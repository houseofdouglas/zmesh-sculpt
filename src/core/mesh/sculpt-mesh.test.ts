import { describe, it, expect } from 'vitest';
import { createSculptMesh, SculptMeshValidationError } from './sculpt-mesh';

/**
 * A regular tetrahedron centered at the origin — a closed, convex volume
 * where "outward" is unambiguous. By its symmetry about the origin, each
 * vertex's averaged normal works out to exactly that vertex's own
 * normalized position, which makes it a precise fixture for both the
 * unit-length and outward-direction checks.
 */
const TETRA_POSITIONS = new Float32Array([
  1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1,
]);
const TETRA_INDICES = new Uint32Array([1, 3, 2, 0, 2, 3, 0, 3, 1, 0, 1, 2]);

describe('createSculptMesh', () => {
  it('computes vertexCount, triangleCount, and bounds from valid arrays', () => {
    const mesh = createSculptMesh(TETRA_POSITIONS, TETRA_INDICES);

    expect(mesh.vertexCount).toBe(4);
    expect(mesh.triangleCount).toBe(4);
    expect(mesh.bounds.min).toEqual([-1, -1, -1]);
    expect(mesh.bounds.max).toEqual([1, 1, 1]);
  });

  it('computes unit-length, outward-pointing normals on a symmetric convex fixture', () => {
    const mesh = createSculptMesh(TETRA_POSITIONS, TETRA_INDICES);

    for (let v = 0; v < mesh.vertexCount; v++) {
      const px = mesh.positions[v * 3]!;
      const py = mesh.positions[v * 3 + 1]!;
      const pz = mesh.positions[v * 3 + 2]!;
      const plen = Math.sqrt(px * px + py * py + pz * pz);

      const nx = mesh.normals[v * 3]!;
      const ny = mesh.normals[v * 3 + 1]!;
      const nz = mesh.normals[v * 3 + 2]!;
      const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);

      expect(nlen).toBeCloseTo(1, 5);
      // By the tetrahedron's symmetry about the origin, the outward normal
      // at each vertex equals that vertex's own radial direction.
      expect(nx).toBeCloseTo(px / plen, 5);
      expect(ny).toBeCloseTo(py / plen, 5);
      expect(nz).toBeCloseTo(pz / plen, 5);
    }
  });

  it('rejects a positions array whose length is not a multiple of 3', () => {
    const bad = new Float32Array([1, 2, 3, 4]);
    expect(() => createSculptMesh(bad, TETRA_INDICES)).toThrow(SculptMeshValidationError);
  });

  it('rejects an empty positions array (zero vertices)', () => {
    expect(() => createSculptMesh(new Float32Array([]), new Uint32Array([]))).toThrow(
      SculptMeshValidationError,
    );
  });

  it('rejects an indices array whose length is not a multiple of 3', () => {
    const bad = new Uint32Array([0, 1, 2, 3]);
    expect(() => createSculptMesh(TETRA_POSITIONS, bad)).toThrow(SculptMeshValidationError);
  });

  it('rejects an index that references a vertex out of range', () => {
    const bad = new Uint32Array([0, 1, 4]); // only 4 vertices exist, valid range 0-3
    expect(() => createSculptMesh(TETRA_POSITIONS, bad)).toThrow(SculptMeshValidationError);
  });
});
