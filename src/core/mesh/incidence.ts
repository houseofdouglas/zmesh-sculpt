import type { SculptMesh } from './sculpt-mesh';

/**
 * Per-vertex incident-triangle lists in CSR (compressed sparse row) form:
 * the triangles touching vertex `v` are
 * `triangles[offsets[v] .. offsets[v+1])`, each value a triangle index
 * (i.e. a row of `indices` starting at `triangle * 3`).
 *
 * This is the vertex->triangle counterpart to `VertexAdjacency`'s
 * vertex->vertex map, and exists for the same reason: it turns the
 * per-stamp "which triangles touch this region?" query — otherwise an
 * O(triangleCount) scan of the whole index buffer — into one that costs
 * only O(region size), independent of how large the mesh is. The build
 * cost is paid once per topology change (mesh load or remesh), alongside
 * adjacency and the spatial hash, never on a sculpt stamp.
 */
export interface VertexTriangleIncidence {
  /** length = vertexCount + 1 */
  offsets: Uint32Array;
  /** flat triangle indices, grouped by vertex per `offsets` */
  triangles: Uint32Array;
}

/**
 * Builds the vertex->triangle incidence for every vertex from the mesh's
 * triangle indices, in O(triangles) via a two-pass counting-sort layout
 * (count per vertex, prefix-sum into offsets, then fill). Every triangle
 * contributes to exactly its three (distinct) corner vertices, so the flat
 * `triangles` array has exactly `3 * triangleCount` entries.
 */
export function buildVertexTriangleIncidence(mesh: SculptMesh): VertexTriangleIncidence {
  const { vertexCount } = mesh;
  const triangleCount = mesh.indices.length / 3;

  // Pass 1: count incident triangles per vertex (temporarily stored in
  // `offsets`, one slot per vertex).
  const offsets = new Uint32Array(vertexCount + 1);
  for (let t = 0; t < triangleCount; t++) {
    const a = mesh.indices[t * 3]!;
    const b = mesh.indices[t * 3 + 1]!;
    const c = mesh.indices[t * 3 + 2]!;
    offsets[a] = offsets[a]! + 1;
    offsets[b] = offsets[b]! + 1;
    offsets[c] = offsets[c]! + 1;
  }

  // Exclusive prefix sum: offsets[v] becomes vertex v's start index, and
  // offsets[vertexCount] the grand total (= 3 * triangleCount).
  let total = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = offsets[v]!;
    offsets[v] = total;
    total += count;
  }
  offsets[vertexCount] = total;

  // Pass 2: fill, advancing a per-vertex write cursor (a copy of the
  // starts, so `offsets` itself stays pointing at each vertex's start).
  const triangles = new Uint32Array(total);
  const cursor = Uint32Array.from(offsets.subarray(0, vertexCount));
  for (let t = 0; t < triangleCount; t++) {
    const a = mesh.indices[t * 3]!;
    const b = mesh.indices[t * 3 + 1]!;
    const c = mesh.indices[t * 3 + 2]!;
    triangles[cursor[a]!] = t;
    cursor[a] = cursor[a]! + 1;
    triangles[cursor[b]!] = t;
    cursor[b] = cursor[b]! + 1;
    triangles[cursor[c]!] = t;
    cursor[c] = cursor[c]! + 1;
  }

  return { offsets, triangles };
}

/**
 * Collects every triangle touching at least one of `vertices`, deduped so
 * each triangle appears exactly once — the O(region size) replacement for
 * `findTrianglesTouchingVertices`' O(triangleCount) scan. Dedup is
 * essential, not cosmetic: a triangle shared by two or three region
 * vertices would otherwise be listed more than once, and
 * `recomputeNormalsForTriangles` would add its face normal in that many
 * times, corrupting the result.
 *
 * `findTrianglesTouchingVertices` remains the trusted reference this is
 * checked against (see incidence.test.ts) — both must return the same set
 * of triangles for any region.
 */
export function collectIncidentTriangles(
  incidence: VertexTriangleIncidence,
  vertices: ReadonlySet<number>,
): number[] {
  const seen = new Set<number>();
  const triangles: number[] = [];
  for (const v of vertices) {
    const start = incidence.offsets[v]!;
    const end = incidence.offsets[v + 1]!;
    for (let i = start; i < end; i++) {
      const t = incidence.triangles[i]!;
      if (!seen.has(t)) {
        seen.add(t);
        triangles.push(t);
      }
    }
  }
  return triangles;
}
