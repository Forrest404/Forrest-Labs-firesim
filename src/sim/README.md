# src/sim

Pure simulation core. Runs in a Web Worker in the app and directly in Node for tests.

**Owns:** `simulate(scenario): SimResult`, the spread model (fuel, wind, slope, moisture factors),
intervention handling (firebreak, water with decay), the seeded PRNG, the worker wrapper and its
typed message protocol.

**Must not import:** the DOM, Cesium, `src/data`, `src/ui`, `src/viewer`, `src/app`.
Only `src/contract`. **Never use `Math.random()` here**; use `prng.ts`.

**Public interface**
- `simulate(scenario)` in `index.ts`. Deterministic for a given scenario and seed.
- `worker.ts` + `protocol.ts`: `run`, `cancel` in; `progress`, `result`, `error` out. Typed arrays are transferred, not copied.

**Model in one line:** minimum-travel-time propagation (Dijkstra over the 8-neighbour graph).
Edge cost = distance / rate, where
`rate = baseRate(target fuel) x windFactor x slopeFactor x moistureFactor x globalMultiplier`.
Details and formulas are in `rates.ts`; event timing (firebreak at t, water decay) in `events.ts` and `moisture.ts`.

**Extension points**
- `rates.ts`: `TODO(sim-realism)` tune factors or swap in Rothermel rate of spread.
- `events.ts`: `TODO(sim-realism)` ember spotting hook (currently a disabled stub).
- Add a new intervention type: extend `InterventionType` in the contract (announce it), handle it in `events.ts`.
