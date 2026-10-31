/**
 * Responding units in 3D: one marker per order (coloured by unit type, labelled with its live
 * status) and the line it has built so far. Positions come from src/contain/kinematics.ts as a
 * pure function of playback time, so scrubbing works. Entities only; nothing here touches state.
 */

import { Cartesian2, Cartesian3, Color, ConstantProperty, HeightReference, LabelStyle, VerticalOrigin } from 'cesium';
import type { Entity, Viewer } from 'cesium';
import type { GridSpec } from '../contract';
import { UNITS, unitKinematicsAt } from '../contain';
import type { Order, UnitType } from '../contain';

export interface DispatchOverlay {
  setOrders(grid: GridSpec | null, orders: Order[]): void;
  setVisible(visible: boolean): void;
  updateTime(t: number): void;
  destroy(): void;
}

export const UNIT_COLOR: Record<UnitType, string> = {
  handcrew: '#ffd166',
  engine: '#ff7a1a',
  dozer: '#d4a373',
  helicopter: '#38bdf8',
  airtanker: '#f43f5e',
};

interface Marker {
  order: Order;
  point: Entity;
  line: Entity;
  lastCount: number;
  lastStatus: string;
}

export function createDispatchOverlay(viewer: Viewer): DispatchOverlay {
  let grid: GridSpec | null = null;
  let orders: Order[] = [];
  let markers: Marker[] = [];
  let visible = true;
  let lastT = 0;

  function clear(): void {
    for (const m of markers) {
      viewer.entities.remove(m.point);
      viewer.entities.remove(m.line);
    }
    markers = [];
  }

  function build(): void {
    clear();
    if (!grid) return;
    for (const order of orders) {
      const u = UNITS[order.unitType];
      const color = Color.fromCssColorString(UNIT_COLOR[order.unitType]);
      const heightReference = u.airborne ? HeightReference.RELATIVE_TO_GROUND : HeightReference.CLAMP_TO_GROUND;
      const point = viewer.entities.add({
        show: false,
        position: Cartesian3.fromDegrees(order.sourceLonLat.lon, order.sourceLonLat.lat, 0),
        point: {
          pixelSize: u.airborne ? 11 : 10,
          color,
          outlineColor: Color.BLACK.withAlpha(0.8),
          outlineWidth: 2,
          heightReference,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: order.unitName,
          font: '12px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -12),
          heightReference,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: Color.BLACK.withAlpha(0.45),
          backgroundPadding: new Cartesian2(5, 3),
        },
      });
      const water = order.tactic === 'wetline' || order.tactic === 'bucket' || order.tactic === 'retardant';
      const line = viewer.entities.add({
        show: false,
        polyline: {
          positions: new ConstantProperty([]),
          width: 3,
          material: water ? Color.fromCssColorString('#4aa3ff').withAlpha(0.9) : Color.fromCssColorString('#f1f1f1').withAlpha(0.9),
          clampToGround: true,
        },
      });
      markers.push({ order, point, line, lastCount: -1, lastStatus: '' });
    }
    update(lastT);
  }

  function update(t: number): void {
    lastT = t;
    if (!grid) return;
    for (const m of markers) {
      const k = unitKinematicsAt(m.order, orders, grid, t);
      const u = UNITS[m.order.unitType];
      const show = visible && k.visible;
      m.point.show = show;
      if (show) {
        m.point.position = Cartesian3.fromDegrees(k.lon, k.lat, u.airborne ? k.altitudeM : 0) as unknown as Entity['position'];
        // Finished units keep their dot but lose the label, or a busy fire reads as a wall of text.
        const status = k.phase === 'completed' ? '' : `${m.order.unitName}\n${k.status}`;
        if (status !== m.lastStatus) {
          m.lastStatus = status;
          if (m.point.label) {
            m.point.label.text = new ConstantProperty(status);
            m.point.label.show = new ConstantProperty(status !== '');
          }
        }
      }
      const pts = k.activeLonLats;
      const showLine = visible && pts.length >= 2 && (k.phase === 'working' || k.phase === 'shuttle' || k.phase === 'completed');
      m.line.show = showLine;
      if (showLine && (pts.length !== m.lastCount || k.phase === 'working')) {
        m.lastCount = pts.length;
        const flat: number[] = [];
        for (const [lon, lat] of pts) flat.push(lon, lat);
        if (m.line.polyline) m.line.polyline.positions = new ConstantProperty(Cartesian3.fromDegreesArray(flat));
      }
    }
  }

  return {
    setOrders(g, o) {
      grid = g;
      orders = o;
      build();
    },
    setVisible(v) {
      visible = v;
      update(lastT);
    },
    updateTime: update,
    destroy: clear,
  };
}
