import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FuelClass, applyDrynessPreset, scheduleFromPreset, validateScenario } from '../src/contract';
import type { Intervention, Scenario, WeatherKeyframe } from '../src/contract';
import { simulate } from '../src/sim';
import { LIVE_STEP_S, MAX_LIVE_EDITS, addLiveEdit, displayWeather, effectiveSchedule, liveEditTime } from '../src/sim/live';
import type { LiveEdit } from '../src/sim/live';
import { mulberry32 } from '../src/sim/prng';
import { createWeatherTimeline, weatherAt } from '../src/sim/weather';
import type { WeatherState } from '../src/sim/weather';

const W = 90;
const H = 90;
const DURATION = 6 * 3600;

function area(seed: number, wet: boolean): Scenario {
  const n = W * H;
  const rand = mulberry32(seed);
  const fuel = new Uint8Array(n);
  const elevation = new Float32Array(n);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const v = rand();
      fuel[r * W + c] = v < 0.5 ? FuelClass.FOREST_CONIFER : v < 0.85 ? FuelClass.GRASS : v < 0.97 ? FuelClass.SHRUB : FuelClass.NONE;
      elevation[r * W + c] = 100 + 40 * Math.sin(c / 13) + 30 * Math.cos(r / 17);
    }
  }
  fuel[45 * W + 45] = FuelClass.GRASS;
  const water: Intervention[] = wet
    ? [{ id: 'w', tSeconds: 1500, type: 'water', cells: Array.from({ length: 30 }, (_, k) => (40 + (k % 3)) * W + 30 + Math.floor(k / 3) * 2) }]
    : [];
  return {
    grid: { width: W, height: H, cellSizeM: 30, originLon: -122.2, originLat: 37.2, bounds: { west: -122.2, south: 37.17, east: -122.17, north: 37.2 } },
    fuel, elevation,
    weather: applyDrynessPreset({ ...DEFAULT_WEATHER, windSpeedMps: 6, windFromDeg: 250 }, 'high'),
    ignition: [{ row: 45, col: 45 }],
    interventions: water,
    durationSeconds: DURATION,
    seed,
    settings: { ...DEFAULT_SETTINGS },
  };
}

const state = (o: Partial<WeatherState> = {}): WeatherState => ({ windSpeedMps: 6, windFromDeg: 250, temperatureC: 30, relativeHumidity: 0.2, ...o });

describe('edit timing', () => {
  it('lands on the grid, at least stepS/2 + 30 s after "now", and never more than a step later than that', () => {
    for (const now of [0, 1, 59, 60, 61, 119, 120, 121, 1234.5, 20000]) {
      const b = liveEditTime(now);
      expect(b % LIVE_STEP_S).toBe(0);
      expect(b - LIVE_STEP_S / 2).toBeGreaterThanOrEqual(now + 30);
      expect(b - LIVE_STEP_S / 2).toBeLessThan(now + 30 + LIVE_STEP_S);
    }
  });

  it('replaces an edit in the same slot, drops edits centred later, keeps earlier ones, and is capped', () => {
    let e: LiveEdit[] = [];
    e = addLiveEdit(e, 1000, state({ windSpeedMps: 1 }));
    e = addLiveEdit(e, 1010, state({ windSpeedMps: 2 })); // same slot
    expect(e.map((x) => x.state.windSpeedMps)).toEqual([2]);
    e = addLiveEdit(e, 3000, state({ windSpeedMps: 3 }));
    e = addLiveEdit(e, 5000, state({ windSpeedMps: 4 }));
    expect(e.map((x) => x.state.windSpeedMps)).toEqual([2, 3, 4]);
    e = addLiveEdit(e, 3010, state({ windSpeedMps: 9 })); // go back in time: later what-ifs vanish
    expect(e.map((x) => x.state.windSpeedMps)).toEqual([2, 9]);
    let many: LiveEdit[] = [];
    for (let i = 0; i < MAX_LIVE_EDITS + 30; i++) many = addLiveEdit(many, i * 300, state({ windSpeedMps: i }));
    expect(many.length).toBe(MAX_LIVE_EDITS);
    expect(many[0].state.windSpeedMps).toBe(0); // history is never the thing that gets dropped
  });
});

