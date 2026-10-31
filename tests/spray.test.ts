import { describe, expect, it } from 'vitest';
import { FUELS, FuelClass } from '../src/contract';
import type { Intervention } from '../src/contract';
import { simulate } from '../src/sim';
import { crossWetEdge } from '../src/sim/crossing';
import type { Crossing } from '../src/sim/crossing';
import { buildEventLayers, moistureAt, sprayContribution, timeUntilMoisture } from '../src/sim/events';
import { createRateFn } from '../src/sim/models';
import type { EdgeInput } from '../src/sim/models';
import { DEFAULT_SETTINGS } from '../src/contract';
import { idx, makeFixture } from './fixtures';

const water = (id: string, t: number, cells: number[], boost: number, half: number): Intervention => ({ id, tSeconds: t, type: 'water', cells, params: { moistureBoost: boost, halfLifeS: half } });

describe('spray bookkeeping', () => {
  it('moisture is base before the spray, base + boost at the spray, and halves every half-life', () => {
    const L = buildEventLayers([water('a', 100, [3], 0.4, 600)], 10, DEFAULT_SETTINGS);
    expect(moistureAt(L, 3, 99, 0.1)).toBeCloseTo(0.1, 12);
    expect(moistureAt(L, 3, 100, 0.1)).toBeCloseTo(0.5, 12);
    expect(moistureAt(L, 3, 700, 0.1)).toBeCloseTo(0.3, 12);
    expect(moistureAt(L, 3, 1300, 0.1)).toBeCloseTo(0.2, 12);
    expect(moistureAt(L, 4, 100, 0.1)).toBeCloseTo(0.1, 12); // unsprayed cell
  });

  it('overlapping sprays: the wettest dominates, so a later weak spray cannot cancel an earlier strong one', () => {
    const L = buildEventLayers([water('strong', 0, [1], 0.6, 3000), water('weak', 500, [1], 0.05, 60)], 5, DEFAULT_SETTINGS);
    const strongAlone = buildEventLayers([water('strong', 0, [1], 0.6, 3000)], 5, DEFAULT_SETTINGS);
    for (const t of [0, 100, 499, 500, 501, 900, 2000, 5000]) {
      expect(sprayContribution(L, 1, t)).toBeGreaterThanOrEqual(sprayContribution(strongAlone, 1, t) - 1e-12);
      expect(sprayContribution(L, 1, t)).toBeCloseTo(sprayContribution(strongAlone, 1, t), 12);
    }
    // And a stronger later spray takes over.
    const L2 = buildEventLayers([water('a', 0, [1], 0.2, 600), water('b', 1000, [1], 0.5, 600)], 5, DEFAULT_SETTINGS);
    expect(sprayContribution(L2, 1, 1000)).toBeCloseTo(0.5, 12);
  });

  it('ignores sprays that do nothing (zero boost or zero half-life) without NaNs', () => {
    const L = buildEventLayers([water('z1', 0, [1], 0, 600), water('z2', 0, [1], 0.4, 0)], 5, DEFAULT_SETTINGS);
    expect(L.hasWater).toBe(false);
    expect(moistureAt(L, 1, 10, 0.1)).toBe(0.1);
  });

  it('timeUntilMoisture: closed form for one spray, fixed point across overlapping sprays', () => {
    const one = buildEventLayers([water('a', 0, [1], 0.4, 600)], 5, DEFAULT_SETTINGS);
    // base 0.1, target 0.2: the spray must decay to 0.1.  0.4 * 2^(-t/600) = 0.1  ->  t = 2 half-lives = 1200
    expect(timeUntilMoisture(one, 1, 0.1, 0.2, 0)).toBeCloseTo(1200, 6);
    expect(timeUntilMoisture(one, 1, 0.1, 0.15, 0)).toBeCloseTo(600 * Math.log2(0.4 / 0.05), 6);
    expect(timeUntilMoisture(one, 1, 0.1, 0.1, 0)).toBe(Infinity); // never reaches base exactly
    expect(timeUntilMoisture(one, 2, 0.1, 0.2, 50)).toBe(50); // unsprayed cell is already dry
    // A second spray that starts before the first has dried pushes the dry time out.
    const two = buildEventLayers([water('a', 0, [1], 0.4, 600), water('b', 500, [1], 0.4, 600)], 5, DEFAULT_SETTINGS);
    const t2 = timeUntilMoisture(two, 1, 0.1, 0.2, 0);
    expect(t2).toBeCloseTo(500 + 600 * Math.log2(0.4 / 0.1), 6);
    // A spray that starts after the cell was dry does not matter for "first dry time from tFrom".
    const late = buildEventLayers([water('a', 0, [1], 0.4, 600), water('b', 5000, [1], 0.4, 600)], 5, DEFAULT_SETTINGS);
    expect(timeUntilMoisture(late, 1, 0.1, 0.2, 0)).toBeCloseTo(1200, 6);
  });
});

