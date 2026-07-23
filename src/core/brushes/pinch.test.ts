import { describe, it, expect } from 'vitest';
import { applyPinch } from './pinch';
import type { BrushKernelContext, Stamp } from './brush-kernel';

function makeContext(
  positions: Float32Array,
  stamp: Stamp,
  affectedIndices: number[],
): BrushKernelContext {
  return {
    positions,
    normals: new Float32Array(positions.length), // unused by Pinch
    adjacency: { offsets: new Uint32Array(1), neighbors: new Uint32Array(0) }, // unused by Pinch
    affectedIndices,
    stamp,
  };
}

describe('applyPinch', () => {
  it('reduces the tangential (in-plane) distance to the stamp center', () => {
    // Stamp centered at origin, normal along +Z: a vertex offset purely
    // in X (fully within the tangent plane) should pull toward the axis.
    const positions = new Float32Array([5, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    const before = Math.hypot(positions[0]!, positions[1]!);
    applyPinch(context);
    const after = Math.hypot(context.positions[0]!, context.positions[1]!);

    expect(after).toBeLessThan(before);
  });

  it('never moves a vertex along the stamp normal', () => {
    const positions = new Float32Array([5, 0, 3]); // tangential (x) + along-normal (z) offset
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    applyPinch(context);

    expect(context.positions[2]).toBeCloseTo(3, 10);
  });

  it('increases tangential distance (spreads) when strength is negative — invert', () => {
    const positions = new Float32Array([5, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 10,
      strength: -1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    const before = Math.hypot(positions[0]!, positions[1]!);
    applyPinch(context);
    const after = Math.hypot(context.positions[0]!, context.positions[1]!);

    expect(after).toBeGreaterThan(before);
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

    applyPinch(context);

    expect(context.positions).toEqual(original);
  });
});
