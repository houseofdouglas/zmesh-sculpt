import { Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { SurfaceHit } from '../engine/stroke';
import { projectScreenDeltaToWorld } from './math/grab-projection';
import type { Vec3 } from './math/vec3';

/**
 * Raycasts from a pointer's normalized-device-coordinate position through
 * `camera` against `target`, returning a `SurfaceHit` (FR-16) or `null`
 * if the ray misses — a miss is exactly what drives the pointer router's
 * later camera-vs-sculpt decision (FR-11: primary input off-mesh means
 * camera, not sculpt).
 *
 * Three.js's own `Mesh.raycast` already computes the interpolated
 * (barycentric-weighted) vertex normal at the hit point — not the flat
 * face normal — via the geometry's `normal` attribute, and orients it
 * to face the ray; it just isn't guaranteed unit-length after
 * interpolation, so it's re-normalized here to satisfy the spec's "unit
 * normal" requirement explicitly rather than assuming it.
 */
export function pickSurfaceHit(
  raycaster: Raycaster,
  camera: PerspectiveCamera,
  target: Object3D,
  ndcX: number,
  ndcY: number,
): SurfaceHit | null {
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
  const [hit] = raycaster.intersectObject(target, false);
  if (!hit || !hit.normal) {
    return null;
  }

  const normal = hit.normal.clone().normalize();
  return {
    point: [hit.point.x, hit.point.y, hit.point.z],
    normal: [normal.x, normal.y, normal.z],
  };
}

/** Converts a pointer position in canvas pixels to normalized device coordinates (-1..1, Y up) for `pickSurfaceHit`. */
export function pixelToNdc(
  pixelX: number,
  pixelY: number,
  canvasWidthPx: number,
  canvasHeightPx: number,
): { x: number; y: number } {
  return {
    x: (pixelX / canvasWidthPx) * 2 - 1,
    y: -(pixelY / canvasHeightPx) * 2 + 1,
  };
}

/**
 * Grab's `worldDelta` (FR-17): the frame-to-frame screen-space cursor
 * motion (`screenDx`/`screenDy`) converted to a world-space vector at
 * `grabPoint`'s depth, via Task 02's `projectScreenDeltaToWorld`. Reads
 * the camera's *current* world position/orientation directly (not
 * assuming any particular camera controller drives it) — `camera.up` is
 * transformed by the camera's own quaternion to get its true current up
 * direction, since the raw property is only ever the fixed world-up hint
 * `lookAt` was built from, not something that tracks orientation itself.
 *
 * The caller supplies `grabPoint` (fixed for the whole gesture — Grab
 * doesn't re-raycast mid-drag, per the engine's stroke lifecycle) and
 * the screen delta since the last frame; this function has no state of
 * its own.
 */
export function computeGrabWorldDelta(
  camera: PerspectiveCamera,
  grabPoint: Vec3,
  screenDx: number,
  screenDy: number,
  viewportHeightPx: number,
): Vec3 {
  const cameraPosition: Vec3 = [camera.position.x, camera.position.y, camera.position.z];

  const forwardVec = camera.getWorldDirection(new Vector3());
  const forward: Vec3 = [forwardVec.x, forwardVec.y, forwardVec.z];

  const upVec = camera.up.clone().applyQuaternion(camera.quaternion);
  const up: Vec3 = [upVec.x, upVec.y, upVec.z];

  const fovYRadians = (camera.fov * Math.PI) / 180;

  return projectScreenDeltaToWorld(
    grabPoint,
    cameraPosition,
    forward,
    up,
    screenDx,
    screenDy,
    viewportHeightPx,
    fovYRadians,
  );
}
