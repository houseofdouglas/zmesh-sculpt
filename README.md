# zmesh

Browser-based, beginner-first 3D sculpting for 3D printing — Tinkercad-style approachability, brush sculpting for organic shapes, and always-watertight STL/3MF export.

Sculpt figurines, minis, and busts directly in your browser — no install, no accounts — and export a file your slicer will accept without repair. No existing browser sculpting tool treats "beginner sculpts → guaranteed-printable file" as its core loop: [SculptGL](https://github.com/stephomi/sculptgl) is unmaintained, [Nomad Sculpt](https://nomadsculpt.com/) (web) is pro-leaning, and [Re:Form](https://reform3d.app/) paywalls STL export. zmesh is trying to be the missing option.

**Status: early, in-progress.** The sculpting engine and 3D viewport are built and working; there's no polished UI yet (see [Current status](#current-status) below).

## Try it

```bash
npm install
npm run dev
```

Opens a throwaway developer harness at `http://localhost:5173` — a real sculptable sphere with buttons that exercise every engine/viewport feature (brushes, symmetry, undo, remesh detail levels, camera, picking). It's a debug tool, not the eventual product UI — see [Current status](#current-status).

## What's here

- **Brush sculpting** — Draw, Smooth, Inflate, Grab, Pinch, Crease, Flatten, each with falloff-weighted, allocation-free kernels.
- **X-mirror symmetry**, on by default.
- **Undo/redo**, 50+ steps, memory-bounded.
- **Voxel remeshing** via [manifold-3d](https://github.com/elalish/manifold), dispatched to a Web Worker so the UI thread never blocks, behind an in-house `remesh()` seam (swappable for a different implementation later).
- **A real-time 3D viewport** — Three.js `WebGPURenderer` (falls back to WebGL2), live GPU buffer sync as you sculpt, a trackpad-first camera/sculpt input model (1-finger sculpts, 2-finger always orbits — mirrors Nomad Sculpt's one-handed feel), and a brush cursor + mirror-plane indicator.

Not yet built: the actual chrome (toolbars, brush panel, detail slider), STL/3MF export, and local-first project persistence.

## Tech stack

- **Frontend-only in v1** — no backend, no accounts. React 19 + Vite for the chrome (still a placeholder); Three.js for rendering.
- **TypeScript, strict mode.** Core mesh algorithms (`src/core/`) are pure, framework-free, and Node-testable — no DOM, no Three.js, no React.
- **Vitest** for unit tests (`npm test`); interactive/browser verification for anything touching real rendering (no headless GPU in CI yet).
- Full architecture and standards: [`constitution.md`](constitution.md). Project map: [`AGENTS.md`](AGENTS.md).

```
src/
  core/      pure mesh algorithms — brush math, adjacency, spatial hash, manifold validation, remesh
  engine/    the sculpt session — SculptEngine facade, stroke lifecycle, undo history, detail/remesh dispatch
  viewport/  Three.js: scene, camera, mesh↔GPU sync, picking, pointer routing, brush cursor
  ui/        (not built yet) React chrome
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . --max-warnings 0
npm test            # vitest run
npm run build       # production build
```

This project follows a docs-driven SDLC: specs in [`docs/specs/`](docs/specs/) are the source of truth, broken into tasks in [`docs/tasks/`](docs/tasks/) and tracked in [`docs/plans/`](docs/plans/). Each completed spec has an honestly-reported acceptance status (including known gaps) rather than a blanket "done."

## Current status

- **sculpt-engine-core** — complete (16/16 tasks); acceptance **PASS (23/23)** — the four original verification gaps (perf re-measurement through the real engine, Worker-in-browser, coverage tooling, silhouette metric) were all closed 2026-07-24.
- **viewport-rendering** — complete (9/9 tasks); acceptance PASS. Both gaps found during its performance pass have since been fixed: the ≥60fps-Med / ≥30fps-Max target now holds end-to-end (~61fps at Max detail on the M1 baseline, after replacing an O(triangleCount) per-stamp normal scan with a precomputed vertex→triangle incidence structure), and the remesh triangle-count targeting no longer overshoots on repeated remeshes (iterative correction loop).
- **Not started**: the real UI (toolbars/panels replacing the dev harness), STL/3MF export, and `.zmesh` project persistence.

See [`docs/plans/active/`](docs/plans/active/) for the detailed, per-task decision logs behind each of the above.

## License

[MIT](LICENSE)
