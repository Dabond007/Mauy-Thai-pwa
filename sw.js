/**
 * sw.js — offline support. Cache-first for this origin only; there are no
 * third-party requests to handle (§10). Bump CACHE_VERSION on every release.
 */

const CACHE_VERSION = 'v2-a6';
const CACHE_NAME = `nak-muay-${CACHE_VERSION}`;

const APP_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/settings.js',
  './js/storage.js',
  './js/camera.js',
  './js/stage.js',
  './js/pose/landmarks.js',
  './js/pose/geometry.js',
  './js/pose/filter.js',
  './js/pose/body-model.js',
  './js/pose/framing.js',
  './js/pose/calibration.js',
  './js/pose/pipeline.js',
  './js/pose/pose-engine.js',
  './js/audio/voice-queue.js',
  './js/audio/voice.js',
  './js/audio/tones.js',
  './js/render/renderer.js',
  './js/debug/overlay.js',
  './js/debug/log.js',
  './js/screens/home.js',
  './js/screens/setup.js',
  './js/screens/practice.js',
  './js/screens/angle-test.js',
  './js/coach/routine.js',
  './js/screens/settings.js',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg',
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/wasm/vision_wasm_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  './vendor/mediapipe/models/pose_landmarker_full.task',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(request) {
  // Ignore ?debug=1 etc. when matching the app shell.
  const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503 });
  }
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
