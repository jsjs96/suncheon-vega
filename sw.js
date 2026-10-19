/* VEGA 서비스 워커: 오프라인 캐시(최신 화면 우선) + FCM 푸시 알림 */
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyA2xq8tjDg8mmSI5FXVxSw6NeTohBETIU4",
  authDomain: "vega-volleyball.firebaseapp.com",
  projectId: "vega-volleyball",
  storageBucket: "vega-volleyball.firebasestorage.app",
  messagingSenderId: "1039273345368",
  appId: "1:1039273345368:web:1ecd2e74caae8334e4252d"
});
const messaging = firebase.messaging();
/* notification 형태의 메시지는 FCM이 자동 표시. 데이터 전용 메시지만 직접 표시 */
messaging.onBackgroundMessage((p) => {
  if (p.notification) return;
  const d = p.data || {};
  self.registration.showNotification(d.title || '순천 VEGA', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { link: d.link || './' } });
});
self.addEventListener('notificationclick', (e) => {
  if (e.notification.data && e.notification.data.FCM_MSG) return;   // FCM이 직접 처리
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => { for (const c of l) if ('focus' in c) return c.focus(); return clients.openWindow(link); }));
});

const CACHE = 'vega-v2';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'icon-192.png', 'logo.png']).catch(() => {}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; }).catch(() => caches.match(r).then(m => m || caches.match('./'))));
});
