/**
 * Emergency response card: switch the response on, pick how hard it responds, compare the run
 * with and without it, and read the orders. Simulate (in the playback card) runs the plan.
 */

import type { Store } from '../app/state';
import { staleIfResult } from '../app/state';
import { RESPONSE_LEVELS } from '../contain';
import type { ResponseLevel } from '../contain';
import { UNIT_COLOR } from '../viewer/dispatchOverlay';
import { chip, segmented, toggle } from './controls';
import { el, formatClock } from './el';
import { STR } from './strings';

export function mountContain(container: HTMLElement, store: Store, actions: { simulate(): void }): void {
  const enable = toggle(STR.containEnable, (on) =>
    store.update((s) => {
      const plan = s.contain.plan;
      if (on) return { contain: { ...s.contain, enabled: true }, ...staleIfResult(s) };
      // Off: keep showing the fire, but as the run without a response.
      return { contain: { ...s.contain, enabled: false, plan: null, show: 'contained' }, result: plan ? plan.baseline : s.result };
    }), { title: STR.containEnableHelp });
  const level = segmented(
    RESPONSE_LEVELS.map((v) => ({ value: v, label: STR.levelNames[v] })),
    (v: ResponseLevel) => store.update((s) => ({ contain: { ...s.contain, level: v, overrides: null }, ...staleIfResult(s) })),
    { ariaLabel: STR.containLevel, class: 'small grow' },
  );
  const levelHint = el('div', { class: 'muted hint' });
  const progress = el('div', { class: 'progress' }, el('i', {}));
  const progressText = el('div', { class: 'muted hint' });
  const show = segmented(
    [{ value: 'contained', label: STR.showWith }, { value: 'baseline', label: STR.showWithout }],
    (v: 'contained' | 'baseline') =>
      store.update((s) => {
        const plan = s.contain.plan;
        if (!plan || s.contain.show === v) return {};
        return { result: v === 'contained' ? plan.contained : plan.baseline, contain: { ...s.contain, show: v } };
      }),
    { ariaLabel: STR.showRun, class: 'small grow' },
  );
  const outline = toggle(STR.containOutline, (on) => store.update((s) => ({ contain: { ...s.contain, outline: on } })));
  const units = toggle(STR.containUnits, (on) => store.update((s) => ({ contain: { ...s.contain, units3d: on } })));
  const hud = toggle(STR.containHud, (on) => store.update((s) => ({ contain: { ...s.contain, hud: on } })));
  const without = chip('', 'stat without');
  const withResp = chip('', 'stat');
  const saved = chip('', 'stat saved');
  const stats = el('div', { class: 'stats compare' }, without, withResp, saved);
  const homes = el('div', { class: 'hint' });
  const resources = el('div', { class: 'muted hint' });
  const list = el('ul', { class: 'interventions orders' });
  const planBox = el('div', { class: 'sub plan' }, show.root, outline.root, units.root, hud.root, stats, homes, resources, list);
  const status = el('div', { class: 'muted hint' });
  const dispatchBtn = el('button', { type: 'button', class: 'primary', onclick: () => {
    store.update((s) => ({ contain: { ...s.contain, enabled: true } }));
    actions.simulate();
  } }, STR.dispatchNow) as HTMLButtonElement;

  container.append(enable.root, level.root, levelHint, dispatchBtn, progress, progressText, status, planBox);

  let lastPlan: unknown = null;
  let lastLevelKey = '';
  store.subscribe((s) => {
    const c = s.contain;
    enable.input.checked = c.enabled;
    dispatchBtn.disabled = !s.area || !s.ignition || s.simRunning;
    dispatchBtn.textContent = c.planning ? STR.containPlanning : c.plan && !s.resultStale ? STR.dispatchAgain : STR.dispatchNow;
    level.set(c.level);
    level.setDisabled(!c.enabled);
    const key = `${c.level}:${c.overrides ? 'custom' : ''}`;
    if (key !== lastLevelKey) {
      lastLevelKey = key;
      levelHint.textContent = c.enabled ? (c.overrides ? STR.levelCustom : STR.levelHints[c.level]) : STR.containEnableHelp;
    }
    if (!c.enabled && levelHint.textContent !== STR.containEnableHelp) levelHint.textContent = STR.containEnableHelp;
    if (c.enabled && !c.overrides && levelHint.textContent !== STR.levelHints[c.level]) levelHint.textContent = STR.levelHints[c.level];
    progress.hidden = !c.planning;
    progressText.hidden = !c.planning;
    if (c.planning) {
      (progress.firstElementChild as HTMLElement).style.setProperty('--p', `${Math.round(c.progress * 100)}%`);
      progressText.textContent = `${STR.containPlanning} ${Math.round(c.progress * 100)}%`;
    }
    const plan = c.plan;
    planBox.hidden = !plan || !c.enabled;
    status.textContent = !c.enabled ? '' : plan ? (s.resultStale ? STR.containStale : plan.orders.length === 0 ? STR.containNoOrders : '') : c.planning ? '' : STR.containNoPlan;
    status.classList.toggle('warn', !!plan && s.resultStale);
    if (!plan) {
      lastPlan = null;
      return;
    }
    show.set(c.show);
    outline.input.checked = c.outline;
    units.input.checked = c.units3d;
    hud.input.checked = c.hud;
    if (plan === lastPlan) return;
    lastPlan = plan;
    const m = plan.metrics;
    without.textContent = `${STR.statWithout} ${m.baselineBurnedHa.toFixed(0)} ha`;
    withResp.textContent = `${STR.statWith} ${m.containedBurnedHa.toFixed(0)} ha`;
    saved.textContent = `${STR.statSaved} ${m.savedHa.toFixed(0)} ha · ${m.reductionPct.toFixed(0)}%`;
    homes.hidden = m.homesTotal === null;
    if (m.homesTotal !== null) homes.textContent = `${STR.statHomes}: ${m.homesBaseline} → ${m.homesContained} ${STR.statHomesOf} ${m.homesTotal}`;
    const parts: string[] = [];
    if (m.lineKm > 0) parts.push(`${m.lineKm.toFixed(1)} km ${STR.statLine}`);
    if (m.clearedHa > 0) parts.push(`${m.clearedHa.toFixed(1)} ha ${STR.statCleared}`);
    if (m.waterL > 0) parts.push(`${Math.round(m.waterL).toLocaleString()} L ${STR.statWater}`);
    resources.textContent = parts.join(' · ');
    list.replaceChildren(
      ...plan.orders.map((o) =>
        el('li', {},
          el('i', { class: 'dot', style: `background:${UNIT_COLOR[o.unitType]}` }),
          el('span', { class: 'iv-text' }, `${o.unitName} · ${STR.tacticNames[o.tactic]} ${o.sector} · ${STR.orderEta} ${formatClock(o.etaSeconds)}`),
          chip(`${o.savedHa >= 0.05 ? '−' : ''}${o.savedHa.toFixed(1)} ha`, 'value small'),
        ),
      ),
    );
  });
}
