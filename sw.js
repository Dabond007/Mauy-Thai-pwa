const CACHE_NAME = 'nak-muay-v1';

const APP_ASSETS = [
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/camera.js',
  '/js/pose-engine.js',
  '/js/move-classifier.js',
  '/js/combo-engine.js',
  '/js/audio.js',
  '/js/renderer.js',
  '/js/hud.js',
  '/js/screens/home.js',
  '/js/screens/training.js',
  '/js/screens/results.js',
  '/data/moves.json',
  '/data/combos.json',
  '/assets/icons/icon-192.svg',
  '/assets/icons/icon-512.svg'
];

// MediaPipe CDN resources to cache
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.wasm',
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache app assets (must succeed)
      const appCachePromise = cache.addAll(APP_ASSETS);
      // Cache CDN assets best-effort
      const cdnCachePromise = Promise.allSettled(
        CDN_ASSETS.map(url => cache.add(url).catch(() => null))
      );
      return Promise.all([appCachePromise, cdnCachePromise]);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache-first for app assets
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Stale-while-revalidate for CDN assets (MediaPipe)
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('storage.googleapis.com')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

// Notify clients of new service worker
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
