/**
 * Spread-rate factors. Rothermel-INSPIRED trends only (wind, slope, fuel, moisture).
 * Every constant is a placeholder, NOT CALIBRATED. See DECISIONS.md D3.
 *
 * rate = baseRate(target fuel) x windFactor x slopeFactor x moistureFactor x globalMultiplier
 */

import type { SimSettings } from '../contract';

const SQRT2 = Math.SQRT2;

/** The 8 neighbour offsets with their unit direction (east, north components) and distance factor. */
export interface NeighborOffset {
  dr: number;
  dc: number;
  /** Unit vector of the spread direction: x east, y north. */
  ux: number;
  uy: number;
  /** Multiply by cell size to get centre-to-centre distance. */
  distFactor: number;
}

export const NEIGHBOR_OFFSETS: readonly NeighborOffset[] = (() => {
  const out: NeighborOffset[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const len = Math.hypot(dr, dc);
      // Row increases southward, so "north" is -dr.
      out.push({ dr, dc, ux: dc / len, uy: -dr / len, distFactor: len === 1 ? 1 : SQRT2 });
    }
  }
  return out;
})();

/**
 * Wind factor from the cosine of the angle between the spread direction and the downwind
 * direction. Strong boost downwind, neutral flanking, strong penalty upwind. Grows with wind
 * speed with diminishing returns (windExponent < 1).
 */
export function windFactor(cosTheta: number, windSpeedMps: number, settings: SimSettings): number {
  if (settings.windStrength <= 0 || windSpeedMps <= 0) return 1;
  const s = 1.2 * settings.windStrength * Math.pow(windSpeedMps, settings.windExponent);
  if (cosTheta >= 0) return 1 + s * cosTheta;
  // Backing fire: penalised, but softer than the head boost so some upwind creep stays visible
  // (head/back ratio about 20x at 8 m/s). Real backing fires can be far slower.
  return 1 / (1 - 0.35 * s * cosTheta);
}

/**
 * Slope factor from rise over run between source and target. Uphill boosts, downhill damps.
 * exp(k * tan(slope)), clamped. 20 degrees uphill is about 3x at slopeStrength 1.
 */
export function slopeFactor(dzM: number, distM: number, settings: SimSettings): number {
  if (settings.slopeStrength <= 0) return 1;
  const tanPhi = dzM / distM;
  const f = Math.exp(3 * settings.slopeStrength * tanPhi);
  return f < 0.2 ? 0.2 : f > 5 ? 5 : f;
}

/**
 * Moisture factor: 1 when bone dry, 0 at or above the fuel's moisture of extinction.
 * (1 - m/Mx)^2 is a stand-in for Rothermel's damping polynomial with the same trend.
 */
export function moistureFactor(moisture: number, extinctionMoisture: number): number {
  if (extinctionMoisture <= 0 || moisture >= extinctionMoisture) return 0;
  const r = 1 - moisture / extinctionMoisture;
  return r * r;
}

/** Spread direction cosine against the wind "toward" vector (x east, y north). */
export function cosAgainstWind(offset: NeighborOffset, windX: number, windY: number): number {
  return offset.ux * windX + offset.uy * windY;
}

// TODO(sim-realism): swap this product of factors for Rothermel rate of spread per fuel model,
// keep the function signature so the solver does not change.
export function combineRate(
  baseRateMps: number,
  wind: number,
  slope: number,
  moisture: number,
  settings: SimSettings,
): number {
  return baseRateMps * wind * slope * moisture * settings.globalMultiplier;
}
