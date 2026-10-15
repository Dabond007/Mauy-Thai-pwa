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
  }

  /**
   * @param {{t:number, image:Array|null, world:Array|null, inferenceMs?:number}} raw
   */
  process(raw) {
    const { t } = raw;
    const image = raw.image ? this._imageFilter.filter(raw.image, t) : null;
    const world = raw.world ? this._worldFilter.filter(raw.world, t) : null;

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
      fps: this._frameTimes.length,
      inferenceMs: raw.inferenceMs ?? null,
    };
  }
}
