import { add, cross, dot, normalize, scale, subtract, type Vec3 } from './vec3';

/**
 * Converts a frame-to-frame screen-space pointer delta into a world-space
 * delta on the camera-facing plane through `grabPoint` (FR-17 — what
 * makes a Grab drag track the cursor in screen space at the model's
 * depth, rather than at some fixed world scale that feels wrong up
 * close or far away).
 *
 * The technique: at `grabPoint`'s depth along the camera's view
 * direction, one pixel of screen motion corresponds to a fixed number of
 * world units (the standard perspective-camera "world size per pixel" at
 * a given depth) — the same relationship `framingDistance` inverts.
 * Screen X maps to the camera's right axis; screen Y maps to the
 * camera's up axis, negated, since screen-space Y conventionally grows
 * downward while world "up" is the opposite sense.
 *
 * `depth` is measured along `cameraForward` (a projection, not the
 * straight-line distance to `grabPoint`) — the correct quantity for a
 * perspective FOV, and the one that keeps this consistent with
 * `framingDistance`'s own distance-along-view-direction convention.
 */
export function projectScreenDeltaToWorld(
  grabPoint: Vec3,
  cameraPosition: Vec3,
  cameraForward: Vec3,
  cameraUp: Vec3,
  screenDx: number,
  screenDy: number,
  viewportHeightPx: number,
  fovYRadians: number,
): Vec3 {
  const forward = normalize(cameraForward);
  const depth = dot(subtract(grabPoint, cameraPosition), forward);

  const worldHeightAtDepth = 2 * depth * Math.tan(fovYRadians / 2);
  const unitsPerPixel = viewportHeightPx > 0 ? worldHeightAtDepth / viewportHeightPx : 0;

  const right = normalize(cross(forward, cameraUp));
  const up = normalize(cameraUp);

  const rightDelta = scale(right, screenDx * unitsPerPixel);
  const upDelta = scale(up, -screenDy * unitsPerPixel);
  return add(rightDelta, upDelta);
}
