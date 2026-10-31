/**
 * Per-cell smoke emission from the sim's arrival times and the fuel table. Flaming phase:
 * uniform rate over [arrival, burnout). Smoldering: exponential tail after burnout, truncated at
 * tailCutoffTau and renormalised. Everything is integrated in closed form so totals do not depend
 * on the step size.
 */

import { FUELS, FuelClass, NEVER_ARRIVES, isBurnable } from '../../contract';
import type { GridSpec, Weather } from '../../contract';
import type { SmokeParams } from './params';

/** Heat content shared by all fuels in fuels.ts, J/kg. */
const HEAT_J_PER_KG = 18_608_000;

export interface SmokeInputs {
  grid: GridSpec;
  fuel: Uint8Array;
  elevation: Float32Array;
  arrival: Float32Array;
  intensity?: Float32Array;
  weather: Weather;
  seed: number;
  durationS: number;
}

export interface EmissionTables {
  /** Reference to the arrival array (not copied). */
  arrival: Float32Array;
  /** arrival + burnDurationS, or NEVER_ARRIVES. */
  burnoutAt: Float32Array;
  /** kg particulate emitted over the whole flaming phase. */
  mFlame: Float32Array;
  /** kg particulate emitted over the whole smoldering tail. */
  mSmolder: Float32Array;
  /** Smoldering e-folding time per cell, s. */
  tauS: Float32Array;
  /** Heat release rate while flaming, W. */
  heatW: Float32Array;
  /** Normalisation of the truncated tail: 1 - exp(-tailCutoffTau). */
  tailNorm: number;
  tailCutoffTau: number;
}

export function buildEmissionTables(inp: SmokeInputs, p: SmokeParams): EmissionTables {
  const n = inp.grid.width * inp.grid.height;
  const area = inp.grid.cellSizeM * inp.grid.cellSizeM;
  const burnoutAt = new Float32Array(n).fill(NEVER_ARRIVES);
  const mFlame = new Float32Array(n);
  const mSmolder = new Float32Array(n);
  const tauS = new Float32Array(n);
  const heatW = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = inp.arrival[i];
    const f = inp.fuel[i];
    if (a === NEVER_ARRIVES || !isBurnable(f)) continue;
    const spec = FUELS[f as FuelClass];
    const D = Math.max(1, spec.burnDurationS);
    const mFuel = spec.bed.loadKgM2 * area;
    const s = p.smolderFrac[f] ?? 0;
    const I = inp.intensity ? inp.intensity[i] : 0.5;
    burnoutAt[i] = a + D;
    mFlame[i] = mFuel * (1 - s) * p.efFlameKgKg * (0.5 + I);
    mSmolder[i] = mFuel * s * p.efSmolderKgKg;
    tauS[i] = p.smolderTauS[f] ?? 0;
    heatW[i] = (mFuel * (1 - s) * HEAT_J_PER_KG) / D;
  }
  return { arrival: inp.arrival, burnoutAt, mFlame, mSmolder, tauS, heatW, tailNorm: 1 - Math.exp(-p.tailCutoffTau), tailCutoffTau: p.tailCutoffTau };
}

export interface EmissionTotals {
  /** kg emitted over the interval, all cells. */
  total: number;
  /** kg of that from smoldering. */
  smolder: number;
  /** Time-weighted mean flaming heat release over the interval, W. */
  heatW: number;
  /** Cells that were flaming at any time in the interval. */
  activeFlaming: number;
}

/** Adds the emission of every cell over [t0, t1) into `out` (and the smoldering part into `smolderOut`). */
export function emissionBetween(tbl: EmissionTables, t0: number, t1: number, out: Float32Array, smolderOut?: Float32Array): EmissionTotals {
  const dt = t1 - t0;
  let total = 0;
  let smolder = 0;
  let heat = 0;
  let active = 0;
  if (dt <= 0) return { total, smolder, heatW: heat, activeFlaming: active };
  const { arrival, burnoutAt, mFlame, mSmolder, tauS, heatW, tailNorm, tailCutoffTau } = tbl;
  for (let i = 0; i < out.length; i++) {
    const b = burnoutAt[i];
    if (b === NEVER_ARRIVES) continue;
    const a = arrival[i];
    if (a >= t1) continue;
    let e = 0;
    // Flaming: uniform over [a, b).
    const lo = a > t0 ? a : t0;
    const hi = b < t1 ? b : t1;
    if (hi > lo) {
      const frac = (hi - lo) / (b - a);
      e += mFlame[i] * frac;
      heat += (heatW[i] * (hi - lo)) / dt;
      active++;
    }
    // Smoldering: tail after b, truncated at tailCutoffTau * tau.
    const tau = tauS[i];
    if (tau > 0 && t1 > b) {
      const end = tailCutoffTau * tau;
      let x0 = t0 - b;
      let x1 = t1 - b;
      if (x0 < 0) x0 = 0;
      if (x1 > end) x1 = end;
      if (x1 > x0) {
        const es = (mSmolder[i] / tailNorm) * (Math.exp(-x0 / tau) - Math.exp(-x1 / tau));
        e += es;
        smolder += es;
        if (smolderOut) smolderOut[i] += es;
      }
    }
    if (e > 0) {
      out[i] += e;
      total += e;
    }
  }
  return { total, smolder, heatW: heat, activeFlaming: active };
}
