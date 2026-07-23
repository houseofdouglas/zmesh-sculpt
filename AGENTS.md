# zmesh — Agent Map

zmesh is a browser-based, beginner-first 3D sculpting app targeted at 3D printing: Tinkercad-style approachability, brush sculpting for organic shapes (figurines, minis, busts), and always-watertight STL/3MF export. Fully client-side in v1 (no backend, local-first persistence). Built with React + Vite and Three.js (WebGPURenderer with WebGL2 fallback); the interesting parts — mesh structures, brush deformation, remeshing, manifold export — are implemented in-house.

This file is a map, not a manual. Read the linked documents for detail.

## Where things live

| What | Where |
|---|---|
| Tech stack, layer rules, standards, invariants | `constitution.md` (read before any architectural change) |
| Project brief (problem, users, scope) | `docs/briefs/zmesh-brief.md` |
| Feature specs (source of truth) | `docs/specs/` |
| Task lists per feature | `docs/tasks/` |
| In-flight execution plans | `docs/plans/active/` |
| Completed plans | `docs/plans/completed/` |
| Architecture decisions | `docs/adr/` |
| Design notes & diagrams | `docs/design/` |
| Application source | `src/` (layers: `types → core → engine → viewport → ui`) |
| Deployment (S3+CloudFront CDK, later phase) | `infra/` |

## Working rules

- **When starting a new task, read the relevant spec first.** Specs are the source of truth; code is derived from specs.
- Respect the layer order in `constitution.md` — especially: `src/core/` is pure and framework-free; React never re-renders per sculpt stroke.
- The product invariants (watertight export, real mm units, never lose work, 60 fps sculpting) override convenience. If a task conflicts with one, stop and flag it.
- Record significant decisions as ADRs in `docs/adr/`.
