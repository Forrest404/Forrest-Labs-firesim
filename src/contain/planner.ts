/**
 * Greedy rollout planner for the emergency response. Pure and synchronous; runs inside the sim
 * worker. For every assignment it tries a few candidate lines, re-simulates each, and keeps the
 * one with the best score (area saved, homes saved, vegetation cleared, line length). The
 * baseline (no response) and the final contained run come back together so the UI can show
 * "with" and "without" side by side.
 */

import type { CellRef, Intervention, Scenario, SimResult } from '../contract';
import { cellCenterLonLat } from '../data/geo';
import type { Pt } from '../data/raster';
import { simulate } from '../sim';
import { buildDropSeries, buildLineSegments, candidateLines } from './lines';
import type { LineBuild } from './lines';
import { homesReached } from './metrics';
import type { Station } from './stations';
import { defaultStations } from './stations';
import { UNITS, resolveLevel } from './units';
import type { ContainOverrides, LevelSpec, ResponseLevel, Tactic, UnitType } from './units';

export interface PlanInput {
  scenario: Scenario;
  level: ResponseLevel;
  overrides?: ContainOverrides | null;
  /** Optional: defaults to defaultStations() for the level's roster. */
  stations?: Station[];
  homes: Uint16Array | null;
}

export interface Order {
  id: string;
  unitId: string;
  unitType: UnitType;
  unitName: string;
  tactic: Tactic;
  cycle: number;
  sector: string;
  /** Cell-space [col, row] polyline of the line, in work order. */
  strokePoints: [number, number][];
  routeWaypointsLonLat: [number, number][];
  sourceLonLat: { lon: number; lat: number };
  dropCenterLonLat: { lon: number; lat: number };
  dispatchTimeSeconds: number;
  etaSeconds: number;
  executionDurationSeconds: number;
  interventionIds: string[];
  savedHa: number;
  clearedHa: number;
  lengthM: number;
  waterL: number;
  /** Aircraft: number of drops in this sortie. */
  drops: number;
}

export interface PlanMetrics {
  baselineBurnedHa: number;
  containedBurnedHa: number;
  savedHa: number;
  reductionPct: number;
  lineKm: number;
  clearedHa: number;
  waterL: number;
  homesTotal: number | null;
  homesBaseline: number | null;
  homesContained: number | null;
  sims: number;
  runtimeMs: number;
}

export interface ContainPlan {
  level: ResponseLevel;
  spec: LevelSpec;
  stations: Station[];
  orders: Order[];
  interventions: Intervention[];
  baseline: SimResult;
  contained: SimResult;
  metrics: PlanMetrics;
}

interface UnitState {
  station: Station;
  /** When the unit can start its next assignment (on the grid). */
  availableAt: number;
  /** Where it is (cell) when it becomes available. */
  pos: CellRef;
  assignments: number;
}

const LOCK_THRESHOLD = 0.3;

