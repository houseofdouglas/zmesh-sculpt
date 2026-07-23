import { describe, it, expect } from 'vitest';
import { GrabStroke, STAMP_SPACING_FRACTION, StrokeSampler, type SurfaceHit } from './stroke';
import type { Stamp } from '../core/brushes/brush-kernel';

const UP: readonly [number, number, number] = [0, 1, 0];

function hitAt(x: number, y = 0, z = 0): SurfaceHit {
  return { point: [x, y, z], normal: UP };
}

/** Runs a straight stroke along +X from 0 to `endX` in samples of `sampleStep` mm. */
function strokeAlongX(sampler: StrokeSampler, endX: number, sampleStep: number): Stamp[] {
  const stamps = sampler.begin(hitAt(0));
  for (let x = sampleStep; x <= endX + 1e-9; x += sampleStep) {
    stamps.push(...sampler.update(hitAt(x)));
  }
  sampler.end();
  return stamps;
}

describe('StrokeSampler', () => {
  it('spaces stamps by distance travelled, so fast and slow strokes match', () => {
    // Same 100mm path, same brush: 100 short samples (slow drag) vs. a
    // single 100mm sample (a fast flick that skipped every frame between).
    const slow = strokeAlongX(new StrokeSampler(10, 0.5), 100, 1);
    const fast = strokeAlongX(new StrokeSampler(10, 0.5), 100, 100);

    expect(slow).toHaveLength(fast.length);
    for (let i = 0; i < slow.length; i++) {
      expect(slow[i]!.center[0]).toBeCloseTo(fast[i]!.center[0], 3);
      expect(slow[i]!.center[1]).toBeCloseTo(fast[i]!.center[1], 6);
      expect(slow[i]!.center[2]).toBeCloseTo(fast[i]!.center[2], 6);
    }

    // And the spacing is the one FR-7 asks for: proportional to brush size.
    const spacing = 10 * STAMP_SPACING_FRACTION;
    expect(slow).toHaveLength(1 + 100 / spacing);
    expect(slow[0]!.center[0]).toBeCloseTo(0, 6);
    expect(slow[1]!.center[0]).toBeCloseTo(spacing, 6);
  });

  it('scales stamp spacing with brush size', () => {
    const small = strokeAlongX(new StrokeSampler(4, 0.5), 40, 40);
    const large = strokeAlongX(new StrokeSampler(20, 0.5), 40, 40);

    expect(small[1]!.center[0]).toBeCloseTo(1, 6);
    expect(large[1]!.center[0]).toBeCloseTo(5, 6);
    expect(small.length).toBeGreaterThan(large.length);
  });

  it('interpolates stamps between sparse samples, with unit normals', () => {
    // Two samples 90 degrees apart on a unit-ish arc: the interpolated
    // stamps must land between them with usable (unit-length) normals.
    const sampler = new StrokeSampler(10, 1);
    sampler.begin({ point: [0, 0, 0], normal: [0, 1, 0] });
    const stamps = sampler.update({ point: [10, 0, 0], normal: [1, 0, 0] });

    expect(stamps.length).toBeGreaterThan(1);
    for (const stamp of stamps) {
      const [nx, ny, nz] = stamp.normal;
      expect(Math.sqrt(nx * nx + ny * ny + nz * nz)).toBeCloseTo(1, 6);
      expect(stamp.center[0]).toBeGreaterThan(0);
      expect(stamp.center[0]).toBeLessThanOrEqual(10);
    }
    // The normal rotates from the start normal toward the end normal.
    expect(stamps[stamps.length - 1]!.normal[0]).toBeGreaterThan(stamps[0]!.normal[0]);
  });

  it('carries the brush radius and signed strength onto every stamp', () => {
    const stamps = strokeAlongX(new StrokeSampler(8, -0.7), 8, 8);

    expect(stamps.length).toBeGreaterThan(1);
    for (const stamp of stamps) {
      expect(stamp.radius).toBe(8);
      expect(stamp.strength).toBe(-0.7);
      expect(stamp.dragDelta).toBeNull();
    }
  });

  it('emits nothing when the cursor is held still', () => {
    const sampler = new StrokeSampler(10, 1);
    sampler.begin(hitAt(0));

    expect(sampler.update(hitAt(0))).toEqual([]);
    expect(sampler.update(hitAt(0))).toEqual([]);
  });

  it('treats an off-mesh update as a no-op and does not stamp across the gap', () => {
    const sampler = new StrokeSampler(10, 1);
    sampler.begin(hitAt(0));

    expect(sampler.update(null)).toEqual([]);
    expect(sampler.isActive).toBe(true);

    // Re-entering 100mm away re-anchors rather than filling the gap with
    // 40 stamps through empty space.
    const resumed = sampler.update(hitAt(100));
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.center[0]).toBeCloseTo(100, 6);
  });

  it('is a no-op for a degenerate brush and after end()', () => {
    const zeroRadius = new StrokeSampler(0, 1);
    expect(zeroRadius.begin(hitAt(0))).toEqual([]);
    expect(zeroRadius.update(hitAt(10))).toEqual([]);
    expect(zeroRadius.isActive).toBe(false);

    const zeroStrength = new StrokeSampler(10, 0);
    expect(zeroStrength.begin(hitAt(0))).toEqual([]);
    expect(zeroStrength.update(hitAt(10))).toEqual([]);

    const ended = new StrokeSampler(10, 1);
    ended.begin(hitAt(0));
    ended.end();
    expect(ended.update(hitAt(10))).toEqual([]);
    expect(ended.isActive).toBe(false);
  });

  it('rejects a non-positive spacing fraction (it would never terminate)', () => {
    expect(() => new StrokeSampler(10, 1, 0)).toThrow(RangeError);
  });
});

