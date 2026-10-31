/**
 * Grid outline and corner markers. Used by the alignment spike and as a debug toggle: the four
 * labelled points must sit exactly on the corners of the burn overlay.
 */

import { Cartesian2, Cartesian3, Color, Entity, LabelStyle, VerticalOrigin } from 'cesium';
import type { Viewer } from 'cesium';
import type { GridSpec } from '../contract';

export interface GridOutline {
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function createGridOutline(viewer: Viewer, grid: GridSpec): GridOutline {
  const b = grid.bounds;
  const corners: [string, number, number][] = [
    ['NW (0,0)', b.west, b.north],
    [`NE (0,${grid.width - 1})`, b.east, b.north],
    [`SW (${grid.height - 1},0)`, b.west, b.south],
    [`SE (${grid.height - 1},${grid.width - 1})`, b.east, b.south],
  ];
  const entities: Entity[] = [];
  for (const [text, lon, lat] of corners) {
    entities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat),
        point: { pixelSize: 9, color: Color.CYAN, outlineColor: Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text,
          font: '13px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
  }
  entities.push(
    viewer.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArray([b.west, b.north, b.east, b.north, b.east, b.south, b.west, b.south, b.west, b.north]),
        width: 2,
        material: Color.CYAN,
        clampToGround: true,
      },
    }),
  );
  return {
    setVisible(visible) {
      for (const e of entities) e.show = visible;
    },
    destroy() {
      for (const e of entities) viewer.entities.remove(e);
    },
  };
}
