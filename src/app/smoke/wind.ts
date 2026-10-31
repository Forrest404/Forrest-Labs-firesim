/**
 * Wind for lattice step k: the scenario wind plus an optional seeded low-frequency meander when
 * weather.windVariabilityDeg > 0. A pure function of k, so replaying from a checkpoint is exact.
 */

import { windTowardDeg } from '../../contract';
import type { Weather } from '../../contract';
import { mulberry32 } from '../../sim/prng';
import type { SmokeParams } from './params';

export interface StepWind {
  /** Unit vector the smoke moves toward: x east, y north. */
  ux: number;
  uy: number;
  /** m/s */
  speed: number;
}

const SMOKE_SEED_SALT = 0x534d4f4b; // 'SMOK'

export function windAtStep(weather: Weather, seed: number, k: number, p: SmokeParams): StepWind {
  const toward = windTowardDeg(weather.windFromDeg);
  const V = weather.windVariabilityDeg ?? 0;
  let theta = 0;
  let speed = Math.max(0, weather.windSpeedMps);
  if (V > 0) {
    const rng = mulberry32((seed ^ SMOKE_SEED_SALT) >>> 0);
    const phi1 = 2 * Math.PI * rng();
    const phi2 = 2 * Math.PI * rng();
    const tMid = (k + 0.5) * p.stepS;
    const [p1, p2] = p.meanderPeriodsS;
    theta = V * (0.6 * Math.sin((2 * Math.PI * tMid) / p1 + phi1) + 0.4 * Math.sin((2 * Math.PI * tMid) / p2 + phi2));
    speed *= 1 + p.meanderSpeedFrac * Math.sin((2 * Math.PI * tMid) / p1 + phi2);
  }
  const rad = ((toward + theta) * Math.PI) / 180;
  return { ux: Math.sin(rad), uy: Math.cos(rad), speed };
}
