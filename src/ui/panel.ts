/** Side panel layout: header + honesty notice, then each section mounts itself. */

import type { Store } from '../app/state';
import { mountAreaPicker } from './areaPicker';
import type { AreaPickerActions } from './areaPicker';
import { mountDebug } from './debug';
import { el } from './el';
import { mountPlayback } from './playback';
import type { PlaybackActions } from './playback';
import { mountSettingsSimple } from './settingsSimple';
import { STR } from './strings';

export interface PanelActions extends AreaPickerActions, PlaybackActions {
  topDown(): void;
  resetView(): void;
}

export interface PanelSlots {
  /** Section for the firefighting tools (filled in Stage 6). */
  tools: HTMLElement;
  /** Section for the advanced settings (filled in Stage 6). */
  advanced: HTMLElement;
  /** Section for "Suggest a plan" (Gemini + simulator check). */
  planner: HTMLElement;
}

export function mountPanel(root: HTMLElement, store: Store, actions: PanelActions): PanelSlots {
  // Honesty stays on screen, but as one quiet line: the demo leads with the fire, not a warning.
  const header = el('div', {},
    el('h1', {}, STR.appTitle),
    el('details', { class: 'honesty' }, el('summary', {}, STR.honestyNotice), el('small', {}, STR.honestyDetail)),
  );
  const modeLine = el('div', { class: 'muted' });
  const area = el('section');
  const settings = el('section');
  const advanced = el('section');
  const sim = el('section');
  const planner = el('section');
  const tools = el('section');
  const camera = el('section', {},
    el('h2', {}, STR.cameraTitle),
    el('div', { class: 'row' },
      el('button', { onclick: () => actions.topDown() }, STR.cameraTopDown),
      el('button', { onclick: () => actions.resetView() }, STR.cameraReset),
    ),
    el('div', { class: 'muted' }, STR.cameraHelp),
  );
  const particles = el('input', { type: 'checkbox' }) as HTMLInputElement;
  particles.onchange = () => store.update((s) => ({ effects: { ...s.effects, particles: particles.checked } }));
  const quality = el('select', {},
    el('option', { value: 'low' }, STR.qualityLow),
    el('option', { value: 'medium' }, STR.qualityMedium),
    el('option', { value: 'high' }, STR.qualityHigh),
  ) as HTMLSelectElement;
  quality.onchange = () => store.update((s) => ({ effects: { ...s.effects, quality: quality.value as 'low' | 'medium' | 'high' } }));
  const effects = el('section', {},
    el('h2', {}, STR.effectsTitle),
    el('label', {}, el('span', {}, STR.effectsParticles), particles),
    el('label', {}, el('span', {}, STR.effectsQuality), quality),
  );
  const debug = el('section');
  const footer = el('div', { class: 'muted footer' }, STR.footer);
  // Demo flow first (place, conditions, run, plan, fight); everything else folds away.
  const more = el('details', { class: 'more' }, el('summary', {}, STR.moreSettings), advanced, camera, effects, debug);
  root.append(header, modeLine, area, settings, sim, planner, tools, more, footer);

  mountAreaPicker(area, store, actions);
  mountSettingsSimple(settings, store);
  mountPlayback(sim, store, actions);
  mountDebug(debug, store);

  store.subscribe((s) => {
    modeLine.textContent = STR.viewerMode[s.viewerMode];
    particles.checked = s.effects.particles;
    quality.value = s.effects.quality;
    quality.disabled = !s.effects.particles;
  });
  return { tools, advanced, planner };
}
