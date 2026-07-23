# Execution Plan: sculpt-engine-core

Started: 2026-07-19
Status: IN PROGRESS

Spec: docs/specs/sculpt-engine-core.md
Tasks: docs/tasks/sculpt-engine-core-tasks.md

## Progress
- [x] 01 — Project scaffold (Vite + React + TS strict + Vitest)
- [ ] 02 — SculptMesh type + construction + normals + AABB
- [ ] 03 — Primitive generators (sphere first)
- [ ] 04 — Manifold / watertight validator
- [ ] 05 — manifold-3d LevelSet round-trip spike (library de-risk)
- [ ] 06 — One-ring adjacency (CSR)
- [ ] 07 — Spatial hash for radius queries
- [ ] 08 — Falloff + Draw brush kernel (template)
- [ ] 09 — Q-01 benchmark spike (triangle budget → Max detail)
- [ ] 10 — Brushes part 1: Smooth + Inflate
- [ ] 11 — Brushes part 2: Pinch + Crease + Flatten + registry
- [ ] 12 — Stroke stamping + Grab
- [ ] 13 — X-mirror symmetry
- [ ] 14 — Undo/redo history
- [ ] 15 — SculptEngine facade + change notification
- [ ] 16 — Remesh integration (manifold-3d) + detail + worker

## Decisions & Notes
- Task 01: pinned `vite@7` + `@vitejs/plugin-react@4.7.0` (not latest `vite@8`/`plugin-react@6`) — vitest@3.2's peer range caps at vite ^7, and plugin-react@6 requires vite ^8. Revisit when vitest publishes a vite-8-compatible major.
- Task 01: added `vitest.test.passWithNoTests: true` so `npm run test` exits 0 on an empty suite (Vitest's default is exit 1 with zero test files).
- Task 01: React 19 needs `import type { JSX } from 'react'` for component return types — the global `JSX` namespace isn't ambient the way older React types provided.
- Q-01 (triangle budget → Max detail) is resolved by Task 09; provisional Max ≈ 500k until measured.
- manifold-3d de-risked early in Task 05 before committing to it in Task 16 (revisit ADR if the spike fails).
- Brush work split: Draw (08, template) → Smooth+Inflate (10) → Pinch+Crease+Flatten+registry (11); Grab is stroke-stateful (12).
- Smooth-invert is a no-op in v1 (sharpen deferred).
