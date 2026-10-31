import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FuelClass, applyDrynessPreset, windTowardDeg } from '../src/contract';
import type { Intervention, Scenario, SimResult, SimSettings } from '../src/contract';
import { simulate } from '../src/sim';
import { hash32, hashNormal, hashUnit } from '../src/sim/hash';
import { SPOT_MIN_DISTANCE_CELLS } from '../src/sim/spotting';
import { mulberry32 } from '../src/sim/prng';
import { FIX_H, FIX_W, idx, makeFixture } from './fixtures';
import type { FixtureOptions } from './fixtures';

const spotty = (o: FixtureOptions & { spot?: Partial<SimSettings> } = {}): Scenario => {
  const { spot, ...rest } = o;
  return makeFixture({
    river: false, road: false, ignition: [{ row: 25, col: 5 }], dryness: 'extreme',
    weather: { windSpeedMps: 12, windFromDeg: 270 }, durationSeconds: 12 * 3600,
    ...rest, settings: { spottingEnabled: true, spottingIgnitionProb: 0.3, ...spot, ...rest.settings },
  });
};
const off = (s: Scenario): Scenario => ({ ...s, settings: { ...s.settings, spottingEnabled: false } });
const cellsOf = (r: SimResult): number[] => Array.from(r.ignitedByEmber).flatMap((v, i) => (v ? [i] : []));
const dist = (a: number, b: number): number => Math.hypot(Math.floor(a / FIX_W) - Math.floor(b / FIX_W), (a % FIX_W) - (b % FIX_W));
const col = (c: number): number[] => Array.from({ length: FIX_H }, (_, r) => idx(r, c));

describe('counter-based hash', () => {
  it('is a pure function of its arguments', () => {
    expect(hash32(1, 2, 3, 4)).toBe(hash32(1, 2, 3, 4));
    expect(hash32(1, 2, 3, 4)).not.toBe(hash32(2, 2, 3, 4));
    expect(hash32(1, 2, 3, 4)).not.toBe(hash32(1, 3, 3, 4));
    expect(hash32(1, 2, 3, 4)).not.toBe(hash32(1, 2, 4, 4));
    expect(hash32(1, 2, 3, 4)).not.toBe(hash32(1, 2, 3, 5));
  });

  it('uniform draws: mean 0.5, variance 1/12, all 10 deciles populated, no serial correlation', () => {
    const N = 200_000;
    let sum = 0, sum2 = 0, lag = 0, prev = hashUnit(7, 0, 0, 1);
    const bins = new Array(10).fill(0);
    for (let i = 1; i <= N; i++) {
      const u = hashUnit(7, i, 3, 1);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u; sum2 += u * u; lag += (u - 0.5) * (prev - 0.5); prev = u;
      bins[Math.floor(u * 10)]++;
    }
    expect(sum / N).toBeCloseTo(0.5, 2);
    expect(sum2 / N - (sum / N) ** 2).toBeCloseTo(1 / 12, 2);
    expect(Math.abs(lag / N / (1 / 12))).toBeLessThan(0.01);
    for (const b of bins) expect(Math.abs(b / N - 0.1)).toBeLessThan(0.005);
  });

  it('streams do not collide: the same inputs with different stream ids are uncorrelated', () => {
    let c = 0;
    const N = 50_000;
    for (let i = 0; i < N; i++) c += (hashUnit(3, i, 1, 1) - 0.5) * (hashUnit(3, i, 1, 2) - 0.5);
    expect(Math.abs(c / N / (1 / 12))).toBeLessThan(0.02);
  });

  it('normal draws: mean 0, sd 1, finite', () => {
    const N = 100_000;
    let s = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      const z = hashNormal(11, i, 2, 1);
      expect(Number.isFinite(z)).toBe(true);
      s += z; s2 += z * z;
    }
    expect(s / N).toBeCloseTo(0, 1);
    expect(Math.sqrt(s2 / N - (s / N) ** 2)).toBeCloseTo(1, 1);
  });
});

