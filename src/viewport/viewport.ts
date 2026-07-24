import { initRenderer, type RendererInitResult, type ViewportInitResult } from './renderer';

export type { ViewportInitResult, RenderBackend } from './renderer';

/** Neutral dark clear color while there's no scene yet (Task 03 adds one). */
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

  /** Async: initializes the renderer (WebGPU, falling back to WebGL2) and starts the render loop. */
  async init(): Promise<ViewportInitResult> {
    const result = await initRenderer(this.canvas);
    if (!result.ok || !result.renderer) {
      return { ok: false, reason: result.reason };
    }

    this.renderer = result.renderer;
    this.renderer.setClearColor(CLEAR_COLOR);
    this.resize();
    this.startLoop();
    return { ok: true, backend: result.backend };
  }

  /**
   * Stops the render loop and releases the renderer and canvas.
   * Idempotent: safe to call more than once, or before `init()`.
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
    this.renderer?.dispose();
    this.renderer = undefined;
    this.canvas.remove();
  }

  private resize(): void {
    if (!this.renderer) {
      return;
    }
    const { clientWidth, clientHeight } = this.container;
    this.renderer.setSize(clientWidth, clientHeight, false);
  }

  private startLoop(): void {
    const loop = (): void => {
      if (this.disposed || !this.renderer) {
        return;
      }
      // Task 03+ renders an actual scene/camera; for now this just clears
      // the canvas every frame to prove the loop is alive and the
      // backend is really drawing.
      this.renderer.clear();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }
}
