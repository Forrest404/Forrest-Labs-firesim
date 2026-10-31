/** Banners (bottom centre): fallback notice, errors, loading state. */

import { el } from './el';

export type NoticeKind = 'warn' | 'error' | 'info';

export interface Notices {
  show(text: string, kind?: NoticeKind, ttlMs?: number): void;
  /** Persistent banner keyed by id (e.g. 'fallback', 'loading'); null removes it. */
  persistent(id: string, text: string | null, kind?: NoticeKind): void;
}

export function createNotices(container: HTMLElement): Notices {
  const persistentEls = new Map<string, HTMLElement>();
  return {
    show(text, kind = 'warn', ttlMs = 6000) {
      const node = el('div', { class: `banner ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
      container.appendChild(node);
      if (ttlMs > 0) setTimeout(() => node.remove(), ttlMs);
    },
    persistent(id, text, kind = 'warn') {
      const existing = persistentEls.get(id);
      if (existing) {
        existing.remove();
        persistentEls.delete(id);
      }
      if (text === null) return;
      const node = el('div', { class: `banner ${kind}`, 'data-id': id }, text);
      container.appendChild(node);
      persistentEls.set(id, node);
    },
  };
}
