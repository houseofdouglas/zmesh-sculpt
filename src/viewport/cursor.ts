import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Vector3 } from 'three';
import type { SurfaceHit } from '../engine/stroke';

export interface BrushDisplayConfig {
  /** mm — mirrors the value the UI passes to `engine.setBrushSize` (spec's Data Model). */
  cursorRadiusMm: number;
  /** mirrors engine symmetry; drives the mirror-plane indicator. */
  symmetryX: boolean;
}

const DEFAULT_CONFIG: BrushDisplayConfig = { cursorRadiusMm: 5, symmetryX: true };

/** Ring inner/outer radius as a fraction of the unit base geometry — a thin annulus, not a filled disc. */
const RING_INNER_FRACTION = 0.85;
const RING_SEGMENTS = 48;
/** Nudge along the surface normal (mm) so the ring doesn't z-fight the mesh underneath it. */
const RING_SURFACE_OFFSET_MM = 0.05;

const MIRROR_PLANE_SIZE_MM = 1000;
const MIRROR_PLANE_COLOR = 0x88aaff;
const MIRROR_PLANE_OPACITY = 0.12;

const CURSOR_RING_COLOR = 0xffffff;
const CURSOR_RING_OPACITY = 0.85;

export interface Cursor {
  ring: Mesh;
  mirrorPlane: Mesh;
  /** FR-20: cursor radius and the mirror-plane's visibility, without the viewport owning brush state itself. */
  setBrushDisplay(config: BrushDisplayConfig): void;
  /**
   * Called on every hover/drag pointer move (FR-18): positions and
   * orients the ring at `hit`, or hides it for `null` (off-mesh, or a
   * camera gesture in progress — the caller decides when that applies).
   */
  updateHover(hit: SurfaceHit | null): void;
  dispose(): void;
}

/**
 * Builds the brush-cursor ring and mirror-plane indicator (FR-18/19).
 * The ring is a simple oriented annulus — the spec's leaning answer over
 * a projected decal, simplest to get right; revisit if it reads poorly
 * on high-curvature surfaces. Built once at a unit radius and resized via
 * `.scale`, not rebuilt, so `setBrushDisplay` stays cheap on every slider
 * tick. Both objects render with `depthTest: false` (and a high
 * `renderOrder`) so they always read clearly on top of the mesh, rather
 * than relying on a surface-offset nudge alone to avoid z-fighting.
 */
export function createCursor(initial: BrushDisplayConfig = DEFAULT_CONFIG): Cursor {
  let config = initial;

  const ringMaterial = new MeshBasicMaterial({
    color: CURSOR_RING_COLOR,
    transparent: true,
    opacity: CURSOR_RING_OPACITY,
    depthTest: false,
    side: DoubleSide,
  });
  const ring = new Mesh(new RingGeometry(RING_INNER_FRACTION, 1, RING_SEGMENTS), ringMaterial);
  ring.renderOrder = 999;
  ring.visible = false;
  ring.scale.setScalar(config.cursorRadiusMm);

  const mirrorMaterial = new MeshBasicMaterial({
    color: MIRROR_PLANE_COLOR,
    transparent: true,
    opacity: MIRROR_PLANE_OPACITY,
    side: DoubleSide,
    depthWrite: false,
  });
  const mirrorPlane = new Mesh(
    new PlaneGeometry(MIRROR_PLANE_SIZE_MM, MIRROR_PLANE_SIZE_MM),
    mirrorMaterial,
  );
  // PlaneGeometry's own face normal is +Z; the mirror plane is the x=0
  // plane, whose normal is +X — rotate its face a quarter turn around Y.
  mirrorPlane.rotation.y = Math.PI / 2;
  mirrorPlane.visible = config.symmetryX;

  const upAxis = new Vector3(0, 0, 1);
  const normalVec = new Vector3();

  function setBrushDisplay(next: BrushDisplayConfig): void {
    config = next;
    ring.scale.setScalar(config.cursorRadiusMm);
    mirrorPlane.visible = config.symmetryX;
  }

  function updateHover(hit: SurfaceHit | null): void {
    if (!hit) {
      ring.visible = false;
      return;
    }
    normalVec.set(hit.normal[0], hit.normal[1], hit.normal[2]);
    ring.quaternion.setFromUnitVectors(upAxis, normalVec);
    ring.position.set(
      hit.point[0] + hit.normal[0] * RING_SURFACE_OFFSET_MM,
      hit.point[1] + hit.normal[1] * RING_SURFACE_OFFSET_MM,
      hit.point[2] + hit.normal[2] * RING_SURFACE_OFFSET_MM,
    );
    ring.visible = true;
  }

  function dispose(): void {
    ring.geometry.dispose();
    ringMaterial.dispose();
    mirrorPlane.geometry.dispose();
    mirrorMaterial.dispose();
  }

  return { ring, mirrorPlane, setBrushDisplay, updateHover, dispose };
}
