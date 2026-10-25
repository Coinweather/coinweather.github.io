// Anonyme Besuchszählung für die Betreiber-Übersicht (#/admin) – auch für Besucher ohne Konto.
// Ein Besuch ist ein geöffnetes Fenster mit der Seite. Seine zufällige Kennung lebt nur im Arbeitsspeicher: keine Cookies,
// keine eigene Kennung im Browser, keine IP-Adresse. Ein Besuch lässt sich deshalb nicht mit späteren Besuchen verbinden.
// Gespeichert werden der Besuch selbst (visits/{id}, nach 30 Tagen gelöscht – für „online“ und die Liste der letzten Besuche)
// und Tagessummen (stats/{JJJJ-MM-TT}, Schweizer Zeit). Die Zugriffsregeln stehen in firestore.rules.
//
// Wichtig: Dieses Modul muss in app.js als erstes geladen werden. Nur so sieht es, ob der Browser die Seite schon kannte,
// bevor die Seite selbst Einstellungen und Kurse speichert.
import * as auth from './auth.js';

const ZONE = 'Europe/Zurich';
const dayOf = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(t);
const hourOf = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(t);
// Feldnamen in Firestore: nur Buchstaben, Ziffern, _ und -
const key = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || '_';

const ua = navigator.userAgent;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|bingpreview/i;
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
let on = auth.available && !navigator.webdriver && !BOT.test(ua) && (!local || auth.emulatorMode);

// Kannte der Browser die Seite schon? Abgeleitet aus den Einstellungen und Kursen, die die Seite ohnehin speichert.
const returning = (() => { try { return Object.keys(localStorage).some((k) => /^(coinwetter|krypto-markt)-/.test(k)); } catch { return false; } })();

// Herkunft: Werbe- oder Teilen-Link (?von=…), sonst die verweisende Seite
const SOURCES = [[/android\.gm$|mail\./, 'mail'], [/google/, 'google'], [/bing\./, 'bing'], [/duckduckgo/, 'duckduckgo'], [/yahoo\./, 'yahoo'],
  [/ecosia/, 'ecosia'], [/search\.brave/, 'brave'], [/yandex/, 'yandex'], [/qwant/, 'qwant'], [/startpage/, 'startpage'], [/baidu/, 'baidu'],
  [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, 'x'], [/t\.me|telegram/, 'telegram'], [/whatsapp|wa\.me/, 'whatsapp'], [/reddit/, 'reddit'],
  [/facebook|^fb\.|messenger|\.katana/, 'facebook'], [/instagram/, 'instagram'], [/youtube|youtu\.be/, 'youtube'], [/linkedin|lnkd\.in/, 'linkedin'],
  [/tiktok/, 'tiktok'], [/pinterest/, 'pinterest'], [/discord/, 'discord'], [/github/, 'github'],
  [/chatgpt|openai|perplexity|claude\.ai|gemini\.google|copilot/, 'ki']];
const [src, ref] = (() => {
  let von = null;
  try { von = new URLSearchParams(location.search).get('von')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || null; } catch { /* ohne Zusatz */ }
  if (von) return von.startsWith('share-') ? ['teilen', von] : ['link', von];
  let r = null;
  try { r = document.referrer ? new URL(document.referrer) : null; } catch { /* unlesbar */ }
  if (!r) return ['direkt', null];
  const host = (r.hostname || r.host).replace(/^www\./, '');
  if (host === location.hostname) {
    // Von einer eigenen Seite außerhalb der App: den SEO-Seiten wie /best-crypto-to-buy-now/
    const path = r.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
    return path ? ['seo', path] : ['direkt', null];
  }
  const hit = SOURCES.find(([re]) => re.test(host));
  return [hit ? hit[1] : 'andere', host.slice(0, 60)];
})();

const tablet = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua));
const dev = tablet ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'handy' : 'computer';
const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iOS' : /Android/.test(ua) ? 'Android'
  : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'andere';
const br = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV/.test(ua) ? 'Facebook' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg(A|iOS)?\//.test(ua) ? 'Edge'
  : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'andere';
const pwa = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } })();
const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } })();
const loc = (navigator.language || '').slice(0, 10) || null;

const id = (() => { const a = new Uint8Array(12); crypto.getRandomValues(a); return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20); })();
const v = { start: Date.now(), pages: [], ev: {}, n: 0, dur: 0, acc: false, land: null };
v.day = dayOf(v.start);
let lang = null, cur = null;

// Hochzuzählende Tagessummen bis zum nächsten Speichern
let pending = {};
const add = (path, n = 1) => {
  let node = pending;
  for (const k of path.slice(0, -1)) node = node[k] ??= {};
  const last = path[path.length - 1];
  node[last] = (node[last] ?? 0) + n;
};
add(['v']); add(['one']);   // „one“: Besuche mit nur einer Seite – fällt mit der zweiten Seite wieder weg
add(['dev', dev]); add(['os', key(os)]); add(['br', key(br)]); add(['src', key(src)]); add(['hour', hourOf(v.start)]);
if (ref) add(['ref', `${key(src)}__${key(ref)}`.slice(0, 80)]);   // Quelle und Seite, getrennt durch „__“
if (tz) add(['tz', key(tz)]);
if (loc) add(['loc', key(loc)]);
if (returning) add(['ret']);
if (pwa) add(['pwa']);

