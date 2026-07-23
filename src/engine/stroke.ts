import {
  MAX_STAMP_DISPLACEMENT_MM,
  clampVectorMagnitude,
  type Stamp,
} from '../core/brushes/brush-kernel';
import { computeFalloff } from '../core/brushes/falloff';

/**
 * A resolved pointer sample: where on the surface the cursor is, supplied
 * by the viewport's raycaster. The engine never raycasts itself — it only
 * ever sees hits (see the sculpt-engine-core spec's Out of Scope).
 */
export interface SurfaceHit {
  /** surface hit point, mm */
  point: readonly [number, number, number];
  /** interpolated surface normal at the hit point */
  normal: readonly [number, number, number];
  /** frame-to-frame cursor motion in world space; Grab only */
  worldDelta?: readonly [number, number, number];
}

/**
 * Stamps are placed every `radius * STAMP_SPACING_FRACTION` mm of travel
 * along the stroke path. Spacing proportional to brush size (rather than
 * to elapsed time or to one-stamp-per-pointer-event) is what makes a
 * stroke speed-independent per FR-7: a fast drag delivers few, long
 * pointer samples and gets many interpolated stamps; a slow drag delivers
 * many short ones and gets stamps only once enough distance accumulates.
 *
 * A quarter of the radius means consecutive stamps overlap heavily, which
 * is what makes a stroke read as a continuous ridge rather than a row of
 * dots. Feel-tuned, like the per-brush strength scales (spec Open
 * Questions).
 */
export const STAMP_SPACING_FRACTION = 0.25;

/**
 * Turns a stream of pointer samples into evenly spaced stamps for the
 * six stamp brushes (Draw, Smooth, Inflate, Pinch, Crease, Flatten).
 *
 * This class only *generates* stamps — it never touches mesh data. The
 * caller (the `SculptEngine` facade, Task 15) queries the spatial hash for
 * each returned stamp and runs the matching kernel from the brush
 * registry. Grab does not go through here at all; it is stroke-stateful
 * and handled by {@link GrabStroke}.
 *
 * One sampler serves one stroke: `begin` → zero or more `update`s → `end`.
 */
export class StrokeSampler {
  private readonly radius: number;
  private readonly strength: number;
  private readonly spacing: number;

  private active = false;
  /** true once an off-mesh sample broke stroke continuity (see `update`) */
  private gapPending = false;
  private lastSamplePoint: [number, number, number] = [0, 0, 0];
  private lastSampleNormal: [number, number, number] = [0, 1, 0];
  /** path length travelled since the last stamp was emitted, mm */
  private distanceSinceLastStamp = 0;

  /**
   * @param radius brush size in mm
   * @param strength 0–1, already sign-flipped by the caller when inverted
   * @param spacingFraction stamp spacing as a fraction of `radius`
   */
  constructor(radius: number, strength: number, spacingFraction = STAMP_SPACING_FRACTION) {
    if (spacingFraction <= 0) {
      throw new RangeError(`spacingFraction must be > 0, got ${spacingFraction}`);
    }
    this.radius = radius;
    this.strength = strength;
    this.spacing = radius * spacingFraction;
  }

  /** Whether a stroke is currently in progress (between `begin` and `end`). */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Starts a stroke, emitting the stamp at the touch-down point. A
   * degenerate brush (zero radius or zero strength) starts nothing and
   * emits nothing, so no history entry is ever committed for it.
   */
  begin(hit: SurfaceHit): Stamp[] {
    if (this.isDegenerate()) {
      return [];
    }
    this.active = true;
    this.gapPending = false;
    this.distanceSinceLastStamp = 0;
    this.anchor(hit);
    return [this.makeStamp(hit.point, hit.normal)];
  }

