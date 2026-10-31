/**
 * Real-fire check: the same fire re-run with no wind and with the wind reversed, compared with the
 * real perimeter at real size. If the real wind matches far better, the match is not luck: the
 * physics (wind, slope, fuel) is doing the work.
 */

import type { Scenario, Weather } from '../contract';
import type { ReferenceFire } from '../data/bundle';
import { simulate } from '../sim';
import { overlapAtRealSize } from './impact';
import type { Overlap } from './impact';

export type ControlKind = 'real' | 'noWind' | 'reversed';

export interface ControlRun {
  kind: ControlKind;
  /** Null if that run never grows to the real fire's size. */
  overlap: Overlap | null;
}

/** Three solver runs of ~20 ms each on a 200 x 200 grid, so the main thread is fine. */
export function controlRuns(scenario: Scenario, ref: ReferenceFire): ControlRun[] {
  const base: Scenario = { ...scenario, interventions: [] };
  const run = (kind: ControlKind, weather: Partial<Weather>): ControlRun => ({
    kind,
    overlap: overlapAtRealSize(simulate({ ...base, weather: { ...base.weather, ...weather } }), ref),
  });
  return [
    run('real', {}),
    run('noWind', { windSpeedMps: 0 }),
    run('reversed', { windFromDeg: (base.weather.windFromDeg + 180) % 360 }),
  ];
}
