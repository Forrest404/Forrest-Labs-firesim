/**
 * Simple settings: wind speed, wind direction (with an arrow showing where the wind blows
 * TOWARD), dryness preset (data from presets.ts), duration. Writes SI into the store.
 */

import { DRYNESS_PRESETS, DRYNESS_PRESET_ORDER, WEATHER_PRESETS, WEATHER_PRESET_ORDER, deriveFuelMoisture, windTowardDeg } from '../contract';
import type { DrynessPreset, WeatherPresetId } from '../contract';
import { staleIfResult } from '../app/state';
import type { Store } from '../app/state';
import { clearLiveEdits, currentWeather, isLiveEditing, setDryness, setLive, setWeatherPreset, setWindFrom, setWindSpeed } from '../app/weatherEdit';
import { compass, el, formatClock, formatDuration } from './el';
import { STR } from './strings';

const DURATIONS = [3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600];

export function mountSettingsSimple(container: HTMLElement, store: Store): void {
  const speed = el('input', { type: 'range', min: 0, max: 80, step: 1 }) as HTMLInputElement;
  const speedVal = el('span', { class: 'value' });
  const dir = el('input', { type: 'range', min: 0, max: 359, step: 1 }) as HTMLInputElement;
  const dirVal = el('span', { class: 'value' });
  const arrow = el('span', { class: 'wind-arrow', title: STR.windArrowTitle }, '➜');
  const dryness = el('select') as HTMLSelectElement;
  for (const p of DRYNESS_PRESET_ORDER) dryness.append(el('option', { value: p }, DRYNESS_PRESETS[p].label));
  dryness.append(el('option', { value: 'custom', disabled: true }, STR.drynessCustom));
  const drynessVal = el('span', { class: 'value' });
  const weatherOverTime = el('select', { 'aria-label': STR.weatherOverTime }) as HTMLSelectElement;
  for (const id of WEATHER_PRESET_ORDER) weatherOverTime.append(el('option', { value: id }, WEATHER_PRESETS[id].label));
  weatherOverTime.onchange = () => setWeatherPreset(store, weatherOverTime.value as WeatherPresetId);
  const duration = el('select') as HTMLSelectElement;
  for (const d of DURATIONS) duration.append(el('option', { value: d }, formatDuration(d)));

  speed.oninput = () => setWindSpeed(store, Number(speed.value) / 3.6);
  dir.oninput = () => setWindFrom(store, Number(dir.value));
  dryness.onchange = () => setDryness(store, dryness.value as DrynessPreset);
  duration.onchange = () => store.update((s) => ({ durationSeconds: Number(duration.value), ...staleIfResult(s) }));

  const liveBox = el('input', { type: 'checkbox', 'aria-label': STR.liveLabel }) as HTMLInputElement;
  liveBox.onchange = () => setLive(store, liveBox.checked);
  const liveInfo = el('span', { class: 'muted live-info' });
  const liveClear = el('button', { class: 'small', onclick: () => clearLiveEdits(store) }, STR.liveClear) as HTMLButtonElement;
  const liveRow = el('div', { class: 'live-row', title: STR.liveTitle }, el('label', {}, el('span', {}, STR.liveLabel), liveBox), el('div', { class: 'row' }, liveInfo, liveClear));

  container.append(
    el('h2', {}, STR.settingsTitle),
    liveRow,
    el('label', {}, el('span', {}, STR.windSpeed), speed, speedVal),
    el('label', {}, el('span', {}, STR.windFrom), dir, arrow, dirVal),
    el('label', {}, el('span', {}, STR.dryness), dryness, drynessVal),
    el('label', {}, el('span', {}, STR.weatherOverTime), weatherOverTime),
    el('label', {}, el('span', {}, STR.duration), duration),
  );

  store.subscribe((s) => {
    // While live (a result exists and the clock is past 0) the controls show the weather in force now.
    const liveView = s.live && !!s.result && s.playback.t > 0;
    const now = currentWeather(s);
    const w = liveView ? { ...s.weather, ...now, baseFuelMoisture: s.weather.baseFuelMoisture - deriveFuelMoisture(s.weather.temperatureC, s.weather.relativeHumidity) + deriveFuelMoisture(now.temperatureC, now.relativeHumidity) } : s.weather;
    liveBox.checked = s.live;
    liveInfo.textContent = !s.live ? STR.liveOffHint : s.liveEdits.length ? STR.liveEdits(s.liveEdits.length, formatClock(s.liveEdits[s.liveEdits.length - 1].tSeconds)) : s.result ? STR.liveIdle : '';
    liveClear.style.display = s.live && s.liveEdits.length ? '' : 'none';
    liveRow.classList.toggle('editing', isLiveEditing(s));
    const kmh = Math.round(w.windSpeedMps * 3.6);
    if (document.activeElement !== speed) speed.value = String(kmh);
    speedVal.textContent = `${kmh} km/h`;
    if (document.activeElement !== dir) dir.value = String(Math.round(w.windFromDeg));
    dirVal.textContent = `${Math.round(w.windFromDeg)}° (${compass(w.windFromDeg)})`;
    arrow.style.transform = `rotate(${windTowardDeg(w.windFromDeg) - 90}deg)`;
    const preset = DRYNESS_PRESET_ORDER.find(
      (p) => DRYNESS_PRESETS[p].temperatureC === w.temperatureC && DRYNESS_PRESETS[p].relativeHumidity === w.relativeHumidity
        && Math.abs(deriveFuelMoisture(w.temperatureC, w.relativeHumidity) - w.baseFuelMoisture) < 1e-6,
    );
    dryness.value = preset ?? 'custom';
    drynessVal.textContent = `${Math.round(w.baseFuelMoisture * 100)} % moisture`;
    duration.value = String(s.durationSeconds);
    weatherOverTime.value = s.weatherPreset;
  });
}
