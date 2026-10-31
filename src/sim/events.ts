/**
 * Preprocesses timestamped interventions into flat per-cell arrays the solver can read in O(1),
 * and implements time-dependent moisture (water spray with exponential decay).
 */

import { NEVER_ARRIVES } from '../contract';
import type { Intervention, SimSettings } from '../contract';

/** One water spray on a cell: moisture `boost` added at time `t`, halving every `half` seconds. */
export interface Spray {
  t: number;
  boost: number;
  half: number;
}

export interface EventLayers {
  /** Time at which each cell becomes non-burnable (firebreak), NEVER_ARRIVES if never. */
  breakT: Float32Array;
  /** Every spray per sprayed cell. A cell's extra moisture is the largest remaining boost of its sprays. */
  sprays: Map<number, Spray[]>;
  hasWater: boolean;
}

export function buildEventLayers(
  interventions: Intervention[],
  cellCount: number,
  settings: SimSettings,
): EventLayers {
  const breakT = new Float32Array(cellCount).fill(NEVER_ARRIVES);
  const sprays = new Map<number, Spray[]>();

  for (const iv of interventions) {
    if (iv.type === 'firebreak') {
      for (const c of iv.cells) if (iv.tSeconds < breakT[c]) breakT[c] = iv.tSeconds;
    } else if (iv.type === 'water') {
      const spray: Spray = {
        t: iv.tSeconds,
        boost: iv.params?.moistureBoost ?? settings.waterMoistureBoost,
        half: iv.params?.halfLifeS ?? settings.waterHalfLifeS,
      };
      // Keep every spray: a later one must not erase an earlier one's water before it happens,
      // otherwise adding a spray could make a cell drier and the fire arrive earlier.
      for (const c of iv.cells) {
        const list = sprays.get(c);
        if (list) list.push(spray);
        else sprays.set(c, [spray]);
      }
    }
    // TODO(sim-realism): ember spotting would be a new event source here (settings.spottingEnabled).
  }
  return { breakT, sprays, hasWater: sprays.size > 0 };
}

function remaining(s: Spray, t: number): number {
  if (t < s.t) return 0;
  return s.half > 0 ? s.boost * Math.pow(2, -(t - s.t) / s.half) : 0;
}

/** Fuel moisture of a cell at simulated time t: base plus the wettest decaying spray. */
export function moistureAt(layers: EventLayers, cell: number, t: number, baseMoisture: number): number {
  const list = layers.sprays.get(cell);
  if (!list) return baseMoisture;
  let extra = 0;
  for (const s of list) extra = Math.max(extra, remaining(s, t));
  return baseMoisture + extra;
}

/**
 * Earliest time at or after `from` when a sprayed cell's moisture is at or below `targetMoisture`,
 * or NEVER_ARRIVES. Uses the closed form of each spray's decay; a spray that starts while waiting
 * for an earlier one to dry pushes the time further out.
 */
export function timeUntilMoisture(
  layers: EventLayers,
  cell: number,
  baseMoisture: number,
  targetMoisture: number,
  from = 0,
): number {
  if (targetMoisture <= baseMoisture) return NEVER_ARRIVES;
  const list = layers.sprays.get(cell);
  if (!list) return from;
  const room = targetMoisture - baseMoisture;
  const dryAt = (s: Spray): number => (s.boost <= room || !(s.half > 0) ? s.t : s.t + s.half * Math.log2(s.boost / room));
  let t = from;
  for (let guard = 0; guard <= list.length; guard++) {
    let next = t;
    for (const s of list) if (s.t <= t) next = Math.max(next, dryAt(s));
    if (next === t) return t;
    t = next;
  }
  return t;
}
