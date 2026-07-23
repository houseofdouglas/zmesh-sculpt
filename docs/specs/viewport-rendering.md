# Spec: Viewport & Rendering

**Status**: APPROVED
**Created**: 2026-07-23
**Last Updated**: 2026-07-23
**Related Specs**: `sculpt-engine-core` (consumed — this layer drives its stroke lifecycle and renders its mesh). Downstream: UI (toolbars/panels, a later spec) mounts and configures this viewport.

---

## Overview

**Summary**: The Three.js rendering layer that draws the live sculpt mesh, runs the camera, turns pointer input into either camera moves or `SurfaceHit`s fed to the engine, and shows the brush cursor and mirror plane — all in a render loop that lives entirely outside React.

**User Roles**: Hobbyist sculptor (this is the surface they actually look at and drag on — but it has no chrome; toolbars/panels are the UI layer).

**Why**: `sculpt-engine-core` is headless — it deforms typed arrays but nothing is visible and nothing drives it. This layer is what makes sculpting real: it renders the mesh at 60fps, translates a drag on the model into a brush stroke (and a drag on empty space into an orbit), and reflects every deformation back to the screen incrementally. It is also the layer where the engine's performance NFRs become observable end-to-end (real fps, not just CPU-side stamp cost).

**Scope**: `src/viewport/` — Three.js scene/camera/lights, the mesh↔GPU buffer bridge, raycasting/picking, the pointer→(camera | stroke) router, and the brush-cursor and mirror-plane visuals. It consumes the `SculptEngine` API and is configured by the UI layer (brush display radius, symmetry on/off). It does **not** own brush *state*, any DOM chrome, export, or persistence — see Out of Scope.

---

## User Stories

- As a **sculptor**, I want the model to update the instant I drag on it, so sculpting feels like clay, not a batch process.
- As a **sculptor**, I want to orbit/pan/zoom to see my work from any angle, using the same one-handed trackpad gestures settled in the wireframe.
- As a **sculptor**, I want a cursor ring on the surface showing where and how big my brush is, so I can aim before committing a stroke.
- As a **sculptor**, I want to see the mirror plane when symmetry is on, so I understand why both sides are changing.
- As the **UI layer**, I want to mount a viewport onto a canvas, point it at an engine, push brush-display config to it, and dispose it cleanly, without touching Three.js myself.

---

## Functional Requirements

**Renderer & lifecycle**
1. The viewport shall render with Three.js `WebGPURenderer`, which uses WebGPU where available and falls back to WebGL2 automatically (constitution).
2. Initialization shall be async and report which backend was selected, or report a capability failure if neither WebGPU nor WebGL2 is available (the UI turns that failure into the unsupported-browser notice, Flow 1 — the viewport itself never renders a broken canvas).
3. The viewport shall mount onto a caller-provided container/canvas, run its own `requestAnimationFrame` loop, and expose a `dispose()` that stops the loop and releases all GPU resources and event listeners.
4. The render loop shall run independently of React — no React re-render occurs per frame or per stroke (constitution invariant).

**Mesh rendering & sync**
5. The viewport shall render the engine's current mesh as a `THREE.Mesh` whose `BufferGeometry` is backed by the engine's `positions`/`normals`/`indices` typed arrays.
6. On each engine `onChange(region)`, the viewport shall upload only the changed vertex range (`region.vertexStart..vertexEnd`) to the GPU (partial buffer update), not the whole buffer.
7. On a topology change (a full-mesh dirty region, i.e. a remesh or a new/loaded mesh), the viewport shall rebuild the geometry with the new buffers and counts.
8. The mesh shall be shaded with a neutral matte "clay" material and lighting that reads form clearly from any angle (default; selectable presets are FR-31/COULD, out of scope here).

**Camera**
9. The viewport shall provide orbit, pan, and zoom around a target point, in millimeter world space.
10. On mount and on any new/loaded mesh (not on a remesh, which preserves silhouette), the camera shall frame the model to fit the view.

