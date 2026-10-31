/**
 * Ensemble runs: many simulations with perturbed wind, moisture, ignition position and seed, turned
 * into burn-probability statistics. One simulation takes ~20 ms, so 50-100 runs take a second or two.
 *
 * Reproducible: every perturbation of run k is a pure hash of (baseSeed, k, parameter), so the same
 * spec always gives the same ensemble, in any order and on any machine. Per-run results are not
 * kept: counts accumulate, so memory does not grow with the number of runs.
 */

import { ENSEMBLE_TIME_BINS, FuelClass, NEVER_ARRIVES, assertValidScenario, validateEnsembleSpec } from '../contract';
import type { EnsembleResult, EnsembleSpec, Scenario } from '../contract';
import { hash32, hashNormal, hashUnit } from './hash';
import { simulate } from './index';

/** Stream ids for the per-run hashes (kept distinct so parameters never share a draw). */
const S_WIND = 11;
const S_DIR = 12;
const S_MOIST = 13;
const S_IGN = 14;
const S_SEED = 15;

/** The scenario for run k: the original with its perturbations applied. Pure and deterministic. */
export function perturbScenario(base: Scenario, spec: EnsembleSpec, k: number): Scenario {
  const { baseSeed } = spec;
  const sSigma = spec.windSpeedRelSigma;
  // Mean-preserving lognormal factor on wind speed.
  const speedFactor = sSigma > 0 ? Math.exp(sSigma * hashNormal(baseSeed, k, 0, S_WIND) - (sSigma * sSigma) / 2) : 1;
  const dirOffset = spec.windDirSigmaDeg * hashNormal(baseSeed, k, 0, S_DIR);
  const moistOffset = spec.moistureSigma * hashNormal(baseSeed, k, 0, S_MOIST);

  const w = base.weather;
  const weather = {
    ...w,
    windSpeedMps: w.windSpeedMps * speedFactor,
    windFromDeg: (((w.windFromDeg + dirOffset) % 360) + 360) % 360,
    baseFuelMoisture: Math.min(0.9, Math.max(0.005, w.baseFuelMoisture + moistOffset)),
  };
  const weatherSchedule = base.weatherSchedule?.map((kf) => ({
    ...kf,
    windSpeedMps: kf.windSpeedMps === undefined ? undefined : kf.windSpeedMps * speedFactor,
    windFromDeg: kf.windFromDeg === undefined ? undefined : (((kf.windFromDeg + dirOffset) % 360) + 360) % 360,
  }));

  let ignition = base.ignition;
  if (spec.ignitionJitterCells > 0) {
    const { width, height } = base.grid;
    ignition = base.ignition.map((ig, n) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const ang = 2 * Math.PI * hashUnit(baseSeed, k, n * 64 + attempt, S_IGN);
        const rad = spec.ignitionJitterCells * Math.sqrt(hashUnit(baseSeed, k, n * 64 + attempt, S_IGN + 100));
        const row = Math.round(ig.row - rad * Math.cos(ang));
        const col = Math.round(ig.col + rad * Math.sin(ang));
        if (row < 0 || col < 0 || row >= height || col >= width) continue;
        if (base.fuel[row * width + col] === FuelClass.NONE) continue;
        return { row, col };
      }
      return ig; // nowhere burnable nearby: keep the original
    });
  }

  return {
    ...base,
    weather,
    weatherSchedule,
    ignition,
    seed: hash32(baseSeed, k, 0, S_SEED) & 0x7fffffff,
  };
}

export interface EnsembleHooks {
  /** Called after every run with the fraction done (0-1). */
  onProgress?: (fraction: number) => void;
  /** Checked before every run; return true to stop early (the partial result is discarded: returns null). */
  shouldCancel?: () => boolean;
}

/** Synchronous ensemble. For the UI use the worker version, which yields between runs so it can be cancelled. */
export function runEnsemble(base: Scenario, spec: EnsembleSpec, hooks: EnsembleHooks = {}): EnsembleResult | null {
  const acc = beginEnsemble(base, spec);
  for (let k = 0; k < spec.runs; k++) {
    if (hooks.shouldCancel?.()) return null;
    accumulateRun(acc, k);
    hooks.onProgress?.((k + 1) / spec.runs);
  }
  return finishEnsemble(acc);
}

