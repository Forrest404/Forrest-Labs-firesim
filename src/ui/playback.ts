/** Simulate button, play/pause, speed, scrubber, simulated clock and live stats. */

import type { Store } from '../app/state';
import { homesReached, overlapAt, overlapAtRealSize, totalHomes } from '../app/impact';
import type { Overlap } from '../app/impact';
import { liveStats } from '../app/overlayPainter';
import type { SimResult } from '../contract';
import { COMPARE_RGBA } from '../viewer/burnCanvas';
import { el, formatClock } from './el';
import { STR } from './strings';

const SPEEDS = [1, 4, 16, 64, 256, 1024];

export interface PlaybackActions {
  simulate(): void;
  compareWithRealFire(): void;
  cancel(): void;
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
  const impact = el('div', { class: 'impact' });
  const realFire = el('div', { class: 'real-fire' });
  const realSize = new WeakMap<SimResult, Overlap | null>();
  const compareBtn = el('button', { class: 'primary', onclick: () => actions.compareWithRealFire() }, STR.compareButton) as HTMLButtonElement;
  const colorsBtn = el('button', { onclick: () => store.update((s) => ({ compare: !s.compare })) }) as HTMLButtonElement;
  const swatch = (kind: keyof typeof COMPARE_RGBA, label: string): HTMLElement =>
    el('span', { class: 'swatch-item' }, el('span', { class: 'swatch', style: `background: rgba(${COMPARE_RGBA[kind].slice(0, 3).join(',')}, 1)` }), label);
  const legend = el('div', { class: 'legend' }, swatch('both', STR.legendBoth), swatch('missed', STR.legendMissed), swatch('extra', STR.legendExtra));
  const pct = (o: Overlap | null): string => (o ? `${Math.round(o.iou * 100)} %` : STR.neverReal);

  container.append(
    el('h2', {}, STR.simulateTitle),
    el('div', { class: 'row' }, simulateBtn, cancelBtn),
    hint,
    error,
    el('div', { class: 'row' }, playBtn, restartBtn, ...speedBtns),
    el('label', {}, scrub, clock),
    stats,
    impact,
    realFire,
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
      stats.textContent = `${st.burnedAreaHa.toFixed(0)} ha · ${st.burnedCells} cells burned · ${STR.simTime} ${s.result!.stats.runtimeMs.toFixed(0)} ms`;
    } else stats.textContent = '';

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
      compareBtn.disabled = s.simRunning;
      colorsBtn.textContent = s.compare ? STR.showFireColors : STR.showAccuracyColors;
      const parts: (HTMLElement | false)[] = [
        el('div', {}, el('strong', {}, `${STR.realFire} ${ref.name}: `), `${ref.areaHa.toFixed(0)} ha ${STR.realOutline}`),
        el('div', { class: 'row' }, compareBtn, has && colorsBtn),
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
