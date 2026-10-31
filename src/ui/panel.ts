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
}

export function mountPanel(root: HTMLElement, store: Store, actions: PanelActions): PanelSlots {
  const header = el('div', {},
    el('h1', {}, STR.appTitle),
    el('div', { class: 'notice' }, STR.honestyNotice, el('small', {}, STR.honestyDetail)),
  );
  const modeLine = el('div', { class: 'muted' });
  const area = el('section');
  const settings = el('section');
  const advanced = el('section');
  const sim = el('section');
  const tools = el('section');
  const camera = el('section', {},
    el('h2', {}, STR.cameraTitle),
    el('div', { class: 'row' },
      el('button', { onclick: () => actions.topDown() }, STR.cameraTopDown),
      el('button', { onclick: () => actions.resetView() }, STR.cameraReset),
    ),
    el('div', { class: 'muted' }, STR.cameraHelp),
  );
  const debug = el('section');
  const footer = el('div', { class: 'muted footer' }, STR.footer);
  root.append(header, modeLine, area, settings, advanced, sim, tools, camera, debug, footer);

  mountAreaPicker(area, store, actions);
  mountSettingsSimple(settings, store);
  mountPlayback(sim, store, actions);
  mountDebug(debug, store);

  store.subscribe((s) => {
    modeLine.textContent = STR.viewerMode[s.viewerMode];
  });
  return { tools, advanced };
}
