import { add, type Vec3 } from './vec3';

/**
 * Padding above the tight-fit distance so a framed model doesn't touch
 * the exact edge of the view — feel-tuned, same convention as the
 * per-brush strength scales in the engine layer. Only increases the
 * returned distance, so it can only make the fit looser (never
 * violates "projected extent <= view height").
 */
const FRAMING_MARGIN = 1.15;

/**
 * The camera distance at which a sphere of the given bounding diagonal
 * fits entirely within the vertical field of view (FR-10/frameModel).
 * Uses the bounds diagonal as a worst-case bounding-sphere diameter, so
 * the fit holds regardless of the model's current orientation.
 *
 * Standard perspective-camera framing formula: the visible vertical
 * extent at distance d is `2 * d * tan(fovY/2)`; solving for the d at
 * which that extent equals the diagonal gives the tight fit, then a
 * small margin is applied.
 */
export function framingDistance(boundsDiagonalMm: number, fovYRadians: number): number {
  const tightFit = boundsDiagonalMm / (2 * Math.tan(fovYRadians / 2));
  return tightFit * FRAMING_MARGIN;
}

/**
 * A camera position on a sphere of `radius` around `target`, parameterized
 * by yaw (rotation around the vertical/Y axis) and pitch (angle above the
 * horizontal plane) — an orbit camera's usual two degrees of freedom.
 * `yaw=0, pitch=0` places the camera on `target`'s +Z side, at its
 * height; increasing `pitch` raises the camera toward +Y (looking down
 * at the target); increasing `yaw` rotates it around Y.
 */
export function sphericalToPosition(
  target: Vec3,
  radius: number,
  yaw: number,
  pitch: number,
): Vec3 {
  const horizontal = radius * Math.cos(pitch);
  const offset: Vec3 = [
    horizontal * Math.sin(yaw),
    radius * Math.sin(pitch),
    horizontal * Math.cos(yaw),
  ];
  return add(target, offset);
}
