import { describe, it, expect, vi } from 'vitest';
import { sphere } from '../mesh/primitives';
import { checkManifold } from '../validate/manifold';
import { remesh, RemeshValidationError } from './remesh';

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
});
