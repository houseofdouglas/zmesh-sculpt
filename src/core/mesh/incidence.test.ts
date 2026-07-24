import { describe, it, expect } from 'vitest';
import { buildVertexTriangleIncidence, collectIncidentTriangles } from './incidence';
import { findTrianglesTouchingVertices } from './normals';
import { buildVertexAdjacency } from './adjacency';
import { sphere } from './primitives';
import type { SculptMesh } from './sculpt-mesh';

/** Minimal hand-built mesh: two triangles sharing edge (1,2) — a quad split diagonally. */
function twoTriangleQuad(): Pick<SculptMesh, 'vertexCount' | 'indices'> {
  //  3---2
  //  | \ |
  //  0---1
  return {
    vertexCount: 4,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe('buildVertexTriangleIncidence', () => {
  it('lists exactly the triangles incident to each vertex', () => {
    const mesh = twoTriangleQuad() as SculptMesh;
    const inc = buildVertexTriangleIncidence(mesh);

    const trianglesOf = (v: number): number[] =>
      Array.from(inc.triangles.subarray(inc.offsets[v]!, inc.offsets[v + 1]!)).sort((a, b) => a - b);

    expect(trianglesOf(0)).toEqual([0, 1]); // shared corner of both triangles
    expect(trianglesOf(1)).toEqual([0]); // only triangle 0
    expect(trianglesOf(2)).toEqual([0, 1]); // shared corner of both triangles
    expect(trianglesOf(3)).toEqual([1]); // only triangle 1
  });

  it('has offsets summing to 3 * triangleCount (each triangle contributes 3 corners)', () => {
    const mesh = sphere(50);
    const inc = buildVertexTriangleIncidence(mesh);
    expect(inc.offsets[mesh.vertexCount]).toBe(mesh.triangleCount * 3);
    expect(inc.triangles.length).toBe(mesh.triangleCount * 3);
  });
});

describe('collectIncidentTriangles', () => {
  it('matches the findTrianglesTouchingVertices scan for every one-ring region on a sphere', () => {
    // The incidence path is only trustworthy insofar as it returns the
    // same triangle *set* as the dead-simple O(n) reference; lock the two
    // together across many real regions.
    const mesh = sphere(50, { widthSegments: 16, heightSegments: 12 });
    const adjacency = buildVertexAdjacency(mesh);
    const inc = buildVertexTriangleIncidence(mesh);

    const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

    for (let v = 0; v < mesh.vertexCount; v++) {
      const region = new Set<number>([v]);
      for (let i = adjacency.offsets[v]!; i < adjacency.offsets[v + 1]!; i++) {
        region.add(adjacency.neighbors[i]!);
      }
      const viaScan = sorted(findTrianglesTouchingVertices(mesh.indices, region));
      const viaIncidence = sorted(collectIncidentTriangles(inc, region));
      expect(viaIncidence).toEqual(viaScan);
    }
  });

  it('deduplicates a triangle shared by several region vertices', () => {
    const mesh = twoTriangleQuad() as SculptMesh;
    const inc = buildVertexTriangleIncidence(mesh);

    // Vertices 0 and 2 both belong to triangles 0 and 1; each must appear once.
    const result = collectIncidentTriangles(inc, new Set([0, 2]));
    expect([...result].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(new Set(result).size).toBe(result.length); // no duplicates
  });

  it('returns nothing for an empty region', () => {
    const mesh = twoTriangleQuad() as SculptMesh;
    const inc = buildVertexTriangleIncidence(mesh);
    expect(collectIncidentTriangles(inc, new Set())).toEqual([]);
  });
});
