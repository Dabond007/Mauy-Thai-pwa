/**
 * js/stage.js — the shared camera screen: camera → pose engine → pipeline →
 * renderer + debug overlay, plus the panel that Setup and Practice fill in.
 *
 * The camera runs only while a camera screen is open; stop() releases it so
 * the camera indicator goes off as soon as the user leaves (§10.7).
 */

import { CameraManager } from './camera.js';
import { PosePipeline } from './pose/pipeline.js';
import { Renderer } from './render/renderer.js';
import { DebugOverlay } from './debug/overlay.js';

export class Stage {
  constructor({ bus, poseEngine, settings, voice, tones, log }) {
    this.bus = bus;
    this.log = log;
    this.poseEngine = poseEngine;
    this.settings = settings;
    this.voice = voice;
    this.tones = tones;
    this.camera = new CameraManager();
    this.pipeline = new PosePipeline({ calibration: settings.calibration });

    this.el = {
      screen: document.getElementById('camera-screen'),
      title: document.getElementById('cam-title'),
      close: document.getElementById('cam-close'),
      stage: document.getElementById('cam-stage'),
      video: document.getElementById('camera-feed'),
      canvas: document.getElementById('pose-canvas'),
      banner: document.getElementById('cam-banner'),
      countdown: document.getElementById('countdown-overlay'),
      countdownNum: document.getElementById('countdown-number'),
      debug: document.getElementById('debug-panel'),
      chip: document.getElementById('cam-chip'),
      timer: document.getElementById('cam-timer'),
      rec: document.getElementById('cam-rec'),
      prompt: document.getElementById('cam-prompt'),
      progress: document.getElementById('cam-progress'),
      progressFill: document.getElementById('cam-progress-fill'),
      detail: document.getElementById('cam-detail'),
      strip: document.getElementById('cam-strip'),
      actions: document.getElementById('cam-actions'),
      cameraPrompt: document.getElementById('camera-prompt'),
      allowCamera: document.getElementById('allow-camera-btn'),
    };

    this.renderer = new Renderer(this.el.canvas);
    this.debug = new DebugOverlay(this.el.canvas, this.el.debug);
    this.debug.setEnabled(settings.get('debug'));

    this.drawOpts = { guide: false, guideStatus: 'red', sides: true };
    this._handler = null;
    this._wakeLock = null;
    this._resizeObserver = null;
    this.running = false;

    bus.on('settings:changed', ({ values }) => this.debug.setEnabled(values.debug));
    bus.on('calibration:changed', c => this.pipeline.setCalibration(c));
    voice.onSpeak = (text, priority) => {
      this.debug.lastSpoken = text;
      this.log.event('voice', { text, priority });
    };
    this.el.close.addEventListener('click', () => this.bus.emit('stage:close'));
    this.el.allowCamera.addEventListener('click', () => {
      if (this._lastStart) this.start(this._lastStart);
    });
  }

  /**
   * Open the camera and start feeding frames to `onFrame`.
   * @param {object} o
   * @param {string} o.title
   * @param {'upper'|'full'} [o.required]
   * @param {(frame) => void} o.onFrame
   * @param {() => void} [o.onStarted]  called once the camera is running
   *                                    (again after a permission retry)
   * @returns {Promise<boolean>} false if the camera could not start
   */
  async start(opts) {
    const { title, required = 'full', onFrame, onStarted } = opts;
    this.stop({ keepCamera: true });
    this._lastStart = opts;
    this.el.title.textContent = title;
    this.el.cameraPrompt.classList.remove('visible');
    this.setPanel({});
    this.setBanner(null);
    this._handler = onFrame;
    this.pipeline.setCalibration(this.settings.calibration);
    this.pipeline.setRequired(required);
    this.pipeline.reset();

    try {
      if (!this.camera.isActive) await this.camera.start(this.el.video);
    } catch (err) {
      console.warn('[Stage] camera:', err);
      this.el.cameraPrompt.querySelector('p').textContent = err.name === 'CameraPermissionError'
        ? 'Allow camera access to train. Video stays on your phone — it is never recorded or sent anywhere.'
        : `Couldn't start the camera: ${err.message}`;
      this.el.cameraPrompt.classList.add('visible');
      return false;
    }

    const { width, height } = this.camera.videoSize;
    this.renderer.setVideoSize(width, height);
    this._syncSize();
    this._resizeObserver = new ResizeObserver(() => this._syncSize());
    this._resizeObserver.observe(this.el.stage);
    this._acquireWakeLock();

    this.el.rec.classList.toggle('hidden', !this.log.enabled);
    this._lastFramingKey = null;
    this.log.event('screen', {
      title,
      required,
      camera: this.camera.info,
      model: this.poseEngine.model,
      delegate: this.poseEngine.delegate,
      calibration: this.settings.calibration,
      viewport: { w: innerWidth, h: innerHeight },
    });

    this.running = true;
    this.poseEngine.start(this.el.video, raw => this._onRaw(raw));
    onStarted?.();
    return true;
  }

