import type { SculptMesh } from './sculpt-mesh';

/**
 * A uniform-grid spatial hash over vertex positions, answering "which
 * vertices are within radius r of point p" — the query every brush stamp
 * makes. `buildSpatialHash` does a full rebuild (needed when topology
 * changes: mesh load or remesh); `updateVertexPosition` keeps an existing
 * hash accurate as individual vertices move during sculpting, without
 * needing a full O(vertexCount) rebuild after every stamp.
 */
export interface SpatialHash {
  cellSize: number;
  /** cell key (see cellKey) -> vertex indices currently in that cell */
  buckets: Map<string, number[]>;
  /** length = vertexCount*3: each vertex's last-known (cx,cy,cz) grid cell */
  vertexCellCoord: Int32Array;
}

/**
 * Builds a spatial hash for every vertex in the mesh. If `cellSize` isn't
 * given, it's derived from the mesh's own scale and vertex density (see
 * `deriveCellSize`) rather than a fixed brush radius — brush size changes
 * continuously as the user adjusts it, so tuning cell size to a specific
 * radius would mean rebuilding on every slider tick. A density-derived
 * cell size instead gives reasonable query performance across whatever
 * radius is actually requested.
 */
export function buildSpatialHash(mesh: SculptMesh, cellSize?: number): SpatialHash {
  const resolvedCellSize = cellSize ?? deriveCellSize(mesh);
  const buckets = new Map<string, number[]>();
  const vertexCellCoord = new Int32Array(mesh.vertexCount * 3);

  for (let v = 0; v < mesh.vertexCount; v++) {
    const x = mesh.positions[v * 3]!;
    const y = mesh.positions[v * 3 + 1]!;
    const z = mesh.positions[v * 3 + 2]!;
    const cx = Math.floor(x / resolvedCellSize);
    const cy = Math.floor(y / resolvedCellSize);
    const cz = Math.floor(z / resolvedCellSize);

    vertexCellCoord[v * 3] = cx;
    vertexCellCoord[v * 3 + 1] = cy;
    vertexCellCoord[v * 3 + 2] = cz;

    addToBucket(buckets, cx, cy, cz, v);
  }

  return { cellSize: resolvedCellSize, buckets, vertexCellCoord };
}

/**
 * Returns every vertex within `radius` of `center`, using the hash's
 * stored cell buckets to narrow down candidates (broad phase) and the
 * caller-supplied, always-current `positions` for the exact distance test
 * (narrow phase). Passing live positions here — rather than trusting
 * positions implied by bucket membership — means a query stays exactly
 * correct even for vertices that moved but haven't been refreshed into
 * their new cell yet via `updateVertexPosition`, as long as they haven't
 * moved far enough to leave the searched cell range entirely.
 */
export function queryRadius(
  hash: SpatialHash,
  positions: Float32Array,
  center: readonly [number, number, number],
  radius: number,
): number[] {
  const [px, py, pz] = center;
  const { cellSize } = hash;

  const minCx = Math.floor((px - radius) / cellSize);
  const maxCx = Math.floor((px + radius) / cellSize);
  const minCy = Math.floor((py - radius) / cellSize);
  const maxCy = Math.floor((py + radius) / cellSize);
  const minCz = Math.floor((pz - radius) / cellSize);
  const maxCz = Math.floor((pz + radius) / cellSize);

  const radiusSq = radius * radius;
  const result: number[] = [];

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = hash.buckets.get(cellKey(cx, cy, cz));
        if (!bucket) continue;
        for (const v of bucket) {
          const dx = positions[v * 3]! - px;
          const dy = positions[v * 3 + 1]! - py;
          const dz = positions[v * 3 + 2]! - pz;
          if (dx * dx + dy * dy + dz * dz <= radiusSq) {
            result.push(v);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Call after a vertex's position has changed (e.g. a brush stamp moved
 * it) so its cell bucket stays accurate. A no-op if it's still within its
 * previously recorded cell, which is the common case — brush displacement
 * per stamp is normally small relative to cell size.
 */
export function updateVertexPosition(
  hash: SpatialHash,
  positions: Float32Array,
  vertexIndex: number,
): void {
  const x = positions[vertexIndex * 3]!;
  const y = positions[vertexIndex * 3 + 1]!;
  const z = positions[vertexIndex * 3 + 2]!;
  const newCx = Math.floor(x / hash.cellSize);
  const newCy = Math.floor(y / hash.cellSize);
  const newCz = Math.floor(z / hash.cellSize);

  const oldCx = hash.vertexCellCoord[vertexIndex * 3]!;
  const oldCy = hash.vertexCellCoord[vertexIndex * 3 + 1]!;
  const oldCz = hash.vertexCellCoord[vertexIndex * 3 + 2]!;

  if (newCx === oldCx && newCy === oldCy && newCz === oldCz) {
    return;
  }

  removeFromBucket(hash.buckets, oldCx, oldCy, oldCz, vertexIndex);
  addToBucket(hash.buckets, newCx, newCy, newCz, vertexIndex);

  hash.vertexCellCoord[vertexIndex * 3] = newCx;
  hash.vertexCellCoord[vertexIndex * 3 + 1] = newCy;
  hash.vertexCellCoord[vertexIndex * 3 + 2] = newCz;
}

/**
 * Sizes cells from the mesh's own scale: assuming vertices are roughly
 * uniformly distributed in their bounding box, (volume / vertexCount)^(1/3)
 * is the average inter-vertex spacing. A small multiplier keeps a handful
 * of vertices per cell rather than ~1, reducing the number of cells a
 * typical query needs to visit.
 */
function deriveCellSize(mesh: SculptMesh): number {
  const { min, max } = mesh.bounds;
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  const volume = Math.max(dx * dy * dz, 1e-9);
  const averageSpacing = Math.cbrt(volume / Math.max(mesh.vertexCount, 1));
  return averageSpacing * 2;
}

function cellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

function addToBucket(
  buckets: Map<string, number[]>,
  cx: number,
  cy: number,
  cz: number,
  vertexIndex: number,
): void {
  const key = cellKey(cx, cy, cz);
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.push(vertexIndex);
  } else {
    buckets.set(key, [vertexIndex]);
  }
}

function removeFromBucket(
  buckets: Map<string, number[]>,
  cx: number,
  cy: number,
  cz: number,
  vertexIndex: number,
): void {
  const key = cellKey(cx, cy, cz);
  const bucket = buckets.get(key);
  if (!bucket) return;
  const index = bucket.indexOf(vertexIndex);
  if (index !== -1) {
    bucket.splice(index, 1);
  }
  if (bucket.length === 0) {
    buckets.delete(key);
  }
}
