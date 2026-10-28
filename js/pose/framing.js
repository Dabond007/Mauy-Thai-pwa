/**
 * js/pose/framing.js — framing check (§3.3) and presence state machine (§3.4).
 *
 * Pure logic: feed it image landmarks (normalised to the unmirrored camera
 * frame) and timestamps in ms. All thresholds are starting points to tune.
 */

import { LM, REQUIRED, FRAMING_LANDMARKS, bestOf, missingEntries } from './landmarks.js';
import { imageBodyExtent } from './body-model.js';
import { mean, minVisibility, yawDeg } from './geometry.js';

export const FRAMING_DEFAULTS = Object.freeze({
  minVisibility: 0.6,
  heightMin: 0.55,
  heightMax: 0.85,
  centreBand: 0.2,        // hip midpoint within 0.5 ± 0.2 (middle 40 %)
  edgeMargin: 0.03,
  tiltFeetEdge: 0.94,     // heels this low...
  tiltHeadroom: 0.2,      // ...with this much space above the head
  tiltHeadEdge: 0.04,
  tiltFootroom: 0.8,
  lightingVisibility: 0.7,
  lightingHoldMs: 2000,
  facingMaxDeg: 50,
  tipIntervalMs: 5000,
  tipHoldMs: 1000,        // a problem must last this long before it is spoken
});

const UPPER_BODY = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

/** Issue ids in priority order; the first present issue supplies the tip. */
const PRIORITY = ['no_person', 'not_visible', 'too_far', 'too_close', 'edge',
  'off_centre', 'tilt', 'facing', 'lighting'];

/**
 * Evaluate one frame. Lighting is time-based, so it is added by FramingMonitor.
 * @param {Array|null} image  normalised landmarks
 * @param {Array|null} world  world landmarks (for facing), optional
 */
export function evaluateFraming(image, world = null, opts = FRAMING_DEFAULTS) {
  const o = { ...FRAMING_DEFAULTS, ...opts };
  const issues = [];
  const metrics = {};

  if (!image) {
    issues.push({ id: 'no_person', level: 'red', tip: 'Step into view of the camera' });
    return finalise(issues, metrics);
  }

  const missing = missingEntries(image, FRAMING_LANDMARKS, o.minVisibility);
  metrics.meanVisibility = mean(FRAMING_LANDMARKS.map(e => bestOf(image, e)?.visibility ?? 0));
  metrics.missing = missing;

  if (missing.length) {
    const upperMissing = missing.some(i => UPPER_BODY.includes(i));
    issues.push({
      id: 'not_visible', level: 'red',
      tip: upperMissing ? 'Step into the middle of the picture' : 'Step back until I can see your feet',
    });
  }

  const ext = imageBodyExtent(image);
  metrics.bodyHeight = ext.height;
  metrics.headTop = ext.headTop;
  metrics.heelsY = ext.heelsY;

  if (!missing.length) {
    if (ext.height < o.heightMin) {
      issues.push({ id: 'too_far', level: 'amber', tip: 'Come a little closer' });
    } else if (ext.height > o.heightMax) {
      issues.push({ id: 'too_close', level: 'amber', tip: 'Step back a little' });
    }

    const nearEdge = FRAMING_LANDMARKS.some(e => {
      const p = bestOf(image, e);
      return p.x < o.edgeMargin || p.x > 1 - o.edgeMargin ||
             p.y < o.edgeMargin || p.y > 1 - o.edgeMargin;
    });
    if (nearEdge) {
      issues.push({ id: 'edge', level: 'amber', tip: 'Give yourself room to kick — step back' });
    }

    // The preview is mirrored, so on-screen x = 1 - x and the user's own
    // left matches the screen's left (like a mirror).
    const screenX = 1 - (image[LM.L_HIP].x + image[LM.R_HIP].x) / 2;
    metrics.screenX = screenX;
    if (screenX > 0.5 + o.centreBand) {
      issues.push({ id: 'off_centre', level: 'amber', tip: 'Move a little to your left' });
    } else if (screenX < 0.5 - o.centreBand) {
      issues.push({ id: 'off_centre', level: 'amber', tip: 'Move a little to your right' });
    }

    if (ext.heelsY > o.tiltFeetEdge && ext.headTop > o.tiltHeadroom) {
      issues.push({ id: 'tilt', level: 'amber', tip: 'Tilt the phone down a bit' });
    } else if (ext.headTop < o.tiltHeadEdge && ext.heelsY < o.tiltFootroom) {
      issues.push({ id: 'tilt', level: 'amber', tip: 'Tilt the phone up a bit' });
    }
  }

  if (world && minVisibility(image, [LM.L_SHOULDER, LM.R_SHOULDER]) >= o.minVisibility) {
    let facing = Math.abs(yawDeg(world[LM.L_SHOULDER], world[LM.R_SHOULDER]));
    if (facing > 90) facing = 180 - facing;
    metrics.facingDeg = facing;
    if (facing > o.facingMaxDeg) {
      issues.push({ id: 'facing', level: 'amber', tip: 'Face the phone' });
    }
  }

  return finalise(issues, metrics);
}

