// HiGroces Service Worker (sw.js)
// Provides offline capability & caches product assets on device memory (Zepto-style client caching)

const CACHE_NAME = 'higroces-cache-v3';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/custom.html',
  '/rider.html',
  '/admin.html',
  '/shop.html',
  '/track.html',
  '/manifest.json'
];

// Install: pre-cache core pages
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching core app shell v3');
      return cache.addAll(CORE_ASSETS).catch(err => console.warn('[SW] Pre-cache warning:', err));
    })
  );
  self.skipWaiting();
});

// Activate: purge all old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Deleting stale cache:', key);
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API calls (never cache live orders or settings)
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

  // 2. HTML navigation requests: Network-First! (Ensures latest features show immediately)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Static assets & images: Stale-While-Revalidate
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
