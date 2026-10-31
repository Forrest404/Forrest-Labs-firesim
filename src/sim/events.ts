/**
 * Timestamped interventions turned into flat per-cell structures the solver can query cheaply.
 *
 * Firebreak: a cell becomes non-burnable from breakT[cell] on (earliest event wins).
 * Water: each spray adds `boost * 2^(-(t - tSpray) / halfLife)` to the cell's fuel moisture from
 * tSpray on. A cell can carry several sprays; the WETTEST one dominates (max, not sum). Max keeps
 * the model monotone: adding a spray can never make a cell drier or a fire faster, and a later,
 * weaker spray can never cancel an earlier, stronger one. See docs/sim-realism.md SIM-5.
 */

import { NEVER_ARRIVES } from '../contract';
import type { Intervention, SimSettings } from '../contract';

export interface EventLayers {
  /** Time at which each cell becomes non-burnable (firebreak), NEVER_ARRIVES if never. */
  breakT: Float32Array;
  /** Head of each cell's spray list (index into the spray arrays), -1 if the cell was never sprayed. */
  sprayHead: Int32Array;
  /** Earliest and latest spray start per sprayed cell. */
  sprayFirst: Float64Array;
  sprayLast: Float64Array;
  /** Flat spray records: start time (s), moisture boost (fraction), half-life (s), next record index. */
  sprayT: number[];
  sprayBoost: number[];
  sprayHalf: number[];
  sprayNext: number[];
  hasWater: boolean;
}

export function buildEventLayers(
  interventions: Intervention[],
  cellCount: number,
  settings: SimSettings,
): EventLayers {
  const breakT = new Float32Array(cellCount).fill(NEVER_ARRIVES);
  const sprayHead = new Int32Array(cellCount).fill(-1);
  const sprayFirst = new Float64Array(cellCount).fill(Infinity);
  const sprayLast = new Float64Array(cellCount).fill(-Infinity);
  const layers: EventLayers = {
    breakT, sprayHead, sprayFirst, sprayLast,
    sprayT: [], sprayBoost: [], sprayHalf: [], sprayNext: [], hasWater: false,
  };

  for (const iv of interventions) {
    if (iv.type === 'firebreak') {
      for (const c of iv.cells) if (iv.tSeconds < breakT[c]) breakT[c] = iv.tSeconds;
    } else if (iv.type === 'water') {
      const boost = iv.params?.moistureBoost ?? settings.waterMoistureBoost;
      const half = iv.params?.halfLifeS ?? settings.waterHalfLifeS;
      if (!(boost > 0) || !(half > 0)) continue; // a spray with no boost or no persistence does nothing
      for (const c of iv.cells) {
        const idx = layers.sprayT.length;
        layers.sprayT.push(iv.tSeconds);
        layers.sprayBoost.push(boost);
        layers.sprayHalf.push(half);
        layers.sprayNext.push(sprayHead[c]);
        sprayHead[c] = idx;
        if (iv.tSeconds < sprayFirst[c]) sprayFirst[c] = iv.tSeconds;
        if (iv.tSeconds > sprayLast[c]) sprayLast[c] = iv.tSeconds;
        layers.hasWater = true;
      }
    }
    // TODO(sim-realism): ember spotting would be a new event source here (settings.spottingEnabled).
  }
  return layers;
}

/** Moisture added by sprays at time t (the wettest active spray), 0 if none are active. */
export function sprayContribution(layers: EventLayers, cell: number, t: number): number {
  let best = 0;
  for (let k = layers.sprayHead[cell]; k >= 0; k = layers.sprayNext[k]) {
    const ts = layers.sprayT[k];
    if (t < ts) continue;
    const c = layers.sprayBoost[k] * Math.pow(2, -(t - ts) / layers.sprayHalf[k]);
    if (c > best) best = c;
  }
  return best;
}

/** Fuel moisture of a cell at simulated time t: base plus decaying spray. */
export function moistureAt(layers: EventLayers, cell: number, t: number, baseMoisture: number): number {
  return baseMoisture + sprayContribution(layers, cell, t);
}

/**
 * Earliest time T >= tFrom at which the cell's moisture is at or below `targetMoisture` and stays
 * that way for every spray already started by T (a spray that starts later re-wets the cell, but
 * the fire only needs the cell to be dry at the moment it arrives). Returns NEVER_ARRIVES if the
 * target is at or below the base moisture.
 */
export function timeUntilMoisture(
  layers: EventLayers,
  cell: number,
  baseMoisture: number,
  targetMoisture: number,
  tFrom: number,
): number {
  const thr = targetMoisture - baseMoisture;
  if (!(thr > 0)) return NEVER_ARRIVES;
  let T = tFrom;
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = layers.sprayHead[cell]; k >= 0; k = layers.sprayNext[k]) {
      const ts = layers.sprayT[k];
      if (ts > T) continue;
      const boost = layers.sprayBoost[k];
      const dry = boost <= thr ? ts : ts + layers.sprayHalf[k] * Math.log2(boost / thr);
      if (dry > T) {
        T = dry;
        changed = true;
      }
    }
  }
  return T;
}

/**
 * The latest spray start at or before t (lo, -Infinity if none) and the earliest spray start after t
 * (hi, Infinity if none) on a cell. The crossing integrators use them as extra breakpoints so a spray
 * never starts in the middle of an interval, where evaluating at the midpoint would miss it.
 */
export function sprayStartsAround(layers: EventLayers, cell: number, t: number, out: { lo: number; hi: number }): void {
  let lo = -Infinity;
  let hi = Infinity;
  for (let k = layers.sprayHead[cell]; k >= 0; k = layers.sprayNext[k]) {
    const ts = layers.sprayT[k];
    if (ts <= t) {
      if (ts > lo) lo = ts;
    } else if (ts < hi) hi = ts;
  }
  out.lo = lo;
  out.hi = hi;
}
