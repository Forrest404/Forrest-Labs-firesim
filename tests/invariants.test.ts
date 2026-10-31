/**
 * Model invariants: properties that must hold for ANY parameter values, so no golden data and no
 * dependence on calibration. (Idea borrowed from how ForeFire tests its models.)
 * Every rate model registered in MODELS is run through the same suite.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FUELS, FuelClass, applyDrynessPreset } from '../src/contract';
import type { Intervention, Scenario, SimResult } from '../src/contract';
import { simulate } from '../src/sim';
import { mulberry32 } from '../src/sim/prng';
import { FIX_H, FIX_W, countBurned, idx, makeFixture } from './fixtures';
import type { FixtureOptions } from './fixtures';

/** Rate models under test. Extended as models are added (see src/sim/models.ts). */
const MODELS: { name: string; settings: Partial<Scenario['settings']> }[] = [{ name: 'factors', settings: {} }];

const CENTRE = { row: 25, col: 25 };
const open = (o: FixtureOptions = {}): FixtureOptions => ({ river: false, road: false, ignition: [CENTRE], ...o });

function burnedNeighbourEarlier(arr: Float32Array, W: number, H: number, i: number): boolean {
  const r = (i / W) | 0;
  const c = i % W;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      if (arr[rr * W + cc] < arr[i]) return true;
    }
  }
  return false;
}

function randomScenario(seed: number): Scenario {
  const rand = mulberry32(seed);
  const W = 30;
  const H = 30;
  const n = W * H;
  const fuel = new Uint8Array(n);
  const elevation = new Float32Array(n);
  const phase = rand() * 6;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const v = rand();
      fuel[i] = v < 0.08 ? FuelClass.NONE : 1 + Math.floor(rand() * 5);
      elevation[i] = 100 + 80 * Math.sin(c / 5 + phase) + 60 * Math.cos(r / 7);
    }
  }
  const base = makeFixture();
  let weather = applyDrynessPreset({ ...DEFAULT_WEATHER }, (['low', 'medium', 'high', 'extreme'] as const)[Math.floor(rand() * 4)]);
  weather = { ...weather, windSpeedMps: rand() * 15, windFromDeg: rand() * 360, windVariabilityDeg: rand() < 0.5 ? 0 : rand() * 30 };
  let ig = { row: Math.floor(rand() * H), col: Math.floor(rand() * W) };
  while (fuel[ig.row * W + ig.col] === FuelClass.NONE) ig = { row: Math.floor(rand() * H), col: Math.floor(rand() * W) };
  return {
    grid: { ...base.grid, width: W, height: H },
    fuel,
    elevation,
    weather,
    ignition: [ig],
    interventions: [],
    durationSeconds: 8 * 3600,
    seed: Math.floor(rand() * 1e6),
    settings: { ...DEFAULT_SETTINGS, slopeStrength: rand() * 2, windStrength: rand() * 2 },
  };
}

function randomIntervention(rand: () => number, W: number, H: number, id: string, duration: number): Intervention {
  const cells: number[] = [];
  const n = 5 + Math.floor(rand() * 60);
  for (let k = 0; k < n; k++) cells.push(Math.floor(rand() * H) * W + Math.floor(rand() * W));
  return {
    id,
    tSeconds: rand() < 0.4 ? 0 : rand() * duration * 0.5,
    type: rand() < 0.5 ? 'firebreak' : 'water',
    cells: [...new Set(cells)],
    params: { halfLifeS: 60 + rand() * 3000, moistureBoost: 0.05 + rand() * 0.6 },
  };
}

