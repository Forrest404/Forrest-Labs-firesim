/** Briggs plume rise for a bent-over buoyant plume, used for a global "plume top" scalar. */

import type { SmokeParams } from './params';

/** Buoyancy flux F = g Q / (pi cp rho T) with T = 293 K, Q in W, result in m^4/s^3. */
export function buoyancyFlux(heatW: number): number {
  return heatW > 0 ? 8.8e-6 * heatW : 0;
}

/** Final rise above the source, metres. Zero when there is no buoyancy; otherwise clamped to [30, maxM]. */
export function briggsFinalRise(F: number, uMps: number, maxM: number): number {
  if (!(F > 0)) return 0;
  const u = Math.max(1, uMps);
  const dh = F < 55 ? (21.4 * Math.pow(F, 0.75)) / u : (38.7 * Math.pow(F, 0.6)) / u;
  return Math.min(maxM, Math.max(30, dh));
}

/** Transport speed factor from a power-law wind profile referenced to 10 m, capped. */
export function windSpeedFactor(plumeTopM: number, p: SmokeParams): number {
  const z = Math.max(10, plumeTopM);
  return Math.min(p.speedFactorMax, Math.pow(z / 10, p.windProfileExp));
}