function finalise(issues, metrics) {
  issues.sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  const status = issues.some(i => i.level === 'red') ? 'red'
    : issues.length ? 'amber' : 'green';
  return { status, issues, tip: issues[0]?.tip ?? null, metrics };
}

/**
 * Adds the time-based lighting check and throttles spoken tips to one per
 * `tipIntervalMs`. A tip is only spoken once its problem has lasted
 * `tipHoldMs`, so a one-frame landmark flicker never triggers a voice line.
 */
export class FramingMonitor {
  constructor(opts = {}) {
    this.o = { ...FRAMING_DEFAULTS, ...opts };
    this._lowLightSince = null;
    this.reset();
  }

  reset() {
    this._lowLightSince = null;
    this._lastSpokenAt = -Infinity;
    this._greenSince = null;
    this._tip = null;
    this._tipSince = null;
  }

  /**
   * @returns {{status, issues, tip, metrics, speak: string|null, greenForMs: number}}
   */
  update(image, world, t) {
    const r = evaluateFraming(image, world, this.o);

    const mv = r.metrics.meanVisibility;
    if (image && Number.isFinite(mv) && mv < this.o.lightingVisibility) {
      this._lowLightSince ??= t;
      if (t - this._lowLightSince >= this.o.lightingHoldMs) {
        r.issues.push({ id: 'lighting', level: 'amber', tip: 'More light would help' });
        Object.assign(r, finalise(r.issues, r.metrics));
      }
    } else {
      this._lowLightSince = null;
    }

    if (r.status === 'green') this._greenSince ??= t;
    else this._greenSince = null;
    r.greenForMs = this._greenSince === null ? 0 : t - this._greenSince;

    if (r.tip !== this._tip) {
      this._tip = r.tip;
      this._tipSince = t;
    }
    r.speak = null;
    if (r.tip && t - this._tipSince >= this.o.tipHoldMs &&
        t - this._lastSpokenAt >= this.o.tipIntervalMs) {
      r.speak = r.tip;
      this._lastSpokenAt = t;
    }
    return r;
  }
}

export const PRESENCE = Object.freeze({
  ACQUIRING: 'ACQUIRING',       // session start; nothing announced yet
  TRACKING: 'TRACKING',
  OUT_OF_FRAME: 'OUT_OF_FRAME',
  RESUMING: 'RESUMING',         // back in frame, 3-2-1 running
});

export const PRESENCE_DEFAULTS = Object.freeze({
  lostAfterMs: 1000,
  stableForMs: 1500,
  countdownMs: 3000,
  announceMs: 1200,        // gap for "Back in frame" to be spoken before 3-2-1
  lostVisibility: 0.5,     // below this a required landmark counts as lost...
  presentVisibility: 0.6,  // ...and must reach this to count as back (hysteresis)
  frameSlack: 0.02,        // landmarks may sit this far outside [0,1]
});

