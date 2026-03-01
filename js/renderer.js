/**
 * js/renderer.js — Canvas Renderer
 *
 * Draws the pose silhouette (joint markers + limb connections) on the pose
 * canvas, and hit/miss feedback effects on the FX canvas.
 *
 * Canvas coordinate convention:
 *   MediaPipe x is in the raw (unmirrored) frame [0,1].
 *   The <video> element is CSS-flipped (scaleX(-1)) so the user sees a
 *   mirror view. To align the overlay, we flip x when drawing:
 *     canvas_x = (1 - landmark.x) * canvasWidth
 *   y is not flipped: canvas_y = landmark.y * canvasHeight
 */

// MediaPipe Pose connections (pairs of landmark indices)
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
  // Feet
  [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32],
];

// Key body landmark indices for drawing (exclude face detail landmarks)
const BODY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// Colours
const COLOR = {
  limb:         'rgba(100, 200, 255, 0.7)',
  joint:        'rgba(255, 255, 255, 0.9)',
  jointActive:  '#e94560',
  hitFlash:     'rgba(72, 187, 120, 0.4)',
  missFlash:    'rgba(252, 129, 129, 0.4)',
};

export class Renderer {
  /**
   * @param {HTMLCanvasElement} poseCanvas
   * @param {HTMLCanvasElement} fxCanvas
   */
  constructor(poseCanvas, fxCanvas) {
    this._poseCanvas = poseCanvas;
    this._fxCanvas   = fxCanvas;
    this._poseCtx    = poseCanvas.getContext('2d');
    this._fxCtx      = fxCanvas.getContext('2d');

    this._width  = 0;
    this._height = 0;

    // Active limb for highlighting (during a callout)
    this._activeLandmarks = new Set();

    // Trail: last N wrist/ankle positions
    this._trail = [];
    this._MAX_TRAIL = 5;

    // FX animation state
    this._fxAnimId = null;
  }

  /**
   * Resize canvases to match actual display size.
   * Call whenever the container size changes.
   */
  resize(width, height) {
    this._width  = width;
    this._height = height;
    this._poseCanvas.width  = width;
    this._poseCanvas.height = height;
    this._fxCanvas.width    = width;
    this._fxCanvas.height   = height;
  }

  /**
   * Draw pose landmarks and limb connections.
   * @param {Array} landmarks   Array of 33 {x, y, z, visibility} objects
   * @param {number[]} [activeLms]  Indices of landmarks to highlight
   */
  drawPose(landmarks, activeLms = []) {
    const ctx = this._poseCtx;
    const w   = this._width;
    const h   = this._height;

    ctx.clearRect(0, 0, w, h);

    if (!landmarks?.length) return;

    const active = new Set(activeLms);

    // ── Draw limb connections ────────────────────────────────
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.strokeStyle = COLOR.limb;

    for (const [a, b] of POSE_CONNECTIONS) {
      const lmA = landmarks[a];
      const lmB = landmarks[b];
      if (!lmA || !lmB) continue;
      if ((lmA.visibility ?? 1) < 0.4 || (lmB.visibility ?? 1) < 0.4) continue;

      const isActive = active.has(a) || active.has(b);
      ctx.strokeStyle = isActive
        ? 'rgba(233, 69, 96, 0.9)'
        : COLOR.limb;
      ctx.lineWidth = isActive ? 4 : 3;

      ctx.beginPath();
      ctx.moveTo(this._lx(lmA), this._ly(lmA));
      ctx.lineTo(this._lx(lmB), this._ly(lmB));
      ctx.stroke();
    }

    // ── Draw joint markers ───────────────────────────────────
    for (const i of BODY_LANDMARKS) {
      const lm = landmarks[i];
      if (!lm || (lm.visibility ?? 1) < 0.4) continue;

      const x = this._lx(lm);
      const y = this._ly(lm);
      const r = active.has(i) ? 7 : 5;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = active.has(i) ? COLOR.jointActive : COLOR.joint;
      ctx.fill();
    }

    // ── Trail effect on strike landmarks ────────────────────
    this._updateTrail(landmarks);
    this._drawTrail(ctx);
  }

