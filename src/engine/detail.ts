import type { SculptMesh } from '../core/mesh/sculpt-mesh';

/** Discrete detail levels (FR-15). */
export type DetailLevel = 'low' | 'med' | 'high' | 'max';

/**
 * Level -> target triangle count (spec's Data Model section). `max` is
 * the Q-01-resolved clamp (Task 09, 2026-07-23:
 * docs/design/q01-triangle-budget-findings.md) — 500,000, not a
 * provisional placeholder — and not user-overridable (FR-18): nothing in
 * this API accepts a target above it.
 */
export const DETAIL_TARGET_TRIANGLE_COUNTS: Readonly<Record<DetailLevel, number>> = {
  low: 20_000,
  med: 80_000,
  high: 200_000,
  max: 500_000,
};

/**
 * What `SculptEngine.setDetail` actually calls to perform a remesh. The
 * production implementation ({@link createWorkerRemeshRunner}) dispatches
 * to a Web Worker; `SculptEngine` accepts this as an injectable
 * constructor option so its own orchestration (clamping, history,
 * reject-and-restore, progress relay) can be unit-tested against a fake
 * runner without a real Worker or WASM.
 */
export type RemeshRunner = (
  mesh: SculptMesh,
  targetTriangleCount: number,
  onProgress?: (fraction: number) => void,
) => Promise<SculptMesh>;

export interface RemeshWorkerRequest {
  mesh: SculptMesh;
  targetTriangleCount: number;
}

export type RemeshWorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; mesh: SculptMesh }
  | { type: 'error'; message: string };

/**
 * The real, production `RemeshRunner`: dispatches to a dedicated Web
 * Worker per FR-16/NFR-03, so a remesh (up to ~3s at Max) never blocks
 * the main thread. A fresh worker is spawned per call and terminated
 * once it resolves or rejects — simpler to reason about than a
 * persistent worker pool, and cheap given the WASM module's own init
 * cost is negligible (~7.5ms, per the Task 05 ADR) next to a
 * multi-second remesh budget.
 *
 * Not exercised by this project's automated tests: `Worker` doesn't
 * exist in the plain Node environment Vitest runs this project in (no
 * DOM test environment is configured), so there's no way to unit-test
 * actual worker dispatch here. `SculptEngine`'s injectable `RemeshRunner`
 * exists specifically so everything *around* this factory is fully
 * unit-tested against a fake runner instead; this factory itself is
 * thin, uninstrumented glue, verified interactively per the
 * constitution's Definition of Done.
 */
export function createWorkerRemeshRunner(): RemeshRunner {
  return (mesh, targetTriangleCount, onProgress) =>
    new Promise<SculptMesh>((resolve, reject) => {
      const worker = new Worker(new URL('./remesh.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (event: MessageEvent<RemeshWorkerResponse>): void => {
        const data = event.data;
        if (data.type === 'progress') {
          onProgress?.(data.fraction);
        } else if (data.type === 'done') {
          worker.terminate();
          resolve(data.mesh);
        } else {
          worker.terminate();
          reject(new Error(data.message));
        }
      };
      worker.onerror = (event: ErrorEvent): void => {
        worker.terminate();
        reject(new Error(event.message || 'remesh worker failed'));
      };

      const request: RemeshWorkerRequest = { mesh, targetTriangleCount };
      worker.postMessage(request);
    });
}
