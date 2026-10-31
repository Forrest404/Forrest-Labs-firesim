# src/ui

Plain TypeScript DOM UI (no framework). One side panel, notices, and a small `el()` helper.

**Owns:** `panel.ts` (layout), `settingsSimple.ts`, `settingsAdvanced.ts`, `playback.ts`,
`tools.ts` (tool palette + intervention list), `notices.ts` (honesty notice, fallback banner,
errors, loading), `debug.ts` (debug toggles), `strings.ts` (ALL user-facing text), `styles.css`.

**Must not import:** Cesium. UI talks to the viewer only through `src/app` wiring.

**Rules**
- Every user-facing string lives in `strings.ts`. Never write "exact" or "accurate" in copy.
- The honesty notice ("Simplified model. Not for real-world decisions.") is always visible.
- Panels read and write the app store (`src/app/state.ts`); they never own state.
- Units: the store is SI; sliders convert at the edge (e.g. km/h shown, m/s stored).

**Extension points**
- `settingsAdvanced.ts` `TODO(settings-polish)`: validation, units toggle, more knobs.
- `tools.ts` `TODO(tools-v2)`: new tool buttons register through `src/tools/index.ts`.
