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
- [x] Stage 6: Tools and advanced settings
- [x] Stage 7: Effects, hardening, hand-off, tag `v0`

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

### Stage 6 — Tools and advanced settings
- `src/tools/`: `firebreak.ts` (polyline -> swath via the tested 4-connected rasteriser),
  `water.ts` (brush), `history.ts` (undo/redo snapshots), `index.ts` (tool registry with the
  `TODO(tools-v2)` extension point). 8 new tests (53 total), incl. "a firebreak drawn by the tool
  stops the simulated fire".
- `src/app/toolsController.ts`: strokes -> live preview -> timestamped `Intervention` (current
  playback time, or t = 0 in "pre-clear" mode) -> re-simulate preserving playback time.
- UI: palette (Ignition / Firebreak (clear trees) / Water spray), swath width / spray radius,
  pre-clear toggle, Undo / Redo / Clear (also Cmd/Ctrl+Z, Shift for redo), intervention list with
  remove buttons, `Escape` returns to Ignition. Advanced panel: temperature, humidity, dead fuel
  moisture, wind variability, spread / wind / slope multipliers, water half-life and boost, seed,
  burnout; grid size, spotting, crown fire and time-varying weather shown disabled, "coming soon".
- **Verified headlessly** via the dev hook `window.__firesim` (DEV builds only): baseline 1,751
  cells at 4 h -> 968 with a pre-clear firebreak across the downwind path -> 956 with water at
  t = 30 min -> 968 after Undo; list and timestamps correct; no console errors.
- Not verified: real mouse drags in Cesium (no interactive browser available); the pick/drag code
  path is exercised only through `debugStroke()`.

### Stage 7 — Effects, hardening, hand-off
- `src/viewer/particles.ts`: flame + smoke `ParticleSystem`s on up to 20/45/80 front cells (stable
  hash sampling), smoke drifts downwind; "Effects" section in the panel (toggle + quality).
- Hardening: global `error` / `unhandledrejection` banner, empty-index banner, non-burnable
  ignition rejected before simulating, favicon (no more 404), worker auto-respawn (Stage 5),
  area-load and tile-load failures already banner-ed.
- README rewritten (install, env, usage, model in plain words, limitations, layout, adding areas,
  attribution). FEATURES.md finalised against the real `TODO(<slot>)` markers (17 across 7 slots).
  DECISIONS D14-D16. `tests/README.md` updated.
- **Final verification:** `npm run typecheck` ✓, `npm test` 53/53 ✓, `npm run build` ✓ (dist 14 MB
  incl. Cesium assets), from-scratch `rm -rf node_modules && npm install` ✓ (postinstall copies
  Cesium assets), headless run with particles at "high" playing at 256× on Alpirsbach: clean console,
  165 ha at 4 h 18 m (`stage7.png`). No "exact"/"accurate" in user-facing copy; no key fragments
  tracked; only `.env.example` tracked; all source files < 250 lines.

## Definition of Done (prompt §12)

- [x] `npm install && npm run dev` starts clean; `build`, `typecheck`, `test` pass
- [x] Viewer loads (fallback verified; Google path coded, reverts on failure) and the user can fly around
- [x] Click places ignition; Simulate runs in a worker; fire animates with play/pause/speed/scrubber
- [x] Wind, slope and dryness visibly and correctly change the spread (fixture tests + screenshots)
- [x] Firebreak and water tools work in 3D, change the outcome, support undo/redo (verified via dev hook)
- [x] Advanced settings wired; unfinished items labelled "coming soon"
- [x] Honesty notice always visible; no "exact"/"accurate" in user-facing copy
- [x] No keys committed; Google tiles never used as a data source
- [x] Works with no network apart from map tiles (bundles are static); synthetic areas labelled
- [x] PROGRESS / DECISIONS / FEATURES / README complete; branch tagged `v0`

### Google tiles key plumbing (`feature/google-tiles`)

- `.env.example` now documents how to obtain and restrict a key; `.env.local` is created empty
  and confirmed gitignored (`git check-ignore`). History check: only `.env.example` was ever
  tracked, no key value in any commit.
- `src/viewer/googleTiles.ts`: sliding-window failure detection (auth/quota fast path), cost
  controls, URL/key redaction (`src/viewer/redact.ts`, tested in `tests/redact.test.ts`).
- README "Google 3D tiles setup" section; DECISIONS D17.
- Still not exercised with a real key (none on the build machine). First run with a key: check
  overlay alignment against the grid outline and click-to-ignite accuracy.

## Known issues / not verified

- **Google Photorealistic 3D Tiles path not exercised** (no key on the build machine): draping of
  the overlay on 3D tiles, picking on tiles, and particle heights on tiles are untested. First
  teammate with a key: put it in `.env.local`, load the app, check the overlay aligns with the
  corner markers (Debug layers -> Grid outline). If classification on tiles fails, set
  `classificationType: ClassificationType.TERRAIN` in `src/viewer/burnLayer.ts` and keep the globe.
- **Real mouse drags** on the Cesium canvas were not exercised (no interactive browser); the
  pick/drag path runs only through `wiring.debugStroke()`. Click-to-ignite and drag-to-draw should
  be the first things a human checks.
- Boulder Creek has patchy OSM forest polygons, so much of it is default grass; rebuild with
  `--default FOREST_CONIFER` when Overpass is healthy (see Stage 3 follow-up).
- Default ignition for the real areas is the nearest forest cell to the grid centre (Alpirsbach's is
  next to the town). `demo-ship` should set `suggestedIgnition` per area in the bundles.
- Water sprayed on cells that are already burning has no effect by design (see D3).
- The Vite production bundle is one 4.2 MB chunk (Cesium); fine for a demo, split later if needed.

## Cuts taken

- None of the cut list was needed. Follow-fire camera was never planned beyond a stub (TODO in `camera.ts`).

## Resume here

Everything in the prompt is done and tagged `v0`. Next work happens in the `FEATURES.md` slots on
`feature/<slot>` branches off `main` (after `scaffold/v0` is merged).