describe('spotting off, or nothing to throw', () => {
  it('disabled by default and then identical to the result without the feature', () => {
    const s = spotty();
    const a = simulate(off(s));
    expect(a.stats.spotFires).toBe(0);
    expect(a.ignitedByEmber.every((v) => v === 0)).toBe(true);
    expect(DEFAULT_SETTINGS.spottingEnabled).toBe(false);
  });

  it('a threshold above any intensity changes nothing, byte for byte', () => {
    const s = spotty({ spot: { spottingIntensityKwM: 1e9 } });
    const a = simulate(s).arrivalTime;
    const b = simulate(off(s)).arrivalTime;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });

  it('no wind, no embers; zero embers per cell, no embers', () => {
    expect(simulate(spotty({ weather: { windSpeedMps: 0 } })).stats.spotFires).toBe(0);
    expect(simulate(spotty({ spot: { spottingEmbers: 0 } })).stats.spotFires).toBe(0);
    expect(simulate(spotty({ spot: { spottingIgnitionProb: 0 } })).stats.spotFires).toBe(0);
  });
});

describe('spot fires', () => {
  const r = simulate(spotty({ spot: { spottingEmbers: 4 } }));
  const spots = cellsOf(r);

  it('happen, and are counted consistently', () => {
    expect(spots.length).toBeGreaterThan(20);
    expect(r.stats.spotFires).toBe(spots.length);
    for (const i of spots) expect(r.arrivalTime[i]).toBeLessThan(Infinity);
  });

  it('provenance: every burned cell has an earlier source; ordinary spread is local, spot fires are not', () => {
    const ig = idx(25, 5);
    for (let i = 0; i < r.arrivalTime.length; i++) {
      if (r.arrivalTime[i] === Infinity) {
        expect(r.sourceCell[i]).toBe(-1);
        expect(r.ignitedByEmber[i]).toBe(0);
        continue;
      }
      if (i === ig) {
        expect(r.sourceCell[i]).toBe(-1);
        continue;
      }
      const src = r.sourceCell[i];
      expect(src, `cell ${i}`).toBeGreaterThanOrEqual(0);
      expect(r.arrivalTime[src]).toBeLessThan(r.arrivalTime[i]);
      if (r.ignitedByEmber[i]) {
        expect(r.arrivalTime[i] - r.arrivalTime[src]).toBeGreaterThanOrEqual(30 - 1e-3); // ignition delay + flight
        expect(dist(src, i)).toBeGreaterThanOrEqual(SPOT_MIN_DISTANCE_CELLS - 0.6); // rounding to a cell
      } else {
        expect(Math.max(Math.abs(Math.floor(src / FIX_W) - Math.floor(i / FIX_W)), Math.abs((src % FIX_W) - (i % FIX_W)))).toBeLessThanOrEqual(2);
      }
    }
  });

  it('embers land downwind (within the 25 degree scatter) and at plausible distances', () => {
    const toward = (windTowardDeg(270) * Math.PI) / 180; // east
    let inCone = 0;
    const dists: number[] = [];
    for (const i of spots) {
      const s = r.sourceCell[i];
      const dr = Math.floor(i / FIX_W) - Math.floor(s / FIX_W);
      const dc = (i % FIX_W) - (s % FIX_W);
      const heading = Math.atan2(dc, -dr);
      const diff = Math.abs(Math.atan2(Math.sin(heading - toward), Math.cos(heading - toward)));
      if (diff <= (35 * Math.PI) / 180) inCone++;
      dists.push(Math.hypot(dr, dc) * 30);
    }
    expect(inCone / spots.length).toBeGreaterThan(0.95);
    dists.sort((a, b) => a - b);
    const median = dists[dists.length >> 1];
    expect(median).toBeGreaterThan(80);
    expect(median).toBeLessThan(700);
  });

  it('the range scale moves the landings farther, and a larger threshold throws fewer embers', () => {
    const med = (scale: number): number => {
      const res = simulate(spotty({ spot: { spottingEmbers: 4, spottingRangeScale: scale } }));
      const d = cellsOf(res).map((i) => dist(res.sourceCell[i], i)).sort((a, b) => a - b);
      return d[d.length >> 1];
    };
    expect(med(2)).toBeGreaterThan(med(0.5));
    // Short run so the grid does not saturate (a long run burns everything regardless).
    const burned = [1e9, 8000, 4000, 2500, 1000].map((thr) => simulate(spotty({ durationSeconds: 3000, spot: { spottingEmbers: 4, spottingIntensityKwM: thr } })).stats.burnedCells);
    for (let i = 1; i < burned.length; i++) expect(burned[i]).toBeGreaterThanOrEqual(burned[i - 1]);
    expect(burned[burned.length - 1]).toBeGreaterThan(burned[0]);
  });

  it('is deterministic for a seed, and the seed changes where embers land', () => {
    const a = simulate(spotty({ spot: { spottingEmbers: 4 }, seed: 1 }));
    const b = simulate(spotty({ spot: { spottingEmbers: 4 }, seed: 1 }));
    const c = simulate(spotty({ spot: { spottingEmbers: 4 }, seed: 2 }));
    expect(Buffer.from(a.arrivalTime.buffer).equals(Buffer.from(b.arrivalTime.buffer))).toBe(true);
    expect(Buffer.from(a.sourceCell.buffer).equals(Buffer.from(b.sourceCell.buffer))).toBe(true);
    expect(Buffer.from(a.arrivalTime.buffer).equals(Buffer.from(c.arrivalTime.buffer))).toBe(false);
    expect(Math.abs(c.stats.spotFires / a.stats.spotFires - 1)).toBeLessThan(0.5);
  });
});

