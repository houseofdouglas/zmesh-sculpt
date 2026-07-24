import { useEffect, useRef, useState, type JSX } from 'react';
import { Viewport, type ViewportInitResult } from './viewport/viewport';
import { SculptEngine } from './engine/sculpt-engine';
import styles from './App.module.css';

/** North pole of the default sphere (diameter 50mm, origin-centered) — a stable, known-good hit for a scripted stroke. */
const NORTH_POLE_HIT = { point: [0, 25, 0], normal: [0, 1, 0] } as const;

/**
 * Throwaway dev harness (viewport-rendering spec, Task 01): mounts a
 * Viewport into a container and reports the detected render backend (or
 * the unsupported-browser reason). Each later task in this plan grows
 * what's wired up here — Task 04 adds a real SculptEngine wired via
 * `attachEngine`, replacing the Task 03 placeholder, plus buttons for a
 * scripted stroke and a scripted remesh (both real code paths, not
 * faked) so the partial-update and topology-rebuild paths can be
 * verified visually. The UI spec replaces this file entirely — its
 * eventual deletion is expected, not a regression.
 */
/** Radians per click for the orbit demo buttons — feel-tuned for a visibly-steppable amount. */
const ORBIT_STEP_RADIANS = 0.3;
/** Screen pixels per click for the pan demo buttons. */
const PAN_STEP_PX = 60;
/** Multiplicative zoom factor per click (< 1 zooms in, > 1 zooms out). */
const ZOOM_IN_FACTOR = 0.85;
const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SculptEngine | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [status, setStatus] = useState<ViewportInitResult | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const engine = new SculptEngine();
    engineRef.current = engine;
    const viewport = new Viewport(container);
    viewportRef.current = viewport;
    let cancelled = false;

    void viewport.init().then((result) => {
      if (cancelled) {
        return;
      }
      setStatus(result);
      if (result.ok) {
        viewport.attachEngine(engine);
      }
    });

    return () => {
      cancelled = true;
      viewport.dispose();
      engineRef.current = null;
      viewportRef.current = null;
    };
  }, []);

  function scriptedDrawStroke(): void {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.setBrush('draw');
    engine.setBrushSize(12);
    engine.setBrushStrength(1);
    engine.beginStroke(NORTH_POLE_HIT);
    engine.endStroke();
  }

  function scriptedRemesh(): void {
    void engineRef.current?.setDetail('low');
  }

  return (
    <div className={styles.viewport} ref={containerRef}>
      {status === null && <p className={styles.placeholder}>Initializing renderer…</p>}
      {status !== null && !status.ok && (
        <p className={styles.placeholder}>Viewport unavailable: {status.reason}</p>
      )}
      {status !== null && status.ok && (
        <>
          <p className={styles.placeholder}>backend: {status.backend}</p>
          <div className={styles.devPanel}>
            <button type="button" onClick={scriptedDrawStroke}>
              Scripted Draw stroke
            </button>
            <button type="button" onClick={scriptedRemesh}>
              Scripted remesh (Low)
            </button>
            <button type="button" onClick={() => viewportRef.current?.orbit(-ORBIT_STEP_RADIANS, 0)}>
              Orbit left
            </button>
            <button type="button" onClick={() => viewportRef.current?.orbit(ORBIT_STEP_RADIANS, 0)}>
              Orbit right
            </button>
            <button type="button" onClick={() => viewportRef.current?.orbit(0, ORBIT_STEP_RADIANS)}>
              Orbit up
            </button>
            <button type="button" onClick={() => viewportRef.current?.orbit(0, -ORBIT_STEP_RADIANS)}>
              Orbit down
            </button>
            <button type="button" onClick={() => viewportRef.current?.pan(-PAN_STEP_PX, 0)}>
              Pan left
            </button>
            <button type="button" onClick={() => viewportRef.current?.pan(PAN_STEP_PX, 0)}>
              Pan right
            </button>
            <button type="button" onClick={() => viewportRef.current?.zoom(ZOOM_IN_FACTOR)}>
              Zoom in
            </button>
            <button type="button" onClick={() => viewportRef.current?.zoom(ZOOM_OUT_FACTOR)}>
              Zoom out
            </button>
            <button type="button" onClick={() => viewportRef.current?.frameModel()}>
              Frame model
            </button>
          </div>
        </>
      )}
    </div>
  );
}
