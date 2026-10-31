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
- `weather-timeline.test.ts`, `weather.test.ts`, `crossing-accuracy.test.ts`, `spray.test.ts` — time-varying weather, sprays and the FIFO-safe crossing integrators (brute-force accuracy).
- `neighbourhood.test.ts`, `spotting.test.ts`, `intensity.test.ts`, `rothermel.test.ts` — the 16-direction stencil and its leak guards, ember spotting, Byram intensity, the Rothermel model.
- `ensemble.test.ts` — burn-probability ensembles. `contours.test.ts`, `geojson.test.ts` — marching squares and the GeoJSON export.
- `landcover.test.ts`, `ignition.test.ts` — satellite land cover (tables, resampler vs brute force, GeoTIFF/ASCII readers, hybrid OSM mode) and the default ignition.
- `burnCanvas.test.ts` — overlay painters.

The viewer and UI are verified by hand or headlessly (see `PROGRESS.md`), not by unit tests.
