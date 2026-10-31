/**
 * Satellite fire detections (NASA FIRMS) as a PointPrimitiveCollection: one point per detection,
 * coloured by age and sized by fire radiative power. Points sit a little above the ellipsoid so
 * they never z-fight the globe; the globe itself hides the far hemisphere. Picking uses a
 * dedicated left-click handler and reports the detection id.
 */

import { Cartesian3, Color, NearFarScalar, PointPrimitiveCollection, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { PointPrimitive, Viewer } from 'cesium';

/** Structural subset of data/firms Hotspot so this module stays free of data imports. */
export interface HotspotPoint {
  id: string;
  lon: number;
  lat: number;
  /** Fire radiative power, MW. */
  frp: number;
  /** Epoch ms UTC. */
  acquiredAt: number;
}

export interface HotspotLayer {
  /** Replaces all points. `nowMs` drives the age colouring. */
  set(points: HotspotPoint[], nowMs?: number): void;
  setVisible(visible: boolean): void;
  setSelected(id: string | null): void;
  destroy(): void;
}

/** Metres above the ellipsoid; far above log-depth resolution at globe range, invisible up close. */
const LIFT_M = 300;
const MAX_AGE_H = 72;
/** Colour stops: hours since detection -> colour. */
const AGE_STOPS: [number, string][] = [
  [0, '#fff6a0'],
  [6, '#ffb347'],
  [24, '#ff4a1a'],
  [MAX_AGE_H, '#6e0b0b'],
];

/** One colour per whole hour, precomputed so 50k points share instances. */
const AGE_LUT: Color[] = (() => {
  const stops = AGE_STOPS.map(([h, css]) => [h, Color.fromCssColorString(css)] as const);
  const lut: Color[] = [];
  for (let h = 0; h <= MAX_AGE_H; h++) {
    let k = 0;
    while (k < stops.length - 2 && h > stops[k + 1][0]) k++;
    const [h0, c0] = stops[k];
    const [h1, c1] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
    lut.push(Color.lerp(c0, c1, t, new Color()));
  }
  return lut;
})();

export function colorForAgeHours(hours: number): Color {
  const h = Number.isFinite(hours) ? Math.min(MAX_AGE_H, Math.max(0, Math.round(hours))) : MAX_AGE_H;
  return AGE_LUT[h];
}

export function pixelSizeForFrp(frp: number): number {
  const s = 4 + Math.sqrt(Math.max(0, frp)) * 0.6;
  return Math.min(14, Math.max(4, s));
}

const OUTLINE = Color.BLACK.withAlpha(0.6);
const SELECTED_OUTLINE = Color.WHITE;

export function createHotspotLayer(viewer: Viewer, onPick: (id: string | null) => void): HotspotLayer {
  const scene = viewer.scene;
  const collection = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
  collection.show = false;
  const byId = new Map<string, { point: PointPrimitive; size: number }>();
  let selected: { point: PointPrimitive; size: number } | null = null;
  const scale = new NearFarScalar(2.0e5, 1.0, 1.5e7, 0.6);

  const handler = new ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
    if (!collection.show) return;
    const picked = scene.pick(e.position, 6, 6) as { collection?: unknown; id?: unknown; primitive?: { id?: unknown } } | undefined;
    if (picked && picked.collection === collection && typeof picked.id === 'string') onPick(picked.id);
    else if (picked?.primitive && typeof picked.primitive.id === 'string' && byId.has(picked.primitive.id)) onPick(picked.primitive.id);
    else if (!picked) onPick(null); // clicked empty globe: clear; hits on other layers are theirs to handle
  }, ScreenSpaceEventType.LEFT_CLICK);

  const restore = (): void => {
    if (!selected) return;
    selected.point.outlineColor = OUTLINE;
    selected.point.outlineWidth = 1;
    selected.point.pixelSize = selected.size;
    selected = null;
  };

  return {
    set(points, nowMs = Date.now()) {
      selected = null;
      collection.removeAll();
      byId.clear();
      for (const p of points) {
        const size = pixelSizeForFrp(p.frp);
        const point = collection.add({
          id: p.id,
          position: Cartesian3.fromDegrees(p.lon, p.lat, LIFT_M),
          pixelSize: size,
          color: colorForAgeHours((nowMs - p.acquiredAt) / 3_600_000),
          outlineColor: OUTLINE,
          outlineWidth: 1,
          scaleByDistance: scale,
        });
        byId.set(p.id, { point, size });
      }
    },
    setVisible(visible) {
      collection.show = visible;
    },
    setSelected(id) {
      restore();
      if (!id) return;
      const entry = byId.get(id);
      if (!entry) return;
      selected = entry;
      entry.point.outlineColor = SELECTED_OUTLINE;
      entry.point.outlineWidth = 2;
      entry.point.pixelSize = entry.size + 6;
    },
    destroy() {
      handler.destroy();
      scene.primitives.remove(collection);
      byId.clear();
    },
  };
}
