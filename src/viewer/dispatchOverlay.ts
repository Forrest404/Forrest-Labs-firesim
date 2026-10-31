/**
 * AGENT 4 (Part 1) — Time-Synchronized 3D Cesium Globe Visualizer for Fire Stations,
 * River Dip Sites, Animated Vehicle Icons (Helicopter, Airtanker, Fire Engine),
 * Progressive Water Spray / Fire Break Swath Drawing, and Helicopter Dip-Site Shuttle Loops.
 */

import {
  BoundingSphere,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  HeadingPitchRange,
  HeightReference,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  PolylineDashMaterialProperty,
  VerticalOrigin,
} from 'cesium';
import type { Entity, Viewer } from 'cesium';
import type { GridSpec } from '../contract';
import { cellCenterLonLat, lonLatToCellFloat } from '../data/geo';
import { computeOrderKinematicsAtTime } from '../agent/optimizer';
import type {
  AgentDispatchOrder,
  DipSite,
  FireStationAsset,
  TacticType,
  UnitType,
} from '../agent/types';

export interface DispatchOverlay {
  setStationsAndDipSite(stations: FireStationAsset[], dipSite: DipSite | null): void;
  setOrders(
    grid: GridSpec | null,
    orders: AgentDispatchOrder[],
    highlightedOrderId: string | null,
    elevation?: Float32Array | null,
    useElevation?: boolean,
  ): void;
  setHighlightedOrder(highlightedOrderId: string | null): void;
  updateTime(currentTimeS: number): void;
  flyToOrder(order: AgentDispatchOrder): void;
  flyToActiveUnit(orderId: string, currentTimeS: number): void;
  stopTracking(): void;
  getTrackedOrderId(): string | null;
  destroy(): void;
}

const UNIT_COLOR: Record<UnitType, string> = {
  engine: '#ff7a1a',     // Tactical Amber
  helicopter: '#38bdf8', // Aerial Cyan
  airtanker: '#f43f5e',  // Heavy Tanker Coral-Red
};

const TACTIC_COLOR: Record<TacticType, string> = {
  water: '#38bdf8',      // Retardant / Water Spray Cyan
  firebreak: '#f59e0b',  // Cleared-Earth Firebreak Amber-Gold
};

function formatEtaMin(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s > 0 ? ` ${s}s` : ''}`;
}

const iconCache = new Map<string, string>();

/**
 * Generates a crisp 48x48 canvas data-URI icon for a Helicopter, Airtanker, or Fire Engine/Dozer,
 * badged with its active tactic color (Cyan for Water Spray, Amber for Fire Break).
 */
function getUnitBillboardDataUrl(unitType: UnitType, tacticType: TacticType): string {
  const key = `${unitType}-${tacticType}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 52;
  canvas.height = 52;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = 26;
  const cy = 26;
  const primary = UNIT_COLOR[unitType];
  const tacticAccent = TACTIC_COLOR[tacticType];

  // Outer tactical ring
  ctx.beginPath();
  ctx.arc(cx, cy, 21, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12, 16, 23, 0.9)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = primary;
  ctx.stroke();

  // Inner tactic indicator arc
  ctx.beginPath();
  ctx.arc(cx, cy, 17, -Math.PI * 0.75, Math.PI * 0.75);
  ctx.lineWidth = 2;
  ctx.strokeStyle = tacticAccent;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;

  if (unitType === 'helicopter') {
    // Rotor disc circle + crossed blades + fuselage
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 10);
    ctx.lineTo(cx + 10, cy + 10);
    ctx.moveTo(cx + 10, cy - 10);
    ctx.lineTo(cx - 10, cy + 10);
    ctx.stroke();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (unitType === 'airtanker') {
    // Swept fixed-wing silhouette
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 3, cy - 3);
    ctx.lineTo(cx + 13, cy + 2);
    ctx.lineTo(cx + 13, cy + 5);
    ctx.lineTo(cx + 3, cy + 3);
    ctx.lineTo(cx + 2, cy + 9);
    ctx.lineTo(cx + 6, cy + 11);
    ctx.lineTo(cx - 6, cy + 11);
    ctx.lineTo(cx - 2, cy + 9);
    ctx.lineTo(cx - 3, cy + 3);
    ctx.lineTo(cx - 13, cy + 5);
    ctx.lineTo(cx - 13, cy + 2);
    ctx.lineTo(cx - 3, cy - 3);
    ctx.closePath();
    ctx.fill();
  } else {
    // Ground Fire Engine / Dozer Truck silhouette
    ctx.fillStyle = primary;
    ctx.fillRect(cx - 10, cy - 6, 14, 11);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx + 4, cy - 4, 6, 9);
    // Dozer blade or water cannon nozzle on front
    ctx.strokeStyle = tacticAccent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 7);
    ctx.lineTo(cx + 12, cy + 7);
    ctx.stroke();
    // Wheels
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(cx - 5, cy + 7, 3, 0, Math.PI * 2);
    ctx.arc(cx + 6, cy + 7, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const url = canvas.toDataURL();
  iconCache.set(key, url);
  return url;
}

