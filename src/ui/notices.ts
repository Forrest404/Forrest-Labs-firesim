/** Banners (bottom centre): fallback notice, errors, loading state. Animated in/out; errors dismiss on click. */

import { el } from './el';
import { icon } from './icons';

export type NoticeKind = 'warn' | 'error' | 'info';

export interface Notices {
  show(text: string, kind?: NoticeKind, ttlMs?: number): void;
  /** Persistent banner keyed by id (e.g. 'fallback', 'loading'); null removes it. */
  persistent(id: string, text: string | null, kind?: NoticeKind): void;
}

const ICON = { warn: 'info', error: 'x', info: 'loader' } as const;

function banner(text: string, kind: NoticeKind, attrs: Record<string, string> = {}): HTMLElement {
  const node = el('div', { class: `banner ${kind}`, role: kind === 'error' ? 'alert' : 'status', ...attrs }, icon(ICON[kind], 16), el('span', {}, text));
  requestAnimationFrame(() => node.classList.add('in'));
  return node;
}

function dismiss(node: HTMLElement): void {
  node.classList.remove('in');
  node.addEventListener('transitionend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 400);
}

export function createNotices(container: HTMLElement): Notices {
  const persistentEls = new Map<string, HTMLElement>();
  return {
    show(text, kind = 'warn', ttlMs = 6000) {
      const node = banner(text, kind);
      node.onclick = () => dismiss(node);
      container.appendChild(node);
      if (ttlMs > 0) setTimeout(() => dismiss(node), ttlMs);
    },
    persistent(id, text, kind = 'warn') {
      const existing = persistentEls.get(id);
      if (existing) {
        dismiss(existing);
        persistentEls.delete(id);
      }
      if (text === null) return;
      const node = banner(text, kind, { 'data-id': id });
      container.appendChild(node);
      persistentEls.set(id, node);
    },
  };
}
