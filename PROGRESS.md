# PROGRESS

Running log for the `scaffold/v0` build. Any session should be able to resume from this file.
Companion files: [DECISIONS.md](DECISIONS.md) (judgement calls), [FEATURES.md](FEATURES.md) (feature slots for the 3-person split), [plan.md](plan.md) (original 5-hour plan; superseded where it conflicts, see DECISIONS.md).

## Stage checklist

- [x] Stage 0: Recon (branch `scaffold/v0` created from `main` @ `42fe7b2`)
- [x] Stage 1: Scaffold and contract
- [x] Stage 2: Sim core on the fixture
- [x] Stage 3: Data (geo, raster, terrain, bundles, 2 real + 2 synthetic areas, build script)
- [ ] Stage 4: Cesium viewer spike
- [ ] Stage 5: Overlay, playback, ignition (CRITICAL MILESTONE)
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

## Current stage

Stage 4: Cesium viewer spike.

## Next

Stage 5: Overlay, playback, ignition (critical milestone).

## Known issues / not verified

- (none yet)

## Cuts taken

- (none yet)
