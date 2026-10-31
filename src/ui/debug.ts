/** Debug toggles: grid outline, fuel classes, slope. */

import type { DebugFlags, Store } from '../app/state';
import { el } from './el';
import { STR } from './strings';

export function mountDebug(container: HTMLElement, store: Store): void {
  const toggles: [keyof DebugFlags, string][] = [
    ['outline', STR.debugOutline],
    ['fuel', STR.debugFuel],
    ['slope', STR.debugSlope],
  ];
  const inputs = new Map<keyof DebugFlags, HTMLInputElement>();
  const details = el('details', {}, el('summary', {}, STR.debugTitle));
  for (const [key, label] of toggles) {
    const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
    input.onchange = () => store.update((s) => ({ debug: { ...s.debug, [key]: input.checked } }));
    inputs.set(key, input);
    details.append(el('label', {}, el('span', {}, label), input));
  }
  details.append(
    el('div', { class: 'muted legend' },
      ...Object.entries(STR.fuelLegend).map(([name, color]) => el('span', { class: 'swatch' }, el('i', { style: `background:${color}` }), name)),
    ),
  );
  container.append(details);
  store.subscribe((s) => {
    for (const [key, input] of inputs) input.checked = s.debug[key];
  });
}
