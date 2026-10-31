import { describe, expect, it } from 'vitest';
import { DEFAULT_WEATHER, WEATHER_PRESETS, WEATHER_PRESET_ORDER, applyDrynessPreset, deriveFuelMoisture, scheduleFromPreset, validateScenario } from '../src/contract';
import type { Scenario, WeatherKeyframe } from '../src/contract';
import { createWeatherTimeline } from '../src/sim/weather';
import { makeFixture } from './fixtures';

const withSchedule = (kf: WeatherKeyframe[] | undefined, o: Parameters<typeof makeFixture>[0] = {}): Scenario => ({ ...makeFixture(o), weatherSchedule: kf });

describe('weather timeline', () => {
  it('no schedule (missing or empty) means no timeline: the fast constant path is kept', () => {
    expect(createWeatherTimeline(withSchedule(undefined))).toBeNull();
    expect(createWeatherTimeline(withSchedule([]))).toBeNull();
  });

  it('starts from Scenario.weather, interpolates linearly, holds after the last keyframe', () => {
    const s = withSchedule([{ tSeconds: 3600, windSpeedMps: 10 }, { tSeconds: 7200, windSpeedMps: 4 }], { weather: { windSpeedMps: 2 } });
    const tl = createWeatherTimeline(s)!;
    expect(tl.speedAt(0)).toBe(2);
    expect(tl.speedAt(1800)).toBeCloseTo(6, 12);
    expect(tl.speedAt(3600)).toBe(10);
    expect(tl.speedAt(5400)).toBeCloseTo(7, 12);
    expect(tl.speedAt(7200)).toBe(4);
    expect(tl.speedAt(99999)).toBe(4);
    expect(tl.speedAt(-5)).toBe(2);
  });

  it('each field follows only its own keyframes (a keyframe that omits a field leaves it alone)', () => {
    const s = withSchedule([{ tSeconds: 3600, windSpeedMps: 9 }, { tSeconds: 7200, windFromDeg: 0 }], { weather: { windSpeedMps: 3, windFromDeg: 270 } });
    const tl = createWeatherTimeline(s)!;
    expect(tl.speedAt(7200)).toBe(9);
    expect(tl.speedAt(10_000)).toBe(9);
    // Direction ramps from its t=0 value (270) to the keyframe (0 = 360) along the shorter arc (+90 degrees).
    expect(tl.fromDegAt(1800)).toBeCloseTo(292.5, 9);
    expect(tl.fromDegAt(3600)).toBeCloseTo(315, 9);
    expect(tl.fromDegAt(7200)).toBeCloseTo(0, 9);
  });

  it('a keyframe at t = 0 overrides the starting value', () => {
    const tl = createWeatherTimeline(withSchedule([{ tSeconds: 0, windSpeedMps: 7 }, { tSeconds: 3600, windSpeedMps: 7 }], { weather: { windSpeedMps: 2 } }))!;
    expect(tl.speedAt(0)).toBe(7);
  });

  it('wind direction interpolates along the shorter arc across north (350 -> 10 passes through 0)', () => {
    const tl = createWeatherTimeline(withSchedule([{ tSeconds: 1000, windFromDeg: 10 }], { weather: { windFromDeg: 350 } }))!;
    expect(tl.fromDegAt(500)).toBeCloseTo(0, 9);
    expect(tl.fromDegAt(250)).toBeCloseTo(355, 9);
    expect(tl.fromDegAt(750)).toBeCloseTo(5, 9);
    const back = createWeatherTimeline(withSchedule([{ tSeconds: 1000, windFromDeg: 350 }], { weather: { windFromDeg: 10 } }))!;
    expect(back.fromDegAt(500)).toBeCloseTo(0, 9);
    for (let t = 0; t <= 1000; t += 50) {
      const d = tl.fromDegAt(t);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(360);
    }
    // 90 -> 270 is exactly half a turn; either arc is valid, but it must be continuous and end at 270.
    const half = createWeatherTimeline(withSchedule([{ tSeconds: 100, windFromDeg: 270 }], { weather: { windFromDeg: 90 } }))!;
    expect(half.fromDegAt(100)).toBeCloseTo(270, 9);
  });

  it('wind speed never goes negative and humidity stays in 0-1', () => {
    const tl = createWeatherTimeline(withSchedule([{ tSeconds: 100, windSpeedMps: 0 }, { tSeconds: 200, relativeHumidity: 1 }]))!;
    for (let t = 0; t < 400; t += 10) {
      expect(tl.speedAt(t)).toBeGreaterThanOrEqual(0);
      expect(tl.humidityAt(t)).toBeGreaterThanOrEqual(0);
      expect(tl.humidityAt(t)).toBeLessThanOrEqual(1);
    }
  });
});

