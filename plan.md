# 5-Hour Build Plan: Wildfire Spread Demo

> **Simplified model, not for real-world decisions.** This plan builds an interactive, honestly labelled demo. It is not a scientific tool. The long-term vision (Rothermel, validation) stays in [ROADMAP.md](ROADMAP.md) and [ideas.md](ideas.md); where this plan conflicts with them, this plan wins for the hackathon.

**Status:** draft for the team to veto in the first 15 minutes. Every decision flagged *veto?* in section 3 is a proposal, not a done deal. ADRs 0001-0003 stay "Proposed" until the team signs off (see section 14).

**Assumed team: 4 people** (A, B, C, D). Section 7 shows how to adapt for 2, 3 or 5.

---

## 1. Goal and success criteria

Build a browser app where a user clicks a map, sets wind and dryness (simple presets, or advanced controls), and watches a fire spread across real OpenStreetMap land cover and real elevation. They can then draw a firebreak or spray water and see the spread react. The model is a seeded cellular automaton whose spread probability is multiplied by fuel, wind, slope and moisture factors that follow the same trends as the Rothermel model. It is labelled as a simplified model everywhere.

**Demo done =**

- [ ] App opens on a saved demo area **with no network** (`?offline=1`), with the disclaimer banner and data attributions visible.
- [ ] Clicking inside the grid sets the ignition point; clicking water, a road or outside the grid is rejected with a message.
- [ ] Simple settings work: wind speed, wind-from direction, dryness preset (low/medium/high/extreme), duration. A Run button starts the sim.
- [ ] Spread animates on a canvas overlay aligned with the basemap, at 20 fps or better on a team laptop.
- [ ] The trends are visible: the fire elongates downwind, runs uphill faster than downhill, stops at water and roads, and burns at least 2x more area under "extreme" than "low" at the same simulated time.
- [ ] **Firebreak tool:** drawing a swath (during pause or run) visibly changes where the fire goes.
- [ ] **Water tool:** a sprayed patch turns blue, slows or stops the fire, and fades over simulated time.
- [ ] Advanced settings panel exists and edits the same settings object the presets fill (*Should*).
- [ ] Same scenario + same seed gives a byte-identical arrival-time grid (determinism test passes).
- [ ] Live "load area here" works at least once on the team's network, and when it fails it falls back to a saved area with a banner within 20 s.
- [ ] Deployed URL works on a second machine; README states limitations; 3-minute demo rehearsed twice; backup screen recording exists.

---

## 2. Scope

| In (5-hour demo) | Out (see Post-demo roadmap) |
|---|---|
| Cellular automaton, 8 neighbours, fixed time step, seeded and deterministic | Real Rothermel equations, level-set / wavefront, midflame wind adjustment |
| Fuel classes from OSM tags; roads and rivers as barriers | LANDFIRE / CORINE / WorldCover fuel models, canopy height, fuel moisture classes (1h/10h/100h) |
| Elevation from Terrarium tiles, slope-aware spread | Terrain-modified wind |
| Manual weather, optional Open-Meteo prefill (stretch) | Time-varying weather, forecasts |
| Firebreak swath tool and water spray tool, as timestamped events | Retardant, backburns, crews/trucks, resource limits, strategy mode |
| Simple presets + advanced panel (CA-relevant settings only) | Spotting probability, crown-fire threshold, season |
| Canvas overlay on a 2D map | 3D terrain view |
| Static client-side app, bundled fallback areas | Backend, accounts, scenario sharing links |
| Scenario JSON download/upload (*Should*) | Ensemble runs, burn-probability maps |
| Honest limitations notice | Validation against historical fires, any accuracy claim |

### Post-demo roadmap (everything cut)

1. Replace the factor product with Rothermel rate of spread (Scott & Burgan fuel models), elliptical wavefront or level-set propagation.
2. Ember spotting, then crown-fire transition.
3. Real fuel and canopy data (LANDFIRE, ESA WorldCover, Meta/WRI canopy), dead/live fuel moisture classes.
4. Time-varying weather, terrain-modified wind.
5. Ensemble runs and burn-probability maps (server-side or WebGPU).
6. Validation against 2-3 documented historical fires (basis for any accuracy claim).
7. 3D terrain view.
8. Backend features: shared scenarios, cached demo-area bundles (see section 3, "Do we need a backend?").
9. Strategy mode: retardant, backburns, crews, resource limits.

---

## 3. Key decisions made now

**Rule: the team has 15 minutes at the start to veto. Silence = accepted. Initial each row when agreed.**

