/* Service Worker — 快取靜態資源，讓 PWA 可離線開啟 */
const CACHE = 'asset-tracker-v35';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/assets.js',
  './js/router.js',
  './js/futures.js',
  './js/config.js',
  './js/store.js',
  './js/api.js',
  './js/calc.js',
  './js/dropdown.js',
  './js/dom.js',
  './js/icons.js',
  './js/sync.js',
  './manifest.json',
  './vendor/chart.umd.min.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 只快取自家靜態資源；股價/匯率 API 一律走網路
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
