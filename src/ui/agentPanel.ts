/**
 * AGENT 4 (Part 2) — Tactical Dispatch Agent UI Panel.
 * Displays nearby Fire Stations with dedicated Crew Leads & Voices, Helicopter River Dip Site,
 * Before vs. After Hectares Saved telemetry, Gemini Incident Commander Briefing,
 * Multi-Wave Dispatch Orders (with Hybrid Tactic Selection: Fire Break vs. Water Spray),
 * Live Agent Reasoning Log, and One-Click Deployment.
 */

import type { Store } from '../app/state';
import { el, formatClock } from './el';
import { STR } from './strings';

export interface AgentPanelActions {
  recommendPlan(): void;
  deployPlan(): void;
  toggleOrder(orderId: string, enabled: boolean): void;
  highlightOrder(orderId: string | null): void;
  flyToOrder(orderId: string): void;
}

export function mountAgentPanel(
  container: HTMLElement,
  store: Store,
  actions: AgentPanelActions,
): void {
  const stationList = el('ul', { class: 'agent-stations' });
  const dipSiteBox = el('div', { class: 'agent-dipsite muted' });

  const recommendBtn = el(
    'button',
    {
      class: 'primary agent-btn',
      onclick: () => actions.recommendPlan(),
    },
    STR.agentRecommendBtn,
  ) as HTMLButtonElement;

  const statusLine = el('div', { class: 'muted' });
  const resultsWrap = el('div', { class: 'agent-results' });

  // Before vs. After Telemetry Strip
  const baselineVal = el('strong', { class: 'tabular' }, '—');
  const projectedVal = el('strong', { class: 'tabular' }, '—');
  const savedVal = el('strong', { class: 'tabular agent-saved' }, '—');
  const deforestedVal = el('strong', { class: 'tabular' }, '—');

  const compareGrid = el(
    'div',
    { class: 'agent-compare-grid' },
    el('div', { class: 'agent-metric' }, el('span', { class: 'muted' }, STR.agentBaselineLabel), baselineVal),
    el('div', { class: 'agent-metric' }, el('span', { class: 'muted' }, STR.agentProjectedLabel), projectedVal),
    el('div', { class: 'agent-metric' }, el('span', { class: 'muted' }, STR.agentSavedLabel), savedVal),
    el('div', { class: 'agent-metric' }, el('span', { class: 'muted' }, STR.agentDeforestedLabel), deforestedVal),
  );

  // Commander Briefing Box
  const briefingMeta = el('div', { class: 'muted agent-briefing-meta' });
  const briefingText = el('div', { class: 'agent-briefing-text' });
  const briefingBox = el('div', { class: 'agent-briefing' }, briefingMeta, briefingText);

  // Multi-Wave Dispatch Orders List
  const ordersTitle = el('div', { class: 'muted agent-subtitle' }, STR.agentOrdersTitle);
  const ordersList = el('ul', { class: 'agent-orders' });

  // Deploy Plan Action Button
  const deployBtn = el(
    'button',
    {
      class: 'primary agent-deploy-btn',
      onclick: () => actions.deployPlan(),
    },
    STR.agentDeployBtn,
  ) as HTMLButtonElement;

  // Collapsible Live Agent Reasoning Log
  const logSummary = el('summary', {}, STR.agentReasoningLogTitle);
  const logList = el('ul', { class: 'agent-reasoning-log' });
  const logDetails = el('details', { class: 'agent-log-details' }, logSummary, logList);

  resultsWrap.append(compareGrid, briefingBox, ordersTitle, ordersList, deployBtn, logDetails);

  container.append(
    el('h2', {}, STR.agentSectionTitle),
    el('div', { class: 'muted' }, STR.agentSubtitle),
    stationList,
    dipSiteBox,
    el('div', { class: 'row' }, recommendBtn),
    statusLine,
    resultsWrap,
  );

  let lastStationsRef: unknown = null;
  let lastPlanRef: unknown = null;
  const orderDomMap = new Map<
    string,
    { li: HTMLElement; cb: HTMLInputElement; trackBtn: HTMLButtonElement }
  >();

  store.subscribe((s) => {
    // 1. Render discovered stations only when stations array reference changes
    if (s.stations !== lastStationsRef) {
      lastStationsRef = s.stations;
      stationList.replaceChildren(
        ...s.stations.map((stn) => {
          const typeLabel =
            stn.unitType === 'engine'
              ? 'Engine'
              : stn.unitType === 'helicopter'
                ? 'Helitack'
                : 'Airtanker';
          const routeNote =
            stn.routingMethod === 'osrm'
              ? 'OSRM road'
              : stn.routingMethod === 'tortuosity'
                ? 'road est.'
                : 'direct vector';
          const crewTitle = stn.crewPersona
            ? `${stn.crewPersona.crewLeadName} · ${stn.crewPersona.stationCallLabel} (${stn.name})`
            : stn.name;
          return el(
            'li',
            { class: 'agent-station-row' },
            el('span', { class: 'agent-stn-name' }, crewTitle),
            el(
              'span',
              { class: 'muted tabular' },
              `${typeLabel} (${stn.speedKmh} km/h · ${stn.waterCapacityLiters ?? 2500}L) · ${stn.routeDistanceKm} km (${routeNote}) · ETA ${formatClock(stn.travelTimeSeconds)}`,
            ),
          );
        }),
      );
    }

    // 2. Render Helicopter River/Lake Dip-Site summary
    if (s.dipSite) {
      dipSiteBox.style.display = '';
      dipSiteBox.textContent = `◆ ${s.dipSite.label} · Cell (${s.dipSite.col}, ${s.dipSite.row}) · Wave-2 2,500L refill loop ${formatClock(s.dipSite.turnaroundSeconds)}`;
    } else {
      dipSiteBox.style.display = 'none';
    }

    // 3. Button state
    recommendBtn.disabled = !s.result || s.simRunning || s.agentRunning;
    recommendBtn.textContent = s.agentRunning
      ? STR.agentComputing
      : s.agentPlan
        ? STR.agentRecomputeBtn
        : STR.agentRecommendBtn;

    if (!s.result) {
      statusLine.textContent = STR.agentNeedsSimHint;
      resultsWrap.style.display = 'none';
      return;
    }

    if (s.agentRunning) {
      statusLine.textContent = STR.agentRunningHint;
    } else if (!s.agentPlan) {
      statusLine.textContent = STR.agentReadyHint;
      resultsWrap.style.display = 'none';
      return;
    } else {
      statusLine.textContent = '';
    }

    const plan = s.agentPlan;
    if (!plan) {
      resultsWrap.style.display = 'none';
      return;
    }

    resultsWrap.style.display = '';

    // 4. Before vs. After comparison metrics
    baselineVal.textContent = `${plan.baselineBurnedHa.toFixed(1)} ha`;
    projectedVal.textContent = `${plan.projectedBurnedHa.toFixed(1)} ha`;
    savedVal.textContent = `${plan.savedHa.toFixed(1)} ha (${plan.reductionPct.toFixed(1)}%)`;
    deforestedVal.textContent = `${(plan.totalDeforestedHa ?? 0).toFixed(2)} ha`;

    // 5. Commander briefing
    briefingMeta.textContent =
      plan.briefingSource === 'gemini'
        ? `Incident Commander & Conservation Agent · Gemini Synthesis · ${plan.computedInMs} ms`
        : `Incident Commander & Conservation Agent · Counterfactual Synthesis · ${plan.computedInMs} ms`;
    briefingText.textContent = plan.commanderBriefing;

    // 6. Rebuild Multi-Wave Dispatch Orders & Reasoning Log ONLY when plan changes
    if (plan !== lastPlanRef) {
      lastPlanRef = plan;
      orderDomMap.clear();

      ordersList.replaceChildren(
        ...plan.orders.map((order) => {
          const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
          cb.checked = order.enabled;
          cb.onchange = () => actions.toggleOrder(order.id, cb.checked);

          const waveDescriptor =
            order.wave === 1
              ? 'Wave 1 · Initial'
              : order.sourceType === 'dip_site'
                ? 'Wave 2 · Dip Shuttle'
                : 'Wave 2 · Refill';

          const tacticBadge = el(
            'span',
            {
              class: `hud-tactic-pill ${
                order.tacticType === 'firebreak' ? 'tactic-badge-firebreak' : 'tactic-badge-water'
              }`,
            },
            order.tacticType === 'firebreak' ? 'FIRE BREAK' : '2,500L WATER SPRAY',
          );

          const trackBtn = el(
            'button',
            {
              class: 'small hud-track-btn',
              title: 'Fly camera and track this 3D unit live',
              onclick: (e: Event) => {
                e.stopPropagation();
                actions.flyToOrder(order.id);
              },
            },
            '🎯 Track 3D',
          ) as HTMLButtonElement;

          const headerRow = el(
            'div',
            { class: 'agent-order-header' },
            el(
              'label',
              { class: 'agent-order-check' },
              cb,
              el(
                'strong',
                {},
                `${order.crewPersona.crewLeadName} · ${order.crewPersona.stationCallLabel}`,
              ),
            ),
            el('div', { class: 'row' }, tacticBadge, trackBtn),
          );

          const ecoTag =
            order.tacticType === 'firebreak'
              ? `${order.tacticComparison.deforestedHa.toFixed(2)} ha cut`
              : '0 ha cut';

          const metaRow = el(
            'div',
            { class: 'muted tabular agent-order-meta' },
            `${waveDescriptor} (${order.crewPersona.callsign} @ ${order.unit.speedKmh} km/h) · ${order.sectorLabel} · ETA ${formatClock(order.etaSeconds)} · -${order.marginalSavedHa.toFixed(1)} ha (${ecoTag})`,
          );

          const dispatchCallout = order.radioCallouts.find((c) => c.phase === 'dispatch');
          const radioRow = dispatchCallout
            ? el('div', { class: 'agent-order-radio' }, `“${dispatchCallout.transcript}”`)
            : el('span');

          const rationaleRow = el(
            'div',
            { class: 'agent-order-rationale tabular' },
            order.tacticComparison.tacticRationale,
          );

          const li = el(
            'li',
            {
              class: 'agent-order-item',
              onmouseenter: () => actions.highlightOrder(order.id),
              onmouseleave: () => actions.highlightOrder(null),
            },
            headerRow,
            metaRow,
            radioRow,
            rationaleRow,
          );

          orderDomMap.set(order.id, { li, cb, trackBtn });
          return li;
        }),
      );

      // 7. Live Agent Reasoning Log
      logSummary.textContent = `${STR.agentReasoningLogTitle} (${plan.reasoningLog.length} tactic rollouts tested)`;
      logList.replaceChildren(
        ...plan.reasoningLog.map((step) =>
          el(
            'li',
            { class: step.selected ? 'agent-log-selected tabular' : 'muted tabular' },
            step.summary,
          ),
        ),
      );
    }

    // Update order item highlight/track state in-place without replacing DOM elements
    for (const order of plan.orders) {
      const dom = orderDomMap.get(order.id);
      if (!dom) continue;
      dom.cb.checked = order.enabled;
      const isTracked = s.trackedOrderId === order.id;
      const isHighlighted = s.highlightedOrderId === order.id || isTracked;
      dom.li.classList.toggle('highlighted', isHighlighted);
      dom.li.classList.toggle('tracked', isTracked);
      dom.trackBtn.textContent = isTracked ? '🎯 Tracking 3D' : '🎯 Track 3D';
      dom.trackBtn.classList.toggle('active', isTracked);
    }

    const enabledCount = plan.orders.filter((o) => o.enabled).length;
    deployBtn.disabled = enabledCount === 0 || s.simRunning;
    deployBtn.textContent = `${STR.agentDeployBtn} (${enabledCount} ${enabledCount === 1 ? 'order' : 'orders'})`;
  });
}
