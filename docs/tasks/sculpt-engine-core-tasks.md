# Task Plan: sculpt-engine-core

**Spec**: docs/specs/sculpt-engine-core.md
**Status**: APPROVED
**Created**: 2026-07-19
**Total**: 16 tasks, ~37 hours

Layers per constitution: `types → core → engine`. No Infra/API/UI tasks here — those belong to downstream specs (Viewport, Export, Persistence).

---

## Task: 01 — Project scaffold (Vite + React + TS strict + Vitest)

**Layer**: Config · **Estimate**: 1hr · **Depends on**: none · **Status**: DONE
**Completed**: 2026-07-23

### What to build
Initialize the actual Vite + React 19 + TypeScript project over the existing stub `package.json`/`tsconfig.json`. Wire up ESLint (typescript-eslint), Prettier, and Vitest with `test`/`typecheck`/`lint` scripts matching the constitution. Add a minimal app entry so `npm run dev` boots (blank canvas placeholder is fine). Establish `src/core`, `src/engine`, `src/types` folders.

### Acceptance criteria
- [ ] `npm install && npm run dev` serves a blank app; `npm run typecheck`, `lint`, `test` all pass on an empty suite
- [ ] Vitest runs in a Node environment for `src/core` (no DOM required)
- [ ] ESLint enforces no-`any`, explicit return types on exports