**Input routing (the settled model)**
11. On pointer-down, the viewport shall raycast against the mesh and choose a mode for that gesture: **sculpt** if the gesture is the "primary" input *and* it hit the mesh; **camera** otherwise (primary input on empty space, or any "secondary" input).
12. In **sculpt** mode, the viewport shall call `engine.beginStroke(hit)` / `updateStroke(hit | null)` / `endStroke()`, passing `null` on moves where the pointer has left the mesh.
13. In **camera** mode, the viewport shall manipulate its own camera and shall not call any engine stroke method.
14. The gesture mapping shall be:

| Device | Sculpt | Orbit | Pan | Zoom | Invert brush |
|---|---|---|---|---|---|
| **Trackpad** | 1-finger drag on model | 1-finger drag on empty · **2-finger drag (always)** | Shift + 2-finger drag | Pinch | Option held |
| **Mouse** | Left-drag on model | Left-drag on empty · right-drag (always) | Middle-drag · Shift+right-drag | Scroll | Alt held |

15. The "always" orbit (2-finger / right-drag) shall orbit even when the pointer is over the model, so the user can reframe when the model fills the view (replaces the dropped Hold-Space idea).

**Picking / SurfaceHit**
16. The viewport shall build the `SurfaceHit` the engine consumes: `point` and interpolated `normal` at the ray-mesh intersection, and `worldDelta` for Grab.
17. `worldDelta` shall be the cursor's frame-to-frame motion projected onto the plane through the grab point facing the camera (so a Grab drag tracks the cursor in screen space at the model's depth).

**Brush cursor & mirror plane**
18. When the pointer is over the mesh, the viewport shall show a cursor ring on the surface, centered at the hit point, oriented to the surface normal, sized to the current brush display radius; it shall hide when the pointer leaves the mesh or a camera gesture is active.
19. When symmetry is on (as told by the UI/engine config), the viewport shall show a subtle mirror-plane indicator at x=0; it shall hide when symmetry is off.

**Configuration from UI**
20. The viewport shall accept brush **display** config from the UI — cursor radius (the same mm value the UI passes to `engine.setBrushSize`) and symmetry on/off — without itself owning brush state.

---

## Architecture & Module Layout

```
src/viewport/                    (Three.js; browser-only glue kept thin)
  viewport.ts                    Viewport facade: mount/dispose, render loop, wires the pieces
  renderer.ts                    WebGPURenderer init + backend/capability detection
  scene.ts                       scene graph: lights, clay material, the mesh object
  mesh-sync.ts                   SculptMesh + DirtyRegion -> BufferGeometry (partial uploads, rebuilds)
  camera-controller.ts           orbit/pan/zoom camera math around a target; framing
  pointer-router.ts              pointer events -> {sculpt | camera} decision + gesture classification
  picking.ts                     raycast -> SurfaceHit; grab worldDelta projection
  cursor.ts                      brush-cursor ring + mirror-plane objects
  math/                          pure, Node-testable helpers (see testing note)
    spherical-camera.ts          target+spherical<->matrix, framing-distance-for-bounds
    grab-projection.ts           screen-delta -> world-delta on the camera-facing plane
    dirty-range.ts               DirtyRegion -> BufferAttribute updateRange
```

