import { describe, expect, it } from 'vitest';
import { DEFAULT_ENSEMBLE_SPEC, ENSEMBLE_TIME_BINS, FuelClass, validateEnsembleSpec } from '../src/contract';
import type { EnsembleSpec, Intervention, Scenario } from '../src/contract';
import { simulate } from '../src/sim';
import { accumulateRun, beginEnsemble, finishEnsemble, perturbScenario, probabilityAt, runEnsemble } from '../src/sim/ensemble';
import { FIX_H, FIX_W, idx, makeFixture } from './fixtures';
import type { FixtureOptions } from './fixtures';

const base = (o: FixtureOptions = {}): Scenario => makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 20 }], fuelClass: FuelClass.GRASS, dryness: 'high', weather: { windSpeedMps: 6, windFromDeg: 270 }, durationSeconds: 3 * 3600, ...o });
const spec = (o: Partial<EnsembleSpec> = {}): EnsembleSpec => ({ ...DEFAULT_ENSEMBLE_SPEC, runs: 30, baseSeed: 7, ...o });
const NONE: Partial<EnsembleSpec> = { windSpeedRelSigma: 0, windDirSigmaDeg: 0, moistureSigma: 0, ignitionJitterCells: 0 };

describe('perturbations', () => {
  it('are a pure function of (spec, run): same input, same scenario, in any order', () => {
    const b = base();
    const s = spec();
    const a1 = perturbScenario(b, s, 5);
    const a2 = perturbScenario(b, s, 5);
    perturbScenario(b, s, 9);
    expect(a1.weather).toEqual(a2.weather);
    expect(a1.seed).toBe(a2.seed);
    expect(perturbScenario(b, spec({ baseSeed: 8 }), 5).weather).not.toEqual(a1.weather);
    expect(a1.fuel).toBe(b.fuel); // shared, not copied
  });

  it('have the intended statistics: wind factor mean 1 (mean-preserving), direction offset sd = sigma, moisture offset sd = sigma', () => {
    const b = base();
    const s = spec({ windSpeedRelSigma: 0.25, windDirSigmaDeg: 15, moistureSigma: 0.02 });
    const N = 30000;
    let f = 0, f2 = 0, d = 0, d2 = 0, m = 0, m2 = 0;
    for (let k = 0; k < N; k++) {
      const p = perturbScenario(b, s, k).weather;
      const fac = p.windSpeedMps / b.weather.windSpeedMps;
      f += fac; f2 += fac * fac;
      const dir = ((p.windFromDeg - b.weather.windFromDeg + 540) % 360) - 180;
      d += dir; d2 += dir * dir;
      const mo = p.baseFuelMoisture - b.weather.baseFuelMoisture;
      m += mo; m2 += mo * mo;
    }
    // Standard error of the mean is 0.25/sqrt(30000) = 0.0014; without the mean-preserving correction the mean is 1.032.
    expect(Math.abs(f / N - 1)).toBeLessThan(0.006);
    expect(Math.sqrt(f2 / N - (f / N) ** 2)).toBeCloseTo(0.25, 1);
    expect(d / N).toBeCloseTo(0, 0);
    expect(Math.sqrt(d2 / N - (d / N) ** 2)).toBeCloseTo(15, 0);
    expect(Math.abs(m / N)).toBeLessThan(0.002);
    expect(Math.sqrt(m2 / N - (m / N) ** 2)).toBeCloseTo(0.02, 2);
  });

  it('zero sigma leaves the weather untouched; the scenario seed still differs per run', () => {
    const b = base();
    const p = perturbScenario(b, spec(NONE), 3);
    expect(p.weather).toEqual(b.weather);
    expect(p.ignition).toEqual(b.ignition);
    const seeds = new Set(Array.from({ length: 200 }, (_, k) => perturbScenario(b, spec(NONE), k).seed));
    expect(seeds.size).toBeGreaterThan(195);
    for (const sd of seeds) expect(Number.isInteger(sd) && sd >= 0).toBe(true);
  });

  it('weather keyframes get the same speed factor and direction offset as the starting weather', () => {
    const b: Scenario = { ...base(), weatherSchedule: [{ tSeconds: 1000, windSpeedMps: 12, windFromDeg: 300, relativeHumidity: 0.3 }, { tSeconds: 5000, temperatureC: 30 }] };
    const p = perturbScenario(b, spec({ windSpeedRelSigma: 0.3, windDirSigmaDeg: 20 }), 4);
    const factor = p.weather.windSpeedMps / b.weather.windSpeedMps;
    expect(p.weatherSchedule![0].windSpeedMps!).toBeCloseTo(12 * factor, 9);
    const off = (((p.weather.windFromDeg - b.weather.windFromDeg + 540) % 360) - 180);
    expect((((p.weatherSchedule![0].windFromDeg! - 300 + 540) % 360) - 180)).toBeCloseTo(off, 9);
    expect(p.weatherSchedule![0].relativeHumidity).toBe(0.3);
    expect(p.weatherSchedule![1].windSpeedMps).toBeUndefined();
    expect(p.weatherSchedule![1].temperatureC).toBe(30);
  });

  it('ignition jitter stays within the radius and on burnable ground, and is off by default', () => {
    const b = base();
    for (const [r, c] of [[0, 0], [10, 3]]) { b.fuel[r * FIX_W + c] = FuelClass.NONE; }
    const s = spec({ ignitionJitterCells: 4 });
    const seen = new Set<string>();
    for (let k = 0; k < 400; k++) {
      const ig = perturbScenario(b, s, k).ignition[0];
      expect(Math.hypot(ig.row - 25, ig.col - 20)).toBeLessThanOrEqual(4.6);
      expect(b.fuel[ig.row * FIX_W + ig.col]).not.toBe(FuelClass.NONE);
      seen.add(`${ig.row},${ig.col}`);
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(perturbScenario(b, spec(), 1).ignition).toEqual(b.ignition);
  });

  it('ignition jitter falls back to the original cell when nothing burnable is nearby', () => {
    const b = base();
    for (let r = 0; r < FIX_H; r++) for (let c = 0; c < FIX_W; c++) b.fuel[r * FIX_W + c] = FuelClass.NONE;
    b.fuel[25 * FIX_W + 20] = FuelClass.GRASS;
    for (let k = 0; k < 20; k++) expect(perturbScenario(b, spec({ ignitionJitterCells: 5 }), k).ignition[0]).toEqual({ row: 25, col: 20 });
  });
});

describe('ensemble statistics', () => {
  it('with no perturbation every run is the deterministic run: probabilities are 0 or 1 and equal the burned set', () => {
    const b = base();
    const det = simulate(b);
    const e = runEnsemble(b, spec({ ...NONE, runs: 6 }))!;
    for (let i = 0; i < det.arrivalTime.length; i++) {
      expect(e.burnProbability[i]).toBe(det.arrivalTime[i] === Infinity ? 0 : 1);
      expect(e.meanArrivalS[i]).toBeCloseTo(det.arrivalTime[i], 3);
      expect(e.earliestArrivalS[i]).toBe(det.arrivalTime[i]);
    }
    for (const a of e.areasHa) expect(a).toBeCloseTo(det.stats.burnedAreaHa, 9);
    expect(e.area.p10Ha).toBeCloseTo(e.area.p90Ha, 9);
  });

  it('is reproducible and independent of the order the runs are made in', () => {
    const b = base();
    const s = spec({ runs: 12, ignitionJitterCells: 2 });
    const a = runEnsemble(b, s)!;
    const c = runEnsemble(b, s)!;
    expect(Buffer.from(a.burnProbability.buffer).equals(Buffer.from(c.burnProbability.buffer))).toBe(true);
    const acc = beginEnsemble(b, s);
    for (let k = s.runs - 1; k >= 0; k--) accumulateRun(acc, k); // backwards
    const rev = finishEnsemble(acc);
    expect(Buffer.from(rev.burnProbability.buffer).equals(Buffer.from(a.burnProbability.buffer))).toBe(true);
    expect(Buffer.from(rev.burnedByBin.buffer).equals(Buffer.from(a.burnedByBin.buffer))).toBe(true);
    expect(rev.area.meanHa).toBeCloseTo(a.area.meanHa, 9);
    const d = runEnsemble(b, spec({ runs: 12, ignitionJitterCells: 2, baseSeed: 99 }))!;
    expect(Buffer.from(d.burnProbability.buffer).equals(Buffer.from(a.burnProbability.buffer))).toBe(false);
  });

  it('probabilities are valid: in [0,1], multiples of 1/runs, 1 at the ignition, and the time slices add up', () => {
    const b = base();
    const s = spec({ runs: 40 });
    const e = runEnsemble(b, s)!;
    const n = FIX_W * FIX_H;
    for (let i = 0; i < n; i++) {
      const p = e.burnProbability[i];
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(Math.abs(p * s.runs - Math.round(p * s.runs))).toBeLessThan(1e-4);
      let sum = 0;
      for (let bin = 0; bin < ENSEMBLE_TIME_BINS; bin++) sum += e.burnedByBin[bin * n + i];
      expect(sum).toBe(Math.round(p * s.runs));
    }
    expect(e.burnProbability[idx(25, 20)]).toBe(1);
    expect(e.runs).toBe(40);
  });

  it('probabilityAt: 0 at the start, equals the final map at the end, never decreases, exact at slice boundaries', () => {
    const e = runEnsemble(base(), spec({ runs: 30 }))!;
    const n = FIX_W * FIX_H;
    const end = probabilityAt(e, e.durationSeconds);
    for (let i = 0; i < n; i++) expect(end[i]).toBeCloseTo(e.burnProbability[i], 6);
    const start = probabilityAt(e, 0);
    expect(Math.max(...start)).toBe(0);
    let prev: Float32Array = new Float32Array(n);
    for (let t = 0; t <= e.durationSeconds; t += e.durationSeconds / 97) {
      const p = probabilityAt(e, t);
      for (let i = 0; i < n; i++) expect(p[i] + 1e-6).toBeGreaterThanOrEqual(prev[i]);
      prev = p;
    }
    // Beyond the run, it stays at the final map.
    expect(probabilityAt(e, e.durationSeconds * 2)[idx(25, 30)]).toBeCloseTo(e.burnProbability[idx(25, 30)], 6);
    // Exact at EVERY slice boundary, for EVERY cell: compare with direct counts from the individual runs.
    const sp = spec({ runs: 30 });
    const arrivals = Array.from({ length: sp.runs }, (_, k) => simulate(perturbScenario(base(), sp, k)).arrivalTime);
    for (let j = 0; j <= ENSEMBLE_TIME_BINS; j++) {
      const t = (e.durationSeconds * j) / ENSEMBLE_TIME_BINS;
      const p = probabilityAt(e, t);
      for (let i = 0; i < n; i++) {
        let direct = 0;
        for (const a of arrivals) if (a[i] <= t && !(j === 0 && a[i] > 0)) direct++;
        // At t = 0 the interpolation starts from nothing, so only the ignition cells (arrival 0) differ.
        if (j === 0) continue;
        expect(p[i], `boundary ${j} cell ${i}`).toBeCloseTo(direct / sp.runs, 6);
      }
    }
    // Between boundaries it interpolates linearly: halfway through a slice is halfway between its ends.
    const a = probabilityAt(e, (e.durationSeconds * 7) / ENSEMBLE_TIME_BINS);
    const bb = probabilityAt(e, (e.durationSeconds * 8) / ENSEMBLE_TIME_BINS);
    const mid = probabilityAt(e, (e.durationSeconds * 7.5) / ENSEMBLE_TIME_BINS);
    for (let i = 0; i < n; i++) expect(mid[i]).toBeCloseTo((a[i] + bb[i]) / 2, 6);
  });

  it('area summary: quantiles are ordered, the mean matches the runs, and each run matches a direct simulation', () => {
    const b = base();
    const s = spec({ runs: 25 });
    const e = runEnsemble(b, s)!;
    expect(e.area.minHa).toBeLessThanOrEqual(e.area.p10Ha);
    expect(e.area.p10Ha).toBeLessThanOrEqual(e.area.p50Ha);
    expect(e.area.p50Ha).toBeLessThanOrEqual(e.area.p90Ha);
    expect(e.area.p90Ha).toBeLessThanOrEqual(e.area.maxHa);
    expect(e.area.maxHa).toBeGreaterThan(e.area.minHa); // the perturbations matter
    let sum = 0;
    for (let k = 0; k < s.runs; k++) {
      const direct = simulate(perturbScenario(b, s, k)).stats.burnedAreaHa;
      expect(e.areasHa[k]).toBeCloseTo(direct, 5);
      sum += direct;
    }
    expect(e.area.meanHa).toBeCloseTo(sum / s.runs, 5);
  });

  it('more wind uncertainty means a wider spread of outcomes; more direction uncertainty spreads the fire sideways', () => {
    const b = base();
    const sd = (o: Partial<EnsembleSpec>): number => {
      const a = runEnsemble(b, spec({ ...NONE, runs: 60, ...o }))!.areasHa;
      const mean = a.reduce((x, y) => x + y, 0) / a.length;
      return Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
    };
    expect(sd({ windSpeedRelSigma: 0.4 })).toBeGreaterThan(sd({ windSpeedRelSigma: 0.1 }));
    expect(sd({ windSpeedRelSigma: 0 })).toBeLessThan(1e-9); // identical runs: no spread (up to rounding)
    const narrow = runEnsemble(b, spec({ ...NONE, runs: 60 }))!;
    const wide = runEnsemble(b, spec({ ...NONE, runs: 60, windDirSigmaDeg: 35 }))!;
    // A flank cell just outside the deterministic fire: unreachable without direction uncertainty,
    // reachable in some runs with it.
    const det = simulate(b).arrivalTime;
    let flank = -1;
    for (let r = 24; r >= 0; r--) if (det[idx(r, 30)] === Infinity) { flank = idx(r + 0, 30); break; }
    expect(flank).toBeGreaterThan(0);
    expect(narrow.burnProbability[flank]).toBe(0);
    expect(wide.burnProbability[flank]).toBeGreaterThan(0);
    expect(wide.burnProbability[flank]).toBeLessThan(1);
  });

  it('along the downwind axis the chance of burning never rises with distance (homogeneous ground, no spotting)', () => {
    const e = runEnsemble(base({ durationSeconds: 2400 }), spec({ runs: 60 }))!; // short enough that the far end is not always reached
    let prev = 1;
    for (let c = 20; c < FIX_W; c++) {
      const p = e.burnProbability[idx(25, c)];
      expect(p).toBeLessThanOrEqual(prev + 1e-9);
      prev = p;
    }
    expect(e.burnProbability[idx(25, 24)]).toBeGreaterThan(e.burnProbability[idx(25, 46)]);
    expect(e.burnProbability[idx(25, 24)]).toBe(1);
  });

  it('interventions are part of every run: a firebreak makes everything behind it unreachable, a wet band lowers the mean area', () => {
    const b = base();
    const brk: Intervention = { id: 'fb', tSeconds: 0, type: 'firebreak', cells: Array.from({ length: FIX_H }, (_, r) => idx(r, 32)) };
    const withBreak = runEnsemble({ ...b, interventions: [brk] }, spec({ runs: 30 }))!;
    for (let r = 0; r < FIX_H; r++) for (let c = 32; c < FIX_W; c++) expect(withBreak.burnProbability[idx(r, c)]).toBe(0);
    const open = runEnsemble(b, spec({ runs: 30 }))!;
    expect(withBreak.area.meanHa).toBeLessThan(open.area.meanHa);
    // With spotting the same break is jumped in some runs: the probability behind it is no longer zero.
    const sp = makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 5 }], dryness: 'extreme', weather: { windSpeedMps: 12, windFromDeg: 270 }, durationSeconds: 6 * 3600, settings: { spottingEnabled: true, spottingIgnitionProb: 0.3, spottingEmbers: 4 } });
    const brk2: Intervention = { id: 'fb', tSeconds: 0, type: 'firebreak', cells: [20, 21, 22].flatMap((c) => Array.from({ length: FIX_H }, (_, r) => idx(r, c))) };
    const jumped = runEnsemble({ ...sp, interventions: [brk2] }, spec({ runs: 20 }))!;
    let behind = 0;
    for (let r = 0; r < FIX_H; r++) for (let c = 23; c < FIX_W; c++) behind = Math.max(behind, jumped.burnProbability[idx(r, c)]);
    expect(behind).toBeGreaterThan(0);
    expect(jumped.meanSpotFires).toBeGreaterThan(0);
  });

  it('works with a weather schedule', () => {
    const b: Scenario = { ...base(), weatherSchedule: [{ tSeconds: 1800, windFromDeg: 0 }, { tSeconds: 2400, windFromDeg: 0 }] };
    const e = runEnsemble(b, spec({ runs: 15 }))!;
    expect(e.area.meanHa).toBeGreaterThan(0);
    expect(e.burnProbability[idx(40, 20)]).toBeGreaterThan(0); // the shift pushes fire south
  });
});

