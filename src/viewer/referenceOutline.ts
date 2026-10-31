/** Outline of a real fire's final perimeter, draped on the terrain, for comparing a run. */

import { Cartesian3, Color } from 'cesium';
import type { Entity, Viewer } from 'cesium';

export interface ReferenceOutline {
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function createReferenceOutline(viewer: Viewer, rings: [number, number][][]): ReferenceOutline {
  const entities: Entity[] = rings
    .filter((ring) => ring.length >= 2)
    .map((ring) =>
      viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray(ring.flat()),
          clampToGround: true,
          width: 3,
          material: Color.WHITE.withAlpha(0.9),
        },
      }),
    );
  return {
    setVisible: (visible) => {
      for (const e of entities) e.show = visible;
    },
    destroy: () => {
      for (const e of entities) viewer.entities.remove(e);
    },
  };
}
