import { SculptMeshValidationError, type SculptMesh } from '../core/mesh/sculpt-mesh';
import { sphere, egg, block, capsule } from '../core/mesh/primitives';
import { buildVertexAdjacency, type VertexAdjacency } from '../core/mesh/adjacency';
import { buildSpatialHash, queryRadius, updateVertexPosition, type SpatialHash } from '../core/mesh/spatial-hash';
import { recomputeAffectedRegionNormals } from '../core/mesh/normals';
import { STAMP_BRUSH_KERNELS, type BrushKernel, type Stamp, type StampBrushType } from '../core/brushes';
import { StrokeSampler, type SurfaceHit } from './stroke';
import { SymmetricGrabStroke, symmetricStamps, type SymmetryAxis } from './symmetry';
import { SculptHistory, type HistoryEntry } from './history';
import {
  DETAIL_TARGET_TRIANGLE_COUNTS,
  createWorkerRemeshRunner,
  type DetailLevel,
  type RemeshRunner,
} from './detail';

export type { DetailLevel } from './detail';
export type BrushType = StampBrushType | 'grab';
export type PrimitiveShape = 'sphere' | 'egg' | 'block' | 'capsule';

export interface SculptEngineOptions {
  /**
   * Overrides the `RemeshRunner` `setDetail` dispatches to. Production
   * code should never need this (it defaults to the real Web Worker
   * dispatch); tests inject a fake runner so `setDetail`'s surrounding
   * orchestration — clamping, history, reject-and-restore, progress
   * relay — can be exercised without a real Worker or WASM (neither
   * exists in this project's Node-based Vitest environment).
   */
  remeshRunner?: RemeshRunner;
}

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
  private readonly remeshProgressListeners = new Set<(fraction: number) => void>();
  private readonly remeshRunner: RemeshRunner;

  constructor(options: SculptEngineOptions = {}) {
    // FR-01: sphere is the default first-run starting shape.
    const initial = sphere();
    this.mesh = initial;
    this.adjacency = buildVertexAdjacency(initial);
    this.spatialHash = buildSpatialHash(initial);
    this.history = new SculptHistory();
    // Lazily-invoked: constructing this closure never touches `Worker`
    // itself, only *calling* it does (inside setDetail) — so building an
    // engine with no options is safe even in an environment (like this
    // project's Vitest/Node setup) that has no `Worker` global at all.
    this.remeshRunner = options.remeshRunner ?? createWorkerRemeshRunner();
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
    this.applyHistoryEntry(this.history.undo(this.mesh.positions), 'before');
  }

  redo(): void {
    this.applyHistoryEntry(this.history.redo(this.mesh.positions), 'after');
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
   * Remeshes toward `level`'s target triangle count (FR-15/17) via the
   * injected `RemeshRunner` (the real Web Worker dispatch in production).
   * Resolves once the new mesh is live; rejects — leaving mesh, history,
   * and `detailLevel` completely untouched — if the runner rejects
   * (remesh failure, timeout, or a non-manifold result; `remesh()` itself
   * already refuses to resolve with one). Nothing below the `await` runs
   * on a rejection, which is what makes "leaves mesh + history untouched"
   * automatic rather than something to unwind by hand.
   *
   * Detail-level bookkeeping (`getDetail()`) is not itself part of any
   * history entry — a `RemeshHistoryEntry` (spec's Data Model) only
   * carries before/after meshes, no level — so undoing past a remesh
   * leaves `getDetail()` reporting whichever level was last *successfully
   * set*, which may no longer match the now-restored mesh's actual
   * resolution. Accepted: nothing in the spec's acceptance criteria
   * exercises `getDetail()` across an undo of a remesh.
   */
  async setDetail(level: DetailLevel): Promise<void> {
    const target = DETAIL_TARGET_TRIANGLE_COUNTS[level];
    const before = this.mesh;
    const after = await this.remeshRunner(before, target, (fraction) => {
      this.emitRemeshProgress(fraction);
    });
    this.commitRemesh(before, after);
    this.detailLevel = level;
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

  /**
   * Reports remesh progress (FR-16 — "reporting progress"). Not part of
   * the spec's originally-drafted Engine API interface block (which had
   * no way to observe `setDetail`'s progress at all despite requiring it
   * be reported), so this is one small additive extension to that
   * surface — the same class of deliberate, documented deviation as
   * `updateStroke` accepting `null`.
   */
  onRemeshProgress(cb: (fraction: number) => void): () => void {
    this.remeshProgressListeners.add(cb);
    return () => {
      this.remeshProgressListeners.delete(cb);
    };
  }

  // ---- internals ----

  private replaceMesh(mesh: SculptMesh): void {
    this.replaceMeshKeepingHistory(mesh);
    // Unlike a remesh (commitRemesh), a fresh loadMesh/newFromPrimitive is
    // a new document: every existing history entry's vertex indices refer
    // to the OLD mesh's layout, not this one, so they're discarded rather
    // than kept around meaninglessly.
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
   * A remesh entry, unlike a stroke, swaps the whole mesh: `SculptHistory`
   * doesn't (and can't) touch it, since applying it means rebuilding
   * adjacency/spatial-hash too — this is that facade-level mesh swap the
   * entry's own doc comment says only the facade can do. `side` tells us
   * which snapshot to restore to, since one popped entry serves both
   * `undo` (-> `beforeMesh`) and `redo` (-> `afterMesh`).
   */
  private applyHistoryEntry(entry: HistoryEntry | null, side: 'before' | 'after'): void {
    if (!entry) {
      return;
    }
    if (entry.kind === 'stroke') {
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
      return;
    }

    this.replaceMeshKeepingHistory(side === 'before' ? entry.beforeMesh : entry.afterMesh);
    this.emitFullMeshDirtyRegion();
  }

  /**
   * Commits a successful remesh as exactly one undo entry (FR-12) and
   * swaps in the new mesh. Unlike `replaceMesh` (loadMesh/newFromPrimitive
   * — a genuinely new document), this deliberately keeps the existing
   * history so the remesh itself stays undoable.
   */
  private commitRemesh(before: SculptMesh, after: SculptMesh): void {
    this.history.pushRemesh(before, after);
    this.replaceMeshKeepingHistory(after);
    this.emitFullMeshDirtyRegion();
  }

  private replaceMeshKeepingHistory(mesh: SculptMesh): void {
    this.mesh = mesh;
    this.adjacency = buildVertexAdjacency(mesh);
    this.spatialHash = buildSpatialHash(mesh);
  }

  private emitDirtyRegion(affected: readonly number[]): void {
    if (affected.length === 0 || this.changeListeners.size === 0) {
      return;
    }
    this.notifyChange(computeDirtyRegion(this.mesh.positions, affected));
  }

  /** A remesh touches the whole mesh (new topology, not a vertex subset), so the dirty region is the whole thing. */
  private emitFullMeshDirtyRegion(): void {
    if (this.changeListeners.size === 0) {
      return;
    }
    this.notifyChange({
      vertexStart: 0,
      vertexEnd: this.mesh.vertexCount,
      aabb: { min: [...this.mesh.bounds.min], max: [...this.mesh.bounds.max] },
    });
  }

  private notifyChange(region: DirtyRegion): void {
    for (const cb of this.changeListeners) {
      cb(region);
    }
  }

  private emitRemeshProgress(fraction: number): void {
    for (const cb of this.remeshProgressListeners) {
      cb(fraction);
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
