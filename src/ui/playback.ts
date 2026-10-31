/** Big Simulate button, hint line, transport controls (icons), speed chips, scrubber, clock, stats. */

import type { Store } from '../app/state';
import { homesReached, overlapAt, overlapAtRealSize, totalHomes } from '../app/impact';
import type { Overlap } from '../app/impact';
import { liveStats } from '../app/overlayPainter';
import type { SimResult } from '../contract';
import { COMPARE_RGBA } from '../viewer/burnCanvas';
import { chip, iconButton, segmented, slider } from './controls';
import { el, formatClock } from './el';
import { icon } from './icons';
import { STR } from './strings';

const SPEEDS = [1, 4, 16, 64, 256, 1024];

export interface PlaybackActions {
  simulate(): void;
  compareWithRealFire(): void;
  realVsSim(): void;
  cancel(): void;
}

export function mountPlayback(container: HTMLElement, store: Store, actions: PlaybackActions): void {
  const simLabel = el('span', {});
  const simIcon = el('span', { class: 'btn-icon' }, icon('flame'));
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

  const impact = el('div', { class: 'impact' });
  const realFire = el('div', { class: 'real-fire' });
  const realSize = new WeakMap<SimResult, Overlap | null>();
  const sideBySideBtn = el('button', { type: 'button', class: 'primary', onclick: () => actions.realVsSim() }, icon('target', 16), el('span', {}, STR.sideBySideButton)) as HTMLButtonElement;
  const compareBtn = el('button', { type: 'button', onclick: () => actions.compareWithRealFire() }, STR.compareButton) as HTMLButtonElement;
  const colorsBtn = el('button', { type: 'button', onclick: () => store.update((s) => ({ compare: !s.compare })) }) as HTMLButtonElement;
  const swatch = (kind: keyof typeof COMPARE_RGBA, label: string): HTMLElement =>
    el('span', { class: 'swatch-item' }, el('span', { class: 'swatch', style: `background: rgba(${COMPARE_RGBA[kind].slice(0, 3).join(',')}, 1)` }), label);
  const legend = el('div', { class: 'legend' }, swatch('both', STR.legendBoth), swatch('missed', STR.legendMissed), swatch('extra', STR.legendExtra));
  const pct = (o: Overlap | null): string => (o ? `${Math.round(o.iou * 100)} %` : STR.neverReal);

  container.append(
    el('div', { class: 'sim-row' }, simulateBtn, cancelBtn),
    hint,
    error,
    transport,
    scrub,
    stats,
    impact,
    realFire,
  );

  store.subscribe((s) => {
    const hasArea = !!s.area;
    const stale = !!s.result && s.resultStale;
    simulateBtn.disabled = !hasArea || !s.ignition || s.simRunning;
    simLabel.textContent = s.simRunning ? STR.simulating : stale ? STR.reSimulate : STR.simulate;
    simIcon.replaceChildren(icon(s.simRunning ? 'loader' : stale ? 'restart' : 'flame'));
    simulateBtn.classList.toggle('stale', stale);
    simulateBtn.classList.toggle('running', s.simRunning);
    cancelBtn.hidden = !s.simRunning;
    hint.textContent = !s.ignition ? STR.placeIgnitionHint : stale ? STR.staleHint : '';
    error.textContent = s.simError ?? '';

    const has = !!s.result;
    transport.classList.toggle('off', !has);
    playBtn.disabled = restartBtn.disabled = scrub.disabled = !has;
    speed.setDisabled(!has);
    playBtn.replaceChildren(icon(s.playback.playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', s.playback.playing ? STR.pause : STR.play);
    playBtn.title = s.playback.playing ? STR.pause : STR.play;
    speed.set(s.playback.speed);
    scrub.max = String(s.durationSeconds);
    if (document.activeElement !== scrub) scrub.value = String(s.playback.t);
    clock.textContent = formatClock(s.playback.t);
    stats.hidden = !has;
    if (has && s.area) {
      const st = liveStats(s.result, s.area.grid, s.playback.t);
      area.textContent = `${st.burnedAreaHa.toFixed(0)} ha`;
      cells.textContent = `${st.burnedCells} ${STR.cellsBurned}`;
    }

    const homes = s.area?.homes;
    if (has && s.area && homes) {
      const now = homesReached(s.result!, homes, s.area.grid, s.playback.t);
      const without = s.baseline && s.baseline !== s.result ? homesReached(s.baseline, homes, s.area.grid, s.playback.t) : null;
      impact.replaceChildren(
        el('strong', {}, without !== null ? `${STR.homesReached} ${without} → ${now} ${STR.withYourPlan}` : `${STR.homesReached} ${now}`),
        el('span', { class: 'muted' }, ` ${STR.of} ${totalHomes(homes)} ${STR.inThisArea}`),
      );
    } else impact.replaceChildren();

    const ref = s.area?.reference;
    if (ref) {
      sideBySideBtn.disabled = compareBtn.disabled = s.simRunning;
      colorsBtn.textContent = s.compare ? STR.showFireColors : STR.showAccuracyColors;
      const parts: (HTMLElement | false)[] = [
        el('div', {}, el('strong', {}, `${STR.realFire} ${ref.name}: `), `${ref.areaHa.toFixed(0)} ha ${STR.realOutline}`),
        el('div', { class: 'row' }, sideBySideBtn, compareBtn, has && colorsBtn),
      ];
      if (has) {
        if (!realSize.has(s.result!)) realSize.set(s.result!, overlapAtRealSize(s.result!, ref));
        const fair = realSize.get(s.result!);
        const live = overlapAt(s.result!, ref, s.playback.t);
        parts.push(
          fair
            ? el('div', { class: 'match' }, el('strong', {}, `${STR.matchAtRealSize} ${Math.round(fair.iou * 100)} %`), el('span', { class: 'muted' }, ` (IoU, ${STR.reached} ${(fair.t / 3600).toFixed(1)} h; ${STR.covers} ${Math.round(fair.covered * 100)} % ${STR.ofRealBurn})`))
            : el('div', { class: 'muted' }, STR.neverRealSize),
          el('div', { class: 'muted' }, `${STR.overlapNow} ${Math.round(live.iou * 100)} %`),
          s.compare && legend,
        );
        if (s.controls) {
          const label: Record<string, string> = { real: STR.controlReal, noWind: STR.controlNoWind, reversed: STR.controlReversed };
          parts.push(
            el('div', { class: 'controls' },
              el('div', {}, el('strong', {}, STR.controlsTitle)),
              ...s.controls.map((c) => el('div', { class: c.kind === 'real' ? 'control real' : 'control' }, `${label[c.kind]}: ${pct(c.overlap)}`)),
              el('div', { class: 'muted' }, STR.controlsNote),
            ),
          );
        }
      }
      realFire.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
    } else realFire.replaceChildren();
  });
}
