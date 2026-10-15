/**
 * js/audio/tones.js — instant Web Audio tones, no files (§8.2).
 * The AudioContext is created on first use, which must follow a user gesture.
 */

export class Tones {
  constructor() {
    this._ctx = null;
    this.enabled = true;
  }

  /** Call from a tap handler so later tones can play without a gesture. */
  unlock() {
    this._ensure();
  }

  _ensure() {
    if (!this._ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this._ctx = new Ctx();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  _note(freq, durSec, { type = 'sine', gain = 0.3, at = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    osc.start(t);
    osc.stop(t + durSec + 0.02);
  }

  /** Learn-mode "throw now" cue. */
  cue()      { this._note(900, 0.05, { gain: 0.25 }); }
  /** After a combo announcement. */
  go()       { this._note(1100, 0.15, { gain: 0.35 }); }
  /** Clean rep: bright two-note chime, upward. */
  clean()    { this._note(880, 0.09, { gain: 0.25 }); this._note(1320, 0.14, { gain: 0.25, at: 0.08 }); }
  /** Good rep: single soft note. */
  good()     { this._note(660, 0.12, { gain: 0.2 }); }
  /** Fix rep: low soft thud, not harsh. */
  fix()      { this._note(180, 0.16, { type: 'triangle', gain: 0.3 }); }
  /** 3-2-1 countdown beep (the last one higher). */
  count(n)   { this._note(n === 1 ? 1000 : 800, 0.12, { gain: 0.35 }); }
  /** Round start/end bell. */
  bell() {
    this._note(1200, 0.7, { gain: 0.35 });
    this._note(1800, 0.5, { gain: 0.12, at: 0.01 });
  }
}
