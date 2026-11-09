/* VEGA 서비스 워커: 오프라인 캐시(최신 화면 우선). 푸시 알림 기능은 제거되었습니다. */
const CACHE = 'vega-v4';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'vega-theme.css', 'icon-192.png', 'logo-w.png', 'logo-mark-w.png']).catch(() => {}))); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
      /* 이전 버전에서 켜 둔 푸시 구독 해제 */
      .then(() => (self.registration.pushManager ? self.registration.pushManager.getSubscription().then(s => s && s.unsubscribe()).catch(() => {}) : null))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; }).catch(() => caches.match(r).then(m => m || caches.match('./'))));
});
