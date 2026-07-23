import { describe, it, expect } from 'vitest';
import { sphere } from '../../mesh/primitives';
import { checkManifold } from '../../validate/manifold';
import {
  getManifoldToplevel,
  sculptMeshToManifoldMesh,
  manifoldToSculptMesh,
} from '../manifold-adapter';

/**
 * De-risking spike for ADR 2026-07-19 (voxel-remesh library choice).
 *
 * Finding: the task/ADR assumed we'd go through `Manifold.levelSet`, an
 * SDF-based constructor — but that API takes a signed-distance *function*,
 * meaning we'd have to hand-roll an SDF sampler over our own mesh just to
 * feed it back in. The actual best-fit API for "change an existing mesh's
 * resolution while preserving its shape" is `Manifold.ofMesh` (accepts our
 * position+index buffers directly, no merge vectors needed since our
 * vertices are already welded) combined with `.refineToLength()` /
 * `.simplify()` (both operate on existing topology and are guaranteed
 * manifold, since they're methods on an already-manifold Manifold object)
 * and `.getMesh()`. This spike proves that path instead; see the ADR
 * update for the full writeup.
 */
describe('manifold-3d spike: sphere round-trip', () => {
  it('increases resolution via refineToLength, preserving manifoldness and silhouette', async () => {
    const initStart = process.hrtime.bigint();
    const wasm = await getManifoldToplevel();
    const initMs = Number(process.hrtime.bigint() - initStart) / 1e6;
    expect(initMs).toBeGreaterThan(0); // sanity: the timer actually measured something

    const original = sphere(50); // radius 25mm
    const inputMesh = sculptMeshToManifoldMesh(wasm, original);
    const manifold = wasm.Manifold.ofMesh(inputMesh);

    const refined = manifold.refineToLength(2); // target ~2mm edge length
    const result = manifoldToSculptMesh(refined);

    expect(result.triangleCount).toBeGreaterThan(original.triangleCount);

    const check = checkManifold(result);
    expect(check.ok).toBe(true);
    expect(check.defects).toEqual([]);

    // Silhouette preserved: still spans ~radius 25 on every axis.
    expect(result.bounds.min[0]).toBeCloseTo(-25, 0);
    expect(result.bounds.max[0]).toBeCloseTo(25, 0);
    expect(result.bounds.min[1]).toBeCloseTo(-25, 0);
    expect(result.bounds.max[1]).toBeCloseTo(25, 0);
    expect(result.bounds.min[2]).toBeCloseTo(-25, 0);
    expect(result.bounds.max[2]).toBeCloseTo(25, 0);

    // Manifold instances are WASM-heap-backed and not garbage-collected;
    // must be explicitly freed. Mesh (inputMesh) is a plain JS data struct
    // over our own typed arrays and has no delete() of its own.
    manifold.delete();
    refined.delete();
  });

  it('decreases resolution via simplify, preserving manifoldness', async () => {
    const wasm = await getManifoldToplevel();

    const original = sphere(50);
    const inputMesh = sculptMeshToManifoldMesh(wasm, original);
    const manifold = wasm.Manifold.ofMesh(inputMesh);

    const simplified = manifold.simplify(1); // 1mm tolerance
    const result = manifoldToSculptMesh(simplified);

    expect(result.triangleCount).toBeLessThan(original.triangleCount);
    expect(checkManifold(result).ok).toBe(true);

    manifold.delete();
    simplified.delete();
  });
});
