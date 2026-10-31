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
cp .env.example .env.local   # optional: add a Cesium ion token for photoreal 3D tiles
npm run dev            # http://localhost:5173
```

Other scripts: `npm run build` (static site in `dist/`), `npm run preview`, `npm test`,
`npm run typecheck`, `npm run make:synthetic`, `npm run build:demo-area -- …` (see below).

Requires Node 20+ (built with Node 25, npm 11). No backend. A Cesium ion token is optional (3D tiles only).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | no | Cesium ion access token for the Photorealistic 3D Tiles backdrop (ion asset 2275207). Without it (or if tiles fail) the app falls back to an OpenStreetMap globe and shows a banner. |

Tokens go in `.env.local` (gitignored). Never commit tokens.

**3D tiles are display only.** Nothing in the app reads data from the ion/Google tiles or imagery. All
simulation inputs come from open data (OpenStreetMap, AWS Terrain Tiles) or are synthetic.

## 3D tiles setup (Cesium ion)

The 3D backdrop is Photorealistic 3D Tiles streamed from Cesium ion (asset 2275207, Google's
photoreal tiles distributed and billed through ion). It is optional: with no token the app runs
on the OpenStreetMap fallback globe and shows the banner "Fallback view: 3D tiles unavailable".

1. **Get a token.** Sign in at [ion.cesium.com](https://ion.cesium.com). In the **Asset Depot**
   open "Google Photorealistic 3D Tiles" and click **Add to my assets**. Then under **Access
   Tokens** create a token.
2. **Restrict it** when creating or editing the token:
   - Scopes: `assets:read` only.
   - Allowed URLs: `http://localhost:*` and the deploy domain.
   - Account -> Usage: keep an eye on the 3D Tiles streaming quota (the free tier has a monthly
     cap; ion emails you as you approach it).
3. **Put it in `.env.local`** in the repo root (copy `.env.example` if the file does not exist):
   ```
   VITE_CESIUM_ION_TOKEN=<your token, no quotes, no spaces>
   ```
   `.env.local` is gitignored. **Never commit a token**, never paste one in chat or an issue, and
   each teammate needs their own `.env.local`. Vite reads env files at startup, so **restart
   `npm run dev`** after editing it.
4. **Check it worked.** The panel's mode line reads "3D tiles: Photorealistic via Cesium ion
   (display only)", photoreal buildings and terrain appear with the Google and Cesium credits in
   the bottom-right, and there is no fallback banner. If the banner appears, its text says why:
   no token, HTTP 401 (token invalid or missing `assets:read`), HTTP 403 (allowed-URL restriction
   or asset not permitted), HTTP 404 (asset not added to your ion account), HTTP 429 (quota), or
   tiles stopped loading (network).

The app never crashes on a bad token: the fallback globe is always underneath and is shown again
when tiles stop loading. The token is passed per asset, never set globally on `Ion`, and never
logged. Cost controls live in `src/viewer/ionTiles.ts` (screen-space error, no preloading of
flight destinations, culling while moving, a modest cache).

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
src/viewer/     the ONLY Cesium importer: viewer, ion 3D tiles + fallback, overlay, picking, particles
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
OpenStreetMap. 3D tiles (optional): Google Photorealistic via Cesium ion. Rendering: CesiumJS.

## Working in parallel

Branch `feature/<slot>` from `main`, small PRs, `main` always builds. **Do not edit
`src/contract/` without announcing it in chat.** See [FEATURES.md](FEATURES.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

<!-- TODO(demo-ship): deployment target + URL, 3-minute demo script, rehearsal notes. -->
