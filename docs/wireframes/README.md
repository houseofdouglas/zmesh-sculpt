# Wireframes — zmesh v1

Low-fidelity, grayscale, annotated wireframes for the v1 screens. Open the `.html` files in a browser. Each includes a default state, key alternate states, a UX-review checklist, and numbered annotations tying elements back to requirements (FR/NFR/BR) and flows.

Source flows: [../design/zmesh-v1-flows.md](../design/zmesh-v1-flows.md) · Requirements: [../requirements/zmesh-v1-requirements.md](../requirements/zmesh-v1-requirements.md)

| Wireframe | Covers | Flows |
|---|---|---|
| [zmesh-v1-sculpt-workspace.html](zmesh-v1-sculpt-workspace.html) | The core screen: viewport, 7-brush rail, size/strength, detail slider, mirror toggle, undo/redo, **settled camera-vs-brush input model** (trackpad + mouse). States: remesh-in-progress, detail-ceiling. | 1–8 |
| [zmesh-v1-export-panel.html](zmesh-v1-export-panel.html) | Print-ready export: mm dimensions, uniform scale, printer-bed context + fit preview, STL/3MF. States: oversized-warning, validating/repairing, success, **refused** (the watertight gate). | 4 |
| [zmesh-v1-gallery.html](zmesh-v1-gallery.html) | Home project grid (IndexedDB) + context menu. States: new-sculpt shape picker, rename, delete-confirm, empty. | 1, 5, 8 |
| [zmesh-v1-system-states.html](zmesh-v1-system-states.html) | Cross-cutting edges: unsupported-browser notice, crash-recovery prompt, invalid-file + version-mismatch errors. | 1, 7, 8 |

**Not separately wireframed (deliberate):** Save/Load file dialogs are OS-native (native picker on Chrome/Edge; download/upload fallback on Safari/Firefox) — surfaced via "Open .zmesh…" in the gallery and "Save file" in the export panel.

## Key decisions settled during wireframing
- **Input model** (trackpad-first): 1 finger = act on the model / sculpt, 2 fingers = camera; parallel mouse scheme. Hold-Space dropped in favor of an always-works secondary-orbit.
- **Oversized-for-bed is a warning, not a block.**
- **Detail control** = named stops (Low/Med/High/Max), ceiling set by the Q-01 60fps benchmark.
- **Failure states fail safe**: export refuses rather than emit a broken file; bad file loads never mutate current work; recovery defaults to Restore.
