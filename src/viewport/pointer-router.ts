import type { SculptEngine } from '../engine/sculpt-engine';
import type { SurfaceHit } from '../engine/stroke';
import type { CameraController } from './camera-controller';

export type GestureKind = 'primary-drag' | 'secondary-drag' | 'pan-drag' | 'zoom';

/**
 * The FR-11/14/15 mode decision, as a pure function: `sculpt` only for a
 * primary-input drag that hit the mesh; `camera` for everything else —
 * including a primary drag over empty space, and a secondary/pan/zoom
 * gesture even when it starts over the model (FR-15's "always orbit").
 */
export function classifyMode(gesture: GestureKind, hitMesh: boolean): 'sculpt' | 'camera' {
  return gesture === 'primary-drag' && hitMesh ? 'sculpt' : 'camera';
}

export interface PointerDownInfo {
  /** PointerEvent.button: 0 = primary/left, 1 = middle, 2 = secondary/right. */
  button: number;
  shiftKey: boolean;
}

/**
 * Classifies a `pointerdown` into a gesture kind (FR-14's device table).
 * A trackpad's 1-finger drag and an actual mouse's left-drag both arrive
 * as `button === 0` — the browser/OS already normalizes a trackpad
 * "secondary click" configuration to `button === 2` too, so no separate
 * trackpad-specific branch is needed here. Shift turns a right-drag into
 * a pan rather than an orbit (Mouse row: "Middle-drag · Shift+right-drag").
 */
export function classifyPointerDownGesture(info: PointerDownInfo): GestureKind {
  if (info.button === 2) {
    return info.shiftKey ? 'pan-drag' : 'secondary-drag';
  }
  if (info.button === 1) {
    return 'pan-drag';
  }
  return 'primary-drag';
}

export interface WheelGestureInfo {
  ctrlKey: boolean;
  shiftKey: boolean;
}

export type WheelGestureKind = 'zoom' | 'pan' | 'orbit';

/**
 * Classifies a `wheel` event (FR-14's trackpad row: 2-finger drag,
 * shift+2-finger, and pinch all arrive as `wheel`, not pointer, events —
 * there is no pointer-event-level "how many fingers" signal on desktop
 * browsers). `ctrlKey` is the long-standing, cross-browser signal a
 * trackpad pinch gesture sets; `shiftKey` signals pan.
 *
 * An unmodified wheel event defaults to **orbit**, not zoom — a
 * deliberate choice for this trackpad-first app (FR-15: 2-finger drag
 * always orbits) over the more common "plain scroll = zoom" convention,
 * since JS cannot actually distinguish a trackpad's unmodified 2-finger
 * drag from a physical mouse's scroll wheel at the `wheel`-event level.
 * A mouse's zoom is still reachable via ctrl+scroll (the same pinch
 * path). See the plan's Decisions & Notes for the full tradeoff.
 */
export function classifyWheelGesture(info: WheelGestureInfo): WheelGestureKind {
  if (info.ctrlKey) {
    return 'zoom';
  }
  if (info.shiftKey) {
    return 'pan';
  }
  return 'orbit';
}

/** Radians of camera orbit per pixel of drag motion — feel-tuned. */
const DRAG_ORBIT_RADIANS_PER_PIXEL = 0.005;
/** Radians of camera orbit per wheel-delta unit — feel-tuned; wheel deltas run larger than drag pixels per event. */
const WHEEL_ORBIT_RADIANS_PER_UNIT = 0.003;
/** Camera zoom-factor change per wheel deltaY unit — feel-tuned. */
const WHEEL_ZOOM_SENSITIVITY = 0.002;

interface ActiveGesture {
  gestureKind: GestureKind;
  mode: 'sculpt' | 'camera';
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
}

export interface PointerRouterDeps {
  canvas: HTMLCanvasElement;
  cameraController: CameraController;
  /** Looked up fresh on every use — the attached engine can change (or not exist yet). */
  getEngine: () => SculptEngine | undefined;
  pick: (pixelX: number, pixelY: number) => SurfaceHit | null;
  getViewportHeightPx: () => number;
}

