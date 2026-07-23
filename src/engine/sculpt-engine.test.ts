import { describe, it, expect } from 'vitest';
import { SculptEngine, type DirtyRegion } from './sculpt-engine';
import type { SculptMesh } from '../core/mesh/sculpt-mesh';
import type { SurfaceHit } from './stroke';

function nearestVertex(mesh: Readonly<SculptMesh>, target: readonly [number, number, number]): number {
  let best = -1;
  let bestDistSq = Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const dx = mesh.positions[v * 3]! - target[0];
    const dy = mesh.positions[v * 3 + 1]! - target[1];
    const dz = mesh.positions[v * 3 + 2]! - target[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = v;
    }
  }
  return best;
}

function hitAtVertex(mesh: Readonly<SculptMesh>, v: number): SurfaceHit {
  return {
    point: [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!],
    normal: [mesh.normals[v * 3]!, mesh.normals[v * 3 + 1]!, mesh.normals[v * 3 + 2]!],
  };
}

describe('SculptEngine', () => {
  it('starts with a default sphere mesh (FR-01)', () => {
    const engine = new SculptEngine();
    const mesh = engine.getMesh();
    expect(mesh.vertexCount).toBeGreaterThan(0);
    expect(mesh.triangleCount).toBeGreaterThan(0);
  });

  it('newFromPrimitive replaces the mesh with the requested shape', () => {
    const engine = new SculptEngine();
    const before = engine.getMesh();
    engine.newFromPrimitive('block');
    const after = engine.getMesh();
    expect(after).not.toBe(before);
    expect(after.vertexCount).toBe(8); // block: 8 shared corner vertices
  });

  it('rejects loading an empty/zero-vertex mesh', () => {
    const engine = new SculptEngine();
    const empty: SculptMesh = {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      normals: new Float32Array(0),
      vertexCount: 0,
      triangleCount: 0,
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    };
    expect(() => engine.loadMesh(empty)).toThrow();
  });

  it('clamps brush size and strength to sane bounds without throwing', () => {
    const engine = new SculptEngine();
    expect(() => engine.setBrushSize(-100)).not.toThrow();
    expect(() => engine.setBrushSize(1e9)).not.toThrow();
    expect(() => engine.setBrushStrength(-5)).not.toThrow();
    expect(() => engine.setBrushStrength(5)).not.toThrow();
  });

  it('end-to-end: load sphere, configure brush, stroke, undo/redo restore exactly', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');
    engine.setBrushSize(8);
    engine.setBrushStrength(0.8);
    engine.setSymmetry('none'); // isolate to one side for a simpler assertion

    const meshBefore = engine.getMesh();
    const beforePositions = meshBefore.positions.slice();
    const v1 = nearestVertex(meshBefore, [25, 0, 0]);
    const v2 = nearestVertex(meshBefore, [20, 0, 15]);
    const hit1 = hitAtVertex(meshBefore, v1);
    const hit2 = hitAtVertex(meshBefore, v2);

    expect(engine.canUndo).toBe(false);

    engine.beginStroke(hit1);
    engine.updateStroke(hit2);
    engine.endStroke();

    const meshAfter = engine.getMesh();
    expect(meshAfter.positions[v1 * 3]!).not.toBeCloseTo(beforePositions[v1 * 3]!, 6);
    expect(engine.canUndo).toBe(true);
    expect(engine.canRedo).toBe(false);

    engine.undo();
    expect(engine.getMesh().positions).toEqual(beforePositions); // bit-identical restore
    expect(engine.canUndo).toBe(false);
    expect(engine.canRedo).toBe(true);

    const afterUndo = engine.getMesh().positions.slice();
    engine.redo();
    expect(engine.getMesh().positions).not.toEqual(afterUndo);
    expect(engine.getMesh().positions[v1 * 3]!).not.toBeCloseTo(beforePositions[v1 * 3]!, 6);
  });

  it('onChange fires with a correct DirtyRegion per stamp, and stops after unsubscribe', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setSymmetry('none');
    engine.setBrush('draw');
    engine.setBrushSize(8);
    engine.setBrushStrength(0.8);

    const regions: DirtyRegion[] = [];
    const unsubscribe = engine.onChange((region) => regions.push(region));

    const mesh = engine.getMesh();
    const v = nearestVertex(mesh, [25, 0, 0]);
    const hit = hitAtVertex(mesh, v);

    engine.beginStroke(hit);
    expect(regions.length).toBeGreaterThan(0);
    const region = regions[0]!;
    expect(region.vertexStart).toBeLessThanOrEqual(v);
    expect(region.vertexEnd).toBeGreaterThan(v);
    expect(region.aabb.min).toHaveLength(3);
    expect(region.aabb.max).toHaveLength(3);

    engine.endStroke();
    unsubscribe();
    const countAfterUnsubscribe = regions.length;

    engine.beginStroke(hit);
    engine.endStroke();
    expect(regions.length).toBe(countAfterUnsubscribe);
  });

  it('Grab pins and translates the affected region, and is undoable', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setSymmetry('none');
    engine.setBrush('grab');
    engine.setBrushSize(10);
    engine.setBrushStrength(1);

    const mesh = engine.getMesh();
    const before = mesh.positions.slice();
    const v = nearestVertex(mesh, [25, 0, 0]);
    const hit = hitAtVertex(mesh, v);

    engine.beginStroke(hit);
    engine.updateStroke({ point: hit.point, normal: hit.normal, worldDelta: [0, 5, 0] });
    engine.endStroke();

    expect(engine.getMesh().positions[v * 3 + 1]!).toBeGreaterThan(before[v * 3 + 1]!);
    expect(engine.canUndo).toBe(true);

    engine.undo();
    expect(engine.getMesh().positions).toEqual(before);
  });

  it('mirrors a stroke across x=0 by default (FR-10)', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');
    engine.setBrushSize(10);
    engine.setBrushStrength(0.6);
    // symmetry left at its default (ON, x)

    const before = engine.getMesh().positions.slice();
    const v = nearestVertex(engine.getMesh(), [25, 0, 0]);
    const mirrorV = nearestVertex(engine.getMesh(), [-before[v * 3]!, before[v * 3 + 1]!, before[v * 3 + 2]!]);
    const hit = hitAtVertex(engine.getMesh(), v);

    engine.beginStroke(hit);
    engine.endStroke();

    const after = engine.getMesh().positions;
    const deltaX = after[v * 3]! - before[v * 3]!;
    const mirrorDeltaX = after[mirrorV * 3]! - before[mirrorV * 3]!;
    expect(deltaX).not.toBeCloseTo(0, 6);
    expect(mirrorDeltaX).toBeCloseTo(-deltaX, 4);
  });

  it('toggling symmetry off affects only the next stroke, not one already committed', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');
    engine.setBrushSize(10);
    engine.setBrushStrength(0.6);

    const before = engine.getMesh().positions.slice();
    const v1 = nearestVertex(engine.getMesh(), [25, 0, 0]);
    const mirrorV1 = nearestVertex(engine.getMesh(), [-before[v1 * 3]!, before[v1 * 3 + 1]!, before[v1 * 3 + 2]!]);

    engine.beginStroke(hitAtVertex(engine.getMesh(), v1));
    engine.endStroke();
    const afterMirroredStroke = engine.getMesh().positions.slice();
    expect(afterMirroredStroke[mirrorV1 * 3]!).not.toBeCloseTo(before[mirrorV1 * 3]!, 6);

    engine.setSymmetry('none');
    const v2 = nearestVertex(engine.getMesh(), [0, 0, 25]);
    const mirrorV2 = nearestVertex(engine.getMesh(), [
      -afterMirroredStroke[v2 * 3]!,
      afterMirroredStroke[v2 * 3 + 1]!,
      afterMirroredStroke[v2 * 3 + 2]!,
    ]);
    engine.beginStroke(hitAtVertex(engine.getMesh(), v2));
    engine.endStroke();

    // The second stroke's mirror side must be untouched — symmetry was off for it.
    expect(engine.getMesh().positions[mirrorV2 * 3]!).toBeCloseTo(afterMirroredStroke[mirrorV2 * 3]!, 6);
  });

  it('treats an off-mesh updateStroke(null) mid-stroke as a safe no-op', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');

    const hit = hitAtVertex(engine.getMesh(), nearestVertex(engine.getMesh(), [25, 0, 0]));

    engine.beginStroke(hit);
    const snapshot = engine.getMesh().positions.slice();
    expect(() => engine.updateStroke(null)).not.toThrow();
    expect(engine.getMesh().positions).toEqual(snapshot);
    engine.endStroke();
  });

  it('updateStroke without a preceding beginStroke is a safe no-op', () => {
    const engine = new SculptEngine();
    const snapshot = engine.getMesh().positions.slice();
    expect(() => engine.updateStroke(hitAtVertex(engine.getMesh(), 0))).not.toThrow();
    expect(engine.getMesh().positions).toEqual(snapshot);
  });

  it('a degenerate (zero-strength) stroke commits no history entry', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');
    engine.setBrushStrength(0);

    engine.beginStroke(hitAtVertex(engine.getMesh(), nearestVertex(engine.getMesh(), [25, 0, 0])));
    engine.endStroke();

    expect(engine.canUndo).toBe(false);
  });

  it('undo/redo on a fresh engine are safe no-ops', () => {
    const engine = new SculptEngine();
    expect(engine.canUndo).toBe(false);
    expect(engine.canRedo).toBe(false);
    expect(() => engine.undo()).not.toThrow();
    expect(() => engine.redo()).not.toThrow();
  });

  it('discards the redo branch when a new stroke follows an undo', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');
    engine.setSymmetry('none');

    engine.beginStroke(hitAtVertex(engine.getMesh(), nearestVertex(engine.getMesh(), [25, 0, 0])));
    engine.endStroke();
    engine.undo();
    expect(engine.canRedo).toBe(true);

    engine.beginStroke(hitAtVertex(engine.getMesh(), nearestVertex(engine.getMesh(), [0, 25, 0])));
    engine.endStroke();

    expect(engine.canRedo).toBe(false);
  });

  it('loading a new mesh resets history (old entries reference the old topology)', () => {
    const engine = new SculptEngine();
    engine.newFromPrimitive('sphere');
    engine.setBrush('draw');

    engine.beginStroke(hitAtVertex(engine.getMesh(), nearestVertex(engine.getMesh(), [25, 0, 0])));
    engine.endStroke();
    expect(engine.canUndo).toBe(true);

    engine.newFromPrimitive('block');
    expect(engine.canUndo).toBe(false);
    expect(engine.canRedo).toBe(false);
  });

  it('exposes typed detail getters; setDetail is not yet implemented (Task 16)', async () => {
    const engine = new SculptEngine();
    expect(engine.getDetail()).toBe('med');
    expect(engine.getMaxDetail()).toBe('max');
    await expect(engine.setDetail('high')).rejects.toThrow();
  });
});