### Files expected
- `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `index.html`, `src/main.tsx`, layer folders

---

## Task: 02 — `SculptMesh` type + construction + normals + AABB

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 01 · **Status**: DONE
**Completed**: 2026-07-23

### What to build
The `SculptMesh` typed-array structure (`positions`/`indices`/`normals`, counts, `bounds`) with a constructor that validates array lengths, computes per-vertex normals from face normals, and computes the AABB. Pure, framework-free.

### Acceptance criteria
- [ ] Constructing from valid arrays yields correct `vertexCount`/`triangleCount`/`bounds`
- [ ] Normals are unit-length and point outward on a known convex fixture
- [ ] Zero-vertex / mismatched-length arrays throw a validation error
- [ ] No DOM/Three/React imports

### Files expected
- `src/core/mesh/sculpt-mesh.ts`, `src/core/mesh/sculpt-mesh.test.ts`

---

## Task: 03 — Primitive generators (sphere first; egg, block, capsule)

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 02 · **Status**: DONE
**Completed**: 2026-07-23

### What to build
Generators producing closed, manifold, watertight `SculptMesh` primitives centered at origin in mm. Sphere required (first-run default); egg/block/capsule for FR-22. Reasonable default resolution (~Med).

### Acceptance criteria
- [ ] `sphere()` is watertight (every edge shared by exactly 2 triangles), origin-centered, outward normals
- [ ] Each shape returns the requested approximate diameter/extent in mm
- [ ] Triangle count within the target band for the default detail level

### Files expected
- `src/core/mesh/primitives.ts`, `src/core/mesh/primitives.test.ts`

---

## Task: 04 — Manifold / watertight validator

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 02 · **Status**: DONE
**Completed**: 2026-07-23

### What to build
`validate/manifold.ts` — checks a mesh is manifold (each edge shared by exactly two triangles, consistent winding) and watertight (no boundary edges). Returns a structured result (ok + list of defects). Reused later by export and remesh boundaries.

### Acceptance criteria
- [ ] Passes on all primitives from Task 03
- [ ] Detects a deliberately introduced hole / non-manifold edge in a fixture
- [ ] Pure and fast enough to run on every remesh output

### Files expected
- `src/core/validate/manifold.ts`, `src/core/validate/manifold.test.ts`

---

## Task: 05 — `manifold-3d` LevelSet round-trip spike (library de-risk)

**Layer**: Core/Spike · **Estimate**: 2hr · **Depends on**: 03, 04 · **Status**: DONE
**Completed**: 2026-07-23
**Note**: spike found `levelSet` is the wrong API for this use case; `ofMesh`/`refineToLength`/`simplify`/`getMesh` is the correct fit and is what was actually proven. See the ADR (`docs/adr/2026-07-19-voxel-remesh-library.md`) for the full writeup.

### What to build
Install `manifold-3d` and prove the remesh primitive works before committing to it. Convert a `SculptMesh` sphere → an SDF/level-set input → run manifold's `LevelSet` at a target resolution → convert back to `SculptMesh`. Validate the result with Task 04. Measure WASM init time and bundle footprint. Capture findings; if it fails (non-manifold output, unacceptable size, awkward API), flag to revisit the library choice (ADR) before Task 16.

### Acceptance criteria
- [ ] A sphere round-tripped through `manifold-3d` LevelSet passes the Task 04 validator (manifold + watertight)
- [ ] Silhouette roughly preserved (visual/Hausdorff sanity check)
- [ ] WASM init + bundle size recorded; go/no-go note added to the ADR
- [ ] Conversion helpers (`SculptMesh` ↔ manifold mesh) drafted for reuse in Task 16

### Files expected
- `src/core/remesh/manifold-adapter.ts` (draft), `src/core/remesh/__spike__/levelset-roundtrip.test.ts`, ADR note

---

## Task: 06 — One-ring adjacency (CSR)

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 02 · **Status**: PENDING

### What to build
Build per-vertex one-ring neighbor lists in CSR form (offset + flat index arrays) from `indices`. Needed by Smooth and by normal recomputation.

### Acceptance criteria
- [ ] Neighbor sets correct on a hand-checked fixture (e.g., octahedron)
- [ ] Symmetric: if b ∈ neighbors(a) then a ∈ neighbors(b)
- [ ] Builds in O(triangles); no per-vertex allocation in the hot path

### Files expected
- `src/core/mesh/adjacency.ts`, `src/core/mesh/adjacency.test.ts`

---

## Task: 07 — Spatial hash for radius queries

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 02 · **Status**: PENDING

### What to build
Uniform-grid spatial hash over vertex positions supporting "all vertices within radius r of point p". Rebuildable on topology change; refreshable after strokes. The query every stamping brush uses.

### Acceptance criteria
- [ ] Radius query returns exactly the vertices within r (validated against brute force on fixtures)
- [ ] Query cost sublinear vs. brute force on a 100k-vertex sphere
- [ ] Cell size derived sensibly from mesh scale / typical brush radius

### Files expected
- `src/core/mesh/spatial-hash.ts`, `src/core/mesh/spatial-hash.test.ts`

---

## Task: 08 — Falloff + Draw brush kernel (the template brush)

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 06, 07 · **Status**: PENDING

### What to build
`brushes/falloff.ts` (smoothstep) and the first brush, `brushes/draw.ts`, as a pure function `(positions, normals, affectedIndices, stamp) → mutates positions`. Establishes the brush-kernel signature all others follow. Includes the per-stamp safety cap and the affected-region normal-recompute helper.

### Acceptance criteria
- [ ] Draw raises vertices within radius along the stamp normal, weighted by falloff; edge vertices move ~0
- [ ] Vertices outside radius are bit-identical
- [ ] Invert subtracts (indents)
- [ ] Per-stamp displacement never exceeds the safety cap

### Files expected
- `src/core/brushes/falloff.ts`, `src/core/brushes/draw.ts`, `+ tests`

---

## Task: 09 — Q-01 benchmark spike (triangle budget → Max detail)

**Layer**: Test/Spike · **Estimate**: 3hr · **Depends on**: 03, 07, 08 · **Status**: PENDING

### What to build
The scripted benchmark harness from the spec: generate spheres from ~20k→1M triangles, apply a scripted Draw stroke sequence at each size, measure sustained per-stamp frame time (query + deform + normals + dirty-emit; rendering measured separately in the viewport spec), and report the largest triangle count holding ≥60 fps on the M1 baseline.

### Acceptance criteria
- [ ] Produces a table of triangle-count vs. sustained frame time on the baseline machine
- [ ] Recommends a concrete Max triangle budget (resolves requirements Q-01)
- [ ] Findings recorded; provisional 500k replaced with the measured value

### Files expected
- `src/core/__bench__/sculpt-bench.ts`, a short results note in `docs/design/`

---

## Task: 10 — Brushes part 1: Smooth + Inflate

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 08 · **Status**: PENDING

### What to build
Two behaviors following the Task 08 template: Smooth (Laplacian toward one-ring average; invert = **no-op** per spec) and Inflate (displace along each vertex's own normal).

### Acceptance criteria
- [ ] Smooth strictly reduces mean local curvature in the affected region; Smooth-invert is a no-op
- [ ] Inflate increases enclosed volume; deflate (invert) decreases it
- [ ] Both pure and allocation-free in the hot loop

### Files expected
- `src/core/brushes/smooth.ts`, `src/core/brushes/inflate.ts`, `+ tests`

---

## Task: 11 — Brushes part 2: Pinch + Crease + Flatten + registry

**Layer**: Core · **Estimate**: 2hr · **Depends on**: 08 · **Status**: PENDING

### What to build
The tangent-plane / planar behaviors: Pinch (toward center in tangent plane), Crease (pinch + inward normal), Flatten (toward the affected region's averaged plane). Assemble the stamp-brush registry (`brushes/index.ts`) covering all six stamp brushes (Grab is stroke-stateful, handled in Task 12).

### Acceptance criteria
- [ ] Flatten reduces affected vertices' distance-variance to their average plane
- [ ] Pinch reduces mean in-plane distance-to-center; Crease forms a sharp valley (raised ridge on invert)
- [ ] Registry resolves every `BrushType` (except grab) to its kernel

### Files expected
- `src/core/brushes/{pinch,crease,flatten}.ts`, `src/core/brushes/index.ts`, `+ tests`

---

## Task: 12 — Stroke stamping + Grab

**Layer**: Engine · **Estimate**: 3hr · **Depends on**: 08 · **Status**: PENDING

### What to build
`engine/stroke.ts`: convert a sequence of pointer `SurfaceHit`s into size-spaced stamps (speed-independent, FR-7), interpolating between sparse samples. Implement Grab here as the stroke-stateful brush: fix the affected set on `beginStroke`, translate by `worldDelta·falloff` each update until `endStroke`.

### Acceptance criteria
- [ ] Fast vs. slow stroke over the same path yields near-identical stamp coverage
- [ ] Grab moves the fixed vertex set with the cursor; releasing ends the operation
- [ ] Off-mesh update (no hit) is a safe no-op

### Files expected
- `src/engine/stroke.ts`, `src/engine/stroke.test.ts`

---

## Task: 13 — X-mirror symmetry

**Layer**: Engine · **Estimate**: 2hr · **Depends on**: 12 · **Status**: PENDING

### What to build
Apply each stamp additionally mirrored across x=0 to the geometrically mirrored vertices. Establish (once per topology) a mirror-vertex mapping or a mirror-the-stamp-and-requery strategy. Default ON.

### Acceptance criteria
- [ ] A +X stroke yields mirror-equal displacement on −X within float tolerance
- [ ] Toggling off affects only subsequent strokes
- [ ] Works for all stamp brushes and Grab

### Files expected
- `src/engine/symmetry.ts`, `+ tests`

---

## Task: 14 — Undo/redo history (delta + snapshot)

**Layer**: Engine · **Estimate**: 3hr · **Depends on**: 12 · **Status**: PENDING

### What to build
`engine/history.ts`: per-stroke entries store touched-vertex indices + before/after buffers; commit one entry per `endStroke`. Linear history (new stroke truncates redo), memory-bounded with oldest-first eviction never below 50 steps. (Remesh snapshot entries wired in Task 16.)

### Acceptance criteria
- [ ] Undo restores bit-identical prior positions; redo reapplies identically
- [ ] ≥50 sequential strokes each undoable in order
- [ ] New stroke after undo discards redo branch
- [ ] Empty-history undo / no-redo are safe no-ops

### Files expected
- `src/engine/history.ts`, `src/engine/history.test.ts`

---

## Task: 15 — `SculptEngine` facade + change notification

**Layer**: Engine · **Estimate**: 3hr · **Depends on**: 10, 11, 13, 14 · **Status**: PENDING

### What to build
The `SculptEngine` class implementing the spec's API: mesh lifecycle, brush config (type/size/strength/invert/symmetry), stroke lifecycle wiring stamps→brushes→normals→history, and `onChange(region)` dirty-region emission. The single object downstream layers talk to.

### Acceptance criteria
- [ ] Full public API from the spec present and typed; no `any`
- [ ] `onChange` fires with a correct `DirtyRegion` after each stamp/stroke
- [ ] End-to-end via the facade: load sphere → configure brush → begin/update/end stroke → undo
- [ ] Engine holds mesh state outside React (no React import)

### Files expected
- `src/engine/sculpt-engine.ts`, `src/engine/sculpt-engine.test.ts`

---

## Task: 16 — Remesh integration (`manifold-3d`) + detail levels + worker

**Layer**: Core/Engine · **Estimate**: 4hr · **Depends on**: 04, 05, 15 · **Status**: PENDING

### What to build
Promote the Task 05 spike into `core/remesh/remesh.ts` behind the `remesh()` seam, validated with Task 04's checker. `engine/detail.ts` maps `DetailLevel`→target triangle count and dispatches remesh to a Web Worker with progress; commit a remesh history snapshot entry (undoable). Reject-and-restore on failure or non-manifold output.

### Acceptance criteria
- [ ] `setDetail` up/down produces a validated manifold+watertight mesh preserving silhouette (Hausdorff below threshold)
- [ ] Runs in a Web Worker; main thread stays responsive; progress reported
- [ ] Failed/non-manifold remesh leaves mesh + history untouched; `setDetail` rejects
- [ ] Remesh is one undo entry; `getMaxDetail()` reflects the Q-01 clamp

### Files expected
- `src/core/remesh/remesh.ts`, `src/engine/detail.ts`, a worker module, `+ tests`
