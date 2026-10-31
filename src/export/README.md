# src/export

Turns simulation results into files other tools can read. No DOM, no Cesium (the browser download
helper lives in `src/app/download.ts`).

**Owns:** `geojson.ts`: fire perimeters (isochrones: contours of the arrival-time field, hourly by
default), ignition and firefighting-action points, and ensemble burn-probability lines (10 / 50 / 90 %
by default). RFC 7946: WGS84 `[lon, lat]`, exterior rings counter-clockwise, holes clockwise, closed
rings. The contouring itself (marching squares, rings, polygons with holes) is `src/data/contours.ts`.

**May import:** `contract/`, `data/`, `sim/`. **Must not import:** Cesium, the DOM, `ui/`, `viewer/`.

Every file carries a `disclaimer` member ("Simplified model. Not for real-world decisions."), the model
name, and whether the demo area's data is synthetic, because an exported file loses the app's on-screen
notice. Do not remove them.

**Extension points:** add a format (KML, shapefile) as a new file here that reuses `contourPolygons`.
