import ManifoldModule from 'manifold-3d';
import type {
  ManifoldToplevel,
  Manifold as ManifoldInstance,
  Mesh as ManifoldMeshInstance,
} from 'manifold-3d';
import { createSculptMesh, type SculptMesh } from '../mesh/sculpt-mesh';

let toplevelPromise: Promise<ManifoldToplevel> | undefined;

/**
 * Lazily initializes the manifold-3d WASM module (once per process/tab) and
 * returns its toplevel namespace (Manifold, Mesh, etc). Callers await this
 * once before touching any Manifold API; repeat calls return the same
 * cached promise.
 */
export function getManifoldToplevel(): Promise<ManifoldToplevel> {
  toplevelPromise ??= ManifoldModule().then((wasm) => {
    wasm.setup();
    return wasm;
  });
  return toplevelPromise;
}

/**
 * Converts a SculptMesh into a manifold-3d Mesh. Our positions/indices are
 * already exactly the layout manifold-3d expects: numProp=3 (position-only,
 * no extra per-vertex channels), position-only vertProperties, CCW triVerts.
 * Because our SculptMesh vertices are already welded (one index per unique
 * position — see the Task 03 primitives finding on this), no mergeFromVert/
 * mergeToVert vectors are needed.
 *
 * Unlike `Manifold` instances, `Mesh` is a plain JS struct over our own
 * typed arrays — it has no WASM-heap lifetime and needs no `.delete()`.
 * Anything built from it via `Manifold.ofMesh()` does, though; see
 * `manifoldToSculptMesh` and the spike test for the disposal pattern.
 */
export function sculptMeshToManifoldMesh(
  wasm: ManifoldToplevel,
  mesh: SculptMesh,
): ManifoldMeshInstance {
  return new wasm.Mesh({
    numProp: 3,
    vertProperties: mesh.positions,
    triVerts: mesh.indices,
  });
}

/**
 * Converts a manifold-3d Manifold back into a SculptMesh. Normals and
 * bounds are recomputed via createSculptMesh — manifold-3d's own output
 * isn't consulted for them, since our SculptMesh normal convention (area-
 * weighted, computed once at construction) is the single source of truth
 * for the rest of the engine.
 */
export function manifoldToSculptMesh(manifold: ManifoldInstance): SculptMesh {
  const outMesh = manifold.getMesh();
  const positions = extractPositions(outMesh.vertProperties, outMesh.numProp, outMesh.numVert);
  return createSculptMesh(positions, outMesh.triVerts);
}

/** Manifold's Mesh always stores >=3 properties per vertex; we only want xyz. */
function extractPositions(
  vertProperties: Float32Array,
  numProp: number,
  numVert: number,
): Float32Array {
  if (numProp === 3) {
    return vertProperties;
  }
  const positions = new Float32Array(numVert * 3);
  for (let v = 0; v < numVert; v++) {
    positions[v * 3] = vertProperties[v * numProp]!;
    positions[v * 3 + 1] = vertProperties[v * numProp + 1]!;
    positions[v * 3 + 2] = vertProperties[v * numProp + 2]!;
  }
  return positions;
}
