/**
 * Shared UI controls so every section looks and behaves the same: section cards, segmented
 * chips, filled sliders, toggle switches and icon buttons. All plain DOM, no framework.
 */

import { el } from './el';
import { icon } from './icons';
import type { IconName } from './icons';

/** A card section with an icon + title header and an optional trailing slot. */
export function section(name: IconName, title: string, opts: { trailing?: Node; class?: string } = {}): { root: HTMLElement; body: HTMLElement; header: HTMLElement } {
  const body = el('div', { class: 'section-body' });
  const header = el('div', { class: 'section-head' },
    el('h2', {}, icon(name, 16), el('span', {}, title)),
    opts.trailing ?? null,
  );
  const root = el('section', { class: `card ${opts.class ?? ''}`.trim() }, header, body);
  return { root, body, header };
}

export interface SegmentedOption<T extends string | number> { value: T; label: string; title?: string }

/** Single-select chip group. `onSelect` fires on click; `set(value)` syncs from the store. */
export function segmented<T extends string | number>(
  options: SegmentedOption<T>[],
  onSelect: (value: T) => void,
  opts: { ariaLabel?: string; class?: string } = {},
): { root: HTMLElement; set(value: T | null): void; setDisabled(v: boolean): void } {
  const buttons = new Map<T, HTMLButtonElement>();
  const root = el('div', { class: `seg ${opts.class ?? ''}`.trim(), role: 'radiogroup', 'aria-label': opts.ariaLabel });
  for (const o of options) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', title: o.title, onclick: () => onSelect(o.value) }, o.label) as HTMLButtonElement;
    buttons.set(o.value, b);
    root.append(b);
  }
  return {
    root,
    set(value) {
      for (const [v, b] of buttons) {
        const on = v === value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    },
    setDisabled(v) {
      for (const b of buttons.values()) b.disabled = v;
    },
  };
}

/** Range input with a filled track; `--fill` is kept in sync for the CSS gradient. */
export function slider(attrs: { min: number; max: number; step: number; ariaLabel: string }, onInput: (v: number) => void): HTMLInputElement {
  const input = el('input', { type: 'range', min: attrs.min, max: attrs.max, step: attrs.step, 'aria-label': attrs.ariaLabel }) as HTMLInputElement;
  const paint = () => {
    const min = Number(input.min), max = Number(input.max);
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${pct}%`);
  };
  input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
  const origSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  // Keep the fill correct when the store writes `.value` programmatically.
  Object.defineProperty(input, 'value', {
    get() { return origSet.get!.call(input) as string; },
    set(v: string) { origSet.set!.call(input, v); paint(); },
  });
  return input;
}

/** A labelled row: label on the left, control(s) on the right, value chip optional. */
export function row(label: string, ...controls: (Node | null)[]): HTMLElement {
  return el('div', { class: 'ctl-row' }, el('span', { class: 'ctl-label' }, label), el('div', { class: 'ctl' }, ...controls));
}

/** Toggle switch. Returns the input so callers can sync `.checked`. */
export function toggle(label: string, onChange: (checked: boolean) => void, opts: { title?: string } = {}): { root: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  input.onchange = () => onChange(input.checked);
  const root = el('label', { class: 'switch', title: opts.title }, el('span', { class: 'switch-label' }, label), input, el('span', { class: 'track', 'aria-hidden': 'true' }));
  return { root, input };
}

/** Icon-only button with an accessible name. */
export function iconButton(name: IconName, label: string, onClick: () => void, opts: { class?: string; title?: string } = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: `icon-btn ${opts.class ?? ''}`.trim(), 'aria-label': label, title: opts.title ?? label, onclick: onClick }, icon(name)) as HTMLButtonElement;
}

/** Small value chip (tabular numbers). */
export function chip(text = '', cls = ''): HTMLElement {
  return el('span', { class: `chip ${cls}`.trim() }, text);
}

export interface TabOption<T extends string> { value: T; label: string; icon: IconName }

/** Top-level tab bar (role=tablist). Arrow keys move between tabs; `set(value)` syncs from the store. */
export function tabBar<T extends string>(
  options: TabOption<T>[],
  onSelect: (value: T) => void,
  opts: { ariaLabel?: string } = {},
): { root: HTMLElement; set(value: T): void } {
  const buttons = new Map<T, HTMLButtonElement>();
  const root = el('div', { class: 'tabs', role: 'tablist', 'aria-label': opts.ariaLabel });
  options.forEach((o, i) => {
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1', onclick: () => onSelect(o.value) }, icon(o.icon, 16), el('span', {}, o.label)) as HTMLButtonElement;
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
      onSelect(next.value);
      buttons.get(next.value)?.focus();
    });
    buttons.set(o.value, b);
    root.append(b);
  });
  return {
    root,
    set(value) {
      for (const [v, b] of buttons) {
        const on = v === value;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
    },
  };
}
