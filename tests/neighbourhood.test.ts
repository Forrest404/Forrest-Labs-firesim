import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FuelClass, applyDrynessPreset, validateScenario } from '../src/contract';
import type { Intervention, Scenario } from '../src/contract';
import { simulate } from '../src/sim';
import { ALL_MOVES, KING_MOVES, NEIGHBOR_OFFSETS } from '../src/sim/rates';
import { mulberry32 } from '../src/sim/prng';
import { FIX_H, FIX_W, idx, makeFixture } from './fixtures';

const iso = (neighbourhood: 8 | 16, extra: object = {}) =>
  makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 25 }], fuelClass: FuelClass.GRASS, weather: { windSpeedMps: 0 }, settings: { rateModel: 'iso', isoSpeedMps: 0.2, neighbourhood, ...extra }, durationSeconds: 48 * 3600 });

/** Worst relative error of arrival time versus straight-line distance / speed, over many directions. */
function worstAnisotropy(s: Scenario): number {
  const a = simulate(s).arrivalTime;
  const speed = s.settings.isoSpeedMps;
  let worst = 0;
  for (let deg = 0; deg < 360; deg += 3) {
    const rad = (deg * Math.PI) / 180;
    for (const dist of [8, 14, 22]) {
      const r = Math.round(25 - dist * Math.cos(rad));
      const c = Math.round(25 + dist * Math.sin(rad));
      if (r < 0 || c < 0 || r >= FIX_H || c >= FIX_W || (r === 25 && c === 25)) continue;
      const trueM = Math.hypot(r - 25, c - 25) * 30;
      worst = Math.max(worst, Math.abs(a[idx(r, c)] / (trueM / speed) - 1));
    }
  }
  return worst;
}

describe('stencil', () => {
  it('has 8 king moves then 8 knight moves, all distinct, with unit directions and consistent distances', () => {
    expect(NEIGHBOR_OFFSETS.length).toBe(ALL_MOVES);
    const seen = new Set<string>();
    NEIGHBOR_OFFSETS.forEach((o, i) => {
      seen.add(`${o.dr},${o.dc}`);
      expect(Math.hypot(o.ux, o.uy)).toBeCloseTo(1, 12);
      expect(o.distFactor).toBeCloseTo(Math.hypot(o.dr, o.dc), 12);
      expect(i < KING_MOVES ? Math.max(Math.abs(o.dr), Math.abs(o.dc)) === 1 : Math.abs(o.dr * o.dc) === 2).toBe(true);
    });
    expect(seen.size).toBe(16);
  });

  it('every knight move passes through exactly the two cells next to its straight segment', () => {
    for (const o of NEIGHBOR_OFFSETS.slice(KING_MOVES)) {
      // The midpoint of the segment lies on the shared edge of the two intermediate cells.
      const mx = (o.m1c + o.m2c) / 2;
      const my = (o.m1r + o.m2r) / 2;
      expect(mx).toBeCloseTo(o.dc / 2, 12);
      expect(my).toBeCloseTo(o.dr / 2, 12);
      // Both intermediates are king-adjacent to the source or to the target (they bridge the move).
      for (const [r, c] of [[o.m1r, o.m1c], [o.m2r, o.m2c]]) {
        expect(Math.max(Math.abs(r), Math.abs(c))).toBeLessThanOrEqual(1);
        expect(Math.max(Math.abs(o.dr - r), Math.abs(o.dc - c))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is validated: only 8 or 16', () => {
    const s = makeFixture();
    expect(s.settings.neighbourhood).toBe(16);
    expect(validateScenario({ ...s, settings: { ...s.settings, neighbourhood: 12 as never } }).some((e) => e.includes('neighbourhood'))).toBe(true);
    expect(DEFAULT_SETTINGS.neighbourhood).toBe(16);
  });
});

describe('fire shape', () => {
  it('16 directions: isotropic fire is within 3 % of a circle (8 directions: within 8.5 %, measurably worse)', () => {
    const e16 = worstAnisotropy(iso(16));
    const e8 = worstAnisotropy(iso(8));
    console.log(`isotropic grid error: 8 dirs ${(e8 * 100).toFixed(1)} %, 16 dirs ${(e16 * 100).toFixed(1)} %`);
    expect(e16).toBeLessThan(0.03);
    expect(e8).toBeLessThan(0.085);
    expect(e8).toBeGreaterThan(e16 * 2);
  });

  it('axes and exact diagonals are unchanged by the extra moves', () => {
    const a = simulate(iso(16)).arrivalTime;
    expect(a[idx(25, 35)]).toBeCloseTo((10 * 30) / 0.2, 1);
    expect(a[idx(35, 35)]).toBeCloseTo((10 * Math.SQRT2 * 30) / 0.2, 1);
  });

  it('never slower than 8 directions anywhere when burnout is off (fuzz: 40 scenarios with water and firebreaks)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const W = 30;
      const n = W * W;
      const fuel = new Uint8Array(n);
      const elevation = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        fuel[i] = rand() < 0.06 ? 0 : seed % 2 ? 4 : 1 + Math.floor(rand() * 5);
        elevation[i] = 100 + 60 * Math.sin((i % W) / 5) + 40 * Math.cos(((i / W) | 0) / 6);
      }
      let ig = 400;
      while (fuel[ig] === 0) ig++;
      const iv = (id: string, type: 'water' | 'firebreak'): Intervention => ({ id, type, tSeconds: rand() * 2000, cells: Array.from({ length: 60 }, () => Math.floor(rand() * n)), params: { halfLifeS: 100 + rand() * 3000, moistureBoost: 0.1 + rand() * 0.5 } });
      const base: Scenario = {
        grid: { ...makeFixture().grid, width: W, height: W },
        fuel, elevation,
        weather: { ...applyDrynessPreset({ ...DEFAULT_WEATHER }, 'high'), windSpeedMps: rand() * 12, windFromDeg: rand() * 360 },
        ignition: [{ row: (ig / W) | 0, col: ig % W }],
        interventions: [iv('w', 'water'), iv('f', 'firebreak')],
        durationSeconds: 8 * 3600, seed,
        settings: { ...DEFAULT_SETTINGS, burnoutEnabled: false, rateModel: seed % 3 === 0 ? 'rothermel' : 'factors' },
      };
      const a8 = simulate({ ...base, settings: { ...base.settings, neighbourhood: 8 } }).arrivalTime;
      const a16 = simulate({ ...base, settings: { ...base.settings, neighbourhood: 16 } }).arrivalTime;
      for (let i = 0; i < n; i++) {
        if (a8[i] === Infinity) continue;
        expect(a16[i], `seed ${seed} cell ${i}`).toBeLessThanOrEqual(a8[i] + 1e-2);
      }
    }
  });
});

