# src/data

Turns the world into a `Scenario` grid. Node-safe (used by `scripts/` and the browser).

**Owns:** `geo.ts` (the ONLY lat/lon <-> cell conversion in the app), `raster.ts` (polygons and
lines onto the grid), `terrain.ts` (Terrarium decode, slope/aspect, gap fill), `osm.ts` (OSM tags
to `FuelClass`, Overpass query text, element to shapes), `bundle.ts` (demo-area JSON format),
`synthetic.ts` (generated areas), `demoAreas.ts` (loader + `index.json`).

**Must not import:** Cesium, the DOM, `src/ui`, `src/viewer`, `src/sim`.

**Legal boundary (strict):** Google 3D Tiles and Google imagery are for DISPLAY ONLY. Nothing
in this folder (or anywhere) may scrape, cache, download, sample heights from, run detection on,
or otherwise extract data from Google tiles or imagery. Every simulation input comes from open
data: OpenStreetMap (ODbL) via Overpass, AWS Terrain Tiles (Terrarium), or synthetic generation.

**Conventions:** see `src/contract/conventions.ts`. Unmapped land defaults to `GRASS`
(configurable in the builder options). Elevation gaps are filled from the nearest valid sample
before a scenario is produced; `ELEVATION_NODATA` must never reach the sim.

**Extension points**
- `TODO(live-data)` in `demoAreas.ts`: the "Live (current view)" loader stub.
- `osm.ts` `TAG_RULES`: add or change tag -> fuel mappings.
- `bundle.ts`: optional layers (e.g. canopy height) go in as new optional base64 fields.
