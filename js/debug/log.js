/**
 * js/debug/log.js — opt-in debug log (spec §10.5).
 *
 * Off by default. Records numbers only — raw pose landmarks per frame plus
 * app events (framing, presence, calibration, voice) — never images. Kept in
 * memory on the phone (last few minutes), and leaves it only when the user
 * taps Download. Raw landmarks are enough to replay a session offline
 * through the same pipeline (tools/replay.mjs).
 */

const LOG_VERSION = 1;
const MAX_EVENTS = 5000;

const r4 = v => Math.round(v * 1e4) / 1e4;
const r2 = v => Math.round(v * 100) / 100;

export class DebugLog {
  constructor({ maxSeconds = 180 } = {}) {
    this.maxMs = maxSeconds * 1000;
    this.enabled = false;
    this.clear();
  }

  clear() {
    this.frames = [];
    this.events = [];
  }

  /** Seconds of frames currently held. */
  get seconds() {
    if (this.frames.length < 2) return 0;
    return (this.frames.at(-1).t - this.frames[0].t) / 1000;
  }

  /** One raw MediaPipe result (before filtering), compacted. */
  frame(raw) {
    if (!this.enabled) return;
    const f = { t: Math.round(raw.t * 10) / 10, ms: r2(raw.inferenceMs ?? 0) };
    if (raw.image && raw.world) {
      f.i = raw.image.flatMap(p => [r4(p.x), r4(p.y), r4(p.z), r2(p.visibility ?? 0)]);
      f.w = raw.world.flatMap(p => [r4(p.x), r4(p.y), r4(p.z)]);
    }
    this.frames.push(f);
    const cutoff = f.t - this.maxMs;
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop].t < cutoff) drop++;
    if (drop) this.frames.splice(0, drop);
  }

  event(type, data = {}, t = performance.now()) {
    if (!this.enabled) return;
    this.events.push({ t: Math.round(t * 10) / 10, type, ...data });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  toJSON() {
    return {
      app: 'nak-muay-trainer',
      logVersion: LOG_VERSION,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
      format: {
        i: '33 image landmarks × [x, y, z, visibility], normalised to the unmirrored camera frame',
        w: '33 world landmarks × [x, y, z] in metres, hip-centred',
        ms: 'inference time',
      },
      frames: this.frames,
      events: this.events,
    };
  }

  /** Save as a .json file via the browser's download. */
  download() {
    const blob = new Blob([JSON.stringify(this.toJSON())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url;
    a.download = `nakmuay-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return blob.size;
  }
}

/** Inverse of DebugLog.frame(): back to {t, image, world, inferenceMs}. */
export function decodeFrame(f) {
  const out = { t: f.t, inferenceMs: f.ms, image: null, world: null };
  if (f.i && f.w) {
    out.image = [];
    out.world = [];
    for (let k = 0; k < f.i.length / 4; k++) {
      out.image.push({ x: f.i[4 * k], y: f.i[4 * k + 1], z: f.i[4 * k + 2], visibility: f.i[4 * k + 3] });
      out.world.push({ x: f.w[3 * k], y: f.w[3 * k + 1], z: f.w[3 * k + 2], visibility: f.i[4 * k + 3] });
    }
  }
  return out;
}
