/**
 * js/pose/calibration.js — calibration state machine (§7.2).
 *
 * Steps:
 *   1. handedness  "Raise your left hand above your head" → records swapSides
 *   2. stance      "Get in your fighting stance and hold still" → proposes
 *                  orthodox/southpaw, waits for the user to confirm, stores
 *                  stance width, guard height, elbows, torso angle, rotations
 *   3. reach       "Throw three slow jabs" → full-extension reach (skippable)
 *
 * Pure: feed it filtered frames {t, image, world}; it returns what to show.
 */

import { LM, sideMap, REQUIRED, minEntryVisibility } from './landmarks.js';
import { computeBody } from './body-model.js';
import { median, mean } from './geometry.js';

export const CALIBRATION_VERSION = 1;

export const CALIB_DEFAULTS = Object.freeze({
  raiseHoldMs: 1000,
  raiseMargin: 1.0,         // wrist above the nose by ≥ one nose→shoulder-line height
  stillHoldMs: 2000,
  stillMaxDrift: 0.25,      // body units any tracked joint may wander while "still"
  sampleMs: 1000,           // averaging window once still
  reachReps: 3,
  reachOut: 0.3,            // body units beyond guard reach to count as a jab...
  elbowOpen: 40,            // ...or the elbow opening this many degrees past guard
  elbowMin: 130,            //    and to at least this angle
  reachBack: 0.15,          // back within this of guard reach (and elbow re-bent) = rep done
  reachMinVisibility: 0.5,
  reachTimeoutMs: 45000,
  minVisibility: 0.6,
});

export const STEPS = Object.freeze({
  HANDEDNESS: 'handedness',
  STANCE: 'stance',
  CONFIRM_STANCE: 'confirm_stance',
  REACH: 'reach',
  DONE: 'done',
});

export const PROMPTS = Object.freeze({
  handedness: 'Raise your left hand above your head.',
  stance: 'Get in your fighting stance, hands up, and hold still.',
  reach: 'Throw three slow jabs, back to guard each time.',
  done: 'Calibration done.',
});

export class Calibrator {
  /**
   * @param {object} [opts]
   * @param {object} [opts.previous]  existing calibration, used as fallback for
   *                                  swapSides when the handedness step is skipped
   */
  constructor(opts = {}) {
    this.o = { ...CALIB_DEFAULTS, ...opts };
    this._previous = opts.previous ?? null;
    this.step = STEPS.HANDEDNESS;
    this.result = { version: CALIBRATION_VERSION, swapSides: this._previous?.swapSides ?? false };
    this._raise = null;          // { index, since }
    this._stillSince = null;
    this._anchor = null;
    this._samples = [];
    this._prevBody = null;
    this._proposal = null;
    this._reach = null;
  }

  get prompt() {
    if (this.step === STEPS.CONFIRM_STANCE) return this.proposalText;
    return PROMPTS[this.step] ?? '';
  }

  get proposal() { return this._proposal; }

  get proposalText() {
    if (!this._proposal) return '';
    const foot = this._proposal.stance === 'orthodox' ? 'Left' : 'Right';
    return `${foot} foot forward — ${this._proposal.stance}. Is that right?`;
  }

  /**
   * @param {{t, image, world}} frame  filtered landmarks; t in ms
   * @returns {{step, prompt, progress:number, event?:string}}
   */
  update(frame) {
    switch (this.step) {
      case STEPS.HANDEDNESS: return this._handedness(frame);
      case STEPS.STANCE:     return this._stance(frame);
      case STEPS.REACH:      return this._reachStep(frame);
      default:               return this._out(1);
    }
  }

  _out(progress, event) {
    return { step: this.step, prompt: this.prompt, progress, event };
  }

  // ── 1. Handedness ────────────────────────────────────────

  _handedness({ t, image }) {
    if (!image) { this._raise = null; return this._out(0); }
    // Vertical reference in image-y units (x and y are normalised separately,
    // so a horizontal distance can't be used as a vertical margin).
    const nose = image[LM.NOSE];
    const shY = (image[LM.L_SHOULDER].y + image[LM.R_SHOULDER].y) / 2;
    const neck = Math.max(1e-3, shY - nose.y);
    const above = i => (image[i].visibility ?? 0) >= this.o.minVisibility &&
      image[i].y < nose.y - this.o.raiseMargin * neck;
    // The other hand may stay in guard (even at eyebrow height); it just has
    // to be clearly lower than the raised one.
    const clearlyBelow = (i, raisedIdx) => image[i].y > image[raisedIdx].y + neck;

    let raised = null;
    if (above(LM.L_WRIST) && clearlyBelow(LM.R_WRIST, LM.L_WRIST)) raised = LM.L_WRIST;
    else if (above(LM.R_WRIST) && clearlyBelow(LM.L_WRIST, LM.R_WRIST)) raised = LM.R_WRIST;

    if (raised === null) { this._raise = null; return this._out(0); }
    if (!this._raise || this._raise.index !== raised) this._raise = { index: raised, since: t };

    const held = t - this._raise.since;
    if (held < this.o.raiseHoldMs) return this._out(held / this.o.raiseHoldMs);

    this.result.swapSides = raised === LM.R_WRIST;
    this.result.handednessChecked = true;
    this.step = STEPS.STANCE;
    return this._out(1, 'handedness_done');
  }

