# Task Plan: viewport-rendering

**Spec**: docs/specs/viewport-rendering.md
**Status**: APPROVED
**Created**: 2026-07-23
**Total**: 9 tasks, ~23 hours

Layer: all Viewport (`src/viewport/`), consuming the `SculptEngine` API from sculpt-engine-core. First spec with interactive **browser verification** at most steps — the dev server (`npm run dev`) and `.claude/launch.json` (`zmesh-dev`, port 5173) already exist. A throwaway dev harness in `src/App.tsx` (news up an engine + viewport and mounts it) is introduced in Task 01 and fleshed out per task; the UI spec replaces it later.

---

## Task: 01 — Install three + renderer init, capability detection, dev harness

**Layer**: Config/Viewport · **Estimate**: 2hr · **Depends on**: none · **Status**: DONE
**Completed**: 2026-07-23

### What to build
Add the `three` dependency (and `@webgpu/types` if needed for `navigator.gpu` capability typing). Create `src/viewport/renderer.ts`: async init of Three.js `WebGPURenderer` (from `three/webgpu`) that uses WebGPU when available and falls back to WebGL2, returning `ViewportInitResult` (`{ ok, backend }` or `{ ok:false, reason }` when neither is available). Create a minimal `src/viewport/viewport.ts` shell (`new Viewport(container)`, `init()`, `dispose()`) that mounts a canvas and clears it to a solid color. Wire a throwaway harness in `src/App.tsx` that mounts a Viewport and shows the detected backend.

### Acceptance criteria
- [ ] `npm run dev` shows a canvas cleared to a color; the detected backend (`webgpu` or `webgl2`) is visible/logged
- [ ] `init()` resolves `{ ok:false, reason }` (not a throw) when no GPU backend is available
- [ ] `dispose()` stops the loop and releases the renderer; calling it twice or before `init()` is a safe no-op
- [ ] `npm run typecheck`, `lint`, `test` remain clean

### Files expected
- `src/viewport/renderer.ts`, `src/viewport/viewport.ts` (shell), `src/App.tsx` (harness), `package.json`

---

## Task: 02 — Pure math helpers (spherical-camera, grab-projection, dirty-range)

**Layer**: Viewport (pure) · **Estimate**: 3hr · **Depends on**: 01 · **Status**: DONE
**Completed**: 2026-07-23

### What to build
The Node-testable core of this layer, importing no Three.js/DOM. `math/spherical-camera.ts`: `framingDistance(boundsDiagonalMm, fovYRadians)` and `sphericalToPosition(target, radius, yaw, pitch)`. `math/grab-projection.ts`: `projectScreenDeltaToWorld(...)` mapping a screen-pixel delta to a world-space delta on the camera-facing plane through the grab point. `math/dirty-range.ts`: `vertexRangeToAttributeRange(vertexStart, vertexEnd)` → `{ offset, count }` for an xyz `BufferAttribute`.

### Acceptance criteria
- [ ] `framingDistance` returns a distance at which a sphere of the given bounds diagonal fits within the vertical FOV (projected extent ≤ view height)
- [ ] `projectScreenDeltaToWorld` yields a vector in the camera-facing plane through the grab point; magnitude scales with depth (2× distance → 2× world delta for the same pixel delta)
- [ ] `vertexRangeToAttributeRange` maps a half-open vertex range to the correct element offset/count
- [ ] All pure — no Three.js/DOM imports; covered by Vitest

### Files expected
- `src/viewport/math/spherical-camera.ts`, `math/grab-projection.ts`, `math/dirty-range.ts`, `+ tests`

---

## Task: 03 — Scene: lights, clay material, static default camera, resize

**Layer**: Viewport · **Estimate**: 2hr · **Depends on**: 01 · **Status**: DONE
**Completed**: 2026-07-23

