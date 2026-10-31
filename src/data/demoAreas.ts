/**
 * Loads demo-area bundles from public/demo-areas/ (browser). The "Live (current view)" entry is a
 * stub in v0: it must never crash, it just reports "coming soon".
 */

import { decodeBundle } from './bundle';
import type { DemoArea, DemoAreaBundle, DemoAreaIndex, DemoAreaIndexEntry } from './bundle';

// Prefixed with Vite's BASE_URL so the app also works when served under a sub-path (GitHub Pages).
export const DEMO_AREAS_BASE = `${import.meta.env.BASE_URL}demo-areas/`;
export const LIVE_AREA_NAME = 'live';

export async function loadDemoAreaIndex(base = DEMO_AREAS_BASE): Promise<DemoAreaIndex> {
  const res = await fetch(`${base}index.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load demo area index (${res.status})`);
  const idx = (await res.json()) as DemoAreaIndex;
  if (!Array.isArray(idx.areas)) throw new Error('Demo area index is malformed');
  return idx;
}

export async function loadDemoArea(entry: DemoAreaIndexEntry, base = DEMO_AREAS_BASE): Promise<DemoArea> {
  const res = await fetch(`${base}${entry.file}`);
  if (!res.ok) throw new Error(`Could not load demo area "${entry.label}" (${res.status})`);
  const bundle = (await res.json()) as DemoAreaBundle;
  return decodeBundle(bundle);
}

export class LiveAreaNotAvailable extends Error {
  constructor() {
    super('Live loading of the current view is coming soon. Pick a saved demo area.');
    this.name = 'LiveAreaNotAvailable';
  }
}

/**
 * TODO(live-data): fetch Overpass + Terrarium for the given bounds in the browser, build the grid
 * with buildFuelGrid() / sampleElevationGrid() / fillNodata(), cache by bounds, and return a
 * DemoArea with synthetic=false and proper attribution. Until then this throws a typed error.
 */
export async function loadLiveArea(_centerLon: number, _centerLat: number): Promise<DemoArea> {
  throw new LiveAreaNotAvailable();
}
