import { SculptMeshValidationError, type SculptMesh } from '../core/mesh/sculpt-mesh';
import { sphere, egg, block, capsule } from '../core/mesh/primitives';
import { buildVertexAdjacency, type VertexAdjacency } from '../core/mesh/adjacency';
import { buildSpatialHash, queryRadius, updateVertexPosition, type SpatialHash } from '../core/mesh/spatial-hash';
import { recomputeAffectedRegionNormals } from '../core/mesh/normals';
import { STAMP_BRUSH_KERNELS, type BrushKernel, type Stamp, type StampBrushType } from '../core/brushes';
import { StrokeSampler, type SurfaceHit } from './stroke';
import { SymmetricGrabStroke, symmetricStamps, type SymmetryAxis } from './symmetry';
import { SculptHistory, type HistoryEntry } from './history';

export type BrushType = StampBrushType | 'grab';
export type PrimitiveShape = 'sphere' | 'egg' | 'block' | 'capsule';

/**
 * Discrete detail levels (FR-15). Just the type lives here for now — the
 * level-to-target-triangle-count mapping and worker dispatch is
 * `engine/detail.ts`, a Task 16 file, since it needs `remesh()` (Task 16)
 * to mean anything. `getDetail`/`getMaxDetail` below are real; `setDetail`
 * is a typed placeholder until then (see its doc comment).
 */
export type DetailLevel = 'low' | 'med' | 'high' | 'max';

export interface DirtyRegion {
  /** lowest touched vertex index */
  vertexStart: number;
  /** one past the highest touched vertex index (half-open, like Array.slice) */
  vertexEnd: number;
  aabb: { min: number[]; max: number[] };
}

const DEFAULT_BRUSH_SIZE_MM = 5;
const DEFAULT_BRUSH_STRENGTH = 0.5;
const MIN_BRUSH_SIZE_MM = 0.1;
/** Mesh-relative brush size ceiling, as a multiple of the mesh's AABB diagonal. */
const MAX_BRUSH_SIZE_DIAGONAL_MULTIPLE = 2;

const PRIMITIVE_GENERATORS: Readonly<Record<PrimitiveShape, () => SculptMesh>> = {
  sphere: () => sphere(),
  egg: () => egg(),
  block: () => block(),
  capsule: () => capsule(),
};

/**
 * The single object the viewport and UI layers talk to (per the spec's
 * Engine API section) — mesh lifecycle, brush config, the stroke
 * lifecycle (stamps → kernels → normals → history), undo/redo, and dirty
 * region notification. Holds all mesh state itself; imports no React or
 * Three.js.
 *
 * `updateStroke` accepts `SurfaceHit | null`, one deliberate widening past
 * the spec's literal `SurfaceHit`-only signature: `StrokeSampler` and
 * `GrabStroke` (Task 12) were already built to treat a `null` hit as "the
 * cursor left the mesh this frame" and break stroke continuity safely
 * rather than interpolating stamps across the gap. Accepting `null` here
 * too lets a viewport that polls every frame (rather than only calling
 * updateStroke when it has a hit) get that safety directly, and is a
 * strict superset of the spec'd contract — any caller that only ever has
 * real hits behaves identically either way.
 */
export class SculptEngine {
  private mesh: SculptMesh;
  private adjacency: VertexAdjacency;
  private spatialHash: SpatialHash;
  private history: SculptHistory;

  private brushType: BrushType = 'draw';
  private brushSizeMm = DEFAULT_BRUSH_SIZE_MM;
  private brushStrength = DEFAULT_BRUSH_STRENGTH;
  private invert = false;
  private symmetryAxis: SymmetryAxis = 'x'; // FR-10: X-mirror is ON by default
  private detailLevel: DetailLevel = 'med';

  // Active-stroke state (all null when no stroke is in progress).
  private strokeSampler: StrokeSampler | null = null;
  private grab: SymmetricGrabStroke | null = null;
  /** vertex -> its position just before the stroke's first touch, captured lazily */
  private strokeTouched: Map<number, readonly [number, number, number]> | null = null;
  /** symmetry axis captured at beginStroke, so a mid-stroke toggle doesn't retroactively apply (FR-11) */
  private strokeAxis: SymmetryAxis = 'x';

  private readonly changeListeners = new Set<(region: DirtyRegion) => void>();

  constructor() {
    // FR-01: sphere is the default first-run starting shape.
    const initial = sphere();
    this.mesh = initial;
    this.adjacency = buildVertexAdjacency(initial);
    this.spatialHash = buildSpatialHash(initial);
    this.history = new SculptHistory();
  }

  // ---- mesh lifecycle ----

  loadMesh(mesh: SculptMesh): void {
    if (mesh.vertexCount === 0) {
      throw new SculptMeshValidationError('cannot load an empty/zero-vertex mesh');
    }
    this.replaceMesh(mesh);
  }

