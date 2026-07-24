import { Raycaster } from 'three';
import { initRenderer, type RendererInitResult, type ViewportInitResult } from './renderer';
import { createScene, type ViewportScene } from './scene';
import { createMeshSync, type MeshSync } from './mesh-sync';
import { CameraController } from './camera-controller';
import { computeGrabWorldDelta, pickSurfaceHit, pixelToNdc } from './picking';
import type { SculptEngine } from '../engine/sculpt-engine';
import type { SurfaceHit } from '../engine/stroke';
import type { Vec3 } from './math/vec3';

export type { ViewportInitResult, RenderBackend } from './renderer';

/** Canvas background where the scene doesn't otherwise draw. */
const CLEAR_COLOR = 0x1a1a1a;

/**
 * The object the UI layer mounts, configures, and disposes (spec's Data
 * Model / Interfaces section). This task establishes the lifecycle shell:
 * mount a canvas, init the renderer, run/stop a render loop, and tear
 * down cleanly. Scene contents (Task 03), mesh sync (Task 04), camera
 * (Task 05), input (Task 07), and brush display (Task 08) are added by
 * later tasks in this plan — this class grows incrementally, the same
 * way `SculptEngine` did across the engine spec's tasks.
 */
export class Viewport {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: NonNullable<RendererInitResult['renderer']> | undefined;
  private viewportScene: ViewportScene | undefined;
  private cameraController: CameraController | undefined;
  private placeholderActive = true;
  private meshSync: MeshSync | undefined;
  private meshSyncUnsubscribe: (() => void) | undefined;
  private attachedEngine: SculptEngine | undefined;
  private readonly raycaster = new Raycaster();
  private resizeObserver: ResizeObserver | undefined;
  private rafHandle: number | null = null;
  private disposed = false;
  /** Set only while `initRenderer` is in flight — see `dispose()`'s canvas-removal guard. */
  private pendingRendererInit: Promise<RendererInitResult> | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    // Absolutely positioned to fill the container regardless of the
    // container's own layout mode (flex/grid alignment can otherwise
    // leave a plain block/percentage-sized canvas at its intrinsic
    // 300x150 default) — the container just needs position:relative.
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.appendChild(this.canvas);
  }

  /** Async: initializes the renderer (WebGPU, falling back to WebGL2), builds the scene, and starts the render loop. */
  async init(): Promise<ViewportInitResult> {
    const pending = initRenderer(this.canvas);
    this.pendingRendererInit = pending;
    const result = await pending;
    this.pendingRendererInit = undefined;

    // `dispose()` can run while the above `await` is in flight (e.g.
    // React StrictMode's dev-mode mount -> cleanup -> mount
    // double-invoke, which disposes the first instance before its
    // init() promise ever settles). Without this guard, a disposed
    // instance would still wire up a renderer/scene/resize-observer/
    // render-loop against a canvas that's already been removed from the
    // DOM. `dispose()` itself additionally defers the canvas's actual
    // removal until this same in-flight call settles — see there for
    // why: it's not enough to just bail out *here*.
    if (this.disposed) {
      result.renderer?.dispose();
      return { ok: false, reason: 'viewport was disposed before init() completed' };
    }
    if (!result.ok || !result.renderer) {
      return { ok: false, reason: result.reason };
    }

    this.renderer = result.renderer;
    this.renderer.setClearColor(CLEAR_COLOR);

    const { clientWidth, clientHeight } = this.container;
    this.viewportScene = createScene(safeAspect(clientWidth, clientHeight));
    // Reuses the exact distance scene.ts already used to frame the
    // placeholder (rather than recomputing it) so constructing the
    // controller here reproduces the identical camera transform with no
    // visible jump — yaw/pitch default to 0, matching scene.ts's own
    // static (0,0,distance)-looking-at-origin setup.
    this.cameraController = new CameraController(this.viewportScene.camera, {
      radius: this.viewportScene.initialCameraDistanceMm,
    });
    this.resize();

    // A ResizeObserver on the container (not a window 'resize' listener)
    // catches layout-driven size changes too — e.g. a sidebar toggling —
    // not just the browser window itself. Resize only touches renderer
    // size/pixel-ratio and camera aspect, never mesh buffers.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.startLoop();
    return { ok: true, backend: result.backend };
  }

  /**
   * Wires a `SculptEngine`'s mesh into the scene (FR-5/6/7): builds a
   * `MeshSync` from the engine's current mesh, replaces the Task 03
   * placeholder with it, and subscribes to `onChange` so every
   * subsequent stamp/stroke/remesh updates the GPU buffers.
   *
   * Basic version — this task's own scope. Task 09 completes the full
   * `attachEngine` contract (unsubscribing a *previous* engine when a
   * second is attached); calling this twice today would leak the first
   * `MeshSync`/subscription rather than replacing them cleanly.
   */
  attachEngine(engine: SculptEngine): void {
    if (!this.viewportScene) {
      return; // init() hasn't completed yet — nothing to attach to
    }

    if (this.placeholderActive) {
      this.viewportScene.scene.remove(this.viewportScene.placeholder);
      this.viewportScene.placeholder.geometry.dispose();
      this.placeholderActive = false;
    }

    this.meshSync = createMeshSync(this.viewportScene.clayMaterial, engine.getMesh());
    this.viewportScene.scene.add(this.meshSync.mesh);
    this.meshSyncUnsubscribe = engine.onChange((region) => {
      this.meshSync?.sync(engine.getMesh(), region);
    });

    this.attachedEngine = engine;
    // FR-10: frame on mount / attach (this call) and on a new/loaded
    // mesh — not on a remesh. There's no re-attach or reload path wired
    // up yet (both are later-task scope: reframing on a *subsequent*
    // loadMesh/newFromPrimitive on an already-attached engine needs a
    // signal this basic onChange-only wiring can't yet distinguish from
    // a remesh, since both currently produce an identical full-mesh
    // DirtyRegion — left open for whoever completes that distinction).
    this.frameModel();
  }

  /** Fits the camera to the attached engine's current mesh bounds (FR-10). A no-op if no engine is attached yet. */
  frameModel(): void {
    if (!this.attachedEngine) {
      return;
    }
    this.cameraController?.frame(this.attachedEngine.getMesh().bounds);
  }

  /**
   * Temporary, non-spec exposure for this task's own manual verification
   * (its own text: "exercised from the harness with temporary buttons or
   * keys") — orbit/pan/zoom aren't part of the spec's public `Viewport`
   * API (only `frameModel` is); Task 07 will likely have the pointer
   * router call `CameraController` directly rather than needing these
   * kept around.
   */
  orbit(deltaYaw: number, deltaPitch: number): void {
    this.cameraController?.orbit(deltaYaw, deltaPitch);
  }

  pan(screenDx: number, screenDy: number): void {
    this.cameraController?.pan(screenDx, screenDy, this.container.clientHeight);
  }

  zoom(scaleFactor: number): void {
    this.cameraController?.zoom(scaleFactor);
  }

  /**
   * Raycasts from a pointer position (in container-relative pixels)
   * against the attached mesh, returning a `SurfaceHit` or `null` on a
   * miss (FR-16). Temporary, non-spec exposure for this task's own
   * manual verification, same rationale as `orbit`/`pan`/`zoom` — Task 07
   * will likely have the pointer router call `picking.ts` directly.
   */
  pick(pixelX: number, pixelY: number): SurfaceHit | null {
    if (!this.viewportScene || !this.meshSync) {
      return null;
    }
    const { x, y } = pixelToNdc(pixelX, pixelY, this.container.clientWidth, this.container.clientHeight);
    return pickSurfaceHit(this.raycaster, this.viewportScene.camera, this.meshSync.mesh, x, y);
  }

  /**
   * Grab's `worldDelta` (FR-17) at `grabPoint`'s depth, for this frame's
   * screen-pixel motion. Temporary, non-spec exposure — same rationale
   * as `pick`.
   */
  grabDelta(grabPoint: Vec3, screenDx: number, screenDy: number): Vec3 | null {
    if (!this.viewportScene) {
      return null;
    }
    return computeGrabWorldDelta(
      this.viewportScene.camera,
      grabPoint,
      screenDx,
      screenDy,
      this.container.clientHeight,
    );
  }

  /**
   * Stops the render loop and releases the renderer, scene resources,
   * observers, and canvas. Idempotent: safe to call more than once, or
   * before `init()`.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    this.meshSyncUnsubscribe?.();
    this.meshSyncUnsubscribe = undefined;
    this.meshSync?.dispose();
    this.meshSync = undefined;
    this.attachedEngine = undefined;
    this.cameraController = undefined;

    if (this.placeholderActive) {
      this.viewportScene?.placeholder.geometry.dispose();
    }
    this.viewportScene?.clayMaterial.dispose();
    this.viewportScene = undefined;

    this.renderer?.dispose();
    this.renderer = undefined;

    if (this.pendingRendererInit) {
      // `initRenderer` is still awaiting `renderer.init()` internally,
      // which can still be mid-way through configuring a WebGPU context
      // against `this.canvas` (querying its size to set up the
      // swapchain). Detaching the canvas from the DOM right now would
      // do so *while that's happening* — a detached element's size
      // collapses to 0 immediately — which is exactly what produced a
      // cascade of "zero-size texture" WebGPU validation errors in
      // practice. Deferring removal until that call has fully settled
      // (success or failure, hence `finally`) avoids the race entirely;
      // the `this.disposed` check inside `init()` still guarantees
      // nothing gets wired up once it does.
      void this.pendingRendererInit.finally(() => this.canvas.remove());
    } else {
      this.canvas.remove();
    }
  }

  private resize(): void {
    if (!this.renderer) {
      return;
    }
    const { clientWidth, clientHeight } = this.container;
    // The container can genuinely report 0x0 on the very first resize
    // pass (both the manual call here at the end of init(), and
    // ResizeObserver's own first callback) — the browser hasn't finished
    // laying out the container yet at that early point, even though it
    // settles to the real size moments later. Configuring the renderer's
    // swapchain at 0x0 is what produced a cascade of WebGPU "zero-size
    // texture" validation errors in practice; skipping the resize
    // entirely here (rather than passing the degenerate size through)
    // avoids that — a later resize (the real one) corrects the size
    // once layout has actually happened.
    if (clientWidth === 0 || clientHeight === 0) {
      return;
    }

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(clientWidth, clientHeight, false);

    if (this.viewportScene) {
      this.viewportScene.camera.aspect = safeAspect(clientWidth, clientHeight);
      this.viewportScene.camera.updateProjectionMatrix();
    }
  }

  private startLoop(): void {
    const loop = (): void => {
      if (this.disposed || !this.renderer) {
        return;
      }
      // Defense in depth alongside the `resize()` guard above: never
      // draw with a degenerate container size.
      if (this.viewportScene && this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.renderer.render(this.viewportScene.scene, this.viewportScene.camera);
      } else if (!this.viewportScene) {
        this.renderer.clear();
      }
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }
}

/** Guards against a zero-height container (e.g. mid-layout) producing a NaN/Infinity aspect ratio. */
function safeAspect(width: number, height: number): number {
  return height > 0 ? width / height : 1;
}