  /**
   * Set which landmark indices to highlight (active limb for callout).
   * @param {number[]} indices
   */
  setActiveLandmarks(indices) {
    this._activeLandmarks = new Set(indices);
  }

  clearPose() {
    this._poseCtx.clearRect(0, 0, this._width, this._height);
  }

  // ── FX effects ────────────────────────────────────────────

  /** Flash green hit effect. */
  flashHit() {
    this._flashFX(COLOR.hitFlash);
  }

  /** Flash red miss effect. */
  flashMiss() {
    this._flashFX(COLOR.missFlash);
  }

  _flashFX(color) {
    const ctx = this._fxCtx;
    const w   = this._width;
    const h   = this._height;

    // Cancel any ongoing FX animation
    if (this._fxAnimId) cancelAnimationFrame(this._fxAnimId);

    ctx.clearRect(0, 0, w, h);

    let alpha = 0.6;
    const fade = () => {
      ctx.clearRect(0, 0, w, h);
      if (alpha <= 0) return;
      ctx.fillStyle = color.replace(/[\d.]+\)$/, `${alpha})`);
      ctx.fillRect(0, 0, w, h);
      alpha -= 0.06;
      this._fxAnimId = requestAnimationFrame(fade);
    };
    fade();
  }

  clearFX() {
    if (this._fxAnimId) cancelAnimationFrame(this._fxAnimId);
    this._fxCtx.clearRect(0, 0, this._width, this._height);
  }

  // ── Trail ────────────────────────────────────────────────

  _updateTrail(landmarks) {
    const STRIKE_LMS = [15, 16, 27, 28]; // wrists and ankles
    const positions  = {};
    for (const i of STRIKE_LMS) {
      const lm = landmarks[i];
      if (lm && (lm.visibility ?? 1) > 0.4) {
        positions[i] = { x: this._lx(lm), y: this._ly(lm) };
      }
    }
    this._trail.push(positions);
    if (this._trail.length > this._MAX_TRAIL) this._trail.shift();
  }

  _drawTrail(ctx) {
    const n = this._trail.length;
    for (let f = 0; f < n - 1; f++) {
      const opacity = ((f + 1) / n) * 0.4;
      ctx.strokeStyle = `rgba(233, 69, 96, ${opacity})`;
      ctx.lineWidth = 2;

      for (const [idx, pos] of Object.entries(this._trail[f])) {
        const nextPos = this._trail[f + 1]?.[idx];
        if (!nextPos) continue;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(nextPos.x, nextPos.y);
        ctx.stroke();
      }
    }
  }

  // ── Coordinate helpers ────────────────────────────────────

  /** Convert normalised landmark x to mirrored canvas x. */
  _lx(lm) {
    return (1 - lm.x) * this._width;
  }

  /** Convert normalised landmark y to canvas y. */
  _ly(lm) {
    return lm.y * this._height;
  }

  /**
   * Map landmark indices to active based on move category.
   * @param {string} moveId
   * @param {'orthodox'|'southpaw'} stance
   * @returns {number[]}
   */
  static activeLandmarksForMove(moveId, stance = 'orthodox') {
    const isOrtho = stance === 'orthodox';
    const LEAD_ARM  = isOrtho ? [12, 14, 16] : [11, 13, 15];
    const REAR_ARM  = isOrtho ? [11, 13, 15] : [12, 14, 16];
    const LEAD_LEG  = isOrtho ? [24, 26, 28] : [23, 25, 27];
    const REAR_LEG  = isOrtho ? [23, 25, 27] : [24, 26, 28];

    const map = {
      jab:           LEAD_ARM,
      cross:         REAR_ARM,
      lead_hook:     LEAD_ARM,
      rear_hook:     REAR_ARM,
      lead_uppercut: LEAD_ARM,
      rear_uppercut: REAR_ARM,
      lead_teep:     LEAD_LEG,
      rear_roundhouse: REAR_LEG,
      high_guard:    [11, 12, 13, 14, 15, 16],
      check:         LEAD_LEG,
    };
    return map[moveId] ?? [];
  }
}