describe('crossing a sprayed edge', () => {
  const settings = { ...DEFAULT_SETTINGS };
  const s = makeFixture({ settings });
  const rateFn = createRateFn(s);
  const base = 0.08;
  const mx = FUELS[FuelClass.FOREST_CONIFER].extinctionMoisture;
  const mkEdge = (): EdgeInput => ({ fuel: FuelClass.FOREST_CONIFER, moisture: base, cosTheta: 0.7, windSpeedMps: 5, dz: 4, dist: 30 });
  const cross = (layers: ReturnType<typeof buildEventLayers>, tStart: number, burnout = Infinity): number => {
    const out: Crossing = { t: 0, rate: 0 };
    crossWetEdge(layers, 1, tStart, 30, base, mx, burnout, 1e9, rateFn, mkEdge(), out);
    return out.t;
  };
  const unsprayed = (tStart: number): number => {
    const e = mkEdge();
    return tStart + 30 / rateFn(e);
  };

  it('with no spray on the target it matches the closed form exactly', () => {
    const L = buildEventLayers([water('a', 0, [2], 0.4, 600)], 5, settings); // sprays a DIFFERENT cell
    // cell 1 has no spray: its sprayFirst is Infinity so firstBoundary is Infinity -> base rate throughout
    for (const t0 of [0, 17.3, 1000]) expect(cross(L, t0)).toBeCloseTo(unsprayed(t0), 6);
  });

  it('FIFO: the crossing time never decreases when the front starts later (fine sweep of start times)', () => {
    const L = buildEventLayers([water('a', 200, [1], 0.45, 900), water('b', 1500, [1], 0.3, 400)], 5, settings);
    let prev = -Infinity;
    for (let t0 = 0; t0 <= 12000; t0 += 7.3) {
      const t = cross(L, t0);
      if (t === Infinity) continue;
      expect(t + 1e-6, `start ${t0}`).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(prev).toBeGreaterThan(0);
  });

  it('never earlier than the unsprayed crossing, and approaches it as the water dries out', () => {
    const L = buildEventLayers([water('a', 0, [1], 0.5, 600)], 5, settings);
    let lastExtra = Infinity;
    for (const t0 of [0, 600, 1500, 3000, 6000, 12000]) {
      const t = cross(L, t0);
      expect(t).toBeGreaterThanOrEqual(unsprayed(t0) - 1e-6);
      const extra = t - unsprayed(t0);
      expect(extra).toBeLessThanOrEqual(lastExtra + 1e-6);
      lastExtra = extra;
    }
    expect(lastExtra).toBeLessThan(0.5);
  });

  it('waits for a too-wet cell to dry only while the source is still burning', () => {
    const L = buildEventLayers([water('a', 0, [1], 0.6, 600)], 5, settings); // 0.08+0.6 > mx for a long time
    const dry = timeUntilMoisture(L, 1, base, mx * (1 - 1e-6), 0);
    expect(dry).toBeGreaterThan(300);
    expect(cross(L, 0, dry + 1000)).toBeGreaterThan(dry); // source outlives the wet period: crosses after it
    expect(cross(L, 0, dry - 1)).toBe(Infinity); // source burns out first: cannot ignite it
  });

  it('a spray that starts while the front is mid-crossing still slows it', () => {
    const early = buildEventLayers([water('a', 5000, [1], 0.5, 600)], 5, settings);
    const t0 = 4990;
    expect(cross(early, t0)).toBeGreaterThan(unsprayed(t0));
  });
});

describe('burnout and water (documented non-monotone case)', () => {
  it('a delayed fire can ignite a sprayed cell that an earlier, shorter-lived fire could not', () => {
    // 1-D strip of GRASS (burns 300 s) with a sprayed cell at the end: the early front burns out against the
    // wet cell and fire still gets there via a slower, longer-burning shrub path only if delayed.
    const s = makeFixture({ river: false, road: false, fuelClass: FuelClass.GRASS, ignition: [{ row: 25, col: 10 }], weather: { windSpeedMps: 0 }, durationSeconds: 24 * 3600 });
    const cells = [idx(25, 14)];
    const sprayed = { ...s, interventions: [water('w', 0, cells, 0.6, 3000)] };
    const withBurnout = simulate({ ...sprayed, settings: { ...s.settings, burnoutEnabled: true } });
    const withoutBurnout = simulate({ ...sprayed, settings: { ...s.settings, burnoutEnabled: false } });
    // Without burnout the fire eventually gets through (water decays); with burnout the 5-minute grass
    // front dies at the wet cell, but it can still be reached by going around via its dry neighbours.
    expect(withoutBurnout.arrivalTime[idx(25, 14)]).toBeLessThan(Infinity);
    expect(withBurnout.arrivalTime[idx(25, 14)]).toBeGreaterThanOrEqual(withoutBurnout.arrivalTime[idx(25, 14)] - 1e-6);
  });
});
