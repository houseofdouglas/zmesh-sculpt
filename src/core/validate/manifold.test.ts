import { describe, it, expect } from 'vitest';
import { checkManifold } from './manifold';
import { createSculptMesh } from '../mesh/sculpt-mesh';
import { sphere, egg, block, capsule } from '../mesh/primitives';

describe('checkManifold', () => {
  it('passes on all Task 03 primitives', () => {
    for (const mesh of [sphere(), egg(), block(), capsule()]) {
      const result = checkManifold(mesh);
      expect(result.ok).toBe(true);
      expect(result.defects).toEqual([]);
    }
  });

  it('detects a hole left by a removed triangle as boundary-edge defects', () => {
    const mesh = sphere(20);
    // Drop the last triangle: its 3 edges go from 2 occurrences to 1.
    const holedIndices = mesh.indices.slice(0, mesh.indices.length - 3);
    const holedMesh = createSculptMesh(mesh.positions, holedIndices);

    const result = checkManifold(holedMesh);

    expect(result.ok).toBe(false);
    const boundaryDefects = result.defects.filter((d) => d.kind === 'boundary-edge');
    expect(boundaryDefects).toHaveLength(3);
  });

  it('detects an edge shared by more than 2 triangles as non-manifold-edge', () => {
    // Three triangles all hinged on the undirected edge {0,1} — positions
    // are arbitrary distinct points, since manifold checking is purely
    // topological and doesn't read geometry.
    const positions = new Float32Array([
      0, 0, 0, // 0
      1, 0, 0, // 1
      0, 1, 0, // 2
      0, -1, 0, // 3
      0, 0, 1, // 4
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 1, 4]);
    const mesh = createSculptMesh(positions, indices);

    const result = checkManifold(mesh);

    expect(result.ok).toBe(false);
    expect(
      result.defects.some(
        (d) =>
          d.kind === 'non-manifold-edge' &&
          d.count === 3 &&
          new Set([d.vertexA, d.vertexB]).size === 2 &&
          [d.vertexA, d.vertexB].includes(0) &&
          [d.vertexA, d.vertexB].includes(1),
      ),
    ).toBe(true);
  });

  it('detects a flipped triangle as an inconsistent-winding defect', () => {
    const mesh = block(40, 40, 40);
    const flippedIndices = mesh.indices.slice();
    // Reverse the first triangle's winding by swapping 2 of its 3 indices —
    // same 3 vertices/edges, but now traversed in the same direction as
    // its neighbor across each shared edge instead of the opposite one.
    const tmp = flippedIndices[1]!;
    flippedIndices[1] = flippedIndices[2]!;
    flippedIndices[2] = tmp;
    const flippedMesh = createSculptMesh(mesh.positions, flippedIndices);

    const result = checkManifold(flippedMesh);

    expect(result.ok).toBe(false);
    expect(result.defects.some((d) => d.kind === 'inconsistent-winding')).toBe(true);
  });
});
