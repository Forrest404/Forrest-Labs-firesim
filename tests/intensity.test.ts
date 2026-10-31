import { describe, expect, it } from 'vitest';
import { FUELS, FuelClass } from '../src/contract';
import { simulate } from '../src/sim';
import { byramIntensityKwM, flameLengthM, intensityClass } from '../src/sim/intensity';
import { FIX_W, idx, makeFixture } from './fixtures';
import type { FixtureOptions } from './fixtures';

const iso = (fuelClass: FuelClass, speed = 0.2, extra: Partial<FixtureOptions> = {}) =>
  makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 25 }], fuelClass, weather: { windSpeedMps: 0 }, settings: { rateModel: 'iso', isoSpeedMps: speed }, durationSeconds: 24 * 3600, ...extra });

describe('Byram formulas', () => {
  it('intensity = H w R / 1000, flame length = 0.0775 I^0.46 (hand-computed reference values)', () => {
    // 18.608e6 J/kg x 0.166 kg/m2 x 0.5 m/s = 1,544,464 W/m = 1544.464 kW/m
    expect(byramIntensityKwM(18_608_000, 0.166, 0.5)).toBeCloseTo(1544.464, 3);
    // 0.0775 * 1544.464^0.46 = 2.27059 m (computed independently in Python)
    expect(flameLengthM(1544.464)).toBeCloseTo(2.27059, 4);
    expect(flameLengthM(100)).toBeCloseTo(0.0775 * Math.pow(100, 0.46), 12);
    expect(flameLengthM(1000)).toBeGreaterThan(flameLengthM(100));
  });

  it('is zero (not NaN) for no spread, no fuel, or no heat', () => {
    expect(byramIntensityKwM(18e6, 0.2, 0)).toBe(0);
    expect(byramIntensityKwM(18e6, 0, 1)).toBe(0);
    expect(byramIntensityKwM(0, 0.2, 1)).toBe(0);
    expect(byramIntensityKwM(18e6, 0.2, NaN)).toBe(0);
    expect(flameLengthM(0)).toBe(0);
    expect(flameLengthM(-5)).toBe(0);
  });

  it('classes are ordered and cover the whole range', () => {
    expect([0, 100, 349, 350, 1699, 1700, 3499, 3500, 1e6].map(intensityClass)).toEqual(['low', 'low', 'low', 'moderate', 'moderate', 'high', 'high', 'extreme', 'extreme']);
  });
});

describe('intensity in the simulation result', () => {
  it('constant speed on a uniform bed gives exactly H w R everywhere the fire arrived (pinned)', () => {
    const r = simulate(iso(FuelClass.GRASS, 0.2));
    const expected = (FUELS[FuelClass.GRASS].bed.heatContentJkg * FUELS[FuelClass.GRASS].bed.loadKgM2 * 0.2) / 1000;
    expect(expected).toBeCloseTo(617.79, 1);
    let n = 0;
    for (let i = 0; i < r.arrivalTime.length; i++) {
      if (r.arrivalTime[i] === Infinity) {
        expect(r.firelineIntensityKwM[i]).toBe(0);
        expect(r.flameLengthM[i]).toBe(0);
        continue;
      }
      expect(r.firelineIntensityKwM[i]).toBeCloseTo(expected, 1); // includes the ignition cell
      expect(r.flameLengthM[i]).toBeCloseTo(flameLengthM(expected), 3);
      n++;
    }
    expect(n).toBeGreaterThan(1000);
    expect(r.stats.maxIntensityKwM).toBeCloseTo(expected, 1);
    expect(r.stats.maxFlameLengthM).toBeCloseTo(flameLengthM(expected), 3);
  });

  it('heavier fuel burns hotter at the same spread speed; faster spread burns hotter in the same fuel', () => {
    const grass = simulate(iso(FuelClass.GRASS, 0.2)).stats.maxIntensityKwM;
    const conifer = simulate(iso(FuelClass.FOREST_CONIFER, 0.2)).stats.maxIntensityKwM;
    expect(conifer / grass).toBeCloseTo(FUELS[FuelClass.FOREST_CONIFER].bed.loadKgM2 / FUELS[FuelClass.GRASS].bed.loadKgM2, 3);
    const slow = simulate(iso(FuelClass.GRASS, 0.1)).stats.maxIntensityKwM;
    expect(grass / slow).toBeCloseTo(2, 3);
  });

  it('under wind the head fire is more intense than the flanks and the back (Rothermel)', () => {
    const s = makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 25 }], fuelClass: FuelClass.GRASS, dryness: 'high', weather: { windSpeedMps: 8, windFromDeg: 270 }, settings: { rateModel: 'rothermel', neighbourhood: 16 }, durationSeconds: 6 * 3600 });
    const r = simulate(s);
    const head = r.firelineIntensityKwM[idx(25, 40)];
    const flank = r.firelineIntensityKwM[idx(10, 25)];
    const back = r.firelineIntensityKwM[idx(25, 12)];
    expect(head).toBeGreaterThan(flank * 3);
    expect(flank).toBeGreaterThanOrEqual(back * 0.99);
    expect(r.flameLengthM[idx(25, 40)]).toBeGreaterThan(r.flameLengthM[idx(25, 12)]);
    expect(FIX_W).toBe(50);
  });

  it('stronger wind raises the peak intensity; arrays are finite, non-negative and consistent with the stats', () => {
    let last = 0;
    for (const u of [0, 3, 6, 12]) {
      const r = simulate(makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 25 }], fuelClass: FuelClass.SHRUB, dryness: 'high', weather: { windSpeedMps: u, windFromDeg: 270 }, settings: { rateModel: 'rothermel' }, durationSeconds: 6 * 3600 }));
      expect(r.stats.maxIntensityKwM).toBeGreaterThanOrEqual(last);
      last = r.stats.maxIntensityKwM;
      let maxI = 0;
      let maxL = 0;
      for (let i = 0; i < r.arrivalTime.length; i++) {
        expect(Number.isFinite(r.firelineIntensityKwM[i])).toBe(true);
        expect(Number.isFinite(r.flameLengthM[i])).toBe(true);
        expect(r.firelineIntensityKwM[i]).toBeGreaterThanOrEqual(0);
        maxI = Math.max(maxI, r.firelineIntensityKwM[i]);
        maxL = Math.max(maxL, r.flameLengthM[i]);
      }
      expect(r.stats.maxIntensityKwM).toBeCloseTo(maxI, 3);
      expect(r.stats.maxFlameLengthM).toBeCloseTo(maxL, 3);
    }
  });

  it('values are in a believable range for the default scenario (flame lengths 0.1 - 40 m)', () => {
    for (const rateModel of ['factors', 'rothermel'] as const) {
      const r = simulate(makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 25 }], dryness: 'extreme', weather: { windSpeedMps: 10, windFromDeg: 250 }, settings: { rateModel }, durationSeconds: 12 * 3600 }));
      expect(r.stats.maxFlameLengthM, rateModel).toBeGreaterThan(0.1);
      expect(r.stats.maxFlameLengthM, rateModel).toBeLessThan(40);
    }
  });
});
