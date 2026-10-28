/**
 * js/screens/settings.js — Settings (§5.1).
 */

export class SettingsScreen {
  constructor({ bus, settings, voice, tones, poseEngine, log }) {
    this.log = log;
    this.bus = bus;
    this.settings = settings;
    this.voice = voice;
    this.tones = tones;
    this.poseEngine = poseEngine;
    this.el = document.getElementById('settings-screen');
  }

  show() {
    const v = this.settings.values;
    const c = this.settings.calibration;
    const opt = (name, value, label, current) =>
      `<button class="toggle-btn${current === value ? ' active' : ''}" data-${name}="${value}">${label}</button>`;

    this.el.innerHTML = `
      <header class="home-header">
        <button class="icon-btn" id="settings-back" aria-label="Back">‹</button>
        <h1>Settings</h1>
        <span></span>
      </header>
      <div class="home-content">
        <section class="card">
          <h2>Stance</h2>
          <div class="toggle-btn-group">
            ${opt('stance', 'orthodox', 'Orthodox', c?.stance)}
            ${opt('stance', 'southpaw', 'Southpaw', c?.stance)}
          </div>
          <p class="muted small">${c ? 'Lead and rear follow your stance. Switch any day.' : 'Calibrate first to set your stance.'}</p>
          <button class="btn-secondary" id="set-recalibrate">Re-calibrate</button>
        </section>

        <section class="card">
          <h2>Voice</h2>
          <label class="row">Speed <input type="range" id="set-rate" min="0.7" max="1.5" step="0.05" value="${v.voiceRate}"><span id="set-rate-val">${v.voiceRate.toFixed(2)}×</span></label>
          <label class="row">Volume <input type="range" id="set-volume" min="0" max="1" step="0.05" value="${v.voiceVolume}"><span id="set-volume-val">${Math.round(v.voiceVolume * 100)}%</span></label>
          <div class="row">Coaching
            <div class="toggle-btn-group">
              ${opt('verbosity', 'quiet', 'Quiet', v.verbosity)}
              ${opt('verbosity', 'normal', 'Normal', v.verbosity)}
              ${opt('verbosity', 'chatty', 'Chatty', v.verbosity)}
            </div>
          </div>
          <div class="row">Tones
            <div class="toggle-btn-group">
              ${opt('tones', 'on', 'On', v.tones ? 'on' : 'off')}
              ${opt('tones', 'off', 'Off', v.tones ? 'on' : 'off')}
            </div>
          </div>
          <button class="btn-secondary" id="set-test-voice">Test voice and tones</button>
          ${this.voice.available ? '' : '<p class="warn small">Speech isn’t available in this browser.</p>'}
        </section>

        <section class="card">
          <h2>Detection</h2>
          <p class="muted small">Pose model: Full (${this.poseEngine.delegate ?? '—'}). The Heavy model ran at about 16 fps on a Pixel 9 — too slow to follow strikes — so it isn't offered.</p>
          <div class="row">Debug overlay
            <div class="toggle-btn-group">
              ${opt('debug', 'on', 'On', v.debug ? 'on' : 'off')}
              ${opt('debug', 'off', 'Off', v.debug ? 'on' : 'off')}
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Debug log</h2>
          <p class="muted small">For tuning detection. Records pose numbers only — never images — in memory on this phone (the last 3 minutes). Nothing leaves the phone unless you download it.</p>
          <div class="row">Record
            <div class="toggle-btn-group">
              ${opt('log', 'on', 'On', v.recordLog ? 'on' : 'off')}
              ${opt('log', 'off', 'Off', v.recordLog ? 'on' : 'off')}
            </div>
          </div>
          <button class="btn-secondary" id="set-log-download"${this.log.frames.length ? '' : ' disabled'}>Download log (${Math.round(this.log.seconds)} s)</button>
          <button class="btn-secondary" id="set-log-clear"${this.log.frames.length ? '' : ' disabled'}>Clear log</button>
          <p class="muted small" id="set-log-note"></p>
        </section>

        <section class="card">
          <h2>Your data</h2>
          <p class="muted small">Settings and calibration numbers are stored on this phone only. No video, ever.</p>
          <button class="btn-danger" id="set-delete">Delete everything</button>
        </section>

        <p class="muted small privacy">Nak Muay Trainer v2 · Phase A build</p>
      </div>
    `;
    this._bind();
  }

  _bind() {
    const $ = s => this.el.querySelector(s);
    const group = (name, fn) => this.el.querySelectorAll(`[data-${name}]`).forEach(b =>
      b.addEventListener('click', async () => {
        this.el.querySelectorAll(`[data-${name}]`).forEach(x => x.classList.toggle('active', x === b));
        await fn(b.dataset[name]);
      }));

    $('#settings-back').addEventListener('click', () => this.bus.emit('navigate:home'));
    $('#set-recalibrate').addEventListener('click', () =>
      this.bus.emit('navigate:setup', { forceCalibrate: true, next: 'home' }));

    group('stance', async s => {
      if (!this.settings.calibration) {
        this.show();
        return;
      }
      await this.settings.setStance(s);
    });
    group('verbosity', s => this.settings.set('verbosity', s));
    group('tones', s => this.settings.set('tones', s === 'on'));
    group('debug', s => this.settings.set('debug', s === 'on'));
    group('log', s => this.settings.set('recordLog', s === 'on'));

    $('#set-log-download').addEventListener('click', () => {
      const bytes = this.log.download();
      $('#set-log-note').textContent = `Saved ${(bytes / 1e6).toFixed(1)} MB to your Downloads folder.`;
    });
    $('#set-log-clear').addEventListener('click', () => {
      this.log.clear();
      this.show();
    });
    const rate = $('#set-rate');
    rate.addEventListener('input', () => {
      $('#set-rate-val').textContent = `${Number(rate.value).toFixed(2)}×`;
    });
    rate.addEventListener('change', () => this.settings.set('voiceRate', Number(rate.value)));

    const vol = $('#set-volume');
    vol.addEventListener('input', () => {
      $('#set-volume-val').textContent = `${Math.round(vol.value * 100)}%`;
    });
    vol.addEventListener('change', () => this.settings.set('voiceVolume', Number(vol.value)));

    $('#set-test-voice').addEventListener('click', () => {
      this.voice.unlock?.();
      this.tones.unlock();
      this.tones.clean();
      setTimeout(() => this.tones.good(), 400);
      setTimeout(() => this.tones.fix(), 800);
      this.voice.say('Gloves by your eyebrows. Out of frame. Back in frame.');
    });

    $('#set-delete').addEventListener('click', async () => {
      if (!confirm('Delete all settings and calibration from this phone?')) return;
      await this.settings.deleteEverything();
      this.log.clear();
      this.show();
    });
  }
}
