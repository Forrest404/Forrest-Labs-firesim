# Wildfire Sim (v0 scaffold)

> **Simplified model. Not for real-world decisions.**
> Fire spread here is a simplified cellular model with Rothermel-*inspired* trends (wind, slope,
> fuel, moisture). It is not a validated physics model and has not been compared with real fires.

A web-based 3D wildfire spread demo. Fly around real terrain, click to place an ignition point,
set wind and dryness, press **Simulate**, and watch the fire spread as a draped overlay with
playback controls. Then fight it: draw a **firebreak** (clear trees) or **spray water** and the
simulation re-runs with your actions applied at the time you took them.

- Status: **v0 hackathon scaffold** on branch `scaffold/v0`. See [PROGRESS.md](PROGRESS.md),
  [DECISIONS.md](DECISIONS.md) and [FEATURES.md](FEATURES.md) (feature slots for the team).
- Longer-term vision and the original plan: [ideas.md](ideas.md), [ROADMAP.md](ROADMAP.md),
  [plan.md](plan.md), [docs/adr/](docs/adr/).

## Quick start

```bash
git fetch && git checkout scaffold/v0
npm install            # also copies Cesium's static assets into public/cesium/
cp .env.example .env.local   # optional: add a Google Map Tiles API key for 3D tiles
npm run dev            # http://localhost:5173
```

Other scripts: `npm run build` (static site in `dist/`), `npm run preview`, `npm test`,
`npm run typecheck`, `npm run make:synthetic`, `npm run build:demo-area -- …` (see below).

Requires Node 20+ (built with Node 25, npm 11). No backend, no accounts, no ion token.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | no | Google Photorealistic 3D Tiles for the backdrop. Without it (or if tiles fail) the app falls back to an OpenStreetMap globe and shows a banner. |

Keys go in `.env.local` (gitignored). Never commit keys.

**Google tiles are display only.** Nothing in the app reads data from Google tiles or imagery. All
simulation inputs come from open data (OpenStreetMap, AWS Terrain Tiles) or are synthetic.

## Google 3D tiles setup

The 3D backdrop is Google Photorealistic 3D Tiles, loaded through Cesium. It is optional: with no
key the app runs on the OpenStreetMap fallback globe and shows the banner
"Fallback view: Google 3D tiles unavailable".

1. **Get a key.** In Google Cloud Console pick a project with billing, enable the **Map Tiles
   API** (APIs & Services -> Library), then create an API key (APIs & Services -> Credentials).
2. **Restrict it** (Edit key):
   - Application restrictions: *Websites*, add `localhost:*` and the deploy domain.
   - API restrictions: *Restrict key*, select **Map Tiles API** only.
   - Billing -> Budgets & alerts: set a small monthly budget with an email alert.
3. **Put it in `.env.local`** in the repo root (copy `.env.example` if the file does not exist):
   ```
   VITE_GOOGLE_MAPS_API_KEY=<your key, no quotes, no spaces>
   ```
   `.env.local` is gitignored. **Never commit a key**, never paste one in chat or an issue, and
   each teammate needs their own `.env.local`. Vite reads env files at startup, so **restart
   `npm run dev`** after editing it.
4. **Check it worked.** The panel's mode line reads "3D tiles: Google Photorealistic (display
   only)", photoreal buildings and terrain appear with the Google logo in the bottom-right credit
   area, and there is no fallback banner. If the banner appears, its text says why: no key, the
   key was rejected (HTTP 403: API not enabled or referrer restriction), quota exceeded (HTTP 429),
   or tiles stopped loading (network).

The app never crashes on a bad key: the fallback globe is always underneath and is shown again
when tiles stop loading. Cost controls live in `src/viewer/googleTiles.ts` (screen-space error,
no preloading of flight destinations, culling while moving, a modest cache).

## Using the app

1. Pick a **demo area** (two real: Alpirsbach, Boulder Creek; two synthetic, labelled as such).
2. Click the map to place the **ignition** (non-burnable cells are rejected).
3. Set **wind speed**, **wind from** (the arrow shows where it blows *toward*), **dryness** preset,
   **duration**. "Advanced" exposes temperature, humidity, fuel moisture, multipliers, seed…
