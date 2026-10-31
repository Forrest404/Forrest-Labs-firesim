/**
 * "Real vs simulation": two small square maps over the 3D view. Left is the real fire's official
 * final perimeter, right is our run at the current playback time, both cropped to the same
 * square on the same fuel background so the shapes can be compared at a glance. Playback pauses
 * by itself at the moment the run is as big as the real fire (the fair point to compare).
 */

import { NEVER_ARRIVES, fuelSpec } from '../contract';
import type { GridSpec, SimResult } from '../contract';
import type { DemoArea, ReferenceFire } from '../data/bundle';
import { overlapAt, overlapAtRealSize } from '../app/impact';
import type { Overlap } from '../app/impact';
import { liveStats } from '../app/overlayPainter';
import type { AppState, Store } from '../app/state';
import { parseRgba } from '../viewer/burnCanvas';
import { iconButton } from './controls';
import { el, formatClock } from './el';
import { icon } from './icons';
import { STR } from './strings';

interface Crop {
  r0: number;
  c0: number;
  size: number;
}

const BURNED: [number, number, number] = [255, 90, 54];
const FRONT: [number, number, number] = [255, 214, 90];
const EDGE: [number, number, number] = [34, 211, 238];
const FRONT_WINDOW_S = 1800;

export function mountRealVsSim(container: HTMLElement, store: Store): void {
  const realCanvas = el('canvas', { class: 'rvs-map', 'aria-label': STR.sideBySideReal }) as HTMLCanvasElement;
  const simCanvas = el('canvas', { class: 'rvs-map', 'aria-label': STR.sideBySideSim }) as HTMLCanvasElement;
  const realArea = el('div', { class: 'rvs-big' });
  const simArea = el('div', { class: 'rvs-big' });
  const simSub = el('div', { class: 'rvs-sub' });
  const match = el('div', { class: 'rvs-stat hero' });
  const covered = el('div', { class: 'rvs-stat' });
  const windCheck = el('div', { class: 'rvs-stat' });
  const close = iconButton('x', STR.sideBySideClose, () => store.set({ sideBySide: false }), { class: 'rvs-close' });
  const card = el('div', { class: 'rvs', role: 'region', 'aria-label': STR.sideBySideTitle },
    el('div', { class: 'rvs-head' }, el('h2', {}, icon('target', 16), el('span', {}, STR.sideBySideTitle)), close),
    el('div', { class: 'rvs-maps' },
      el('figure', {}, realCanvas, el('figcaption', {}, el('span', { class: 'rvs-tag real' }, STR.sideBySideReal), realArea, el('div', { class: 'rvs-sub' }, STR.sideBySideAreaReal))),
      el('figure', {}, simCanvas, el('figcaption', {}, el('span', { class: 'rvs-tag sim' }, STR.sideBySideSim), simArea, simSub)),
    ),
    el('div', { class: 'rvs-stats' }, match, covered, windCheck),
  );
  card.hidden = true;
  container.append(card);

  // Per-result caches: the crop and the fair comparison don't change while playback moves.
  let key: { area: DemoArea; result: SimResult } | null = null;
  let crop: Crop | null = null;
  let fair: Overlap | null = null;
  let realPainted = false;

  store.subscribe((s, prev) => {
    const ref = s.area?.reference;
    card.hidden = !s.sideBySide || !ref || !s.area;
    if (card.hidden || !ref || !s.area) return;

    if (!s.result) {
      simArea.textContent = '—';
      simSub.textContent = STR.sideBySideNotYet;
      return;
    }
    if (!key || key.area !== s.area || key.result !== s.result) {
      key = { area: s.area, result: s.result };
      fair = overlapAtRealSize(s.result, ref);
      crop = cropFor(s.area.grid, ref, s.result, fair ? fair.t : s.durationSeconds);
      realPainted = false;
    }
    if (!crop) return;

    // Stop at real size so the fair match is on screen without anyone scrubbing.
    if (fair && s.playback.playing && prev.playback.t < fair.t && s.playback.t >= fair.t) {
      store.set({ playback: { ...s.playback, playing: false, t: fair.t } });
      return;
    }

    if (!realPainted) {
      paint(realCanvas, s.area, crop, (i) => (ref.mask[i] ? BURNED : null), ref.mask, false);
      realPainted = true;
    }
    const arr = s.result.arrivalTime;
    const t = s.playback.t;
    paint(simCanvas, s.area, crop, (i) => {
      const a = arr[i];
      if (a === NEVER_ARRIVES || a > t) return null;
      return t - a < FRONT_WINDOW_S ? FRONT : BURNED;
    }, ref.mask, true);

    realArea.textContent = `${Math.round(ref.areaHa)} ha`;
    const now = liveStats(s.result, s.area.grid, t);
    simArea.textContent = `${Math.round(now.burnedAreaHa)} ha`;
    simSub.textContent = fair && t >= fair.t - 1
      ? `${formatClock(t)} · ${STR.sideBySideRealSize} ${formatClock(fair.t)}`
      : `${formatClock(t)} · ${STR.sideBySideAreaSim}`;

    const live = overlapAt(s.result, ref, t);
    match.replaceChildren(
      el('strong', {}, fair ? `${Math.round(fair.iou * 100)} %` : '—'),
      el('span', {}, `${STR.sideBySideMatch} · ${STR.overlapNow} ${Math.round(live.iou * 100)} %`),
    );
    covered.replaceChildren(el('strong', {}, fair ? `${Math.round(fair.covered * 100)} %` : '—'), el('span', {}, STR.sideBySideCovered));
    const reversed = controlIou(s, 'reversed');
    windCheck.hidden = reversed === undefined;
    windCheck.replaceChildren(el('strong', {}, reversed === null ? '—' : `${Math.round((reversed ?? 0) * 100)} %`), el('span', {}, STR.sideBySideWindCheck));
  });
}

