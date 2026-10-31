/**
 * Fetches NASA FIRMS detections for a UI-level source, with a timeout, an in-memory cache and
 * error mapping to user-facing kinds. Node-safe (global fetch, injectable for tests).
 *
 * Budget: one MAP_KEY allows 5000 transactions per 10 minutes and a world request costs tens of
 * them, and on the deployed site every visitor shares the same key. So results are cached for
 * cacheTtlMs and a forced refresh is honoured at most once per minRefreshMs.
 *
 * Secret handling: the key only ever appears in the request URL. It is never logged and never
 * placed in an Error message or detail.
 *
 * Browser caveat (verified 2026-10-31): FIRMS sends `access-control-allow-origin: *` only on
 * successful replies. Its 400/401/403 error bodies have no CORS headers, so in a browser an invalid
 * key or an exhausted budget surfaces as a failed fetch ('network'), not as 'invalid-key' or
 * 'rate-limit'. Those kinds are still mapped here for non-browser callers and tests.
 */

import { SOURCE_SETS, firmsAreaUrl, parseFirmsCsv } from './firms';
import type { BBox, Hotspot, LiveSource } from './firms';

export type FirmsErrorKind = 'no-key' | 'invalid-key' | 'rate-limit' | 'network' | 'timeout' | 'cancelled' | 'bad-response';

export class FirmsError extends Error {
  constructor(public readonly kind: FirmsErrorKind, public readonly status?: number, public readonly detail?: string) {
    super(`FIRMS ${kind}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'FirmsError';
  }
}

export interface FirmsFetchOptions {
  source: LiveSource;
  days: number;
  area?: BBox | 'world';
  /** Bypass the cache (still rate-limited by minRefreshMs). */
  force?: boolean;
  signal?: AbortSignal;
}

export interface FirmsFetchResult {
  hotspots: Hotspot[];
  fetchedAt: number;
  fromCache: boolean;
}

export interface FirmsClient {
  fetchHotspots(o: FirmsFetchOptions): Promise<FirmsFetchResult>;
  hasKey(): boolean;
}

export interface FirmsClientOptions {
  key: string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  minRefreshMs?: number;
}

interface CacheEntry { hotspots: Hotspot[]; fetchedAt: number }

const MAX_DETAIL = 120;

export function createFirmsClient(o: FirmsClientOptions): FirmsClient {
  const key = (o.key ?? '').trim();
  const fetchImpl: typeof fetch = o.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = o.now ?? (() => Date.now());
  const timeoutMs = o.timeoutMs ?? 20_000;
  const cacheTtlMs = o.cacheTtlMs ?? 10 * 60_000;
  const minRefreshMs = o.minRefreshMs ?? 60_000;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<FirmsFetchResult>>();

  async function fetchOne(url: string, signal: AbortSignal | undefined): Promise<Hotspot[]> {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) throw new FirmsError('cancelled');
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Reject on abort even if the fetch implementation ignores the signal.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new FirmsError(signal?.aborted ? 'cancelled' : 'timeout')), { once: true });
    });
    try {
      let res: Response;
      try {
        res = await Promise.race([fetchImpl(url, { signal: controller.signal }), aborted]);
      } catch (err) {
        if (err instanceof FirmsError) throw err;
        if (controller.signal.aborted) throw new FirmsError(signal?.aborted ? 'cancelled' : 'timeout');
        throw new FirmsError('network');
      }
      let body = '';
      try {
        body = await Promise.race([res.text(), aborted]);
      } catch (err) {
        if (err instanceof FirmsError) throw err;
        throw new FirmsError('network');
      }
      const head = body.slice(0, MAX_DETAIL).trim();
      if (/invalid map_key/i.test(head) || res.status === 401 || res.status === 403 && !/transaction/i.test(head)) {
        throw new FirmsError('invalid-key', res.status, head);
      }
      if (/transaction/i.test(head) || res.status === 429) throw new FirmsError('rate-limit', res.status, head);
      if (!res.ok) throw new FirmsError('bad-response', res.status);
      try {
        return parseFirmsCsv(body);
      } catch {
        throw new FirmsError('bad-response', res.status, head);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  async function fetchFresh(o2: FirmsFetchOptions, cacheKey: string): Promise<FirmsFetchResult> {
    const area = o2.area ?? 'world';
    const urls = SOURCE_SETS[o2.source].map((source) => firmsAreaUrl({ key, source, area, days: o2.days }));
    const parts = await Promise.all(urls.map((u) => fetchOne(u, o2.signal)));
    const hotspots = parts.length === 1 ? parts[0] : parts.flat();
    const entry = { hotspots, fetchedAt: now() };
    cache.set(cacheKey, entry);
    return { ...entry, fromCache: false };
  }

  return {
    hasKey: () => key.length > 0,
    fetchHotspots(o2) {
      if (!key) return Promise.reject(new FirmsError('no-key'));
      const area = o2.area ?? 'world';
      const areaKey = area === 'world' ? 'world' : `${area.west},${area.south},${area.east},${area.north}`;
      const cacheKey = `${o2.source}|${Math.floor(o2.days)}|${areaKey}`;
      const hit = cache.get(cacheKey);
      if (hit) {
        const age = now() - hit.fetchedAt;
        if (age < cacheTtlMs && (!o2.force || age < minRefreshMs)) return Promise.resolve({ ...hit, fromCache: true });
      }
      const pending = inflight.get(cacheKey);
      if (pending) return pending;
      const p = fetchFresh(o2, cacheKey).finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, p);
      return p;
    },
  };
}