/**
 * The event wiring half of this module (FR-11 through FR-15): attaches
 * `pointerdown`/`pointermove`/`pointerup`/`wheel` listeners to the
 * canvas and routes each gesture to either the engine's stroke lifecycle
 * or the camera controller, using `classifyMode`/`classifyPointerDownGesture`/
 * `classifyWheelGesture` above for the actual decisions.
 *
 * Mode is fixed at pointer-down for the whole gesture (FR-11/edge case:
 * a drag that starts as sculpt and later moves off-mesh stays in sculpt,
 * passing `null` rather than switching to camera mid-drag).
 */
export class PointerRouter {
  private readonly deps: PointerRouterDeps;
  private activeGesture: ActiveGesture | null = null;

  constructor(deps: PointerRouterDeps) {
    this.deps = deps;
    deps.canvas.addEventListener('pointerdown', this.handlePointerDown);
    deps.canvas.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    deps.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    // A right-drag is a real gesture here (secondary-drag = orbit), not
    // a request for the browser's own context menu.
    deps.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  /** Removes every listener this instance attached. Idempotent-safe: removing an already-removed listener is a no-op in the DOM. */
  dispose(): void {
    this.deps.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.deps.canvas.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.deps.canvas.removeEventListener('wheel', this.handleWheel);
    this.deps.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.activeGesture = null;
  }

  private pixelPosition(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.deps.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    try {
      this.deps.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nice-to-have (keeps a drag tracking smoothly if the
      // cursor briefly leaves the canvas bounds) — a rare pointerId edge
      // case failing it shouldn't abort the rest of gesture handling.
    }

    const gestureKind = classifyPointerDownGesture({ button: event.button, shiftKey: event.shiftKey });
    const { x, y } = this.pixelPosition(event.clientX, event.clientY);
    const hit = this.deps.pick(x, y);
    const mode = classifyMode(gestureKind, hit !== null);

    this.activeGesture = {
      gestureKind,
      mode,
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };

    if (mode === 'sculpt' && hit) {
      const engine = this.deps.getEngine();
      engine?.setInvert(event.altKey);
      engine?.beginStroke(hit);
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const gesture = this.activeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - gesture.lastClientX;
    const dy = event.clientY - gesture.lastClientY;
    gesture.lastClientX = event.clientX;
    gesture.lastClientY = event.clientY;

    if (gesture.mode === 'sculpt') {
      const { x, y } = this.pixelPosition(event.clientX, event.clientY);
      const hit = this.deps.pick(x, y);
      const engine = this.deps.getEngine();
      engine?.setInvert(event.altKey);
      engine?.updateStroke(hit); // null when the pointer has left the mesh mid-stroke — a safe no-op the engine already handles
      return;
    }

    if (gesture.gestureKind === 'pan-drag') {
      this.deps.cameraController.pan(dx, dy, this.deps.getViewportHeightPx());
    } else {
      // primary-drag over empty space, or secondary-drag (always orbit, FR-15)
      this.deps.cameraController.orbit(dx * DRAG_ORBIT_RADIANS_PER_PIXEL, -dy * DRAG_ORBIT_RADIANS_PER_PIXEL);
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const gesture = this.activeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    if (gesture.mode === 'sculpt') {
      this.deps.getEngine()?.endStroke();
    }
    if (this.deps.canvas.hasPointerCapture(event.pointerId)) {
      this.deps.canvas.releasePointerCapture(event.pointerId);
    }
    this.activeGesture = null;
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const kind = classifyWheelGesture({ ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
    if (kind === 'zoom') {
      this.deps.cameraController.zoom(1 + event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    } else if (kind === 'pan') {
      this.deps.cameraController.pan(event.deltaX, event.deltaY, this.deps.getViewportHeightPx());
    } else {
      this.deps.cameraController.orbit(
        event.deltaX * WHEEL_ORBIT_RADIANS_PER_UNIT,
        -event.deltaY * WHEEL_ORBIT_RADIANS_PER_UNIT,
      );
    }
  };

  private handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
