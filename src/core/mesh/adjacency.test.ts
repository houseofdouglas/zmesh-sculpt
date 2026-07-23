import { describe, it, expect } from 'vitest';
import { buildVertexAdjacency } from './adjacency';
import { createSculptMesh } from './sculpt-mesh';
import { checkManifold } from '../validate/manifold';

/**
 * A regular octahedron: 6 vertices along the ±axes, 8 triangular faces (one
 * per octant). Each vertex connects to every other vertex except its
 * opposite (0<->1, 2<->3, 4<->5 are the three opposite pairs), giving a
 * simple, hand-verifiable degree-4 adjacency structure for every vertex.
 */
const OCTAHEDRON_POSITIONS = new Float32Array([
  1, 0, 0, // 0: +X
  -1, 0, 0, // 1: -X
  0, 1, 0, // 2: +Y
  0, -1, 0, // 3: -Y
  0, 0, 1, // 4: +Z
  0, 0, -1, // 5: -Z
]);
// One face per octant, wound outward (derived via cross-product/centroid check).
const OCTAHEDRON_INDICES = new Uint32Array([
  0, 2, 4, 0, 5, 2, 0, 4, 3, 0, 3, 5, 1, 4, 2, 1, 2, 5, 1, 3, 4, 1, 5, 3,
]);

function neighborsOf(adjacency: ReturnType<typeof buildVertexAdjacency>, v: number): Set<number> {
  const start = adjacency.offsets[v]!;
  const end = adjacency.offsets[v + 1]!;
  return new Set(adjacency.neighbors.slice(start, end));
}

describe('buildVertexAdjacency', () => {
  it('is built from a valid, watertight fixture', () => {
    const mesh = createSculptMesh(OCTAHEDRON_POSITIONS, OCTAHEDRON_INDICES);
    expect(checkManifold(mesh).ok).toBe(true);
  });

  it('matches the hand-derived octahedron neighbor sets exactly', () => {
    const mesh = createSculptMesh(OCTAHEDRON_POSITIONS, OCTAHEDRON_INDICES);
    const adjacency = buildVertexAdjacency(mesh);

    const expected: Record<number, number[]> = {
      0: [2, 3, 4, 5], // opposite is 1
      1: [2, 3, 4, 5], // opposite is 0
      2: [0, 1, 4, 5], // opposite is 3
      3: [0, 1, 4, 5], // opposite is 2
      4: [0, 1, 2, 3], // opposite is 5
      5: [0, 1, 2, 3], // opposite is 4
    };

    for (const [vertex, expectedNeighbors] of Object.entries(expected)) {
      expect(neighborsOf(adjacency, Number(vertex))).toEqual(new Set(expectedNeighbors));
    }
  });

  it('gives every vertex exactly 4 neighbors (no duplicates from shared faces)', () => {
    const mesh = createSculptMesh(OCTAHEDRON_POSITIONS, OCTAHEDRON_INDICES);
    const adjacency = buildVertexAdjacency(mesh);

    for (let v = 0; v < mesh.vertexCount; v++) {
      const start = adjacency.offsets[v]!;
      const end = adjacency.offsets[v + 1]!;
      expect(end - start).toBe(4);
    }
  });

  it('is symmetric: b is a neighbor of a iff a is a neighbor of b', () => {
    const mesh = createSculptMesh(OCTAHEDRON_POSITIONS, OCTAHEDRON_INDICES);
    const adjacency = buildVertexAdjacency(mesh);

    for (let a = 0; a < mesh.vertexCount; a++) {
      for (const b of neighborsOf(adjacency, a)) {
        expect(neighborsOf(adjacency, b).has(a)).toBe(true);
      }
    }
  });
});