**Testing strategy** (same split the engine's worker glue used): the genuinely testable logic — spherical-camera math, the grab-delta projection, dirty-range→updateRange mapping, and the pointer-gesture classification decision table — is extracted into pure functions under `math/` and `pointer-router`'s decision logic, unit-tested in Node. The Three.js integration (actual GPU buffers, real raycasting, the render loop) is thin glue verified interactively in the browser per the constitution's Definition of Done. There is no headless GPU in this project's Vitest environment.

---

## Data Model / Interfaces

The imperative API the UI layer consumes.

```typescript
type RenderBackend = 'webgpu' | 'webgl2';

interface ViewportInitResult {
  ok: boolean;
  backend?: RenderBackend;     // present when ok
  reason?: string;             // present when !ok — feeds the UI's unsupported-browser notice
}

interface BrushDisplayConfig {
  cursorRadiusMm: number;      // mirrors the value UI passes to engine.setBrushSize
  symmetryX: boolean;          // mirrors engine symmetry; drives the mirror-plane indicator
}

interface Viewport {
  // lifecycle
  init(): Promise<ViewportInitResult>;   // async: WebGPURenderer init + capability check
  dispose(): void;                       // stop loop, free GPU + listeners; idempotent

  // wiring
  attachEngine(engine: SculptEngine): void;   // subscribes to onChange; renders its mesh
  setBrushDisplay(config: BrushDisplayConfig): void;

  // camera
  frameModel(): void;                    // fit camera to current mesh bounds

  // optional observability (mirrors the engine's additive progress hook style)
  onFrameStats(cb: (stats: { fps: number }) => void): () => void;
}

// Construction: new Viewport(container: HTMLElement)
```

Consumed from `sculpt-engine-core` unchanged: `SculptEngine` (`onChange`, `getMesh`, `beginStroke`/`updateStroke`/`endStroke`), `SurfaceHit`, `DirtyRegion`, `SculptMesh`.

**Pure helper contracts** (the Node-tested core of this layer):

```typescript
// math/spherical-camera.ts
function framingDistance(boundsDiagonalMm: number, fovYRadians: number): number;
function sphericalToPosition(target: Vec3, radius: number, yaw: number, pitch: number): Vec3;

// math/grab-projection.ts — screen-space delta to world-space delta at the grab point's depth
function projectScreenDeltaToWorld(
  grabPoint: Vec3, cameraPosition: Vec3, cameraForward: Vec3, cameraUp: Vec3,
  screenDx: number, screenDy: number, viewportHeightPx: number, fovYRadians: number,
): Vec3;

// math/dirty-range.ts — half-open [start,end) vertices -> BufferAttribute element range
function vertexRangeToAttributeRange(vertexStart: number, vertexEnd: number): { offset: number; count: number };

// pointer-router.ts — the decision table, as a pure function
type GestureKind = 'primary-drag' | 'secondary-drag' | 'pan-drag' | 'zoom';
function classifyMode(gesture: GestureKind, hitMesh: boolean): 'sculpt' | 'camera';
```

---

## Error States & Edge Cases

| Scenario | What Happens |
|---|---|
| Neither WebGPU nor WebGL2 available | `init()` resolves `{ ok:false, reason }`; nothing is mounted; UI shows the unsupported notice (Flow 1). |
| Pointer-down misses the mesh (primary input) | Classified as camera (orbit); no stroke begins. |
| Pointer leaves the mesh mid-stroke | `updateStroke(null)` — engine treats it as a safe no-op / breaks stamp continuity; the stroke stays open until pointer-up. |
| A drag begins as sculpt, then the pointer moves off-mesh and back | Stays in sculpt mode for the whole gesture (mode is fixed at pointer-down, per FR-11); off-mesh frames pass `null`. |
| Secondary input (2-finger / right-drag) starting on the model | Orbits anyway (FR-15) — never sculpts. |
| Remesh swaps the mesh mid-session | Full-mesh dirty region → geometry rebuilt; camera **not** reframed (silhouette preserved); brush cursor re-derived on next hover. |
| `onChange` fires with a vertex range beyond current buffer (stale, post-topology-change) | Ignored/guarded; the topology-change rebuild is authoritative. |
| Container resized (or devicePixelRatio change) | Renderer size + camera aspect updated; no reallocation of mesh buffers. |
| `dispose()` called twice, or before `init()` | Idempotent no-op; never throws. |
| Engine detached / replaced | Unsubscribes the old `onChange`; subscribes the new; rebuilds geometry from the new engine's mesh. |

---

## Acceptance Criteria

### Node-testable (pure helpers)
- [ ] `classifyMode` returns `sculpt` only for `primary-drag` + `hitMesh=true`; `camera` for every other combination (full truth table).
- [ ] `framingDistance` returns a distance at which a sphere of the given bounds diagonal fits within the vertical FOV (projected extent ≤ view height at that distance).
- [ ] `projectScreenDeltaToWorld` maps a horizontal screen delta to a world vector lying in the camera-facing plane through the grab point, with magnitude scaling correctly with depth (2× distance → 2× world delta for the same pixel delta).
- [ ] `vertexRangeToAttributeRange` converts a half-open vertex range to the correct element offset/count for an interleaved xyz `BufferAttribute`.

### Browser-verified (interactive, per Definition of Done)
- [ ] The default sphere renders, shaded and framed, on load.
- [ ] Dragging on the model with the primary input deforms it live (Draw visibly raises the surface); dragging on empty space orbits instead.
- [ ] 2-finger drag (trackpad) / right-drag (mouse) orbits even when starting on the model.
- [ ] A continuous Draw stroke at the **Med** detail level sustains **≥60 fps including rendering** on the M1 baseline (this is the end-to-end version of the engine's Q-01 criterion — closes the acceptance gap that a headless benchmark left open); **≥30 fps at Max**.
- [ ] The brush cursor ring tracks the surface under the pointer, sized to the brush radius, and hides off-mesh.
- [ ] With symmetry on, the mirror plane is visible and both sides of the model update from one stroke; turning it off hides the plane.
- [ ] A remesh (detail change) rebuilds the mesh without reframing the camera and without a visible full-buffer stall.
- [ ] `dispose()` leaves no running rAF loop, no leaked listeners, and no WebGL/WebGPU context warnings.

---

## Non-Functional Requirements

- **Performance**: ≥60 fps at Med / ≥30 fps at Max including render, on the M1 baseline (NFR-01, now measured end-to-end). Per-stroke work must not allocate on the hot path; buffer uploads are partial (changed range only).
- **No React churn**: the render loop and buffer sync are imperative; React never re-renders per frame or per stroke (constitution).
- **Resource hygiene**: `dispose()` fully tears down; no context leaks across mount/unmount cycles.
- **Purity/testability**: `src/viewport/math/` and the router decision logic import no Three.js/DOM and are Node-tested; Three.js glue is browser-verified.

---

## Out of Scope

- Toolbars, panels, sliders, the dimension readout, the detail slider UI — the **UI** layer (a later spec). This layer only takes `BrushDisplayConfig` in.
- Brush **state** ownership (type/size/strength/invert) — owned by UI/engine; the viewport only knows a display radius and symmetry flag.
- The printer-bed visualization and bed-fit preview — Export/UI (the wireframe puts it in the export panel).
- Material/lighting preset selection (FR-31), touch/stylus pressure (FR-30) — COULD, deferred.
- STL/3MF export, `.zmesh` persistence, thumbnails — their own specs.
- Raycasting acceleration beyond Three.js's built-in `Raycaster` — added only if picking shows up as a profiled bottleneck (noted, not built).

---

## Open Questions

| Question | Owner | Resolution |
|---|---|---|
| Camera math in-house vs. Three.js `OrbitControls`? | Impl (Task 1) | Leaning in-house (`spherical-camera.ts`) — the sculpt-vs-camera routing needs to own pointer-down anyway, and OrbitControls would fight it; in-house is also the more educational path. Confirm at implementation. |
| Brush cursor as oriented ring geometry vs. projected decal? | Impl | Start with an oriented ring (simplest, no decal pipeline); revisit if it reads poorly on high-curvature surfaces. |
| Does the viewport need the engine's brush radius directly (add a getter) or only via `BrushDisplayConfig` from UI? | Impl | Default to `BrushDisplayConfig` (keeps viewport decoupled from engine brush internals); avoids adding engine getters. |
