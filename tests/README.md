# tests

Vitest, Node environment, pure modules only (no Cesium, no DOM).

- `fixtures.ts` — hand-made 50 x 50 grid: uniform forest, a vertical river on the east side, a road
  across the middle, a hill rising toward the north. Known expected behaviour lets the sim and UI
  be built before real data exists.
- `contract.test.ts` — conventions, presets, fuel table, validator.
- `sim.test.ts` — wind, slope, moisture, barriers, water, determinism.
- `perf.test.ts` — a 200 x 200 run completes under 1 s (actual time is logged).
- `geo.test.ts`, `raster.test.ts`, `bundle.test.ts`, `tools.test.ts` — data and tool helpers.

Run `npm test` (once) or `npm run test:watch`.
