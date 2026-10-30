/**
 * js/technique/rep-detector.js — segments straight punches and identifies them (§7.4).
 *
 *   GUARD ──(either arm extends past LAUNCH)──▶ ACTIVE (LAUNCH → PEAK)
 *   ACTIVE ──(both arms back below RETURN)──▶ GUARD   (rep complete)
 *   ACTIVE ──(no return within 2 s)──▶ GUARD          (rep abandoned)
 *
 * "Extension" per arm, in calibrated units (0 = guard, 1 = full punch):
 *   max( reach gain / calibrated reach gain, elbow opening / calibrated elbow opening )
 * Either cue counts because a front-ish camera reads depth poorly (Phase A
 * logs). Extension only counts while the wrist is near shoulder height, so a
 * hand dropping to the hip (a guard fault, not a punch) can never make a rep.
 *
 * Identification: the arm with the larger peak extension threw the punch —
 * lead = jab, rear = cross. On the 30° angle-test log this labelled all
 * 16 called-out jabs and crosses correctly.
 */

export const REP_DEFAULTS = Object.freeze({
  launch: 0.45,          // extension that starts a rep
  ret: 0.35,             // both arms below this = back to guard
  minPeak: 0.75,         // the punching arm must reach this to count
  maxActiveMs: 2000,
  refractoryMs: 150,
  preRollMs: 400,        // frames kept from before launch (hips start turning first)
  minWristHeight: -0.5,  // wrist vs own shoulder (body units, + = above) for extension to count
  fallbackReachGain: 0.45,
  fallbackPeakElbow: 140,
});

export const REP_STATE = Object.freeze({ GUARD: 'GUARD', LAUNCH: 'LAUNCH', PEAK: 'PEAK' });

const SIDES = ['lead', 'rear'];
const TECHNIQUE_BY_ARM = { lead: 'jab', rear: 'cross' };

/** Per-arm extension (see header). Exported for tests and the debug overlay. */
export function armExtension(body, side, calib, o = REP_DEFAULTS) {
  const j = body.joints[side];
  const height = j.shoulder.y - j.wrist.y;   // y down → positive when wrist is above shoulder
  if (height < o.minWristHeight) return 0;
  const gReach = calib?.guardReach?.[side] ?? 0.8;
  const gElbow = calib?.guardElbow?.[side] ?? 75;
  const fullReach = calib?.reach?.lead ?? gReach + o.fallbackReachGain;
  const fullElbow = calib?.reach?.elbowAngle ?? o.fallbackPeakElbow;
  const byReach = (body.reach[side] - gReach) / Math.max(0.1, fullReach - gReach);
  const byElbow = Number.isFinite(body.angles[side].elbow)
    ? (body.angles[side].elbow - gElbow) / Math.max(15, fullElbow - gElbow)
    : -Infinity;
  return Math.max(byReach, byElbow);
}

export class RepDetector {
  /**
   * @param {object} calib  calibration record (guardReach, guardElbow, reach, ...)
   * @param {object} [opts]
   */
  constructor(calib, opts = {}) {
    this.calib = calib;
    this.o = { ...REP_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.state = REP_STATE.GUARD;
    this._rep = null;
    this._lastEnd = -Infinity;
    this._pre = [];
    this.ext = { lead: 0, rear: 0 };
  }

  /** True while a strike is in its LAUNCH/PEAK phase (voice must hold, §8.4). */
  get striking() {
    return this.state !== REP_STATE.GUARD;
  }

  /**
   * @param {object} frame  pipeline frame (needs .t, .body, .glitch)
   * @returns {null | {type:'rep', ...} | {type:'abandoned'}}
   */
  update(frame) {
    const b = frame.body;
    if (!b?.valid || frame.glitch) return null;
    const t = frame.t;
    for (const s of SIDES) this.ext[s] = armExtension(b, s, this.calib, this.o);
    const act = Math.max(this.ext.lead, this.ext.rear);

    if (this.state === REP_STATE.GUARD) {
      if (act > this.o.launch && t - this._lastEnd > this.o.refractoryMs) {
        this.state = REP_STATE.LAUNCH;
        this._rep = {
          tStart: t,
          pre: this._pre,
          frames: [],
          peak: { lead: { e: -Infinity }, rear: { e: -Infinity } },
          maxAct: act,
        };
      } else {
        this._pre.push(frame);
        while (this._pre.length && t - this._pre[0].t > this.o.preRollMs) this._pre.shift();
        return null;
      }
    }

    const r = this._rep;
    r.frames.push(frame);
    for (const s of SIDES) {
      if (this.ext[s] > r.peak[s].e) r.peak[s] = { e: this.ext[s], t, body: b };
    }
    if (act > r.maxAct) r.maxAct = act;
    if (this.state === REP_STATE.LAUNCH && act < r.maxAct - 0.1) this.state = REP_STATE.PEAK;

    if (act < this.o.ret) return this._complete(t);
    if (t - r.tStart > this.o.maxActiveMs) {
      this._end(t);
      return { type: 'abandoned', tStart: r.tStart, t };
    }
    return null;
  }

  _complete(t) {
    const r = this._rep;
    this._end(t);
    const arm = r.peak.lead.e >= r.peak.rear.e ? 'lead' : 'rear';
    const other = arm === 'lead' ? 'rear' : 'lead';
    const pk = r.peak[arm];
    if (pk.e < this.o.minPeak) return { type: 'abandoned', tStart: r.tStart, t, reason: 'too_small' };
    return {
      type: 'rep',
      technique: TECHNIQUE_BY_ARM[arm],
      arm,
      peakExt: pk.e,
      otherExt: r.peak[other].e,
      // 0..1: how clearly one arm dominated
      confidence: Math.max(0, Math.min(1, (pk.e - Math.max(0, r.peak[other].e)) / 0.4 + 0.5)),
      tStart: r.tStart,
      tPeak: pk.t,
      tEnd: t,
      peakBody: pk.body,
      pre: r.pre,
      frames: r.frames,
    };
  }

  _end(t) {
    this.state = REP_STATE.GUARD;
    this._rep = null;
    this._pre = [];
    this._lastEnd = t;
  }
}