### What to build
`src/viewport/scene.ts`: the scene graph — a neutral matte "clay" material, lighting that reads form from any angle (key + fill + ambient, or an equivalent), and a static `PerspectiveCamera` (interactive control comes in Task 05). Handle container resize / devicePixelRatio: update renderer size and camera aspect without reallocating mesh buffers. Render a temporary placeholder solid (e.g. a Three.js sphere) so the lighting is visible.

### Acceptance criteria
- [ ] A lit placeholder solid renders, readable from the default camera angle
- [ ] Resizing the container updates size + aspect with no distortion and no buffer reallocation
- [ ] Material/lighting are the neutral clay default (no preset selection — that's FR-31/out of scope)

### Files expected
- `src/viewport/scene.ts`, `src/viewport/viewport.ts` (wire scene into the loop)

---

## Task: 04 — Mesh-sync: SculptMesh → geometry, partial upload, topology rebuild

**Layer**: Viewport · **Estimate**: 3hr · **Depends on**: 02, 03 · **Status**: DONE
**Completed**: 2026-07-23

### What to build
`src/viewport/mesh-sync.ts`: build a `BufferGeometry` backed by the engine's `positions`/`normals`/`indices` typed arrays; on a `DirtyRegion`, upload only the changed vertex range via `BufferAttribute` update-range (using `vertexRangeToAttributeRange` from Task 02); on a full-mesh dirty region (remesh/new mesh), rebuild geometry with new buffers/counts. Guard against a stale range beyond the current buffer. Update the harness to construct a `SculptEngine`, render its real default sphere, and reflect a scripted deformation.

### Acceptance criteria
- [ ] The engine's real default sphere renders (replacing the Task 03 placeholder)
- [ ] A partial `DirtyRegion` update changes only the affected vertices on screen (no full-buffer re-upload)
- [ ] A topology change (scripted remesh) rebuilds geometry correctly
- [ ] A stale/out-of-range `DirtyRegion` is ignored, not crashed on

### Files expected
- `src/viewport/mesh-sync.ts`, harness update

---

## Task: 05 — Camera controller: orbit / pan / zoom + frameModel

**Layer**: Viewport · **Estimate**: 3hr · **Depends on**: 02, 03 · **Status**: PENDING

### What to build
`src/viewport/camera-controller.ts`: orbit/pan/zoom around a target point in mm world space, using `spherical-camera.ts` math (in-house per the spec's leaning answer — the pointer router needs to own pointer-down anyway). `frameModel()` fits the camera to the current mesh bounds via `framingDistance`. Frame on mount and on new/loaded mesh, but not on remesh. (Raw input wiring is Task 07; this task exposes imperative orbit/pan/zoom/frame methods and can be exercised from the harness with temporary buttons or keys.)

### Acceptance criteria
- [ ] Orbit, pan, and zoom each move the camera correctly around/toward the target
- [ ] `frameModel()` fits the default sphere fully in view, centered
- [ ] Framing fires on load and new mesh, not on a remesh

### Files expected
- `src/viewport/camera-controller.ts`, harness hook

---

## Task: 06 — Picking: raycast → SurfaceHit (point, normal, grab worldDelta)

**Layer**: Viewport · **Estimate**: 2hr · **Depends on**: 02, 04 · **Status**: PENDING

### What to build
`src/viewport/picking.ts`: a `THREE.Raycaster`-based pick from a pointer position to the mesh, producing `SurfaceHit` (`point`, interpolated `normal`). Compute grab `worldDelta` from frame-to-frame cursor motion via `projectScreenDeltaToWorld` (Task 02). Harness: log hits under the cursor to confirm point/normal are correct.

### Acceptance criteria
- [ ] A pointer over the mesh yields a `SurfaceHit` with a surface point and an interpolated (unit) normal
- [ ] A pointer over empty space yields no hit (drives the router's camera decision later)
- [ ] Grab `worldDelta` tracks screen-space cursor motion at the model's depth

### Files expected
- `src/viewport/picking.ts`, harness logging

---

## Task: 07 — Pointer router: classifyMode + camera/sculpt event routing

**Layer**: Viewport · **Estimate**: 3hr · **Depends on**: 05, 06 · **Status**: PENDING

### What to build
`src/viewport/pointer-router.ts`: the pure `classifyMode(gesture, hitMesh)` decision function (Node-tested), plus the event wiring that classifies the gesture on pointer-down (1-finger vs 2-finger vs pinch vs pan modifier; mouse left/right/middle + scroll; pinch as `wheel`+`ctrlKey` on trackpads) and routes: **sculpt** → `engine.beginStroke/updateStroke(hit|null)/endStroke`; **camera** → the Task 05 controller. Mode is fixed at pointer-down for the whole gesture. Implements the full FR-14 gesture table and the FR-15 "always orbit" (2-finger / right-drag) over the model.

### Acceptance criteria
- [ ] `classifyMode` returns `sculpt` only for `primary-drag` + `hitMesh=true`; `camera` otherwise (full truth table, Node-tested)
- [ ] Dragging on the model (primary input) sculpts (Draw visibly raises the surface); dragging empty space orbits
- [ ] 2-finger drag (trackpad) / right-drag (mouse) orbits even when starting on the model
- [ ] Pan (Shift+2-finger / middle / Shift+right) and zoom (pinch / scroll) work; Option/Alt held inverts the brush
- [ ] A gesture that starts as sculpt then moves off-mesh passes `null` and stays in sculpt mode until pointer-up

### Files expected
- `src/viewport/pointer-router.ts`, `+ classifyMode test`, harness wiring

---

## Task: 08 — Brush cursor ring + mirror-plane indicator + setBrushDisplay

**Layer**: Viewport · **Estimate**: 2hr · **Depends on**: 06 · **Status**: PENDING

### What to build
`src/viewport/cursor.ts`: an oriented ring (per the spec's leaning answer — simplest, revisit if it reads poorly on high curvature) that follows the hovered surface point, oriented to the normal, sized to `BrushDisplayConfig.cursorRadiusMm`; hidden off-mesh or during a camera gesture. A subtle mirror-plane indicator at x=0 shown when `symmetryX` is on. `Viewport.setBrushDisplay(config)` feeds both without the viewport owning brush state.

### Acceptance criteria
- [ ] The cursor ring tracks the surface under the pointer, sized to the brush radius, and hides off-mesh
- [ ] `setBrushDisplay` changing the radius resizes the ring live
- [ ] The mirror plane shows when `symmetryX` is true and hides when false

### Files expected
- `src/viewport/cursor.ts`, `src/viewport/viewport.ts` (`setBrushDisplay`)

---

## Task: 09 — Viewport facade: attachEngine, lifecycle/dispose hygiene, onFrameStats, perf verification

**Layer**: Viewport · **Estimate**: 3hr · **Depends on**: 04, 05, 07, 08 · **Status**: PENDING

### What to build
Complete `src/viewport/viewport.ts`: `attachEngine(engine)` subscribes to `onChange` (and unsubscribes a prior engine on replace), rebuilding geometry from the new engine's mesh; rigorous `init()`/`dispose()` (idempotent; full teardown of rAF loop, listeners, GPU resources — no context leaks across mount/unmount); `onFrameStats(cb)` reporting fps. Verify the end-to-end performance criteria and dispose hygiene interactively.

### Acceptance criteria
- [ ] A continuous Draw stroke at **Med** detail sustains **≥60 fps including rendering** on the M1 baseline; **≥30 fps at Max** (closes the engine spec's PARTIAL performance gap)
- [ ] `attachEngine` on a second engine unsubscribes the first and renders the new mesh
- [ ] `dispose()` leaves no running rAF loop, no leaked listeners, no WebGL/WebGPU context warnings across repeated mount/unmount
- [ ] React does not re-render per frame or per stroke (render loop + sync are imperative)

### Files expected
- `src/viewport/viewport.ts` (facade completion), harness finalization
