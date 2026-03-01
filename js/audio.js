/**
 * js/audio.js — Audio Manager
 * Handles TTS callouts (Web Speech API) and synthesised tones (Web Audio API).
 * AudioContext is created lazily on the first user interaction.
 */

export class AudioManager {
  constructor() {
    this._ctx      = null;
    this._synth    = window.speechSynthesis;
    this._voice    = null;

    // Configurable
    this.rate      = 1.3;
    this.pitch     = 0.9;
    this.volume    = 1.0;
    this.ttsEnabled  = true;
    this.tonesEnabled = true;
  }

  /** Call once (ideally after a user gesture) to set up AudioContext. */
  async init() {
    // Pre-warm speechSynthesis on Android (requires user gesture later,
    // but loading voices now avoids the first-speak delay).
    if (this._synth.getVoices().length === 0) {
      await new Promise(resolve => {
        this._synth.addEventListener('voiceschanged', resolve, { once: true });
        setTimeout(resolve, 500); // fallback if event never fires
      });
    }
    this._pickVoice();
  }

  /** Create AudioContext on demand (requires user gesture). */
  _ensureCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  }

  _pickVoice() {
    const voices = this._synth.getVoices();
    // Prefer English voices; on Pixel the Google TTS is typically first
    this._voice = voices.find(v => v.lang.startsWith('en') && v.localService)
               || voices.find(v => v.lang.startsWith('en'))
               || voices[0]
               || null;
  }

  /**
   * Speak text via TTS.
   * @param {string} text
   */
  speak(text) {
    if (!this.ttsEnabled || !text) return;
    this._synth.cancel(); // interrupt any in-flight utterance
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice  = this._voice;
    utter.rate   = this.rate;
    utter.pitch  = this.pitch;
    utter.volume = this.volume;
    this._synth.speak(utter);
  }

  /** Silent utterance to unlock speechSynthesis on Android. */
  unlockTTS() {
    const utter = new SpeechSynthesisUtterance(' ');
    utter.volume = 0;
    this._synth.speak(utter);
  }

  // ── Synthesised tones ──────────────────────────────────────

  /**
   * Play a synthesised tone.
   * @param {number}  freq      Hz
   * @param {number}  duration  seconds
   * @param {string}  type      OscillatorNode.type
   * @param {number}  [gain=0.3]
   */
  playTone(freq, duration, type = 'sine', gain = 0.3) {
    if (!this.tonesEnabled) return;
    const ctx = this._ensureCtx();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();

    osc.connect(g);
    g.connect(ctx.destination);

    osc.type      = type;
    osc.frequency.value = freq;

    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /**
   * Play an ascending sequence of tones.
   * @param {number[]} freqs
   * @param {number}   noteDuration  seconds per note
   */
  playSequence(freqs, noteDuration = 0.08) {
    if (!this.tonesEnabled) return;
    const ctx = this._ensureCtx();
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g);
      g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * noteDuration;
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + noteDuration);
      osc.start(t);
      osc.stop(t + noteDuration + 0.01);
    });
  }

  // ── Named sound events ─────────────────────────────────────

  /** 3-2-1 countdown beeps. */
  playCountdown() {
    [800, 800, 800].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.12, 'sine', 0.4), i * 1000);
    });
  }

  /** Round-start bell. */
  playBell() {
    this.playTone(1200, 0.6, 'sine', 0.5);
    setTimeout(() => this.playTone(1000, 0.4, 'sine', 0.2), 120);
  }

  /** Correct move confirmation. */
  playHit() {
    this.playTone(1000, 0.08, 'sine', 0.25);
  }

  /** Miss / wrong move. */
  playMiss() {
    this.playTone(200, 0.15, 'sawtooth', 0.2);
  }

  /** Full combo completed. */
  playComboComplete() {
    // C5-E5-G5 ascending chime
    this.playSequence([523, 659, 784], 0.08);
  }

  /** Round end. */
  playRoundEnd() {
    // Descending bell
    this.playSequence([1000, 850, 700], 0.1);
  }
}
