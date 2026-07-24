import type { VertexAdjacency } from './adjacency';
import { collectIncidentTriangles, type VertexTriangleIncidence } from './incidence';

/**
 * Finds every triangle touching at least one of the given vertices, via a
 * single O(triangleCount) scan. Simple and always correct, at the cost of
 * not being sub-linear.
 *
 * Production no longer calls this on the per-stamp hot path — profiling
 * showed the scan was ~98% of a stamp's CPU cost at Max detail (~19ms at
 * 500k triangles), so `recomputeAffectedRegionNormals` now uses a
 * precomputed `VertexTriangleIncidence` (`collectIncidentTriangles`)
 * instead, which is O(region size). This is retained as the trusted,
 * dead-simple reference that the incidence path is verified equivalent to
 * (incidence.test.ts).
 */
export function findTrianglesTouchingVertices(
  indices: Uint32Array,
  vertexIndices: ReadonlySet<number>,
): number[] {
  const triangles: number[] = [];
  const triangleCount = indices.length / 3;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3]!;
    const i1 = indices[t * 3 + 1]!;
    const i2 = indices[t * 3 + 2]!;
    if (vertexIndices.has(i0) || vertexIndices.has(i1) || vertexIndices.has(i2)) {
      triangles.push(t);
    }
  }
  return triangles;
}

/**
 * Recomputes normals for exactly `vertexIndicesToUpdate` (zeroing then
 * re-summing each one's incident face normals), reading face data only
 * from `triangleIndices`.
 *
 * `triangleIndices` must include *every* triangle incident to *every*
 * vertex in `vertexIndicesToUpdate`, or those vertices' normals will
 * under-count. It may also include triangles that touch OTHER vertices
 * not in the update set (e.g. a triangle shared between an updated vertex
 * and a two-hop neighbor) — those other vertices are simply left alone,
 * which is deliberate: a two-hop vertex's normal is only trivially stale
 * (one of its several incident faces shifted slightly), not the FR-4
 * affected region proper, and partially recomputing it would be wrong in
 * the opposite direction (missing its OTHER incident triangles). Passing
 * a vertex in `vertexIndicesToUpdate` without its complete triangle set
 * is a caller bug, not something this function can detect.
 */
export function recomputeNormalsForTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  triangleIndices: readonly number[],
  vertexIndicesToUpdate: ReadonlySet<number>,
): void {
  for (const v of vertexIndicesToUpdate) {
    normals[v * 3] = 0;
    normals[v * 3 + 1] = 0;
    normals[v * 3 + 2] = 0;
  }

  for (const t of triangleIndices) {
    const i0 = indices[t * 3]!;
    const i1 = indices[t * 3 + 1]!;
    const i2 = indices[t * 3 + 2]!;

    const ax = positions[i0 * 3]!;
    const ay = positions[i0 * 3 + 1]!;
    const az = positions[i0 * 3 + 2]!;
    const bx = positions[i1 * 3]!;
    const by = positions[i1 * 3 + 1]!;
    const bz = positions[i1 * 3 + 2]!;
    const cx = positions[i2 * 3]!;
    const cy = positions[i2 * 3 + 1]!;
    const cz = positions[i2 * 3 + 2]!;

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Only accumulate into vertices we're actually updating — a corner
    // outside the update set keeps whatever normal it already had; adding
    // to it here (without having zeroed it first) would corrupt an
    // already-normalized value.
    if (vertexIndicesToUpdate.has(i0)) {
      normals[i0 * 3] = normals[i0 * 3]! + nx;
      normals[i0 * 3 + 1] = normals[i0 * 3 + 1]! + ny;
      normals[i0 * 3 + 2] = normals[i0 * 3 + 2]! + nz;
    }
    if (vertexIndicesToUpdate.has(i1)) {
      normals[i1 * 3] = normals[i1 * 3]! + nx;
      normals[i1 * 3 + 1] = normals[i1 * 3 + 1]! + ny;
      normals[i1 * 3 + 2] = normals[i1 * 3 + 2]! + nz;
    }
    if (vertexIndicesToUpdate.has(i2)) {
      normals[i2 * 3] = normals[i2 * 3]! + nx;
      normals[i2 * 3 + 1] = normals[i2 * 3 + 1]! + ny;
      normals[i2 * 3 + 2] = normals[i2 * 3 + 2]! + nz;
    }
  }

  for (const v of vertexIndicesToUpdate) {
    const x = normals[v * 3]!;
    const y = normals[v * 3 + 1]!;
    const z = normals[v * 3 + 2]!;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-12) {
      normals[v * 3] = x / len;
      normals[v * 3 + 1] = y / len;
      normals[v * 3 + 2] = z / len;
    } else {
      normals[v * 3] = 0;
      normals[v * 3 + 1] = 1;
      normals[v * 3 + 2] = 0;
    }
  }
}

/**
 * Recomputes normals for the region a brush stamp may have staled: the
 * affected vertices themselves, plus their one-ring neighbors (FR-4) — a
 * neighbor's incident-face orientation can change even if the neighbor
 * itself didn't move, since it shares a triangle with one that did.
 *
 * The incident triangles are gathered from the precomputed `incidence`
 * (O(region size)) rather than scanned for (O(triangleCount)) — the single
 * change that took a Max-detail stamp's CPU cost from ~19ms to well under
 * 1ms; see `findTrianglesTouchingVertices`' note and incidence.ts.
 */
export function recomputeAffectedRegionNormals(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  adjacency: VertexAdjacency,
  incidence: VertexTriangleIncidence,
  affectedIndices: readonly number[],
): void {
  const region = new Set<number>();
  for (const v of affectedIndices) {
    region.add(v);
    const start = adjacency.offsets[v]!;
    const end = adjacency.offsets[v + 1]!;
    for (let i = start; i < end; i++) {
      region.add(adjacency.neighbors[i]!);
    }
  }

  // Every triangle incident to a region vertex is gathered here, deduped —
  // so `region` is a complete, correct update set for this triangle list
  // (see recomputeNormalsForTriangles).
  const triangles = collectIncidentTriangles(incidence, region);
  recomputeNormalsForTriangles(positions, indices, normals, triangles, region);
}
