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

## D22. Demo scenario work: base, disclaimer, fallbacks

- Branch `feature/demo-scenario` is cut from `main` in its own worktree (`../Forrest-Labs-firesim-demo`)
  because the shared directory had another session's uncommitted edits. It therefore does NOT have
  what lives only on `scaffold/v0` (live weather, compass, ensembles, WorldCover builder, 16-direction
  stencil). The demo is built and tuned on this branch's 8-neighbour sim.
- The on-screen "Simplified model" pill and the footer sentence are removed here too, on request
  (same as `scaffold/v0` commit dda42f5). The demo copy and `DEMO.md` do not mention it.
- Data fallback chain if Overpass is down: retry (3 mirrors, several passes), then the existing
  synthetic areas, labelled synthetic. Overpass was reachable when the Surrey bundle was built
  (it returns HTTP 502 or times out intermittently; a second pass worked).

## D23. Surrey Hills data: multipolygon woodland was being dropped (fixed), class shares, road check

**Bug found by looking at the first Surrey build.** The builder only used a multipolygon relation's
member ways that were already closed on their own. Large woodlands are usually split over several ways,
so they were skipped (17 "unclosed" shapes) and the whole ridge-top wood of Leith Hill came out as
default fill (21 % of the grid). `assembleRings` (`src/data/osm.ts`) now joins member ways end to end
into rings (any order or direction, shared node coordinates matched exactly); chains that do not close
are still counted in `skippedUnclosed`, never turned into polygons. After the fix: 0 skipped, default fill
5.5 % (scattered gardens and verges). Tests: `tests/osmRings.test.ts` (fuzzed order and direction,
holes, unjoinable chains, through `buildFuelGrid`); mutation-checked.

**Surrey Hills bundle** (`public/demo-areas/surrey-hills.json`, real OpenStreetMap land cover and AWS
Terrain Tiles, 200 x 200 cells of 30 m around 51.175 N, -0.376 E; unmapped land = GRASS, D10):
conifer forest 48.5 %, farmland 34.1 %, grass 10.7 %, non-burnable 4.0 %, shrub 2.5 %, deciduous 0.1 %.
Elevation 61-300 m. Trees default to conifer unless OSM says `leaf_type=broadleaved`, so the mixed
Surrey woods read as mostly conifer (the model treats them as one dense woodland class anyway).
Non-burnable is far from "mostly": the grid is not walled in.

**Road leak check (fuzzed).** A 1-cell road cannot be crossed by a fire that moves to its 8
neighbours: `lineCells` adds an orthogonal bridge cell whenever a step changes both row and column,
which makes every rasterised line 4-connected. `tests/roadLeak.test.ts` fuzzes this three ways
(connectivity of 400 random polylines; 300 roads built through `buildFuelGrid` for every road class
separate the two sides under 8-neighbour flood fill; 40 solver runs pushed hard at a road never burn
the far side). Removing the bridge makes three tests fail, so they would catch a regression. No change
to the rasteriser was needed. Consequence for the demo: with no spotting on this branch a road is an
absolute barrier, so the fire can only reach what is in its own compartment of woodland.