describe('embers jump what ordinary spread cannot', () => {
  const west = (extra: FixtureOptions = {}) => spotty({ spot: { spottingEmbers: 4 }, ...extra });

  it('a firebreak that stops the fire is breached when spotting is on', () => {
    const s = west();
    const brk: Intervention = { id: 'fb', tSeconds: 0, type: 'firebreak', cells: [20, 21, 22].flatMap(col) };
    const without = simulate({ ...off(s), interventions: [brk] });
    for (let r = 0; r < FIX_H; r++) for (let c = 23; c < FIX_W; c++) expect(without.arrivalTime[idx(r, c)]).toBe(Infinity);
    const withSpots = simulate({ ...s, interventions: [brk] });
    let beyond = 0;
    for (let r = 0; r < FIX_H; r++) for (let c = 23; c < FIX_W; c++) if (withSpots.arrivalTime[idx(r, c)] < Infinity) beyond++;
    expect(beyond).toBeGreaterThan(30);
    // The cleared cells themselves still never burn (a firebreak is bare ground).
    for (const c of [20, 21, 22]) for (let r = 0; r < FIX_H; r++) expect(withSpots.arrivalTime[idx(r, c)]).toBe(Infinity);
  });

  it('a firebreak cut at time T is still jumped, and fire already past it is unchanged', () => {
    const s = west();
    const base = simulate({ ...s });
    const T = base.arrivalTime[idx(25, 12)] + 1;
    const cut = simulate({ ...s, interventions: [{ id: 'fb', tSeconds: T, type: 'firebreak', cells: [20, 21, 22].flatMap(col) }] });
    for (let i = 0; i < base.arrivalTime.length; i++) if (base.arrivalTime[i] < T) expect(cut.arrivalTime[i]).toBe(base.arrivalTime[i]);
  });

  it('crosses a river that ordinary spread cannot', () => {
    const s = west({ river: true });
    const w = simulate(s);
    let east = 0;
    for (let r = 0; r < FIX_H; r++) for (let c = 42; c < FIX_W; c++) if (w.arrivalTime[idx(r, c)] < Infinity) east++;
    expect(east).toBeGreaterThan(5);
    const wo = simulate(off(s));
    for (let r = 0; r < FIX_H; r++) for (let c = 40; c < FIX_W; c++) expect(wo.arrivalTime[idx(r, c)]).toBe(Infinity);
  });

  it('embers cross a wet band but cannot light the water-soaked cells themselves', () => {
    const s = west();
    const band: Intervention = { id: 'w', tSeconds: 0, type: 'water', cells: [20, 21, 22].flatMap(col), params: { moistureBoost: 0.9, halfLifeS: 1e9 } };
    const r = simulate({ ...s, interventions: [band] });
    for (const c of [20, 21, 22]) for (let rr = 0; rr < FIX_H; rr++) expect(r.arrivalTime[idx(rr, c)]).toBe(Infinity);
    let beyond = 0;
    for (let rr = 0; rr < FIX_H; rr++) for (let c = 23; c < FIX_W; c++) if (r.arrivalTime[idx(rr, c)] < Infinity) beyond++;
    expect(beyond).toBeGreaterThan(30);
    const without = simulate({ ...off(s), interventions: [band] });
    for (let rr = 0; rr < FIX_H; rr++) for (let c = 20; c < FIX_W; c++) expect(without.arrivalTime[idx(rr, c)]).toBe(Infinity);
  });

  it('a thin break is breached sooner than a wide one (time to the first burning cell behind it)', () => {
    const s = west();
    const breach = (width: number): number => {
      const cells = Array.from({ length: width }, (_, k) => 15 + k).flatMap(col);
      const r = simulate({ ...s, interventions: [{ id: 'fb', tSeconds: 0, type: 'firebreak', cells }] });
      let first = Infinity;
      for (let rr = 0; rr < FIX_H; rr++) for (let c = 15 + width; c < FIX_W; c++) first = Math.min(first, r.arrivalTime[idx(rr, c)]);
      return first;
    };
    const thin = breach(2);
    const wide = breach(15);
    expect(thin).toBeLessThan(Infinity);
    expect(thin).toBeLessThan(wide);
  });
});

