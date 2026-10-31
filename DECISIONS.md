# DECISIONS

Every judgement call made while building `scaffold/v0`, newest at the bottom. Teammates may
revisit any of these; if you do, append the new decision rather than editing the old one.

## D1. Where this build deviates from plan.md

`plan.md` (the 5-hour plan written earlier) assumed a 2D MapLibre + React demo. The master
prompt for v0 fixes the stack (CesiumJS 3D, no second map library, no React). Where they
conflict, the prompt wins; plan.md's conventions are kept wherever they do not conflict.

| Topic | plan.md | v0 | Why |
|---|---|---|---|
| Map | MapLibre | CesiumJS | 3D is the product |
| UI | React | Plain TS DOM | Prompt: no React; fewer deps |
| Grid projection | Web Mercator | Equirectangular (lon/lat) | A Cesium `Rectangle` is lon/lat, so an equirectangular grid maps 1:1 onto the draped canvas |
| Model | Probabilistic CA with hash RNG | Deterministic minimum-travel-time (Dijkstra) | Continuous arrival times, no tuning of a probability per tick, naturally deterministic (see D3) |
| Contract naming | snake_case, `-1` never-burned | camelCase, `Infinity` never-burned | Prompt §5 |

Kept from plan.md: 30 m cells, 200 x 200 default, row 0 north / col 0 west, SI units, wind
"from" degrees, fuel 0 = none, presets and fuel table as data, no API key required by default,
bundles under `public/demo-areas/`, the honesty wording, the fixture ideas, the cut order spirit.

## D2. Grid size 200 x 200 at 30 m

40,000 cells. Dijkstra with a binary heap finishes in well under 100 ms; all state is about 1 MB
of typed arrays; the overlay texture is 200 x 200 pixels. A 6 km box is large enough for a fire
to get "out of control" and still be contained. The validator caps grids at 300 x 300.

## D3. Simulation model: minimum travel time, not a stochastic CA

Edge cost from a burning cell to a neighbour is `distance / rate`, where
`rate = baseRate(target fuel) x wind x slope x moisture x globalMultiplier`. Dijkstra over the
8-neighbour graph gives each cell its earliest arrival time. Deterministic by construction; the
`seed` only feeds the optional wind-variability perturbation (mulberry32) and future spotting.

Time-dependent interventions are handled in the relaxation step:
- **Firebreak** at `tb`: a target cell is blocked if the candidate arrival is `>= tb`. A cell that
  ignites before `tb` keeps burning (you cannot clear a burning cell).
- **Water** at `tw` with boost `b` and half-life `h`: `moisture(t) = base + b * 2^(-(t - tw) / h)`.
  If the target is at or above its extinction moisture when the source ignites, the fire may still
  arrive later: we compute `tDry` (closed form) and use `max(tSource, tDry) + distance / rate(tDry)`,
  but only if `tDry` is before the source burns out. This "wait at the source" rule is an
  approximation (fire does not literally wait), documented here and in `src/sim/README.md`.
- Costs are evaluated at the source's arrival time, which keeps Dijkstra's monotonicity.

Ember spotting is NOT implemented; a firebreak wide enough is therefore an absolute barrier.
Real fires jump breaks by spotting. Post-v0, see `FEATURES.md` "Sim realism".

## D4. Sentinels

`arrivalTime` uses `Infinity` for never-ignited (Float32 stores it). Elevation uses `-9999` as
builder-side nodata, which must be filled before a scenario exists; the validator rejects it.

## D5. Cesium integration

- Static assets are copied to `/cesium/` with `vite-plugin-static-copy`; `CESIUM_BASE_URL` is a
  Vite `define`.
- The viewer is created with an explicit OpenStreetMap base layer and an ellipsoid terrain
  provider, with every widget off. **Cesium ion is never called**; no ion token is read.
- With `VITE_GOOGLE_MAPS_API_KEY` present, the Google Photorealistic 3D Tiles tileset is added
  to `scene.primitives` and the globe is hidden. On load failure the tileset is removed, the globe
  is shown and a fallback banner appears.
- The burn layer is a ground-draped rectangle entity whose image material alternates between two
  offscreen canvases (double buffering forces Cesium to re-upload the texture), classified onto
  both terrain and 3D tiles. The Stage 4 spike records whether draping on Google tiles works.

## D6. Picking

`scene.pickPosition` when supported and hitting geometry, else `camera.pickEllipsoid`, then
Cartographic -> degrees -> `geo.lonLatToCell`. Tools only ever see cell coordinates.

## D7. UI without a framework

Plain TS with a tiny `el()` helper and one CSS file. Preact was allowed but not needed for a
side panel; one fewer dependency and no build plugin.

## D8. Demo areas are synthetic in this build

Overpass was unreachable from the build machine (four public endpoints timed out). The two
committed bundles are generated (`scripts/make-synthetic.ts`), flagged `synthetic: true`, and
labelled "(synthetic)" in the picker. The real builder (`scripts/build-demo-area.ts`) is written
and should be run by a teammate on a networked machine. Suggested real areas (varied terrain,
river or road, lots of forest, good OSM coverage):
- Boulder Creek, Santa Cruz Mountains, CA, centre about 37.126, -122.122: redwood forest, Hwy 9,
  San Lorenzo River, strong relief.
- Alpirsbach, Black Forest, DE, centre about 48.345, 8.40: dense `landuse=forest`, Kinzig river,
  B294, good OSM polygons.

## D9. Legal boundary for Google tiles

Google 3D Tiles and imagery are display only. Nothing extracts data from them. All simulation
inputs are open data (OSM/ODbL, AWS Terrain Tiles/Terrarium) or synthetic. Also in
`src/data/README.md` and `.env.example`.

## D10. Unmapped land defaults to GRASS

Overpass returns only mapped features. Cells with no land-cover polygon default to `GRASS`
(configurable in the builder). It makes unmapped areas burnable and visibly "default", which is
more useful in a demo than silently non-burnable gaps.

## D11. TypeScript settings

`strict` on. `noUncheckedIndexedAccess` is off: the sim's inner loops index typed arrays
constantly and the `| undefined` noise would hurt more than help. TypeScript pinned to `~5.9`
(the registry's latest major was newer than the tooling has been exercised with).

## D12. Git workflow for this build

Branch `scaffold/v0` from `main`. `plan.md` (untracked, written earlier this session) is committed
with the Stage 1 docs because `DECISIONS.md` references it. One commit per stage. Nothing pushed.
A teammate branch `feature/gemini-agent` exists on the remote (adds `docs/research/eaton-fire-data.md`); untouched.