  /** Skip the handedness check (keeps the previous mapping, or MediaPipe's labels). */
  skipHandedness() {
    if (this.step !== STEPS.HANDEDNESS) return;
    this.result.handednessChecked = this._previous?.handednessChecked ?? false;
    this.step = STEPS.STANCE;
  }

  // ── 2. Stance ────────────────────────────────────────────

  _stance(frame) {
    // Body computed with the user's real left as "lead" so we can tell which
    // foot is forward without knowing the stance yet.
    const body = computeBody(frame, { swapSides: this.result.swapSides, stance: 'orthodox' }, this._prevBody);
    this._prevBody = body;
    const t = frame.t;

    const visible = frame.image && minEntryVisibility(frame.image, [
      ...REQUIRED.full, LM.L_WRIST, LM.R_WRIST,
    ]) >= this.o.minVisibility;

    const handsUp = body.valid && body.guard.lead.height > -1.0 && body.guard.rear.height > -1.0;

    // Stillness = no tracked joint drifts far from where it was when the hold
    // began. Robust to frame-to-frame jitter, unlike a per-frame speed limit.
    const drift = body.valid && this._anchor ? maxDrift(body, this._anchor) : Infinity;
    if (!visible || !handsUp || drift > this.o.stillMaxDrift) {
      this._anchor = body.valid ? body : null;
      this._stillSince = visible && handsUp ? t : null;
      this._samples = [];
      return this._out(0);
    }
    const held = t - this._stillSince;
    if (held >= this.o.stillHoldMs - this.o.sampleMs) this._samples.push(body);
    if (held < this.o.stillHoldMs) return this._out(held / this.o.stillHoldMs);

    this._proposal = proposeStance(this._samples);
    this._stanceSamples = this._samples;
    this.step = STEPS.CONFIRM_STANCE;
    return this._out(1, 'stance_proposed');
  }

  /**
   * The user confirms (or corrects) the proposed stance.
   * @param {'orthodox'|'southpaw'} stance
   */
  confirmStance(stance) {
    if (this.step !== STEPS.CONFIRM_STANCE) return;
    Object.assign(this.result, measureStance(this._stanceSamples, stance, this.result.swapSides));
    this.result.stance = stance;
    this.step = STEPS.REACH;
    this._prevBody = null;
  }

  // ── 3. Reach ─────────────────────────────────────────────

  _reachStep(frame) {
    const t = frame.t;
    this._reach ??= { activeMs: 0, lastT: null, armed: true, current: 0, peaks: [], elbowAtPeak: [] };
    const r = this._reach;

    // The timeout counts only time the user is actually in frame.
    if (r.lastT !== null) r.activeMs += Math.min(100, t - r.lastT);
    r.lastT = t;
    if (r.activeMs > this.o.reachTimeoutMs) {
      this.skipReach();
      return this._out(1, 'reach_timeout');
    }

    const body = computeBody(frame, this.result, this._prevBody);
    this._prevBody = body;
    if (!body.valid || body.confidence.lead.arm < this.o.reachMinVisibility) {
      r.live = { conf: body.valid ? body.confidence.lead.arm : 0 };
      return this._out(r.peaks.length / this.o.reachReps);
    }

    // A jab straight at the camera is mostly depth, which the front camera
    // judges poorly, so either cue counts: the wrist moving away from the
    // shoulder, or the elbow opening up.
    const guardReach = this.result.guardReach?.lead ?? 0.8;
    const guardElbow = this.result.guardElbow?.lead ?? 70;
    const d = body.reach.lead;
    const elbow = body.angles.lead.elbow;
    const out = d > guardReach + this.o.reachOut ||
      (elbow > Math.max(guardElbow + this.o.elbowOpen, this.o.elbowMin) && d > guardReach + this.o.reachBack);
    const back = d < guardReach + this.o.reachBack && elbow < guardElbow + this.o.elbowOpen;
    r.live = { d, guardReach, elbow, guardElbow, armed: r.armed, conf: body.confidence.lead.arm };

    if (r.armed && out) {
      r.armed = false;
      r.current = d;
      r.currentElbow = elbow;
    } else if (!r.armed) {
      if (d > r.current) {
        r.current = d;
        r.currentElbow = elbow;
      }
      if (back) {
        r.peaks.push(r.current);
        r.elbowAtPeak.push(r.currentElbow);
        r.armed = true;
        if (r.peaks.length >= this.o.reachReps) {
          this.result.reach = {
            lead: median(r.peaks),
            elbowAngle: median(r.elbowAtPeak),
          };
          this._finish();
          return this._out(1, 'done');
        }
        return this._out(r.peaks.length / this.o.reachReps, 'reach_rep');
      }
    }
    return this._out(r.peaks.length / this.o.reachReps);
  }

