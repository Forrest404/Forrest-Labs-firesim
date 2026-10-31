/** Simulate button, play/pause, speed, scrubber, simulated clock and live stats. */

import type { Store } from '../app/state';
import { liveStats } from '../app/overlayPainter';
import { scheduleFromPreset } from '../contract';
import type { Scenario } from '../contract';
import { intensityClass } from '../sim/intensity';
import { createWeatherTimeline } from '../sim/weather';
import type { WeatherTimeline } from '../sim/weather';
import { el, formatClock } from './el';
import { STR } from './strings';

const SPEEDS = [1, 4, 16, 64, 256];

export interface PlaybackActions {
  simulate(): void;
  cancel(): void;
}

// The weather timeline only changes when its inputs do, so it is cached between playback ticks.
let cachedKey = '';
let cachedTimeline: WeatherTimeline | null = null;
function timelineFor(s: { weather: Scenario['weather']; weatherPreset: Parameters<typeof scheduleFromPreset>[0]; settings: Scenario['settings']; durationSeconds: number }): WeatherTimeline | null {
  const key = JSON.stringify([s.weather, s.weatherPreset, s.settings.fuelMoistureLagS, s.durationSeconds]);
  if (key !== cachedKey) {
    cachedKey = key;
    const schedule = scheduleFromPreset(s.weatherPreset, s.weather);
    cachedTimeline = schedule.length ? createWeatherTimeline({ weather: s.weather, weatherSchedule: schedule, settings: s.settings, durationSeconds: s.durationSeconds } as Scenario) : null;
  }
  return cachedTimeline;
}

export function mountPlayback(container: HTMLElement, store: Store, actions: PlaybackActions): void {
  const simulateBtn = el('button', { class: 'primary', onclick: () => actions.simulate() }, STR.simulate) as HTMLButtonElement;
  const cancelBtn = el('button', { onclick: () => actions.cancel() }, STR.cancel) as HTMLButtonElement;
  const hint = el('div', { class: 'muted' });
  const error = el('div', { class: 'error-text', role: 'alert' });

  const playBtn = el('button', { onclick: () => store.update((s) => ({ playback: { ...s.playback, playing: !s.playback.playing, t: s.playback.t >= s.durationSeconds ? 0 : s.playback.t } })) }) as HTMLButtonElement;
  const restartBtn = el('button', { onclick: () => store.update((s) => ({ playback: { ...s.playback, t: 0, playing: true } })) }, STR.restart) as HTMLButtonElement;
  const speedBtns = SPEEDS.map((sp) =>
    el('button', { class: 'speed', onclick: () => store.update((s) => ({ playback: { ...s.playback, speed: sp } })) }, `${sp}×`) as HTMLButtonElement,
  );
  const scrub = el('input', { type: 'range', min: 0, max: 1, step: 30, 'aria-label': STR.scrubber }) as HTMLInputElement;
  scrub.oninput = () => store.update((s) => ({ playback: { ...s.playback, t: Number(scrub.value), playing: false } }));
  const clock = el('span', { class: 'value clock' });
  const stats = el('div', { class: 'stats' });

  container.append(
    el('h2', {}, STR.simulateTitle),
    el('div', { class: 'row' }, simulateBtn, cancelBtn),
    hint,
    error,
    el('div', { class: 'row' }, playBtn, restartBtn, ...speedBtns),
    el('label', {}, scrub, clock),
    stats,
  );

  store.subscribe((s) => {
    const hasArea = !!s.area;
    simulateBtn.disabled = !hasArea || !s.ignition || s.simRunning;
    simulateBtn.textContent = s.simRunning ? STR.simulating : s.result && s.resultStale ? STR.reSimulate : STR.simulate;
    simulateBtn.classList.toggle('stale', !!s.result && s.resultStale);
    cancelBtn.style.display = s.simRunning ? '' : 'none';
    hint.textContent = !s.ignition ? STR.placeIgnitionHint : s.result && s.resultStale ? STR.staleHint : '';
    error.textContent = s.simError ?? '';

    const has = !!s.result;
    playBtn.disabled = restartBtn.disabled = scrub.disabled = !has;
    for (const b of speedBtns) b.disabled = !has;
    playBtn.textContent = s.playback.playing ? STR.pause : STR.play;
    speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === s.playback.speed));
    scrub.max = String(s.durationSeconds);
    if (document.activeElement !== scrub) scrub.value = String(s.playback.t);
    clock.textContent = formatClock(s.playback.t);
    if (has && s.area) {
      const st = liveStats(s.result, s.area.grid, s.playback.t);
      const fire = st.maxIntensityKwM > 0
        ? ` · ${STR.peakIntensity} ${st.maxIntensityKwM.toFixed(0)} kW/m (${STR.intensityClass[intensityClass(st.maxIntensityKwM)]}), ${STR.flameLength} ${st.maxFlameLengthM.toFixed(1)} m`
        : '';
      const tl = timelineFor(s);
      const wind = tl ? ` · ${STR.windNow} ${Math.round(tl.speedAt(s.playback.t) * 3.6)} km/h from ${Math.round(tl.fromDegAt(s.playback.t))}°` : '';
      stats.textContent = `${st.burnedAreaHa.toFixed(0)} ha · ${st.burnedCells} cells burned${fire}${wind} · ${STR.simTime} ${s.result!.stats.runtimeMs.toFixed(0)} ms`;
    } else stats.textContent = '';
  });
}
