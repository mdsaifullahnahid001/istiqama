 /* ==========================================================
   Istiqama — sw.js (Service Worker)
   Strategy: Cache-First, falling back to Network.
   To ship an update: bump CACHE_NAME (e.g. v4) whenever any
   cached file changes, so clients fetch the new versions.
   ========================================================== */
'use strict';

const CACHE_NAME = 'istiqama-cache-v5';

// NOTE: index.html currently links icon-192.png from the site root.
// If your icons live in the root instead of /icons/, change the two paths below.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ---------- INSTALL: pre-cache core assets, activate immediately ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        // Cache each asset individually so one missing file (e.g. an icon)
        // does not abort the whole installation.
        Promise.all(
          ASSETS_TO_CACHE.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
              console.warn('[SW] Could not pre-cache:', url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE: remove old caches, take control of open tabs ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ---------- FETCH: Cache-First, fallback to Network ---------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests; let everything else go straight to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin requests. Cross-origin calls (Firebase SDK,
  // Firebase Auth API, Google Fonts, etc.) are left to the browser.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache only valid, same-origin (basic) responses.
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and not cached: serve the app shell for page navigations.
          if (request.mode === 'navigate') {
            return caches.match('./index.html').then((shell) => shell || caches.match('./'));
          }
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
        });
    })
  );
});