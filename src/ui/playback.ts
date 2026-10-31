/** Big Simulate button, hint line, transport controls (icons), speed chips, scrubber, clock, stats. */

import type { Store } from '../app/state';
import { liveStats } from '../app/overlayPainter';
import { chip, iconButton, segmented, slider } from './controls';
import { el, formatClock } from './el';
import { icon } from './icons';
import { STR } from './strings';

const SPEEDS = [1, 4, 16, 64, 256];
const NUM = new Intl.NumberFormat('en');

export interface PlaybackActions {
  simulate(): void;
  cancel(): void;
}

export function mountPlayback(container: HTMLElement, store: Store, actions: PlaybackActions): void {
  const simLabel = el('span', {});
  const simIcon = el('span', { class: 'btn-icon' });
  const simulateBtn = el('button', { type: 'button', class: 'primary big', onclick: () => actions.simulate() }, simIcon, simLabel) as HTMLButtonElement;
  const cancelBtn = iconButton('x', STR.cancel, () => actions.cancel(), { class: 'cancel' });
  const hint = el('div', { class: 'hint muted' });
  const error = el('div', { class: 'error-text', role: 'alert' });

  const playBtn = iconButton('play', STR.play, () =>
    store.update((s) => ({ playback: { ...s.playback, playing: !s.playback.playing, t: s.playback.t >= s.durationSeconds ? 0 : s.playback.t } })), { class: 'play' });
  const restartBtn = iconButton('restart', STR.restart, () => store.update((s) => ({ playback: { ...s.playback, t: 0, playing: true } })));
  const speed = segmented(SPEEDS.map((sp) => ({ value: sp, label: `${sp}×` })), (sp) => store.update((s) => ({ playback: { ...s.playback, speed: sp } })), { ariaLabel: STR.speed, class: 'small' });
  const scrub = slider({ min: 0, max: 1, step: 30, ariaLabel: STR.scrubber }, (v) => store.update((s) => ({ playback: { ...s.playback, t: v, playing: false } })));
  const clock = el('span', { class: 'clock' });
  const area = chip('', 'stat');
  const cells = chip('', 'stat');
  const stats = el('div', { class: 'stats' }, area, cells);
  const transport = el('div', { class: 'transport' },
    el('div', { class: 'row tight' }, playBtn, restartBtn, clock),
    speed.root,
  );

  container.append(
    el('div', { class: 'sim-row' }, simulateBtn, cancelBtn),
    hint,
    error,
    transport,
    scrub,
    stats,
  );

  let lastSimIcon = '';
  let lastPlaying: boolean | null = null;
  store.subscribe((s) => {
    const hasArea = !!s.area;
    const stale = !!s.result && s.resultStale;
    simulateBtn.disabled = !hasArea || !s.ignition || s.simRunning;
    simLabel.textContent = s.simRunning ? STR.simulating : stale ? STR.reSimulate : STR.simulate;
    const simIconName = s.simRunning ? 'loader' : stale ? 'restart' : '';
    if (simIconName !== lastSimIcon) { lastSimIcon = simIconName; simIcon.replaceChildren(...(simIconName ? [icon(simIconName)] : [])); }
    simulateBtn.classList.toggle('stale', stale);
    simulateBtn.classList.toggle('running', s.simRunning);
    cancelBtn.hidden = !s.simRunning;
    hint.textContent = !s.ignition ? STR.placeIgnitionHint : stale ? STR.staleHint : '';
    error.textContent = s.simError ?? '';

    const has = !!s.result;
    transport.classList.toggle('off', !has);
    playBtn.disabled = restartBtn.disabled = scrub.disabled = !has;
    speed.setDisabled(!has);
    if (s.playback.playing !== lastPlaying) {
      lastPlaying = s.playback.playing;
      playBtn.replaceChildren(icon(s.playback.playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', s.playback.playing ? STR.pause : STR.play);
      playBtn.title = s.playback.playing ? STR.pause : STR.play;
    }
    speed.set(s.playback.speed);
    scrub.max = String(s.durationSeconds);
    if (document.activeElement !== scrub) scrub.value = String(s.playback.t);
    clock.textContent = formatClock(s.playback.t);
    stats.hidden = !has;
    if (has && s.area) {
      const st = liveStats(s.result, s.area.grid, s.playback.t);
      area.textContent = `${NUM.format(Math.round(st.burnedAreaHa))} ha`;
      cells.textContent = `${NUM.format(st.burnedCells)} ${STR.cellsBurned}`;
    }
  });
}
