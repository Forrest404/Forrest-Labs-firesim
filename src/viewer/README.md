# src/viewer

**The only place that imports Cesium.** Everything else talks to it through the functions
exported here.

**Owns:** viewer creation (`createViewer.ts`), Google Photorealistic 3D Tiles with automatic
fallback (`googleTiles.ts`), the burn overlay (`burnCanvas.ts` draws pixels from `arrivalTime`,
`burnLayer.ts` drapes the canvas on the scene), grid outline and corner markers
(`gridOutline.ts`), camera helpers (`camera.ts`), picking (`picking.ts`: screen -> lon/lat ->
cell via `src/data/geo.ts`), particle flames and smoke (`particles.ts`).

**Must not import:** `src/ui`, `src/sim` internals. It may import `src/contract` and `src/data/geo`.

**Modes**
- Primary: Google 3D Tiles when `VITE_GOOGLE_MAPS_API_KEY` is set and the tileset loads.
- Fallback (automatic): OpenStreetMap raster imagery on the ellipsoid globe, with a banner.
- Never calls Cesium ion. No ion token is needed or read.

**Extension points**
- `particles.ts` `TODO(3d-polish)`: quality levels, glow, better sprites.
- `camera.ts` `TODO(3d-polish)`: follow-fire-front camera.
- `burnCanvas.ts`: colour ramps and legend data.
