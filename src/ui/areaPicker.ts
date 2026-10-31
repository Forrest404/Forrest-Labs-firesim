/** Demo-area picker. The "Live (current view)" entry is a disabled "coming soon" stub in v0. */

import { LIVE_AREA_NAME } from '../data/demoAreas';
import type { Store } from '../app/state';
import { el } from './el';
import { STR } from './strings';

export interface AreaPickerActions {
  selectArea(name: string): void;
}

export function mountAreaPicker(container: HTMLElement, store: Store, actions: AreaPickerActions): void {
  const select = el('select', { id: 'area-select', 'aria-label': STR.areaLabel }) as HTMLSelectElement;
  const info = el('div', { class: 'muted' });
  const live = el('option', { value: LIVE_AREA_NAME, disabled: true }, STR.liveAreaLabel);
  select.onchange = () => actions.selectArea(select.value);
  container.append(el('h2', {}, STR.areaLabel), select, info);

  let renderedKey = '';
  store.subscribe((s, prev) => {
    if (s.areas !== prev.areas || renderedKey === '') {
      const key = s.areas.map((a) => a.name).join('|');
      if (key !== renderedKey) {
        renderedKey = key;
        select.replaceChildren(
          ...s.areas.map((a) => el('option', { value: a.name }, a.label)),
          live,
        );
      }
    }
    if (s.area && select.value !== s.area.meta.name) select.value = s.area.meta.name;
    select.disabled = s.areaLoading;
    if (s.areaLoading) info.textContent = STR.loadingArea;
    else if (s.area) {
      const m = s.area.meta;
      // Each bundle names its own data sources and licences (OSM, ESA WorldCover, ...): show those, not a fixed line.
      info.textContent = `${m.description} ${m.synthetic ? '' : m.attribution.join(' · ')}`;
    }
  });
}
