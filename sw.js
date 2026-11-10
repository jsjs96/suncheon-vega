/* VEGA 서비스 워커: 오프라인 캐시(최신 화면 우선). 푸시 알림 기능은 제거되었습니다.
   [개선] 파일을 고쳐 올릴 때마다 아래 CACHE 숫자를 하나 올려 주세요 (예: vega-v6) → 설치 앱도 바로 새 버전으로 바뀝니다.
   [개선] 인터넷이 느릴 때 4초 넘게 응답이 없으면 저장된 화면을 먼저 보여 주고, 새 파일은 뒤에서 받아 둡니다. */
const CACHE = 'vega-v6';
const PRECACHE = ['./', 'vega-theme.css', 'vega-tw.css', 'vega-config.js', 'vega-extras.js', 'vega-more.js', 'icon-192.png', 'logo-w.png', 'logo-mark-w.png'];
const SLOW_MS = 4000;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})));
});

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

  const network = fetch(r).then(res => {
    if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  });
  e.waitUntil(network.catch(() => {}));   /* 늦게 도착해도 캐시는 갱신 */

  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = (res) => { if (!done && res) { done = true; resolve(res); } };
    const fromCache = () => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('./') : null));
    /* 느리면 캐시 먼저 */
    const timer = setTimeout(() => fromCache().then(finish), SLOW_MS);
    network
      .then(res => { clearTimeout(timer); finish(res); })
      .catch(() => { clearTimeout(timer); fromCache().then(m => finish(m || Response.error())); });
  }));
});
