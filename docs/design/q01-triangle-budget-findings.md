# Q-01 Findings: Triangle Budget for Interactive Sculpting

**Status**: Resolved
**Date**: 2026-07-23
**Harness**: `src/core/__bench__/sculpt-bench.ts` (`npm run bench:sculpt`)
**Resolves**: requirements Q-01, spec BR-03 (Max detail clamp)

## Method

For six target triangle counts (20k → 1M, sized via `sphere(100, {widthSegments, heightSegments})` with `widthSegments = heightSegments = round(sqrt(target/2))`), ran a 60-stamp Draw stroke along a quarter great-circle arc (brush radius 5mm on a 100mm sphere) and measured the CPU-side pipeline per stamp: spatial-hash query → `applyDraw` → `updateVertexPosition` per moved vertex → `recomputeAffectedRegionNormals` → a dirty-AABB stand-in for the future `onChange` notification. Rendering is excluded — that's a separate cost, measured by the viewport spec. The first stamp of each run is dropped (JIT/cache warmup); the reported average is over the remaining 59.

## Results

| Triangles | Vertices | Avg stamp (ms) | Implied fps |
|---|---|---|---|
| 19,800 | 9,902 | 0.742 | 1348.1 |
| 49,612 | 24,808 | 1.738 | 575.3 |
| 99,904 | 49,954 | 3.773 | 265.0 |
| 199,080 | 99,542 | 7.681 | 130.2 |
| 499,000 | 249,502 | 19.244 | 52.0 |
| 998,284 | 499,144 | 38.613 | 25.9 |

**≥60 fps (NFR-01 Med target) holds up to: 199,080 triangles**
**≥30 fps (NFR-01 Max target) holds up to: 499,000 triangles**

## Key finding: the bottleneck is a known, already-flagged O(triangleCount) scan — not the local brush/query work

Per-stamp time scales almost exactly linearly with **total mesh size**, not with the (constant) size of the brush-affected region:

| Triangle ratio | Time ratio |
|---|---|
| 2.51x | 2.34x |
| 2.01x | 2.17x |
| 1.99x | 2.04x |
| 2.51x | 2.51x |
| 2.00x | 2.01x |

A well-behaved spatial-hash query (Task 07, independently verified sub-linear) plus local brush deformation would keep per-stamp cost roughly **constant** regardless of total mesh size, since a brush stroke only ever touches a small, fixed-size neighborhood. The near-perfect linear scaling here means something is doing O(total triangles) work on every single stamp.

That something is `findTrianglesTouchingVertices` (`src/core/mesh/normals.ts`, added in Task 08), which the affected-region normal-recompute helper calls once per stamp and which does an honest, documented O(triangleCount) linear scan. Its own doc comment already named this exact risk: *"If profiling ever shows this is a hot spot for large meshes, a precomputed vertex→triangle incidence structure ... would make this O(1) per query — not needed yet at this task's scope."* This benchmark is that profiling, and it confirms the prediction.

## Recommendation

1. **Adopt the measured numbers as the v1 `DetailLevel` clamps** — they're real, current, and already close to the spec's original provisional targets (Low ~20k / Med ~80k / High ~200k / Max ~500k): Med's provisional 80k sits comfortably under the measured 199k @60fps ceiling, and Max's provisional ~500k lines up almost exactly with the measured 499k @30fps ceiling. **Set `Max = 500,000` triangles**, replacing the provisional "~500k, TBD."
2. **Do not block v1 on fixing the O(triangleCount) scan** — the measured ceiling already comfortably covers a beginner sculpting app's working resolution range.
3. **Flag for Task 16 (and reconsider Task 08 if revisited)**: building the precomputed vertex→triangle incidence structure that Task 08 deferred would very likely raise the achievable ceiling substantially, since the dominant cost would then scale with the local affected region instead of total mesh size. Worth prioritizing if a materially higher Max detail is wanted later, or if the viewport's own rendering cost (not yet measured) turns out to leave more CPU headroom than expected.

## Reproducing

```bash
npm run bench:sculpt
```

---

## Addendum — 2026-07-24: incidence fix + as-shipped facade re-measurement

Recommendation #3 above (build the precomputed vertex→triangle incidence structure that Task 08 deferred) has since been implemented — see `src/core/mesh/incidence.ts` and the follow-up notes in both plan files. The prediction held: the O(triangleCount) per-stamp scan is gone, and per-stamp cost now scales with the local affected region instead of total mesh size.

This addendum also closes the acceptance PARTIAL that flagged the numbers above as measured against a **pre-facade, no-symmetry** pipeline (`core/__bench__/sculpt-bench.ts` calls the core functions directly and predates both `SculptEngine` and X-mirror-on-by-default). A new benchmark, `npm run bench:facade` (`src/engine/__bench__/facade-bench.ts`), drives a continuous Draw stroke through the **real `SculptEngine` facade** with **X-mirror symmetry ON** — the exact as-shipped code path, mirror stamp included — measuring wall-clock per `updateStroke()` call that lands a stamp (detected via a real `onChange` subscription, so dirty-region cost is included).

### As-shipped results (M1 baseline, symmetry ON)

| Triangles | avg/sample (ms) | implied fps | symmetry-OFF (ms) |
|---|---|---|---|
| 49,612 | 0.253 | 3,948 | 0.104 |
| 99,904 | 0.324 | 3,085 | 0.131 |
| 199,080 | 0.551 | 1,815 | 0.238 |
| 499,000 | 1.185 | 844 | 0.635 |
| 998,284 | 2.329 | 429 | 1.107 |

**CPU-side ceiling for both the 60fps and 30fps budgets now exceeds 998,284 triangles** — the entire tested range clears 60fps on the CPU, versus the original ~199k (60fps) / ~499k (30fps) ceilings that the O(n) scan imposed. X-mirror symmetry roughly doubles per-sample cost (e.g. 0.635 → 1.185ms at 499k, about 1.87x), exactly as expected from the doubled stamp count, but even with it on, the Max target (500k) has roughly 14x CPU headroom over the 60fps budget, and single-stamp latency there (1.185ms) is far under the 16ms criterion. This closes all three performance PARTIALs from the 2026-07-23 acceptance report (they were measured against the pre-facade pipeline; these are the real as-shipped numbers).

### Consequence for the Q-01 Max clamp

The CPU is **no longer the binding constraint** at Max. The real end-to-end frame rate at Max, measured in-browser during viewport-rendering's fps work, is about 61fps — GPU-render/compositor-bound, not CPU-bound (the CPU stamp is ~1ms of a ~16ms frame). So recommendation #1's clamp of Max = 500,000 still stands as the right v1 value, but the reason has shifted: it is now bounded by GPU render cost, which this CPU benchmark does not measure. Any future push to raise Max above 500k should profile the WebGPU draw + partial-buffer-upload path specifically — the CPU sculpting pipeline would comfortably support well over 1M triangles at 60fps.

### Reproducing the as-shipped numbers

```bash
npm run bench:facade
```
