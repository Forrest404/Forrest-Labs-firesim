/**
 * Smoke field model (src/app/smoke): pure, deterministic, Node-only. See DECISIONS.md D20.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FUELS, FuelClass, NEVER_ARRIVES, applyDrynessPreset, windTowardDeg } from '../src/contract';
import type { GridSpec, Scenario, Weather } from '../src/contract';
import { mulberry32 } from '../src/sim/prng';
import { simulate } from '../src/sim';
import {
  DEFAULT_SMOKE_PARAMS,
  SmokeTimeline,
  advect,
  briggsFinalRise,
  buildEmissionTables,
  buoyancyFlux,
  emissionBetween,
  makeScratch,
  stepField,
  windAtStep,
  windSpeedFactor,
} from '../src/app/smoke';
import type { SmokeInputs, SmokeParams } from '../src/app/smoke';
import { paintSmoke } from '../src/viewer/smokeCanvas';
import { paintBurn } from '../src/viewer/burnCanvas';

const W = 60;
const H = 60;
const CELL = 30;

function grid(w = W, h = H): GridSpec {
  return { width: w, height: h, cellSizeM: CELL, originLon: 8.3, originLat: 48.4, bounds: { west: 8.3, south: 48.38, east: 8.33, north: 48.4 } };
}

function inputs(over: Partial<SmokeInputs> = {}, weather: Partial<Weather> = {}): SmokeInputs {
  const g = over.grid ?? grid();
  const n = g.width * g.height;
  return {
    grid: g,
    fuel: new Uint8Array(n).fill(FuelClass.GRASS),
    elevation: new Float32Array(n),
    arrival: new Float32Array(n).fill(NEVER_ARRIVES),
    weather: { ...DEFAULT_WEATHER, windSpeedMps: 0, windVariabilityDeg: 0, ...weather },
    seed: 1,
    durationS: 6 * 3600,
    ...over,
  };
}

function params(over: Partial<SmokeParams> = {}): SmokeParams {
  return { ...DEFAULT_SMOKE_PARAMS, ...over };
}

const NO_TRANSPORT: Partial<SmokeParams> = { kBaseM2s: 0, kWindM2sPerMps: 0, kPlumeM2sPerKm: 0, lossTauS: 0 };

function puff(n: number, x: number, y: number, mass: number, w = W): Float32Array {
  const c = new Float32Array(n);
  c[y * w + x] = mass;
  return c;
}

function total(c: Float32Array): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s += c[i];
  return s;
}

function centroid(c: Float32Array, w = W): { x: number; y: number; varX: number; varY: number } {
  let m = 0, sx = 0, sy = 0;
  for (let i = 0; i < c.length; i++) {
    const v = c[i];
    if (!v) continue;
    const x = i % w, y = (i / w) | 0;
    m += v; sx += v * x; sy += v * y;
  }
  const cx = sx / m, cy = sy / m;
  let vx = 0, vy = 0;
  for (let i = 0; i < c.length; i++) {
    const v = c[i];
    if (!v) continue;
    const x = i % w, y = (i / w) | 0;
    vx += v * (x - cx) * (x - cx); vy += v * (y - cy) * (y - cy);
  }
  return { x: cx, y: cy, varX: vx / m, varY: vy / m };
}

/** Runs n lattice steps on a field with no emission (empty arrival). Returns the final field. */
function run(conc: Float32Array, n: number, p: SmokeParams, inp = inputs()): Float32Array {
  const tbl = buildEmissionTables(inp, p);
  const scratch = makeScratch(conc.length);
  let a: Float32Array = conc;
  let b: Float32Array = new Float32Array(conc.length);
  for (let k = 0; k < n; k++) {
    stepField(a, b, k, tbl, inp, p, scratch);
    [a, b] = [b, a];
  }
  return a;
}

