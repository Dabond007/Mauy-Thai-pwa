/**
 * js/screens/home.js — Home.
 *
 * Phase A build: the camera, tracking, calibration and voice foundations.
 * Learn / Drill / Round / Library / Progress arrive in later phases (§13)
 * and are shown as "coming next" so the layout doesn't jump around later.
 */

const DAY = 24 * 3600 * 1000;

function ago(ts) {
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

export class HomeScreen {
  constructor({ bus, settings }) {
    this.bus = bus;
    this.settings = settings;
    this.el = document.getElementById('home-screen');
  }

  show() {
    const c = this.settings.calibration;
    const calibText = c
      ? `${c.stance === 'southpaw' ? 'Southpaw' : 'Orthodox'} · calibrated ${ago(c.createdAt)}`
      : 'Not calibrated yet — takes under a minute';

    this.el.innerHTML = `
      <header class="home-header">
        <h1>Nak Muay</h1>
        <button class="icon-btn" id="home-settings" aria-label="Settings">⚙︎</button>
      </header>
      <div class="home-content">
        <section class="card">
          <h2>Stance check</h2>
          <p class="muted">Sets up the camera, calibrates to your body if needed, then a one-minute stance hold that tests tracking and the out-of-frame pause.</p>
          <button class="start-btn" id="home-start">▶ Start</button>
          <p class="calib-line" id="home-calib">${calibText}</p>
          <button class="btn-secondary" id="home-calibrate">${c ? 'Re-calibrate' : 'Calibrate'}</button>
        </section>

        <section class="card">
          <h2>Angle test</h2>
          <p class="muted">Calls out stance, jabs, crosses, kicks and teeps with a beep for each, and records a debug log (numbers only) to compare camera angles. About 2½ minutes.</p>
          <div class="btn-row">
            <button class="btn-primary" id="home-angle-30">30°</button>
            <button class="btn-secondary" id="home-angle-45">45°</button>
          </div>
        </section>

        <section class="card">
          <h2>Coming next</h2>
          <div class="tile-grid">
            <div class="tile disabled"><span>Daily Basics</span></div>
            <div class="tile disabled"><span>Learn</span></div>
            <div class="tile disabled"><span>Drill</span></div>
            <div class="tile disabled"><span>Round</span></div>
            <div class="tile disabled"><span>Library</span></div>
            <div class="tile disabled"><span>Progress</span></div>
          </div>
          <p class="muted small">This build checks the foundations on your phone: framing, left/right detection, calibration, out-of-frame and voice. Teaching and scoring come in the next phase.</p>
        </section>

        <p class="muted small privacy">Video never leaves your phone and is never recorded.</p>
      </div>
    `;

    this.el.querySelector('#home-start').addEventListener('click', () =>
      this.bus.emit('navigate:setup', { next: 'practice' }));
    this.el.querySelector('#home-calibrate').addEventListener('click', () =>
      this.bus.emit('navigate:setup', { forceCalibrate: true, next: 'home' }));
    this.el.querySelector('#home-angle-30').addEventListener('click', () =>
      this.bus.emit('navigate:angle-test', { angle: 30 }));
    this.el.querySelector('#home-angle-45').addEventListener('click', () =>
      this.bus.emit('navigate:angle-test', { angle: 45 }));
    this.el.querySelector('#home-settings').addEventListener('click', () =>
      this.bus.emit('navigate:settings'));
  }
}