| # | Decision | Choice | Why | Veto? / owner |
|---|---|---|---|---|
| 1 | Stack | One TypeScript web app: **Vite + React + TypeScript** for panels | One language end to end; fastest for most teams; static output deploys anywhere | *veto?* If nobody knows React, use vanilla TS |
| 2 | Map library | **MapLibre GL JS**, used directly (no wrapper library) | No token needed; `canvas` source animates a canvas pinned to four corners, so the overlay stays aligned while zooming | *veto?* Leaflet is the fallback if nobody has used MapLibre |
| 3 | Basemap | OpenStreetMap standard raster tiles, with attribution | No key. Satellite is optional (Esri/MapTiler/other, team must check terms). **Never Google tiles or Google data for land cover** | *veto?* **Open question 3** |
| 4 | Grid | **200 x 200 cells at 30 m = 6 km x 6 km** (40,000 cells) | See reasoning below. `COLS`/`ROWS` live in one config constant so 150 or 300 is a one-line change | *veto?* |
| 5 | Projection | Grid is axis-aligned in **Web Mercator (EPSG:3857)** with Mercator cell size = 30 m / cos(centre latitude), north up | Matches the basemap and the Terrarium tiles, so the overlay lines up exactly. Ground cell is 30 m x 30 m to within ~0.2 % over 6 km at mid-latitudes. Mercator preserves angles, so compass wind directions stay correct | Owner: **B** |
| 6 | Lat/lon <-> cell conversion | A single `geo` module, **owned by B**. Nobody else writes conversion maths | Coordinate bugs are the top integration risk | Owner: **B** |
| 7 | Rendering | 200x200 RGBA canvas fed to a MapLibre `canvas` source, `raster-resampling: nearest`, opacity slider | One `putImageData` per frame; no per-cell DOM | Owner: **C** |
| 8 | Where the sim runs | **Web Worker**, pure TypeScript, no DOM access. Main thread gets frame snapshots as transferable typed arrays | UI never janks; sim is testable in Node without a browser | Owner: **A** |
| 9 | Model | Frontier-based CA, **tick = 10 s** of simulated time, 8 neighbours | Only burning cells do work; 6 h = 2,160 ticks | Owner: **A** |
| 10 | Randomness | Counter-based hash RNG: `u = hash(seed, tick, cell, direction)`, not a stream | Adding a firebreak changes nothing elsewhere, so A/B comparisons with the same seed are clean; no order dependence | Owner: **A** |
| 11 | State storage | **Flat typed arrays** (`Uint8Array`, `Float32Array`, `Uint16Array`), row-major. No per-cell objects | Speed, transferability, byte-level determinism test | Owner: **A** |
| 12 | Data | OSM via Overpass (land cover, roads, rivers); Terrarium elevation tiles; manual weather | No GIS pipeline | Owner: **B** |
| 13 | Backend | **None** (see below) | Nothing in the demo breaks without one | Team |
| 14 | Fallback | 1-2 pre-fetched areas committed to `public/demo-areas/` | Survives API outages and venue wifi | Owner: **B** |
| 15 | Deploy | **Vercel static** (assumption), preview from branch, prod at freeze | Zero config for a Vite build | *veto?* Any static host works |
| 16 | Git | Branch prefixes from [CONTRIBUTING.md](CONTRIBUTING.md); small PRs; **5-hour exception:** a 2-minute review by the checkpoint partner instead of a full review | CONTRIBUTING requires a review; the team must OK this shortcut | *veto?* **Open question 5** |
| 17 | Tests | Vitest for sim and geo only (fixture assertions in section 9) | The sim is the only thing worth testing in 5 hours | Owner: **A** |

**Grid reasoning.** 200 x 200 is in the middle of the 150-300 range. It covers 6 km, enough for a fire to get "out of control" and still be containable. State is under 1 MB (fuel 40 KB, elevation 160 KB, arrival 160 KB, spray arrays 320 KB, state 40 KB). A 6 h run is a few thousand ticks over a small frontier, so it finishes in well under 2 s. A single Overpass query for 6 km usually returns roughly 1-3 MB, and the area needs only 1-4 elevation tiles at zoom 12. 30 m also matches the native resolution of the datasets the real model will use later. If rendering lags, drop to 150 x 150; if it flies, try 300 x 300.

### Do we need a backend?

**Supabase MCP check: not reachable from this session.** I searched the available tool list and found no Supabase tools, and I created, changed and deleted nothing. So this plan is backend-free by necessity as well as by choice.

**Decision: no backend. Static client-side app.** Reasoning:

| Candidate feature | Needed for demo? | Decision |
|---|---|---|
| Cache Overpass / elevation results | No. Committed bundles in `public/demo-areas/` do the same job with no moving parts | Use committed bundles |
| Host pre-fetched bundles | No. They are about 270 KB each and ship with the static site | Static files |
| Save and share scenarios | No. Scenario JSON download/upload covers replay | Post-demo |
| Accounts, ensembles | Out of scope | Post-demo |

If the team later wants a backend, the candidates are below. **None of this is built in the 5 hours**, and each one is optional/stretch.

| Later feature | Purpose | Layout (names and columns only) | Owner | Time | Fallback if it fails |
|---|---|---|---|---|---|
| Area cache | Survive Overpass rate limits for many areas | Table `area_cache`: `area_key`, `bbox`, `bundle_json`, `fetched_at`. Or Storage bucket `area-bundles` | B | ~45 min | Committed bundles |
| Share scenarios | Send a link to a scenario | Table `scenarios`: `share_id`, `scenario_json`, `created_at` | D | ~45 min | Download/upload JSON file |

**Secrets rules (apply from day one):**

- No key is needed for the demo as planned.
- Never commit keys. Use `.env.local` (already gitignored via `.env.*`), and commit only an `.env.example` with empty values.
- If a backend or keyed basemap is added: only the **public anon key** goes in the client; never a service-role key in the repo, the client bundle or chat.
- At freeze (4:30) someone greps the diff and the built bundle for `key`, `token`, `secret`.

---

## 4. Architecture

```
 data/grid builder (B) ──► Scenario ──► sim core in Worker (A) ──► frames + Result
        ▲                     ▲                  ▲                       │
   Overpass, elevation        │          interventions (D)               ▼
   tiles, saved bundles   settings (D)                       map UI + canvas renderer (C)
```

| Module | Folder | Responsibility | Owner |
|---|---|---|---|
| Contract | `src/contract/` | Types, validator, example scenario. The only thing everyone imports | A writes, all review |
| Geo | `src/geo/` | lat/lon <-> Mercator <-> cell; grid corners; bbox | B |
| Data / grid builder | `src/data/` | Overpass fetch, tag -> fuel class, polygon and line rasterisation, elevation decode and resample, slope/aspect, bundle export/import | B |
| Sim core | `src/sim/` | Pure TS: state arrays, RNG, step, interventions, result. Runs in Worker and in Node tests | A |
| Worker harness | `src/ui/worker/` | Message protocol, frame streaming, seek by re-running from t=0 | C |
| Map UI | `src/ui/map/` | MapLibre, canvas source, ignition marker, banner, layers | C |
| Tools and settings | `src/ui/panels/`, `src/ui/tools/` | Settings panels, presets (data), firebreak and water drawing, scenario download/upload | D |
| Backend | none | Not in this build | n/a |

Static assets: `public/demo-areas/*.json` (fallback bundles), `public/scenarios/*.json` (demo scenario), `tests/fixtures/` (fixture).

### Scenario contract (v1)

All units SI. Typed arrays are row-major, **index = row * cols + col**. Serialised to JSON as base64 of little-endian bytes (bundles) or passed as `ArrayBuffer`s (worker).

**Grid and orientation**

