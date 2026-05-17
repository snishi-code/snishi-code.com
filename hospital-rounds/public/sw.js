const CACHE = 'hospital-rounds-v5';

// Docs HTML/CSS are bundled into the app itself (see src/docs-bundle.js) so
// they work offline without ever touching the SW cache. The SW only pre-caches
// the app shell plus the docs *images* (best-effort) so that figures inside the
// embedded guide also render offline once the SW has installed.
const SHELL = [
  '/hospital-rounds/',
  '/hospital-rounds/index.html',
  '/shared.css',
];

async function precacheAll() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map((u) => cache.add(u)));
  try {
    const res = await fetch('/docs/hospital-rounds/precache-list.json', { cache: 'no-cache' });
    if (res && res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        await Promise.allSettled(list.map((u) => cache.add(u)));
      }
    }
  } catch (_) { /* first install offline: shell only, images fill in on next online visit */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precacheAll());
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
