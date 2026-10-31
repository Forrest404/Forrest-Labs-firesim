# PROGRESS

Running log for the `scaffold/v0` build. Any session should be able to resume from this file.
Companion files: [DECISIONS.md](DECISIONS.md) (judgement calls), [FEATURES.md](FEATURES.md) (feature slots for the 3-person split), [plan.md](plan.md) (original 5-hour plan; superseded where it conflicts, see DECISIONS.md).

## Stage checklist

- [x] Stage 0: Recon (branch `scaffold/v0` created from `main` @ `42fe7b2`)
- [x] Stage 1: Scaffold and contract
- [x] Stage 2: Sim core on the fixture
- [x] Stage 3: Data (geo, raster, terrain, bundles, 2 real + 2 synthetic areas, build script)
- [x] Stage 4: Cesium viewer spike
- [x] Stage 5: Overlay, playback, ignition (CRITICAL MILESTONE)
- [ ] Stage 6: Tools and advanced settings
- [ ] Stage 7: Effects, hardening, hand-off, tag `v0`

## Environment (Stage 0 recon)

- Node v25.8.1, npm 11.11.0. Package manager: npm (repo had none).
- Network from the build machine: npm registry OK, Terrarium elevation tiles OK, OSM raster tiles OK.
  **Overpass API unreachable** (overpass-api.de, lz4.overpass-api.de, overpass.kumi.systems,
  overpass.private.coffee all timed out at 20 s on a trivial query). Consequence: demo areas in
  this build are **synthetic** and labelled as such. See Stage 3 notes.
- Remote `origin` has `main` (unchanged) and a teammate branch `feature/gemini-agent`. Not touched.

## Stage log

### Stage 0 — Recon
- Read `README.md`, `ideas.md`, `ROADMAP.md`, `plan.md`, `docs/adr/*`, `CONTRIBUTING.md`.
- Created branch `scaffold/v0`. `plan.md` was untracked; it is committed with the Stage 1 docs.

### Stage 1 — Scaffold and contract
- Vite 8 + TypeScript 5.9 (strict) + Vitest 4; Cesium 1.146 installed; static assets served from `/cesium/`.
- Scripts: `dev`, `build`, `test`, `typecheck`, `build:demo-area`, `make:synthetic`.
- Full contract in `src/contract/` (types, conventions, fuel table, presets, validator) + 7 tests.
- Module READMEs, `DECISIONS.md` (D1-D12), `FEATURES.md` skeleton, `.env.example`.
- Note: commit `f19479e` on this branch was made from VS Code (not by the build session) and
  pushed `PROGRESS.md` + `plan.md` to `origin/scaffold/v0`. Harmless; the build keeps committing locally.
- Verified: `npm run typecheck`, `npm test` (7 pass), `npm run build` all green.

### Stage 2 — Sim core
- `src/sim/`: minimum-travel-time solver (Dijkstra, flat typed arrays, binary heap), factors in
  `rates.ts`, timestamped firebreak/water events in `events.ts`, mulberry32 PRNG, worker + protocol.
- `tests/fixtures.ts` (50 x 50 forest, river, road, optional hill) and 16 sim tests + 2 perf tests.
- Measured: 200 x 200 in ~10 ms, 300 x 300 in ~23 ms (Node, after warm-up).
- Tuning note: upwind (backing) spread was ~50x slower than the head at 8 m/s; softened to ~20x so
  the fire visibly creeps upwind in a demo. Still a placeholder (see `rates.ts`).

### Stage 3 — Data
- `src/data/`: `geo.ts` (only lat/lon <-> cell code), `raster.ts` (even-odd polygons, 4-connected
  lines, discs), `terrain.ts` (Terrarium decode, bilinear sampling, nodata fill, slope/aspect),
  `osm.ts` (tag rules, Overpass query, element rasterisation), `bundle.ts`, `noise.ts`,
  `synthetic.ts`, `demoAreas.ts` (loader + live stub). 18 new tests (41 total).
- `public/demo-areas/`: **Overpass came back during this stage**, so there are two REAL areas
  (`boulder-creek`, `alpirsbach`) plus the two synthetic fallbacks; `index.json` lists real first.
