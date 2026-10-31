import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_WEATHER,
  DRYNESS_PRESETS,
  DRYNESS_PRESET_ORDER,
  ELEVATION_NODATA,
  FUELS,
  FuelClass,
  applyDrynessPreset,
  cellIndex,
  cellRowCol,
  deriveFuelMoisture,
  isBurnable,
  validateScenario,
  windTowardDeg,
} from '../src/contract';
import type { Scenario } from '../src/contract';

function tinyScenario(): Scenario {
  const width = 4;
  const height = 3;
  return {
    grid: {
      width,
      height,
      cellSizeM: 30,
      originLon: 10,
      originLat: 50,
      bounds: { west: 10, south: 49.999, east: 10.001, north: 50 },
    },
    fuel: new Uint8Array(width * height).fill(FuelClass.GRASS),
    elevation: new Float32Array(width * height).fill(100),
    weather: { ...DEFAULT_WEATHER },
    ignition: [{ row: 1, col: 1 }],
    interventions: [],
    durationSeconds: 3600,
    seed: 1,
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe('conventions', () => {
  it('indexes row-major with row 0 at the top', () => {
    expect(cellIndex(0, 0, 10)).toBe(0);
    expect(cellIndex(2, 3, 10)).toBe(23);
    expect(cellRowCol(23, 10)).toEqual({ row: 2, col: 3 });
  });

  it('wind FROM the west pushes fire toward the east', () => {
    expect(windTowardDeg(270)).toBe(90);
    expect(windTowardDeg(0)).toBe(180);
    expect(windTowardDeg(90)).toBe(270);
  });
});

describe('fuels and presets', () => {
  it('NONE is never burnable, every other class is', () => {
    expect(isBurnable(FuelClass.NONE)).toBe(false);
    for (const c of [FuelClass.GRASS, FuelClass.SHRUB, FuelClass.FOREST_CONIFER, FuelClass.FARMLAND]) {
      expect(isBurnable(c)).toBe(true);
      expect(FUELS[c].extinctionMoisture).toBeGreaterThan(0);
    }
  });

  it('drier presets give lower fuel moisture, monotonically', () => {
    const moistures = DRYNESS_PRESET_ORDER.map((p) =>
      deriveFuelMoisture(DRYNESS_PRESETS[p].temperatureC, DRYNESS_PRESETS[p].relativeHumidity),
    );
    for (let i = 1; i < moistures.length; i++) expect(moistures[i]).toBeLessThan(moistures[i - 1]);
    expect(moistures[moistures.length - 1]).toBeLessThan(0.06);
    expect(moistures[0]).toBeGreaterThan(0.15);
  });

  it('applying a preset only touches temperature, humidity and moisture', () => {
    const w = applyDrynessPreset({ ...DEFAULT_WEATHER, windSpeedMps: 3, windFromDeg: 45 }, 'extreme');
    expect(w.windSpeedMps).toBe(3);
    expect(w.windFromDeg).toBe(45);
    expect(w.relativeHumidity).toBe(DRYNESS_PRESETS.extreme.relativeHumidity);
    expect(w.baseFuelMoisture).toBeCloseTo(deriveFuelMoisture(38, 0.08));
  });
});

describe('validateScenario', () => {
  it('accepts a well-formed scenario', () => {
    expect(validateScenario(tinyScenario())).toEqual([]);
  });

  it('rejects wrong array lengths, nodata elevation, bad ignition and spotting', () => {
    const s = tinyScenario();
    s.fuel = new Uint8Array(5);
    expect(validateScenario(s).some((e) => e.includes('fuel length'))).toBe(true);

    const s2 = tinyScenario();
    s2.elevation[3] = ELEVATION_NODATA;
    expect(validateScenario(s2).some((e) => e.includes('nodata'))).toBe(true);

    const s3 = tinyScenario();
    s3.ignition = [{ row: 9, col: 0 }];
    expect(validateScenario(s3).some((e) => e.includes('outside grid'))).toBe(true);

    const s4 = tinyScenario();
    s4.settings.spottingEnabled = true;
    expect(validateScenario(s4).some((e) => e.includes('spotting'))).toBe(true);
  });
});
