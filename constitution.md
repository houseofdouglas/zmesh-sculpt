# Constitution

> This file is immutable context for all AI operations. Changes require deliberate architectural decisions. Do not edit during feature implementation.

## Project Identity

- **Name**: zmesh
- **Description**: A browser-based, beginner-first 3D sculpting app that pairs Tinkercad-style approachability with always-watertight, print-ready STL/3MF export for hobbyist 3D-printer owners.
- **Started**: 2026-07-19
- **Owner**: Peter Douglas
- **Brief**: docs/briefs/zmesh-brief.md

## Technology Stack

### Frontend (this is the whole v1 app — there is no backend)
- **Framework**: React 19 + Vite
- **Language**: TypeScript (strict mode)
- **3D Engine**: Three.js using `WebGPURenderer` — runs on WebGPU where available, falls back to WebGL2 automatically. Custom compute (e.g., GPU brush deformation) may be added later via Three.js TSL/compute where WebGPU is present, always with a CPU/WebGL2 fallback.
- **Styling**: CSS Modules (keep the chrome light; the viewport is the star)
- **State**: Zustand for UI state; the mesh/sculpt engine holds its own state outside React (React must never re-render per sculpt stroke)
- **Persistence**: Local-first — File System Access API for save/load to disk, IndexedDB (via `idb`) for autosave/recovery. No accounts, no cloud in v1.
- **Testing**: Vitest (+ Testing Library for components); mesh-engine algorithms get pure unit tests with known-geometry fixtures

### Backend
- **None in v1.** The app is fully client-side. Do not introduce servers, APIs, accounts, or telemetry endpoints without an ADR.

### Infrastructure
- **Hosting (when we ship)**: static — S3 + CloudFront via AWS CDK (TypeScript) in `infra/`. Empty until a deploy phase begins.
- **CI/CD**: GitHub Actions (typecheck, lint, test, build) → CDK deploy later

## Architecture Layers

Dependencies flow forward only. No circular dependencies. No skipping layers.

```
types → core → engine → viewport → ui
```

- **types** (`src/types/`): shared TypeScript types, Zod schemas for file formats/project files
- **core** (`src/core/`): pure mesh algorithms — half-edge/index mesh structures, brush deformation math, voxel remeshing, manifold validation, STL/3MF serialization. **No DOM, no Three.js, no React imports.** Everything here is unit-testable in Node.
- **engine** (`src/engine/`): the sculpt session — owns the live mesh, undo/redo history, brush application loop, dirty-region tracking. Talks to `core`; exposes an imperative API. No React.
- **viewport** (`src/viewport/`): Three.js rendering — scene, camera controls, mesh↔GPU buffer sync, picking/raycasting. Consumes the engine's API.
- **ui** (`src/ui/`): React components — toolbars, panels, dialogs, export flow. Reads/writes engine state via a thin store bridge; never touches mesh data directly.

Heavy work (remeshing, export validation) runs in Web Workers so the UI thread never blocks.

## Non-Negotiable Product Invariants

- **Watertight out, always**: every exported STL/3MF must be manifold and watertight. Export runs validation; if it can't guarantee printability, it repairs or clearly refuses — it never silently emits a broken file.
- **Beginner-first**: default settings must produce good results. Every new UI control must justify its existence; prefer removing options over adding them.
- **Real units**: the model lives in millimeters. Dimensions shown are true print dimensions.
- **Never lose work**: autosave to IndexedDB; a browser crash or accidental tab close must not destroy a session.
- **60 fps sculpting** on a mid-range laptop for meshes up to the supported resolution; degrade resolution before degrading responsiveness.

## Coding Standards

- TypeScript strict mode: `"strict": true` in tsconfig
- No `any` types (use `unknown` and narrow)
- Explicit return types on all exported functions
- All async functions handle errors explicitly — no unhandled promise rejections
- `src/core/` stays dependency-free and framework-free (pure functions + typed arrays preferred; mesh data in `Float32Array`/`Uint32Array`, not object graphs)
- Performance-critical loops avoid per-iteration allocation; document any deliberate exception
- Structured logging via a small logger util — not bare `console.log` strings; no logging in hot paths

## Naming Conventions

- **Files/Directories**: kebab-case (`voxel-remesh.ts`, `brush-inflate.ts`)
- **Types/Interfaces**: PascalCase (`SculptMesh`, `BrushStroke`)
- **Functions/Variables**: camelCase (`applyBrush`, `isManifold`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_UNDO_DEPTH`)

## Security & Privacy Rules

- All file inputs (project files, later mesh imports) validated with Zod / defensive parsers — imported files are untrusted data
- No user data leaves the browser in v1 — no analytics, no telemetry, no remote calls without an ADR
- Third-party dependencies require justification; prefer implementing core algorithms ourselves (that's the point of the project)

## Test Requirements

- `src/core/` algorithms: 80% line coverage minimum, with geometric property tests (e.g., "remesh output is always manifold", "export of any valid mesh round-trips")
- `src/engine/`: undo/redo and stroke application covered by unit tests
- UI: test critical flows (export, save/load) — not per-component snapshots
- Acceptance criteria from specs: each criterion must have at least one test

## Definition of Done

A task is done when:
- [ ] Implementation matches spec acceptance criteria
- [ ] TypeScript compiles with zero errors (`tsc --noEmit`)
- [ ] ESLint passes with zero warnings
- [ ] Relevant tests written and passing
- [ ] No `console.log` debugging left in code
- [ ] Verified interactively in the browser (sculpting features must be *felt*, not just tested)

## Architecture Decision Log

Document significant decisions in `docs/adr/`. Format: `{date}-{decision}.md`.

Recorded at inception:
- Three.js (WebGPURenderer, WebGL2 fallback) over raw WebGPU — learning depth preserved in `core`/`engine`, WebGPU compute remains open as an optimization path
- React + Vite for chrome; engine state lives outside React
- Local-first, no backend in v1
