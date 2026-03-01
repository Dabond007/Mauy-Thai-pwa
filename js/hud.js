/**
 * js/hud.js — HUD (Heads-Up Display) Manager
 * Updates the DOM overlay elements in the training screen:
 * combo progress bar, score, streak, timer, timing feedback, next-move preview.
 */

export class HUD {
  constructor(bus) {
    this._bus = bus;

    // DOM refs
    this._comboBarZone    = document.getElementById('combo-bar-zone');
    this._scoreValue      = document.getElementById('score-value');
    this._streakDisplay   = document.getElementById('streak-display');
    this._timingFeedback  = document.getElementById('timing-feedback');
    this._roundInfo       = document.getElementById('round-info');
    this._roundTimer      = document.getElementById('round-timer');
    this._nextMoveName    = document.getElementById('next-move-name');
    this._currentCallout  = document.getElementById('current-callout');

    this._feedbackTimer = null;
  }

  // ── Combo bar ──────────────────────────────────────────────

  /**
   * Render the combo progress bar for a sequence of moves.
   * @param {string[]} moveNames  Display names of each move in the combo
   */
  setComboSequence(moveNames) {
    this._comboBarZone.innerHTML = '';
    moveNames.forEach(() => {
      const step = document.createElement('div');
      step.className = 'combo-step';
      this._comboBarZone.appendChild(step);
    });
  }

  /**
   * Update which step is active/done/missed.
   * @param {number} index       Current move index (0-based)
   * @param {string} [result]    'done' | 'missed' | null (just activate)
   */
  setComboStep(index, result = null) {
    const steps = this._comboBarZone.querySelectorAll('.combo-step');
    steps.forEach((step, i) => {
      step.className = 'combo-step';
      if (i < index)  step.classList.add('done');
      if (i === index) {
        if (result === 'done')   step.classList.add('done');
        else if (result === 'missed') step.classList.add('missed');
        else                    step.classList.add('active');
      }
    });
  }

  clearComboBar() {
    this._comboBarZone.innerHTML = '';
  }

  // ── Score & streak ─────────────────────────────────────────

  setScore(score) {
    this._scoreValue.textContent = score.toLocaleString();
  }

  setStreak(streak) {
    if (streak <= 1) {
      this._streakDisplay.textContent = '';
    } else {
      this._streakDisplay.textContent = `×${streak}`;
    }
  }

  // ── Timing feedback ────────────────────────────────────────

  /**
   * Flash a timing rating label.
   * @param {'perfect'|'great'|'good'|'miss'} rating
   */
  showRating(rating) {
    clearTimeout(this._feedbackTimer);
    const labels = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
    this._timingFeedback.textContent  = labels[rating] ?? '';
    this._timingFeedback.className    = rating;
    this._feedbackTimer = setTimeout(() => {
      this._timingFeedback.textContent = '';
      this._timingFeedback.className   = '';
    }, 900);
  }

  // ── Round timer ────────────────────────────────────────────

  setRoundInfo(roundNum, totalRounds) {
    this._roundInfo.textContent = `Round ${roundNum} / ${totalRounds}`;
  }

  /**
   * @param {number} seconds  Remaining seconds in the round
   */
  setTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this._roundTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this._roundTimer.classList.toggle('warning', seconds <= 10);
  }

  // ── Next move / callout ────────────────────────────────────

  /** Show the name of the upcoming move in the next-move zone. */
  setNextMove(name) {
    this._nextMoveName.textContent = name ?? '—';
    this._currentCallout.classList.add('hidden');
    this._nextMoveName.classList.remove('hidden');
  }

  /** Flash the current callout name big and bold. */
  showCallout(name) {
    this._currentCallout.textContent = name;
    this._currentCallout.classList.remove('hidden');
    this._nextMoveName.classList.add('hidden');

    // Re-trigger animation
    this._currentCallout.style.animation = 'none';
    this._currentCallout.offsetWidth; // reflow
    this._currentCallout.style.animation = '';

    // Hide after 600ms and revert to next-move display
    setTimeout(() => {
      this._currentCallout.classList.add('hidden');
      this._nextMoveName.classList.remove('hidden');
    }, 600);
  }

  // ── Misc ───────────────────────────────────────────────────

  reset() {
    this.setScore(0);
    this.setStreak(0);
    this.setTimer(0);
    this.setNextMove(null);
    this._timingFeedback.textContent = '';
    this.clearComboBar();
  }
}