  /**
   * @param {object} [o]
   * @param {boolean} [o.keepCamera]  keep the stream open when going straight
   *                                  to another camera screen (no flicker)
   */
  stop({ keepCamera = false } = {}) {
    this.running = false;
    this.poseEngine.stop();
    if (!keepCamera) this.camera.stop();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._wakeLock?.release?.().catch?.(() => {});
    this._wakeLock = null;
    this.renderer.clear();
    this.voice.setHold(false);
    this.showCountdown(null);
    this._handler = null;
  }

  _onRaw(raw) {
    if (!this.running) return;
    this.renderer.setVideoSize(raw.videoWidth, raw.videoHeight);
    const frame = this.pipeline.process(raw);
    this._logFrame(raw, frame);
    this._handler?.(frame);
    this.renderer.draw(frame, { ...this.drawOpts, sides: !!this.settings.calibration });
    this.debug.draw(frame, this.renderer, {
      model: this.poseEngine.model,
      delegate: this.poseEngine.delegate,
      calibration: this.settings.calibration,
      camera: this.camera.info,
    });
  }

  _logFrame(raw, frame) {
    if (!this.log.enabled) return;
    this.log.frame(raw);
    for (const ev of frame.presence.events) this.log.event('presence', ev, frame.t);
    const fr = frame.framing;
    const key = `${fr.status}|${fr.issues.map(i => i.id).join(',')}`;
    if (key !== this._lastFramingKey) {
      this._lastFramingKey = key;
      this.log.event('framing', {
        status: fr.status,
        issues: fr.issues.map(i => i.id),
        missing: fr.metrics.missing,
        metrics: fr.metrics,
      }, frame.t);
    }
  }

  _syncSize() {
    const r = this.el.stage.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
  }

  async _acquireWakeLock() {
    try {
      this._wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* not critical */ }
  }

  // ── Panel helpers ─────────────────────────────────────────

  /**
   * @param {object} p
   * @param {string} [p.chip]       status text
   * @param {'green'|'amber'|'red'|'info'} [p.chipLevel]
   * @param {string} [p.prompt]
   * @param {string} [p.detail]
   * @param {number|null} [p.progress]  0..1, null hides the bar
   * @param {string|null} [p.timer]
   * @param {Array<{label, onClick, kind?}>} [p.actions]
   */
  setPanel({ chip = '', chipLevel = 'info', prompt = '', detail = '', progress = null, timer = null, actions = [] }) {
    this.el.chip.textContent = chip;
    this.el.chip.className = `chip ${chipLevel}`;
    this.el.chip.classList.toggle('hidden', !chip);
    this.el.prompt.textContent = prompt;
    this.el.detail.textContent = detail;
    this.setProgress(progress);
    this.setTimer(timer);
    this.setActions(actions);
    this.setStrip(null);
  }

  /**
   * Row of rep results for the current set (§5.2).
   * @param {Array<'clean'|'good'|'fix'|'missed'|null>|null} ratings  null hides it
   * @param {number} total  slots to show
   */
  setStrip(ratings, total = 0) {
    if (!ratings) {
      this.el.strip.replaceChildren();
      return;
    }
    const cells = [];
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      d.className = `rep ${ratings[i] ?? 'todo'}`;
      cells.push(d);
    }
    this.el.strip.replaceChildren(...cells);
  }

  setChip(text, level = 'info') {
    this.el.chip.textContent = text;
    this.el.chip.className = `chip ${level}`;
    this.el.chip.classList.toggle('hidden', !text);
  }

  setPrompt(text) {
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
  }

  setDetail(text) {
    if (this.el.detail.textContent !== text) this.el.detail.textContent = text;
  }

  setProgress(p) {
    this.el.progress.classList.toggle('hidden', p === null || p === undefined);
    if (p !== null && p !== undefined) this.el.progressFill.style.width = `${Math.round(p * 100)}%`;
  }

  setTimer(text) {
    this.el.timer.classList.toggle('hidden', !text);
    if (text) this.el.timer.textContent = text;
  }

  setActions(actions) {
    this.el.actions.replaceChildren(...actions.map(a => {
      const b = document.createElement('button');
      b.className = a.kind === 'secondary' ? 'btn-secondary' : 'btn-primary';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      return b;
    }));
  }

  /** Big banner over the camera, e.g. "Out of frame". null hides it. */
  setBanner(text, level = 'red') {
    this.el.banner.textContent = text ?? '';
    this.el.banner.className = text ? `visible ${level}` : '';
  }

  showCountdown(n) {
    if (!n) {
      this.el.countdown.classList.remove('visible');
      return;
    }
    this.el.countdownNum.textContent = n;
    this.el.countdownNum.style.animation = 'none';
    void this.el.countdownNum.offsetWidth;
    this.el.countdownNum.style.animation = '';
    this.el.countdown.classList.add('visible');
  }
}
