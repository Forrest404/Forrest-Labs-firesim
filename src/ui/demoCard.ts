/** Demo card: scenario picker, Load / Reset, "Show contained version", and a tips popover. */

import { DEMO_IDS, DEMO_INTERVENTION_PREFIX, DEMO_SCENARIOS } from '../data/demo-scenarios';
import type { DemoId } from '../data/demo-scenarios';
import type { Store } from '../app/state';
import { iconButton } from './controls';
import { el, formatClock } from './el';
import { icon } from './icons';
import { STR } from './strings';

export interface DemoActions {
  load(id: DemoId): void;
  reset(): void;
  showContained(): void;
}

export function mountDemoCard(container: HTMLElement, store: Store, actions: DemoActions): void {
  let chosen: DemoId = 'surrey';
  const select = el('select', { id: 'demo-select', 'aria-label': STR.demoScenarioLabel }) as HTMLSelectElement;
  for (const id of DEMO_IDS) select.append(el('option', { value: id }, STR.demoNames[id]));
  select.onchange = () => { chosen = select.value as DemoId; renderTips(); };

  const loadBtn = el('button', { type: 'button', class: 'strong big', onclick: () => actions.load(chosen) }, STR.demoLoad) as HTMLButtonElement;
  const resetBtn = el('button', { type: 'button', class: 'reset', onclick: () => actions.reset() }, icon('restart', 16), el('span', {}, STR.demoReset)) as HTMLButtonElement;
  const containedLabel = el('span', {}, STR.demoContained);
  const containedBtn = el('button', { type: 'button', title: STR.demoContainedHint, onclick: () => actions.showContained() }, containedLabel) as HTMLButtonElement;
  const tips = el('div', { class: 'demo-tips', hidden: true });
  const tipsBtn = iconButton('info', STR.demoTips, () => {
    tips.hidden = !tips.hidden;
    tipsBtn.setAttribute('aria-expanded', tips.hidden ? 'false' : 'true');
  });
  tipsBtn.setAttribute('aria-expanded', 'false');
  const status = el('div', { class: 'hint muted' });

  function renderTips(): void {
    const sc = DEMO_SCENARIOS[(store.get().demoId ?? chosen)];
    tips.replaceChildren(
      el('div', { class: 'tips-h' }, STR.demoTipsHeading),
      ...STR.demoBeats(formatClock(sc.pauseAtSeconds)).map(([t, text]) => el('div', { class: 'tip' }, el('b', {}, t), el('span', {}, text))),
      el('div', { class: 'tips-h' }, STR.demoShortcutsHeading),
      ...STR.demoShortcuts.map(([k, text]) => el('div', { class: 'tip' }, el('kbd', {}, k), el('span', {}, text))),
    );
  }

  container.append(
    el('div', { class: 'select-wrap' }, select, icon('chevron', 16)),
    el('div', { class: 'sim-row' }, loadBtn, tipsBtn),
    el('div', { class: 'row' }, resetBtn, containedBtn),
    status,
    tips,
  );
  renderTips();

  let lastDemo: DemoId | null | undefined;
  store.subscribe((s) => {
    const loaded = !!s.demoId && !!s.area;
    const shown = s.interventions.some((iv) => iv.id.startsWith(DEMO_INTERVENTION_PREFIX));
    loadBtn.disabled = s.areaLoading || s.areas.length === 0;
    resetBtn.disabled = s.areaLoading || !loaded;
    containedBtn.disabled = !loaded || shown;
    containedLabel.textContent = shown ? STR.demoContainedShown : STR.demoContained;
    status.textContent = loaded && s.demoId ? STR.demoReady(STR.demoNames[s.demoId]) : '';
    if (s.demoId !== lastDemo) {
      lastDemo = s.demoId;
      if (s.demoId) select.value = chosen = s.demoId;
      renderTips();
    }
  });
}
