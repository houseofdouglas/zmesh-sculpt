import type { PerspectiveCamera } from 'three';
import type { Aabb } from '../core/mesh/sculpt-mesh';
import { framingDistance, sphericalToPosition } from './math/spherical-camera';
import { projectScreenDeltaToWorld } from './math/grab-projection';
import { cross, normalize, subtract, type Vec3 } from './math/vec3';

/** Just short of vertical, avoiding the lookAt basis singularity when view direction is parallel to world-up. */
const MAX_PITCH_RADIANS = (89 * Math.PI) / 180;
/** Floor on camera distance so zooming in can never cross through (or reach) the target. */
const MIN_RADIUS_MM = 1;

export interface CameraControllerInitialState {
  target?: Vec3;
  yaw?: number;
  pitch?: number;
  radius: number;
}

/**
 * Orbit/pan/zoom around a target point, in mm world space (FR-9), built
 * on `spherical-camera.ts`'s math — in-house per the spec's leaning
 * answer, since the pointer router (Task 07) needs to own pointer-down
 * anyway and `OrbitControls` would fight that.
 *
 * State is target + yaw + pitch + radius (an orbit camera's usual
 * parameterization); every mutator recomputes the camera's position and
 * orientation from that state via `sphericalToPosition`, rather than
 * accumulating incremental transforms — this keeps the camera's position
 * always an exact, reproducible function of (target, yaw, pitch, radius),
 * with no drift.
 *
 * Raw pointer-event wiring (which gesture maps to which method, with
 * what deltas) is Task 07's job; this class only exposes the imperative
 * operations themselves.
 */
export class CameraController {
  private readonly camera: PerspectiveCamera;
  private target: Vec3;
  private yaw: number;
  private pitch: number;
  private radius: number;

  constructor(camera: PerspectiveCamera, initial: CameraControllerInitialState) {
    this.camera = camera;
    this.target = initial.target ?? [0, 0, 0];
    this.yaw = initial.yaw ?? 0;
    this.pitch = initial.pitch ?? 0;
    this.radius = Math.max(initial.radius, MIN_RADIUS_MM);
    this.updateCameraTransform();
  }

  /** Rotates around the target: `deltaYaw`/`deltaPitch` in radians. Pitch is clamped to avoid flipping over the poles. */
  orbit(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, -MAX_PITCH_RADIANS, MAX_PITCH_RADIANS);
    this.updateCameraTransform();
  }

  /**
   * Translates the target (and, since the camera's position is always
   * derived from it, the camera along with it) so the scene tracks the
   * cursor — the same "grab and drag" feel as the engine's Grab brush.
   * `screenDx`/`screenDy` are raw pointer-motion pixels for this frame;
   * `viewportHeightPx` is the current render target height, needed to
   * convert pixels to world units at the target's depth.
   */
  pan(screenDx: number, screenDy: number, viewportHeightPx: number): void {
    const position = this.position();
    const forward = normalize(subtract(this.target, position));
    const up = this.trueUp(forward);

    const worldDelta = projectScreenDeltaToWorld(
      this.target,
      position,
      forward,
      up,
      screenDx,
      screenDy,
      viewportHeightPx,
      this.fovYRadians(),
    );

    // Moving the camera by +worldDelta would make static content appear
    // to shift by -worldDelta on screen (the usual camera-translation
    // inversion) — subtracting here is what makes content track the
    // cursor instead of run away from it.
    this.target = subtract(this.target, worldDelta);
    this.updateCameraTransform();
  }

  /**
   * Scales the distance to the target by `scaleFactor`: less than 1 moves
   * the camera closer (zoom in), greater than 1 moves it further away
   * (zoom out). Multiplicative rather than additive so zoom speed feels
   * consistent regardless of the current distance.
   */
  zoom(scaleFactor: number): void {
    this.radius = Math.max(this.radius * scaleFactor, MIN_RADIUS_MM);
    this.updateCameraTransform();
  }

  /**
   * Fits the camera to `bounds` (FR-10/frameModel): centers the target
   * on the bounds' midpoint and sets the distance via `framingDistance`
   * against the bounds diagonal. Current yaw/pitch are kept (framing
   * adjusts distance and center, not viewing angle) — callers decide
   * *when* to call this (spec: on mount and on a new/loaded mesh, not on
   * a remesh); this method itself has no opinion on that.
   */
  frame(bounds: Aabb): void {
    const center: Vec3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const dx = bounds.max[0] - bounds.min[0];
    const dy = bounds.max[1] - bounds.min[1];
    const dz = bounds.max[2] - bounds.min[2];
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);

    this.target = center;
    this.radius = Math.max(framingDistance(diagonal, this.fovYRadians()), MIN_RADIUS_MM);
    this.updateCameraTransform();
  }

  private position(): Vec3 {
    return sphericalToPosition(this.target, this.radius, this.yaw, this.pitch);
  }

  private fovYRadians(): number {
    return (this.camera.fov * Math.PI) / 180;
  }

  /**
   * The camera's true orthonormal up vector for its current orientation
   * — not `camera.up` (which stays whatever fixed world-up hint was last
   * assigned; `lookAt` uses it to *build* an orientation but doesn't
   * update it to match). Derived via the standard look-at basis
   * construction so `pan`'s call into `projectScreenDeltaToWorld` gets a
   * right/up pair that's actually perpendicular to `forward`.
   */
  private trueUp(forward: Vec3): Vec3 {
    const worldUpReference: Vec3 = [0, 1, 0];
    const right = normalize(cross(forward, worldUpReference));
    return normalize(cross(right, forward));
  }

  private updateCameraTransform(): void {
    const position = this.position();
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target[0], this.target[1], this.target[2]);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
