/**
 * js/pose/pipeline.js — filter → body model → framing → presence (§7).
 *
 * Pure: takes raw MediaPipe output plus a timestamp and returns one
 * self-contained frame object that every consumer (renderer, debug overlay,
 * calibration, later the rep detector) reads from.
 */

import { LandmarkFilter, FILTER_DEFAULTS } from './filter.js';
import { computeBody } from './body-model.js';
import { FramingMonitor, PresenceMonitor } from './framing.js';
import { LM } from './landmarks.js';

const CORE = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

/** A torso point may not jump further than this (torso lengths) in one frame... */
export const GLITCH_JUMP = 0.35;
/** ...unless it stays there this many frames (then it's real: accept it). */
const GLITCH_MAX_FRAMES = 4;

/**
 * Pose-detector glitches: for 1–3 frames the shoulders/hips can jump to an
 * impossible place (seen in the 30° log mid-cross: shoulder yaw read -22°
 * between frames at 180° and 170°). Torso points can't move 0.35 torso
 * lengths in 1/30 s (~4 m/s), so such frames are replaced by the last good
 * one and flagged.
 */
function torsoJump(a, b, aspect) {
  const px = (p, q) => Math.hypot((p.x - q.x) * aspect, p.y - q.y);
  const mid = (l, i, j) => ({ x: (l[i].x + l[j].x) / 2, y: (l[i].y + l[j].y) / 2 });
  const torso = px(mid(b, LM.L_SHOULDER, LM.R_SHOULDER), mid(b, LM.L_HIP, LM.R_HIP)) || 1e-3;
  let m = 0;
  for (const i of CORE) m = Math.max(m, px(a[i], b[i]));
  return m / torso;
}

export class PosePipeline {
  /**
   * @param {object} [opts]
   * @param {object|null} [opts.calibration]
   * @param {'upper'|'full'} [opts.required]
   */
  constructor({ calibration = null, required = 'full' } = {}) {
    this.calibration = calibration;
    this._imageFilter = new LandmarkFilter(FILTER_DEFAULTS.image);
    this._worldFilter = new LandmarkFilter(FILTER_DEFAULTS.world);
    this.framing = new FramingMonitor();
    this.presence = new PresenceMonitor(required);
    this._prevBody = null;
    this._frameTimes = [];
    this._lastGood = null;
    this._glitchRun = 0;
    this.glitches = 0;
  }

  setCalibration(calibration) {
    this.calibration = calibration;
    this._prevBody = null;
  }

  setRequired(required) {
    this.presence.setRequired(required);
  }

  reset() {
    this._imageFilter.reset();
    this._worldFilter.reset();
    this.framing.reset();
    this.presence.reset();
    this._prevBody = null;
    this._frameTimes = [];
    this._lastGood = null;
    this._glitchRun = 0;
  }

  /**
   * @param {{t:number, image:Array|null, world:Array|null, inferenceMs?:number}} raw
   */
  process(raw) {
    const { t } = raw;
    let src = raw;
    let glitch = false;
    if (raw.image && raw.world && this._lastGood && t - this._lastGood.t < 200) {
      const aspect = (raw.videoWidth || 720) / (raw.videoHeight || 1280);
      if (torsoJump(raw.image, this._lastGood.image, aspect) > GLITCH_JUMP &&
          this._glitchRun < GLITCH_MAX_FRAMES) {
        glitch = true;
        this._glitchRun++;
        this.glitches++;
        src = { ...this._lastGood, t };
      }
    }
    if (!glitch) {
      this._glitchRun = 0;
      if (raw.image && raw.world) this._lastGood = raw;
    }

    const image = src.image ? this._imageFilter.filter(src.image, t) : null;
    const world = src.world ? this._worldFilter.filter(src.world, t) : null;

    const body = computeBody({ t, image, world }, this.calibration, this._prevBody);
    this._prevBody = body.valid ? body : null;

    const framing = this.framing.update(image, world, t);
    const presence = this.presence.update(image, t);

    this._frameTimes.push(t);
    while (this._frameTimes.length && t - this._frameTimes[0] > 1000) this._frameTimes.shift();

    return {
      t,
      raw,
      image,
      world,
      body,
      framing,
      presence,
      glitch,
      fps: this._frameTimes.length,
      inferenceMs: raw.inferenceMs ?? null,
    };
  }
}
