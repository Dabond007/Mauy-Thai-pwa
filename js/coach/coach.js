/**
 * js/coach/coach.js — feedback policy (§8): what to say, and when.
 *
 * Pure. Immediate voice is limited to guard and frame events; every other
 * fault waits for the end-of-set summary, which follows the bandwidth rule
 * (only faults in ≥ 30 % of reps, ≥ 2 reps for guard faults), leads with a
 * positive and gives one focus cue. Feedback fades as mastery rises.
 */

import { RATING } from '../technique/form-eval.js';

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = n => WORDS[n] ?? String(n);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

/** Fault priority (§8.3): guard → return-to-guard → technique-defining → minor. */
const PRIORITY = {
  other_hand_guard: 0, hands_up: 0,
  return_to_guard: 1,
  rotation: 2, pivot: 2, extension: 2, lead_foot_forward: 2, stance_width: 2,
};
const GUARD_CHECKS = new Set(['other_hand_guard', 'hands_up']);

export const BANDWIDTH = 0.3;

/** Limits per set for immediate voice, scaled by verbosity (§8.1, §8.4). */
export const VERBOSITY_LIMITS = {
  quiet: { handsUpPerSet: 1, thatsItPerSet: 0 },
  normal: { handsUpPerSet: 2, thatsItPerSet: 1 },
  chatty: { handsUpPerSet: 3, thatsItPerSet: 2 },
};

/**
 * "Hands up" monitor: guard below calibrated height for > holdMs outside a
 * strike, at most once per cooldownMs and maxPerSet times per set.
 */
export class GuardMonitor {
  constructor({ drop = 0.5, holdMs = 1500, cooldownMs = 10000, maxPerSet = 2, minConf = 0.4 } = {}) {
    this.o = { drop, holdMs, cooldownMs, maxPerSet, minConf };
    this.startSet();
  }

  startSet() {
    this._downSince = null;
    this._lastSaid = -Infinity;
    this.said = 0;
  }

  /**
   * @param {object} frame     pipeline frame
   * @param {boolean} striking a rep is in progress (LAUNCH/PEAK/RETURN)
   * @returns {boolean} true when "Hands up" should be said now
   */
  update(frame, striking) {
    const b = frame.body;
    if (!b?.valid || frame.glitch || striking) {
      if (striking) this._downSince = null;
      return false;
    }
    const g = b.guard;
    if (g.lead.delta === null) return false;
    const seen = Math.min(g.lead.conf, g.rear.conf) >= this.o.minConf;
    const down = seen && (g.lead.delta < -this.o.drop || g.rear.delta < -this.o.drop);
    if (!down) {
      this._downSince = null;
      return false;
    }
    this._downSince ??= frame.t;
    if (frame.t - this._downSince < this.o.holdMs) return false;
    if (frame.t - this._lastSaid < this.o.cooldownMs || this.said >= this.o.maxPerSet) return false;
    this._lastSaid = frame.t;
    this._downSince = null;
    this.said++;
    return true;
  }
}

/**
 * Per-check pass/fail tallies over a set's attempted reps.
 * @returns {Object<string, {pass, fail, measured, failRate, passRate}>}
 */
export function tallyChecks(results) {
  const t = {};
  for (const r of results) {
    for (const [id, c] of Object.entries(r.checks ?? {})) {
      t[id] ??= { pass: 0, fail: 0, measured: 0 };
      if (c.result === 'unknown') continue;
      t[id].measured++;
      t[id][c.result]++;
    }
  }
  for (const v of Object.values(t)) {
    v.failRate = v.measured ? v.fail / v.measured : 0;
    v.passRate = v.measured ? v.pass / v.measured : 0;
  }
  return t;
}

