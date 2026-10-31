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

export function mountRealVsSim(container: HTMLElement, store: Store, groundView: () => void): void {
  const realCanvas = el('canvas', { class: 'rvs-map', 'aria-label': STR.sideBySideReal }) as HTMLCanvasElement;
  const simCanvas = el('canvas', { class: 'rvs-map', 'aria-label': STR.sideBySideSim }) as HTMLCanvasElement;
  const realArea = el('div', { class: 'rvs-big' });
  const simArea = el('div', { class: 'rvs-big' });
  const simSub = el('div', { class: 'rvs-sub' });
  const match = el('div', { class: 'rvs-stat hero' });
  const covered = el('div', { class: 'rvs-stat' });
  const windCheck = el('div', { class: 'rvs-stat' });
  const close = iconButton('x', STR.sideBySideClose, () => store.set({ sideBySide: false }), { class: 'rvs-close' });
  const ground = el('button', { type: 'button', class: 'rvs-ground', onclick: () => groundView() }, icon('camera', 16), el('span', {}, STR.cameraGround)) as HTMLButtonElement;
  const card = el('div', { class: 'rvs', role: 'region', 'aria-label': STR.sideBySideTitle },
    el('div', { class: 'rvs-head' }, el('h2', {}, icon('target', 16), el('span', {}, STR.sideBySideTitle)), el('div', { class: 'row tight' }, ground, close)),
    el('div', { class: 'rvs-maps' },
      el('figure', {}, realCanvas, el('figcaption', {}, el('span', { class: 'rvs-tag real' }, STR.sideBySideReal), realArea, el('div', { class: 'rvs-sub' }, STR.sideBySideAreaReal))),
      el('figure', {}, simCanvas, el('figcaption', {}, el('span', { class: 'rvs-tag sim' }, STR.sideBySideSim), simArea, simSub)),
    ),
    el('div', { class: 'rvs-stats' }, match, covered, windCheck),
    el('div', { class: 'rvs-note' }, el('span', { class: 'rvs-start-dot' }), STR.sideBySideStart, ' · ', STR.sideBySideRevealNote),
  );
  card.hidden = true;
  container.append(card);

  // Per-result caches: the crop and the fair comparison don't change while playback moves.
  let key: { area: DemoArea; result: SimResult } | null = null;
  let crop: Crop | null = null;
  let fair: Overlap | null = null;
  let realRank: Int32Array | null = null;
  let realCells = 0;
  let start: { row: number; col: number } | null = null;

  store.subscribe((s, prev) => {
    const ref = s.area?.reference;
    ground.classList.toggle('active', s.groundFollow);
    card.hidden = !s.sideBySide || !ref || !s.area;
    if (card.hidden || !ref || !s.area) return;

    if (!s.result) {
      simArea.textContent = '—';
      simSub.textContent = STR.sideBySideNotYet;
      return;
    }
    if (!key || key.area !== s.area || key.result !== s.result) {
      if (key?.area !== s.area || !realRank) {
        start = s.area.meta.suggestedIgnition ?? s.ignition;
        realRank = revealOrder(ref.mask, s.area.grid, start);
        realCells = ref.mask.reduce((a, b) => a + b, 0);
      }
      key = { area: s.area, result: s.result };
      fair = overlapAtRealSize(s.result, ref);
      crop = cropFor(s.area.grid, ref, s.result, fair ? fair.t : s.durationSeconds);
    }
    if (!crop || !realRank) return;

    // Stop at real size so the fair match is on screen without anyone scrubbing.
    if (fair && s.playback.playing && prev.playback.t < fair.t && s.playback.t >= fair.t) {
      store.set({ playback: { ...s.playback, playing: false, t: fair.t } });
      return;
    }

    const arr = s.result.arrivalTime;
    const t = s.playback.t;
    let simBurned = 0;
    let simFront = 0;
    for (const a of arr) {
      if (a === NEVER_ARRIVES || a > t) continue;
      simBurned++;
      if (t - a < FRONT_WINDOW_S) simFront++;
    }
    // The real side grows outward from the real start to its official final shape, matched to our
    // burned area so both reach full size together. Its order uses distance only, never our model.
    const shown = Math.min(realCells, simBurned);
    const rank = realRank;
    paint(realCanvas, s.area, crop, (i) => {
      const k = rank[i];
      if (k < 0 || k >= shown) return null;
      return k >= shown - simFront && shown < realCells ? FRONT : BURNED;
    }, ref.mask, false, start);
    paint(simCanvas, s.area, crop, (i) => {
      const a = arr[i];
      if (a === NEVER_ARRIVES || a > t) return null;
      return t - a < FRONT_WINDOW_S ? FRONT : BURNED;
    }, ref.mask, true, start);

    realArea.textContent = shown < realCells ? `${Math.round((ref.areaHa * shown) / realCells)} / ${Math.round(ref.areaHa)} ha` : `${Math.round(ref.areaHa)} ha`;
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

/**
 * Rank of each real-burned cell by distance from the start, walking only through the burned area
 * (a two-pass chamfer distance, repeated until stable since the shape is not convex). -1 elsewhere.
 */
export function revealOrder(mask: Uint8Array, grid: GridSpec, start: { row: number; col: number } | null): Int32Array {
  const { width: W, height: H } = grid;
  const n = W * H;
  const dist = new Float32Array(n).fill(Infinity);
  let seed = start ? start.row * W + start.col : -1;
  if (seed < 0 || !mask[seed]) {
    // Start just outside the perimeter: begin from the nearest burned cell instead.
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const d = start ? Math.hypot(((i / W) | 0) - start.row, (i % W) - start.col) : i;
      if (d < best) { best = d; seed = i; }
    }
  }
  const rank = new Int32Array(n).fill(-1);
  if (seed < 0) return rank;
  dist[seed] = 0;
  const D = Math.SQRT2;
  const relax = (i: number, j: number, cost: number): boolean => {
    if (!mask[j] || dist[i] + cost >= dist[j]) return false;
    dist[j] = dist[i] + cost;
    return true;
  };
  for (let pass = 0, changed = true; changed && pass < 50; pass++) {
    changed = false;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!mask[i] || dist[i] === Infinity) continue;
      if (c + 1 < W) changed = relax(i, i + 1, 1) || changed;
      if (r + 1 < H) {
        changed = relax(i, i + W, 1) || changed;
        if (c > 0) changed = relax(i, i + W - 1, D) || changed;
        if (c + 1 < W) changed = relax(i, i + W + 1, D) || changed;
      }
    }
    for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
      const i = r * W + c;
      if (!mask[i] || dist[i] === Infinity) continue;
      if (c > 0) changed = relax(i, i - 1, 1) || changed;
      if (r > 0) {
        changed = relax(i, i - W, 1) || changed;
        if (c + 1 < W) changed = relax(i, i - W + 1, D) || changed;
        if (c > 0) changed = relax(i, i - W - 1, D) || changed;
      }
    }
  }
  // Pieces not connected to the start (spot fires) come last, nearest first.
  const cells: number[] = [];
  for (let i = 0; i < n; i++) if (mask[i]) cells.push(i);
  const far = (i: number): number => (dist[i] === Infinity ? 1e6 + Math.hypot(((i / W) | 0) - ((seed / W) | 0), (i % W) - (seed % W)) : dist[i]);
  cells.sort((a, b) => far(a) - far(b));
  cells.forEach((i, k) => { rank[i] = k; });
  return rank;
}

/** One pixel per cell: dimmed fuel colour underneath, `color(i)` on top, optional real-perimeter edge and start marker. */
function paint(canvas: HTMLCanvasElement, area: DemoArea, crop: Crop, color: (i: number) => [number, number, number] | null, realMask: Uint8Array, edge: boolean, start: { row: number; col: number } | null): void {
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
  if (start) {
    // Same start on both maps (the official ignition point): white ring with a dark core.
    const x = start.col - c0 + 0.5;
    const y = start.row - r0 + 0.5;
    const rad = Math.max(2.5, size / 45);
    ctx.lineWidth = Math.max(1, size / 110);
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
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