/**
 * Presence state machine (§3.4).
 *
 *   TRACKING ──lost > 1.0 s──▶ OUT_OF_FRAME ──stable 1.5 s──▶ RESUMING ──3-2-1──▶ TRACKING
 *
 * After a walk-out, the 3-2-1 starts `announceMs` after back_in_frame so the
 * spoken "Back in frame" doesn't collide with the first beep.
 *
 * update() returns the state and any events that fired on this frame:
 *   {type:'out_of_frame'} | {type:'back_in_frame', first} | {type:'countdown', n} | {type:'tracking'}
 * `first` is true for the initial acquisition at session start, where the
 * caller should not say "Back in frame".
 */
export class PresenceMonitor {
  constructor(required = 'full', opts = {}) {
    this.o = { ...PRESENCE_DEFAULTS, ...opts };
    this.setRequired(required);
    this.reset();
  }

  setRequired(required) {
    this._required = REQUIRED[required] ?? REQUIRED.full;
  }

  reset() {
    this.state = PRESENCE.ACQUIRING;
    this._lostSince = null;
    this._stableSince = null;
    this._resumeAt = null;
    this._lastCount = null;
    this._first = true;
    this.outOfFrameCount = 0;
  }

  _visible(image, minVis) {
    if (!image) return false;
    const s = this.o.frameSlack;
    return this._required.every(e => {
      const p = bestOf(image, e);
      return p && (p.visibility ?? 0) >= minVis &&
        p.x >= -s && p.x <= 1 + s && p.y >= -s && p.y <= 1 + s;
    });
  }

  /** True while reps should be scored and the set timer should run. */
  get active() {
    return this.state === PRESENCE.TRACKING;
  }

  update(image, t) {
    const events = [];
    const present = this._visible(image, this.o.presentVisibility);
    const lost = !this._visible(image, this.o.lostVisibility);

    switch (this.state) {
      case PRESENCE.TRACKING:
      case PRESENCE.RESUMING: {
        if (lost) {
          this._lostSince ??= t;
          if (t - this._lostSince > this.o.lostAfterMs) {
            const wasTracking = this.state === PRESENCE.TRACKING;
            this._toOut();
            if (this._first) {
              // Lost again during the very first 3-2-1: start over silently.
              this.state = PRESENCE.ACQUIRING;
            } else {
              events.push({ type: 'out_of_frame' });
              if (wasTracking) this.outOfFrameCount++;
            }
          }
        } else {
          this._lostSince = null;
        }
        if (this.state === PRESENCE.RESUMING && t >= this._resumeAt) {
          const elapsed = t - this._resumeAt;
          const n = 3 - Math.floor(elapsed / (this.o.countdownMs / 3));
          if (elapsed >= this.o.countdownMs) {
            this.state = PRESENCE.TRACKING;
            this._first = false;
            events.push({ type: 'tracking' });
          } else if (n !== this._lastCount && n >= 1) {
            this._lastCount = n;
            events.push({ type: 'countdown', n });
          }
        }
        break;
      }
      case PRESENCE.ACQUIRING:
      case PRESENCE.OUT_OF_FRAME: {
        if (present) {
          this._stableSince ??= t;
          if (t - this._stableSince >= this.o.stableForMs) {
            events.push({ type: 'back_in_frame', first: this._first });
            this.state = PRESENCE.RESUMING;
            this._resumeAt = t + (this._first ? 0 : this.o.announceMs);
            this._lostSince = null;
            this._lastCount = null;
            if (this._first) {
              this._lastCount = 3;
              events.push({ type: 'countdown', n: 3 });
            }
          }
        } else {
          this._stableSince = null;
        }
        break;
      }
    }
    return { state: this.state, events };
  }

  _toOut() {
    this.state = PRESENCE.OUT_OF_FRAME;
    this._lostSince = null;
    this._stableSince = null;
    this._resumeAt = null;
    this._lastCount = null;
  }
}
