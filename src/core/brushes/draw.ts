import type { BrushKernel } from './brush-kernel';
import { computeFalloff } from './falloff';

/**
 * Per-stamp displacement (mm) at strength=1, falloff=1 — feel-tuned, not
 * derived from anything physical. A placeholder pending interactive
 * tuning (see the spec's Open Questions on per-brush strength scales).
 */
const DRAW_STRENGTH_SCALE_MM = 2;

/**
 * Safety cap on displacement per stamp, regardless of strength or
 * falloff — guards against self-intersection blow-ups from a fast stroke
 * or an extreme strength value (spec: "no vertex may move more than a
 * safety cap per stamp").
 */
const MAX_STAMP_DISPLACEMENT_MM = 5;

/**
 * Draw: displaces affected vertices along the stamp's own surface normal
 * (the same direction for every vertex in the stamp, not each vertex's
 * individual normal — that's Inflate), weighted by falloff. Adds a
 * rounded bump; a negative `strength` (invert) subtracts, indenting
 * instead.
 *
 * This is the template brush kernel — every other brush (Task 10/11/12)
 * follows the same BrushKernelContext shape established here.
 */
export const applyDraw: BrushKernel = (context) => {
  const { positions, affectedIndices, stamp } = context;
  const { center, normal, radius, strength } = stamp;

  for (const vertexIndex of affectedIndices) {
    const px = positions[vertexIndex * 3]!;
    const py = positions[vertexIndex * 3 + 1]!;
    const pz = positions[vertexIndex * 3 + 2]!;

    const dx = px - center[0];
    const dy = py - center[1];
    const dz = pz - center[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const falloff = computeFalloff(distance, radius);
    if (falloff <= 0) {
      continue;
    }

    const displacement = clamp(
      strength * falloff * DRAW_STRENGTH_SCALE_MM,
      -MAX_STAMP_DISPLACEMENT_MM,
      MAX_STAMP_DISPLACEMENT_MM,
    );

    positions[vertexIndex * 3] = px + normal[0] * displacement;
    positions[vertexIndex * 3 + 1] = py + normal[1] * displacement;
    positions[vertexIndex * 3 + 2] = pz + normal[2] * displacement;
  }
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
