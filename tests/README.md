# tests

Vitest, Node environment, pure modules only (no Cesium, no DOM). `npm test` runs them once,
`npm run test:watch` keeps them running.

- `fixtures.ts` — hand-made 50 x 50 grid: uniform conifer forest, a 2-cell river at columns
  40-41, a road across row 25 (optionally with a gap), optional hill rising toward the north.
- `contract.test.ts` — conventions, presets, fuel table, validator.
- `sim.test.ts` — wind, slope, moisture (incl. extinction), barriers, firebreak timing, water
  delay and dry-out, determinism, fuel ordering, stats.
- `perf.test.ts` — 200 x 200 under 1 s and 300 x 300 under 2 s (actual times are logged; ~10 ms
  and ~25 ms on the build machine).
- `geo.test.ts` — grid construction, lat/lon <-> cell round trips, orientation.
- `raster.test.ts` — even-odd polygons with holes, 4-connected lines, swaths, discs.
- `bundle.test.ts` — synthetic areas, bundle round trip, Terrarium decode, nodata fill,
  slope/aspect, OSM rules.
- `tools.test.ts` — firebreak/water rasterisation, undo/redo, and "a tool-drawn firebreak stops
  the simulated fire".
- `invariants.test.ts` — model invariants that hold for ANY parameters (causality, monotonicity in moisture/wind/slope, mirror and rotation symmetry, interventions never make fire arrive earlier, fuzzed over random scenarios). Every rate model in `MODELS` runs the same suite. Mutation-checked: injected sign bugs are caught.
- `burnCanvas.test.ts` — overlay painters.

The viewer and UI are verified by hand or headlessly (see `PROGRESS.md`), not by unit tests.
- `smoke.test.ts`: the cosmetic smoke field (`src/app/smoke`) and painters: conservation, advection, diffusion, emission, determinism, scrub-back, perf.
