import type { SculptMesh } from '../core/mesh/sculpt-mesh';

/**
 * One completed stroke's undo entry (FR-12): only the vertices the
 * stroke actually touched, before and after, not a full mesh snapshot —
 * this is what keeps per-stroke history cheap enough to hold 50+ steps.
 * `before`/`after` are parallel to `indices` (length `indices.length * 3`,
 * xyz per touched vertex, in the same order as `indices`).
 */
export interface StrokeHistoryEntry {
  kind: 'stroke';
  indices: Uint32Array;
  before: Float32Array;
  after: Float32Array;
}

/**
 * One completed remesh's undo entry: full before/after mesh snapshots,
 * since a topology change can't be expressed as a per-vertex delta. Only
 * the type is established here — `SculptHistory` doesn't yet produce or
 * restore these (no `pushRemesh` exists yet); wiring them in is Task 16's
 * job, once `remesh()` exists to produce the `afterMesh`. `undo`/`redo`
 * below already return the raw entry rather than mutating a mesh
 * in-place for this reason: applying a remesh entry means swapping the
 * whole mesh (and rebuilding adjacency/spatial-hash), which only the
 * engine facade that owns those structures can do — this module just
 * needs to store and hand the entry back in order.
 */
export interface RemeshHistoryEntry {
  kind: 'remesh';
  beforeMesh: SculptMesh;
  afterMesh: SculptMesh;
}

export type HistoryEntry = StrokeHistoryEntry | RemeshHistoryEntry;

/** BR-04 / FR-13: never evict below this many retained undo steps, regardless of memory pressure. */
export const MIN_UNDO_STEPS = 50;

/**
 * Default memory budget for the whole history stack, in bytes. Generous
 * for a session-scoped undo stack of small per-stroke deltas; callers
 * (tests, or a future low-memory profile) can pass a smaller budget via
 * the constructor.
 */
const DEFAULT_MAX_HISTORY_BYTES = 256 * 1024 * 1024;

/**
 * Session-scoped, linear undo/redo history (FR-12/13/14). Never
 * persisted — a fresh session starts with a fresh, empty history.
 *
 * Linear history: committing a new stroke discards whatever was ahead in
 * the redo branch (standard undo/redo semantics, spec's edge-case
 * table). Memory-bounded: once the stack's estimated byte size exceeds
 * `maxBytes`, oldest entries are evicted first — except the floor is
 * never breached: the most recent `MIN_UNDO_STEPS` entries are always
 * kept no matter how large they are.
 */
