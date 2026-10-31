/**
 * Compass and view controls, drawn over the 3D view (bottom right).
 *
 *  - the ring turns so the red N always points at true north;
 *  - drag the ring to turn the view (the scene stays put, the camera swings around it);
 *  - click it (or press Enter on it) to face north;
 *  - the arrows above and below tilt the view towards the horizon or straight down;
 *  - a readout shows the heading and tilt; "?" lists the keyboard flight controls.
 *
 * Self-contained (it injects its own styles) so it works whatever the side panel looks like.
 */

import type { Viewer } from 'cesium';
import { compassPoint, headingFromDialDrag, pointerAngleDeg, tiltFromPitchDeg } from './cameraMath';
import { animateHeading, beginOrbit, currentView, setView, stopViewAnimation } from './orbit';
import type { OrbitSession } from './orbit';

export interface Compass {
  element: HTMLElement;
  destroy(): void;
}

const TILT_STEP_DEG = 10;
const STYLE_ID = 'firesim-compass-style';

const CSS = `
.fs-compass { position: absolute; right: 16px; bottom: 64px; z-index: 4; width: 96px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  font: 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e8e8e8; user-select: none; -webkit-user-select: none; touch-action: none; }
.fs-compass .fs-dial { position: relative; width: 96px; height: 96px; border-radius: 50%; background: rgba(18,20,24,0.88); border: 1px solid rgba(255,255,255,0.16);
  box-shadow: 0 2px 10px rgba(0,0,0,0.35); cursor: grab; outline: none; }
.fs-compass .fs-dial:focus-visible { box-shadow: 0 0 0 2px #ff7a1a; }
.fs-compass .fs-dial.dragging { cursor: grabbing; }
.fs-compass .fs-ring { position: absolute; inset: 0; border-radius: 50%; will-change: transform; }
.fs-compass .fs-ring i { position: absolute; left: 50%; top: 50%; width: 1px; height: 6px; margin-left: -0.5px; background: rgba(255,255,255,0.35); transform-origin: 0 48px; margin-top: -48px; }
.fs-compass .fs-ring i.major { height: 9px; background: rgba(255,255,255,0.7); }
.fs-compass .fs-ring b { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; text-align: center; line-height: 16px; font-weight: 600; }
.fs-compass .fs-ring b.n { color: #ff5a4d; font-size: 14px; }
.fs-compass .fs-ring b.e, .fs-compass .fs-ring b.s, .fs-compass .fs-ring b.w { color: #c8ccd2; font-size: 11px; }
.fs-compass .fs-needle { position: absolute; left: 50%; top: 50%; width: 0; height: 0; margin: -22px 0 0 -6px; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 22px solid #ff5a4d; opacity: 0.95; pointer-events: none; }
.fs-compass .fs-needle::after { content: ''; position: absolute; left: -6px; top: 22px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 22px solid #aab0b8; }
.fs-compass .fs-fixed { position: absolute; left: 50%; top: -3px; margin-left: -5px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid #ff7a1a; pointer-events: none; }
.fs-compass .fs-row { display: flex; gap: 4px; width: 100%; justify-content: space-between; align-items: center; }
.fs-compass button { background: rgba(18,20,24,0.88); color: #e8e8e8; border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px; line-height: 16px; }
.fs-compass button:hover { background: rgba(44,49,58,0.95); }
.fs-compass button:focus-visible { outline: 2px solid #ff7a1a; }
.fs-compass .fs-readout { font-variant-numeric: tabular-nums; background: rgba(18,20,24,0.88); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 1px 6px; white-space: nowrap; }
.fs-compass .fs-help { position: absolute; right: 104px; bottom: 0; width: 230px; padding: 8px 10px; border-radius: 8px; background: rgba(18,20,24,0.94); border: 1px solid rgba(255,255,255,0.16); line-height: 1.45; text-align: left; }
.fs-compass .fs-help[hidden] { display: none; }
.fs-compass .fs-help kbd { background: rgba(255,255,255,0.12); border-radius: 3px; padding: 0 4px; font: inherit; font-weight: 600; }
@media (max-width: 720px) {
  /* The bottom sheet owns the lower half on phones, so the compass sits top-left, under the map credit. */
  .fs-compass { top: calc(max(6px, env(safe-area-inset-top)) + 34px); left: 10px; right: auto; bottom: auto; }
  .fs-compass .fs-help { left: 104px; right: auto; top: 0; bottom: auto; }
}
@media (pointer: coarse) { .fs-compass button { min-width: 44px; min-height: 44px; font-size: 14px; } .fs-compass .fs-row { gap: 6px; } }
`;

