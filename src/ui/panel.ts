/**
 * Side panel: brand header (title, viewer-mode pill, collapse), compact honesty pill, then one
 * card per section. Sections mount themselves into the bodies handed to them.
 */

import type { Store } from '../app/state';
import { mountAreaPicker } from './areaPicker';
import { mountContain } from './contain';
import type { AreaPickerActions } from './areaPicker';
import type { LiveActions } from '../app/liveController';
import { iconButton, section, segmented, tabBar, toggle } from './controls';
import { mountDebug } from './debug';
import { mountLive } from './live';
import { mountLiveFires } from './liveFires';
import type { LiveFiresActions } from './liveFires';
import { el } from './el';
import { icon } from './icons';
import { mountPlayback } from './playback';
import type { PlaybackActions } from './playback';
import { mountSettingsSimple } from './settingsSimple';
import { STR } from './strings';

export interface PanelActions extends AreaPickerActions, PlaybackActions, LiveActions, LiveFiresActions {
  topDown(): void;
  resetView(): void;
  groundView(): void;
}

export interface PanelSlots {
  /** Section body for the firefighting tools. */
  tools: HTMLElement;
  /** Section body for the advanced settings. */
  advanced: HTMLElement;
  /** Section body for "Suggest a plan" (Gemini + simulator check). */
  planner: HTMLElement;
}