describe('fuel moisture follows the weather with a lag', () => {
  const base = applyDrynessPreset({ ...DEFAULT_WEATHER }, 'medium');
  const mk = (kf: WeatherKeyframe[], lag: number, dur = 24 * 3600): Scenario => {
    const s = makeFixture({ weather: base, durationSeconds: dur });
    return { ...s, weatherSchedule: kf, settings: { ...s.settings, fuelMoistureLagS: lag } };
  };

  it('a constant schedule reproduces constant moisture exactly, with any lag', () => {
    for (const lag of [0, 600, 3600, 36000]) {
      const tl = createWeatherTimeline(mk([{ tSeconds: 3600, temperatureC: base.temperatureC, relativeHumidity: base.relativeHumidity }], lag))!;
      for (const t of [0, 100, 1800, 3600, 20_000, 80_000]) expect(tl.baseMoistureAt(t)).toBeCloseTo(base.baseFuelMoisture, 12);
    }
  });

  it('respects an explicit moisture override at t = 0 (offset from the derived value is preserved)', () => {
    const s = mk([{ tSeconds: 3600, relativeHumidity: base.relativeHumidity }], 3600);
    s.weather = { ...s.weather, baseFuelMoisture: 0.2 };
    const tl = createWeatherTimeline(s)!;
    expect(tl.baseMoistureAt(0)).toBeCloseTo(0.2, 12);
    expect(tl.baseMoistureAt(50_000)).toBeCloseTo(0.2, 9);
  });

  it('lag 0: moisture jumps with the weather; lag 3600: it covers 1 - 1/e of the gap after one lag', () => {
    const wetter = [{ tSeconds: 1, relativeHumidity: 0.9 }, { tSeconds: 2, relativeHumidity: 0.9 }];
    const eqWet = deriveFuelMoisture(base.temperatureC, 0.9) + (base.baseFuelMoisture - deriveFuelMoisture(base.temperatureC, base.relativeHumidity));
    const instant = createWeatherTimeline(mk(wetter, 0))!;
    expect(instant.baseMoistureAt(600)).toBeCloseTo(eqWet, 4);
    const lagged = createWeatherTimeline(mk(wetter, 3600))!;
    const gap = eqWet - base.baseFuelMoisture;
    expect(gap).toBeGreaterThan(0.05);
    expect(lagged.baseMoistureAt(3600)).toBeCloseTo(base.baseFuelMoisture + gap * (1 - Math.exp(-1)), 2);
    expect(lagged.baseMoistureAt(3 * 3600)).toBeCloseTo(base.baseFuelMoisture + gap * (1 - Math.exp(-3)), 2);
    // Monotone approach, never overshooting.
    let prev = base.baseFuelMoisture;
    for (let t = 0; t <= 24 * 3600; t += 600) {
      const m = lagged.baseMoistureAt(t);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(m).toBeLessThanOrEqual(eqWet + 1e-9);
      prev = m;
    }
  });

  it('drier air lowers moisture, hotter air lowers it, and moisture stays in a sane range', () => {
    const dry = createWeatherTimeline(mk([{ tSeconds: 3600, relativeHumidity: 0.05, temperatureC: 40 }], 1800))!;
    expect(dry.baseMoistureAt(10 * 3600)).toBeLessThan(base.baseFuelMoisture);
    for (let t = 0; t <= 24 * 3600; t += 1800) {
      expect(dry.baseMoistureAt(t)).toBeGreaterThanOrEqual(0);
      expect(dry.baseMoistureAt(t)).toBeLessThanOrEqual(0.9);
    }
  });
});

describe('presets and validation', () => {
  it('every preset yields valid, strictly increasing keyframes for any starting weather', () => {
    for (const id of WEATHER_PRESET_ORDER) {
      const kf = scheduleFromPreset(id, applyDrynessPreset({ ...DEFAULT_WEATHER, windFromDeg: 300, windSpeedMps: 7 }, 'high'));
      expect(kf.length).toBe(WEATHER_PRESETS[id].steps.length);
      const s = { ...makeFixture(), weatherSchedule: kf };
      expect(validateScenario(s), id).toEqual([]);
      for (let i = 1; i < kf.length; i++) expect(kf[i].tSeconds).toBeGreaterThan(kf[i - 1].tSeconds);
      for (const k of kf) {
        expect(k.windFromDeg!).toBeGreaterThanOrEqual(0);
        expect(k.windFromDeg!).toBeLessThan(360);
      }
    }
    expect(scheduleFromPreset('steady', DEFAULT_WEATHER)).toEqual([]);
  });

  it('rejects unsorted, duplicate, negative and out-of-range keyframes', () => {
    const bad = (kf: WeatherKeyframe[]): string[] => validateScenario({ ...makeFixture(), weatherSchedule: kf });
    expect(bad([{ tSeconds: 100 }, { tSeconds: 50 }]).some((e) => e.includes('increasing'))).toBe(true);
    expect(bad([{ tSeconds: 100 }, { tSeconds: 100 }]).some((e) => e.includes('increasing'))).toBe(true);
    expect(bad([{ tSeconds: -1 }]).some((e) => e.includes('>= 0'))).toBe(true);
    expect(bad([{ tSeconds: NaN }]).length).toBeGreaterThan(0);
    expect(bad([{ tSeconds: 10, windSpeedMps: -3 }]).some((e) => e.includes('wind speed'))).toBe(true);
    expect(bad([{ tSeconds: 10, relativeHumidity: 1.5 }]).some((e) => e.includes('humidity'))).toBe(true);
    expect(bad([{ tSeconds: 10, temperatureC: 200 }]).some((e) => e.includes('temperature'))).toBe(true);
    expect(bad([{ tSeconds: 10, windFromDeg: NaN }]).some((e) => e.includes('direction'))).toBe(true);
    expect(bad(Array.from({ length: 201 }, (_, i) => ({ tSeconds: i + 1 }))).some((e) => e.includes('200'))).toBe(true);
    expect(bad([{ tSeconds: 10 }, { tSeconds: 20, windSpeedMps: 5 }])).toEqual([]);
    const lag = makeFixture();
    expect(validateScenario({ ...lag, settings: { ...lag.settings, fuelMoistureLagS: -1 } }).some((e) => e.includes('fuelMoistureLagS'))).toBe(true);
  });
});
