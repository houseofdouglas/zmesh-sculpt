import { checkManifold } from '../validate/manifold';
import type { SculptMesh } from '../mesh/sculpt-mesh';
import { getManifoldToplevel, sculptMeshToManifoldMesh, manifoldToSculptMesh } from './manifold-adapter';

export class RemeshValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemeshValidationError';
  }
}

/**
 * A deviation tolerance for `.simplify()` is derived from the same
 * estimated edge length as `.refineToLength()`, scaled down by this
 * fraction — a tolerance is a much smaller quantity than an edge length
 * (it bounds how far the decimated surface may drift, not a target
 * spacing), so using the edge length directly would over-simplify.
 * Feel-tuned, like the per-brush strength scales elsewhere in this
 * codebase; there's no analytic relationship between "target triangle
 * count" and manifold-3d's tolerance parameter to derive this from.
 */
const SIMPLIFY_TOLERANCE_FRACTION = 0.25;

/**
 * Voxel/topology remesh seam (FR-17): changes `mesh`'s resolution toward
 * `targetTriangleCount` while preserving its overall shape (FR-15),
 * guaranteed to resolve to a manifold + watertight mesh or reject —
 * never a partially-applied or broken result (the export/watertight
 * invariant, checked the same way here as at export time).
 *
 * Built on manifold-3d's `ofMesh`/`refineToLength`/`simplify`/`getMesh`
 * — the Task 05 spike's corrected finding, not `levelSet` (which is for
 * SDF-authored shapes, not resampling a mesh that already exists; see
 * the ADR). `ofMesh` itself throws if the input isn't already an
 * oriented 2-manifold, an extra free check on the way in.
 *
 * manifold-3d has no "target triangle count" parameter — `refineToLength`
 * takes a target edge length (mm), `simplify` a deviation tolerance (mm)
 * — so both are derived here from `mesh`'s own surface area: for a
 * roughly uniform triangulation, average triangle area ≈ surfaceArea /
 * triangleCount, and an equilateral triangle of edge length L has area
 * (√3/4)·L². This is a first-order estimate that moves resolution in the
 * right direction and roughly toward the target — which is what FR-15's
 * acceptance criterion asks for ("toward the level's target"), not an
 * exact hit — since manifold-3d exposes no triangle-count-targeted API
 * to do better than that.
 */
export async function remesh(
  mesh: SculptMesh,
  targetTriangleCount: number,
  onProgress?: (fraction: number) => void,
): Promise<SculptMesh> {
  onProgress?.(0);
  const wasm = await getManifoldToplevel();
  onProgress?.(0.2);

  const inputMesh = sculptMeshToManifoldMesh(wasm, mesh);
  const manifold = wasm.Manifold.ofMesh(inputMesh);
  const edgeLength = estimateEdgeLengthForTarget(mesh, targetTriangleCount);

  let reshaped;
  try {
    reshaped =
      targetTriangleCount > mesh.triangleCount
        ? manifold.refineToLength(edgeLength)
        : manifold.simplify(edgeLength * SIMPLIFY_TOLERANCE_FRACTION);
  } finally {
    // Manifold instances are WASM-heap-backed and never garbage
    // collected (the Task 05 ADR's memory-management gotcha) — every one
    // obtained here must be disposed explicitly, including on the
    // (unexpected) failure path.
    manifold.delete();
  }
  onProgress?.(0.8);

  let result: SculptMesh;
  try {
    result = manifoldToSculptMesh(reshaped);
  } finally {
    reshaped.delete();
  }

  const check = checkManifold(result);
  if (!check.ok) {
    throw new RemeshValidationError(
      `remesh output failed the manifold/watertight check (${check.defects.length} defect(s)) — never surfacing a broken mesh`,
    );
  }

  onProgress?.(1);
  return result;
}

function estimateEdgeLengthForTarget(mesh: SculptMesh, targetTriangleCount: number): number {
  const surfaceArea = computeSurfaceArea(mesh);
  const targetAverageTriangleArea = surfaceArea / Math.max(targetTriangleCount, 1);
  // area = (sqrt(3)/4) * L^2 for an equilateral triangle of edge length L.
  return Math.sqrt((targetAverageTriangleArea * 4) / Math.sqrt(3));
}

function computeSurfaceArea(mesh: SculptMesh): number {
  let area = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!;
    const i1 = mesh.indices[t + 1]!;
    const i2 = mesh.indices[t + 2]!;

    const ax = mesh.positions[i0 * 3]!;
    const ay = mesh.positions[i0 * 3 + 1]!;
    const az = mesh.positions[i0 * 3 + 2]!;
    const bx = mesh.positions[i1 * 3]!;
    const by = mesh.positions[i1 * 3 + 1]!;
    const bz = mesh.positions[i1 * 3 + 2]!;
    const cx = mesh.positions[i2 * 3]!;
    const cy = mesh.positions[i2 * 3 + 1]!;
    const cz = mesh.positions[i2 * 3 + 2]!;

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    area += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  }
  return area;
}
