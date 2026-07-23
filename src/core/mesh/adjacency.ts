import type { SculptMesh } from './sculpt-mesh';

/**
 * Per-vertex one-ring neighbors in CSR (compressed sparse row) form: the
 * neighbors of vertex `v` are `neighbors[offsets[v] .. offsets[v+1])`. This
 * shape lets brush kernels and normal recomputation iterate a vertex's
 * neighbors with plain array indexing and zero per-query allocation — the
 * allocation cost is paid once here, when the topology changes (mesh load
 * or remesh), not on every sculpt stroke.
 */
export interface VertexAdjacency {
  /** length = vertexCount + 1 */
  offsets: Uint32Array;
  /** flat neighbor indices, grouped by vertex per `offsets` */
  neighbors: Uint32Array;
}

/**
 * Builds the one-ring adjacency for every vertex from the mesh's triangle
 * indices, in O(triangles). Each undirected edge contributes both
 * directions, so the result is always symmetric: b is in neighbors(a) iff
 * a is in neighbors(b).
 */
export function buildVertexAdjacency(mesh: SculptMesh): VertexAdjacency {
  const { vertexCount } = mesh;
  // A Set per vertex is the simplest way to dedupe neighbors touched by
  // more than one triangle (the common case for any shared edge). This
  // runs once per topology change, not in a hot loop, so the allocation
  // here is fine — it's what makes the CSR query path below allocation-free.
  const neighborSets: Array<Set<number>> = Array.from(
    { length: vertexCount },
    () => new Set<number>(),
  );

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    addNeighborPair(neighborSets, a, b);
    addNeighborPair(neighborSets, b, c);
    addNeighborPair(neighborSets, c, a);
  }

  const offsets = new Uint32Array(vertexCount + 1);
  let total = 0;
  for (let v = 0; v < vertexCount; v++) {
    offsets[v] = total;
    total += neighborSets[v]!.size;
  }
  offsets[vertexCount] = total;

  const neighbors = new Uint32Array(total);
  let writeIndex = 0;
  for (let v = 0; v < vertexCount; v++) {
    for (const neighbor of neighborSets[v]!) {
      neighbors[writeIndex] = neighbor;
      writeIndex++;
    }
  }

  return { offsets, neighbors };
}

function addNeighborPair(neighborSets: Array<Set<number>>, u: number, v: number): void {
  neighborSets[u]!.add(v);
  neighborSets[v]!.add(u);
}
