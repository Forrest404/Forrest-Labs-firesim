/** Export buttons: fire perimeters and ensemble probability lines as GeoJSON files. */

import type { Store } from '../app/state';
import { el } from './el';
import { STR } from './strings';

export interface ExportActions {
  exportPerimeters(): void;
  exportProbability(): void;
}

export function mountExport(container: HTMLElement, store: Store, actions: ExportActions): void {
  const perimeters = el('button', { onclick: () => actions.exportPerimeters() }, STR.exportPerimeters) as HTMLButtonElement;
  const probability = el('button', { onclick: () => actions.exportProbability() }, STR.exportProbability) as HTMLButtonElement;
  container.append(el('div', { class: 'row' }, perimeters, probability), el('div', { class: 'muted' }, STR.exportNote));
  store.subscribe((s) => {
    perimeters.disabled = !s.result;
    probability.disabled = !s.ensemble.result;
  });
}
