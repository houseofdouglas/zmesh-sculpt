/** Element offset/count into an interleaved-xyz `BufferAttribute` (`Float32Array`, 3 components per vertex). */
export interface AttributeRange {
  offset: number;
  count: number;
}

/**
 * Converts a half-open `[vertexStart, vertexEnd)` vertex range (the shape
 * of `DirtyRegion` from `sculpt-engine-core`) into the element offset and
 * count Three.js's partial `BufferAttribute` update needs, for an xyz
 * (3-components-per-vertex) attribute — positions or normals.
 *
 * A pure index transform only: whether the range is actually still valid
 * against the *current* buffer (e.g. after a topology change shrank the
 * mesh) is `mesh-sync.ts`'s job, not this function's — see the spec's
 * edge case on a stale post-remesh dirty region.
 */
export function vertexRangeToAttributeRange(vertexStart: number, vertexEnd: number): AttributeRange {
  return {
    offset: vertexStart * 3,
    count: (vertexEnd - vertexStart) * 3,
  };
}