export class SculptHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly maxBytes: number;

  constructor(maxBytes: number = DEFAULT_MAX_HISTORY_BYTES) {
    this.maxBytes = maxBytes;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of entries currently retained in the undo stack. */
  get size(): number {
    return this.undoStack.length;
  }

  /**
   * Commits a completed stroke as exactly one undo entry (FR-12).
   * Discards the redo branch and evicts oldest-first if the history is
   * now over its memory budget (never below `MIN_UNDO_STEPS`).
   *
   * `before`/`after` must each have length `indices.length * 3` — a
   * caller bug otherwise, not user-facing input, so this throws rather
   * than silently truncating.
   */
  pushStroke(indices: Uint32Array, before: Float32Array, after: Float32Array): void {
    const expectedLength = indices.length * 3;
    if (before.length !== expectedLength || after.length !== expectedLength) {
      throw new RangeError(
        `before/after length must equal indices.length * 3 (${expectedLength}), got before=${before.length} after=${after.length}`,
      );
    }

    this.redoStack.length = 0;
    this.undoStack.push({ kind: 'stroke', indices, before, after });
    this.evictOverBudgetEntries();
  }

  /**
   * Commits a completed remesh as exactly one undo entry (FR-12), same
   * redo-truncation and eviction rules as `pushStroke`. Unlike a stroke
   * entry, this module never applies a remesh entry's mesh swap itself —
   * see {@link RemeshHistoryEntry} — the caller does that from the
   * entry `undo`/`redo` hand back.
   */
  pushRemesh(beforeMesh: SculptMesh, afterMesh: SculptMesh): void {
    this.redoStack.length = 0;
    this.undoStack.push({ kind: 'remesh', beforeMesh, afterMesh });
    this.evictOverBudgetEntries();
  }

  /**
   * Undoes the most recent entry. For a stroke entry, restores its
   * touched vertices in `positions` to their bit-identical prior values
   * and returns the entry; a remesh entry is returned without touching
   * `positions` (the caller must apply the mesh swap itself — see
   * {@link RemeshHistoryEntry}). Returns `null` on empty history — a
   * safe no-op.
   */
  undo(positions: Float32Array): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }
    if (entry.kind === 'stroke') {
      restoreStrokeSide(positions, entry, 'before');
    }
    this.redoStack.push(entry);
    return entry;
  }

  /**
   * Reapplies the most recently undone entry. Mirrors `undo`: a stroke
   * entry's touched vertices are restored to their bit-identical "after"
   * values; a remesh entry is handed back for the caller to reapply.
   * Returns `null` with nothing to redo — a safe no-op.
   */
  redo(positions: Float32Array): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }
    if (entry.kind === 'stroke') {
      restoreStrokeSide(positions, entry, 'after');
    }
    this.undoStack.push(entry);
    return entry;
  }

  /**
   * Evicts oldest-first from the undo stack while it's over budget,
   * always stopping at `MIN_UNDO_STEPS` remaining. Among the entries
   * eligible for eviction (everything past the protected most-recent
   * `MIN_UNDO_STEPS` window), a remesh entry is evicted before an
   * equally-old stroke entry, since remesh snapshots are the large ones
   * (spec's edge-case table: "large remesh snapshots evicted first").
   */
  private evictOverBudgetEntries(): void {
    while (
      this.undoStack.length > MIN_UNDO_STEPS &&
      totalBytes(this.undoStack) > this.maxBytes
    ) {
      this.undoStack.splice(indexOfEntryToEvict(this.undoStack), 1);
    }
  }
}

function restoreStrokeSide(
  positions: Float32Array,
  entry: StrokeHistoryEntry,
  side: 'before' | 'after',
): void {
  const source = side === 'before' ? entry.before : entry.after;
  for (let i = 0; i < entry.indices.length; i++) {
    const vertexIndex = entry.indices[i]!;
    positions[vertexIndex * 3] = source[i * 3]!;
    positions[vertexIndex * 3 + 1] = source[i * 3 + 1]!;
    positions[vertexIndex * 3 + 2] = source[i * 3 + 2]!;
  }
}

function entryByteSize(entry: HistoryEntry): number {
  if (entry.kind === 'stroke') {
    return entry.indices.byteLength + entry.before.byteLength + entry.after.byteLength;
  }
  return meshByteSize(entry.beforeMesh) + meshByteSize(entry.afterMesh);
}

function meshByteSize(mesh: SculptMesh): number {
  return mesh.positions.byteLength + mesh.indices.byteLength + mesh.normals.byteLength;
}

function totalBytes(entries: readonly HistoryEntry[]): number {
  let sum = 0;
  for (const entry of entries) {
    sum += entryByteSize(entry);
  }
  return sum;
}

/**
 * Picks which entry to evict from the portion of the undo stack that
 * isn't protected by the `MIN_UNDO_STEPS` floor (index 0 up to, but not
 * including, `length - MIN_UNDO_STEPS`). Prefers the oldest remesh entry
 * in that range; falls back to the oldest entry overall if there is no
 * remesh entry to prefer. Caller guarantees the evictable range is
 * non-empty (`undoStack.length > MIN_UNDO_STEPS`).
 */
function indexOfEntryToEvict(entries: readonly HistoryEntry[]): number {
  const evictableCount = entries.length - MIN_UNDO_STEPS;
  for (let i = 0; i < evictableCount; i++) {
    if (entries[i]!.kind === 'remesh') {
      return i;
    }
  }
  return 0;
}
