import { describe, it, expect } from 'vitest';
import { applySmooth } from './smooth';
import type { BrushKernelContext, Stamp } from './brush-kernel';
import { sphere } from '../mesh/primitives';
import { buildVertexAdjacency, type VertexAdjacency } from '../mesh/adjacency';

/** Distance from a vertex to the average position of its one-ring neighbors — a simple curvature proxy. */
function distanceToNeighborAverage(
  positions: Float32Array,
  adjacency: VertexAdjacency,
  vertex: number,
): number {
  const start = adjacency.offsets[vertex]!;
  const end = adjacency.offsets[vertex + 1]!;
  const count = end - start;
  let avgX = 0;
  let avgY = 0;
  let avgZ = 0;
  for (let i = start; i < end; i++) {
    const n = adjacency.neighbors[i]!;
    avgX += positions[n * 3]!;
    avgY += positions[n * 3 + 1]!;
    avgZ += positions[n * 3 + 2]!;
  }
  avgX /= count;
  avgY /= count;
  avgZ /= count;

  const px = positions[vertex * 3]!;
  const py = positions[vertex * 3 + 1]!;
  const pz = positions[vertex * 3 + 2]!;
  const dx = px - avgX;
  const dy = py - avgY;
  const dz = pz - avgZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

describe('applySmooth', () => {
  it('strictly reduces distance-to-neighbor-average (curvature) at an artificial spike', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const positions = mesh.positions.slice();

    // Create an artificial spike: push one vertex far outward along its normal.
    const spikeVertex = 20;
    const nx = mesh.normals[spikeVertex * 3]!;
    const ny = mesh.normals[spikeVertex * 3 + 1]!;
    const nz = mesh.normals[spikeVertex * 3 + 2]!;
    positions[spikeVertex * 3] = positions[spikeVertex * 3]! + nx * 10;
    positions[spikeVertex * 3 + 1] = positions[spikeVertex * 3 + 1]! + ny * 10;
    positions[spikeVertex * 3 + 2] = positions[spikeVertex * 3 + 2]! + nz * 10;

    const before = distanceToNeighborAverage(positions, adjacency, spikeVertex);

    const center: [number, number, number] = [
      positions[spikeVertex * 3]!,
      positions[spikeVertex * 3 + 1]!,
      positions[spikeVertex * 3 + 2]!,
    ];
    const stamp: Stamp = { center, normal: [nx, ny, nz], radius: 15, strength: 1, dragDelta: null };
    const context: BrushKernelContext = {
      positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices: [spikeVertex],
      stamp,
    };

    applySmooth(context);

    const after = distanceToNeighborAverage(positions, adjacency, spikeVertex);
    expect(after).toBeLessThan(before);
  });

  it('is a no-op when strength is negative (invert) — no sharpen in v1', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const positions = mesh.positions.slice();
    const original = positions.slice();

    const stamp: Stamp = {
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 1000,
      strength: -1,
      dragDelta: null,
    };
    const affectedIndices = [0, 1, 2, 3, 4];
    const context: BrushKernelContext = {
      positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices,
      stamp,
    };

    applySmooth(context);

    expect(positions).toEqual(original);
  });

  it('leaves vertices beyond the radius bit-identical', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);
    const positions = mesh.positions.slice();
    const original = positions.slice();

    // A single vertex far from a tiny-radius stamp centered elsewhere.
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

    applySmooth(context);

    expect(positions).toEqual(original);
  });
});
