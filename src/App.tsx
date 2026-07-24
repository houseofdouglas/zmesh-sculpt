import { useEffect, useRef, useState, type JSX } from 'react';
import { Viewport, type ViewportInitResult } from './viewport/viewport';
import styles from './App.module.css';

/**
 * Throwaway dev harness (viewport-rendering spec, Task 01): mounts a
 * Viewport into a container and reports the detected render backend (or
 * the unsupported-browser reason). Each later task in this plan grows
 * what's wired up here. The UI spec replaces this file entirely — its
 * eventual deletion is expected, not a regression.
 */
export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ViewportInitResult | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const viewport = new Viewport(container);
    let cancelled = false;

    void viewport.init().then((result) => {
      if (!cancelled) {
        setStatus(result);
      }
    });

    return () => {
      cancelled = true;
      viewport.dispose();
    };
  }, []);

  return (
    <div className={styles.viewport} ref={containerRef}>
      {status === null && <p className={styles.placeholder}>Initializing renderer…</p>}
      {status !== null && !status.ok && (
        <p className={styles.placeholder}>Viewport unavailable: {status.reason}</p>
      )}
      {status !== null && status.ok && (
        <p className={styles.placeholder}>backend: {status.backend}</p>
      )}
    </div>
  );
}