for (const model of MODELS) {
  describe(`invariants [${model.name}]`, () => {
    const run = (o: FixtureOptions): SimResult => {
      const s = makeFixture({ ...o, settings: { ...model.settings, ...o.settings } });
      return simulate(s);
    };

    it('arrival times are valid: ignition at 0, never NaN/negative, within duration, none on non-burnable cells', () => {
      for (let seed = 1; seed <= 25; seed++) {
        const s = randomScenario(seed);
        s.settings = { ...s.settings, ...model.settings };
        const { arrivalTime } = simulate(s);
        const ig = s.ignition[0];
        expect(arrivalTime[ig.row * 30 + ig.col]).toBe(0);
        for (let i = 0; i < arrivalTime.length; i++) {
          const a = arrivalTime[i];
          expect(Number.isNaN(a)).toBe(false);
          expect(a).toBeGreaterThanOrEqual(0);
          if (a !== Infinity) {
            expect(a).toBeLessThanOrEqual(s.durationSeconds);
            expect(s.fuel[i]).not.toBe(FuelClass.NONE);
          }
        }
      }
    });

    it('causality: every burned cell except the ignition has a neighbour that burned strictly earlier', () => {
      for (let seed = 100; seed < 120; seed++) {
        const s = randomScenario(seed);
        s.settings = { ...s.settings, ...model.settings };
        const { arrivalTime } = simulate(s);
        const ig = s.ignition[0].row * 30 + s.ignition[0].col;
        for (let i = 0; i < arrivalTime.length; i++) {
          if (i === ig || arrivalTime[i] === Infinity) continue;
          expect(burnedNeighbourEarlier(arrivalTime, 30, 30, i), `seed ${seed} cell ${i}`).toBe(true);
        }
      }
    });

    it('does not mutate its input scenario and reports consistent stats', () => {
      const s = randomScenario(7);
      s.settings = { ...s.settings, ...model.settings };
      const before = { fuel: Uint8Array.from(s.fuel), elev: Float32Array.from(s.elevation), json: JSON.stringify({ w: s.weather, st: s.settings, ig: s.ignition }) };
      const r = simulate(s);
      expect(Buffer.from(s.fuel).equals(Buffer.from(before.fuel))).toBe(true);
      expect(Buffer.from(s.elevation.buffer).equals(Buffer.from(before.elev.buffer))).toBe(true);
      expect(JSON.stringify({ w: s.weather, st: s.settings, ig: s.ignition })).toBe(before.json);
      expect(r.stats.burnedCells).toBe(countBurned(r.arrivalTime));
      expect(r.stats.burnedAreaHa).toBeCloseTo(r.stats.burnedCells * 0.09, 9);
      expect(r.arrivalTime.length).toBe(s.fuel.length);
    });

    it('moisture: more moisture never makes any cell burn earlier; zero spread at and above extinction', () => {
      const mx = FUELS[FuelClass.FOREST_CONIFER].extinctionMoisture;
      let prev: Float32Array | null = null;
      for (const m of [0, 0.03, 0.06, 0.1, 0.15, 0.2, 0.25, 0.3, mx - 0.005]) {
        const { arrivalTime } = run(open({ weather: { baseFuelMoisture: m, windSpeedMps: 4 }, durationSeconds: 6 * 3600 }));
        if (prev) for (let i = 0; i < arrivalTime.length; i++) expect(arrivalTime[i] + 1e-3).toBeGreaterThanOrEqual(prev[i]);
        prev = arrivalTime;
      }
      for (const m of [mx, mx + 0.1, 0.9, 1]) {
        const r = run(open({ weather: { baseFuelMoisture: m } }));
        expect(r.stats.burnedCells).toBe(1);
      }
      // Bone dry is finite and fast, not NaN/Infinity-speed.
      const dry = run(open({ weather: { baseFuelMoisture: 0, windSpeedMps: 20 }, fuelClass: FuelClass.GRASS }));
      expect(Number.isFinite(dry.stats.maxSpreadRateMps)).toBe(true);
      expect(dry.stats.maxSpreadRateMps).toBeLessThan(20);
    });

    it('wind: stronger wind speeds up the head, slows the back, and never produces NaN', () => {
      let lastHead = Infinity;
      let lastBack = 0;
      for (const u of [0, 2, 5, 10, 20, 40]) {
        const { arrivalTime } = run(open({ dryness: 'high', weather: { windSpeedMps: u, windFromDeg: 270 }, durationSeconds: 24 * 3600 }));
        const head = arrivalTime[idx(25, 40)];
        const back = arrivalTime[idx(25, 10)];
        expect(head).toBeLessThanOrEqual(lastHead + 1e-3);
        if (back !== Infinity) expect(back + 1e-3).toBeGreaterThanOrEqual(lastBack);
        else lastBack = Infinity;
        lastHead = head;
        if (back !== Infinity) lastBack = back;
      }
    });

    it('slope: steeper terrain speeds uphill spread and slows downhill spread', () => {
      const uphill: number[] = [];
      const downhill: number[] = [];
      for (const k of [0, 0.5, 1, 2]) {
        const r = run(open({ slopeNorth: true, dryness: 'high', settings: { slopeStrength: k }, ignition: [{ row: 25, col: 25 }], durationSeconds: 24 * 3600 }));
        uphill.push(r.arrivalTime[idx(10, 25)]);
        downhill.push(r.arrivalTime[idx(40, 25)]);
      }
      for (let i = 1; i < uphill.length; i++) {
        expect(uphill[i]).toBeLessThanOrEqual(uphill[i - 1] + 1e-3);
        expect(downhill[i] + 1e-3).toBeGreaterThanOrEqual(downhill[i - 1]);
      }
      expect(uphill[3]).toBeLessThan(uphill[0]);
    });

    it('scale: doubling the global multiplier halves every arrival time', () => {
      const a = run(open({ weather: { windSpeedMps: 5, windFromDeg: 200 }, settings: { globalMultiplier: 1 }, durationSeconds: 48 * 3600 })).arrivalTime;
      const b = run(open({ weather: { windSpeedMps: 5, windFromDeg: 200 }, settings: { globalMultiplier: 2 }, durationSeconds: 48 * 3600 })).arrivalTime;
      let checked = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === Infinity) continue;
        expect(b[i]).toBeCloseTo(a[i] / 2, 1);
        checked++;
      }
      expect(checked).toBeGreaterThan(500);
    });

    it('mirror symmetry: wind from the east is the exact mirror of wind from the west', () => {
      const w = run(open({ ignition: [{ row: 25, col: 24 }], weather: { windSpeedMps: 7, windFromDeg: 270 } })).arrivalTime;
      const e = run(open({ ignition: [{ row: 25, col: 25 }], weather: { windSpeedMps: 7, windFromDeg: 90 } })).arrivalTime;
      for (let r = 0; r < FIX_H; r++) {
        for (let c = 0; c < FIX_W; c++) {
          const a = w[idx(r, c)];
          const b = e[idx(r, FIX_W - 1 - c)];
          if (a === Infinity || b === Infinity) expect(a).toBe(b);
          else expect(Math.abs(a - b)).toBeLessThan(1e-2 + 1e-5 * a);
        }
      }
    });

    it('north-south symmetry with a north/south wind on flat ground', () => {
      const n = run(open({ ignition: [{ row: 24, col: 25 }], weather: { windSpeedMps: 6, windFromDeg: 180 } })).arrivalTime; // from south, pushes north
      const s = run(open({ ignition: [{ row: 25, col: 25 }], weather: { windSpeedMps: 6, windFromDeg: 0 } })).arrivalTime; // from north, pushes south
      for (let r = 0; r < FIX_H; r++) for (let c = 0; c < FIX_W; c++) {
        const a = n[idx(r, c)];
        const b = s[idx(FIX_H - 1 - r, c)];
        if (a === Infinity || b === Infinity) expect(a).toBe(b);
        else expect(Math.abs(a - b)).toBeLessThan(1e-2 + 1e-5 * a);
      }
    });

    it('no wind, flat: four-fold rotational symmetry about the ignition', () => {
      const { arrivalTime: a } = run(open({ weather: { windSpeedMps: 0 }, durationSeconds: 48 * 3600 }));
      for (let dr = -20; dr <= 20; dr++) for (let dc = -20; dc <= 20; dc++) {
        const p = a[idx(25 + dr, 25 + dc)];
        const q = a[idx(25 - dc, 25 + dr)]; // rotate 90 degrees
        expect(Math.abs(p - q)).toBeLessThan(1e-2 + 1e-5 * p);
      }
    });

    it('interventions never make any cell burn earlier (fuzz over 40 random scenarios)', () => {
      for (let seed = 200; seed < 240; seed++) {
        const s = randomScenario(seed);
        s.settings = { ...s.settings, ...model.settings };
        const base = simulate(s).arrivalTime;
        const rand = mulberry32(seed * 31);
        const ivs: Intervention[] = [];
        for (let k = 0; k < 3; k++) ivs.push(randomIntervention(rand, 30, 30, `iv${k}`, s.durationSeconds));
        // Adding interventions one by one: every cell is no earlier than before.
        let prev = base;
        for (let k = 1; k <= ivs.length; k++) {
          const cur = simulate({ ...s, interventions: ivs.slice(0, k) }).arrivalTime;
          for (let i = 0; i < cur.length; i++) {
            expect(cur[i] + 1e-2, `seed ${seed} k ${k} cell ${i}: ${cur[i]} < ${prev[i]}`).toBeGreaterThanOrEqual(prev[i]);
          }
          prev = cur;
        }
      }
    });

    it('interventions that cannot matter do not change the result (after the burn, or on unreachable cells)', () => {
      const s = makeFixture(open({ weather: { windSpeedMps: 6 }, durationSeconds: 3 * 3600 }));
      const base = simulate(s).arrivalTime;
      const late: Intervention = { id: 'late', tSeconds: 3 * 3600, type: 'firebreak', cells: [idx(10, 10), idx(30, 30)] };
      const lateWater: Intervention = { id: 'lw', tSeconds: 3 * 3600, type: 'water', cells: [idx(12, 12)] };
      const after = simulate({ ...s, interventions: [late, lateWater] }).arrivalTime;
      for (let i = 0; i < base.length; i++) if (base[i] < 3 * 3600 - 1) expect(after[i]).toBe(base[i]);
      // A firebreak ring that only covers cells nobody reaches in this short run.
      const far = makeFixture(open({ weather: { windSpeedMps: 0 }, dryness: 'low', durationSeconds: 600 }));
      const farBase = simulate(far).arrivalTime;
      const ring: Intervention = { id: 'ring', tSeconds: 0, type: 'firebreak', cells: [idx(0, 0), idx(0, 1), idx(49, 49)] };
      const farAfter = simulate({ ...far, interventions: [ring] }).arrivalTime;
      expect(Buffer.from(farAfter.buffer).equals(Buffer.from(farBase.buffer))).toBe(true);
    });

    it('is deterministic for every random scenario, including seeded wind variability', () => {
      for (let seed = 300; seed < 315; seed++) {
        const s = randomScenario(seed);
        s.settings = { ...s.settings, ...model.settings };
        s.weather.windVariabilityDeg = 25;
        const a = simulate(s).arrivalTime;
        const b = simulate({ ...s, interventions: [] }).arrivalTime;
        expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
      }
    });

    it('a cell is reached only through burnable ground: cutting all neighbours of the ignition stops everything', () => {
      const s = makeFixture(open({ weather: { windSpeedMps: 8 } }));
      const ring: number[] = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) ring.push(idx(25 + dr, 25 + dc));
      const r = simulate({ ...s, interventions: [{ id: 'ring', tSeconds: 0, type: 'firebreak', cells: ring }] });
      expect(r.stats.burnedCells).toBe(1);
    });

    it('measured grid anisotropy on a flat, windless, uniform grid stays within the documented bound', () => {
      // 8-neighbour shortest paths overestimate straight-line distance by up to ~8.2 % at 22.5 degrees.
      const { arrivalTime: a } = run(open({ weather: { windSpeedMps: 0 }, fuelClass: FuelClass.GRASS, durationSeconds: 48 * 3600 }));
      const v = a[idx(25, 35)] / 10; // seconds per cell along the axis
      let worst = 0;
      for (let deg = 0; deg < 360; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        for (const dist of [10, 20]) {
          const r = Math.round(25 - dist * Math.cos(rad));
          const c = Math.round(25 + dist * Math.sin(rad));
          if (r < 0 || c < 0 || r >= FIX_H || c >= FIX_W) continue;
          const trueDist = Math.hypot(r - 25, c - 25);
          const err = a[idx(r, c)] / (trueDist * v) - 1;
          worst = Math.max(worst, Math.abs(err));
        }
      }
      console.log(`[${model.name}] worst isotropic grid error: ${(worst * 100).toFixed(1)} %`);
      expect(worst).toBeLessThan(GRID_ERROR_BOUND);
    });
  });
}

/** Tightened when the grid-shape fix lands (feature 5). */
const GRID_ERROR_BOUND = 0.09;
