# Project Brief: zmesh

**Status**: Approved 2026-07-19

**Core Problem**: Hobbyist 3D-printer owners can't create organic shapes (figurines, busts, creatures) without climbing the learning curve of Blender/ZBrush — and the approachable tools (Tinkercad, Womp) can't do brush sculpting, while the browser sculpting tools that exist are either dead (SculptGL, archived Jan 2026), pro-oriented (Nomad Sculpt web), or paywall printable export (Re:Form). No tool treats "beginner sculpts → guaranteed-printable file" as its core loop.

**Value Proposition**: zmesh helps hobbyist 3D-printer owners sculpt organic models and print them successfully by pairing Tinkercad-style approachable brush sculpting with always-watertight, print-ready STL export.

**Primary User**: An adult with a home 3D printer and no 3D-art background who wants custom figurines, miniatures, or decorative prints — comfortable with a slicer, intimidated by Blender.

**Secondary Users**: The builder (learning goal: deep dive into real-time mesh processing and GPU rendering). Commercial audience is a possible later phase, not a v1 driver.

**Known Constraints**: None hard. Local-first vs. cloud saves left open (local-first is the lighter default for v1). No timeline pressure.

**Complexity Estimate**: **Large** overall — real-time sculpting is genuinely hard (dynamic topology, undo on huge meshes, watertight guarantees). Phases cleanly; v1 as scoped is a **Medium** slice.

**Explicitly Out of Scope (v1)**: Mesh import (phase 2/3 — see below), printability analysis (wall thickness, overhang/support checks), accounts and cloud sync, sharing/community features, texturing/painting, animation, multi-object scenes, slicing.

## Key Capabilities (high-level, not requirements)

- Sculpt a base mesh (sphere/blob primitives) with a small, well-chosen brush set — draw, smooth, inflate, pinch, grab — with robust undo
- Beginner-first UX: zero-install, works in minutes without a tutorial, forgiving defaults (Tinkercad ethos)
- Guaranteed-manifold export: every model leaves as a watertight STL/3MF a slicer will accept without repair
- Local-first persistence: save/load projects to disk or browser storage
- Print-scale awareness: model dimensions shown in real mm, printer-bed-size context

## Later-Phase Capabilities (phase 2/3)

- **Mesh import + remesh-on-import**: import OBJ/STL/GLB/USDZ meshes — notably photogrammetry scans from macOS Object Capture — and voxel-remesh them into clean, watertight, sculptable geometry. Photogrammetry output is dense, messy, and often non-manifold, so remesh-on-import is the enabler; it shares its core machinery with the watertight-export guarantee. Target workflow: scan a real object → import into zmesh → touch up / customize → print.
- Printability analysis (wall thickness, overhangs, stability)
- Cloud saves / sharing (if the commercial angle materializes)

## Competitive Landscape (as of 2026-07)

| Tool | Browser | Brush sculpting | Print-first | Notes |
|---|---|---|---|---|
| SculptGL | yes | yes | no | Archived Jan 2026, no further development |
| Womp | yes | no (SDF "goop") | partial | Free STL export; not for character/figurine work |
| Nomad Sculpt | web version | yes | no | Best-in-class UX; pro-leaning, iPad-centric |
| Re:Form | yes | yes | partial | STL export paywalled (free tier OBJ only) |
| Blender / ZBrushCoreMini | no | yes | no | Free desktop; the learning-curve problem itself |

**Unowned position**: beginner-first browser sculpting where 3D printing is the goal, not an afterthought.
