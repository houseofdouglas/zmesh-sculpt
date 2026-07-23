# Execution Plan: viewport-rendering

Started: 2026-07-23
Status: IN PROGRESS

Spec: docs/specs/viewport-rendering.md
Tasks: docs/tasks/viewport-rendering-tasks.md

## Progress
- [ ] 01 — Install three + renderer init, capability detection, dev harness
- [ ] 02 — Pure math helpers (spherical-camera, grab-projection, dirty-range)
- [ ] 03 — Scene: lights, clay material, static default camera, resize
- [ ] 04 — Mesh-sync: SculptMesh → geometry, partial upload, topology rebuild
- [ ] 05 — Camera controller: orbit / pan / zoom + frameModel
- [ ] 06 — Picking: raycast → SurfaceHit (point, normal, grab worldDelta)
- [ ] 07 — Pointer router: classifyMode + camera/sculpt event routing
- [ ] 08 — Brush cursor ring + mirror-plane indicator + setBrushDisplay
- [ ] 09 — Viewport facade: attachEngine, lifecycle/dispose, onFrameStats, perf verification

## Decisions & Notes
- First spec with interactive browser verification — most tasks are browser-verified via `npm run dev` (launch config `zmesh-dev`, port 5173), not just Vitest. Only Task 02 (pure math) and Task 07's `classifyMode` are Node-tested.
- A throwaway dev harness in `src/App.tsx` (news up an engine + viewport, mounts it) is introduced in Task 01 and fleshed out per task. The UI spec replaces it — its eventual deletion is expected, not a regression.
- Milestone shape: real sphere on screen by Task 04; full pointer→engine→mesh→screen sculpt loop closed by Task 07; end-to-end ≥60fps perf criterion (the one left PARTIAL by the engine's headless benchmark) validated in Task 09.
- Spec Open Questions planned toward their leaning answers: in-house camera math (Task 05), oriented-ring cursor (Task 08), brush radius via `BrushDisplayConfig` not an engine getter (Task 08). Revisit at implementation if any proves wrong.
- Task 07 (pointer router) is the fiddly one (trackpad gesture detection: pinch arrives as wheel+ctrlKey, etc.); kept as one task but a candidate to split into mouse vs trackpad if it gets unwieldy.