describe('knight moves cannot leak through thin barriers (both modes behave the same)', () => {
  const grass = (extra: object = {}) => makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 10 }], fuelClass: FuelClass.GRASS, weather: { windSpeedMps: 10, windFromDeg: 270 }, durationSeconds: 24 * 3600, ...extra });
  const col = (c: number): number[] => Array.from({ length: FIX_H }, (_, r) => idx(r, c));

  for (const nb of [8, 16] as const) {
    it(`[${nb}] a one-cell-wide non-burnable wall stops the fire`, () => {
      const s = grass({ settings: { neighbourhood: nb } });
      for (const c of col(30)) s.fuel[c] = FuelClass.NONE;
      const a = simulate(s).arrivalTime;
      for (let r = 0; r < FIX_H; r++) for (let c = 30; c < FIX_W; c++) expect(a[idx(r, c)], `${r},${c}`).toBe(Infinity);
      expect(a[idx(25, 29)]).toBeLessThan(Infinity);
    });

    it(`[${nb}] a one-cell-wide diagonal (4-connected) wall stops the fire`, () => {
      const s = grass({ ignition: [{ row: 10, col: 10 }], settings: { neighbourhood: nb } });
      // anti-diagonal r + c = 50, made 4-connected by also blocking (r, c+1)
      for (let r = 0; r < FIX_H; r++) {
        const c = 50 - r;
        if (c >= 0 && c < FIX_W) s.fuel[idx(r, c)] = FuelClass.NONE;
        if (c + 1 >= 0 && c + 1 < FIX_W) s.fuel[idx(r, c + 1)] = FuelClass.NONE;
      }
      const a = simulate(s).arrivalTime;
      for (let r = 0; r < FIX_H; r++) for (let c = 0; c < FIX_W; c++) if (r + c > 51) expect(a[idx(r, c)], `${r},${c}`).toBe(Infinity);
    });

    it(`[${nb}] a one-cell-wide firebreak cut at t=0 stops the fire`, () => {
      const s = grass({ settings: { neighbourhood: nb } });
      s.interventions = [{ id: 'fb', tSeconds: 0, type: 'firebreak', cells: col(30) }];
      const a = simulate(s).arrivalTime;
      for (let r = 0; r < FIX_H; r++) for (let c = 30; c < FIX_W; c++) expect(a[idx(r, c)]).toBe(Infinity);
    });

    it(`[${nb}] a one-cell-wide band that stays too wet stops the fire`, () => {
      const s = grass({ settings: { neighbourhood: nb } });
      s.interventions = [{ id: 'w', tSeconds: 0, type: 'water', cells: col(30), params: { moistureBoost: 0.9, halfLifeS: 1e9 } }];
      const a = simulate(s).arrivalTime;
      for (let r = 0; r < FIX_H; r++) for (let c = 30; c < FIX_W; c++) expect(a[idx(r, c)]).toBe(Infinity);
    });

    it(`[${nb}] a one-cell stripe of another fuel cannot be skipped: cells behind it burn after the stripe`, () => {
      const s = grass({ settings: { neighbourhood: nb }, durationSeconds: 96 * 3600 });
      for (const c of col(30)) s.fuel[c] = FuelClass.FOREST_DECIDUOUS; // very slow fuel in a fast grass field
      const a = simulate(s).arrivalTime;
      for (let r = 2; r < FIX_H - 2; r++) {
        const behind = a[idx(r, 31)];
        if (behind === Infinity) continue;
        const stripe = Math.min(a[idx(r - 1, 30)], a[idx(r, 30)], a[idx(r + 1, 30)]);
        expect(behind, `row ${r}`).toBeGreaterThan(stripe);
      }
    });
  }

  it('a firebreak placed at time T blocks knight moves from T on, and fire already past is unchanged', () => {
    const s = grass();
    const base = simulate(s).arrivalTime;
    const T = base[idx(25, 20)] + 1;
    const cut = simulate({ ...s, interventions: [{ id: 'fb', tSeconds: T, type: 'firebreak', cells: col(24) }] }).arrivalTime;
    for (let i = 0; i < base.length; i++) if (base[i] < T) expect(cut[i]).toBe(base[i]);
    for (let r = 0; r < FIX_H; r++) for (let c = 24; c < FIX_W; c++) if (base[idx(r, 24)] >= T) expect(cut[idx(r, c)]).toBe(Infinity);
  });
});
