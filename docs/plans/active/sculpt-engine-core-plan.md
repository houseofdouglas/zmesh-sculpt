# Execution Plan: sculpt-engine-core

Started: 2026-07-19
Status: IN PROGRESS

Spec: docs/specs/sculpt-engine-core.md
Tasks: docs/tasks/sculpt-engine-core-tasks.md

## Progress
- [x] 01 — Project scaffold (Vite + React + TS strict + Vitest)
- [x] 02 — SculptMesh type + construction + normals + AABB
- [x] 03 — Primitive generators (sphere first)
- [x] 04 — Manifold / watertight validator
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
- Task 02: `noUncheckedIndexedAccess` makes `typedArray[i] += x` a type error (the read side is `number | undefined`). Hot-loop accumulation uses documented non-null assertions (`arr[i]!`) instead of per-element branches, since the offsets are provably in-bounds. Test fixture is a regular tetrahedron centered at the origin — by symmetry each vertex's normal exactly equals its normalized position, giving a precise (not just sign-check) outward-normal assertion.
- Task 03 — **important correctness finding**: a naive UV-sphere (duplicated seam column + duplicated pole vertices per column, the standard rendering-oriented construction) is only *positionally* closed, not *index*-watertight — poles are represented by many coincident-position-but-different-index vertices. For a renderer that's invisible, but for us a brush stroke or remesh touching a pole would move only one of those duplicates and tear the mesh open. Redesigned `buildSurfaceOfRevolution` (shared by sphere/egg/capsule) so poles are a single welded vertex with a triangle fan, and non-pole rings wrap via modulo (no seam duplication needed since there's no texturing in v1). Verified via a from-scratch directed-edge-pairing watertight+orientable test — this is the check that would have caught the naive version's bug. `block` uses 8 shared corner vertices for the same reason (not 24 per-face vertices), trading perfectly flat corner shading for guaranteed connectivity.
- Task 03: `egg`'s width is an approximation by design (smoothstep-blended taper has no closed-form peak radius); height, and both of `capsule`'s dimensions, are exact. Documented in code and reflected in the tests' tolerances.
- Task 04: `checkManifold` classifies 3 defect kinds — boundary-edge (1 occurrence, a hole), inconsistent-winding (2 occurrences, same direction — one face flipped), non-manifold-edge (3+ occurrences). Uses numeric edge keys (`u*vertexCount+v`) rather than string concatenation since this runs on every remesh output. This formalizes (with defect reporting) the informal directed-edge check written ad hoc for Task 03's tests — Task 03 can migrate to this validator later if useful, though its own local check remains valid.
- Q-01 (triangle budget → Max detail) is resolved by Task 09; provisional Max ≈ 500k until measured.
- manifold-3d de-risked early in Task 05 before committing to it in Task 16 (revisit ADR if the spike fails).
- Brush work split: Draw (08, template) → Smooth+Inflate (10) → Pinch+Crease+Flatten+registry (11); Grab is stroke-stateful (12).
- Smooth-invert is a no-op in v1 (sharpen deferred).
