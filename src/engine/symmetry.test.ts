import { describe, it, expect } from 'vitest';
import { mirrorHit, mirrorStamp, symmetricStamps, SymmetricGrabStroke } from './symmetry';
import type { Stamp } from '../core/brushes/brush-kernel';
import { applyDraw } from '../core/brushes/draw';
import { recomputeAffectedRegionNormals } from '../core/mesh/normals';
import { buildVertexAdjacency } from '../core/mesh/adjacency';
import { buildSpatialHash, queryRadius } from '../core/mesh/spatial-hash';
import { sphere } from '../core/mesh/primitives';
import type { SurfaceHit } from './stroke';

const baseStamp: Stamp = {
  center: [3, 4, 5],
  normal: [0.6, 0.8, 0],
  radius: 7,
  strength: 0.5,
  dragDelta: null,
};

describe('mirrorStamp', () => {
  it('negates the x component of center and normal, leaving everything else', () => {
    const mirrored = mirrorStamp(baseStamp);

    expect(mirrored.center).toEqual([-3, 4, 5]);
    expect(mirrored.normal).toEqual([-0.6, 0.8, 0]);
    expect(mirrored.radius).toBe(baseStamp.radius);
    expect(mirrored.strength).toBe(baseStamp.strength);
    expect(mirrored.dragDelta).toBeNull();
  });

  it('mirrors dragDelta when present', () => {
    const withDrag: Stamp = { ...baseStamp, dragDelta: [1, 2, 3] };
    expect(mirrorStamp(withDrag).dragDelta).toEqual([-1, 2, 3]);
  });
});

describe('mirrorHit', () => {
  it('negates the x component of point, normal, and worldDelta', () => {
    const hit: SurfaceHit = { point: [2, 3, 4], normal: [1, 0, 0], worldDelta: [5, 6, 7] };
    expect(mirrorHit(hit)).toEqual({ point: [-2, 3, 4], normal: [-1, 0, 0], worldDelta: [-5, 6, 7] });
  });

  it('leaves worldDelta undefined when the original hit has none', () => {
    const hit: SurfaceHit = { point: [2, 3, 4], normal: [1, 0, 0] };
    expect(mirrorHit(hit).worldDelta).toBeUndefined();
  });
});

describe('symmetricStamps', () => {
  it('returns only the original stamp when symmetry is off', () => {
    expect(symmetricStamps(baseStamp, 'none')).toEqual([baseStamp]);
  });

  it('returns the stamp plus its x-mirror when symmetry is on', () => {
    const expanded = symmetricStamps(baseStamp, 'x');
    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toEqual(baseStamp);
    expect(expanded[1]).toEqual(mirrorStamp(baseStamp));
  });

  it('a later call with a different axis does not affect an earlier call\'s result', () => {
    // Demonstrates FR-11 ("toggling affects only subsequent strokes") at
    // the API level: axis is an explicit argument, not shared mutable
    // state, so there is nothing for a later call to retroactively change.
    const first = symmetricStamps(baseStamp, 'x');
    symmetricStamps(baseStamp, 'none');

    expect(first).toHaveLength(2);
    expect(first[1]).toEqual(mirrorStamp(baseStamp));
  });
});

/** Brute-force nearest-position match, independent of any mirroring machinery — test-only. */
function findMirrorVertex(
  positions: Float32Array,
  vertexCount: number,
  target: readonly [number, number, number],
): number {
  let best = -1;
  let bestDistSq = Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const dx = positions[v * 3]! - target[0];
    const dy = positions[v * 3 + 1]! - target[1];
    const dz = positions[v * 3 + 2]! - target[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = v;
    }
  }
  return best;
}

