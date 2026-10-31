/**
 * Creates the Cesium viewer. Never touches Cesium ion: the base layer and terrain are explicit.
 * Primary mode adds Google Photorealistic 3D Tiles when a key is present (googleTiles.ts);
 * otherwise, or on failure, the OpenStreetMap raster globe is the fallback.
 */

import {
  EllipsoidTerrainProvider,
  ImageryLayer,
  OpenStreetMapImageryProvider,
  Viewer,
} from 'cesium';
import type { Cesium3DTileset } from 'cesium';
import { tryAddGoogleTiles } from './googleTiles';

export type ViewerMode = 'google' | 'fallback';
/** What is drawn under the overlays: the Google tileset (when loaded) or the OSM globe. */
export type Backdrop = 'tiles' | 'globe';

export interface ViewerHandle {
  viewer: Viewer;
  mode: ViewerMode;
  /** Why we are in fallback mode (empty in google mode). */
  fallbackReason: string;
  /**
   * Switches between the Google tileset and the globe. The live-fires view uses the globe so the
   * far side of the Earth occludes points and no tiles stream for the whole planet. No-op in
   * fallback mode or after a late tile failure (the globe is already the only backdrop then).
   */
  setBackdrop(mode: Backdrop): void;
}

export interface CreateViewerOptions {
  container: HTMLElement;
  googleApiKey?: string;
  /** Called if the mode changes after creation (e.g. Google tiles start failing later). */
  onModeChange?: (mode: ViewerMode, reason: string) => void;
}

export async function createViewer(o: CreateViewerOptions): Promise<ViewerHandle> {
  const osm = new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' });
  const viewer = new Viewer(o.container, {
    baseLayer: new ImageryLayer(osm),
    terrainProvider: new EllipsoidTerrainProvider(),
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    fullscreenButton: false,
    shouldAnimate: true,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  // Double-click on an entity would otherwise fly the camera to it; we handle clicks ourselves.
  viewer.screenSpaceEventHandler.removeInputAction(2 /* LEFT_DOUBLE_CLICK */);

  let tileset: Cesium3DTileset | null = null;
  let tilesAlive = false;
  const setBackdrop = (mode: Backdrop): void => {
    if (!tileset || !tilesAlive) return;
    tileset.show = mode === 'tiles';
    viewer.scene.globe.show = mode === 'globe';
  };

  const key = (o.googleApiKey ?? '').trim();
  if (!key) {
    return { viewer, mode: 'fallback', fallbackReason: 'No VITE_GOOGLE_MAPS_API_KEY set.', setBackdrop };
  }
  const result = await tryAddGoogleTiles(viewer, key, (reason) => {
    tilesAlive = false;
    o.onModeChange?.('fallback', reason);
  });
  if (result.ok) {
    tileset = result.tileset;
    tilesAlive = true;
    return { viewer, mode: 'google', fallbackReason: '', setBackdrop };
  }
  return { viewer, mode: 'fallback', fallbackReason: result.reason, setBackdrop };
}
