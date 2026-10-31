/**
 * Emergency response planner: lines only touch burnable cells, never homes; crews build
 * progressively and can be outrun; the contained run never burns more than the baseline; and a
 * bigger response saves at least as much as a smaller one on the synthetic valley.
 */

import { describe, expect, it } from 'vitest';
import { FuelClass, validateScenario } from '../src/contract';
import type { CellRef, Intervention, Scenario } from '../src/contract';
import { scenarioFromArea } from '../src/data/bundle';
import { defaultIgnition } from '../src/data/ignition';
import { makeSyntheticArea } from '../src/data/synthetic';
import { simulate } from '../src/sim';
import {
  LEVELS,
  RESPONSE_LEVELS,
  UNITS,
  buildDropSeries,
  buildLineSegments,
  candidateLines,
  defaultStations,
  planContainment,
  unitKinematicsAt,
} from '../src/contain';
import type { ContainPlan, ResponseLevel } from '../src/contain';
import { makeFixture } from './fixtures';

function valley(width = 120, height = 120): { scenario: Scenario; ignition: CellRef } {
  const area = makeSyntheticArea({ name: 't-valley', label: 'Test valley', centerLon: 8.4, centerLat: 48.3, seed: 11, style: 'valley', width, height });
  const ignition = defaultIgnition(area) ?? { row: height >> 1, col: width >> 1 };
  const scenario = scenarioFromArea(area, { weather: { windSpeedMps: 6, windFromDeg: 250, baseFuelMoisture: 0.06 }, ignition: [ignition], durationSeconds: 6 * 3600 });
  return { scenario, ignition };
}

const plans = new Map<ResponseLevel, ContainPlan>();
function planFor(level: ResponseLevel): ContainPlan {
  let p = plans.get(level);
  if (!p) {
    p = planContainment({ scenario: valley().scenario, level, homes: null });
    plans.set(level, p);
  }
  return p;
}

