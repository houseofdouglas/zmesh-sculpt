import { clampDisplacement, type BrushKernel } from './brush-kernel';
import { computeFalloff } from './falloff';

/**
 * Per-stamp displacement (mm) at strength=1, falloff=1 — feel-tuned
 * placeholder, same convention as Draw's own scale constant.
 */
const INFLATE_STRENGTH_SCALE_MM = 2;

/**
 * Inflate: displaces each affected vertex along **its own** vertex normal
 * (not the stamp's shared normal — that's Draw), weighted by falloff.
 * Puffs the region outward evenly, following the existing curvature
 * rather than pushing everything in one flat direction. A negative
 * `strength` (invert) deflates instead.
 */
export const applyInflate: BrushKernel = (context) => {
  const { positions, normals, affectedIndices, stamp } = context;
  const { center, radius, strength } = stamp;

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

    const displacement = clampDisplacement(strength * falloff * INFLATE_STRENGTH_SCALE_MM);

    const nx = normals[vertexIndex * 3]!;
    const ny = normals[vertexIndex * 3 + 1]!;
    const nz = normals[vertexIndex * 3 + 2]!;

    positions[vertexIndex * 3] = px + nx * displacement;
    positions[vertexIndex * 3 + 1] = py + ny * displacement;
    positions[vertexIndex * 3 + 2] = pz + nz * displacement;
  }
};
