import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FuelClass, applyDrynessPreset } from '../src/contract';
import type { Scenario } from '../src/contract';
import { mulberry32 } from '../src/sim/prng';
import { simulate } from '../src/sim';

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

  it('simulates a 300 x 300 grid (the cap) under 2 s', () => {
    const s = bigScenario(300, 300);
    const t0 = performance.now();
    simulate(s);
    const ms = performance.now() - t0;
    console.log(`300x300 simulate: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
