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

/**
 * Safety cap on displacement per stamp (mm), regardless of strength or
 * falloff — guards against self-intersection blow-ups from a fast stroke
 * or an extreme strength value (spec: "no vertex may move more than a
 * safety cap per stamp"). Shared by every displacement-based brush.
 */
export const MAX_STAMP_DISPLACEMENT_MM = 5;

export function clampDisplacement(value: number): number {
  if (value < -MAX_STAMP_DISPLACEMENT_MM) return -MAX_STAMP_DISPLACEMENT_MM;
  if (value > MAX_STAMP_DISPLACEMENT_MM) return MAX_STAMP_DISPLACEMENT_MM;
  return value;
}

/**
 * Clamps a signed blend factor to [-1, 1]. Used by brushes whose "step" is
 * a fraction of an existing offset (contract/expand toward a point or
 * plane) rather than a fixed mm displacement along a known direction —
 * Draw/Inflate use `clampDisplacement` instead, since their displacement
 * is a scalar along one known unit direction.
 */
export function clampBlendSigned(value: number): number {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/**
 * Clamps a displacement *vector*'s magnitude to MAX_STAMP_DISPLACEMENT_MM,
 * preserving its direction. For brushes whose displacement isn't along a
 * single known axis (Pinch/Crease move within an arbitrary tangent-plane
 * direction; Flatten moves along a computed plane normal), so a per-axis
 * scalar clamp would distort direction instead of just limiting magnitude.
 */
export function clampVectorMagnitude(
  x: number,
  y: number,
  z: number,
  maxMagnitude: number,
): readonly [number, number, number] {
  const magnitude = Math.sqrt(x * x + y * y + z * z);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return [x, y, z];
  }
  const scale = maxMagnitude / magnitude;
  return [x * scale, y * scale, z * scale];
}
