# src/viewer

**The only place that imports Cesium.** Everything else talks to it through the functions
exported here.

**Owns:** viewer creation (`createViewer.ts`), Photorealistic 3D Tiles from Cesium ion with automatic
fallback (`ionTiles.ts`), the burn overlay (`burnCanvas.ts` draws pixels from `arrivalTime`,
`burnLayer.ts` drapes the canvas on the scene), grid outline and corner markers
(`gridOutline.ts`), camera helpers (`camera.ts`), picking (`picking.ts`: screen -> lon/lat ->
cell via `src/data/geo.ts`), particle flames and smoke (`particles.ts`).

**Must not import:** `src/ui`, `src/sim` internals. It may import `src/contract` and `src/data/geo`.

**Modes**
- Primary: Photorealistic 3D Tiles (ion asset 2275207) when `VITE_CESIUM_ION_TOKEN` is set and the tileset loads.
- Fallback (automatic): OpenStreetMap raster imagery on the ellipsoid globe, with a banner.
- Cesium ion is used only for that one asset, with the token passed per request (never `Ion.defaultAccessToken`). Base imagery and terrain never come from ion.

**Extension points**
- `particles.ts` `TODO(3d-polish)`: quality levels, glow, better sprites.
- `camera.ts` `TODO(3d-polish)`: follow-fire-front camera.
- `burnCanvas.ts`: colour ramps and legend data.
