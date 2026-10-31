# src/tools

Firefighting tools as pure logic. Input: cell coordinates (already converted from the 3D pick
by `src/viewer/picking.ts` + `src/data/geo.ts`). Output: `Intervention` events for the scenario.

**Owns:** `firebreak.ts` (polyline -> swath of cells, "Firebreak (clear trees)"), `water.ts`
(brush -> cells), `history.ts` (undo/redo over the intervention list), `index.ts` (tool registry).

**Must not import:** Cesium, the DOM, `src/ui`, `src/viewer`.

**Why "clear trees" is a swath:** the data describes vegetation per 30 m cell, not individual
trees, so clearing is modelled as setting fuel to `NONE` in every cell of the swath.

**Extension points**
- `index.ts` `TODO(tools-v2)`: register new tools (retardant, backburn, crews) here.
- `firebreak.ts`: swath width and shape rules.