// --- incremental API (lets the worker yield between runs) -------------------------------------

export interface EnsembleAccumulator {
  base: Scenario;
  spec: EnsembleSpec;
  n: number;
  counts: Uint16Array;
  burnedByBin: Uint16Array;
  sumArrival: Float64Array;
  earliest: Float32Array;
  areas: Float64Array;
  spotFires: number;
  startedAt: number;
}

export function beginEnsemble(base: Scenario, spec: EnsembleSpec): EnsembleAccumulator {
  assertValidScenario(base);
  const errors = validateEnsembleSpec(spec);
  if (errors.length > 0) throw new Error(`Invalid ensemble: ${errors.join('; ')}`);
  const n = base.grid.width * base.grid.height;
  return {
    base, spec, n,
    counts: new Uint16Array(n),
    burnedByBin: new Uint16Array(ENSEMBLE_TIME_BINS * n),
    sumArrival: new Float64Array(n),
    earliest: new Float32Array(n).fill(NEVER_ARRIVES),
    areas: new Float64Array(spec.runs),
    spotFires: 0,
    startedAt: now(),
  };
}

export function accumulateRun(acc: EnsembleAccumulator, k: number): void {
  const r = simulate(perturbScenario(acc.base, acc.spec, k));
  const { n } = acc;
  const dur = acc.base.durationSeconds;
  for (let i = 0; i < n; i++) {
    const a = r.arrivalTime[i];
    if (a === NEVER_ARRIVES) continue;
    acc.counts[i]++;
    acc.sumArrival[i] += a;
    if (a < acc.earliest[i]) acc.earliest[i] = a;
    // Slice b covers (b, b+1] * dur / bins; an arrival of exactly 0 belongs to the first slice.
    const bin = Math.min(ENSEMBLE_TIME_BINS - 1, Math.max(0, Math.ceil((a / dur) * ENSEMBLE_TIME_BINS) - 1));
    acc.burnedByBin[bin * n + i]++;
  }
  acc.areas[k] = r.stats.burnedAreaHa;
  acc.spotFires += r.stats.spotFires;
}

export function finishEnsemble(acc: EnsembleAccumulator): EnsembleResult {
  const { n, spec, base } = acc;
  const burnProbability = new Float32Array(n);
  const meanArrival = new Float32Array(n).fill(NEVER_ARRIVES);
  for (let i = 0; i < n; i++) {
    burnProbability[i] = acc.counts[i] / spec.runs;
    if (acc.counts[i] > 0) meanArrival[i] = acc.sumArrival[i] / acc.counts[i];
  }
  const sorted = Float64Array.from(acc.areas).sort();
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  let sum = 0;
  for (const a of acc.areas) sum += a;
  return {
    runs: spec.runs,
    width: base.grid.width,
    height: base.grid.height,
    durationSeconds: base.durationSeconds,
    burnProbability,
    burnedByBin: acc.burnedByBin,
    meanArrivalS: meanArrival,
    earliestArrivalS: acc.earliest,
    areasHa: acc.areas,
    area: { meanHa: sum / spec.runs, minHa: sorted[0], p10Ha: q(0.1), p50Ha: q(0.5), p90Ha: q(0.9), maxHa: sorted[sorted.length - 1] },
    meanSpotFires: acc.spotFires / spec.runs,
    runtimeMs: now() - acc.startedAt,
  };
}

/**
 * P(burned by time t) per cell, from the time slices. Exact at slice boundaries, and linear inside a
 * slice, so scrubbing the playback time animates a smooth growing probability.
 */
export function probabilityAt(result: EnsembleResult, tSeconds: number, out?: Float32Array): Float32Array {
  const n = result.width * result.height;
  const p = out ?? new Float32Array(n);
  const x = Math.min(ENSEMBLE_TIME_BINS, Math.max(0, (tSeconds / result.durationSeconds) * ENSEMBLE_TIME_BINS));
  const full = Math.floor(x);
  const frac = x - full;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let b = 0; b < full; b++) c += result.burnedByBin[b * n + i];
    if (full < ENSEMBLE_TIME_BINS) c += frac * result.burnedByBin[full * n + i];
    p[i] = c / result.runs;
  }
  return p;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