describe('line building', () => {
  const sc = makeFixture({ dryness: 'high', weather: { windSpeedMps: 4 }, durationSeconds: 6 * 3600 });
  const base = simulate(sc);
  const path = [[10.5, 10.5], [30.5, 10.5]] as const;

  it('hand line: one cell wide, burnable cells only, non-decreasing completion times, bounded length', () => {
    const b = buildLineSegments(sc.grid, sc.fuel, null, [...path], UNITS.handcrew, 600, 300, base.arrivalTime, 'x');
    expect(b.segments.length).toBeGreaterThan(0);
    let last = -1;
    for (const s of b.segments) {
      expect(s.type).toBe('firebreak');
      expect(s.tSeconds).toBeGreaterThanOrEqual(last);
      last = s.tSeconds;
      for (const c of s.cells) expect(sc.fuel[c]).not.toBe(FuelClass.NONE);
    }
    expect(b.lengthM).toBeLessThanOrEqual(300);
    // Production bound: conifer factor 0.5 → 7.5 m/min for a hand crew.
    const maxLen = (UNITS.handcrew.lineRateMpm * 1.3 * (b.endT - b.startT)) / 60 + sc.grid.cellSizeM;
    expect(b.lengthM).toBeLessThanOrEqual(maxLen);
  });

  it('a crew is outrun: a line across the fire path stops where the fire arrives first', () => {
    // Row 34, two cells north of the ignition at (35, 20): the fire gets there in minutes.
    const b = buildLineSegments(sc.grid, sc.fuel, null, [[5.5, 34.5], [45.5, 34.5]], UNITS.handcrew, 0, 2000, base.arrivalTime, 'y');
    for (const c of b.cells) expect(base.arrivalTime[c]).toBeGreaterThan(0);
    expect(b.lengthM).toBeLessThan(2000);
  });

  it('never cuts through or beside homes; dozers keep a 3-cell clearance', () => {
    const homes = new Uint16Array(sc.fuel.length);
    const fuel = new Uint8Array(sc.fuel);
    const W = sc.grid.width;
    homes[10 * W + 20] = 2;
    fuel[10 * W + 20] = FuelClass.NONE;
    const hand = buildLineSegments(sc.grid, fuel, homes, [...path], UNITS.handcrew, 600, 3000, base.arrivalTime, 'h');
    for (const c of hand.cells) expect(homes[c]).toBe(0);
    const dozer = buildLineSegments(sc.grid, fuel, homes, [...path], UNITS.dozer, 600, 3000, base.arrivalTime, 'd', { forestAllowed: true });
    for (const c of dozer.cells) {
      const r = Math.floor(c / W);
      const col = c % W;
      expect(Math.max(Math.abs(r - 10), Math.abs(col - 20))).toBeGreaterThan(3);
    }
  });

  it('dozers stay out of forest unless the level allows it', () => {
    const b = buildLineSegments(sc.grid, sc.fuel, null, [...path], UNITS.dozer, 600, 3000, base.arrivalTime, 'd');
    expect(b.cells.length).toBe(0);
  });

  it('aircraft drop short water lines once per reload cycle, never on burning cells', () => {
    const b = buildDropSeries(sc.grid, sc.fuel, null, [[5.5, 20.5], [45.5, 20.5]], UNITS.helicopter, 1200, 4, 6 * 3600, base.arrivalTime, 'a');
    expect(b.segments.length).toBeGreaterThan(0);
    expect(b.segments.length).toBeLessThanOrEqual(4);
    b.segments.forEach((s, i) => {
      expect(s.type).toBe('water');
      expect(s.cells.length).toBeLessThanOrEqual(UNITS.helicopter.dropCells);
      expect(s.tSeconds).toBe(1200 + i * UNITS.helicopter.turnaroundS);
      for (const c of s.cells) expect(base.arrivalTime[c]).toBeGreaterThan(s.tSeconds);
    });
  });

  it('candidates: one per sector, inside the grid, ranked, excludable', () => {
    const c = candidateLines(sc.grid, sc.fuel, null, sc.ignition[0], sc.weather.windFromDeg, base.arrivalTime, 1800, 12, 6);
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < c.length; i++) expect(c[i - 1].threat).toBeGreaterThanOrEqual(c[i].threat);
    for (const cand of c) for (const [x, y] of cand.path) {
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
      expect(x).toBeLessThan(sc.grid.width);
      expect(y).toBeLessThan(sc.grid.height);
    }
    const ex = candidateLines(sc.grid, sc.fuel, null, sc.ignition[0], sc.weather.windFromDeg, base.arrivalTime, 1800, 12, 8, { exclude: new Set(c.map((k) => k.sector)) });
    for (const k of ex) expect(c.map((q) => q.sector)).not.toContain(k.sector);
  });
});

describe('stations', () => {
  it('ground units enter where roads leave the grid; air units from other sides', () => {
    const { scenario } = valley();
    const st = defaultStations(scenario.grid, scenario.fuel, LEVELS.maximum.roster);
    expect(st.length).toBe(Object.values(LEVELS.maximum.roster).reduce((a, b) => a + b, 0));
    const ground = st.filter((s) => !UNITS[s.type].airborne);
    for (const s of ground) {
      const edge = s.entry.row === 0 || s.entry.col === 0 || s.entry.row === scenario.grid.height - 1 || s.entry.col === scenario.grid.width - 1;
      expect(edge).toBe(true);
      expect(s.baseToEntryKm).toBeGreaterThan(5);
      expect(s.baseToEntryKm).toBeLessThan(7);
    }
  });
});