- Verified by rendering each fuel grid as ASCII and running a 6 h simulation on each bundle.
- Bugs found and fixed in this stage:
  - Builder mangled absolute `--out` paths (`join` -> `resolve`).
  - Every residential street and creek was an absolute barrier (Boulder Creek became a maze) and
    `landuse=residential` wiped out 25 % of the grid. Barrier rules narrowed; see DECISIONS D13.
  - Synthetic ridge ignition was boxed in by a road; moved east of it.
- Elevation nodata (`-9999`) never reached a bundle (0 cells filled for both real areas).
- Follow-up for a teammate (`live-data`): OSM forest polygons are patchy around Boulder Creek, so
  ~60 % of that grid is default fuel (grass) though it is redwood belt. The builder now has
  `--default FOREST_CONIFER`; a rebuild with it hit Overpass 502s. Re-run:
  `npm run build:demo-area -- --name boulder-creek --label "Boulder Creek, CA" --center -122.122,37.126 --wind 250 --default FOREST_CONIFER`

### Stage 4 — Cesium viewer spike
- `src/viewer/`: `createViewer.ts` (OSM base layer, ellipsoid terrain, no ion, widgets off),
  `googleTiles.ts` (Google 3D Tiles when a key exists, automatic revert on failure),
  `burnCanvas.ts` (pure painters + tests), `burnLayer.ts` (`GridLayer`: double-buffered canvas
  draped as a ground rectangle, classification BOTH), `gridOutline.ts`, `camera.ts`.
- **Alignment verified visually** (headless Chrome screenshot, fallback mode): the overlay's edges
  sit on the four corner markers, row 0 is north, and the fuel grid lines up with the OSM basemap
  (forest, Kinzig valley road, farmland). Clean console apart from a favicon 404.
- **Google 3D Tiles draping NOT verified** (no API key on the build machine). Fallback mode is the
  tested default; the Google path is coded and reverts to fallback on any load failure.
- Bug found and fixed: `vite-plugin-static-copy` did not serve Cesium's assets in dev (every
  `/cesium/*` request got `index.html`, so workers, `approximateTerrainHeights.json` and textures
  failed and rendering stopped). Replaced by `scripts/copy-cesium.mjs` into gitignored
  `public/cesium/` (postinstall / predev / prebuild). Plugin removed.
- Visual verification method: Chrome extension was not connected, so a small CDP script drives
  the installed Chrome headlessly (SwiftShader WebGL), captures console + screenshot.

### Stage 5 — Core loop (critical milestone) ✅
- `src/app/`: `state.ts` (store), `simClient.ts` (worker RPC, cancel, auto-respawn on crash),
  `clock.ts` (playback), `overlayPainter.ts` (throttled repaint + live stats), `wiring.ts`
  (store <-> viewer <-> worker), `main.ts`.
- `src/viewer/picking.ts` (click + drag, pickPosition -> globe.pick -> ellipsoid fallbacks),
  `ignitionMarker.ts`. `src/data/ignition.ts` picks a default ignition for areas without one.
- `src/ui/`: panel, area picker (with disabled "Live — coming soon"), simple settings (wind km/h,
  wind-from with toward-arrow, dryness presets as data, duration), playback (Simulate / cancel,
  play/pause/restart, 1-256×, scrubber, clock, live ha), debug toggles, notices, `strings.ts`.
- **Verified end to end headlessly:** page loads a real area, default ignition is set, Simulate runs
  in the worker (5-6 ms), fire animates on the draped overlay (`stage5b/c.png`): 55 cells at 26 min,
  1,751 cells / 158 ha at 4 h on the synthetic valley. Console clean except favicon 404.
- Found while verifying: real areas had no suggested ignition so Simulate stayed disabled; fixed
  with `defaultIgnition()` (nearest forest/shrub cell to the centre with burnable neighbours).
- Known: `?area=<name>` picks the start area. `Space` toggles playback, `Escape` returns to the
  ignition tool.

## Current stage

Stage 6: Tools and advanced settings.

## Next

Stage 7: Effects, hardening, hand-off.

## Known issues / not verified

- (none yet)

## Cuts taken

- (none yet)
