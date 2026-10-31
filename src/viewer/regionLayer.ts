/**
 * Fire regions (convex hulls of linked detections) as one batched GroundPrimitive draped on the
 * globe, coloured by the region's latest detection age. A second, brighter primitive marks the
 * selected region. Clicks on a region report its id; clicks elsewhere are ignored here (the
 * hotspot layer owns the "clicked nothing" case).
 */

import {
  Cartesian3,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPrimitive,
  PolygonGeometry,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium';
import type { Viewer } from 'cesium';
import { colorForAgeHours } from './hotspotLayer';

/** Structural subset of data/firms FireRegion. */
export interface RegionShape {
  id: string;
  /** [lon, lat] ring. */
  hull: [number, number][];
  latestAt: number;
}

export interface RegionLayer {
  set(regions: RegionShape[], nowMs?: number): void;
  setVisible(visible: boolean): void;
  setSelected(id: string | null): void;
  destroy(): void;
}

const FILL_ALPHA = 0.35;
const SELECTED_ALPHA = 0.6;

function instanceFor(r: RegionShape, nowMs: number, alpha: number): GeometryInstance | null {
  if (r.hull.length < 3) return null;
  const flat: number[] = [];
  for (const [lon, lat] of r.hull) flat.push(lon, lat);
  const color = colorForAgeHours((nowMs - r.latestAt) / 3_600_000).withAlpha(alpha);
  return new GeometryInstance({
    id: r.id,
    geometry: PolygonGeometry.fromPositions({ positions: Cartesian3.fromDegreesArray(flat) }),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
  });
}

export function createRegionLayer(viewer: Viewer, onPick: (id: string) => void): RegionLayer {
  const scene = viewer.scene;
  const supported = GroundPrimitive.isSupported(scene);
  let primitive: GroundPrimitive | null = null;
  let highlight: GroundPrimitive | null = null;
  let visible = false;
  let shapes = new Map<string, RegionShape>();
  let lastNow = Date.now();

  const handler = new ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
    if (!visible || !primitive) return;
    const picked = scene.pick(e.position) as { primitive?: unknown; id?: unknown } | undefined;
    if (picked && (picked.primitive === primitive || picked.primitive === highlight) && typeof picked.id === 'string') onPick(picked.id);
  }, ScreenSpaceEventType.LEFT_CLICK);

  const dropHighlight = (): void => {
    if (highlight) {
      scene.primitives.remove(highlight);
      highlight = null;
    }
  };

  return {
    set(regions, nowMs = Date.now()) {
      lastNow = nowMs;
      dropHighlight();
      if (primitive) {
        scene.primitives.remove(primitive);
        primitive = null;
      }
      shapes = new Map(regions.map((r) => [r.id, r]));
      if (!supported || regions.length === 0) return;
      const instances: GeometryInstance[] = [];
      for (const r of regions) {
        const inst = instanceFor(r, nowMs, FILL_ALPHA);
        if (inst) instances.push(inst);
      }
      if (instances.length === 0) return;
      primitive = scene.primitives.add(new GroundPrimitive({ geometryInstances: instances, show: visible })) as GroundPrimitive;
    },
    setVisible(v) {
      visible = v;
      if (primitive) primitive.show = v;
      if (highlight) highlight.show = v;
    },
    setSelected(id) {
      dropHighlight();
      if (!id || !supported) return;
      const r = shapes.get(id);
      if (!r) return;
      const inst = instanceFor(r, lastNow, SELECTED_ALPHA);
      if (!inst) return;
      highlight = scene.primitives.add(new GroundPrimitive({ geometryInstances: inst, show: visible })) as GroundPrimitive;
    },
    destroy() {
      handler.destroy();
      dropHighlight();
      if (primitive) scene.primitives.remove(primitive);
      primitive = null;
      shapes.clear();
    },
  };
}
