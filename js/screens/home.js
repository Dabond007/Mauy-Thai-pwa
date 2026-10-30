/**
 * js/screens/home.js — Home: level, streak, the learning path, setup and tools.
 */

import { LEARNING_PATH } from '../technique/registry.js';
import { xpForLevel } from '../progression.js';

const DAY = 24 * 3600 * 1000;

function ago(ts) {
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

const BADGE = { new: 'New', learning: 'Learning', solid: 'Solid', sharp: 'Sharp' };

export class HomeScreen {
  constructor({ bus, settings, techniques, progression }) {
    this.bus = bus;
    this.settings = settings;
    this.techniques = techniques;
    this.progression = progression;
    this.el = document.getElementById('home-screen');
  }

  show() {
    const c = this.settings.calibration;
    const p = this.progression();
    const lvl = p.level;
    const calibText = c
      ? `${c.stance === 'southpaw' ? 'Southpaw' : 'Orthodox'} · calibrated ${ago(c.createdAt)}`
      : 'Not calibrated yet — takes under a minute';

    const rows = LEARNING_PATH.flat().map(id => {
      const def = this.techniques[id];
      const m = p.mastery(id);
      const locked = !p.unlocked(id);
      return `
        <button class="tech-row${locked ? ' locked' : ''}" data-tech="${id}">
          <span class="tech-name">${locked ? '🔒 ' : ''}${def.name}</span>
          <span class="badge ${m}">${BADGE[m]}</span>
        </button>`;
    }).join('');

    this.el.innerHTML = `
      <header class="home-header">
        <h1>Nak Muay</h1>
        <button class="icon-btn" id="home-settings" aria-label="Settings">⚙︎</button>
      </header>
      <div class="home-content">
        <section class="card player">
          <div class="player-row">
            <span class="level">Level ${lvl}</span>
            <span class="muted small">${p.data.xp} XP · next level at ${xpForLevel(lvl + 1)}</span>
          </div>
          <div class="xp-bar"><div style="width:${Math.round(p.levelProgress * 100)}%"></div></div>
          <div class="player-row muted small">
            <span>🔥 ${p.dailyStreak} day${p.dailyStreak === 1 ? '' : 's'} in a row</span>
            <span>Best streak ${p.data.bestStreak}</span>
          </div>
        </section>

        <section class="card">
          <h2>Learn</h2>
          <div class="tech-list">${rows}</div>
          <p class="muted small">Stance and guard first. Jab and cross unlock when both are Solid (80% clean or good over two sets in a row).</p>
        </section>

        <section class="card">
          <h2>Setup</h2>
          <p class="calib-line">${calibText}</p>
          <p class="muted small">Phone at waist height, about 3 m in front of you and 1.5 m to your rear-hand side. Face a spot on the wall, not the phone.</p>
          <button class="btn-secondary" id="home-calibrate">${c ? 'Re-calibrate' : 'Calibrate'}</button>
        </section>

        <section class="card">
          <h2>Tools</h2>
          <div class="btn-row">
            <button class="btn-secondary" id="home-start">Stance check</button>
            <button class="btn-secondary" id="home-angle-30">Angle test</button>
          </div>
        </section>

        <section class="card">
          <h2>Coming next</h2>
          <div class="tile-grid">
            <div class="tile disabled"><span>Daily Basics</span></div>
            <div class="tile disabled"><span>Drill</span></div>
            <div class="tile disabled"><span>Round</span></div>
            <div class="tile disabled"><span>Kicks</span></div>
            <div class="tile disabled"><span>Library</span></div>
            <div class="tile disabled"><span>Progress</span></div>
          </div>
        </section>

        <p class="muted small privacy">Video never leaves your phone and is never recorded.</p>
      </div>
    `;

    this.el.querySelectorAll('[data-tech]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.tech;
      if (!p.unlocked(id) && !confirm(`${this.techniques[id].name} unlocks when Stance and Guard are Solid. Practise it anyway?`)) return;
      this.bus.emit('navigate:learn', { technique: id });
    }));
    this.el.querySelector('#home-start').addEventListener('click', () =>
      this.bus.emit('navigate:setup', { next: 'practice' }));
    this.el.querySelector('#home-calibrate').addEventListener('click', () =>
      this.bus.emit('navigate:setup', { forceCalibrate: true, next: 'home' }));
    this.el.querySelector('#home-angle-30').addEventListener('click', () =>
      this.bus.emit('navigate:angle-test', { angle: 30 }));
    this.el.querySelector('#home-settings').addEventListener('click', () =>
      this.bus.emit('navigate:settings'));
  }
}
