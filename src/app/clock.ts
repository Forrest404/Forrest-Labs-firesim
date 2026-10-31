/**
 * Playback clock: advances simulated time while playing, via requestAnimationFrame.
 * Writes playback.t into the store; the overlay repaints from store changes.
 */

import type { Store } from './state';

export interface Clock {
  stop(): void;
}

export function startClock(store: Store): Clock {
  let last = performance.now();
  let raf = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const s = store.get();
    if (s.playback.playing && s.result) {
      const t = Math.min(s.durationSeconds, s.playback.t + dt * s.playback.speed);
      if (t >= s.durationSeconds) store.set({ playback: { ...s.playback, t: s.durationSeconds, playing: false } });
      else store.set({ playback: { ...s.playback, t } });
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf) };
}
