/**
 * Creates the Cesium viewer. The base layer and terrain are explicit (no ion defaults).
 * Primary mode adds Photorealistic 3D Tiles from Cesium ion when a token is present
 * (ionTiles.ts); otherwise, or on failure, the OpenStreetMap raster globe is the fallback.
 */

import {
  EllipsoidTerrainProvider,
  ImageryLayer,
  OpenStreetMapImageryProvider,
  Viewer,
} from 'cesium';
import { tryAddIonTiles } from './ionTiles';

export type ViewerMode = 'tiles' | 'fallback';

export interface ViewerHandle {
  viewer: Viewer;
  mode: ViewerMode;
  /** Why we are in fallback mode (empty in tiles mode). */
  fallbackReason: string;
}

export interface CreateViewerOptions {
  container: HTMLElement;
  /** Cesium ion access token (VITE_CESIUM_ION_TOKEN). Empty means fallback mode. */
  ionAccessToken?: string;
  /** Called if the mode changes after creation (e.g. 3D tiles start failing later). */
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

  const token = (o.ionAccessToken ?? '').trim();
  if (!token) {
    return { viewer, mode: 'fallback', fallbackReason: 'No VITE_CESIUM_ION_TOKEN set.' };
  }
  const result = await tryAddIonTiles(viewer, token, (reason) => o.onModeChange?.('fallback', reason));
  if (result.ok) return { viewer, mode: 'tiles', fallbackReason: '' };
  return { viewer, mode: 'fallback', fallbackReason: result.reason };
}
