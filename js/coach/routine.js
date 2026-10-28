/**
 * js/coach/routine.js — a scripted, called-out routine (used by the angle test).
 *
 * Pure timeline: feed it "active" milliseconds (time the user was in frame)
 * and it returns what to say and when to beep. Never waits on speech events;
 * the lead-in before the first beep comes from an estimated speech duration
 * (spec §8.4).
 *
 * Step shapes:
 *   { id, say, holdMs }                        speak, then hold for holdMs
 *   { id, say, reps: { count, intervalMs, label } }  speak, then a cue per rep
 *   { id, say, walkout: true }                 speak, then wait for walkoutDone()
 *   { id, say }                                speak and finish
 */

const LEAD_IN_MARGIN_MS = 800;

export class Routine {
  /**
   * @param {Array<object>} steps
   * @param {(text:string) => number} estimateMs  speech duration estimate
   */
  constructor(steps, estimateMs) {
    this.steps = steps;
    this._estimate = estimateMs;
    this.index = -1;
    this._stepStart = 0;
    this._leadIn = 0;
    this._nextRep = 0;
    this._walkedOut = false;
    this.done = false;
  }

  get step() {
    return this.steps[this.index] ?? null;
  }

  /** Called by the screen once the user has walked out and come back. */
  walkoutDone() {
    if (this.step?.walkout) this._walkedOut = true;
  }

  /**
   * @param {number} activeMs  accumulated in-frame time
   * @returns {Array<{type:'step'|'say'|'cue'|'done', ...}>}
   */
  update(activeMs) {
    const out = [];
    if (this.done) return out;
    if (this.index < 0) this._begin(0, activeMs, out);

    // Loop so that zero-length steps chain within one update.
    for (let guard = 0; guard < this.steps.length + 1 && !this.done; guard++) {
      const s = this.step;
      const t = activeMs - this._stepStart - this._leadIn;
      let finished = false;

      if (s.reps) {
        while (this._nextRep < s.reps.count && t >= this._nextRep * s.reps.intervalMs) {
          out.push({ type: 'cue', step: s.id, label: s.reps.label, rep: this._nextRep + 1, of: s.reps.count });
          this._nextRep++;
        }
        finished = t >= s.reps.count * s.reps.intervalMs;
      } else if (s.holdMs !== undefined) {
        finished = t >= s.holdMs;
      } else if (s.walkout) {
        finished = this._walkedOut;
      } else {
        finished = t >= 0;
      }

      if (!finished) break;
      if (this.index + 1 >= this.steps.length) {
        this.done = true;
        out.push({ type: 'done' });
      } else {
        this._begin(this.index + 1, activeMs, out);
      }
    }
    return out;
  }

  _begin(i, activeMs, out) {
    this.index = i;
    this._stepStart = activeMs;
    this._nextRep = 0;
    this._walkedOut = false;
    const s = this.step;
    this._leadIn = s.say ? this._estimate(s.say) + LEAD_IN_MARGIN_MS : 0;
    out.push({ type: 'step', step: s.id, index: i });
    if (s.say) out.push({ type: 'say', step: s.id, text: s.say });
  }

  /** Remaining in-frame time, roughly (for the on-screen timer). */
  remainingMs(activeMs) {
    let total = 0;
    for (let i = Math.max(0, this.index); i < this.steps.length; i++) {
      const s = this.steps[i];
      const lead = s.say ? this._estimate(s.say) + LEAD_IN_MARGIN_MS : 0;
      const body = s.reps ? s.reps.count * s.reps.intervalMs : (s.holdMs ?? 0);
      total += lead + body;
    }
    if (this.index >= 0) total -= activeMs - this._stepStart;
    return Math.max(0, total);
  }
}
