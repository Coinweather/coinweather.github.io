// Service Worker: macht Coinweather installierbar und zeigt ohne Netz die zuletzt geladene Seite.
// Immer zuerst das Netz – so gibt es nie eine veraltete Fassung; der Zwischenspeicher dient nur als Rückfall.
// Fremde Adressen (Kurse, Anmeldung) gehen unverändert durch.
const CACHE = 'coinweather-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit ?? caches.match('/'))));
});

// Hinweis, wenn der Autopilot gehandelt hat. Chrome weckt die installierte App ab und zu (Periodic Background Sync);
// die Seite legt beim Einschalten Strategie, zuletzt gesehenen Handel und die Texte in ihrer Sprache unter STATE ab.
const STATE = 'coinweather-state', SEEN = '/__autopilot-seen';
self.addEventListener('periodicsync', (e) => { if (e.tag === 'autopilot') e.waitUntil(checkAutopilot()); });
async function checkAutopilot() {
  const cache = await caches.open(STATE);
  const hit = await cache.match(SEEN);
  if (!hit) return;
  const st = await hit.json();
  const res = await fetch(`/data/model-curve.json?t=${Date.now()}`);
  if (!res.ok) return;
  const c = await res.json();
  const latest = (c.profiles?.[st.profile] ?? c.profiles?.balanced ?? c).trades?.[0]?.t ?? 0;
  if (latest > (st.last ?? 0)) {
    await self.registration.showNotification(st.title, { body: st.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'autopilot', data: { url: '/#/portfolio' } });
    await cache.put(SEEN, new Response(JSON.stringify({ ...st, last: latest })));
  }
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const open = list.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) { open.navigate(e.notification.data?.url ?? '/'); return open.focus(); }
    return self.clients.openWindow(e.notification.data?.url ?? '/');
  }));
});
