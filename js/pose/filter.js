/**
 * js/pose/filter.js — One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * Adaptive low-pass: heavy smoothing when a landmark is still (kills jitter),
 * light smoothing when it moves fast (keeps lag low on strikes). Driven by
 * real timestamps, so behaviour doesn't change with the frame rate.
 */

function smoothingFactor(cutoffHz, dtSec) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  /**
   * @param {object} p
   * @param {number} p.minCutoff  Hz; lower = smoother when still
   * @param {number} p.beta       how quickly the cutoff rises with speed
   * @param {number} p.dCutoff    Hz; smoothing of the speed estimate
   */
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta      = beta;
    this.dCutoff   = dCutoff;
    this.reset();
  }

  reset() {
    this._x  = null;
    this._dx = 0;
    this._t  = null;
  }

  /**
   * @param {number} x     raw value
   * @param {number} tSec  timestamp in seconds
   * @returns {number}     filtered value
   */
  filter(x, tSec) {
    if (this._x === null || this._t === null || tSec <= this._t) {
      this._x = x;
      this._dx = 0;
      this._t = tSec;
      return x;
    }
    const dt = tSec - this._t;
    this._t = tSec;

    const rawDx = (x - this._x) / dt;
    const aD = smoothingFactor(this.dCutoff, dt);
    this._dx = aD * rawDx + (1 - aD) * this._dx;

    const cutoff = this.minCutoff + this.beta * Math.abs(this._dx);
    const a = smoothingFactor(cutoff, dt);
    this._x = a * x + (1 - a) * this._x;
    return this._x;
  }
}

/** Default parameters; starting points to tune on device (§7.1). */
export const FILTER_DEFAULTS = Object.freeze({
  image: { minCutoff: 1.0, beta: 20, dCutoff: 1.0 },  // normalised frame units
  world: { minCutoff: 1.0, beta: 10, dCutoff: 1.0 },  // metres
  resetGapMs: 500,  // a gap longer than this restarts the filter (no smearing)
});

/**
 * Filters a whole landmark array (x, y, z per landmark). Visibility is passed
 * through unfiltered so confidence reacts immediately.
 */
export class LandmarkFilter {
  constructor(params = FILTER_DEFAULTS.image, resetGapMs = FILTER_DEFAULTS.resetGapMs) {
    this._params = params;
    this._resetGapMs = resetGapMs;
    this._filters = [];
    this._lastT = null;
  }

  reset() {
    this._filters = [];
    this._lastT = null;
  }

  /**
   * @param {Array<{x,y,z,visibility}>|null} landmarks
   * @param {number} tMs  timestamp in milliseconds
   */
  filter(landmarks, tMs) {
    if (!landmarks) return null;
    if (this._lastT !== null && tMs - this._lastT > this._resetGapMs) this.reset();
    this._lastT = tMs;

    const tSec = tMs / 1000;
    return landmarks.map((lm, i) => {
      let f = this._filters[i];
      if (!f) {
        f = this._filters[i] = [
          new OneEuroFilter(this._params),
          new OneEuroFilter(this._params),
          new OneEuroFilter(this._params),
        ];
      }
      return {
        x: f[0].filter(lm.x, tSec),
        y: f[1].filter(lm.y, tSec),
        z: f[2].filter(lm.z ?? 0, tSec),
        visibility: lm.visibility ?? 0,
      };
    });
  }
}
