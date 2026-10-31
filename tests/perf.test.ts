import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FuelClass, applyDrynessPreset } from '../src/contract';
import type { Scenario } from '../src/contract';
import { mulberry32 } from '../src/sim/prng';
import { simulate } from '../src/sim';
import { runEnsemble } from '../src/sim/ensemble';
import { DEFAULT_ENSEMBLE_SPEC } from '../src/contract';

function bigScenario(width: number, height: number): Scenario {
  const n = width * height;
  const rand = mulberry32(7);
  const fuel = new Uint8Array(n);
  const elevation = new Float32Array(n);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const v = rand();
      fuel[i] = v < 0.45 ? FuelClass.FOREST_CONIFER : v < 0.8 ? FuelClass.GRASS : v < 0.95 ? FuelClass.SHRUB : FuelClass.NONE;
      elevation[i] = 200 + 60 * Math.sin(c / 17) + 40 * Math.cos(r / 23);
    }
  }
  return {
    grid: {
      width,
      height,
      cellSizeM: 30,
      originLon: -122.2,
      originLat: 37.2,
      bounds: { west: -122.2, south: 37.15, east: -122.13, north: 37.2 },
    },
    fuel,
    elevation,
    weather: applyDrynessPreset({ ...DEFAULT_WEATHER, windSpeedMps: 8, windFromDeg: 240 }, 'extreme'),
    ignition: [{ row: height >> 1, col: width >> 1 }],
    interventions: [],
    durationSeconds: 24 * 3600,
    seed: 3,
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe('performance', () => {
  it('simulates a 200 x 200 grid well under 1 s', () => {
    const s = bigScenario(200, 200);
    simulate(s); // warm up JIT
    const t0 = performance.now();
    const r = simulate(s);
    const ms = performance.now() - t0;
    console.log(`200x200 simulate: ${ms.toFixed(1)} ms, burned ${r.stats.burnedCells} cells (reported ${r.stats.runtimeMs.toFixed(1)} ms)`);
    expect(ms).toBeLessThan(1000);
    expect(r.stats.burnedCells).toBeGreaterThan(1000);
  });

  it('Rothermel on 200 x 200 stays under 1 s', () => {
    const s = { ...bigScenario(200, 200), settings: { ...DEFAULT_SETTINGS, rateModel: 'rothermel' as const } };
    simulate(s);
    const t0 = performance.now();
    const r = simulate(s);
    const ms = performance.now() - t0;
    console.log(`200x200 rothermel: ${ms.toFixed(1)} ms, burned ${r.stats.burnedCells} cells`);
    expect(ms).toBeLessThan(1000);
    expect(r.stats.burnedCells).toBeGreaterThan(500);
  });

  it('200 x 200 with ~1500 sprayed cells (several long strokes, slow decay) stays under 1.5 s', () => {
    for (const rateModel of ['factors', 'rothermel'] as const) {
      const base = bigScenario(200, 200);
      const cells = (r0: number, c0: number, len: number, vertical: boolean): number[] => {
        const out: number[] = [];
        for (let k = 0; k < len; k++) for (let w = -2; w <= 2; w++) out.push(vertical ? (r0 + k) * 200 + c0 + w : (r0 + w) * 200 + c0 + k);
        return out;
      };
      const interventions = [
        { id: 'a', tSeconds: 0, type: 'water' as const, cells: cells(20, 120, 150, true), params: { halfLifeS: 3600, moistureBoost: 0.5 } },
        { id: 'b', tSeconds: 600, type: 'water' as const, cells: cells(120, 20, 150, false), params: { halfLifeS: 1800, moistureBoost: 0.4 } },
        { id: 'c', tSeconds: 1800, type: 'water' as const, cells: cells(30, 60, 100, true), params: { halfLifeS: 7200, moistureBoost: 0.6 } },
      ];
      const s = { ...base, interventions, settings: { ...DEFAULT_SETTINGS, rateModel } };
      simulate(s);
      const t0 = performance.now();
      const r = simulate(s);
      const ms = performance.now() - t0;
      console.log(`200x200 ${rateModel} + ${interventions.reduce((n, i) => n + i.cells.length, 0)} sprayed cells: ${ms.toFixed(1)} ms, burned ${r.stats.burnedCells}`);
      expect(ms).toBeLessThan(1500);
    }
  });

  it('spotting at its heaviest (8 embers per cell, low threshold, gale) on 300 x 300 stays under 2 s', () => {
    const base = bigScenario(300, 300);
    for (let i = 0; i < base.fuel.length; i++) if (base.fuel[i] === FuelClass.GRASS) base.fuel[i] = FuelClass.FOREST_CONIFER;
    const s = { ...base, weather: { ...base.weather, windSpeedMps: 18 }, settings: { ...DEFAULT_SETTINGS, spottingEnabled: true, spottingEmbers: 8, spottingIntensityKwM: 200, spottingRangeScale: 2, spottingIgnitionProb: 0.5 } };
    simulate(s);
    const t0 = performance.now();
    const r = simulate(s);
    const ms = performance.now() - t0;
    console.log(`300x300 heavy spotting: ${ms.toFixed(1)} ms, burned ${r.stats.burnedCells}, spot fires ${r.stats.spotFires}`);
    expect(r.stats.spotFires).toBeGreaterThan(100);
    expect(ms).toBeLessThan(2000);
  });

  it('a changing-weather schedule on 300 x 300 stays under 2.5 s, with and without spotting', () => {
    for (const spottingEnabled of [false, true]) {
      const base = bigScenario(300, 300);
      const w = base.weather;
      const s = {
        ...base,
        weatherSchedule: [{ tSeconds: 3600, windSpeedMps: 14, windFromDeg: 300 }, { tSeconds: 3 * 3600, windSpeedMps: 5, windFromDeg: 200, relativeHumidity: 0.5 }, { tSeconds: 9 * 3600, relativeHumidity: 0.2 }],
        settings: { ...DEFAULT_SETTINGS, spottingEnabled, spottingIgnitionProb: 0.05 },
        weather: { ...w, windSpeedMps: 8 },
      };
      simulate(s);
      const t0 = performance.now();
      const r = simulate(s);
      const ms = performance.now() - t0;
      console.log(`300x300 weather schedule (spotting ${spottingEnabled}): ${ms.toFixed(1)} ms, burned ${r.stats.burnedCells}`);
      expect(ms).toBeLessThan(2500);
    }
  });

  it('a 100-run ensemble on 200 x 200: under 6 s plain/Rothermel, under 15 s with spotting + a weather schedule', () => {
    const plain = bigScenario(200, 200);
    const variants = {
      plain,
      rothermel: { ...plain, settings: { ...DEFAULT_SETTINGS, rateModel: 'rothermel' as const } },
      'spotting + schedule': {
        ...plain,
        weatherSchedule: [{ tSeconds: 3600, windSpeedMps: 12, windFromDeg: 300 }, { tSeconds: 4 * 3600, relativeHumidity: 0.5 }],
        settings: { ...DEFAULT_SETTINGS, spottingEnabled: true, spottingIgnitionProb: 0.05 },
      },
    };
    for (const [name, sc] of Object.entries(variants)) {
      const t0 = performance.now();
      const e = runEnsemble(sc, { ...DEFAULT_ENSEMBLE_SPEC, runs: 100 })!;
      const ms = performance.now() - t0;
      console.log(`100-run ensemble, 200x200, ${name}: ${(ms / 1000).toFixed(2)} s (${(ms / 100).toFixed(0)} ms/run), mean ${e.area.meanHa.toFixed(0)} ha`);
      // The heavy variant burns almost the whole grid with time-integrated edges and embers: ~80 ms per run.
      expect(ms).toBeLessThan(name === 'spotting + schedule' ? 15000 : 6000);
    }
  }, 60_000); // three 100-run ensembles take ~15 s together; vitest's default timeout is 5 s

  it('simulates a 300 x 300 grid (the cap) under 2 s', () => {
    const s = bigScenario(300, 300);
    const t0 = performance.now();
    simulate(s);
    const ms = performance.now() - t0;
    console.log(`300x300 simulate: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
