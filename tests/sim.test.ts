import { describe, expect, it } from 'vitest';
import { FUELS, FuelClass } from '../src/contract';
import type { Intervention } from '../src/contract';
import { simulate } from '../src/sim';
import { FIX_H, FIX_W, ROAD_ROW, countBurned, idx, makeFixture } from './fixtures';

describe('wind', () => {
  it('wind FROM the west (270) drives fire east much faster than west', () => {
    const s = makeFixture({ road: false, dryness: 'extreme', weather: { windSpeedMps: 8, windFromDeg: 270 } });
    const { arrivalTime } = simulate(s);
    const east = arrivalTime[idx(35, 38)]; // 18 cells downwind, just before the river
    const westFar = arrivalTime[idx(35, 2)]; // 18 cells upwind
    const westNear = arrivalTime[idx(35, 17)]; // 3 cells upwind: backing fire creeps
    expect(east).toBeLessThan(Infinity);
    expect(westNear).toBeLessThan(Infinity);
    expect(westNear).toBeGreaterThan(arrivalTime[idx(35, 23)] * 3);
    expect(westFar === Infinity || westFar / east > 3).toBe(true);
  });

  it('with no wind the spread is symmetric east/west', () => {
    const s = makeFixture({ river: false, road: false, weather: { windSpeedMps: 0 } });
    const { arrivalTime } = simulate(s);
    expect(arrivalTime[idx(35, 30)]).toBeCloseTo(arrivalTime[idx(35, 10)], 3);
  });
});

describe('slope', () => {
  it('spreads faster uphill (north) than downhill (south), all else equal', () => {
    const s = makeFixture({ road: false, slopeNorth: true, ignition: [{ row: 25, col: 20 }] });
    const { arrivalTime } = simulate(s);
    const up = arrivalTime[idx(7, 20)];
    const down = arrivalTime[idx(43, 20)];
    expect(up).toBeLessThan(Infinity);
    expect(down / up).toBeGreaterThan(1.5);
  });
});

describe('moisture', () => {
  it('higher base moisture burns fewer cells in the same time', () => {
    const dry = simulate(makeFixture({ dryness: 'extreme', durationSeconds: 4 * 3600 }));
    const wet = simulate(makeFixture({ dryness: 'low', durationSeconds: 4 * 3600 }));
    expect(countBurned(dry.arrivalTime)).toBeGreaterThan(countBurned(wet.arrivalTime) * 1.5);
  });

  it('at or above the moisture of extinction nothing spreads', () => {
    const mx = FUELS[FuelClass.FOREST_CONIFER].extinctionMoisture;
    const s = makeFixture({ weather: { baseFuelMoisture: mx } });
    const { arrivalTime, stats } = simulate(s);
    expect(countBurned(arrivalTime)).toBe(1);
    expect(stats.burnedCells).toBe(1);
  });
});

describe('barriers', () => {
  it('fire does not cross the river', () => {
    const s = makeFixture({ road: false, weather: { windSpeedMps: 10, windFromDeg: 270 } });
    const { arrivalTime } = simulate(s);
    for (let r = 0; r < FIX_H; r++) {
      for (let c = 40; c < FIX_W; c++) expect(arrivalTime[idx(r, c)]).toBe(Infinity);
    }
    expect(arrivalTime[idx(35, 39)]).toBeLessThan(Infinity);
  });

  it('fire does not cross a full road but does through a gap', () => {
    const windNorth = { windSpeedMps: 10, windFromDeg: 180 };
    const closed = simulate(makeFixture({ weather: windNorth }));
    for (let r = 0; r < ROAD_ROW; r++) {
      for (let c = 0; c < FIX_W; c++) expect(closed.arrivalTime[idx(r, c)]).toBe(Infinity);
    }
    const open = simulate(makeFixture({ weather: windNorth, roadGap: true }));
    let northBurned = 0;
    for (let r = 0; r < ROAD_ROW; r++) for (let c = 0; c < FIX_W; c++) if (open.arrivalTime[idx(r, c)] !== Infinity) northBurned++;
    expect(northBurned).toBeGreaterThan(50);
  });

  it('a fully spanning firebreak at t=0 blocks spread; one at time T leaves earlier arrivals unchanged', () => {
    const base = makeFixture({ road: false, weather: { windSpeedMps: 10, windFromDeg: 180 } });
    const baseline = simulate(base);

    const cells: number[] = [];
    for (let c = 0; c < FIX_W; c++) cells.push(idx(20, c));
    const preClear: Intervention = { id: 'fb0', tSeconds: 0, type: 'firebreak', cells };
    const blocked = simulate({ ...base, interventions: [preClear] });
    for (let r = 0; r <= 20; r++) {
      for (let c = 0; c < FIX_W; c++) expect(blocked.arrivalTime[idx(r, c)]).toBe(Infinity);
    }
    expect(countBurned(blocked.arrivalTime)).toBeLessThan(countBurned(baseline.arrivalTime));

    // Break cut at time T: everything that burned before T is identical; nothing crosses after.
    const T = baseline.arrivalTime[idx(28, 20)] + 60;
    const late = simulate({ ...base, interventions: [{ ...preClear, id: 'fbT', tSeconds: T }] });
    for (let i = 0; i < baseline.arrivalTime.length; i++) {
      if (baseline.arrivalTime[i] < T) expect(late.arrivalTime[i]).toBe(baseline.arrivalTime[i]);
    }
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < FIX_W; c++) {
        const a = late.arrivalTime[idx(r, c)];
        expect(a === Infinity || a < T).toBe(true);
      }
    }
  });
});