describe('smoke transport', () => {
  it('conserves mass with no wind and no loss', () => {
    const n = W * H;
    const start = puff(n, 30, 30, 100);
    const end = run(start, 20, params({ lossTauS: 0 }));
    expect(Math.abs(total(end) - 100) / 100).toBeLessThan(1e-5);
  });

  it('moves a puff downwind by u * dt (east)', () => {
    const n = W * H;
    const end = run(puff(n, 15, 30, 10), 3, params(NO_TRANSPORT), inputs({}, { windSpeedMps: 5, windFromDeg: 270 }));
    const c = centroid(end);
    expect(Math.abs(c.x - 45)).toBeLessThan(0.05); // 5 m/s * 60 s * 3 / 30 m = 30 cells
    expect(Math.abs(c.y - 30)).toBeLessThan(0.05);
  });

  it('wind from the north moves smoke toward higher rows (south)', () => {
    const n = W * H;
    const end = run(puff(n, 30, 15, 10), 3, params(NO_TRANSPORT), inputs({}, { windSpeedMps: 5, windFromDeg: 0 }));
    const c = centroid(end);
    expect(Math.abs(c.y - 45)).toBeLessThan(0.05);
    expect(Math.abs(c.x - 30)).toBeLessThan(0.05);
  });

  it('diffuses symmetrically with the expected variance', () => {
    const n = W * H;
    const p = params({ kBaseM2s: 60, kWindM2sPerMps: 0, kPlumeM2sPerKm: 0, lossTauS: 0 });
    const end = run(puff(n, 30, 30, 100), 1, p);
    for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
      expect(Math.abs(end[y * W + x] - end[y * W + (60 - x)])).toBeLessThan(1e-6);
      expect(Math.abs(end[y * W + x] - end[(60 - y) * W + x])).toBeLessThan(1e-6);
    }
    const sigma2 = (2 * 60 * 60) / (CELL * CELL); // 8 cells^2
    const c = centroid(end);
    expect(Math.abs(c.varX - sigma2) / sigma2).toBeLessThan(0.1);
    expect(Math.abs(c.varY - sigma2) / sigma2).toBeLessThan(0.1);
  });

  it('advect with zero displacement is a copy', () => {
    const src = puff(W * H, 3, 4, 7);
    const dst = new Float32Array(W * H);
    advect(src, dst, W, H, 0, 0);
    expect(dst).toEqual(src);
  });
});

describe('smoke emission', () => {
  it('stops after burnout plus the smoldering tail and is step-size independent', () => {
    const inp = inputs();
    inp.arrival[0] = 0; // one grass cell ignites at t = 0
    const p = params();
    const tbl = buildEmissionTables(inp, p);
    const spec = FUELS[FuelClass.GRASS];
    const mFuel = spec.bed.loadKgM2 * CELL * CELL;
    const s = p.smolderFrac[FuelClass.GRASS];
    const expected = mFuel * (1 - s) * p.efFlameKgKg * 1.0 + mFuel * s * p.efSmolderKgKg; // intensity absent -> 0.5 + 0.5
    const out = new Float32Array(inp.arrival.length);
    let sum = 0;
    for (let t = 0; t < 3000; t += 60) {
      out.fill(0);
      const r = emissionBetween(tbl, t, t + 60, out);
      sum += r.total;
      if (t >= spec.burnDurationS + p.tailCutoffTau * p.smolderTauS[FuelClass.GRASS]) expect(r.total).toBe(0);
    }
    expect(Math.abs(sum - expected) / expected).toBeLessThan(1e-6);
    // Step-size independence over the flaming phase.
    out.fill(0);
    const one = emissionBetween(tbl, 0, spec.burnDurationS, out).total;
    let pieces = 0;
    for (let t = 0; t < spec.burnDurationS; t += 60) { out.fill(0); pieces += emissionBetween(tbl, t, t + 60, out).total; }
    expect(Math.abs(one - pieces) / one).toBeLessThan(1e-9);
  });

  it('builds per-fuel burnout and emits nothing for non-burnable or never-burned cells', () => {
    const inp = inputs();
    const classes = [FuelClass.NONE, FuelClass.GRASS, FuelClass.SHRUB, FuelClass.FOREST_DECIDUOUS, FuelClass.FOREST_CONIFER, FuelClass.FARMLAND];
    classes.forEach((f, i) => { inp.fuel[i] = f; inp.arrival[i] = 100; });
    inp.fuel[10] = FuelClass.FOREST_CONIFER; // never burns
    const tbl = buildEmissionTables(inp, params());
    classes.forEach((f, i) => {
      if (f === FuelClass.NONE) { expect(tbl.burnoutAt[i]).toBe(NEVER_ARRIVES); expect(tbl.mFlame[i]).toBe(0); }
      else expect(tbl.burnoutAt[i]).toBe(100 + FUELS[f].burnDurationS);
    });
    expect(tbl.burnoutAt[10]).toBe(NEVER_ARRIVES);
    const out = new Float32Array(inp.arrival.length);
    emissionBetween(tbl, 0, 1e6, out);
    expect(out[0]).toBe(0);
    expect(out[10]).toBe(0);
    expect(out[4]).toBeGreaterThan(out[1]); // conifer out-emits grass
  });
});

