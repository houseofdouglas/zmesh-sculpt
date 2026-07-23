import { MAX_STAMP_DISPLACEMENT_MM, clampBlendSigned, clampVectorMagnitude } from './brush-kernel';
import type { BrushKernel } from './brush-kernel';
import { computeFalloff } from './falloff';

/**
 * Pinch: pulls each affected vertex toward the stamp's central axis
 * within the tangent plane (the plane perpendicular to the stamp normal)
 * — it never moves a vertex along the normal, only laterally. Modeled as
 * a fractional contraction of the vertex's own tangential offset (like
 * Smooth's blend-toward-average, not a fixed mm step like Draw/Inflate):
 * this is self-limiting (can't overshoot past the axis) and naturally
 * matches "tightens into ridges" as repeated stamps progressively narrow
 * the affected strip. A negative `strength` (invert) uses the same
 * formula with a negative blend, which naturally expands the tangential
 * offset instead — "pushes apart (spreads)".
 */
export const applyPinch: BrushKernel = (context) => {
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

    // Remove the along-normal component of (vertex - center) to get the
    // vertex's offset within the tangent plane.
    const alongNormal = dx * normal[0] + dy * normal[1] + dz * normal[2];
    const tangentX = dx - alongNormal * normal[0];
    const tangentY = dy - alongNormal * normal[1];
    const tangentZ = dz - alongNormal * normal[2];

    const blend = clampBlendSigned(strength * falloff);
    const [dispX, dispY, dispZ] = clampVectorMagnitude(
      -tangentX * blend,
      -tangentY * blend,
      -tangentZ * blend,
      MAX_STAMP_DISPLACEMENT_MM,
    );

    positions[vertexIndex * 3] = px + dispX;
    positions[vertexIndex * 3 + 1] = py + dispY;
    positions[vertexIndex * 3 + 2] = pz + dispZ;
  }
};
