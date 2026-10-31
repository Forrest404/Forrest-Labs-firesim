# src/viewer

**The only place that imports Cesium.** Everything else talks to it through the functions
exported here.

**Owns:** viewer creation (`createViewer.ts`), Google Photorealistic 3D Tiles with automatic
fallback (`googleTiles.ts`), the burn overlay (`burnCanvas.ts` draws pixels from `arrivalTime`,
`burnLayer.ts` drapes the canvas on the scene), grid outline and corner markers
(`gridOutline.ts`), camera helpers (`camera.ts`), picking (`picking.ts`: screen -> lon/lat ->
cell via `src/data/geo.ts`), particle flames and smoke (`particles.ts`), and the camera controls
(`compass.ts`, `orbit.ts`, `flight.ts`, pure maths in `cameraMath.ts`, see below).

**Must not import:** `src/ui`, `src/sim` internals. It may import `src/contract` and `src/data/geo`.

**Modes**
- Primary: Google 3D Tiles when `VITE_GOOGLE_MAPS_API_KEY` is set and the tileset loads.
- Fallback (automatic): OpenStreetMap raster imagery on the ellipsoid globe, with a banner.
- Never calls Cesium ion. No ion token is needed or read.

**Camera controls** (mounted by `src/app/main.ts`; self-contained, independent of the side panel)
- Compass dial (bottom right): the ring turns so the red N always points to true north. Drag the
  ring to turn the view (the map swings round the point at the centre of the screen); click it, or
  press Enter when focused, to face north. The orange mark is where you are looking.
- Tilt: the ▲ / ▼ buttons change the angle by 10 degrees. `?` shows the controls card.
- Free flight (proper 3D, any direction): W/A/S/D move forward, left, back, right along the
  direction you are looking; R/F rise and sink; Q/E or the left/right arrows turn; the up/down
  arrows look up and down; hold Shift for 4x speed. Speed scales with height (a street-level fly-by
  is slow, a view from 6 km is fast). The camera never goes below 3 m above the surface.
- Keys are ignored while typing in a field, and with Cmd/Ctrl/Alt held, so they do not clash with
  undo or the tool shortcuts (Space, Escape and Z are deliberately not used).
- Orbit turns and tilts take the target, range and angles once per gesture (`beginOrbit`) and
  measure angles in the target's own east/north/up frame. Reading the camera's heading/pitch and
  feeding it back used to drift the pitch by about 0.4 degrees per step; this removes it.
- The ground under the camera is the ellipsoid in fallback mode (no terrain), so "3 m above the
  surface" is 3 m above sea level there. With Google tiles it is measured to the same ellipsoid, so
  hills can still rise above you. Not handled yet: collision with 3D tile buildings.

**Extension points**
- `particles.ts` `TODO(3d-polish)`: quality levels, glow, better sprites.
- `camera.ts` `TODO(3d-polish)`: follow-fire-front camera.
- `burnCanvas.ts`: colour ramps and legend data.