describe('control', () => {
  it('reports progress up to 1 and can be cancelled between runs', () => {
    const fr: number[] = [];
    const e = runEnsemble(base(), spec({ runs: 8 }), { onProgress: (f) => fr.push(f) })!;
    expect(fr.length).toBe(8);
    expect(fr[7]).toBe(1);
    for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThan(fr[i - 1]);
    expect(e.runs).toBe(8);
    let calls = 0;
    expect(runEnsemble(base(), spec({ runs: 50 }), { shouldCancel: () => ++calls > 3 })).toBeNull();
    expect(calls).toBe(4);
  });

  it('rejects an invalid spec or scenario', () => {
    expect(validateEnsembleSpec(spec())).toEqual([]);
    for (const bad of [{ runs: 0 }, { runs: 501 }, { runs: 2.5 }, { windSpeedRelSigma: -1 }, { windDirSigmaDeg: 400 }, { moistureSigma: 1 }, { ignitionJitterCells: -2 }, { baseSeed: 1.5 }]) {
      expect(validateEnsembleSpec(spec(bad)).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    expect(() => runEnsemble(base(), spec({ runs: 0 }))).toThrow(/Invalid ensemble/);
    const broken = base();
    broken.ignition = [{ row: 99, col: 0 }];
    expect(() => runEnsemble(broken, spec())).toThrow(/Invalid scenario/);
  });
});
