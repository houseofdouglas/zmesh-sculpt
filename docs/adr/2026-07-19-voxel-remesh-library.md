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

## Spike findings (Task 05, 2026-07-23) — GO

Installed `manifold-3d@3.5.1` and round-tripped a sphere through it in both directions. **Result: go.**

**Correction to the plan above — `levelSet` is the wrong tool for this job.** `Manifold.levelSet(sdf, bounds, edgeLength, ...)` takes a signed-distance *function* as input — it's for constructive/procedural modeling (CSG booleans, SDF-authored shapes), not for resampling a mesh we already have. Using it for our "detail slider" would have meant hand-rolling our own SDF sampler over an arbitrary sculpted mesh (itself a substantial algorithm) just to feed data back into the library — defeating the point of using a library at all.

The actual best-fit API, found by reading the real type definitions rather than guessing from documentation summaries:
- **`Manifold.ofMesh(mesh)`** — constructs a `Manifold` directly from position+index buffers (throws if not an oriented 2-manifold, so it doubles as an independent validator).
- **`.refineToLength(edgeLength)`** / **`.refine(n)`** — subdivides existing topology to raise resolution, preserving shape, guaranteed manifold (it's a method on an already-manifold object).
- **`.simplify(tolerance)`** — decimates to lower resolution, same guarantee.
- **`.getMesh()`** — returns position+index buffers back out.

This is a strictly better fit for FR-08 (raise/lower detail while preserving shape) than SDF/isosurface remeshing, and needs no SDF sampler at all. `src/core/remesh/remesh.ts` (Task 16) should build on `ofMesh`/`refineToLength`/`simplify`/`getMesh`, not `levelSet`.

**Conversion is nearly free.** manifold-3d's `Mesh` struct expects `{ numProp: 3, vertProperties: Float32Array, triVerts: Uint32Array }` with position-only channels and CCW winding — exactly our `SculptMesh` layout. Because our vertices are already welded (see the Task 03 finding on avoiding duplicate pole/seam vertices), **no `mergeFromVert`/`mergeToVert` vectors are needed** — the conversion is a direct pass-through, not a transform. See `src/core/remesh/manifold-adapter.ts`.

**Memory-management gotcha for Task 16 to carry forward:** `Manifold` instances (and `CrossSection`) are WASM-heap-backed and are **not garbage-collected** — every one obtained from `ofMesh`, `.refineToLength()`, `.simplify()`, etc. must have `.delete()` called explicitly, or the WASM heap leaks. `Mesh` (the plain input/output struct over our own typed arrays) does *not* have or need `.delete()`. The engine-layer remesh dispatch (Task 16) must track and dispose every intermediate `Manifold` it creates, especially since remeshing runs repeatedly across a session inside a Web Worker.

**Measurements:**
- WASM init (`Module()` resolve + `.setup()`), isolated in Node: **~7.5ms** (7.3ms module resolve, 0.2ms setup). Browser cold-start will differ (network fetch of the .wasm on first load, then cached) but this is a low ceiling either way — no lazy-loading gymnastics needed.
- Bundle footprint: `manifold.js` glue **73KB** + `manifold.wasm` **529KB** ≈ **601KB uncompressed** total. Reasonable for a WASM geometry engine that's the core of the product, not an incidental dependency.
- Round-trip of a ~2,200-triangle sphere through both `refineToLength` (more detail) and `simplify` (less detail): both completed well under test-timeout, output passed `checkManifold` (Task 04) with zero defects, and the refined output's bounding box stayed within the analytic sphere radius (silhouette preserved).

**Known, accepted risk — not a blocker:** `npm audit` flags 4 high-severity CVEs in `sharp` (image-processing native library), pulled in transitively via `manifold-3d → @gltf-transform/functions → ndarray-pixels → sharp`. This is manifold-3d's *optional* glTF/texture I/O tooling, not the core WASM geometry engine (`Manifold`/`Mesh`/`levelSet`/etc.) we actually import and use. `sharp` is a native Node library that cannot execute in a browser at all, and we have no reason to import any glTF/texture helper from this package. The vulnerable code path is unreachable for our usage. Not fixing via `npm audit fix --force` (which would downgrade `manifold-3d` three minor versions, a real regression, solely to dodge an unreachable transitive path). Revisit if a future phase actually needs manifold-3d's glTF export helpers.

**Verdict: adopt `manifold-3d` for Task 16**, built on `ofMesh`/`refineToLength`/`simplify`/`getMesh` rather than `levelSet`.
