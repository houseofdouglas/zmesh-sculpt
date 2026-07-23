# Execution Plan: sculpt-engine-core

Started: 2026-07-19
Status: IN PROGRESS

Spec: docs/specs/sculpt-engine-core.md
Tasks: docs/tasks/sculpt-engine-core-tasks.md

## Progress
- [ ] 01 — Project scaffold (Vite + React + TS strict + Vitest)
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
- Q-01 (triangle budget → Max detail) is resolved by Task 09; provisional Max ≈ 500k until measured.
- manifold-3d de-risked early in Task 05 before committing to it in Task 16 (revisit ADR if the spike fails).
- Brush work split: Draw (08, template) → Smooth+Inflate (10) → Pinch+Crease+Flatten+registry (11); Grab is stroke-stateful (12).
- Smooth-invert is a no-op in v1 (sharpen deferred).
