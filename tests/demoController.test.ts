import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoController } from '../src/app/demoController';
import { createStore, initialState } from '../src/app/state';
import type { Store } from '../src/app/state';
import { createToolsController } from '../src/app/toolsController';
import type { Wiring } from '../src/app/wiring';
import { DEFAULT_SETTINGS } from '../src/contract';
import { decodeBundle } from '../src/data/bundle';
import type { DemoArea, DemoAreaBundle, DemoAreaIndex, DemoAreaIndexEntry } from '../src/data/bundle';
import { DEMO_SCENARIOS } from '../src/data/demo-scenarios';
import type { Notices } from '../src/ui/notices';

const DIR = join(__dirname, '..', 'public', 'demo-areas');
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as DemoAreaIndex;
const haveSurrey = existsSync(join(DIR, 'surrey-hills.json'));
const areaCache = new Map<string, DemoArea>();
const bundle = (name: string): DemoArea => {
  if (!areaCache.has(name)) areaCache.set(name, decodeBundle(JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as DemoAreaBundle));
  return areaCache.get(name)!;
};

interface Rig {
  store: Store;
  tools: ReturnType<typeof createToolsController>;
  demo: ReturnType<typeof createDemoController>;
  log: { level: string; msg: string }[];
  flights: unknown[];
  simulations: number;
  failing: Set<string>;
}

function rig(opts: { areas?: DemoAreaIndexEntry[]; failing?: string[] } = {}): Rig {
  const store = createStore({ ...initialState(), areas: opts.areas ?? index.areas });
  const r = { log: [] as Rig['log'], flights: [] as unknown[], simulations: 0, failing: new Set(opts.failing ?? []) } as Rig;
  const wiring = {
    // Like the real selectArea: load the area, reset the run; on failure leave the old area in place.
    selectArea: async (name: string) => {
      if (r.failing.has(name)) return;
      store.set({ area: bundle(name), areaLoading: false, interventions: [], result: null, resultStale: false, ignition: bundle(name).meta.suggestedIgnition ?? null });
    },
    simulate: async () => { r.simulations++; },
    flyToView: (v: unknown) => { r.flights.push(v); },
    setDrawHandlers: () => {},
    setPreview: () => {},
  } as unknown as Wiring;
  const notices = { show: (msg: string, level: string) => { r.log.push({ level, msg }); }, persistent: () => {} } as unknown as Notices;
  r.store = store;
  r.tools = createToolsController(store, wiring);
  r.demo = createDemoController(store, wiring, r.tools, notices);
  return r;
}

describe('demo controller: Load demo scenario', () => {
  it.skipIf(!haveSurrey)('loads the Surrey scenario ready for Simulate: area, ignition, weather in SI units, duration, seed, speed, camera', async () => {
    const r = rig();
    // dirty state from earlier use
    r.store.set({ settings: { ...DEFAULT_SETTINGS, globalMultiplier: 3 }, seed: 99, durationSeconds: 3600, tool: 'water' });
    await r.demo.load('surrey');
    const s = r.store.get();
    const sc = DEMO_SCENARIOS.surrey;
    expect(s.demoId).toBe('surrey');
    expect(s.area?.meta.name).toBe('surrey-hills');
    expect(s.ignition).toEqual(sc.ignition);
    expect(s.weather.windFromDeg).toBe(225);
    expect(s.weather.windSpeedMps).toBeCloseTo(25 / 3.6, 9);
    expect(s.durationSeconds).toBe(4 * 3600);
    expect(s.seed).toBe(1);
    expect(s.settings).toEqual(DEFAULT_SETTINGS); // tuned on the defaults, so a reload restores them
    expect(s.tool).toBe('ignite');
    expect(s.result).toBeNull();
    expect(s.interventions).toEqual([]);
    expect(s.playback).toEqual({ t: 0, playing: false, speed: 256 });
    expect(r.flights).toEqual([sc.camera]);
    expect(r.log).toEqual([]);
  });

  it('loads the backup scenario on the generated area with no warnings', async () => {
    const r = rig();
    await r.demo.load('backup');
    const s = r.store.get();
    expect(s.demoId).toBe('backup');
    expect(s.area?.meta.name).toBe('synthetic-ridge');
    expect(s.area?.meta.synthetic).toBe(true);
    expect(s.weather.windFromDeg).toBe(270);
    expect(s.ignition).toEqual(DEMO_SCENARIOS.backup.ignition);
    expect(r.log).toEqual([]);
  });

  it('falls back to the backup, with a visible message, when the scenario area is not in the list', async () => {
    const r = rig({ areas: index.areas.filter((a) => a.name !== 'surrey-hills') });
    await r.demo.load('surrey');
    expect(r.store.get().demoId).toBe('backup');
    expect(r.store.get().area?.meta.synthetic).toBe(true);
    expect(r.log.some((l) => l.level === 'warn' && l.msg.includes('backup'))).toBe(true);
  });

  it('falls back to the backup when the bundle fails to load', async () => {
    const r = rig({ failing: ['surrey-hills'] });
    await r.demo.load('surrey');
    expect(r.store.get().demoId).toBe('backup');
    expect(r.store.get().area?.meta.name).toBe('synthetic-ridge');
    expect(r.log.some((l) => l.level === 'warn')).toBe(true);
  });

  it('says so and does not throw when nothing can be loaded', async () => {
    const r = rig({ failing: ['surrey-hills', 'synthetic-ridge'] });
    await expect(r.demo.load('surrey')).resolves.toBeUndefined();
    expect(r.store.get().demoId).toBeNull();
    expect(r.log.some((l) => l.level === 'error')).toBe(true);
  });

  it('picking another area by hand ends "the demo is loaded"', async () => {
    const r = rig();
    await r.demo.load('backup');
    r.store.set({ area: bundle('synthetic-valley') });
    expect(r.store.get().demoId).toBeNull();
  });
});

