/**
 * Live fires pane: NASA FIRMS detections. Status + source/day-range, filters, the largest fires
 * (by summed radiative power), and the selected detection. Reads `state.live`, writes only
 * through LiveActions. Lists are rebuilt only when their input changes (D19).
 */

import type { LiveActions } from '../app/liveController';
import type { AppState, Store } from '../app/state';
import { FIRMS_KEY_URL, clusterKey } from '../data/firms';
import type { Hotspot, HotspotCluster, LiveSource } from '../data/firms';
import { chip, iconButton, row, section, segmented, slider, toggle } from './controls';
import { el, formatAge, formatUtc } from './el';
import { STR } from './strings';

const SOURCES: { value: LiveSource; label: string }[] = [
  { value: 'viirs', label: STR.liveSourceViirs },
  { value: 'noaa20', label: STR.liveSourceNoaa20 },
  { value: 'snpp', label: STR.liveSourceSnpp },
  { value: 'modis', label: STR.liveSourceModis },
];
const DAYS = [1, 2, 3] as const;

export function mountLive(container: HTMLElement, store: Store, actions: LiveActions): void {
  // --- Detections card -------------------------------------------------------------------
  const refreshBtn = iconButton('restart', STR.liveRefresh, () => actions.refresh(true));
  const main = section('globe', STR.liveTitle, { trailing: refreshBtn });
  const count = chip('', 'stat');
  const meta = el('span', { class: 'meta' });
  const status = el('div', { class: 'live-status' }, count, meta);
  const source = segmented(SOURCES, (v) => actions.setSource(v), { ariaLabel: STR.liveSource, class: 'small grow' });
  const days = segmented(DAYS.map((d) => ({ value: d, label: STR.liveDay(d) })), (d) => actions.setDays(d), { ariaLabel: STR.liveDays, class: 'small' });
  const controls = el('div', { class: 'sub' },
    el('div', { class: 'ctl-row stacked' }, el('span', { class: 'ctl-label' }, STR.liveSource), source.root),
    row(STR.liveDays, days.root),
  );
  const errorText = el('div', { class: 'error-text' });
  const empty = el('div', { class: 'muted hint' }, STR.liveEmpty);
  const keyMissing = el('div', { class: 'key-missing' },
    STR.liveKeyMissing, ' ',
    el('a', { href: FIRMS_KEY_URL, target: '_blank', rel: 'noopener noreferrer' }, STR.liveKeyLink),
  );
  main.body.append(status, controls, errorText, empty, keyMissing, el('div', { class: 'muted hint' }, STR.liveHonesty));

  // --- Filters card ----------------------------------------------------------------------
  const filters = section('sliders', STR.liveFilters);
  const hideLow = toggle(STR.liveHideLow, (on) => actions.setFilters({ hideLow: on }));
  const minFrp = slider({ min: 0, max: 100, step: 5, ariaLabel: STR.liveMinFrp }, (v) => actions.setFilters({ minFrp: v }));
  const minFrpVal = chip('', 'value');
  const pass = segmented(
    [{ value: 'all', label: STR.liveAll }, { value: 'day', label: STR.liveDayOnly }, { value: 'night', label: STR.liveNightOnly }],
    (v) => actions.setFilters({ daynight: v as 'all' | 'day' | 'night' }),
    { ariaLabel: STR.liveDayNight, class: 'small' },
  );
  filters.body.append(
    hideLow.root,
    row(STR.liveMinFrp, minFrp, minFrpVal),
    row(STR.liveDayNight, pass.root),
    el('div', { class: 'legend-age', 'aria-hidden': 'true' }),
    el('div', { class: 'muted hint' }, STR.liveAgeLegend),
  );

  // --- Largest fires card ----------------------------------------------------------------
  const largest = section('flame', STR.liveLargest);
  const list = el('ol', { class: 'clusters' });
  largest.body.append(list);
  const clusterButtons = new Map<string, HTMLButtonElement>();

  // --- Selected detection card -----------------------------------------------------------
  const clearBtn = iconButton('x', STR.liveClear, () => actions.select(null), { class: 'tiny' });
  const selected = section('target', STR.liveSelected, { trailing: clearBtn });
  const kv = el('dl', { class: 'kv' });
  const flyBtn = el('button', { type: 'button', onclick: () => { const id = store.get().live.selectedId; if (id) actions.flyToHotspot(id); } }, STR.liveFlyHere);
  selected.body.append(kv, flyBtn);
  selected.root.hidden = true;

  container.append(main.root, filters.root, largest.root, selected.root, el('div', { class: 'muted hint' }, STR.liveAttribution));

  // --- Rendering -------------------------------------------------------------------------
  let byId = new Map<string, Hotspot>();
  let lastHotspots: Hotspot[] | null = null;
  let lastClusters: HotspotCluster[] | null = null;

  const renderMeta = (s: AppState): void => {
    const L = s.live;
    if (L.status === 'loading') meta.textContent = STR.liveLoading;
    else if (L.fetchedAt === null) meta.textContent = STR.liveNever;
    else meta.textContent = `${STR.liveUpdated} ${formatAge(L.fetchedAt)}`;
  };

  const renderClusters = (s: AppState): void => {
    const L = s.live;
    if (L.clusters !== lastClusters) {
      lastClusters = L.clusters;
      clusterButtons.clear();
      list.replaceChildren(...L.clusters.map((c) => {
        const b = el('button', { type: 'button', onclick: () => actions.flyToCluster(c.id) },
          el('span', { class: 'frp' }, `${Math.round(c.frpSum)} MW`),
          el('span', { class: 'sub' }, `${c.count} ${STR.liveDetections} · ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)} · ${formatAge(c.latestAt)}`),
        ) as HTMLButtonElement;
        clusterButtons.set(c.id, b);
        return el('li', {}, b);
      }));
    }
    const sel = L.selectedId ? byId.get(L.selectedId) : undefined;
    const selKey = sel ? clusterKey(sel.lat, sel.lon) : null;
    for (const [id, b] of clusterButtons) b.classList.toggle('on', id === selKey);
  };

  const renderSelected = (s: AppState): void => {
    const h = s.live.selectedId ? byId.get(s.live.selectedId) : undefined;
    selected.root.hidden = !h;
    if (!h) return;
    const pairs: [string, string][] = [
      [STR.liveLat, h.lat.toFixed(4)],
      [STR.liveLon, h.lon.toFixed(4)],
      [STR.liveTime, `${formatUtc(h.acquiredAt)} (${formatAge(h.acquiredAt)})`],
      [STR.liveFrp, `${h.frp.toFixed(1)} MW`],
      [STR.liveConfidence, STR.liveConfidenceLabel[h.confidence]],
      [STR.liveSatellite, `${h.satellite} · ${h.instrument}`],
      [STR.liveBrightness, `${h.brightness.toFixed(0)} K`],
      [STR.livePass, h.daynight === 'D' ? STR.livePassDay : STR.livePassNight],
    ];
    kv.replaceChildren(...pairs.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  };

  const render = (s: AppState): void => {
    const L = s.live;
    if (L.hotspots !== lastHotspots) {
      lastHotspots = L.hotspots;
      byId = new Map(L.hotspots.map((h) => [h.id, h]));
    }
    const loading = L.status === 'loading';
    container.classList.toggle('loading', loading);
    refreshBtn.disabled = loading || !L.keyPresent;
    keyMissing.hidden = L.keyPresent;
    controls.hidden = !L.keyPresent;
    status.hidden = !L.keyPresent;
    count.textContent = `${L.filtered.length.toLocaleString()} ${STR.liveDetections}`;
    renderMeta(s);
    errorText.textContent = L.status === 'error' ? (L.error ?? '') : '';
    empty.hidden = !(L.status === 'ready' && L.filtered.length === 0);
    source.set(L.source);
    days.set(L.days);
    hideLow.input.checked = L.filters.hideLow;
    if (document.activeElement !== minFrp) minFrp.value = String(L.filters.minFrp);
    minFrpVal.textContent = `${L.filters.minFrp} MW`;
    pass.set(L.filters.daynight);
    renderClusters(s);
    renderSelected(s);
  };

  render(store.get());
  store.subscribe((s, prev) => {
    if (s.live !== prev.live) render(s);
  });
  // "Updated N min ago" ticks on its own; nothing else in the pane depends on wall-clock time.
  setInterval(() => renderMeta(store.get()), 30_000);
}