  /**
   * Advances the stroke to a new pointer sample, emitting every stamp that
   * falls on the path between the previous sample and this one.
   *
   * A `null` hit means the cursor left the mesh: a safe no-op that also
   * breaks continuity, so the stroke does not later interpolate a line of
   * stamps across the gap (which could stamp through empty space, or
   * across the far side of the model). Re-entering the surface behaves
   * like a fresh touch-down — it re-anchors and stamps there.
   */
  update(hit: SurfaceHit | null): Stamp[] {
    if (!this.active) {
      return [];
    }
    if (hit === null) {
      this.gapPending = true;
      return [];
    }
    if (this.gapPending) {
      this.gapPending = false;
      this.distanceSinceLastStamp = 0;
      this.anchor(hit);
      return [this.makeStamp(hit.point, hit.normal)];
    }

    const ax = this.lastSamplePoint[0];
    const ay = this.lastSamplePoint[1];
    const az = this.lastSamplePoint[2];
    const segX = hit.point[0] - ax;
    const segY = hit.point[1] - ay;
    const segZ = hit.point[2] - az;
    const segLength = Math.sqrt(segX * segX + segY * segY + segZ * segZ);
    if (segLength <= 0) {
      // Cursor held still: no path travelled, so no stamp is due. Holding
      // the pointer down without moving must not pile stamps on one spot.
      return [];
    }

    const stamps: Stamp[] = [];
    let travelled = 0;
    // Each iteration consumes exactly the remaining distance to the next
    // stamp. The guard means that distance never exceeds what's left of
    // the segment, so `t` below stays within [0, 1].
    while (this.distanceSinceLastStamp + (segLength - travelled) >= this.spacing) {
      travelled += this.spacing - this.distanceSinceLastStamp;
      const t = travelled / segLength;
      const point: [number, number, number] = [ax + segX * t, ay + segY * t, az + segZ * t];
      stamps.push(this.makeStamp(point, this.interpolateNormal(hit.normal, t)));
      this.distanceSinceLastStamp = 0;
    }
    this.distanceSinceLastStamp += segLength - travelled;

    this.anchor(hit);
    return stamps;
  }

  /** Ends the stroke; later `update`s are no-ops until the next `begin`. */
  end(): void {
    this.active = false;
  }

  private isDegenerate(): boolean {
    return this.radius <= 0 || this.strength === 0;
  }

  private anchor(hit: SurfaceHit): void {
    this.lastSamplePoint[0] = hit.point[0];
    this.lastSamplePoint[1] = hit.point[1];
    this.lastSamplePoint[2] = hit.point[2];
    this.lastSampleNormal[0] = hit.normal[0];
    this.lastSampleNormal[1] = hit.normal[1];
    this.lastSampleNormal[2] = hit.normal[2];
  }

  /**
   * Linear blend between the segment's two endpoint normals, renormalized.
   * Falls back to the newer normal in the degenerate case where the two
   * are near-opposite and cancel — a stamp with a zero-length normal would
   * make Draw/Crease displace by nothing at all.
   */
  private interpolateNormal(
    endNormal: readonly [number, number, number],
    t: number,
  ): [number, number, number] {
    const x = this.lastSampleNormal[0] + (endNormal[0] - this.lastSampleNormal[0]) * t;
    const y = this.lastSampleNormal[1] + (endNormal[1] - this.lastSampleNormal[1]) * t;
    const z = this.lastSampleNormal[2] + (endNormal[2] - this.lastSampleNormal[2]) * t;
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length <= 1e-12) {
      return [endNormal[0], endNormal[1], endNormal[2]];
    }
    return [x / length, y / length, z / length];
  }

  private makeStamp(
    point: readonly [number, number, number],
    normal: readonly [number, number, number],
  ): Stamp {
    return {
      center: [point[0], point[1], point[2]],
      normal: [normal[0], normal[1], normal[2]],
      radius: this.radius,
      strength: this.strength,
      dragDelta: null,
    };
  }
}

/**
 * Grab: the one brush that isn't a stamp kernel.
 *
 * Every other brush recomputes its affected set and falloff weights per
 * stamp from live positions. Grab must not — it fixes both at touch-down
 * and then rigidly carries that same soft region along with the cursor.
 * Recomputing either mid-drag would make the grabbed region slide off the
 * vertices it grabbed (they've moved away from the original center), which
 * is why Grab can't be expressed as a `BrushKernel` and lives here in the
 * engine's stroke lifecycle instead of in `core/brushes/`.
 *
 * Invert is not applicable (the spec's brush table: "direction is the
 * drag"), so the stamp's sign is dropped and only its magnitude is used
 * as the pull scale.
 */
