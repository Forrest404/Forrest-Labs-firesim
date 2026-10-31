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
