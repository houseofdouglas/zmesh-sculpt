/**
 * The core mesh representation: flat typed arrays in millimeters, centered
 * at the origin. Positions/indices come from a primitive generator, a
 * remesh, or a loaded file; normals and bounds are always derived here so
 * they can never drift out of sync with the geometry.
 */
export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface SculptMesh {
  /** length = 3 * vertexCount, mm */
  positions: Float32Array;
  /** length = 3 * triangleCount, CCW winding (outward normals) */
  indices: Uint32Array;
  /** length = 3 * vertexCount, unit vectors */
  normals: Float32Array;
  vertexCount: number;
  triangleCount: number;
  bounds: Aabb;
}

export class SculptMeshValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SculptMeshValidationError';
  }
}

/**
 * Builds a SculptMesh from raw positions and triangle indices, computing
 * per-vertex normals and the AABB. Throws SculptMeshValidationError if the
 * arrays are malformed — imported/generated geometry is never trusted
 * silently.
 */
export function createSculptMesh(positions: Float32Array, indices: Uint32Array): SculptMesh {
  const vertexCount = validatePositions(positions);
  const triangleCount = validateIndices(indices, vertexCount);

  const normals = computeVertexNormals(positions, indices, vertexCount);
  const bounds = computeBounds(positions, vertexCount);

  return { positions, indices, normals, vertexCount, triangleCount, bounds };
}

function validatePositions(positions: Float32Array): number {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new SculptMeshValidationError(
      `positions length must be a positive multiple of 3 (xyz per vertex), got ${positions.length}`,
    );
  }
  return positions.length / 3;
}

function validateIndices(indices: Uint32Array, vertexCount: number): number {
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new SculptMeshValidationError(
      `indices length must be a positive multiple of 3 (one triangle per 3), got ${indices.length}`,
    );
  }
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx === undefined || idx >= vertexCount) {
      throw new SculptMeshValidationError(
        `index ${String(idx)} at position ${i} is out of range for ${vertexCount} vertices`,
      );
    }
  }
  return indices.length / 3;
}

/**
 * Area-weighted vertex normals: each face's unnormalized cross product
 * (magnitude ~ 2x triangle area) is accumulated into its three vertices,
 * so larger adjacent faces contribute more before the final normalize.
 * This is a full-mesh recompute for construction/load; incremental
 * recompute of just the vertices touched by a stroke is a separate,
 * engine-level concern (see the sculpt-engine-core spec).
 */
function computeVertexNormals(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
): Float32Array {
  const normals = new Float32Array(vertexCount * 3);

  // Index bounds are guaranteed by validateIndices/validatePositions above;
  // non-null assertions avoid per-element undefined checks in this hot loop.
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!;
    const i1 = indices[t + 1]!;
    const i2 = indices[t + 2]!;

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

    // `+=` reads before writing, which noUncheckedIndexedAccess treats as
    // possibly undefined; these offsets are within the freshly allocated
    // `normals` buffer (size vertexCount*3), so the read is always defined.
    normals[i0 * 3] = normals[i0 * 3]! + nx;
    normals[i0 * 3 + 1] = normals[i0 * 3 + 1]! + ny;
    normals[i0 * 3 + 2] = normals[i0 * 3 + 2]! + nz;
    normals[i1 * 3] = normals[i1 * 3]! + nx;
    normals[i1 * 3 + 1] = normals[i1 * 3 + 1]! + ny;
    normals[i1 * 3 + 2] = normals[i1 * 3 + 2]! + nz;
    normals[i2 * 3] = normals[i2 * 3]! + nx;
    normals[i2 * 3 + 1] = normals[i2 * 3 + 1]! + ny;
    normals[i2 * 3 + 2] = normals[i2 * 3 + 2]! + nz;
  }

  normalizeVectorsInPlace(normals, vertexCount);
  return normals;
}

function normalizeVectorsInPlace(vectors: Float32Array, count: number): void {
  for (let v = 0; v < count; v++) {
    const x = vectors[v * 3]!;
    const y = vectors[v * 3 + 1]!;
    const z = vectors[v * 3 + 2]!;
    const len = Math.sqrt(x * x + y * y + z * z);

    if (len > 1e-12) {
      vectors[v * 3] = x / len;
      vectors[v * 3 + 1] = y / len;
      vectors[v * 3 + 2] = z / len;
    } else {
      // Degenerate case (isolated vertex with no incident faces) — a
      // stable arbitrary fallback so downstream consumers never see NaN.
      vectors[v * 3] = 0;
      vectors[v * 3 + 1] = 1;
      vectors[v * 3 + 2] = 0;
    }
  }
}

function computeBounds(positions: Float32Array, vertexCount: number): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
