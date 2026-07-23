# Requirements: zmesh v1 (Sculpt + Print-Ready Export)

**Source Brief**: docs/briefs/zmesh-brief.md
**Status**: APPROVED
**Created**: 2026-07-19

## Problem Statement

Hobbyist 3D-printer owners have no approachable way to create organic shapes. zmesh v1 delivers the complete core loop — open the app, sculpt a figurine from a ball of digital clay, export a file that prints without repair — with Tinkercad-level approachability. Success for v1: a novice produces a printable custom model in their first session, without a tutorial.

## User Roles & Goals

| Role | Goal | Frequency |
|------|------|-----------|
| Hobbyist sculptor (only role — no auth, no admin) | Sculpt an organic model and export a printable file | Occasionally (evenings/weekends, project-driven) |

## Functional Requirements

### MUST HAVE (MVP blockers)

**First run & viewport**
- FR-01 [MUST] On first load, the user sees a sculptable sphere in the viewport with a brush already active — a stroke can be made with zero prior decisions.
- FR-02 [MUST] The user can orbit, pan, and zoom the camera with mouse and trackpad gestures.

**Sculpting**
- FR-03 [MUST] The user can sculpt with seven brushes: Draw (add clay), Smooth, Inflate, Grab, Pinch, Crease, Flatten.
- FR-04 [MUST] The user can invert any brush's effect via a modifier key (e.g., Draw subtracts clay).
- FR-05 [MUST] The user can adjust brush size and strength via visible controls and keyboard shortcuts.
- FR-06 [MUST] X-axis mirror symmetry is ON by default with a clearly visible toggle.
- FR-07 [MUST] The user can undo/redo at least 50 steps within a session.
- FR-08 [MUST] The user can raise or lower mesh detail via a single "detail" control, which remeshes the model at the new resolution while preserving its shape.

**Print-ready export**
- FR-09 [MUST] The user can export the model as an STL file that is watertight and manifold — validated before writing; if validation fails, the system repairs automatically or clearly refuses (it never silently emits a broken file).
- FR-10 [MUST] The user can see the model's real dimensions in millimeters at all times and set its size (uniform scale) before export.
- FR-11 [MUST] The user can see their model in the context of a printer bed (common presets + custom size) to judge printability at scale.

**Projects & persistence**
- FR-12 [MUST] The user sees a home screen gallery of their projects with thumbnails (stored in browser storage); they can create, open, rename, and delete projects.
- FR-13 [MUST] Work is autosaved continuously; closing the tab or crashing the browser loses at most 30 seconds of work.
- FR-14 [MUST] The user can save a project to disk as a `.zmesh` file and load one back, on all supported browsers.

### SHOULD HAVE
- FR-20 [SHOULD] The user can export as 3MF (real units embedded, modern slicer standard). *(Designated cut if timeline halves.)*
- FR-21 [SHOULD] Keyboard shortcuts for brush switching, undo/redo, and symmetry, with an in-app cheat sheet.
- FR-22 [SHOULD] New projects can start from a small set of base shapes (sphere, egg, block, capsule) — first run still defaults straight to the sphere.

### COULD HAVE
- FR-30 [COULD] Touch/stylus sculpting (iPad, pen displays) with pressure → strength. *(See Q-03: desktop-first for v1.)*
- FR-31 [COULD] Selectable viewport material/lighting presets (clay, matcap).
- FR-32 [COULD] Duplicate an existing project from the gallery.

