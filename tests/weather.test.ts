import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FUELS, FuelClass, applyDrynessPreset, scheduleFromPreset } from '../src/contract';
import type { Intervention, Scenario, WeatherKeyframe } from '../src/contract';
import { simulate } from '../src/sim';
import { crossTimeVarying } from '../src/sim/crossing';
import { buildEventLayers } from '../src/sim/events';
import { createRateFn } from '../src/sim/models';
import { mulberry32 } from '../src/sim/prng';
import { createWeatherTimeline } from '../src/sim/weather';
import { FIX_H, FIX_W, countBurned, idx, makeFixture } from './fixtures';
import type { FixtureOptions } from './fixtures';

const open = (o: FixtureOptions = {}): FixtureOptions => ({ river: false, road: false, ignition: [{ row: 25, col: 25 }], fuelClass: FuelClass.GRASS, dryness: 'high', ...o });
const withSched = (kf: WeatherKeyframe[], o: FixtureOptions = {}): Scenario => ({ ...makeFixture(open(o)), weatherSchedule: kf });

describe('a constant schedule is the same as steady weather', () => {
  it('arrival times agree to rounding error (no interventions), for both models and with wind variability', () => {
    for (const rateModel of ['factors', 'rothermel'] as const) {
      for (const variability of [0, 25]) {
        const o = open({ weather: { windSpeedMps: 7, windFromDeg: 230, windVariabilityDeg: variability }, settings: { rateModel }, durationSeconds: 6 * 3600 });
        const s = makeFixture(o);
        const w = s.weather;
        const steady = simulate(s).arrivalTime;
        const sched = simulate({ ...s, weatherSchedule: [{ tSeconds: 1800, windSpeedMps: w.windSpeedMps, windFromDeg: w.windFromDeg, temperatureC: w.temperatureC, relativeHumidity: w.relativeHumidity }, { tSeconds: 9000, windSpeedMps: w.windSpeedMps }] }).arrivalTime;
        let worst = 0;
        for (let i = 0; i < steady.length; i++) {
          if (steady[i] === Infinity || sched[i] === Infinity) expect(sched[i]).toBe(steady[i]);
          else worst = Math.max(worst, Math.abs(steady[i] - sched[i]));
        }
        expect(worst, `${rateModel} variability ${variability}`).toBeLessThan(0.05);
      }
    }
  });

  it('the schedule changes nothing when it is empty', () => {
    const s = makeFixture(open({ weather: { windSpeedMps: 6 } }));
    const a = simulate(s).arrivalTime;
    expect(Buffer.from(simulate({ ...s, weatherSchedule: [] }).arrivalTime.buffer).equals(Buffer.from(a.buffer))).toBe(true);
    expect(Buffer.from(simulate({ ...s, weatherSchedule: undefined }).arrivalTime.buffer).equals(Buffer.from(a.buffer))).toBe(true);
  });
});

