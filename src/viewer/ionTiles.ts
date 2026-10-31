/**
 * Photorealistic 3D Tiles streamed from Cesium ion (ion asset 2275207, which is Google's
 * Photorealistic 3D Tiles distributed and billed through ion).
 *
 * DISPLAY ONLY. Nothing in this module or anywhere else in the app samples, caches, downloads or
 * extracts data from these tiles (see DECISIONS.md D9, D18). Simulation inputs come from open
 * data. Google's and Cesium's attribution are rendered by Cesium's on-screen credit display.
 *
 * Secret handling: the ion token is handed to IonResource per asset and never assigned to the
 * global Ion.defaultAccessToken, never logged. Tile URLs and ion responses carry access tokens,
 * so every error message that could contain one goes through redact() before leaving here.
 */

import { Cesium3DTileset, IonResource } from 'cesium';
import type { Viewer } from 'cesium';
import { redact } from './redact';

/** Cesium ion Asset Depot id for "Google Photorealistic 3D Tiles". */
export const PHOTOREALISTIC_TILES_ASSET_ID = 2275207;

export type TilesResult = { ok: true; tileset: Cesium3DTileset } | { ok: false; reason: string };

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
  // Same defaults createGooglePhotorealistic3DTileset applies for this asset, cache kept modest.
  enableCollision: true,
  cacheBytes: 512 * 1024 * 1024,
  maximumCacheOverflowBytes: 256 * 1024 * 1024,
} as const;

/**
 * Adds the tileset. Resolves ok:false (without throwing) when the token is missing/invalid, the
 * asset is not in the account, or the root tileset cannot be fetched. If tiles start failing
 * afterwards (quota, token revoked, network), the tileset is removed, the globe is shown again
 * and onLateFailure is called once. The fallback globe is always underneath, so the scene is
 * never blank.
 */
export async function tryAddIonTiles(
  viewer: Viewer,
  accessToken: string,
  onLateFailure: (reason: string) => void,
): Promise<TilesResult> {
  let tileset: Cesium3DTileset;
  try {
    const resource = await IonResource.fromAssetId(PHOTOREALISTIC_TILES_ASSET_ID, { accessToken });
    tileset = await Cesium3DTileset.fromUrl(resource, { ...TILESET_OPTIONS });
  } catch (err) {
    return { ok: false, reason: `3D tiles could not be loaded from Cesium ion: ${describe(err)}` };
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
          ? '3D tiles quota exceeded on Cesium ion (HTTP 429).'
          : `Cesium ion rejected the token (HTTP ${status}): check the token scopes and allowed URLs.`,
      );
    } else if (failures.length >= FAILURE_LIMIT) {
      revert('3D tiles stopped loading (network or server errors).');
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

/** Human-readable, URL-free description of a load error, with ion's usual causes spelled out. */
function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 401) return 'HTTP 401 (token invalid or missing the assets:read scope)';
    if (code === 403) return 'HTTP 403 (token not allowed for this URL or asset)';
    if (code === 404) return `HTTP 404 (asset ${PHOTOREALISTIC_TILES_ASSET_ID} is not added to this ion account)`;
    if (typeof code === 'number') return `HTTP ${code}`;
  }
  const raw = err instanceof Error ? err.message : String(err);
  return redact(raw) || 'network error';
}