describe('plume and wind', () => {
  it('Briggs rise is monotone in buoyancy, decreasing in wind, clamped', () => {
    expect(briggsFinalRise(0, 5, 2500)).toBe(0);
    expect(briggsFinalRise(10, 5, 2500)).toBeLessThan(briggsFinalRise(100, 5, 2500));
    expect(briggsFinalRise(100, 5, 2500)).toBeLessThan(briggsFinalRise(1000, 5, 2500));
    expect(briggsFinalRise(1000, 10, 2500)).toBeLessThan(briggsFinalRise(1000, 2, 2500));
    expect(briggsFinalRise(1e9, 1, 2500)).toBe(2500);
    expect(briggsFinalRise(1e-6, 50, 2500)).toBe(30);
    expect(buoyancyFlux(1e6)).toBeCloseTo(8.8, 6);
  });

  it('wind speed factor is 1 at 10 m and capped', () => {
    const p = params();
    expect(windSpeedFactor(0, p)).toBe(1);
    expect(windSpeedFactor(10, p)).toBe(1);
    expect(windSpeedFactor(1e6, p)).toBe(p.speedFactorMax);
    expect(windSpeedFactor(500, p)).toBeGreaterThan(1);
  });

  it('meander is pure in k, absent at zero variability, and averages to the scenario direction', () => {
    const p = params();
    const base = { ...DEFAULT_WEATHER, windFromDeg: 240, windSpeedMps: 6, windVariabilityDeg: 0 };
    const a = windAtStep(base, 5, 7, p);
    expect(a).toEqual(windAtStep(base, 5, 7, p));
    const rad = (windTowardDeg(240) * Math.PI) / 180;
    expect(a.ux).toBeCloseTo(Math.sin(rad), 12);
    expect(a.uy).toBeCloseTo(Math.cos(rad), 12);
    const varied = { ...base, windVariabilityDeg: 25 };
    expect(windAtStep(varied, 5, 7, p)).toEqual(windAtStep(varied, 5, 7, p));
    let sx = 0, sy = 0;
    for (let k = 0; k < 600; k++) { const w = windAtStep(varied, 5, k, p); sx += w.ux; sy += w.uy; }
    const meanDeg = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(meanDeg - windTowardDeg(240))).toBeLessThan(2);
  });
});

/** A synthetic radial fire on a conifer grid: arrival = distance / 0.03 m/s within 20 cells. */
function fireInputs(weather: Partial<Weather> = {}): SmokeInputs {
  const inp = inputs({}, { windSpeedMps: 4, windFromDeg: 270, ...weather });
  inp.fuel.fill(FuelClass.FOREST_CONIFER);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - 30, y - 30) * CELL;
    if (d <= 20 * CELL) inp.arrival[y * W + x] = d / 0.03;
  }
  return inp;
}

describe('smoke timeline', () => {
  it('is deterministic with wind variability', () => {
    const a = new SmokeTimeline(fireInputs({ windVariabilityDeg: 25 }));
    const b = new SmokeTimeline(fireInputs({ windVariabilityDeg: 25 }));
    expect(a.advanceTo(6 * 3600, 1e9, 1e9)).toBe(true);
    expect(b.advanceTo(6 * 3600, 1e9, 1e9)).toBe(true);
    const sa = a.sampleAt(6 * 3600, new Float32Array(W * H));
    const sb = b.sampleAt(6 * 3600, new Float32Array(W * H));
    expect(total(sa.conc)).toBeGreaterThan(0);
    expect(sa.conc).toEqual(sb.conc);
    expect(sa.plumeTopM).toBe(sb.plumeTopM);
  });

  it('scrubbing back equals a fresh recompute', () => {
    const a = new SmokeTimeline(fireInputs({ windVariabilityDeg: 10 }));
    const b = new SmokeTimeline(fireInputs({ windVariabilityDeg: 10 }));
    expect(a.advanceTo(4 * 3600, 1e9, 1e9)).toBe(true);
    expect(a.advanceTo(5000, 1e9, 1e9)).toBe(true);
    expect(b.advanceTo(5000, 1e9, 1e9)).toBe(true);
    const sa = a.sampleAt(5000, new Float32Array(W * H));
    const sb = b.sampleAt(5000, new Float32Array(W * H));
    expect(sa.conc).toEqual(sb.conc);
    expect(sa.emission).toEqual(sb.emission);
    expect(sa.smolderFrac).toBe(sb.smolderFrac);
  });

  it('respects the step budget and reports when it is not caught up', () => {
    const tl = new SmokeTimeline(fireInputs());
    expect(tl.advanceTo(6 * 3600, 1e9, 3)).toBe(false);
    expect(tl.fieldT).toBe(3 * 60);
    expect(tl.advanceTo(6 * 3600, 1e9, 1e9)).toBe(true);
    expect(tl.fieldT).toBe(6 * 3600);
  });

  it('sampleAt interpolates half a step of advection between lattice points', () => {
    const p = params(NO_TRANSPORT);
    const inp = inputs({}, { windSpeedMps: 5, windFromDeg: 270 });
    const tl = new SmokeTimeline(inp, p);
    tl.seedConcentration(puff(W * H, 15, 30, 10));
    const c0 = centroid(tl.sampleAt(0, new Float32Array(W * H)).conc);
    const cHalf = centroid(tl.sampleAt(30, new Float32Array(W * H)).conc);
    tl.advanceTo(60, 1e9);
    const c1 = centroid(tl.sampleAt(60, new Float32Array(W * H)).conc);
    expect(Math.abs(c1.x - c0.x - 10)).toBeLessThan(0.05);
    expect(Math.abs(cHalf.x - (c0.x + c1.x) / 2)).toBeLessThan(0.1);
  });

  it('does not mutate state in sampleAt', () => {
    const tl = new SmokeTimeline(fireInputs());
    tl.advanceTo(3600, 1e9, 1e9);
    const a = tl.sampleAt(3600 + 45, new Float32Array(W * H)).conc;
    const b = tl.sampleAt(3600 + 45, new Float32Array(W * H)).conc;
    expect(a).toEqual(b);
  });
});