describe('weatherAt', () => {
  it('agrees with the solver timeline', () => {
    const base = state();
    const kf: WeatherKeyframe[] = [{ tSeconds: 1800, windSpeedMps: 10, windFromDeg: 350 }, { tSeconds: 7200, windFromDeg: 20, temperatureC: 20, relativeHumidity: 0.5 }];
    const tl = createWeatherTimeline({ weather: { ...DEFAULT_WEATHER, ...base }, weatherSchedule: kf, settings: DEFAULT_SETTINGS, durationSeconds: DURATION } as Scenario)!;
    for (const t of [0, 100, 1800, 3000, 7200, 9000, 20000]) {
      const w = weatherAt({ ...DEFAULT_WEATHER, ...base }, kf, t);
      expect(w.windSpeedMps).toBeCloseTo(tl.speedAt(t), 9);
      expect(w.windFromDeg).toBeCloseTo(tl.fromDegAt(t), 9);
      expect(w.temperatureC).toBeCloseTo(tl.temperatureAt(t), 9);
      expect(w.relativeHumidity).toBeCloseTo(tl.humidityAt(t), 9);
    }
  });
});

describe('effectiveSchedule', () => {
  const base = { ...DEFAULT_WEATHER, windSpeedMps: 5, windFromDeg: 200 };
  const preset = scheduleFromPreset('frontPassage', base);

  it('is the preset itself with no edits, and an empty list stays empty unless a timeline is forced', () => {
    expect(effectiveSchedule(base, preset, [], { durationSeconds: DURATION })).toEqual(preset);
    expect(effectiveSchedule(base, [], [], { durationSeconds: DURATION })).toEqual([]);
    const forced = effectiveSchedule(base, [], [], { durationSeconds: DURATION, ensureTimeline: true });
    expect(forced.length).toBe(1);
    for (const t of [0, 1000, DURATION]) expect(weatherAt(base, forced, t)).toEqual(weatherAt(base, [], t));
  });

  it('leaves the weather before the change untouched, reaches the new weather after it, and is a valid schedule', () => {
    const edits = addLiveEdit([], 4000, state({ windSpeedMps: 18, windFromDeg: 40, temperatureC: 38, relativeHumidity: 0.08 }));
    const sched = effectiveSchedule(base, preset, edits, { durationSeconds: DURATION });
    const b = edits[0].tSeconds;
    for (const t of [0, 500, 1800, 3000, b - LIVE_STEP_S / 2]) {
      const a = weatherAt(base, sched, t);
      const o = weatherAt(base, preset, t);
      for (const k of Object.keys(a) as (keyof WeatherState)[]) expect(a[k], `${k} @${t}`).toBeCloseTo(o[k], 9);
    }
    for (const t of [b + LIVE_STEP_S / 2, b + 5000, DURATION]) expect(weatherAt(base, sched, t)).toEqual(edits[0].state);
    expect(validateScenario({ ...area(1, false), weather: base, weatherSchedule: sched })).toEqual([]);
  });

  it('chains several edits and ignores one that falls after the end', () => {
    let edits: LiveEdit[] = [];
    edits = addLiveEdit(edits, 1000, state({ windSpeedMps: 9 }));
    edits = addLiveEdit(edits, 5000, state({ windSpeedMps: 14, windFromDeg: 90 }));
    edits = addLiveEdit(edits, DURATION + 1000, state({ windSpeedMps: 99 }));
    const sched = effectiveSchedule(base, [], edits, { durationSeconds: DURATION });
    expect(weatherAt(base, sched, 3000).windSpeedMps).toBeCloseTo(9, 9);
    expect(weatherAt(base, sched, 8000).windSpeedMps).toBeCloseTo(14, 9);
    expect(weatherAt(base, sched, DURATION).windSpeedMps).toBeCloseTo(14, 9);
    for (let i = 1; i < sched.length; i++) expect(sched[i].tSeconds).toBeGreaterThan(sched[i - 1].tSeconds);
  });
});

