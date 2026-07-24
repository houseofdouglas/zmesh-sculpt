# Specs

Specs are the source of truth. Code is derived from specs.

## Active Specs
(none currently — see Completed below)

## Completed Specs
- [sculpt-engine-core](sculpt-engine-core.md) — the foundational in-memory sculpting engine: mesh representation, the seven brushes, X-mirror symmetry, undo/redo, and detail remeshing (`src/core` + `src/engine`). Implemented 2026-07-23 (all 16 tasks); acceptance was PARTIAL (19/23) and is now a full **PASS (23/23)** — all four verification gaps closed 2026-07-24 (facade+symmetry re-benchmark, Worker-in-browser verification, coverage tooling at 98% on core, and a true point-to-surface silhouette metric). See the Addendum in `docs/plans/active/sculpt-engine-core-acceptance-2026-07-23.md`.
- [viewport-rendering](viewport-rendering.md) — the Three.js rendering layer (`src/viewport`): WebGPURenderer (WebGL2 fallback), mesh↔GPU buffer sync, raycasting to `SurfaceHit`, the trackpad-first camera-vs-brush input router, and brush-cursor/mirror-plane display. Consumes the `SculptEngine` API. Implemented 2026-07-23 (all 9 tasks); acceptance PASS as of 2026-07-24. Both gaps found during Task 09 were fixed: the ≥30fps@Max criterion (was ~25fps, now ~61fps — a per-stamp O(triangleCount) normal scan replaced by a precomputed vertex→triangle incidence structure) and a `remesh()` target-overshoot bug in `core/remesh/remesh.ts` (iterative correction loop). See `docs/plans/active/viewport-rendering-plan.md`'s Decisions & Notes (Task 09) for the full findings, including a real bug found and fixed along the way (manifold-3d's WASM failing to load inside the remesh Web Worker in both dev and production, via a `vite.config.ts` fix).