const HELP = [
  ['Compass', 'drag the ring to turn the view, click it to face north'],
  ['Tilt', '▲ ▼ buttons, or middle-drag / Ctrl-drag on the map'],
  ['Fly', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move where you look, <kbd>R</kbd>/<kbd>F</kbd> rise or sink'],
  ['Look', '<kbd>Q</kbd>/<kbd>E</kbd> or ← → turn, ↑ ↓ look up or down'],
  ['Speed', 'hold <kbd>Shift</kbd> for 4× (speed follows your height)'],
  ['Mouse', 'drag to rotate the map, scroll to zoom'],
] as const;

export function mountCompass(viewer: Viewer, parent: HTMLElement = viewer.container as HTMLElement): Compass {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  const root = el('div', 'fs-compass');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Compass and view controls');

  const dial = el('div', 'fs-dial');
  dial.tabIndex = 0;
  dial.setAttribute('role', 'button');
  dial.setAttribute('aria-label', 'Compass. Drag to turn the view, press Enter to face north.');
  dial.title = 'Drag to turn the view · click to face north';
  const ring = el('div', 'fs-ring');
  for (let d = 0; d < 360; d += 15) {
    const tick = el('i', d % 90 === 0 ? 'major' : '');
    tick.style.transform = `rotate(${d}deg)`;
    ring.appendChild(tick);
  }
  for (const [label, cls, deg] of [['N', 'n', 0], ['E', 'e', 90], ['S', 's', 180], ['W', 'w', 270]] as const) {
    const b = el('b', cls, label);
    b.style.transform = `rotate(${deg}deg) translateY(-31px) rotate(${-deg}deg)`; // keep the letters upright relative to the ring
    ring.appendChild(b);
  }
  dial.append(ring, el('div', 'fs-needle'), el('div', 'fs-fixed'));

  const up = el('button', '', '▲');
  up.title = 'Tilt towards the horizon';
  up.setAttribute('aria-label', 'Tilt towards the horizon');
  const down = el('button', '', '▼');
  down.title = 'Tilt towards straight down';
  down.setAttribute('aria-label', 'Tilt towards straight down');
  const help = el('button', '', '?');
  help.title = 'Camera controls';
  help.setAttribute('aria-label', 'Show camera controls');
  help.setAttribute('aria-expanded', 'false');
  const row = el('div', 'fs-row');
  row.append(up, help, down);
  const readout = el('div', 'fs-readout');
  const helpCard = el('div', 'fs-help');
  helpCard.hidden = true;
  helpCard.innerHTML = HELP.map(([k, v]) => `<div><b>${k}:</b> ${v}</div>`).join('');
  root.append(dial, row, readout, helpCard);
  parent.appendChild(root);

  // ---- state shown on screen -------------------------------------------------------------
  let shownHeading = NaN;
  let shownTilt = NaN;
  const refresh = (): void => {
    const v = currentView(viewer);
    const tilt = tiltFromPitchDeg(v.pitchDeg);
    if (Math.abs(v.headingDeg - shownHeading) > 0.05 || !Number.isFinite(shownHeading)) {
      shownHeading = v.headingDeg;
      ring.style.transform = `rotate(${-v.headingDeg}deg)`;
    }
    if (Math.abs(tilt - shownTilt) > 0.2 || !Number.isFinite(shownTilt)) {
      shownTilt = tilt;
    }
    readout.textContent = `${compassPoint(v.headingDeg)} ${Math.round(v.headingDeg) % 360}° · tilt ${Math.round(tilt)}°`;
    root.dataset.heading = v.headingDeg.toFixed(2);
    root.dataset.tilt = tilt.toFixed(1);
  };
  viewer.scene.preRender.addEventListener(refresh);
  refresh();

  // ---- drag the ring to turn; a click without movement faces north ----------------------
  let drag: { orbit: OrbitSession; pointerId: number; startAngle: number; startHeading: number; startX: number; startY: number; moved: boolean } | null = null;
  const angleAt = (e: PointerEvent): number => {
    const r = dial.getBoundingClientRect();
    return pointerAngleDeg(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };
  dial.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stopViewAnimation();
    viewer.camera.cancelFlight();
    dial.setPointerCapture(e.pointerId);
    drag = { orbit: beginOrbit(viewer), pointerId: e.pointerId, startAngle: angleAt(e), startHeading: currentView(viewer).headingDeg, startX: e.clientX, startY: e.clientY, moved: false };
    e.preventDefault();
  });
  dial.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
    drag.moved = true;
    dial.classList.add('dragging');
    drag.orbit.set({ headingDeg: headingFromDialDrag(drag.startHeading, drag.startAngle, angleAt(e)) });
  });
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const clicked = !drag.moved && e.type === 'pointerup';
    drag = null;
    dial.classList.remove('dragging');
    if (clicked) animateHeading(viewer, 0);
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      animateHeading(viewer, 0);
      e.preventDefault();
    }
  });

  // ---- tilt buttons ----------------------------------------------------------------------
  const tilt = (deltaDeg: number): void => {
    stopViewAnimation();
    viewer.camera.cancelFlight();
    setView(viewer, { pitchDeg: currentView(viewer).pitchDeg + deltaDeg });
  };
  up.addEventListener('click', () => tilt(TILT_STEP_DEG)); // towards the horizon: pitch rises towards 0
  down.addEventListener('click', () => tilt(-TILT_STEP_DEG));
  help.addEventListener('click', () => {
    helpCard.hidden = !helpCard.hidden;
    help.setAttribute('aria-expanded', helpCard.hidden ? 'false' : 'true');
  });

  // Keep camera events from reaching the map underneath.
  for (const t of ['pointerdown', 'wheel', 'dblclick', 'contextmenu'] as const) root.addEventListener(t, (e) => e.stopPropagation());

  return {
    element: root,
    destroy() {
      viewer.scene.preRender.removeEventListener(refresh);
      stopViewAnimation();
      root.remove();
    },
  };
}

