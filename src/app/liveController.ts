/**
 * Live-fires tab controller: owns the FIRMS fetch lifecycle (one in-flight request, generation
 * counter, abort on change), derives the filtered list and clusters, and is the only writer of
 * `state.live` and `state.view`.
 *
 * Store rule: a `store.set` inside a subscriber re-enters the listener loop with a stale `prev`,
 * so anything triggered from a subscriber is deferred with queueMicrotask.
 */

import { clusterHotspots, filterHotspots } from '../data/firms';
import type { Hotspot, HotspotFilters, LiveSource } from '../data/firms';
import { FirmsError } from '../data/firmsClient';
import type { FirmsClient, FirmsErrorKind } from '../data/firmsClient';
import type { Notices } from '../ui/notices';
import { STR } from '../ui/strings';
import { redact } from '../viewer/redact';
import type { LiveState, Store, ViewId } from './state';

export interface LiveActions {
  setView(view: ViewId): void;
  refresh(force?: boolean): void;
  setSource(source: LiveSource): void;
  setDays(days: 1 | 2 | 3): void;
  setFilters(patch: Partial<HotspotFilters>): void;
  select(id: string | null): void;
  flyToHotspot(id: string): void;
  flyToCluster(id: string): void;
}

const HOTSPOT_RANGE_M = 60_000;
const CLUSTER_RANGE_M = 150_000;

function derive(hotspots: Hotspot[], filters: HotspotFilters): Pick<LiveState, 'filtered' | 'clusters'> {
  const filtered = filterHotspots(hotspots, filters);
  return { filtered, clusters: clusterHotspots(filtered) };
}

export function createLiveController(
  store: Store,
  notices: Notices,
  client: FirmsClient,
  flyTo: (lon: number, lat: number, rangeM: number) => void,
): LiveActions {
  let generation = 0;
  let controller: AbortController | null = null;

  const patchLive = (fn: (live: LiveState) => Partial<LiveState>): void => {
    store.update((s) => ({ live: { ...s.live, ...fn(s.live) } }));
  };

  async function refresh(force = false): Promise<void> {
    const s = store.get();
    if (!s.live.keyPresent) {
      patchLive(() => ({ status: 'error', error: STR.liveError['no-key'] }));
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const gen = ++generation;
    patchLive(() => ({ status: 'loading', error: null }));
    try {
      const r = await client.fetchHotspots({ source: s.live.source, days: s.live.days, force, signal: controller.signal });
      if (gen !== generation) return;
      patchLive((live) => ({
        hotspots: r.hotspots,
        ...derive(r.hotspots, live.filters),
        fetchedAt: r.fetchedAt,
        status: 'ready',
        error: null,
        selectedId: null,
      }));
      if (force && r.fromCache) notices.show(STR.liveUpToDate, 'info', 2500);
    } catch (err) {
      if (gen !== generation) return;
      const kind: FirmsErrorKind = err instanceof FirmsError ? err.kind : 'bad-response';
      if (kind === 'cancelled') return;
      const detail = err instanceof FirmsError && err.detail && (kind === 'invalid-key' || kind === 'rate-limit') ? ` ${redact(err.detail)}` : '';
      const msg = `${STR.liveError[kind]}${detail}`;
      patchLive(() => ({ status: 'error', error: msg }));
      notices.show(msg, 'error', 8000);
    }
  }

  // First entry into the live tab loads data on its own (deferred: this runs inside a subscriber).
  store.subscribe((s, prev) => {
    if (s.view === 'live' && prev.view !== 'live' && s.live.status === 'idle' && s.live.keyPresent) {
      queueMicrotask(() => void refresh());
    }
  });

  const select = (id: string | null): void => {
    if (store.get().live.selectedId === id) return;
    patchLive(() => ({ selectedId: id }));
  };

  return {
    setView(view) {
      store.update((s) => {
        if (s.view === view) return {};
        return {
          view,
          playback: { ...s.playback, playing: false },
          live: view === 'sim' ? { ...s.live, selectedId: null } : s.live,
        };
      });
    },
    refresh(force = false) {
      void refresh(force);
    },
    setSource(source) {
      if (store.get().live.source === source) return;
      patchLive(() => ({ source }));
      void refresh();
    },
    setDays(days) {
      if (store.get().live.days === days) return;
      patchLive(() => ({ days }));
      void refresh();
    },
    setFilters(patch) {
      patchLive((live) => {
        const filters = { ...live.filters, ...patch };
        const d = derive(live.hotspots, filters);
        const keep = live.selectedId !== null && d.filtered.some((h) => h.id === live.selectedId);
        return { filters, ...d, selectedId: keep ? live.selectedId : null };
      });
    },
    select,
    flyToHotspot(id) {
      const h = store.get().live.filtered.find((x) => x.id === id);
      if (!h) return;
      select(id);
      flyTo(h.lon, h.lat, HOTSPOT_RANGE_M);
    },
    flyToCluster(id) {
      const c = store.get().live.clusters.find((x) => x.id === id);
      if (!c) return;
      select(c.sampleId);
      flyTo(c.lon, c.lat, CLUSTER_RANGE_M);
    },
  };
}
