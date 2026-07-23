import { describe, it, expect } from 'vitest';
import { applyDraw } from './draw';
import type { BrushKernelContext, Stamp } from './brush-kernel';

function makeContext(
  positions: Float32Array,
  stamp: Stamp,
  affectedIndices: number[],
): BrushKernelContext {
  return {
    positions,
    normals: new Float32Array(positions.length), // unused by Draw
    adjacency: { offsets: new Uint32Array(1), neighbors: new Uint32Array(0) }, // unused by Draw
    affectedIndices,
    stamp,
  };
}

describe('applyDraw', () => {
  it('raises vertices along the stamp normal, weighted by falloff', () => {
    const positions = new Float32Array([
      0, 0, 0, // vertex 0: at the stamp center, distance 0
      5, 0, 0, // vertex 1: distance 5, halfway to the radius edge
      10, 0, 0, // vertex 2: distance 10, exactly at the radius edge
    ]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0, 1, 2]);

    applyDraw(context);

    const yAt = (vertex: number): number => context.positions[vertex * 3 + 1]!;

    expect(yAt(0)).toBeGreaterThan(0); // center: full displacement
    expect(yAt(1)).toBeGreaterThan(0); // halfway: some displacement
    expect(yAt(1)).toBeLessThan(yAt(0)); // less than the center (monotonic falloff)
    expect(yAt(2)).toBeCloseTo(0, 10); // edge: displacement ~0

    // Only the stamp-normal axis (y) should have moved.
    expect(context.positions[0]).toBeCloseTo(0, 10);
    expect(context.positions[2]).toBeCloseTo(0, 10);
  });

  it('leaves vertices at or beyond the radius bit-identical, even if passed as affected', () => {
    const positions = new Float32Array([10, 0, 0, 20, 0, 0]); // exactly at, and beyond, the edge
    const original = positions.slice();
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 10,
      strength: 1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0, 1]);

    applyDraw(context);

    expect(context.positions).toEqual(original);
  });

  it('subtracts (indents) when strength is negative — invert', () => {
    const positions = new Float32Array([0, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 10,
      strength: -1,
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    applyDraw(context);

    expect(context.positions[1]).toBeLessThan(0);
  });

  it('never exceeds the safety cap regardless of strength', () => {
    const positions = new Float32Array([0, 0, 0]);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 10,
      strength: 1000, // extreme
      dragDelta: null,
    };
    const context = makeContext(positions, stamp, [0]);

    applyDraw(context);

    expect(Math.abs(context.positions[1]!)).toBeLessThanOrEqual(5);
  });
});