| Field | Type | Meaning |
|---|---|---|
| `version` | int | `1` |
| `grid.cols`, `grid.rows` | int | 200, 200 by default |
| `grid.cell_size_m` | float | Ground size of a cell, 30 |
| `grid.origin_x_m`, `grid.origin_y_m` | float | EPSG:3857 coordinates of the **north-west corner** of cell (0,0) |
| `grid.cell_size_merc_m` | float | Cell edge in Mercator metres = `cell_size_m / cos(lat0)` |
| `grid.lat0` | float | Centre latitude, degrees |
| Orientation | n/a | **Column increases east, row increases south.** Cell (c, r) centre = origin + (c+0.5, -(r+0.5)) x `cell_size_merc_m` |

**Layers**

| Field | Type | Unit / values | No data |
|---|---|---|---|
| `fuel` | `Uint8Array[rows*cols]` | Class id from the fuel table (section 5) | `0` = no data / outside coverage, non-burnable |
| `elevation_m` | `Float32Array[rows*cols]` | Metres above sea level | Builder **must fill** gaps (nearest valid cell). The validator rejects `NaN` and `-9999`, so the sim never sees them |
| `slope_deg`, `aspect_deg` | optional `Float32Array` | Degrees; aspect clockwise from north, direction the slope faces | For overlays only. The sim derives slope along each spread direction from elevation differences |

**Weather and model**

| Field | Type | Unit / meaning |
|---|---|---|
| `weather.wind_speed_ms` | float | m/s, treated as midflame wind (simplification) |
| `weather.wind_from_deg` | float | **Meteorological: the direction the wind blows FROM**, 0 = from north, 90 = from east, clockwise. Fire is pushed toward `from + 180` |
| `weather.wind_gust_frac` | float 0-0.5 | Seeded per-tick wind speed variation |
| `weather.rel_humidity_pct`, `weather.air_temp_c` | float | Inputs to the moisture rule |
| `weather.fuel_moisture` | float 0.02-0.30 | Dead fuel moisture, fraction of dry weight. Derived from the two above unless `moisture_override` is true |
| `weather.moisture_override` | bool | Advanced: use `fuel_moisture` as typed |
| `model.dt_s` | float | Tick length, 10 |
| `model.duration_s` | float | Simulated duration |
| `model.slope_enabled` | bool | Advanced toggle |
| `model.wind_strength`, `model.spread_scale` | float | Multipliers on the wind exponent and base probability (advanced) |
| `model.fuel_overrides` | map class id -> `{mult, burn_s, extinction}` | Advanced overrides |

**Events**

| Field | Type | Meaning |
|---|---|---|
| `seed` | uint32 | Drives the hash RNG |
| `ignitions[]` | `{col, row, t_s}` | Demo uses one, at `t_s = 0`. Array so more can be added later |
| `interventions[]` | see below | Timestamped, replayable |

Intervention: `{ id, t_s, type: "firebreak" | "water", path_cells: [[col,row],...] (floats, cell coordinates, at least 1 point), width_m, strength?, decay_tau_s? }`. `strength` (water only) is the peak moisture fraction, default 0.40. `decay_tau_s` is the water decay constant, default 1,200 s. Interventions are applied at tick `ceil(t_s / dt_s)`. The UI converts map clicks to cell coordinates through `geo`; the sim never sees lat/lon.

**Output**

| Field | Type | Meaning |
|---|---|---|
| `arrival_time_s` | `Float32Array[rows*cols]` | Simulated seconds since t=0 when the cell ignited; **`-1` = never ignited** |
| `intensity_rel` (optional) | `Uint8Array` | 0-255 *relative* spread-strength proxy at ignition. Not a physical intensity |
| `stats` | `{burned_cells, burned_area_ha, final_t_s}` | |
| `state_hash` | string | Hash of `arrival_time_s` bytes, used by the determinism test |

**Live frame message (worker -> UI):** `{ t_s, state: Uint8Array }` where state is 0 = unburned, 1 = burning, 2 = burned. **Control messages (UI -> worker):** `init(scenario)`, `play(speed)`, `pause`, `seek(t_s)` (re-run from 0, deterministic), `addIntervention(iv)`, `getResult`.

**Sim internals (A):** state arrays are `state` (`Uint8`), `arrival` (`Float32`), `burnout_tick` (`Uint16`), `spray_peak` (`Float32`), `spray_tick` (`Uint16`), plus a frontier list of burning cell indices. Firebreaks only convert cells that are not burning or burned. Water raises effective moisture and never extinguishes a burning cell.

---

## 5. Fuel and factor tables

### Fuel classes from OSM tags

**All numbers below are tunable placeholders, not measured values.** They are chosen to give plausible relative behaviour and are tuned in SIM-7.

| Id | Class | OSM tags | Spread multiplier | Burn duration | Extinction moisture |
|---|---|---|---|---|---|
| 0 | No data | outside coverage | 0 | n/a | n/a |
| 1 | Water | `natural=water`, `waterway=riverbank` polygons | 0 (barrier) | n/a | n/a |
| 2 | Barrier | Lines: `highway=motorway/trunk/primary/secondary/tertiary/residential/unclassified`, `waterway=river/canal`, plus user firebreaks | 0 (barrier) | n/a | n/a |
| 3 | Bare / built-up / other (also the **default for unmapped land**) | `landuse=residential/commercial/industrial`, `building=*`, `natural=bare_rock/sand/wetland` | 0.15 (no structure model) | 300 s | 0.35 |
| 4 | Grass | `natural=grassland`, `landuse=meadow/grass/farmland/village_green` | 1.00 | 300 s | 0.30 |
| 5 | Scrub | `natural=scrub/heath` | 0.75 | 900 s | 0.35 |
| 6 | Forest | `natural=wood`, `landuse=forest` | 0.50 | 1,800 s | 0.40 |

Extinction moistures are deliberately generous so that even "low" dryness still burns slowly. Real values are lower.

