/**
 * Side panel: brand header (title, viewer-mode pill, collapse), then one
 * card per section. Sections mount themselves into the bodies handed to them.
 */

import type { Store } from '../app/state';
import { mountAreaPicker } from './areaPicker';
import type { AreaPickerActions } from './areaPicker';
import type { LiveActions } from '../app/liveController';
import { iconButton, section, segmented, tabBar, toggle } from './controls';
import { mountDebug } from './debug';
import { mountDemoCard } from './demoCard';
import type { DemoActions } from './demoCard';
import { mountEnsemble } from './ensemble';
import type { EnsembleActions } from './ensemble';
import { mountExport } from './export';
import type { ExportActions } from './export';
import { mountLive } from './live';
import { mountLiveFires } from './liveFires';
import type { LiveFiresActions } from './liveFires';
import { el } from './el';
import { icon } from './icons';
import { mountPlayback } from './playback';
import type { PlaybackActions } from './playback';
import { mountSettingsSimple } from './settingsSimple';
import { STR } from './strings';

export interface PanelActions extends AreaPickerActions, PlaybackActions, LiveActions, LiveFiresActions, EnsembleActions, ExportActions {
  demo: DemoActions;
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
  const collapseBtn = iconButton('chevronLeft', STR.collapsePanel, () => setSheet(root.classList.contains('collapsed') ? 'mid' : 'peek'), { class: 'collapse' });
  collapseBtn.setAttribute('aria-expanded', 'true');

  // Phone layout: the panel is a bottom sheet with three heights. Tap the handle to step through
  // them, or drag it up/down. (On wide screens the handle is hidden and only Hide/Show applies.)
  type Sheet = 'peek' | 'mid' | 'tall';
  const ORDER: Sheet[] = ['peek', 'mid', 'tall'];
  let sheet: Sheet = 'mid';
  function setSheet(next: Sheet): void {
    sheet = next;
    root.classList.toggle('collapsed', next === 'peek');
    root.classList.toggle('tall', next === 'tall');
    collapseBtn.setAttribute('aria-expanded', next === 'peek' ? 'false' : 'true');
    collapseBtn.title = next === 'peek' ? STR.expandPanel : STR.collapsePanel;
    handle.setAttribute('aria-valuenow', String(ORDER.indexOf(next)));
  }
  const handle = el('button', { type: 'button', class: 'sheet-handle', 'aria-label': STR.resizePanel, role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '2', 'aria-valuenow': '1' }, el('i', {}));
  let dragY: number | null = null;
  handle.addEventListener('pointerdown', (e) => { dragY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointerup', (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    dragY = null;
    const i = ORDER.indexOf(sheet);
    if (Math.abs(dy) > 24) setSheet(ORDER[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
    else setSheet(ORDER[(i + 1) % 3]);
  });
  handle.addEventListener('pointercancel', () => { dragY = null; });
  handle.addEventListener('keydown', (e) => {
    const i = ORDER.indexOf(sheet);
    if (e.key === 'ArrowUp') { setSheet(ORDER[Math.min(2, i + 1)]); e.preventDefault(); }
    if (e.key === 'ArrowDown') { setSheet(ORDER[Math.max(0, i - 1)]); e.preventDefault(); }
  });
  const header = el('header', { class: 'brand' },
    el('div', { class: 'brand-left' }, el('h1', {}, STR.appTitle)),
    el('div', { class: 'brand-right' }, modePill, collapseBtn),
  );
  // Only the Live tab carries a data note (satellite age); the simulator view has none by request.
  const honesty = el('div', { class: 'honesty', title: STR.liveHonesty, tabindex: '0' }, icon('info', 14), el('span', {}, STR.honestyNoticeLive));
  honesty.hidden = true;

  // Sections
  const demo = section('sparkles', STR.demoTitle, { class: 'demo' });
  const area = section('map', STR.areaLabel);
  const settings = section('wind', STR.settingsTitle);
  const sim = section('flame', STR.simulateTitle, { class: 'sim' });
  const ensemble = section('layers', STR.ensembleTitle);
  const exportSec = section('target', STR.exportTitle);
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
  const simPane = el('div', { class: 'pane', role: 'tabpanel' }, demo.root, area.root, settings.root, sim.root, ensemble.root, planner.root, tools.root, advanced.root, view.root, exportSec.root);
  const livePane = el('div', { class: 'pane', role: 'tabpanel' });
  livePane.hidden = true;
  tabs.set('sim');
  root.append(handle, header, honesty, tabs.root, simPane, livePane, footer);

  mountDemoCard(demo.body, store, actions.demo);
  mountAreaPicker(area.body, store, actions);
  mountSettingsSimple(settings.body, store);
  mountPlayback(sim.body, store, actions);
  mountEnsemble(ensemble.body, store, actions);
  mountExport(exportSec.body, store, actions);
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
      honesty.hidden = s.view !== 'live';
      modePill.hidden = s.view === 'live';
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