export class GrabStroke {
  private readonly positions: Float32Array;
  /** the vertex set pinned at touch-down; never recomputed */
  private readonly indices: Uint32Array;
  /** falloff × pull strength per pinned vertex, parallel to `indices` */
  private readonly weights: Float32Array;
  private readonly lastPoint: [number, number, number];
  private active = true;

  /**
   * @param positions the live mesh position buffer, mutated in place
   * @param affectedIndices vertices within the stamp radius, from a
   *   spatial-hash query the caller ran at touch-down
   * @param stamp the touch-down stamp (center, radius and strength)
   */
  constructor(positions: Float32Array, affectedIndices: readonly number[], stamp: Stamp) {
    this.positions = positions;

    const pull = Math.abs(stamp.strength);
    const keptIndices: number[] = [];
    const keptWeights: number[] = [];
    for (const vertexIndex of affectedIndices) {
      const dx = positions[vertexIndex * 3]! - stamp.center[0];
      const dy = positions[vertexIndex * 3 + 1]! - stamp.center[1];
      const dz = positions[vertexIndex * 3 + 2]! - stamp.center[2];
      const weight = computeFalloff(Math.sqrt(dx * dx + dy * dy + dz * dz), stamp.radius) * pull;
      // Vertices at or beyond the radius edge weigh 0 and would never
      // move; dropping them here keeps the per-frame loop tight.
      if (weight > 0) {
        keptIndices.push(vertexIndex);
        keptWeights.push(weight);
      }
    }

    this.indices = Uint32Array.from(keptIndices);
    this.weights = Float32Array.from(keptWeights);
    this.lastPoint = [stamp.center[0], stamp.center[1], stamp.center[2]];
  }

  /** Whether the grab is still held (before `end`). */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * The pinned vertex set. The caller needs it to recompute normals for
   * the affected region and to report the dirty region after each update.
   */
  get affectedIndices(): Readonly<Uint32Array> {
    return this.indices;
  }

  /**
   * Translates the pinned set by this frame's cursor motion, weighted per
   * vertex. Uses the hit's `worldDelta` when the viewport supplies one,
   * otherwise derives the motion from the previous hit point.
   *
   * @returns whether any vertex actually moved — the caller uses this to
   *   decide whether normals and the dirty region need updating.
   */
  update(hit: SurfaceHit | null): boolean {
    if (!this.active || hit === null || this.indices.length === 0) {
      return false;
    }

    const rawX = hit.worldDelta ? hit.worldDelta[0] : hit.point[0] - this.lastPoint[0];
    const rawY = hit.worldDelta ? hit.worldDelta[1] : hit.point[1] - this.lastPoint[1];
    const rawZ = hit.worldDelta ? hit.worldDelta[2] : hit.point[2] - this.lastPoint[2];
    this.lastPoint[0] = hit.point[0];
    this.lastPoint[1] = hit.point[1];
    this.lastPoint[2] = hit.point[2];

    // Same per-stamp safety cap the displacement brushes use: a cursor
    // jump (dropped frame, cursor re-entering the window) must not fling
    // the grabbed region through the rest of the mesh.
    const [dx, dy, dz] = clampVectorMagnitude(rawX, rawY, rawZ, MAX_STAMP_DISPLACEMENT_MM);
    if (dx === 0 && dy === 0 && dz === 0) {
      return false;
    }

    for (let i = 0; i < this.indices.length; i++) {
      const vertexIndex = this.indices[i]!;
      const weight = this.weights[i]!;
      this.positions[vertexIndex * 3] = this.positions[vertexIndex * 3]! + dx * weight;
      this.positions[vertexIndex * 3 + 1] = this.positions[vertexIndex * 3 + 1]! + dy * weight;
      this.positions[vertexIndex * 3 + 2] = this.positions[vertexIndex * 3 + 2]! + dz * weight;
    }
    return true;
  }

  /** Releases the grab; later `update`s are no-ops. */
  end(): void {
    this.active = false;
  }
}