describe('painters', () => {
  it('paintSmoke: transparent at zero, monotone, capped, brown when smoldering', () => {
    const conc = new Float32Array([0, 0.01, 0.1, 1, 10, 1000]);
    const data = new Uint8ClampedArray(conc.length * 4);
    paintSmoke(data, conc, { cellAreaM2: 900, sigmaExtM2PerKg: 4000, maxAlpha: 0.8, smolderFrac: 0 });
    expect(data[3]).toBe(0);
    for (let i = 1; i < conc.length; i++) expect(data[i * 4 + 3]).toBeGreaterThanOrEqual(data[(i - 1) * 4 + 3]);
    expect(data[5 * 4 + 3]).toBe(Math.round(0.8 * 255));
    const brown = new Uint8ClampedArray(4);
    paintSmoke(brown, new Float32Array([1]), { cellAreaM2: 900, sigmaExtM2PerKg: 4000, maxAlpha: 0.8, smolderFrac: 1 });
    expect(brown[0]).toBeGreaterThan(brown[2]);
  });

  it('paintBurn uses per-fuel burnout when provided', () => {
    const arrival = new Float32Array([0, 0]);
    const burnoutAt = new Float32Array([300, 1800]);
    const data = new Uint8ClampedArray(8);
    paintBurn(data, arrival, 600, { flameWindowS: 900, burnoutAt });
    expect(data[0]).toBe(35); // grass-like cell: charred after 300 s
    expect(data[4]).toBe(255); // forest-like cell: still flaming at 600 s
    paintBurn(data, arrival, 600, { flameWindowS: 900 });
    expect(data[0]).toBe(255); // fallback window keeps both flaming
  });
});

function bigScenario(width: number, height: number): Scenario {
  const n = width * height;
  const rand = mulberry32(7);
  const fuel = new Uint8Array(n);
  const elevation = new Float32Array(n);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const i = r * width + c;
    const v = rand();
    fuel[i] = v < 0.45 ? FuelClass.FOREST_CONIFER : v < 0.8 ? FuelClass.GRASS : v < 0.95 ? FuelClass.SHRUB : FuelClass.NONE;
    elevation[i] = 200 + 60 * Math.sin(c / 17) + 40 * Math.cos(r / 23);
  }
  return {
    grid: { width, height, cellSizeM: 30, originLon: -122.2, originLat: 37.2, bounds: { west: -122.2, south: 37.15, east: -122.13, north: 37.2 } },
    fuel, elevation,
    weather: applyDrynessPreset({ ...DEFAULT_WEATHER, windSpeedMps: 8, windFromDeg: 240 }, 'extreme'),
    ignition: [{ row: height >> 1, col: width >> 1 }],
    interventions: [],
    durationSeconds: 24 * 3600,
    seed: 3,
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe('smoke performance', () => {
  it('steps a 200 x 200 field in well under 8 ms', () => {
    const sc = bigScenario(200, 200);
    const result = simulate(sc);
    const tl = new SmokeTimeline({ grid: sc.grid, fuel: sc.fuel, elevation: sc.elevation, arrival: result.arrivalTime, intensity: result.intensity, weather: sc.weather, seed: sc.seed, durationS: sc.durationSeconds });
    tl.advanceTo(5 * 60, 1e9, 1e9);
    const t0 = performance.now();
    tl.advanceTo(65 * 60, 1e9, 1e9);
    const perStep = (performance.now() - t0) / 60;
    console.log(`smoke step 200x200: ${perStep.toFixed(2)} ms`);
    expect(perStep).toBeLessThan(8);
  });
});
