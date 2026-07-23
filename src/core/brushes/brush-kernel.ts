import type { VertexAdjacency } from '../mesh/adjacency';

/**
 * A single application of a brush at one point along a stroke. Constructed
 * by the engine layer (see the sculpt-engine-core spec's stroke lifecycle);
 * brush kernels only ever consume it.
 */
export interface Stamp {
  /** surface hit point, mm */
  center: readonly [number, number, number];
  /** interpolated surface normal at the hit point */
  normal: readonly [number, number, number];
  /** brush size, mm */
  radius: number;
  /** 0-1, sign flipped when inverted */
  strength: number;
  /** world-space cursor motion since the last stamp; Grab only */
  dragDelta: readonly [number, number, number] | null;
}

/**
 * Everything a brush kernel needs to apply one stamp. Every kernel (Draw,
 * Smooth, Inflate, ...) takes this same shape and mutates `positions` in
 * place for the vertices it touches — not every kernel uses every field
 * (Draw ignores `normals`/`adjacency`; Smooth needs `adjacency`), but the
 * shared contract is what lets the engine dispatch to any brush uniformly.
 */
export interface BrushKernelContext {
  positions: Float32Array;
  normals: Float32Array;
  adjacency: VertexAdjacency;
  /** vertex indices within the stamp radius, from a spatial-hash query */
  affectedIndices: readonly number[];
  stamp: Stamp;
}

export type BrushKernel = (context: BrushKernelContext) => void;
