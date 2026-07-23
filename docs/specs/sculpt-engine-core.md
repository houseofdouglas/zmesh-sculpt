# Spec: Sculpt Engine Core

**Status**: APPROVED
**Created**: 2026-07-19
**Last Updated**: 2026-07-19
**Related Specs**: none yet (foundational). Downstream specs will depend on this: Viewport & Rendering, Export & Validation, Project Persistence.

---

## Overview

**Summary**: The in-memory 3D sculpting engine — a mesh representation plus the seven brushes, X-mirror symmetry, undo/redo, and detail remeshing — that turns pointer strokes into deformed geometry.

**User Roles**: Hobbyist sculptor (indirectly — this layer has no UI; it's driven by the viewport and UI layers).

**Why**: This is the foundation the entire product stands on. Every other feature — rendering, export, persistence — consumes the mesh and stroke model defined here. It must be correct (geometry stays valid), fast (60 fps sculpting, NFR-01), and framework-free (constitution: `src/core/` is pure), so it can be unit-tested in Node and reused by Web Workers.

**Scope**: `src/core/` (pure geometry + brush kernels + remesh interface + validation) and `src/engine/` (the stroke-driven session: brush state, symmetry, undo history, remesh dispatch). It explicitly does **not** include rendering, raycasting/picking, serialization, or UI — see Out of Scope.

---

## User Stories

- As a **sculptor**, I want to push, pull, smooth, and pinch the surface with distinct brushes, so that I can shape organic forms intuitively.
- As a **sculptor**, I want my strokes mirrored across the model, so that symmetric things (faces, figures) come out symmetric for free.
- As a **sculptor**, I want to undo any number of recent actions exactly, so that mistakes are never costly.
- As a **sculptor**, I want to raise detail when I need finer features, so that I can add detail without the whole model being heavy from the start.
- As a **downstream layer** (viewport/export), I want a clean, well-typed mesh and change notifications, so that I can render or serialize without reaching into engine internals.

---

## Functional Requirements

**Mesh**
1. The engine shall represent a sculpt mesh as flat typed arrays: vertex positions (`Float32Array`, xyz), triangle indices (`Uint32Array`, 3 per face), and per-vertex normals (`Float32Array`, xyz), in millimeter units (1 unit = 1 mm, BR-01), centered at the origin.
2. The engine shall provide primitive generators for the v1 base shapes (sphere required; egg, block, capsule for FR-22) as valid, watertight, closed meshes.
3. The engine shall maintain vertex adjacency (one-ring neighbors) and a spatial acceleration structure for radius queries, rebuilt on any topology change (load/remesh).
4. The engine shall recompute vertex normals for the affected region after every deformation.

**Brushes & strokes**
5. The engine shall support seven brushes with the precise kernels defined in [Brush Specifications](#brush-specifications): Draw, Smooth, Inflate, Grab, Pinch, Crease, Flatten.
6. The user (via upstream layers) can set the active brush, brush size (in mm), and strength (0–1), and toggle invert.
7. A stroke shall be applied as a sequence of overlapping stamps spaced proportionally to brush size, so stroke speed does not change the result density.
8. Deformation shall be confined to vertices within the brush radius, weighted by a smooth falloff (1 at center → 0 at the radius edge).
9. Topology is fixed during sculpting — brushes only move existing vertices; topology changes only via remesh (FR-8 / detail).

**Symmetry**
10. The engine shall support X-axis mirror symmetry, ON by default (FR-06): each stamp is additionally applied mirrored across the x=0 plane to the geometrically mirrored vertices.
11. Symmetry can be toggled off; toggling affects only subsequent strokes.

**Undo/redo**
12. Each completed stroke and each remesh shall be exactly one undo entry.
13. The engine shall undo/redo at least 50 steps (FR-07, BR-04); history is session-scoped, memory-bounded, evicts oldest-first, and is never persisted.
14. Undo/redo shall restore mesh state exactly (bit-identical vertex positions for stroke entries).

**Detail / remesh**
15. The engine shall expose a detail control with discrete levels (Low / Med / High / Max) that voxel-remeshes the mesh to a target resolution while preserving overall shape (FR-08).
16. Remeshing shall run off the main thread (Web Worker) and complete within 3 s at Max on baseline hardware (NFR-03), reporting progress and remaining cancellable/undoable.
17. Remeshing shall be performed via a narrow in-house interface (`remesh(mesh, target)`), behind which a library implementation is permitted (per ADR 2026-07-19).
18. The Max level shall be clamped to the triangle budget determined by the Q-01 benchmark (BR-03); it is not user-overridable.

**Change notification**
19. The engine shall emit change notifications describing the dirty region (affected vertex range/AABB) so downstream layers can update incrementally without a full rescan.

---

## Architecture & Module Layout

```
src/core/                        (pure, framework-free, Node-testable)
  mesh/sculpt-mesh.ts            SculptMesh type + construction, normals, AABB
  mesh/adjacency.ts              one-ring neighbors
  mesh/spatial-hash.ts           uniform-grid radius queries
  mesh/primitives.ts             sphere, egg, block, capsule generators
  brushes/falloff.ts             falloff curves
  brushes/*.ts                   one file per brush kernel (pure functions)
  brushes/index.ts               brush registry
  remesh/remesh.ts               remesh(mesh, target) interface + adapter
  validate/manifold.ts           manifold/watertight checks (shared with export)
src/engine/                      (session state, no React, no Three.js)
  sculpt-engine.ts               SculptEngine: stroke lifecycle, brush state, symmetry
  stroke.ts                      stamp generation from pointer samples
  history.ts                     undo/redo stack (delta + snapshot entries)
  detail.ts                      detail levels <-> remesh targets; worker dispatch
```

Brush kernels in `src/core/brushes/` are **pure functions** — `(positions, normals, neighbors, stamp) -> mutated positions for affected indices` — with no engine or DOM state, so each is independently unit-testable.

---

## Data Model

### `SculptMesh` (core type)

| Field | Type | Notes |
|---|---|---|
| `positions` | `Float32Array` | length `3 * vertexCount`, mm, origin-centered |
| `indices` | `Uint32Array` | length `3 * triangleCount`, CCW winding (outward normals) |
| `normals` | `Float32Array` | length `3 * vertexCount`, unit vectors |
| `vertexCount` | `number` | |
| `triangleCount` | `number` | |
| `bounds` | `{ min:[x,y,z], max:[x,y,z] }` | AABB in mm, kept current |

Derived/auxiliary (not serialized): `adjacency` (one-ring, CSR-style offset+index arrays) and `spatialHash` (uniform grid). Rebuilt on topology change.

### `Stamp` (engine -> core)

| Field | Type | Notes |
|---|---|---|
| `center` | `[x,y,z]` | surface hit point, mm |
| `normal` | `[x,y,z]` | interpolated surface normal at hit |
| `radius` | `number` | mm (= brush size) |
| `strength` | `number` | 0–1, sign flipped when inverted |
| `dragDelta` | `[x,y,z] \| null` | world-space cursor motion (Grab only) |

### `HistoryEntry` (engine)

- **Stroke entry**: `{ kind:'stroke', indices:Uint32Array, before:Float32Array, after:Float32Array }` — stores only the vertices the stroke touched (bounded memory).
- **Remesh entry**: `{ kind:'remesh', beforeMesh:SculptMesh, afterMesh:SculptMesh }` — full snapshots, since topology changes can't be deltaed. Snapshots may be compressed; remesh entries count toward the memory bound and can be evicted first when large.

### `DetailLevel`

`'low' | 'med' | 'high' | 'max'` -> provisional target triangle counts **~20k / ~80k / ~200k / (Max = TBD by Q-01)**. Placeholder Max ~= 500k pending the benchmark.

---

## Engine API / Interfaces

Replaces the template's HTTP contract — this is the imperative TypeScript API the viewport and UI layers consume.

```typescript
type BrushType = 'draw' | 'smooth' | 'inflate' | 'grab' | 'pinch' | 'crease' | 'flatten';
type SymmetryAxis = 'none' | 'x';

interface SurfaceHit {          // supplied by the viewport's raycaster
  point: [number, number, number];
  normal: [number, number, number];
  worldDelta?: [number, number, number]; // frame-to-frame cursor motion (Grab)
}

interface DirtyRegion { vertexStart: number; vertexEnd: number; aabb: { min: number[]; max: number[] }; }

interface SculptEngine {
  // mesh lifecycle
  loadMesh(mesh: SculptMesh): void;
  newFromPrimitive(shape: 'sphere' | 'egg' | 'block' | 'capsule'): void;
  getMesh(): Readonly<SculptMesh>;

  // brush config
  setBrush(type: BrushType): void;
  setBrushSize(mm: number): void;         // clamped to [min, mesh-relative max]
  setBrushStrength(value: number): void;  // clamped 0–1
  setInvert(invert: boolean): void;
  setSymmetry(axis: SymmetryAxis): void;

  // stroke lifecycle (driven by pointer events upstream)
  beginStroke(hit: SurfaceHit): void;
  updateStroke(hit: SurfaceHit): void;    // engine generates stamps between samples
  endStroke(): void;                       // commits one history entry

  // history
  undo(): void;
  redo(): void;
  get canUndo(): boolean;
  get canRedo(): boolean;

  // detail
  getDetail(): DetailLevel;
  setDetail(level: DetailLevel): Promise<void>; // async remesh; resolves when applied
  getMaxDetail(): DetailLevel;                  // reflects Q-01 clamp

  // change notification
  onChange(cb: (region: DirtyRegion) => void): () => void; // returns unsubscribe
}
```

```typescript
// core remesh seam (library allowed behind this)
function remesh(
  mesh: SculptMesh,
  targetTriangleCount: number,
  onProgress?: (fraction: number) => void
): Promise<SculptMesh>; // output guaranteed manifold + watertight
```

---

## Brush Specifications

All brushes weight displacement by falloff `w = smoothstep(1 - d/radius)` where `d` = distance from stamp center; effective step = `strength * w * k` (`k` = per-brush scale tuned to feel). Invert flips sign where meaningful.

| Brush | Kernel | Invert |
|---|---|---|
| **Draw** | Displace affected vertices along the **stamp's surface normal** by `w*strength`. Adds a rounded bump. | Subtracts (indents) |
| **Smooth** | Move each vertex toward the average position of its one-ring neighbors (Laplacian); `strength` is the blend factor. Reduces local curvature. | **No-op in v1** (sharpen deferred — see Resolved Questions) |
| **Inflate** | Displace each vertex along **its own vertex normal** (not the stamp normal) by `w*strength`. Puffs the region outward evenly. | Deflates |
| **Grab** | On `beginStroke`, fix the affected vertex set; translate them by `dragDelta*w` each frame until `endStroke`. Pulls a soft region with the cursor. | n/a (direction is the drag) |
| **Pinch** | Move affected vertices toward the stamp center within the tangent plane by `w*strength`. Tightens into ridges. | Pushes apart (spreads) |
| **Crease** | Pinch toward center **and** displace inward along the stamp normal (negative Draw), combined. Cuts sharp valleys. | Raised sharp ridge (outward) |
| **Flatten** | Compute the area's average plane (centroid + averaged normal of affected vertices); move affected vertices toward that plane by `w*strength`. Planarizes. | Pull away from plane (emboss) |

Common rules: no vertex may move more than a safety cap per stamp (prevents self-intersection blow-ups from fast strokes); after each stamp, affected-vertex normals are recomputed; the same stamp is applied to mirrored vertices when symmetry is on.

---

## Error States & Edge Cases

| Scenario | What Happens |
|---|---|
| Stroke starts off the mesh (no surface hit) | No stamp generated; stroke is a no-op (upstream passes no hit). |
| Brush radius larger than the whole mesh | All vertices affected; falloff still applied from center; no error. |
| Very fast stroke (sparse pointer samples) | Stamp interpolation fills the gap by size-based spacing (FR-07), so result is speed-independent. |
| Degenerate stamp (zero radius/strength) | No-op; no history entry committed. |
| Undo with empty history / redo with nothing ahead | No-op; `canUndo`/`canRedo` report `false`. |
| New stroke after undo | Truncates the redo branch (standard linear history). |
| Remesh fails or exceeds time budget | Mesh unchanged; `setDetail` rejects; upstream shows Flow 3 fallback message; no partial mesh applied. |
| Remesh output fails manifold check | Treated as failure (reject) — never surface a non-watertight mesh (invariant). |
| Detail raised beyond Max | Clamped to Max; `setDetail('max')` is the ceiling (BR-03). |
| Memory pressure (history exceeds bound) | Evict oldest entries, but never below 50 stroke steps; large remesh snapshots evicted first. |
| Empty/zero-vertex mesh loaded | Rejected at `loadMesh` with a validation error (guards downstream). |

---

## Acceptance Criteria

### Happy path
- [ ] `newFromPrimitive('sphere')` yields a closed, manifold, watertight mesh centered at origin with correct outward normals.
- [ ] A Draw stroke on a sphere raises the struck region outward along the normal; vertices outside the brush radius are bit-identical to before.
- [ ] Each of the seven brushes produces its specified deformation (verified by a per-brush geometric assertion — e.g., Smooth strictly reduces mean local curvature in the affected region; Flatten reduces the affected vertices' distance-variance to their average plane; Inflate increases enclosed volume; Pinch reduces mean distance-to-center in-plane).
- [ ] A stroke dragged fast vs. slow over the same path produces near-identical results (stamp spacing is size-based, not time-based).

### Symmetry
- [ ] With X-symmetry on, a stroke on +X produces a mirror-equal displacement on −X (vertex displacements equal within float tolerance after mirroring).
- [ ] Toggling symmetry off mid-session affects only subsequent strokes.

### Undo/redo
- [ ] After a stroke, `undo()` restores every affected vertex to bit-identical prior positions; `redo()` reapplies identically.
- [ ] At least 50 sequential strokes can each be undone in order.
- [ ] A remesh can be undone, restoring the exact prior topology and positions.
- [ ] Starting a new stroke after undo discards the redo branch.

### Detail / remesh
- [ ] `setDetail` raises/lowers triangle count toward the level's target while preserving silhouette (Hausdorff distance to pre-remesh surface below a defined threshold).
- [ ] Every remesh output passes the manifold + watertight validator.
- [ ] Remesh runs in a Web Worker (main thread stays responsive) and reports progress.
- [ ] `getMaxDetail()` reflects the Q-01-derived clamp; requesting beyond it clamps.

### Performance (NFR-01/02)
- [ ] Applying a continuous stroke at the **default (Med)** level sustains ≥60 fps on the baseline (M1) — measured by the Q-01 harness.
- [ ] Applying a continuous stroke at **Max** sustains ≥30 fps on the baseline.
- [ ] Single-stamp application latency (query -> deform -> normals -> dirty-region emit) is ≤16 ms at Med.

### Edge cases
- [ ] Off-mesh stroke, zero-radius stamp, and empty-history undo are all safe no-ops.
- [ ] Loading a zero-vertex mesh is rejected with a validation error.
- [ ] A failed remesh leaves the mesh and history untouched.

---

## Non-Functional Requirements

- **Performance**: ≥60 fps at Med, ≥30 fps at Max on M1 baseline (NFR-01); ≤16 ms stamp latency; remesh ≤3 s at Max off-thread (NFR-03).
- **Purity/testability**: `src/core/` imports no DOM, Three.js, or React; runs headless in Vitest with typed-array fixtures. 80% line coverage on core (constitution).
- **Memory**: history bounded; hot brush loops avoid per-stamp allocation (reuse scratch buffers).
- **Correctness invariant**: the engine never produces or exposes a non-manifold/non-watertight mesh through a remesh boundary.

---

## Q-01 Benchmark Spike (first task in this spec)

A dedicated, throwaway-friendly harness that:
1. Generates spheres at increasing triangle counts (e.g., 20k -> 1M).
2. Programmatically applies a scripted Draw+Grab stroke sequence per size, measuring sustained frame time (stamp + normal recompute + dirty-emit; rendering measured separately in the viewport spec).
3. On the M1 baseline, reports the largest triangle count that holds ≥60 fps end-to-end.

**Output**: the concrete triangle budget -> sets the `Max` `DetailLevel` target and `getMaxDetail()` clamp (resolves BR-03 / requirements Q-01). Until it runs, the provisional Max ~= 500k is a placeholder and must not be treated as final.

---

## Out of Scope

This spec intentionally does **not** cover:
- Rendering, materials, lighting, camera — Viewport spec.
- Raycasting/picking — the viewport supplies `SurfaceHit`; the engine consumes it.
- The camera-vs-brush input model — settled in the wireframe, implemented in the Viewport/UI spec; the engine only sees resolved hits and drag deltas.
- STL/3MF serialization and the export validation UX — Export spec (reuses `validate/manifold.ts`).
- `.zmesh` persistence, autosave, thumbnails — Persistence spec.
- Mesh import / photogrammetry — phase 2/3.
- The specific remesh library selection — an implementation task behind the `remesh()` seam (per ADR). Approach: adopt a best-fit library first; write an in-house remesher only if it fails a functional or non-functional requirement.

---

## Resolved Questions

| Question | Resolution |
|---|---|
| Should **Smooth invert** sharpen or be a no-op? | **No-op in v1.** Sharpen (amplify deviation from neighbor average) is a reasonable future addition but needs feel-tuning; deferred. |
| Build the remesher or use a library? | **Best-shot library first** (behind the `remesh()` seam); revisit with an in-house implementation only if the library fails an FR/NFR. Candidates tracked in ADR 2026-07-19. |

## Open Questions

| Question | Owner | Resolution |
|---|---|---|
| Q-01: triangle budget for ≥60 fps at Med on M1? | Benchmark spike (first task) | Sets Max detail; provisional 500k until measured |
| Which specific remesh library behind `remesh()`? | Impl task (library scan) | Vetted for manifold output, bundle size, license (ADR candidates) |
| Exact per-brush strength scale `k` values | Tuning during implementation | Feel-based; defaults set, refined interactively |
