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
- Exercised with a real key via headless Chrome: tiles load, overlay drapes on tiles, click
  picking exact (see Known issues). A Cesium ion variant (asset 2275207, `VITE_CESIUM_ION_TOKEN`)
  was built and then reverted the same day because the team's credential is a Google Maps key;
  commits bdde0a6 / d2c0c65 hold it if ion is wanted later (D18).

### UI/UX pass (`feature/google-tiles`)

- Panel rebuilt: brand header with viewer-mode pill and collapse-to-rail, honesty pill, card
  sections (Area, Conditions, Simulate, Tools, Advanced, View), chips for dryness / duration /
  speed / quality, filled sliders, draggable wind dial, switches, icon transport controls,
  animated notices, phone bottom-sheet layout, reduced-motion support. See D19.
- Verified headlessly on 1400x900 and 390x844: chips, dial drag (sets wind from 270 when
  dragged east), switches, simulate, speed, play, collapse, advanced toggle and a firebreak
  stroke all update the store; no exceptions or console errors.

### Smoke plume (`feature/smoke`)

- Deterministic smoke field in `src/app/smoke/` (emission, Briggs plume rise, seeded wind
  meander, semi-Lagrangian advection, box-blur diffusion, loss, checkpointed timeline), draped
  as a new GridLayer (zIndex 4) via `src/viewer/smokeCanvas.ts`; particles driven by the field;
  "Smoke plume" switch in View. See D20.
- `tests/smoke.test.ts` (18 tests): mass conservation, advection distance and sign, diffusion
  symmetry/variance, emission closed form and cut-off, per-fuel burnout, plume/wind laws,
  determinism, scrub-back == recompute, sampleAt interpolation, painters, perf (1.3 ms per
  200x200 step on the build machine).
- Headless (D16 method, served from a snapshot copy so teammate edits cannot reload the page):
  with wind from 270 the 1 h / 6 h smoke centroids lie ~60 cells east of the ignition, with
  wind from 0 ~60 cells south; scrubbing 24 h -> 1 h reproduces the 1 h field exactly; smoke
  layer hides with the switch; no exceptions or console errors.

### Fire visuals (`feature/smoke`, D21)

- Switches for Flames, Embers, Smoke puffs, Smoke plume, Ground glow, Smooth edges; Quality
  chips. Byram-sized flame particles, ember system, flickering ground glow, 2x anti-aliased
  burn/smoke overlays, smoke dimmed over flaming cells. `wiring.focusIgnition()` close-up camera.
- `tests/burnCanvasScaled.test.ts` (6 tests): scale-1 parity with `paintBurn`, nearest
  upsample parity, anti-aliased edge alpha, glow only on empty pixels and only while flaming,
  deterministic flicker, bilinear/nearest upsampling.
- Headless: all six switches toggle in the store with no errors; top-down captures show the
  smooth front + glow vs the blocky overlay; close-up capture of flames/embers/puffs.

## Live fires tab (`feature/live-fires`, 2026-10-31)

- New: `src/data/firms.ts` + `firmsClient.ts` (tested: 32 cases, mutation-checked), `src/viewer/hotspotLayer.ts`,
  `src/app/liveController.ts`, `src/ui/live.ts`, `controls.tabBar`, `state.view` / `state.live`,
  `ViewerHandle.setBackdrop`, `redact()` masks 32-hex keys. Decision D22.
- **Verified headlessly with a real key** (installed Chrome, SwiftShader, Google mode, 1400x900):
  clicking the tab fetches NOAA-20 + SNPP world/1 day (59,116 rows, 52,302 after the default
  low-confidence filter), the globe view shows the dots, "Largest fires" fly-to selects the sample
  point and fills the details card, a min-FRP filter changes the count without a refetch, a forced
  refresh inside the 60 s floor makes no request, switching back restores the grid, tiles and marker,
  and the key appears nowhere in console, exceptions or DOM. Screenshots in the session scratchpad.
- Verified without a key (fallback globe): key-missing card with link, refresh disabled, nothing
  fetched. With a bogus key: FIRMS answers 400 without CORS headers, so the browser reports
  "NASA FIRMS did not answer…" (see D22); nothing crashes.
- Fire regions + satellite basemap (D23): `regionsFromHotspots` (tested: linkage, adjacency,
  hull, footprint area; mutation-checked on the neighbour linkage), `src/viewer/regionLayer.ts`
  (one batched `GroundPrimitive`, highlight primitive for the selection), `live.layers` and
  `live.basemap`, `ViewerHandle.setBasemap`. Headless with a real key: 52,302 filtered detections
  gave 12,899 regions (largest: 676 detections, 7,390 MW, ~800 km², 21-vertex hull), region
  fly-to fills the region card and highlights the list entry, the satellite basemap pulled 56
  Esri tiles, toggling regions off removes the hulls, selecting a point clears the region.
- Not verified by a human: real mouse clicks on dots or regions (the pick path uses `scene.pick` with a 6 px
  box and was exercised only through `__firesim.live.flyToCluster`), the phone layout of the live
  pane, and behaviour when Google tiles fail *while* the live view is open.

## Visual system v2 (D24, 2026-10-31)

