/**
 * Emergency response popup: top right, collapsible, shown once an area and an ignition exist.
 * Holds the response controls (level, dispatch, with/without) and the live dispatch cards.
 */

import type { Store } from '../app/state';
import { mountContain } from './contain';
import { iconButton } from './controls';
import { mountDispatchHud } from './dispatchHud';
import { el } from './el';
import { icon } from './icons';
import { STR } from './strings';

export function mountResponsePopup(root: HTMLElement, store: Store, actions: { simulate(): void }): void {
  const body = el('div', { class: 'pop-body' });
  const pop = el('aside', { class: 'response-pop', 'aria-label': STR.containTitle });
  const toggle = iconButton('chevron', STR.popCollapse, () => {
    const collapsed = pop.classList.toggle('collapsed');
    toggle.title = collapsed ? STR.popExpand : STR.popCollapse;
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }, { class: 'pop-toggle' });
  toggle.setAttribute('aria-expanded', 'true');
  const head = el('header', { class: 'pop-head' }, el('h2', {}, icon('target', 16), el('span', {}, STR.containTitle)), toggle);
  head.addEventListener('click', (e) => { if (e.target === head || (e.target as HTMLElement).closest('h2')) toggle.click(); });
  pop.append(head, body);
  pop.hidden = true;
  root.append(pop);
  mountContain(body, store, actions);
  mountDispatchHud(body, store);
  store.subscribe((s) => {
    const show = s.view === 'sim' && !!s.area && !!s.ignition && !s.areaLoading;
    if (pop.hidden === show) pop.hidden = !show;
  });
}
