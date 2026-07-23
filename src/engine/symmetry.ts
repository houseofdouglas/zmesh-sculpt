import type { Stamp } from '../core/brushes/brush-kernel';
import { queryRadius, type SpatialHash } from '../core/mesh/spatial-hash';
import { GrabStroke, type SurfaceHit } from './stroke';

/**
 * Which axis (if any) strokes are mirrored across (FR-10). Only 'x' is
 * supported in v1; 'none' turns symmetry off. The default (ON) is owned
 * by whichever caller holds brush/session config — the `SculptEngine`
 * facade (Task 15) — not by this module, which is stateless.
 */
export type SymmetryAxis = 'none' | 'x';

function mirrorX(v: readonly [number, number, number]): [number, number, number] {
  return [-v[0], v[1], v[2]];
}

/**
 * Mirrors a single stamp across x=0. Both its center and its normal get
 * their x component negated — a normal is a direction, and reflecting a
 * direction across a plane negates exactly the component perpendicular
 * to it, same as for a position. `dragDelta`, when present, is a
 * world-space vector and mirrors the same way.
 */
export function mirrorStamp(stamp: Stamp): Stamp {
  return {
    center: mirrorX(stamp.center),
    normal: mirrorX(stamp.normal),
    radius: stamp.radius,
    strength: stamp.strength,
    dragDelta: stamp.dragDelta ? mirrorX(stamp.dragDelta) : null,
  };
}

/**
 * Mirrors a pointer hit across x=0 — used to drive a mirrored
 * `GrabStroke` frame-by-frame the same way a real hit drives the primary
 * one (see `SymmetricGrabStroke`).
 */
export function mirrorHit(hit: SurfaceHit): SurfaceHit {
  return {
    point: mirrorX(hit.point),
    normal: mirrorX(hit.normal),
    worldDelta: hit.worldDelta ? mirrorX(hit.worldDelta) : undefined,
  };
}

/**
 * Expands one stamp into the stamp(s) that should actually be applied
 * given the current symmetry axis: itself alone when symmetry is off, or
 * itself plus its x-mirror when on.
 *
 * This is brush-agnostic — it runs before the spatial-hash query and
 * kernel dispatch that turn a `Stamp` into an actual deformation, so it
 * works identically for all six stamp brushes (Draw, Smooth, Inflate,
 * Pinch, Crease, Flatten) with no brush-specific mirroring logic. Grab,
 * being stroke-stateful rather than stamp-based, uses
 * `SymmetricGrabStroke` instead.
 *
 * A stamp centered exactly on the mirror plane produces two identical
 * copies, which is deliberate (not a bug to special-case): it's the same
 * "both stamps fire" behavior applied at the seam, matching how
 * symmetric sculpting tools normally behave there.
 *
 * The caller is expected to capture `axis` once per stroke (e.g. at
 * `beginStroke`) and pass that same value for every stamp the stroke
 * emits, so that toggling symmetry mid-session affects only strokes that
 * start afterward (FR-11) — not one already in progress. Since `axis` is
 * an explicit argument here rather than live global state, that guarantee
 * falls out of how the caller threads it through, not from anything
 * mutable in this module.
 */
export function symmetricStamps(stamp: Stamp, axis: SymmetryAxis): Stamp[] {
  if (axis === 'none') {
    return [stamp];
  }
  return [stamp, mirrorStamp(stamp)];
}

/**
 * Grab's symmetric counterpart. A plain `GrabStroke` fixes one vertex set
 * at construction and rigidly carries it for the drag; mirroring it means
 * fixing a *second*, independent vertex set — found by querying the
 * spatial hash at the mirrored touch-down point — and carrying that one
 * with the mirrored drag each update.
 *
 * The two `GrabStroke`s are otherwise completely independent: no shared
 * state, no coordination beyond mirroring the input hit. `axis` is fixed
 * at construction (bound to whichever stroke this instance belongs to),
 * so a symmetry toggle after construction cannot retroactively change an
 * in-progress grab — only a grab started afterward picks up the new
 * setting (FR-11), matching `symmetricStamps`.
 */
export class SymmetricGrabStroke {
  private readonly primary: GrabStroke;
  private readonly mirrored: GrabStroke | null;

  constructor(positions: Float32Array, spatialHash: SpatialHash, stamp: Stamp, axis: SymmetryAxis) {
    const primaryAffected = queryRadius(spatialHash, positions, stamp.center, stamp.radius);
    this.primary = new GrabStroke(positions, primaryAffected, stamp);

    if (axis === 'x') {
      const mirrored = mirrorStamp(stamp);
      const mirroredAffected = queryRadius(
        spatialHash,
        positions,
        mirrored.center,
        mirrored.radius,
      );
      this.mirrored = new GrabStroke(positions, mirroredAffected, mirrored);
    } else {
      this.mirrored = null;
    }
  }

  /** Whether either side is still held. */
  get isActive(): boolean {
    return this.primary.isActive || (this.mirrored?.isActive ?? false);
  }

  /** Every vertex either side pinned — for normal recompute / dirty-region reporting. */
  get affectedIndices(): number[] {
    const combined = new Set<number>(this.primary.affectedIndices);
    if (this.mirrored) {
      for (const v of this.mirrored.affectedIndices) {
        combined.add(v);
      }
    }
    return Array.from(combined);
  }

  /**
   * Drives both sides from one real pointer hit: the primary side from
   * `hit` directly, the mirrored side from its x-mirror.
   */
  update(hit: SurfaceHit | null): boolean {
    const primaryMoved = this.primary.update(hit);
    if (!this.mirrored) {
      return primaryMoved;
    }
    const mirroredMoved = this.mirrored.update(hit ? mirrorHit(hit) : null);
    return primaryMoved || mirroredMoved;
  }

  /** Releases both sides. */
  end(): void {
    this.primary.end();
    this.mirrored?.end();
  }
}
