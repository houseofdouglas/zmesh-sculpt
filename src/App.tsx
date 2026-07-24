import { useEffect, useRef, useState, type JSX } from 'react';
import { Viewport, type ViewportInitResult, type BrushDisplayConfig } from './viewport/viewport';
import { SculptEngine } from './engine/sculpt-engine';
import type { Vec3 } from './viewport/math/vec3';
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
/** mm change per click for the cursor-radius demo buttons. */
const CURSOR_RADIUS_STEP_MM = 2;
/** Stamps in the Task 09 perf-test's scripted continuous stroke. */
const PERF_TEST_STAMP_COUNT = 90;

/** N points along a quarter-circle arc of the given radius, with matching outward normals — a scripted "continuous drag" path. */
function generateArcPath(radiusMm: number, count: number): { point: Vec3; normal: Vec3 }[] {
  const path: { point: Vec3; normal: Vec3 }[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / (count - 1)) * (Math.PI / 2);
    const x = radiusMm * Math.cos(theta);
    const y = radiusMm * Math.sin(theta);
    const len = Math.sqrt(x * x + y * y);
    path.push({ point: [x, y, 0], normal: [x / len, y / len, 0] });
  }
  return path;
}

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SculptEngine | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const hitReadoutRef = useRef<HTMLParagraphElement>(null);
  const lastHitPointRef = useRef<Vec3 | null>(null);
  const brushDisplayRef = useRef<BrushDisplayConfig>({ cursorRadiusMm: 5, symmetryX: true });
  const renderCountRef = useRef(0);
  const [status, setStatus] = useState<ViewportInitResult | null>(null);

  // Task 09 verification: React must never re-render per frame/stroke.
  // A plain useEffect with no dependency array runs after every commit
  // (not merely every render *attempt*, which Strict Mode can double up
  // on its own) — logging the count here makes "did an extra commit
  // happen" directly checkable across a scripted stroke or perf test,
  // both of which drive the engine/viewport entirely outside React state.
  useEffect(() => {
    renderCountRef.current += 1;
    console.log(`[render] App committed ${renderCountRef.current} time(s) total`);
  });

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

  /**
   * Task 06 verification: raycasts under the click and reports the
   * result both to the console (for automated checks) and a small
   * on-screen readout (updated directly on the DOM node, bypassing React
   * state, so this frequent-ish event never triggers a re-render).
   */
  function handleContainerClick(event: React.MouseEvent<HTMLDivElement>): void {
    const container = containerRef.current;
    const viewport = viewportRef.current;
    if (!container || !viewport) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const hit = viewport.pick(event.clientX - rect.left, event.clientY - rect.top);
    const message = hit
      ? `hit: point=[${hit.point.map((n) => n.toFixed(1)).join(', ')}] normal=[${hit.normal.map((n) => n.toFixed(2)).join(', ')}]`
      : 'hit: none (empty space)';
    console.log(`[pick] ${message}`);
    if (hitReadoutRef.current) {
      hitReadoutRef.current.textContent = message;
    }
    lastHitPointRef.current = hit ? [...hit.point] : null;
  }

  /** Task 06 verification: computes Grab's worldDelta at the last picked point's depth for a fixed screen delta. */
  function testGrabDelta(): void {
    const grabPoint = lastHitPointRef.current;
    const viewport = viewportRef.current;
    if (!grabPoint || !viewport) {
      console.log('[grabDelta] no prior pick to test against — click the model first');
      return;
    }
    const delta = viewport.grabDelta(grabPoint, 50, 0);
    console.log(`[grabDelta] screenDx=50 -> worldDelta=[${delta?.map((n) => n.toFixed(3)).join(', ')}]`);
  }

  /** Task 08 verification: pushes a brush-display change through setBrushDisplay (cursor radius / mirror-plane visibility). */
  function adjustCursorRadius(deltaMm: number): void {
    const next = {
      ...brushDisplayRef.current,
      cursorRadiusMm: Math.max(1, brushDisplayRef.current.cursorRadiusMm + deltaMm),
    };
    brushDisplayRef.current = next;
    viewportRef.current?.setBrushDisplay(next);
    console.log(`[brushDisplay] cursorRadiusMm=${next.cursorRadiusMm}`);
  }

  function toggleSymmetry(): void {
    const next = { ...brushDisplayRef.current, symmetryX: !brushDisplayRef.current.symmetryX };
    brushDisplayRef.current = next;
    viewportRef.current?.setBrushDisplay(next);
    console.log(`[brushDisplay] symmetryX=${next.symmetryX}`);
  }

  /**
   * Task 09 perf verification: remeshes to `level`, then runs a scripted
   * continuous Draw stroke paced one stamp per `requestAnimationFrame` —
   * so the browser's real render loop runs normally alongside it, the
   * same way a real drag (paced by real pointermove events) would — and
   * measures the actual wall-clock time between those frames via
   * `onFrameStats`, which is exactly the end-to-end (CPU stamp + render)
   * cost the spec's ≥60fps(Med)/≥30fps(Max) criterion is about.
   */
  async function runPerfTest(level: 'med' | 'max'): Promise<void> {
    const engine = engineRef.current;
    const viewport = viewportRef.current;
    if (!engine || !viewport) {
      return;
    }

    console.log(`[perf] remeshing to ${level}…`);
    try {
      await engine.setDetail(level);
    } catch (err) {
      console.error(`[perf] setDetail(${level}) rejected:`, err);
      return;
    }
    const mesh = engine.getMesh();
    const radiusMm = (mesh.bounds.max[0] - mesh.bounds.min[0]) / 2;
    console.log(`[perf] ${level}: ${mesh.triangleCount.toLocaleString()} triangles, radius ${radiusMm.toFixed(1)}mm`);

    const fpsReadings: number[] = [];
    const unsubscribe = viewport.onFrameStats(({ fps }) => fpsReadings.push(fps));

    const path = generateArcPath(radiusMm, PERF_TEST_STAMP_COUNT);
    engine.setBrush('draw');
    engine.setBrushSize(radiusMm * 0.1);
    engine.setBrushStrength(0.3);
    engine.beginStroke(path[0]!);

    await new Promise<void>((resolve) => {
      let index = 0;
      function step(): void {
        index++;
        if (index < path.length) {
          engine!.updateStroke(path[index]!);
          requestAnimationFrame(step);
        } else {
          engine!.endStroke();
          resolve();
        }
      }
      requestAnimationFrame(step);
    });

    unsubscribe();
    const fpsSummary = fpsReadings.length > 0 ? fpsReadings.map((f) => f.toFixed(1)).join(', ') : '(stroke finished within one fps sampling window)';
    console.log(`[perf] ${level}: onFrameStats readings during the stroke: ${fpsSummary}`);
  }

  /**
   * Task 09 verification: attachEngine on a second engine must
   * unsubscribe the first (a stroke on the old engine afterward must
   * NOT reach the viewport) and render the new engine's mesh.
   */
  function testAttachEngineReplace(): void {
    const viewport = viewportRef.current;
    const firstEngine = engineRef.current;
    if (!viewport || !firstEngine) {
      return;
    }
    const secondEngine = new SculptEngine();
    secondEngine.newFromPrimitive('block'); // visibly different from the sphere, so a render change is obvious
    viewport.attachEngine(secondEngine);
    engineRef.current = secondEngine;

    // If the old engine's onChange were still subscribed, this stroke
    // would throw trying to sync against the new (differently-shaped)
    // mesh, or otherwise visibly corrupt the render.
    firstEngine.setBrush('draw');
    firstEngine.setBrushSize(12);
    firstEngine.setBrushStrength(1);
    firstEngine.beginStroke({ point: [0, 25, 0], normal: [0, 1, 0] });
    firstEngine.endStroke();
    console.log('[attachEngineReplace] attached a block-shaped second engine; stroked the detached first engine with no visible effect expected');
  }

  /**
   * Task 09 dispose-hygiene verification: repeatedly disposes the
   * current Viewport and mounts a fresh one against the same container,
   * re-attaching the same engine each time — simulating repeated
   * mount/unmount cycles within one page session (rather than only ever
   * testing a single fresh page load) to check for accumulating console
   * warnings/errors.
   */
  async function stressDisposeCycles(): Promise<void> {
    const engine = engineRef.current;
    const container = containerRef.current;
    if (!engine || !container) {
      return;
    }
    for (let i = 0; i < 5; i++) {
      viewportRef.current?.dispose();
      const fresh = new Viewport(container);
      viewportRef.current = fresh;
      const result = await fresh.init();
      if (result.ok) {
        fresh.attachEngine(engine);
      }
      console.log(`[disposeStress] cycle ${i + 1}/5: init ok=${result.ok}`);
    }
    console.log('[disposeStress] completed 5 mount/unmount cycles — check for accumulating warnings');
  }

  return (
    <div className={styles.viewport} ref={containerRef} onClick={handleContainerClick}>
      {status === null && <p className={styles.placeholder}>Initializing renderer…</p>}
      {status !== null && !status.ok && (
        <p className={styles.placeholder}>Viewport unavailable: {status.reason}</p>
      )}
      {status !== null && status.ok && (
        <>
          <p className={styles.placeholder}>backend: {status.backend}</p>
          <p className={styles.placeholder} style={{ top: '32px' }} ref={hitReadoutRef}>
            click the model to pick
          </p>
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
            <button type="button" onClick={testGrabDelta}>
              Test Grab delta
            </button>
            <button type="button" onClick={() => adjustCursorRadius(CURSOR_RADIUS_STEP_MM)}>
              Cursor radius +2mm
            </button>
            <button type="button" onClick={() => adjustCursorRadius(-CURSOR_RADIUS_STEP_MM)}>
              Cursor radius -2mm
            </button>
            <button type="button" onClick={toggleSymmetry}>
              Toggle symmetry
            </button>
            <button type="button" onClick={() => void runPerfTest('med')}>
              Perf test (Med)
            </button>
            <button type="button" onClick={() => void runPerfTest('max')}>
              Perf test (Max)
            </button>
            <button type="button" onClick={() => void stressDisposeCycles()}>
              Stress dispose (5x)
            </button>
            <button type="button" onClick={testAttachEngineReplace}>
              Test attachEngine replace
            </button>
          </div>
        </>
      )}
    </div>
  );
}
