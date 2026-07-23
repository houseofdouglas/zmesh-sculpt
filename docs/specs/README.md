# Specs

Specs are the source of truth. Code is derived from specs.

## Active Specs
- [viewport-rendering](viewport-rendering.md) — the Three.js rendering layer (`src/viewport`): WebGPURenderer (WebGL2 fallback), mesh↔GPU buffer sync, raycasting to `SurfaceHit`, the trackpad-first camera-vs-brush input router, and brush-cursor/mirror-plane display. Consumes the `SculptEngine` API.

## Completed Specs
- [sculpt-engine-core](sculpt-engine-core.md) — the foundational in-memory sculpting engine: mesh representation, the seven brushes, X-mirror symmetry, undo/redo, and detail remeshing (`src/core` + `src/engine`). Implemented 2026-07-23 (all 16 tasks); acceptance PARTIAL (19/23, 4 non-blocking verification gaps — see `docs/plans/active/sculpt-engine-core-acceptance-2026-07-23.md`).