export function planContainment(input: PlanInput, onProgress?: (fraction: number) => void): ContainPlan {
  const t0 = now();
  const { scenario, homes } = input;
  const spec = resolveLevel(input.level, input.overrides);
  const grid = scenario.grid;
  const fuel = scenario.fuel;
  const stations = input.stations ?? defaultStations(grid, fuel, spec.roster);
  const ignition = scenario.ignition[0] ?? { row: grid.height >> 1, col: grid.width >> 1 };
  const duration = scenario.durationSeconds;

  let sims = 0;
  const run = (interventions: Intervention[]): SimResult => {
    sims++;
    return simulate({ ...scenario, interventions });
  };
  const baseline = run(scenario.interventions);
  const homesAt = (r: SimResult): number => (homes ? homesReached(r.arrivalTime, homes, grid, duration) : 0);

  // Progress is a rough count of sims: baseline + per cycle, per unit, one per candidate.
  const budgetOptions = spec.lineBudgetM > 500 ? 2 : 1;
  const plannedSims = 1 + spec.cycles * stations.length * spec.candidates * budgetOptions;
  const report = (): void => onProgress?.(Math.min(0.99, sims / Math.max(1, plannedSims)));

  const units: UnitState[] = stations.map((st) => {
    const u = UNITS[st.type];
    const travelS = (st.baseToEntryKm / u.travelKmh) * 3600;
    // Units of one type leave their base a minute apart.
    const stagger = 60 * Number(st.id.split('-')[1] ?? 1) - 60;
    return { station: st, availableAt: spec.delayS + stagger + travelS, pos: st.entry, assignments: 0 };
  });

  const locked: Intervention[] = [...scenario.interventions];
  let current = baseline;
  let currentBurned = baseline.stats.burnedAreaHa;
  let currentHomes = homesAt(baseline);
  const orders: Order[] = [];

  for (let cycle = 1; cycle <= spec.cycles; cycle++) {
    const taken = new Set<string>();
    const order = [...units].filter((x) => x.availableAt < duration * 0.9).sort((a, b) => a.availableAt - b.availableAt);
    for (const unit of order) {
      const u = UNITS[unit.station.type];
      const budgetCells = u.airborne ? u.dropCells * spec.dropsPerSortie : Math.round(spec.lineBudgetM / grid.cellSizeM);
      if (budgetCells <= 0) continue;
      // Time the line must hold at: roughly when this unit would finish building it.
      const buildS = u.airborne ? u.turnaroundS * Math.max(1, spec.dropsPerSortie - 1) : (spec.lineBudgetM / u.lineRateMpm) * 60 * 1.2;
      let best: { sector: string; path: Pt[]; build: LineBuild; result: SimResult; score: number; savedHa: number } | null = null;
      // A long line sits on a late isochrone, far from the fire, and takes hours to finish. Big
      // responses also try the same sectors at half the budget, closer in, so "Maximum" can never
      // do worse than a smaller line would have (greedy lock-in otherwise prefers the far line).
      const fractions = !u.airborne && spec.lineBudgetM > 500 ? [1, 0.5] : [1];
      for (const frac of fractions) {
        const cells = Math.max(1, Math.round(budgetCells * frac));
        const tLineF = unit.availableAt + buildS * frac * 0.8 + 300;
        const cands = candidateLines(grid, fuel, homes, ignition, scenario.weather.windFromDeg, current.arrivalTime, tLineF, cells, spec.candidates, { exclude: taken, origin: unit.pos });
        for (const cand of cands) {
          const build = buildFor(unit, cand.path, cycle, spec.lineBudgetM * frac);
          if (build.segments.length === 0) continue;
          const result = run([...locked, ...build.segments]);
          report();
          const savedHa = currentBurned - result.stats.burnedAreaHa;
          const homesSaved = homes ? currentHomes - homesAt(result) : 0;
          const score = savedHa + 2 * homesSaved - spec.cutPenalty * build.clearedHa - (0.02 * build.lengthM) / 100;
          if (!best || score > best.score) best = { sector: cand.sector, path: cand.path, build, result, score, savedHa };
        }
      }
      if (!best || best.score <= LOCK_THRESHOLD) continue;
      locked.push(...best.build.segments);
      current = best.result;
      currentBurned = best.result.stats.burnedAreaHa;
      currentHomes = homesAt(best.result);
      taken.add(best.sector);
      orders.push(makeOrder(unit, best.sector, best.path, best.build, cycle, best.savedHa));
      const last = best.build.cells[best.build.cells.length - 1];
      unit.pos = last === undefined ? unit.pos : { row: (last / grid.width) | 0, col: last % grid.width };
      unit.availableAt = best.build.endT + u.turnaroundS;
      unit.assignments++;
    }
  }

  const contained = current;
  const metrics: PlanMetrics = {
    baselineBurnedHa: baseline.stats.burnedAreaHa,
    containedBurnedHa: contained.stats.burnedAreaHa,
    savedHa: baseline.stats.burnedAreaHa - contained.stats.burnedAreaHa,
    reductionPct: baseline.stats.burnedAreaHa > 0 ? (100 * (baseline.stats.burnedAreaHa - contained.stats.burnedAreaHa)) / baseline.stats.burnedAreaHa : 0,
    lineKm: orders.filter((o) => !UNITS[o.unitType].airborne).reduce((a, o) => a + o.lengthM, 0) / 1000,
    clearedHa: orders.reduce((a, o) => a + o.clearedHa, 0),
    waterL: orders.reduce((a, o) => a + o.waterL, 0),
    homesTotal: homes ? Array.from(homes).reduce((a, b) => a + b, 0) : null,
    homesBaseline: homes ? homesAt(baseline) : null,
    homesContained: homes ? homesAt(contained) : null,
    sims,
    runtimeMs: now() - t0,
  };
  onProgress?.(1);
  return { level: spec.level, spec, stations, orders, interventions: locked.slice(scenario.interventions.length), baseline, contained, metrics };

  function buildFor(unit: UnitState, path: Pt[], cycle: number, budgetM: number): LineBuild {
    const u = UNITS[unit.station.type];
    const idPrefix = `resp-${unit.station.id}-c${cycle}`;
    // Fly, walk or drive from the current position (grid entry, or the last line) to the start of the line.
    const startT = unit.availableAt + onGridS(unit, path);
    if (u.airborne) return buildDropSeries(grid, fuel, homes, path, u, startT, spec.dropsPerSortie, duration, current.arrivalTime, idPrefix, unit.station.name);
    // Near homes nothing is cut: ground units switch to a wet line there.
    const first = lineCellsNearHomes(path);
    return buildLineSegments(grid, fuel, homes, path, u, startT, budgetM, current.arrivalTime, idPrefix, {
      forestAllowed: u.type === 'dozer' ? spec.dozerInForest : u.forestAllowed,
      wet: first && u.tactic !== 'wetline',
      label: unit.station.name,
    });
  }

  function lineCellsNearHomes(path: readonly (readonly [number, number])[]): boolean {
    if (!homes) return false;
    const { width: W, height: H } = grid;
    for (const [x, y] of path) {
      const r = Math.floor(y);
      const c = Math.floor(x);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < H && cc >= 0 && cc < W && homes[rr * W + cc] > 0) return true;
      }
    }
    return false;
  }

  function makeOrder(unit: UnitState, sector: string, path: readonly (readonly [number, number])[], build: LineBuild, cycle: number, savedHa: number): Order {
    const u = UNITS[unit.station.type];
    const st = unit.station;
    const stroke = path.map(([x, y]) => [x - 0.5, y - 0.5] as [number, number]);
    const mid = stroke[stroke.length >> 1];
    const center = cellCenterLonLat(grid, Math.round(mid[1]), Math.round(mid[0]));
    const isFirst = unit.assignments === 0;
    // Dispatch: first assignment leaves the base after the detection delay; later ones start from the last line.
    const travelS = (st.baseToEntryKm / u.travelKmh) * 3600;
    const dispatch = isFirst ? Math.max(0, build.startT - travelS - onGridS(unit, path)) : unit.availableAt - u.turnaroundS;
    const from = isFirst ? { lon: st.lon, lat: st.lat } : cellCenterLonLat(grid, unit.pos.row, unit.pos.col);
    const start = cellCenterLonLat(grid, Math.round(stroke[0][1]), Math.round(stroke[0][0]));
    const route: [number, number][] = isFirst
      ? [...st.routeWaypointsLonLat, [start.lon, start.lat]]
      : [[from.lon, from.lat], [start.lon, start.lat]];
    return {
      id: `order-${st.id}-c${cycle}`,
      unitId: st.id,
      unitType: st.type,
      unitName: st.name,
      tactic: build.segments[0]?.type === 'firebreak' ? u.tactic : u.airborne ? u.tactic : 'wetline',
      cycle,
      sector,
      strokePoints: stroke,
      routeWaypointsLonLat: route,
      sourceLonLat: from,
      dropCenterLonLat: { lon: center.lon, lat: center.lat },
      dispatchTimeSeconds: dispatch,
      etaSeconds: build.startT,
      executionDurationSeconds: Math.max(60, build.endT - build.startT),
      interventionIds: build.segments.map((s) => s.id),
      savedHa,
      clearedHa: build.clearedHa,
      lengthM: build.lengthM,
      waterL: build.waterL,
      drops: u.airborne ? build.segments.length : 0,
    };
  }

  function onGridS(unit: UnitState, path: readonly (readonly [number, number])[]): number {
    const u = UNITS[unit.station.type];
    const [x0, y0] = path[0];
    const distM = Math.hypot(x0 - unit.pos.col, y0 - unit.pos.row) * grid.cellSizeM;
    return (distM / 1000 / u.onGridKmh) * 3600;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
