/**
 * js/screens/home.js — Home Screen
 *
 * Dashboard / session launcher. Renders the home UI into #home-screen,
 * handles session configuration, and emits navigate:training when ready.
 */

const DEFAULT_CONFIG = {
  rounds:          3,
  roundDuration:   180,  // seconds (3 min)
  restDuration:    60,
  speed:           'normal',
  mode:            'shadow',
  selectedComboId: null,  // null = random
};

export class HomeScreen {
  constructor(bus) {
    this._bus    = bus;
    this._el     = document.getElementById('home-screen');
    this._config = { ...DEFAULT_CONFIG };
    this._combos = [];

    this._render();
    this._loadCombos();
  }

  show() {
    // Refresh stats if any
    this._updateStats();
  }

  hide() {}

  // ── Render ────────────────────────────────────────────────

  _render() {
    this._el.innerHTML = `
      <div class="home-header">
        <h1>Nak Muay</h1>
        <div class="profile-badge" title="Profile">🥊</div>
      </div>

      <div class="home-content">

        <!-- Stats row -->
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-value" id="stat-sessions">0</div>
            <div class="stat-label">Sessions</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-streak">0</div>
            <div class="stat-label">Best Streak</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-accuracy">—</div>
            <div class="stat-label">Accuracy</div>
          </div>
        </div>

        <!-- Session config -->
        <div class="config-card">
          <h2>Session Setup</h2>

          <!-- Training mode -->
          <div class="config-row">
            <span class="config-label">Mode</span>
            <div class="toggle-btn-group" id="mode-group">
              <button class="toggle-btn active" data-mode="shadow">Shadow</button>
              <button class="toggle-btn"        data-mode="heavybag">Bag</button>
            </div>
          </div>

          <!-- Rounds -->
          <div class="config-row">
            <span class="config-label">Rounds</span>
            <div class="toggle-btn-group" id="rounds-group">
              <button class="toggle-btn" data-rounds="1">1</button>
              <button class="toggle-btn active" data-rounds="3">3</button>
              <button class="toggle-btn" data-rounds="5">5</button>
            </div>
          </div>

          <!-- Round duration -->
          <div class="config-row">
            <span class="config-label">Duration</span>
            <div class="toggle-btn-group" id="duration-group">
              <button class="toggle-btn" data-dur="60">1 min</button>
              <button class="toggle-btn active" data-dur="180">3 min</button>
              <button class="toggle-btn" data-dur="300">5 min</button>
            </div>
          </div>

          <!-- Speed -->
          <div class="config-row">
            <span class="config-label">Speed</span>
            <div class="toggle-btn-group" id="speed-group">
              <button class="toggle-btn" data-speed="slow">Slow</button>
              <button class="toggle-btn active" data-speed="normal">Normal</button>
              <button class="toggle-btn" data-speed="fast">Fast</button>
            </div>
          </div>
        </div>

        <!-- Combo selection -->
        <div class="combo-list-card">
          <h2>Combos</h2>
          <div id="combo-list">
            <!-- Populated after data loads -->
            <div class="combo-item">
              <div>
                <div class="combo-name">Loading combos…</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Start button -->
        <button class="start-btn" id="start-btn">▶ Start Training</button>

      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    // Toggle button groups
    this._el.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._config.mode = btn.dataset.mode;
      });
    });

    this._el.querySelectorAll('[data-rounds]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('[data-rounds]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._config.rounds = Number(btn.dataset.rounds);
      });
    });

    this._el.querySelectorAll('[data-dur]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('[data-dur]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._config.roundDuration = Number(btn.dataset.dur);
      });
    });

    this._el.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._config.speed = btn.dataset.speed;
      });
    });

    // Start button
    this._el.querySelector('#start-btn').addEventListener('click', () => {
      this._bus.emit('navigate:training', { ...this._config });
    });
  }

  // ── Combo list ────────────────────────────────────────────

  async _loadCombos() {
    try {
      const res    = await fetch('/data/combos.json');
      const data   = await res.json();
      this._combos = data.combos ?? [];
      this._renderComboList();
    } catch {
      // Non-critical; combos list just won't be interactive
    }
  }

  _renderComboList() {
    const list = this._el.querySelector('#combo-list');
    if (!list) return;

    list.innerHTML = '';

    // "Random" option at top
    const randomItem = this._makeComboItem(null, '🎲 Random', 'Mix of all combos');
    randomItem.classList.add('selected');
    list.appendChild(randomItem);

    for (const combo of this._combos.filter(c => c.tier === 1)) {
      const seqText = combo.sequence?.join(' → ') ?? '';
      const item    = this._makeComboItem(combo.id, combo.name, seqText, combo.difficulty);
      list.appendChild(item);
    }
  }

  _makeComboItem(id, name, subtitle, difficulty = 0) {
    const item = document.createElement('div');
    item.className  = 'combo-item';
    item.dataset.id = id ?? '';

    const dots = Array.from({ length: 5 }, (_, i) =>
      `<span class="diff-dot${i < difficulty ? ' filled' : ''}"></span>`
    ).join('');

    item.innerHTML = `
      <div style="flex:1">
        <div class="combo-name">${name}</div>
        ${subtitle ? `<div class="combo-sequence">${subtitle}</div>` : ''}
      </div>
      <div class="combo-difficulty">${dots}</div>
    `;

    item.addEventListener('click', () => {
      this._el.querySelectorAll('.combo-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      this._config.selectedComboId = id || null;
    });

    return item;
  }

  // ── Stats ─────────────────────────────────────────────────

  _updateStats() {
    // In Phase 1 there's no IndexedDB persistence yet, so stats start at 0
    const sessions  = Number(sessionStorage.getItem('nmt_sessions')  ?? 0);
    const bestStreak = Number(sessionStorage.getItem('nmt_bestStreak') ?? 0);
    const accuracy  = sessionStorage.getItem('nmt_accuracy') ?? '—';

    const s = this._el.querySelector('#stat-sessions');
    const t = this._el.querySelector('#stat-streak');
    const a = this._el.querySelector('#stat-accuracy');
    if (s) s.textContent = sessions;
    if (t) t.textContent = bestStreak;
    if (a) a.textContent = accuracy !== '—' ? `${accuracy}%` : '—';
  }
}
