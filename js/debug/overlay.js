/**
 * js/debug/overlay.js — what the detector sees (§12.1).
 *
 * Canvas labels on wrists and ankles say which side the app thinks is the
 * user's real left/right and lead/rear, so the v1 mirror question can be
 * settled by eye. A text panel shows presence, framing, FPS, inference time
 * and live body metrics.
 */

const PANEL_INTERVAL_MS = 200;

const f1 = v => (Number.isFinite(v) ? v.toFixed(1) : '—');
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const f0 = v => (Number.isFinite(v) ? Math.round(v).toString() : '—');

export class DebugOverlay {
  /**
   * @param {HTMLCanvasElement} canvas  shared with the renderer (drawn after it)
   * @param {HTMLElement} panel
   */
  constructor(canvas, panel) {
    this._ctx = canvas.getContext('2d');
    this._panel = panel;
    this._lastPanel = 0;
    this.enabled = false;
    this.lastSpoken = '';
    this.extra = {};     // screens can add lines, e.g. calibration step
  }

  setEnabled(on) {
    this.enabled = !!on;
    this._panel.classList.toggle('hidden', !this.enabled);
  }

  /**
   * @param {object} frame     pipeline frame
   * @param {object} renderer  for coordinate mapping
   * @param {object} info      { model, delegate, calibration }
   */
  draw(frame, renderer, info) {
    if (!this.enabled) return;
    if (frame?.body?.valid) this._labels(frame, renderer);
    if (frame.t - this._lastPanel >= PANEL_INTERVAL_MS) {
      this._lastPanel = frame.t;
      this._panel.textContent = this._text(frame, info);
    }
  }

  _labels(frame, renderer) {
    const ctx = this._ctx;
    const b = frame.body;
    const tags = [];
    const userSide = idx => (Object.values(b.sides.left).includes(idx) ? 'L' : 'R');
    for (const s of ['lead', 'rear']) {
      const w = b.sides[s].wrist;
      const a = b.sides[s].ankle;
      tags.push([w, `${userSide(w)} ${s}`]);
      tags.push([a, `${userSide(a)} ${s}`]);
    }
    ctx.save();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const [idx, label] of tags) {
      const lm = frame.image[idx];
      if (!lm) continue;
      const p = renderer.map(lm);
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = (lm.visibility ?? 0) < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.7)';
      ctx.fillRect(p.x + 8, p.y - 10, w, 20);
      ctx.fillStyle = label.includes('lead') ? '#ff8fa3' : '#9fd3ff';
      ctx.fillText(label, p.x + 13, p.y);
    }
    ctx.restore();
  }

  _text(frame, info) {
    const c = info.calibration;
    const lines = [];
    lines.push(`fps ${frame.fps}  infer ${f1(frame.inferenceMs)}ms  ${info.model ?? '?'}/${info.delegate ?? '?'}`);
    lines.push(`presence ${frame.presence.state}  framing ${frame.framing.status}`);
    if (frame.framing.issues.length) lines.push(`  issues: ${frame.framing.issues.map(i => i.id).join(', ')}`);
    const m = frame.framing.metrics;
    lines.push(`  height ${f2(m.bodyHeight)}  x ${f2(m.screenX)}  vis ${f2(m.meanVisibility)}  facing ${f0(m.facingDeg)}°`);
    lines.push(c
      ? `calib ${c.stance}  swapSides ${c.swapSides}${c.handednessChecked ? '' : ' (unchecked)'}  reach ${f2(c.reach?.lead)}`
      : 'calib none (MediaPipe labels assumed)');

    const b = frame.body;
    if (b?.valid) {
      lines.push(`guard Δ lead ${f2(b.guard.lead.delta ?? b.guard.lead.height)}  rear ${f2(b.guard.rear.delta ?? b.guard.rear.height)}`);
      lines.push(`elbow lead ${f0(b.angles.lead.elbow)}°  rear ${f0(b.angles.rear.elbow)}°`);
      lines.push(`knee  lead ${f0(b.angles.lead.knee)}°  rear ${f0(b.angles.rear.knee)}°`);
      lines.push(`reach lead ${f2(b.reach.lead)}  rear ${f2(b.reach.rear)}  (shoulder widths)`);
      lines.push(`turn sh ${f0(b.shoulderTurn)}°  hip ${f0(b.hipTurn)}°  lean ${f0(b.torsoLean)}°`);
      lines.push(`stance w ${f2(b.stance.width)}  lead fwd ${f2(b.stance.leadForward)}`);
      lines.push(`speed wrist ${f1(b.speed.lead.wrist)}/${f1(b.speed.rear.wrist)}  ankle ${f1(b.speed.lead.ankle)}/${f1(b.speed.rear.ankle)}`);
      lines.push(`conf arm ${f2(b.confidence.lead.arm)}/${f2(b.confidence.rear.arm)}  leg ${f2(b.confidence.lead.leg)}/${f2(b.confidence.rear.leg)}`);
    } else {
      lines.push('no pose');
    }
    for (const [k, v] of Object.entries(this.extra)) lines.push(`${k}: ${v}`);
    if (this.lastSpoken) lines.push(`voice: "${this.lastSpoken}"`);
    return lines.join('\n');
  }
}
