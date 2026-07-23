import { describe, it, expect } from 'vitest';
import { applyFlatten } from './flatten';
import type { BrushKernelContext, Stamp } from './brush-kernel';

function makeContext(
  positions: Float32Array,
  normals: Float32Array,
  stamp: Stamp,
  affectedIndices: number[],
): BrushKernelContext {
  return {
    positions,
    normals,
    adjacency: { offsets: new Uint32Array(1), neighbors: new Uint32Array(0) }, // unused by Flatten
    affectedIndices,
    stamp,
  };
}

function varianceAlongZ(positions: Float32Array, indices: number[]): number {
  const zs = indices.map((i) => positions[i * 3 + 2]!);
  const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
  return zs.reduce((sum, z) => sum + (z - mean) ** 2, 0) / zs.length;
}

// A bumpy 2x2 patch, all vertices facing +Z, at varying heights.
const BUMPY_POSITIONS = (): Float32Array =>
  new Float32Array([0, 0, 2, 5, 0, -1, 0, 5, 3, 5, 5, 0]);
const FLAT_NORMALS = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);

describe('applyFlatten', () => {
  it('reduces distance-variance to the average plane across the affected region', () => {
    const positions = BUMPY_POSITIONS();
    const affectedIndices = [0, 1, 2, 3];
    const beforeVariance = varianceAlongZ(positions, affectedIndices);

    const stamp: Stamp = {
      center: [2.5, 2.5, 1],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, FLAT_NORMALS, stamp, affectedIndices);

    applyFlatten(context);

    const afterVariance = varianceAlongZ(context.positions, affectedIndices);
    expect(afterVariance).toBeLessThan(beforeVariance);
  });

  it('increases distance-variance (moves further from the plane) when strength is negative — emboss', () => {
    const positions = BUMPY_POSITIONS();
    const affectedIndices = [0, 1, 2, 3];
    const beforeVariance = varianceAlongZ(positions, affectedIndices);

    const stamp: Stamp = {
      center: [2.5, 2.5, 1],
      normal: [0, 0, 1],
      radius: 10,
      strength: -1,
      dragDelta: null,
    };
    const context = makeContext(positions, FLAT_NORMALS, stamp, affectedIndices);

    applyFlatten(context);

    const afterVariance = varianceAlongZ(context.positions, affectedIndices);
    expect(afterVariance).toBeGreaterThan(beforeVariance);
  });

  it('leaves vertices beyond the radius bit-identical', () => {
    const positions = new Float32Array([1000, 1000, 1000]);
    const normals = new Float32Array([0, 0, 1]);
    const original = positions.slice();
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 1,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, normals, stamp, [0]);

    applyFlatten(context);

    expect(context.positions).toEqual(original);
  });

  it('is a no-op when affected vertex normals cancel out (degenerate plane)', () => {
    const positions = new Float32Array([0, 0, 1, 0, 0, -1]);
    const normals = new Float32Array([0, 0, 1, 0, 0, -1]); // opposing
    const original = positions.slice();
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, normals, stamp, [0, 1]);

    applyFlatten(context);

    expect(context.positions).toEqual(original);
  });
});