let userKnown = false, hadUser = null, timer = null, failures = 0, visibleSince = document.visibilityState === 'visible' ? Date.now() : null;

// Sichtbare Zeit seit dem letzten Speichern (höchstens 3 Minuten am Stück – ein vergessenes Fenster zählt nicht ewig)
function takeTime() {
  if (visibleSince === null) return 0;
  const now = Date.now(), secs = Math.min(180, Math.round((now - visibleSince) / 1000));
  visibleSince = now;
  return secs;
}

async function flush() {
  clearTimeout(timer); timer = null;
  if (!on || !userKnown || !lang) return;
  if (Date.now() - v.start > 6 * 3_600_000) return;   // sehr lange offen: nicht mehr fortschreiben
  const secs = takeTime();
  if (secs) { v.dur += secs; add(['secs'], secs); }
  const counts = pending; pending = {};
  const doc = { day: v.day, start: v.start, last: Date.now(), dur: v.dur, n: v.n, pages: v.pages, land: v.land, ev: v.ev, acc: v.acc,
    dev, os, br, src, ref, tz, loc, lang, cur, ret: returning, pwa };
  try {
    await auth.saveVisit(id, doc, v.day, Object.keys(counts).length ? counts : null);
    failures = 0;
  } catch {
    // Zählung ist für die Seite nicht nötig: Summen für den nächsten Versuch behalten, nach drei Fehlschlägen aufhören
    for (const [k, n] of Object.entries(counts)) {
      if (typeof n === 'number') add([k], n); else for (const [k2, n2] of Object.entries(n)) add([k, k2], n2);
    }
    if (++failures >= 3) on = false;
  }
}
const soon = (ms = 5000) => { if (on && !timer) timer = setTimeout(flush, ms); };

// Sprache und Währung der Seite – erst danach wird gespeichert
export function start(prefs) {
  lang = prefs.lang; cur = prefs.currency;
  add(['lang', key(lang)]); add(['cur', key(cur)]);
  soon(4000);
}

// Aufgerufene Seite: name wie in der Adresse (markt, coin, rechner …), bei Coins die Coin-ID
export function page(name, coin) {
  if (!on || name === 'admin') return;
  const p = coin ? `coin/${coin}` : name;
  const last = v.pages[v.pages.length - 1];
  if (last?.p === p && Date.now() - v.start - last.t * 1000 < 30_000) return;   // Neuaufbau derselben Seite, z. B. nach dem Anmelden
  if (!v.land) { v.land = p; add(['land', key(coin ? 'coin' : name)]); }
  if (v.n === 1) add(['one'], -1);
  v.n++;
  v.pages.push({ p: p.slice(0, 80), t: Math.round((Date.now() - v.start) / 1000) });
  if (v.pages.length > 40) v.pages.splice(1, 1);   // die Einstiegsseite bleibt
  add(['pv']); add(['pages', key(name)]);
  if (coin) add(['coins', key(coin)]);
  soon();
}

// Eine Handlung, z. B. „rechnen“ oder „teilen“
export function event(name) {
  if (!on) return;
  v.ev[name] = (v.ev[name] ?? 0) + 1;
  add(['ev', key(name)]);
  soon();
}

// An- und Abmeldung: Betreiber werden nicht gezählt; wer sich während des Besuchs anmeldet oder ein Konto anlegt, zählt als Handlung
export function user(u, owner) {
  if (owner) { on = false; clearTimeout(timer); return; }
  if (u && !v.acc) { v.acc = true; add(['acc']); }
  if (userKnown && u && !hadUser) event(u.created && Date.now() - u.created < 15 * 60_000 ? 'registriert' : 'angemeldet');
  hadUser = !!u;
  if (!userKnown) { userKnown = true; soon(1500); }
}

// Klicks und Formulare, die für den Weg zum Konto zählen – ohne Eingaben, nur dass es passiert ist
const FORMS = { 'calc-form': 'rechnen', 'ch-form': 'challenge', 'cmp-form': 'vergleichen', 'ap-form': 'autopilot_zeigen',
  'a-form': 'konto_formular', 'p-start': 'autopilot_gestartet' };
document.addEventListener('submit', (e) => { const name = FORMS[e.target?.id]; if (name) event(name); }, true);
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a, button');
  if (!a) return;
  const href = a.getAttribute('href') ?? '';
  if (a.closest('.share-row') || a.dataset.share !== undefined) event('teilen');
  else if (a.id === 'install-app') event('installieren');
  else if (a.dataset.tvOk !== undefined) event('tradingview');
  else if (href.startsWith('#/konto') || a.dataset.next !== undefined) event('zum_konto');
  else if (href.startsWith('#/preise')) event('preise');
}, true);

// Solange sichtbar alle 90 Sekunden „noch da“ (für „online“), beim Verlassen sofort speichern
setInterval(() => { if (document.visibilityState === 'visible') flush(); }, 90_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') visibleSince = Date.now();
  else flush().then(() => { visibleSince = null; });
});
