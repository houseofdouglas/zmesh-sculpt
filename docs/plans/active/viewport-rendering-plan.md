# Execution Plan: viewport-rendering

Started: 2026-07-23
Status: IN PROGRESS

Spec: docs/specs/viewport-rendering.md
Tasks: docs/tasks/viewport-rendering-tasks.md

## Progress
- [x] 01 — Install three + renderer init, capability detection, dev harness
- [ ] 02 — Pure math helpers (spherical-camera, grab-projection, dirty-range)
- [ ] 03 — Scene: lights, clay material, static default camera, resize
- [ ] 04 — Mesh-sync: SculptMesh → geometry, partial upload, topology rebuild
- [ ] 05 — Camera controller: orbit / pan / zoom + frameModel
- [ ] 06 — Picking: raycast → SurfaceHit (point, normal, grab worldDelta)
- [ ] 07 — Pointer router: classifyMode + camera/sculpt event routing
- [ ] 08 — Brush cursor ring + mirror-plane indicator + setBrushDisplay
- [ ] 09 — Viewport facade: attachEngine, lifecycle/dispose, onFrameStats, perf verification

## Decisions & Notes
- Task 01: `three@0.185.1` ships **no bundled types** (`types`/`typesVersions` both absent from its package.json) — installed `@types/three` (matched exact version) and `@webgpu/types` (for `navigator.gpu` capability typing) separately. `three/webgpu` resolves correctly under this project's `moduleResolution: "bundler"`; verified with a throwaway probe file — testing module resolution via a direct `tsc <file>` CLI arg is misleading (it ignores `tsconfig.json` entirely and defaults to classic resolution), the probe had to live under `src/` to pick up the real project config.
- Task 01: `renderer.backend` is typed as the abstract base `Backend`, not the concrete `WebGPUBackend`/`WebGLBackend` — `isWebGPUBackend` only exists on the subclass, so backend detection uses an `in` check (`'isWebGPUBackend' in renderer.backend`) as both the runtime check and the type guard, rather than an unsafe cast.
- Task 01: `.viewport`'s CSS was `display:flex; align-items:center` (from Task 01 of sculpt-engine-core, meant only for centering placeholder text) — that container mode doesn't reliably stretch a percentage-sized canvas child. Switched to `position:relative` on the container with the canvas `position:absolute; inset:0`, which is robust regardless of the container's own layout mode. Verified visually: canvas fills edge-to-edge at both desktop and tablet viewport presets.
- Task 01: verified against a **real WebGPU backend** in this environment (`backend: webgpu` in the running app) — the WebGL2 fallback path and the "neither backend available" failure path are implemented and code-reviewed but not exercised against an actual non-WebGPU browser in this session (nothing in this environment lacks WebGPU to test against).
- Task 01: live window-resize handling (a resize listener updating `renderer.setSize` after mount) is explicitly Task 03's scope, not this one — Task 01's `resize()` call only runs once at `init()` to size correctly for whatever the container's dimensions are at mount time. Verified only that initial-mount sizing is correct across viewport presets, not live resize-while-mounted.
- First spec with interactive browser verification — most tasks are browser-verified via `npm run dev` (launch config `zmesh-dev`, port 5173), not just Vitest. Only Task 02 (pure math) and Task 07's `classifyMode` are Node-tested.
- A throwaway dev harness in `src/App.tsx` (news up an engine + viewport, mounts it) is introduced in Task 01 and fleshed out per task. The UI spec replaces it — its eventual deletion is expected, not a regression.
- Milestone shape: real sphere on screen by Task 04; full pointer→engine→mesh→screen sculpt loop closed by Task 07; end-to-end ≥60fps perf criterion (the one left PARTIAL by the engine's headless benchmark) validated in Task 09.
- Spec Open Questions planned toward their leaning answers: in-house camera math (Task 05), oriented-ring cursor (Task 08), brush radius via `BrushDisplayConfig` not an engine getter (Task 08). Revisit at implementation if any proves wrong.
- Task 07 (pointer router) is the fiddly one (trackpad gesture detection: pinch arrives as wheel+ctrlKey, etc.); kept as one task but a candidate to split into mouse vs trackpad if it gets unwieldy.
