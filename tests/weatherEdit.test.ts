import { describe, expect, it } from 'vitest';
import type { SimResult } from '../src/contract';
import { createStore, initialState } from '../src/app/state';
import type { AppState, Store } from '../src/app/state';
import { clearLiveEdits, currentWeather, isLiveEditing, scheduleFor, setDryness, setLive, setWeatherPreset, setWindFrom, setWindSpeed } from '../src/app/weatherEdit';

const RESULT = {} as SimResult;

function storeAt(o: Partial<AppState>): Store {
  return createStore({ ...initialState(), ...o });
}

describe('weather edits', () => {
  it('before any result, a change is to the starting weather and nothing is flagged', () => {
    const st = storeAt({});
    setWindSpeed(st, 12);
    const s = st.get();
    expect(s.weather.windSpeedMps).toBe(12);
    expect(s.liveEdits).toEqual([]);
    expect(s.resultStale).toBe(false);
    expect(s.autoRun).toBe(0);
  });

  it('during playback it becomes a live edit: the starting weather is untouched, a re-run is requested, nothing is stale', () => {
    const st = storeAt({ result: RESULT, playback: { t: 2000, playing: true, speed: 64 } });
    const before = st.get().weather;
    setWindSpeed(st, 15);
    const s = st.get();
    expect(s.weather).toBe(before);
    expect(s.liveEdits.length).toBe(1);
    expect(s.liveEdits[0].state.windSpeedMps).toBe(15);
    expect(s.liveEdits[0].madeAtS).toBe(2000);
    expect(s.autoRun).toBe(1);
    expect(s.resultStale).toBe(false);
    expect(isLiveEditing(s)).toBe(true);
  });

  it('shows the new value at once, composes speed then direction, and one slot keeps one edit', () => {
    const st = storeAt({ result: RESULT, playback: { t: 2000, playing: false, speed: 64 } });
    const start = currentWeather(st.get());
    setWindSpeed(st, 15);
    setWindFrom(st, 123);
    setWindFrom(st, 130);
    const s = st.get();
    expect(s.liveEdits.length).toBe(1);
    const now = currentWeather(s);
    expect(now.windSpeedMps).toBe(15);
    expect(now.windFromDeg).toBe(130);
    expect(now.temperatureC).toBe(start.temperatureC);
    // scrubbed back to before the change was made, the old weather is what applied then
    expect(currentWeather({ ...s, playback: { ...s.playback, t: 500 } }).windSpeedMps).toBeCloseTo(start.windSpeedMps, 9);
  });

  it('at t = 0 a change rewrites the starting weather, drops live edits, and re-runs', () => {
    const st = storeAt({ result: RESULT, playback: { t: 2000, playing: false, speed: 64 } });
    setWindSpeed(st, 15);
    st.update((s) => ({ playback: { ...s.playback, t: 0 } }));
    setWindFrom(st, 45);
    const s = st.get();
    expect(s.weather.windFromDeg).toBe(45);
    expect(s.liveEdits).toEqual([]);
    expect(s.autoRun).toBe(2);
  });

  it('with live off, a change is to the starting weather and the result is flagged stale instead', () => {
    const st = storeAt({ result: RESULT, live: false, playback: { t: 2000, playing: false, speed: 64 } });
    setWindSpeed(st, 15);
    const s = st.get();
    expect(s.weather.windSpeedMps).toBe(15);
    expect(s.liveEdits).toEqual([]);
    expect(s.resultStale).toBe(true);
    expect(s.autoRun).toBe(0);
  });

  it('dryness works live: temperature and humidity change from then on, the preset keeps its meaning at the start', () => {
    const live = storeAt({ result: RESULT, playback: { t: 3000, playing: false, speed: 64 } });
    setDryness(live, 'extreme');
    expect(live.get().liveEdits[0].state.relativeHumidity).toBeLessThan(0.2);
    const start = storeAt({});
    setDryness(start, 'extreme');
    expect(start.get().weather.relativeHumidity).toBe(live.get().liveEdits[0].state.relativeHumidity);
    expect(start.get().weather.baseFuelMoisture).toBeLessThan(0.08);
  });

  it('a new preset, switching live off, or clearing drops the edits; switching live on re-runs', () => {
    const mk = (): Store => {
      const st = storeAt({ result: RESULT, playback: { t: 2000, playing: false, speed: 64 } });
      setWindSpeed(st, 15);
      return st;
    };
    let st = mk();
    setWeatherPreset(st, 'windShift');
    expect(st.get().liveEdits).toEqual([]);
    expect(st.get().weatherPreset).toBe('windShift');
    st = mk();
    setLive(st, false);
    expect(st.get().live).toBe(false);
    expect(st.get().liveEdits).toEqual([]);
    expect(st.get().resultStale).toBe(true);
    const runs = st.get().autoRun;
    setLive(st, true);
    expect(st.get().autoRun).toBe(runs + 1);
    st = mk();
    const n = st.get().autoRun;
    clearLiveEdits(st);
    expect(st.get().liveEdits).toEqual([]);
    expect(st.get().autoRun).toBe(n + 1);
    clearLiveEdits(st); // nothing to clear: no pointless re-run
    expect(st.get().autoRun).toBe(n + 1);
  });

  it('the schedule: single live runs always use the time-varying path, ensembles only when there is something to vary', () => {
    const st = storeAt({});
    expect(scheduleFor(st.get()).length).toBe(1);
    expect(scheduleFor(st.get(), true)).toEqual([]);
    st.set({ live: false });
    expect(scheduleFor(st.get())).toEqual([]);
  });
});