4. **Simulate**. Use play/pause, speed (1–256×), the scrubber and the simulated clock.
5. Choose **Firebreak (clear trees)** or **Water spray** and drag on the map. Actions apply at the
   current playback time (or at t = 0 with "Apply at start"). Undo/redo, remove from the list.
6. **Debug layers**: grid outline, fuel classes, slope. Camera: top-down / reset.

Keyboard: `Space` play/pause, `Escape` back to the ignition tool, `Cmd/Ctrl+Z` undo (`Shift` redo).
URL: `?area=<name>` starts on that area.

## The model, in plain words

Each 30 m cell has a fuel class (from OSM land cover) and an elevation. From a burning cell the
fire reaches each of its 8 neighbours after `distance / rate`, where

`rate = baseRate(fuel) × wind × slope × moisture × multiplier`

- wind: strong boost downwind, penalty upwind, growing with speed with diminishing returns;
- slope: uphill faster, downhill slower (from the elevation difference);
- moisture: slows spread, and stops it at the fuel's moisture of extinction;
- firebreak: cells become non-burnable from the moment they are cleared;
- water: adds moisture that decays with a half-life (default 10 simulated minutes).

Arrival times come from a deterministic shortest-path (minimum travel time) solve over the grid,
so the same scenario always gives the same result. Everything is re-run from t = 0 when you change
something; a 200 × 200 grid takes a few milliseconds.

**Limitations (honest list):** no ember spotting, so a wide enough firebreak is an absolute
barrier; no crown fire; constant weather; coarse 30 m cells; placeholder, uncalibrated
coefficients; OSM land cover is incomplete (unmapped land defaults to grass, or the fuel chosen
when the area was built); heights on the fallback globe are flat. See `DECISIONS.md` D3, D10, D13.

## Repository layout

```
src/contract/   FROZEN shared types, conventions, fuel table, presets, validator
src/sim/        pure simulation core + Web Worker wrapper   (no DOM, no Cesium)
src/data/       lat/lon <-> grid, rasterising, terrain, OSM rules, bundles, synthetic areas
src/tools/      firebreak / water as pure logic, undo/redo, tool registry
src/viewer/     the ONLY Cesium importer: viewer, Google tiles + fallback, overlay, picking, particles
src/ui/         side panel, settings, playback, tools UI, notices, strings.ts (all copy)
src/app/        store, worker client, clock, wiring, entry point
public/demo-areas/  committed demo-area bundles + index.json
scripts/        build-demo-area (real data), make-synthetic, copy-cesium
tests/          Vitest: fixture grid, sim, geo, raster, bundles, tools, painters, perf
```

Each `src/*` folder has a README with what it owns, what it must not import, and its
extension points (`TODO(<slot>)` markers, listed in [FEATURES.md](FEATURES.md)).

## Adding a demo area

Real data (needs network; Overpass can be slow or return 502, the script retries two mirrors):

```bash
npm run build:demo-area -- --name my-area --label "My Area" --center <lon>,<lat> \
  [--size 200] [--cell 30] [--wind 250] [--default GRASS|SHRUB|FOREST_CONIFER|…]
```

It writes `public/demo-areas/my-area.json` (~260 KB) and updates `index.json`. Record the source
and licence in [data/README.md](data/README.md). Synthetic areas: `npm run make:synthetic`.

## Attribution

Land cover © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles (Mapzen Terrarium;
underlying sources per <https://registry.opendata.aws/terrain-tiles/>). Basemap tiles ©
OpenStreetMap. 3D tiles (optional): Google. Rendering: CesiumJS.

## Working in parallel

Branch `feature/<slot>` from `main`, small PRs, `main` always builds. **Do not edit
`src/contract/` without announcing it in chat.** See [FEATURES.md](FEATURES.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

<!-- TODO(demo-ship): deployment target + URL, 3-minute demo script, rehearsal notes. -->
