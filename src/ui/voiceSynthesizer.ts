/**
 * Dedicated Per-Station Wildfire Radio Voice Synthesizer.
 * Maps each station crew's GeminiVoicePreset ('Kore' | 'Fenrir' | 'Puck' | 'Charon')
 * and pitch/rate profile to a distinct, consistent voice on the radio net, with a quick
 * Mute/Unmute toggle and subtle radio squelch tone.
 */

import type { RadioCalloutEvent } from '../agent/types';

export interface RadioVoiceSynthesizer {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  speakCallout(event: RadioCalloutEvent): void;
  stopAll(): void;
}

export function createRadioVoiceSynthesizer(): RadioVoiceSynthesizer {
  let enabled = true;
  let audioCtx: AudioContext | null = null;

  function playRadioSquelchBeep(freq = 1480, durationMs = 55): void {
    if (!enabled || typeof window === 'undefined') return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durationMs / 1000);
    } catch {
      // Ignore audio context autoplay restrictions until user interaction
    }
  }

  function pickDedicatedBrowserVoice(preset: RadioCalloutEvent['voicePreset']): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const enVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const pool = enVoices.length > 0 ? enVoices : voices;

    const indexMap: Record<RadioCalloutEvent['voicePreset'], number> = {
      Kore: 0,
      Fenrir: 1,
      Puck: 2,
      Charon: 3,
    };
    return pool[indexMap[preset] % pool.length] ?? pool[0] ?? null;
  }

  function speakCallout(event: RadioCalloutEvent): void {
    if (!enabled || typeof window === 'undefined') return;
    playRadioSquelchBeep(event.phase === 'dispatch' ? 1560 : 1320, 50);

    if (!('speechSynthesis' in window)) return;
    try {
      // Cancel any stale utterance if queue is backed up
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(event.transcript);
      const voice = pickDedicatedBrowserVoice(event.voicePreset);
      if (voice) utter.voice = voice;
      utter.pitch = event.voicePitch;
      utter.rate = event.voiceRate;
      utter.volume = 0.9;
      utter.onend = () => playRadioSquelchBeep(1180, 35);
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors in headless environments
    }
  }

  function stopAll(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }

  return {
    isEnabled: () => enabled,
    setEnabled(next: boolean) {
      enabled = next;
      if (!enabled) stopAll();
    },
    speakCallout,
    stopAll,
  };
}