/** The single focus for the next set, or null if nothing passes the bandwidth rule. */
export function pickFocus(def, results, bandwidth = BANDWIDTH) {
  const tally = tallyChecks(results);
  const eligible = def.checks.filter(c => {
    const t = tally[c.id];
    if (!t || !t.measured) return false;
    return GUARD_CHECKS.has(c.id) ? t.fail >= 2 : t.failRate >= bandwidth;
  });
  eligible.sort((a, b) =>
    (PRIORITY[a.id] ?? 3) - (PRIORITY[b.id] ?? 3) ||
    (a.severity === 'major' ? 0 : 1) - (b.severity === 'major' ? 0 : 1) ||
    tally[b.id].failRate - tally[a.id].failRate);
  const c = eligible[0];
  return c ? { id: c.id, cue: c.cue, failRate: tally[c.id].failRate } : null;
}

/** The best-performing measured check, phrased as praise. */
export function pickPositive(def, results) {
  const tally = tallyChecks(results);
  const ok = def.checks
    .filter(c => tally[c.id]?.measured >= 2 && tally[c.id].passRate >= 0.75)
    .sort((a, b) => tally[b.id].passRate - tally[a.id].passRate || (PRIORITY[a.id] ?? 3) - (PRIORITY[b.id] ?? 3));
  return ok[0] ? { id: ok[0].id, text: ok[0].praise } : null;
}

/**
 * End-of-set summary (§8.3): result count → one positive → one focus.
 * @param {object} p
 * @param {object} p.def          technique definition
 * @param {Array}  p.results      per-rep results (form-eval output, or {rating:'missed', noAttempt:true})
 * @param {string} [p.mastery]    new | learning | solid | sharp
 * @returns {{lines: string[], speak: boolean, focus: object|null, positive: object|null, counts: object}}
 */
export function summarizeSet({ def, results, mastery = 'learning' }) {
  const counts = { clean: 0, good: 0, fix: 0, missed: 0 };
  for (const r of results) counts[r.rating]++;
  const total = results.length;
  const attempted = results.filter(r => !r.noAttempt && !r.wrongTechnique);
  const lines = [];

  if (counts.clean === total) lines.push(`All ${word(total)} clean.`);
  else lines.push(`${cap(word(counts.clean))} of ${word(total)} clean.`);

  const wrong = results.filter(r => r.wrongTechnique);
  if (wrong.length >= 2) {
    const looked = wrong[0].technique === 'cross' ? 'a cross' : wrong[0].technique === 'jab' ? 'a jab' : wrong[0].technique;
    lines.push(`I asked for ${def.id === 'jab' ? 'a jab' : def.id === 'cross' ? 'a cross' : def.name.toLowerCase()} — that looked like ${looked}.`);
  }

  const positive = pickPositive(def, attempted);
  let focus = pickFocus(def, attempted);
  if (mastery === 'solid' && focus && focus.failRate <= BANDWIDTH) focus = null;

  if (lines.length < 2) {
    lines.push(positive ? `${positive.text}.` : attempted.length ? 'Good work, keep going.' : 'Let’s get those reps in.');
  }
  lines.push(focus ? `Next set: ${lower(focus.cue)}.` : 'Same again — keep it sharp.');

  return {
    lines: lines.slice(0, 3),
    speak: mastery !== 'sharp',
    focus,
    positive,
    counts,
  };
}

/**
 * "That's it": the first clean-on-that-check rep after a focus was given,
 * limited per set (§8.1).
 */
export class PraiseTracker {
  constructor(maxPerSet = 1) {
    this.maxPerSet = maxPerSet;
    this.focusId = null;
    this.startSet();
  }

  setFocus(id) {
    this.focusId = id;
  }

  startSet() {
    this.said = 0;
  }

  /** @returns {boolean} true when "That's it" should be said for this rep */
  onRep(result) {
    if (!this.focusId || this.said >= this.maxPerSet) return false;
    const c = result.checks?.[this.focusId];
    if (c?.result === 'pass' && (result.rating === RATING.CLEAN || result.rating === RATING.GOOD)) {
      this.said++;
      return true;
    }
    return false;
  }
}
