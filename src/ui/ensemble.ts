/** Ensemble ("uncertainty") controls: runs, uncertainty level, run/cancel, probability toggle, legend, summary. */

import { ENSEMBLE_RUN_OPTIONS, UNCERTAINTY_ORDER, UNCERTAINTY_PRESETS } from '../contract';
import type { UncertaintyLevel } from '../contract';
import type { Store } from '../app/state';
import { PROBABILITY_GRADIENT } from '../viewer/burnCanvas';
import { el } from './el';
import { STR } from './strings';

export interface EnsembleActions {
  runEnsemble(): void;
  cancelEnsemble(): void;
}

export function mountEnsemble(container: HTMLElement, store: Store, actions: EnsembleActions): void {
  const runs = el('select', { 'aria-label': STR.ensembleRuns }) as HTMLSelectElement;
  for (const n of ENSEMBLE_RUN_OPTIONS) runs.append(el('option', { value: n }, String(n)));
  const level = el('select', { 'aria-label': STR.ensembleUncertainty }) as HTMLSelectElement;
  for (const id of UNCERTAINTY_ORDER) level.append(el('option', { value: id }, UNCERTAINTY_PRESETS[id].label));
  const jitter = el('select', { 'aria-label': STR.ensembleJitter }) as HTMLSelectElement;
  for (const [v, label] of Object.entries(STR.ensembleJitterOptions)) jitter.append(el('option', { value: v }, label));

  runs.onchange = () => store.update((s) => ({ ensemble: { ...s.ensemble, runs: Number(runs.value) } }));
  level.onchange = () => store.update((s) => ({ ensemble: { ...s.ensemble, uncertainty: level.value as UncertaintyLevel } }));
  jitter.onchange = () => store.update((s) => ({ ensemble: { ...s.ensemble, ignitionJitterCells: Number(jitter.value) } }));

  const runBtn = el('button', { class: 'primary', onclick: () => actions.runEnsemble() }) as HTMLButtonElement;
  const cancelBtn = el('button', { onclick: () => actions.cancelEnsemble() }, STR.ensembleCancel) as HTMLButtonElement;
  const progress = el('progress', { max: 1, value: 0 }) as HTMLProgressElement;
  const show = el('input', { type: 'checkbox' }) as HTMLInputElement;
  show.onchange = () => store.set({ showProbability: show.checked });
  const legend = el('div', { class: 'prob-legend' },
    el('div', { class: 'bar', style: `background:${PROBABILITY_GRADIENT}` }),
    el('div', { class: 'ticks' }, el('span', {}, '0 %'), el('span', {}, '50 %'), el('span', {}, '100 %')),
    el('div', { class: 'muted' }, STR.probabilityLegend),
  );
  const note = el('div', { class: 'muted' });
  const summary = el('div', { class: 'stats' });
  const error = el('div', { class: 'error-text', role: 'alert' });

  container.append(
    el('h2', {}, STR.ensembleTitle),
    el('div', { class: 'muted' }, STR.ensembleIntro),
    el('label', {}, el('span', {}, STR.ensembleRuns), runs),
    el('label', {}, el('span', {}, STR.ensembleUncertainty), level),
    el('label', {}, el('span', {}, STR.ensembleJitter), jitter),
    el('div', { class: 'row' }, runBtn, cancelBtn),
    progress, error, note,
    el('label', {}, el('span', {}, STR.showProbability), show),
    legend, summary,
  );

  store.subscribe((s) => {
    const e = s.ensemble;
    if (document.activeElement !== runs) runs.value = String(e.runs);
    if (document.activeElement !== level) level.value = e.uncertainty;
    if (document.activeElement !== jitter) jitter.value = String(e.ignitionJitterCells);
    runBtn.disabled = !s.area || !s.ignition || e.running;
    runBtn.textContent = e.running ? STR.ensembleRunning : e.result ? STR.ensembleRerun : STR.ensembleRun;
    runBtn.classList.toggle('stale', !!e.result && e.stale);
    cancelBtn.style.display = e.running ? '' : 'none';
    progress.style.display = e.running ? '' : 'none';
    progress.value = e.progress;
    error.textContent = e.error ?? '';
    note.textContent = e.result && e.stale ? STR.ensembleStale : '';
    show.disabled = !e.result;
    show.checked = s.showProbability && !!e.result;
    legend.style.display = s.showProbability && e.result ? '' : 'none';
    if (e.result) {
      const a = e.result.area;
      summary.textContent = `${STR.ensembleSummary}: ${a.meanHa.toFixed(0)} ha on average (middle 80 %: ${a.p10Ha.toFixed(0)}–${a.p90Ha.toFixed(0)} ha, range ${a.minHa.toFixed(0)}–${a.maxHa.toFixed(0)}) · ${e.result.runs} runs, ${STR.ensembleTime} ${(e.result.runtimeMs / 1000).toFixed(1)} s`
        + (e.result.meanSpotFires > 0 ? ` · ${e.result.meanSpotFires.toFixed(0)} ${STR.ensembleSpots}` : '');
    } else summary.textContent = '';
  });
}