/** Three collinear vertices at distance 0, 5 and 10 from the origin. */
function grabFixture(): { positions: Float32Array; stamp: Stamp } {
  const positions = new Float32Array([
    0, 0, 0, // vertex 0: at the center, falloff 1
    5, 0, 0, // vertex 1: halfway out, falloff 0.5
    10, 0, 0, // vertex 2: at the radius edge, falloff 0
  ]);
  const stamp: Stamp = {
    center: [0, 0, 0],
    normal: UP,
    radius: 10,
    strength: 1,
    dragDelta: null,
  };
  return { positions, stamp };
}

describe('GrabStroke', () => {
  it('translates the affected set with the cursor, weighted by falloff', () => {
    const { positions, stamp } = grabFixture();
    const grab = new GrabStroke(positions, [0, 1, 2], stamp);

    const moved = grab.update({ point: [0, 2, 0], normal: UP, worldDelta: [0, 2, 0] });

    expect(moved).toBe(true);
    expect(positions[1]).toBeCloseTo(2, 6); // center: full drag
    expect(positions[4]).toBeCloseTo(1, 6); // halfway: smoothstep(0.5) = 0.5
    expect(positions[7]).toBe(0); // edge: weight 0, bit-identical
  });

  it('keeps the vertex set fixed as the region is dragged away', () => {
    const { positions, stamp } = grabFixture();
    // Vertex 2 starts outside the falloff, so it must never move — even
    // once vertex 0 has been dragged right on top of it.
    const grab = new GrabStroke(positions, [0, 1, 2], stamp);
    const before2 = positions.slice(6, 9);

    for (let i = 0; i < 5; i++) {
      grab.update({ point: [0, 0, 0], normal: UP, worldDelta: [2, 0, 0] });
    }

    expect(positions[0]).toBeCloseTo(10, 6); // vertex 0 dragged 5 x 2mm
    expect(positions.slice(6, 9)).toEqual(before2);
    expect(grab.affectedIndices).toEqual(Uint32Array.from([0, 1]));
  });

  it('stops moving vertices once the grab is released', () => {
    const { positions, stamp } = grabFixture();
    const grab = new GrabStroke(positions, [0, 1, 2], stamp);
    grab.update({ point: [0, 1, 0], normal: UP, worldDelta: [0, 1, 0] });

    grab.end();
    const afterRelease = positions.slice();
    const moved = grab.update({ point: [0, 9, 0], normal: UP, worldDelta: [0, 8, 0] });

    expect(grab.isActive).toBe(false);
    expect(moved).toBe(false);
    expect(positions).toEqual(afterRelease);
  });

  it('is a safe no-op on an off-mesh update', () => {
    const { positions, stamp } = grabFixture();
    const grab = new GrabStroke(positions, [0, 1, 2], stamp);
    const before = positions.slice();

    expect(grab.update(null)).toBe(false);
    expect(positions).toEqual(before);
  });

  it('derives the drag from hit points when the viewport supplies no worldDelta', () => {
    const { positions, stamp } = grabFixture();
    const grab = new GrabStroke(positions, [0, 1, 2], stamp);

    grab.update({ point: [0, 3, 0], normal: UP });

    expect(positions[1]).toBeCloseTo(3, 6);
  });

  it('clamps a cursor jump to the per-update safety cap', () => {
    const { positions, stamp } = grabFixture();
    const grab = new GrabStroke(positions, [0, 1, 2], stamp);

    grab.update({ point: [0, 500, 0], normal: UP, worldDelta: [0, 500, 0] });

    expect(positions[1]).toBeCloseTo(5, 6); // MAX_STAMP_DISPLACEMENT_MM
  });

  it('ignores the invert sign — the drag direction is the direction', () => {
    const { positions, stamp } = grabFixture();
    const inverted = new GrabStroke(positions, [0, 1, 2], { ...stamp, strength: -1 });

    inverted.update({ point: [0, 2, 0], normal: UP, worldDelta: [0, 2, 0] });

    expect(positions[1]).toBeCloseTo(2, 6); // pulled with the cursor, not against it
  });
});
