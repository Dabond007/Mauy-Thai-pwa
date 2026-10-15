/**
 * js/render/renderer.js — live skeleton and the silhouette outline guide.
 *
 * The <video> is shown with `object-fit: contain` and mirrored with CSS, so
 * what the user sees is exactly what the camera (and MediaPipe) sees — just
 * flipped like a mirror. Landmarks are normalised to the unmirrored frame;
 * we map them into the letterboxed video rectangle and flip x.
 */

import { LM } from '../pose/landmarks.js';

const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const COLOURS = {
  lead: '#e94560',
  rear: '#63b3ed',
  neutral: 'rgba(234, 234, 234, 0.8)',
  lowConf: 'rgba(234, 234, 234, 0.25)',
  guide: { green: 'rgba(72, 187, 120, 0.9)', amber: 'rgba(236, 201, 75, 0.9)', red: 'rgba(252, 129, 129, 0.9)' },
};

const MIN_DRAW_VIS = 0.4;

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._w = 0;
    this._h = 0;
    this._vw = 720;
    this._vh = 1280;
  }

  /** Match the canvas to its CSS size (crisp on high-DPI screens). */
  resize(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    this._w = cssW;
    this._h = cssH;
    this._canvas.width = Math.round(cssW * dpr);
    this._canvas.height = Math.round(cssH * dpr);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setVideoSize(vw, vh) {
    if (vw && vh) {
      this._vw = vw;
      this._vh = vh;
    }
  }

  /** The letterboxed rectangle the video occupies inside the canvas. */
  get videoRect() {
    const s = Math.min(this._w / this._vw, this._h / this._vh);
    const w = this._vw * s;
    const h = this._vh * s;
    return { x: (this._w - w) / 2, y: (this._h - h) / 2, w, h };
  }

  /** Normalised landmark → canvas CSS pixels (mirrored). */
  map(lm) {
    const r = this.videoRect;
    return { x: r.x + (1 - lm.x) * r.w, y: r.y + lm.y * r.h };
  }

  clear() {
    this._ctx.clearRect(0, 0, this._w, this._h);
  }

  /**
   * @param {object} frame  pipeline frame
   * @param {object} [opts]
   * @param {boolean} [opts.guide]          draw the silhouette outline guide
   * @param {'green'|'amber'|'red'} [opts.guideStatus]
   * @param {boolean} [opts.sides]          colour lead/rear limbs (needs calibration)
   */
  draw(frame, { guide = false, guideStatus = 'red', sides = true } = {}) {
    this.clear();
    if (guide) this._drawGuide(guideStatus);
    if (frame?.image) this._drawSkeleton(frame, sides);
  }

  _drawSkeleton(frame, useSides) {
    const ctx = this._ctx;
    const img = frame.image;
    const sideOf = {};
    if (useSides && frame.body?.valid) {
      for (const s of ['lead', 'rear']) {
        for (const idx of Object.values(frame.body.sides[s])) sideOf[idx] = s;
      }
    }
    const colour = (a, b) => {
      const s = sideOf[a] && sideOf[a] === sideOf[b] ? sideOf[a] : null;
      return s ? COLOURS[s] : COLOURS.neutral;
    };

    ctx.lineCap = 'round';
    for (const [a, b] of CONNECTIONS) {
      const p = img[a];
      const q = img[b];
      const vis = Math.min(p.visibility ?? 0, q.visibility ?? 0);
      if (vis < 0.1) continue;
      const pa = this.map(p);
      const pb = this.map(q);
      ctx.strokeStyle = vis < MIN_DRAW_VIS ? COLOURS.lowConf : colour(a, b);
      ctx.lineWidth = vis < MIN_DRAW_VIS ? 2 : 4;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    for (const i of JOINTS) {
      const p = img[i];
      if ((p.visibility ?? 0) < MIN_DRAW_VIS) continue;
      const c = this.map(p);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(c.x, c.y, i === LM.NOSE ? 4 : 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Outline of where to stand: a figure filling ~70 % of the frame height,
   * centred, matching the framing check's sweet spot.
   */
  _drawGuide(status) {
    const ctx = this._ctx;
    const r = this.videoRect;
    const cx = r.x + r.w / 2;
    const top = r.y + r.h * 0.15;
    const bottom = r.y + r.h * 0.87;
    const H = bottom - top;
    const head = H * 0.065;
    const shW = H * 0.13;
    const hipW = H * 0.09;
    const shY = top + head * 2 + H * 0.03;
    const hipY = top + H * 0.52;

    ctx.save();
    ctx.strokeStyle = COLOURS.guide[status] ?? COLOURS.guide.red;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.arc(cx, top + head, head, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    // Torso and arms in guard.
    ctx.moveTo(cx - shW, shY);
    ctx.lineTo(cx + shW, shY);
    ctx.lineTo(cx + hipW, hipY);
    ctx.lineTo(cx - hipW, hipY);
    ctx.closePath();
    // Arms: elbows tucked down by the ribs, gloves up by the face.
    const elbowY = shY + H * 0.12;
    const gloveY = top + head * 1.7;
    for (const s of [-1, 1]) {
      ctx.moveTo(cx + s * shW, shY);
      ctx.lineTo(cx + s * shW * 0.95, elbowY);
      ctx.lineTo(cx + s * head * 1.3, gloveY);
    }
    // Legs in a stance.
    ctx.moveTo(cx - hipW, hipY);
    ctx.lineTo(cx - hipW * 1.6, bottom - H * 0.22);
    ctx.lineTo(cx - hipW * 2.0, bottom);
    ctx.moveTo(cx + hipW, hipY);
    ctx.lineTo(cx + hipW * 1.5, bottom - H * 0.22);
    ctx.lineTo(cx + hipW * 1.9, bottom);
    ctx.stroke();
    ctx.restore();
  }
}
