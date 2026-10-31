# Sim realism: decisions and notes

Decisions for the `sim-realism` slot (see [FEATURES.md](../FEATURES.md)), kept in their own file so
parallel work on `DECISIONS.md` does not conflict. Numbered `SIM-n`. Source of ideas: a read-only
review of [ForeFire](https://github.com/forefireAPI/forefire) (CNRS), summarised in SIM-1.

## What was built (index)

Nine features from the ForeFire review, each with tests and mutation checks. 264 tests, all green.

| # | Feature | Section | Where |
|---|---|---|---|
| 1 | Model invariant tests (no golden data) | SIM-7 | `tests/invariants.test.ts` |
| 2 | Pluggable rate-of-spread models, Rothermel (1972) | SIM-2, 3 | `src/sim/models.ts`, `rothermel.ts` |
| 3 | 16-direction stencil: rounder fires (8.2 % to 2.7 % shape error) | SIM-8 | `src/sim/rates.ts`, `index.ts` |
| 4 | Byram fireline intensity and flame length | SIM-9 | `src/sim/intensity.ts` |
| 5 | Deterministic ember spotting | SIM-10 | `src/sim/spotting.ts`, `hash.ts` |
| 6 | Time-varying weather and lagged fuel moisture | SIM-11 | `src/sim/weather.ts`, `crossing.ts` |
| 7 | Ensemble runs and burn-probability maps | SIM-12 | `src/sim/ensemble.ts` |
| 8 | GeoJSON perimeters and probability lines | SIM-13 | `src/data/contours.ts`, `src/export/` |
| 9 | Satellite land cover (ESA WorldCover / CORINE) | SIM-14 | `src/data/landcover.ts`, `scripts/` |
| 10 | Live wind and dryness changes while playing | SIM-15 | `src/sim/live.ts`, `src/app/weatherEdit.ts` |

Real bugs these tests found in code that already existed (each is described in its section):
edges into sprayed cells were not FIFO, so a firebreak could make a wet cell burn EARLIER (SIM-4); a later
spray overwrote an earlier, stronger one (SIM-5); the Rothermel wind limit ignored slope (SIM-3); crossing
integrators ignored a spray starting mid-interval, up to 4,000 % off (SIM-4); a size check that could never
fire (SIM-14); a default ignition that could land in a walled-in patch or a town (SIM-14); hard-coded data
attribution that was wrong for WorldCover-based areas and missing from exports (SIM-13, 14).

## SIM-1. What we borrow from ForeFire, and what we do not

ForeFire is **GPL-3.0**. We borrowed ideas only, never code: copying or porting its source could
force the whole project onto GPL, and this repo has no licence yet. Everything here is written from
the published papers (Rothermel 1972, USDA INT-115; Albini 1976, INT-30; Andrews, Cruz & Rothermel
2013, wind limit; Anderson 1982 fuel models). Do not paste ForeFire code into this repo.

Ideas taken: pluggable rate-of-spread models; invariant tests that need no golden data; spotting,
intensity, time-varying weather and ensembles as later features. Not taken: Lagrangian front
tracking (topology merging and splitting is a lot of complexity for little gain on a raster),
fire-atmosphere coupling, curvature damping (only meaningful for a tracked front).
ForeFire's own "spotting" is only a coupled re-ignition hook driven by an atmosphere model and uses
`std::random_device`, so it is non-deterministic; ours must stay seeded.

## SIM-2. Rate-of-spread models are pluggable (`src/sim/models.ts`)

`settings.rateModel` selects `factors` (default, the demo-tuned v0 model), `rothermel`, or `iso`
(constant speed, for tests). The solver builds one `RateFn` per run and calls it per edge with a
reusable `EdgeInput`. A model returns m/s, finite, >= 0, non-increasing in moisture. Adding one:
implement a factory in `models.ts`, add the id to `RateModelId` in the contract (announce it), and
add it to `MODELS` in `tests/invariants.test.ts` so it must pass the invariant suite.

Contract change (announced here): `SimSettings.rateModel`, `SimSettings.isoSpeedMps`,
`FuelSpec.bed` (a single-size dead fuel bed in SI units).

The `factors` model is unchanged in behaviour. Its per-fuel tables moved from Float32 to Float64; a
comparison against the previous solver on 60 random scenarios was byte-identical at Float32
precision, and differs by at most 2.4e-7 relative with Float64 (0 burned-cell differences).

## SIM-3. Rothermel model (`src/sim/rothermel.ts`)

Single-size dead fuel bed, Rothermel (1972) with Albini (1976) revisions (A = 133 sigma^-0.7913,
mineral damping 0.174 Se^-0.19) and the Andrews, Cruz & Rothermel (2013) limit on effective wind
(96.8 IR^(1/3) ft/min), applied to the COMBINED wind and slope effect. Per direction of spread the
wind term uses the midflame wind component along that direction (backing and flank spread get no
wind boost) and the slope term the upslope tangent along it (downhill gets none). Midflame wind =
open wind x `FuelBed.windReduction` (0.25 forest to 0.4 grass).

**Not validated** against BehavePlus or observed fires. Fuel beds are placeholders loosely based on
Anderson models 1, 5, 9, 10 and a crop-stubble stand-in, with all dead classes lumped into one.
Moisture of extinction is the shared `extinctionMoisture` (0.30-0.35, above the literature's
0.12-0.30) so that the demo dryness presets still burn. The coefficients are pinned by
`tests/rothermel.test.ts` against numbers computed independently in Python from the equations.
Surface fire in litter is slow (0.3-1.5 m/min without wind); real forest fires run via crowning and
spotting, which this model does not have. That is why `factors` stays the default.

## SIM-4. Edges into sprayed cells are integrated over time (`src/sim/crossing.ts`)

Bug found by the invariant fuzz. The v0 solver evaluated an edge's speed once, when the source
ignited. A source that ignites later sees drier fuel and could beat an earlier one (a non-FIFO
edge), which Dijkstra does not support: adding a firebreak could make a wet cell burn EARLIER.

Fix: for a target cell with sprays, integrate `rate(moisture(t))` over time until the edge distance
is covered. The rate is piecewise constant on an absolute time grid (spacing a power of two near
`unsprayed crossing time / 32`, clamped to 2-512 s, a function of the edge only). Progress per grid
interval then does not depend on the start time, so crossing time is non-decreasing in start time
(FIFO) by construction, and never earlier than the unsprayed crossing. Cells without sprays keep
the closed form. Cost: about 2x on a 200 x 200 grid with 2,000 sprayed cells (about 50 ms).

Accuracy fix (found while building SIM-11): the rate of an interval is evaluated at its midpoint, so a
spray that STARTS inside an interval was ignored for the whole interval. With a spray that cuts the
speed 16x just before the front would finish, the crossing came out 300 s too early (up to 4,186 % in
random trials). Each sprayed cell's spray start times are now extra breakpoints on the absolute grid,
which keeps the partition independent of the start time (FIFO is preserved). Tested against a
brute-force fine-step integral: median error 0.01 %, worst 0.74 % (400 random edges); the test fails
with 83 % and 2,128 % errors if the breakpoints are removed (`tests/crossing-accuracy.test.ts`).
Scenarios without sprays are byte-identical to before; with sprays 21 of 80 random scenarios changed,
by 0.2 % of cells on average and at most 68 s.

## SIM-5. Overlapping sprays: the wettest wins

Previously the latest spray on a cell replaced earlier ones, so a weak late spray cancelled a strong
early one. Now a cell keeps a list of sprays and its added moisture is the MAXIMUM of the sprays'
decaying contributions (not the sum). Max is monotone (an extra spray never dries a cell) and keeps
the dry-up time closed form (`timeUntilMoisture` is a small fixed point over the cell's sprays).
It is conservative for overlapping strokes; a cumulative-with-saturation model is possible later.

## SIM-6. Burnout makes water NON-monotone, on purpose

With `burnoutEnabled`, a source can only light a still-too-wet neighbour while it is burning. So a
fire delayed upstream (for example by a firebreak) can reach a sprayed cell after it has dried,
while an earlier fire would have burnt out against the wet fuel (grass burns for only 300 s). That
is physical, so "interventions never make a cell burn earlier" is NOT asserted for water with
burnout on. It is asserted for any mix with burnout off (this checks SIM-4 and SIM-5) and for
firebreaks with burnout on; validity and causality are asserted always.

## SIM-7. Tests added for this slot

- `tests/invariants.test.ts`: properties that hold for any parameters, run for every model in
  `MODELS`: causality, monotonicity in moisture/wind/slope, mirror and rotation symmetry, scale
  invariance, determinism, fuzzed intervention monotonicity (150 + 100 scenarios), grid anisotropy.
  Mutation-checked: injected sign errors, a non-FIFO grid, the old spray overwrite, the old wind-only
  limit, a wrong damping constant and an exponent typo are all caught.
- `tests/rothermel.test.ts`: equations, pinned independent reference values, model-in-solver.
- `tests/spray.test.ts`: spray bookkeeping, FIFO of the crossing over a fine sweep, wait-for-dry.

## SIM-8. 16-direction stencil: rounder fires (`settings.neighbourhood`, default 16)

8-neighbour shortest paths overestimate straight-line distance by up to 8.2 % (at 22.5 degrees),
so a fire on uniform ground came out as a polygon. The solver now also uses the 8 knight moves
(1 x 2 cells), cutting the worst error to 2.7 %. Cost: about 1.5x solve time (15 to 22 ms on
200 x 200, 26 to 39 ms on 300 x 300). `neighbourhood: 8` is kept, and is byte-identical to the
previous solver (checked on 80 random scenarios with water, firebreaks and wind variability).

A knight move hops over two cells, so it is only allowed when both are (a) the same fuel as the
target, (b) unsprayed, and (c) not firebroken by the arrival time. Without (a) a one-cell stripe of
slow fuel or a thin wall could be skipped; without (b) a one-cell wet band could be hopped; without
(c) a firebreak could be hopped. Each guard is covered by tests that fail when it is removed. With
the guards, 16 directions is never slower than 8 at any cell (fuzzed, burnout off: 0 of 77,561
cells later, 16,084 earlier). With burnout on and water that guarantee does not hold, see SIM-6.

## SIM-9. Fireline intensity and flame length (`src/sim/intensity.ts`)

`SimResult` now carries `firelineIntensityKwM` and `flameLengthM` per cell, plus `maxIntensityKwM`
and `maxFlameLengthM` in the stats (additive contract change). Byram (1959): `I = H w R` (kW/m,
H heat content, w the whole dead fuel load of the bed, R the spread rate along the edge that
ignited the cell, so head > flank > back) and `L = 0.0775 I^0.46` (m). Ignition cells take the
strongest rate they started. Never-burned cells are 0.

Indicative only: w counts the entire lumped dead load as consumed (overstating heavy-timber beds),
and R and the beds are placeholders. Example: Rothermel on conifer under 9 m/s wind shows about
19,000 kW/m and 7 m flames, which is a plausible order of magnitude for a wind-driven timber fire
but not a prediction. The UI shows a coarse class (low < 350, moderate < 1700, high < 3500,
extreme kW/m), the usual rule-of-thumb breakpoints for how hard a fire is to suppress; they are
not a safety rating. Flame particles are scaled to the flame length (clamped 1.5-30 m). This is
the input the spotting feature (SIM-10) uses.

## SIM-10. Ember spotting (`src/sim/spotting.ts`, `settings.spottingEnabled`, off by default)

With spotting off, a firebreak or river is an absolute barrier. With it on, a burning cell whose
POTENTIAL head-fire intensity (wind-driven, steepest uphill; a property of the cell, not of the
route the fire took) reaches `spottingIntensityKwM` throws embers downwind that can fly over water,
roads and firebreaks. Per ember: distance lognormal around `range x 15 m x U x sqrt(flame length)`
(sigma 0.6, at least 2.3 cells), direction downwind +-25 degrees, flight time distance / (0.7 U),
then a 30 s ignition delay; success `spottingIgnitionProb x (1 - m/Mx)^2`, and it fails on
non-burnable cells, cells wetter than extinction at landing time, and cells already firebroken.
Embers are extra POSITIVE-delay edges, so the solver stays a correct shortest-path search.

Determinism: every draw is a pure hash of (seed, source cell, ember number, stream) in
`src/sim/hash.ts`, not a stream, so a firebreak elsewhere cannot reshuffle unrelated embers.
(ForeFire's own re-ignition uses `std::random_device`; ours must be replayable.)
`SimResult.sourceCell` and `ignitedByEmber` record provenance (which cell ignited each cell, and
whether by ember), `stats.spotFires` counts them, and the overlay flashes spot fires pale.

Calibration: the default ignition chance is 0.02. At 0.3 each burning cell started about 0.7 new
fires and the whole map burned in 3 h (supercritical). Measured at 3 h, 10 m/s, extreme: `p = 0.03`
gives roughly 2-5x the area of spotting off, `p = 0.01` about 1.5-3x. Real per-ember ignition is
far smaller and very uncertain; 0.02 was picked so the effect is visible in a demo. All constants
are placeholders for Albini's (1979, 1983) spotting-distance models, not calibrated.

Invariants: spotting off is byte-identical to before; a threshold above any intensity changes
nothing; enabling spotting never makes any cell burn later (fuzz, burnout off); provenance holds
(every burned cell has an earlier source, ordinary spread is local, spot fires are at least 2
cells away and at least the 30 s delay later). Not asserted with spotting on: causality through
neighbours (embers legitimately land far from any burned cell) and monotonicity under water
(landing success depends on moisture at landing time).

Known gap found while tuning: the default ignition for the real Boulder Creek bundle burns only
2 ha (it appears to be boxed in); `defaultIgnition()` in `src/data/ignition.ts` needs a better
choice (`demo-ship` slot).

## SIM-11. Weather over time (`Scenario.weatherSchedule`, `src/sim/weather.ts`)

Wind speed, wind direction, temperature and humidity can follow keyframes (each field is its own
series, linearly interpolated, direction along the shorter arc, held after the last keyframe;
`Scenario.weather` is t = 0). Dead fuel moisture follows the weather with a lag
(`settings.fuelMoistureLagS`, default 1 h): `equilibrium = deriveFuelMoisture(T, RH) + offset` where
`offset = m0 - derive(T0, RH0)`, so a constant schedule reproduces the constant run exactly and an
explicit moisture at t = 0 is respected; `dm/dt = (equilibrium - m) / lag`, tabulated at 60 s.

Solver: with a schedule every edge is integrated over time (`crossTimeVarying`), the weather piecewise
constant on an absolute grid (`Scenario.weatherStepS`, default 600 s; the live path uses 120 s, see SIM-15) (60 s into a sprayed cell, with spray starts as breakpoints), so
FIFO holds by construction and the shortest-path search stays correct, the same idea as SIM-4.
Without a schedule nothing changes: 160 of 160 random scenarios without sprays are byte-identical to
the previous commit. A constant schedule matches steady weather to 4 ms (rounding) without
interventions; with sprays the two crossing integrators discretise differently and differ slightly,
plus a burnout cliff (a wait that just fits in the source's burn time on one grid but not the other).

Behaviour: a too-wet interval (moisture at or above extinction) makes the front wait, but only while
the source still burns (same rule as water, SIM-6); with burnout off, fuel that starts too wet burns
once it dries. Embers use the wind and moisture at the moment of ignition and landing.

Limits: no precipitation. With the simple linear moisture model even 100 % humidity tops out near 27 %,
below the 30-35 % extinction moisture, so damp air slows a fire but cannot stop it unless extinction
is lowered; a rain keyframe would need its own wetting term. Wind variability stays a fixed per-cell
direction offset. The UI offers five presets as data (`WEATHER_PRESETS`: steady, wind shift, wind
rise, front passage, evening cooling), applied relative to the starting weather at simulate time, and
shows the wind "now" while playing.

Tests: `tests/weather-timeline.test.ts` (interpolation, direction wrap, moisture lag, validation),
`tests/weather.test.ts` (constant schedule equals steady, wind shift, monotone wind ramp, damp air
and lag, too-wet-then-dry, FIFO sweep, fuzzed firebreak monotonicity and validity under random
schedules), `tests/crossing-accuracy.test.ts`. Mutation-checked: five injected bugs are caught.

## SIM-12. Ensembles and burn-probability maps (`src/sim/ensemble.ts`)

One simulation costs about 20 ms, so many perturbed runs are cheap. `runEnsemble` runs N (1-500)
simulations, each with perturbed wind speed (mean-preserving lognormal, so the average wind is
unchanged), wind direction (normal, degrees), fuel moisture (normal, fraction), optionally the
ignition cell (random burnable cell within a radius) and the seed (embers, wind variability). A
weather schedule is perturbed consistently (same speed factor and direction offset on every
keyframe). Every perturbation is a pure hash of (baseSeed, run, parameter), so an ensemble is exactly
reproducible, and independent of the order the runs are made in (tested by running them backwards).

Output: per-cell burn probability, mean and earliest arrival, burned-area quantiles (p10/p50/p90),
mean spot fires, and 24 time slices of ignition counts so `probabilityAt(result, t)` gives P(burned by
t) and the probability map animates with the scrubber (exact at slice boundaries, linear within a
slice). Per-run results are not stored, so memory does not grow with N. Interventions, spotting and
schedules apply in every run, so the map shows how a firebreak changes the odds.

The app runs it in the worker with progress and cancel (the worker yields between runs). UI: runs
(25-200), an uncertainty level (low/medium/high as data in `UNCERTAINTY_PRESETS`), ignition
position (exact, +-1, +-3 cells), a toggle for the probability layer (drawn above the single run,
which fades back), a legend, and a one-line summary. An ensemble is flagged stale when conditions
change. Cost on 200 x 200, 100 runs: 2.4 s plain, 3.9 s Rothermel, 8.3 s with spotting and a weather
schedule (about 80 ms per run; the app shows progress).

Honest limits: the perturbation sizes are guesses, not measured forecast errors, and the map shows
the spread of THIS model under those guesses. It is not a calibrated probability of a real fire. At
t = 0 the ignition cell shows 0 because the first slice interpolates from nothing.

Tests (`tests/ensemble.test.ts`, 17): perturbation statistics (mean-preserving to 0.6 %), zero
perturbation collapses to the deterministic run, reproducibility and order independence, valid
probabilities, the full map checked against direct counts at all 25 slice boundaries, quantile
order, sensitivity to wind and direction uncertainty, downwind monotonicity, interventions and
spotting inside runs, cancel and progress. Mutation-checked: a non-mean-preserving factor, a
same-for-every-run perturbation, a wrong divisor, dropped interventions, and slices shifted one early
or late are all caught (two earlier tests were too weak to catch the last two and were strengthened).

## SIM-13. Perimeter export: GeoJSON isochrones and probability lines (`src/data/contours.ts`, `src/export/geojson.ts`)

The arrival-time grid already encodes every perimeter: the fire edge at time t is the contour of
arrival time at level t. `src/data/contours.ts` is a marching-squares implementation (pure raster
geometry, cell space): a one-sample "outside" border so every contour closes, linear interpolation
between samples (midpoint where one side is unburned/infinite), explicit saddle resolution by the
centre value, ring assembly, and polygons with holes by nesting depth (so islands inside pockets
work). Probability lines use the same code with `mode: 'above'`.

`src/export/geojson.ts` writes RFC 7946: WGS84 `[lon, lat]`, exterior rings counter-clockwise, holes
clockwise (normalised after the lat flip), closed rings, coordinates rounded to 6 decimals (about
0.1 m). `perimetersToGeoJSON`: hourly isochrones (at most 48, always ending at the duration) with
`tHours`, `areaHa`, `perimeterKm`, plus the ignition point and firebreak / water cells. `probabilityToGeoJSON`:
10 / 50 / 90 % lines of an ensemble at the end of the run or any time. A new `src/export/` module
(README included) because it needs both `data/` and `sim/`, which `data/` may not import.

Every file carries a `disclaimer` ("Simplified model. Not for real-world decisions."), the demo
area's name and whether its data is synthetic, because an exported file loses the on-screen notice.

Known behaviour: contours cut the four grid corners diagonally (a fully burned 6 x 4 grid has area
23.5 cells, not 24) and run half a cell outside the outermost cell centres along the grid edge. Where
two probability levels both touch the grid edge their lines coincide there.

Tests (`tests/contours.test.ts` 15, `tests/geojson.test.ts` 15): exact known shapes (single cell is a
diamond of area 0.5, a distance field gives a circle within 2 % in radius and area), holes, islands,
two blobs, grid-edge closure, interpolation, saddles, fuzz over 150 random fields (closed, finite, no
repeated points, valid nesting), RFC 7946 orientation fuzzed over 150 shapes with holes and islands,
every cell centre on the correct side of the final perimeter (0 wrong), perimeter area within 10 % of
the burned area at every hour, nested probability lines, the disclaimer. Mutation-checked: inverted
saddles, no interpolation, a wrong edge id, holes as exteriors, lat/lon swapped and a dropped
disclaimer are caught; un-normalised orientation survived until the fuzz over holes and islands was
added (ordinary fire shapes happen to come out right by luck).

## SIM-14. Satellite land cover for fuel (`src/data/landcover.ts`, `scripts/lib/landcover-io.ts`)

OSM vegetation is patchy in many places (Boulder Creek: 61 % of the grid fell to the default grass
although the area is a redwood belt). `build:demo-area` can now use ESA WorldCover 2021 (10 m, global,
CC BY 4.0), read straight from the public AWS bucket as a Cloud-Optimized GeoTIFF (only the needed
window is downloaded, about 0.9 s for a 6 km area), or a local GeoTIFF / ESRI ASCII grid, with the
WorldCover or CORINE legend. `geotiff` (MIT) is a DEV dependency used only by the Node script; the
browser bundle is unchanged.

Mapping (placeholders, like the fuel table): tree cover -> conifer (`--tree-fuel` to change; WorldCover
does not name the forest type), shrubland -> shrub, grassland -> grass, cropland -> farmland;
built-up, bare/sparse, snow, water, wetland, mangrove and moss -> non-burnable. CORINE names its forest
types. The 10 m pixels are reduced to 30 m cells by majority vote (ties to the lower code); every pixel
inside the grid is used exactly once (tested with a read-counting proxy), and the whole resampler is
fuzz-tested against an independent brute-force reference.

Hybrid mode: satellite vegetation as the base, OSM drawn on top for what it maps well (water,
buildings, roads, rivers, rail); `--osm none` skips Overpass entirely, which is useful because
Overpass is the flakiest dependency. A real Boulder Creek bundle built this way is 92 % conifer forest
(was 27 %), with 0 uncovered cells.

Bug found and fixed on the way: the default ignition only looked near the grid centre and could land
in a tiny walled-in patch or inside a town (13 cells burned in 6 h). It now picks a cell in the largest
8-connected burnable region (the connectivity the solver spreads through), requires 85 % burnable land
in a 13 x 13 window (summed-area table), prefers forest and shrub, and takes the nearest such cell to
the centre. On Boulder Creek the 6 h Rothermel fire went from 13 cells to 389 ha.

Not done: CORINE and other non-geographic rasters must be reprojected to EPSG:4326 first (the reader
refuses them with the gdalwarp command); WorldCover is the only source fetched automatically (CORINE
needs a Copernicus login); no live in-browser loading yet (`live-data` slot).

Tests: `tests/landcover.test.ts` (15) and `tests/ignition.test.ts` (10). Mutation-checked: an off-by-one
pixel range, tie-break reversed, flipped row order, forest mapped to non-burnable, OSM vegetation not
skipped in hybrid mode, tile naming by the wrong corner, a lost GeoTIFF y offset, a dropped openness
rule, the wrong region and a farthest-candidate pick are all caught (two mutants were equivalent code
and one tie-break rule needed its own test).

## SIM-15. Live weather: change wind and dryness while the fire plays (`src/sim/live.ts`, `src/app/weatherEdit.ts`)

Moving the wind speed, wind direction or dryness while a result is playing changes the weather FROM
THE CURRENT TIME ON, re-runs the simulation automatically (150 ms after the last change, in the
worker, 20-100 ms on the Boulder Creek grid) and leaves everything that has already burned alone.
Before any result exists, or at t = 0, the same controls change the starting conditions as before.

How the past stays put. The solver samples the weather at the middle of each step of an absolute grid.
A change made at playback time T is centred on the first grid boundary B at least `step/2 + 30 s`
later: a keyframe at `B - step/2` holds the weather exactly as the schedule had it, and a keyframe at
`B + step/2` holds the new weather. Every step that ends by B is sampled at or before `B - step/2`, so
nothing that burns before T can change (the extra 30 s covers the 60 s steps inside sprayed cells).
The change therefore starts to bite 90-210 s of simulated time after T. That needs a finer grid than the
default, so single live runs set `weatherStepS = 120` (about 2.7x slower than 600 s, still far inside a
frame budget; ensembles keep 600 s because a 100-run ensemble was already close to its 15 s test limit).
A live run also always uses the time-varying solver path (an otherwise empty schedule gets one do-nothing
keyframe after the end), because the closed-form constant-weather path rounds differently and a run
before and after the first edit would not agree exactly.

Rules the user sees:
- An edit replaces the preset's trend from then on ("the user has taken over"); the preset's later
  keyframes are dropped. Earlier ones are kept.
- Edits in the same slot (a slider drag) are one edit. Editing at an earlier time discards edits
  centred later: they described a future that no longer happens.
- At most 80 edits (two keyframes each; a schedule may hold 200). The newest is what gets replaced.
- The sliders show the weather in force at the playback time, and show a change at once even before it
  has ramped in. "Undo live changes" clears them; switching live off clears them and flags the result stale.
- Only wind speed, wind direction and the dryness presets are live. Other settings (spread multiplier,
  rate model, spotting, fuel moisture and so on) still apply from the start via Re-simulate.
- Dryness changes temperature and humidity; fuel moisture follows with its usual lag.

Tests: `tests/live.test.ts` (13) runs the real solver and asserts, for 40 random edits over four scenarios
(with and without water, with and without spotting), that the set of cells burned by T and their times are
identical before and after an edit, in both directions, and that the edit changes the later fire.
`tests/weatherEdit.test.ts` (8) covers the store rules. Mutation-checked: no hold keyframe, no half-step
margin, no spray margin, future preset keyframes kept, slot replacement, the solver path not forced,
live edits flagged stale, edits kept when live is switched off, a wrong edit time, losing the other fields,
and a preset change keeping edits are all caught. One mutant (hold keyframe at B instead of B - step/2) is
equivalent: no solver step samples in between.
