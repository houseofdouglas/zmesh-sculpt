import { remesh } from '../core/remesh/remesh';
import type { RemeshWorkerRequest, RemeshWorkerResponse } from './detail';

/**
 * Minimal shape of a dedicated worker's global scope — just the two
 * members this file needs. Written by hand rather than pulling in
 * TypeScript's ambient `webworker` lib: this project has one shared
 * tsconfig (`lib: ["ES2022", "DOM", "DOM.Iterable"]`) covering both
 * main-thread and worker code, and `webworker` declares several globals
 * (`self` included) differently than `DOM` does — adding it project-wide
 * would conflict, and a separate tsconfig for one file is more machinery
 * than this narrow cast needs.
 */
interface WorkerGlobalLike {
  onmessage: ((event: { data: RemeshWorkerRequest }) => void) | null;
  postMessage(message: RemeshWorkerResponse): void;
}

const ctx = self as unknown as WorkerGlobalLike;

/**
 * The worker entry point (FR-16/NFR-03): runs `remesh()` off the main
 * thread and relays progress/result/error back. Deliberately thin — all
 * real logic (the manifold-3d calls, manifold validation) lives in
 * `core/remesh/remesh.ts`, which is Node-testable; this file is
 * platform glue that can only really run in a browser, verified
 * interactively rather than by an automated test (see
 * `createWorkerRemeshRunner`'s doc comment in `./detail`).
 */
ctx.onmessage = (event) => {
  const { mesh, targetTriangleCount } = event.data;
  remesh(mesh, targetTriangleCount, (fraction) => {
    ctx.postMessage({ type: 'progress', fraction });
  })
    .then((result) => {
      ctx.postMessage({ type: 'done', mesh: result });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      ctx.postMessage({ type: 'error', message });
    });
};
