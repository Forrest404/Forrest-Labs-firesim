/**
 * AGENT 4 (Part 3) — Time-Synchronized Floating HUD Dispatch Toast Stack & Live Wildfire Radio Net.
 * Triggers pop-up cards in real time as `playback.t` crosses each unit's dispatch, dip-refill,
 * and on-scene tactic execution timestamps, speaking with each station crew's dedicated voice.
 */

import { computeOrderKinematicsAtTime } from '../agent/optimizer';
import type { AgentDispatchOrder, RadioCalloutEvent, UnitType } from '../agent/types';
import type { Store } from '../app/state';
import { el, formatClock } from './el';
import { createRadioVoiceSynthesizer } from './voiceSynthesizer';

export interface DispatchHudActions {
  flyToActiveUnit(orderId: string): void;
  stopTracking(): void;
  highlightOrder(orderId: string | null): void;
}

interface CardDomRefs {
  card: HTMLElement;
  equalizer: HTMLElement;
  progressFill: HTMLElement;
  statusText: HTMLElement;
  trackBtn: HTMLButtonElement;
  orderId: string;
  phase: RadioCalloutEvent['phase'];
}

function createUnitSvgIcon(unitType: UnitType): HTMLElement {
  const wrap = el('span', { class: `hud-unit-icon unit-${unitType}` });
  if (unitType === 'helicopter') {
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M12 6v5m-5 4h10a3 3 0 0 0 0-6H7a3 3 0 0 0 0 6Zm-4 0h3m8 3v2m-6-2v2m-2 0h10"/></svg>`;
  } else if (unitType === 'airtanker') {
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L14 9l8 3v2l-8-1-1 6 3 2v1l-4-1-4 1v-1l3-2-1-6-8 1v-2l8-3 2-7z"/></svg>`;
  } else {
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="13" height="9" rx="1"/><path d="M15 10h4l3 3v3h-7v-6z"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/></svg>`;
  }
  return wrap;
}

export function mountDispatchPopupHud(
  root: HTMLElement,
  store: Store,
  actions: DispatchHudActions,
): void {
  const voiceSynth = createRadioVoiceSynthesizer();
  const spokenEventIds = new Set<string>();
  const cardDomMap = new Map<string, CardDomRefs>();
  let lastVisibleIdsKey = '';
  let lastPlanRef: unknown = null;
  let lastTimeS = 0;

  const hudContainer = el('aside', { class: 'dispatch-hud-container', style: 'display: none;' });

  const stopTrackBtn = el(
    'button',
    {
      class: 'small hud-stop-track-btn',
      style: 'display: none;',
      title: 'Release 3D camera lock on active unit',
      onclick: (e: Event) => {
        e.stopPropagation();
        actions.stopTracking();
      },
    },
    '🎯 Release 3D Lock',
  ) as HTMLButtonElement;

  const voiceToggleBtn = el(
    'button',
    {
      class: 'small hud-voice-btn active',
      title: 'Toggle dedicated station radio voices',
      onclick: () => {
        const next = !voiceSynth.isEnabled();
        voiceSynth.setEnabled(next);
        voiceToggleBtn.textContent = next ? '🔊 Voice Net ON' : '🔇 Voice Muted';
        voiceToggleBtn.classList.toggle('active', next);
      },
    },
    '🔊 Voice Net ON',
  ) as HTMLButtonElement;

  const headerClock = el('span', { class: 'tabular hud-clock-pill' }, 'T+00:00');
  const hudHeader = el(
    'div',
    { class: 'dispatch-hud-header' },
    el(
      'div',
      { class: 'hud-title-group' },
      el('span', { class: 'hud-live-dot' }),
      el('strong', {}, 'WILDFIRE TACTICAL RADIO NET'),
    ),
    el('div', { class: 'hud-header-controls' }, stopTrackBtn, headerClock, voiceToggleBtn),
  );

  const toastStack = el('div', { class: 'dispatch-toast-stack' });
  hudContainer.append(hudHeader, toastStack);
  root.append(hudContainer);

  function getOrCreateCardDom(event: RadioCalloutEvent, order: AgentDispatchOrder): CardDomRefs {
    const existing = cardDomMap.get(event.id);
    if (existing) return existing;

    const phaseLabel =
      event.phase === 'dispatch'
        ? `DISPATCH · WAVE ${event.wave}`
        : event.phase === 'dip_refill'
          ? 'RIVER DIP SHUTTLE'
          : event.tacticType === 'firebreak'
            ? 'ON SCENE · CUTTING FIRE BREAK'
            : 'ON SCENE · SPRAYING WATER';

    const tacticBadgeClass =
      event.tacticType === 'firebreak' ? 'tactic-badge-firebreak' : 'tactic-badge-water';
    const tacticBadgeText = event.tacticType === 'firebreak' ? 'FIRE BREAK' : 'WATER SPRAY';

    const equalizer = el(
      'span',
      { class: 'hud-equalizer' },
      el('i'),
      el('i'),
      el('i'),
      el('i'),
    );

    const speakBtn = el(
      'button',
      {
        class: 'small hud-speak-btn',
        title: `Hear ${event.crewLeadName} (${event.stationCallLabel})`,
        onclick: (e: Event) => {
          e.stopPropagation();
          voiceSynth.setEnabled(true);
          voiceToggleBtn.textContent = '🔊 Voice Net ON';
          voiceToggleBtn.classList.add('active');
          voiceSynth.speakCallout(event);
        },
      },
      '🔊',
    );

    const trackBtn = el(
      'button',
      {
        class: 'small hud-track-btn',
        title: 'Fly camera and track this 3D unit live',
        onclick: (e: Event) => {
          e.stopPropagation();
          actions.flyToActiveUnit(order.id);
        },
      },
      '🎯 Track 3D',
    ) as HTMLButtonElement;

    const topRow = el(
      'div',
      { class: 'hud-toast-top' },
      el(
        'div',
        { class: 'hud-crew-id' },
        createUnitSvgIcon(event.unitType),
        el(
          'div',
          { class: 'hud-crew-titles' },
          el('strong', {}, `${event.crewLeadName} · ${event.stationCallLabel}`),
          el(
            'span',
            { class: 'muted tabular' },
            `${event.callsign} · T+${formatClock(event.triggerTimeSeconds)}`,
          ),
        ),
      ),
      el(
        'div',
        { class: 'hud-badges' },
        equalizer,
        el('span', { class: `hud-tactic-pill ${tacticBadgeClass}` }, tacticBadgeText),
        speakBtn,
      ),
    );

    const transcriptBox = el('div', { class: 'hud-transcript' }, `“${event.transcript}”`);

    const tacticExplain = el(
      'div',
      { class: 'hud-tactic-meta tabular' },
      `${phaseLabel} · ${order.tacticComparison.tacticRationale}`,
    );

    const progressFill = el('div', {
      class: `hud-progress-fill ${
        event.tacticType === 'firebreak' ? 'fill-firebreak' : 'fill-water'
      }`,
      style: 'width: 0%;',
    });

    const statusText = el('span', { class: 'hud-status-text tabular' }, 'STANDBY');

    const progressRow = el(
      'div',
      { class: 'hud-progress-wrap' },
      el('div', { class: 'hud-progress-bar' }, progressFill),
      statusText,
      trackBtn,
    );

    const card = el(
      'div',
      {
        class: `dispatch-toast-card phase-${event.phase}`,
        onclick: () => actions.flyToActiveUnit(order.id),
        onmouseenter: () => actions.highlightOrder(order.id),
        onmouseleave: () => actions.highlightOrder(null),
      },
      topRow,
      transcriptBox,
      tacticExplain,
      progressRow,
    );

    const refs: CardDomRefs = {
      card,
      equalizer,
      progressFill,
      statusText,
      trackBtn,
      orderId: order.id,
      phase: event.phase,
    };
    cardDomMap.set(event.id, refs);
    return refs;
  }

  store.subscribe((s) => {
    const plan = s.agentPlan;
    const area = s.area;
    if (plan !== lastPlanRef) {
      lastPlanRef = plan;
      cardDomMap.clear();
      lastVisibleIdsKey = '';
    }

    if (!plan || !area || plan.orders.length === 0) {
      hudContainer.style.display = 'none';
      spokenEventIds.clear();
      return;
    }

    const enabledOrders = plan.orders.filter((o) => o.enabled);
    if (enabledOrders.length === 0) {
      hudContainer.style.display = 'none';
      return;
    }

    hudContainer.style.display = '';
    stopTrackBtn.style.display = s.trackedOrderId ? '' : 'none';

    const t = s.playback.t;
    headerClock.textContent = `T+${formatClock(t)}`;

    // If user scrubbed backward or restarted, reset spoken IDs after current time
    if (t < lastTimeS - 5 || t <= 2) {
      for (const order of enabledOrders) {
        for (const ev of order.radioCallouts) {
          if (ev.triggerTimeSeconds > t) {
            spokenEventIds.delete(ev.id);
          }
        }
      }
    }

    // Collect all radio callout events from enabled orders
    const allEvents: { event: RadioCalloutEvent; order: AgentDispatchOrder }[] = [];
    for (const order of enabledOrders) {
      for (const ev of order.radioCallouts) {
        allEvents.push({ event: ev, order });
      }
    }
    allEvents.sort((a, b) => a.event.triggerTimeSeconds - b.event.triggerTimeSeconds);

    // Trigger voice synthesis when simulation clock crosses a callout timestamp
    if (s.playback.playing) {
      for (const { event } of allEvents) {
        if (
          t >= event.triggerTimeSeconds &&
          t <= event.triggerTimeSeconds + 45 &&
          !spokenEventIds.has(event.id)
        ) {
          spokenEventIds.add(event.id);
          voiceSynth.speakCallout(event);
          break; // Speak one new transmission per tick
        }
      }
    }
    lastTimeS = t;

    // Filter events that are currently active or recently transmitted within the last 320s
    let visibleItems = allEvents.filter(
      ({ event }) =>
        t >= event.triggerTimeSeconds &&
        (t <= event.endTimeSeconds + 90 || t - event.triggerTimeSeconds <= 320),
    );

    if (visibleItems.length === 0) {
      const pastItems = allEvents.filter(({ event }) => event.triggerTimeSeconds <= t);
      if (pastItems.length > 0) {
        visibleItems = pastItems.slice(-3);
      } else {
        visibleItems = allEvents.filter(({ event }) => event.phase === 'dispatch').slice(0, 3);
      }
    } else {
      visibleItems = visibleItems.slice(-4).reverse();
    }

    // Reconcile DOM children ONLY when the list of visible event IDs changes
    const visibleIdsKey = visibleItems.map((item) => item.event.id).join('|');
    if (visibleIdsKey !== lastVisibleIdsKey) {
      lastVisibleIdsKey = visibleIdsKey;
      toastStack.replaceChildren(
        ...visibleItems.map(({ event, order }) => getOrCreateCardDom(event, order).card),
      );
    }

    // Update live state in-place without recreating DOM nodes
    for (const { event, order } of visibleItems) {
      const refs = getOrCreateCardDom(event, order);
      const kin = computeOrderKinematicsAtTime(
        order,
        enabledOrders,
        s.dipSite,
        area.grid,
        t,
      );

      const isTransmittingNow =
        t >= event.triggerTimeSeconds && t <= event.triggerTimeSeconds + 60 && s.playback.playing;
      refs.equalizer.classList.toggle('speaking', isTransmittingNow);

      const progressPct =
        kin.phase === 'executing_tactic'
          ? Math.round(kin.swathProgress * 100)
          : kin.phase === 'transit' || kin.phase === 'dip_refill'
            ? Math.round(kin.transitProgress * 100)
            : kin.phase === 'completed'
              ? 100
              : 0;
      refs.progressFill.style.width = `${progressPct}%`;
      refs.statusText.textContent = kin.statusBadge;

      const isTracked = s.trackedOrderId === order.id;
      const isHighlighted = s.highlightedOrderId === order.id || isTracked;
      refs.card.classList.toggle('highlighted', isHighlighted);
      refs.card.classList.toggle('tracked', isTracked);
      refs.trackBtn.textContent = isTracked ? '🎯 Tracking 3D' : '🎯 Track 3D';
      refs.trackBtn.classList.toggle('active', isTracked);
    }
  });
}