describe('symmetricStamps end-to-end with a Draw stroke on a sphere', () => {
  it('produces mirror-equal displacement on -X for a +X stroke', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const spatialHash = buildSpatialHash(mesh);
    const before = mesh.positions.slice();

    // A vertex on the +X side of the sphere's equator.
    const originVertex = findMirrorVertex(before, mesh.vertexCount, [25, 0, 0]);
    const origin: [number, number, number] = [
      before[originVertex * 3]!,
      before[originVertex * 3 + 1]!,
      before[originVertex * 3 + 2]!,
    ];
    const mirrorTarget: [number, number, number] = [-origin[0], origin[1], origin[2]];
    const mirrorVertex = findMirrorVertex(before, mesh.vertexCount, mirrorTarget);
    // Sanity: the sphere really does have an exact mirror partner here.
    expect(before[mirrorVertex * 3]!).toBeCloseTo(-origin[0], 4);

    const stamp: Stamp = {
      center: origin,
      normal: origin.map((c) => c / 25) as [number, number, number],
      radius: 15,
      strength: 0.6,
      dragDelta: null,
    };

    for (const s of symmetricStamps(stamp, 'x')) {
      const affected = queryRadius(spatialHash, mesh.positions, s.center, s.radius);
      applyDraw({ positions: mesh.positions, normals: mesh.normals, adjacency, affectedIndices: affected, stamp: s });
      recomputeAffectedRegionNormals(mesh.positions, mesh.indices, mesh.normals, adjacency, affected);
    }

    const originDelta = [0, 1, 2].map((i) => mesh.positions[originVertex * 3 + i]! - before[originVertex * 3 + i]!);
    const mirrorDelta = [0, 1, 2].map((i) => mesh.positions[mirrorVertex * 3 + i]! - before[mirrorVertex * 3 + i]!);

    expect(originDelta[0]).not.toBeCloseTo(0, 6); // the stroke actually did something
    expect(mirrorDelta[0]!).toBeCloseTo(-originDelta[0]!, 4);
    expect(mirrorDelta[1]!).toBeCloseTo(originDelta[1]!, 4);
    expect(mirrorDelta[2]!).toBeCloseTo(originDelta[2]!, 4);
  });
});

