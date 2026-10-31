/** Demo-area picker. The "Live (current view)" entry is a disabled "coming soon" stub in v0. */

import type { Store } from '../app/state';
import { el } from './el';
import { icon } from './icons';
import { STR } from './strings';

export interface AreaPickerActions {
  selectArea(name: string): void;
}

export function mountAreaPicker(container: HTMLElement, store: Store, actions: AreaPickerActions): void {
  const select = el('select', { id: 'area-select', 'aria-label': STR.areaLabel }) as HTMLSelectElement;
  const info = el('div', { class: 'muted hint' });
  const tag = el('span', { class: 'pill tag' }, STR.syntheticTag);
  select.onchange = () => actions.selectArea(select.value);
  container.append(el('div', { class: 'select-wrap' }, select, icon('chevron', 16)), el('div', { class: 'row between' }, info, tag));

  let renderedKey = '';
  store.subscribe((s, prev) => {
    if (s.areas !== prev.areas || renderedKey === '') {
      const key = s.areas.map((a) => a.name).join('|');
      if (key !== renderedKey) {
        renderedKey = key;
        select.replaceChildren(...s.areas.map((a) => el('option', { value: a.name }, a.label)));
      }
    }
    if (s.area && select.value !== s.area.meta.name) select.value = s.area.meta.name;
    select.disabled = s.areaLoading;
    container.classList.toggle('loading', s.areaLoading);
    if (s.areaLoading) info.textContent = STR.loadingArea;
    else if (s.area) info.textContent = s.area.meta.description;
    tag.hidden = !(s.area?.meta.synthetic);
    tag.title = STR.syntheticNote;
  });
}
