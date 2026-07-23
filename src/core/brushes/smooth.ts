import type { BrushKernel } from './brush-kernel';
import { computeFalloff } from './falloff';

/**
 * Smooth: moves each affected vertex toward the average position of its
 * one-ring neighbors (a Laplacian step), blended by `strength * falloff`
 * (0 = no change, 1 = snap fully to the average). Reduces local
 * curvature — bumps and wrinkles relax toward flat.
 *
 * Invert is a **no-op** in v1 (see the spec's Resolved Questions —
 * "sharpen" was considered but deferred; it needs feel-tuning).
 *
 * This reads neighbor positions and writes in place as it iterates
 * `affectedIndices`, so if two neighboring vertices are both in the
 * affected set, the second one processed sees the first's *already
 * smoothed* position. That's a deliberate choice, not a bug: it's the
 * standard Gauss-Seidel variant of Laplacian smoothing (as opposed to
 * Jacobi, which would need a snapshot buffer), and every vertex's own
 * update still strictly reduces its distance to its neighbor average
 * regardless of iteration order — it keeps this brush's hot loop
 * allocation-free, which a snapshot-based approach would not.
 */
export const applySmooth: BrushKernel = (context) => {
  const { positions, adjacency, affectedIndices, stamp } = context;
  const { center, radius, strength } = stamp;

  if (strength <= 0) {
    return;
  }

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

    const start = adjacency.offsets[vertexIndex]!;
    const end = adjacency.offsets[vertexIndex + 1]!;
    const neighborCount = end - start;
    if (neighborCount === 0) {
      continue; // isolated vertex — nothing to average toward
    }

    let avgX = 0;
    let avgY = 0;
    let avgZ = 0;
    for (let i = start; i < end; i++) {
      const neighbor = adjacency.neighbors[i]!;
      avgX += positions[neighbor * 3]!;
      avgY += positions[neighbor * 3 + 1]!;
      avgZ += positions[neighbor * 3 + 2]!;
    }
    avgX /= neighborCount;
    avgY /= neighborCount;
    avgZ /= neighborCount;

    const blend = clampBlend(strength * falloff);
    positions[vertexIndex * 3] = px + (avgX - px) * blend;
    positions[vertexIndex * 3 + 1] = py + (avgY - py) * blend;
    positions[vertexIndex * 3 + 2] = pz + (avgZ - pz) * blend;
  }
};

function clampBlend(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
