/** Overlay layer switches: grid outline, fuel classes (with legend), slope. */

import type { DebugFlags, Store } from '../app/state';
import { toggle } from './controls';
import { el } from './el';
import { STR } from './strings';

export function mountDebug(container: HTMLElement, store: Store): void {
  const toggles: [keyof DebugFlags, string][] = [
    ['outline', STR.debugOutline],
    ['fuel', STR.debugFuel],
    ['slope', STR.debugSlope],
  ];
  const inputs = new Map<keyof DebugFlags, HTMLInputElement>();
  const details = el('details', { class: 'layers' }, el('summary', {}, STR.debugTitle)) as HTMLDetailsElement;
  for (const [key, label] of toggles) {
    const t = toggle(label, (on) => store.update((s) => ({ debug: { ...s.debug, [key]: on } })));
    inputs.set(key, t.input);
    details.append(t.root);
  }
  const legend = el('div', { class: 'legend' },
    ...Object.entries(STR.fuelLegend).map(([name, color]) => el('span', { class: 'swatch' }, el('i', { style: `background:${color}` }), name)),
  );
  details.append(legend);
  container.append(details);
  store.subscribe((s) => {
    for (const [key, input] of inputs) input.checked = s.debug[key];
    legend.hidden = !s.debug.fuel;
  });
}
