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
export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SculptEngine | null>(null);
  const [status, setStatus] = useState<ViewportInitResult | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const engine = new SculptEngine();
    engineRef.current = engine;
    const viewport = new Viewport(container);
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
          </div>
        </>
      )}
    </div>
  );
}
