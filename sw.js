// HiGroces Service Worker (sw.js)
// Provides offline capability & caches product assets on device memory (Zepto-style client caching)

const CACHE_NAME = 'higroces-cache-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/custom.html',
  '/rider.html',
  '/manifest.json'
];

// Install: pre-cache core pages
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching core app shell');
      return cache.addAll(CORE_ASSETS).catch(err => console.warn('[SW] Pre-cache warning:', err));
    })
  );
  self.skipWaiting();
});

// Activate: clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-first for /api/orders, Cache-first for images/assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API calls (never cache live orders)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'You are offline.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2. Static assets & images: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
