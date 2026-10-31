/**
 * Every tunable of the smoke model, with units. All values are order-of-magnitude placeholders
 * chosen for plausible relative behaviour on a 30 m grid; nothing here is calibrated against
 * observations. `sim-realism` may change numbers freely.
 */

import { FUEL_CLASS_COUNT } from '../../contract';

export interface SmokeParams {
  /** Lattice step of the field, simulated seconds. */
  stepS: number;
  /** A full copy of the field is kept every this many steps so scrubbing back is cheap and exact. */
  checkpointEvery: number;
  /** Particulate emitted per kg of fuel consumed in the flaming phase (kg/kg, Urbanski 2014 order). */
  efFlameKgKg: number;
  /** Particulate emitted per kg of fuel consumed while smoldering (kg/kg). */
  efSmolderKgKg: number;
  /** Share of each fuel's load that burns in the smoldering tail, indexed by FuelClass. */
  smolderFrac: Float32Array;
  /** e-folding time of the smoldering tail per FuelClass, seconds. */
  smolderTauS: Float32Array;
  /** The tail is truncated at this many tau and renormalised. */
  tailCutoffTau: number;
  /** Horizontal eddy diffusivity floor, m^2/s. */
  kBaseM2s: number;
  /** Extra diffusivity per m/s of wind, m^2/s per m/s. */
  kWindM2sPerMps: number;
  /** Extra diffusivity per km of plume top (taller plumes spread wider), m^2/s per km. */
  kPlumeM2sPerKm: number;
  /** Power-law wind profile exponent used to speed up transport of tall plumes. */
  windProfileExp: number;
  /** Cap on the transport speed factor from the wind profile. */
  speedFactorMax: number;
  /** Cap on plume rise, metres above ground. */
  plumeMaxM: number;
  /** First-order loss (deposition + dilution out of the column) e-folding time, seconds. 0 disables. */
  lossTauS: number;
  /** Periods of the two seeded meander components, seconds. */
  meanderPeriodsS: [number, number];
  /** Fractional wind-speed modulation of the meander. */
  meanderSpeedFrac: number;
}

function byFuel(values: number[]): Float32Array {
  const a = new Float32Array(FUEL_CLASS_COUNT);
  for (let i = 0; i < Math.min(values.length, FUEL_CLASS_COUNT); i++) a[i] = values[i];
  return a;
}

export const DEFAULT_SMOKE_PARAMS: SmokeParams = {
  stepS: 60,
  checkpointEvery: 20,
  efFlameKgKg: 0.01,
  efSmolderKgKg: 0.025,
  //            NONE GRASS SHRUB DECID CONIF FARM
  smolderFrac: byFuel([0, 0.1, 0.25, 0.4, 0.45, 0.15]),
  smolderTauS: byFuel([0, 600, 1800, 7200, 10800, 900]),
  tailCutoffTau: 4,
  kBaseM2s: 15,
  kWindM2sPerMps: 10,
  kPlumeM2sPerKm: 30,
  windProfileExp: 0.15,
  speedFactorMax: 1.5,
  plumeMaxM: 2500,
  lossTauS: 14400,
  meanderPeriodsS: [1800, 540],
  meanderSpeedFrac: 0.15,
};
