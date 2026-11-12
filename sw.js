/* 血壓記錄 Service Worker：離線可開、可安裝。改版時把 VERSION 數字加一。 */
const VERSION = 'v2';
const CACHE = 'bp-tracker-' + VERSION;
const ASSETS = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bp-tracker-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google Apps Script 等外部請求不經過快取

  if (req.mode === 'navigate') {
    // 網頁：優先取最新版，4 秒內沒回應或離線就用快取
    e.respondWith(
      Promise.race([
        fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }
  // 其他檔案：先用快取，同時背景更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
