/**
 * js/audio/voice-queue.js — the one and only path to speech (§8.4).
 *
 * Priorities: 0 = frame events, 1 = guard, 2 = instructions/summaries,
 * 3 = praise. A higher priority (lower number) cuts off a lower one; equal
 * priority waits its turn.
 *
 * The queue never waits on the engine's `end` event to move on: each item is
 * given an estimated duration, and the queue advances when that timer fires.
 * `onend` may advance it sooner, but only if it arrives after a plausible
 * share of the estimate (Android can fire `end` immediately, or never).
 * A start watchdog re-issues an utterance once if `onstart` never arrives.
 *
 * Pure apart from the injected backend and timer functions, so it is
 * unit-testable with a fake clock.
 */

export const PRIORITY = Object.freeze({ FRAME: 0, GUARD: 1, INFO: 2, PRAISE: 3 });

/** Items not started within this time are dropped (stale cues). */
const DEFAULT_MAX_WAIT_MS = { 0: 2500, 1: 2000, 2: Infinity, 3: 1500 };

const CHARS_PER_SEC_AT_RATE_1 = 14;
const MARGIN_MS = 400;
const MIN_MS = 700;
const EARLY_END_FRACTION = 0.4;
const START_WATCHDOG_MS = 1200;

/** Estimated speaking time for `text` at `rate`, in ms. */
export function estimateSpeechMs(text, rate = 1) {
  const chars = (text ?? '').length;
  return Math.max(MIN_MS, (chars / (CHARS_PER_SEC_AT_RATE_1 * rate)) * 1000 + MARGIN_MS);
}

export class VoiceQueue {
  /**
   * @param {object} deps
   * @param {{speak(text, opts):void, cancel():void}} deps.backend
   *        speak opts: { rate, volume, onstart, onend }
   * @param {() => number} [deps.now]
   * @param {(fn, ms) => any} [deps.setTimer]
   * @param {(id) => void} [deps.clearTimer]
   */
  constructor({
    backend,
    now = () => performance.now(),
    // Wrapped: calling a bare setTimeout as a method throws "Illegal invocation".
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
  }) {
    this._backend = backend;
    this._now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._queue = [];
    this._current = null;
    this._timer = null;
    this._watchdog = null;
    this._hold = false;
    this._seq = 0;
    this.rate = 1;
    this.volume = 1;
    this.enabled = true;
    this.onSpeak = null;   // optional hook (debug overlay): (text, priority) => void
  }

  /**
   * Queue a line.
   * @param {string} text
   * @param {object} [opts]
   * @param {number} [opts.priority=2]
   * @param {string} [opts.key]       replaces any queued item with the same key
   * @param {number} [opts.maxWaitMs] drop if not started within this time
   * @returns {number} estimated ms until this line finishes (from now)
   */
  say(text, { priority = PRIORITY.INFO, key = null, maxWaitMs } = {}) {
    if (!this.enabled || !text) return 0;
    const now = this._now();
    if (key) this._queue = this._queue.filter(i => i.key !== key);
    const item = {
      id: ++this._seq, text, priority, key,
      expiresAt: now + (maxWaitMs ?? DEFAULT_MAX_WAIT_MS[priority] ?? Infinity),
      estimateMs: estimateSpeechMs(text, this.rate),
    };

    if (this._current && priority < this._current.priority) {
      this._stopCurrent(true);
    }
    this._queue.push(item);
    this._queue.sort((a, b) => a.priority - b.priority || a.id - b.id);
    this._pump();
    return this._etaFor(item);
  }

  /** While held, only priority 0 may speak (no speech mid-strike, §8.4). */
  setHold(on) {
    this._hold = !!on;
    if (!on) this._pump();
  }

  get busy() {
    return !!this._current;
  }

  get pending() {
    return this._queue.length;
  }

  cancelAll() {
    this._queue = [];
    this._stopCurrent(true);
  }

  // ── internals ────────────────────────────────────────────

  _etaFor(item) {
    const now = this._now();
    let eta = this._current && this._current !== item
      ? Math.max(0, this._current.endsAt - now) : 0;
    for (const q of this._queue) {
      eta += q.estimateMs;
      if (q === item) return eta;
    }
    return item === this._current ? Math.max(0, item.endsAt - now) : eta;
  }

  _pump() {
    if (this._current) return;
    const now = this._now();
    this._queue = this._queue.filter(i => i.expiresAt >= now);
    const idx = this._queue.findIndex(i => !this._hold || i.priority === PRIORITY.FRAME);
    if (idx < 0) return;
    const [item] = this._queue.splice(idx, 1);
    this._start(item, false);
  }

  _start(item, isRetry) {
    const now = this._now();
    this._current = item;
    item.startedAt = now;
    item.endsAt = now + item.estimateMs;
    item.started = false;

    this._backend.speak(item.text, {
      rate: this.rate,
      volume: this.volume,
      onstart: () => {
        if (this._current === item) item.started = true;
      },
      onend: () => {
        if (this._current !== item) return;
        const elapsed = this._now() - item.startedAt;
        if (elapsed >= item.estimateMs * EARLY_END_FRACTION) this._advance(item);
      },
    });
    this.onSpeak?.(item.text, item.priority);

    this._timer = this._setTimer(() => this._advance(item), item.estimateMs);
    if (!isRetry) {
      this._watchdog = this._setTimer(() => {
        if (this._current === item && !item.started) {
          // Engine stuck (seen on Android): kick it once and re-issue.
          this._backend.cancel();
          this._clearTimers();
          this._start(item, true);
        }
      }, START_WATCHDOG_MS);
    }
  }

  _advance(item) {
    if (this._current !== item) return;
    this._clearTimers();
    this._current = null;
    this._pump();
  }

  _stopCurrent(cancelEngine) {
    if (!this._current) return;
    this._clearTimers();
    this._current = null;
    if (cancelEngine) this._backend.cancel();
  }

  _clearTimers() {
    if (this._timer !== null) this._clearTimer(this._timer);
    if (this._watchdog !== null) this._clearTimer(this._watchdog);
    this._timer = null;
    this._watchdog = null;
  }
}