Raster order (later overwrites earlier): default class 3, then grass, scrub, forest, built-up, water polygons, then barrier lines. **Barrier lines are rasterised 4-connected** (every step moves one cell horizontally or vertically) so a diagonal fire cannot leak through a gap between two diagonal neighbours. Multipolygon relations use even-odd fill over all rings. A paved road is 5-10 m wide and would not always stop a real fire; here it is a barrier only because spotting is out of scope, and the UI says so.

### Factor rules (plain English)

For each burning cell and each of its 8 neighbours that is unburned and burnable, once per tick, the neighbour ignites with probability

`p = clamp( p0 x spread_scale x fuel_mult x f_wind x f_slope x f_moisture x (30 m / distance), 0, 0.9 )`

where distance is the centre-to-centre distance (30 m, or 42.4 m diagonal), `fuel_mult` is the class of the **target** cell, and `p0` starts at about 0.05 (tuned in SIM-7).

- **Wind:** let theta be the angle between the spread direction and the direction the wind is blowing toward. `f_wind = exp(0.25 x wind_strength x U x cos(theta))`, clamped to 0.1-8. With no wind it is 1. Downwind it grows with speed, upwind it shrinks, sideways it is 1. Gusts multiply `U` by a seeded per-tick factor.
- **Slope:** let tan(phi) be rise over run from the burning cell to the target (uphill positive). `f_slope = exp(3.5 x tan(phi))`, clamped to 0.25-4. A 20 degree uphill is roughly 3.5x, a 20 degree downhill roughly 0.3x. Disabled by the advanced toggle.
- **Moisture:** `f_moisture = (1 - m / Mx)^2`, floored at 0, where `m` is the cell's effective moisture and `Mx` is the fuel's extinction moisture. It is 1 when bone dry and 0 at extinction. Rothermel uses a cubic in `m/Mx`; this is a stand-in with the same trend.
- **Effective moisture** = base moisture, raised by water: `m_eff = m_base + (spray_peak - m_base) x exp(-(t - t_spray) / decay_tau_s)`.
- **Burnout:** a burning cell becomes burned after its fuel's burn duration.
- **Tuning target (look, not truth):** under "high" dryness with a strong wind, a head fire on grass crosses roughly 3 km in 1-2 simulated hours; a no-wind, flat forest fire creeps at a couple of metres per minute.

### Simple -> advanced settings

**Simple controls:** wind speed, wind direction (compass, "from"), dryness preset, duration. **Presets are data in one table; there is no separate preset logic.** Choosing a preset writes its row into the same settings object the advanced panel edits, and the advanced panel shows which values the preset set.

| Dryness | Rel. humidity % | Air temp C | Derived dead-fuel moisture |
|---|---|---|---|
| Low | 60 | 15 | ~18 % |
| Medium | 40 | 22 | ~12 % |
| High | 25 | 30 | ~8 % |
| Extreme | 8 | 38 | ~4 % |

Moisture rule: `m = clamp(0.025 + 0.0025 x RH - 0.0005 x (T - 20), 0.02, 0.30)`, with RH in percent and T in degrees C.

**Advanced settings (only what the CA can use):**

| Setting | Effect |
|---|---|
| Relative humidity, air temperature | Feed the moisture rule |
| Moisture override | Type `m` directly, ignoring RH and T |
| Wind gusts (0-50 %) | Seeded per-tick variation |
| Wind strength scale | Scales the wind exponent |
| Base spread scale | Scales `p0` |
| Slope on/off | Toggles `f_slope` |
| Per-fuel multipliers, burn time, extinction moisture | Overrides the fuel table |
| Seed | Replay or vary the stochastic run |
| Playback speed | 60x to 3,600x |

**Shown but not implemented (greyed out with "post-demo"):** spotting probability, crown-fire threshold, time-varying weather, grid resolution.

---

## 6. Hour-by-hour timeline

| Block | Deliverable | Checkpoint that proves it |
|---|---|---|
| **0:00-0:30 Setup and contract** | 0:00-0:15 all-hands: read the veto table, walk the contract, confirm owners, agree wind convention. 0:15-0:30 in parallel: A scaffolds the Vite app, contract types, Vercel hello-world; B starts `geo`; C MapLibre hello with basemap; D writes the fixture spec and preset table | **CP-0:** `main` has the app deployed and showing a map; contract types merged; veto table initialled |
| **0:30-2:00 Parallel build** | A: RNG + state, spread step, barriers and burnout. B: geo, Overpass + fuel raster, elevation. C: map + banner + click, canvas renderer on the fixture, worker harness. D: fixture, simple settings, firebreak drawing UI | **CP-1** 0:45 geo round-trip; **CP-2** 1:30 sim passes fixture tests; **CP-3** 1:55 renderer animates the fixture |
| **2:00-2:45 INTEGRATION (critical)** | Builder output -> scenario -> worker -> renderer on a real area; settings feed the scenario; ignition click works end to end | **CP-4** 2:00 builder output passes the validator; **CP-5** 2:15 overlay aligned with basemap; **CP-6** 2:30 dryness changes burned area |
| **2:45-4:00 Tools and settings** | Interventions in the sim, firebreak and water end to end, run controls, bundles + fallback, tuning, advanced panel (*Should*), layers (*Should*) | **CP-7** 3:00 firebreak changes only downstream; **CP-8** 3:30 determinism; **CP-9** 3:55 fallback trigger |
| **4:00-4:30 Polish** | Demo scenario authored and saved, ignition validation, copy review, scenario download/upload (*Should*), legend, performance pass | Demo scenario runs the "out of control, then contained" story in under 3 minutes |
| **4:30-5:00 Freeze, README, deploy, rehearse** | Feature freeze at 4:30. Only bug fixes. Production deploy, README, attributions, two rehearsals, backup recording | **CP-10** deployed URL passes the smoke test on a second machine with throttled network |

> ### 2:00-2:45 is the critical milestone
> **Rule: if integration slips, cut tools and polish, never the core loop.** The core loop is: a saved or live area -> ignition click -> sim in the worker -> animated overlay. At 2:30, if a real area does not animate end to end, stop all other work, the whole team pairs on integration, and the demo falls back to fixture + bundle. Tools wait.

### Who does what, block by block (4 people)

