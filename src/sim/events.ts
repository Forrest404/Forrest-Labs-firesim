/**
 * Preprocesses timestamped interventions into flat per-cell arrays the solver can read in O(1),
 * and implements time-dependent moisture (water spray with exponential decay).
 */

import { NEVER_ARRIVES } from '../contract';
import type { Intervention, SimSettings } from '../contract';

export interface EventLayers {
  /** Time at which each cell becomes non-burnable (firebreak), NEVER_ARRIVES if never. */
  breakT: Float32Array;
  /** Time of the latest water spray on each cell, NEVER_ARRIVES if none. */
  waterT: Float32Array;
  /** Moisture added at spray time per cell (fraction). */
  waterBoost: Float32Array;
  /** Decay half-life per cell, seconds. */
  waterHalf: Float32Array;
  hasWater: boolean;
}

export function buildEventLayers(
  interventions: Intervention[],
  cellCount: number,
  settings: SimSettings,
): EventLayers {
  const breakT = new Float32Array(cellCount).fill(NEVER_ARRIVES);
  const waterT = new Float32Array(cellCount).fill(NEVER_ARRIVES);
  const waterBoost = new Float32Array(cellCount);
  const waterHalf = new Float32Array(cellCount);
  let hasWater = false;

  for (const iv of interventions) {
    if (iv.type === 'firebreak') {
      for (const c of iv.cells) if (iv.tSeconds < breakT[c]) breakT[c] = iv.tSeconds;
    } else if (iv.type === 'water') {
      hasWater = true;
      const boost = iv.params?.moistureBoost ?? settings.waterMoistureBoost;
      const half = iv.params?.halfLifeS ?? settings.waterHalfLifeS;
      for (const c of iv.cells) {
        // Latest spray wins (re-spraying refreshes the cell). Earlier sprays are forgotten.
        if (waterT[c] === NEVER_ARRIVES || iv.tSeconds >= waterT[c]) {
          waterT[c] = iv.tSeconds;
          waterBoost[c] = boost;
          waterHalf[c] = half;
        }
      }
    }
    // TODO(sim-realism): ember spotting would be a new event source here (settings.spottingEnabled).
  }
  return { breakT, waterT, waterBoost, waterHalf, hasWater };
}

/** Fuel moisture of a cell at simulated time t: base plus decaying spray. */
export function moistureAt(layers: EventLayers, cell: number, t: number, baseMoisture: number): number {
  const tw = layers.waterT[cell];
  if (t < tw) return baseMoisture;
  const half = layers.waterHalf[cell];
  const decay = half > 0 ? Math.pow(2, -(t - tw) / half) : 0;
  return baseMoisture + layers.waterBoost[cell] * decay;
}

/**
 * Earliest time a sprayed cell's moisture drops to `targetMoisture`, or NEVER_ARRIVES.
 * Closed form of the exponential decay in moistureAt.
 */
export function timeUntilMoisture(
  layers: EventLayers,
  cell: number,
  baseMoisture: number,
  targetMoisture: number,
): number {
  if (targetMoisture <= baseMoisture) return NEVER_ARRIVES;
  const tw = layers.waterT[cell];
  if (tw === NEVER_ARRIVES) return 0;
  const boost = layers.waterBoost[cell];
  if (boost <= targetMoisture - baseMoisture) return tw;
  const half = layers.waterHalf[cell];
  if (!(half > 0)) return tw;
  return tw + half * Math.log2(boost / (targetMoisture - baseMoisture));
}
