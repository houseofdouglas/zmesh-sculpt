import { describe, it, expect, vi } from 'vitest';
import { sphere } from '../mesh/primitives';
import { checkManifold } from '../validate/manifold';
import { remesh, RemeshValidationError } from './remesh';

/** How close `actual` must land to `target` (as a fraction) for the correction-loop tests below. */
function withinTolerance(actual: number, target: number, fraction: number): boolean {
  const ratio = actual / target;
  return ratio >= 1 - fraction && ratio <= 1 + fraction;
}

describe('remesh', () => {
  it('increases resolution toward a higher target, staying manifold and preserving the silhouette', async () => {
    const original = sphere(50, { widthSegments: 12, heightSegments: 8 }); // coarse, radius 25mm
    const target = original.triangleCount * 4;

    const result = await remesh(original, target);

    expect(result.triangleCount).toBeGreaterThan(original.triangleCount);
    expect(checkManifold(result).ok).toBe(true);
    expect(result.bounds.min[0]).toBeCloseTo(-25, 0);
    expect(result.bounds.max[0]).toBeCloseTo(25, 0);
  });

  it('decreases resolution toward a lower target, staying manifold and preserving the silhouette', async () => {
    const original = sphere(50, { widthSegments: 48, heightSegments: 24 }); // fine
    const target = Math.round(original.triangleCount / 4);

    const result = await remesh(original, target);

    expect(result.triangleCount).toBeLessThan(original.triangleCount);
    expect(checkManifold(result).ok).toBe(true);
    expect(result.bounds.min[0]).toBeCloseTo(-25, 0);
    expect(result.bounds.max[0]).toBeCloseTo(25, 0);
  });

  it('reports progress from 0 to 1', async () => {
    const original = sphere(50, { widthSegments: 12, heightSegments: 8 });
    const progress: number[] = [];

    await remesh(original, original.triangleCount * 2, (fraction) => progress.push(fraction));

    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    }
  });

  it('rejects with RemeshValidationError rather than surfacing a non-manifold result', async () => {
    // manifold-3d's own operations are guaranteed manifold-preserving, so
    // the only way to exercise this defensive path is to force the
    // validator itself to report a defect for one call.
    vi.spyOn(await import('../validate/manifold'), 'checkManifold').mockReturnValueOnce({
      ok: false,
      defects: [{ kind: 'boundary-edge', vertexA: 0, vertexB: 1 }],
    });

    const original = sphere(50, { widthSegments: 12, heightSegments: 8 });
    await expect(remesh(original, original.triangleCount * 2)).rejects.toThrow(
      RemeshValidationError,
    );

    vi.restoreAllMocks();
    // checkManifold itself is unaffected outside the mock.
    expect(checkManifold(original).ok).toBe(true);
  });

  it('converges the output within tolerance of a large target jump from a coarse source mesh', async () => {
    // Reproduces the exact scenario that first exposed the overshoot: a
    // default-shaped sphere (not pre-refined) jumping straight to a much
    // higher target. A single first-order estimate landed at 96,096 for
    // an 80,000 target here (1.2x) before the correction loop existed.
    const original = sphere(); // default segments, ~2,200 triangles
    const target = 80_000;

    const result = await remesh(original, target);

    expect(withinTolerance(result.triangleCount, target, 0.15)).toBe(true);
    expect(checkManifold(result).ok).toBe(true);
  });

  it('converges within tolerance on a large decrease-detail jump (the simplify path)', async () => {
    // The mirror of the increase-detail overshoot, and the harder of the
    // two to correct: manifold-3d's simplify() collapses toward a deviation
    // tolerance whose triangle count scales with the inverse *first* power
    // of that tolerance, not the inverse square that governs edge length on
    // the refine path. An earlier version scaled the simplify correction by
    // sqrt(ratio) — the refine exponent — which under-corrects by a square
    // root each round, so a Max→Med-sized reduction stalled around
    // 0.6× of target after all attempts (measured 12,656 vs. 20,000 here)
    // instead of converging. SIMPLIFY_CORRECTION_EXPONENT fixes this.
    const original = sphere(50, { widthSegments: 240, heightSegments: 160 }); // ~76k triangles
    const target = 20_000; // ~3.8× reduction — far enough to expose the bad correction

    const result = await remesh(original, target);

    expect(result.triangleCount).toBeLessThan(original.triangleCount);
    expect(withinTolerance(result.triangleCount, target, 0.15)).toBe(true);
    expect(checkManifold(result).ok).toBe(true);
  }, 15_000);

  it('does not compound overshoot across a repeated remesh of an already-remeshed mesh', async () => {
    // The worse of the two originally-observed cases: remeshing the
    // *output* of a previous remesh (not the pristine original),
    // jumping to a much higher target again. Chained overshoot without
    // the correction loop reached 1.72x here (860,372 vs. a 500,000
    // target); each remesh call restarts its own correction from
    // scratch against whatever mesh it's actually given.
    const original = sphere();
    const firstTarget = 80_000;
    const firstResult = await remesh(original, firstTarget);
    expect(withinTolerance(firstResult.triangleCount, firstTarget, 0.15)).toBe(true);

    const secondTarget = 500_000;
    const secondResult = await remesh(firstResult, secondTarget);

    expect(withinTolerance(secondResult.triangleCount, secondTarget, 0.2)).toBe(true);
    expect(checkManifold(secondResult).ok).toBe(true);
  }, 15_000);
});
