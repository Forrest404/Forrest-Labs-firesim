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

- Static assets are copied into the gitignored `public/cesium/` by `scripts/copy-cesium.mjs`
  (postinstall / predev / prebuild) and `window.CESIUM_BASE_URL = '/cesium/'` is set in
  `index.html`. (`vite-plugin-static-copy` was tried first and did not serve the files in dev.)
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

## D8. Demo areas: two real, two synthetic

Overpass was unreachable during recon (four public endpoints timed out), so two synthetic areas
were generated first (`scripts/make-synthetic.ts`, flagged `synthetic: true`, labelled
"(synthetic)" in the picker). Overpass came back during Stage 3 and the real builder
(`scripts/build-demo-area.ts`) produced two real bundles, which are listed first:
- `boulder-creek`: Boulder Creek, Santa Cruz Mountains, CA (37.126, -122.122): redwood forest,
  Hwy 9, San Lorenzo River, 100-800 m relief. Patchy OSM forest polygons; much land is "default".
- `alpirsbach`: Alpirsbach, Black Forest, DE (48.345, 8.40): dense `landuse=forest` (75 % of
  cells), Kinzig river, B294, railway.
The synthetic areas stay as the no-network fallback and as a predictable test bed.
Bundles are about 260 KB each (base64 fuel + Float32 elevation); 4 of them is fine to commit.

## D13. Which OSM features are barriers

A 30 m cell is either burnable or not, and the model has no spotting, so every barrier is
absolute. To avoid turning real areas into mazes:
- Roads are barriers only for `motorway/trunk/primary/secondary/tertiary` (+ links). Residential and
  unclassified streets are ignored (a few metres wide; Boulder Creek had 5,500 cells of them).
- Waterways are barriers only for `river` and `canal`; `stream` is ignored (5,100 cells of
  creeks in Boulder Creek).
- `building=*`, industrial/retail/quarry land use, parking and runways are non-burnable.
  `landuse=residential` is NOT: in wildland-urban areas those polygons are wooded lots and would
  have removed a quarter of the Boulder Creek grid. They fall through to the default fuel (D10).
Teammates on `sim-realism` / `live-data` can revisit once spotting exists.

## D14. Particle effects and heights

Flames and smoke are Cesium `ParticleSystem`s on up to 20/45/80 (low/medium/high) front cells,
chosen by a stable per-cell hash so emitters do not jump between frames. Smoke drifts with the
wind. Heights: on the fallback ellipsoid globe everything sits at 0 m; with Google 3D tiles the
elevation grid is used, which is orthometric and can be off by the geoid offset (tens of metres).
`scene.sampleHeight` would be right but needs a rendered frame; left to `3d-polish`.

## D15. Dev hook

In dev builds only, `window.__firesim = { store, wiring }`. `wiring.debugStroke(points)` feeds a
cell-space stroke through the active drawing tool. This is how the headless tests exercise the
tools without a real mouse; it is also handy for teammates. Not present in production builds.

## D16. Verification method

The Chrome extension was not connected during the build, so a small CDP script drives the
installed Chrome headlessly (SwiftShader WebGL): navigate, run a JS scenario, capture console and
a screenshot. Everything visual reported in `PROGRESS.md` comes from those screenshots. Real
mouse drags on the 3D view were not exercised.

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

## D17. Google 3D tiles: key plumbing, failure detection and cost controls

The key reaches the viewer only via `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` (read once in
`src/app/main.ts`, passed to `createViewer`). It is never stored in a tracked file, never logged,
and every error message that could contain a tile URL passes through `src/viewer/redact.ts`
(URLs and `key=` fragments are stripped) before it reaches a banner or console.

Fallback triggers, all leading to the same OSM globe plus banner: empty key; root tileset fetch
failure (any HTTP status or network error); 3 auth/quota failures (401/403/429) or 25 other tile
failures inside any sliding 30 s window after start. The old fixed 30 s window after boot was
replaced because a quota can run out mid-session. There is no automatic switch back to Google
mode; reload the page.

Cost: `maximumScreenSpaceError` 20 (default 16), `preloadFlightDestinations` off,
`cullRequestsWhileMoving` on, `dynamicScreenSpaceError` on, cache 512 MB. No geocoder exists, so
`onlyUsingWithGoogleGeocoder` is set to silence Cesium's warning.

Draping and picking on tiles: `ClassificationType.BOTH` (D5) is the right setting for classifying
onto 3D Tiles, and `scene.pickPosition` (D6) is the tile-aware path. Neither has been exercised
with a real key on the build machine (no key available). If the overlay does not drape, keep the
fallback as default and revisit per PROGRESS.md "Known issues".

## D18. 3D tiles come from Cesium ion, not a Google Maps key (supersedes the key part of D5/D17)

The team has a Cesium ion account, so the photoreal backdrop is now ion asset 2275207 ("Google
Photorealistic 3D Tiles" from the Asset Depot) authenticated with `VITE_CESIUM_ION_TOKEN`. The
Google Maps key path (`googleTiles.ts`, `VITE_GOOGLE_MAPS_API_KEY`) is removed rather than kept
as a second option: one credential, one setup page, one failure path. D5's "ion is never called"
is relaxed to "ion is called for that one asset only": the token goes to `IonResource.fromAssetId`
per request and is never assigned to `Ion.defaultAccessToken`, so no other ion default (terrain,
imagery, geocoder) can silently start using it. Base imagery stays OpenStreetMap and terrain
stays the ellipsoid in fallback mode.

Everything else in D17 carries over unchanged: failure window and auth fast path (401/403/429,
plus 404 reported as "asset not added to the account"), cost controls, redaction (now also strips
`access_token=`, Bearer headers and JWT-shaped strings, since ion tokens are JWTs). The mode name
is `tiles` instead of `google`. Draping and picking on the tileset remain unverified on the build
machine (no token available).