describe('displayWeather', () => {
  it('shows a not-yet-effective change at once, but not before it was made', () => {
    const base = { ...DEFAULT_WEATHER, windSpeedMps: 5 };
    const edits = addLiveEdit([], 2000, state({ windSpeedMps: 20 }));
    const sched = effectiveSchedule(base, [], edits, { durationSeconds: DURATION });
    expect(displayWeather(base, sched, edits, 2000).windSpeedMps).toBe(20);
    expect(displayWeather(base, sched, edits, 1000).windSpeedMps).toBe(5);
    expect(displayWeather(base, sched, edits, 9000).windSpeedMps).toBeCloseTo(20, 9);
  });
});

describe('the solver: a live change never rewrites what already burned', () => {
  const run = (s: Scenario, edits: LiveEdit[]): Float32Array =>
    simulate({
      ...s,
      weatherStepS: LIVE_STEP_S,
      weatherSchedule: effectiveSchedule(s.weather, [], edits, { stepS: LIVE_STEP_S, durationSeconds: s.durationSeconds, ensureTimeline: true }),
    }).arrivalTime;

  /** Cells that burn by T are identical in both runs, in both directions (same cells, same times). */
  function sameHistory(a: Float32Array, b: Float32Array, T: number): { bad: number; burnedBefore: number } {
    let bad = 0;
    let burnedBefore = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] <= T || b[i] <= T) {
        burnedBefore++;
        if (a[i] !== b[i]) bad++;
      }
    }
    return { bad, burnedBefore };
  }

  const cases = [
    { seed: 3, wet: false, spot: false },
    { seed: 4, wet: true, spot: false },
    { seed: 5, wet: false, spot: true },
    { seed: 6, wet: true, spot: true },
  ];
  for (const c of cases) {
    it(`random edits: seed ${c.seed}, water ${c.wet}, spotting ${c.spot}`, () => {
      const base = area(c.seed, c.wet);
      const s: Scenario = { ...base, settings: { ...base.settings, spottingEnabled: c.spot, spottingIgnitionProb: 0.2 } };
      const noEdit = run(s, []);
      const rand = mulberry32(c.seed * 7);
      let differedAfter = 0;
      let mostBurnedBefore = 0;
      for (let trial = 0; trial < 10; trial++) {
        const T = 1200 + Math.floor(rand() * 12000);
        const next = state({
          windSpeedMps: rand() * 20,
          windFromDeg: rand() * 360,
          temperatureC: 15 + rand() * 25,
          relativeHumidity: 0.08 + rand() * 0.6,
        });
        const edits = addLiveEdit([], T, next);
        const after = run(s, edits);
        const { bad, burnedBefore } = sameHistory(noEdit, after, T);
        expect(bad, `T=${T}`).toBe(0);
        mostBurnedBefore = Math.max(mostBurnedBefore, burnedBefore);
        for (let i = 0; i < after.length; i++) if (after[i] !== noEdit[i]) { differedAfter++; break; }
      }
      expect(mostBurnedBefore, 'the history check is not vacuous').toBeGreaterThan(300);
      expect(differedAfter, 'the edits actually change the fire later on').toBeGreaterThan(6);
    });
  }

  it('two successive edits (made while the first is still playing out) keep the history of both', () => {
    const s = area(8, true);
    const e1 = addLiveEdit([], 2000, state({ windFromDeg: 60, windSpeedMps: 12 }));
    const e2 = addLiveEdit(e1, 6000, state({ windFromDeg: 300, windSpeedMps: 3 }));
    const a = run(s, e1);
    const b = run(s, e2);
    expect(sameHistory(a, b, 6000).bad).toBe(0);
    expect(sameHistory(run(s, []), a, 2000).bad).toBe(0);
  });

  it('a wind turn really moves the fire: downwind cells burn sooner after a 180 degree change', () => {
    const s = area(9, false);
    const west = run(s, addLiveEdit([], 3600, state({ windFromDeg: 270, windSpeedMps: 14 })));
    const east = run(s, addLiveEdit([], 3600, state({ windFromDeg: 90, windSpeedMps: 14 })));
    const burnedCols = (a: Float32Array, t: number): number => {
      let sum = 0, n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] <= t) { sum += i % W; n++; }
      return sum / n;
    };
    // wind FROM the west blows the fire east: the burned centroid ends up further east than with wind from the east
    expect(burnedCols(west, 3 * 3600)).toBeGreaterThan(burnedCols(east, 3 * 3600) + 3);
  });
});
