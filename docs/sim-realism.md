# Sim realism: decisions and notes

Decisions for the `sim-realism` slot (see [FEATURES.md](../FEATURES.md)), kept in their own file so
parallel work on `DECISIONS.md` does not conflict. Numbered `SIM-n`. Source of ideas: a read-only
review of [ForeFire](https://github.com/forefireAPI/forefire) (CNRS), summarised in SIM-1.

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
constant on an absolute 600 s grid (60 s into a sprayed cell, with spray starts as breakpoints), so
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
