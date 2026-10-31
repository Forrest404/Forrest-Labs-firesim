/**
 * Conditions: wind speed (filled slider), wind direction (draggable compass dial + slider),
 * dryness preset (chips, data from presets.ts), duration (chips). Writes SI into the store.
 */

import { DRYNESS_PRESETS, DRYNESS_PRESET_ORDER, applyDrynessPreset, deriveFuelMoisture, windTowardDeg } from '../contract';
import type { DrynessPreset } from '../contract';
import { staleIfResult } from '../app/state';
import type { Store } from '../app/state';
import { chip, row, segmented, slider } from './controls';
import { compass, el, formatDuration } from './el';
import { icon } from './icons';
import { STR } from './strings';

const DURATIONS = [3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600];
const RED_FLAG_WIND_KMH = 40;

export function mountSettingsSimple(container: HTMLElement, store: Store): void {
  const speed = slider({ min: 0, max: 80, step: 1, ariaLabel: STR.windSpeed }, (v) =>
    store.update((s) => ({ weather: { ...s.weather, windSpeedMps: v / 3.6 }, ...staleIfResult(s) })));
  const speedVal = chip('', 'value');

  const setDir = (deg: number) => store.update((s) => ({ weather: { ...s.weather, windFromDeg: ((deg % 360) + 360) % 360 }, ...staleIfResult(s) }));
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
    (p) => { if (p !== 'custom') store.update((s) => ({ weather: applyDrynessPreset(s.weather, p as DrynessPreset), ...staleIfResult(s) })); },
    { ariaLabel: STR.dryness, class: 'grow' },
  );
  const customBtn = dryness.root.lastElementChild as HTMLButtonElement;
  customBtn.classList.add('ghost');
  const drynessVal = chip('', 'value');

  const duration = segmented(
    DURATIONS.map((d) => ({ value: d, label: formatDuration(d) })),
    (d) => store.update((s) => ({ durationSeconds: d, ...staleIfResult(s) })),
    { ariaLabel: STR.duration, class: 'grow' },
  );

  // One click for the demo: extreme dryness and Red Flag wind, keeping the wind direction.
  const redFlag = el('button', {
    type: 'button',
    title: STR.redFlagTitle,
    onclick: () => store.update((s) => ({ weather: { ...applyDrynessPreset(s.weather, 'extreme'), windSpeedMps: RED_FLAG_WIND_KMH / 3.6 }, ...staleIfResult(s) })),
  }, icon('flame', 16), el('span', {}, STR.redFlag));

  container.append(
    row(STR.windSpeed, speed, speedVal),
    el('div', { class: 'ctl-row wind' },
      el('span', { class: 'ctl-label' }, STR.windFrom),
      el('div', { class: 'ctl' }, dial, el('div', { class: 'stack' }, dir, dirVal)),
    ),
    el('div', { class: 'ctl-row stacked' }, el('div', { class: 'ctl-label-row' }, el('span', { class: 'ctl-label' }, STR.dryness), drynessVal), dryness.root),
    el('div', { class: 'ctl-row stacked' }, el('span', { class: 'ctl-label' }, STR.duration), duration.root),
    el('div', { class: 'row' }, redFlag),
  );

  store.subscribe((s) => {
    const w = s.weather;
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
  });
}