| Time | A (sim) | B (data) | C (map UI) | D (tools / settings) |
|---|---|---|---|---|
| 0:15-0:30 | Scaffold, contract types, deploy | `geo` start | MapLibre hello | Fixture spec, preset table |
| 0:30-1:00 | SIM-1 (to 0:50), start SIM-2 | DATA-1 (to 0:40), start DATA-2 | UI-1 | FIX-1 (to 0:50), start TOOL-1 |
| 1:00-2:00 | SIM-2 (to 1:30), SIM-3 (to 1:50), fixture tests | DATA-2 (to 1:20), DATA-3 (to 1:55) | UI-2 (to 1:40), UI-7 | TOOL-1 (to 1:20), TOOL-3 drawing UI |
| 2:00-2:45 | INT-1: sim <-> worker <-> renderer; then SIM-4 from 2:25 | INT-1: real area through the pipeline | INT-1: overlay alignment | INT-1: settings -> scenario |
| 2:45-4:00 | SIM-4 (to 2:50), SIM-6, SIM-7, INT-3 QA | DATA-4, DATA-7, DATA-6 | UI-3, UI-5, UI-6, UI-4 | TOOL-3 end to end, TOOL-4, TOOL-2 |
| 4:00-4:30 | Perf and bugs | INT-2 hardening, buffer | Legend, copy polish | TOOL-6, TOOL-5 |
| 4:30-5:00 | Final QA | Prod deploy | Rehearsal lead (INT-5) | README (INT-4) |

---

## 7. Task breakdown by workstream

Estimates are focused minutes. Priority: **M** = must, **S** = should, **X** = stretch. Owners are placeholders (`@owner-A` etc.). Each definition of done can be checked in under a minute.

### Sim core (A)

| ID | Pri | Task | Min | Depends | Definition of done |
|---|---|---|---|---|---|
| SIM-1 | M | State typed arrays, hash RNG, scenario loading | 20 | CP-0 | [ ] Two runs with the same seed give byte-identical output; a different seed differs |
| SIM-2 | M | Neighbour spread with fuel x wind x slope x moisture on a frontier list | 40 | SIM-1, FIX-1 | [ ] Fixture tests T1-T3 pass (section 9) |
| SIM-3 | M | Barriers (water, roads) and burnout | 20 | SIM-2 | [ ] Fixture T4: zero burned cells beyond river and road except through the gap |
| SIM-4 | M | Interventions: firebreak rasterisation, water with decay | 25 | SIM-3 | [ ] Fixture T5-T6 pass |
| SIM-6 | M | Result: arrival grid, stats, hash, optional intensity | 15 | SIM-3 | [ ] `state_hash` stable across runs |
| SIM-7 | M | Tuning pass on constants; check preset spread | 20 | INT-1 | [ ] "Extreme + strong wind" front covers about 3 km in 1-2 sim hours on grass; "low" visibly creeps |

### Data / grid builder (B)

| ID | Pri | Task | Min | Depends | Definition of done |
|---|---|---|---|---|---|
| DATA-1 | M | `geo`: lat/lon <-> Mercator <-> cell, corners, bbox | 25 | CP-0 | [ ] Four-corner round trip within 1 cell; unit test with 3 known points |
| DATA-2 | M | Overpass query, tag -> fuel class, polygon and 4-connected line rasterisation | 40 | DATA-1 | [ ] Fuel grid of the demo area shows forest, water and roads where the basemap shows them |
| DATA-3 | M | Terrarium fetch, decode, resample to grid, fill gaps, slope/aspect | 35 | DATA-1 | [ ] Min/max elevation within about 5 % of the known range; slope picture looks plausible; CORS works |
| DATA-4 | M | Timeouts, one mirror retry, fallback trigger, bundle export/import | 35 | DATA-2, DATA-3 | [ ] Blocking Overpass loads the saved area within 20 s with a banner; sim output from bundle equals sim output from live fetch for the same seed |
| DATA-6 | M | Update `data/README.md`: sources, versions, licences, attribution text | 15 | DATA-2 | [ ] Every dataset used is listed with licence and attribution |
| DATA-7 | M | Choose 2 areas and commit their bundles | 25 | DATA-4, area criteria | [ ] Both bundles load with `?offline=1`; each file is under 500 KB |
| DATA-5 | X | Open-Meteo prefill of wind, temperature, humidity | 20 | UI settings | [ ] Button fills the simple settings from live weather |

### Map UI and rendering (C)

| ID | Pri | Task | Min | Depends | Definition of done |
|---|---|---|---|---|---|
| UI-1 | M | MapLibre, basemap, attribution, always-visible disclaimer banner, click-to-ignite | 30 | CP-0 | [ ] Banner visible; click logs a cell index |
| UI-2 | M | Canvas source and renderer (colour ramp, nearest sampling, opacity) | 40 | UI-1, FIX-1 | [ ] Fixture renders; four corner markers sit on the grid corners; frame takes under 8 ms |
| UI-7 | M | Worker harness: init, play, pause, seek, frame streaming | 20 | SIM-1 interface | [ ] Sim ticks stream to the canvas |
| UI-3 | M | Run controls: play/pause, speed, restart, clock, burned-area readout | 30 | INT-1 | [ ] Speed change takes effect immediately |
| UI-5 | M | Ignition validation: reject water, barrier, outside | 15 | UI-1, DATA-2 | [ ] Clicking a river shows a message |
| UI-6 | M | Loading / error / fallback banner and area picker | 20 | DATA-4 | [ ] Fallback banner appears in the CP-9 test |
| UI-4 | S | Layer toggles (fuel, slope/hillshade) and legend | 25 | INT-1 | [ ] Toggling the fuel layer shows the classes |

### Tools and settings (D)

