# Acceptance Report: sculpt-engine-core

Date: 2026-07-23
Result: **PARTIAL** (2026-07-23) → **PASS** (all 4 gaps closed 2026-07-24 — see Addendum)

## Summary

23 criteria checked (20 acceptance-criteria checkboxes + 3 relevant NFRs). As of 2026-07-23: **19 passing, 4 partial, 0 failing.** All gaps were performance/verification gaps, not functional ones — every functional behavior the spec asks for is implemented and covered by a passing test. The gaps were: three performance criteria measured against a pre-facade benchmark rather than the current, real engine configuration; the Web Worker dispatch path (correctly, honestly undocumented as untestable in this project's Node-based test environment) not yet verified in a browser; and no line-coverage tooling configured to confirm the constitution's 80%-on-core target numerically.

**All four have since been closed (2026-07-24) — see the Addendum at the bottom.** The original per-criterion detail below is preserved as the point-in-time 2026-07-23 record; the ⚠️ PARTIAL entries are superseded by the Addendum.

## Criteria Results

### Happy path

#### ✅ PASS — `newFromPrimitive('sphere')` yields a closed, manifold, watertight mesh centered at origin with correct outward normals
Evidence: `src/core/mesh/primitives.test.ts` ("sphere > is watertight and consistently oriented", "has outward-pointing normals", "spans the requested diameter... centered at the origin").

#### ✅ PASS — A Draw stroke raises the struck region outward along the normal; vertices outside the brush radius are bit-identical
Evidence: `src/core/brushes/draw.test.ts` ("raises vertices along the stamp normal, weighted by falloff", "leaves vertices at or beyond the radius bit-identical").

#### ✅ PASS — Each of the seven brushes produces its specified deformation
Evidence: `smooth.test.ts` (curvature-reduction proxy), `inflate.test.ts` (signed-volume proxy), `pinch.test.ts` (tangential-distance reduction), `crease.test.ts` (inward displacement + tangential pull), `flatten.test.ts` (plane-distance-variance reduction), `draw.test.ts` (normal displacement), and Grab via `stroke.test.ts` ("translates the affected set with the cursor, weighted by falloff").

#### ✅ PASS — A stroke dragged fast vs. slow over the same path produces near-identical results
Evidence: `src/engine/stroke.test.ts` ("spaces stamps by distance travelled, so fast and slow strokes match").

### Symmetry

#### ✅ PASS — With X-symmetry on, a stroke on +X produces a mirror-equal displacement on −X
Evidence: `src/engine/symmetry.test.ts` ("produces mirror-equal displacement on -X for a +X stroke") and `src/engine/sculpt-engine.test.ts` ("mirrors a stroke across x=0 by default (FR-10)").

#### ✅ PASS — Toggling symmetry off mid-session affects only subsequent strokes
Evidence: `src/engine/sculpt-engine.test.ts` ("toggling symmetry off affects only the next stroke, not one already committed").

### Undo/redo

#### ✅ PASS — After a stroke, `undo()` restores every affected vertex to bit-identical prior positions; `redo()` reapplies identically
Evidence: `src/engine/history.test.ts` ("undo restores bit-identical prior positions; redo reapplies identically") plus the end-to-end path in `sculpt-engine.test.ts`.

#### ✅ PASS — At least 50 sequential strokes can each be undone in order
Evidence: `src/engine/history.test.ts` ("undoes at least 50 sequential strokes in order").

#### ✅ PASS — A remesh can be undone, restoring the exact prior topology and positions
Evidence: `src/engine/sculpt-engine.test.ts` ("undo/redo of a remesh restores the exact prior/new topology").

#### ✅ PASS — Starting a new stroke after undo discards the redo branch
Evidence: `src/engine/history.test.ts` ("discards the redo branch when a new stroke is committed after undo") and the same behavior at the facade level in `sculpt-engine.test.ts`.

### Detail / remesh

#### ⚠️ PARTIAL — `setDetail` raises/lowers triangle count toward the level's target while preserving silhouette (Hausdorff distance below a defined threshold)
Evidence: `src/core/remesh/remesh.test.ts` confirms triangle count moves in the right direction and a bounding-box proxy for silhouette (`toBeCloseTo(-25, 0)`/`toBeCloseTo(25, 0)`).
Gap: no Hausdorff distance is actually computed, and no threshold is defined anywhere in code or docs — the spec's literal wording ("Hausdorff distance... below a defined threshold") isn't satisfied verbatim. The bounding-box check is a reasonable proxy but a much looser one (it can't catch, e.g., a bulge or dent that stays within the overall bounds).
Suggestion: either compute an actual Hausdorff (or simpler symmetric nearest-point) distance between pre/post-remesh surfaces in the test, or update the spec's wording to describe the bounding-box proxy actually used, if that's judged sufficient for this product.

#### ✅ PASS — Every remesh output passes the manifold + watertight validator
Evidence: `src/core/remesh/remesh.ts` runs `checkManifold` on every result and throws `RemeshValidationError` rather than returning a bad mesh; `remesh.test.ts` exercises both a real pass and a forced-failure path via a mocked validator.

#### ⚠️ PARTIAL — Remesh runs in a Web Worker (main thread stays responsive) and reports progress
Evidence: progress reporting is fully tested (`remesh.test.ts` — "reports progress from 0 to 1", monotonically increasing). The Worker dispatch itself (`src/engine/detail.ts` `createWorkerRemeshRunner`, `src/engine/remesh.worker.ts`) is implemented and its own doc comments are explicit that it is **not** exercised by any automated test, because `Worker` doesn't exist in this project's plain-Node Vitest environment — `SculptEngine`'s injectable `RemeshRunner` exists specifically so everything around the dispatch is unit-tested against a fake runner instead.
Gap: "main thread stays responsive" has not been verified interactively in a browser either — no browser session has loaded this code yet in this project.
Suggestion: verify once a viewport/dev-server exists to load this in a real browser (per the constitution's Definition of Done: "Verified interactively in the browser").

#### ✅ PASS — `getMaxDetail()` reflects the Q-01-derived clamp; requesting beyond it clamps
Evidence: `sculpt-engine.test.ts` ("exposes typed detail getters — getMaxDetail reflects the Q-01 clamp") confirms `getMaxDetail() === 'max'` (500,000, per `DETAIL_TARGET_TRIANGLE_COUNTS`). "Requesting beyond it clamps" is satisfied structurally rather than by a runtime clamp: `DetailLevel` is a closed `'low'|'med'|'high'|'max'` union, so there is no way to construct a request beyond `'max'` through the typed API in the first place — nothing to clamp at runtime.

### Performance (NFR-01/02)

#### ⚠️ PARTIAL — Applying a continuous stroke at the default (Med) level sustains ≥60 fps on the baseline (M1)
Evidence: `docs/design/q01-triangle-budget-findings.md` — ≥60fps measured up to ~199k triangles, comfortably above Med's 80k target (interpolating between the 50k/1.7ms and 100k/3.8ms measurements gives roughly ~3ms at 80k, well under the 16.7ms/60fps budget).
Gap: the Q-01 benchmark (`src/core/__bench__/sculpt-bench.ts`) calls `queryRadius`/`applyDraw`/`recomputeAffectedRegionNormals`/`updateVertexPosition` directly — it predates `SculptEngine`, and critically predates X-mirror symmetry being ON by default (FR-10), which doubles the per-pointer-sample stamp count (a real stroke plus its mirror) in normal usage. The measured numbers are for the *un-mirrored* pipeline; the real default-configuration cost is not separately measured. Given the ~5x margin at Med's target, doubling the cost would still very likely clear 60fps, but this is inference, not measurement.
Suggestion: re-run (or add a variant of) the Q-01 benchmark through the actual `SculptEngine` facade with default symmetry on, to get a real number for the as-shipped configuration.

#### ⚠️ PARTIAL — Applying a continuous stroke at Max sustains ≥30 fps on the baseline
Same evidence and same gap as above — ≥30fps measured to ~499k triangles (matching Max's 500k target almost exactly, so this one has less margin to absorb the un-measured symmetry-doubling cost than the Med case does).
Suggestion: same as above; this is the criterion where re-measuring through the real facade matters most, since it's already at the edge of the measured envelope.

#### ⚠️ PARTIAL — Single-stamp application latency (query → deform → normals → dirty-region emit) is ≤16 ms at Med
Evidence: same Q-01 benchmark data (interpolated ~3ms at Med's 80k target).
Gap: same pre-facade/no-symmetry caveat as the two criteria above, plus this criterion asks about a *single stamp*, while the benchmark reports an *average over a 60-stamp stroke* — close enough in practice (per-stamp cost dominates and doesn't vary much stamp-to-stamp for a fixed mesh size) but not literally the same measurement.

### Edge cases

#### ✅ PASS — Off-mesh stroke, zero-radius stamp, and empty-history undo are all safe no-ops
Evidence: `src/engine/stroke.test.ts` ("is a no-op for a degenerate brush and after end()" — explicitly covers zero-radius and zero-strength; "treats an off-mesh update as a no-op"), `src/engine/history.test.ts` ("treats undo on empty history and redo with nothing ahead as safe no-ops"), and the facade-level equivalents in `sculpt-engine.test.ts`.

#### ✅ PASS — Loading a zero-vertex mesh is rejected with a validation error
Evidence: `src/engine/sculpt-engine.test.ts` ("rejects loading an empty/zero-vertex mesh"), backed by `SculptMeshValidationError` in `src/core/mesh/sculpt-mesh.ts`.

#### ✅ PASS — A failed remesh leaves the mesh and history untouched
Evidence: `src/engine/sculpt-engine.test.ts` ("a failed setDetail rejects and leaves mesh, history, and detail level untouched").

## Relevant Non-Functional Requirements

#### ✅ PASS — `src/core/` imports no DOM, Three.js, or React
Evidence: `grep -rln "from 'react'\|from 'three'\|document\.\|window\." src/core/` returns no matches.

#### ✅ PASS — Correctness invariant: the engine never produces or exposes a non-manifold/non-watertight mesh through a remesh boundary
Evidence: `remesh.ts` unconditionally runs `checkManifold` on its result and throws rather than returning; `remesh.test.ts`'s forced-failure test confirms the throw path actually fires rather than being dead code.

#### ⚠️ PARTIAL — 80% line coverage on `src/core/` (constitution requirement)
Gap: no coverage tool is configured (`package.json` has no `@vitest/coverage-v8` or similar dependency, and no `coverage` script) — this has never been numerically measured, only informally judged high given the breadth of tests written per module.
Suggestion: add `@vitest/coverage-v8` and a `test:coverage` script before relying on this number; likely close to or above 80% already given test density, but currently unverified.

## Recommendation

Nothing here blocks moving to the next spec (Viewport & Rendering is the natural next layer, per the constitution's `types → core → engine → viewport → ui` order, and is what the performance PARTIALs actually need in order to be re-measured meaningfully anyway — a real render loop is required to observe true end-to-end fps, not just the CPU-side sculpting pipeline this spec measures). Recommend tracking the 4 PARTIALs as a short follow-up list rather than reopening sculpt-engine-core tasks now:

1. Re-benchmark through `SculptEngine` with default symmetry on (closes the 3 performance PARTIALs).
2. Verify Worker-based remesh dispatch interactively once a browser-loadable app exists.
3. Add coverage tooling and confirm the 80%-on-core target.
4. Either compute a real Hausdorff/nearest-point distance for the silhouette-preservation test, or update the spec to describe the bounding-box proxy actually in use.

---

## Addendum — 2026-07-24: all four PARTIALs closed → full PASS

All four follow-up items above were completed. The spec now passes 23/23. (Two of them were substantially enabled by the intervening viewport-rendering spec, which gave the engine a real browser to run in and surfaced the performance work that made the numbers dramatically better.)

**1. The three performance PARTIALs → PASS.** The original Q-01 numbers were measured against the pre-facade, no-symmetry core pipeline. A new benchmark, `npm run bench:facade` (`src/engine/__bench__/facade-bench.ts`), drives a continuous Draw stroke through the real `SculptEngine` facade with X-mirror symmetry ON — the true as-shipped path — and separately during the viewport-rendering fps work the real end-to-end (CPU+render) rate was measured in a live browser. Both comfortably pass:
   - **≥60fps @ Med**: as-shipped CPU cost at 100k triangles is 0.324ms/sample (3,085fps CPU-side); end-to-end in-browser at Med (~96k tri) sustained 60.9fps.
   - **≥30fps @ Max**: as-shipped CPU cost at 500k is 1.185ms/sample (844fps CPU-side); end-to-end in-browser at Max (~550k tri) sustained ~61fps.
   - **≤16ms single-stamp @ Med**: the as-shipped per-sample latency (symmetry on) is ~0.32ms at Med — far under 16ms.
   - A prerequisite for these numbers was fixing the O(triangleCount) per-stamp normal scan (`findTrianglesTouchingVertices`) that dominated the original Q-01 cost — replaced by a precomputed vertex→triangle incidence structure (`src/core/mesh/incidence.ts`). See the 2026-07-24 addendum in `docs/design/q01-triangle-budget-findings.md` for the full re-measurement. **Reframing**: the CPU is no longer the binding constraint at Max; end-to-end fps there is GPU-render-bound. Max = 500,000 still stands as the right clamp, now for a GPU (not CPU) reason.

**2. Worker remesh dispatch in a browser → PASS.** This was verified during viewport-rendering Task 09: `setDetail` ran through the real `createWorkerRemeshRunner` in a live browser (that verification is in fact how a severe WASM-in-worker loading bug was found and fixed — `vite.config.ts`'s `optimizeDeps.exclude` / `worker.format`). `setDetail('med')` completed off the main thread in ~188ms, matching a pure-Node reproduction. Full detail in `docs/plans/active/viewport-rendering-plan.md`'s Task 09 notes.

**3. 80%-on-core coverage → PASS.** `@vitest/coverage-v8` + a `test:coverage` script now measure it, scoped to `src/core/` with an enforced 80% threshold (lines/functions/statements/branches). First measured result: **98.09% lines / 94.05% branches / 100% functions** — every core module over 80%.

**4. Silhouette-preservation metric → PASS.** The remesh tests' loose bounding-box proxy is replaced (augmented) by a true point-to-surface Hausdorff distance: `maxDeviationFromSphere` in `remesh.test.ts` asserts every remeshed vertex stays within 8% of the source sphere's radius. Measured: ~1.14mm (4.5% of radius) for the refine path — its worst case is the coarse source's sagitta — and ~1e-6mm for the simplify path. This catches dents/bulges within the overall bounds that a bbox check cannot. (Chose option (a) — compute a real distance — over option (b) — reword the spec — as the stronger guarantee.)
