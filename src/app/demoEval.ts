/**
 * Runs a demo scenario headlessly (uncontained, contained, wind flipped) and reports what happened
 * plus the pass/fail checks the demo must meet. Used by scripts/tune-demo.ts and
 * tests/demoScenario.test.ts, so the report you read and the test that guards it are one thing.
 */

import { FuelClass } from '../contract';
import type { Scenario, SimResult } from '../contract';
import { scenarioFromArea } from '../data/bundle';
import type { DemoArea } from '../data/bundle';
import { demoContained, demoWeather } from '../data/demo-scenarios';
import type { DemoScenario } from '../data/demo-scenarios';
import { arrivalAtCells, arrivalAtZone, bearingGap, burnedShape, discZone } from '../data/demoMetrics';
import type { Shape } from '../data/demoMetrics';
import { simulate } from '../sim';

export interface DemoReport {
  /** Ignition cell is burnable. */
  ignitionBurnable: boolean;
  /** Seconds at which the uncontained fire first burns a cell of the threatened zone (Infinity: never). */
  zoneArrivalS: number;
  /** The same for the contained run. */
  containedZoneArrivalS: number;
  /** Seconds at which the uncontained head reaches the saved firebreak line (Infinity: never). */
  breakArrivalS: number;
  uncontained: Shape;
  /** Shape of the uncontained fire at the moment it reaches the zone (what the audience sees before the payoff). */
  atZone: Shape;
  contained: Shape;
  flipped: Shape;
  runtimeMs: number;
  /** Bearing the wind blows TOWARD, degrees. */
  windToDeg: number;
  durationSeconds: number;
}

export function demoScenarioFor(area: DemoArea, s: DemoScenario, o: { windFromDeg?: number; contained?: boolean } = {}): Scenario {
  const weather = demoWeather(s);
  if (o.windFromDeg !== undefined) weather.windFromDeg = o.windFromDeg;
  const scenario = scenarioFromArea(area, { weather, ignition: [s.ignition], durationSeconds: s.durationSeconds, seed: s.seed });
  if (o.contained) scenario.interventions = demoContained(s, area.grid);
  return scenario;
}

export function evaluateDemo(area: DemoArea, s: DemoScenario): DemoReport {
  const { grid } = area;
  const zone = { cells: discZone(grid, s.threatened.centre, s.threatened.radiusCells).cells.filter((i) => area.fuel[i] !== FuelClass.NONE) };
  const run = (o: Parameters<typeof demoScenarioFor>[2] = {}): SimResult => simulate(demoScenarioFor(area, s, o));
  const un = run();
  const co = run({ contained: true });
  const fl = run({ windFromDeg: (s.windFromDeg + 180) % 360 });
  const zoneArrivalS = arrivalAtZone(un.arrivalTime, zone);
  const breaks = demoContained(s, grid).filter((iv) => iv.type === 'firebreak');
  const breakCells = breaks.flatMap((iv) => iv.cells).filter((i) => area.fuel[i] !== FuelClass.NONE);
  return {
    ignitionBurnable: area.fuel[s.ignition.row * grid.width + s.ignition.col] !== FuelClass.NONE,
    zoneArrivalS,
    containedZoneArrivalS: arrivalAtZone(co.arrivalTime, zone),
    breakArrivalS: arrivalAtCells(un.arrivalTime, breakCells),
    uncontained: burnedShape(grid, un.arrivalTime, s.ignition),
    atZone: burnedShape(grid, un.arrivalTime, s.ignition, zoneArrivalS),
    contained: burnedShape(grid, co.arrivalTime, s.ignition),
    flipped: burnedShape(grid, fl.arrivalTime, s.ignition),
    runtimeMs: un.stats.runtimeMs,
    windToDeg: (s.windFromDeg + 180) % 360,
    durationSeconds: s.durationSeconds,
  };
}

export interface DemoCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;

/** The things the demo promises. Thresholds are deliberately loose enough not to be brittle, tight enough to matter. */
export function demoChecks(r: DemoReport): DemoCheck[] {
  const D = r.durationSeconds;
  const hours = (t: number): string => (t === Infinity ? 'never' : `${(t / 3600).toFixed(2)} h`);
  const zoneFrac = r.zoneArrivalS / D;
  const breakFrac = r.breakArrivalS / D;
  const headOff = bearingGap(r.atZone.headBearingDeg, r.windToDeg);
  const flipGap = bearingGap(r.flipped.headBearingDeg, r.uncontained.headBearingDeg);
  // centroid vectors point opposite ways when the flipped fire runs the other side of the ignition
  const dot = r.flipped.centroidEastM * r.uncontained.centroidEastM + r.flipped.centroidNorthM * r.uncontained.centroidNorthM;
  const areaRatio = r.contained.hectares / r.uncontained.hectares;
  return [
    { name: 'ignition is on a burnable cell', ok: r.ignitionBurnable, detail: '' },
    { name: 'uncontained fire reaches the threatened zone before the end (55-95% of the run)', ok: zoneFrac >= 0.55 && zoneFrac <= 0.95, detail: `at ${hours(r.zoneArrivalS)} = ${pct(zoneFrac)} of ${(D / 3600).toFixed(1)} h` },
    { name: 'the head reaches the firebreak line at 40-60% of the run', ok: breakFrac >= 0.4 && breakFrac <= 0.6, detail: `at ${hours(r.breakArrivalS)} = ${pct(breakFrac)}` },
    { name: 'the fire is wind-driven: head within 40 deg of downwind, reaching 4x further ahead than behind, aspect >= 1.25', ok: headOff <= 40 && r.atZone.aheadM >= 4 * r.atZone.behindM && r.atZone.aspect >= 1.25, detail: `head ${r.atZone.headBearingDeg.toFixed(0)} deg (downwind ${r.windToDeg.toFixed(0)}), ahead ${r.atZone.aheadM.toFixed(0)} m / behind ${r.atZone.behindM.toFixed(0)} m, aspect ${r.atZone.aspect.toFixed(2)}` },
    { name: 'flipping the wind reverses the fire (head turns >= 90 deg, centroid on the other side of the ignition)', ok: flipGap >= 90 && dot < 0, detail: `head turns ${flipGap.toFixed(0)} deg, ${r.flipped.hectares.toFixed(0)} ha` },
    { name: 'contained run does not reach the threatened zone', ok: r.containedZoneArrivalS === Infinity, detail: `zone arrival ${hours(r.containedZoneArrivalS)}` },
    { name: 'contained run burns materially less (at most 70%) but still a real fire (at least 30%)', ok: areaRatio <= 0.7 && areaRatio >= 0.3, detail: `${r.contained.hectares.toFixed(0)} ha = ${pct(areaRatio)} of ${r.uncontained.hectares.toFixed(0)} ha` },
    { name: 'a run takes under 1 s', ok: r.runtimeMs < 1000, detail: `${r.runtimeMs.toFixed(0)} ms` },
  ];
}
