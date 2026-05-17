const CACHE = 'hospital-rounds-v3';

// App shell + docs index. Individual docs pages and images are cached on first fetch (network-fill).
const PRECACHE = [
  '/hospital-rounds/',
  '/hospital-rounds/index.html',
  '/docs/hospital-rounds/',
  '/docs/hospital-rounds/index.html',
  '/shared.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // allSettled so a missing pre-cache entry doesn't abort install
      Promise.allSettled(PRECACHE.map((url) => c.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first with network fallback that fills the cache; on total failure, return the SPA shell.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && res.ok && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/hospital-rounds/'));
    })
  );
});