describe('SymmetricGrabStroke', () => {
  function sphereFixture(): { mesh: ReturnType<typeof sphere>; spatialHash: ReturnType<typeof buildSpatialHash> } {
    const mesh = sphere(50);
    const spatialHash = buildSpatialHash(mesh);
    return { mesh, spatialHash };
  }

  it('translates both the primary and mirrored vertex sets in mirrored directions', () => {
    const { mesh, spatialHash } = sphereFixture();
    const before = mesh.positions.slice();
    const originVertex = findMirrorVertex(before, mesh.vertexCount, [25, 0, 0]);
    const origin: [number, number, number] = [
      before[originVertex * 3]!,
      before[originVertex * 3 + 1]!,
      before[originVertex * 3 + 2]!,
    ];
    const mirrorVertex = findMirrorVertex(before, mesh.vertexCount, [-origin[0], origin[1], origin[2]]);

    const stamp: Stamp = { center: origin, normal: [1, 0, 0], radius: 15, strength: 1, dragDelta: null };
    const grab = new SymmetricGrabStroke(mesh.positions, spatialHash, stamp, 'x');

    grab.update({ point: origin, normal: [1, 0, 0], worldDelta: [0, 3, 0] });

    const originDeltaY = mesh.positions[originVertex * 3 + 1]! - before[originVertex * 3 + 1]!;
    const mirrorDeltaY = mesh.positions[mirrorVertex * 3 + 1]! - before[mirrorVertex * 3 + 1]!;
    const mirrorDeltaX = mesh.positions[mirrorVertex * 3]! - before[mirrorVertex * 3]!;

    expect(originDeltaY).toBeGreaterThan(0);
    expect(mirrorDeltaY).toBeCloseTo(originDeltaY, 4); // y is not mirrored
    expect(mirrorDeltaX).toBeCloseTo(0, 4); // no x drag was applied, mirrored or not
  });

  it('does not create a mirrored side when symmetry is off', () => {
    const { mesh, spatialHash } = sphereFixture();
    const before = mesh.positions.slice();
    const originVertex = findMirrorVertex(before, mesh.vertexCount, [25, 0, 0]);
    const origin: [number, number, number] = [
      before[originVertex * 3]!,
      before[originVertex * 3 + 1]!,
      before[originVertex * 3 + 2]!,
    ];
    const mirrorVertex = findMirrorVertex(before, mesh.vertexCount, [-origin[0], origin[1], origin[2]]);

    const stamp: Stamp = { center: origin, normal: [1, 0, 0], radius: 15, strength: 1, dragDelta: null };
    const grab = new SymmetricGrabStroke(mesh.positions, spatialHash, stamp, 'none');

    grab.update({ point: origin, normal: [1, 0, 0], worldDelta: [0, 3, 0] });

    expect(mesh.positions[mirrorVertex * 3 + 1]!).toBeCloseTo(before[mirrorVertex * 3 + 1]!, 6);
  });

  it('a symmetric grab already in progress keeps mirroring even if a later grab uses "none"', () => {
    // FR-11: axis is bound at construction, so an in-progress symmetric
    // grab is unaffected by what a subsequently-constructed grab uses.
    const { mesh, spatialHash } = sphereFixture();
    const before = mesh.positions.slice();
    const originVertex = findMirrorVertex(before, mesh.vertexCount, [25, 0, 0]);
    const origin: [number, number, number] = [
      before[originVertex * 3]!,
      before[originVertex * 3 + 1]!,
      before[originVertex * 3 + 2]!,
    ];
    const mirrorVertex = findMirrorVertex(before, mesh.vertexCount, [-origin[0], origin[1], origin[2]]);

    const stamp: Stamp = { center: origin, normal: [1, 0, 0], radius: 15, strength: 1, dragDelta: null };
    const ongoing = new SymmetricGrabStroke(mesh.positions, spatialHash, stamp, 'x');
    // Simulate a symmetry toggle: a brand new grab constructed afterward
    // uses 'none' — it must not retroactively change `ongoing`.
    new SymmetricGrabStroke(mesh.positions, spatialHash, stamp, 'none');

    ongoing.update({ point: origin, normal: [1, 0, 0], worldDelta: [0, 3, 0] });

    expect(mesh.positions[mirrorVertex * 3 + 1]!).not.toBeCloseTo(before[mirrorVertex * 3 + 1]!, 6);
  });

  it('releases both sides on end(), after which updates are no-ops', () => {
    const { mesh, spatialHash } = sphereFixture();
    const originVertex = findMirrorVertex(mesh.positions, mesh.vertexCount, [25, 0, 0]);
    const origin: [number, number, number] = [
      mesh.positions[originVertex * 3]!,
      mesh.positions[originVertex * 3 + 1]!,
      mesh.positions[originVertex * 3 + 2]!,
    ];
    const stamp: Stamp = { center: origin, normal: [1, 0, 0], radius: 15, strength: 1, dragDelta: null };
    const grab = new SymmetricGrabStroke(mesh.positions, spatialHash, stamp, 'x');

    grab.end();
    const after = mesh.positions.slice();
    const moved = grab.update({ point: origin, normal: [1, 0, 0], worldDelta: [0, 5, 0] });

    expect(grab.isActive).toBe(false);
    expect(moved).toBe(false);
    expect(mesh.positions).toEqual(after);
  });

  it('is a safe no-op on an off-mesh update', () => {
    const { mesh, spatialHash } = sphereFixture();
    const originVertex = findMirrorVertex(mesh.positions, mesh.vertexCount, [25, 0, 0]);
    const origin: [number, number, number] = [
      mesh.positions[originVertex * 3]!,
      mesh.positions[originVertex * 3 + 1]!,
      mesh.positions[originVertex * 3 + 2]!,
    ];
    const stamp: Stamp = { center: origin, normal: [1, 0, 0], radius: 15, strength: 1, dragDelta: null };
    const grab = new SymmetricGrabStroke(mesh.positions, spatialHash, stamp, 'x');
    const before = mesh.positions.slice();

    expect(grab.update(null)).toBe(false);
    expect(mesh.positions).toEqual(before);
  });
});
