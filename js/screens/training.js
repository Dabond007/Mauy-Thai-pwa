/**
 * js/screens/training.js — Training Screen Orchestrator
 *
 * Coordinates all training subsystems for an active session:
 *   Camera → PoseEngine → MoveClassifier → ComboEngine
 *   Renderer → HUD → AudioManager
 *
 * Screen lifecycle:
 *   show(config)  — activate camera, run countdown, start session
 *   hide()        — stop camera, clean up listeners
 *
 * The training screen also manages:
 *   - Screen Wake Lock (prevent display dimming during training)
 *   - Haptic feedback (navigator.vibrate)
 *   - Round timer display
 *   - Pause / resume UI
 *   - Camera permission error handling
 */

import { CameraPermissionError } from '../camera.js';
import { Renderer }              from '../renderer.js';

export class TrainingScreen {
  constructor(bus, camera, poseEngine, moveClassifier, comboEngine, audio, renderer, hud) {
    this._bus            = bus;
    this._camera         = camera;
    this._poseEngine     = poseEngine;
    this._moveClassifier = moveClassifier;
    this._comboEngine    = comboEngine;
    this._audio          = audio;
    this._renderer       = renderer;
    this._hud            = hud;

    // DOM refs
    this._videoEl        = document.getElementById('camera-feed');
    this._poseCanvas     = document.getElementById('pose-canvas');
    this._fxCanvas       = document.getElementById('fx-canvas');
    this._cameraZone     = document.getElementById('camera-zone');
    this._cameraPrompt   = document.getElementById('camera-prompt');
    this._countdownOvl   = document.getElementById('countdown-overlay');
    this._countdownNum   = document.getElementById('countdown-number');
    this._pauseOvl       = document.getElementById('pause-overlay');
    this._pauseBtn       = document.getElementById('pause-btn');
    this._resumeBtn      = document.getElementById('resume-btn');
    this._endBtn         = document.getElementById('end-session-btn');
    this._allowCameraBtn = document.getElementById('allow-camera-btn');

    this._wakeLock       = null;
    this._resizeObserver = null;
    this._roundTimerId   = null;
    this._roundEndAt     = null;
    this._paused         = false;
    this._config         = null;
    this._unsubscribers  = [];

    this._bindStaticEvents();
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async show(config) {
    this._config = config;
    this._paused = false;

    this._hud.reset();
    this._pauseOvl.classList.remove('visible');
    this._cameraPrompt.classList.remove('visible');

    // Unlock TTS on user gesture (this is called after user taps Start)
    this._audio.unlockTTS();
    this._audio.init().catch(() => {});

    // Start camera
    try {
      await this._camera.start(this._videoEl);
    } catch (err) {
      if (err instanceof CameraPermissionError) {
        this._showCameraPrompt();
        return;
      }
      console.error('[Training] Camera error:', err);
      return;
    }

    // Size canvases to match camera zone
    this._syncCanvasSize();
    this._startResizeObserver();

    // Start pose detection
    this._poseEngine.startProcessing(this._videoEl);

    // Subscribe to events for this session
    this._subscribeSorted();

    // Acquire wake lock
    this._acquireWakeLock();

    // Countdown then start
    await this._runCountdown(3);

    this._audio.playBell();
    this._comboEngine.startSession(config);
  }

  hide() {
    this._cleanUp();
    this._bus.emit('session:end', {});
  }

  // ── Event subscriptions ───────────────────────────────────

  _subscribeSorted() {
    const b  = this._bus;
    const us = this._unsubscribers;

    // Pose → classifier
    us.push(b.on('pose:landmarks', data => {
      const result = this._moveClassifier.classify(data);
      if (result) {
        b.emit('classifier:result', { ...result, detectionTime: performance.now() });
      }
      // Render pose overlay
      const active = Renderer.activeLandmarksForMove(
        this._moveClassifier._expectedMoveId ?? '',
        this._moveClassifier._stance,
      );
      this._renderer.drawPose(data.landmarks, active);
    }));

    // Callout → TTS + HUD
    us.push(b.on('combo:callout', ({ moveId, moveName, ttsCallout, sequence, moveIndex }) => {
      this._audio.speak(ttsCallout);
      this._hud.showCallout(moveName);
      // Show next move (peek ahead)
      const seqArr = sequence ?? [];
      const nextId = seqArr[moveIndex + 1];
      const nextDef = nextId ? this._comboEngine.getMoveDefinition(nextId) : null;
      this._hud.setNextMove(nextDef?.name ?? null);
      this._hud.setComboStep(moveIndex);
    }));

    // Combo start → set up combo bar
    us.push(b.on('combo:start', ({ sequence }) => {
      this._hud.setComboSequence(sequence);
    }));

    // Hit
    us.push(b.on('combo:hit', ({ moveId, rating, points, streak, totalScore }) => {
      this._hud.setScore(totalScore);
      this._hud.setStreak(streak);
      this._hud.showRating(rating);
      this._renderer.flashHit();
      this._audio.playHit();
      this._vibrate(rating === 'perfect' ? [20, 10, 20] : [15]);
    }));

    // Miss
    us.push(b.on('combo:miss', ({ moveId, totalScore }) => {
      this._hud.setScore(totalScore);
      this._hud.setStreak(0);
      this._hud.showRating('miss');
      this._renderer.flashMiss();
      this._audio.playMiss();
      this._vibrate([5, 5]);
    }));

    // Combo complete
    us.push(b.on('combo:complete', () => {
      this._audio.playComboComplete();
    }));

    // Round ready → start round timer
    us.push(b.on('session:roundReady', ({ roundNum, totalRounds, duration }) => {
      this._hud.setRoundInfo(roundNum, totalRounds);
      this._startRoundTimer(duration);
    }));

    // Round end
    us.push(b.on('session:roundEnd', ({ roundNum }) => {
      this._stopRoundTimer();
      this._audio.playRoundEnd();
      this._hud.setTimer(0);
    }));

    // Rest period
    us.push(b.on('session:rest', ({ duration }) => {
      this._hud.setNextMove(`Rest — ${duration}s`);
    }));

    // Session complete → navigate to results
    us.push(b.on('session:complete', data => {
      this._cleanUp();
      // Persist basic stats to sessionStorage
      const prev = Number(sessionStorage.getItem('nmt_sessions') ?? 0);
      sessionStorage.setItem('nmt_sessions', prev + 1);
      const prevBest = Number(sessionStorage.getItem('nmt_bestStreak') ?? 0);
      sessionStorage.setItem('nmt_bestStreak', Math.max(prevBest, data.bestStreak ?? 0));
      if (data.accuracy != null) {
        sessionStorage.setItem('nmt_accuracy', data.accuracy);
      }
      this._bus.emit('navigate:results', { ...data, config: this._config });
    }));
  }

  _unsubscribeAll() {
    this._unsubscribers.forEach(fn => fn());
    this._unsubscribers = [];
  }

  // ── Static button bindings (survive screen hide/show) ─────

  _bindStaticEvents() {
    this._pauseBtn?.addEventListener('click', () => this._togglePause());
    this._resumeBtn?.addEventListener('click', () => this._togglePause());
    this._endBtn?.addEventListener('click',   () => this._endSession());
    this._allowCameraBtn?.addEventListener('click', () => {
      this._cameraPrompt.classList.remove('visible');
      this.show(this._config);
    });
  }

  // ── Pause / resume ────────────────────────────────────────

  _togglePause() {
    if (this._paused) {
      this._paused = false;
      this._pauseOvl.classList.remove('visible');
      this._pauseBtn.textContent = '⏸';
      this._bus.emit('session:resume');
    } else {
      this._paused = true;
      this._pauseOvl.classList.add('visible');
      this._pauseBtn.textContent = '▶';
      this._bus.emit('session:pause');
      this._stopRoundTimer();
    }
  }

  _endSession() {
    this._pauseOvl.classList.remove('visible');
    this._comboEngine.endSession();
  }

  // ── Countdown ─────────────────────────────────────────────

  async _runCountdown(from) {
    this._countdownOvl.classList.add('visible');
    for (let i = from; i >= 1; i--) {
      this._countdownNum.textContent = i;
      // Re-trigger animation
      this._countdownNum.style.animation = 'none';
      this._countdownNum.offsetWidth;
      this._countdownNum.style.animation = '';
      this._audio.playTone(800, 0.12, 'sine', 0.4);
      await delay(900);
    }
    this._countdownOvl.classList.remove('visible');
  }

  // ── Round timer ───────────────────────────────────────────

  _startRoundTimer(duration) {
    this._stopRoundTimer();
    const endAt = Date.now() + duration * 1000;
    this._roundTimerId = setInterval(() => {
      const remaining = Math.max(0, (endAt - Date.now()) / 1000);
      this._hud.setTimer(remaining);
      if (remaining <= 0) this._stopRoundTimer();
    }, 250);
    this._hud.setTimer(duration);
  }

  _stopRoundTimer() {
    clearInterval(this._roundTimerId);
    this._roundTimerId = null;
  }

  // ── Canvas sizing ─────────────────────────────────────────

  _syncCanvasSize() {
    const zone = this._cameraZone;
    const w    = zone.clientWidth;
    const h    = zone.clientHeight;
    this._renderer.resize(w, h);
  }

  _startResizeObserver() {
    if (!window.ResizeObserver) return;
    this._resizeObserver?.disconnect();
    this._resizeObserver = new ResizeObserver(() => this._syncCanvasSize());
    this._resizeObserver.observe(this._cameraZone);
  }

  // ── Wake Lock ─────────────────────────────────────────────

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* not critical */ }
  }

  _releaseWakeLock() {
    this._wakeLock?.release();
    this._wakeLock = null;
  }

  // ── Camera permission error ───────────────────────────────

  _showCameraPrompt() {
    this._cameraPrompt.classList.add('visible');
  }

  // ── Clean up ──────────────────────────────────────────────

  _cleanUp() {
    this._stopRoundTimer();
    this._unsubscribeAll();
    this._poseEngine.stopProcessing();
    this._camera.stop();
    this._renderer.clearPose();
    this._renderer.clearFX();
    this._releaseWakeLock();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  // ── Helpers ───────────────────────────────────────────────

  _vibrate(pattern) {
    navigator.vibrate?.(pattern);
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));
