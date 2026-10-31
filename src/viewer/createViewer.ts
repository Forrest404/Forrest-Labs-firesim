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
import { tryAddGoogleTiles } from './googleTiles';

export type ViewerMode = 'google' | 'fallback';

export interface ViewerHandle {
  viewer: Viewer;
  mode: ViewerMode;
  /** Why we are in fallback mode (empty in google mode). */
  fallbackReason: string;
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

  const key = (o.googleApiKey ?? '').trim();
  if (!key) {
    return { viewer, mode: 'fallback', fallbackReason: 'No VITE_GOOGLE_MAPS_API_KEY set.' };
  }
  const result = await tryAddGoogleTiles(viewer, key, (reason) => o.onModeChange?.('fallback', reason));
  if (result.ok) return { viewer, mode: 'google', fallbackReason: '' };
  return { viewer, mode: 'fallback', fallbackReason: result.reason };
}
