# ADR: Permit a third-party voxel-remesh library for v1

**Date**: 2026-07-19
**Status**: Accepted

## Context

The constitution states a preference for implementing core algorithms in-house, because a stated goal of the project is for the owner to learn how real-time mesh processing works. Voxel remeshing is the single most complex algorithm in that core: it underpins the "detail" control (FR-08), the watertight-export guarantee (FR-09), and — in later phases — remesh-on-import for photogrammetry scans.

A correct, robust, performant voxel remesher (surface sampling → SDF/voxel grid → isosurface extraction → manifold output) is a multi-week effort on its own and a common place for subtle non-manifold bugs. Building it first would block every other v1 feature behind the hardest problem in the project.

## Decision

For v1, a third-party library is permitted for the voxel-remesh / isosurface step. The rest of `src/core/` (mesh structures, brush deformation math, manifold validation, STL/3MF serialization) remains in-house per the constitution.

The remesher must sit behind a narrow, in-house interface (e.g. `remesh(mesh, targetResolution) → SculptMesh`) in `src/core/` so the implementation can be swapped for an in-house one later without touching callers.

## Consequences

- **Positive**: unblocks the whole v1 feature set; the owner still learns the surrounding machinery (validation, serialization, brush math) which is plenty educational; the isosurface algorithm can be studied and reimplemented later as a focused learning project behind the stable interface.
- **Negative**: relaxes the in-house-core principle for one component; adds a dependency that must be vetted for license, bundle size, WASM footprint, and manifold-output guarantees.
- **Candidates evaluated** (initial scan 2026-07-19):
  - **`manifold-3d`** (elalish/manifold) — **leading candidate.** WASM, runs in-browser; the library's core guarantee is topological robustness / manifold output, which directly serves our watertight invariant. Ships a `LevelSet` operation (SDF → isosurface) that is exactly the voxel-remesh primitive our detail slider needs, plus documented Three.js interop. Apache-2.0.
  - Marching-cubes / surface-nets npm libraries — lighter, but they only do isosurface extraction; we'd still own the SDF sampling and manifold guarantees. Fallback if `manifold-3d` bundle/WASM footprint proves too heavy.
  - In-house surface-nets over a library-provided SDF — the "learning centerpiece" path, deferred.
  - **Decision**: adopt `manifold-3d` as the best-shot v1 implementation behind the `remesh()` seam; benchmark it in the Q-01 spike.
- **Related insight**: `manifold-3d`'s docs note STL round-trips are not guaranteed to re-import as manifold and recommend 3MF for solids. This reinforces keeping 3MF on the roadmap (FR-20) and makes zmesh's own export-time validation (FR-09) essential for the STL path.
- **Revisit if**: bundle size or WASM footprint is unacceptable, output is not reliably manifold in practice, licensing changes, or the owner chooses to make the remesher the in-house learning centerpiece.
