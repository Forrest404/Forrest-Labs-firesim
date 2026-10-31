/**
 * A real fire's final perimeter, for comparing a run: a line draped on the terrain plus a
 * translucent glowing wall standing on it, so the real edge reads from any 3D angle, including
 * the ground view.
 */

import { Cartesian3, Color, ColorMaterialProperty } from 'cesium';
import type { Entity, Viewer } from 'cesium';

export interface ReferenceOutline {
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface ReferenceOutlineOptions {
  /** Ground height in metres at a point (3D tiles); omit on the flat fallback globe. */
  groundAt?: (lon: number, lat: number) => number;
}

const CYAN = Color.fromCssColorString('#22d3ee');
const WALL_HEIGHT_M = 40;
/** Wall vertices are thinned to about this many per ring; the draped line keeps every point. */
const WALL_POINTS = 400;

export function createReferenceOutline(viewer: Viewer, rings: [number, number][][], o: ReferenceOutlineOptions = {}): ReferenceOutline {
  const entities: Entity[] = [];
  for (const ring of rings.filter((r) => r.length >= 2)) {
    entities.push(viewer.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArray(ring.flat()),
        clampToGround: true,
        width: 4,
        // Cyan reads on both the light OSM globe and dark burn/satellite imagery.
        material: CYAN,
      },
    }));
    if (ring.length < 4) continue;
    const step = Math.max(1, Math.floor(ring.length / WALL_POINTS));
    const pts = ring.filter((_, i) => i % step === 0);
    pts.push(ring[ring.length - 1]);
    const ground = pts.map(([lon, lat]) => o.groundAt?.(lon, lat) ?? 0);
    entities.push(viewer.entities.add({
      wall: {
        positions: Cartesian3.fromDegreesArrayHeights(pts.flatMap(([lon, lat], i) => [lon, lat, ground[i] + WALL_HEIGHT_M])),
        minimumHeights: ground,
        material: new ColorMaterialProperty(CYAN.withAlpha(0.22)),
        outline: true,
        outlineColor: CYAN.withAlpha(0.9),
      },
    }));
  }
  return {
    setVisible: (visible) => {
      for (const e of entities) e.show = visible;
    },
    destroy: () => {
      for (const e of entities) viewer.entities.remove(e);
    },
  };
}
