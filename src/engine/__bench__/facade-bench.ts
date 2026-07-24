/**
 * As-shipped sculpting benchmark: drives a continuous Draw stroke through
 * the real `SculptEngine` facade — the exact code path a pointer drag takes
 * in the app — with X-mirror symmetry ON by default (FR-10). This closes
 * the sculpt-engine-core acceptance PARTIAL that (correctly) flagged the
 * original Q-01 numbers as measured against a *pre-facade, no-symmetry*
 * core pipeline (`core/__bench__/sculpt-bench.ts`): symmetry doubles the
 * stamp count per pointer sample (a stroke plus its mirror), and that real
 * default-configuration cost was never separately measured.
 *
 * It also captures the post-incidence-fix reality (2026-07-24): the
 * O(triangleCount) per-stamp normal scan that dominated the Q-01 numbers is
 * gone (replaced by a precomputed vertex→triangle incidence structure), so
 * the ceilings here are far higher than Q-01's original ~199k/~499k.
 *
 * What's measured: wall-clock of each `updateStroke()` call that actually
 * produces sculpting work (detected via a real `onChange` subscription, so
 * the dirty-region computation a live viewport triggers is included).
 * `implied fps = 1000 / avg-per-working-sample-ms`. Runs both symmetry-on
 * (as shipped) and symmetry-off, to quantify the doubling directly.
 *
 * Run: `npm run bench:facade`. Not part of `npm test` — a slow,
 * timing-sensitive spike, not a correctness suite.
 */
import { SculptEngine } from '../sculpt-engine';
import { sphere } from '../../core/mesh/primitives';
import type { SurfaceHit } from '../stroke';

const TARGET_TRIANGLE_COUNTS = [50_000, 100_000, 200_000, 500_000, 1_000_000];
const SPHERE_DIAMETER_MM = 100; // radius 50mm — matches the Q-01 bench
const BRUSH_RADIUS_MM = 5; // matches the Q-01 bench
const BRUSH_STRENGTH = 0.3;
const SAMPLES_PER_STROKE = 90;
const SIXTY_FPS_BUDGET_MS = 1000 / 60;
const THIRTY_FPS_BUDGET_MS = 1000 / 30;

interface BenchRow {
  triangleCount: number;
  symmetry: 'on' | 'off';
  workingSamples: number;
  avgSampleMs: number;
  impliedFps: number;
}

/** width==height segments needed for triangleCount = 2*W*(H-1), assuming W=H. */
function segmentsForTriangleTarget(targetTriangles: number): number {
  return Math.max(4, Math.round(Math.sqrt(targetTriangles / 2)));
}

/** N hit points along a quarter great-circle arc on the sphere's surface. */
function strokePath(sphereRadius: number, count: number): SurfaceHit[] {
  const path: SurfaceHit[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const theta = t * (Math.PI / 2);
    const x = sphereRadius * Math.cos(theta);
    const y = sphereRadius * Math.sin(theta);
    const len = Math.sqrt(x * x + y * y);
    path.push({ point: [x, y, 0], normal: [x / len, y / len, 0] });
  }
  return path;
}

function benchOne(triangleCount: number, symmetryOn: boolean): BenchRow {
  const segments = segmentsForTriangleTarget(triangleCount);
  const mesh = sphere(SPHERE_DIAMETER_MM, { widthSegments: segments, heightSegments: segments });

  const engine = new SculptEngine();
  engine.loadMesh(mesh);
  engine.setBrush('draw');
  engine.setBrushSize(BRUSH_RADIUS_MM);
  engine.setBrushStrength(BRUSH_STRENGTH);
  // FR-10: X-mirror is ON by default. The 'off' variant sets 'none', which
  // is exactly how the app's symmetry toggle turns it off — so both rows
  // measure real, reachable engine configurations.
  engine.setSymmetry(symmetryOn ? 'x' : 'none');

  // Count onChange notifications: emitDirtyRegion fires once per stamp that
  // touched vertices, so a working updateStroke fires >= 1 (2 with mirror).
  let onChangeCount = 0;
  const unsubscribe = engine.onChange(() => {
    onChangeCount++;
  });

  const sphereRadius = mesh.bounds.max[0]!;
  const path = strokePath(sphereRadius, SAMPLES_PER_STROKE);

  engine.beginStroke(path[0]!);

  let totalWorkingMs = 0;
  let workingSamples = 0;
  for (let i = 1; i < path.length; i++) {
    const before = onChangeCount;
    const start = performance.now();
    engine.updateStroke(path[i]!);
    const elapsed = performance.now() - start;
    // Only count samples that actually produced sculpting work — a real
    // continuous drag's frame rate is bounded by the cost of a frame that
    // lands a stamp, not by the sampler's distance-culled no-op frames.
    if (onChangeCount > before && i > 1) {
      totalWorkingMs += elapsed;
      workingSamples++;
    }
  }
  engine.endStroke();
  unsubscribe();

  const avgSampleMs = workingSamples > 0 ? totalWorkingMs / workingSamples : 0;
  return {
    triangleCount: mesh.triangleCount,
    symmetry: symmetryOn ? 'on' : 'off',
    workingSamples,
    avgSampleMs,
    impliedFps: avgSampleMs > 0 ? 1000 / avgSampleMs : Infinity,
  };
}

function ceilingUnder(rows: BenchRow[], budgetMs: number): number {
  let largest = 0;
  for (const r of rows) {
    if (r.avgSampleMs <= budgetMs && r.triangleCount > largest) {
      largest = r.triangleCount;
    }
  }
  return largest;
}

function run(): void {
  const shipped: BenchRow[] = []; // symmetry on — the as-shipped default
  const noSym: BenchRow[] = []; // symmetry off — for the doubling comparison
  for (const target of TARGET_TRIANGLE_COUNTS) {
    shipped.push(benchOne(target, true));
    noSym.push(benchOne(target, false));
  }

  console.table(
    [...shipped, ...noSym]
      .sort((a, b) => a.triangleCount - b.triangleCount || a.symmetry.localeCompare(b.symmetry))
      .map((r) => ({
        triangles: r.triangleCount,
        symmetry: r.symmetry,
        'working samples': r.workingSamples,
        'avg/sample (ms)': r.avgSampleMs.toFixed(3),
        'implied fps': r.impliedFps.toFixed(1),
      })),
  );

  console.log('');
  console.log('Through the real SculptEngine facade, X-mirror symmetry ON (as shipped):');
  console.log(`  >= 60 fps (Med target) up to: ${ceilingUnder(shipped, SIXTY_FPS_BUDGET_MS).toLocaleString()} triangles`);
  console.log(`  >= 30 fps (Max target) up to: ${ceilingUnder(shipped, THIRTY_FPS_BUDGET_MS).toLocaleString()} triangles`);
}

run();
