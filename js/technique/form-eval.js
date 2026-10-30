/**
 * js/technique/form-eval.js — grades a completed rep or a hold window (§6.2, §7.3).
 *
 * Every check returns { result: 'pass'|'fail'|'unknown', confidence, value }.
 * Unknown is first-class: when the landmarks a check needs weren't seen
 * well enough, it is excluded from rating and feedback rather than guessed.
 *
 * Thresholds come from the technique JSON and are relative to calibration.
 */

import { angleDiff } from '../pose/geometry.js';

export const RATING = Object.freeze({ CLEAN: 'clean', GOOD: 'good', FIX: 'fix', MISSED: 'missed' });

const unknown = (confidence = 0) => ({ result: 'unknown', confidence, value: null });
const verdict = (pass, value, confidence = 1) => ({ result: pass ? 'pass' : 'fail', confidence, value });

/** Horizontal yaw (deg) of a heel→toe vector from world landmarks. */
function footYaw(world, heel, toe) {
  const a = world[heel];
  const b = world[toe];
  return (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
}

/** Largest absolute change of a yaw series from its first value (unwrapped). */
function maxTurn(series) {
  if (series.length < 2) return null;
  const base = series[0];
  let m = 0;
  for (const v of series) m = Math.max(m, Math.abs(angleDiff(v, base)));
  return m;
}

// ── Strike checks ───────────────────────────────────────────

const STRIKE_CHECKS = {
  /** The non-punching hand stays near calibrated guard height. */
  other_hand_guard(rep, th) {
    const other = rep.arm === 'lead' ? 'rear' : 'lead';
    let worst = Infinity;
    let conf = 1;
    for (const f of rep.frames) {
      const g = f.body.guard[other];
      if (g.delta === null) return unknown();
      if (g.delta < worst) {
        worst = g.delta;
        conf = g.conf;
      }
    }
    if (conf < th.min_conf) return unknown(conf);
    return verdict(worst > -th.drop, worst, conf);
  },

  /** Back from peak to guard quickly. */
  return_to_guard(rep, th) {
    const ms = rep.tEnd - rep.tPeak;
    return verdict(ms <= th.max_ms, ms);
  },

  /** Peak reach vs the calibrated full reach. */
  extension(rep, th, calib) {
    const full = calib?.reach?.lead;
    if (!full) return unknown();
    const reach = rep.peakBody.reach[rep.arm];
    const conf = rep.peakBody.confidence[rep.arm].arm;
    if (conf < 0.5) return unknown(conf);
    return verdict(reach >= th.reach_fraction * full, reach / full, conf);
  },

  /** Shoulders turn during the punch (from start to peak). */
  rotation(rep, th) {
    // Needs the moments before launch (hips turn first). A rep that starts
    // straight after another has no clean "before", so don't guess.
    const preMs = rep.pre?.length ? rep.tStart - rep.pre[0].t : 0;
    if (preMs < 250) return unknown(0.3);
    const upToPeak = [...(rep.pre ?? []), ...rep.frames].filter(f => f.t <= rep.tPeak && !f.glitch);
    const conf = Math.min(...upToPeak.map(f => f.body.confidence.shoulders));
    if (!Number.isFinite(conf) || conf < 0.5) return unknown(conf);
    const turn = maxTurn(upToPeak.map(f => f.body.shoulderYaw));
    if (turn === null) return unknown();
    return verdict(turn >= th.min_deg, turn, conf);
  },

  /** Rear foot pivots (heel→toe direction turns). */
  pivot(rep, th) {
    const frames = [...(rep.pre ?? []), ...rep.frames]
      .filter(f => f.t <= rep.tPeak + 150 && !f.glitch && f.world && f.image);
    if (frames.length < 2) return unknown();
    const s = frames[0].body.sides.rear;
    // Average, not minimum: the rear foot flickers as it turns.
    const conf = frames.reduce((a, f) => a + Math.min(f.image[s.heel].visibility, f.image[s.foot].visibility), 0) / frames.length;
    if (conf < th.min_conf) return unknown(conf);
    const turn = maxTurn(frames.map(f => footYaw(f.world, s.heel, s.foot)));
    return verdict(turn >= th.min_deg, turn, conf);
  },
};

// ── Hold checks (stance, guard): judged over a window of frames ──

const HOLD_CHECKS = {
  hands_up(frames, th) {
    return fractionOk(frames, f => {
      const g = f.body.guard;
      if (g.lead.delta === null || Math.min(g.lead.conf, g.rear.conf) < th.min_conf) return null;
      return g.lead.delta > -th.drop && g.rear.delta > -th.drop;
    }, th.ok_fraction);
  },

  elbows_in(frames, th, calib) {
    return fractionOk(frames, f => {
      const b = f.body;
      if (Math.min(b.confidence.lead.arm, b.confidence.rear.arm) < th.min_conf) return null;
      return ['lead', 'rear'].every(s => elbowOut(b, s) - (calib?.elbows?.[s]?.out ?? 0) < th.max_out);
    }, th.ok_fraction);
  },

  lead_foot_forward(frames, th) {
    return fractionOk(frames, f => {
      const st = f.body.stance;
      if (st.conf < th.min_conf) return null;
      return st.leadForward > th.min_forward;
    }, th.ok_fraction);
  },

  stance_width(frames, th, calib) {
    const ref = calib?.stanceWidth;
    if (!ref) return unknown();
    return fractionOk(frames, f => {
      const st = f.body.stance;
      if (st.conf < th.min_conf) return null;
      return Math.abs(st.width - ref) / ref <= th.band;
    }, th.ok_fraction);
  },

  upright(frames, th, calib) {
    const ref = calib?.torsoLean ?? 0;
    return fractionOk(frames, f => Math.abs(f.body.torsoLean - ref) <= th.max_lean_change, th.ok_fraction);
  },
};

/** Elbow's sideways offset from its shoulder (+ = outside the shoulder line). */
function elbowOut(b, side) {
  const j = b.joints;
  const midX = (j.lead.shoulder.x + j.rear.shoulder.x) / 2;
  const sign = Math.sign(j[side].shoulder.x - midX) || 1;
  return sign * (j[side].elbow.x - j[side].shoulder.x);
}

/** Pass if ≥ okFraction of measurable frames pass; unknown if under half were measurable. */
function fractionOk(frames, test, okFraction) {
  let measured = 0;
  let ok = 0;
  for (const f of frames) {
    if (!f.body?.valid || f.glitch) continue;
    const r = test(f);
    if (r === null) continue;
    measured++;
    if (r) ok++;
  }
  if (measured < Math.max(3, frames.length * 0.5)) return unknown(measured / Math.max(1, frames.length));
  return verdict(ok / measured >= okFraction, ok / measured, measured / frames.length);
}

// ── Public API ──────────────────────────────────────────────

/**
 * Grade a strike rep.
 * @param {object} def     technique definition (the one that was asked for)
 * @param {object} rep     RepDetector output
 * @param {object} calib
 * @returns {{technique, expected, rating, checks: Object<string, object>, faults: string[]}}
 */
export function evaluateRep(def, rep, calib) {
  if (rep.technique !== def.id) {
    return { technique: rep.technique, expected: def.id, rating: RATING.MISSED, wrongTechnique: true, checks: {}, faults: [] };
  }
  const checks = {};
  for (const c of def.checks) {
    const fn = STRIKE_CHECKS[c.id];
    checks[c.id] = fn ? fn(rep, c.threshold ?? {}, calib) : unknown();
  }
  return grade(def, checks);
}

/**
 * Grade one window of a hold drill (stance, guard).
 * @param {object} def
 * @param {Array} frames  pipeline frames in the window
 */
export function evaluateHold(def, frames, calib) {
  const checks = {};
  for (const c of def.checks) {
    const fn = HOLD_CHECKS[c.id];
    checks[c.id] = fn ? fn(frames, c.threshold ?? {}, calib) : unknown();
  }
  return grade(def, checks);
}

function grade(def, checks) {
  const failed = def.checks.filter(c => checks[c.id].result === 'fail');
  const rating = failed.some(c => c.severity === 'major') ? RATING.FIX
    : failed.length ? RATING.GOOD
      : RATING.CLEAN;
  return { technique: def.id, expected: def.id, rating, checks, faults: failed.map(c => c.id) };
}
