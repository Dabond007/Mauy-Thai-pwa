/**
 * js/app.js — Entry point
 * Initialises the event bus, service worker, and all modules.
 * Orchestrates the loading sequence and initial screen display.
 */

import { CameraManager }    from './camera.js';
import { PoseEngine }       from './pose-engine.js';
import { MoveClassifier }   from './move-classifier.js';
import { ComboEngine }      from './combo-engine.js';
import { AudioManager }     from './audio.js';
import { Renderer }         from './renderer.js';
import { HUD }              from './hud.js';
import { HomeScreen }       from './screens/home.js';
import { TrainingScreen }   from './screens/training.js';
import { ResultsScreen }    from './screens/results.js';

/* ── Event Bus ─────────────────────────────────────────────── */

class EventBus {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  }

  emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }
}

/* ── Loading UI helpers ─────────────────────────────────────── */

const loadingBar    = document.getElementById('loading-bar');
const loadingStatus = document.getElementById('loading-status');

function setProgress(pct, msg) {
  loadingBar.style.width = `${pct}%`;
  if (msg) loadingStatus.textContent = msg;
}

/* ── Screen router ──────────────────────────────────────────── */

const SCREENS = {
  loading:  document.getElementById('loading-screen'),
  home:     document.getElementById('home-screen'),
  training: document.getElementById('training-screen'),
  results:  document.getElementById('results-screen'),
};

let _currentScreen = 'loading';

function showScreen(name) {
  if (!SCREENS[name]) return;
  SCREENS[_currentScreen]?.classList.remove('active');
  SCREENS[name].classList.add('active');
  _currentScreen = name;
}

/* ── Boot sequence ──────────────────────────────────────────── */

async function boot() {
  const bus = new EventBus();
  window._bus = bus; // handy for debugging

  try {
    setProgress(5, 'Registering service worker…');
    await registerServiceWorker();

    setProgress(15, 'Loading move data…');
    // Data is loaded by individual modules; just warm up fetch cache here.
    await Promise.all([
      fetch('/data/moves.json'),
      fetch('/data/combos.json'),
    ]);

    setProgress(30, 'Initialising audio…');
    const audio = new AudioManager();
    await audio.init();

    setProgress(40, 'Setting up camera…');
    const camera = new CameraManager();

    setProgress(50, 'Loading pose detection model…');
    const poseEngine = new PoseEngine(bus);
    await poseEngine.init();   // downloads + compiles MediaPipe WASM

    setProgress(75, 'Preparing training engine…');
    const moveClassifier = new MoveClassifier(bus, 'orthodox');
    const comboEngine    = new ComboEngine(bus);
    await comboEngine.loadCombos();

    setProgress(85, 'Building UI…');
    const renderer = new Renderer(
      document.getElementById('pose-canvas'),
      document.getElementById('fx-canvas'),
    );
    const hud = new HUD(bus);

    // Screens
    const homeScreen     = new HomeScreen(bus);
    const trainingScreen = new TrainingScreen(
      bus, camera, poseEngine, moveClassifier, comboEngine, audio, renderer, hud,
    );
    const resultsScreen  = new ResultsScreen(bus);

    // Wire navigation events
    bus.on('navigate:home',     () => { homeScreen.show(); showScreen('home'); });
    bus.on('navigate:training', config => { trainingScreen.show(config); showScreen('training'); });
    bus.on('navigate:results',  data   => { resultsScreen.show(data);    showScreen('results'); });

    setProgress(100, 'Ready!');

    // Small pause so the user sees 100%
    await delay(300);

    homeScreen.show();
    showScreen('home');

  } catch (err) {
    console.error('[Boot] Fatal error:', err);
    loadingStatus.textContent = `Error: ${err.message}. Please refresh.`;
    loadingBar.style.background = '#e94560';
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateToast(newWorker);
        }
      });
    });
  } catch (e) {
    console.warn('[SW] Registration failed:', e);
  }
}

function showUpdateToast(worker) {
  const toast  = document.getElementById('update-toast');
  const btn    = document.getElementById('update-btn');
  toast.classList.add('visible');
  btn.onclick = () => {
    worker.postMessage('SKIP_WAITING');
    window.location.reload();
  };
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// Kick off
boot();