describe('water', () => {
  it('water at t=0 on a band ahead of the fire delays arrival behind it', () => {
    const base = makeFixture({ road: false, weather: { windSpeedMps: 8, windFromDeg: 270 } });
    const baseline = simulate(base);
    const cells: number[] = [];
    for (let r = 0; r < FIX_H; r++) for (const c of [30, 31, 32]) cells.push(idx(r, c));
    const probe = idx(35, 36);
    // Default 10-minute half-life: the band is nearly dry when the fire gets there ~55 min in,
    // so the delay is small but must exist.
    const quick: Intervention = { id: 'w0', tSeconds: 0, type: 'water', cells };
    const sprayedQuick = simulate({ ...base, interventions: [quick] });
    expect(sprayedQuick.arrivalTime[probe]).toBeGreaterThan(baseline.arrivalTime[probe]);
    // Long-lasting water (1 h half-life) holds the band above extinction and delays a lot.
    const slow: Intervention = { ...quick, id: 'w1', params: { halfLifeS: 3600 } };
    const sprayedSlow = simulate({ ...base, interventions: [slow] });
    expect(sprayedSlow.arrivalTime[probe]).toBeGreaterThan(baseline.arrivalTime[probe] * 1.3);
    // Upwind of the band nothing changes.
    expect(sprayedSlow.arrivalTime[idx(35, 25)]).toBe(baseline.arrivalTime[idx(35, 25)]);
  });

  it('water eventually dries and the fire gets through', () => {
    const base = makeFixture({ road: false, weather: { windSpeedMps: 8, windFromDeg: 270 } });
    const cells: number[] = [];
    for (let r = 0; r < FIX_H; r++) cells.push(idx(r, 30));
    const water: Intervention = { id: 'w0', tSeconds: 0, type: 'water', cells, params: { halfLifeS: 120 } };
    const sprayed = simulate({ ...base, interventions: [water] });
    expect(sprayed.arrivalTime[idx(35, 36)]).toBeLessThan(Infinity);
  });
});

describe('determinism', () => {
  it('same scenario and seed give byte-identical arrival times', () => {
    const s = makeFixture({ weather: { windSpeedMps: 7, windFromDeg: 200, windVariabilityDeg: 25 } });
    const a = simulate(s).arrivalTime;
    const b = simulate(s).arrivalTime;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });

  it('a different seed with wind variability gives a different (but similar) result', () => {
    const w = { windSpeedMps: 7, windFromDeg: 200, windVariabilityDeg: 25 };
    const a = simulate(makeFixture({ weather: w, seed: 1 }));
    const b = simulate(makeFixture({ weather: w, seed: 2 }));
    expect(Buffer.from(a.arrivalTime.buffer).equals(Buffer.from(b.arrivalTime.buffer))).toBe(false);
    const ratio = a.stats.burnedCells / b.stats.burnedCells;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});

describe('fuel', () => {
  it('grass spreads faster than conifer forest under the same conditions', () => {
    const grass = simulate(makeFixture({ fuelClass: FuelClass.GRASS, durationSeconds: 3600 }));
    const forest = simulate(makeFixture({ fuelClass: FuelClass.FOREST_CONIFER, durationSeconds: 3600 }));
    expect(grass.stats.burnedCells).toBeGreaterThan(forest.stats.burnedCells);
  });

  it('reports stats and relative intensity', () => {
    const r = simulate(makeFixture({ weather: { windSpeedMps: 5 } }));
    expect(r.stats.burnedAreaHa).toBeCloseTo(r.stats.burnedCells * 0.09, 6);
    expect(r.stats.maxSpreadRateMps).toBeGreaterThan(0);
    expect(r.intensity).toBeDefined();
    let max = 0;
    for (const v of r.intensity ?? []) max = Math.max(max, v);
    expect(max).toBeCloseTo(1, 6);
  });
});
