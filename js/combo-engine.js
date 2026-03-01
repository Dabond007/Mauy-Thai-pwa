/**
 * js/combo-engine.js — Combo Engine
 *
 * Manages the sequence of move callouts within a training session.
 * Controls timing, tracks hits/misses, and emits scoring events.
 *
 * Timing model (announce-then-track):
 *   1. Full combo is announced via TTS ("Jab, Cross!")
 *   2. After TTS finishes, a start beep plays
 *   3. Individual moves are cued with short tone pings (no TTS)
 *   4. User executes each move; scored on detection or window timeout
 *
 * Events emitted:
 *   combo:announce      { text, comboName, sequence }  — TTS speaks full combo
 *   combo:start         { comboId, comboName, sequence }
 *   combo:callout       { moveId, moveName, calloutTime, sequence, moveIndex }
 *   combo:windowClose   (timing window expired for current move)
 *   combo:hit           { moveId, rating, points, streak }
 *   combo:miss          { moveId }
 *   combo:complete      { comboId, hits, misses }
 *   combo:ttsRateAdjust { rate }
 *   session:roundStart  { roundNum }
 *   session:roundEnd    { roundNum, score }
 *   session:complete    { totalScore, rounds, hits, misses, accuracy, ratings }
 *
 * Events consumed:
 *   classifier:result         — move detection from MoveClassifier
 *   combo:announceComplete    — TTS finished announcing the combo
 *   session:pause / session:resume
 */

const SPEED_MULTIPLIERS = {
  slow:   1.5,
  normal: 1.0,
  fast:   0.7,
  elite:  0.5,
};

// Adaptive TTS rate settings (applies to combo announcement voice)
const TTS_RATE_MIN   = 1.0;
const TTS_RATE_MAX   = 2.0;
const TTS_RATE_BASE  = 1.3;
const TTS_RATE_WINDOW = 6;

// Delay after the "go" beep before the first move ping (ms)
const GO_BEEP_DELAY_MS = 400;

export class ComboEngine {
  constructor(bus) {
    this._bus    = bus;
    this._combos = [];
    this._moves  = {};   // id → move definition

    // Session state
    this._session        = null;
    this._roundTimer     = null;
    this._calloutTimer   = null;
    this._windowTimer    = null;
    this._announceTimer  = null;
    this._paused         = false;
    this._pausedAt       = 0;

    // Per-combo state
    this._currentCombo   = null;
    this._moveIndex      = 0;
    this._comboHits      = 0;
    this._comboMisses    = 0;

    // Per-move state
    this._currentCalloutTime = 0;
    this._currentMoveId      = null;
    this._currentMoveDef     = null;
    this._currentMoveScored  = false;

    // Cumulative session stats
    this._totalScore     = 0;
    this._streak         = 0;
    this._bestStreak     = 0;
    this._ratings        = { perfect: 0, great: 0, good: 0, miss: 0 };
    this._sessionHits    = 0;
    this._sessionMisses  = 0;
    this._roundScores    = [];

    // Adaptive TTS rate
    this._recentResults  = [];
    this._currentTTSRate = TTS_RATE_BASE;

    // Subscribe to events
    bus.on('classifier:result', data => this._onClassifierResult(data));
    bus.on('combo:announceComplete', () => this._onAnnounceComplete());
    bus.on('session:pause',  () => this._pause());
    bus.on('session:resume', () => this._resume());
  }

  async loadCombos() {
    const [movesRes, combosRes] = await Promise.all([
      fetch('./data/moves.json'),
      fetch('./data/combos.json'),
    ]);
    const movesData  = await movesRes.json();
    const combosData = await combosRes.json();

    this._moves  = Object.fromEntries(movesData.moves.map(m => [m.id, m]));
    this._combos = combosData.combos;
  }

  /**
   * Begin a training session.
   */
  startSession(config) {
    this._session = {
      rounds:        config.rounds       ?? 3,
      roundDuration: config.roundDuration ?? 180,
      restDuration:  config.restDuration  ?? 60,
      speedMult:     SPEED_MULTIPLIERS[config.speed ?? 'normal'],
      comboId:       config.selectedComboId ?? null,
      currentRound:  0,
    };

    this._totalScore    = 0;
    this._streak        = 0;
    this._bestStreak    = 0;
    this._ratings       = { perfect: 0, great: 0, good: 0, miss: 0 };
    this._sessionHits   = 0;
    this._sessionMisses = 0;
    this._roundScores   = [];
    this._recentResults = [];
    this._currentTTSRate = TTS_RATE_BASE;
    this._paused        = false;

    this._startNextRound();
  }

  endSession() {
    this._clearTimers();
    this._emitSessionComplete();
  }

  // ── Round management ──────────────────────────────────────

