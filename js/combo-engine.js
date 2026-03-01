/**
 * js/combo-engine.js — Combo Engine
 *
 * Manages the sequence of move callouts within a training session.
 * Controls timing, tracks hits/misses, and emits scoring events.
 *
 * Session flow:
 *   startSession(config) → [countdown] → startRound()
 *     → for each combo: callout moves at intervals
 *       → per move: open timing window → wait → score
 *     → combo ends → next combo / repeat
 *   → endRound() → [rest] → next round or endSession()
 *
 * Events emitted:
 *   combo:callout        { moveId, moveName, calloutTime }
 *   combo:windowClose    (timing window expired)
 *   combo:hit            { moveId, rating, points, streak }
 *   combo:miss           { moveId }
 *   combo:complete       { comboId, hits, misses, score }
 *   session:roundStart   { roundNum }
 *   session:roundEnd     { roundNum, score }
 *   session:complete     { totalScore, rounds, hits, misses, accuracy, ratings }
 *
 * Events consumed:
 *   pose:landmarks  (routed via MoveClassifier → 'classifier:result')
 *   session:pause / session:resume
 */

const SPEED_MULTIPLIERS = {
  slow:   1.5,
  normal: 1.0,
  fast:   0.7,
  elite:  0.5,
};

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
    this._paused         = false;
    this._pausedAt       = 0;

    // Per-combo state
    this._currentCombo   = null;
    this._moveIndex      = 0;
    this._comboHits      = 0;
    this._comboMisses    = 0;

    // Cumulative session stats
    this._totalScore     = 0;
    this._streak         = 0;
    this._ratings        = { perfect: 0, great: 0, good: 0, miss: 0 };
    this._sessionHits    = 0;
    this._sessionMisses  = 0;
    this._roundScores    = [];

    // Subscribe to move detection results
    bus.on('classifier:result', data => this._onClassifierResult(data));
    bus.on('session:pause',  () => this._pause());
    bus.on('session:resume', () => this._resume());
  }

  async loadCombos() {
    const [movesRes, combosRes] = await Promise.all([
      fetch('/data/moves.json'),
      fetch('/data/combos.json'),
    ]);
    const movesData  = await movesRes.json();
    const combosData = await combosRes.json();

    this._moves  = Object.fromEntries(movesData.moves.map(m => [m.id, m]));
    this._combos = combosData.combos;
  }

  /**
   * Begin a training session.
   * @param {{
   *   rounds: number,
   *   roundDuration: number,   // seconds
   *   restDuration: number,    // seconds
   *   speed: 'slow'|'normal'|'fast'|'elite',
   *   mode: 'shadow'|'heavybag',
   *   selectedComboId: string|null,  // null = random
   * }} config
   */
  startSession(config) {
    this._session = {
      rounds:        config.rounds       ?? 3,
      roundDuration: config.roundDuration ?? 180,  // 3 min
      restDuration:  config.restDuration  ?? 60,
      speedMult:     SPEED_MULTIPLIERS[config.speed ?? 'normal'],
      comboId:       config.selectedComboId ?? null,
      currentRound:  0,
    };

    this._totalScore    = 0;
    this._streak        = 0;
    this._ratings       = { perfect: 0, great: 0, good: 0, miss: 0 };
    this._sessionHits   = 0;
    this._sessionMisses = 0;
    this._roundScores   = [];
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

    // Round countdown — handled by TrainingScreen (audio + HUD)
    // Combo engine waits for session:roundReady before calling out
    this._bus.emit('session:roundReady', {
      roundNum:     s.currentRound,
      totalRounds:  s.rounds,
      duration:     s.roundDuration,
    });

    // Round timer
    const roundEndAt = Date.now() + s.roundDuration * 1000;
    this._roundEndAt = roundEndAt;
    this._roundTimer = setTimeout(() => this._endRound(), s.roundDuration * 1000);

    // Start calling out combos
    this._nextCombo();
  }

  _endRound() {
    this._clearCalloutTimers();
    const roundScore = this._totalScore - this._roundStartScore;
    this._roundScores.push(roundScore);

    this._bus.emit('session:roundEnd', {
      roundNum: this._session.currentRound,
      score:    roundScore,
    });

    const s = this._session;
    if (s.currentRound < s.rounds) {
      // Rest period then next round
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

  // ── Combo sequencing ──────────────────────────────────────

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

    this._moveIndex  = 0;
    this._comboHits  = 0;
    this._comboMisses = 0;

    this._bus.emit('combo:start', {
      comboId:   this._currentCombo.id,
      comboName: this._currentCombo.name,
      sequence:  this._currentCombo.sequence.map(id => this._moves[id]?.name ?? id),
    });

    this._calloutNextMove();
  }

  _calloutNextMove() {
    if (this._paused) return;

    const combo  = this._currentCombo;
    if (!combo || this._moveIndex >= combo.sequence.length) {
      this._onComboComplete();
      return;
    }

    const moveId   = combo.sequence[this._moveIndex];
    const moveDef  = this._moves[moveId];
    if (!moveDef) {
      this._moveIndex++;
      this._calloutNextMove();
      return;
    }

    const interval = combo.base_interval_ms * this._session.speedMult;
    const calloutTime = performance.now();

    // Notify classifier and HUD
    this._bus.emit('combo:callout', {
      moveId,
      moveName:    moveDef.name,
      ttsCallout:  moveDef.tts_callout,
      calloutTime,
      sequence:    combo.sequence,
      moveIndex:   this._moveIndex,
    });

    // Open timing window
    const windowMs = (moveDef.detection_window_ms ?? 1000) * this._session.speedMult;
    this._currentCalloutTime = calloutTime;
    this._currentMoveId      = moveId;
    this._currentMoveDef     = moveDef;

    // Close window if no detection
    this._windowTimer = setTimeout(() => {
      this._bus.emit('combo:windowClose');
      this._recordResult(false, moveId, null);
    }, windowMs);

    // Schedule next callout
    this._calloutTimer = setTimeout(() => {
      this._moveIndex++;
      this._calloutNextMove();
    }, interval);
  }

  _onComboComplete() {
    this._bus.emit('combo:complete', {
      comboId: this._currentCombo?.id,
      hits:    this._comboHits,
      misses:  this._comboMisses,
    });

    // Short rest between combos (200ms * speed)
    const rest = 1200 * this._session.speedMult;
    setTimeout(() => {
      if (!this._paused) this._nextCombo();
    }, rest);
  }

  // ── Scoring ───────────────────────────────────────────────

  _onClassifierResult({ detected, moveId, confidence, detectionTime }) {
    if (!detected || moveId !== this._currentMoveId) return;

    // Clear the miss timer
    clearTimeout(this._windowTimer);
    this._bus.emit('combo:windowClose');

    this._recordResult(true, moveId, detectionTime);
  }

  _recordResult(hit, moveId, detectionTime) {
    let rating = 'miss';
    let points = 0;

    if (hit) {
      const delta = detectionTime != null
        ? detectionTime - this._currentCalloutTime
        : 999;

      if (delta < 150)      { rating = 'perfect'; points = 100; }
      else if (delta < 350) { rating = 'great';   points = 75;  }
      else                  { rating = 'good';    points = 50;  }

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
    // Restart from the current move (simplified — just go to next combo)
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
    this._calloutTimer = null;
    this._windowTimer  = null;
  }

  /** Expose move definitions for other modules. */
  getMoveDefinition(moveId) {
    return this._moves[moveId] ?? null;
  }

  getCombos() {
    return this._combos;
  }
}
