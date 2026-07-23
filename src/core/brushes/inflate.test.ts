import { describe, it, expect } from 'vitest';
import { applyInflate } from './inflate';
import type { BrushKernelContext, Stamp } from './brush-kernel';
import { sphere } from '../mesh/primitives';
import { buildVertexAdjacency } from '../mesh/adjacency';

/**
 * Signed enclosed volume of a closed, consistently-outward-oriented mesh,
 * via the standard divergence-theorem sum over triangles:
 * V = (1/6) * sum(v0 . (v1 x v2)). Exact for any watertight mesh
 * regardless of where the origin sits relative to it.
 */
function computeSignedVolume(positions: Float32Array, indices: Uint32Array, triangleCount: number): number {
  let volume = 0;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3]!;
    const i1 = indices[t * 3 + 1]!;
    const i2 = indices[t * 3 + 2]!;

    const x0 = positions[i0 * 3]!;
    const y0 = positions[i0 * 3 + 1]!;
    const z0 = positions[i0 * 3 + 2]!;
    const x1 = positions[i1 * 3]!;
    const y1 = positions[i1 * 3 + 1]!;
    const z1 = positions[i1 * 3 + 2]!;
    const x2 = positions[i2 * 3]!;
    const y2 = positions[i2 * 3 + 1]!;
    const z2 = positions[i2 * 3 + 2]!;

    const cx = y1 * z2 - z1 * y2;
    const cy = z1 * x2 - x1 * z2;
    const cz = x1 * y2 - y1 * x2;

    volume += x0 * cx + y0 * cy + z0 * cz;
  }
  return volume / 6;
}

describe('applyInflate', () => {
  it('increases enclosed volume when applied across the whole mesh', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh); // unused by Inflate, required by context shape
    const positions = mesh.positions.slice();

    const volumeBefore = computeSignedVolume(positions, mesh.indices, mesh.triangleCount);

    // A radius far larger than the sphere gives falloff ~= 1 everywhere,
    // so every vertex inflates at close to full strength.
    const allIndices = Array.from({ length: mesh.vertexCount }, (_, i) => i);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0], // unused by Inflate (it uses each vertex's own normal)
      radius: 1000,
      strength: 1,
      dragDelta: null,
    };
    const context: BrushKernelContext = {
      positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices: allIndices,
      stamp,
    };

    applyInflate(context);

    const volumeAfter = computeSignedVolume(positions, mesh.indices, mesh.triangleCount);
    expect(volumeAfter).toBeGreaterThan(volumeBefore);
  });

  it('decreases enclosed volume (deflates) when strength is negative', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const positions = mesh.positions.slice();

    const volumeBefore = computeSignedVolume(positions, mesh.indices, mesh.triangleCount);

    const allIndices = Array.from({ length: mesh.vertexCount }, (_, i) => i);
    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 1000,
      strength: -1,
      dragDelta: null,
    };
    const context: BrushKernelContext = {
      positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices: allIndices,
      stamp,
    };

    applyInflate(context);

    const volumeAfter = computeSignedVolume(positions, mesh.indices, mesh.triangleCount);
    expect(volumeAfter).toBeLessThan(volumeBefore);
  });

  it('leaves vertices beyond the radius bit-identical', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const positions = mesh.positions.slice();
    const original = positions.slice();

    const stamp: Stamp = {
      center: [1000, 1000, 1000],
      normal: [0, 1, 0],
      radius: 1,
      strength: 1,
      dragDelta: null,
    };
    const context: BrushKernelContext = {
      positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices: [0],
      stamp,
    };

    applyInflate(context);

    expect(positions).toEqual(original);
  });

  it('never exceeds the safety cap regardless of strength', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const positions = mesh.positions.slice();
    const before = positions.slice();

    const stamp: Stamp = {
      center: [positions[0]!, positions[1]!, positions[2]!],
      normal: [0, 1, 0],
      radius: 1000,
      strength: 1000, // extreme
      dragDelta: null,
    };
    const context: BrushKernelContext = {
      positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices: [0],
      stamp,
    };

    applyInflate(context);

    const dx = positions[0]! - before[0]!;
    const dy = positions[1]! - before[1]!;
    const dz = positions[2]! - before[2]!;
    const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(moved).toBeLessThanOrEqual(5);
  });
});