| ID | Pri | Task | Min | Depends | Definition of done |
|---|---|---|---|---|---|
| FIX-1 | M | Generate the 50x50 fixture scenario file | 20 | Contract | [ ] `tests/fixtures/` scenario passes the validator and renders |
| TOOL-1 | M | Simple settings panel + preset table as data | 30 | CP-0 | [ ] Switching dryness changes the displayed moisture readout |
| TOOL-3 | M | Firebreak tool: click points, width slider, preview, emits timestamped event | 40 | UI-1, DATA-1, SIM-4 for end to end | [ ] After commit the fire path changes (CP-7) |
| TOOL-4 | M | Water tool: line or circle, blue overlay that fades with decay | 30 | TOOL-3 | [ ] Sprayed patch slows the front, then recovers |
| TOOL-6 | M | Author and save the demo scenario | 15 | TOOL-3, TOOL-4 | [ ] "Out of control, then contained" plays in under 3 minutes |
| TOOL-2 | S | Advanced panel (section 5 list) | 25 | TOOL-1 | [ ] Editing a value shows "changed from preset" |
| TOOL-5 | S | Scenario download/upload and replay | 20 | SIM-6 | [ ] Re-importing a downloaded scenario gives the same `state_hash` |
| TOOL-7 | X | Undo last intervention (re-run from 0) | 15 | TOOL-3 | [ ] Undo removes the last break |

### Integration, deploy, QA (shared)

| ID | Pri | Task | Min | Depends | Definition of done |
|---|---|---|---|---|---|
| INT-1 | M | Wire builder -> scenario -> worker -> renderer on a real area (all hands, 2:00-2:45) | shared | CP-3, CP-4 | [ ] Click, run, see animated spread on a real area |
| INT-2 | M | Vercel preview + prod deploy, no env vars needed | 15 | CP-0 | [ ] Prod URL loads on a second machine |
| INT-3 | M | QA: determinism, fixture suite, bug bash, Chrome + one other browser | 25 | SIM-6 | [ ] Checklist in section 1 all ticked |
| INT-4 | M | README, limitations notice, attributions, ROADMAP and ADR updates | 20 | all | [ ] Section 14 checklist ticked |
| INT-5 | M | Two timed rehearsals + backup screen recording | 20 | INT-2 | [ ] Recording plays; rehearsal under 3:00 |

### Capacity check (4 people)

Per person, focused capacity is about 195 min (300 min minus about 105 min of shared blocks: setup, integration, freeze).

| Person | Workstream | Must (min) | + Should (min) |
|---|---|---|---|
| A | SIM-1,2,3,4,6,7 + INT-3 | 165 | 165 |
| B | DATA-1,2,3,4,6,7 + INT-2 | 190 | 190 |
| C | UI-1,2,3,5,6,7 + INT-5 | 175 | 200 (+UI-4) |
| D | FIX-1, TOOL-1,3,4,6 + INT-4 | 155 | 200 (+TOOL-2, TOOL-5) |
| **Total** | | **685** of 780 capacity | **755** |

The buffer is about 95 min for Must work alone, and about 25 min once the Should tasks are added. **That is thin: treat the cut list (section 12) as live from the start.**

### Team size mapping

| Workstream | 2 people | 3 people | 4 people (assumed) | 5 people |
|---|---|---|---|---|
| Sim core | P1 | P1 | A | A |
| Data / grid builder | P1 | P2 | B | B |
| Map UI / rendering | P2 | P3 | C | C |
| Tools / settings | P2 | P2 (settings) + P3 (drawing) | D | D |
| Integration / deploy / QA | P2 | P1 (QA, deploy, README) | split: A (QA), B (deploy), C (rehearsal), D (README) | **E**: all INT tasks, DATA-6, UI-4, TOOL-5, TOOL-6, DATA-5 |

- **5 people:** about 975 capacity vs 755 demand, so the buffer is real. E also owns demo-day logistics and the backup recording. Use the slack to add the second demo area and TOOL-7.
- **3 people:** capacity about 585 vs 685 Must. Apply the **pre-cuts** before starting: one demo area instead of two (-13), no separate tuning task, tune during integration (-20), firebreak and water share one drawing component (-20), UI-6 reduced to a banner (-10), UI-5 folded into UI-1 (-10), no mirror retry in DATA-4 (-10), README and rehearsal trimmed (-10), DATA-6 trimmed (-5). That gets Must to about 587 with **no Should and no buffer**. The first slip fires the cut list. Loads: P1 sim + QA + deploy + README about 190; P2 data + fixture + simple settings about 197; P3 map + shared drawing component + demo scenario about 200.
- **2 people:** capacity about 390 vs about 485 for the smallest viable scope. **The full checklist does not fit.** Commit to the minimum demo: saved area only (bundle made by a one-off builder page, no live-fetch UI), core loop, simple presets, firebreak tool. Water spray, advanced panel, scenario save/load and layers become stretch. P1 = sim + data builder; P2 = map UI + tools + deploy. If the team wants the full checklist, it needs more time or more people; decide at 0:15, not at 3:00.

---

## 8. Interface checkpoints

Two people verify that their pieces connect, together, at the stated time. Each has a pass condition you can see in a minute.

| CP | Time | Who | Pass condition |
|---|---|---|---|
| CP-0 | 0:30 | All | Contract types import in every branch; example scenario passes the validator; wind convention (`wind_from_deg`) written on the whiteboard |
| CP-1 | 0:45 | B + C | **Geo round trip:** four corner markers drawn from `geo` sit on the grid corners; clicking a marker returns cell (0,0), (cols-1,0), (0,rows-1), (cols-1,rows-1); lat/lon order is correct |
| CP-2 | 1:30 | A + D | **Sim returns correct arrival times on the fixture:** tests T1-T4 pass (section 9) |
| CP-3 | 1:55 | A + C | Worker streams fixture frames; canvas animates; frame time under 8 ms |
| CP-4 | 2:00 | A + B | **Grid builder output loads in the sim without changes:** validator passes (lengths = rows x cols, class ids in the table, no `NaN` or `-9999`) |
| CP-5 | 2:15 | B + C | **Real area is aligned:** river and forest edges on the overlay match the basemap within about 2 cells |
| CP-6 | 2:30 | A + D | Same seed, dryness low -> extreme: burned area at a fixed time is at least 2x |
| CP-7 | 3:00 | A + D + C | Firebreak at time t: arrival times identical before t and upstream of the break; cells behind the break stay unburned |
| CP-8 | 3:30 | A + D | **Determinism:** the same scenario JSON twice gives the same `state_hash`; downloaded and re-imported scenario matches |
| CP-9 | 3:55 | B + C | **Fallback:** block the Overpass domain (browser devtools); the saved area loads within 20 s with a banner; same-seed sim result equals the live result |
| CP-10 | 4:50 | All | Prod URL on a second machine with throttled network passes the section 1 checklist |

