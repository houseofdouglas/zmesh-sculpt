import { MAX_STAMP_DISPLACEMENT_MM, clampBlendSigned, clampVectorMagnitude } from './brush-kernel';
import type { BrushKernel } from './brush-kernel';
import { computeFalloff } from './falloff';

/**
 * Per-stamp displacement (mm) at strength=1, falloff=1 for Crease's
 * along-normal component — feel-tuned placeholder, same convention as
 * Draw/Inflate's own scale constants.
 */
const CREASE_STRENGTH_SCALE_MM = 2;

/**
 * Crease: Pinch's tangential pull combined with an along-the-stamp-normal
 * displacement, forced inward by default (the spec calls this "negative
 * Draw") — together they cut a sharp valley. Both components scale with
 * the same signed `strength * falloff`, so invert flips them together:
 * pinch becomes spread and inward becomes outward, which is exactly the
 * spec's described invert behavior ("raised sharp ridge") — no special
 * per-component sign-casing needed.
 */
export const applyCrease: BrushKernel = (context) => {
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

    const alongNormal = dx * normal[0] + dy * normal[1] + dz * normal[2];
    const tangentX = dx - alongNormal * normal[0];
    const tangentY = dy - alongNormal * normal[1];
    const tangentZ = dz - alongNormal * normal[2];

    const blend = clampBlendSigned(strength * falloff);
    const pinchX = -tangentX * blend;
    const pinchY = -tangentY * blend;
    const pinchZ = -tangentZ * blend;

    // Inward by default (negative sign); flips to outward together with
    // the pinch->spread flip above when strength is negated (invert).
    const alongDisplacement = -strength * falloff * CREASE_STRENGTH_SCALE_MM;

    const rawX = pinchX + normal[0] * alongDisplacement;
    const rawY = pinchY + normal[1] * alongDisplacement;
    const rawZ = pinchZ + normal[2] * alongDisplacement;

    const [dispX, dispY, dispZ] = clampVectorMagnitude(rawX, rawY, rawZ, MAX_STAMP_DISPLACEMENT_MM);

    positions[vertexIndex * 3] = px + dispX;
    positions[vertexIndex * 3 + 1] = py + dispY;
    positions[vertexIndex * 3 + 2] = pz + dispZ;
  }
};