function controlIou(s: AppState, kind: 'reversed' | 'noWind'): number | null | undefined {
  const run = s.controls?.find((c) => c.kind === kind);
  if (!run) return undefined;
  return run.overlap ? run.overlap.iou : null;
}

/** Square crop around the real fire and the run at real size, with a margin, clamped to the grid. */
export function cropFor(grid: GridSpec, ref: ReferenceFire, result: SimResult, tCompare: number): Crop | null {
  const { width: W, height: H } = grid;
  let rMin = H;
  let rMax = -1;
  let cMin = W;
  let cMax = -1;
  for (let i = 0; i < ref.mask.length; i++) {
    if (!ref.mask[i] && !(result.arrivalTime[i] <= tCompare)) continue;
    const r = (i / W) | 0;
    const c = i - r * W;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (c < cMin) cMin = c;
    if (c > cMax) cMax = c;
  }
  if (rMax < 0) return null;
  const margin = 6;
  const size = Math.min(Math.max(W, H), Math.max(rMax - rMin, cMax - cMin) + 1 + 2 * margin);
  const clampStart = (lo: number, hi: number, n: number): number => Math.max(0, Math.min(n - size, Math.round((lo + hi) / 2 - size / 2)));
  return { r0: clampStart(rMin, rMax, H), c0: clampStart(cMin, cMax, W), size: Math.min(size, W, H) };
}

/** One pixel per cell: dimmed fuel colour underneath, `color(i)` on top, optional real-perimeter edge. */
function paint(canvas: HTMLCanvasElement, area: DemoArea, crop: Crop, color: (i: number) => [number, number, number] | null, realMask: Uint8Array, edge: boolean): void {
  const { size, r0, c0 } = crop;
  const W = area.grid.width;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = (r0 + r) * W + (c0 + c);
      const p = (r * size + c) * 4;
      let rgb = color(i) ?? fuelBackground(area.fuel[i]);
      if (edge && realMask[i] && isEdge(realMask, i, W, area.grid.height)) rgb = EDGE;
      d[p] = rgb[0];
      d[p + 1] = rgb[1];
      d[p + 2] = rgb[2];
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const FUEL_BG = new Map<number, [number, number, number]>();

/** The fuel layer's colour, dimmed toward the panel background so the fire reads on top. */
function fuelBackground(fuel: number): [number, number, number] {
  let rgb = FUEL_BG.get(fuel);
  if (!rgb) {
    const f = parseRgba(fuelSpec(fuel).color);
    rgb = [Math.round(18 + f[0] * 0.28), Math.round(20 + f[1] * 0.28), Math.round(24 + f[2] * 0.28)];
    FUEL_BG.set(fuel, rgb);
  }
  return rgb;
}

function isEdge(mask: Uint8Array, i: number, W: number, H: number): boolean {
  const r = (i / W) | 0;
  const c = i - r * W;
  return r === 0 || c === 0 || r === H - 1 || c === W - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W];
}