---

## 9. Test fixture

A hand-made **50 x 50** scenario (1.5 km x 1.5 km) so the sim and UI can be built before real data works. Built by D (FIX-1), asserted by A.

**Layout**

- Fuel: mostly forest (class 6), a 10 x 10 grass patch (class 4) in the north-east, a scrub strip (class 5) in the south-west, a few bare cells (class 3).
- Water: a 2-cell-wide river running north-south at column 40, full height (class 1).
- Road: a 1-cell-thick 4-connected line along row 8, full width, with a **3-cell gap** at columns 5-7 (class 2).
- Terrain: a plane rising to the north (about 12 degrees) for the slope tests; a flat variant for the wind tests.
- Ignition: near the centre, at column 20, row 30. Fixed seed. Fixed `dt_s = 10`.

**Expected behaviour**

| Test | Setup | Expected |
|---|---|---|
| T1 Wind | Flat terrain, wind from the west at 6 m/s, medium dryness | Fire reaches the east side far faster than the west; front distance ratio downwind:upwind at least 3 before the river stops it |
| T2 Slope | Tilted terrain, no wind | Northward (uphill) front travels at least 2x farther than southward in the same time |
| T3 Moisture | Same as T1, low vs extreme dryness | Extreme burned area at a fixed time at least 2x low |
| T4 Barriers | Fire driven toward the river and road | No cell east of column 41 and none north of row 7 burn, except through the road gap at columns 5-7 |
| T5 Firebreak | Break at t = 1 h across the downwind path, width 60 m | Arrival grid identical before t; cells beyond the break unburned; fire goes around only if open ground exists |
| T6 Water | Wet patch ahead of the front, then watch | Arrival time at the patch delayed versus no water, then returns toward the baseline after about 2 x `decay_tau_s` |
| T7 Fuel | Grass patch vs forest, same conditions | Grass patch burns out faster and spreads faster |
| T8 Determinism | Same scenario twice; then seed 1 vs seed 2 | Identical hash; different seeds differ but burned areas agree within about 25 % |

---

## 10. Demo areas and fallback

**Area criteria** (team picks; tick all before committing):

- [ ] At least 50 % forest, scrub or grass in the 6 km box (check an Overpass count before fetching everything).
- [ ] At least 100 m of relief across the box so slope effects are visible.
- [ ] A river or a significant road crossing part of the box, but not fencing the whole area.
- [ ] A road or track close to the likely ignition so the firebreak story works.
- [ ] Well mapped in OSM (forest polygons actually present).
- [ ] Not a dense town, and not the site of a recent real fire that harmed people. This is an illustrative demo.
- [ ] Area picked in a 15-minute vote at 1:00; do not spend longer.

**Fallback bundles.** DATA-7 commits **one or two** areas to `public/demo-areas/<name>.json`. Each holds the grid metadata, `fuel` and `elevation_m` as base64 (about 270 KB), and the licence and attribution text. They are not in `data/` because `data/*` is gitignored.

**Exactly how the fallback triggers:**

1. **Default start:** the app opens on bundled area 1. The demo path runs from bundles.
2. **`?offline=1`:** skips every network call; loads the bundle named by `?area=<name>` or area 1.
3. **Live "Load area around map centre":** each Overpass request aborts after 8 s, with one retry on a mirror; each elevation tile aborts after 6 s; the whole load has a hard cap of 20 s.
4. **On any failure or cap:** show the banner "Live data unavailable. Loaded saved demo area `<name>`", and load the bundle nearest to the requested centre (or area 1). The user is never left with an empty grid.
5. **Last resort on stage:** play the recorded demo video (INT-5).

---

## 11. Risks and mitigations

| Risk | Trigger | Pre-agreed mitigation / cut |
|---|---|---|
| Overpass slow or rate-limited | No response in 8 s; HTTP 429/504 in dev | Mirror, then bundle. Develop against a saved bundle from 1:00 so nobody waits on the API |
| Coordinate bugs (flipped rows, lon/lat order, wind "from" vs "to") | CP-1 fails, or the overlay is more than 2 cells off | Stop feature work; B + C pair until CP-1 and CP-5 pass. Use the four-corner marker test and the compass fixture |
| Multipolygon parsing eats the clock | DATA-2 passes 60 min | Cut to ways only (skip relations); accept some holes |
| Canvas or worker performance | Frame over 16 ms or sim lag at high speed | Render every 2nd tick; cap speed steps; drop to 150 x 150 via the config constant |
| Integration slips | Real area does not animate at 2:30 | Freeze tools and polish; all-hands on the core loop; demo on fixture + bundle |
| Scope creep | Any work not in the task list | Parking lot in the README; changes in another person's folder need that owner's OK; new work needs a cut |
| API keys leaked | Any key in a diff, or a keyed basemap added | No keys needed by default. Keyed satellite basemap only with `.env.local`, public key only; grep the diff and built bundle at 4:30 |
| Overclaiming accuracy | Copy review at 4:00 finds "exact", "accurate", "prediction", "forecast" | Banner on the map, in the README and in the demo script. Say "simulated" and "illustrative". The word "exact" never appears in user-facing copy (this sentence is an internal rule, not user copy) |
| Determinism bugs | Hash mismatch at CP-8 | Fix by keeping all randomness in the hash RNG and processing in fixed order; if not solved by 4:00, drop scenario replay, keep the seed |
| Tuning looks wrong | At 3:00 the head fire does not reach 1 km in 1 sim hour at high dryness | Raise `p0` or `spread_scale` per preset; the fix is a number change, not a rewrite |
| Venue network | Wifi flaky on demo day | Bundle + `?offline=1` + recorded video |
| Tile / data terms | Heavy OSM tile load, or unclear licence | Low request volume, correct attribution. Check each provider's terms before adding (CONTRIBUTING.md). Basemap tiles failing must not break the overlay |
| Licence of committed bundles | OSM-derived grids committed to the repo | OSM data is ODbL, which likely applies share-alike to a derived database. Record it in `data/README.md` and in the bundle's licence text. The repo itself has no licence yet (see open questions) |