  _startNextRound() {
    const s = this._session;
    s.currentRound++;

    if (s.currentRound > s.rounds) {
      this._emitSessionComplete();
      return;
    }

    this._bus.emit('session:roundStart', { roundNum: s.currentRound });
    this._roundStartScore = this._totalScore;

    this._bus.emit('session:roundReady', {
      roundNum:     s.currentRound,
      totalRounds:  s.rounds,
      duration:     s.roundDuration,
    });

    this._roundEndAt = Date.now() + s.roundDuration * 1000;
    this._roundTimer = setTimeout(() => this._endRound(), s.roundDuration * 1000);

    this._nextCombo();
  }

  _endRound() {
    this._finalizePendingMove();
    this._clearCalloutTimers();
    const roundScore = this._totalScore - this._roundStartScore;
    this._roundScores.push(roundScore);

    this._bus.emit('session:roundEnd', {
      roundNum: this._session.currentRound,
      score:    roundScore,
    });

    const s = this._session;
    if (s.currentRound < s.rounds) {
      setTimeout(() => this._startNextRound(), s.restDuration * 1000);
      this._bus.emit('session:rest', { duration: s.restDuration });
    } else {
      this._emitSessionComplete();
    }
  }

  _emitSessionComplete() {
    this._clearTimers();
    const total = this._sessionHits + this._sessionMisses;
    this._bus.emit('session:complete', {
      totalScore: this._totalScore,
      rounds:     this._session?.currentRound ?? 0,
      hits:       this._sessionHits,
      misses:     this._sessionMisses,
      accuracy:   total ? Math.round(this._sessionHits / total * 100) : 0,
      ratings:    { ...this._ratings },
      bestStreak: this._bestStreak ?? 0,
    });
  }

  // ── Combo sequencing (announce-then-track) ──────────────────

  _nextCombo() {
    if (this._paused) return;

    // Pick combo
    const eligibleCombos = this._combos.filter(c => c.tier === 1);
    if (!eligibleCombos.length) return;

    if (this._session.comboId) {
      this._currentCombo = eligibleCombos.find(c => c.id === this._session.comboId)
                        ?? eligibleCombos[0];
    } else {
      this._currentCombo = eligibleCombos[Math.floor(Math.random() * eligibleCombos.length)];
    }

    this._moveIndex   = 0;
    this._comboHits   = 0;
    this._comboMisses = 0;

    const combo    = this._currentCombo;
    const moveNames = combo.sequence.map(id => this._moves[id]?.name ?? id);

    this._bus.emit('combo:start', {
      comboId:   combo.id,
      comboName: combo.name,
      sequence:  moveNames,
    });

    // Build TTS announcement: "Jab, Cross!" or "Jab, Cross, Hook!"
    const ttsText = combo.sequence
      .map(id => this._moves[id]?.tts_callout ?? id)
      .join(' ');

    // Announce the full combo via TTS — training screen will speak it
    // and emit combo:announceComplete when TTS finishes
    this._bus.emit('combo:announce', {
      text:      ttsText,
      comboName: combo.name,
      sequence:  moveNames,
    });
  }

  /**
   * Called when TTS finishes announcing the combo.
   * Play start beep then begin move tracking.
   */
  _onAnnounceComplete() {
    if (this._paused) return;

    // Emit "go" beep event (training screen plays the tone)
    this._bus.emit('combo:go');

    // Short delay after beep, then start tracking moves
    this._announceTimer = setTimeout(() => {
      if (!this._paused) this._activateNextMove();
    }, GO_BEEP_DELAY_MS);
  }

  /**
   * Activate the next move in the combo sequence.
   * Plays a tone ping (not TTS) and opens the detection window.
   */
  _activateNextMove() {
    if (this._paused) return;

    const combo = this._currentCombo;
    if (!combo || this._moveIndex >= combo.sequence.length) {
      this._onComboComplete();
      return;
    }

    // Finalize previous move if still pending
    this._finalizePendingMove();

    const moveId  = combo.sequence[this._moveIndex];
    const moveDef = this._moves[moveId];
    if (!moveDef) {
      this._moveIndex++;
      this._activateNextMove();
      return;
    }

    const calloutTime = performance.now();

    // Emit callout — training screen plays a tone ping and updates HUD
    this._bus.emit('combo:callout', {
      moveId,
      moveName:    moveDef.name,
      calloutTime,
      sequence:    combo.sequence,
      moveIndex:   this._moveIndex,
    });

    // Set up detection window
    const windowMs = (moveDef.detection_window_ms ?? 1000) * this._session.speedMult;
    this._currentCalloutTime = calloutTime;
    this._currentMoveId      = moveId;
    this._currentMoveDef     = moveDef;
    this._currentMoveScored  = false;

    // Window timeout → miss
    clearTimeout(this._windowTimer);
    this._windowTimer = setTimeout(() => {
      if (!this._currentMoveScored) {
        this._bus.emit('combo:windowClose');
        this._recordResult(false, moveId, null);
        // Advance to next move after a miss
        this._moveIndex++;
        this._activateNextMove();
      }
    }, windowMs);
  }

