/**
 * js/app.js — Entry point: event bus, boot sequence, screen router.
 */

import { Settings } from './settings.js';
import { PoseEngine } from './pose/pose-engine.js';
import { createVoice } from './audio/voice.js';
import { Tones } from './audio/tones.js';
import { Stage } from './stage.js';
import { DebugLog } from './debug/log.js';
import { HomeScreen } from './screens/home.js';
import { SetupScreen } from './screens/setup.js';
import { PracticeScreen } from './screens/practice.js';
import { SettingsScreen } from './screens/settings.js';

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
  camera:   document.getElementById('camera-screen'),
  settings: document.getElementById('settings-screen'),
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

    setProgress(15, 'Loading settings…');
    const settings = new Settings(bus);
    await settings.load();

    const voice = createVoice();
    const tones = new Tones();
    const applyAudio = v => {
      voice.rate = v.voiceRate;
      voice.volume = v.voiceVolume;
      tones.enabled = v.tones;
    };
    applyAudio(settings.values);
    bus.on('settings:changed', ({ values }) => applyAudio(values));

    // Speech and Web Audio both need a user gesture on Android.
    document.addEventListener('pointerdown', () => {
      voice.unlock();
      tones.unlock();
    }, { once: true });

    const log = new DebugLog();
    log.enabled = settings.get('recordLog');
    bus.on('settings:changed', ({ values }) => { log.enabled = values.recordLog; });

    setProgress(30, 'Loading pose detection model…');
    const poseEngine = new PoseEngine();
    try {
      await poseEngine.init(settings.get('model'));
    } catch (e) {
      if (settings.get('model') === 'full') throw e;
      console.warn('[Boot] model failed, falling back to full:', e);
      await poseEngine.init('full');
      await settings.set('model', 'full');
    }

    setProgress(85, 'Building UI…');
    const deps = { bus, settings, voice, tones, poseEngine, log };
    const stage = new Stage(deps);
    const home = new HomeScreen(deps);
    const setup = new SetupScreen({ ...deps, stage });
    const practice = new PracticeScreen({ ...deps, stage });
    const settingsScreen = new SettingsScreen(deps);

    let cameraController = null;
    const leaveCamera = ({ keepCamera = false } = {}) => {
      cameraController?.close({ keepCamera });
      cameraController = null;
    };

    bus.on('navigate:home', () => {
      leaveCamera();
      home.show();
      showScreen('home');
    });
    bus.on('navigate:settings', () => {
      leaveCamera();
      settingsScreen.show();
      showScreen('settings');
    });
    bus.on('navigate:setup', opts => {
      leaveCamera({ keepCamera: true });
      cameraController = setup;
      showScreen('camera');
      setup.open(opts);
    });
    bus.on('navigate:practice', () => {
      leaveCamera({ keepCamera: true });
      cameraController = practice;
      showScreen('camera');
      practice.open();
    });
    bus.on('stage:close', () => bus.emit('navigate:home'));

    // Leaving the app (switching apps, locking the phone) releases the camera.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && cameraController) bus.emit('navigate:home');
    });

    setProgress(100, 'Ready');
    await delay(200);
    home.show();
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
    const reg = await navigator.serviceWorker.register('./sw.js');
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
  const toast = document.getElementById('update-toast');
  const btn   = document.getElementById('update-btn');
  toast.classList.add('visible');
  btn.onclick = () => {
    worker.postMessage('SKIP_WAITING');
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  };
}

const delay = ms => new Promise(r => setTimeout(r, ms));

boot();