/** Builds a 3D trajectory along ordered waypoints (`[[lon, lat], ...]`). */
function buildWaypointPositions(
  waypoints: [number, number][],
  peakHeightM: number,
  steps = 20,
  sampleElev?: (lon: number, lat: number) => number,
): Cartesian3[] {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) {
    const baseH = sampleElev ? sampleElev(waypoints[0][0], waypoints[0][1]) : 0;
    return [Cartesian3.fromDegrees(waypoints[0][0], waypoints[0][1], baseH + 15)];
  }
  const pts: Cartesian3[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const scaled = u * (waypoints.length - 1);
    const idx = Math.min(waypoints.length - 2, Math.floor(scaled));
    const frac = scaled - idx;
    const lon = waypoints[idx][0] + (waypoints[idx + 1][0] - waypoints[idx][0]) * frac;
    const lat = waypoints[idx][1] + (waypoints[idx + 1][1] - waypoints[idx][1]) * frac;
    const baseH = sampleElev ? sampleElev(lon, lat) : 0;
    const arcH = peakHeightM > 0 ? 20 + Math.sin(u * Math.PI) * peakHeightM : 14;
    pts.push(Cartesian3.fromDegrees(lon, lat, baseH + arcH));
  }
  return pts;
}

export function createDispatchOverlay(viewer: Viewer): DispatchOverlay {
  const stationEntities: Entity[] = [];
  const orderEntities: Entity[] = [];

  let currentGrid: GridSpec | null = null;
  let currentElevation: Float32Array | null = null;
  let currentUseElevation = false;
  let currentOrders: AgentDispatchOrder[] = [];
  let currentDipSite: DipSite | null = null;
  let currentHighlightedId: string | null = null;
  let trackedOrderId: string | null = null;
  let isFlyingToUnit = false;
  let lastTrackedCartesian: Cartesian3 | null = null;
  let currentTime = 0;

  function sampleSurfaceElevation(lon: number, lat: number): number {
    if (!currentUseElevation || !currentGrid || !currentElevation) return 0;
    const { x, y } = lonLatToCellFloat(currentGrid, lon, lat);
    const row = Math.max(0, Math.min(currentGrid.height - 1, Math.floor(y)));
    const col = Math.max(0, Math.min(currentGrid.width - 1, Math.floor(x)));
    return currentElevation[row * currentGrid.width + col] || 0;
  }

  function getUnitCartesian(order: AgentDispatchOrder, timeS: number): Cartesian3 {
    if (!currentGrid) {
      const baseH = sampleSurfaceElevation(order.dropCenterLonLat.lon, order.dropCenterLonLat.lat);
      return Cartesian3.fromDegrees(
        order.dropCenterLonLat.lon,
        order.dropCenterLonLat.lat,
        baseH + 35,
      );
    }
    const kin = computeOrderKinematicsAtTime(
      order,
      currentOrders,
      currentDipSite,
      currentGrid,
      timeS,
    );
    const baseH = sampleSurfaceElevation(kin.lon, kin.lat);
    return Cartesian3.fromDegrees(kin.lon, kin.lat, baseH + kin.altitudeM);
  }

  function clearStations(): void {
    for (const e of stationEntities) viewer.entities.remove(e);
    stationEntities.length = 0;
  }

  function clearOrders(): void {
    for (const e of orderEntities) viewer.entities.remove(e);
    orderEntities.length = 0;
  }

  function setStationsAndDipSite(stations: FireStationAsset[], dipSite: DipSite | null): void {
    clearStations();
    currentDipSite = dipSite;

    for (const stn of stations.slice(0, 5)) {
      const color = Color.fromCssColorString(UNIT_COLOR[stn.unitType]);
      const crewLabel = stn.crewPersona
        ? `${stn.crewPersona.crewLeadName} · ${stn.crewPersona.stationCallLabel}`
        : stn.name;
      const e = viewer.entities.add({
        position: Cartesian3.fromDegrees(stn.entryLonLat.lon, stn.entryLonLat.lat),
        point: {
          pixelSize: 10,
          color,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${crewLabel}\n(${stn.routeDistanceKm} km · ETA +${formatEtaMin(stn.travelTimeSeconds)})`,
          font: '11px monospace',
          fillColor: Color.fromCssColorString('#e8e8e8'),
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -12),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      stationEntities.push(e);
    }

    if (dipSite) {
      const dipEntity = viewer.entities.add({
        position: Cartesian3.fromDegrees(dipSite.lon, dipSite.lat),
        point: {
          pixelSize: 14,
          color: Color.fromCssColorString('#06b6d4'),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `◆ ${dipSite.label}\nHeli Refill Loop: ${formatEtaMin(dipSite.turnaroundSeconds)}`,
          font: 'bold 12px monospace',
          fillColor: Color.fromCssColorString('#67e8f9'),
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -15),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      stationEntities.push(dipEntity);
    }
  }

  function setOrders(
    grid: GridSpec | null,
    orders: AgentDispatchOrder[],
    highlightedOrderId: string | null,
    elevation: Float32Array | null = null,
    useElevation = false,
  ): void {
    clearOrders();
    currentGrid = grid;
    currentElevation = elevation;
    currentUseElevation = useElevation;
    currentOrders = orders;
    currentHighlightedId = highlightedOrderId;
    if (trackedOrderId && !orders.some((o) => o.id === trackedOrderId && o.enabled)) {
      trackedOrderId = null;
      lastTrackedCartesian = null;
    }
    if (!grid) return;

    for (const order of orders) {
      if (!order.enabled) continue;
      const tacticColorCss = TACTIC_COLOR[order.tacticType];
      const baseCss =
        order.sourceType === 'dip_site' ? '#06b6d4' : UNIT_COLOR[order.unit.unitType];
      const routeColor = Color.fromCssColorString(baseCss).withAlpha(0.75);

      const peakHeight =
        order.unit.unitType === 'engine'
          ? 0
          : order.unit.unitType === 'helicopter'
            ? order.wave === 2
              ? 165
              : 230
            : 380;

      // 1. 3D Dispatch Route Corridor (OSRM/curved road for engines, 3D parabolic flight arc for aircraft)
      const routePositions = buildWaypointPositions(
        order.routeWaypointsLonLat,
        peakHeight,
        20,
        sampleSurfaceElevation,
      );
      if (routePositions.length >= 2) {
        orderEntities.push(
          viewer.entities.add({
            polyline: {
              positions: routePositions,
              width: new CallbackProperty(
                () => (currentHighlightedId === order.id || trackedOrderId === order.id ? 4.2 : 2.4),
                false,
              ),
              clampToGround: order.unit.unitType === 'engine',
              material: new PolylineDashMaterialProperty({
                color: routeColor,
                dashLength: order.wave === 2 ? 12 : 18,
              }),
            },
          }),
        );
      }

      // If this is a Helicopter Wave 1 order and there is a Wave 2 dip-site shuttle, draw the shuttle return arc to the DipSite
      if (order.wave === 1 && order.unit.unitType === 'helicopter' && currentDipSite) {
        const hasW2 = orders.some(
          (o) => o.unit.id === order.unit.id && o.wave === 2 && o.enabled,
        );
        if (hasW2) {
          const lastCell = order.strokePoints[order.strokePoints.length - 1];
          const arcEnd = lastCell
            ? cellCenterLonLat(grid, lastCell[1], lastCell[0])
            : order.dropCenterLonLat;
          const shuttlePts = buildWaypointPositions(
            [
              [arcEnd.lon, arcEnd.lat],
              [currentDipSite.lon, currentDipSite.lat],
            ],
            140,
            14,
            sampleSurfaceElevation,
          );
          orderEntities.push(
            viewer.entities.add({
              polyline: {
                positions: shuttlePts,
                width: 2.0,
                material: new PolylineDashMaterialProperty({
                  color: Color.fromCssColorString('#22d3ee').withAlpha(0.55),
                  dashLength: 10,
                }),
              },
            }),
          );
        }
      }

      // 2. Planned Target Swath Ghost Preview (faint dashed outline prior to arrival)
      const fullSwathLonLats: number[] = [];
      for (const [col, row] of order.strokePoints) {
        const pt = cellCenterLonLat(grid, row, col);
        fullSwathLonLats.push(pt.lon, pt.lat);
      }
      if (fullSwathLonLats.length >= 4) {
        orderEntities.push(
          viewer.entities.add({
            polyline: {
              positions: Cartesian3.fromDegreesArray(fullSwathLonLats),
              width: new CallbackProperty(
                () => (currentHighlightedId === order.id || trackedOrderId === order.id ? 6 : 4),
                false,
              ),
              clampToGround: true,
              material: new PolylineDashMaterialProperty({
                color: Color.fromCssColorString(tacticColorCss).withAlpha(0.32),
                dashLength: 10,
              }),
            },
          }),
        );

        // 3. Progressively Drawn Active Tactic Swath (grows dynamically as unit traverses the arc!)
        const activeSwathProperty = new CallbackProperty(() => {
          if (!currentGrid) return [];
          const kin = computeOrderKinematicsAtTime(
            order,
            currentOrders,
            currentDipSite,
            currentGrid,
            currentTime,
          );
          if (kin.activeSwathLonLats.length < 2) return [];
          const flat: number[] = [];
          for (const [lon, lat] of kin.activeSwathLonLats) {
            flat.push(lon, lat);
          }
          return Cartesian3.fromDegreesArray(flat);
        }, false);

        orderEntities.push(
          viewer.entities.add({
            polyline: {
              positions: activeSwathProperty,
              width: new CallbackProperty(
                () => (currentHighlightedId === order.id || trackedOrderId === order.id ? 14 : 10),
                false,
              ),
              clampToGround: true,
              material: Color.fromCssColorString(tacticColorCss).withAlpha(
                order.tacticType === 'firebreak' ? 0.92 : 0.85,
              ),
            },
          }),
        );
      }

      // 4. Target Sector Static Callout Marker
      const tacticBadge = order.tacticType === 'firebreak' ? 'FIRE BREAK' : 'WATER SPRAY';
      const waveTag =
        order.wave === 2 && order.sourceType === 'dip_site' ? 'W2 DIP' : `W${order.wave}`;

      orderEntities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(order.dropCenterLonLat.lon, order.dropCenterLonLat.lat),
          point: {
            pixelSize: new CallbackProperty(
              () => (currentHighlightedId === order.id || trackedOrderId === order.id ? 11 : 8),
              false,
            ),
            color: Color.fromCssColorString(tacticColorCss),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${waveTag} [${tacticBadge}] · ${order.sectorLabel}\nETA +${formatEtaMin(order.etaSeconds)} · -${order.marginalSavedHa.toFixed(1)} ha`,
            font: '10.5px monospace',
            fillColor:
              order.tacticType === 'firebreak'
                ? Color.fromCssColorString('#fde68a')
                : Color.fromCssColorString('#bae6fd'),
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -12),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );

      // 5. Animated 3D Vehicle Icon (Helicopter, Airtanker, or Fire Engine/Dozer)
      const billboardUrl = getUnitBillboardDataUrl(order.unit.unitType, order.tacticType);
      const dynamicPosition = new CallbackPositionProperty(() => {
        return getUnitCartesian(order, currentTime);
      }, false);

      const dynamicShow = new CallbackProperty(() => {
        if (!currentGrid) return false;
        const kin = computeOrderKinematicsAtTime(
          order,
          currentOrders,
          currentDipSite,
          currentGrid,
          currentTime,
        );
        return kin.visible || trackedOrderId === order.id;
      }, false);

      const dynamicLabelText = new CallbackProperty(() => {
        if (!currentGrid) return order.crewPersona.callsign;
        const kin = computeOrderKinematicsAtTime(
          order,
          currentOrders,
          currentDipSite,
          currentGrid,
          currentTime,
        );
        const trackPrefix = trackedOrderId === order.id ? '🎯 TRACKING · ' : '';
        return `${trackPrefix}${order.crewPersona.crewLeadName} (${order.crewPersona.callsign})\n${kin.statusBadge}`;
      }, false);

      const dynamicRingSize = new CallbackProperty(() => {
        if (!currentGrid) return 0;
        const kin = computeOrderKinematicsAtTime(
          order,
          currentOrders,
          currentDipSite,
          currentGrid,
          currentTime,
        );
        if (
          trackedOrderId === order.id ||
          kin.phase === 'executing_tactic' ||
          kin.phase === 'dip_refill'
        ) {
          const pulse = 20 + Math.sin(currentTime * 0.25) * 6;
          return pulse;
        }
        return 8;
      }, false);

      const dynamicBillboardSize = new CallbackProperty(
        () => (currentHighlightedId === order.id || trackedOrderId === order.id ? 40 : 32),
        false,
      );

      orderEntities.push(
        viewer.entities.add({
          position: dynamicPosition,
          billboard: billboardUrl
            ? {
                image: billboardUrl,
                show: dynamicShow,
                width: dynamicBillboardSize,
                height: dynamicBillboardSize,
                verticalOrigin: VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              }
            : undefined,
          point: {
            show: dynamicShow,
            pixelSize: dynamicRingSize,
            color: Color.fromCssColorString(tacticColorCss).withAlpha(0.55),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            show: dynamicShow,
            text: dynamicLabelText,
            font: 'bold 11px monospace',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.TOP,
            pixelOffset: new Cartesian2(0, 20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
  }

  function setHighlightedOrder(highlightedOrderId: string | null): void {
    if (currentHighlightedId === highlightedOrderId) return;
    currentHighlightedId = highlightedOrderId;
    viewer.scene.requestRender();
  }

  function updateTime(currentTimeS: number): void {
    currentTime = currentTimeS;
    if (trackedOrderId && !isFlyingToUnit) {
      const order = currentOrders.find((o) => o.id === trackedOrderId && o.enabled);
      if (order && currentGrid) {
        const unitCartesian = getUnitCartesian(order, currentTimeS);
        const prevTarget = lastTrackedCartesian ?? unitCartesian;
        const rawDist = Cartesian3.distance(viewer.camera.positionWC, prevTarget);
        const range = Number.isFinite(rawDist) ? Math.max(280, Math.min(3500, rawDist)) : 950;
        const heading = viewer.camera.heading;
        const pitch = Math.min(-0.22, viewer.camera.pitch);
        viewer.camera.lookAt(unitCartesian, new HeadingPitchRange(heading, pitch, range));
        viewer.camera.lookAtTransform(Matrix4.IDENTITY);
        lastTrackedCartesian = unitCartesian;
      }
    }
    viewer.scene.requestRender();
  }

  function flyToOrder(order: AgentDispatchOrder): void {
    const baseH = sampleSurfaceElevation(order.dropCenterLonLat.lon, order.dropCenterLonLat.lat);
    const target = Cartesian3.fromDegrees(
      order.dropCenterLonLat.lon,
      order.dropCenterLonLat.lat,
      baseH + 40,
    );
    viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 90), {
      duration: 0.95,
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-38), 1300),
    });
  }

  function flyToActiveUnit(orderId: string, currentTimeS: number): void {
    const order = currentOrders.find((o) => o.id === orderId);
    if (!order) return;
    currentTime = currentTimeS;
    trackedOrderId = orderId;
    if (!currentGrid) {
      flyToOrder(order);
      return;
    }
    const unitCartesian = getUnitCartesian(order, currentTimeS);
    lastTrackedCartesian = unitCartesian;
    isFlyingToUnit = true;
    const defaultRange = order.unit.unitType === 'engine' ? 780 : 1080;
    viewer.camera.flyToBoundingSphere(new BoundingSphere(unitCartesian, 60), {
      duration: 0.85,
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), defaultRange),
      complete: () => {
        isFlyingToUnit = false;
        lastTrackedCartesian = getUnitCartesian(order, currentTime);
      },
      cancel: () => {
        isFlyingToUnit = false;
      },
    });
    viewer.scene.requestRender();
  }

  function stopTracking(): void {
    trackedOrderId = null;
    isFlyingToUnit = false;
    lastTrackedCartesian = null;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }

  return {
    setStationsAndDipSite,
    setOrders,
    setHighlightedOrder,
    updateTime,
    flyToOrder,
    flyToActiveUnit,
    stopTracking,
    getTrackedOrderId: () => trackedOrderId,
    destroy() {
      stopTracking();
      clearStations();
      clearOrders();
    },
  };
}