describe('planner', () => {
  it('every level: valid scenario, nothing before the delay, contained never burns more than baseline', () => {
    for (const level of RESPONSE_LEVELS) {
      const p = planFor(level);
      const sc = valley().scenario;
      expect(validateScenario({ ...sc, interventions: p.interventions })).toEqual([]);
      for (const iv of p.interventions) expect(iv.tSeconds).toBeGreaterThanOrEqual(LEVELS[level].delayS);
      expect(p.contained.stats.burnedCells).toBeLessThanOrEqual(p.baseline.stats.burnedCells);
      expect(p.metrics.savedHa).toBeGreaterThanOrEqual(0);
      for (const iv of p.interventions) {
        if (iv.type === 'firebreak') expect(iv.params?.widthCells).toBe(1);
        for (const c of iv.cells) expect(sc.fuel[c]).not.toBe(FuelClass.NONE);
      }
    }
  });

  it('a response actually helps on the valley and bigger responses save at least as much', () => {
    const minimal = planFor('minimal');
    const maximum = planFor('maximum');
    expect(maximum.orders.length).toBeGreaterThan(minimal.orders.length);
    expect(maximum.metrics.savedHa).toBeGreaterThan(0);
    expect(maximum.metrics.savedHa).toBeGreaterThanOrEqual(minimal.metrics.savedHa - 1);
  });

  it('orders are consistent with their interventions and the timeline', () => {
    const p = planFor('standard');
    const ids = new Set(p.interventions.map((i) => i.id));
    for (const o of p.orders) {
      expect(o.interventionIds.length).toBeGreaterThan(0);
      for (const id of o.interventionIds) expect(ids.has(id)).toBe(true);
      expect(o.dispatchTimeSeconds).toBeLessThanOrEqual(o.etaSeconds);
      expect(o.etaSeconds).toBeGreaterThanOrEqual(LEVELS.standard.delayS);
      expect(o.executionDurationSeconds).toBeGreaterThan(0);
    }
  });

  it('reports progress and finishes a standard plan on 120x120 quickly', () => {
    const fr: number[] = [];
    const t0 = performance.now();
    const p = planContainment({ scenario: valley().scenario, level: 'standard', homes: null }, (f) => fr.push(f));
    const ms = performance.now() - t0;
    expect(fr[fr.length - 1]).toBe(1);
    for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThanOrEqual(fr[i - 1]);
    expect(p.metrics.sims).toBeLessThan(200);
    expect(ms).toBeLessThan(5000);
  });

  it('overrides change the plan: zero roster means no orders', () => {
    const p = planContainment({ scenario: valley().scenario, level: 'standard', overrides: { roster: { handcrew: 0, engine: 0, helicopter: 0 } }, homes: null });
    expect(p.orders.length).toBe(0);
    expect(p.metrics.savedHa).toBe(0);
  });

  it('homes: the planner counts them and never treats a home cell', () => {
    const { scenario } = valley();
    const homes = new Uint16Array(scenario.fuel.length);
    const fuel = new Uint8Array(scenario.fuel);
    const W = scenario.grid.width;
    const ign = scenario.ignition[0];
    for (let k = 0; k < 6; k++) {
      const i = (ign.row - 4) * W + ign.col + 10 + k;
      homes[i] = 1;
      fuel[i] = FuelClass.NONE;
    }
    const p = planContainment({ scenario: { ...scenario, fuel }, level: 'aggressive', homes });
    expect(p.metrics.homesTotal).toBe(6);
    expect(p.metrics.homesBaseline).not.toBeNull();
    for (const iv of p.interventions) for (const c of iv.cells) expect(homes[c]).toBe(0);
  });
});

describe('kinematics', () => {
  it('standby, transit, working, completed in order; only the current order is visible', () => {
    const p = planFor('standard');
    const { scenario } = valley();
    const o = p.orders[0];
    expect(o).toBeDefined();
    const at = (t: number) => unitKinematicsAt(o, p.orders, scenario.grid, t);
    expect(at(o.dispatchTimeSeconds - 1).phase).toBe('standby');
    const mid = at((o.dispatchTimeSeconds + o.etaSeconds) / 2);
    if (o.etaSeconds > o.dispatchTimeSeconds + 1) {
      expect(mid.phase).toBe('transit');
      expect(mid.progress).toBeGreaterThan(0);
      expect(mid.progress).toBeLessThan(1);
    }
    const work = at(o.etaSeconds + o.executionDurationSeconds / 2);
    expect(['working', 'shuttle']).toContain(work.phase);
    expect(at(o.etaSeconds + o.executionDurationSeconds + 1).phase).toBe('completed');
    const later = p.orders.find((q) => q.unitId === o.unitId && q.id !== o.id);
    if (later) expect(at(later.dispatchTimeSeconds + 1).visible).toBe(false);
  });
});

/** Interventions must be plain data (structured-cloneable) so the worker can post them. */
it('plan is structured-cloneable', () => {
  const p = planFor('minimal');
  const clone = structuredClone({ orders: p.orders, interventions: p.interventions as Intervention[], metrics: p.metrics });
  expect(clone.orders.length).toBe(p.orders.length);
});
