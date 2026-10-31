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

Draping and picking on tiles: `ClassificationType.BOTH` (D5) classifies onto the 3D Tiles and
`scene.pickPosition` (D6) is the tile-aware path. Both verified headlessly with a real key on
2026-10-31: overlay drapes on the tiles, synthetic click lands the marker within 1 px.

## D18. Stay on the Google Maps key; Cesium ion variant shelved

An ion-based variant (asset 2275207 "Google Photorealistic 3D Tiles" via `IonResource.fromAssetId`
with `VITE_CESIUM_ION_TOKEN`, token passed per asset and never set on `Ion.defaultAccessToken`)
was built in bdde0a6 and reverted in d2c0c65: the credential the team actually holds is a Google
Maps key (`AIza...` shape), which ion rejects with 401. One credential, one path. If the team
later gets an ion account, cherry-pick bdde0a6; its redaction also covers `access_token=`,
Bearer headers and JWTs, which is worth keeping either way.

## D19. UI system: one control kit, SVG icons, motion tokens

The side panel was rebuilt as cards on a small token set (`src/ui/styles.css` `:root`) with
shared primitives in `src/ui/controls.ts` (section, segmented chips, filled slider, switch,
icon button, value chip) and one Lucide-style inline SVG set in `src/ui/icons.ts` (no emoji,
no icon font, no network font). Rules that follow from it:
- Presets and enumerations are chips (`segmented`), not `<select>`; the area picker stays a
  native select because its list is data-driven and can grow.
- Every slider is `slider()` so the filled track stays in sync when the store writes `.value`.
- Motion uses two durations (140 / 240 ms) and one easing; `prefers-reduced-motion` collapses
  all of it. Store subscribers must not rebuild DOM every tick: the clock updates the store
  every frame during playback, so lists and icons are only replaced when their input changes
  (the first version re-created the intervention list per tick and its fade-in never finished).
- `settingsAdvanced.ts` is owned by the `settings-polish` slot and was not edited; its
  `<details>` summary is hidden and the card header drives `open`, synced through
  `store.advancedOpen`.
- Copy is shorter everywhere (hints are one line, "display only" wording lives in the mode pill
  tooltip and README); the honesty notice text itself is unchanged.

## D20. Cosmetic smoke field (deterministic, not a dispersion model)