  /** Live numbers for the debug overlay and log during the reach step. */
  get reachLive() {
    return this._reach?.live ?? null;
  }

  /**
   * The user left the frame (or isn't settled back in yet): drop anything
   * half-measured so walking around can't count as a held stance or a jab.
   */
  pause() {
    this._raise = null;
    this._stillSince = null;
    this._anchor = null;
    this._samples = [];
    this._prevBody = null;
    if (this._reach) {
      Object.assign(this._reach, { armed: true, current: 0, lastT: null, live: null });
    }
  }

  /** Skip reach capture; extension checks fall back to elbow angle (§6.2). */
  skipReach() {
    if (this.step !== STEPS.REACH) return;
    this.result.reach = null;
    this._finish();
  }

  _finish() {
    this.result.createdAt = Date.now();
    this.step = STEPS.DONE;
  }
}

const DRIFT_JOINTS = ['wrist', 'elbow', 'knee', 'ankle'];

function maxDrift(body, anchor) {
  let m = 0;
  for (const s of ['lead', 'rear']) {
    for (const j of DRIFT_JOINTS) {
      const a = body.joints[s][j];
      const b = anchor.joints[s][j];
      m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return m;
}

/**
 * Decide which foot is forward from averaged stance samples (bodies computed
 * with lead = user's left). Two independent cues:
 *   - world depth: the forward ankle is closer to the camera (smaller z)
 *   - image height: the forward heel sits lower in the frame
 * Agreement → high confidence. Disagreement → trust world depth, low confidence.
 */
export function proposeStance(samples) {
  const depth = median(samples.map(b => b.stance.leadForward));   // + = left foot forward
  const imgCue = median(samples.map(b => b.imageJoints.lead.heel.y - b.imageJoints.rear.heel.y));
  const leftForwardByDepth = depth > 0;
  const leftForwardByImage = imgCue > 0;
  const agree = leftForwardByDepth === leftForwardByImage;
  return {
    stance: leftForwardByDepth ? 'orthodox' : 'southpaw',
    confidence: agree ? 'high' : 'low',
    depth,
  };
}

/** Stance measurements stored in the calibration record. */
export function measureStance(samples, stance, swapSides) {
  // Recompute bodies' lead/rear for the confirmed stance by swapping sides
  // when southpaw (samples were taken with lead = user's left).
  const flip = stance === 'southpaw';
  const pick = (b, side) => (flip ? (side === 'lead' ? 'rear' : 'lead') : side);
  const m = f => mean(samples.map(f));

  const guard = {};
  const elbows = {};
  const guardReach = {};
  const guardElbow = {};
  for (const side of ['lead', 'rear']) {
    guard[side] = { height: m(b => b.guard[pick(b, side)].height) };
    // Elbow sideways offset from its shoulder (+ = outside the shoulder line).
    elbows[side] = {
      out: m(b => {
        const s = pick(b, side);
        const sign = Math.sign(b.joints[s].shoulder.x - (b.joints.lead.shoulder.x + b.joints.rear.shoulder.x) / 2) || 1;
        return sign * (b.joints[s].elbow.x - b.joints[s].shoulder.x);
      }),
    };
    guardReach[side] = m(b => b.reach[pick(b, side)]);
    guardElbow[side] = m(b => b.angles[pick(b, side)].elbow);
  }

  // Yaw baselines are computed user-left → user-right, so stance doesn't change them.
  return {
    swapSides,
    shoulderWidthM: m(b => b.liveShoulderWidth),
    stanceWidth: m(b => b.stance.width),
    stanceLateral: m(b => b.stance.lateral),
    guard,
    elbows,
    guardReach,
    guardElbow,
    torsoLean: m(b => b.torsoLean),
    shoulderYaw: m(b => b.shoulderYaw),
    hipYaw: m(b => b.hipYaw),
  };
}

/** Whether calibration should run before a session (§4.2: first time or 7+ days). */
export function calibrationDue(calib, now = Date.now()) {
  if (!calib || calib.version !== CALIBRATION_VERSION) return true;
  return now - (calib.createdAt ?? 0) > 7 * 24 * 3600 * 1000;
}

export { sideMap };