- Chrome and copy pass only (styles.css overrides, strings, panel, live pane, area picker,
  index title, Cesium credit). Verified headlessly on desktop and 390 px: no glass, no glow,
  underline tabs, serif wordmark and numbers, no placeholders, one disclaimer per view.

## Known issues / not verified

- **Google Photorealistic 3D Tiles path verified headlessly** (2026-10-31, real key in
  `.env.local`): tileset loads, mode line reads Google, Google credit shown, burn overlay drapes
  onto the tiles (`ClassificationType.BOTH`), and a synthetic click on the tiles placed the
  ignition marker within 1 px of the click (pickPosition path). Particle heights on tiles still
  unchecked by a human. Earlier fallback suggestion (`ClassificationType.TERRAIN`) is not needed.
- **Smoke**: particle physics runs on wall-clock time and Cesium's emitters are random, so only
  the draped field is reproducible. No Worker yet: a 24 h forward scrub catches up over a few
  seconds (12 ms per frame budget). FPS impact not measurable headlessly (SwiftShader).
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

## Demo check with response teams (`feature/demo-integration`, 2026-10-31)

- Snapshot of the worktree served on its own port (so other sessions' edits cannot reload the
  page) and driven headlessly in Google 3D mode through `window.__firesim` and real DOM clicks.
- **Response teams** (Boulder Creek, 1,339 homes): all four levels plan and render; stats chips,
  order list, Without / With flip, outline, 3D units, dispatch cards, the enable switch (falls back
  to the baseline run), the Dispatch button (enables and runs), stale hint after a weather change,
  scrubbing while playing. Sanity on every plan: contained never burns more than the baseline,
  every order has interventions, ETA after dispatch, nothing dispatched before the delay (after the
  fix in D27's addendum).
- **Everything else**: plain simulate, Space / Escape, firebreak and water strokes (pre-clear and
  at playback time), undo and clear, hand-drawn line plus response, AI plan (built-in: 67 → 17 ha,
  65 → 0 homes), all six effect switches and the quality chips, ground view, Red Flag day, Crozier
  compare (67 / 37 / 11 % IoU) and Real vs simulation (pauses itself), responses on Alpirsbach and
  both synthetic areas, the NIFC live-fire list. No exceptions or console errors in any run.
- **Rehearsed script** (DEMO.md): 12 h, no response 176 ha / 262 homes; Standard 153 ha / 254;
  Maximum 11 ha / 0; Red Flag + Maximum 47 % saved. Plans take 1-3 s in the worker.
- **Live fires tab**: clicking the tab loads 66,607 detections (14,029 regions) in 2.3 s. Pressing
  refresh while the first load is in flight left the tab on "loading" for good: the client handed
  the new caller the aborted in-flight promise. Fixed in `firmsClient.ts` (an aborted in-flight
  request is not reused), regression test added, re-checked in the browser.
- **Not working / not verified**: "predict a live fire" fails in headless Chrome with a LANDFIRE
  HTTP 500 that carries no CORS header ("Failed to fetch"), while the same URL answers 200 from
  curl; it could not be checked in a real Chrome (extension not connected), so test it by hand
  before promising it. Response popup and dispatch cards hidden under 720 px. Real mouse drags on
  the 3D canvas still only exercised through `wiring.debugStroke`.

## Resume here

Everything in the prompt is done and tagged `v0`. Next work happens in the `FEATURES.md` slots on
`feature/<slot>` branches off `main` (after `scaffold/v0` is merged).


## Demo scenario work (branch `feature/demo-scenario`, from `main`)

- [x] Stage 0: worktree `../Forrest-Labs-firesim-demo`, baseline green, on-screen disclaimer removed (as requested).
- [x] Stage 1: real **Surrey Hills (Leith Hill)** bundle built from OpenStreetMap + AWS terrain (Overpass answered on
  the second pass; it returns 502 or times out now and then). Found and fixed a builder bug: multipolygon
  woodlands split across several ways were dropped (`assembleRings`, D29). Road-leak fuzz tests added; a 1-cell road
  cannot be crossed (no change needed).
- [x] Stage 2: `npm run tune:demo`, `src/data/demo-scenarios.ts`, `src/app/demoEval.ts`, tests. Both scenarios pass all
  checks: uncontained fire reaches the village, saved plan holds it, flipped wind reverses the fire (D30).
- [x] Stage 3: Demo card (Load demo scenario, Reset, Show contained version as one undo step, Demo tips),
  camera framing on the action, fallback to the offline backup if a bundle fails to load.
- [x] Stage 4: backup scenario on the generated area (works with no network).
- [x] Stage 5: `DEMO-SURREY.md` (3-minute script, coordinates, pre-flight, troubleshooting).

Verified: typecheck, tests, production build, `npm run tune:demo`; headless Chrome with real mouse clicks
(Load, Simulate, Space to pause, Show contained, Undo, Reset, backup, tips) and screenshots.
Not verified: Google 3D tiles (no key used here), drawing the firebreak with a real mouse drag on the 3D map,
a fully offline run (the OpenStreetMap globe still fetched tiles here), the demo on a projector.
If the Surrey bundle is ever missing (Overpass blocked on a machine): the Demo card falls back to the backup
and says so; rebuild with the command in `DEMO-SURREY.md` on a networked machine.