  newFromPrimitive(shape: PrimitiveShape): void {
    this.replaceMesh(PRIMITIVE_GENERATORS[shape]());
  }

  getMesh(): Readonly<SculptMesh> {
    return this.mesh;
  }

  // ---- brush config ----

  setBrush(type: BrushType): void {
    this.brushType = type;
  }

  setBrushSize(mm: number): void {
    const maxSize = this.maxBrushSizeMm();
    this.brushSizeMm = clamp(mm, MIN_BRUSH_SIZE_MM, maxSize);
  }

  setBrushStrength(value: number): void {
    this.brushStrength = clamp(value, 0, 1);
  }

  setInvert(invert: boolean): void {
    this.invert = invert;
  }

  setSymmetry(axis: SymmetryAxis): void {
    this.symmetryAxis = axis;
  }

  // ---- stroke lifecycle ----

  beginStroke(hit: SurfaceHit): void {
    this.strokeAxis = this.symmetryAxis;
    this.strokeTouched = new Map();

    const stamp = this.makeStamp(hit);

    if (this.brushType === 'grab') {
      this.grab = new SymmetricGrabStroke(this.mesh.positions, this.spatialHash, stamp, this.strokeAxis);
      this.recordTouched(this.grab.affectedIndices);
      return;
    }

    const kernel = STAMP_BRUSH_KERNELS[this.brushType];
    this.strokeSampler = new StrokeSampler(this.brushSizeMm, this.signedStrength());
    this.applyStampsForCurrentStroke(this.strokeSampler.begin(hit), kernel);
  }

  updateStroke(hit: SurfaceHit | null): void {
    if (this.grab) {
      if (this.grab.update(hit)) {
        this.onGrabMoved();
      }
      return;
    }
    if (this.strokeSampler) {
      const kernel = STAMP_BRUSH_KERNELS[this.brushType as StampBrushType];
      this.applyStampsForCurrentStroke(this.strokeSampler.update(hit), kernel);
    }
    // No active stroke (updateStroke called without a preceding
    // beginStroke, or the brush was degenerate at begin) — safe no-op.
  }

  endStroke(): void {
    this.grab?.end();
    this.grab = null;
    this.strokeSampler?.end();
    this.strokeSampler = null;
    this.commitStrokeHistory();
  }

  // ---- history ----

  undo(): void {
    this.applyHistoryEntry(this.history.undo(this.mesh.positions));
  }