describe('demo controller: Reset', () => {
  it('returns to the clean state of the same demo after the user has changed things', async () => {
    const r = rig();
    await r.demo.load('backup');
    r.store.update((s) => ({
      weather: { ...s.weather, windFromDeg: 10 }, ignition: { row: 5, col: 5 }, seed: 7, result: {} as never,
      playback: { t: 5000, playing: true, speed: 4 },
    }));
    await r.demo.reset();
    const s = r.store.get();
    expect(s.demoId).toBe('backup');
    expect(s.weather.windFromDeg).toBe(270);
    expect(s.ignition).toEqual(DEMO_SCENARIOS.backup.ignition);
    expect(s.seed).toBe(1);
    expect(s.result).toBeNull();
    expect(s.playback).toEqual({ t: 0, playing: false, speed: 256 });
  });

  it('with nothing loaded yet, loads the default demo', async () => {
    const r = rig({ areas: index.areas.filter((a) => a.name !== 'surrey-hills') });
    await r.demo.reset();
    expect(r.store.get().demoId).toBe('backup'); // the default's area was missing, so the backup
  });
});

describe('demo controller: Show contained version', () => {
  it('does nothing before a demo is loaded', () => {
    const r = rig();
    r.demo.showContained();
    expect(r.store.get().interventions).toEqual([]);
  });

  it('adds the saved plan as ONE undo step, at the saved times, re-simulating only when a result exists', async () => {
    const r = rig();
    await r.demo.load('backup');
    r.demo.showContained();
    const plan = r.store.get().interventions;
    expect(plan.length).toBe(DEMO_SCENARIOS.backup.contained.length);
    expect(plan.map((iv) => iv.tSeconds)).toEqual(DEMO_SCENARIOS.backup.contained.map((a) => a.tSeconds));
    expect(plan.every((iv) => iv.id.startsWith('demo-'))).toBe(true);
    expect(r.simulations).toBe(0); // no result yet: nothing to re-run

    r.tools.undo();
    expect(r.store.get().interventions).toEqual([]); // one undo removes the whole plan
    r.tools.redo();
    expect(r.store.get().interventions.length).toBe(plan.length);

    r.store.set({ result: {} as never });
    r.tools.undo();
    expect(r.simulations).toBe(1); // undo with a result re-simulates
  });

  it('is idempotent and keeps the interventions the presenter drew themselves', async () => {
    const r = rig();
    await r.demo.load('backup');
    const own = { id: 'water-own', tSeconds: 100, type: 'water' as const, cells: [1, 2, 3] };
    r.tools.applyAll([own]);
    r.demo.showContained();
    r.demo.showContained();
    const list = r.store.get().interventions;
    expect(list.filter((iv) => iv.id.startsWith('demo-')).length).toBe(DEMO_SCENARIOS.backup.contained.length);
    expect(list[0].id).toBe('water-own');
    r.tools.undo();
    expect(r.store.get().interventions.map((iv) => iv.id)).toEqual(['water-own']);
  });
});