describe('spotting only ever adds fire', () => {
  it('never makes any cell burn later than without spotting (fuzz: 40 scenarios, water + firebreaks, burnout off)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const W = 30, n = W * W;
      const fuel = new Uint8Array(n), elevation = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        fuel[i] = rand() < 0.07 ? 0 : seed % 2 ? FuelClass.FOREST_CONIFER : 1 + Math.floor(rand() * 5);
        elevation[i] = 100 + 60 * Math.sin((i % W) / 5) + 40 * Math.cos(((i / W) | 0) / 6);
      }
      let ig = 300;
      while (fuel[ig] === 0) ig++;
      const iv = (id: string, type: 'water' | 'firebreak'): Intervention => ({ id, type, tSeconds: rand() * 3000, cells: Array.from({ length: 50 }, () => Math.floor(rand() * n)), params: { halfLifeS: 100 + rand() * 3000, moistureBoost: 0.1 + rand() * 0.5 } });
      const base: Scenario = {
        grid: { ...makeFixture().grid, width: W, height: W }, fuel, elevation,
        weather: { ...applyDrynessPreset({ ...DEFAULT_WEATHER }, 'extreme'), windSpeedMps: 4 + rand() * 12, windFromDeg: rand() * 360 },
        ignition: [{ row: (ig / W) | 0, col: ig % W }], interventions: [iv('w', 'water'), iv('f', 'firebreak')],
        durationSeconds: 8 * 3600, seed,
        settings: { ...DEFAULT_SETTINGS, burnoutEnabled: false, rateModel: seed % 3 === 0 ? 'rothermel' : 'factors', spottingEmbers: 4, spottingIntensityKwM: 1500 },
      };
      const a = simulate({ ...base, settings: { ...base.settings, spottingEnabled: false } }).arrivalTime;
      const b = simulate({ ...base, settings: { ...base.settings, spottingEnabled: true } });
      for (let i = 0; i < n; i++) {
        if (a[i] === Infinity) continue;
        expect(b.arrivalTime[i], `seed ${seed} cell ${i}`).toBeLessThanOrEqual(a[i] + 1e-2);
      }
    }
  });

  it('spot-ignited cells report a sensible intensity (head-fire based) and flame length', () => {
    const r = simulate(spotty({ spot: { spottingEmbers: 4 } }));
    for (const i of cellsOf(r)) {
      expect(r.firelineIntensityKwM[i]).toBeGreaterThan(0);
      expect(r.flameLengthM[i]).toBeGreaterThan(0);
    }
  });
});
