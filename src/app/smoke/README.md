# src/app/smoke

Cosmetic smoke field for the viewer. **Not a dispersion model validated against observations**:
no boundary layer, no terrain channelling, no chemistry; emission factors and extinction are
order-of-magnitude placeholders and opacity is illustrative. It never feeds back into spread.

- Inputs: the scenario snapshot that produced a result (grid, fuel, elevation, weather, seed,
  duration) plus `arrivalTime` and `intensity` from `SimResult`. Nothing in `src/contract` changes.
- `emission.ts`: per-cell flaming (uniform over the fuel's burn duration) and smoldering
  (exponential tail) particulate, closed-form integrals so totals are step-size independent.
- `plume.ts`: Briggs final rise for a global plume top; it scales transport speed and diffusivity.
- `wind.ts`: scenario wind plus a seeded meander (`windVariabilityDeg`), pure in the step index.
- `transport.ts`: semi-Lagrangian advection, box-blur Gaussian diffusion, first-order loss.
- `timeline.ts`: 60 s lattice with checkpoints every 20 steps; `advanceTo` is budgeted,
  `sampleAt` adds the residual advection/emission between lattice points.

Imports allowed: `src/contract`, `src/sim/prng`. No DOM, no Cesium, so `tests/smoke.test.ts` runs
in Node. The painter is `src/viewer/smokeCanvas.ts`; wiring lives in `src/app/overlayPainter.ts`
and `src/app/wiring.ts`.
