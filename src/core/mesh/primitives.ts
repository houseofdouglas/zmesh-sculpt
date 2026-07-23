import { createSculptMesh, type SculptMesh } from './sculpt-mesh';

const DEFAULT_WIDTH_SEGMENTS = 48;
const DEFAULT_HEIGHT_SEGMENTS = 24;
const DEFAULT_HEMISPHERE_SEGMENTS = 12;
const DEFAULT_CYLINDER_SEGMENTS = 3;

/** Below this radius (mm) a ring is treated as a single pole vertex, not a column of them. */
const POLE_RADIUS_EPSILON_MM = 1e-6;

interface RevolutionRing {
  height: number;
  radius: number;
}

interface SphereOptions {
  widthSegments?: number;
  heightSegments?: number;
}

interface CapsuleOptions {
  widthSegments?: number;
  hemisphereSegments?: number;
  cylinderSegments?: number;
}

/**
 * Triangulates a closed surface of revolution from an ordered list of
 * (height, radius) rings running pole-to-pole (the first and last ring
 * must have ~0 radius). Shared by sphere, egg, and capsule — only the
 * ring profile differs between them.
 *
 * There's no texturing in v1, so unlike a typical UV-sphere there is no
 * duplicated seam column and no duplicated pole vertex per column: each
 * pole is a single shared vertex, and non-pole rings wrap via modulo
 * indexing. This is what makes the result a single truly welded solid —
 * a brush stroke or remesh can move a pole without tearing the mesh open,
 * and it passes an index-based (not just positional) watertight check.
 */
function buildSurfaceOfRevolution(
  rings: RevolutionRing[],
  widthSegments: number,
): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  const ringVertexIndices: (number | number[])[] = [];

  for (const ring of rings) {
    if (Math.abs(ring.radius) < POLE_RADIUS_EPSILON_MM) {
      const index = positions.length / 3;
      positions.push(0, ring.height, 0);
      ringVertexIndices.push(index);
    } else {
      const columns: number[] = [];
      for (let ix = 0; ix < widthSegments; ix++) {
        const phi = (ix / widthSegments) * Math.PI * 2;
        const index = positions.length / 3;
        positions.push(-ring.radius * Math.cos(phi), ring.height, ring.radius * Math.sin(phi));
        columns.push(index);
      }
      ringVertexIndices.push(columns);
    }
  }

  for (let i = 0; i < ringVertexIndices.length - 1; i++) {
    const upper = ringVertexIndices[i]!;
    const lower = ringVertexIndices[i + 1]!;

    if (typeof upper === 'number' && Array.isArray(lower)) {
      // Top pole -> ring: a triangle fan around the single pole vertex.
      const w = lower.length;
      for (let ix = 0; ix < w; ix++) {
        indices.push(upper, lower[ix]!, lower[(ix + 1) % w]!);
      }
    } else if (Array.isArray(upper) && typeof lower === 'number') {
      // Ring -> bottom pole: a fan with the opposite winding, mirroring
      // the top-pole case for a consistently outward-facing surface.
      const w = upper.length;
      for (let ix = 0; ix < w; ix++) {
        indices.push(upper[(ix + 1) % w]!, upper[ix]!, lower);
      }
    } else if (Array.isArray(upper) && Array.isArray(lower)) {
      // Ring -> ring: a quad strip, each quad split into 2 triangles.
      const w = upper.length;
      for (let ix = 0; ix < w; ix++) {
        const a = upper[(ix + 1) % w]!;
        const b = upper[ix]!;
        const c = lower[ix]!;
        const d = lower[(ix + 1) % w]!;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    } else {
      throw new Error('surface-of-revolution profile has two adjacent pole rings');
    }
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** A sculptable sphere, the default first-run starting shape (FR-01). */
export function sphere(diameterMm = 50, options: SphereOptions = {}): SculptMesh {
  const widthSegments = options.widthSegments ?? DEFAULT_WIDTH_SEGMENTS;
  const heightSegments = options.heightSegments ?? DEFAULT_HEIGHT_SEGMENTS;
  const radius = diameterMm / 2;

  const rings: RevolutionRing[] = [];
  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    const theta = v * Math.PI;
    rings.push({ height: radius * Math.cos(theta), radius: radius * Math.sin(theta) });
  }

  const { positions, indices } = buildSurfaceOfRevolution(rings, widthSegments);
  return createSculptMesh(positions, indices);
}

/**
 * An egg-shaped starting primitive (FR-22): narrower toward the top pole,
 * fuller toward the bottom, blended smoothly so it stays one continuous
 * surface of revolution. The vertical extent is exact; the horizontal
 * extent is an approximation of `widthMm` by design (a taper has no single
 * analytic maximum radius the way a sphere or capsule does).
 */
export function egg(heightMm = 55, widthMm = 40, options: SphereOptions = {}): SculptMesh {
  const widthSegments = options.widthSegments ?? DEFAULT_WIDTH_SEGMENTS;
  const heightSegments = options.heightSegments ?? DEFAULT_HEIGHT_SEGMENTS;
  const radiusY = heightMm / 2;
  const maxRadiusXZ = widthMm / 2;
  const topScale = 0.75;
  const bottomScale = 1.1;

  const rings: RevolutionRing[] = [];
  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    const theta = v * Math.PI;
    const smooth = v * v * (3 - 2 * v);
    const scale = topScale + (bottomScale - topScale) * smooth;
    rings.push({
      height: radiusY * Math.cos(theta),
      radius: maxRadiusXZ * Math.sin(theta) * scale,
    });
  }

  const { positions, indices } = buildSurfaceOfRevolution(rings, widthSegments);
  return createSculptMesh(positions, indices);
}

