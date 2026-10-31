import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoChecks, demoScenarioFor, evaluateDemo } from '../src/app/demoEval';
import { decodeBundle } from '../src/data/bundle';
import type { DemoArea, DemoAreaBundle, DemoAreaIndex } from '../src/data/bundle';
import { DEMO_IDS, DEMO_SCENARIOS, demoContained, demoWeather } from '../src/data/demo-scenarios';
import type { DemoScenario } from '../src/data/demo-scenarios';
import { FuelClass } from '../src/contract';
import { simulate } from '../src/sim';

const DIR = join(__dirname, '..', 'public', 'demo-areas');
const load = (name: string): DemoArea | null => {
  const f = join(DIR, `${name}.json`);
  return existsSync(f) ? decodeBundle(JSON.parse(readFileSync(f, 'utf8')) as DemoAreaBundle) : null;
};

describe('demo area index', () => {
  const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as DemoAreaIndex;
  it('lists every area a demo scenario uses, each with a bundle file that exists', () => {
    for (const id of DEMO_IDS) {
      const entry = index.areas.find((a) => a.name === DEMO_SCENARIOS[id].areaName);
      // The real Surrey bundle may be absent on a machine that could not reach Overpass; then it must not be listed either.
      if (entry) expect(existsSync(join(DIR, entry.file)), entry.file).toBe(true);
      else expect(id).toBe('surrey');
    }
  });
  it('labels the Surrey bundle as real data and the backup as synthetic', () => {
    const surrey = index.areas.find((a) => a.name === 'surrey-hills');
    if (surrey) expect(surrey.synthetic).toBe(false);
    expect(index.areas.find((a) => a.name === 'synthetic-ridge')?.synthetic).toBe(true);
  });
});

for (const id of DEMO_IDS) {
  const s = DEMO_SCENARIOS[id];
  const area = load(s.areaName);
  const run = it.skipIf(!area);

  describe(`demo scenario "${id}" on ${s.areaName}${area ? '' : ' (bundle missing: skipped)'}`, () => {
    run('is well formed: ignition inside the grid and burnable, a non-empty threatened zone, a plan that builds', () => {
      const { grid } = area!;
      expect(s.ignition.row).toBeGreaterThanOrEqual(0);
      expect(s.ignition.row).toBeLessThan(grid.height);
      expect(s.ignition.col).toBeGreaterThanOrEqual(0);
      expect(s.ignition.col).toBeLessThan(grid.width);
      expect(area!.fuel[s.ignition.row * grid.width + s.ignition.col]).not.toBe(FuelClass.NONE);
      const w = demoWeather(s);
      expect(w.windSpeedMps).toBeCloseTo(s.windSpeedKmh / 3.6, 9); // km/h converted at the edge
      const plan = demoContained(s, grid);
      expect(plan.length).toBe(s.contained.length);
      expect(plan.some((iv) => iv.type === 'firebreak')).toBe(true);
      for (const iv of plan) {
        expect(iv.cells.length).toBeGreaterThan(0);
        expect(iv.tSeconds).toBeGreaterThan(0);
        expect(iv.tSeconds).toBeLessThan(s.durationSeconds);
      }
    });

    run('is deterministic: the same scenario gives byte-identical arrival times', () => {
      const a = simulate(demoScenarioFor(area!, s)).arrivalTime;
      const b = simulate(demoScenarioFor(area!, s)).arrivalTime;
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    });

    // One test per promise, so a failure names it.
    const report = area ? evaluateDemo(area, s) : null;
    for (const c of report ? demoChecks(report) : []) {
      it(`${c.name} [${c.detail || 'ok'}]`, () => expect(c.ok).toBe(true));
    }

    run('the saved plan really is what contains it: the same fire without it reaches the village, with it never does', () => {
      expect(report!.zoneArrivalS).toBeLessThan(s.durationSeconds);
      expect(report!.containedZoneArrivalS).toBe(Infinity);
      // and it holds for a run half as long again (it is not just running out of time)
      const longer: DemoScenario = { ...s, durationSeconds: s.durationSeconds * 1.5 };
      const r = evaluateDemo(area!, longer);
      expect(r.containedZoneArrivalS).toBe(Infinity);
    });

    run('the checks bite: a broken scenario fails the right ones (negative controls)', () => {
      const failing = (scn: DemoScenario): string[] => demoChecks(evaluateDemo(area!, scn)).filter((c) => !c.ok).map((c) => c.name);
      // 1. firebreak moved behind the ignition: the head never reaches it, and the village is not saved
      const behind: DemoScenario = { ...s, contained: s.contained.map((a) => ({ ...a, points: a.points.map(([x, y]) => [x, y + 80] as [number, number]) })) };
      const f1 = failing(behind);
      expect(f1.some((n) => n.includes('firebreak line'))).toBe(true);
      expect(f1.some((n) => n.includes('does not reach the threatened zone'))).toBe(true);
      // 2. no plan at all: nothing is contained
      const none: DemoScenario = { ...s, contained: [] };
      expect(failing(none).some((n) => n.includes('does not reach the threatened zone') || n.includes('materially less'))).toBe(true);
      // 3. wind from the wrong side: the head is no longer downwind of where the story says
      const wrong: DemoScenario = { ...s, windFromDeg: (s.windFromDeg + 180) % 360 };
      expect(failing(wrong).length).toBeGreaterThan(0);
      // 4. no wind to speak of: not wind-driven
      const calm: DemoScenario = { ...s, windSpeedKmh: 1 };
      expect(failing(calm).some((n) => n.includes('wind-driven'))).toBe(true);
    });
  });
}
