/**
 * Conditions: wind speed (filled slider), wind direction (draggable compass dial + slider),
 * dryness preset (chips, data from presets.ts), weather over time, duration (chips). Writes SI into
 * the store. Every wind/dryness change goes through app/weatherEdit.ts, so while Live is on and a
 * result exists it takes effect from the current playback time on and re-runs by itself.
 */

import { DRYNESS_PRESETS, DRYNESS_PRESET_ORDER, WEATHER_PRESETS, WEATHER_PRESET_ORDER, deriveFuelMoisture, windTowardDeg } from '../contract';
import type { DrynessPreset, WeatherPresetId } from '../contract';
import { staleIfResult } from '../app/state';
import type { Store } from '../app/state';
import { clearLiveEdits, currentWeather, isLiveEditing, setDryness, setLive, setWeatherPreset, setWindFrom, setWindSpeed } from '../app/weatherEdit';
import { chip, row, segmented, slider, toggle } from './controls';
import { compass, el, formatClock, formatDuration } from './el';
import { icon } from './icons';
import { STR } from './strings';

const DURATIONS = [3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600];
const RED_FLAG_WIND_KMH = 40;

export function mountSettingsSimple(container: HTMLElement, store: Store): void {
  const speed = slider({ min: 0, max: 80, step: 1, ariaLabel: STR.windSpeed }, (v) => setWindSpeed(store, v / 3.6));
  const speedVal = chip('', 'value');

  const setDir = (deg: number) => setWindFrom(store, ((deg % 360) + 360) % 360);
  const dir = slider({ min: 0, max: 359, step: 1, ariaLabel: STR.windFrom }, setDir);
  const dirVal = chip('', 'value');
  const needle = el('span', { class: 'needle' }, icon('arrow', 14));
  const dial = el('div', { class: 'dial', title: STR.windArrowTitle, role: 'presentation' },
    el('span', { class: 'tick n' }, 'N'), el('span', { class: 'tick e' }, 'E'), el('span', { class: 'tick s' }, 'S'), el('span', { class: 'tick w' }, 'W'),
    needle,
  );
  // Drag anywhere on the dial: the needle points where the wind blows TOWARD, so "from" is opposite.
  const dialDrag = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const toward = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up (north), clockwise
    setDir(toward + 180);
  };
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    dial.classList.add('dragging');
    dialDrag(e);
  });
  dial.addEventListener('pointermove', (e) => { if (dial.classList.contains('dragging')) dialDrag(e); });
  const endDrag = () => dial.classList.remove('dragging');
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);

  const dryness = segmented(
    [...DRYNESS_PRESET_ORDER.map((p) => ({ value: p as string, label: DRYNESS_PRESETS[p].label })), { value: 'custom', label: STR.drynessCustom }],
    (p) => { if (p !== 'custom') setDryness(store, p as DrynessPreset); },
    { ariaLabel: STR.dryness, class: 'grow' },
  );
  const customBtn = dryness.root.lastElementChild as HTMLButtonElement;
  customBtn.classList.add('ghost');
  const drynessVal = chip('', 'value');

  const weatherOverTime = el('select', { 'aria-label': STR.weatherOverTime }) as HTMLSelectElement;
  for (const id of WEATHER_PRESET_ORDER) weatherOverTime.append(el('option', { value: id }, WEATHER_PRESETS[id].label));
  weatherOverTime.onchange = () => setWeatherPreset(store, weatherOverTime.value as WeatherPresetId);

  const duration = segmented(
    DURATIONS.map((d) => ({ value: d, label: formatDuration(d) })),
    (d) => store.update((s) => ({ durationSeconds: d, ...staleIfResult(s) })),
    { ariaLabel: STR.duration, class: 'grow' },
  );

  // One click for the demo: extreme dryness and Red Flag wind, keeping the wind direction.
  const redFlag = el('button', {
    type: 'button',
    title: STR.redFlagTitle,
    onclick: () => {
      setDryness(store, 'extreme');
      setWindSpeed(store, RED_FLAG_WIND_KMH / 3.6);
    },
  }, icon('flame', 16), el('span', {}, STR.redFlag));

  // Live mode: edits made while a result exists apply from the current time on and re-run automatically.
  const live = toggle(STR.liveLabel, (on) => setLive(store, on), { title: STR.liveEditTitle });
  const liveInfo = el('span', { class: 'muted live-info' });
  const liveClear = el('button', { type: 'button', class: 'small', onclick: () => clearLiveEdits(store) }, STR.liveEditClear) as HTMLButtonElement;
  const liveRow = el('div', { class: 'live-row', title: STR.liveEditTitle }, live.root, el('div', { class: 'row' }, liveInfo, liveClear));

  container.append(
    liveRow,
    row(STR.windSpeed, speed, speedVal),
    el('div', { class: 'ctl-row wind' },
      el('span', { class: 'ctl-label' }, STR.windFrom),
      el('div', { class: 'ctl' }, dial, el('div', { class: 'stack' }, dir, dirVal)),
    ),
    el('div', { class: 'ctl-row stacked' }, el('div', { class: 'ctl-label-row' }, el('span', { class: 'ctl-label' }, STR.dryness), drynessVal), dryness.root),
    el('div', { class: 'ctl-row stacked' }, el('span', { class: 'ctl-label' }, STR.weatherOverTime), el('div', { class: 'select-wrap' }, weatherOverTime, icon('chevron', 16))),
    el('div', { class: 'ctl-row stacked' }, el('span', { class: 'ctl-label' }, STR.duration), duration.root),
    el('div', { class: 'row' }, redFlag),
  );

  store.subscribe((s) => {
    // While live (a result exists and the clock is past 0) the controls show the weather in force now.
    const liveView = s.liveEdit && !!s.result && s.playback.t > 0;
    const now = currentWeather(s);
    const w = liveView
      ? { ...s.weather, ...now, baseFuelMoisture: s.weather.baseFuelMoisture - deriveFuelMoisture(s.weather.temperatureC, s.weather.relativeHumidity) + deriveFuelMoisture(now.temperatureC, now.relativeHumidity) }
      : s.weather;
    live.input.checked = s.liveEdit;
    liveInfo.textContent = !s.liveEdit ? STR.liveOffHint : s.liveEdits.length ? STR.liveEdits(s.liveEdits.length, formatClock(s.liveEdits[s.liveEdits.length - 1].tSeconds)) : s.result ? STR.liveIdle : '';
    liveClear.style.display = s.liveEdit && s.liveEdits.length ? '' : 'none';
    liveRow.classList.toggle('editing', isLiveEditing(s));
    const kmh = Math.round(w.windSpeedMps * 3.6);
    if (document.activeElement !== speed) speed.value = String(kmh);
    speedVal.textContent = `${kmh} km/h`;
    const from = Math.round(w.windFromDeg);
    if (document.activeElement !== dir) dir.value = String(from);
    dirVal.textContent = `${from}° ${compass(w.windFromDeg)}`;
    needle.style.transform = `rotate(${windTowardDeg(w.windFromDeg)}deg)`;
    const preset = DRYNESS_PRESET_ORDER.find(
      (p) => DRYNESS_PRESETS[p].temperatureC === w.temperatureC && DRYNESS_PRESETS[p].relativeHumidity === w.relativeHumidity
        && Math.abs(deriveFuelMoisture(w.temperatureC, w.relativeHumidity) - w.baseFuelMoisture) < 1e-6,
    );
    dryness.set(preset ?? 'custom');
    customBtn.hidden = preset !== undefined;
    drynessVal.textContent = `${Math.round(w.baseFuelMoisture * 100)}% moisture`;
    duration.set(s.durationSeconds);
    weatherOverTime.value = s.weatherPreset;
  });
}
