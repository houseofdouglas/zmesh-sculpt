import type { SculptMesh } from '../mesh/sculpt-mesh';

export type ManifoldDefectKind = 'boundary-edge' | 'non-manifold-edge' | 'inconsistent-winding';

export interface ManifoldDefect {
  kind: ManifoldDefectKind;
  vertexA: number;
  vertexB: number;
  /** Only set for non-manifold-edge: how many triangles reference this edge. */
  count?: number;
}

export interface ManifoldCheckResult {
  ok: boolean;
  defects: ManifoldDefect[];
}

/**
 * Checks that a mesh is a closed, consistently-oriented 2-manifold: every
 * undirected edge must be used by exactly 2 triangles, and those 2 must
 * traverse it in opposite directions (the standard signature of two
 * triangles correctly wound on either side of a shared edge, both facing
 * outward). This is the shared gate behind both export (never emit a
 * broken STL/3MF) and remesh (never accept a broken output) — see the
 * sculpt-engine-core spec's watertight invariant.
 *
 * - 1 occurrence  -> boundary-edge (a hole; not watertight)
 * - 2, same direction -> inconsistent-winding (one face is flipped)
 * - 2, opposite directions -> valid, no defect
 * - 3+ occurrences -> non-manifold-edge (more than 2 faces share an edge)
 */
export function checkManifold(mesh: SculptMesh): ManifoldCheckResult {
  // Numeric edge keys (not string concatenation) since this runs on every
  // remesh output and potentially large meshes; u*vertexCount+v is a safe
  // integer for any realistic vertex count.
  const edgeOccurrences = new Map<number, Array<[number, number]>>();
  const { vertexCount } = mesh;

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    recordEdge(edgeOccurrences, a, b, vertexCount);
    recordEdge(edgeOccurrences, b, c, vertexCount);
    recordEdge(edgeOccurrences, c, a, vertexCount);
  }

  const defects: ManifoldDefect[] = [];

  for (const occurrences of edgeOccurrences.values()) {
    if (occurrences.length === 1) {
      const [u, v] = occurrences[0]!;
      defects.push({ kind: 'boundary-edge', vertexA: u, vertexB: v });
    } else if (occurrences.length === 2) {
      const [u1, v1] = occurrences[0]!;
      const [u2, v2] = occurrences[1]!;
      const isOppositeDirection = u1 === v2 && v1 === u2;
      if (!isOppositeDirection) {
        defects.push({ kind: 'inconsistent-winding', vertexA: u1, vertexB: v1 });
      }
    } else {
      const [u, v] = occurrences[0]!;
      defects.push({
        kind: 'non-manifold-edge',
        vertexA: u,
        vertexB: v,
        count: occurrences.length,
      });
    }
  }

  return { ok: defects.length === 0, defects };
}

function recordEdge(
  edgeOccurrences: Map<number, Array<[number, number]>>,
  u: number,
  v: number,
  vertexCount: number,
): void {
  const key = u < v ? u * vertexCount + v : v * vertexCount + u;
  const occurrences = edgeOccurrences.get(key);
  if (occurrences) {
    occurrences.push([u, v]);
  } else {
    edgeOccurrences.set(key, [[u, v]]);
  }
}