export function mountPanel(root: HTMLElement, store: Store, actions: PanelActions): PanelSlots {
  // Header
  const modePill = el('span', { class: 'pill mode', title: STR.googleAttribution }, el('i', { class: 'dot' }), el('span', { class: 'pill-text' }));
  const collapseBtn = iconButton('chevronLeft', STR.collapsePanel, () => {
    const collapsed = root.classList.toggle('collapsed');
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseBtn.title = collapsed ? STR.expandPanel : STR.collapsePanel;
  }, { class: 'collapse' });
  collapseBtn.setAttribute('aria-expanded', 'true');
  const header = el('header', { class: 'brand' },
    el('div', { class: 'brand-left' }, el('span', { class: 'logo' }, icon('flame', 18)), el('h1', {}, STR.appTitle)),
    el('div', { class: 'brand-right' }, modePill, collapseBtn),
  );
  const honesty = el('div', { class: 'honesty', title: STR.honestyDetail, tabindex: '0' }, icon('info', 14), el('span', {}, STR.honestyNotice));

  // Sections
  const area = section('map', STR.areaLabel);
  const settings = section('wind', STR.settingsTitle);
  const sim = section('flame', STR.simulateTitle, { class: 'sim' });
  const respond = section('target', STR.containTitle, { class: 'respond' });
  const planner = section('sparkles', STR.planTitle);
  const predict = section('globe', STR.predictTitle, { class: 'live' });
  const tools = section('axe', STR.toolsTitle);
  const advChevron = el('span', { class: 'chev' }, icon('chevron', 16));
  const advanced = section('sliders', STR.advancedTitle, { class: 'adv', trailing: advChevron });
  // settingsAdvanced.ts renders a <details>; its summary is hidden and the card header drives it.
  advanced.header.setAttribute('role', 'button');
  advanced.header.setAttribute('tabindex', '0');
  advanced.header.setAttribute('aria-expanded', 'false');
  const toggleAdvanced = () => {
    const d = advanced.body.querySelector('details');
    if (d) d.open = !d.open;
  };
  advanced.header.addEventListener('click', toggleAdvanced);
  advanced.header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAdvanced(); } });

  const groundBtn = iconButton('camera', STR.cameraGround, () => actions.groundView());
  const view = section('eye', STR.viewTitle, {
    trailing: el('div', { class: 'row tight' },
      groundBtn,
      iconButton('topdown', STR.cameraTopDown, () => actions.topDown()),
      iconButton('compass', STR.cameraReset, () => actions.resetView()),
    ),
  });
  const fx = (key: 'flames' | 'embers' | 'smokeParticles' | 'smoke' | 'glow' | 'smooth', label: string, title?: string) =>
    toggle(label, (on) => store.update((s) => ({ effects: { ...s.effects, [key]: on } })), { title });
  const flames = fx('flames', STR.effectsFlames);
  const embers = fx('embers', STR.effectsEmbers);
  const puffs = fx('smokeParticles', STR.effectsSmokeParticles);
  const glow = fx('glow', STR.effectsGlow);
  const smooth = fx('smooth', STR.effectsSmooth);
  const quality = segmented(
    [{ value: 'low', label: STR.qualityLow }, { value: 'medium', label: STR.qualityMedium }, { value: 'high', label: STR.qualityHigh }],
    (q) => store.update((s) => ({ effects: { ...s.effects, quality: q as 'low' | 'medium' | 'high' } })),
    { ariaLabel: STR.effectsQuality, class: 'small' },
  );
  const smoke = fx('smoke', STR.effectsSmoke, STR.smokeHint);
  view.body.append(
    el('div', { class: 'sub-title' }, STR.effectsGroup),
    flames.root, embers.root, puffs.root, smoke.root, glow.root, smooth.root,
    el('div', { class: 'ctl-row' }, el('span', { class: 'ctl-label' }, STR.effectsQuality), quality.root),
  );
  const debugBody = el('div', { class: 'sub' });
  view.body.append(debugBody, el('div', { class: 'muted hint' }, STR.cameraHelp));

  const footer = el('footer', { class: 'muted footer' }, STR.footer);
  // Tabs: the simulator (everything above) or the live satellite detections.
  const tabs = tabBar(
    [{ value: 'sim', label: STR.tabSim, icon: 'flame' }, { value: 'live', label: STR.tabLive, icon: 'globe' }],
    (v) => actions.setView(v),
    { ariaLabel: STR.tabsLabel },
  );
  const simPane = el('div', { class: 'pane', role: 'tabpanel' }, area.root, settings.root, sim.root, respond.root, planner.root, tools.root, advanced.root, view.root);
  const livePane = el('div', { class: 'pane', role: 'tabpanel' });
  livePane.hidden = true;
  tabs.set('sim');
  root.append(header, honesty, tabs.root, simPane, livePane, footer);

  mountAreaPicker(area.body, store, actions);
  mountSettingsSimple(settings.body, store);
  mountPlayback(sim.body, store, actions);
  mountContain(respond.body, store);
  mountDebug(debugBody, store);
  mountLive(livePane, store, actions);
  livePane.append(predict.root);
  mountLiveFires(predict.body, store, actions);

  store.subscribe((s, prev) => {
    if (s.view !== prev.view) {
      tabs.set(s.view);
      simPane.hidden = s.view !== 'sim';
      livePane.hidden = s.view !== 'live';
      footer.textContent = s.view === 'live' ? STR.liveFooter : STR.footer;
    }
    groundBtn.classList.toggle('active', s.groundFollow);
    groundBtn.setAttribute('aria-pressed', s.groundFollow ? 'true' : 'false');
    advanced.root.classList.toggle('open', s.advancedOpen);
    advanced.header.setAttribute('aria-expanded', s.advancedOpen ? 'true' : 'false');
    modePill.classList.toggle('live', s.viewerMode === 'google');
    (modePill.querySelector('.pill-text') as HTMLElement).textContent = STR.viewerMode[s.viewerMode];
    flames.input.checked = s.effects.flames;
    embers.input.checked = s.effects.embers;
    puffs.input.checked = s.effects.smokeParticles;
    smoke.input.checked = s.effects.smoke;
    glow.input.checked = s.effects.glow;
    smooth.input.checked = s.effects.smooth;
    quality.set(s.effects.quality);
    quality.setDisabled(!(s.effects.flames || s.effects.embers || s.effects.smokeParticles));
  });
  return { tools: tools.body, advanced: advanced.body, planner: planner.body };
}
