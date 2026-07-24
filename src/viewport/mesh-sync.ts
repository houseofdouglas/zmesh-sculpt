import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, type MeshStandardMaterial } from 'three';
import type { SculptMesh } from '../core/mesh/sculpt-mesh';
import type { DirtyRegion } from '../engine/sculpt-engine';
import { vertexRangeToAttributeRange } from './math/dirty-range';

export interface MeshSync {
  /** The live THREE.Mesh — add this to the scene once, then just call `sync`. */
  mesh: Mesh;
  /**
   * Reacts to one `onChange` notification. A same-topology region (the
   * common case — a stroke) uploads only the touched vertex range; a
   * different mesh object (remesh, or a newly loaded mesh) rebuilds the
   * geometry entirely, since the old `BufferAttribute`s would otherwise
   * keep pointing at now-disconnected, stale typed arrays.
   */
  sync(sculptMesh: SculptMesh, region: DirtyRegion): void;
  dispose(): void;
}

/**
 * Builds a `BufferGeometry` directly backed by `initialMesh`'s own
 * `positions`/`normals`/`indices` typed arrays (FR-5) — not copies. The
 * engine mutates those arrays in place per stamp; the CPU-side geometry
 * data is therefore already current the instant a stamp lands, and
 * `sync` only needs to tell the GPU which byte range to re-upload.
 */
export function createMeshSync(material: MeshStandardMaterial, initialMesh: SculptMesh): MeshSync {
  const geometry = new BufferGeometry();
  const mesh = new Mesh(geometry, material);
  let currentMesh = initialMesh;
  // Kept as typed references rather than re-fetched via
  // `geometry.getAttribute` — that returns a
  // `BufferAttribute | InterleavedBufferAttribute` union (the latter has
  // no `addUpdateRange`), even though we know these are always plain
  // `BufferAttribute`s since we're the only ones who ever set them.
  let positionAttr: BufferAttribute;
  let normalAttr: BufferAttribute;

  function rebuild(sculptMesh: SculptMesh): void {
    positionAttr = new BufferAttribute(sculptMesh.positions, 3).setUsage(DynamicDrawUsage);
    normalAttr = new BufferAttribute(sculptMesh.normals, 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('normal', normalAttr);
    geometry.setIndex(new BufferAttribute(sculptMesh.indices, 1));
    geometry.computeBoundingSphere();
    currentMesh = sculptMesh;
  }

  rebuild(initialMesh);

  function sync(sculptMesh: SculptMesh, region: DirtyRegion): void {
    // Identity, not just equal counts: a remesh/load produces an entirely
    // new SculptMesh with new typed-array objects, even if it happened to
    // land on the same vertex count. Comparing the actual array reference
    // is what correctly distinguishes "same topology, some vertices
    // moved" from "different topology entirely" — the two cases FR-6/FR-7
    // require different handling for.
    if (sculptMesh.positions !== currentMesh.positions) {
      rebuild(sculptMesh);
      return;
    }

    if (
      region.vertexStart < 0 ||
      region.vertexEnd > currentMesh.vertexCount ||
      region.vertexStart >= region.vertexEnd
    ) {
      // Stale (e.g. queued before a topology change landed) or degenerate
      // — ignored, not applied (spec edge case: never crash on this).
      return;
    }

    const { offset, count } = vertexRangeToAttributeRange(region.vertexStart, region.vertexEnd);
    positionAttr.addUpdateRange(offset, count);
    normalAttr.addUpdateRange(offset, count);
    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    // Deliberately NOT recomputing the bounding sphere here (it's an
    // O(vertexCount) scan — exactly the per-stamp cost the engine spec's
    // own Q-01 finding flagged as the bottleneck at scale). It's only
    // recomputed on `rebuild`. Accepted for now: a long session that
    // pushes vertices well outside the last-computed bounding sphere
    // (e.g. repeated Inflate) could in principle cause Task 06's
    // raycasts to miss near the edge — revisit if that shows up.
  }

  function dispose(): void {
    geometry.dispose();
  }

  return { mesh, sync, dispose };
}
