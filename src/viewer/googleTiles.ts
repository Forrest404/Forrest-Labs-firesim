/**
 * Google Photorealistic 3D Tiles (Map Tiles API) in Cesium. DISPLAY ONLY: nothing reads data back
 * from these tiles (see DECISIONS.md D9). Google's attribution is rendered by Cesium's credit
 * display (showCreditsOnScreen).
 */

import { createGooglePhotorealistic3DTileset } from 'cesium';
import type { Cesium3DTileset, Viewer } from 'cesium';

export type GoogleTilesResult = { ok: true; tileset: Cesium3DTileset } | { ok: false; reason: string };

const EARLY_FAILURE_WINDOW_MS = 30_000;
const EARLY_FAILURE_LIMIT = 25;

/**
 * Adds the tileset. Resolves ok:false (without throwing) when the key is missing/invalid or the
 * root tileset cannot be fetched. If many tiles fail shortly after start (quota, network), the
 * tileset is removed, the globe is shown again and onLateFailure is called.
 */
export async function tryAddGoogleTiles(
  viewer: Viewer,
  key: string,
  onLateFailure: (reason: string) => void,
): Promise<GoogleTilesResult> {
  let tileset: Cesium3DTileset;
  try {
    tileset = await createGooglePhotorealistic3DTileset({ key }, { showCreditsOnScreen: true });
  } catch (err) {
    return { ok: false, reason: `Google 3D Tiles could not be loaded: ${describe(err)}` };
  }
  viewer.scene.primitives.add(tileset);
  viewer.scene.globe.show = false;

  const started = Date.now();
  let failures = 0;
  let reverted = false;
  tileset.tileFailed.addEventListener(() => {
    if (reverted) return;
    failures++;
    if (Date.now() - started < EARLY_FAILURE_WINDOW_MS && failures >= EARLY_FAILURE_LIMIT) {
      reverted = true;
      viewer.scene.primitives.remove(tileset);
      viewer.scene.globe.show = true;
      onLateFailure('Google 3D Tiles stopped loading (quota, key restriction or network).');
    }
  });
  return { ok: true, tileset };
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'statusCode' in err) return `HTTP ${(err as { statusCode: number }).statusCode}`;
  return err instanceof Error ? err.message : String(err);
}
