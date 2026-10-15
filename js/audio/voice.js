/**
 * js/audio/voice.js — Web Speech backend for the voice queue (§8.4).
 * Nothing else in the app calls speechSynthesis.
 */

import { VoiceQueue, PRIORITY } from './voice-queue.js';

export { PRIORITY };

class WebSpeechBackend {
  constructor() {
    this._synth = window.speechSynthesis ?? null;
    this._voice = null;
    this._current = null;   // keep a reference: Chrome can GC utterances mid-speech
    if (this._synth) {
      this._pickVoice();
      this._synth.addEventListener?.('voiceschanged', () => this._pickVoice());
    }
  }

  _pickVoice() {
    const voices = this._synth.getVoices();
    this._voice = voices.find(v => v.lang?.startsWith('en') && v.localService)
               || voices.find(v => v.lang?.startsWith('en'))
               || null;
  }

  speak(text, { rate, volume, onstart, onend }) {
    if (!this._synth) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this._voice) u.voice = this._voice;
    u.lang = this._voice?.lang ?? 'en-GB';
    u.rate = rate;
    u.volume = volume;
    u.onstart = onstart;
    u.onend = onend;
    u.onerror = onend;
    this._current = u;
    this._synth.speak(u);
  }

  cancel() {
    this._synth?.cancel();
  }

  /** A silent utterance from a user gesture unlocks speech on Android. */
  unlock() {
    if (!this._synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this._synth.speak(u);
  }
}

export function createVoice() {
  const backend = new WebSpeechBackend();
  const queue = new VoiceQueue({ backend });
  queue.unlock = () => backend.unlock();
  queue.available = !!window.speechSynthesis;
  return queue;
}
