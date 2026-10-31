/**
 * Google Photorealistic 3D Tiles (Map Tiles API) in Cesium.
 *
 * DISPLAY ONLY. Nothing in this module or anywhere else in the app samples, caches, downloads or
 * extracts data from Google tiles or imagery (see DECISIONS.md D9, D17). Simulation inputs come
 * from open data. Google's attribution and logo are rendered by Cesium's on-screen credit display.
 *
 * Secret handling: the key is passed to Cesium per request and never logged. Tile URLs carry the
 * key, so every error message that could contain a URL goes through redact() before it leaves
 * this module.
 */

import { createGooglePhotorealistic3DTileset } from 'cesium';
import type { Cesium3DTileset, Viewer } from 'cesium';
import { redact } from './redact';

export type GoogleTilesResult = { ok: true; tileset: Cesium3DTileset } | { ok: false; reason: string };

/** Sliding window used to decide that the tileset has stopped working. */
const FAILURE_WINDOW_MS = 30_000;
/** Generic tile failures (network, 5xx) inside the window before we revert. */
const FAILURE_LIMIT = 25;
/** Auth/quota failures (401/403/429) inside the window before we revert. */
const AUTH_FAILURE_LIMIT = 3;

/**
 * Cost controls. The demo area is about 6 km across, so there is no reason to stream tiles for
 * the whole flight path or for the far horizon at full detail.
 */
const TILESET_OPTIONS = {
  showCreditsOnScreen: true,
  // 16 is Cesium's default; a little higher keeps the demo crisp while cutting tile requests.
  maximumScreenSpaceError: 20,
  // Do not stream tiles at the fly-to destination while the camera is still in flight.
  preloadFlightDestinations: false,
  preloadWhenHidden: false,
  // Skip tiles the moving camera will not need by the time they arrive.
  cullRequestsWhileMoving: true,
  cullRequestsWhileMovingMultiplier: 60,
  // Lower resolution far from the camera (horizon views).
  dynamicScreenSpaceError: true,
  dynamicScreenSpaceErrorDensity: 2.0e-4,
  dynamicScreenSpaceErrorFactor: 24.0,
  dynamicScreenSpaceErrorHeightFalloff: 0.25,
  // Keep the cache modest; the default is 1.5 GB.
  cacheBytes: 512 * 1024 * 1024,
  maximumCacheOverflowBytes: 256 * 1024 * 1024,
} as const;

/**
 * Adds the tileset. Resolves ok:false (without throwing) when the key is missing/invalid or the
 * root tileset cannot be fetched. If tiles start failing afterwards (quota, key restriction,
 * network), the tileset is removed, the globe is shown again and onLateFailure is called once.
 * The app never ends up with a blank scene: the fallback globe is always underneath.
 */
export async function tryAddGoogleTiles(
  viewer: Viewer,
  key: string,
  onLateFailure: (reason: string) => void,
): Promise<GoogleTilesResult> {
  let tileset: Cesium3DTileset;
  try {
    // No geocoder is configured at all (Viewer option geocoder:false), so the "only Google
    // geocoder" warning does not apply.
    tileset = await createGooglePhotorealistic3DTileset(
      { key, onlyUsingWithGoogleGeocoder: true },
      { ...TILESET_OPTIONS },
    );
  } catch (err) {
    return { ok: false, reason: `Google 3D Tiles could not be loaded: ${describe(err)}` };
  }
  viewer.scene.primitives.add(tileset);
  viewer.scene.globe.show = false;

  const failures: number[] = [];
  const authFailures: number[] = [];
  let reverted = false;

  const revert = (reason: string) => {
    if (reverted) return;
    reverted = true;
    try {
      viewer.scene.primitives.remove(tileset);
    } catch {
      // Already destroyed; nothing to do.
    }
    viewer.scene.globe.show = true;
    onLateFailure(reason);
  };

  tileset.tileFailed.addEventListener((e: { url?: string; message?: string }) => {
    if (reverted) return;
    const now = Date.now();
    const status = statusOf(e.message);
    const bucket = status === 401 || status === 403 || status === 429 ? authFailures : failures;
    bucket.push(now);
    prune(bucket, now);
    if (authFailures.length >= AUTH_FAILURE_LIMIT) {
      revert(
        status === 429
          ? 'Google 3D Tiles quota exceeded (HTTP 429).'
          : `Google 3D Tiles rejected the key (HTTP ${status}): check API and referrer restrictions.`,
      );
    } else if (failures.length >= FAILURE_LIMIT) {
      revert('Google 3D Tiles stopped loading (network or server errors).');
    }
  });

  return { ok: true, tileset };
}

function prune(times: number[], now: number): void {
  while (times.length && now - times[0] > FAILURE_WINDOW_MS) times.shift();
}

/** Pulls an HTTP status out of a Cesium request error message, if any. Never logs the message. */
function statusOf(message: string | undefined): number | undefined {
  if (!message) return undefined;
  const m = /Status Code:\s*(\d{3})/i.exec(message);
  return m ? Number(m[1]) : undefined;
}

/** Human-readable, URL-free description of a load error. */
function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (typeof code === 'number') return `HTTP ${code}`;
  }
  const raw = err instanceof Error ? err.message : String(err);
  return redact(raw) || 'network error';
}
