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
