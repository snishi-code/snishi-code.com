const CACHE = 'hospital-rounds-v7';

// SW のスコープ（=sw.js が置かれているディレクトリ）。本番では '/hospital-rounds/'、
// テスト(サブドメイン)では '/' になる。相対URL は self.registration.scope を起点に解決。
const SCOPE = self.registration ? self.registration.scope : self.location.href.replace(/[^/]*$/, '');

// Docs HTML/CSS are bundled into the app itself (see src/docs-bundle.js) so
// they work offline without ever touching the SW cache. The SW only pre-caches
// the app shell plus the docs *images* (best-effort) so that figures inside the
// embedded guide also render offline once the SW has installed.
const SHELL = [
  new URL('./', SCOPE).href,
  new URL('./index.html', SCOPE).href,
];

async function precacheAll() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map((u) => cache.add(u)));
  // 説明書の precache list は snishi-code.com 本番の /docs/hospital-rounds/ 配下にのみ存在。
  // テスト環境では 404 となるが try/catch で無視される（説明書は src/docs-bundle.js に
  // インライン化されているため、画像が無くてもアプリ動作には支障なし）。
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
      }).catch(() => caches.match(new URL('./', SCOPE).href));
    })
  );
});