Smoke is app/viewer code only (`src/app/smoke/`, `src/viewer/smokeCanvas.ts`); the contract
and the spread model are untouched and nothing feeds back. The field is column-integrated
particulate per cell on the sim grid, stepped on a 60 s lattice: closed-form per-fuel emission
(uniform flaming over the fuel's `burnDurationS`, exponential smoldering tail per fuel, nominal
emission factors 0.010 / 0.025 kg per kg fuel weighted 0.5-1.5 by the sim's relative intensity),
semi-Lagrangian advection, three-box Gaussian diffusion (K = 15 + 10 u + 30 per km of plume
top), 4 h first-order loss. A Briggs bent-over final rise from the summed flaming heat release
gives one global plume top that scales transport speed (power-law profile) and diffusivity;
column mass is not diluted by height. Wind is the scenario snapshot that produced the result
(not the live, possibly edited weather) plus a seeded meander from `windVariabilityDeg` via
mulberry32; no `Math.random` in the model. Checkpoints every 20 steps make scrubbing back a
bitwise-identical replay; forward jumps catch up on a budgeted per-frame loop (12 ms).

Terrain does not steer the drift: a column at plume height is not channelled by 30 m terrain
and, with one wind vector and no boundary layer, an up-valley bias would be invented. Terrain is
used only for particle emitter heights (D14).

Particles are now driven by the field (emission weight, local plume rise, buoyancy decay, wind
profile, hash turbulence) but Cesium's emitters still use their own randomness, so particle
visuals are not reproducible; only the draped field is. Both the burn overlay and the smoke
follow per-fuel burnout (`arrival + burnDurationS`, what the sim uses); the old
`waterHalfLifeS * 1.5` window was never physically related to burning and remains only as the
no-result fallback. With `burnoutEnabled = false` the sim spreads forever but visuals still use
the per-fuel duration.

Honesty: this is not a dispersion model validated against observations. No boundary layer, no
terrain channelling, no chemistry; emission factors and extinction (4000 m^2/kg) are
order-of-magnitude placeholders and opacity is illustrative.

## D21. Fire visuals: every extra is a switch

The View card lists six independent switches (`EffectsFlags`): Flames, Embers, Smoke puffs,
Smoke plume (the D20 layer), Ground glow, Smooth edges, plus the particle Quality chips. Each
flag is read in exactly one place (particles for the first three, the overlay painter for glow
and smoothing, layer visibility for the plume) so turning one off removes only that cost.

- **Flames** are Cesium particle systems with a teardrop sprite; their height comes from Byram
  flame length `L = 0.0775 (H w R)^0.46` using the fuel's heat and load and the cell's spread
  rate (`intensity x maxSpreadRateMps`), exaggerated x4 and clamped 3-16 m so they read at
  30 m cells. They lean downwind and flicker; 'low' quality skips the per-particle update.
- **Embers** are small hot sprites lofted for the first third of their life, then pulled down
  by gravity while the wind profile and hash turbulence carry them; rate scales with the local
  smoke emission weight.
- **Ground glow** is painted on the burn overlay: a flickering orange halo (deterministic per
  cell and 20 s slot) onto unburned pixels within 2.5 cells of a flaming cell.
- **Smooth edges**: the burn and smoke layers are 2 canvas pixels per cell (`GridLayer.scale`);
  with the switch on, the burn painter bilinearly interpolates burned fraction and age across
  the four nearest cells (anti-aliased front, soft ramp) and the smoke field is upsampled
  bilinearly; off, both are nearest-neighbour so the cell structure is honest and visible.
- Smoke drawn over cells that are flaming right now is dimmed to 30 % so the fire is never
  hidden under its own plume.

None of this changes the simulation; the particle visuals remain non-reproducible (Cesium
emitter randomness), the overlay pixels are deterministic and unit-tested
(`tests/burnCanvasScaled.test.ts`).

## D22. Live fires tab: NASA FIRMS detections next to the simulator

The panel now has two tabs, **Simulation** (everything that existed) and **Live fires**
(`state.view`). The live tab shows near-real-time active-fire detections from the NASA FIRMS
area API for the whole globe; the two 6 km demo grids almost never contain a detection, so a
grid-only overlay would have been empty (verified 2026-10-31: zero rows over both areas, while
Boulder Creek has 189 archived VIIRS rows from the August 2020 CZU fire via the `_SP` sources,
a possible later "historical compare" feature).

- **Key in the bundle.** `VITE_FIRMS_MAP_KEY` follows the Google key: `.env.local` locally, a
  repo secret on Pages, compiled into the public bundle. FIRMS keys are free and rate-limited
  only (5000 transactions / 10 min), so the exposure is a shared budget, not a bill. The key
  travels as a URL path segment, so `redact()` now also masks a standalone 32-hex token.
- **Browser fetch, no proxy.** Successful FIRMS replies carry `access-control-allow-origin: *`.
  Error replies (400/401/403) do not, so from a browser an invalid or exhausted key is
  indistinguishable from a network failure; the copy says so instead of guessing.
- **Budget protection.** `firmsClient` caches per (source, days, area) for 10 minutes, dedupes
  in-flight requests, and honours a forced refresh at most once a minute. Defaults (VIIRS =
  NOAA-20 + SNPP, 1 day, world) cost two requests per visitor per 10 minutes; no polling.
  `MAX_DAYS = 3` keeps the largest payload around 13 MB.
- **Fetch lives in `data/`, not `app/`.** `data/` is Node-safe and `fetch` exists in Node 18+,
  so cache, TTL, timeout and error mapping are unit-tested with an injected `fetch`.
- **Globe backdrop in the live view.** Entering Live fires hides the Google tileset and shows the
  OSM globe (`ViewerHandle.setBackdrop`); leaving restores it. Reasons: no height sampling from
  Google tiles (D9), the far hemisphere occludes points naturally with the depth test on, and no
  tiles stream for the whole planet. Points are `PointPrimitive`s at 300 m above the ellipsoid
  (far above log-depth resolution at globe range, invisible up close), coloured by age and sized
  by FRP; ~50k points rebuild in well under 100 ms.
- **Dots, not perimeters.** Copy states the pixel size (375 m / 1 km), the 1–3 h latency and
  "not for safety decisions"; the footer switches to the FIRMS attribution in the live view.
- **Store rule made explicit.** A `store.set` inside a subscriber re-enters the listener loop
  with a stale `prev`, so subscriber-triggered writes (auto-load on first tab entry, picks) are
  deferred with `queueMicrotask`; the tab click does one combined update (view + pause).
- **Sim objects in the live view.** Grid layers, outline, marker and particles are hidden, the
  grid picker is disabled, Space/Escape/Cmd+Z are gated to the sim tab; sim state (area, result,
  playback position) survives the switch and the camera flies back to the grid.

## D23. Live fires: fire regions and a satellite basemap

- **Fire regions are derived, not downloaded.** FIRMS publishes points, not perimeters. A region
  is the set of detections linked by single-linkage on a 0.02° (~2 km) grid with 8-neighbour
  cells (`regionsFromHotspots`), outlined by the convex hull of every member's pixel footprint
  (scan × track km around the point, so a lone detection is a ~375 m rectangle, not a dot with
  no area). Regions carry count, summed and peak FRP, hull area (shoelace, local scale) and the
  latest observation. The copy says they are footprints of detections, not mapped perimeters.
  Why a hull and not a raster: a few thousand polygons batch into one `GroundPrimitive` and pick
  per instance; a global raster would need its own tiling. Why 2 km: VIIRS pixels are 375 m and
  neighbouring pixels of one fire are never further apart than a few pixels; 2 km also bridges
  the gap between a NOAA-20 and a SNPP overpass of the same fire.
- **"Largest fires" lists regions**, replacing the earlier 0.25° bins (D22): a bin cut fires in
  half and merged unrelated ones. Ids are `R:` + the strongest member's id, so a selection
  survives a filter change as long as that member stays.
- **Layers are toggles, not modes.** Detections and regions are independent switches in the
  store (`live.layers`), both on by default; the region layer hides with the live view like the
  dots. Selecting a region clears the point selection and vice versa; a click on empty globe
  clears both (only the dots layer treats "picked nothing" as a miss, so the two click handlers
  on one canvas never fight).
- **Satellite basemap = Esri World Imagery, display only.** Key-free tiles from
  `server.arcgisonline.com` (`UrlTemplateImageryProvider`, Cesium shows the Esri credit), created
  lazily on first use and toggled with `show`, so the default stays OpenStreetMap and costs
  nothing until asked for. Same rule as Google tiles (D9): imagery is never a simulation input.
  Considered NASA GIBS (open, daily, 250 m) and rejected for the live view because a fire at
  60 km range needs sub-100 m imagery to read the terrain; GIBS stays a candidate for a
  "satellite image of the day" overlay. The toggle lives in the Live fires pane only; in the
  simulation it would be invisible under Google tiles.

## D24. Emergency response simulation on the frozen contract

PR #4 ("containment simulation") introduced dispatched units, a rollout optimizer and moving 3D
markers, but its lines were 90-150 m wide, crossed roads and buildings, landed all at once at
the unit's ETA, and the optimizer ran ~40 synchronous sims on the UI thread with hard-coded
resources. The port in `src/contain/` keeps its structure (sector candidates perpendicular to the
spread, re-simulate each option, greedy lock-in, baseline vs contained metrics, time-driven unit
kinematics) and changes the model:

- **No contract change.** Hand and dozer lines are `firebreak` interventions one cell wide; engine
  wet lines, bucket drops and retardant are `water` with per-unit `moistureBoost`/`halfLifeS`
  (retardant: 6 h half-life). The sim, validator and tools are untouched.
- **Lines only touch burnable cells.** Roads, water and buildings (all `FuelClass.NONE`) are free
  tie-ins, never "cleared" and never painted. With a homes layer (`DemoArea.homes`, the format
  from feature/yariel) a line stops at a home, dozers keep three cells clear of one, and ground
  units near homes switch to a wet line. Vegetation cleared is weighted by fuel (forest 1,
  shrub 0.4, grass 0.15) and penalised in the score, so cutting is a last resort.
- **Crews can be outrun.** A ground unit works its line cell by cell at a production rate
  (hand crew 15 m/min, engine 12, dozer 40, scaled by fuel) from the moment it reaches the line
  (base → entry at road speed, entry → line on foot or track). Every three cells become one
  intervention stamped with its completion time, so the fire can reach the unfinished end first,
  at which point the crew pulls back. Aircraft lay `dropCells` per drop, one per reload cycle
  (helicopter 7 min, airtanker 45 min), never on cells already burning.
- **Response level is a dial.** `LEVELS` fixes detection delay, roster, assignments per unit,
  line budget, drops per sortie and the cut penalty for Minimal / Standard / Aggressive /
  Maximum; the advanced panel overrides any of them (`ContainOverrides`). Units of one type
  leave a minute apart; bases are placed 6 / 20 / 60 km outside the grid on the side where the
  most roads leave it (no Overpass or OSRM: deterministic, offline, instant).
- **With vs without in one job.** The planner runs inside the sim worker behind a `plan`
  request and returns both runs. The UI flips `result` between them, draws the other run's
  burned-area outline in magenta, and shows Without / With / Saved plus homes reached when the
  area has a homes layer. The Gemini briefing, its dev-server endpoint and the voice callouts
  were dropped: a static Pages site has no server, and the briefing's "guardrail" was dead code.
- **Cost.** A full plan is 20-130 sims and finishes in well under a second on a 200×200 grid,
  so candidates are evaluated per unit, not per unit type, and every level tries all eight
  sectors each cycle.
