/**
 * js/progression.js — XP, streaks, levels, mastery (§9). Pure; persistence
 * is done by the caller (storage key 'progress').
 */

import { RATING } from './technique/form-eval.js';
import { LEARNING_PATH } from './technique/registry.js';

export const XP = Object.freeze({ clean: 10, good: 6, fix: 2, missed: 0 });
export const COMBO_BONUS = 20;
export const MASTERY = Object.freeze({ NEW: 'new', LEARNING: 'learning', SOLID: 'solid', SHARP: 'sharp' });

const MULTIPLIERS = [[20, 3], [10, 2], [5, 1.5]];

/** Cumulative XP needed to reach `level` (level 1 = 0). Gentle curve, fast early levels. */
export function xpForLevel(level) {
  return level <= 1 ? 0 : Math.round(60 * (level - 1) ** 1.6);
}

export function levelFor(xp) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l++;
  return l;
}

const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function emptyProgress() {
  return { version: 1, xp: 0, streak: 0, bestStreak: 0, days: { last: null, count: 0 }, techniques: {}, sessions: 0 };
}

export class Progression {
  /** @param {object|null} data  stored progress (or null for a fresh start) */
  constructor(data = null) {
    this.data = { ...emptyProgress(), ...(data ?? {}) };
  }

  get level() {
    return levelFor(this.data.xp);
  }

  /** XP progress within the current level, 0..1. */
  get levelProgress() {
    const l = this.level;
    const a = xpForLevel(l);
    const b = xpForLevel(l + 1);
    return (this.data.xp - a) / (b - a);
  }

  technique(id) {
    return (this.data.techniques[id] ??= { sets: [], mastery: MASTERY.NEW, reps: 0, clean: 0 });
  }

  mastery(id) {
    return this.data.techniques[id]?.mastery ?? MASTERY.NEW;
  }

  /** Unlocked when every technique in earlier learning-path steps is Solid (§9.3). */
  unlocked(id) {
    for (const step of LEARNING_PATH) {
      if (step.includes(id)) return true;
      if (!step.every(t => [MASTERY.SOLID, MASTERY.SHARP].includes(this.mastery(t)))) return false;
    }
    return true;
  }

  /**
   * Score one rep (§9.1). Streak = Clean/Good reps since the last Missed;
   * multipliers apply to Clean/Good only; a Fix neither adds nor resets.
   * @returns {{xp:number, multiplier:number, streak:number}}
   */
  recordRep(techniqueId, rating) {
    let multiplier = 1;
    if (rating === RATING.CLEAN || rating === RATING.GOOD) {
      this.data.streak++;
      for (const [n, m] of MULTIPLIERS) {
        if (this.data.streak >= n) {
          multiplier = m;
          break;
        }
      }
    } else if (rating === RATING.MISSED) {
      this.data.streak = 0;
    }
    this.data.bestStreak = Math.max(this.data.bestStreak, this.data.streak);
    const xp = Math.round(XP[rating] * multiplier);
    this.data.xp += xp;
    const t = this.technique(techniqueId);
    t.reps++;
    if (rating === RATING.CLEAN) t.clean++;
    return { xp, multiplier, streak: this.data.streak };
  }

  /**
   * Record a finished set and update mastery (§9.2).
   * @param {string} techniqueId
   * @param {Array} results  per-rep results; reps with no measurable check are excluded
   * @param {string} sessionId
   * @returns {{before:string, after:string}}
   */
  endSet(techniqueId, results, sessionId) {
    const t = this.technique(techniqueId);
    const before = t.mastery;
    const measurable = results.filter(r => r.noAttempt || r.wrongTechnique ||
      Object.values(r.checks ?? {}).some(c => c.result !== 'unknown'));
    const good = measurable.filter(r => r.rating === RATING.CLEAN || r.rating === RATING.GOOD).length;
    t.sets.push({ n: measurable.length, good, session: sessionId, at: Date.now() });
    if (t.sets.length > 50) t.sets.splice(0, t.sets.length - 50);

    const rate = s => (s.n ? s.good / s.n : 0);
    let m = MASTERY.LEARNING;
    const last2 = t.sets.slice(-2);
    if (last2.length === 2 && last2.every(s => s.n >= 8 && rate(s) >= 0.8)) m = MASTERY.SOLID;
    // Once Solid, stay at least Solid.
    if (before === MASTERY.SOLID || before === MASTERY.SHARP) m = MASTERY.SOLID;
    const sharpSessions = new Set(t.sets.filter(s => s.n >= 8 && rate(s) >= 0.9).map(s => s.session));
    if (m === MASTERY.SOLID && sharpSessions.size >= 3) m = MASTERY.SHARP;
    if (before === MASTERY.SHARP) m = MASTERY.SHARP;
    t.mastery = m;
    return { before, after: m };
  }

  /** Count a completed session toward the daily streak. */
  completeSession(now = new Date()) {
    const d = today(now);
    const last = this.data.days.last;
    if (last !== d) {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      this.data.days.count = last === today(y) ? this.data.days.count + 1 : 1;
      this.data.days.last = d;
    }
    this.data.sessions++;
  }

  get dailyStreak() {
    const last = this.data.days.last;
    if (!last) return 0;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return last === today() || last === today(y) ? this.data.days.count : 0;
  }
}
