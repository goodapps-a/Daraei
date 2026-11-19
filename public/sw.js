// Service Worker for Darayi PWA
const CACHE_NAME = 'darayi-shell-v16';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/coin-splash.js',
  '/coin-face.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('darayi-shell-')).map((k) => caches.delete(k))
      )).catch(() => {})
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Always bypass cache for cross-origin, API requests, and non-GET
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
    return;
  }

  // Network-First for page navigation so any refresh gets latest code immediately
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request)
          .then((m) => m || caches.match('/'))
          .then((m) => m || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }))
      )
    );
    return;
  }

  // Stale-while-revalidate for static assets (icons, flags, splash, fonts) — never cache HTML SPA fallback as an image/asset
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        const ct = (response && response.headers && response.headers.get('content-type')) || '';
        if (response && response.status === 200 && !ct.toLowerCase().includes('text/html')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('', { status: 503 }));
      return cached || fetchPromise;
    })
  );
});
