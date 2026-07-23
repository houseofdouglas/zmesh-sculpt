import { describe, it, expect } from 'vitest';
import { sphere, egg, block, capsule } from './primitives';
import type { SculptMesh } from './sculpt-mesh';

/**
 * Every directed edge (u->v) of a closed, consistently-wound manifold must
 * appear exactly once, and its exact reverse (v->u) — contributed by the
 * neighboring triangle on the other side of that edge — must also appear
 * exactly once. This is a stronger, from-scratch check than "each edge
 * used twice": it also rules out two triangles wound the same way sharing
 * an edge, which would make the surface non-orientable. The full-featured
 * defect-reporting validator lives in Task 04; this is a local helper
 * scoped to this task's own tests.
 */
function isWatertightAndOrientable(mesh: SculptMesh): boolean {
  const directedEdgeCounts = new Map<string, number>();

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${u}->${v}`;
      directedEdgeCounts.set(key, (directedEdgeCounts.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of directedEdgeCounts) {
    if (count !== 1) return false;
    const [u, v] = key.split('->');
    const reverseCount = directedEdgeCounts.get(`${v}->${u}`) ?? 0;
    if (reverseCount !== 1) return false;
  }
  return true;
}

/** Every vertex normal should point away from the mesh's own center. */
function hasOutwardNormals(mesh: SculptMesh): boolean {
  for (let v = 0; v < mesh.vertexCount; v++) {
    const px = mesh.positions[v * 3]!;
    const py = mesh.positions[v * 3 + 1]!;
    const pz = mesh.positions[v * 3 + 2]!;
    const nx = mesh.normals[v * 3]!;
    const ny = mesh.normals[v * 3 + 1]!;
    const nz = mesh.normals[v * 3 + 2]!;

    const dot = px * nx + py * ny + pz * nz;
    // Pole vertices sit exactly on the axis, so their position component
    // in the two non-axial directions is 0 by construction — a plain
    // dot > 0 still holds since the axial components alone carry the sign.
    if (dot <= 0) return false;
  }
  return true;
}

describe('sphere', () => {
  const mesh = sphere(50);

  it('is watertight and consistently oriented', () => {
    expect(isWatertightAndOrientable(mesh)).toBe(true);
  });

  it('has outward-pointing normals', () => {
    expect(hasOutwardNormals(mesh)).toBe(true);
  });

  it('spans the requested diameter on every axis, centered at the origin', () => {
    expect(mesh.bounds.min[0]).toBeCloseTo(-25, 5);
    expect(mesh.bounds.max[0]).toBeCloseTo(25, 5);
    expect(mesh.bounds.min[1]).toBeCloseTo(-25, 5);
    expect(mesh.bounds.max[1]).toBeCloseTo(25, 5);
    expect(mesh.bounds.min[2]).toBeCloseTo(-25, 5);
    expect(mesh.bounds.max[2]).toBeCloseTo(25, 5);
  });

  it('has a triangle count matching the default-resolution formula (2*W*(H-1))', () => {
    // Default width/height segments are 48/24.
    expect(mesh.triangleCount).toBe(2 * 48 * (24 - 1));
    expect(mesh.triangleCount).toBeGreaterThan(500);
    expect(mesh.triangleCount).toBeLessThan(20000);
  });
});

describe('egg', () => {
  const mesh = egg(55, 40);

  it('is watertight and consistently oriented', () => {
    expect(isWatertightAndOrientable(mesh)).toBe(true);
  });

  it('has outward-pointing normals', () => {
    expect(hasOutwardNormals(mesh)).toBe(true);
  });

  it('spans exactly the requested vertical height', () => {
    expect(mesh.bounds.min[1]).toBeCloseTo(-27.5, 5);
    expect(mesh.bounds.max[1]).toBeCloseTo(27.5, 5);
  });

  it('approximates the requested width (taper has no exact analytic peak)', () => {
    const widthX = mesh.bounds.max[0] - mesh.bounds.min[0];
    const widthZ = mesh.bounds.max[2] - mesh.bounds.min[2];
    expect(widthX).toBeGreaterThan(40 * 0.6);
    expect(widthX).toBeLessThan(40 * 1.1);
    expect(widthZ).toBeGreaterThan(40 * 0.6);
    expect(widthZ).toBeLessThan(40 * 1.1);
  });
});

describe('block', () => {
  const mesh = block(40, 30, 20);

  it('is watertight and consistently oriented', () => {
    expect(isWatertightAndOrientable(mesh)).toBe(true);
  });

  it('has outward-pointing normals', () => {
    expect(hasOutwardNormals(mesh)).toBe(true);
  });

  it('spans exactly the requested extents on each axis', () => {
    expect(mesh.bounds.min).toEqual([-20, -15, -10]);
    expect(mesh.bounds.max).toEqual([20, 15, 10]);
  });

  it('has exactly 8 vertices and 12 triangles (2 per face)', () => {
    expect(mesh.vertexCount).toBe(8);
    expect(mesh.triangleCount).toBe(12);
  });
});

describe('capsule', () => {
  const mesh = capsule(60, 15);

  it('is watertight and consistently oriented', () => {
    expect(isWatertightAndOrientable(mesh)).toBe(true);
  });

  it('has outward-pointing normals', () => {
    expect(hasOutwardNormals(mesh)).toBe(true);
  });

  it('spans exactly the requested total height and radius', () => {
    expect(mesh.bounds.min[1]).toBeCloseTo(-30, 5);
    expect(mesh.bounds.max[1]).toBeCloseTo(30, 5);
    expect(mesh.bounds.max[0]).toBeCloseTo(15, 5);
    expect(mesh.bounds.max[2]).toBeCloseTo(15, 5);
  });

  it('degrades gracefully to a sphere-like shape when height <= 2*radius', () => {
    // cylinderHeight clamps to 0 rather than going negative.
    const squashed = capsule(20, 15);
    expect(isWatertightAndOrientable(squashed)).toBe(true);
    expect(squashed.bounds.max[1]).toBeCloseTo(15, 5);
  });
});
