import { describe, it, expect } from 'vitest';
import { createSculptMesh } from './sculpt-mesh';
import { buildVertexAdjacency } from './adjacency';
import {
  recomputeAffectedRegionNormals,
  findTrianglesTouchingVertices,
} from './normals';
import { sphere } from './primitives';

describe('findTrianglesTouchingVertices', () => {
  it('finds exactly the triangles referencing at least one given vertex', () => {
    const indices = new Uint32Array([0, 1, 2, 2, 3, 4, 5, 6, 7]);
    expect(findTrianglesTouchingVertices(indices, new Set([3]))).toEqual([1]);
    expect(findTrianglesTouchingVertices(indices, new Set([0, 6]))).toEqual([0, 2]);
  });
});

describe('recomputeAffectedRegionNormals', () => {
  function oneRingRegion(
    adjacency: ReturnType<typeof buildVertexAdjacency>,
    vertex: number,
  ): Set<number> {
    const region = new Set<number>([vertex]);
    const start = adjacency.offsets[vertex]!;
    const end = adjacency.offsets[vertex + 1]!;
    for (let i = start; i < end; i++) {
      region.add(adjacency.neighbors[i]!);
    }
    return region;
  }

  it('updates the affected region to match a full mesh recompute', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);

    const movedVertex = 10;
    const positions = mesh.positions.slice();
    positions[movedVertex * 3] = positions[movedVertex * 3]! + 3;
    positions[movedVertex * 3 + 1] = positions[movedVertex * 3 + 1]! + 1;
    positions[movedVertex * 3 + 2] = positions[movedVertex * 3 + 2]! - 2;

    const normals = mesh.normals.slice(); // stale copy, patched in place below
    recomputeAffectedRegionNormals(positions, mesh.indices, normals, adjacency, [movedVertex]);

    // Ground truth: a full mesh rebuilt from the same (mutated) positions.
    const fullRebuild = createSculptMesh(positions, mesh.indices);

    for (const v of oneRingRegion(adjacency, movedVertex)) {
      expect(normals[v * 3]).toBeCloseTo(fullRebuild.normals[v * 3]!, 5);
      expect(normals[v * 3 + 1]).toBeCloseTo(fullRebuild.normals[v * 3 + 1]!, 5);
      expect(normals[v * 3 + 2]).toBeCloseTo(fullRebuild.normals[v * 3 + 2]!, 5);
    }
  });

  it('leaves normals outside the affected region untouched', () => {
    const mesh = sphere(50);
    const adjacency = buildVertexAdjacency(mesh);

    const movedVertex = 10;
    const positions = mesh.positions.slice();
    positions[movedVertex * 3] = positions[movedVertex * 3]! + 3;

    const normals = mesh.normals.slice();
    const originalSnapshot = normals.slice();

    recomputeAffectedRegionNormals(positions, mesh.indices, normals, adjacency, [movedVertex]);

    const region = oneRingRegion(adjacency, movedVertex);
    let farVertex = -1;
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (!region.has(v)) {
        farVertex = v;
        break;
      }
    }
    expect(farVertex).toBeGreaterThanOrEqual(0);

    expect(normals[farVertex * 3]).toBe(originalSnapshot[farVertex * 3]);
    expect(normals[farVertex * 3 + 1]).toBe(originalSnapshot[farVertex * 3 + 1]);
    expect(normals[farVertex * 3 + 2]).toBe(originalSnapshot[farVertex * 3 + 2]);
  });
});
