/**
 * js/screens/results.js — Results Screen
 *
 * Displays post-session statistics: score, accuracy, ratings breakdown,
 * and buttons to start a new session or train again with the same config.
 */

export class ResultsScreen {
  constructor(bus) {
    this._bus  = bus;
    this._el   = document.getElementById('results-screen');
    this._lastConfig = null;
  }

  /**
   * @param {{
   *   totalScore: number,
   *   rounds: number,
   *   hits: number,
   *   misses: number,
   *   accuracy: number,
   *   ratings: { perfect, great, good, miss },
   *   bestStreak: number,
   *   config: object,
   * }} data
   */
  show(data) {
    this._lastConfig = data.config ?? null;
    this._render(data);
  }

  hide() {}

  // ── Render ────────────────────────────────────────────────

  _render(data) {
    const total     = data.hits + data.misses;
    const accuracy  = data.accuracy ?? (total ? Math.round(data.hits / total * 100) : 0);
    const ratings   = data.ratings ?? { perfect: 0, great: 0, good: 0, miss: 0 };
    const ratTotal  = ratings.perfect + ratings.great + ratings.good + ratings.miss;

    const durationSec = (data.config?.roundDuration ?? 180) * (data.rounds ?? 1);
    const mins  = Math.floor(durationSec / 60);
    const secs  = durationSec % 60;
    const durStr = secs ? `${mins}m ${secs}s` : `${mins} min`;

    this._el.innerHTML = `
      <div class="results-header">
        <h1 style="color: var(--accent)">Session Complete</h1>
        <p class="round-summary">
          ${data.rounds ?? 1} round${(data.rounds ?? 1) !== 1 ? 's' : ''} · ${durStr}
        </p>
      </div>

      <div class="results-content">

        <!-- Hero score -->
        <div class="results-score-hero">
          <div class="total-score">${(data.totalScore ?? 0).toLocaleString()}</div>
          <div class="total-score-label">Total Score</div>
        </div>

        <!-- Stats grid -->
        <div class="results-stats-grid">
          <div class="result-stat">
            <div class="result-stat-value">${accuracy}%</div>
            <div class="result-stat-label">Accuracy</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">${data.bestStreak ?? 0}</div>
            <div class="result-stat-label">Best Streak</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">${data.hits ?? 0}</div>
            <div class="result-stat-label">Hits</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">${data.misses ?? 0}</div>
            <div class="result-stat-label">Missed</div>
          </div>
        </div>

        <!-- Ratings breakdown -->
        <div class="accuracy-bar-container">
          <h3>Timing Breakdown</h3>
          ${this._ratingBar('Perfect', ratings.perfect, ratTotal, '#ffd700')}
          ${this._ratingBar('Great',   ratings.great,   ratTotal, '#48bb78')}
          ${this._ratingBar('Good',    ratings.good,    ratTotal, '#63b3ed')}
          ${this._ratingBar('Miss',    ratings.miss,    ratTotal, '#fc8181')}
        </div>

        <!-- Actions -->
        <div class="results-actions">
          <button class="btn-primary" id="train-again-btn">▶ Train Again</button>
          <button class="btn-secondary" id="new-session-btn">New Session</button>
        </div>

      </div>
    `;

    // Animate bars after paint
    requestAnimationFrame(() => {
      this._el.querySelectorAll('.accuracy-bar-fill').forEach(bar => {
        const target = bar.dataset.target;
        bar.style.width = `${target}%`;
      });
    });

    // Buttons
    this._el.querySelector('#train-again-btn').addEventListener('click', () => {
      if (this._lastConfig) {
        this._bus.emit('navigate:training', this._lastConfig);
      } else {
        this._bus.emit('navigate:home');
      }
    });

    this._el.querySelector('#new-session-btn').addEventListener('click', () => {
      this._bus.emit('navigate:home');
    });
  }

  _ratingBar(label, count, total, color) {
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <div class="accuracy-row">
        <span class="accuracy-label">${label}</span>
        <div class="accuracy-bar-bg">
          <div class="accuracy-bar-fill"
               data-target="${pct}"
               style="width:0%; background:${color}">
          </div>
        </div>
        <span class="accuracy-count">${count}</span>
      </div>
    `;
  }
}
