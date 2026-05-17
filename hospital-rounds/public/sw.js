const CACHE = 'hospital-rounds-v4';

// App shell. Docs HTML/images are pulled from precache-list.json at install time
// so the full guide works offline (and the in-app "?" buttons keep working).
const SHELL = [
  '/hospital-rounds/',
  '/hospital-rounds/index.html',
  '/shared.css',
  '/docs/hospital-rounds/',
  '/docs/hospital-rounds/index.html',
  '/docs/hospital-rounds/precache-list.json',
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
  } catch (_) { /* offline first-install: shell-only, fill on visit */ }
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
