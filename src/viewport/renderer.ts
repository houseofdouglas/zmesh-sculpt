import { WebGPURenderer } from 'three/webgpu';

export type RenderBackend = 'webgpu' | 'webgl2';

export interface ViewportInitResult {
  ok: boolean;
  /** present when ok */
  backend?: RenderBackend;
  /** present when !ok — feeds the UI's unsupported-browser notice */
  reason?: string;
}

export interface RendererInitResult extends ViewportInitResult {
  renderer?: WebGPURenderer;
}

/**
 * Initializes a Three.js `WebGPURenderer`, which itself automatically uses
 * WebGPU where available and falls back to WebGL2 otherwise (constitution).
 * Never throws — resolves `{ ok:false, reason }` when neither backend is
 * available (or init otherwise fails), so callers can show the
 * unsupported-browser notice (spec Flow 1) instead of a broken canvas.
 */
export async function initRenderer(canvas: HTMLCanvasElement): Promise<RendererInitResult> {
  if (!hasAnyGpuBackend()) {
    return {
      ok: false,
      reason: 'Neither WebGPU nor WebGL2 is available in this browser.',
    };
  }

  const renderer = new WebGPURenderer({ canvas, antialias: true });

  try {
    await renderer.init();
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'The renderer failed to initialize.',
    };
  }

  // renderer.backend is typed as the abstract base `Backend`; the
  // WebGPU/WebGL2-specific flags only exist on its concrete subclasses,
  // so `in` doubles as both the runtime check and the type guard.
  const isWebGPU = 'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend;
  const backend: RenderBackend = isWebGPU ? 'webgpu' : 'webgl2';
  return { ok: true, backend, renderer };
}

/**
 * Cheap pre-flight check for the true failure case (spec FR-2): neither
 * backend exists at all. `WebGPURenderer` already handles the WebGPU ->
 * WebGL2 fallback internally, so this only needs to rule out the case
 * where *both* are absent, before we even construct a renderer.
 */
function hasAnyGpuBackend(): boolean {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null) {
    return true;
  }
  if (typeof document === 'undefined') {
    return false;
  }
  const probe = document.createElement('canvas');
  return probe.getContext('webgl2') != null;
}
