/**
 * Spread-rate factors. Rothermel-INSPIRED trends only (wind, slope, fuel, moisture).
 * Every constant is a placeholder, NOT CALIBRATED. See DECISIONS.md D3.
 *
 * rate = baseRate(target fuel) x windFactor x slopeFactor x moistureFactor x globalMultiplier
 */

import type { SimSettings } from '../contract';

/**
 * Neighbour stencil. The first 8 entries are the king moves (4 edge + 4 diagonal); entries 8-15
 * are the knight moves (1 x 2 cells). 8-neighbour shortest paths overestimate straight-line
 * distance by up to 8.2 %, which makes a fire on uniform ground octagonal; adding knight moves
 * cuts that to 2.7 %.
 *
 * A knight move hops over two cells (m1 and m2, given as offsets from the SOURCE cell), so the
 * solver only allows it when both are the same fuel as the target, unsprayed and not firebroken by
 * the arrival time. That keeps barriers, wet bands and fuel changes from being skipped.
 */
export interface NeighborOffset {
  dr: number;
  dc: number;
  /** Unit vector of the spread direction: x east, y north. */
  ux: number;
  uy: number;
  /** Multiply by cell size to get centre-to-centre distance. */
  distFactor: number;
  /** Knight moves only: the two cells the segment passes through, as offsets from the source. */
  m1r: number;
  m1c: number;
  m2r: number;
  m2c: number;
}

export const KING_MOVES = 8;
export const ALL_MOVES = 16;

export const NEIGHBOR_OFFSETS: readonly NeighborOffset[] = (() => {
  const out: NeighborOffset[] = [];
  const push = (dr: number, dc: number, m1r = 0, m1c = 0, m2r = 0, m2c = 0): void => {
    const len = Math.hypot(dr, dc);
    // Row increases southward, so "north" is -dr.
    out.push({ dr, dc, ux: dc / len, uy: -dr / len, distFactor: len, m1r, m1c, m2r, m2c });
  };
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) push(dr, dc);
  for (const sr of [-1, 1]) {
    for (const sc of [-2, 2]) {
      push(sr, sc, 0, sc / 2, sr, sc / 2); // 1 row, 2 columns: passes (0, +-1) and (+-1, +-1)
      push(sc, sr, sc / 2, 0, sc / 2, sr); // 2 rows, 1 column: passes (+-1, 0) and (+-1, +-1)
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
