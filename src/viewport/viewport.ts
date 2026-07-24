import { initRenderer, type RendererInitResult, type ViewportInitResult } from './renderer';
import { createScene, type ViewportScene } from './scene';

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
  private resizeObserver: ResizeObserver | undefined;
  private rafHandle: number | null = null;
  private disposed = false;

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
    const result = await initRenderer(this.canvas);

    // `dispose()` can run while this `await` is in flight (e.g. React
    // StrictMode's dev-mode mount -> cleanup -> mount double-invoke,
    // which disposes the first instance before its init() promise ever
    // settles). Without this guard, a disposed instance would still wire
    // up a renderer/scene/resize-observer/render-loop against a canvas
    // that's already been removed from the DOM — which is exactly what
    // produced zero-size WebGPU texture validation errors in practice.
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

    this.viewportScene?.placeholder.geometry.dispose();
    this.viewportScene?.clayMaterial.dispose();
    this.viewportScene = undefined;

    this.renderer?.dispose();
    this.renderer = undefined;
    this.canvas.remove();
  }

  private resize(): void {
    if (!this.renderer) {
      return;
    }
    const { clientWidth, clientHeight } = this.container;
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
      if (this.viewportScene) {
        this.renderer.render(this.viewportScene.scene, this.viewportScene.camera);
      } else {
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
