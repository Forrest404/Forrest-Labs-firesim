/** The ignition point marker. */

import { Cartesian2, Cartesian3, Color, HeightReference, LabelStyle, VerticalOrigin } from 'cesium';
import type { Entity, Viewer } from 'cesium';
import type { CellRef, GridSpec } from '../contract';
import { cellCenterLonLat } from '../data/geo';

export interface IgnitionMarker {
  set(grid: GridSpec, cell: CellRef | null): void;
  destroy(): void;
}

export function createIgnitionMarker(viewer: Viewer, label: string): IgnitionMarker {
  const entity: Entity = viewer.entities.add({
    show: false,
    position: Cartesian3.fromDegrees(0, 0),
    point: {
      pixelSize: 12,
      color: Color.fromCssColorString('#ff7a1a'),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: label,
      font: '13px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -14),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  return {
    set(grid, cell) {
      if (!cell) {
        entity.show = false;
        return;
      }
      const { lon, lat } = cellCenterLonLat(grid, cell.row, cell.col);
      entity.position = Cartesian3.fromDegrees(lon, lat) as unknown as Entity['position'];
      entity.show = true;
    },
    destroy() {
      viewer.entities.remove(entity);
    },
  };
}
