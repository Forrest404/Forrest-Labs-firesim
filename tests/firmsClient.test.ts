import { describe, expect, it } from 'vitest';
import { FirmsError, createFirmsClient } from '../src/data/firmsClient';

const KEY = 'ffffffffffffffffffffffffffffffff';

const CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-15.8213,131.1125,345.2,0.39,0.36,2026-10-31,0412,N20,VIIRS,n,2.0NRT,298.1,12.6,N`;

interface Stub { calls: string[]; fetch: typeof fetch }

function stub(handler: (url: string) => Response | Promise<Response>): Stub {
  const calls: string[] = [];
  const f = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return { calls, fetch: f };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof FirmsError ? err.kind : `other:${String(err)}`;
  }
}

describe('createFirmsClient', () => {
  it('rejects with no-key and never calls fetch when the key is empty', async () => {
    const s = stub(() => new Response(CSV));
    const c = createFirmsClient({ key: '  ', fetchImpl: s.fetch });
    expect(c.hasKey()).toBe(false);
    expect(await kindOf(c.fetchHotspots({ source: 'snpp', days: 1 }))).toBe('no-key');
    expect(s.calls).toHaveLength(0);
  });

  it('fetches, parses and caches within the TTL', async () => {
    const s = stub(() => new Response(CSV, { status: 200 }));
    const k = clock();
    const c = createFirmsClient({ key: KEY, fetchImpl: s.fetch, now: k.now, cacheTtlMs: 10_000, minRefreshMs: 1_000 });
    const a = await c.fetchHotspots({ source: 'snpp', days: 1 });
    expect(a.fromCache).toBe(false);
    expect(a.hotspots).toHaveLength(1);
    expect(a.fetchedAt).toBe(k.now());
    expect(s.calls).toEqual([`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/VIIRS_SNPP_NRT/world/1`]);
    k.advance(5_000);
    const b = await c.fetchHotspots({ source: 'snpp', days: 1 });
    expect(b.fromCache).toBe(true);
    expect(b.hotspots).toBe(a.hotspots);
    expect(s.calls).toHaveLength(1);
    k.advance(6_000); // past the TTL
    const d = await c.fetchHotspots({ source: 'snpp', days: 1 });
    expect(d.fromCache).toBe(false);
    expect(s.calls).toHaveLength(2);
  });

  it('honours force only after the refresh floor', async () => {
    const s = stub(() => new Response(CSV));
    const k = clock();
    const c = createFirmsClient({ key: KEY, fetchImpl: s.fetch, now: k.now, cacheTtlMs: 100_000, minRefreshMs: 1_000 });
    await c.fetchHotspots({ source: 'modis', days: 1 });
    k.advance(500);
    expect((await c.fetchHotspots({ source: 'modis', days: 1, force: true })).fromCache).toBe(true);
    expect(s.calls).toHaveLength(1);
    k.advance(600);
    expect((await c.fetchHotspots({ source: 'modis', days: 1, force: true })).fromCache).toBe(false);
    expect(s.calls).toHaveLength(2);
  });

  it('keys the cache by source, days and area', async () => {
    const s = stub(() => new Response(CSV));
    const c = createFirmsClient({ key: KEY, fetchImpl: s.fetch });
    await c.fetchHotspots({ source: 'modis', days: 1 });
    await c.fetchHotspots({ source: 'modis', days: 2 });
    await c.fetchHotspots({ source: 'modis', days: 1, area: { west: -125, south: 32, east: -114, north: 42 } });
    await c.fetchHotspots({ source: 'modis', days: 1 });
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]).toMatch(/\/MODIS_NRT\/-125,32,-114,42\/1$/);
  });

  it('dedupes concurrent calls for the same key', async () => {
    const s = stub(() => new Response(CSV));
    const c = createFirmsClient({ key: KEY, fetchImpl: s.fetch });
    const [a, b] = await Promise.all([c.fetchHotspots({ source: 'snpp', days: 1 }), c.fetchHotspots({ source: 'snpp', days: 1 })]);
    expect(a.hotspots).toBe(b.hotspots);
    expect(s.calls).toHaveLength(1);
  });

  it('fetches both VIIRS satellites for "viirs" and merges them', async () => {
    const s = stub(() => new Response(CSV));
    const c = createFirmsClient({ key: KEY, fetchImpl: s.fetch });
    const r = await c.fetchHotspots({ source: 'viirs', days: 2 });
    expect(s.calls.map((u) => u.split('/').slice(-3).join('/'))).toEqual(['VIIRS_NOAA20_NRT/world/2', 'VIIRS_SNPP_NRT/world/2']);
    expect(r.hotspots).toHaveLength(2);
  });

  it('maps FIRMS errors to kinds', async () => {
    const mk = (body: string, status: number) => createFirmsClient({ key: KEY, fetchImpl: stub(() => new Response(body, { status })).fetch });
    expect(await kindOf(mk('Invalid MAP_KEY.', 400).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('invalid-key');
    expect(await kindOf(mk('Invalid MAP_KEY.', 401).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('invalid-key');
    expect(await kindOf(mk('Exceeding allowed transaction limit.', 403).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('rate-limit');
    expect(await kindOf(mk('MAP_KEY is invalid or your have exceeded your transaction/time limit.', 403).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('rate-limit');
    expect(await kindOf(mk('slow down', 429).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('rate-limit');
    expect(await kindOf(mk('<html>oops</html>', 500).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('bad-response');
    expect(await kindOf(mk('<html>not csv</html>', 200).fetchHotspots({ source: 'snpp', days: 1 }))).toBe('bad-response');
  });

  it('reports status and a short detail, never the key', async () => {
    const body = `Invalid MAP_KEY. ${'x'.repeat(500)}`;
    const c = createFirmsClient({ key: KEY, fetchImpl: stub(() => new Response(body, { status: 400 })).fetch });
    let err: FirmsError | null = null;
    try {
      await c.fetchHotspots({ source: 'snpp', days: 1 });
    } catch (e) {
      err = e as FirmsError;
    }
    expect(err).toBeInstanceOf(FirmsError);
    expect(err!.status).toBe(400);
    expect(err!.detail!.length).toBeLessThanOrEqual(120);
    expect(err!.message).not.toContain(KEY);
    expect(err!.detail).not.toContain(KEY);
  });

  it('maps a thrown TypeError to network', async () => {
    const f = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const c = createFirmsClient({ key: KEY, fetchImpl: f });
    expect(await kindOf(c.fetchHotspots({ source: 'snpp', days: 1 }))).toBe('network');
  });

  it('times out a hanging fetch, even one that ignores the signal', async () => {
    const f = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const c = createFirmsClient({ key: KEY, fetchImpl: f, timeoutMs: 10 });
    expect(await kindOf(c.fetchHotspots({ source: 'snpp', days: 1 }))).toBe('timeout');
  });

  it('reports cancelled when the caller aborts', async () => {
    const f = ((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    const c = createFirmsClient({ key: KEY, fetchImpl: f, timeoutMs: 5_000 });
    const ac = new AbortController();
    const p = c.fetchHotspots({ source: 'snpp', days: 1, signal: ac.signal });
    ac.abort();
    expect(await kindOf(p)).toBe('cancelled');
    const ac2 = new AbortController();
    ac2.abort();
    expect(await kindOf(c.fetchHotspots({ source: 'modis', days: 1, signal: ac2.signal }))).toBe('cancelled');
  });

  it('a refresh after aborting the in-flight request starts a new request instead of handing out the cancelled one', async () => {
    // The live tab aborts the previous request on every refresh. Reusing the aborted in-flight
    // promise left the new caller with a "cancelled" rejection and the tab stuck on loading.
    let resolveFirst: ((r: Response) => void) | null = null;
    let n = 0;
    const f = ((_input: RequestInfo | URL, init?: RequestInit) => {
      n++;
      if (n === 1) {
        return new Promise<Response>((resolve, reject) => {
          resolveFirst = resolve;
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return Promise.resolve(new Response(CSV, { status: 200 }));
    }) as typeof fetch;
    const c = createFirmsClient({ key: KEY, fetchImpl: f });
    const first = new AbortController();
    const p1 = c.fetchHotspots({ source: 'snpp', days: 1, signal: first.signal });
    first.abort();
    const second = new AbortController();
    const p2 = c.fetchHotspots({ source: 'snpp', days: 1, force: true, signal: second.signal });
    expect(await kindOf(p1)).toBe('cancelled');
    const r = await p2;
    expect(r.fromCache).toBe(false);
    expect(r.hotspots).toHaveLength(1);
    expect(n).toBe(2);
    expect(resolveFirst).not.toBeNull();
    // A third call now hits the cache that the second request filled, not the dead first one.
    expect((await c.fetchHotspots({ source: 'snpp', days: 1 })).fromCache).toBe(true);
    expect(n).toBe(2);
  });

  it('does not cache failures', async () => {
    let n = 0;
    const s = stub(() => (n++ === 0 ? new Response('Invalid MAP_KEY.', { status: 400 }) : new Response(CSV)));
    const c = createFirmsClient({ key: KEY, fetchImpl: s.fetch });
    expect(await kindOf(c.fetchHotspots({ source: 'snpp', days: 1 }))).toBe('invalid-key');
    expect((await c.fetchHotspots({ source: 'snpp', days: 1 })).hotspots).toHaveLength(1);
    expect(s.calls).toHaveLength(2);
  });
});
