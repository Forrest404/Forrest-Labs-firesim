/**
 * Dispatch cards over the map: what every responding unit is doing at the playback time.
 * Derived from the plan's orders through the pure kinematics, so scrubbing updates it.
 */

import type { Store } from '../app/state';
import { unitKinematicsAt } from '../contain';
import type { UnitKinematics } from '../contain';
import { UNIT_COLOR } from '../viewer/dispatchOverlay';
import { el } from './el';
import { STR } from './strings';

const MAX_CARDS = 7;
const RANK: Record<UnitKinematics['phase'], number> = { working: 0, shuttle: 1, transit: 2, completed: 3, standby: 4 };

export function mountDispatchHud(root: HTMLElement, store: Store): void {
  const box = el('div', { class: 'dispatch-hud', 'aria-live': 'polite', 'aria-label': STR.hudTitle });
  box.hidden = true;
  root.append(box);
  let lastKey = '';

  store.subscribe((s) => {
    const plan = s.contain.plan;
    const on = !!plan && !!s.area && !!s.result && s.view === 'sim' && s.contain.hud && s.contain.show === 'contained' && plan.orders.length > 0;
    if (!on) {
      if (!box.hidden) {
        box.hidden = true;
        lastKey = '';
      }
      return;
    }
    const grid = s.area!.grid;
    const t = s.playback.t;
    const rows = plan!.orders
      .map((o) => ({ o, k: unitKinematicsAt(o, plan!.orders, grid, t) }))
      .filter((r) => r.k.visible && r.k.phase !== 'standby')
      .sort((a, b) => RANK[a.k.phase] - RANK[b.k.phase] || a.o.etaSeconds - b.o.etaSeconds)
      .slice(0, MAX_CARDS);
    const key = rows.map((r) => `${r.o.id}|${r.k.status}`).join(';');
    if (key === lastKey) return;
    lastKey = key;
    box.hidden = rows.length === 0;
    box.replaceChildren(
      ...rows.map((r) =>
        el('div', { class: `card in ${r.k.phase}` },
          el('i', { class: 'dot', style: `background:${UNIT_COLOR[r.o.unitType]}` }),
          el('div', { class: 'card-body' },
            el('div', { class: 'name' }, r.o.unitName),
            el('div', { class: 'status' }, r.k.status),
            el('div', { class: 'meta muted' }, `${STR.tacticNames[r.o.tactic]} · ${r.o.sector}`),
          ),
        ),
      ),
    );
  });
}
