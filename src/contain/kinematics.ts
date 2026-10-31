/**
 * Where each responding unit is at simulated time t, derived from its orders. Pure; drives the
 * 3D unit markers and the dispatch HUD. Adapted from PR #4's computeOrderKinematicsAtTime.
 */

import type { GridSpec } from '../contract';
import { cellCenterLonLat } from '../data/geo';
import type { Order } from './planner';
import { UNITS } from './units';

export type UnitPhase = 'standby' | 'transit' | 'working' | 'shuttle' | 'completed';

export interface UnitKinematics {
  orderId: string;
  phase: UnitPhase;
  /** False when another order of the same unit is the current one at t. */
  visible: boolean;
  lon: number;
  lat: number;
  altitudeM: number;
  /** 0-1 through the current phase. */
  progress: number;
  /** Lon/lat polyline of the line built so far. */
  activeLonLats: [number, number][];
  status: string;
}

export function interpolatePolyline(waypoints: [number, number][], u: number): [number, number] {
  if (waypoints.length === 0) return [0, 0];
  if (waypoints.length === 1 || u <= 0) return waypoints[0];
  if (u >= 1) return waypoints[waypoints.length - 1];
  const scaled = u * (waypoints.length - 1);
  const idx = Math.min(waypoints.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const [lon1, lat1] = waypoints[idx];
  const [lon2, lat2] = waypoints[idx + 1];
  return [lon1 + (lon2 - lon1) * frac, lat1 + (lat2 - lat1) * frac];
}

export function strokeLonLats(order: Order, grid: GridSpec, samples = 16): [number, number][] {
  if (order.strokePoints.length === 0) return [];
  const raw = order.strokePoints.map(([col, row]) => {
    const p = cellCenterLonLat(grid, Math.round(row), Math.round(col));
    return [p.lon, p.lat] as [number, number];
  });
  if (raw.length === 1) return raw;
  const out: [number, number][] = [];
  for (let i = 0; i <= samples; i++) out.push(interpolatePolyline(raw, i / samples));
  return out;
}

/** The order a unit is on at time t: the latest one dispatched, or its first while waiting. */
export function currentOrderId(unitId: string, orders: Order[], t: number): string | null {
  const mine = orders.filter((o) => o.unitId === unitId).sort((a, b) => a.dispatchTimeSeconds - b.dispatchTimeSeconds);
  if (mine.length === 0) return null;
  let cur = mine[0];
  for (const o of mine) if (o.dispatchTimeSeconds <= t) cur = o;
  return cur.id;
}

export function unitKinematicsAt(order: Order, allOrders: Order[], grid: GridSpec, t: number): UnitKinematics {
  const u = UNITS[order.unitType];
  const visible = currentOrderId(order.unitId, allOrders, t) === order.id;
  const stroke = strokeLonLats(order, grid);
  const groundAlt = 2;
  const cruiseAlt = u.type === 'helicopter' ? 150 : 350;
  const endT = order.etaSeconds + order.executionDurationSeconds;
  const base = { orderId: order.id, visible };

  if (t < order.dispatchTimeSeconds) {
    const [lon, lat] = order.routeWaypointsLonLat[0] ?? [order.sourceLonLat.lon, order.sourceLonLat.lat];
    return { ...base, phase: 'standby', lon, lat, altitudeM: groundAlt, progress: 0, activeLonLats: [], status: 'Standby' };
  }
  if (t < order.etaSeconds) {
    const span = Math.max(1, order.etaSeconds - order.dispatchTimeSeconds);
    const p = Math.max(0, Math.min(1, (t - order.dispatchTimeSeconds) / span));
    const [lon, lat] = interpolatePolyline(order.routeWaypointsLonLat, p);
    const alt = u.airborne ? 20 + Math.sin(p * Math.PI) * cruiseAlt : groundAlt;
    return { ...base, phase: 'transit', lon, lat, altitudeM: alt, progress: p, activeLonLats: [], status: `En route · ${Math.round(p * 100)}%` };
  }
  if (t <= endT) {
    if (u.airborne && order.drops > 1) {
      // Drop runs separated by reload shuttles back toward the base.
      const cycle = Math.max(1, u.turnaroundS);
      const k = Math.min(order.drops - 1, Math.floor((t - order.etaSeconds) / cycle));
      const phaseU = ((t - order.etaSeconds) % cycle) / cycle;
      const seg = 1 / order.drops;
      const a = k * seg;
      const b = (k + 1) * seg;
      if (phaseU < 0.15) {
        const p = phaseU / 0.15;
        const [lon, lat] = interpolatePolyline(stroke, a + (b - a) * p);
        return { ...base, phase: 'working', lon, lat, altitudeM: 60, progress: (k + p) / order.drops, activeLonLats: stroke.slice(0, Math.max(2, Math.ceil((a + (b - a) * p) * stroke.length))), status: `Drop ${k + 1} of ${order.drops}` };
      }
      const s = (phaseU - 0.15) / 0.85;
      const out = s < 0.5 ? s / 0.5 : 1 - (s - 0.5) / 0.5;
      const [dLon, dLat] = interpolatePolyline(stroke, b);
      const lon = dLon + (order.sourceLonLat.lon - dLon) * out;
      const lat = dLat + (order.sourceLonLat.lat - dLat) * out;
      return { ...base, phase: 'shuttle', lon, lat, altitudeM: 40 + Math.sin(out * Math.PI) * cruiseAlt, progress: (k + 1) / order.drops, activeLonLats: stroke.slice(0, Math.max(2, Math.ceil(b * stroke.length))), status: s < 0.5 ? 'Returning to reload' : 'Inbound with load' };
    }
    const span = Math.max(1, order.executionDurationSeconds);
    const p = Math.max(0, Math.min(1, (t - order.etaSeconds) / span));
    const [lon, lat] = interpolatePolyline(stroke, p);
    const count = Math.max(2, Math.ceil(p * stroke.length));
    const active = stroke.slice(0, count);
    if (active.length >= 2) active[active.length - 1] = [lon, lat];
    const verb = u.tactic === 'wetline' ? 'Laying wet line' : u.tactic === 'bucket' || u.tactic === 'retardant' ? 'Dropping' : 'Building line';
    return { ...base, phase: 'working', lon, lat, altitudeM: u.airborne ? 60 : groundAlt, progress: p, activeLonLats: active, status: `${verb} · ${Math.round(p * 100)}%` };
  }
  const [lon, lat] = stroke[stroke.length - 1] ?? [order.dropCenterLonLat.lon, order.dropCenterLonLat.lat];
  return { ...base, phase: 'completed', lon, lat, altitudeM: u.airborne ? 40 : groundAlt, progress: 1, activeLonLats: stroke, status: u.airborne ? 'Sortie complete' : 'Line complete · holding' };
}