describe('wind that changes over time', () => {
  it('a wind shift moves the fire: east first, then south once the wind comes from the north', () => {
    const o = { weather: { windSpeedMps: 9, windFromDeg: 270 }, durationSeconds: 3 * 3600 };
    const steady = simulate(makeFixture(open(o)));
    const shift = simulate(withSched([{ tSeconds: 1200, windFromDeg: 270 }, { tSeconds: 1500, windFromDeg: 0 }], o));
    const south = idx(40, 25);
    const east = idx(25, 44);
    expect(steady.arrivalTime[south]).toBeGreaterThan(shift.arrivalTime[south]); // shift pushes it south sooner
    expect(shift.arrivalTime[east]).toBeGreaterThan(steady.arrivalTime[east]); // and east later
    // Before the shift both runs are identical.
    for (let i = 0; i < steady.arrivalTime.length; i++) if (steady.arrivalTime[i] < 1100) expect(shift.arrivalTime[i]).toBeCloseTo(steady.arrivalTime[i], 1);
  });

  it('rising wind sits between the calm and the gale runs along the downwind axis (monotone in wind)', () => {
    const o = { durationSeconds: 12 * 3600 };
    const calm = simulate(makeFixture(open({ ...o, weather: { windSpeedMps: 3, windFromDeg: 270 } }))).arrivalTime;
    const gale = simulate(makeFixture(open({ ...o, weather: { windSpeedMps: 12, windFromDeg: 270 } }))).arrivalTime;
    const ramp = simulate(withSched([{ tSeconds: 3000, windSpeedMps: 12 }], { ...o, weather: { windSpeedMps: 3, windFromDeg: 270 } })).arrivalTime;
    let checked = 0;
    for (let c = 28; c < FIX_W; c++) {
      const i = idx(25, c);
      if (calm[i] === Infinity) continue;
      expect(ramp[i]).toBeLessThanOrEqual(calm[i] + 0.05);
      expect(ramp[i]).toBeGreaterThanOrEqual(gale[i] - 0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(ramp[idx(25, 44)]).toBeLessThan(calm[idx(25, 44)] * 0.95);
  });

  it('wind dropping to zero stops the downwind surge: embers stop too', () => {
    const base = makeFixture({ ...open({ fuelClass: FuelClass.FOREST_CONIFER, dryness: 'extreme', ignition: [{ row: 25, col: 5 }], weather: { windSpeedMps: 12, windFromDeg: 270 }, durationSeconds: 8 * 3600 }), settings: { spottingEnabled: true, spottingIgnitionProb: 0.3, spottingEmbers: 4 } });
    const steady = simulate(base);
    const calms = simulate({ ...base, weatherSchedule: [{ tSeconds: 60, windSpeedMps: 0 }, { tSeconds: 61, windSpeedMps: 0 }] });
    expect(steady.stats.spotFires).toBeGreaterThan(5);
    expect(calms.stats.spotFires).toBeLessThan(steady.stats.spotFires);
    expect(calms.stats.burnedCells).toBeLessThan(steady.stats.burnedCells);
  });
});

describe('moisture that changes over time', () => {
  // The simple moisture model tops out near 27 % at 100 % humidity, below grass's 30 % extinction, so
  // damp air alone can never put a grass fire out (there is no precipitation). To exercise the wait/
  // extinction logic, lower grass's extinction moisture for this group only, then restore it.
  let savedExtinction = 0;
  beforeAll(() => {
    savedExtinction = FUELS[FuelClass.GRASS].extinctionMoisture;
    FUELS[FuelClass.GRASS].extinctionMoisture = 0.2;
  });
  afterAll(() => {
    FUELS[FuelClass.GRASS].extinctionMoisture = savedExtinction;
  });

  const rainy = (lag: number): Scenario => {
    const s = makeFixture(open({ dryness: 'medium', weather: { windSpeedMps: 5 }, durationSeconds: 10 * 3600, settings: { fuelMoistureLagS: lag } }));
    return { ...s, weatherSchedule: [{ tSeconds: 1800, relativeHumidity: s.weather.relativeHumidity }, { tSeconds: 4 * 3600, relativeHumidity: 1 }] };
  };

  it('humidity rising to saturation puts the fire out: spread stops once moisture passes extinction, and the area is smaller than with steady weather', () => {
    const s = rainy(0);
    const steadyArea = simulate({ ...s, weatherSchedule: undefined }).stats.burnedCells;
    const r = simulate(s);
    expect(r.stats.burnedCells).toBeLessThan(steadyArea);
    const tl = createWeatherTimeline(s)!;
    const mx = FUELS[FuelClass.GRASS].extinctionMoisture;
    let tExt = Infinity;
    for (let t = 0; t <= 10 * 3600; t += 30) if (tl.baseMoistureAt(t) >= mx) { tExt = t; break; }
    expect(tExt).toBeLessThan(10 * 3600);
    const burnoutS = FUELS[FuelClass.GRASS].burnDurationS;
    for (let i = 0; i < r.arrivalTime.length; i++) if (r.arrivalTime[i] < Infinity) expect(r.arrivalTime[i]).toBeLessThanOrEqual(tExt + burnoutS + 1);
  });

  it('fuel that starts too wet to burn burns once it dries (burnout off); with burnout on the source dies first', () => {
    const wet = (burnoutEnabled: boolean): Scenario => {
      const s = makeFixture(open({ dryness: 'low', weather: { windSpeedMps: 4, baseFuelMoisture: 0.25 }, durationSeconds: 10 * 3600, settings: { fuelMoistureLagS: 900, burnoutEnabled } }));
      return { ...s, weatherSchedule: [{ tSeconds: 1800, relativeHumidity: s.weather.relativeHumidity }, { tSeconds: 3 * 3600, relativeHumidity: 0.03, temperatureC: 40 }] };
    };
    expect(FUELS[FuelClass.GRASS].extinctionMoisture).toBeLessThan(0.25); // starts wetter than extinction
    const patient = simulate(wet(false));
    expect(patient.stats.burnedCells).toBeGreaterThan(200);
    const tl = createWeatherTimeline(wet(false))!;
    let tDry = Infinity;
    for (let t = 0; t <= 10 * 3600; t += 30) if (tl.baseMoistureAt(t) < FUELS[FuelClass.GRASS].extinctionMoisture) { tDry = t; break; }
    expect(tDry).toBeGreaterThan(1800);
    for (let i = 0; i < patient.arrivalTime.length; i++) if (patient.arrivalTime[i] > 0 && patient.arrivalTime[i] < Infinity) expect(patient.arrivalTime[i]).toBeGreaterThanOrEqual(tDry);
    expect(simulate(wet(true)).stats.burnedCells).toBeLessThan(patient.stats.burnedCells);
  });

  it('a slower fuel moisture response lets the fire run longer before the damp air takes effect', () => {
    const instant = simulate(rainy(0)).stats.burnedCells;
    const slow = simulate(rainy(3 * 3600)).stats.burnedCells;
    expect(slow).toBeGreaterThanOrEqual(instant);
    expect(slow).toBeGreaterThan(instant);
  });

  it('hotter, drier air during the run speeds the fire up compared with steady conditions', () => {
    const base = makeFixture(open({ dryness: 'low', weather: { windSpeedMps: 4 }, durationSeconds: 3 * 3600 }));
    const hot = { ...base, weatherSchedule: [{ tSeconds: 600, temperatureC: 40, relativeHumidity: 0.05 }], settings: { ...base.settings, fuelMoistureLagS: 600 } };
    expect(simulate(hot).stats.burnedCells).toBeGreaterThan(simulate(base).stats.burnedCells);
  });
});

describe('time-varying edges are FIFO (Dijkstra stays correct)', () => {
  it('a front that starts later never finishes the crossing earlier, under a gusty, shifting schedule', () => {
    const s = makeFixture(open({ weather: { windSpeedMps: 3, windFromDeg: 250 }, settings: { rateModel: 'rothermel' } }));
    s.weatherSchedule = [{ tSeconds: 900, windSpeedMps: 14, windFromDeg: 290 }, { tSeconds: 1500, windSpeedMps: 1, windFromDeg: 200 }, { tSeconds: 2400, windSpeedMps: 11, windFromDeg: 260 }, { tSeconds: 4000, windSpeedMps: 2 }];
    const tl = createWeatherTimeline(s)!;
    const rateFn = createRateFn(s);
    const layers = buildEventLayers([], 5, s.settings);
    const mx = FUELS[FuelClass.GRASS].extinctionMoisture;
    for (const [ux, uy] of [[1, 0], [0.6, 0.8], [0, 1], [-1, 0], [-0.7, -0.7]] as const) {
      let prev = -Infinity;
      for (let t0 = 0; t0 < 6000; t0 += 11.3) {
        const out = { t: 0, rate: 0 };
        crossTimeVarying({ layers, timeline: tl, rateFn, edge: { fuel: FuelClass.GRASS, moisture: 0, cosTheta: 0, windSpeedMps: 0, dz: 3, dist: 30 }, duration: 1e9 }, 1, t0, 30, ux, uy, 0, mx, Infinity, out);
        expect(out.t + 1e-6, `dir ${ux},${uy} start ${t0}`).toBeGreaterThanOrEqual(prev);
        expect(out.t).toBeGreaterThan(t0);
        prev = out.t;
      }
    }
  });

  it('firebreaks never make any cell burn earlier under random schedules (fuzz: 60 scenarios, burnout on)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed);
      const W = 30, n = W * W;
      const fuel = new Uint8Array(n), elevation = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        fuel[i] = rand() < 0.06 ? 0 : 1 + Math.floor(rand() * 5);
        elevation[i] = 100 + 60 * Math.sin((i % W) / 5) + 40 * Math.cos(((i / W) | 0) / 6);
      }
      let ig = 300;
      while (fuel[ig] === 0) ig++;
      const kf: WeatherKeyframe[] = [];
      let t = 0;
      for (let k = 0; k < 4; k++) {
        t += 300 + rand() * 3000;
        kf.push({ tSeconds: t, windSpeedMps: rand() * 14, windFromDeg: rand() * 360, temperatureC: 10 + rand() * 30, relativeHumidity: 0.05 + rand() * 0.8 });
      }
      const base: Scenario = {
        grid: { ...makeFixture().grid, width: W, height: W }, fuel, elevation,
        weather: { ...applyDrynessPreset({ ...DEFAULT_WEATHER }, 'high'), windSpeedMps: rand() * 10, windFromDeg: rand() * 360, windVariabilityDeg: seed % 3 ? 0 : 20 },
        weatherSchedule: kf, ignition: [{ row: (ig / W) | 0, col: ig % W }], interventions: [], durationSeconds: 8 * 3600, seed,
        settings: { ...DEFAULT_SETTINGS, rateModel: seed % 3 === 0 ? 'rothermel' : 'factors', fuelMoistureLagS: seed % 2 ? 3600 : 600 },
      };
      let prev = simulate(base).arrivalTime;
      const brk = (id: string): Intervention => ({ id, type: 'firebreak', tSeconds: rand() * 2000, cells: Array.from({ length: 50 }, () => Math.floor(rand() * n)) });
      const ivs = [brk('a'), brk('b'), brk('c')];
      for (let k = 1; k <= 3; k++) {
        const cur = simulate({ ...base, interventions: ivs.slice(0, k) }).arrivalTime;
        for (let i = 0; i < n; i++) expect(cur[i] + 1e-2, `seed ${seed} k ${k} cell ${i}`).toBeGreaterThanOrEqual(prev[i]);
        prev = cur;
      }
    }
  });

  it('results stay valid, causal and deterministic under random schedules, water and burnout (fuzz: 60 scenarios)', () => {
    for (let seed = 100; seed < 160; seed++) {
      const rand = mulberry32(seed);
      const W = 30, n = W * W;
      const fuel = new Uint8Array(n), elevation = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        fuel[i] = rand() < 0.06 ? 0 : 1 + Math.floor(rand() * 5);
        elevation[i] = 100 + 60 * Math.sin((i % W) / 5);
      }
      let ig = 300;
      while (fuel[ig] === 0) ig++;
      const kf: WeatherKeyframe[] = [];
      let t = 0;
      for (let k = 0; k < 5; k++) {
        t += 200 + rand() * 2500;
        kf.push({ tSeconds: t, windSpeedMps: rand() * 16, windFromDeg: rand() * 720 - 180, relativeHumidity: 0.05 + rand() * 0.9 });
      }
      const water: Intervention = { id: 'w', type: 'water', tSeconds: rand() * 2000, cells: Array.from({ length: 80 }, () => Math.floor(rand() * n)), params: { halfLifeS: 100 + rand() * 3000, moistureBoost: 0.1 + rand() * 0.5 } };
      const s: Scenario = {
        grid: { ...makeFixture().grid, width: W, height: W }, fuel, elevation,
        weather: { ...applyDrynessPreset({ ...DEFAULT_WEATHER }, 'extreme'), windSpeedMps: rand() * 10, windFromDeg: rand() * 360 },
        weatherSchedule: kf, ignition: [{ row: (ig / W) | 0, col: ig % W }], interventions: [water], durationSeconds: 8 * 3600, seed,
        settings: { ...DEFAULT_SETTINGS, burnoutEnabled: seed % 2 === 0, fuelMoistureLagS: 1800 },
      };
      const a = simulate(s);
      const b = simulate({ ...s });
      expect(Buffer.from(a.arrivalTime.buffer).equals(Buffer.from(b.arrivalTime.buffer))).toBe(true);
      for (let i = 0; i < n; i++) {
        const v = a.arrivalTime[i];
        expect(Number.isNaN(v)).toBe(false);
        if (v === Infinity) continue;
        expect(v).toBeLessThanOrEqual(s.durationSeconds);
        expect(fuel[i]).not.toBe(0);
        if (i !== ig) {
          const src = a.sourceCell[i];
          expect(src, `seed ${seed} cell ${i}`).toBeGreaterThanOrEqual(0);
          expect(a.arrivalTime[src]).toBeLessThan(v);
        }
      }
    }
  });
});

describe('presets in the solver and performance', () => {
  it('every preset runs and the "steady" preset equals no schedule', () => {
    const base = makeFixture(open({ weather: { windSpeedMps: 7, windFromDeg: 260 }, durationSeconds: 6 * 3600 }));
    const none = simulate(base).arrivalTime;
    expect(Buffer.from(simulate({ ...base, weatherSchedule: scheduleFromPreset('steady', base.weather) }).arrivalTime.buffer).equals(Buffer.from(none.buffer))).toBe(true);
    for (const id of ['windShift', 'windRise', 'frontPassage', 'eveningCooling'] as const) {
      const r = simulate({ ...base, weatherSchedule: scheduleFromPreset(id, base.weather) });
      expect(r.stats.burnedCells, id).toBeGreaterThan(10);
      expect(Buffer.from(r.arrivalTime.buffer).equals(Buffer.from(none.buffer)), id).toBe(false);
    }
    expect(countBurned(none)).toBeGreaterThan(10);
    expect(FIX_H).toBe(50);
  });
});