### WON'T HAVE (v1 — prevents scope creep)
- FR-40 [WON'T] Mesh import (photogrammetry/OBJ/STL/USDZ) — phase 2/3; remesh-on-import shares machinery with FR-08/FR-09, so v1 builds its foundation.
- FR-41 [WON'T] Printability analysis (wall thickness, overhangs, stability) — phase 2.
- FR-42 [WON'T] Accounts, cloud sync, sharing — local-first v1.
- FR-43 [WON'T] Stamp/alpha texture brushes, painting, multi-object scenes, animation, slicing.

## Non-Functional Requirements

- NFR-01 [Performance] Sculpt strokes render at ≥60 fps at the default detail level, and ≥30 fps at maximum detail, on mid-range 2022+ hardware (baseline: Apple M1 / equivalent integrated GPU).
- NFR-02 [Performance] Brush response latency (pointer move → visible deformation) ≤ 33 ms.
- NFR-03 [Performance] Detail-change remesh completes ≤ 3 s at maximum resolution, off the UI thread with progress indication.
- NFR-04 [Performance] App is interactive (first stroke possible) ≤ 3 s after page load on a typical broadband connection.
- NFR-05 [Compatibility] Works on latest Chrome, Edge, Safari, Firefox; uses WebGPU when available, falls back to WebGL2 transparently. Desktop-first (see Q-03).
- NFR-06 [Reliability] Export validation guarantees: every emitted STL/3MF passes standard manifold checks (target: imports into PrusaSlicer/Cura/Bambu Studio with no repair prompt).
- NFR-07 [Privacy] No user data leaves the browser — no analytics, telemetry, or remote calls.
- NFR-08 [Security] `.zmesh` files and browser-stored data are treated as untrusted input and defensively validated on load.
- NFR-09 [Accessibility] All controls have visible labels or tooltips + ARIA labels; color is never the sole indicator; UI (not viewport) is keyboard-navigable.
- NFR-10 [Cost] Hosting is static; infrastructure cost ≤ $5/month at v1 scale.

## Business Rules

- BR-01 Units: 1 internal unit = 1 mm; STL is emitted on that convention, 3MF with explicit millimeter units.
- BR-02 Export gate: a mesh that fails manifold validation after auto-repair cannot be exported — the user gets a plain-language explanation, never a broken file.
- BR-03 Detail bounds: mesh resolution is clamped between a floor (sculptable minimum) and a ceiling (the triangle budget that sustains NFR-01); the ceiling is fixed by benchmark, not user-overridable.
- BR-04 Undo history is session-scoped (not persisted in project files) and memory-bounded; oldest entries evict first, never below 50 steps.
- BR-05 Autosave never overwrites the on-disk `.zmesh` file — disk saves are explicit user actions.

## Data Requirements

- **Project**: id, name, created/modified timestamps, thumbnail (PNG blob), mesh data, detail level, model scale (mm), printer-bed setting.
- **Mesh**: vertex positions + triangle indices as typed arrays (`Float32Array`/`Uint32Array`); one connected watertight surface.
- **`.zmesh` file**: versioned container (format version, project metadata, compressed mesh payload); Zod-validated on load.
- **Settings** (browser-scoped): last-used brush config, bed preset, UI preferences.

## Integration Requirements

None external. Browser platform APIs only: WebGPU/WebGL2, IndexedDB, File System Access API (with download/upload fallback where unsupported — notably Firefox/Safari), Web Workers, Pointer Events.

## Constraints

- Technical: fully client-side; constitution layer rules (`types → core → engine → viewport → ui`); core algorithms implemented in-house (learning goal) — **except the voxel remesher, where a library is permitted (see Q-02 / ADR needed)**.
- Timeline: none hard.
- Budget: hobby-scale (NFR-10).

## Resolved Questions

| ID | Question | Resolution |
|----|----------|------------|
| Q-02 | Build the voxel remesher in-house or use a library? | **Library permitted** for v1. Relaxes the constitution's in-house-core preference for this one component; record as an ADR documenting the trade-off and candidate libraries. |
| Q-03 | Is desktop-only acceptable for v1? | **Yes — desktop-first.** Touch/stylus (FR-30) explicitly deferred to COULD. |

## Open Questions

| ID | Question | Impact | Owner | Status |
|----|----------|--------|-------|--------|
| Q-01 | What triangle budget sustains 60 fps on the M1 baseline? Sets the detail ceiling (BR-03). | High — shapes engine design | Benchmark spike, first implementation task | Open |

## Out of Scope

Everything under WON'T HAVE, plus: monetization, i18n/localization, offline PWA packaging, and community/sharing features.
