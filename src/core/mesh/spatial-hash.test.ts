import { describe, it, expect } from 'vitest';
import { buildSpatialHash, queryRadius, updateVertexPosition } from './spatial-hash';
import { sphere } from './primitives';

function bruteForceRadius(
  positions: Float32Array,
  vertexCount: number,
  center: readonly [number, number, number],
  radius: number,
): number[] {
  const [px, py, pz] = center;
  const radiusSq = radius * radius;
  const result: number[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const dx = positions[v * 3]! - px;
    const dy = positions[v * 3 + 1]! - py;
    const dz = positions[v * 3 + 2]! - pz;
    if (dx * dx + dy * dy + dz * dz <= radiusSq) {
      result.push(v);
    }
  }
  return result;
}

describe('spatial hash', () => {
  it('matches brute force exactly across several points and radii', () => {
    const mesh = sphere(50);
    const hash = buildSpatialHash(mesh);

    const cases: Array<[[number, number, number], number]> = [
      [[25, 0, 0], 5],
      [[0, 25, 0], 8],
      [[0, 0, -25], 3],
      [[10, 10, 10], 12],
      [[0, 0, 0], 50], // radius large enough to plausibly span multiple cells' worth of the mesh
    ];

    for (const [center, radius] of cases) {
      const hashResult = new Set(queryRadius(hash, mesh.positions, center, radius));
      const bruteResult = new Set(bruteForceRadius(mesh.positions, mesh.vertexCount, center, radius));
      expect(hashResult).toEqual(bruteResult);
    }
  });

  it('stays correct after updateVertexPosition moves a vertex to a new cell', () => {
    const mesh = sphere(50);
    const hash = buildSpatialHash(mesh);
    const positions = mesh.positions.slice();

    // Move vertex 0 far across the mesh (many cells away) and refresh it.
    const movedVertex = 0;
    positions[movedVertex * 3] = -positions[movedVertex * 3]!;
    positions[movedVertex * 3 + 1] = -positions[movedVertex * 3 + 1]!;
    positions[movedVertex * 3 + 2] = -positions[movedVertex * 3 + 2]!;
    updateVertexPosition(hash, positions, movedVertex);

    const center: [number, number, number] = [
      positions[movedVertex * 3]!,
      positions[movedVertex * 3 + 1]!,
      positions[movedVertex * 3 + 2]!,
    ];
    const hashResult = new Set(queryRadius(hash, positions, center, 1));
    const bruteResult = new Set(bruteForceRadius(positions, mesh.vertexCount, center, 1));

    expect(hashResult).toEqual(bruteResult);
    expect(hashResult.has(movedVertex)).toBe(true);
  });

  it('derives a smaller cell size for a denser mesh at the same scale', () => {
    const sparse = sphere(50, { widthSegments: 16, heightSegments: 16 });
    const dense = sphere(50, { widthSegments: 64, heightSegments: 64 });

    const sparseHash = buildSpatialHash(sparse);
    const denseHash = buildSpatialHash(dense);

    expect(denseHash.cellSize).toBeLessThan(sparseHash.cellSize);
    expect(denseHash.cellSize).toBeGreaterThan(0);
  });

  it('is meaningfully faster than brute force for a small-radius query on a large mesh', () => {
    // ~100k vertices: 2 poles + (heightSegments-1)*widthSegments non-pole rings.
    const mesh = sphere(100, { widthSegments: 320, heightSegments: 320 });
    expect(mesh.vertexCount).toBeGreaterThan(90000);

    const hash = buildSpatialHash(mesh);
    const center: [number, number, number] = [50, 0, 0]; // a point on the sphere's surface
    const radius = 2; // small relative to the ~100mm sphere

    const hashStart = performance.now();
    const hashResult = queryRadius(hash, mesh.positions, center, radius);
    const hashMs = performance.now() - hashStart;

    const bruteStart = performance.now();
    const bruteResult = bruteForceRadius(mesh.positions, mesh.vertexCount, center, radius);
    const bruteMs = performance.now() - bruteStart;

    expect(new Set(hashResult)).toEqual(new Set(bruteResult));
    // Loose margin (not a tight ratio) to avoid flakiness across machines,
    // while still meaningfully demonstrating sublinear query behavior.
    expect(hashMs).toBeLessThan(bruteMs / 2);
  });
});
