/**
 * Q-01 benchmark spike: what triangle budget sustains interactive
 * sculpting on the M1 baseline? Measures the CPU-side sculpting pipeline
 * only (spatial-hash query, brush deform, affected-region normal
 * recompute, a dirty-AABB stand-in for the future onChange notification)
 * — no rendering, which is a separate cost measured by the viewport spec.
 *
 * Run directly: `npm run bench:sculpt`. Not part of `npm test` — this is
 * a slow, timing-sensitive spike, not a correctness suite.
 */
import { sphere } from '../mesh/primitives';
import { buildVertexAdjacency, type VertexAdjacency } from '../mesh/adjacency';
import { buildSpatialHash, queryRadius, updateVertexPosition } from '../mesh/spatial-hash';
import { recomputeAffectedRegionNormals } from '../mesh/normals';
import { applyDraw } from '../brushes/draw';
import type { Stamp, BrushKernelContext } from '../brushes/brush-kernel';
import type { SculptMesh } from '../mesh/sculpt-mesh';

const TARGET_TRIANGLE_COUNTS = [20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
const SPHERE_DIAMETER_MM = 100;
const BRUSH_RADIUS_MM = 5;
const STAMPS_PER_STROKE = 60;
const SIXTY_FPS_BUDGET_MS = 1000 / 60;
const THIRTY_FPS_BUDGET_MS = 1000 / 30;

export interface BenchResult {
  triangleCount: number;
  vertexCount: number;
  avgStampMs: number;
  impliedFps: number;
}

/** width==height segments needed for triangleCount = 2*W*(H-1), assuming W=H. */
function segmentsForTriangleTarget(targetTriangles: number): number {
  return Math.max(4, Math.round(Math.sqrt(targetTriangles / 2)));
}

interface StampPoint {
  center: [number, number, number];
  normal: [number, number, number];
}

/** N stamp centers along a quarter great-circle arc on the sphere's surface. */
function generateStrokePath(sphereRadius: number, stampCount: number): StampPoint[] {
  const path: StampPoint[] = [];
  for (let i = 0; i < stampCount; i++) {
    const t = i / (stampCount - 1);
    const theta = t * (Math.PI / 2);
    const x = sphereRadius * Math.cos(theta);
    const y = sphereRadius * Math.sin(theta);
    const z = 0;
    const len = Math.sqrt(x * x + y * y + z * z);
    path.push({ center: [x, y, z], normal: [x / len, y / len, z / len] });
  }
  return path;
}

/** A cheap stand-in for the dirty-region AABB a real onChange notification would report. */
function computeDirtyAabb(positions: Float32Array, affected: readonly number[]): void {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of affected) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Values aren't consumed anywhere yet (no real onChange exists until
  // Task 15) — this function's cost is what's being measured, not its
  // output.
  if (minX > maxX || minY > maxY || minZ > maxZ) {
    throw new Error('unreachable: empty affected set should not occur mid-stroke');
  }
}

function runStroke(mesh: SculptMesh, adjacency: VertexAdjacency, brushRadius: number): number[] {
  const spatialHash = buildSpatialHash(mesh);
  const sphereRadius = mesh.bounds.max[0]!;
  const path = generateStrokePath(sphereRadius, STAMPS_PER_STROKE);
  const timings: number[] = [];

  for (const point of path) {
    const stampStart = performance.now();

    const stamp: Stamp = {
      center: point.center,
      normal: point.normal,
      radius: brushRadius,
      strength: 0.3,
      dragDelta: null,
    };

    const affectedIndices = queryRadius(spatialHash, mesh.positions, stamp.center, stamp.radius);

    const context: BrushKernelContext = {
      positions: mesh.positions,
      normals: mesh.normals,
      adjacency,
      affectedIndices,
      stamp,
    };
    applyDraw(context);

    for (const v of affectedIndices) {
      updateVertexPosition(spatialHash, mesh.positions, v);
    }

    recomputeAffectedRegionNormals(
      mesh.positions,
      mesh.indices,
      mesh.normals,
      adjacency,
      affectedIndices,
    );

    computeDirtyAabb(mesh.positions, affectedIndices);

    timings.push(performance.now() - stampStart);
  }

  return timings;
}

export function runBenchmark(): BenchResult[] {
  const results: BenchResult[] = [];

  for (const target of TARGET_TRIANGLE_COUNTS) {
    const segments = segmentsForTriangleTarget(target);
    const mesh = sphere(SPHERE_DIAMETER_MM, {
      widthSegments: segments,
      heightSegments: segments,
    });
    const adjacency = buildVertexAdjacency(mesh);

    const timings = runStroke(mesh, adjacency, BRUSH_RADIUS_MM);
    // Drop the first stamp (JIT/cache warmup) and average the rest —
    // sustained rate is what matters for a continuous stroke.
    const steady = timings.slice(1);
    const avgStampMs = steady.reduce((sum, t) => sum + t, 0) / steady.length;

    results.push({
      triangleCount: mesh.triangleCount,
      vertexCount: mesh.vertexCount,
      avgStampMs,
      impliedFps: 1000 / avgStampMs,
    });
  }

  return results;
}

function largestTriangleCountUnder(results: BenchResult[], budgetMs: number): number {
  let largest = 0;
  for (const r of results) {
    if (r.avgStampMs <= budgetMs && r.triangleCount > largest) {
      largest = r.triangleCount;
    }
  }
  return largest;
}

function printReport(results: BenchResult[]): void {
  console.table(
    results.map((r) => ({
      triangles: r.triangleCount,
      vertices: r.vertexCount,
      'avg stamp (ms)': r.avgStampMs.toFixed(3),
      'implied fps': r.impliedFps.toFixed(1),
    })),
  );

  const sixtyFpsBudget = largestTriangleCountUnder(results, SIXTY_FPS_BUDGET_MS);
  const thirtyFpsBudget = largestTriangleCountUnder(results, THIRTY_FPS_BUDGET_MS);

  console.log('');
  console.log(`>= 60 fps (NFR-01 Med target) up to: ${sixtyFpsBudget.toLocaleString()} triangles`);
  console.log(`>= 30 fps (NFR-01 Max target) up to: ${thirtyFpsBudget.toLocaleString()} triangles`);
}

// This file's only practical entry point is `npm run bench:sculpt`
// (via vite-node), which doesn't report its own path in a way that lets
// us reliably detect "am I the entrypoint" — so just always report.
// runBenchmark() is still exported for a future test/tool to call
// without the console output, if that's ever needed.
printReport(runBenchmark());
