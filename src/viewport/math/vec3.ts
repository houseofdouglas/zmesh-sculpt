/**
 * Minimal 3D vector arithmetic shared by this layer's pure math helpers
 * (spherical-camera, grab-projection). Not part of the spec's own
 * Architecture table, which lists only the three named modules under
 * `math/` — but all three need the same handful of vector operations, so
 * this small, DRY supporting module avoids hand-rolling cross/dot/scale
 * three times over. Kept framework-free like the rest of `math/`: no
 * Three.js `Vector3` here, just tuples, so these files stay Node-testable
 * without a DOM/GPU environment.
 */
export type Vec3 = readonly [number, number, number];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/** Zero vector in, zero vector out (rather than NaN) — a degenerate direction has no meaningful unit form. */
export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len <= 1e-12) {
    return [0, 0, 0];
  }
  return scale(v, 1 / len);
}