  redo(): void {
    this.applyHistoryEntry(this.history.redo(this.mesh.positions));
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  // ---- detail ----

  getDetail(): DetailLevel {
    return this.detailLevel;
  }

  /**
   * Not implemented yet: needs `remesh()` and the worker dispatch, both
   * Task 16. `getDetail`/`getMaxDetail` are real (and `getMaxDetail`
   * already reflects the resolved Q-01 clamp) so the rest of this
   * facade's typed surface is complete now; only the actual remesh
   * behavior is deferred.
   */
  setDetail(_level: DetailLevel): Promise<void> {
    return Promise.reject(
      new Error('setDetail is not implemented until remesh() is wired in (Task 16)'),
    );
  }

  getMaxDetail(): DetailLevel {
    // Q-01 (Task 09, resolved 2026-07-23): Max = 500,000 triangles.
    return 'max';
  }

  // ---- change notification ----

  onChange(cb: (region: DirtyRegion) => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  // ---- internals ----

  private replaceMesh(mesh: SculptMesh): void {
    this.mesh = mesh;
    this.adjacency = buildVertexAdjacency(mesh);
    this.spatialHash = buildSpatialHash(mesh);
    // A new topology invalidates every existing history entry (their
    // vertex indices refer to the old mesh's layout, not this one), so a
    // fresh mesh load starts a fresh history — same as a new session.
    this.history = new SculptHistory();
  }

  private maxBrushSizeMm(): number {
    const { min, max } = this.mesh.bounds;
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return diagonal * MAX_BRUSH_SIZE_DIAGONAL_MULTIPLE;
  }

  private signedStrength(): number {
    return this.invert ? -this.brushStrength : this.brushStrength;
  }

  private makeStamp(hit: SurfaceHit): Stamp {
    return {
      center: hit.point,
      normal: hit.normal,
      radius: this.brushSizeMm,
      strength: this.signedStrength(),
      dragDelta: null,
    };
  }

  /** Expands each stamp for symmetry, then queries + applies + recomputes + notifies for every resulting stamp. */
  private applyStampsForCurrentStroke(stamps: readonly Stamp[], kernel: BrushKernel): void {
    for (const stamp of stamps) {
      for (const expanded of symmetricStamps(stamp, this.strokeAxis)) {
        this.applyStampAndNotify(expanded, kernel);
      }
    }
  }

  private applyStampAndNotify(stamp: Stamp, kernel: BrushKernel): void {
    const affected = queryRadius(this.spatialHash, this.mesh.positions, stamp.center, stamp.radius);
    if (affected.length === 0) {
      return;
    }
    this.recordTouched(affected);

    kernel({
      positions: this.mesh.positions,
      normals: this.mesh.normals,
      adjacency: this.adjacency,
      affectedIndices: affected,
      stamp,
    });
    recomputeAffectedRegionNormals(
      this.mesh.positions,
      this.mesh.indices,
      this.mesh.normals,
      this.adjacency,
      affected,
    );
    for (const v of affected) {
      updateVertexPosition(this.spatialHash, this.mesh.positions, v);
    }
    this.emitDirtyRegion(affected);
  }

  private onGrabMoved(): void {
    if (!this.grab) {
      return;
    }
    const affected = this.grab.affectedIndices;
    this.recordTouched(affected);
    recomputeAffectedRegionNormals(
      this.mesh.positions,
      this.mesh.indices,
      this.mesh.normals,
      this.adjacency,
      affected,
    );
    for (const v of affected) {
      updateVertexPosition(this.spatialHash, this.mesh.positions, v);
    }
    this.emitDirtyRegion(affected);
  }

  /** Records each vertex's pre-stroke position the first time (and only the first time) it's touched. */
  private recordTouched(indices: readonly number[]): void {
    if (!this.strokeTouched) {
      return;
    }
    for (const v of indices) {
      if (!this.strokeTouched.has(v)) {
        this.strokeTouched.set(v, [
          this.mesh.positions[v * 3]!,
          this.mesh.positions[v * 3 + 1]!,
          this.mesh.positions[v * 3 + 2]!,
        ]);
      }
    }
  }

  /**
   * Packages every vertex touched anywhere in the just-ended stroke into
   * exactly one history entry (FR-12), reading each one's final ("after")
   * value fresh from the live mesh. A stroke that never touched anything
   * (degenerate brush, or a stroke that never got a beginStroke) commits
   * no entry at all — per the spec's edge cases, a no-op stroke is not an
   * undo step.
   */
  private commitStrokeHistory(): void {
    const touched = this.strokeTouched;
    this.strokeTouched = null;
    if (!touched || touched.size === 0) {
      return;
    }

    const indices = Uint32Array.from(touched.keys());
    const before = new Float32Array(indices.length * 3);
    const after = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      const v = indices[i]!;
      const original = touched.get(v)!;
      before[i * 3] = original[0];
      before[i * 3 + 1] = original[1];
      before[i * 3 + 2] = original[2];
      after[i * 3] = this.mesh.positions[v * 3]!;
      after[i * 3 + 1] = this.mesh.positions[v * 3 + 1]!;
      after[i * 3 + 2] = this.mesh.positions[v * 3 + 2]!;
    }
    this.history.pushStroke(indices, before, after);
  }

  /**
   * After a stroke entry's positions are restored (by `SculptHistory`
   * itself), the affected region's normals are stale — they still
   * reflect whichever side of the undo/redo we just moved away from — so
   * they're recomputed here exactly as after a fresh stamp (FR-4 treats
   * undo/redo as just another kind of deformation to the region). Since
   * `recomputeAffectedRegionNormals` is a pure function of positions,
   * recomputing against the now bit-identical restored positions yields
   * the same bit-identical normals that existed at that point originally
   * — no separate normals buffer needs to be stored per entry.
   *
   * A remesh entry isn't produced by `SculptHistory` yet (Task 16), so
   * there's nothing to do for that branch here today.
   */
  private applyHistoryEntry(entry: HistoryEntry | null): void {
    if (!entry || entry.kind !== 'stroke') {
      return;
    }
    const indices = Array.from(entry.indices);
    recomputeAffectedRegionNormals(
      this.mesh.positions,
      this.mesh.indices,
      this.mesh.normals,
      this.adjacency,
      indices,
    );
    for (const v of indices) {
      updateVertexPosition(this.spatialHash, this.mesh.positions, v);
    }
    this.emitDirtyRegion(indices);
  }

  private emitDirtyRegion(affected: readonly number[]): void {
    if (affected.length === 0 || this.changeListeners.size === 0) {
      return;
    }
    const region = computeDirtyRegion(this.mesh.positions, affected);
    for (const cb of this.changeListeners) {
      cb(region);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computeDirtyRegion(positions: Float32Array, affected: readonly number[]): DirtyRegion {
  let vertexStart = Infinity;
  let vertexEnd = -Infinity;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const v of affected) {
    if (v < vertexStart) vertexStart = v;
    if (v > vertexEnd) vertexEnd = v;
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  return {
    vertexStart,
    vertexEnd: vertexEnd + 1,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}
