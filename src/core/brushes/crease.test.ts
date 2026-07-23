import { describe, it, expect } from 'vitest';
import { applyCrease } from './crease';
import type { BrushKernelContext, Stamp } from './brush-kernel';

function makeContext(
  positions: Float32Array,
  stamp: Stamp,
  affectedIndices: number[],
): BrushKernelContext {
  return {
    positions,
    normals: new Float32Array(positions.length), // unused by Crease
    adjacency: { offsets: new Uint32Array(1), neighbors: new Uint32Array(0) }, // unused by Crease
    affectedIndices,
    stamp,
  };
}

describe('applyCrease', () => {
  it('displaces inward along the stamp normal by default (cuts a valley)', () => {
    const positions = new Float32Array([0, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    applyCrease(context);

    expect(context.positions[2]).toBeLessThan(0);
  });

  it('displaces outward along the stamp normal when strength is negative — invert (raised ridge)', () => {
    const positions = new Float32Array([0, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: -1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    applyCrease(context);

    expect(context.positions[2]).toBeGreaterThan(0);
  });

  it('also pulls tangentially toward the stamp axis (the Pinch component)', () => {
    const positions = new Float32Array([5, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    const beforeTangential = Math.hypot(positions[0]!, positions[1]!);
    applyCrease(context);
    const afterTangential = Math.hypot(context.positions[0]!, context.positions[1]!);

    expect(afterTangential).toBeLessThan(beforeTangential);
  });

  it('leaves vertices beyond the radius bit-identical', () => {
    const positions = new Float32Array([20, 0, 0]);
    const original = positions.slice();
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    applyCrease(context);

    expect(context.positions).toEqual(original);
  });
});
