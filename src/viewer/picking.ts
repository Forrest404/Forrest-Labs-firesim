/**
 * Screen -> lon/lat -> grid cell. Works on Google 3D Tiles (pickPosition) and on the fallback
 * globe. Supports click and drag; while a drag tool is active the camera does not rotate.
 * Tools only ever see cell coordinates (and fractional cell positions for smooth lines).
 */

import { Cartesian2, Cartographic, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Cartesian3, Viewer } from 'cesium';
import type { CellRef, GridSpec } from '../contract';
import { inGrid } from '../contract';
import { lonLatToCellFloat } from '../data/geo';

export interface PickedCell extends CellRef {
  /** Fractional cell coordinates (x along columns, y along rows). */
  x: number;
  y: number;
  lon: number;
  lat: number;
}

export interface PickHandlers {
  onClick(cell: PickedCell): void;
  onDragStart(cell: PickedCell): void;
  onDragMove(cell: PickedCell): void;
  onDragEnd(): void;
  /** Fired for clicks/drags that land outside the grid. */
  onOutside?(): void;
}

export interface Picker {
  /** When true, left-drag draws instead of rotating the camera. */
  setDragMode(enabled: boolean): void;
  /** When false, clicks and drags are ignored entirely (live view). */
  setEnabled(enabled: boolean): void;
  pickCell(x: number, y: number): PickedCell | null;
  destroy(): void;
}

export function createPicker(viewer: Viewer, getGrid: () => GridSpec | null, h: PickHandlers): Picker {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const controller = viewer.scene.screenSpaceCameraController;
  let dragMode = false;
  let enabled = true;
  let dragging = false;
  let lastKey = -1;

  const pickLonLat = (pos: Cartesian2): { lon: number; lat: number } | null => {
    const scene = viewer.scene;
    let cart: Cartesian3 | undefined;
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(pos);
      if (p && Number.isFinite(p.x)) cart = p;
    }
    if (!cart && scene.globe.show) {
      const ray = viewer.camera.getPickRay(pos);
      if (ray) cart = scene.globe.pick(ray, scene);
    }
    if (!cart) cart = viewer.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
    if (!cart) return null;
    const c = Cartographic.fromCartesian(cart);
    return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) };
  };

  const pickCell = (x: number, y: number): PickedCell | null => {
    const grid = getGrid();
    if (!grid) return null;
    const ll = pickLonLat(new Cartesian2(x, y));
    if (!ll) return null;
    const f = lonLatToCellFloat(grid, ll.lon, ll.lat);
    const row = Math.floor(f.y);
    const col = Math.floor(f.x);
    if (!inGrid(grid, row, col)) return null;
    return { row, col, x: f.x, y: f.y, lon: ll.lon, lat: ll.lat };
  };

  const setCamera = (enabled: boolean): void => {
    controller.enableRotate = enabled;
    controller.enableTranslate = enabled;
    controller.enableTilt = enabled;
    controller.enableLook = enabled;
  };

  handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
    if (!enabled || dragMode) return;
    const cell = pickCell(e.position.x, e.position.y);
    if (cell) h.onClick(cell);
    else h.onOutside?.();
  }, ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
    if (!enabled || !dragMode) return;
    const cell = pickCell(e.position.x, e.position.y);
    if (!cell) {
      h.onOutside?.();
      return;
    }
    dragging = true;
    lastKey = cell.row * 100000 + cell.col;
    setCamera(false);
    h.onDragStart(cell);
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
    if (!dragging) return;
    const cell = pickCell(e.endPosition.x, e.endPosition.y);
    if (!cell) return;
    const key = cell.row * 100000 + cell.col;
    if (key === lastKey) return;
    lastKey = key;
    h.onDragMove(cell);
  }, ScreenSpaceEventType.MOUSE_MOVE);

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    setCamera(true);
    h.onDragEnd();
  };
  handler.setInputAction(endDrag, ScreenSpaceEventType.LEFT_UP);
  viewer.scene.canvas.addEventListener('pointerleave', endDrag);

  return {
    setDragMode(on) {
      dragMode = on;
      if (!on) endDrag();
    },
    setEnabled(on) {
      enabled = on;
      if (!on) endDrag();
    },
    pickCell,
    destroy() {
      endDrag();
      viewer.scene.canvas.removeEventListener('pointerleave', endDrag);
      handler.destroy();
    },
  };
}
