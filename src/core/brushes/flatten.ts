import { MAX_STAMP_DISPLACEMENT_MM, clampBlendSigned, clampVectorMagnitude } from './brush-kernel';
import type { BrushKernel } from './brush-kernel';
import { computeFalloff } from './falloff';

/**
 * Flatten: moves affected vertices toward a single shared plane — the
 * area's average plane (centroid + averaged vertex normal) — planarizing
 * the region. A negative `strength` (invert) pulls vertices further from
 * the plane instead ("emboss").
 *
 * Unlike every other brush here, the plane is one quantity shared by the
 * *whole* stamp, so this genuinely needs two passes over `affectedIndices`:
 * first aggregate the centroid/normal from every vertex's pre-stamp
 * position (before any of them move), then move each vertex toward that
 * now-fixed plane. Note this needs no scratch array, though — the shared
 * quantity is a handful of scalars (6 numbers), not a per-vertex buffer —
 * so it stays allocation-free like every other brush here.
 */
export const applyFlatten: BrushKernel = (context) => {
  const { positions, normals, affectedIndices, stamp } = context;
  const { center, radius, strength } = stamp;

  let count = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let avgNx = 0;
  let avgNy = 0;
  let avgNz = 0;

  for (const vertexIndex of affectedIndices) {
    const px = positions[vertexIndex * 3]!;
    const py = positions[vertexIndex * 3 + 1]!;
    const pz = positions[vertexIndex * 3 + 2]!;
    const dx = px - center[0];
    const dy = py - center[1];
    const dz = pz - center[2];
    if (dx * dx + dy * dy + dz * dz > radius * radius) {
      continue; // outside the actual radius, even if passed in as "affected"
    }

    cx += px;
    cy += py;
    cz += pz;
    avgNx += normals[vertexIndex * 3]!;
    avgNy += normals[vertexIndex * 3 + 1]!;
    avgNz += normals[vertexIndex * 3 + 2]!;
    count++;
  }

  if (count === 0) {
    return;
  }
  cx /= count;
  cy /= count;
  cz /= count;

  const normalLength = Math.sqrt(avgNx * avgNx + avgNy * avgNy + avgNz * avgNz);
  if (normalLength < 1e-12) {
    return; // degenerate: opposing normals cancelled out, no sensible plane
  }
  avgNx /= normalLength;
  avgNy /= normalLength;
  avgNz /= normalLength;

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

    // Signed distance from the vertex to the plane (point=centroid, normal=avgN).
    const signedDistance = (px - cx) * avgNx + (py - cy) * avgNy + (pz - cz) * avgNz;

    const blend = clampBlendSigned(strength * falloff);
    // blend=1 snaps fully onto the plane (standard point-to-plane
    // projection: P - signedDistance*normal); negative blend (invert)
    // moves further in whichever direction the vertex already was.
    const alongDisplacement = -signedDistance * blend;

    const [dispX, dispY, dispZ] = clampVectorMagnitude(
      avgNx * alongDisplacement,
      avgNy * alongDisplacement,
      avgNz * alongDisplacement,
      MAX_STAMP_DISPLACEMENT_MM,
    );

    positions[vertexIndex * 3] = px + dispX;
    positions[vertexIndex * 3 + 1] = py + dispY;
    positions[vertexIndex * 3 + 2] = pz + dispZ;
  }
};