/**
 * A rectangular block starting primitive (FR-22). Uses 8 shared corner
 * vertices (not 24 per-face vertices) so it is a single connected,
 * index-watertight solid — a brush stroke near an edge deforms the whole
 * corner together rather than tearing the box open at the seam. The
 * trade-off is that corner shading normals are smoothed across the 3
 * adjacent faces rather than perfectly flat; the geometry itself stays a
 * sharp cube.
 */
export function block(xMm = 40, yMm = 40, zMm = 40): SculptMesh {
  const hx = xMm / 2;
  const hy = yMm / 2;
  const hz = zMm / 2;

  // prettier-ignore
  const positions = new Float32Array([
    -hx, -hy, -hz, // 0
     hx, -hy, -hz, // 1
     hx,  hy, -hz, // 2
    -hx,  hy, -hz, // 3
    -hx, -hy,  hz, // 4
     hx, -hy,  hz, // 5
     hx,  hy,  hz, // 6
    -hx,  hy,  hz, // 7
  ]);

  // prettier-ignore
  const indices = new Uint32Array([
    1, 2, 6, 1, 6, 5, // +X
    0, 4, 7, 0, 7, 3, // -X
    3, 7, 6, 3, 6, 2, // +Y
    0, 1, 5, 0, 5, 4, // -Y
    4, 5, 6, 4, 6, 7, // +Z
    0, 3, 2, 0, 2, 1, // -Z
  ]);

  return createSculptMesh(positions, indices);
}

/**
 * A pill-shaped starting primitive (FR-22): a cylindrical middle section
 * capped by two hemispheres, built on the same surface-of-revolution
 * machinery as the sphere. Both `totalHeightMm` (pole to pole) and
 * `radiusMm` come out exact — the profile's straight cylinder section and
 * hemisphere caps have an exact analytic radius, unlike the egg's blended
 * taper.
 */
export function capsule(
  totalHeightMm = 60,
  radiusMm = 15,
  options: CapsuleOptions = {},
): SculptMesh {
  const widthSegments = options.widthSegments ?? DEFAULT_WIDTH_SEGMENTS;
  const hemisphereSegments = options.hemisphereSegments ?? DEFAULT_HEMISPHERE_SEGMENTS;
  const cylinderSegments = options.cylinderSegments ?? DEFAULT_CYLINDER_SEGMENTS;

  const radius = radiusMm;
  const cylinderHeight = Math.max(0, totalHeightMm - 2 * radius);
  const halfCylinder = cylinderHeight / 2;

  const rings: RevolutionRing[] = [];

  for (let j = 0; j <= hemisphereSegments; j++) {
    const angle = (j / hemisphereSegments) * (Math.PI / 2);
    rings.push({
      height: halfCylinder + radius * Math.cos(angle),
      radius: radius * Math.sin(angle),
    });
  }

  for (let m = 1; m < cylinderSegments; m++) {
    const t = m / cylinderSegments;
    rings.push({ height: halfCylinder - t * cylinderHeight, radius });
  }

  for (let k = 0; k <= hemisphereSegments; k++) {
    const angle = (k / hemisphereSegments) * (Math.PI / 2);
    rings.push({
      height: -halfCylinder - radius * Math.sin(angle),
      radius: radius * Math.cos(angle),
    });
  }

  const { positions, indices } = buildSurfaceOfRevolution(rings, widthSegments);
  return createSculptMesh(positions, indices);
}