  _finalizePendingMove() {
    if (this._currentMoveId && !this._currentMoveScored) {
      clearTimeout(this._windowTimer);
      this._bus.emit('combo:windowClose');
      this._recordResult(false, this._currentMoveId, null);
    }
  }

  _onComboComplete() {
    this._currentMoveId = null;
    this._currentMoveScored = true;

    this._bus.emit('combo:complete', {
      comboId: this._currentCombo?.id,
      hits:    this._comboHits,
      misses:  this._comboMisses,
    });

    // Rest between combos, then next combo
    const rest = 1500 * this._session.speedMult;
    setTimeout(() => {
      if (!this._paused) this._nextCombo();
    }, rest);
  }

  // ── Scoring ───────────────────────────────────────────────

  _onClassifierResult({ detected, moveId, confidence, detectionTime }) {
    if (!detected || moveId !== this._currentMoveId) return;
    if (this._currentMoveScored) return;

    clearTimeout(this._windowTimer);
    this._bus.emit('combo:windowClose');

    this._recordResult(true, moveId, detectionTime);

    // On hit, advance to next move after a short recovery pause
    const recoveryMs = (this._currentMoveDef?.recovery_ms ?? 300) * this._session.speedMult;
    this._calloutTimer = setTimeout(() => {
      this._moveIndex++;
      this._activateNextMove();
    }, recoveryMs);
  }

  _recordResult(hit, moveId, detectionTime) {
    if (this._currentMoveScored && moveId === this._currentMoveId) return;
    this._currentMoveScored = true;

    let rating = 'miss';
    let points = 0;

    if (hit) {
      const delta = detectionTime != null
        ? Math.max(0, detectionTime - this._currentCalloutTime)
        : 999;

      if (delta <= 100)      { rating = 'perfect'; points = 100; }
      else if (delta <= 250) { rating = 'great';   points = 75;  }
      else                   { rating = 'good';    points = 50;  }

      this._streak++;
      this._bestStreak = Math.max(this._bestStreak ?? 0, this._streak);
      this._comboHits++;
      this._sessionHits++;
    } else {
      this._streak = 0;
      this._comboMisses++;
      this._sessionMisses++;
    }

    // Streak multiplier
    let mult = 1;
    if (this._streak >= 20)      mult = 3;
    else if (this._streak >= 10) mult = 2;
    else if (this._streak >= 5)  mult = 1.5;

    const scored = Math.round(points * mult);
    this._totalScore += scored;
    this._ratings[rating]++;

    if (hit) {
      this._bus.emit('combo:hit', {
        moveId, rating, points: scored, streak: this._streak,
        totalScore: this._totalScore,
      });
    } else {
      this._bus.emit('combo:miss', { moveId, totalScore: this._totalScore });
    }

    // Adaptive TTS rate
    this._recentResults.push(hit);
    if (this._recentResults.length > TTS_RATE_WINDOW) {
      this._recentResults.shift();
    }
    this._updateTTSRate();
  }

  _updateTTSRate() {
    if (this._recentResults.length < 3) return;

    const hits = this._recentResults.filter(Boolean).length;
    const hitRate = hits / this._recentResults.length;

    const newRate = TTS_RATE_MIN + (TTS_RATE_MAX - TTS_RATE_MIN) * hitRate;
    this._currentTTSRate = this._currentTTSRate * 0.6 + newRate * 0.4;
    this._currentTTSRate = Math.max(TTS_RATE_MIN, Math.min(TTS_RATE_MAX, this._currentTTSRate));

    this._bus.emit('combo:ttsRateAdjust', { rate: this._currentTTSRate });
  }

  // ── Pause / resume ────────────────────────────────────────

  _pause() {
    if (this._paused) return;
    this._paused   = true;
    this._pausedAt = Date.now();
    this._clearCalloutTimers();
  }

  _resume() {
    if (!this._paused) return;
    this._paused = false;
    this._nextCombo();
  }

  // ── Helpers ───────────────────────────────────────────────

  _clearTimers() {
    clearTimeout(this._roundTimer);
    this._clearCalloutTimers();
  }

  _clearCalloutTimers() {
    clearTimeout(this._calloutTimer);
    clearTimeout(this._windowTimer);
    clearTimeout(this._announceTimer);
    this._calloutTimer  = null;
    this._windowTimer   = null;
    this._announceTimer = null;
  }

  getMoveDefinition(moveId) {
    return this._moves[moveId] ?? null;
  }

  getCombos() {
    return this._combos;
  }
}