---

## 12. Cut list (drop first to last)

If time runs short, cut from the top. Each cut is pre-agreed; no debate needed.

1. Open-Meteo prefill (DATA-5)
2. Undo and anything else marked X (TOOL-7)
3. Layer toggles and legend (UI-4)
4. Scenario download/upload and replay UI (TOOL-5), keeping the seed
5. Advanced panel down to three controls (moisture override, wind gusts, slope toggle), then drop it (TOOL-2)
6. Polish: hillshade, opacity slider, mobile layout
7. Second demo area
8. Live "load area here" UI (keep the builder as a one-off bundle maker)
9. Water decay visual (keep instant wetness), then the water tool itself
10. Firebreak polylines down to one straight segment
11. Time scrubber and seek (keep play, pause, speed, restart)

**Never cut:** the core loop (area -> ignition -> worker sim -> animated overlay), the disclaimer banner, the offline fallback, the seed.

---

## 13. Demo script (3 minutes)

| Time | Action | Say |
|---|---|---|
| 0:00-0:20 | Open on the saved area. Point at the banner. Toggle the fuel layer (forest, grass, water, roads). | "This is a simplified model, not for real-world decisions. It uses real OpenStreetMap land cover and real elevation." |
| 0:20-0:50 | Click an ignition point at the grass/forest edge. Set wind 8 m/s from the west, dryness Extreme, speed 600x. Press Run. | "Wind pushes it east, and it runs uphill faster than down." |
| 0:50-1:30 | Let it grow. Point at the burned-area readout and the elongated front. Optionally restart with the same seed at Low dryness for 10 s. | "This is out of control. Same seed, drier fuel, much bigger fire." |
| 1:30-2:30 | Pause. Draw a firebreak across the head fire's path. Spray water along the flank. Resume. The front stalls at the break, water, river and road. | "Cutting fuel and wetting ahead of the front is what stops it. In reality embers can jump a break; this model does not do spotting." |
| 2:30-2:50 | Reload the saved scenario. Same seed, same interventions, identical result. | "Runs are deterministic and replayable." |
| 2:50-3:00 | Back to the banner. | "Next: real Rothermel physics, spotting, and validation against historical fires before we say anything about accuracy." |

**Contingencies:** live fetch fails -> the banner says so and the saved area is used (say nothing, it is expected). App fails -> play the recording.

---

## 14. Definition of done and handoff

- [ ] Prod URL live and checked on a second machine (CP-10).
- [ ] Disclaimer banner permanently visible; "Simplified model, not for real-world decisions" also in the README top, the run summary and the demo script.
- [ ] README: what it is, how to run and build, the model in plain words, the limitations list, how to add an area, link to this plan and the contract.
- [ ] Attributions shown on the map and in the README (copy the exact required text from each provider's page, do not paraphrase): OpenStreetMap contributors (ODbL), the elevation tile provider and its underlying sources, the basemap provider.
- [ ] `data/README.md` lists every dataset, version and licence (DATA-6).
- [ ] [ROADMAP.md](ROADMAP.md) updated: this build brings simple/advanced settings, firebreak and water tools forward on a CA; Rothermel stays in v2.
- [ ] ADRs 0001-0003: open a PR proposing "Accepted for demo scope" per CONTRIBUTING.md; **only the team can flip a status**. Note that ADR 0002's staging (CA first, Rothermel later) matches this plan.
- [ ] Parking lot of bugs and ideas committed.
- [ ] Backup recording stored outside the repo (link in the README or with E/C).

**Next steps toward the Rothermel model**

1. Swap the factor product for Rothermel rate of spread with Scott & Burgan fuel model parameters; keep the contract and the fixture tests.
2. Elliptical wavefront or level-set propagation on the same grid.
3. Fuel moisture classes (1h/10h/100h), live and dead.
4. Ember spotting, then crown-fire transition.
5. Real fuel and canopy data (LANDFIRE, WorldCover, canopy height); time-varying weather.
6. Validate against 2-3 documented fires; only then make accuracy claims. Wording stays "physically grounded and validated against real historical fires", never "exact".

---

## 15. Open questions and assumptions

**Assumptions (correct them in the first 15 minutes):**

1. Team of 4, all comfortable with TypeScript; React is familiar to most.
2. Deploy target is Vercel static; any static host works.
3. Demo is shown on a modern Chromium browser, in person or by screen share, to a non-expert audience.
4. Public Overpass and OSM tile servers are acceptable at demo volume.
5. Purpose is education / portfolio. Real planning use is out of scope (this answers part of ideas.md's open question; confirm).
6. Node 20+ and git are installed; dependencies (Vite, React, TypeScript, maplibre-gl, Vitest) are installed at build time, not now.
7. Tuning numbers in section 5 are placeholders chosen for visual plausibility, not calibrated to real fires.
8. The Terrarium endpoint allows browser (CORS) requests; checked in DATA-3 first.

**Open questions (flag owners):**

| # | Question | Needed by | Default if unanswered |
|---|---|---|---|
| 1 | Which region / which two demo areas? | 1:00 | Team picks using the criteria in section 10 |
| 2 | React, or vanilla TS / Svelte? | 0:15 | React |
| 3 | Satellite basemap, and from whom (terms and key)? | 1:00 | OSM raster only; no key |
| 4 | Default for unmapped land: class 3 (bare, barely burns) or grass? | 1:30 | Class 3; revisit if live areas look empty |
| 5 | OK to relax the CONTRIBUTING review rule for 5 hours? | 0:15 | 2-minute partner review |
| 6 | Project licence (LICENSE is still a TODO) and how it interacts with ODbL-derived bundles | 4:30 | Keep bundles with their own licence file; decide the repo licence after the demo |
| 7 | Project name for the banner and README (currently "Wildfire Sim") | 4:00 | Wildfire Sim |
| 8 | Is the 2-person scope acceptable, or extend the time? | 0:15 | Only relevant if the team is 2 |
