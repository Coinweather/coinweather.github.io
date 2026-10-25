import { $, esc, settings, sleep, isNum, money, compact, num, signed, tone, pct, fromDisplay, toDisplay, currencyCode, localise } from './util.js';
import * as i18n from './i18n.js';
import { SITE } from './config.js';
import * as site from './site.js';
import * as api from './api.js';
import * as pf from './portfolio.js';
import * as auth from './auth.js';
import * as tr from './track.js';
import { plan, applyMove, adjusted, reserveAdvice, fngTilt, followModel, withdrawPlan, RESERVE_MODES, RESERVE_BACKTEST, HOLD_BACKTEST } from './manager.js';
import { quickAnalyse, detailAnalyse, marketIndex, prepare, backtest, expectedMove, analyseNews, TRADE_SETUPS, TRADE_LIMITS, TRADE_LEVERAGE, SHORT_TESTS, outlookOf, greedZone, WEIGHTS, RISK_ZONES, buyHistory as yearAfterBuy } from './model.js';

const REFRESH_MS = 120_000;      // so alt dürfen gespeicherte Kurse sein, bevor sofort neu geladen wird
const PAGE_INTERVAL_MS = 30_000;
const RETRY_MS = 30_000;
const FNG_REFRESH_MS = 30 * 60_000;
const BTC_REFRESH_MS = 10 * 60_000;
const NO_REGIME = { score: null, factors: [] };
const PAGE_SIZE = 25;   // Zeilen je Schritt; „Weitere anzeigen“ lädt jeweils so viele nach
// Zentral berechnete Daten (scripts/snapshot.mjs, alle 15 Minuten über GitHub Actions)
// Beim lokalen Entwickeln wird die Datei gelesen, die `node scripts/snapshot.mjs` nach out/ schreibt
const SNAPSHOT_URL = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'out/snapshot.json'
  : 'https://raw.githubusercontent.com/Coinweather/coinweather.github.io/data/snapshot.json';
const SNAPSHOT_MAX_AGE_MS = 2 * 3_600_000;    // ältere Daten gelten als ausgefallen – dann rechnet der Browser selbst
const SNAPSHOT_REFRESH_MS = 5 * 60_000;
const LIVE_PRICE_MS = 60_000;
const STALE_MS = 15 * 60_000;
const CACHE_KEY = 'krypto-markt-kurse-usd';
const CACHE_FIELDS = ['id', 'symbol', 'name', 'image', 'current_price', 'market_cap', 'market_cap_rank', 'total_volume',
  'high_24h', 'low_24h', 'ath', 'ath_change_percentage', 'circulating_supply', 'max_supply',
  'price_change_percentage_24h_in_currency', 'price_change_percentage_7d_in_currency', 'price_change_percentage_14d_in_currency',
  'price_change_percentage_30d_in_currency', 'price_change_percentage_200d_in_currency', 'price_change_percentage_1y_in_currency'];
// Token, die nur einen anderen Coin abbilden – für die Liste der stärksten Kaufsignale uninteressant
const DERIVATIVE = /wrapped|staked|staking|bridged|restaked|\busd|usd\b/i;

const state = {
  raw: new Map(), coins: [], byId: new Map(), bySymbol: new Map(), byName: new Map(),
  market: null, fng: null, btcData: null, btcInd: null, marketNews: null,
  daily: new Map(),     // Tageskurse je Coin-ID, sobald geladen
  news: new Map(),      // ausgewertete Nachrichten je Coin-ID
  server: false,        // true: Bewertungen kommen fertig vom Server und werden hier nicht neu gerechnet
  refining: false,
  refineDone: false,    // Hintergrund-Bewertung mindestens einmal abgeschlossen
  sort: { key: 'rank', dir: 1 }, page: 1, query: '', filter: 'all',
  showNone: false,      // Stablecoins und Token auf Aktien, Gold & Co. (ohne Signal) in der Liste zeigen
  gen: 0, nextPage: 1, pagesLoaded: 0, updated: null,
};

// Wörterbuch der gewählten Sprache laden; ab hier wird alles übersetzt, was auf der Seite erscheint
await i18n.ready;
i18n.start();
$('#foot-prefs').innerHTML = i18n.prefsControls();

const view = $('#view');
let current = null;

// ---------- Daten ----------

// Sortierte Liste und Suchtabellen neu aufbauen
function reindex(coins) {
  state.bySymbol.clear(); state.byName.clear();
  for (const c of coins) {
    // Bei doppelten Kürzeln gewinnt der Coin mit der größeren Marktkapitalisierung
    if (!state.bySymbol.has(c.symbol.toLowerCase())) state.bySymbol.set(c.symbol.toLowerCase(), c);
    if (!state.byName.has(c.name.toLowerCase())) state.byName.set(c.name.toLowerCase(), c);
  }
  state.coins = coins;
  state.byId = state.raw;
}

// Welche Börse die Kursgeschichte des Coins führt, weiß die zentrale Berechnung; ohne sie werden beide versucht
const histSource = (c) => (state.server && state.histKnown ? c.hist ?? null : undefined);

function rebuild() {
  if (state.server) {
    // Bewertungen stehen fest; nur die Tagesindikatoren für Diagramm und Rückblick-Test werden ergänzt
    const coins = [...state.raw.values()].sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
    for (const c of coins) {
      const daily = state.daily.get(c.id);
      c.ind = daily && isNum(c.current_price) ? prepare(daily.t, [...daily.p.slice(0, -1), c.current_price], daily.v) : null;
    }
    return reindex(coins);
  }
  // Coins, die seit mehreren Durchläufen nicht mehr geliefert wurden, sind aus den Top 1000 gefallen
  if (state.pagesLoaded >= api.PAGES) {
    for (const [id, c] of state.raw) if (c.fetched && Date.now() - c.fetched > STALE_MS) state.raw.delete(id);
  }
  const coins = [...state.raw.values()].sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
  // Marktphase immer mit dem aktuellen Bitcoin-Kurs rechnen, nicht mit dem Stand beim Laden der Tageskurse
  const btc = state.raw.get('bitcoin');
  if (state.btcData && isNum(btc?.current_price)) {
    const { t, p, v } = state.btcData;
    state.btcInd = prepare(t, [...p.slice(0, -1), btc.current_price], v);
  }
  state.market = marketIndex(coins, state.btcInd, state.fng, state.marketNews);
  if (state.market) state.market.time = new Date();
  const regime = state.market?.regime ?? NO_REGIME;
  for (const c of coins) {
    c.analysis = quickAnalyse(c, regime);
    // Sind Tageskurse geladen, gilt überall die verfeinerte Bewertung – in der Liste wie in der Detailansicht
    const daily = state.daily.get(c.id);
    c.ind = null;
    if (daily && isNum(c.current_price)) {
      c.ind = prepare(daily.t, [...daily.p.slice(0, -1), c.current_price], daily.v);
      c.analysis = detailAnalyse(c, c.ind, regime, state.news.get(c.id));
      // Die Daytrading-Muster sind an Binance-Kursen geprüft
      if (daily.source !== 'Binance') delete c.analysis.trade;
    }
  }
  reindex(coins);
}

function setStatus(error) {
  $('#dot').className = 'dot ' + (error ? 'fail' : state.updated ? 'live' : '');
  const total = api.PAGES * 250;
  const loaded = state.server ? ' · zentral berechnet' : state.coins.length < total && state.pagesLoaded < api.PAGES ? ` · ${state.coins.length} von ${total} Coins geladen` : ` · ${state.coins.length} Coins`;
  $('#updated').textContent = state.updated ? `Stand: ${state.updated.toLocaleTimeString(settings.locale)}${loaded}` : 'Lade Kurse …';
  $('#error').hidden = !error;
  if (error) $('#error').textContent = error + (state.coins.length ? ' Es werden die zuletzt geladenen Kurse angezeigt.' : '');
}

// Zwischenspeicher im Browser: Die Seite zeigt nach dem Neuladen sofort Kurse und schont das Anfrage-Limit
function saveCache() {
  const coins = state.coins.map((c) => {
    const out = {};
    for (const f of CACHE_FIELDS) out[f] = c[f];
    out.sparkline_in_7d = { price: (c.sparkline_in_7d?.price || []).map((p) => Number(p.toPrecision(5))) };
    return out;
  });
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ time: state.updated.getTime(), coins })); } catch {}
}

// Gibt das Alter der gespeicherten Kurse in Millisekunden zurück, ohne Treffer Infinity
function restoreCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!Array.isArray(cache?.coins)) return Infinity;
    for (const c of cache.coins) { c.fetched = Date.now(); state.raw.set(c.id, c); }
    state.pagesLoaded = Math.min(api.PAGES, Math.ceil(cache.coins.length / 250));
    state.updated = new Date(cache.time);
    rebuild();
    return Date.now() - cache.time;
  } catch { return Infinity; }
}

// Lädt die nächste Seite (250 Coins). Scheitert sie am Anfrage-Limit, versucht der nächste Aufruf dieselbe Seite erneut
async function loadPage(gen) {
  const page = state.nextPage;
  try {
    const list = await api.markets('usd', page);
    if (gen !== state.gen) return false;
    const now = Date.now();
    for (const c of list) { c.fetched = now; state.raw.set(c.id, c); }
    state.nextPage = page % api.PAGES + 1;
    state.pagesLoaded = Math.max(state.pagesLoaded, page);
    state.updated = new Date();
    rebuild();
    setStatus(null);
    current?.update();
    if (state.nextPage === 1) saveCache();
    if (state.pagesLoaded >= api.PAGES) refineAll();
    return true;
  } catch (err) {
    if (gen === state.gen) setStatus(err.message);
    return false;
  }
}

// Das kostenlose CoinGecko-Limit liegt bei etwa 5 Anfragen pro Minute. Beim ersten Laden kommen die
// vier Seiten direkt hintereinander, danach wird alle 30 Sekunden eine Seite aufgefrischt – so bleibt
// Luft für die Kursverläufe der Detailansicht.
async function marketLoop() {
  const gen = ++state.gen;
  const age = restoreCache();
  if (age < Infinity) {
    setStatus(null); current?.update();
    // Auch mit Kursen aus dem Zwischenspeicher die Bewertungen verfeinern – sonst kämen bei gestörtem Kursabruf nie Vorschläge
    if (state.pagesLoaded >= api.PAGES) refineAll();
  }
  if (age < REFRESH_MS) await sleep(PAGE_INTERVAL_MS);
  while (gen === state.gen) {
    const ok = await loadPage(gen);
    if (!ok) await sleep(RETRY_MS);
    else if (state.pagesLoaded >= api.PAGES) await sleep(PAGE_INTERVAL_MS);
    while (document.hidden) await sleep(3000);
  }
}

// Lädt im Hintergrund die Tageskurse aller Coins, die Binance führt, damit die Liste dieselbe
// verfeinerte Bewertung zeigt wie die Detailansicht. Reihenfolge: nach Marktkapitalisierung.
const refineChecked = new Set();

async function refineAll() {
  if (state.refining) return;
  // Jeden Coin nur einmal prüfen, sonst würde die Paarliste alle 30 Sekunden neu geladen
  const fresh = state.coins.filter((c) => !refineChecked.has(c.id) && !state.daily.has(c.id) && !c.analysis.stable);
  if (!fresh.length) { state.refineDone = true; return; }
  state.refining = true;
  try {
    const prices = await api.binancePrices();
    for (const c of fresh) refineChecked.add(c.id);
    const todo = fresh.filter((c) => {
      const p = prices.get(c.symbol.toUpperCase() + 'USDT');
      // Gleiches Kürzel, aber ein anderer Coin? Dann weicht der Kurs deutlich ab
      return p && Math.abs(p / c.current_price - 1) < 0.1;
    });
    let done = 0;
    const worker = async () => {
      for (let c = todo.shift(); c; c = todo.shift()) {
        try {
          const data = await api.history(c.symbol, histSource(c));
          if (data && !state.daily.has(c.id)) state.daily.set(c.id, data);
        } catch { /* einzelner Coin nicht ladbar – es bleibt bei der Schnellbewertung */ }
        if (++done % 20 === 0) { rebuild(); current?.update(); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    rebuild(); current?.update();
  } catch { /* Binance nicht erreichbar */ }
  state.refining = false;
  state.refineDone = true;
  current?.update();
}

// ---------- Zentral berechnete Daten ----------

// Lädt das Ergebnis der zentralen Berechnung. Gibt false zurück, wenn es fehlt oder zu alt ist.
// lite: zuerst die kleine Datei mit den 150 größten Coins (schneller erster Bildschirm), danach die vollständige
async function loadSnapshot(lite = false) {
  try {
    // Die Zeitangabe in der Adresse umgeht zu lange Zwischenspeicherung
    const url = lite ? SNAPSHOT_URL.replace('snapshot.json', 'lite.json') : SNAPSHOT_URL;
    const res = await fetch(`${url}?t=${Math.floor(Date.now() / SNAPSHOT_REFRESH_MS)}`);
    if (!res.ok) return false;
    const snap = localise(await res.json());   // Zahlen in den Texten in der gewählten Schreibweise
    i18n.setRates(snap.fx);                    // Wechselkurse für die gewählte Währung
    if (!Array.isArray(snap.coins) || snap.coins.length < 100 || Date.now() - snap.time > SNAPSHOT_MAX_AGE_MS) return false;
    if (state.server && state.updated && snap.time <= state.updated.getTime() && (lite || state.full)) return true;   // nichts Neues
    if (lite && state.full) return true;   // die vollständigen Daten sind schon da

    const live = new Map([...state.raw.values()].map((c) => [c.id, c.current_price]));
    state.server = true;
    state.histKnown = snap.coins.some((c) => c.hist);   // ältere Schnappschüsse kennen die Börse noch nicht
    state.gen++;                        // beendet eine laufende Berechnung im Browser
    state.raw = new Map();
    for (const c of snap.coins) {
      c.analysis.regime = snap.market.regime;
      c.snapshotPrice = c.current_price;
      if (state.liveSince && isNum(live.get(c.id))) c.current_price = live.get(c.id);   // Live-Kurs behalten
      state.raw.set(c.id, c);
    }
    state.market = { ...snap.market, time: new Date(snap.time) };
    state.record = snap.record ?? null;
    if (snap.fng && !state.fng?.history) {
      // Bis der vollständige Verlauf geladen ist, reichen heute, vor 7 und vor 30 Tagen
      const history = [];
      history[0] = { value: snap.fng.value }; history[7] = { value: snap.fng.week }; history[29] = { value: snap.fng.month };
      state.fng = { value: snap.fng.value, history, byDay: new Map() };
    }
    if (state.fng) state.fng.cmc = snap.fng?.cmc ?? null;   // Index von CoinMarketCap, falls ein Schlüssel hinterlegt ist
    state.pagesLoaded = api.PAGES;
    state.refineDone = true;
    state.updated = new Date(snap.time);
    state.full = !lite;
    rebuild();
    setStatus(null);
    current?.update();
    return true;
  } catch { return false; }
}

// Zwischen zwei Berechnungen die Kurse aktuell halten: ein Abruf bei Binance liefert alle Paare.
// Die Bewertungen bleiben dabei unverändert.
async function livePriceLoop() {
  while (state.server) {
    try {
      const prices = await api.binancePrices();
      for (const c of state.raw.values()) {
        const p = prices.get(c.symbol.toUpperCase() + 'USDT');
        // Gleiches Kürzel, aber ein anderer Coin? Dann weicht der Kurs deutlich ab
        if (p && Math.abs(p / c.snapshotPrice - 1) < 0.2) c.current_price = p;
      }
      state.liveSince = Date.now();
      rebuild();
      current?.update();
    } catch { /* Binance nicht erreichbar – es bleiben die Kurse der letzten Berechnung */ }
    await sleep(LIVE_PRICE_MS);
    while (document.hidden) await sleep(3000);
  }
}

async function start() {
  const quick = await loadSnapshot(true);
  if ((await loadSnapshot()) || quick) {
    livePriceLoop();
    for (;;) {
      await sleep(SNAPSHOT_REFRESH_MS);
      while (document.hidden) await sleep(3000);
      await loadSnapshot();
    }
  }
  // Keine zentralen Daten verfügbar: Der Browser lädt und rechnet selbst
  marketLoop();
  newsLoop();
}

async function fngLoop() {
  for (;;) {
    try {
      const data = await api.fearGreed();
      state.fng = { ...state.fng, value: data[0].value, history: data, values: data.map((d) => d.value),
        byDay: new Map(data.map((d) => [Math.floor(d.time / 86_400_000), d.value])) };
      if (state.coins.length) { rebuild(); current?.update(); }
    } catch { /* Seite funktioniert auch ohne Fear & Greed */ }
    await sleep(FNG_REFRESH_MS);
  }
}

// Bitcoin-Tageskurse für die Marktphase; ohne sie rechnet das Modell mit einer einfacheren Ersatzgröße.
// Der letzte Tageskurs wird in rebuild() laufend durch den Live-Kurs ersetzt.
async function bitcoinLoop() {
  for (;;) {
    try {
      const data = await api.history('BTC');
      if (data) {
        state.btcData = data;
        state.btcInd = prepare(data.t, data.p, data.v);
        if (state.coins.length) { rebuild(); current?.update(); }
      }
    } catch { /* Binance nicht erreichbar */ }
    await sleep(BTC_REFRESH_MS);
  }
}

async function newsLoop() {
  for (;;) {
    try {
      state.marketNews = analyseNews(await api.marketNews());
      if (state.coins.length) { rebuild(); current?.update(); }
    } catch { /* Seite funktioniert auch ohne Nachrichten */ }
    await sleep(FNG_REFRESH_MS);
  }
}

// ---------- Bausteine ----------

const badge = (a, extra = '') => `<span class="badge ${a.signal} ${extra}">${esc(a.label)}</span>`;

// Eine Skala für alles: Der Score eines Coins (intern −100 … +100) erscheint wie der Kauf-Score des Markts von 0 bis 100
const to100 = (score) => (score === null || score === undefined ? null : Math.round(50 + score / 2));
function scoreCell(score) {
  if (score === null || score === undefined) return '<span class="muted">–</span>';
  const v = to100(score);
  return `<div class="score"><span class="score-num ${tone(score)}">${v}</span>
    <span class="bar"><i class="${tone(score)}" style="left:0;width:${v}%"></i></span></div>`;
}

const riskTag = (risk) => (risk.label === '–' ? '<span class="muted">–</span>' : `<span class="risk r${risk.level}">${risk.label}</span>`);

function sparkline(prices, up) {
  if (!prices || prices.length < 2) return '';
  const w = 110, h = 32, min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const pts = prices.map((p, i) => `${(i / (prices.length - 1) * w).toFixed(1)},${(h - 2 - (p - min) / span * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--${up ? 'up' : 'down'})" stroke-width="1.5"/></svg>`;
}

// Die fünf Bausteine des Kauf-Scores (Startseite und Zyklus-Kompass): je länger der Balken, desto günstiger
function buyInputs(b) {
  return `<ul class="buy-inputs">${BUY_INPUTS.map(([k, name, sub, val]) => {
    const cheap = Math.round(100 - b.parts[k]), [cls, word] = cheapTag(cheap);
    return `<li><span class="bi-name"><strong>${name}</strong><small>${sub}</small></span><span class="bi-val">${b.raw ? val(b.raw) : ''}</span>
      <span class="bi-bar"><i class="${cls}" style="width:${Math.max(4, cheap)}%"></i></span><span class="bi-tag ${cls}">${word}</span></li>`;
  }).join('')}</ul>
  <p class="hint">Je länger der Balken, desto günstiger. Alle fünf zählen gleich; der Kauf-Score ist ihr Mittel.</p>`;
}

function gauge(value, colors) {
  const cx = 100, cy = 100, r = 80;
  const pt = (v, rad = r) => {
    const a = Math.PI * (1 - v / 100);
    return [(cx + rad * Math.cos(a)).toFixed(1), (cy - rad * Math.sin(a)).toFixed(1)];
  };
  const step = 100 / colors.length;
  const arcs = colors.map((col, i) => {
    const [x1, y1] = pt(i * step + 0.8), [x2, y2] = pt((i + 1) * step - 0.8);
    return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" stroke="${col}" stroke-width="13" fill="none"/>`;
  }).join('');
  const [nx, ny] = pt(value, r - 16);
  return `<svg class="gauge" viewBox="0 0 200 110" aria-hidden="true">${arcs}
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" class="needle"/><circle cx="${cx}" cy="${cy}" r="5" class="hub"/></svg>`;
}

const SELL_TO_BUY = ['var(--down)', 'var(--warn)', 'var(--hold)', 'var(--mild)', 'var(--up)'];

// Erste Schritte: Merker, welche Bereiche jemand schon gesehen hat (nur in diesem Browser)
const ONBOARD_KEY = 'coinwetter-erste-schritte-aus';
const seen = (what) => { try { return localStorage.getItem('coinwetter-gesehen-' + what) === '1'; } catch { return false; } };
const markSeen = (what) => { try { localStorage.setItem('coinwetter-gesehen-' + what, '1'); } catch { /* egal */ } };

// Teilen-Links (WhatsApp, Telegram, X, Link kopieren) – jeder geteilte Link kann neue Besucher bringen
function shareLinks(url, msg, label = 'Teilen') {
  const enc = encodeURIComponent;
  return `<span>${label}:</span>
    <a href="https://wa.me/?text=${enc(`${msg} ${url}`)}" target="_blank" rel="noopener">WhatsApp</a>
    <a href="https://t.me/share/url?url=${enc(url)}&text=${enc(msg)}" target="_blank" rel="noopener">Telegram</a>
    <a href="https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(msg)}" target="_blank" rel="noopener">X</a>
    <button type="button" class="link-btn" data-copy="${esc(url)}">Link kopieren</button>`;
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = i18n.say('Kopiert'); } catch { prompt('Link', btn.dataset.copy); }
});
// Favoriten: Stern an jedem Coin. Gespeichert im Konto (portfolios/{uid}.watch); ohne Konto führt der Stern zur Anmeldung.
const watched = (id) => !!depot.user && (depot.data.watch ?? []).includes(id);
const star = (id) => `<button type="button" class="star${watched(id) ? ' on' : ''}" data-watch="${esc(id)}" title="${watched(id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}" aria-label="${watched(id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}">${watched(id) ? '★' : '☆'}</button>`;
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-watch]');
  if (!btn) return;
  e.preventDefault();
  if (!depot.user) { location.hash = '#/konto'; return; }
  const set = new Set(depot.data.watch ?? []);
  if (set.has(btn.dataset.watch)) set.delete(btn.dataset.watch); else set.add(btn.dataset.watch);
  saveDepot({ ...depot.data, watch: [...set] }, { internal: true });
});
// Geteilte Links tragen bei angemeldeten Nutzern ein Kürzel ihres Kontos – so zeigt die Betreiber-Übersicht unter „Herkunft“, wer wen bringt
const refTag = (base = 'share') => (depot.user?.uid ? `${base}-${depot.user.uid.slice(0, 6).toLowerCase()}` : base);
const shareUrl = (hash = '') => `${location.origin}/?von=${refTag()}&lang=${i18n.prefs.lang}${hash}`;

// Das Krypto-Wetter: die Stimmung am Markt (Markt-Wetter) als Wetterlage – dieselben Stufen wie in den täglichen Beiträgen.
// Ob sich ein Kauf lohnt, sagt der Kauf-Score: Er ist antizyklisch – bei Regen ist Bitcoin meist günstiger.
const skyOf = (v) => (v < 30 ? 'storm' : v < 45 ? 'rain' : v < 55 ? 'cloud' : v < 70 ? 'partly' : 'sun');
const moodOf = (m) => m?.mood?.value ?? m?.value;
const SKY_TEXT = {
  storm: 'Der Markt fällt deutlich, die Stimmung ist schlecht.',
  rain: 'Der Markt ist schwach, viele Anleger sind vorsichtig.',
  cloud: 'Gemischte Lage ohne klare Richtung.',
  partly: 'Der Markt ist freundlich, die Mehrheit der Coins steigt.',
  sun: 'Starker Markt, die Stimmung ist gut.',
};
const SKY_TITLE = { storm: 'Stürmisch', rain: 'Regnerisch', cloud: 'Bewölkt', partly: 'Heiter bis wolkig', sun: 'Sonnig' };
function skyIcon(sky) {
  const sun = '<circle cx="0" cy="0" r="70" fill="#f5a524"/>';
  const cloud = (fill) => `<g fill="${fill}"><circle cx="-40" cy="20" r="50"/><circle cx="20" cy="0" r="65"/><circle cx="80" cy="25" r="45"/><rect x="-90" y="20" width="215" height="50" rx="25"/></g>`;
  const drops = '<g stroke="#5b8def" stroke-width="10" stroke-linecap="round"><line x1="-40" y1="95" x2="-50" y2="125"/><line x1="10" y1="95" x2="0" y2="125"/><line x1="60" y1="95" x2="50" y2="125"/></g>';
  const icon = { sun, partly: `<g transform="translate(-30,-30)">${sun}</g>${cloud('#e8ecf3')}`, cloud: cloud('#9aa4b2'),
    rain: `${cloud('#7c8796')}${drops}`, storm: `${cloud('#5c6675')}<path d="M10 80 L-15 130 L10 130 L-5 175 L45 115 L20 115 L35 80 Z" fill="#f5a524"/>` }[sky];
  return `<svg class="sky" viewBox="-110 -90 260 280" aria-hidden="true">${icon}</svg>`;
}

const NOW_ANSWER = {
  'Kaufen': 'Ja – der Zyklus ist günstig. Solche Stände waren für Käufe in Raten meist gute Gelegenheiten.',
  'Eher kaufen': 'Eher ja – der Zyklus ist eher günstig. Ein gutes Umfeld für Sparpläne und Käufe in Raten.',
  'Halten': 'Normal weiter – weder billig noch teuer. Ein Sparplan kann wie gewohnt laufen.',
  'Eher verkaufen': 'Eher nein – der Zyklus ist teuer. Nicht nachkaufen, Gewinne teilweise sichern.',
  'Verkaufen': 'Nein – der Zyklus ist überhitzt. Gewinne sichern statt kaufen.',
};
const BUY_TITLE = {
  'Kaufen': 'Der Zyklus ist günstig', 'Eher kaufen': 'Der Zyklus ist eher günstig', 'Halten': 'Weder billig noch teuer',
  'Eher verkaufen': 'Der Zyklus ist teuer', 'Verkaufen': 'Der Zyklus ist überhitzt',
};
// Die fünf Bausteine des Kauf-Scores – je länger der Balken, desto günstiger
const BUY_INPUTS = [
  ['mayer', 'Mayer-Multiple', 'Kurs zum 200-Tage-Schnitt', (r) => num(r.mayer, 2)],
  ['twoYear', '2-Jahres-Schnitt', 'Kurs zum Schnitt der letzten 2 Jahre', (r) => `${num(r.twoYear, 2)}×`],
  ['pi', 'Pi-Cycle', '111-Tage-Schnitt zum doppelten 350-Tage-Schnitt', (r) => `${num(r.pi * 100, 0)} %`],
  ['ath', 'Abstand zum Allzeithoch', 'je tiefer, desto günstiger', (r) => `${num(r.dd, 0)} %`],
  ['fng', 'Angst am Markt', 'Fear & Greed, Schnitt 30 Tage', (r) => num(r.fng30, 0)],
];
// Welche Bausteine den Kauf-Score gerade heben und welche ihn drücken – in einem Satz
function buyDrivers(b) {
  const list = BUY_INPUTS.map(([k, name]) => [name, 100 - b.parts[k]]);
  const pro = list.filter(([, v]) => v >= 62).map(([n]) => n), con = list.filter(([, v]) => v < 45).map(([n]) => n);
  const names = (list) => list.map((n) => `<span>${n}</span>`).join(', ');
  return [pro.length ? `<span class="up">Günstig:</span> ${names(pro)}.` : '', con.length ? `<span class="down">Teuer:</span> ${names(con)}.` : '',
    !pro.length && !con.length ? 'Alle Bausteine liegen im Mittelfeld.' : ''].filter(Boolean).join(' ');
}
const cheapTag = (v) => (v >= 62 ? ['up', 'günstig'] : v >= 45 ? ['hold', 'neutral'] : ['down', 'teuer']);

const fngLabel = (v) => (v <= 24 ? 'Extreme Angst' : v <= 46 ? 'Angst' : v <= 54 ? 'Neutral' : v <= 75 ? 'Gier' : 'Extreme Gier');

// Was der Fear-&-Greed-Index gerade im Modell bewirkt – Gier-Bremse, Angst-Käufe oder nichts
function fngEffect(regime) {
  const f = regime?.fng;
  if (!f || !isNum(f.avg7)) return '';
  const fearDays = Math.round((f.fearShare60 ?? 0) * 60);
  const tilt = fngTilt(regime);
  const [cls, title, text] = greedZone(regime)
    ? ['down', 'Gier-Bremse aktiv', `7-Tage-Schnitt ${num(f.avg7, 0)}: Der Trend der Altcoins wird gedeckelt. Nach solchen Phasen stand der mittlere Coin 30 Tage später nur in rund jedem vierten Fall höher.`]
    : tilt.fear > 0
      ? ['up', 'Angst-Käufe aktiv', `${fearDays} der letzten 60 Tage in der Angstzone, Bitcoin tief unter dem Allzeithoch: Der Reserve-Vorschlag sinkt, aufgestockt werden Bitcoin und Ethereum.`]
      : ['muted', 'Derzeit ohne Sonderwirkung', `7-Tage-Schnitt ${num(f.avg7, 0)}, ${fearDays} der letzten 60 Tage in der Angstzone. Gier-Bremse ab 75, Angst-Käufe ab 54 von 60 Tagen unter 45.`];
  return `<div class="fng-effect"><strong class="${cls}">${title}</strong><span class="muted">${text}</span></div>`;
}

const moodLabel = (v) => (v < 15 ? 'extreme Angst' : v < 25 ? 'Angst' : v < 45 ? 'gedrückt' : v <= 55 ? 'neutral' : v <= 75 ? 'zuversichtlich' : v <= 85 ? 'Gier' : 'extreme Gier');

// ---------- Erklärungen ----------
// Wie etwas berechnet wird, steht nicht über die Seite verteilt, sondern hinter einem kleinen Info-Knopf.

const infoBtn = (key, label = 'So wird gerechnet') =>
  `<button type="button" class="info-btn" data-info="${key}"><span aria-hidden="true">i</span>${label}</button>`;

const LIMITS = `<p class="muted">Alle Rückrechnungen enthalten nur Coins, die es heute noch gibt, und die Regeln wurden an denselben Jahren
  ausgewählt, an denen sie gemessen sind. Echte Ergebnisse fallen deshalb schlechter aus. Kurse lassen sich nicht sicher vorhersagen.</p>`;

const INFO = {
  model: { title: 'So entstehen die Prognosen', body: () => `
    <p>Jeder Coin bekommt einen Kauf-Score von 0 bis 100 – dieselbe Skala wie der Kauf-Score des Markts. Ab 58 heißt es „Eher kaufen“, ab 70 „Kaufen“, bis 43 „Eher verkaufen“, bis 36 „Verkaufen“. Er setzt sich aus vier Bausteinen und dem Zyklus-Kompass zusammen:</p>
    <ul><li><strong>Marktphase (45 %)</strong> – Stärke von Bitcoin (RSI, Veränderung über 30 Tage, Abstand zum 50- und 200-Tage-Schnitt) und Fear &amp; Greed, über 14 Tage geglättet.</li>
      <li><strong>Kurzfristig (20 %)</strong> – Erholung nach einem Ausverkauf; ein starker Tagesrückgang zählt nur, wenn der Markt mitfällt.</li>
      <li><strong>Mittelfristig (25 %)</strong> – Schwung über 2–4 Wochen und Handelsvolumen.</li>
      <li><strong>Langfristig (10 %)</strong> – ein früher Aufwärtstrend ist gut, Überdehnung schlecht.</li></ul>
    <p>In jedem Baustein zählt die Schwankung des Coins mit: Ruhigere Coins schnitten in der Prüfung in beiden Zeiträumen besser ab als der Markt.</p>
    <h3>Über allem steht der Zyklus-Kompass</h3>
    <ul><li><strong>Bitcoin und Ethereum:</strong> Ihr Score besteht zu 80 % aus dem Kauf-Score (100 − Zyklus-Risiko) und zu 20 % aus ihrem Trend. Ihr Signal gilt für 12 Monate und länger.</li>
      <li><strong>Altcoins:</strong> Ihr Score ist ihr Trend plus ein Zyklus-Bonus: je Kauf-Score-Punkt über 50 kommen 0,6 Punkte dazu (bei 69 also +12).
        Dazu nie gegen den Kompass: Bei günstigem Zyklus (ab 62) gibt es kein Verkaufssignal, bei teurem (unter 45) höchstens „Eher kaufen“.</li>
      <li><strong>Bärenmarkt und Gier-Bremse:</strong> Liegt Bitcoin unter seinem 200-Tage-Schnitt im Abwärtstrend oder Fear &amp; Greed im 7-Tage-Schnitt bei 75–85, wird der Trend der Altcoins gedeckelt – ein Kaufsignal entsteht dann nur noch über den Zyklus-Bonus.</li></ul>
    <p>Rückrechnung des Portfolio-Managers mit genau diesen Regeln und der Reserve nach Kompass und Trend (Mittel aus 7 Starttagen): 81 % pro Jahr seit 2018, seit 2022 43 %, größter Rückgang −46 %
      (früher nur nach dem Trend: 73 %, 43 %, −40 %). Ein Abzug bei teurem Zyklus hätte viel gekostet (60 % pro Jahr) – deshalb dort nur die Obergrenze.</p>
    <p>Bärenmarkt und Gier-Bremse steuern auch das Reserve-Ziel im Portfolio. Eigene Regeln je Altcoin (kein Kauf im eigenen Abwärtstrend, kein Kauf nach eigener Gier, Kauf nach eigener Angst)
      halfen in der Prüfung jeweils nur in einem von zwei Zeiträumen und sind deshalb nicht eingebaut.</p>
    <h3>Grundlage</h3>
    <p>Tageskurse von 84 Coins seit 2018 (rund ${num(174000, 0)} Coin-Tage), geprüft in zwei getrennten Zeiträumen. Bewertet wird mit den Tageskursen der letzten 4 Jahre von Binance, sonst von Gate.io;
      Coins, die an keiner der beiden Börsen gehandelt werden, bekommen eine einfachere Schnellbewertung. Token auf Aktien, Fonds, Edelmetalle und Währungen erhalten keine Prognose.</p>${LIMITS}` },

  index: { title: 'Jetzt kaufen? – der Kauf-Score', body: () => `
    <p>Der Kauf-Score reicht von 0 (überhitzt, teuer) bis 100 (tief im Zyklus, günstig). Er ist bewusst antizyklisch:
      Wenn der Markt gefallen ist und Angst herrscht, steigt er – wenn alle in Hochstimmung sind, sinkt er. Bei Regen kauft man billiger.</p>
    <ul><li><strong>Mayer-Multiple:</strong> Kurs zum 200-Tage-Schnitt. 0,7 zählt als ganz günstig, 2,4 als überhitzt.</li>
      <li><strong>2-Jahres-Schnitt:</strong> Kurs zum Schnitt der letzten 730 Tage. Am Schnitt ganz günstig, beim Fünffachen überhitzt.</li>
      <li><strong>Pi-Cycle:</strong> 111-Tage-Schnitt zum doppelten 350-Tage-Schnitt. 40 % ganz günstig, das Kreuzen bei 100 % überhitzt.</li>
      <li><strong>Abstand zum Allzeithoch:</strong> 80 % darunter ganz günstig, am Hoch teuer.</li>
      <li><strong>Angst am Markt:</strong> Fear &amp; Greed im Schnitt der letzten 30 Tage – Angst macht den Score höher.</li></ul>
    <p>Alle fünf zählen gleich. Der Kauf-Score ist 100 minus das Zyklus-Risiko aus dem Zyklus-Kompass – beide zeigen dasselbe, nur andersherum.</p>
    <h3>Stufen</h3>
    <ul><li><strong>ab 75:</strong> Kaufen</li><li><strong>62–74:</strong> Eher kaufen</li><li><strong>45–61:</strong> Halten</li>
      <li><strong>30–44:</strong> Eher verkaufen</li><li><strong>unter 30:</strong> Verkaufen</li></ul>
    <h3>Geprüft an Bitcoin-Tageskursen seit 2022</h3>
    <p>Ab 62 Punkten stand Bitcoin ein Jahr später in 71–76 % der Fälle höher (mittleres Ergebnis +50 bis +104 %), zwischen 45 und 61 nur in 48 %.
      In den Jahren 2018–2021 zeigte sich dieselbe Richtung. Auf 90 Tage gab es dagegen keinen Vorteil: Nach günstigen Ständen fiel der Kurs oft noch weiter.</p>
    <p>Der Kauf-Score sagt deshalb, ob sich Käufe in Raten über ein Jahr und länger lohnten – nicht, wann der Boden erreicht ist.
      Seit 2022 war der Zyklus nie überhitzt; die teure Seite ist darum weniger gut belegt als die günstige.</p>
    <h3>Wo der Kauf-Score überall gilt</h3>
    <ul><li><strong>Bitcoin und Ethereum:</strong> Ihr Signal besteht zu 80 % aus dem Kauf-Score.</li>
      <li><strong>Altcoins:</strong> Zyklus-Bonus im Score (je Punkt über 50 plus 0,6), kein Verkaufssignal bei günstigem, höchstens „Eher kaufen“ bei teurem Zyklus.</li>
      <li><strong>12-Monats-Sicht</strong> auf der Startseite und bei jedem Coin.</li>
      <li><strong>Portfolio-Manager und Modell-Portfolio:</strong> rechnen mit genau diesen Signalen.</li>
      <li><strong>Zyklus-Kompass:</strong> Das Zyklus-Risiko ist 100 minus Kauf-Score.</li></ul>
    <p>Geprüft an 84 Coins seit 2018, wöchentlich gehandelt, mit Gebühren: So kam der Portfolio-Manager auf 81 % pro Jahr. Hätten alle Coins zu 60 % direkt dem Kauf-Score
      gefolgt, wären es nur 38 % gewesen – nach günstigen Ständen fielen viele Altcoins zunächst weiter.</p>${LIMITS}` },

  weather: { title: 'Das Krypto-Wetter', body: () => `
    <p>Das Wetter beschreibt, wie es dem Markt gerade geht – nicht, ob sich ein Kauf lohnt. Grundlage ist das Markt-Wetter von 0 (Sturm) bis 100 (Sonne):</p>
    <ul><li><strong>70 % Marktphase:</strong> Stärke von Bitcoin, über 14 Tage geglättet – ein einzelner schwacher Tag verschiebt sie kaum.</li>
      <li><strong>20 % Marktbreite:</strong> Anteil der 200 größten Coins, die über 7 und 30 Tage im Plus liegen.</li>
      <li><strong>10 % Nachrichtenlage:</strong> grobe Stichwort-Auswertung englischer Schlagzeilen.</li></ul>
    <p>Unter 30 stürmisch, bis 44 regnerisch, bis 54 bewölkt, bis 69 heiter bis wolkig, ab 70 sonnig. Die Marktphase fließt mit 45 % in jeden Coin-Score ein.</p>
    <p><strong>Regen ist oft Kaufwetter:</strong> Ist das Wetter schlecht und der Kauf-Score hoch, ist Bitcoin günstig, während viele Angst haben.
      Genau solche Stände waren auf ein Jahr gesehen meist gute Einstiege.</p>` },

  cycle: { title: 'Die Sicht auf 12 Monate', body: () => `
    <p>Die Jahressicht folgt dem Kauf-Score – auf der Startseite wie bei jedem einzelnen Coin. Für jede Stufe steht da, was ein Jahr nach
      vergleichbaren Ständen folgte, gemessen an allen Tagen seit Januar 2022 (unter 45 seit 2018, weil es seit 2022 zu wenige solche Tage gab).</p>
    <ul><li><strong>Bitcoin:</strong> ab 62 Punkten in 69–76 % der Fälle höher, zwischen 45 und 61 nur in 48 %.</li>
      <li><strong>Ethereum:</strong> ab 62 Punkten in 77–82 % der Fälle höher, zwischen 45 und 61 nur in 42 %.</li>
      <li><strong>Altcoins:</strong> seit 2022 auch nach günstigen Ständen nur in 40–47 % der Fälle höher, sonst meist deutlich tiefer.
        2018–2021 war das anders – damals stiegen fast alle Coins.</li></ul>
    <p>Deshalb folgen Bitcoin und Ethereum vor allem dem Kauf-Score; bei Altcoins zählt er als Bonus zu ihrem Trend – und nie gegen den Kompass.</p>
    <p class="muted">Seit 2022 gab es nur einen Zyklus – eine Tendenz, keine Gewissheit.</p>` },

  fng: { title: 'Fear & Greed im Modell', body: () => `
    <p>Der Index misst die Stimmung am Kryptomarkt von 0 (extreme Angst) bis 100 (extreme Gier). Geprüft wurde, was seit 2018 auf Angst und Gier folgte:</p>
    <ul><li><strong>Gier-Bremse:</strong> Lag der 7-Tage-Schnitt bei 75–85, stand der mittlere Coin 30 Tage später nur in 20–33 % der Fälle höher (im Mittel rund −20 %). Dann wird der Trend der Altcoins gedeckelt. Bitcoin und Ethereum folgen dem Kauf-Score, in dem Fear & Greed schon steckt.</li>
      <li><strong>Angst-Käufe:</strong> Stand der Index an mindestens 54 der letzten 60 Tage unter 45 und liegt Bitcoin mindestens 40 % unter seinem Hoch, sinkt das Reserve-Ziel,
        und Bitcoin und Ethereum bekommen ein starkes antizyklisches Kaufsignal. Ein Jahr später stand Bitcoin in 86–100 % der Fälle höher, Ethereum in 64–100 %.</li>
      <li><strong>Nicht eingebaut:</strong> Altcoins in Angst kaufen (ein Jahr später meist tiefer) und bei Gier alles verkaufen (Ende 2020 stiegen die Kurse trotz extremer Gier monatelang weiter).
        Über 85 gibt es nur diese eine Phase – dafür lässt sich keine Regel belegen.</li></ul>
    <p>Gerechnet wird mit dem Index von alternative.me, weil er seit 2018 vorliegt. Der Index von CoinMarketCap existiert erst seit Mitte 2023; er wird angezeigt, wenn ein Schlüssel hinterlegt ist.</p>${LIMITS}` },

  percent: { title: 'Aussicht nach Zeitraum', body: () => `
    <p>Für 7 und 30 Tage steht da, in wie vielen von 100 vergleichbaren Fällen der Kurs danach höher stand. Verglichen wird mit allen 84 geprüften Coins seit 2018,
      wenn sie denselben Score hatten.</p>
    <ul><li><strong>Positiv:</strong> in mindestens 53 von 100 Fällen höher (sehr positiv ab 60).</li>
      <li><strong>Neutral:</strong> etwa jeder zweite Fall höher, jeder zweite tiefer.</li>
      <li><strong>Negativ:</strong> in höchstens 47 von 100 Fällen höher (sehr negativ ab 40).</li></ul>
    <p>Eine genaue Prozentzahl steht bewusst nicht da: Sie läge meist bei plus oder minus einem Prozent und wirkte genauer, als sie ist.
      Wie stark der Kurs in beide Richtungen ausschlagen kann, zeigt „Übliche Schwankungsbreite“.</p>
    <h3>Was ein Kaufsignal bedeutet</h3>
    <p>„Eher kaufen“ ist ein schwaches Signal: etwas mehr als jeder zweite Fall lief ins Plus, der Vorteil entsteht erst über viele Käufe, weil einzelne davon stark steigen.
      Ein deutliches Signal („Kaufen“) beginnt bei einem Kauf-Score von 70. Sicher ist kein einzelner Kauf.</p>
    <h3>12 Monate</h3>
    <p>Die Jahressicht folgt dem Kauf-Score – getrennt für Bitcoin, Ethereum und Altcoins, gemessen an allen Tagen seit 2022.
      Beim einzelnen Altcoin verschiebt sein langfristiger Trend das Ergebnis etwas. Das ist nur ein Zyklus und damit eine schmale Grundlage.</p>
    <p><strong>Das spricht dafür / dagegen:</strong> die Merkmale mit dem größten Beitrag zum Score, in Punkten.</p>${LIMITS}` },

  horizons: { title: 'So entsteht der Score', body: () => `
    <p>Der Trend-Teil des Kauf-Scores ist die gewichtete Summe aus vier Bausteinen. Jeder bewertet einen Ausschnitt des bisherigen Kursverlaufs; auf der Skala 0–100 steht 50 für neutral:</p>
    <ul><li><strong>Kurzfristig (20 %):</strong> die letzten Tage – vor allem Erholung nach einem Ausverkauf.</li>
      <li><strong>Mittelfristig (25 %):</strong> Schwung über 2–4 Wochen und Handelsvolumen.</li>
      <li><strong>Langfristig (10 %):</strong> Trend über 200 Tage bis ein Jahr.</li>
      <li><strong>Marktphase (45 %):</strong> Stärke von Bitcoin und Fear &amp; Greed – für alle Coins gleich.</li></ul>
    <p>Die Bausteine sind die Zutaten des Scores, keine eigenen Prognosen: Ein starker mittelfristiger Baustein heißt nicht, dass der Kurs in 30 Tagen stark steigt.
      Was auf den Score in der Vergangenheit folgte, steht unter „Aussicht nach Zeitraum“.</p>
    <p>Bei Bitcoin und Ethereum zählen diese Bausteine nur zu 20 % – zu 80 % zählt der Kauf-Score des Zyklus-Kompasses. Bei Altcoins kommt ein Zyklus-Bonus dazu
      (je Kauf-Score-Punkt über 50 plus 0,6 Punkte); Bärenmarkt-Filter, Gier-Bremse, Nachrichten und die Obergrenze bei teurem Zyklus können den Score begrenzen.
      Dann weicht er von der Summe der Bausteine ab.</p>
    <p>„Verfeinert“ heißt: Für diesen Coin liegen Tageskurse aus bis zu 4 Jahren vor. Sonst gilt die Schnellbewertung aus den Marktdaten der letzten 7 Tage bis 12 Monate.</p>` },

  mood: { title: 'Stimmung des Coins', body: () => `
    <p>Ein eigener Angst-und-Gier-Wert für den einzelnen Coin von 0 (Angst) bis 100 (Gier) – einen fertigen Index je Coin gibt es nicht frei verfügbar.
      Er entsteht aus dem Kursverlauf: RSI (30 %), Lage in der Spanne der letzten 30 Tage (30 %) und Veränderung über 30 Tage, gemessen an der üblichen Schwankung (40 %).</p>
    <p>In der Prüfung sagte der Wert für sich wenig voraus:</p>
    <ul><li>Unter 15: 7 Tage später stand der Kurs in 59 % der Fälle höher, nach 30 Tagen aber nur in 43 %.</li>
      <li>Mehr als 14 Tage über 75: 7 Tage später nur in 43 % der Fälle höher.</li></ul>
    <p>Er wird deshalb angezeigt, fließt aber nicht in den Score ein. Die kurze Erholung nach einem Ausverkauf steckt bereits im kurzfristigen Baustein.</p>` },

  swing: { title: 'Übliche Schwankungsbreite', body: () => `
    <p>Abgeleitet aus den Tagesschwankungen der letzten 90 Tage. In etwa zwei von drei Fällen bleibt der Kurs in dieser Spanne –
      Ausreißer nach oben und unten sind jederzeit möglich. Die Spanne sagt nichts über die Richtung.</p>` },

  backtest: { title: 'Rückblick-Test', body: () => `
    <p>Wie liefen die Signale bei genau diesem Coin? Der Score wurde für jeden Tag nur mit den damals bekannten Kursen berechnet. Gezählt wird, wie oft der Kurs
      7 und 30 Tage später höher stand – dieselbe Größe wie in der Aussicht oben. Nachrichten sind im Rückblick nicht enthalten.</p>
    <h3>Warum der Rückblick von der Aussicht abweichen kann</h3>
    <ul><li>Der Rückblick zeigt nur diesen einen Coin, die Aussicht stützt sich auf alle 84 geprüften Coins.</li>
      <li>Ist ein Coin in diesen Jahren stark gestiegen, sieht jedes seiner Kaufsignale im Rückblick gut aus – auch ein zufälliges.
        Der Vergleich mit „alle Tage“ zeigt, wie viel davon am Signal lag.</li>
      <li>Im Rückblick zählen alle Kaufsignale, auch die mit sehr hohem Score. Die Aussicht gilt für den Score von heute.</li></ul>
    <p><strong>Geprüft:</strong> Coins mit besonders gutem Rückblick liefen danach nicht besser als Coins mit schwachem – seit 2022 sogar etwas schlechter.
      Der Rückblick eines einzelnen Coins ist deshalb kein Grund, mehr zu erwarten, als die Aussicht angibt.</p>
    <p class="muted">Die Bewertungskurven wurden an denselben Jahren ausgerichtet. Die Trefferquoten im Rückblick fallen deshalb eher zu gut aus und sind keine Zusage für die Zukunft.</p>` },

  news: { title: 'Nachrichten', body: () => `
    <p>Englischsprachige Meldungen der letzten 7 Tage, automatisch nach Stichwörtern als positiv oder negativ eingestuft. Die Einstufung ist grob und kann danebenliegen –
      sie erkennt weder Ironie noch Zusammenhang.</p>
    <p>In den Score der einzelnen Coins fließen die Meldungen nicht ein; die allgemeine Nachrichtenlage zählt mit 10 % im Markt-Wetter.</p>` },

  sizing: { title: 'Einsatz und Hebel', body: () => `
    <p>Das Risiko ist der Betrag, den du verlierst, wenn der Stopp greift. Üblich sind 0,5 bis 2 % des Kontos je Handel. Daraus ergibt sich die Positionsgröße:
      Risiko geteilt durch den Abstand zum Stopp. Der Hebel ändert daran nichts – er bestimmt nur, wie viel Sicherheit du hinterlegst.</p>
    <p>Vorgeschlagen wird höchstens der Hebel, bei dem die Zwangsauflösung (rund 90 % geteilt durch den Hebel unter dem Einstieg) mindestens doppelt so weit entfernt liegt wie der Stopp, und nie mehr als 3-fach.</p>
    <h3>Was Hebel in der Rückrechnung bewirkt hätte</h3>
    <p class="muted">An jedem Signaltag 10 % des Kontos als Sicherheit, verteilt auf höchstens 5 Vorschläge.</p>
    ${Object.entries(TRADE_LEVERAGE).map(([k, rows]) => `<div class="label">${TRADE_SETUPS[k].label}</div><div class="table-wrap"><table class="fc-table">
      <thead><tr><th>Hebel</th><th class="num">pro Jahr</th><th class="num">größter Rückgang</th><th class="num">Zwangsauflösungen</th></tr></thead>
      <tbody>${rows.map(([l, y, dd, liq]) => `<tr><td>${l}×</td><td class="num ${tone(y)}">${signed(y, 0)} %</td><td class="num">−${dd} %</td><td class="num">${liq}</td></tr>`).join('')}</tbody></table></div>`).join('')}
    <p>Bis zum 3-fachen Hebel wuchsen Ertrag und Rückgang etwa im Gleichschritt – der Hebel macht einen Handel nicht besser, nur größer.
      Ab dem 5-fachen häuften sich die Zwangsauflösungen, beim 10-fachen blieb vom Vorteil nichts übrig.</p>${LIMITS}` },

  setups: { title: 'So entstehen die Handelsvorschläge', body: () => {
    const row = (s, when) => `<li><strong>${esc(s.label)}:</strong> ${when} Ziel ${s.target}-fache, Stopp ${s.stop}-fache Tagesschwankung des Coins, höchstens ${s.days} Tage.
      Rückblick über ${num(s.cases, 0)} Fälle an ${s.signalDays} Tagen: ${s.hit} % im Plus, im Mittel ${signed(s.avg, 1)} % je Handel (je Signaltag gemittelt ${signed(s.dayAvg, 1)} %);
      in den vier Zeitabschnitten ${s.blocks.map((b) => signed(b, 1) + ' %').join(', ')}. ${esc(s.caveat)}</li>`;
    return `<p>Ein Muster kommt nur auf die Seite, wenn es in allen vier Zwei-Jahres-Abschnitten seit 2018 nach Gebühren im Plus lag. Das schaffen zwei:</p>
      <ul>${row(TRADE_SETUPS.selloff, `Der Coin ist in 7 Tagen um mindestens ${-TRADE_LIMITS.selloff} % gefallen, der mittlere Coin am Markt um mindestens ${-TRADE_LIMITS.market} %, es herrscht kein Bärenmarkt und Fear &amp; Greed steht im 7-Tage-Schnitt bei mindestens ${TRADE_LIMITS.fng}.`)}
        ${row(TRADE_SETUPS.score, `Der Trend-Score (ohne Zyklus-Kompass, −100 bis +100) liegt bei mindestens +${TRADE_LIMITS.score}.`)}</ul>
      <p>Geprüft an Tageskursen mit Hoch und Tief von 84 Coins, mit 0,5 % Gebühren je Handel. Trifft eine Tageskerze Ziel und Stopp, zählt der Stopp.
        Vorschläge gibt es nur für Coins mit Tageskursen von Binance und genug Handelsvolumen. Sie gelten für Tage, nicht für Minuten:
        Für Handeln im Minutentakt gibt es hier keine geprüfte Grundlage.</p>${LIMITS}`; } },

  short: { title: 'Warum es keine Short-Vorschläge gibt', body: () => {
    const cell = (v) => (v === null ? '<td class="num muted">–</td>' : `<td class="num ${tone(v)}">${signed(v, 1)} %</td>`);
    return `<p>Ein Short-Muster kommt nur auf die Seite, wenn es in allen vier Zeitabschnitten seit 2018 nach Kosten im Plus lag. Geprüft wurden über 20 Varianten,
        darunter „bei extremer Gier shorten“. Keine hat das geschafft – die besten im Überblick (mittlerer Ertrag je Handel):</p>
      <div class="table-wrap"><table class="fc-table"><thead><tr><th>Muster</th><th class="num">2018–20</th><th class="num">2020–22</th><th class="num">2022–24</th><th class="num">2024–26</th></tr></thead>
        <tbody>${SHORT_TESTS.map(([label, v]) => `<tr><td>${esc(label)}</td>${v.map(cell).join('')}</tr>`).join('')}</tbody></table></div>
      <p>Am nächsten kam „extreme Gier nahe am Allzeithoch“: 2022–2026 im Plus, Ende 2020 aber mit Verlust, weil die Kurse trotz Gier monatelang weiterstiegen.
        Shorts haben zudem ein Risiko, das Käufe nicht haben: Ein Coin kann sich in Tagen verdoppeln, der Verlust ist nach oben offen.</p>
      <p>Was die Daten stützen, steckt stattdessen in der Gier-Bremse (bei extremer Gier wird der Trend der Altcoins gedeckelt) und im Zyklus-Kompass, der die Reserve senkt, wenn der Zyklus günstig ist.</p>`; } },

  autopilot: { title: 'So arbeitet der Autopilot', body: () => `
    <p>Der Autopilot hält dein Portfolio in denselben Anteilen wie das Modell-Portfolio deiner Strategie. Das Modell folgt genau den Regeln des Portfolio-Managers
      und ist dieselbe Kurve, die der Rechner unter „Mit dem Portfolio-Manager“ zeigt.</p>
    <ul><li><strong>Jede Woche geprüft:</strong> Am Prüftag entscheidet das Modell nach Kaufsignalen, Zyklus-Kompass und Schutzregeln, was es kauft und verkauft.
        Am Morgen danach stehen die Schritte hier.</li>
      <li><strong>Kursbewegungen allein lösen nichts aus:</strong> Steigt ein Coin, steigt er im Modell genauso. Gehandelt wird nur, wenn das Modell handelt oder Geld dazukommt.</li>
      <li><strong>Kleine Abweichungen bleiben liegen:</strong> Unter 1 % des Portfolios (mindestens 10 $) wird nicht gehandelt – das spart Gebühren.</li>
      <li><strong>Einzahlen und Sparrate:</strong> Neues Geld wird nach den Zielanteilen verteilt. Beim Auszahlen verkaufst du von allem denselben Teil.</li>
      <li><strong>Coins außerhalb des Modells</strong> schlägt der Autopilot zum Verkauf vor. Willst du sie behalten, wechsle zu „Selbst pflegen“.</li></ul>
    <p>Ausführen musst du die Schritte selbst bei deiner Börse – Coinweather hat keinen Zugriff auf dein Geld. Tipp danach auf „Erledigt“, dann stimmt der Bestand hier.
      Kauf- und Verkaufskurse weichen etwas ab; kleine Unterschiede gleicht der Autopilot beim nächsten Mal aus.</p>
    <p>Rückrechnung „Ausgewogen“: +${RESERVE_BACKTEST.balanced.perYear} % pro Jahr seit 2018, seit 2022 +${RESERVE_BACKTEST.balanced.recent} %, größter Rückgang −${RESERVE_BACKTEST.balanced.drawdown} %.
      „Vorsichtig“: +${RESERVE_BACKTEST.cautious.perYear} %, +${RESERVE_BACKTEST.cautious.recent} %, −${RESERVE_BACKTEST.cautious.drawdown} %.</p>${LIMITS}` },

  reserve: { title: 'Strategien und Reserve', body: () => `
    <p>Die Strategie legt fest, wie viel des Portfolios als Reserve (Bargeld oder Stablecoins) liegt. Die Reserve folgt dem Zyklus-Kompass und der Marktphase:</p>
    <ul><li><strong>Zyklus-Kompass:</strong> Ab einem Kauf-Score von 62 sinkt die Reserve um bis zu 20 Punkte (voll bei 85) – solange kein Bärenmarkt herrscht.</li>
      <li><strong>Marktphase:</strong> Je stärker der Trend, desto weniger Reserve.</li>
      <li><strong>Bärenmarkt:</strong> Liegt Bitcoin im Abwärtstrend unter seinem 200-Tage-Schnitt, bleibt der Großteil in Reserve.</li>
      <li><strong>Lange Angst tief im Zyklus:</strong> Weniger Reserve, investiert wird dann nur in Bitcoin und Ethereum.</li>
      <li><strong>Zu wenige Kaufsignale:</strong> Was sich nicht sinnvoll verteilen lässt, bleibt in Reserve.</li></ul>
    <div class="table-wrap"><table class="fc-table"><thead><tr><th>Strategie</th><th class="num">pro Jahr</th><th class="num">seit 2022</th><th class="num">größter Rückgang</th></tr></thead>
      <tbody>${Object.entries(RESERVE_MODES).map(([k, m]) => `<tr><td>${m.label}</td><td class="num up">+${RESERVE_BACKTEST[k].perYear} %</td><td class="num up">+${RESERVE_BACKTEST[k].recent} %</td><td class="num down">−${RESERVE_BACKTEST[k].drawdown} %</td></tr>`).join('')}
        <tr><td>Bitcoin halten</td><td class="num up">+${HOLD_BACKTEST.perYear} %</td><td class="num up">+${HOLD_BACKTEST.recent} %</td><td class="num down">−${HOLD_BACKTEST.drawdown} %</td></tr></tbody></table></div>
    <p>Rückrechnung März 2018 bis heute an 125 Coins, wöchentlich, 0,25 % Gebühr je Handel, Mittel aus 7 Starttagen.</p>
    <p>Geprüft und nicht mehr angeboten: „Antizyklisch“ (Reserve stärker nach dem Kauf-Score) brachte 78 % pro Jahr bei −51 % Rückgang, „Nur Bitcoin und Ethereum“
      36 % pro Jahr bei −38 % – beide schlechter als „Ausgewogen“. Eine Reserve nur nach dem Kauf-Score kam auf 59 % pro Jahr bei −60 %.</p>${LIMITS}` },

  manager: { title: 'So arbeitet der Portfolio-Manager', body: () => `
    <ul><li><strong>Feste Vorschläge:</strong> Sie werden einmal berechnet und bleiben stehen, bis du etwas am Portfolio änderst oder „Neu berechnen“ wählst.</li>
      <li><strong>Erst das Risiko:</strong> Die Strategie bestimmt, wie viel Reserve bleibt. Bei Bedarf legst du eine eigene Reserve fest.</li>
      <li><strong>Verkaufen, wenn Kurse fallen:</strong> Verkaufssignale werden verkauft. Fällt ein Coin 25 % unter sein Hoch seit dem Kauf, greift die Schutzregel – unabhängig vom Score.</li>
      <li><strong>Gewinner laufen lassen:</strong> Bei hohen Gewinnen wird ein Teil gesichert, wenn der Trend überdehnt ist.</li>
      <li><strong>Antizyklischer Kern:</strong> Liegt Bitcoin mehr als 40 % unter seinem Hoch, werden Bitcoin und Ethereum aufgestockt und nicht per Stop verkauft.</li>
      <li><strong>Kein Klumpen:</strong> höchstens 20 % je Coin (Bitcoin und Ethereum 40 %, riskante Coins weniger), höchstens 8 Positionen.</li>
      <li><strong>Tauschen:</strong> Passen ein Verkauf und ein Kauf zusammen, schlägt der Manager einen direkten Tausch vor – gerechnet mit zweimal 0,25 % Gebühr.</li>
      <li><strong>Wenig handeln:</strong> Abweichungen unter 4 % des Portfolios bleiben liegen, getauscht wird nur bei mindestens 30 Punkten besserem Score.</li>
      <li>Die Seite handelt nicht selbst. Du setzt die Schritte bei deiner Börse um und trägst sie hier als umgesetzt ein.</li></ul>
    <p>Etwa 45 % der Monate endeten in der Rückrechnung im Minus; Verluste lassen sich nicht ausschließen.</p>${LIMITS}` },

  compass: { title: 'Kauf-Score und Zyklus-Risiko', body: () => `
    <p>Ein eigener Index von Coinweather aus fünf Bausteinen. Der Kauf-Score geht von 0 (überhitzt) bis 100 (tief, günstig); das Zyklus-Risiko ist dieselbe Zahl andersherum, 100 minus Kauf-Score.</p>
    <p>Jeder Baustein wird zuerst als Risiko von 0 bis 100 gerechnet:</p>
    <ul><li><strong>Mayer-Multiple:</strong> 0,7 ergibt 0, 2,4 ergibt 100.</li>
      <li><strong>2-Jahres-Schnitt:</strong> am Schnitt 0, beim Fünffachen 100 (logarithmisch).</li>
      <li><strong>Pi-Cycle:</strong> 40 % ergibt 0, das Kreuzen (100 %) ergibt 100.</li>
      <li><strong>Nähe zum Allzeithoch:</strong> 80 % darunter ergibt 0, am Hoch 100.</li>
      <li><strong>Fear &amp; Greed:</strong> Schnitt der letzten 30 Tage.</li></ul>
    <p>Stufen des Kauf-Scores: ab 75 Kaufen, 62–74 Eher kaufen, 45–61 Halten, 30–44 Eher verkaufen, unter 30 Verkaufen.</p>
    <p>Geprüft an Bitcoin-Tageskursen seit 2022: Ab einem Kauf-Score von 62 stand Bitcoin ein Jahr später in 69–76 % der Fälle höher, zwischen 45 und 61 nur in 48 %.
      Unter 30 lag der Kauf-Score seit 2022 nie. Die Schwellen der Bausteine sind bekannte Marken aus der Literatur, nicht an diesen Daten optimiert.
      Trotzdem: Seit 2022 gab es nur einen Zyklus – eine Tendenz, keine Gewissheit.</p>` },

  record: { title: 'Erfolgskontrolle', body: () => `
    <p>Einmal am Tag hält die zentrale Berechnung die bis zu 25 stärksten Kaufsignale mit ihrem Kurs fest – Coins mit genug Handelsvolumen.
      7 und 30 Tage später wird nachgesehen, wo der Kurs steht.</p>
    <p>Anders als die Rückrechnung arbeitet diese Messung mit Kursen, die beim Signal noch niemand kannte. Sie ist damit der ehrlichste Maßstab dafür, ob die Signale etwas taugen.</p>
    <ul><li><strong>Im Mittel:</strong> durchschnittliche Kursveränderung aller festgehaltenen Signale nach der Frist, ohne Gebühren.</li>
      <li><strong>Im Plus:</strong> Anteil der Signale, deren Kurs höher steht.</li>
      <li><strong>Bitcoin:</strong> Veränderung von Bitcoin über dieselben Zeiträume, zum Vergleich.</li>
      <li><strong>Top 100 im Schnitt:</strong> durchschnittliche Veränderung der 100 größten Coins (ohne Stablecoins) über dieselben Zeiträume – so ist zu sehen, ob die Signale besser oder schlechter liefen als der Markt (erfasst ab 24.10.2026).</li></ul>
    <p><strong>Änderung am 24.10.2026:</strong> In der ersten Woche lagen die Signale bei kleineren Coins (ab Rang 200) im Mittel bei ${signed(-6.5, 1)} %, in den Top 10 bei ${signed(0.2, 1)} %. Das Modell ist nur an großen Coins geprüft. Seitdem gibt es Kaufsignale nur noch für die 100 größten Coins mit mehrjährigen Tageskursen. Die früheren Ergebnisse bleiben unverändert in der Messung.</p>
    <p class="muted">Die Messung wird mit jedem Tag aussagekräftiger. Wenige Wochen sagen wenig – in einer fallenden Marktphase liegen auch gute Signale im Minus.</p>` },

  performance: { title: 'Wertentwicklung', body: () => `
    <p>Die Seite hält jeden geänderten Bestand mit seinem Zeitpunkt fest. Aus den Beständen und den Tageskursen rechnet sie den Wert für jeden Tag nach –
      auch für Tage, an denen du die Seite nicht geöffnet hattest.</p>
    <ul><li><strong>Wert:</strong> alle Coins zum Tageskurs plus Bargeld.</li>
      <li><strong>Eingezahlt:</strong> Geld, das von außen kam – neue Positionen und Bargeld, abzüglich Entnahmen. Käufe, Verkäufe und Tausche innerhalb des Portfolios zählen nicht dazu.</li>
      <li><strong>Wertentwicklung in Prozent:</strong> zeitgewichtet, also ohne den Einfluss von Ein- und Auszahlungen.</li>
      <li><strong>Vergleich mit Bitcoin:</strong> Jede Einzahlung wäre am selben Tag in Bitcoin geflossen.</li></ul>
    <p>Links der Markierung „Beginn der Erfassung“ ist zurückgerechnet, wie sich dein damaliger Bestand entwickelt hätte. Für Coins ohne Kursgeschichte wird der heutige Kurs angenommen.</p>` },
};

const infoDialog = document.createElement('dialog');
infoDialog.className = 'dialog wide';
document.body.append(infoDialog);
infoDialog.addEventListener('click', (e) => { if (e.target === infoDialog || e.target.closest('[data-close]')) infoDialog.close(); });
document.addEventListener('click', (e) => {
  const key = e.target.closest?.('[data-info]')?.dataset.info;
  if (!key || !INFO[key]) return;
  e.preventDefault();
  infoDialog.innerHTML = `<div><div class="dialog-top"><h2>${INFO[key].title}</h2><button class="icon" type="button" data-close aria-label="Schließen">✕</button></div>
    <div class="info-body">${INFO[key].body()}</div></div>`;
  infoDialog.showModal();
  infoDialog.scrollTop = 0;
});

// Dialog, der eine Entscheidung verlangt – er lässt sich nicht nebenbei schließen. Ergebnis: true bei Zustimmung.
function decide(html, yes, no) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog wide';
    dlg.innerHTML = `<div><div class="info-body">${html}</div>
      <div class="btn-row dialog-actions"><button class="btn" type="button" data-yes>${yes}</button><button class="btn ghost" type="button" data-no>${no}</button></div></div>`;
    document.body.append(dlg);
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    dlg.addEventListener('click', (e) => {
      const button = e.target.closest('[data-yes], [data-no]');
      if (!button) return;
      dlg.close(); dlg.remove();
      resolve(button.hasAttribute('data-yes'));
    });
    dlg.showModal();
    dlg.scrollTop = 0;
  });
}

function factorList(factors) {
  if (!factors.length) return '<p class="muted">Keine Daten für diesen Zeitraum.</p>';
  return `<ul class="factors">${factors.map((f) => `<li>
    <span class="pts ${tone(Math.abs(f.score) < 0.05 ? 0 : f.score)}">${signed(f.score * 100, 0)}</span>
    <span><strong>${esc(f.name)}</strong><br><span class="muted">${esc(f.text)}</span></span></li>`).join('')}</ul>`;
}

// ---------- Marktübersicht ----------

const SORTS = {
  rank: (c) => c.market_cap_rank, name: (c) => c.name.toLowerCase(), price: (c) => c.current_price,
  h24: (c) => c.price_change_percentage_24h_in_currency, d7: (c) => c.price_change_percentage_7d_in_currency,
  d30: (c) => c.price_change_percentage_30d_in_currency, mcap: (c) => c.market_cap, score: (c) => c.analysis.score,
};

// Ohne Konto oder Abo: kostenlose Vorschau. Die Großwetterlage ist frei sichtbar, die Signale der einzelnen Coins
// sind verdeckt – außer bei Bitcoin und Ethereum als Beispiel. So sieht jeder Besucher sofort, was die Seite kann.
const SAMPLES = ['bitcoin', 'ethereum'];
const previewCta = (title, text) => {
  const guest = !depot.user;
  return `<section class="panel preview-cta">
    <div><div class="label">${guest ? 'Kostenlose Vorschau' : 'Vorschau'}</div><h2>${title}</h2>
      <p class="muted">${guest ? text : 'Deine Testphase ist vorbei. Mit einem Paket siehst du wieder alle Signale.'}</p></div>
    <div class="btn-row">${guest ? '<a class="btn" href="#/konto">Kostenlos starten</a> <a class="btn ghost" href="#/preise">Mehr erfahren</a>'
      : '<a class="btn" href="#/preise">Pakete ansehen</a>'}</div>
  </section>`;
};

// Zyklus-Kompass auf jeder Coin-Seite: Kauf-Score, seine Bausteine und was er heute für genau diesen Coin bedeutet
function coinCompass(c) {
  const m = state.market, b = m?.buy;
  if (!b || !c || c.analysis?.signal === 'none') return '';
  const core = c.id === 'bitcoin' || c.id === 'ethereum';
  const h = yearAfterBuy(m.value)?.[c.id === 'bitcoin' ? 'btc' : c.id === 'ethereum' ? 'eth' : 'alt'];
  const name = `<span translate="no">${esc(c.name)}</span>`;
  const rule = core ? `Der Kauf-Score zählt im Score von ${name} zu 80 %, der eigene Trend zu 20 %. Das Signal gilt für 12 Monate und länger.`
    : m.value > 50 ? `Der Zyklus ist ${m.value >= 75 ? 'günstig' : 'eher günstig'} – ${name} bekommt dafür +${Math.round((c.analysis?.cycle ?? 0) / 2)} Punkte im Kauf-Score${m.value >= 62 ? ' und kein Verkaufssignal' : ''}. Dazu zählt sein eigener Trend.`
      : m.value < 45 ? `Der Zyklus ist teuer – deshalb höchstens „Eher kaufen“ für ${name}, und nur für die nächsten Wochen.`
        : `Der Zyklus ist weder billig noch teuer – über das Signal von ${name} entscheidet heute sein Trend.`;
  const who = c.id === 'bitcoin' ? 'Bitcoin' : c.id === 'ethereum' ? 'Ethereum' : 'Altcoins';
  return `<section class="panel coin-compass">
    <div class="head-row"><div class="label">Zyklus-Kompass · Kauf-Score</div><a class="link-more" href="#/indikatoren">Zyklus-Kompass →</a></div>
    <div class="cc-top"><div class="cc-score"><strong>${m.value}</strong><small> / 100</small>${badge(m)}</div>
      <div><h3>${BUY_TITLE[m.label]}</h3><p>${rule}</p></div></div>
    ${h ? `<div class="buy-history"><div class="label">Ein Jahr nach Ständen wie heute · seit 2022</div>
      <div class="bh-grid"><div><strong class="${h.up >= 55 ? 'up' : h.up <= 45 ? 'down' : ''}">${h.up} %</strong><span>${who} ein Jahr später höher</span></div>
        <div><strong class="${tone(h.median)}">${signed(h.median, 0)} %</strong><span>mittleres Ergebnis nach einem Jahr</span></div></div></div>` : ''}
    <details class="fold"><summary>Das steckt im Kauf-Score</summary>
      <ul class="buy-inputs">${BUY_INPUTS.map(([k, label, sub, val]) => {
        const cheap = Math.round(100 - b.parts[k]), [cls, word] = cheapTag(cheap);
        return `<li><span class="bi-name"><strong>${label}</strong><small>${sub}</small></span><span class="bi-val">${val(b.raw)}</span>
          <span class="bi-bar"><i class="${cls}" style="width:${Math.max(4, cheap)}%"></i></span><span class="bi-tag ${cls}">${word}</span></li>`;
      }).join('')}</ul></details>
  </section>`;
}

// Coin und Autopilot: Rang nach Kauf-Score unter den großen Coins und ob das Modell-Portfolio ihn hält (Bestand nur mit Paket)
async function coinAutopilot(c, el) {
  if (!el || !c || c.analysis?.signal === 'none' || c.analysis?.stable) { if (el) el.innerHTML = ''; return; }
  const pool = state.coins.filter((x) => (x.market_cap_rank ?? 9999) <= 300 && x.total_volume >= 5e6 && x.analysis?.signal && x.analysis.signal !== 'none'
    && !x.analysis.stable && !DERIVATIVE.test(x.name) && isNum(x.analysis.score)).sort((a, b) => adjusted(b.analysis) - adjusted(a.analysis));
  const rank = pool.findIndex((x) => x.id === c.id) + 1;
  const curve = await loadModelCurve();
  if (!el.isConnected) return;
  const t = modelProfile(curve);
  const full = fullAccess();
  const h = t?.holdings?.find((x) => modelCoin(x.symbol)?.id === c.id);
  // Ganze Sätze ohne Auszeichnung darin – so übersetzt die Seite sie in einem Stück
  const name = esc(c.name);
  const status = !t ? '' : !full ? `Ob der Autopilot ${name} gerade hält, siehst du mit einem kostenlosen Konto.`
    : h ? `Der Autopilot hält gerade ${num(h.share, 1)} % in ${name} (Strategie Ausgewogen, Stand ${dateText(new Date(t.asOf))}).`
      : `Der Autopilot hält ${name} gerade nicht. Er kauft nur die stärksten Kauf-Scores unter den Top 200 und höchstens 8 Coins.`;
  el.innerHTML = `<section class="panel coin-ap"><span class="ap-icon" aria-hidden="true">🤖</span><div>
      <div class="label">Autopilot</div>
      ${rank ? `<p><strong>Rang ${rank}</strong> von ${pool.length} nach Kauf-Score (große Coins mit genug Handelsvolumen, riskantere abgewertet).</p>` : ''}
      ${status ? `<p>${status}</p>` : ''}</div>
      <a class="btn ghost small" href="${full ? '#/portfolio' : depot.user ? '#/preise' : '#/konto'}" ${full ? '' : 'data-next="#/portfolio"'}>${full ? 'Zum Autopiloten' : 'Autopilot ansehen'}</a></section>`;
}

// Detailansicht eines Coins ohne Konto: Hinweis auf das kostenlose Konto, darunter das Angebot
function lockedCoinView(id) {
  view.innerHTML = '<div id="locked-head"></div><div id="locked-compass"></div><div id="locked-sales"></div>';
  const sales = site.pricingView($('#locked-sales'), { access, user: () => depot.user, record: () => state.record });
  const head = () => {
    const c = state.coins.find((x) => x.id === id);
    const name = c ? `<span translate="no">${esc(c.name)}</span>` : 'diesen Coin';
    $('#locked-head').innerHTML = previewCta(`Signal und Aussicht für ${name}`,
      'Mit einem kostenlosen Konto siehst du für jeden der 1000 Coins das Signal, die Aussicht für 7 und 30 Tage und den Rückblick. 30 Tage alle Funktionen, ohne Zahlungsdaten.');
    const ck = `${state.market?.value}|${c?.id}`;
    if ($('#locked-compass').dataset.key !== ck) { $('#locked-compass').dataset.key = ck; $('#locked-compass').innerHTML = coinCompass(c); }
  };
  return { update() { head(); sales.update(); } };
}

function marketView(preview = false) {
  const th = (key, label, cls = '') => (preview && key === 'score' ? `<th class="${cls}">${label}</th>` : `<th class="${cls} sortable" data-sort="${key}">${label}</th>`);
  if (preview && state.sort.key === 'score') state.sort = { key: 'rank', dir: 1 };
  if (preview) state.filter = 'all';
  view.innerHTML = `
    <section class="panel weather" id="weather"></section>
    <section class="panel onboard" id="onboard" hidden></section>
    <section class="panel ap-teaser" id="ap-teaser" hidden></section>
    <section class="buy-hero">
      <div class="panel buy-card" id="g-market"></div>
      <div class="panel buy-parts" id="buy-parts"></div>
    </section>
    <section class="panel todo-box" id="todo"></section>
    <nav class="jump" aria-label="Auf dieser Seite"><span class="label">Auf dieser Seite</span>
      <a href="#" data-jump="#picks-sec">Kaufsignale</a><a href="#" data-jump="#cycle">12 Monate</a><a href="#" data-jump=".heat-wrap">Heatmap</a><a href="#" data-jump=".controls">Alle Coins</a></nav>
    ${preview ? previewCta('Die Großwetterlage siehst du hier frei. Welche Coins gerade ein Kaufsignal haben, zeigt dein kostenloses Konto.',
      '30 Tage alle Funktionen, ohne Zahlungsdaten. Anmelden mit Google dauert 10 Sekunden.') : ''}
    <section class="hero hero-two">
      <div class="panel gauge-panel" id="g-fng"></div>
      <div class="panel" id="market-parts"></div>
      <section class="panel" id="cycle"></section>
    </section>
    <div class="teaser-row">
      <a class="panel compass-teaser" href="#/indikatoren" id="compass-teaser" hidden></a>
      <a class="panel calc-teaser" href="#/rechner"><span class="calc-icon" aria-hidden="true">🧮</span><span><strong>Sparplan- und Portfolio-Rechner</strong>
        <span class="muted">Was wäre aus einem Sparplan geworden – mit einem Coin, mit Bitcoin oder mit dem Portfolio-Manager?</span></span><span class="btn ghost">Ausprobieren</span></a>
    </div>
    <section id="favs" hidden></section>
    <section id="picks-sec">
      <h2>Stärkste Kaufsignale</h2>
      <p class="hint">Coins aus den Top 500 mit ausreichend Handelsvolumen, sortiert nach Kauf-Score – riskantere Coins werden dabei abgewertet.</p>
      <div id="picks" class="picks"></div>
    </section>
    <section class="panel" id="record" hidden></section>
    <section class="heat-wrap">
      <div class="panel-top"><h2>Markt-Heatmap</h2>
        <div class="chips" id="heat-range"><button class="chip active" data-heat="24h">24 h</button><button class="chip" data-heat="7d">7 Tage</button><button class="chip" data-heat="30d">30 Tage</button></div></div>
      <div id="heatmap" class="heatmap"></div>
      <p class="hint">Die 100 größten Coins ohne Stablecoins: Die Fläche wächst mit dem Marktwert, die Farbe zeigt die Kursveränderung. Ein Klick öffnet den Coin.</p>
    </section>
    ${preview ? '<p class="hint">Bitcoin und Ethereum zeigen das Signal als Beispiel. Die Signale aller 1000 Coins siehst du mit einem kostenlosen Konto.</p>' : ''}
    <section class="controls">
      <input id="search" type="search" placeholder="Coin suchen (z. B. Bitcoin, ETH) …" aria-label="Coin suchen" value="${esc(state.query)}">
      <div class="chips" id="filters" role="group" aria-label="Nach Signal filtern"${preview ? ' hidden' : ''}>
        ${[['all', 'Alle'], ['buy', 'Kaufen'], ['hold', 'Halten'], ['sell', 'Verkaufen'], ...(depot.user ? [['watch', '★ Favoriten']] : [])].map(([k, l]) =>
          `<button data-filter="${k}" class="chip ${state.filter === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <label class="toggle"><input type="checkbox" id="show-none"${state.showNone ? ' checked' : ''}> Stablecoins und Token auf Aktien oder Gold zeigen</label>
    </section>
    <div class="table-wrap"><table>
      <thead><tr>
        ${th('rank', '#', 'num col-rank')}${th('name', 'Coin', 'col-coin')}${th('price', 'Kurs', 'num')}${th('h24', '24 h', 'num')}
        ${th('d7', `7 ${i18n.span('T')}`, 'num col-7d')}${th('d30', `30 ${i18n.span('T')}`, 'num col-30d')}${th('mcap', 'Marktkap.', 'num col-cap')}
        <th class="col-chart">7 Tage</th>${th('score', 'Kauf-Score', 'col-score')}
        <th class="col-hold">Haltedauer</th><th class="col-risk">Risiko</th><th>Signal</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div class="pager" id="pager"></div>`;

  $('#search').addEventListener('input', (e) => { state.query = e.target.value; state.page = 1; table(); });
  view.querySelector('.jump').addEventListener('click', (e) => {
    const sel = e.target.closest('[data-jump]')?.dataset.jump;
    if (!sel) return;
    e.preventDefault();
    view.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  let heatRange = '24h';
  $('#heat-range').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-heat]');
    if (!btn) return;
    heatRange = btn.dataset.heat;
    for (const b of $('#heat-range').children) b.classList.toggle('active', b === btn);
    heatmap();
  });
  $('#show-none').addEventListener('change', (e) => { state.showNone = e.target.checked; state.page = 1; table(); });
  $('#filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter; state.page = 1;
    for (const b of $('#filters').children) b.classList.toggle('active', b === btn);
    table();
  });
  $('thead', view).addEventListener('click', (e) => {
    const key = e.target.closest('[data-sort]')?.dataset.sort;
    if (!key) return;
    // Zahlenspalten beginnen absteigend, Rang und Name aufsteigend
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'rank' || key === 'name' ? 1 : -1 };
    table();
  });
  $('#rows').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (e.target.closest('[data-watch]')) return;
    if (row) location.hash = '#/coin/' + encodeURIComponent(row.dataset.id);
  });
  $('#pager').addEventListener('click', (e) => {
    const p = Number(e.target.closest('[data-page]')?.dataset.page);
    if (!p) return;
    state.page = p; table();
  });

  // Teilen: führt direkt in die App (kostenlose Vorschau) in der Sprache des Besuchers; Herkunft „share“ in der Nutzerübersicht
  function shareRow() {
    const m = state.market;
    if (!m) return;
    $('#share-row').innerHTML = shareLinks(shareUrl(), `${i18n.say('Das Krypto-Wetter heute')}: ${i18n.say(m.label)} (${m.value}/100)`, 'Heutigen Krypto-Wetterbericht teilen');
  }

  function weather() {
    const m = state.market, f = state.fng, btc = state.byId.get('bitcoin');
    if (!m) { $('#weather').innerHTML = '<p class="muted">Das Krypto-Wetter wird berechnet …</p>'; return; }
    const sky = skyOf(moodOf(m)), d24 = btc?.price_change_percentage_24h_in_currency;
    const wet = sky === 'storm' || sky === 'rain', dry = sky === 'sun' || sky === 'partly';
    // Der Kern der Seite in einem Satz: Regen ist oft Kaufwetter, Sonne oft teuer
    const tip = m.buy && wet && m.value >= 62 ? 'Regen ist Kaufwetter: Die Stimmung ist schlecht, der Zyklus aber günstig. Genau solche Tage waren auf ein Jahr gesehen meist gute Einstiege.'
      : m.buy && dry && m.value < 45 ? 'Sonne ist teuer: Die Stimmung ist gut, der Zyklus aber heiß. Jetzt eher nicht nachkaufen.'
        : m.buy && wet ? 'Regen allein ist noch kein Kaufgrund: Der Zyklus ist noch nicht günstig.'
          : '';
    $('#weather').className = `panel weather ${sky}`;
    $('#weather').innerHTML = `<div class="weather-icon">${skyIcon(sky)}</div>
      <div class="weather-main">
        <div class="label">Das Krypto-Wetter heute</div>
        <h1 class="weather-title">${SKY_TITLE[sky]}</h1>
        <p class="weather-mood">${SKY_TEXT[sky]}</p>
        <p class="weather-answer"><strong>Jetzt kaufen?</strong> ${NOW_ANSWER[m.label]}</p>
        ${tip ? `<p class="weather-tip ${wet && m.value >= 62 ? 'good' : ''}">${tip}</p>` : ''}
        <div class="weather-stats">
          <span>Kauf-Score <strong>${m.value}/100</strong> · ${badge(m)}</span>
          ${f ? `<span>Fear &amp; Greed <strong>${f.value}</strong> · ${fngLabel(f.value)}</span>` : ''}
          ${btc ? `<span>Bitcoin <strong>${money(btc.current_price)}</strong> <span class="${tone(d24)}">${pct(d24)}</span></span>` : ''}
        </div>
        <p class="share-row hint" id="share-row"></p>
      </div>`;
    shareRow();
  }

  // Wie lief Bitcoin nach Kauf-Scores wie heute? Aus dem Rückblick des Zyklus-Kompasses (Zyklus-Risiko = 100 − Kauf-Score)
  async function buyHistory() {
    const m = state.market, el = $('#buy-history');
    if (!m?.buy || !el) return;
    const x = await loadIndices();
    const risk = 100 - m.value, row = x?.risk?.backtest?.find((b) => risk >= b.lo && risk < b.hi);
    const y = yearAfterBuy(m.value)?.btc, q = row?.['90'] ?? row?.periods?.[1]?.['90'];
    if (!y || !$('#buy-history')) return;
    $('#buy-history').innerHTML = `<div class="label">Nach Ständen wie heute · seit 2022</div>
      <div class="bh-grid"><div><strong class="${y.up >= 55 ? 'up' : y.up <= 45 ? 'down' : ''}">${y.up} %</strong><span>Bitcoin ein Jahr später höher</span></div>
        <div><strong class="${tone(y.median)}">${signed(y.median, 0)} %</strong><span>mittleres Ergebnis nach einem Jahr</span></div>
        ${q ? `<div><strong class="${q.up >= 55 ? 'up' : q.up <= 45 ? 'down' : ''}">${q.up} %</strong><span>nach 90 Tagen höher</span></div>` : ''}</div>`;
  }

  // Was heißt das für dich? – aus dem Kauf-Score drei klare nächste Schritte
  function todo() {
    const m = state.market, el = $('#todo');
    if (!m?.buy || !el) { if (el) el.hidden = true; return; }
    el.hidden = false;
    const v = m.value;
    const steps = v >= 62 ? [['🌧️', 'Günstiger Zyklus: in Raten kaufen – vor allem Bitcoin und Ethereum, über mindestens 12 Monate.', '#/coin/bitcoin', 'Bitcoin ansehen'],
      ['🧮', 'Ausrechnen, was ein Sparplan gebracht hätte – mit einem Coin, mit Bitcoin oder mit dem Portfolio-Manager.', '#/rechner', 'Sparplan rechnen'],
      ['💼', 'Den Portfolio-Manager deinen Bestand prüfen lassen: was kaufen, was halten, wie viel Reserve.', depot.user ? '#/portfolio' : '#/konto', depot.user ? 'Portfolio prüfen' : 'Kostenlos starten']]
      : v >= 45 ? [['☁️', 'Weder billig noch teuer: Ein Sparplan kann normal weiterlaufen.', '#/rechner', 'Sparplan rechnen'],
        ['📈', 'Für die nächsten Wochen zählt der Trend: die stärksten Kaufsignale ansehen.', '#picks-sec', 'Kaufsignale ansehen'],
        ['💼', 'Den Portfolio-Manager deinen Bestand prüfen lassen.', depot.user ? '#/portfolio' : '#/konto', depot.user ? 'Portfolio prüfen' : 'Kostenlos starten']]
        : [['☀️', 'Teurer Zyklus: nicht nachkaufen, Gewinne teilweise sichern.', depot.user ? '#/portfolio' : '#/konto', depot.user ? 'Portfolio prüfen' : 'Kostenlos starten'],
          ['🧭', 'Im Zyklus-Kompass sehen, welche Bausteine heiß laufen.', '#/indikatoren', 'Zyklus-Kompass'],
          ['🧮', 'Prüfen, wie ein Sparplan durch teure Phasen kam.', '#/rechner', 'Sparplan rechnen']];
    el.innerHTML = `<div class="label">Was heißt das für dich?</div>
      <ol class="todo-list">${steps.map(([icon, text, href, btn]) => `<li><span class="todo-icon" aria-hidden="true">${icon}</span><span>${text}</span>
        <a class="btn ghost small" href="${href.startsWith('#/') ? href : '#'}"${href.startsWith('#/') ? '' : ` data-jump-to="${href}"`}>${btn}</a></li>`).join('')}</ol>
      <p class="hint">Keine Anlageberatung – eine Einordnung aus vergangenen Daten.</p>`;
    for (const a of el.querySelectorAll('[data-jump-to]')) a.addEventListener('click', (e) => { e.preventDefault(); view.querySelector(a.dataset.jumpTo)?.scrollIntoView({ behavior: 'smooth' }); });
  }

  function hero() {
    weather();
    todo();
    const m = state.market;
    $('#g-market').innerHTML = m ? `<div class="buy-gauge"><div class="label">Jetzt kaufen? · Kauf-Score</div>${gauge(m.value, SELL_TO_BUY)}
          <div class="gauge-value">${m.value}<small> / 100</small></div>${badge(m, 'big')}</div>
        <div class="buy-text">
          <h2>${m.buy ? BUY_TITLE[m.label] : 'Kauf-Score wird berechnet …'}</h2>
          <p>${m.buy ? buyDrivers(m.buy) : NOW_ANSWER[m.label]}</p>
          <div id="buy-history" class="buy-history"></div>
          <p class="hint">Sicht: 12 Monate und länger, für Sparpläne und Käufe in Raten. Kurzfristig kann der Kurs weiter fallen.
            Stand ${m.time.toLocaleTimeString(settings.locale, { hour: '2-digit', minute: '2-digit' })} ${infoBtn('index')}</p>
        </div>`
      : '<div class="label">Jetzt kaufen?</div><p class="muted">Wird berechnet …</p>';
    const b = m?.buy;
    $('#buy-parts').innerHTML = b ? `<div class="head-row"><div class="label">Das steckt im Kauf-Score</div><a class="link-more" href="#/indikatoren">Zyklus-Kompass →</a></div>
        ${buyInputs(b)}`
      : '<div class="label">Das steckt im Kauf-Score</div><p class="muted">Wird berechnet …</p>';
    buyHistory();
    const cy = m?.cycle, h = m?.buy ? yearAfterBuy(m.value) : null;
    $('#cycle').hidden = !cy && !h;
    const after = (who, up, mid) => `<strong>${who}:</strong> in ${up} % der Fälle höher, mittleres Ergebnis ${signed(mid, 0)} %.`;
    if (h) {
      // 12 Monate nach dem Kauf-Score – getrennt für Bitcoin, Ethereum und Altcoins, weil sie sich seit 2022 sehr verschieden verhielten
      $('#cycle').className = `panel cycle ${m.value >= 62 ? 'deep' : m.value >= 45 ? 'mid' : 'high'}`;
      $('#cycle').innerHTML = `<div class="panel-top"><div><div class="label">Sicht auf 12 Monate · nach dem Kauf-Score</div><h2>Ein Jahr nach Ständen wie heute</h2>${infoBtn('cycle')}</div>
          <strong class="cycle-dd">${m.value}<small> Kauf-Score</small></strong></div>
        <ul class="plain"><li>${after('Bitcoin', h.btc.up, h.btc.median)}</li><li>${after('Ethereum', h.eth.up, h.eth.median)}</li>
          <li>${after('Mittlerer Altcoin', h.alt.up, h.alt.median)}</li></ul>
        <p class="hint">Alle Tage seit 2022 mit vergleichbarem Kauf-Score. Altcoins verloren seit 2022 auf Jahressicht meist – auch nach günstigen Ständen.${cy ? ` Bitcoin liegt ${num(-cy.dd, 0)} % unter seinem Allzeithoch.` : ''}</p>`;
    } else if (cy) {
      $('#cycle').className = `panel cycle ${cy.zone}`;
      $('#cycle').innerHTML = `<div class="panel-top"><div><div class="label">Zyklus – Sicht auf 12 Monate</div><h2>${esc(cy.label)}</h2>${infoBtn('cycle')}</div>
          <strong class="cycle-dd">${num(-cy.dd, 0)} %<small> unter Allzeithoch</small></strong></div>
        <p>Bitcoin liegt ${num(-cy.dd, 0)} % unter seinem Allzeithoch. Ein Jahr nach vergleichbaren Ständen seit 2022:</p>
        <ul class="plain"><li>${after('Bitcoin', cy.btcUp, cy.btcMedian)}</li>
          <li>${after('Mittlerer Coin', cy.altUp, cy.altMedian)}</li></ul>`;
    }
    // Erfolgskontrolle: was aus den Kaufsignalen der Seite tatsächlich geworden ist
    const rec = state.record;
    $('#record').hidden = !rec;
    if (rec) {
      const line = (label, o) => (o ? `<div><div class="label">${label}</div><div class="value ${tone(o.avg)}">${signed(o.avg, 1)} %</div>
          <div class="muted">${num(o.up / o.n * 100, 0)} % im Plus (${o.up} von ${o.n}) · Bitcoin ${signed(o.btc, 1)} %${isNum(o.mkt) ? ` · Top 100 im Schnitt ${signed(o.mkt, 1)} %` : ''}</div></div>`
        : `<div><div class="label">${label}</div><div class="value muted">–</div><div class="muted">noch keine Ergebnisse</div></div>`);
      $('#record').innerHTML = `<div class="head-row"><div><div class="label">Erfolgskontrolle</div>
          <div class="muted">Kaufsignale der Seite, gemessen seit ${new Date(rec.since * 86_400_000).toLocaleDateString(settings.locale)}</div></div>${infoBtn('record', 'So wird gemessen')}</div>
        <div class="stat-grid">${line('Nach 7 Tagen', rec.d7)}${line('Nach 30 Tagen', rec.d30)}</div>
        ${rec.d7 ? '' : '<p class="hint">Die Messung hat gerade begonnen. Erste Ergebnisse gibt es 7 Tage nach den ersten Signalen.</p>'}`;
    }
    const f = state.fng;
    $('#g-fng').innerHTML = f ? `<div class="label">Fear &amp; Greed Index · <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener">alternative.me</a></div>${gauge(f.value, SELL_TO_BUY)}
        <div class="gauge-value">${f.value}<small> / 100</small></div><span class="badge none big">${fngLabel(f.value)}</span>
        <div class="hint">Vor 7 Tagen: ${isNum(f.history[7]?.value) ? f.history[7].value : '–'} · vor 30 Tagen: ${isNum(f.history[29]?.value) ? f.history[29].value : '–'}${f.cmc ? `<br>CoinMarketCap: ${f.cmc.value}${f.cmc.label ? ` (${esc(f.cmc.label)})` : ''}` : ''}</div>
        <details class="fold"><summary>Wirkung im Modell</summary>${fngEffect(m?.regime)}${infoBtn('fng', 'So wird gerechnet')}</details>`
      : '<div class="label">Fear &amp; Greed Index · <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener">alternative.me</a></div><p class="muted">Wird geladen …</p>';
    $('#market-parts').innerHTML = m ? `<div class="label">Markt-Wetter · Stimmung der nächsten Wochen</div>
        <div class="mood-row"><span class="mood-num">${moodOf(m)}<small> / 100</small></span><strong>${SKY_TITLE[skyOf(moodOf(m))]}</strong></div>
        <span class="mood-bar"><i style="left:${moodOf(m)}%"></i></span><div class="range-labels"><span>Sturm</span><span>Sonne</span></div>
        <p class="muted mood-text"><span>${SKY_TEXT[skyOf(moodOf(m))]}</span> <span>Das Wetter sagt, wie es dem Markt geht – ob sich ein Kauf lohnt, sagt der Kauf-Score.</span></p>
        <details class="fold"><summary>So entsteht das Markt-Wetter</summary>${infoBtn('weather')}
        ${factorList(m.mood?.parts ?? m.parts)}
        <details><summary>Heutige Einzelwerte der Marktphase</summary>${factorList(m.regime.factors)}</details></details>`
      : '<div class="label">Markt-Wetter</div><p class="muted">Wird berechnet …</p>';
  }

  // Kein Kaufsignal für die nächsten Wochen – aber vielleicht ein günstiger Zyklus. Beides steht da, damit es sich nicht widerspricht.
  function noPicks() {
    if (!state.coins.length) return '<p class="muted">Lade Kurse …</p>';
    const m = state.market, r = m?.regime;
    const why = r?.bear ? 'Bitcoin liegt unter seinem 200-Tage-Schnitt im Abwärtstrend – das bremst die Signale der Altcoins.'
      : greedZone(r) ? 'Die Gier-Bremse ist aktiv – nach solchen Phasen fielen die meisten Coins.' : 'Kein Coin erfüllt gerade die Kriterien.';
    return `<div class="panel no-picks"><p><strong>Aktuell kein Kaufsignal für die nächsten Wochen.</strong> ${why}</p>
      ${m?.buy && m.value >= 62 ? `<p>Für Käufe in Raten mit Blick auf 12 Monate und mehr zählt der Kauf-Score oben (${m.value}/100). Nach solchen Ständen stand Bitcoin seit 2022 ein Jahr später meist höher – kurzfristig kann der Kurs trotzdem weiter fallen.</p>` : ''}</div>`;
  }

  function picks() {
    // Riskantere Coins brauchen einen höheren Score, um vorne zu landen
    const list = state.coins.filter((c) => c.analysis.signal === 'buy' && (c.market_cap_rank ?? 9999) <= 500 &&
      c.total_volume >= 1e6 && !DERIVATIVE.test(c.name))
      .sort((a, b) => adjusted(b.analysis) - adjusted(a.analysis)).slice(0, 8);
    // Vorschau: Plätze, Signal, Haltedauer und Risiko sind sichtbar, welcher Coin es ist, nicht
    if (preview) {
      $('#picks').innerHTML = list.length ? list.map((c, i) => `<a class="pick panel locked" href="${depot.user ? '#/preise' : '#/konto'}">
          <div class="coin-cell"><span class="lock-icon" aria-hidden="true">🔒</span>
            <div><div class="label">Platz ${i + 1}</div><div class="coin-name blur" aria-hidden="true">Coinname</div></div></div>
          <div class="pick-score blur" aria-hidden="true">+00</div>
          <div class="pick-meta">${badge(c.analysis)}<span>Haltedauer: <strong>${c.analysis.horizon}</strong></span><span>Risiko: ${riskTag(c.analysis.risk)}</span></div>
        </a>`).join('') + `<section class="panel upsell"><div><h3>Welche Coins sind das?</h3>
          <p class="muted">Mit einem kostenlosen Konto siehst du die stärksten Kaufsignale, das Signal jedes Coins und die Detailansicht mit Rückblick.</p></div>
          <div class="btn-row"><a class="btn" href="${depot.user ? '#/preise' : '#/konto'}">${depot.user ? 'Pakete ansehen' : 'Kostenlos starten'}</a></div></section>`
        : noPicks();
      return;
    }
    $('#picks').innerHTML = list.length ? list.map((c) => `<a class="pick panel" href="#/coin/${encodeURIComponent(c.id)}">
        <div class="coin-cell"><img src="${esc(c.image)}" alt="" loading="lazy">
          <div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol)} · #${c.market_cap_rank}</div></div></div>
        <div class="pick-score ${tone(c.analysis.score)}">${to100(c.analysis.score)}<small>/100</small></div>
        <div class="pick-meta">${badge(c.analysis)}<span>Haltedauer: <strong>${c.analysis.horizon}</strong></span><span>Risiko: ${riskTag(c.analysis.risk)}</span></div>
      </a>`).join('')
      : noPicks();
  }

  function table() {
    const q = state.query.trim().toLowerCase();
    const get = SORTS[state.sort.key];
    const list = state.coins.filter((c) =>
      (state.filter === 'all' || c.analysis.signal === state.filter || (state.filter === 'watch' && watched(c.id))) &&
      (state.showNone || c.analysis.signal !== 'none' || q) &&
      (!q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = get(a), y = get(b);
        if (x == null || y == null) return (x == null) - (y == null);   // fehlende Werte ans Ende
        return (x < y ? -1 : x > y ? 1 : 0) * state.sort.dir;
      });

    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const rows = list.slice(0, state.page * PAGE_SIZE);

    for (const h of view.querySelectorAll('th[data-sort]')) {
      h.classList.toggle('sorted', h.dataset.sort === state.sort.key);
      h.dataset.dir = h.dataset.sort === state.sort.key ? (state.sort.dir > 0 ? '▲' : '▼') : '';
    }

    $('#rows').innerHTML = rows.length ? rows.map((c) => {
      const a = c.analysis, d7 = c.price_change_percentage_7d_in_currency;
      const hidden = preview && !SAMPLES.includes(c.id) && a.signal !== 'none';
      const lock = '<span class="lock-cell" title="Mit kostenlosem Konto sichtbar">🔒</span>';
      return `<tr class="coin" data-id="${esc(c.id)}">
        <td class="num muted col-rank">${c.market_cap_rank ?? ''}</td>
        <td class="col-coin"><div class="coin-line">${a.signal === 'none' ? '' : star(c.id)}<a class="coin-cell" href="#/coin/${encodeURIComponent(c.id)}"><img src="${esc(c.image)}" alt="" loading="lazy">
          <div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol)}</div></div></a></div></td>
        <td class="num">${money(c.current_price)}</td>
        <td class="num">${pct(c.price_change_percentage_24h_in_currency)}</td>
        <td class="num col-7d">${pct(d7)}</td>
        <td class="num col-30d">${pct(c.price_change_percentage_30d_in_currency)}</td>
        <td class="num col-cap">${compact(c.market_cap)}</td>
        <td class="col-chart">${sparkline(c.sparkline_in_7d?.price, !isNum(d7) || d7 >= 0)}</td>
        <td class="col-score">${hidden ? lock : scoreCell(a.score)}</td>
        <td class="col-hold">${hidden ? lock : a.horizon}</td>
        <td class="col-risk">${hidden ? lock : riskTag(a.risk)}</td>
        <td>${hidden ? lock : badge(a)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="12" class="empty">${state.coins.length ? 'Keine Coins gefunden.' : 'Lade Kurse …'}</td></tr>`;

    const btn = (p, label, active) => `<button class="chip ${active ? 'active' : ''}" data-page="${p}">${label}</button>`;
    $('#pager').innerHTML = state.page < pages
      ? `<button class="btn ghost" data-page="${state.page + 1}">Weitere ${Math.min(PAGE_SIZE, list.length - rows.length)} anzeigen</button><span class="muted">${rows.length} von ${list.length} Coins</span>`
      : list.length > PAGE_SIZE ? `<span class="muted">Alle ${list.length} Coins angezeigt</span>` : '';
  }

  // Erste Schritte nach der Anmeldung: eine kurze Liste mit Haken – verschwindet, wenn alles erledigt oder ausgeblendet ist
  function onboard() {
    const el = $('#onboard');
    let hidden = false; try { hidden = localStorage.getItem(ONBOARD_KEY) === '1'; } catch { /* dann zeigen */ }
    const d = depot.data;
    const steps = [
      ['☆', 'Coins mit einem Stern als Favoriten markieren', (d.watch ?? []).length > 0, '#rows'],
      ['🤖', 'Den Autopiloten starten oder deine Coins eintragen', d.positions.length > 0 || d.cash > 0 || !!d.mode, '#/portfolio'],
      ['🧭', 'Den Zyklus-Kompass ansehen', seen('compass'), '#/indikatoren'],
      ['🧮', 'Den Sparplan-Rechner ausprobieren', seen('calc'), '#/rechner'],
    ];
    const done = steps.filter((x) => x[2]).length;
    el.hidden = !depot.user || hidden || done === steps.length;
    if (el.hidden) return;
    el.innerHTML = `<div class="panel-top"><div><div class="label">Erste Schritte</div><strong>${done} von ${steps.length} erledigt</strong></div>
        <button type="button" class="link-btn" id="onboard-hide">Ausblenden</button></div>
      <ul class="onboard-list">${steps.map(([icon, text, ok, href]) => `<li class="${ok ? 'ok' : ''}"><span aria-hidden="true">${ok ? '✅' : icon}</span>
        ${ok ? `<span>${text}</span>` : `<a href="${href.startsWith('#/') ? href : '#/'}" ${href.startsWith('#/') ? '' : 'data-scroll="' + href + '"'}>${text}</a>`}</li>`).join('')}</ul>`;
    $('#onboard-hide').addEventListener('click', () => { try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* nur jetzt */ } el.hidden = true; });
    for (const a of el.querySelectorAll('[data-scroll]')) a.addEventListener('click', (e) => { e.preventDefault(); $(a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }); });
  }

  // Zyklus-Kompass als Kurzfassung – lädt einmal und verlinkt auf die ganze Seite
  let teaserDone = false;
  async function compassTeaser() {
    if (teaserDone) return;
    teaserDone = true;
    const x = await loadIndices();
    const el = $('#compass-teaser');
    if (!x || !el) return;
    el.innerHTML = `<div class="label">Zyklus-Kompass</div>
      <div class="teaser-stats">
        ${x.altseason ? `<span>Altcoin-Saison <strong>${x.altseason.value}/100</strong> · ${seasonLabel(x.altseason.value)}</span>` : ''}
        <span>Pi-Cycle <strong>${num(x.pi.ratio * 100, 0)} %</strong></span>
        <span>Mayer-Multiple <strong>${num(x.mayer.value, 2)}</strong></span>
      </div><span class="btn ghost">Alle Indikatoren</span>`;
    el.hidden = false;
  }

  // Heatmap: Kacheln nach dem „Squarified“-Verfahren – möglichst quadratisch, damit Kürzel und Prozent lesbar bleiben
  function heatmap() {
    const el = $('#heatmap');
    const list = state.coins.filter((c) => (c.market_cap_rank ?? 9999) <= 110 && c.analysis.signal !== 'none' && c.market_cap > 0).slice(0, 100);
    if (!list.length || !el.clientWidth) return;
    const W = el.clientWidth, H = Math.round(W < 600 ? W * 1.25 : W * 0.5);
    // Die Fläche wächst mit dem Marktwert, abgeschwächt – sonst wäre Bitcoin fast die ganze Karte
    const weights = list.map((c) => Math.pow(c.market_cap, 0.6)), sum = weights.reduce((a, b) => a + b, 0);
    let rest = list.map((c, i) => ({ c, v: weights[i] / sum * W * H }));
    const tiles = [];
    let x = 0, y = 0, w = W, h = H;
    while (rest.length) {
      const short = Math.min(w, h);
      const worst = (row) => { const t = row.reduce((a, b) => a + b.v, 0); const mx = Math.max(...row.map((r) => r.v)), mn = Math.min(...row.map((r) => r.v)); return Math.max(short * short * mx / (t * t), t * t / (short * short * mn)); };
      const row = [rest[0]]; let i = 1;
      while (i < rest.length && worst([...row, rest[i]]) <= worst(row)) row.push(rest[i++]);
      const t = row.reduce((a, b) => a + b.v, 0);
      if (w >= h) { const cw = t / h; let cy = y; for (const r of row) { const rh = r.v / cw; tiles.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; } x += cw; w -= cw; }
      else { const rh = t / w; let cx = x; for (const r of row) { const rw = r.v / rh; tiles.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; } y += rh; h -= rh; }
      rest = rest.slice(i);
    }
    const key = { '24h': 'price_change_percentage_24h_in_currency', '7d': 'price_change_percentage_7d_in_currency', '30d': 'price_change_percentage_30d_in_currency' }[heatRange];
    const full = { '24h': 8, '7d': 20, '30d': 35 }[heatRange];   // so viel Prozent ergeben die kräftigste Farbe
    el.style.height = `${H}px`;
    el.innerHTML = tiles.map(({ c, x: tx, y: ty, w: tw, h: th }) => {
      const v = c[key], a = isNum(v) ? Math.round(Math.min(1, Math.abs(v) / full) * 75 + 10) : 0;
      const bg = !isNum(v) ? 'var(--panel-2)' : `color-mix(in srgb, var(--${v >= 0 ? 'up' : 'down'}) ${a}%, var(--panel-2))`;
      const big = tw > 46 && th > 30, fs = Math.max(10, Math.min(22, Math.sqrt(tw * th) / 5));
      return `<a class="heat-tile" href="#/coin/${encodeURIComponent(c.id)}" style="left:${tx}px;top:${ty}px;width:${tw}px;height:${th}px;background:${bg};font-size:${fs}px"
        title="${esc(c.name)}: ${isNum(v) ? `${signed(v, 1)} %` : '–'}">${big ? `<span class="coin-sym">${esc(c.symbol.toUpperCase())}</span><small>${pct(v)}</small>` : ''}</a>`;
    }).join('');
  }

  function favs() {
    const list = (depot.user ? depot.data.watch ?? [] : []).map((id) => state.byId.get(id)).filter(Boolean);
    $('#favs').hidden = !list.length;
    if (!list.length) return;
    $('#favs').innerHTML = `<h2>Deine Favoriten</h2><div class="fav-list">${list.map((c) => {
      const d24 = c.price_change_percentage_24h_in_currency, open = !preview || SAMPLES.includes(c.id);
      return `<a class="panel fav" href="#/coin/${encodeURIComponent(c.id)}"><div class="coin-cell"><img src="${esc(c.image)}" alt="" loading="lazy">
        <div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol)}</div></div></div>
        <div class="fav-num"><strong>${money(c.current_price)}</strong><span class="${tone(d24)}">${pct(d24)}</span></div>
        <div>${open ? badge(c.analysis) : '<span class="lock-cell">🔒</span>'}</div></a>`;
    }).join('')}</div>`;
  }

  // Autopilot-Vorschau: einmal, sobald Kurse da sind, und wenn sich der Zugang ändert
  let apKey = null;
  const apTeaser = () => { const key = `${state.coins.length > 0}|${access().plan}|${depot.data.mode}|${state.record?.ap?.nav}`; if (key === apKey) return; apKey = key; autopilotTeaser($('#ap-teaser')); };
  return { update() { hero(); onboard(); compassTeaser(); apTeaser(); favs(); picks(); heatmap(); table(); } };
}

// ---------- Detailansicht ----------

const RANGES = { '1T': 1, '7T': 7, '30T': 30, '90T': 90, '1J': 365, '4J': 1461 };
const INTRADAY_REFRESH_MS = 2 * 60_000;

function drawChart(el, { t, p, overlays = [], hourly, intraday, note, marker, plain }) {
  // plain: Kennzahlen ohne Währung (Indikatoren)
  const fmtV = plain ? (v) => num(v, Math.abs(v) < 10 ? 2 : 0) : money;
  if (p.length < 2) { el.innerHTML = '<p class="muted">Keine Kursdaten für diesen Zeitraum.</p>'; return; }
  // In echten Pixeln zeichnen, damit die Beschriftung auf schmalen Bildschirmen lesbar bleibt
  const W = Math.max(el.clientWidth, 280), narrow = W < 600;
  const H = narrow ? 240 : 320, L = 10, R = narrow ? 66 : 84, T = 12, B = 26;
  const tickCount = narrow ? 2 : 4;
  const all = p.concat(...overlays.map((o) => o.values.filter((v) => v != null)));
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || hi * 0.01;
  // Beträge und Kurse sind nie negativ – die Achse beginnt dann höchstens bei null
  lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad; hi += pad;
  const x = (i) => L + i / (p.length - 1) * (W - L - R);
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = (vals) => {
    let d = '', pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const date = (ms) => new Date(ms).toLocaleString(settings.locale, hourly
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
  const color = p[p.length - 1] >= p[0] ? 'var(--up)' : 'var(--down)';

  const grid = [0, 1, 2, 3, 4].map((k) => {
    const v = lo + (hi - lo) * k / 4;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${W - R + 8}" y="${y(v) + 4}" class="axis">${esc(fmtV(v))}</text>`;
  }).join('');
  const ticks = Array.from({ length: tickCount + 1 }, (_, k) => {
    const i = Math.round(k / tickCount * (p.length - 1));
    const anchor = k === 0 ? 'start' : k === tickCount ? 'end' : 'middle';
    // Tagesansicht: Uhrzeit, sonst das Datum
    const label = intraday ? new Date(t[i]).toLocaleTimeString(settings.locale, { hour: '2-digit', minute: '2-digit' }) : date(t[i]).slice(0, hourly ? 6 : 10);
    return `<text x="${x(i)}" y="${H - 6}" text-anchor="${anchor}" class="axis">${label}</text>`;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kursverlauf">
      ${grid}${ticks}
      <path d="${path(p)}L${x(p.length - 1)} ${H - B}L${L} ${H - B}Z" fill="${color}" opacity=".08"/>
      ${overlays.map((o) => `<path d="${path(o.values)}" fill="none" stroke="${o.color}" stroke-width="1.5" stroke-dasharray="5 4"/>`).join('')}
      <path d="${path(p)}" fill="none" stroke="${color}" stroke-width="2"/>
      ${marker ? `<line x1="${x(marker.index)}" x2="${x(marker.index)}" y1="${T}" y2="${H - B}" class="cross"/><text x="${x(marker.index) + (marker.index > p.length * 0.6 ? -6 : 6)}" y="${T + 10}" text-anchor="${marker.index > p.length * 0.6 ? 'end' : 'start'}" class="axis">${esc(marker.label)}</text>` : ''}
      <g class="cursor" hidden><line y1="${T}" y2="${H - B}" class="cross"/><circle r="4" fill="${color}"/></g>
    </svg>
    <div class="tip" hidden></div>
    <div class="legend">${overlays.map((o) => `<span><i style="background:${o.color}"></i>${o.label}</span>`).join('')}${note ? `<span class="muted">${esc(note)}</span>` : ''}</div>`;

  const svg = $('svg', el), cursor = $('.cursor', el), tip = $('.tip', el);
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width * W;
    const i = Math.max(0, Math.min(p.length - 1, Math.round((px - L) / (W - L - R) * (p.length - 1))));
    cursor.hidden = false;
    $('line', cursor).setAttribute('x1', x(i)); $('line', cursor).setAttribute('x2', x(i));
    $('circle', cursor).setAttribute('cx', x(i)); $('circle', cursor).setAttribute('cy', y(p[i]));
    tip.hidden = false;
    tip.innerHTML = `<strong>${esc(fmtV(p[i]))}</strong><br>${date(t[i])}`;
    const left = x(i) / W * box.width;
    tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
  });
  svg.addEventListener('pointerleave', () => { cursor.hidden = true; tip.hidden = true; });
}

function detailView(id) {
  const d = { range: '1J', started: false, data: null, ind: null, source: null, error: null,
    tests: null, testsWithRegime: null, news: null, newsError: null,
    intra: null, intraNote: null, intraTime: 0, intraLoading: false };
  view.innerHTML = `
    <a class="back" href="#/">← Zurück zur Übersicht</a>
    <div id="d-head"></div>
    <div id="d-compass"></div>
    <div id="d-auto"></div>
    <section class="panel">
      <div class="panel-top"><h2>Kursverlauf</h2>
        <div class="chips" id="ranges">${Object.keys(RANGES).map((r) => `<button class="chip ${r === d.range ? 'active' : ''}" data-range="${r}">${i18n.span(r)}</button>`).join('')}</div></div>
      <div id="chart" class="chart"><p class="muted">Lade Kursverlauf …</p></div>
    </section>
    <div id="d-forecast"></div>
    <div id="d-news"></div>
    <div id="d-stats"></div>`;

  $('#ranges').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    d.range = btn.dataset.range;
    for (const b of $('#ranges').children) b.classList.toggle('active', b === btn);
    chart();
    update();   // Kopfzeile zeigt die Veränderung über den gewählten Zeitraum
  });

  const self = { update };

  // Tageskurse landen in state.daily, Nachrichten in state.news. rebuild() rechnet daraus die eine
  // Bewertung des Coins, die auch die Liste zeigt.
  async function loadData(c) {
    try {
      if (!state.daily.has(id)) {
        let data = null;
        try { data = await api.history(c.symbol, histSource(c)); } catch { /* Börsen nicht erreichbar */ }
        // Gleiches Kürzel, aber ein anderer Coin? Dann weicht der Kurs deutlich ab
        if (data && Math.abs(data.p[data.p.length - 1] / c.current_price - 1) > 0.1) data = null;
        // Nur wenn keine Börse den Coin führt: CoinGecko, im kostenlosen Zugang höchstens ein Jahr
        if (!data) data = { ...(await api.chart(id, 'usd')), source: 'CoinGecko' };
        state.daily.set(id, data);
        rebuild();
      }
    } catch (err) {
      d.error = err.message;
    }
    if (current !== self) return;
    update(); chart();   // update() übernimmt die geladenen Tageskurse, erst dann kann das Diagramm zeichnen
  }

  // Tagesansicht: 5-Minuten-Kurse von Binance, sonst die letzten 24 Stundenkurse aus der Marktliste
  async function loadIntraday(c) {
    d.intraLoading = true;
    let data = null;
    try { data = await api.intraday(c.symbol); } catch { /* Binance nicht erreichbar */ }
    // Gleiches Kürzel, aber ein anderer Coin? Dann weicht der Kurs deutlich ab
    if (data && Math.abs(data.p[data.p.length - 1] / c.current_price - 1) > 0.1) data = null;
    if (data) d.intraNote = 'Kurse im 5-Minuten-Takt (Binance)';
    else {
      const p = (c.sparkline_in_7d?.price || []).filter(isNum).slice(-25);
      const now = Date.now();
      data = { p, t: p.map((_, i) => now - (p.length - 1 - i) * 3_600_000) };
      d.intraNote = 'Stundenkurse (CoinGecko) – für diesen Coin gibt es keine feineren Daten';
    }
    d.intra = data; d.intraTime = Date.now(); d.intraLoading = false;
    if (current === self && d.range === '1T') { chart(); update(); }
  }

  async function loadNews(c) {
    try {
      state.news.set(id, analyseNews(await api.coinNews(c.name, c.symbol)));
      rebuild();
    } catch (err) { d.newsError = err.message; }
    if (current === self) update();
  }

  function chart() {
    const el = $('#chart');
    const c = state.byId.get(id);
    if (d.range === '1T') {
      if (d.intra) drawChart(el, { t: d.intra.t, p: d.intra.p, hourly: true, intraday: true, note: d.intraNote });
      else el.innerHTML = `<p class="muted">${c ? 'Lade Tageskurs …' : 'Für diesen Coin gibt es keine Kursdaten.'}</p>`;
      if (c && !d.intraLoading && Date.now() - d.intraTime > INTRADAY_REFRESH_MS) loadIntraday(c);
    } else if (d.range === '7T') {
      const p = (c?.sparkline_in_7d?.price || []).filter(isNum);
      const now = Date.now();
      drawChart(el, { p, t: p.map((_, i) => now - (p.length - 1 - i) * 3_600_000), hourly: true });
    } else if (d.data) {
      const n = RANGES[d.range];
      drawChart(el, { t: d.data.t.slice(-n), p: d.data.p.slice(-n), overlays: [
        { label: '50-Tage-Schnitt', color: 'var(--accent)', values: d.ind.sma50.slice(-n) },
        { label: '200-Tage-Schnitt', color: 'var(--violet)', values: d.ind.sma200.slice(-n) },
      ] });
    } else el.innerHTML = `<p class="muted">${esc(d.error ?? 'Lade Kursverlauf …')}</p>`;
  }

  // Kursveränderung über den im Diagramm gewählten Zeitraum, gemessen bis zum aktuellen Kurs
  function rangeChange(c) {
    if (d.range === '1T') {
      // Die Veränderung über 24 Stunden steht schon darüber – hier die Spanne des Tages
      const p = d.intra?.p ?? [];
      const lo = isNum(c.low_24h) ? c.low_24h : p.length ? Math.min(...p) : null, hi = isNum(c.high_24h) ? c.high_24h : p.length ? Math.max(...p) : null;
      return isNum(lo) && isNum(hi) ? `<div><span class="muted">Tagesspanne</span> ${money(lo)} – ${money(hi)}</div>` : '';
    }
    if (d.range === '7T') {
      const v = c.price_change_percentage_7d_in_currency;
      return isNum(v) ? `<div>${pct(v)} <span class="muted">in 7 Tagen</span></div>` : '';
    }
    if (!d.data) return '';
    const n = Math.min(RANGES[d.range], d.data.p.length);
    const first = d.data.p[d.data.p.length - n];
    if (!(first > 0) || !isNum(c.current_price)) return '';
    const days = Math.round((Date.now() - d.data.t[d.data.t.length - n]) / 86_400_000);
    // Reicht die Kursgeschichte nicht so weit zurück, steht die tatsächliche Spanne da
    const label = n < RANGES[d.range] ? `${days} Tagen (gesamte Kursgeschichte)` : { '30T': '30 Tagen', '90T': '90 Tagen', '1J': '1 Jahr', '4J': '4 Jahren' }[d.range];
    return `<div>${pct((c.current_price / first - 1) * 100)} <span class="muted">in ${label}</span></div>`;
  }

  function head(c, a) {
    const strength = { Kaufen: 'deutlich', 'Eher kaufen': 'schwach – leichter Vorteil', Verkaufen: 'deutlich', 'Eher verkaufen': 'schwach' }[a.label];
    $('#d-head').innerHTML = `<section class="panel d-head">
      <div class="d-coin"><img src="${esc(c.image)}" alt="">
        <div><h1 class="d-name">${esc(c.name)} <span class="coin-sym">${esc(c.symbol)}</span> ${a.signal === 'none' ? '' : star(c.id)}</h1>
          <div class="muted">Rang #${c.market_cap_rank ?? '–'}</div></div></div>
      <div><div class="d-price">${money(c.current_price)}</div>
        <div>${pct(c.price_change_percentage_24h_in_currency)} <span class="muted">in 24 Stunden</span></div>
        ${rangeChange(c)}</div>
      <div class="d-signal">${badge(a, 'big')}
        <dl><div><dt>Kauf-Score</dt><dd class="${tone(a.score)}">${a.score === null ? '–' : to100(a.score) + ' / 100'}</dd></div>
          ${strength ? `<div><dt>Signalstärke</dt><dd>${strength}</dd></div>` : ''}
          <div><dt>Haltedauer</dt><dd>${a.horizon}</dd></div>
          ${a.scope ? `<div><dt>Signal gilt für</dt><dd>${a.scope === 'weeks' ? 'die nächsten Wochen – nicht zum langen Halten' : a.scope === 'year' ? '12 Monate und länger (Zyklus-Kompass)' : 'Wochen bis Monate'}</dd></div>` : ''}
          <div><dt>Risiko</dt><dd>${riskTag(a.risk)}</dd></div>
          ${a.mood ? `<div><dt>Stimmung des Coins</dt><dd>${a.mood.value} / 100 · ${moodLabel(a.mood.value)}</dd></div>` : ''}
          <div><dt>Übereinstimmung</dt><dd>${a.agreement ? `${a.agreement.agreeing} von ${a.agreement.of} Zeiträumen` : '–'}</dd></div></dl></div>
      ${summary(a)}
      <p class="share-row hint d-share">${shareLinks(shareUrl(`#/coin/${encodeURIComponent(c.id)}`), `${c.name}: ${i18n.say(a.label)} – Coinweather`)}
        <a href="#/vergleich/${encodeURIComponent(c.id)},${c.id === 'bitcoin' ? 'ethereum' : 'bitcoin'}">⇄ ${c.id === 'bitcoin' ? 'Mit Ethereum vergleichen' : 'Mit Bitcoin vergleichen'}</a>
        <a href="#/rechner/${encodeURIComponent(c.id)}">🧮 Sparplan rechnen</a></p>
    </section>`;
  }

  // „Kurz gesagt“: das Signal in Alltagssprache, mit der Häufigkeit aus vergleichbaren Fällen
  function summary(a) {
    if (a.signal === 'none') return '';
    const say = a.byCycle ? { Kaufen: 'Der Zyklus ist günstig – ein guter Stand für Käufe in Raten über mindestens 12 Monate.', 'Eher kaufen': 'Der Zyklus ist eher günstig – Käufe in Raten über mindestens 12 Monate.',
      Halten: 'Weder billig noch teuer – ein Sparplan kann normal weiterlaufen.', 'Eher verkaufen': 'Der Zyklus ist teuer – nicht nachkaufen.', Verkaufen: 'Der Zyklus ist überhitzt – Gewinne sichern.' }[a.label] ?? ''
      : a.anticyclical ? 'Antizyklischer Einstieg für mindestens 12 Monate – kurzfristig kann der Kurs weiter fallen.'
      : { Kaufen: 'Die Daten sprechen für einen Kauf.', 'Eher kaufen': 'Die Daten sprechen leicht für einen Kauf – ein schwaches Signal.',
        Halten: 'Im Moment kein klarer Vorteil – abwarten.', 'Eher verkaufen': 'Die Daten sprechen eher gegen einen Kauf.',
        Verkaufen: 'Die Daten sprechen gegen einen Kauf.' }[a.label] ?? '';
    const up = a.forecast?.medium?.up, year = a.forecast?.long;
    return `<p class="d-summary"><strong>Kurz gesagt:</strong> <span>${say}</span>
      ${isNum(up) && !a.byCycle && !a.cycleLed ? `<span>In vergleichbaren Fällen stand der Kurs 30 Tage später in ${up} von 100 Fällen höher.</span>` : ''}
      ${year?.byBuy && isNum(year.up) ? `<span>Auf 12 Monate (nach dem Kauf-Score): in ${year.up} von 100 vergleichbaren Fällen höher.</span>` : ''}
      <span class="muted">Eine Wahrscheinlichkeit, keine Garantie.</span></p>`;
  }

  // fc: die Aussicht von heute für denselben Zeitraum – sie steht zum Vergleich unter dem Rückblick
  function testBox(bt, fc, basis) {
    if (!bt || bt.all.n < 30) return '';
    const line = (b, label, fall) => (b.n < 5 ? `<li><span class="muted">${label}: zu selten aufgetreten (${b.n} Tage)</span></li>`
      : `<li><strong>${label}</strong> an ${b.n} Tagen → in ${num(fall ? 100 - b.upRate : b.upRate, 0)} von 100 Fällen ${fall ? 'tiefer' : 'höher'}</li>`);
    // Vorsprung der Kaufsignale vor allen Tagen, in Fällen von 100
    const edge = bt.buy.n >= 5 ? bt.buy.upRate - bt.all.upRate : null;
    const verdict = edge === null ? '' : edge > 5
      ? '<p class="up">Kaufsignale liefen bei diesem Coin öfter ins Plus als ein beliebiger Tag.</p>'
      : edge < -5 ? '<p class="down">Kaufsignale liefen bei diesem Coin seltener ins Plus als ein beliebiger Tag.</p>'
      : '<p class="muted">Kaufsignale brachten bei diesem Coin kaum einen Vorteil gegenüber einem beliebigen Tag.</p>';
    return `<div class="panel"><h3>${bt.days} Tage später</h3><ul class="plain">
      ${line(bt.buy, 'Kaufsignal')}${line(bt.sell, 'Verkaufssignal', true)}
      <li><span class="muted">Zum Vergleich alle ${bt.all.n} Tage: in ${num(bt.all.upRate, 0)} von 100 Fällen höher</span></li>
      ${fc && isNum(fc.up) ? `<li><span class="muted">Aussicht von heute (${basis}): in ${fc.up} von 100 Fällen höher</span></li>` : ''}
    </ul>${verdict}</div>`;
  }

  function forecast(c, a) {
    if (a.signal === 'none') { $('#d-forecast').innerHTML = `<section class="panel"><h2>Prognose</h2><p>${esc(a.notes[0])}</p></section>`; return; }
    // Bausteine des Scores: Bewertung des bisherigen Kursverlaufs und ihr Beitrag in Punkten. Eine Prognose sind sie
    // nicht – die steht einmal, als Prozentwert mit Einordnung, in den drei Feldern darüber.
    const weightSum = Object.keys(WEIGHTS).reduce((sum, k) => sum + (a[k].score === null ? 0 : WEIGHTS[k]), 0);
    const share = (k) => (a[k].score === null || !weightSum ? null : a[k].score * 100 * WEIGHTS[k] / weightSum);
    const blockSum = Math.round(Object.keys(WEIGHTS).reduce((sum, k) => sum + (share(k) ?? 0), 0));
    const block = (key, title, hint) => {
      const h = a[key], pts = share(key);
      return `<div class="panel h-card">
      <div class="panel-top"><div><h3>${title}</h3><div class="muted">${hint}${pts === null ? '' : ` · Bewertung ${signed(h.score * 100, 0)}, zählt ${num(WEIGHTS[key] * 100, 0)} %`}</div></div>
        <span class="outlook ${tone(pts === null ? 0 : Math.round(pts / 2))}">${pts === null ? '–' : `${signed(pts / 2, 0)} ${Math.abs(Math.round(pts / 2)) === 1 ? 'Punkt' : 'Punkte'}`}</span></div>
      ${factorList(h.factors)}</div>`;
    };

    const fcast = a.forecast;
    // Je Zeitraum die Einordnung und ihre Grundlage: wie oft der Kurs in vergleichbaren Fällen höher stand.
    // Ein Prozentwert steht bewusst nicht da – er läge meist bei ±1 % und wirkte genauer, als er ist.
    // Auf 12 Monate gibt es nur zwei Zyklen; ihr Ergebnis steht da, damit klar ist, dass die Jahressicht am Markt hängt.
    const fbox = (title, s) => {
      if (!s) return `<div><div class="label">${title}</div><div class="value muted">–</div></div>`;
      const [word, dir] = outlookOf(s);
      const who = c.id === 'bitcoin' ? 'stand Bitcoin' : c.id === 'ethereum' ? 'stand Ethereum' : 'standen Altcoins';
      const basis = s.days >= 365 && isNum(s.up) && s.byBuy ? `Folgt dem Kauf-Score: Seit 2022 ${who} ein Jahr nach vergleichbaren Ständen in ${s.up} % der Fälle höher, im Mittel ${signed(s.mid, 0)} %`
        : s.days >= 365 && isNum(s.up) ? `Hängt am Marktzyklus: Seit 2022 ${c.id === 'bitcoin' ? 'stand Bitcoin' : 'standen vergleichbare Coins'} ein Jahr nach solchen Lagen in ${s.up} % der Fälle höher, im Mittel ${signed(s.mid, 0)} %`
        : isNum(s.up) ? `höher in ${s.up} von 100 vergleichbaren Fällen` : '';
      return `<div><div class="label">${title}</div><div class="value ${tone(dir)}">${word}</div><div class="muted">${basis}</div></div>`;
    };
    const why = a.reasons;
    const reasonList = (list) => list.map((f) => `<li><strong class="${tone(f.points)}">${signed(f.points / 2, 0)}</strong> ${esc(f.name)} <span class="muted">(${f.horizon})</span>: ${esc(f.text)}</li>`).join('');
    const percent = !fcast ? '' : `<section class="panel"><div class="head-row"><h2>Aussicht nach Zeitraum</h2>${infoBtn('percent')}</div>
        ${a.byCycle || a.cycleLed ? `<div class="stat-grid">${fbox('In 12 Monaten', fcast.long)}</div>
          <p class="hint">${a.byCycle ? 'Bitcoin und Ethereum folgen vor allem dem Kauf-Score des Zyklus-Kompasses – er gilt für 12 Monate und länger.' : 'Dieses Kaufsignal kommt vor allem vom günstigen Zyklus – es gilt für 12 Monate und länger.'}
            Auf Sicht von Wochen gab der Zyklus keinen Vorteil: Der Kurs kann weiter fallen, wie stark, zeigt die übliche Schwankungsbreite unten.</p>`
          : `<div class="stat-grid">${fbox('In 7 Tagen', fcast.short)}${fbox('In 30 Tagen', fcast.medium)}${fbox('In 12 Monaten', fcast.long)}</div>`}
        ${why && (why.pro.length || why.contra.length) ? `<div class="h-cards reasons">
          <div><h3>Das spricht dafür</h3>${why.pro.length ? `<ul class="plain">${reasonList(why.pro)}</ul>` : '<p class="muted">Kein Merkmal spricht derzeit deutlich für den Coin.</p>'}</div>
          <div><h3>Das spricht dagegen</h3>${why.contra.length ? `<ul class="plain">${reasonList(why.contra)}</ul>` : '<p class="muted">Kein Merkmal spricht derzeit deutlich dagegen.</p>'}</div></div>` : ''}
        ${a.mood ? `<p class="hint mood-line">Stimmung des Coins: <strong>${a.mood.value} von 100</strong> (${moodLabel(a.mood.value)}${a.mood.fearDays > 1 ? `, seit ${a.mood.fearDays} Tagen in Angst` : a.mood.greedDays > 1 ? `, seit ${a.mood.greedDays} Tagen in Gier` : ''}) ${infoBtn('mood', 'Was heißt das?')}</p>` : ''}
      </section>`;

    let extra = '';
    if (d.ind) {
      // Rückblick-Test nur neu rechnen, wenn die Bitcoin-Daten für die Marktphase dazugekommen sind
      if (!d.tests || d.testsWithRegime !== !!state.btcInd) {
        d.testsWithRegime = !!state.btcInd;
        // dieselben Zeiträume wie in der Prognose, damit sich beides vergleichen lässt
        d.tests = (a.byCycle ? [90, 365] : [7, 30]).map((days) => backtest(d.ind, state.btcInd, state.fng?.byDay, days, c.id));
      }
      const move = expectedMove(d.data.p);
      const span = (m) => `${money(c.current_price * Math.exp(-m))} bis ${money(c.current_price * Math.exp(m))}`;
      const years = d.ind.n / 365;
      extra = `<section class="panel"><div class="head-row"><h2>Übliche Schwankungsbreite</h2>${infoBtn('swing')}</div>
          ${move ? `<div class="stat-grid">
            <div><div class="label">In 7 Tagen</div><div class="value">± ${num(move.d7 * 100, 0)} %</div><div class="muted">${span(move.d7)}</div></div>
            <div><div class="label">In 30 Tagen</div><div class="value">± ${num(move.d30 * 100, 0)} %</div><div class="muted">${span(move.d30)}</div></div></div>` : ''}
        </section>
        <div class="head-row"><h2>Rückblick-Test über ${years >= 1.5 ? num(years, 1) + ' Jahre' : num(d.ind.n, 0) + ' Tage'}</h2>${infoBtn('backtest')}</div>
        <p class="hint">So liefen die Signale bei diesem Coin (Kursgeschichte von ${d.source}). Das beschreibt seine Vergangenheit und ist keine Vorhersage:
          Coins mit besonders gutem Rückblick liefen danach nicht besser als andere.</p>
        <div class="h-cards">${d.tests.map((bt) => testBox(bt, a.byCycle ? (bt.days >= 365 ? fcast?.long : null) : bt.days === 7 ? fcast?.short : fcast?.medium,
          a.byCycle ? 'nach dem Kauf-Score' : 'alle geprüften Coins bei diesem Score')).join('') || '<p class="muted">Zu wenig Kursgeschichte für einen Rückblick-Test.</p>'}</div>`;
    } else if (d.error) extra = `<section class="panel"><p class="muted">${esc(d.error)}</p></section>`;

    $('#d-forecast').innerHTML = `${percent}
      ${a.notes.map((n) => `<p class="notice">${esc(n)}</p>`).join('')}
      <details class="fold d-fold"><summary>So entsteht der Score</summary>${infoBtn('horizons')}
      <p class="hint">Vier Bausteine bewerten den bisherigen Kursverlauf und die Marktlage – die Zutaten des Scores, keine eigenen Prognosen.
        ${d.ind ? `Verfeinert mit ${num(d.ind.n, 0)} Tageskursen.` : 'Schnellbewertung – die verfeinerte Bewertung wird geladen …'}</p>
      <div class="h-cards">${block('short', 'Kurzfristig', 'die letzten Tage')}${block('medium', 'Mittelfristig', '2–4 Wochen')}
        ${block('long', 'Langfristig', '200 Tage bis 1 Jahr')}${block('regime', 'Marktphase', 'gilt für alle Coins, Schnitt aus 14 Tagen')}</div>
      <p class="hint block-sum">So ergibt sich der Kauf-Score: Ausgangswert 50, die Bausteine zusammen <strong>${signed(blockSum / 2, 0)}</strong>${a.byCycle
          ? `. Bei ${c.id === 'bitcoin' ? 'Bitcoin' : 'Ethereum'} zählen sie nur zu 20 %, zu 80 % zählt der Kauf-Score des Zyklus-Kompasses (${a.regime?.buy}) – zusammen <strong>${to100(a.score)}/100</strong>.`
          : a.cycle ? `, dazu der Zyklus-Bonus <strong>+${Math.round(a.cycle / 2)}</strong> – zusammen <strong>${to100(a.score)}/100</strong>${to100(a.score) !== Math.round(50 + blockSum / 2 + a.cycle / 2) ? ' (Filter, Nachrichten oder die Grenzen des Kompasses verschieben ihn)' : ''}.`
          : ` – zusammen <strong>${to100(a.score)}/100</strong>${to100(a.score) !== Math.round(50 + blockSum / 2) ? ' (Filter, Nachrichten oder die Grenzen des Kompasses verschieben ihn)' : ''}.`}</p></details>
      ${extra}`;
  }

  function news(a) {
    const el = $('#d-news');
    if (a.signal === 'none') { el.innerHTML = ''; return; }
    const n = d.news;
    const tag = (t) => (t > 0 ? '<span class="tag up">positiv</span>' : t < 0 ? '<span class="tag down">negativ</span>' : '<span class="tag">neutral</span>');
    const body = !n ? `<p class="muted">${esc(d.newsError ?? 'Lade Nachrichten …')}</p>` : `
      <p>${esc(n.text)}${n.score !== null && !state.server ? ` → Einfluss auf den Score: <strong class="${tone(Math.round(n.score * 10))}">${signed(n.score * 10, 0)} Punkte</strong>` : ''}</p>
      <ul class="news">${n.items.slice(0, 8).map((it) => `<li>${tag(it.tone)}
        <span>${/^https?:\/\//.test(it.link) ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}
        <br><span class="muted">${esc(it.source ?? '')} · ${new Date(it.time).toLocaleDateString(settings.locale)}</span></span></li>`).join('')}</ul>`;
    el.innerHTML = `<section class="panel"><div class="head-row"><h2>Nachrichten</h2>${infoBtn('news')}</div>
      ${body}</section>`;
  }

  function stats(c) {
    const cell = (label, value) => `<div><div class="label">${label}</div><div class="value">${value}</div></div>`;
    const coins = (v) => (isNum(v) ? `${v.toLocaleString(settings.locale, { maximumFractionDigits: 0 })} ${esc(c.symbol.toUpperCase())}` : '–');
    $('#d-stats').innerHTML = `<section class="panel"><h2>Kennzahlen</h2><div class="stat-grid">
      ${cell('Marktkapitalisierung', compact(c.market_cap))}${cell('Handelsvolumen 24 h', compact(c.total_volume))}
      ${cell('24-h-Hoch', money(c.high_24h))}${cell('24-h-Tief', money(c.low_24h))}
      ${cell('7 Tage', pct(c.price_change_percentage_7d_in_currency))}${cell('30 Tage', pct(c.price_change_percentage_30d_in_currency))}
      ${cell('200 Tage', pct(c.price_change_percentage_200d_in_currency))}${cell('1 Jahr', pct(c.price_change_percentage_1y_in_currency))}
      ${cell('Allzeithoch', money(c.ath))}${cell('Abstand zum Allzeithoch', pct(c.ath_change_percentage))}
      ${cell('Umlaufmenge', coins(c.circulating_supply))}${cell('Maximale Menge', isNum(c.max_supply) ? coins(c.max_supply) : 'unbegrenzt')}
    </div></section>`;
  }

  function update() {
    const c = state.byId.get(id);
    if (!c) {
      $('#d-head').innerHTML = `<section class="panel"><p class="muted">${state.pagesLoaded >= api.PAGES
        ? 'Dieser Coin gehört aktuell nicht zu den Top 1000.' : 'Lade Kurse …'}</p></section>`;
      return;
    }
    d.data = state.daily.get(id) ?? null;
    d.ind = d.data ? c.ind : null;
    d.source = d.data?.source ?? null;
    d.news = state.news.get(id) ?? null;
    if (!d.started) {
      d.started = true;
      loadData(c);
      if (!c.analysis.stable && !d.news) loadNews(c);
      chart();
    } else if (d.range === '7T' || d.range === '1T') chart();
    const a = c.analysis;
    head(c, a);
    // Kompass nur neu zeichnen, wenn sich der Kauf-Score ändert – sonst klappt die Aufschlüsselung bei jedem Kurs-Update zu
    const ck = `${state.market?.value}|${a.signal}`;
    if (d.compassKey !== ck) { d.compassKey = ck; $('#d-compass').innerHTML = coinCompass(c); }
    // Rang erst neu rechnen, wenn alle Coins geladen sind – sonst zählt er nur die ersten 150
    const ak = `${state.pagesLoaded >= api.PAGES}|${a.score}|${access().plan}`;
    if (d.autoKey !== ak) { d.autoKey = ak; coinAutopilot(c, $('#d-auto')); }
    forecast(c, a); news(a); stats(c);
  }

  return self;
}

// ---------- Portfolio: Speicherung und Konto ----------

// Das Portfolio liegt immer im Browser und, wenn angemeldet, zusätzlich im Konto
const depot = { data: pf.load(), user: null, ready: !auth.available, sync: 'local', error: null, stop: null };
// Merkzeichen „auf diesem Gerät angemeldet“: Ohne es zeigt die Seite Gästen sofort die Vorschau, statt auf Firebase zu warten
const LOGIN_HINT = 'coinwetter-konto';
const maybeSignedIn = () => { try { return localStorage.getItem(LOGIN_HINT) === '1'; } catch { return true; } };

// Coin zu einer Position: nach ID, sonst nach Kürzel oder Name
const coinOf = (pos) => (pos.id && state.byId.get(pos.id))
  || state.bySymbol.get((pos.symbol || pos.name || '').toLowerCase())
  || state.byName.get((pos.name || pos.symbol || '').toLowerCase())
  || state.bySymbol.get((pos.name || '').toLowerCase());

// Wert eines Portfolios zu den aktuellen Kursen; Positionen ohne Kurs zählen nicht mit
const depotValue = (data) => data.cash + data.positions.reduce((sum, pos) => {
  const c = coinOf(pos);
  return sum + (c && isNum(c.current_price) ? pos.amount * c.current_price : 0);
}, 0);

// internal: Kauf, Verkauf oder Tausch innerhalb des Portfolios – kein Geld von außen. note: Eintrag für den Verlauf.
function saveDepot(data, { internal = false, note = null } = {}) {
  const before = depot.data;
  const next = pf.normalise(data);
  // Ändert ein Kauf oder Verkauf das Bargeld, wird der eingetragene Betrag in seiner Währung mitgeführt
  const fixRate = next.cashFix && i18n.rateOf(next.cashFix.currency);
  if (next.cashFix && next.cash !== before.cash && data.cashFix === before.cashFix) {
    next.cashFix = fixRate > 0 ? { ...next.cashFix, amount: Math.round(next.cash * fixRate * 100) / 100 } : null;
  }
  // Geänderten Bestand für die Wertentwicklung festhalten – nur wenn Kurse da sind, sonst wäre der Wert falsch
  if (state.coins.length) {
    const held = { cash: next.cash, positions: next.positions.map((pos) => ({ id: pos.id ?? coinOf(pos)?.id ?? null, amount: pos.amount })) };
    next.track = tr.record(next.track, held, { valueBefore: depotValue(before), valueAfter: depotValue(next), internal });
  }
  if (note) next.log = tr.addLog(next.log, note);
  depot.data = next;
  pf.save(depot.data);
  if (depot.user) {
    depot.sync = 'saving';
    auth.savePortfolio(depot.user.uid, depot.data).then(
      () => { depot.sync = 'synced'; depot.error = null; },
      (err) => { depot.sync = 'error'; depot.error = err.message; },
    ).finally(() => current?.update());
  }
  current?.update();
}

// ---------- Abo und Zustimmung ----------

// Welches Paket gilt? Ohne Bezahlschranke alles; sonst nach dem Abo des Kontos. Ohne Abo gibt es keine Inhalte.
const abo = { sub: null, stop: null, loaded: false };
function access() {
  if (!SITE.paywall) return { plan: 'full', reason: 'open' };
  if (!depot.user) return { plan: null, reason: 'guest' };
  if (depot.owner) return { plan: 'full', reason: 'owner' };
  const s = abo.sub;
  if (s && ['active', 'trialing'].includes(s.status) && (!s.until || s.until > Date.now())) return { plan: s.plan, reason: 'paid', until: s.until, cancel: s.cancel };
  // Kostenlose Testphase ab dem Erstellen des Kontos: alle Funktionen, danach endet der Zugang von selbst
  const trialEnd = SITE.trialDays > 0 && depot.user.created ? depot.user.created + SITE.trialDays * 86_400_000 : null;
  if (trialEnd) return trialEnd > Date.now() ? { plan: 'full', reason: 'trial', until: trialEnd } : { plan: null, reason: 'expired', until: trialEnd };
  return { plan: null, reason: 'none' };
}
const fullAccess = () => access().plan === 'full';
// Portfolio und Daytrading gehören zum größeren Paket
const lockedView = (kind) => { view.innerHTML = site.upsell(kind); return { update() {} }; };
const waitView = () => { view.innerHTML = '<section class="panel"><p class="muted">Anmeldung wird geprüft …</p></section>'; return { update() {} }; };

// Nach dem ersten Anmelden und nach geänderten Rechtstexten: Zustimmung zu AGB und Risikohinweis einholen und festhalten
let consentOpen = false;
async function askConsent() {
  if (consentOpen || !depot.user || depot.data.consent?.v === SITE.legalVersion) return;
  consentOpen = true;
  const uid = depot.user.uid;
  const agreed = await decide(site.consentHtml(), 'Ich stimme zu', 'Abmelden');
  consentOpen = false;
  if (depot.user?.uid !== uid) return;
  if (agreed) saveDepot({ ...depot.data, consent: { v: SITE.legalVersion, t: Date.now() } }, { internal: true });
  else auth.logout().catch(() => {});
}

// Daytrading zeigt Hebel – vor dem ersten Besuch wird der Risikohinweis bestätigt (gilt je Gerät)
const TRADING_ACK = 'coinwetter-risiko-handel';
let tradingAsked = false;
function tradingAck() {
  try { if (localStorage.getItem(TRADING_ACK) === SITE.legalVersion) return; } catch { /* dann wird jedes Mal gefragt */ }
  if (tradingAsked) return;
  tradingAsked = true;
  decide(site.tradingRiskHtml(), 'Verstanden', 'Zurück zum Markt').then((ok) => {
    tradingAsked = false;
    if (!ok) { location.hash = '#/'; return; }
    try { localStorage.setItem(TRADING_ACK, SITE.legalVersion); } catch { /* nicht speicherbar */ }
  });
}

// Sprache oder Währung geändert: speichern – angemeldet auch im Konto – und die Seite neu aufbauen
document.addEventListener('change', async (e) => {
  const key = e.target.dataset?.pref;
  if (!key) return;
  i18n.savePrefs({ [key]: e.target.value });
  if (depot.user) {
    depot.data = { ...depot.data, prefs: { ...i18n.prefs } };
    pf.save(depot.data);
    try { await auth.savePortfolio(depot.user.uid, depot.data); } catch { /* dann gilt die Wahl nur auf diesem Gerät */ }
  }
  location.reload();
});
const prefsPanel = () => `<section class="panel"><div class="label">Einstellungen</div>
    <div class="prefs">${i18n.prefsControls()}</div>
    <p class="hint">Beträge werden aus US-Dollar zum aktuellen Wechselkurs umgerechnet. Eingaben machst du in der gewählten Währung.</p></section>`;

// ---------- Nutzung für die Betreiber-Übersicht ----------
// Mit Konto wird festgehalten, wann und wie oft jemand die Seite nutzt, welche Bereiche und Coins er aufruft und die letzten
// 20 Seiten. Gesammelt wird im Browser und alle paar Sekunden gebündelt gespeichert (users/{uid}, siehe firestore.rules).
const usage = { uid: null, counts: null, recent: [], dirty: false, timer: null, first: null };

// Herkunft aus Werbe-Links wie coinweather.github.io/?von=reddit: Der erste Kanal zählt. Danach verschwindet der Zusatz
// aus der Adresse, damit er beim Weitergeben des Links nicht mitwandert.
const REF_KEY = 'coinwetter-von';
const referrer = (() => {
  let ref = null;
  try {
    const von = new URLSearchParams(location.search).get('von')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    ref = localStorage.getItem(REF_KEY);
    if (von && !ref) { ref = von; localStorage.setItem(REF_KEY, von); }
    if (von) history.replaceState(null, '', location.pathname + location.hash);
  } catch { /* ohne Speicher keine Herkunft */ }
  return ref;
})();
const USAGE_FLUSH_MS = 8000, USAGE_BEAT_MS = 120_000;

async function usageStart(user) {
  if (usage.uid) await usageFlush();
  usage.uid = user?.uid ?? null;
  usage.counts = { visits: 1, pages: {}, coins: {} };
  usage.recent = []; usage.first = null; usage.dirty = !!user; usage.sourceSaved = false;
  if (!user) return;
  try {
    const old = await auth.loadUsage(user.uid);
    if (usage.uid !== user.uid) return;
    usage.recent = [...usage.recent, ...(Array.isArray(old?.recent) ? old.recent : [])].slice(0, 20);
    usage.first = old?.firstSeen ?? null;
    if (old?.source) usage.sourceSaved = true;   // der erste Kanal bleibt
  }
  catch { /* ohne Leserecht beginnt die Liste neu */ }
  // Die aufgerufene Seite zählt route(), das nach jedem An- und Abmelden läuft
}

function usagePage(name, id) {
  if (!usage.uid || name === 'admin') return;
  const page = name === 'coin' ? 'coin' : name;
  let coin = null;
  if (name === 'coin' && id) { try { coin = decodeURIComponent(id); } catch { coin = id; } }
  const p = coin ? `coin/${coin}` : page;
  // Dieselbe Seite kurz hintereinander (Neuaufbau nach dem Anmelden) zählt einmal
  if (usage.recent[0]?.p === p && Date.now() - usage.recent[0].t < 5000) return;
  usage.recent = [{ t: Date.now(), p }, ...usage.recent].slice(0, 20);
  usage.counts.pages[page] = (usage.counts.pages[page] ?? 0) + 1;
  if (coin) usage.counts.coins[coin] = (usage.counts.coins[coin] ?? 0) + 1;
  usage.dirty = true;
  clearTimeout(usage.timer);
  usage.timer = setTimeout(usageFlush, USAGE_FLUSH_MS);
}

async function usageFlush() {
  clearTimeout(usage.timer);
  const user = depot.user;
  if (!usage.uid || !user || user.uid !== usage.uid) return;
  const counts = usage.counts;
  usage.counts = { visits: 0, pages: {}, coins: {} };
  usage.dirty = false;
  const a = access();
  const base = { email: user.email ?? null, name: user.name ?? null, provider: user.provider ?? null, created: user.created ?? null,
    firstSeen: usage.first ?? Date.now(), lastSeen: Date.now(), lastPage: usage.recent[0]?.p ?? null, recent: usage.recent,
    lang: i18n.prefs.lang, currency: i18n.prefs.currency, device: matchMedia('(max-width: 760px)').matches ? 'Handy' : 'Computer',
    access: a.reason, accessUntil: a.until ?? null };
  if (referrer && !usage.sourceSaved) { base.source = referrer; usage.sourceSaved = true; }
  usage.first ??= base.firstSeen;
  try { await auth.saveUsage(usage.uid, base, counts); }
  catch { /* z. B. Regeln noch nicht veröffentlicht – die Statistik ist für die Seite nicht nötig */ }
}

// Solange die Seite offen und sichtbar ist, alle zwei Minuten „zuletzt aktiv“ auffrischen; beim Verlassen sofort speichern
setInterval(() => { if (usage.uid && document.visibilityState === 'visible') usageFlush(); }, USAGE_BEAT_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && usage.dirty) usageFlush(); });

function renderAccountLink() {
  const link = $('#nav-account');
  link.textContent = depot.user ? (depot.user.name || depot.user.email || 'Konto') : 'Anmelden';
  link.classList.toggle('signed-in', !!depot.user);
  $('#nav-admin').hidden = !depot.owner;
}

auth.onUser(async (user) => {
  depot.stop?.();
  depot.stop = null;
  const before = depot.user;
  const owner = await site.isOwner(user).catch(() => false);
  depot.user = user;
  depot.owner = owner;
  depot.ready = true;
  try { if (user) localStorage.setItem(LOGIN_HINT, '1'); else localStorage.removeItem(LOGIN_HINT); } catch { /* dann wird gewartet */ }
  if (user?.uid !== before?.uid) usageStart(user);
  abo.stop?.();
  abo.stop = null; abo.sub = null; abo.loaded = false;
  if (user && SITE.paywall) {
    auth.watchSubscription(user.uid, (sub) => {
      if (depot.user?.uid !== user.uid) return;
      const before = access().plan, first = !abo.loaded;
      abo.sub = sub; abo.loaded = true;
      if (first || access().plan !== before) route(); else current?.update();
    }).then((stop) => { if (depot.user?.uid === user.uid) abo.stop = stop; else stop(); }, () => {});
  }
  if (user) {
    depot.sync = 'saving';
    let first = true;
    try {
      depot.stop = await auth.watchPortfolio(user.uid, (cloud, pending) => {
        if (cloud) {
          // Eigene, noch nicht bestätigte Änderungen sind lokal schon da
          if (!pending) {
            depot.data = pf.normalise(cloud); pf.save(depot.data);
            // Sprache und Währung aus dem Konto gelten auf jedem Gerät
            const p = depot.data.prefs;
            if (p && (p.lang !== i18n.prefs.lang || p.currency !== i18n.prefs.currency)) { i18n.savePrefs(p); location.reload(); return; }
          }
          depot.sync = 'synced';
          askConsent();   // auch bei noch unbestätigtem Speichern: Der Stand der Zustimmung liegt dann schon lokal vor
        } else if (first) saveDepot(depot.data);   // erstes Anmelden: Portfolio aus dem Browser ins Konto übernehmen
        first = false;
        current?.update();
      }, (err) => { depot.sync = 'error'; depot.error = err.message; current?.update(); });
    } catch (err) { depot.sync = 'error'; depot.error = err.message; }
  } else {
    // Nach dem Abmelden bleibt nichts auf dem Gerät zurück; die Daten liegen im Konto
    if (before) { depot.data = pf.empty(); pf.save(depot.data); }
    depot.sync = 'local';
  }
  renderAccountLink();
  // Das Portfolio gibt es nur angemeldet – nach An- oder Abmelden die Ansicht neu wählen
  // … und mit Bezahlschranke hängt jede Ansicht davon ab, wer angemeldet ist
  // Gäste sehen die Vorschau schon vor der Prüfung – bleibt es beim Gast, nicht neu aufbauen (sonst springt die Seite nach oben)
  if ((SITE.paywall && routedFor !== (depot.user?.uid ?? 'guest')) || /^#\/(portfolio|konto|preise)/.test(location.hash)) route(); else current?.update();
});

const SYNC_TEXT = {
  local: 'Dein Portfolio ist nur in diesem Browser gespeichert. Mit einem Konto kannst du es von überall abrufen.',
  saving: 'Wird mit deinem Konto abgeglichen …',
  synced: 'In deinem Konto gespeichert – auf jedem Gerät abrufbar, auf dem du dich anmeldest.',
};

// ---------- Daytrading ----------

const TRADING_KEY = 'krypto-markt-handel';
// Zahl für ein Eingabefeld: in der gewählten Schreibweise, ohne Tausendertrennung
const inputText = (v) => v.toLocaleString(settings.locale, { useGrouping: false, maximumFractionDigits: 2 });
// Größter sinnvoller Hebel: Die Zwangsauflösung (rund 90 % / Hebel unter dem Einstieg) soll mindestens doppelt so weit
// entfernt liegen wie der Stopp. Mehr als 3-fach wird nie vorgeschlagen – ab 5-fach häuften sich in der Rückrechnung
// die Liquidationen.
const maxLeverage = (stopPct) => Math.max(1, Math.min(3, Math.floor(90 / (2 * stopPct))));

function tradingView() {
  let sizing = { account: null, risk: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(TRADING_KEY));
    if (saved?.account > 0) sizing.account = saved.account;
    if (saved?.risk > 0) sizing.risk = Math.min(saved.risk, 5);
  } catch { /* Voreinstellung */ }
  view.innerHTML = `
    <div class="page-head"><div><h1>Daytrading</h1>
      <p class="hint">Vorschläge mit Einstieg, Ziel, Stopp und Hebel – nur wenn ein geprüftes Muster vorliegt. An vielen Tagen bleibt die Liste leer.</p></div>
      <div class="actions">${infoBtn('setups', 'So entstehen die Vorschläge')}</div></div>
    <section class="panel">
      <div class="head-row"><div class="label">Einsatz berechnen</div>${infoBtn('sizing', 'Einsatz und Hebel')}</div>
      <form id="t-sizing" class="sizing">
        <label>Kontogröße (${currencyCode()})<input id="t-account" inputmode="decimal" placeholder="zum Beispiel 5000" value="${sizing.account ? inputText(toDisplay(sizing.account)) : ''}"></label>
        <label>Risiko je Handel (% des Kontos)<input id="t-risk" inputmode="decimal" value="${inputText(sizing.risk)}"></label>
      </form>
      <p class="notice" id="t-risk-note" hidden>Gerechnet wird mit höchstens 5 % Risiko je Handel.</p>
    </section>
    <section id="t-long"></section>
    <section id="t-short"></section>
    <section id="t-watch"></section>
    <section class="panel" id="t-rules"></section>`;

  $('#t-sizing').addEventListener('input', () => {
    const account = pf.parseInput($('#t-account').value), risk = pf.parseInput($('#t-risk').value);
    // Mehr als 5 % Risiko je Handel rechnet die Seite nicht – das wäre nach wenigen Verlusten in Folge das halbe Konto
    sizing = { account: account > 0 ? fromDisplay(account) : null, risk: risk > 0 ? Math.min(risk, 5) : 1 };
    $('#t-risk-note').hidden = !(risk > 5);
    try { localStorage.setItem(TRADING_KEY, JSON.stringify(sizing)); } catch { /* ohne Speicher gilt die Eingabe bis zum Neuladen */ }
    update();
  });
  $('#t-sizing').addEventListener('submit', (e) => e.preventDefault());

  const coinCell = (c) => `<a class="coin-cell" href="#/coin/${encodeURIComponent(c.id)}"><img src="${esc(c.image)}" alt="" loading="lazy">
      <div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol)} · #${c.market_cap_rank ?? '–'}</div></div></a>`;
  const liquid = (c) => c.total_volume >= 2e6 && !DERIVATIVE.test(c.name);

  // Wo steht der Kurs gegenüber dem Vorschlag? Zu weit gelaufen oder unter dem Stopp gilt er nicht mehr.
  function status(c, t) {
    const p = c.current_price, done = (p - t.entry) / (t.target - t.entry);
    if (p <= t.stop) return ['down', 'Stopp erreicht – nicht mehr einsteigen'];
    if (p >= t.target) return ['up', 'Ziel erreicht – Gewinn mitnehmen'];
    if (done > 0.35) return ['', 'schon gelaufen – nicht mehr nachkaufen'];
    return ['up', 'Einstieg jetzt möglich'];
  }

  // Positionsgröße aus Risiko und Stopp; mit Hebel sinkt nur die hinterlegte Sicherheit
  function sizeText(t, lev) {
    const share = sizing.risk / t.stopPct;                 // Position als Anteil des Kontos
    const capped = Math.min(share, lev);                   // mehr als Konto × Hebel geht nicht
    const riskPct = capped * t.stopPct, gainPct = capped * t.targetPct;
    if (!sizing.account) {
      return `Bei ${num(sizing.risk, 1)} % Risiko: Position rund <strong>${num(capped * 100, 0)} % des Kontos</strong>
        (Verlust am Stopp ${num(riskPct, 1)} %, Gewinn am Ziel ${num(gainPct, 1)} % des Kontos). Trage oben deine Kontogröße ein, dann stehen hier Beträge.`;
    }
    const pos = sizing.account * capped;
    return `Position rund <strong>${money(pos)}</strong> (${num(capped * 100, 0)} % des Kontos) · Verlust am Stopp rund ${money(sizing.account * riskPct / 100)} ·
      Gewinn am Ziel rund ${money(sizing.account * gainPct / 100)}${lev > 1 ? ` · mit ${lev}-fachem Hebel hinterlegst du ${money(pos / lev)} als Sicherheit` : ''}.`;
  }

  function update() {
    const list = state.coins.filter((c) => c.analysis.trade?.kind && liquid(c))
      .sort((a, b) => (a.analysis.trade.kind === b.analysis.trade.kind ? (b.analysis.trendScore ?? b.analysis.score) - (a.analysis.trendScore ?? a.analysis.score) : a.analysis.trade.kind === 'selloff' ? -1 : 1));
    const regime = state.market?.regime;
    const why = !state.coins.length ? 'Lade Kurse …'
      : regime?.bear ? 'Im Bärenmarkt entfallen beide Muster: Ausverkäufe gingen dort öfter weiter, und der Score erreicht die Schwelle nicht.'
        : greedZone(regime) ? 'Die Gier-Bremse ist aktiv (Fear & Greed im 7-Tage-Schnitt über 75) – der Trend-Score der Altcoins ist gedeckelt und erreicht die Schwelle nicht.'
          : 'Kein Coin erfüllt im Moment eines der beiden geprüften Muster. Lieber kein Handel als ein unbegründeter.';
    $('#t-long').innerHTML = '<h2>Long – auf steigende Kurse</h2>' + (list.length ? `<div class="trades">${list.map((c) => {
      const t = c.analysis.trade, s = TRADE_SETUPS[t.kind], [cls, text] = status(c, t), lev = maxLeverage(t.stopPct);
      const until = new Date(t.time + t.days * 86_400_000).toLocaleDateString(settings.locale, { weekday: 'short', day: 'numeric', month: 'short' });
      return `<div class="panel trade">
        <div class="panel-top">${coinCell(c)}<span class="badge buy">Long</span></div>
        <div class="trade-why">${esc(s.label)}${t.kind === 'selloff' ? ` · ${signed(t.r7, 0)} % in 7 Tagen, zusammen mit dem Markt` : ` · Trend-Score ${signed(c.analysis.trendScore ?? c.analysis.score, 0)}`}</div>
        <dl class="trade-grid">
          <div><dt>Einstieg</dt><dd>${money(t.entry)}</dd><dd class="muted">jetzt ${money(c.current_price)}</dd></div>
          <div><dt>Ziel – verkaufen bei</dt><dd class="up">${money(t.target)}</dd><dd class="muted">+${num(t.targetPct, 1)} %</dd></div>
          <div><dt>Stopp – aussteigen bei</dt><dd class="down">${money(t.stop)}</dd><dd class="muted">−${num(t.stopPct, 1)} %</dd></div>
          <div><dt>Spätestens verkaufen</dt><dd>${until}</dd><dd class="muted">nach ${t.days} Tagen, egal wo der Kurs steht</dd></div></dl>
        <p class="trade-status ${cls}">${text}</p>
        <p class="trade-lev"><strong>Hebel: ${lev === 1 ? 'keiner (1×)' : `höchstens ${lev}×`}</strong>
          <span class="muted">${lev === 1 ? 'Der Stopp liegt so weit entfernt, dass ein Hebel die Zwangsauflösung zu nahe brächte.'
            : `Dann läge die Zwangsauflösung bei etwa −${num(90 / lev, 0)} %, mindestens doppelt so weit weg wie der Stopp. Ohne Hebel bleibt die sichere Wahl.`}</span></p>
        <p class="trade-size">${sizeText(t, lev)}</p>
        <p class="hint">Rückblick: ${s.hit} % der Handel im Plus, im Mittel ${signed(s.avg, 1)} % nach Gebühren. ${esc(s.caveat)}</p>
      </div>`; }).join('')}</div>`
      : `<div class="panel"><p><strong>Heute kein Long-Vorschlag.</strong></p><p class="muted">${why}</p></div>`);

    $('#t-short').innerHTML = `<h2>Short – auf fallende Kurse</h2><div class="panel"><p><strong>Kein Short-Vorschlag.</strong>
      Über 20 Short-Muster geprüft – keines lag in allen vier Zeitabschnitten seit 2018 im Plus.</p>${infoBtn('short', 'Geprüfte Muster und Ergebnisse')}</div>`;

    // Beobachtungsliste: was einem Muster am nächsten kommt oder knapp an einer Bedingung scheitert
    const near = state.coins.filter((c) => c.analysis.trade && !c.analysis.trade.kind && liquid(c)).map((c) => {
      const t = c.analysis.trade;
      const blocked = t.blocked === 'alone' ? { gap: 0.05, text: `${signed(t.r7, 0)} % in 7 Tagen, aber der Markt fiel nicht mit – fällt ein Coin allein, gab es keinen Vorteil` }
        : t.blocked === 'fear' ? { gap: 0.05, text: `${signed(t.r7, 0)} % in 7 Tagen, aber der Markt steht in der Angstzone – dort ging es nach Ausverkäufen öfter weiter abwärts` } : null;
      const drop = !blocked && t.r7 !== null && t.r7 <= -15 ? { gap: (TRADE_LIMITS.selloff - t.r7) / -10, text: `${signed(t.r7, 0)} % in 7 Tagen – Muster ab ${TRADE_LIMITS.selloff} %` } : null;
      const ts = c.analysis.trendScore ?? c.analysis.score;
      const strong = ts >= 28 ? { gap: (TRADE_LIMITS.score - ts) / 12, text: `Trend-Score ${signed(ts, 0)} – Muster ab +${TRADE_LIMITS.score}` } : null;
      const best = [blocked, drop, strong].filter(Boolean).sort((x, y) => x.gap - y.gap)[0];
      return best ? { c, ...best } : null;
    }).filter(Boolean).sort((x, y) => x.gap - y.gap).slice(0, 8);
    $('#t-watch').innerHTML = '<h2>Beobachtungsliste</h2><p class="hint">Noch kein Signal – diese Coins sind einem Muster am nächsten.</p>' + (near.length
      ? `<div class="table-wrap"><table><thead><tr><th class="col-coin">Coin</th><th class="num">Kurs</th><th class="num">24 h</th><th>Stand</th></tr></thead>
          <tbody>${near.map(({ c, text }) => `<tr><td class="col-coin">${coinCell(c)}</td><td class="num">${money(c.current_price)}</td>
            <td class="num">${pct(c.price_change_percentage_24h_in_currency)}</td><td>${esc(text)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel"><p class="muted">Im Moment ist kein Coin in der Nähe eines Musters.</p></div>');

    $('#t-rules').innerHTML = `<p class="notice">Sicher ist kein Handel. Auch beim besten Muster endete etwa jeder sechste Handel im Minus, beim zweiten fast jeder zweite –
      und weil der Stopp weit entfernt liegt, ist ein einzelner Verlust groß. Mit Hebel kann die hinterlegte Sicherheit vollständig verloren gehen. Keine Anlageberatung.</p>`;
  }
  return { update };
}

// gate: Die Ansicht steht anstelle des Portfolios, solange niemand angemeldet ist
function accountView(gate = false) {
  let shown = null, message = '', busy = false;
  const key = () => (!depot.ready ? 'wait' : depot.user?.uid ?? (auth.available ? 'out' : 'off'));
  const BENEFITS = `<ul class="benefits">
      <li><div><strong>Dein Portfolio, überall</strong><span>Im Konto gespeichert und auf jedem Gerät abrufbar.</span></div></li>
      <li><div><strong>Autopilot</strong><span>Betrag eingeben – er sagt dir, was du kaufst, und zeigt jede Woche, ob etwas zu tun ist. Live mitgemessen.</span></div></li>
      <li><div><strong>Modell-Schritte für deinen Bestand</strong><span>Der Portfolio-Manager rechnet nach festen, geprüften Regeln aus, was das Modell für deinen Bestand vorsieht – mit Begründung, Gebühr und Zeitrahmen. Die Entscheidung triffst du.</span></div></li>
      <li><div><strong>Warnung bei fallenden Kursen</strong><span>Verkaufssignal, sobald ein Coin deutlich unter sein Hoch fällt oder der Markt dreht.</span></div></li>
      <li><div><strong>Wertentwicklung im Blick</strong><span>Diagramm deines Portfolios mit Gewinn, Einzahlungen und Vergleich zu Bitcoin.</span></div></li>
    </ul>`;

  function render() {
    shown = key();
    if (shown === 'wait') {
      view.innerHTML = '<section class="panel"><p class="muted">Anmeldung wird geprüft …</p></section>';
      return;
    }
    if (!auth.available) {
      view.innerHTML = `<h2>${gate ? 'Portfolio' : 'Konto'}</h2><section class="panel">
        <p>${gate ? 'Für das Portfolio brauchst du ein Konto – ' : ''}Konten sind auf dieser Seite noch nicht eingerichtet.</p>
        <p class="hint">Für Betreiber: Firebase-Projekt anlegen und die Zugangsdaten in <code>js/firebase-config.js</code> eintragen – die Schritte stehen in der README.</p>
      </section>`;
      return;
    }
    if (depot.user) {
      const a = access(), until = a.until ? new Date(a.until).toLocaleDateString(settings.locale) : null;
      const planText = a.reason === 'open' ? 'Die Bezahlschranke ist ausgeschaltet – alle Funktionen sind offen.'
        : a.reason === 'owner' ? 'Betreiber-Zugang – alle Funktionen sind freigeschaltet.'
        : a.reason === 'paid' ? `Paket ${SITE.plans[a.plan].name} ist aktiv${until ? ` bis ${until}` : ''}${a.cancel ? ' und verlängert sich nicht mehr' : ''}.`
        : a.reason === 'trial' ? `Kostenlose Testphase bis ${until}: Alle Funktionen sind freigeschaltet. Danach endet der Zugang von selbst – es entstehen keine Kosten.`
        : a.reason === 'expired' ? `Deine kostenlose Testphase ist am ${until} abgelaufen.`
        : 'Für dein Konto läuft kein Abo.';
      view.innerHTML = `<h2>Konto</h2><section class="panel">
        <p>Angemeldet als <strong>${esc(depot.user.email ?? depot.user.name ?? '')}</strong></p>
        <p class="hint" id="a-sync"></p>
        <p><a class="btn" href="#/">Zum Markt</a> ${depot.owner ? '<a class="btn ghost" href="#/admin">Nutzerübersicht</a> ' : ''}<button class="btn ghost" id="a-logout">Abmelden</button></p>
        <p id="a-msg" class="notice" hidden></p>
      </section>
      <section class="panel"><div class="label">Abo</div><p>${planText}</p>
        <p><a class="btn ghost" href="#/preise">Pakete und Preise</a>${a.reason === 'paid' && SITE.manageUrl ? ` <a class="btn ghost" href="${esc(SITE.manageUrl)}" target="_blank" rel="noopener">Abo verwalten</a>` : ''}</p></section>
      ${prefsPanel()}
      <section class="panel"><div class="label">Deine Daten</div>
        <p class="hint">Dein Portfolio kannst du auf der Portfolio-Seite als Tabelle exportieren. Löschst du dein Konto, werden Portfolio und Anmeldung endgültig entfernt.${a.reason === 'paid' ? ' Ein laufendes Abo kündigst du bitte vorher.' : ''}</p>
        <p class="hint">Konto-Kennung: <code>${esc(depot.user.uid)}</code></p>
        <p><button class="link danger" id="a-delete" type="button">Konto und Daten löschen</button></p></section>`;
      $('#a-logout').addEventListener('click', () => act(() => auth.logout()));
      $('#a-delete').addEventListener('click', () => {
        if (!confirm('Konto wirklich löschen? Portfolio, Wertentwicklung und Anmeldung werden endgültig entfernt.')) return;
        act(() => auth.deleteAccount(depot.user.uid));
      });
      return;
    }
    const form = `<section class="panel account">
        <h2>Anmelden oder Konto erstellen</h2>
        <button class="btn google" id="a-google" type="button">Mit Google anmelden</button>
        <div class="or"><span>oder mit E-Mail-Adresse</span></div>
        <form id="a-form" class="form">
          <label>E-Mail-Adresse <input id="a-email" type="email" autocomplete="email" required></label>
          <label>Passwort (mindestens 6 Zeichen) <input id="a-password" type="password" autocomplete="current-password" required minlength="6"></label>
          <div class="btn-row">
            <button class="btn" type="submit" data-action="login">Anmelden</button>
            <button class="btn ghost" type="submit" data-action="register">Konto erstellen</button>
          </div>
          <button class="link" type="button" id="a-reset">Passwort vergessen?</button>
        </form>
        <p class="hint">Mit dem Erstellen eines Kontos akzeptierst du die <a href="#/agb">AGB</a>. Bitte lies vorher den <a href="#/risiko">Risikohinweis</a>
          und die <a href="#/datenschutz">Datenschutzerklärung</a>. ${esc(SITE.name)} ist keine Anlageberatung.</p>
        <p id="a-msg" class="notice" hidden></p>
      </section>`;
    view.innerHTML = `<div class="gate">
        <div>
          <h1>${gate ? 'Melde dich an, um dein Portfolio zu sehen' : `Dein Konto bei ${esc(SITE.name)}`}</h1>
          <p class="lead">${SITE.trialDays > 0 ? `Mit einem neuen Konto testest du ${SITE.trialDays} Tage lang alle Funktionen kostenlos – ohne Zahlungsdaten. ` : 'Für ein Abo brauchst du ein Konto. '}Darin liegen auch dein Portfolio und deine Einstellungen. <a href="#/preise">Pakete und Preise</a></p>
          ${BENEFITS}
        </div>
        ${form}
      </div>
      ${prefsPanel()}`;
    $('#a-google').addEventListener('click', () => act(() => auth.loginGoogle(), true));
    $('#a-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#a-email').value.trim(), password = $('#a-password').value;
      const register = e.submitter?.dataset.action === 'register';
      act(() => (register ? auth.register(email, password) : auth.login(email, password)), true);
    });
    $('#a-reset').addEventListener('click', () => {
      const email = $('#a-email').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { message = 'Bitte gib oben deine E-Mail-Adresse ein und klick dann erneut auf „Passwort vergessen?“.'; return update(); }
      act(async () => { await auth.resetPassword(email); message = `Falls es ein Konto für ${email} gibt, ist eine E-Mail zum Zurücksetzen unterwegs.`; });
    });
  }

  // Führt eine Konto-Aktion aus und zeigt Fehler an; nach erfolgreicher Anmeldung geht es zum Portfolio
  async function act(fn, toPortfolio = false) {
    if (busy) return;
    busy = true; message = '';
    update();
    try {
      await fn();
      if (toPortfolio) {
        const next = nextAfterLogin();
        location.hash = next ?? (gate ? '#/portfolio' : '#/');
      }
    } catch (err) { message = err.message; }
    busy = false;
    if (current === self) update();
  }

  function update() {
    if (key() !== shown) render();
    const msg = $('#a-msg');
    if (msg) { msg.hidden = !message; msg.textContent = message; }
    const sync = $('#a-sync');
    if (sync) sync.textContent = depot.sync === 'error' ? `Speichern fehlgeschlagen: ${depot.error}` : SYNC_TEXT[depot.sync];
    for (const b of view.querySelectorAll('button')) b.disabled = busy;
  }

  const self = { update };
  return self;
}

// Ziel nach der Anmeldung: aus der Adresse (#/konto?next=portfolio/auto) oder vom zuletzt geklickten Knopf mit data-next
const NEXT_KEY = 'coinwetter-weiter';
function nextAfterLogin() {
  const fromHash = new URLSearchParams(location.hash.split('?')[1] ?? '').get('next');
  let stored = null; try { stored = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); } catch { /* ohne Speicher */ }
  const next = fromHash ? `#/${fromHash.replace(/^#?\/?/, '')}` : stored;
  return next && /^#\/[\w/?=&.,@%-]*$/.test(next) ? next : null;
}
document.addEventListener('click', (e) => {
  const next = e.target.closest('[data-next]')?.dataset.next;
  if (next) try { sessionStorage.setItem(NEXT_KEY, next); } catch { /* dann eben zur Startseite */ }
});

// ---------- Autopilot: gemeinsame Teile für Startseite, Menü und Portfolio ----------

// Kürzel aus dem Modell (Binance) → Coin der Seite: unter gleichem Kürzel der mit dem höchsten Marktwert
function modelCoin(sym) {
  const c = state.coins.filter((x) => x.symbol.toUpperCase() === sym && isNum(x.current_price) && (x.market_cap_rank ?? 9999) <= 500)
    .sort((a, b) => (a.market_cap_rank ?? 9999) - (b.market_cap_rank ?? 9999))[0];
  return c ? { id: c.id, name: c.name, symbol: c.symbol, price: c.current_price, image: c.image } : null;
}
// Bestand und Reserve des Modell-Portfolios einer Strategie
const modelProfile = (c, key = 'balanced') => c?.profiles?.[key] ?? (key === 'balanced' && c?.holdings ? c : null);
// Eigener Bestand zu heutigen Kursen; Stablecoins zählen zur Reserve
const depotHoldings = () => depot.data.positions.map((pos) => {
  const c = coinOf(pos);
  return c && isNum(c.current_price) ? { id: c.id, name: c.name, symbol: c.symbol, units: pos.amount, price: c.current_price, stable: !!c.analysis?.stable } : null;
}).filter(Boolean);
// Offene Schritte des Autopiloten: Handel plus fällige Sparrate – für den Hinweis im Menü
function autopilotOpen(curve) {
  if (depot.data.mode !== 'auto' || !fullAccess() || !state.coins.length) return 0;
  const t = modelProfile(curve, depot.data.reserveMode);
  if (!t) return 0;
  const f = followModel({ target: t, coinOf: modelCoin, holdings: depotHoldings(), cash: depot.data.cash });
  const a = depot.data.auto;
  return (f?.moves.length ?? 0) + (a?.monthly && (!a.lastDeposit || a.lastDeposit < monthKey()) ? 1 : 0);
}
// Zahl am Menüpunkt „Portfolio“, solange der Autopilot etwas zu tun hat
let badgeShown = null;
async function navBadge() {
  const n = depot.data.mode === 'auto' && fullAccess() ? autopilotOpen(await loadModelCurve()) : 0;
  if (n === badgeShown) return;
  badgeShown = n;
  const a = document.querySelector('nav a[data-nav="portfolio"]');
  a?.querySelector('.nav-badge')?.remove();
  if (a && n) a.insertAdjacentHTML('beforeend', `<span class="nav-badge" title="${esc(i18n.say('Schritte des Autopiloten'))}">${n}</span>`);
}
setInterval(() => navBadge().catch(() => {}), 60_000);

// Live-Messung des Autopiloten (scripts/snapshot.mjs): das Modell-Portfolio seit dem Start mit echten Kursen, Bitcoin daneben
function autopilotLive(cls = 'hint') {
  const a = state.record?.ap;
  if (!a?.days) return '';
  const since = new Date(a.since * 86_400_000).toLocaleDateString(settings.locale);
  const r = a.nav - 100, b = a.btc - 100;
  return `<p class="${cls} ap-live"><span class="live-dot" aria-hidden="true"></span><strong>Live seit ${since}:</strong> Autopilot <span class="${tone(r)}">${signed(r, 1)} %</span>,
    Bitcoin <span class="${tone(b)}">${signed(b, 1)} %</span> – mit echten Kursen und Gebühren, ohne Rückrechnung.</p>`;
}

// Startseite: Was würde der Autopilot mit einem Betrag kaufen? Für alle sichtbar; die ganze Liste mit Konto
let apAmount = null;
async function autopilotTeaser(el) {
  const c = await loadModelCurve();
  if (!el.isConnected) return;
  const t = modelProfile(c);
  if (!t || !state.coins.length) { el.hidden = true; return; }
  const full = fullAccess(), mine = full && depot.data.mode === 'auto';
  apAmount ??= Math.round(toDisplay(1000) / 100) * 100 || 1000;
  const f = followModel({ target: t, coinOf: modelCoin, holdings: [], cash: fromDisplay(apAmount) });
  if (!f) { el.hidden = true; return; }
  const buys = [...f.moves].sort((a, b) => b.usd - a.usd);
  const shown = full ? buys : buys.slice(0, 1);
  const open = mine ? autopilotOpen(c) : 0;
  el.hidden = false;
  el.innerHTML = `<div class="ap-head"><span class="ap-icon" aria-hidden="true">🤖</span><div>
      <div class="label">Autopilot</div>
      <h2>Sag, wie viel du anlegen willst – der Autopilot sagt dir, was du kaufst.</h2>
      <p class="muted">Nach dem Zyklus-Kompass und den besten Kauf-Scores, mit Reserve in schwachen Phasen. Jede Woche geprüft – du siehst, ob etwas zu tun ist.</p></div></div>
    ${mine ? `<p class="ap-mine"><strong>${open ? `Dein Autopilot: ${open} ${open === 1 ? 'Schritt' : 'Schritte'} zu tun` : 'Dein Autopilot: alles erledigt'}</strong> <a class="btn small" href="#/portfolio">Zum Portfolio</a></p>` : ''}
    <form class="ap-form" id="ap-form"><label>Betrag <span translate="no">(${currencyCode()})</span><input id="ap-amount" inputmode="decimal" value="${esc(inputText(apAmount))}" autocomplete="off"></label>
      <button class="btn ghost" type="submit">Zeigen</button></form>
    <ul class="ap-list">
      ${shown.map((m) => `<li><span><strong>${esc(m.name)}</strong> <span class="muted">≈ ${m.units.toLocaleString(settings.locale, { maximumSignificantDigits: 3 })} ${esc(m.symbol.toUpperCase())}</span></span><strong>${money(m.usd)}</strong></li>`).join('')}
      ${full ? '' : buys.length > 1 ? `<li class="ap-locked"><span>🔒 ${buys.length - 1} weitere Coins</span><span class="muted">mit kostenlosem Konto</span></li>` : ''}
      <li class="ap-reserve"><span>Reserve (Bargeld oder Stablecoins)</span><strong>${money(f.reserve * f.reserveShare)}</strong></li></ul>
    <div class="btn-row">${full ? `<a class="btn" href="#/portfolio/auto?b=${Math.round(fromDisplay(apAmount) * 100) / 100}&m=once">Mit diesem Betrag starten</a>`
      : `<a class="btn" href="${depot.user ? '#/preise' : '#/konto'}" data-next="#/portfolio/auto?b=${Math.round(fromDisplay(apAmount) * 100) / 100}&m=once">${depot.user ? 'Pakete ansehen' : 'Kostenlos starten – 30 Tage alle Funktionen'}</a>`}
      <a class="btn ghost" href="#/rechner">So wäre es gelaufen</a></div>
    <p class="share-row hint">${shareLinks(`${location.origin}${i18n.prefs.lang === 'en' ? '' : `/${i18n.prefs.lang}`}/crypto-portfolio-autopilot/?von=${refTag('share-ap')}`,
      i18n.say('Sag, wie viel du anlegen willst – der Autopilot sagt dir, was du kaufst.'), 'Teilen')}</p>
    <p class="ap-challenge"><span>🏁 <strong>Glaubst du, du bist besser?</strong> Wähle drei Coins und tritt gegen den Autopiloten an.</span>
      <a class="btn ghost small" href="#/challenge">Schlag den Autopiloten</a></p>
    ${autopilotLive()}
    <p class="hint">Rückrechnung seit 2018: +${RESERVE_BACKTEST.balanced.perYear} % pro Jahr, größter Rückgang −${RESERVE_BACKTEST.balanced.drawdown} % (Bitcoin halten: +${HOLD_BACKTEST.perYear} %, −${HOLD_BACKTEST.drawdown} %).
      Die Zukunft fällt meist schlechter aus. Keine Anlageberatung – ausführen tust du selbst bei deiner Börse.</p>`;
  el.querySelector('#ap-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = pf.parseInput(el.querySelector('#ap-amount').value);
    if (v > 0) { apAmount = v; autopilotTeaser(el); }
  });
}

// ---------- Portfolio ----------

const ALLOC_COLORS = ['var(--accent)', 'var(--violet)', 'var(--up)', '#38bdf8', 'var(--hold)', '#f472b6'];
const MOVE_LABEL = { sell: 'Verkaufen', profit: 'Gewinn mitnehmen', reduce: 'Reduzieren', swap: 'Tauschen', buy: 'Kaufen', add: 'Nachkaufen' };
const dateText = (d) => d.toLocaleDateString(settings.locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

// Zuletzt berechnete Vorschläge. Sie bleiben stehen, bis sich das Portfolio ändert oder neu berechnet wird –
// laufende Kursänderungen verschieben sie nicht.
let advice = null;
const ADVICE_STALE_MS = 30 * 60_000;

const PERF_RANGES = { '30T': 30, '90T': 90, '1J': 365, 'Seit Beginn': null };
// Autopilot: Monat als „2026-10“ und die Sparrate in US-Dollar zum heutigen Wechselkurs
const NOTIFY_KEY = 'coinwetter-autopilot-melden';
const notifyOn = () => { try { return localStorage.getItem(NOTIFY_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; } };
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthlyUsd = (m) => (m ? m.amount / (i18n.rateOf(m.currency) || 1) : 0);

function portfolioView(arg = '') {
  let message = '';
  let perfRange = '90T';
  let trackStarted = false;
  let imp = null;          // Import: eingelesene Tabelle und Spaltenzuordnung
  let recalc = false;
  // Aus dem Rechner: #/portfolio/auto?b=1000&m=once – der Autopilot startet mit diesen Beträgen
  const pre = new URLSearchParams((arg ?? '').split('?')[1] ?? '');
  const preset = (arg ?? '').startsWith('auto') ? { amount: Number(pre.get('b')) || null, monthly: pre.get('m') === 'plan' } : null;
  view.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Mein Portfolio</h1><p class="hint" id="p-where"></p></div>
      <div class="actions">
        <button class="btn" id="p-open-add" data-for="manual">+ Position</button>
        <button class="btn ghost" id="p-open-import" data-for="manual">Importieren</button>
        <button class="btn" id="p-open-money" data-for="auto">Einzahlen / Auszahlen</button>
        <button class="btn ghost" id="p-open-reserve">Strategie: <b id="r-chip"></b></button>
      </div>
    </div>
    <div class="mode-switch" id="p-mode" role="group" aria-label="Wie wird das Portfolio gepflegt?" hidden>
      <button type="button" data-mode-set="auto"><span aria-hidden="true">🤖</span> Autopilot</button>
      <button type="button" data-mode-set="manual"><span aria-hidden="true">✍️</span> Selbst pflegen</button>
    </div>
    <p id="p-msg" class="notice" hidden></p>
    <section class="panel p-next" id="p-next" hidden></section>
    <div id="p-empty"></div>
    <div id="p-body">
      <div id="p-auto"></div>
      <section id="p-summary" class="summary"></section>
      <div id="p-alloc"></div>
      <section class="panel" id="p-perf" hidden>
        <div class="panel-top"><div><h2>Wertentwicklung</h2>${infoBtn('performance')}</div>
          <div class="chips" id="p-perf-ranges">${Object.keys(PERF_RANGES).map((r) => `<button class="chip" data-perf="${r}">${i18n.span(r)}</button>`).join('')}</div></div>
        <div id="p-perf-chart" class="chart"></div>
        <div class="stat-grid" id="p-perf-stats"></div>
        <p class="hint" id="p-perf-note"></p>
      </section>
      <h2>Bestand</h2>
      <div class="table-wrap"><table>
        <thead><tr><th class="col-coin">Coin</th><th class="num">Menge</th><th class="num col-7d">Kurs</th><th class="num">24 h</th><th class="num">Wert</th><th class="num col-cap">Anteil</th>
          <th class="num col-30d">Ø Kaufpreis</th><th class="num">Gewinn / Verlust</th><th class="col-score">Kauf-Score</th><th>Signal</th><th></th></tr></thead>
        <tbody id="p-rows"></tbody>
      </table></div>
      <p class="foot-actions"><button class="link" id="p-export" type="button">Als CSV exportieren</button> · <button class="link" id="p-clear" type="button">Portfolio leeren</button></p>
      <div id="p-manager"></div>
      <div id="p-log"></div>
    </div>

    <dialog id="dlg-add" class="dialog">
      <form id="p-add" class="form" method="dialog">
        <div class="dialog-top"><h2>Position hinzufügen</h2><button class="icon" type="button" data-close aria-label="Schließen">✕</button></div>
        <label>Coin <input id="p-coin" list="coinlist" placeholder="z. B. Bitcoin oder BTC" required autocomplete="off"></label>
        <datalist id="coinlist"></datalist>
        <label>Menge <input id="p-amount" inputmode="decimal" placeholder="0,5" required></label>
        <label>Kaufpreis je Coin in ${currencyCode()} (optional) <input id="p-cost" inputmode="decimal" placeholder="leer = aktueller Kurs"></label>
        <p id="p-add-msg" class="notice" hidden></p>
        <div class="btn-row"><button class="btn" type="submit">Hinzufügen</button><button class="btn ghost" type="button" data-close>Abbrechen</button></div>
      </form>
    </dialog>

    <dialog id="dlg-edit" class="dialog">
      <form id="p-edit" class="form" method="dialog">
        <div class="dialog-top"><h2 id="e-title">Position ändern</h2><button class="icon" type="button" data-close aria-label="Schließen">✕</button></div>
        <div class="chips" id="e-actions" role="group" aria-label="Was möchtest du tun?">
          <button type="button" class="chip active" data-action="swap">Tauschen</button>
          <button type="button" class="chip" data-action="sell">Verkaufen</button>
          <button type="button" class="chip" data-action="remove">Entfernen</button>
        </div>
        <p class="hint" id="e-help"></p>
        <label>Menge <span id="e-have"></span>
          <span class="input-row"><input id="e-amount" inputmode="decimal" required><button class="btn ghost small" type="button" id="e-all">Alles</button></span></label>
        <label id="e-target-row">Tauschen in <input id="e-target" list="coinlist" placeholder="z. B. Ethereum oder ETH" autocomplete="off"></label>
        <label class="check" id="e-fee-row"><input type="checkbox" id="e-fee" checked> Gebühr von 0,25 % je Kauf und Verkauf abziehen</label>
        <p id="e-preview" class="preview"></p>
        <p id="e-msg" class="notice" hidden></p>
        <div class="btn-row"><button class="btn" type="submit" id="e-submit">Tauschen</button><button class="btn ghost" type="button" data-close>Abbrechen</button></div>
      </form>
    </dialog>

    <dialog id="dlg-reserve" class="dialog">
      <div>
        <div class="dialog-top"><h2>Strategie</h2><button class="icon" type="button" data-close aria-label="Schließen">✕</button></div>
        ${infoBtn('reserve', 'Strategien und Rückrechnung')}
        <p class="hint">Die Strategie legt fest, wie viel Reserve (Bargeld oder Stablecoins) der Manager je nach Marktlage hält. Den Rest verteilt er auf Coins.</p>
        <div id="r-options" class="reserve-options"></div>
        <p class="hint" id="r-hint"></p>
        <p id="r-actual"></p>
        <form id="p-monthly" class="inline-form" data-for="auto">
          <label for="p-monthly-value">Monatliche Sparrate (<span translate="no">${currencyCode()}</span>, leer = keine)</label>
          <input id="p-monthly-value" inputmode="decimal" placeholder="zum Beispiel 200">
          <button class="btn ghost small" type="submit">Speichern</button>
        </form>
        <details class="fold" id="r-custom" data-for="manual"><summary>Eigene Reserve festlegen</summary>
          <p class="hint">Nur wenn du bewusst davon abweichen willst – zum Beispiel, weil du einen Teil bald brauchst.</p>
          <strong class="reserve-value" id="r-value"></strong>
          <input type="range" id="r-slider" min="0" max="100" step="5" aria-label="Gewünschte Reserve in Prozent">
          <div class="range-labels"><span>0 % · voll investiert</span><span>100 % · alles in Reserve</span></div>
        </details>
        <div class="reserve-row" data-for="manual">
          <form id="p-cash" class="inline-form">
            <label for="p-cash-value">Bargeld außerhalb der Coins (${currencyCode()})</label>
            <input id="p-cash-value" inputmode="decimal" placeholder="0">
            <button class="btn ghost small" type="submit">Speichern</button>
          </form>
        </div>
        <div class="btn-row done-row"><button class="btn" type="button" data-close>Fertig</button></div>
      </div>
    </dialog>

    <dialog id="dlg-money" class="dialog">
      <form id="p-money" class="form" method="dialog">
        <div class="dialog-top"><h2>Einzahlen oder auszahlen</h2><button class="icon" type="button" data-close aria-label="Schließen">✕</button></div>
        <div class="chips" id="m-kind" role="group" aria-label="Einzahlen oder auszahlen">
          <button type="button" class="chip active" data-kind="in">Einzahlen</button><button type="button" class="chip" data-kind="out">Auszahlen</button>
        </div>
        <label>Betrag (<span translate="no">${currencyCode()}</span>) <input id="m-amount" inputmode="decimal" placeholder="zum Beispiel 500" required autocomplete="off"></label>
        <p class="hint" id="m-help"></p>
        <div id="m-preview" class="preview"></div>
        <p id="m-msg" class="notice" hidden></p>
        <div class="btn-row"><button class="btn" type="submit" id="m-submit">Einzahlung eintragen</button><button class="btn ghost" type="button" data-close>Abbrechen</button></div>
      </form>
    </dialog>

    <dialog id="dlg-import" class="dialog wide">
      <div class="dialog-top"><h2>Portfolio importieren</h2><button class="icon" type="button" data-close aria-label="Schließen">✕</button></div>
      <div id="imp-body"></div>
    </dialog>`;

  const say = (text) => { message = text; update(); };
  const amountText = (v) => v.toLocaleString(settings.locale, { maximumFractionDigits: 12, useGrouping: false });
  const copy = () => depot.data.positions.map((p) => ({ ...p }));
  const store = (positions, extra = {}, opts = {}) => saveDepot({ ...depot.data, positions, ...extra }, opts);
  const find = coinOf;

  // ----- Dialoge -----
  for (const d of view.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  $('#p-open-add').addEventListener('click', () => { $('#p-add-msg').hidden = true; $('#dlg-add').showModal(); });
  $('#p-open-reserve').addEventListener('click', () => $('#dlg-reserve').showModal());
  $('#p-open-import').addEventListener('click', () => { imp = null; renderImport(); $('#dlg-import').showModal(); });
  $('#p-open-money').addEventListener('click', () => { flow.kind = 'in'; $('#m-amount').value = ''; renderMoney(); $('#dlg-money').showModal(); });
  view.addEventListener('click', (e) => {
    // Aus der leeren Seite „Selbst pflegen“: erst den Modus setzen, dann eintragen oder importieren
    if (e.target.closest('[data-open-add], [data-open-import]') && depot.data.mode !== 'manual') saveDepot({ ...depot.data, mode: 'manual' }, { internal: true });
    if (e.target.closest('[data-open-add]')) $('#p-open-add').click();
    if (e.target.closest('[data-open-import]')) $('#p-open-import').click();
  });
  const isAuto = () => depot.data.mode === 'auto';

  // ----- Autopilot oder selbst pflegen -----
  $('#p-mode').addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-mode-set]')?.dataset.modeSet;
    if (!mode || mode === (depot.data.mode ?? 'manual')) return;
    if (mode === 'auto') {
      const ok = await decide(`<h2>Autopilot einschalten?</h2>
        <p>Der Autopilot hält dein Portfolio in denselben Anteilen wie das Modell-Portfolio der Strategie „${esc(RESERVE_MODES[depot.data.reserveMode].label)}“.
          Er zeigt dir, was du dafür kaufen und verkaufen musst – Coins, die nicht im Modell sind, schlägt er zum Verkauf vor.</p>
        <p class="muted">Ausführen musst du die Schritte selbst bei deiner Börse. Du kannst jederzeit zurück zu „Selbst pflegen“ wechseln; dein Bestand bleibt erhalten.</p>`,
        'Autopilot einschalten', 'Abbrechen');
      if (!ok) return;
    }
    message = mode === 'auto' ? 'Autopilot eingeschaltet. Oben steht, was zu tun ist.' : 'Du pflegst dein Portfolio jetzt selbst. Der Manager prüft deinen Bestand und schlägt Schritte vor.';
    saveDepot({ ...depot.data, mode, auto: mode === 'auto' ? { ...(depot.data.auto ?? {}), began: depot.data.auto?.began ?? Date.now(), lastDeposit: depot.data.auto?.lastDeposit ?? monthKey() } : depot.data.auto },
      { internal: true, note: mode === 'auto' ? 'Autopilot eingeschaltet' : 'Auf „Selbst pflegen“ gewechselt' });
  });

  // ----- Einzahlen und auszahlen (Autopilot) -----
  const flow = { kind: 'in' };
  const heldNow = depotHoldings;
  function renderMoney(showError = false) {
    for (const b of $('#m-kind').children) b.classList.toggle('active', b.dataset.kind === flow.kind);
    const usd = fromDisplay(pf.parseInput($('#m-amount').value));
    let error = !(usd > 0) ? 'Bitte einen Betrag größer als 0 eingeben.' : null;
    flow.plan = null;
    if (flow.kind === 'in') {
      $('#m-help').textContent = 'Zahl das Geld bei deiner Börse ein und trag es hier ein. Der Autopilot zeigt dann, was du davon kaufst – nach den Anteilen des Modells.';
      $('#m-preview').innerHTML = '';
      $('#m-submit').textContent = 'Einzahlung eintragen';
    } else {
      $('#m-help').textContent = 'Damit die Anteile gleich bleiben, verkaufst du von jedem Coin denselben Teil und nimmst denselben Teil der Reserve.';
      $('#m-submit').textContent = 'Auszahlung eintragen';
      const w = !error ? withdrawPlan({ holdings: heldNow(), cash: depot.data.cash, amount: usd }) : null;
      if (!error && !w) error = 'So viel ist im Portfolio nicht vorhanden.';
      flow.plan = w;
      const units = (v) => v.toLocaleString(settings.locale, { maximumSignificantDigits: 4 });
      $('#m-preview').innerHTML = w ? `<ul class="plain">${w.sells.map((s) => `<li>Verkaufen: <strong>${units(s.units)} ${esc(s.symbol.toUpperCase())}</strong> (${money(s.usd)})</li>`).join('')}
        ${w.fromReserve >= 0.5 ? `<li>Aus der Reserve: <strong>${money(w.fromReserve)}</strong></li>` : ''}</ul>` : '';
    }
    $('#m-msg').hidden = !(showError && error);
    $('#m-msg').textContent = error ?? '';
    return { usd, error };
  }
  $('#m-kind').addEventListener('click', (e) => { const k = e.target.closest('[data-kind]')?.dataset.kind; if (k) { flow.kind = k; renderMoney(); } });
  $('#m-amount').addEventListener('input', () => renderMoney());
  $('#p-money').addEventListener('submit', (e) => {
    e.preventDefault();
    const { usd, error } = renderMoney(true);
    if (error) return;
    $('#dlg-money').close();
    if (flow.kind === 'in') {
      message = `${money(usd)} eingezahlt. Der Autopilot zeigt oben, was du davon kaufst.`;
      return saveDepot({ ...depot.data, cash: depot.data.cash + usd, cashFix: null }, { note: `Einzahlung: ${money(usd)}` });
    }
    // Auszahlung: jede Position und die Reserve um denselben Teil kleiner
    const k = 1 - flow.plan.part, stables = new Set(heldNow().filter((h) => h.stable).map((h) => h.id));
    const positions = copy().map((p) => { const c = find(p); return c && (stables.has(c.id) || flow.plan.sells.some((s) => s.id === c.id)) ? { ...p, amount: p.amount * k } : p; });
    message = `${money(usd)} ausgezahlt. Trag die Verkäufe bei deiner Börse genauso ein.`;
    saveDepot({ ...depot.data, positions, cash: depot.data.cash * k, cashFix: null }, { note: `Auszahlung: ${money(usd)}` });
  });

  $('#p-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const fail = (text) => { $('#p-add-msg').hidden = false; $('#p-add-msg').textContent = text; };
    const text = $('#p-coin').value.trim();
    const m = text.match(/^(.*)\(([^)]+)\)$/);
    const c = (m && state.coins.find((x) => x.name === m[1].trim() && x.symbol.toUpperCase() === m[2].trim().toUpperCase()))
      || find({ symbol: text, name: text });
    const amount = pf.parseInput($('#p-amount').value);
    const cost = fromDisplay(pf.parseInput($('#p-cost').value));
    if (!c) return fail(`„${text}“ wurde unter den geladenen Coins nicht gefunden.`);
    if (!(amount > 0)) return fail('Bitte eine Menge größer als 0 eingeben.');
    message = `${c.name} hinzugefügt.`;
    e.target.reset();
    $('#dlg-add').close();
    store(pf.add(copy(), { id: c.id, symbol: c.symbol, name: c.name, amount, cost: cost > 0 ? cost : c.current_price, costCur: 'usd', since: Date.now(), peak: c.current_price }),
      {}, { note: `${amountText(amount)} ${c.symbol.toUpperCase()} hinzugefügt` });
  });

  // ----- Import in zwei Schritten: Datei wählen, dann Zuordnung prüfen -----
  function renderImport(error = '') {
    const el = $('#imp-body');
    if (!imp) {
      el.innerHTML = `
        <p class="hint">Exportiere dein Portfolio bei CoinMarketCap als CSV-Datei und wähle sie hier aus. Es funktionieren auch Exporte anderer Anbieter –
          im nächsten Schritt siehst du, was erkannt wurde, und kannst die Spalten selbst zuordnen.</p>
        <div class="form">
          <label>Datei (CSV oder Text) <input type="file" id="imp-file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label>
          <label>oder Inhalt hier einfügen <textarea id="imp-text" rows="4" placeholder="Kopfzeile und Zeilen aus der Datei"></textarea></label>
          ${error ? `<p class="notice">${esc(error)}</p>` : ''}
          <div class="btn-row"><button class="btn" id="imp-next" type="button">Weiter</button><button class="btn ghost" type="button" data-close>Abbrechen</button></div>
        </div>`;
      $('#imp-next').addEventListener('click', async () => {
        try {
          const file = $('#imp-file').files[0];
          const text = file ? await pf.readFile(file) : $('#imp-text').value;
          if (!text.trim()) return renderImport('Bitte eine Datei auswählen oder den Inhalt einfügen.');
          imp = pf.parseTable(text);
          renderImport();
        } catch (err) { imp = null; renderImport('Die Datei konnte nicht gelesen werden: ' + err.message); }
      });
      return;
    }

    const option = (i, sel) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(imp.header[i] || `Spalte ${i + 1}`)}</option>`;
    const result = pf.buildPositions(imp.rows, imp.columns);
    const hasCoin = imp.columns.symbol !== undefined || imp.columns.name !== undefined;
    const ok = hasCoin && imp.columns.amount !== undefined && result.positions.length > 0;
    const found = result.positions.filter((p) => find(p)).length;
    el.innerHTML = `
      <p class="hint">${imp.rows.length} Zeilen gelesen. Prüfe, ob die Spalten richtig zugeordnet sind – Coin und Menge werden gebraucht, der Rest ist freiwillig.</p>
      <div class="map-grid">${pf.ROLES.map(([role, label]) => `<label>${label}
          <select data-role="${role}"><option value="">– keine –</option>${imp.header.map((_, i) => option(i, imp.columns[role])).join('')}</select></label>`).join('')}</div>
      <h3>Erkannt</h3>
      ${ok ? `<ul class="import-list">${result.positions.slice(0, 8).map((p) => {
          const c = find(p);
          return `<li><span class="tag ${c ? 'up' : 'down'}">${c ? 'gefunden' : 'unbekannt'}</span>
            <span><strong>${esc(c?.name ?? p.name ?? p.symbol)}</strong> · ${p.amount.toLocaleString(settings.locale, { maximumFractionDigits: 8 })} ${esc((c?.symbol ?? p.symbol ?? '').toUpperCase())}${p.cost ? ` · Ø ${money(p.cost)}` : ''}</span></li>`;
        }).join('')}</ul>
        <p class="hint">${result.positions.length} Positionen, davon ${found} unter den Top 1000 gefunden${result.positions.length > 8 ? ` (gezeigt: die ersten 8)` : ''}${result.skipped ? ` · ${result.skipped} Zeilen ohne Coin oder Menge übersprungen` : ''}.</p>`
        : `<p class="notice">${!hasCoin || imp.columns.amount === undefined ? 'Bitte oben die Spalten für Coin und Menge auswählen.' : 'Mit dieser Zuordnung ergeben sich keine Bestände. Stimmt die Spalte für die Menge?'}</p>`}
      <label class="check"><input type="checkbox" id="imp-replace" checked> Bestehende Positionen ersetzen</label>
      <div class="btn-row"><button class="btn" id="imp-do" type="button" ${ok ? '' : 'disabled'}>Importieren</button><button class="btn ghost" id="imp-back" type="button">Zurück</button></div>`;
    for (const sel of el.querySelectorAll('select[data-role]')) {
      sel.addEventListener('change', () => {
        if (sel.value === '') delete imp.columns[sel.dataset.role]; else imp.columns[sel.dataset.role] = Number(sel.value);
        renderImport();
      });
    }
    $('#imp-back').addEventListener('click', () => { imp = null; renderImport(); });
    $('#imp-do').addEventListener('click', () => {
      // Fehlt in der Datei ein Kaufpreis, gilt der aktuelle Kurs
      const fresh = result.positions.map((p) => { const c = find(p); return { ...p, id: c?.id ?? null, cost: p.cost ?? c?.current_price ?? null, since: Date.now() }; });
      message = `${fresh.length} Positionen importiert.`;
      const replace = $('#imp-replace').checked;
      $('#dlg-import').close();
      store(replace ? fresh : fresh.reduce(pf.add, copy()), {}, { note: `Import: ${fresh.length} Positionen${replace ? ', bisheriger Bestand ersetzt' : ' ergänzt'}` });
    });
  }

  // ----- Reserve -----
  // Reserve-Ziel beim Selbst-Pflegen: eigener Wert oder der Vorschlag der gewählten Strategie (ausgewogen/vorsichtig)
  // Reserve-Ziel: eigener Wert, sonst die Reserve des Modell-Portfolios der Strategie – dieselbe Zahl wie im Autopiloten und im Rechner.
  // Fehlt das Modell, gilt der Vorschlag aus der Marktlage.
  let model = null, modelAsked = false;
  const modelCash = (key = depot.data.reserveMode) => (isNum(model?.profiles?.[key]?.cash) ? model.profiles[key].cash : key === 'balanced' && isNum(model?.cash) ? model.cash : null);
  const reserveTarget = () => depot.data.reservePct ?? (isNum(modelCash()) ? Math.round(modelCash()) : reserveAdvice(state.market?.regime)[depot.data.reserveMode]);
  const loadModel = () => {
    if (model || modelAsked) return;
    modelAsked = true;
    loadModelCurve().then((c) => { model = c ?? false; if (current === self) update(); });
  };
  $('#r-slider').addEventListener('input', (e) => { $('#r-value').textContent = `${e.target.value} %`; });
  $('#r-slider').addEventListener('change', (e) => {
    message = '';
    saveDepot({ ...depot.data, reservePct: Number(e.target.value) });
  });
  $('#r-options').addEventListener('click', (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (!mode || (mode === depot.data.reserveMode && depot.data.reservePct === null)) return;
    message = isAuto() ? `Strategie „${RESERVE_MODES[mode].label}“ gewählt. Oben steht, was sich dadurch ändert.` : '';
    saveDepot({ ...depot.data, reservePct: null, reserveMode: mode }, { internal: true, note: `Strategie: ${RESERVE_MODES[mode].label}` });
  });
  // Monatliche Sparrate des Autopiloten – in der gewählten Währung gespeichert, eingezahlt wird zum Kurs des Tages
  const monthlyText = () => { const m = depot.data.auto?.monthly; return m ? (m.currency === settings.currency ? m.amount : Math.round(toDisplay(m.amount / (i18n.rateOf(m.currency) || 1)) * 100) / 100).toLocaleString(settings.locale, { maximumFractionDigits: 2, useGrouping: false }) : ''; };
  $('#p-monthly').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#p-monthly-value').value.trim(), amount = raw ? pf.parseInput(raw) : 0;
    if (!(amount >= 0)) return say('Bitte einen Betrag von 0 oder mehr eingeben.');
    $('#p-monthly-value').blur();
    message = amount ? 'Sparrate gespeichert. Am Monatsanfang erinnert dich der Autopilot daran.' : 'Keine Sparrate mehr.';
    saveDepot({ ...depot.data, auto: { ...(depot.data.auto ?? {}), monthly: amount ? { amount, currency: settings.currency } : null } }, { internal: true });
  });
  // Bargeld wird in der gewählten Währung eingetragen und so gespeichert; intern rechnet die Seite in US-Dollar
  const saveCash = () => {
    const raw = $('#p-cash-value').value.trim();
    const amount = raw ? pf.parseInput(raw) : 0;
    if (!(amount >= 0)) return say('Bitte einen Betrag von 0 oder mehr eingeben.');
    $('#p-cash-value').blur();
    if (raw === cashText()) return;
    message = 'Bargeld gespeichert.';
    const cash = fromDisplay(amount);
    saveDepot({ ...depot.data, cash, cashFix: { amount, currency: settings.currency } }, { note: `Bargeld auf ${money(cash)} gesetzt` });
  };
  $('#p-cash').addEventListener('submit', (e) => { e.preventDefault(); saveCash(); });
  // „Fertig“, ✕ oder Esc übernehmen einen eingetippten Betrag, ohne dass erst „Speichern“ nötig ist
  $('#dlg-reserve').addEventListener('close', saveCash);

  // ----- Position ändern: tauschen, verkaufen oder entfernen -----
  const EDIT = {
    swap: { button: 'Tauschen', help: 'Tauscht die Menge in einen anderen Coin. Der neue Coin bekommt den Gegenwert als Kaufpreis.' },
    sell: { button: 'Verkaufen', help: 'Verkauft die Menge zum aktuellen Kurs. Der Erlös wird deinem Bargeld gutgeschrieben.' },
    remove: { button: 'Entfernen', help: 'Nimmt die Menge aus dem Portfolio, ohne etwas zu verbuchen – z. B. um einen Eintrag zu korrigieren.' },
  };
  let edit = null;   // { key, action }

  const resolveCoin = (text) => {
    const m = text.match(/^(.*)\(([^)]+)\)$/);
    return (m && state.coins.find((x) => x.name === m[1].trim() && x.symbol.toUpperCase() === m[2].trim().toUpperCase()))
      || find({ symbol: text, name: text });
  };

  // Rechnet aus den Eingaben, was passieren würde; error ist gesetzt, wenn noch etwas fehlt
  function editPlan() {
    const pos = depot.data.positions.find((p) => pf.keyOf(p) === edit.key);
    if (!pos) return { error: 'Diese Position gibt es nicht mehr.' };
    const c = find(pos);
    const units = pf.parseInput($('#e-amount').value);
    if (!(units > 0)) return { pos, c, error: 'Bitte eine Menge größer als 0 eingeben.' };
    if (units > pos.amount * 1.0000001) return { pos, c, error: `Du hast nur ${pos.amount.toLocaleString(settings.locale, { maximumFractionDigits: 8 })}.` };
    const amount = Math.min(units, pos.amount);
    if (edit.action === 'remove') return { pos, c, amount };
    if (!c || !isNum(c.current_price)) return { pos, c, error: 'Für diesen Coin gibt es keinen Kurs – er lässt sich nur entfernen.' };
    const fee = $('#e-fee').checked ? 0.0025 : 0;
    const usd = amount * c.current_price;
    if (edit.action === 'sell') return { pos, c, amount, fee, usd, proceeds: usd * (1 - fee) };
    const text = $('#e-target').value.trim();
    if (!text) return { pos, c, amount, fee, usd, error: 'Bitte den Coin angeben, in den getauscht werden soll.' };
    const to = resolveCoin(text);
    if (!to) return { pos, c, error: `„${text}“ wurde unter den geladenen Coins nicht gefunden.` };
    if (to.id === c.id) return { pos, c, error: 'Bitte einen anderen Coin wählen.' };
    if (!isNum(to.current_price) || !(to.current_price > 0)) return { pos, c, error: `Für ${to.name} gibt es gerade keinen Kurs.` };
    return { pos, c, amount, fee, usd, to, toUnits: usd * (1 - fee) * (1 - fee) / to.current_price };
  }

  function renderEdit(showError = false) {
    const p = editPlan();
    const sym = (p.c?.symbol ?? p.pos?.symbol ?? '').toUpperCase();
    for (const b of $('#e-actions').children) b.classList.toggle('active', b.dataset.action === edit.action);
    $('#e-title').textContent = `${p.c?.name ?? p.pos?.name ?? p.pos?.symbol ?? 'Position'} ändern`;
    $('#e-help').textContent = EDIT[edit.action].help;
    $('#e-have').textContent = p.pos ? `(vorhanden: ${p.pos.amount.toLocaleString(settings.locale, { maximumFractionDigits: 8 })} ${sym})` : '';
    $('#e-target-row').hidden = edit.action !== 'swap';
    $('#e-fee-row').hidden = edit.action === 'remove';
    $('#e-submit').textContent = EDIT[edit.action].button;
    const units = (v) => v.toLocaleString(settings.locale, { maximumSignificantDigits: 6 });
    $('#e-preview').innerHTML = p.error ? ''
      : edit.action === 'swap' ? `${units(p.amount)} ${esc(sym)} (${money(p.usd)}) → rund <strong>${units(p.toUnits)} ${esc(p.to.symbol.toUpperCase())}</strong>${p.fee ? ` · Gebühr rund ${money(p.usd * p.fee * 2)}` : ''}`
        : edit.action === 'sell' ? `${units(p.amount)} ${esc(sym)} → <strong>${money(p.proceeds)}</strong> ins Bargeld${p.fee ? ` · Gebühr rund ${money(p.usd * p.fee)}` : ''}`
          : `${units(p.amount)} ${esc(sym)} werden entfernt${p.amount >= p.pos.amount ? ' – die Position verschwindet ganz' : ''}.`;
    $('#e-msg').hidden = !(showError && p.error);
    $('#e-msg').textContent = p.error ?? '';
    return p;
  }

  $('#p-rows').addEventListener('click', (e) => {
    const key = e.target.closest('[data-edit]')?.dataset.edit;
    if (key === undefined) return;
    const pos = depot.data.positions.find((p) => pf.keyOf(p) === key);
    if (!pos) return;
    // Ohne Kurs lässt sich nicht tauschen oder verkaufen – dann direkt „Entfernen“
    edit = { key, action: find(pos) ? 'swap' : 'remove' };
    $('#e-amount').value = amountText(pos.amount);
    $('#e-target').value = '';
    renderEdit();
    $('#dlg-edit').showModal();
  });
  $('#e-actions').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action) { edit.action = action; renderEdit(); }
  });
  $('#e-all').addEventListener('click', () => {
    const pos = depot.data.positions.find((p) => pf.keyOf(p) === edit.key);
    if (pos) { $('#e-amount').value = amountText(pos.amount); renderEdit(); }
  });
  for (const id of ['#e-amount', '#e-target', '#e-fee']) $(id).addEventListener('input', () => renderEdit());

  $('#p-edit').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = renderEdit(true);
    if (p.error) return;
    const sym = (p.c?.symbol ?? p.pos.symbol ?? '').toUpperCase();
    const units = p.amount.toLocaleString(settings.locale, { maximumSignificantDigits: 6 });
    if (edit.action === 'remove') {
      message = `${units} ${sym} entfernt.`;
      $('#dlg-edit').close();
      return store(copy().map((x) => (pf.keyOf(x) === edit.key ? { ...x, amount: x.amount - p.amount } : x)), {}, { note: `${units} ${sym} entfernt` });
    }
    // Importierte Positionen kennen ihre Coin-ID noch nicht – hier wird sie ergänzt
    const withIds = copy().map((x) => ({ ...x, id: x.id ?? find(x)?.id ?? null }));
    const move = edit.action === 'sell'
      ? { type: 'sell', id: p.c.id, usd: p.usd, price: p.c.current_price }
      : { type: 'swap', id: p.c.id, usd: p.usd, price: p.c.current_price,
        toCoin: { id: p.to.id, symbol: p.to.symbol, name: p.to.name, price: p.to.current_price } };
    const result = applyMove(withIds, depot.data.cash, move, { fee: p.fee });
    if (!result) { $('#e-msg').hidden = false; $('#e-msg').textContent = 'Das hat nicht geklappt – bitte Menge prüfen.'; return; }
    message = edit.action === 'sell' ? `${units} ${sym} verkauft, ${money(p.proceeds)} ins Bargeld gebucht.`
      : `${units} ${sym} in ${p.to.name} getauscht.`;
    $('#dlg-edit').close();
    saveDepot({ ...depot.data, positions: result.positions, cash: result.cash }, { internal: true,
      note: edit.action === 'sell' ? `${units} ${sym} verkauft für ${money(p.proceeds)}` : `${units} ${sym} in ${p.to.name} getauscht` });
  });

  $('#p-clear').addEventListener('click', () => {
    if (!confirm('Portfolio wirklich leeren? Bestand, Wertentwicklung und Verlauf werden gelöscht.')) return;
    message = 'Portfolio geleert.'; saveDepot({ ...pf.empty(), consent: depot.data.consent, prefs: depot.data.prefs });
  });
  // Bestand als Tabelle herunterladen – Trennzeichen und Dezimalzeichen so, wie Excel sie in der gewählten Sprache erwartet
  $('#p-export').addEventListener('click', () => {
    const comma = i18n.prefs.lang === 'de';
    const de = (v) => (!isNum(v) ? '' : comma ? String(v).replace('.', ',') : String(v));
    const lines = [['Coin', 'Kürzel', 'Menge', 'Kaufpreis USD', 'Kurs USD', 'Wert USD']];
    for (const pos of depot.data.positions) {
      const c = find(pos);
      lines.push([c?.name ?? pos.name ?? '', (c?.symbol ?? pos.symbol ?? '').toUpperCase(), de(pos.amount), de(pos.cost), de(c?.current_price), de(c ? pos.amount * c.current_price : null)]);
    }
    if (depot.data.cash) lines.push(['Bargeld', 'USD', de(depot.data.cash), '', '1', de(depot.data.cash)]);
    // Vorangestelltes Zeichen U+FEFF: damit erkennt Excel die Umlaute
    const csv = String.fromCharCode(0xFEFF) + lines.map((row) => row.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(comma ? ';' : ',')).join(String.fromCharCode(13, 10));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#p-manager').addEventListener('click', (e) => {
    if (e.target.closest('[data-recalc]')) { recalc = true; return update(); }
    // Einen empfohlenen Schritt als ausgeführt eintragen: Mengen, Reserve und Kaufpreise werden angepasst
    const index = e.target.closest('[data-move]')?.dataset.move;
    const move = advice?.plan.moves[index];
    if (!move) return;
    // Importierte Positionen kennen ihre Coin-ID noch nicht – hier wird sie ergänzt
    const withIds = copy().map((p) => ({ ...p, id: p.id ?? find(p)?.id ?? null }));
    const stableIds = withIds.filter((p) => state.byId.get(p.id)?.analysis.stable).map((p) => p.id);
    const result = applyMove(withIds, depot.data.cash, move, { stableIds });
    if (!result) return say('Für diesen Kauf fehlt die Reserve. Trag zuerst die Verkäufe als umgesetzt ein oder erhöhe das Bargeld.');
    message = `Eingetragen: ${move.title}.`;
    saveDepot({ ...depot.data, positions: result.positions, cash: result.cash }, { internal: true, note: `Vorschlag umgesetzt: ${move.title} (${money(move.usd)})` });
  });

  // Höchster Kurs seit dem Kauf: gespeicherter Wert, aktueller Kurs und – wenn vorhanden – die Tageskurse seit dem Kaufdatum
  function peakOf(pos, c) {
    if (!c || !isNum(c.current_price) || c.analysis.stable) return null;
    let peak = Math.max(pos.peak ?? 0, c.current_price);
    if (c.ind && pos.since) {
      for (let i = c.ind.n - 1; i >= 0 && c.ind.times[i] >= pos.since; i--) peak = Math.max(peak, c.ind.prices[i]);
    }
    return peak;
  }

  // ----- Wertentwicklung -----
  const historyTried = new Set();
  let historyLoading = false;
  const closes = new WeakMap();    // Tageskurse je Coin als Nachschlagetabelle: Tag → Schlusskurs

  // Schlusskurs an einem Tag; vor dem ersten bekannten Tag gilt der erste Kurs, bei Lücken null
  function closeOn(daily, day) {
    if (!daily?.t?.length) return null;
    let c = closes.get(daily);
    if (!c) {
      c = { map: new Map(daily.t.map((t, i) => [tr.dayOf(t), daily.p[i]])), first: tr.dayOf(daily.t[0]) };
      closes.set(daily, c);
    }
    return day < c.first ? daily.p[0] : c.map.get(day) ?? null;
  }

  // Tageskurse der gehaltenen Coins nachladen: Binance, ersatzweise CoinGecko (dort nur wenige Abrufe)
  async function loadHistories(ids) {
    historyLoading = true;
    let fallbacks = 0;
    for (const id of ids) {
      historyTried.add(id);
      const c = state.byId.get(id);
      if (!c) continue;
      let data = null;
      try { data = await api.history(c.symbol, histSource(c)); } catch { /* Börsen nicht erreichbar */ }
      if (data && Math.abs(data.p[data.p.length - 1] / c.current_price - 1) > 0.1) data = null;   // gleiches Kürzel, anderer Coin
      if (!data && fallbacks < 3) {
        fallbacks++;
        try { data = { ...(await api.chart(id, 'usd')), source: 'CoinGecko' }; } catch { /* Limit erreicht – es bleibt beim heutigen Kurs */ }
      }
      if (data) state.daily.set(id, data);
    }
    historyLoading = false;
    rebuild();
    if (current === self) update();
  }

  $('#p-perf-ranges').addEventListener('click', (e) => {
    const r = e.target.closest('[data-perf]')?.dataset.perf;
    if (r) { perfRange = r; performancePanel(); }
  });

  function performancePanel() {
    const el = $('#p-perf'), track = depot.data.track;
    el.hidden = !track.states.length;
    if (!track.states.length) return;
    for (const b of $('#p-perf-ranges').children) b.classList.toggle('active', b.dataset.perf === perfRange);
    const today = tr.dayOf(Date.now()), start = tr.dayOf(track.states[0].t);
    const ids = [...new Set(track.states.flatMap((st) => st.pos.map((x) => x[0])))];
    const wanted = ids.filter((id) => !state.daily.has(id) && !historyTried.has(id) && state.byId.get(id) && !state.byId.get(id).analysis.stable);
    if (wanted.length && !historyLoading && state.pagesLoaded >= api.PAGES) loadHistories(wanted);
    if (wanted.length || historyLoading) {
      $('#p-perf-chart').innerHTML = '<p class="loading"><span class="spinner" aria-hidden="true"></span> Lade die Kursgeschichte deiner Coins …</p>';
      $('#p-perf-stats').innerHTML = ''; $('#p-perf-note').textContent = '';
      return;
    }

    // Kurs eines Coins an einem Tag; ohne Kursgeschichte gilt der heutige Kurs
    const flat = new Set();
    const price = (id, day) => {
      const c = state.byId.get(id);
      if (day >= today) return c?.current_price ?? null;
      const daily = state.daily.get(id);
      if (!daily) { if (c && !c.analysis.stable) flat.add(c.name); return c?.current_price ?? null; }
      return closeOn(daily, day);
    };
    const btc = (day) => (day >= today ? state.byId.get('bitcoin')?.current_price ?? null : closeOn(state.btcData, day));
    const span = PERF_RANGES[perfRange];
    const from = span ? today - span : Math.min(start, today - 30);
    const pts = tr.series(track, { fromDay: from, toDay: today, priceOn: price, btcOn: btc });
    const all = tr.series(track, { fromDay: start, toDay: today, priceOn: price, btcOn: btc });
    const first = pts.findIndex((x) => x.tracked);
    drawChart($('#p-perf-chart'), {
      t: pts.map((x) => x.day * 86_400_000 + 43_200_000), p: pts.map((x) => x.value),
      overlays: [{ label: 'Eingezahlt', color: 'var(--muted)', values: pts.map((x) => x.in) },
        { label: 'Dasselbe Geld in Bitcoin', color: 'var(--accent)', values: pts.map((x) => x.btc) }],
      marker: first > 0 ? { index: first, label: 'Beginn der Erfassung' } : null,
    });

    const last = all[all.length - 1];
    const sinceStart = tr.performance(all), inRange = tr.performance(pts);
    const b0 = btc(start), b1 = btc(today);
    const began = new Date(track.states[0].t).toLocaleDateString(settings.locale);
    const cell = (label, value, sub) => `<div><div class="label">${label}</div><div class="value">${value}</div><div class="muted">${sub}</div></div>`;
    $('#p-perf-stats').innerHTML =
      cell(`Zeitraum ${i18n.span(perfRange)}`, inRange === null ? '–' : pct(inRange), first > 0 ? 'teils zurückgerechnet' : 'ohne Ein- und Auszahlungen')
      + cell('Seit Beginn', sinceStart === null ? '–' : pct(sinceStart), `erfasst seit ${began}`)
      + cell('Gewinn seit Beginn', `<span class="${tone(Math.round(last.value - last.in))}">${money(last.value - last.in)}</span>`, `eingezahlt ${money(last.in)}`)
      + cell('Bitcoin seit Beginn', b0 && b1 && all.length > 1 ? pct((b1 / b0 - 1) * 100) : '–', 'zum Vergleich');
    $('#p-perf-note').textContent = (all.length < 2 ? 'Die Aufzeichnung beginnt heute – ab morgen wächst hier dein tatsächlicher Verlauf. ' : '')
      + (first > 0 ? 'Links der Markierung ist zurückgerechnet, wie sich dein damaliger Bestand entwickelt hätte. ' : '')
      + (flat.size ? `Ohne Kursgeschichte, mit heutigem Kurs gerechnet: ${[...flat].join(', ')}.` : '');
  }

  function logPanel() {
    const log = depot.data.log;
    const open = !!$('#p-log details')?.open;
    $('#p-log').innerHTML = log.length ? `<details class="log"${open ? ' open' : ''}><summary>Verlauf – die letzten ${log.length} Änderungen</summary>
        <ul class="plain">${[...log].reverse().map((entry) => `<li><span class="muted">${new Date(entry.t).toLocaleString(settings.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> · ${esc(entry.text)}</li>`).join('')}</ul></details>` : '';
  }

  const self = { update };
  let optionCount = -1;
  let emptyShown = null;

  function update() {
    const list = depot.data.positions;
    $('#p-where').textContent = depot.sync === 'error' ? `Speichern im Konto fehlgeschlagen: ${depot.error}` : SYNC_TEXT[depot.sync];
    $('#p-msg').hidden = !message; $('#p-msg').textContent = message;
    if (optionCount !== state.coins.length) {
      optionCount = state.coins.length;
      $('#coinlist').innerHTML = state.coins.map((c) => `<option value="${esc(c.name)} (${esc(c.symbol.toUpperCase())})">`).join('');
    }

    // In einer anderen Währung eingetragenes Bargeld folgt dem aktuellen Wechselkurs
    const fix = depot.data.cashFix, fixRate = fix && i18n.rateOf(fix.currency);
    if (fixRate > 0 && Math.abs(fix.amount / fixRate - depot.data.cash) > 0.01) return saveDepot({ ...depot.data, cash: fix.amount / fixRate }, { internal: true });

    // Leer: nichts eingetragen – außer der Autopilot läuft schon mit einer Sparrate und wartet auf die erste Einzahlung
    const isEmpty = !list.length && !depot.data.cash && !(isAuto() && depot.data.auto?.monthly);
    $('#p-body').hidden = isEmpty;
    // Nur bei einem Wechsel neu aufbauen – sonst ginge ein angefangener Betrag bei jeder Kursaktualisierung verloren
    if (isEmpty !== emptyShown) {
      emptyShown = isEmpty;
      const bt = (k) => `+${RESERVE_BACKTEST[k].perYear} % pro Jahr · größter Rückgang −${RESERVE_BACKTEST[k].drawdown} %`;
      $('#p-empty').innerHTML = isEmpty ? `<section class="panel empty-state setup">
        <h2>Wie möchtest du dein Portfolio führen?</h2>
        <p class="muted">Du kannst jederzeit wechseln. Coinweather handelt nicht für dich und hat keinen Zugriff auf dein Geld – die Schritte setzt du bei deiner Börse um.</p>
        <div class="setup-grid">
          <form class="setup-card auto" id="p-start">
            <div class="setup-top"><span class="setup-icon" aria-hidden="true">🤖</span><div><h3>Autopilot</h3><span class="badge buy">Empfohlen für den Einstieg</span></div></div>
            <p>Du sagst, wie viel du anlegst – der Manager sagt dir genau, was du kaufst. Dein Portfolio folgt dem Modell-Portfolio aus dem Rechner,
              und jede Woche siehst du, ob etwas zu tun ist.</p>
            <label>Startbetrag <span translate="no">(${currencyCode()})</span><input id="p-start-value" inputmode="decimal" placeholder="zum Beispiel 5000" autocomplete="off"></label>
            <label>Monatliche Sparrate, optional <span translate="no">(${currencyCode()})</span><input id="p-start-monthly" inputmode="decimal" placeholder="zum Beispiel 200" autocomplete="off"></label>
            <fieldset class="setup-modes"><legend>Strategie</legend>
              ${Object.entries(RESERVE_MODES).map(([k, m]) => `<label class="setup-mode"><input type="radio" name="p-start-mode" value="${k}" ${k === 'balanced' ? 'checked' : ''}>
                <span><strong>${m.label}</strong><small>${bt(k)} (Rückrechnung)</small></span></label>`).join('')}
            </fieldset>
            <button class="btn" type="submit">Portfolio zusammenstellen</button>
          </form>
          <div class="setup-card manual">
            <div class="setup-top"><span class="setup-icon" aria-hidden="true">✍️</span><div><h3>Selbst pflegen</h3><span class="muted">Für bestehende Portfolios</span></div></div>
            <p>Du trägst deine Coins ein oder importierst sie von CoinMarketCap oder deiner Börse. Der Manager prüft jeden Coin
              und schlägt Käufe, Verkäufe und die passende Reserve vor – du entscheidest.</p>
            <div class="btn-row"><button class="btn ghost" type="button" data-open-add>+ Coins eintragen</button><button class="btn ghost" type="button" data-open-import>Portfolio importieren</button></div>
          </div>
        </div>
        <p class="hint">Rückrechnung 2018 bis heute mit 0,25 % Gebühr je Handel, Mittel aus 7 Starttagen. Die Zukunft fällt meist schlechter aus. Keine Anlageberatung.</p>
      </section>` : '';
      if (isEmpty && preset?.amount) {
        $(preset.monthly ? '#p-start-monthly' : '#p-start-value').value = inputText(toDisplay(preset.amount));
        $('#p-start-value').focus();
      }
      $('#p-start')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const read = (id) => { const raw = $(id).value.trim(); return raw ? pf.parseInput(raw) : 0; };
        const amount = read('#p-start-value'), monthly = read('#p-start-monthly');
        if (!(amount >= 0) || !(monthly >= 0) || !(amount > 0 || monthly > 0)) return say('Bitte einen Startbetrag oder eine Sparrate größer als 0 eingeben.');
        const cash = fromDisplay(amount), mode = view.querySelector('[name="p-start-mode"]:checked')?.value ?? 'balanced';
        message = amount > 0 ? 'Fertig – hier steht, was du kaufst. Setz es bei deiner Börse um und tipp danach auf „Erledigt“.' : 'Sparrate gespeichert. Trag die erste Einzahlung ein, sobald das Geld bei deiner Börse ist.';
        saveDepot({ ...depot.data, cash, cashFix: null, mode: 'auto', reserveMode: mode, reservePct: null,
          auto: { monthly: monthly > 0 ? { amount: monthly, currency: settings.currency } : null, lastDeposit: amount > 0 ? monthKey() : null, began: Date.now() } },
        { note: `Autopilot gestartet (${RESERVE_MODES[mode].label})${amount > 0 ? `, Startbetrag ${money(cash)}` : ''}` });
      });
    }
    // Was nur zu einem der beiden Modi gehört
    const auto = isAuto();
    for (const el of view.querySelectorAll('[data-for]')) el.hidden = isEmpty ? true : el.dataset.for !== (auto ? 'auto' : 'manual');
    $('#p-open-reserve').hidden = isEmpty;
    $('#p-mode').hidden = isEmpty;
    for (const b of $('#p-mode').children) b.classList.toggle('active', b.dataset.modeSet === (auto ? 'auto' : 'manual'));
    loadModel();
    if (isEmpty) { advice = null; reserve(0, 0); return; }

    const rows = list.map((pos) => {
      const c = find(pos);
      const value = c ? pos.amount * c.current_price : null;
      const unit = isNum(pos.cost) ? pos.cost : null;
      const paid = unit === null ? null : unit * pos.amount;
      return { pos, c, value, unit, paid, gain: value !== null && paid !== null ? value - paid : null, peak: peakOf(pos, c) };
    }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

    // Neues Hoch seit dem Kauf merken (Grundlage der Schutzregel) – gespeichert wird erst ab 1 % Unterschied
    if (rows.some((r) => r.peak && r.peak > (r.pos.peak ?? 0) * 1.01)) {
      return store(list.map((p) => { const r = rows.find((x) => x.pos === p); return r?.peak ? { ...p, peak: Math.max(p.peak ?? 0, r.peak) } : p; }));
    }

    const cash = depot.data.cash;
    const total = rows.reduce((s, r) => s + (r.value ?? 0), 0) + cash;
    // Bestehende Portfolios: Die Aufzeichnung für die Wertentwicklung beginnt mit dem heutigen Bestand
    if (!depot.data.track.states.length && total > 0 && state.pagesLoaded >= api.PAGES && !trackStarted) { trackStarted = true; return saveDepot(depot.data); }
    const stableValue = rows.filter((r) => r.c?.analysis.stable).reduce((s, r) => s + r.value, 0);
    const priced = rows.filter((r) => r.gain !== null);
    const paid = priced.reduce((s, r) => s + r.paid, 0);
    const gain = priced.reduce((s, r) => s + r.gain, 0);
    const day = rows.reduce((s, r) => {
      const ch = r.c?.price_change_percentage_24h_in_currency;
      return s + (r.value !== null && isNum(ch) ? r.value - r.value / (1 + ch / 100) : 0);
    }, 0);

    const card = (label, value, sub = '', cls = '') => `<div class="card ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="muted">${sub}</div></div>`;
    $('#p-summary').innerHTML = card('Gesamtwert', money(total), `heute ${pct(total - day > 0 ? day / (total - day) * 100 : 0)} (${money(day)})`, 'main') +
      card('Gewinn / Verlust', priced.length ? `<span class="${tone(gain)}">${money(gain)}</span>` : '–', paid ? pct(gain / paid * 100) : 'Kaufpreise fehlen') +
      card('Reserve aktuell', money(cash + stableValue), total ? `${num((cash + stableValue) / total * 100, 0)} % des Portfolios${auto ? (follow() ? ` · Ziel ${Math.round(follow().reserveShare * 100)} %` : '') : ` · Ziel ${reserveTarget()} %`}` : '');

    $('#p-rows').innerHTML = rows.length ? rows.map(({ pos, c, value, unit, paid: p, gain: g }) => {
      const a = c?.analysis;
      const name = c ? `<a class="coin-cell" href="#/coin/${encodeURIComponent(c.id)}"><img src="${esc(c.image)}" alt="" loading="lazy">
          <div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol)}</div></div></a>`
        : `<div><div class="coin-name">${esc(pos.name || pos.symbol)}</div><div class="coin-sym">${state.pagesLoaded < api.PAGES ? 'wird geladen …' : 'nicht in den Top 1000'}</div></div>`;
      return `<tr>
        <td class="col-coin">${name}</td>
        <td class="num">${pos.amount.toLocaleString(settings.locale, { maximumFractionDigits: 8 })}</td>
        <td class="num col-7d">${c ? money(c.current_price) : '–'}</td>
        <td class="num">${pct(c?.price_change_percentage_24h_in_currency)}</td>
        <td class="num">${money(value)}</td>
        <td class="num col-cap">${value !== null && total ? num(value / total * 100) + ' %' : '–'}</td>
        <td class="num col-30d">${unit === null ? '–' : money(unit)}</td>
        <td class="num">${g === null ? '–' : `<span class="${tone(g)}">${money(g)}</span><br><small>${pct(g / p * 100)}</small>`}</td>
        <td class="col-score">${a ? scoreCell(a.score) : '–'}</td>
        <td>${a ? badge(a) : '–'}</td>
        <td><button class="btn ghost small" data-edit="${esc(pf.keyOf(pos))}">Ändern</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="11" class="empty">Noch keine Coins – nur Bargeld. Mit „+ Position“ fügst du Coins hinzu.</td></tr>';

    allocation(rows, cash, total);
    performancePanel();
    reserve(cash + stableValue, total);
    if (auto) { $('#p-manager').innerHTML = ''; autoPanel(); } else { $('#p-auto').innerHTML = ''; manager(rows, total); }
    logPanel();
  }

  // ----- Benachrichtigung, wenn der Autopilot handelt (sw.js prüft im Hintergrund, sofern der Browser das kann) -----
  async function rememberSeen(t) {
    const cache = await caches.open('coinweather-state');
    await cache.put('/__autopilot-seen', new Response(JSON.stringify({ profile: depot.data.reserveMode, last: t?.trades?.[0]?.t ?? 0,
      title: i18n.say('Coinweather Autopilot'), body: i18n.say('Das Modell hat gehandelt – deine Schritte stehen in der App.') })));
  }
  async function enableNotify() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('caches' in window)) return say('Dein Browser kann keine Benachrichtigungen zeigen. Trag dir den Prüftag in den Kalender ein.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return say('Benachrichtigungen sind nicht erlaubt. Du kannst sie in den Einstellungen deines Browsers freigeben – oder den Prüftag in den Kalender eintragen.');
    await rememberSeen(modelTarget());
    try { localStorage.setItem(NOTIFY_KEY, '1'); } catch { /* nur für jetzt */ }
    let periodic = false;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.periodicSync) { await reg.periodicSync.register('autopilot', { minInterval: 12 * 3_600_000 }); periodic = true; }
    } catch { /* nur in installierten Apps erlaubt */ }
    say(periodic ? 'Eingeschaltet. Hat der Autopilot gehandelt, meldet sich Coinweather – solange die App auf diesem Gerät installiert ist.'
      : 'Erlaubt – aber dein Browser prüft nicht selbst im Hintergrund. Installiere Coinweather als App (Chrome, Android) oder trag dir den Prüftag in den Kalender ein.');
  }

  // ----- Autopilot: dem Modell-Portfolio der gewählten Strategie folgen -----
  const modelTarget = () => {
    const key = depot.data.reserveMode;
    return model?.profiles?.[key] ?? (key === 'balanced' && model?.holdings ? model : null);
  };
  // Kürzel aus dem Modell (Binance) → Coin der Seite: unter gleichem Kürzel der mit dem höchsten Marktwert
  const coinBySymbol = modelCoin;
  const follow = () => {
    const t = modelTarget();
    return t && state.coins.length ? followModel({ target: t, coinOf: coinBySymbol, holdings: heldNow(), cash: depot.data.cash }) : null;
  };
  const AUTO_LABEL = { buy: 'Kaufen', add: 'Nachkaufen', reduce: 'Reduzieren', sell: 'Verkaufen' };
  const MODEL_WHY = { sell: 'Das Modell hat verkauft – Verkaufssignal oder Schutzregel.', reduce: 'Das Modell hat reduziert – mehr Reserve oder Obergrenze je Coin.',
    profit: 'Das Modell hat einen Teil des Gewinns gesichert.', buy: 'Das Modell hat gekauft – Kaufsignal.', add: 'Das Modell hat nachgekauft.',
    'swap-in': 'Das Modell hat in diesen Coin getauscht.', 'swap-out': 'Das Modell hat diesen Coin gegen einen stärkeren getauscht.' };
  let autoMoves = [];

  function autoPanel() {
    const el = $('#p-auto');
    loadModel();
    const t = modelTarget(), f = follow();
    if (!t || !f) {
      el.innerHTML = `<section class="panel autopilot"><p class="loading">${model === false ? 'Das Modell-Portfolio ist gerade nicht erreichbar. Bitte später noch einmal versuchen.'
        : '<span class="spinner" aria-hidden="true"></span> Das Modell-Portfolio wird geladen …'}</p></section>`;
      $('#p-next').hidden = true;
      return;
    }
    autoMoves = f.moves;
    const a = depot.data.auto ?? {}, label = RESERVE_MODES[depot.data.reserveMode].label;
    const date = (ms, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(ms).toLocaleDateString(settings.locale, opts);
    // Sparrate fällig: ein neuer Monat seit der letzten Einzahlung
    const due = a.monthly && (!a.lastDeposit || a.lastDeposit < monthKey());
    const units = (m) => `${m.units.toLocaleString(settings.locale, { maximumSignificantDigits: 4 })} ${esc(m.symbol.toUpperCase())}`;
    // Warum: der letzte Handel des Modells mit diesem Coin in den letzten 3 Wochen, sonst der Zielanteil
    const recent = (sym) => (t.trades ?? []).find((x) => x.symbol === sym && x.t > Date.now() - 21 * 86_400_000);
    const why = (m) => {
      const w = f.weights.find((x) => x.id === m.id);
      if (!w) return 'Nicht im Modell-Portfolio – der Erlös geht an die Coins des Modells.';
      const tr = recent(m.symbol.toUpperCase());
      if (tr && MODEL_WHY[tr.type] && ((tr.type === 'buy' || tr.type === 'add' || tr.type === 'swap-in') === (m.type === 'buy' || m.type === 'add'))) return MODEL_WHY[tr.type];
      return m.type === 'buy' || m.type === 'add' ? `Auf den Zielanteil von ${num(w.share * 100, 1)} % bringen.` : `Zurück auf den Zielanteil von ${num(w.share * 100, 1)} %.`;
    };
    const rowsHtml = f.moves.map((m, i) => `<li class="todo-move ${m.type}">
        <span class="tag ${m.type === 'buy' || m.type === 'add' ? 'up' : 'down'}">${AUTO_LABEL[m.type]}</span>
        <span class="tm-main"><strong>${esc(m.name)}</strong> <span class="muted">≈ ${units(m)}</span><small>${esc(why(m))}</small></span>
        <strong class="tm-usd">${money(m.usd)}</strong>
        <button class="btn ghost small" type="button" data-auto-move="${i}">Erledigt</button></li>`).join('');
    const reserveNow = f.total ? f.reserve / f.total : 0;
    const bar = (v, color) => `<span class="mini-bar"><i style="width:${Math.min(100, v * 100)}%;background:${color}"></i></span>`;
    el.innerHTML = `<section class="panel autopilot">
      <div class="panel-top"><div><div class="label">🤖 Autopilot · Strategie ${esc(label)}</div>
        <h2>${f.moves.length ? `${f.moves.length} ${f.moves.length === 1 ? 'Schritt' : 'Schritte'} zu tun` : due ? 'Sparrate fällig' : 'Alles erledigt'}</h2>
        <div class="muted">Folgt dem Modell-Portfolio · Stand ${dateText(new Date(t.asOf))} · nächste Prüfung ${new Date(t.next).toLocaleDateString(settings.locale, { weekday: 'long' })}, ${dateText(new Date(t.next))}</div></div>
        <div class="btn-row">${infoBtn('autopilot', 'So arbeitet der Autopilot')}<button type="button" class="info-btn" data-ics><span aria-hidden="true">📅</span>Prüftag in den Kalender</button>
          <button type="button" class="info-btn" data-notify><span aria-hidden="true">🔔</span>${notifyOn() ? 'Benachrichtigung ist an' : 'Benachrichtigen, wenn er handelt'}</button></div></div>
      ${due ? `<div class="deposit-due"><span aria-hidden="true">📅</span><div><strong>Sparrate für ${new Date().toLocaleDateString(settings.locale, { month: 'long' })}: ${money(monthlyUsd(a.monthly))}</strong>
          <div class="muted">Zahl sie bei deiner Börse ein und trag sie hier ein – dann zeigt der Autopilot, was du davon kaufst.</div></div>
          <div class="btn-row"><button class="btn small" type="button" data-deposit="yes">Eingezahlt</button><button class="btn ghost small" type="button" data-deposit="skip">Diesen Monat nicht</button></div></div>` : ''}
      ${f.moves.length ? `<ol class="todo-moves">${rowsHtml}</ol>
        <div class="btn-row todo-all"><button class="btn" type="button" data-auto-all>Alle als erledigt eintragen</button>
          <span class="muted">Gebühren zusammen rund ${money(f.fees)} (0,25 % je Handel)</span></div>`
        : f.total ? `<p class="all-done">✓ Dein Portfolio entspricht dem Modell. Bis zur nächsten Prüfung ist nichts zu tun.</p>` : ''}
      ${f.missing.length ? `<p class="notice">Nicht gefunden und deshalb in Reserve gelassen: ${f.missing.map(esc).join(', ')}.</p>` : ''}
      ${depot.data.reserveMode === 'balanced' ? autopilotLive() : ''}
      <p class="share-row hint">${shareLinks(`${location.origin}${i18n.prefs.lang === 'en' ? '' : `/${i18n.prefs.lang}`}/crypto-portfolio-autopilot/?von=${refTag('share-ap')}`,
        i18n.say('Mein Krypto-Portfolio läuft mit dem Autopiloten von Coinweather – er sagt mir jede Woche, was ich kaufe.'), 'Autopilot empfehlen')}</p>
      <details class="fold target-fold"${f.moves.length ? '' : ' open'}><summary>Ziel und Stand</summary>
        <table class="m-table target-table"><thead><tr><th>Coin</th><th class="num">Kauf-Score</th><th class="num">Ziel</th><th class="num">Jetzt</th><th></th></tr></thead><tbody>
        ${f.weights.map((w) => { const sc = state.byId.get(w.id)?.analysis?.score; return `<tr><td><a href="#/coin/${encodeURIComponent(w.id)}"><strong>${esc(w.name)}</strong></a></td>
          <td class="num"><span class="${tone(sc)}">${isNum(sc) ? to100(sc) : '–'}</span></td><td class="num">${num(w.share * 100, 1)} %</td><td class="num">${num(f.total ? w.have / f.total * 100 : 0, 1)} %</td><td class="m-bar">${bar(w.share, 'var(--accent)')}</td></tr>`; }).join('')}
        <tr><td>Reserve</td><td></td><td class="num">${num(f.reserveShare * 100, 1)} %</td><td class="num">${num(reserveNow * 100, 1)} %</td><td class="m-bar">${bar(f.reserveShare, 'var(--muted)')}</td></tr></tbody></table>
        <p class="hint">Die Reserve folgt der Strategie: mehr in schwachen Marktphasen und im Bärenmarkt, weniger, wenn der Zyklus-Kompass günstig steht. Gibt es zu wenige Kaufsignale, bleibt mehr in Reserve.</p>
      </details>
    </section>`;
    // Die Übersicht oben braucht es hier nicht – der Autopilot steht selbst ganz oben
    $('#p-next').hidden = true;
    if (notifyOn()) rememberSeen(t).catch(() => {});
  }

  // Schritte des Autopiloten eintragen: einzeln oder alle (erst Verkäufe, dann Käufe); dazu die Sparrate
  $('#p-auto').addEventListener('click', (e) => {
    if (e.target.closest('[data-notify]')) { enableNotify().catch((err) => say(err.message)); return; }
    // Wöchentlicher Termin am Prüftag (9 Uhr Ortszeit) als Kalenderdatei – die Erinnerung, ohne dass Coinweather etwas speichert
    if (e.target.closest('[data-ics]')) {
      const t = modelTarget();
      if (!t) return;
      const d = new Date(t.next), p2 = (n) => String(n).padStart(2, '0');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Coinweather//Autopilot//DE', 'BEGIN:VEVENT', `UID:autopilot-${Date.now()}@coinweather.github.io`, `DTSTAMP:${stamp}`,
        `DTSTART:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T090000`, 'DURATION:PT15M', 'RRULE:FREQ=WEEKLY',
        `SUMMARY:${i18n.say('Coinweather: Autopilot prüfen')}`, `DESCRIPTION:${i18n.say('Schau nach, ob der Autopilot Schritte für dein Portfolio hat.')}`,
        'URL:https://coinweather.github.io/#/portfolio', 'END:VEVENT', 'END:VCALENDAR'].join(String.fromCharCode(13, 10));
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      link.download = 'coinweather-autopilot.ics';
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }
    const dep = e.target.closest('[data-deposit]')?.dataset.deposit;
    if (dep) {
      const a = depot.data.auto ?? {}, usd = monthlyUsd(a.monthly);
      if (dep === 'yes') message = `${money(usd)} eingezahlt. Darunter steht, was du davon kaufst.`;
      return saveDepot({ ...depot.data, cash: depot.data.cash + (dep === 'yes' ? usd : 0), cashFix: null, auto: { ...a, lastDeposit: monthKey() } },
        dep === 'yes' ? { note: `Sparrate eingezahlt: ${money(usd)}` } : { internal: true, note: 'Sparrate diesen Monat ausgesetzt' });
    }
    const all = e.target.closest('[data-auto-all]');
    const one = e.target.closest('[data-auto-move]')?.dataset.autoMove;
    if (!all && one === undefined) return;
    const isBuy = (m) => (m.type === 'buy' || m.type === 'add' ? 1 : 0);
    const list = all ? [...autoMoves].sort((x, y) => isBuy(x) - isBuy(y)) : [autoMoves[one]].filter(Boolean);
    let positions = copy().map((p) => ({ ...p, id: p.id ?? find(p)?.id ?? null })), cash = depot.data.cash, done = 0;
    const stableIds = positions.filter((p) => state.byId.get(p.id)?.analysis.stable).map((p) => p.id);
    for (const m of list) {
      const r = applyMove(positions, cash, m, { stableIds });
      if (r) { positions = r.positions; cash = r.cash; done++; }
    }
    if (!done) return say('Für diesen Kauf fehlt die Reserve. Trag zuerst die Verkäufe als erledigt ein.');
    message = done === 1 ? `Eingetragen: ${AUTO_LABEL[list[0].type]} ${list[0].name}.` : `${done} Schritte eingetragen.`;
    saveDepot({ ...depot.data, positions, cash, cashFix: null }, { internal: true,
      note: list.length === 1 ? `Autopilot: ${AUTO_LABEL[list[0].type]} ${list[0].name} (${money(list[0].usd)})` : `Autopilot: ${done} Schritte eingetragen` });
  });

  function reserve(actual, total) {
    const auto = isAuto();
    const advice = reserveAdvice(state.market?.regime);
    const chosen = auto ? null : depot.data.reservePct;
    const mode = depot.data.reserveMode;
    // Reserve heute je Strategie: im Autopiloten die des Modell-Portfolios, sonst der Vorschlag aus der Marktlage
    const today = (key) => (isNum(modelCash(key)) ? Math.round(modelCash(key)) : !auto && state.market ? advice[key] : null);
    const value = auto ? today(mode) : reserveTarget();
    const slider = $('#r-slider');
    if (!auto && document.activeElement !== slider) { slider.value = value; $('#r-value').textContent = `${value} %`; }
    $('#r-chip').textContent = chosen === null ? RESERVE_MODES[mode].label : `Reserve ${chosen} %`;
    const share = total ? actual / total * 100 : 0;
    const gap = isNum(value) ? total * value / 100 - actual : 0;
    $('#r-actual').innerHTML = !total || !isNum(value) ? ''
      : `Aktuell liegen <strong>${money(actual)}</strong> in Reserve (${num(share, 0)} %). `
      + (Math.abs(gap) < total * 0.02 ? 'Das entspricht dem Ziel.'
        : gap > 0 ? `Für ${value} % fehlen rund <strong>${money(gap)}</strong> – dafür schlägt der Manager Verkäufe vor.`
          : `Das sind rund <strong>${money(-gap)}</strong> mehr als das Ziel – dafür schlägt der Manager Käufe vor.`);

    // Die Strategien zur Wahl; im Modus „Selbst pflegen“ setzt der Regler bei Bedarf einen eigenen Wert
    const option = (key) => `<button type="button" class="reserve-option ${chosen === null && mode === key ? 'active' : ''}" data-mode="${key}">
        <span class="label">${RESERVE_MODES[key].label}</span>${isNum(today(key)) ? `<strong>${today(key)} %</strong><span class="muted">Reserve heute</span>` : ''}
        <span class="muted">${RESERVE_MODES[key].text}</span>
        <span class="muted">Rückrechnung: +${RESERVE_BACKTEST[key].perYear} % pro Jahr, seit 2022 +${RESERVE_BACKTEST[key].recent} %, größter Rückgang −${RESERVE_BACKTEST[key].drawdown} %</span></button>`;
    $('#r-options').innerHTML = Object.keys(RESERVE_MODES).map(option).join('');
    const h = advice.history;
    $('#r-hint').innerHTML = auto ? `Der Autopilot folgt dem Modell-Portfolio der Strategie „${esc(RESERVE_MODES[mode].label)}“. Ein Wechsel ändert die Zielanteile – der Autopilot zeigt dann, was dafür zu tun ist.`
      : !state.market ? 'Der Vorschlag wird berechnet …' : `
      ${chosen === null ? `Du folgst der Strategie „${RESERVE_MODES[mode].label}“: Die Reserve ist die des Modell-Portfolios, das jede Woche nach Marktphase, Zyklus-Kompass und Kaufsignalen neu eingestellt wird.`
        : `Du hast <strong>${chosen} %</strong> selbst eingestellt. Ein Klick auf eine Strategie folgt wieder dem Modell.`}
      ${h ? `In vergleichbaren Marktphasen seit 2018 stand der Markt 30 Tage später in <strong>${h.up} %</strong> der Fälle höher; im schlechtesten Zehntel der Fälle lag er mindestens <strong>${-h.worst} %</strong> tiefer.` : ''}`;
    const cashInput = $('#p-cash-value');
    if (document.activeElement !== cashInput) cashInput.value = cashText();
    const monthlyInput = $('#p-monthly-value');
    if (document.activeElement !== monthlyInput) monthlyInput.value = monthlyText();
  }

  // Bargeld als Eingabetext in der gewählten Währung – wie eingetragen, wenn es in dieser Währung eingetragen wurde
  function cashText() {
    const fix = depot.data.cashFix;
    const amount = fix && fix.currency === settings.currency ? fix.amount : Math.round(toDisplay(depot.data.cash) * 100) / 100;
    return amount ? amount.toLocaleString(settings.locale, { maximumFractionDigits: 2, useGrouping: false }) : '';
  }

  // Verteilung des Portfolios als Balken: die größten Positionen einzeln, der Rest zusammengefasst
  function allocation(rows, cash, total) {
    const el = $('#p-alloc');
    if (!(total > 0)) { el.innerHTML = ''; return; }
    const parts = [];
    let reserveValue = cash, other = 0;
    for (const r of rows.filter((x) => x.value > 0)) {
      if (r.c.analysis.stable) reserveValue += r.value;
      else if (parts.length < 6) parts.push({ name: r.c.name, value: r.value, color: ALLOC_COLORS[parts.length] });
      else other += r.value;
    }
    if (other > 0) parts.push({ name: 'Weitere', value: other, color: 'var(--muted)' });
    if (reserveValue > 0) parts.push({ name: 'Reserve', value: reserveValue, color: 'var(--line-strong)' });
    el.innerHTML = `<section class="panel"><div class="label">Verteilung</div>
      <div class="alloc" role="img" aria-label="Verteilung des Portfolios">${parts.map((p) => `<i style="width:${(p.value / total * 100).toFixed(2)}%;background:${p.color}" title="${esc(p.name)}"></i>`).join('')}</div>
      <div class="alloc-legend">${parts.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.name)} <b>${num(p.value / total * 100, 0)} %</b></span>`).join('')}</div>
    </section>`;
  }

  function manager(rows, total) {
    const el = $('#p-manager');
    if (!(total > 0)) { advice = null; el.innerHTML = ''; return; }
    // Vorschläge erst zeigen, wenn alle Kurse und Bewertungen geladen sind – vorher würden sie sich ständig ändern
    const ready = state.pagesLoaded >= api.PAGES && state.refineDone && !!state.market;
    const key = JSON.stringify([depot.data.positions.map((p) => [pf.keyOf(p), p.amount, p.cost]), depot.data.cash, depot.data.reservePct, depot.data.reserveMode, modelCash()]);
    const mc = modelCash(), label = RESERVE_MODES[depot.data.reserveMode].label;

    if (ready && (!advice || advice.key !== key || recalc)) {
      recalc = false;
      const known = rows.filter((r) => r.c && isNum(r.c.current_price));
      const held = new Set(known.map((r) => r.c.id));
      const candidates = state.coins.filter((c) => c.analysis.signal === 'buy' && !held.has(c.id) &&
        (c.market_cap_rank ?? 9999) <= 300 && c.total_volume >= 5e6 && !DERIVATIVE.test(c.name))
        .sort((a, b) => adjusted(b.analysis) - adjusted(a.analysis)).slice(0, 16)
        .map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, price: c.current_price, analysis: c.analysis }));
      const p = plan({
        holdings: known.map((r) => ({ id: r.c.id, name: r.c.name, symbol: r.c.symbol, units: r.pos.amount, price: r.c.current_price, cost: r.unit, peak: r.peak, trimPrice: r.pos.trimPrice, analysis: r.c.analysis })),
        cash: depot.data.cash, candidates, regime: state.market.regime,
        core: ['bitcoin', 'ethereum'].map((id) => state.byId.get(id)).filter((c) => c && isNum(c.current_price))
          .map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, price: c.current_price, analysis: c.analysis })),
        options: { ...RESERVE_MODES[depot.data.reserveMode].options, ...(depot.data.reservePct !== null ? { investShare: 1 - depot.data.reservePct / 100 }
          : isNum(mc) ? { exposure: { model: true, share: 1 - Math.round(mc) / 100, text: `Reserve wie im Modell-Portfolio der Strategie „${label}“: ${Math.round(mc)} %.` } } : {}) },
      });
      advice = p ? { key, plan: p, time: new Date(), missing: rows.length - known.length } : null;
    }

    if (!advice || advice.key !== key) {
      el.innerHTML = `<section class="panel manager"><h2>Vorschläge</h2>
        <p class="loading"><span class="spinner" aria-hidden="true"></span> Die Vorschläge werden berechnet. Dafür lädt die Seite erst alle Kurse und Bewertungen – das dauert nach dem Öffnen etwa eine Minute.</p></section>`;
      return;
    }

    const p = advice.plan;
    const stale = Date.now() - advice.time > ADVICE_STALE_MS;
    const amount = (m) => `${m.units.toLocaleString(settings.locale, { maximumSignificantDigits: 4 })} ${esc(m.symbol.toUpperCase())}`;
    const cards = p.moves.map((m, i) => `<article class="move ${m.type}">
        <div class="move-top"><span class="move-type">${MOVE_LABEL[m.type]}</span><h3>${esc(m.title)}</h3><strong>${money(m.usd)}</strong></div>
        <p class="muted">${m.type === 'swap'
          ? `${amount(m)} abgeben → rund ${m.toUnits.toLocaleString(settings.locale, { maximumSignificantDigits: 4 })} ${esc(m.toCoin.symbol.toUpperCase())} erhalten · Gebühr rund ${money(m.fee)} (Verkauf und Kauf)`
          : `${m.type === 'buy' || m.type === 'add' ? 'Für' : 'Etwa'} ${amount(m)} zum Kurs von ${money(m.price)} · Gebühr rund ${money(m.fee)}`}</p>
        <dl>
          <div><dt>Ziel</dt><dd>${esc(m.goal)}</dd></div>
          <div><dt>Warum</dt><dd>${esc(m.reason)}</dd></div>
          <div><dt>Zeitrahmen</dt><dd>${esc(m.horizon)} ${esc(m.reviewText ?? `Erneut prüfen am ${dateText(m.review)}.`)}</dd></div>
        </dl>
        <button class="btn small" data-move="${i}">Als umgesetzt eintragen</button>
      </article>`).join('');
    const holds = p.holds.length ? `<p><strong>Halten:</strong> ${p.holds.map((h) => `${esc(h.name)} (${to100(h.score)}/100)`).join(', ')} – hier lohnt im Moment kein Handel.</p>` : '';
    // Oben auf der Seite: die nächsten Schritte in einem Satz, mit Sprung zu den Vorschlägen
    const next = $('#p-next');
    if (next) {
      const buys = p.moves.filter((m) => ['buy', 'add'].includes(m.type)).length, sells = p.moves.filter((m) => ['sell', 'reduce', 'profit'].includes(m.type)).length, swaps = p.moves.filter((m) => m.type === 'swap').length;
      next.hidden = false;
      next.innerHTML = `<div><div class="label">Nächste Schritte</div><strong>${p.moves.length
        ? [buys ? `${buys} ${buys === 1 ? 'Kauf' : 'Käufe'}` : '', sells ? `${sells} ${sells === 1 ? 'Verkauf' : 'Verkäufe'}` : '', swaps ? `${swaps} ${swaps === 1 ? 'Tausch' : 'Tausche'}` : ''].filter(Boolean).join(' · ')
        : 'Kein Handlungsbedarf'}</strong>
        <div class="muted">Reserve-Ziel ${num((1 - p.exposure.share) * 100, 0)} % · Kauf-Score des Markts ${state.market?.value ?? '–'}/100</div></div>
        ${p.moves.length ? '<button class="btn small" type="button" data-goto-moves>Zu den Vorschlägen</button>' : ''}`;
      next.querySelector('[data-goto-moves]')?.addEventListener('click', () => $('#p-manager').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }

    el.innerHTML = `<section class="panel manager">
      <div class="panel-top"><div><h2>Vorschläge</h2><div class="muted">Stand ${advice.time.toLocaleTimeString(settings.locale, { hour: '2-digit', minute: '2-digit' })} Uhr${stale ? ' – älter als 30 Minuten' : ''}</div></div>
        <div class="btn-row">${infoBtn('manager', 'So arbeitet der Manager')}<button class="btn ghost small" data-recalc>Neu berechnen</button></div></div>
      <p>${depot.data.reservePct === null && !p.exposure.model
          ? `${esc(p.exposure.text)} Reserve-Ziel nach der Strategie „${RESERVE_MODES[depot.data.reserveMode].label}“: ${num((1 - p.exposure.share) * 100, 0)} %.`
          : esc(p.exposure.text)}
        Investiert sind ${num(p.investedShare * 100, 0)} %; nach den Schritten wären es ${num(p.targetShare * 100, 0)} %.
        ${p.moves.length ? `Gebühren für alle Schritte zusammen: rund ${money(p.fees)}.` : ''}</p>
      ${advice.missing ? `<p class="notice">${advice.missing} Position(en) ohne Kurs sind nicht berücksichtigt.</p>` : ''}
      ${p.unplaced ? `<p class="notice">Rund ${money(p.unplaced.usd)} bleiben in Reserve, obwohl dein Ziel niedriger liegt: ${p.unplaced.reason === 'signals'
        ? (greedZone(state.market.regime) ? 'Die Gier-Bremse ist aktiv (Fear & Greed im 7-Tage-Schnitt über 75). Im Moment hat kein passender Coin ein Kaufsignal – der Trend der Altcoins ist gedeckelt, weil die meisten Coins danach fielen.'
          : 'Im Moment hat kein passender Coin ein Kaufsignal. In Coins ohne Kaufsignal schlägt der Manager nichts vor.')
        : 'Die Coins mit Kaufsignal sind bis zur Obergrenze je Coin gefüllt, weitere passende gibt es gerade nicht.'}</p>` : ''}
      ${cards || '<p><strong>Im Moment kein Handlungsbedarf.</strong> Dein Portfolio passt zur gewählten Reserve und zur Marktlage; jeder Handel würde nur Gebühren kosten.</p>'}
      ${holds}
    </section>`;
  }

  return self;
}

// ---------- Start ----------

// ---------- Betreiber: Übersicht der Nutzer ----------
// Nur für die Konten in SITE.owners / SITE.ownerMails; die Firestore-Regeln geben die Daten auch nur ihnen heraus.
// Die Seite bleibt deutsch (translate="no"): Sie ist für den Betreiber, nicht für Kunden.
const ADMIN_PAGES = { markt: 'Markt', coin: 'Coin-Details', portfolio: 'Portfolio', daytrading: 'Daytrading', konto: 'Konto', preise: 'Preise',
  agb: 'AGB', datenschutz: 'Datenschutz', impressum: 'Impressum', risiko: 'Risikohinweis' };
const ADMIN_ACCESS = { trial: 'Testphase', expired: 'Test abgelaufen', paid: 'Abo', owner: 'Betreiber', none: 'kein Zugang', open: 'offen' };
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
let adminTimer = null;

function adminView() {
  let users = null, error = null, loading = false, filter = '', sort = 'lastSeen';
  const openRows = new Set(), portfolios = new Map();
  const when = (t) => (t ? new Date(t).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  const ago = (t) => {
    if (!t) return '–';
    const d = Date.now() - t;
    return d < 2 * MINUTE ? 'gerade eben' : d < HOUR ? `vor ${Math.round(d / MINUTE)} Min.` : d < DAY ? `vor ${Math.round(d / HOUR)} Std.` : `vor ${Math.round(d / DAY)} Tagen`;
  };
  const state_ = (u) => (Date.now() - (u.lastSeen ?? 0) < 5 * MINUTE ? ['buy', 'online'] : Date.now() - (u.lastSeen ?? 0) < DAY ? ['hold', 'heute aktiv']
    : Date.now() - (u.lastSeen ?? 0) < 30 * DAY ? ['none', 'aktiv (30 Tage)'] : ['sell', 'inaktiv']);
  const accessText = (u) => `${ADMIN_ACCESS[u.access] ?? u.access ?? '–'}${u.accessUntil && ['trial', 'expired', 'paid'].includes(u.access) ? ` bis ${new Date(u.accessUntil).toLocaleDateString('de-CH')}` : ''}`;
  const total = (m) => Object.values(m ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const top = (m, n) => Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  const pageName = (p) => (p?.startsWith('coin/') ? `Coin: ${state.byId.get(p.slice(5))?.name ?? p.slice(5)}` : ADMIN_PAGES[p] ?? p ?? '–');

  async function load() {
    loading = true; render();
    try { users = await auth.listUsage(); error = null; } catch (err) { error = err.message; }
    loading = false; render();
  }

  async function loadPortfolio(uid) {
    if (portfolios.has(uid)) return;
    portfolios.set(uid, 'loading');
    try { portfolios.set(uid, await auth.readPortfolio(uid)); } catch (err) { portfolios.set(uid, { error: err.message }); }
    render();
  }

  function portfolioHtml(uid) {
    const p = portfolios.get(uid);
    if (p === undefined || p === 'loading') return '<p class="muted">Portfolio wird geladen …</p>';
    if (p === null) return '<p class="muted">Kein Portfolio gespeichert.</p>';
    if (p.error) return `<p class="notice">${esc(p.error)}</p>`;
    const rows = (p.positions ?? []).map((pos) => {
      const c = state.byId.get(pos.id) ?? null;
      return { name: c?.name ?? pos.name ?? pos.symbol, symbol: (pos.symbol || c?.symbol || '').toUpperCase(), amount: pos.amount, value: c ? pos.amount * c.current_price : null };
    }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const value = rows.reduce((s, r) => s + (r.value ?? 0), 0) + (p.cash ?? 0);
    const log = (p.log ?? []).slice(-10).reverse();
    return `<p><strong>${rows.length} Positionen</strong> · Wert rund ${money(value)} · Bargeld ${money(p.cash ?? 0)}
        · Reserve-Ziel ${p.reservePct ?? 'Strategie'}${p.reservePct === null || p.reservePct === undefined ? ` „${RESERVE_MODES[p.reserveMode ?? 'balanced']?.label ?? p.reserveMode}“` : ' %'}
        · Zustimmung AGB ${p.consent ? `${esc(p.consent.v)} am ${when(p.consent.t)}` : 'fehlt'}</p>
      ${rows.length ? `<p class="muted">${rows.map((r) => `${esc(r.name)} (${esc(r.symbol)}) ${r.value === null ? '' : money(r.value)}`).join(' · ')}</p>` : ''}
      ${log.length ? `<div class="label">Letzte Änderungen im Portfolio</div><ul class="admin-list">${log.map((e) => `<li><span class="muted">${when(e.t)}</span> ${esc(e.text ?? e.note ?? '')}</li>`).join('')}</ul>` : ''}`;
  }

  function detailHtml(u) {
    const pages = top(u.pages, 12), coins = top(u.coins, 10);
    return `<tr class="admin-detail"><td colspan="10"><div class="admin-grid">
        <div><div class="label">Bereiche (Aufrufe)</div><ul class="admin-list">${pages.map(([k, n]) => `<li>${esc(ADMIN_PAGES[k] ?? k)} <b>${n}</b></li>`).join('') || '<li class="muted">–</li>'}</ul>
          <div class="label">Meistgesehene Coins</div><ul class="admin-list">${coins.map(([k, n]) => `<li>${esc(state.byId.get(k)?.name ?? k)} <b>${n}</b></li>`).join('') || '<li class="muted">–</li>'}</ul></div>
        <div><div class="label">Zuletzt aufgerufen</div><ul class="admin-list">${(u.recent ?? []).map((r) => `<li><span class="muted">${when(r.t)}</span> ${esc(pageName(r.p))}</li>`).join('') || '<li class="muted">–</li>'}</ul></div>
        <div><div class="label">Konto</div><ul class="admin-list">
            <li>Konto erstellt: ${when(u.created)}</li><li>Erster Besuch erfasst: ${when(u.firstSeen)}</li><li>Anmeldung: ${u.provider === 'google' ? 'Google' : 'E-Mail'}</li>
            <li>Sprache ${esc(u.lang ?? '–')}, Währung ${esc((u.currency ?? '–').toUpperCase())}, ${esc(u.device ?? '–')}</li><li>Konto-Kennung: <code>${esc(u.uid)}</code></li></ul>
          <div class="label">Portfolio</div>${portfolioHtml(u.uid)}</div>
      </div></td></tr>`;
  }

  function render() {
    if (error) {
      view.innerHTML = `<div translate="no"><h1 class="page-title">Nutzerübersicht</h1><section class="panel"><p class="notice">${esc(error)}</p>
        <p>Wahrscheinlich sind die neuen Firestore-Regeln noch nicht veröffentlicht. In der Firebase-Konsole unter Firestore → Regeln den Inhalt
        der Datei <code>firestore.rules</code> einfügen und auf „Veröffentlichen“ klicken.</p><button class="btn" data-reload>Erneut laden</button></section></div>`;
      view.querySelector('[data-reload]').addEventListener('click', load);
      return;
    }
    if (!users) { view.innerHTML = '<div translate="no"><h1 class="page-title">Nutzerübersicht</h1><section class="panel"><p class="muted">Wird geladen …</p></section></div>'; return; }
    const now = Date.now(), seen = (u) => now - (u.lastSeen ?? 0);
    const count = (fn) => users.filter(fn).length;
    const card = (label, value, sub = '') => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="muted">${sub}</div></div>`;
    const q = filter.trim().toLowerCase();
    const list = users.filter((u) => !q || [u.email, u.name, u.uid].some((x) => x?.toLowerCase().includes(q)))
      .sort((a, b) => (sort === 'created' ? (b.created ?? 0) - (a.created ?? 0) : sort === 'visits' ? (b.visits ?? 0) - (a.visits ?? 0) : (b.lastSeen ?? 0) - (a.lastSeen ?? 0)));
    view.innerHTML = `<div translate="no">
      <div class="page-head"><div><h1 class="page-title">Nutzerübersicht</h1>
        <p class="hint">Erfasst wird jedes Konto ab seinem ersten Besuch mit dieser Version. „Online“ heißt: in den letzten 5 Minuten aktiv.</p></div>
        <div class="actions"><button class="btn ghost" data-reload>${loading ? 'Lädt …' : 'Aktualisieren'}</button></div></div>
      <div class="summary">
        ${card('Konten', users.length, `${count((u) => now - (u.created ?? 0) < 7 * DAY)} neu in 7 Tagen`)}
        ${card('Online', count((u) => seen(u) < 5 * MINUTE), 'letzte 5 Minuten')}
        ${card('Aktiv heute', count((u) => seen(u) < DAY), 'letzte 24 Stunden')}
        ${card('Aktiv 7 Tage', count((u) => seen(u) < 7 * DAY), `30 Tage: ${count((u) => seen(u) < 30 * DAY)}`)}
        ${card('In Testphase', count((u) => u.access === 'trial'), `abgelaufen: ${count((u) => u.access === 'expired')}`)}
        ${card('Mit Abo', count((u) => u.access === 'paid'), '')}
        ${card('Herkunft', '', Object.entries(users.reduce((m, u) => { const k = u.source ?? 'direkt'; m[k] = (m[k] ?? 0) + 1; return m; }, {}))
          .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || '–')}
      </div>
      <div class="admin-tools"><input type="search" id="ad-filter" placeholder="Suchen nach E-Mail, Name oder Kennung" value="${esc(filter)}">
        <label>Sortieren <select id="ad-sort"><option value="lastSeen">Zuletzt aktiv</option><option value="created">Neueste Konten</option><option value="visits">Meiste Besuche</option></select></label></div>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>E-Mail</th><th>Status</th><th>Zuletzt aktiv</th><th>Zuletzt gesehen</th><th class="num">Besuche</th>
        <th class="num">Aufrufe</th><th>Zugang</th><th>Erstellt</th><th>Herkunft</th><th></th></tr></thead><tbody>
        ${list.map((u) => {
          const [cls, label] = state_(u);
          return `<tr><td>${esc(u.email ?? u.name ?? u.uid)}</td><td><span class="badge ${cls}">${label}</span></td><td>${ago(u.lastSeen)}</td>
            <td>${esc(pageName(u.lastPage))}</td><td class="num">${u.visits ?? 0}</td><td class="num">${total(u.pages)}</td><td>${esc(accessText(u))}</td>
            <td>${u.created ? new Date(u.created).toLocaleDateString('de-CH') : '–'}</td><td>${esc(u.source ?? 'direkt')}</td>
            <td><button class="btn ghost small" data-user="${esc(u.uid)}">${openRows.has(u.uid) ? 'Schließen' : 'Details'}</button></td></tr>
            ${openRows.has(u.uid) ? detailHtml(u) : ''}`;
        }).join('') || '<tr><td colspan="10" class="empty">Noch keine erfassten Nutzer.</td></tr>'}
      </tbody></table></div></div>`;
    view.querySelector('#ad-sort').value = sort;
    view.querySelector('[data-reload]').addEventListener('click', load);
    view.querySelector('#ad-sort').addEventListener('change', (e) => { sort = e.target.value; render(); });
    const input = view.querySelector('#ad-filter');
    input.addEventListener('input', () => { filter = input.value; render(); const again = view.querySelector('#ad-filter'); again.focus(); again.setSelectionRange(filter.length, filter.length); });
    for (const b of view.querySelectorAll('[data-user]')) b.addEventListener('click', () => {
      const uid = b.dataset.user;
      if (openRows.has(uid)) openRows.delete(uid); else { openRows.add(uid); loadPortfolio(uid); }
      render();
    });
  }

  load();
  // Alle zwei Minuten neu laden, damit „online“ stimmt; die Kurs-Aktualisierungen bauen die Seite nicht jedes Mal neu
  clearInterval(adminTimer);
  adminTimer = setInterval(() => { if (location.hash.startsWith('#/admin') && current?.admin === load) load(); else clearInterval(adminTimer); }, 2 * MINUTE);
  return { update() {}, admin: load };
}

// ---------- Zyklus-Kompass: Zyklus-Indikatoren mit Rückblick (Daten: /data/indices.json, scripts/indices.mjs) ----------
// Die aktuellen Werte sind für alle sichtbar. Verläufe und Rückblick-Tabellen gibt es mit Paket oder Testphase – das ist
// der Teil, der über eine Momentaufnahme hinausgeht.
let indicesData = null;
const loadIndices = () => (indicesData ??= fetch(['localhost', '127.0.0.1'].includes(location.hostname) ? 'out/indices.json' : `/data/indices.json?t=${Math.floor(Date.now() / 3_600_000)}`)
  .then((r) => (r.ok ? r.json() : null)).catch(() => null));
const RISK_COLORS = [...SELL_TO_BUY].reverse();   // links grün (tief), rechts rot (überhitzt)
const RISK_LABEL = (v) => (RISK_ZONES.find(([lo, hi]) => v >= lo && v < hi) ?? RISK_ZONES[RISK_ZONES.length - 1])[2];
const RISK_TEXT = {
  Tief: 'Bitcoin steht tief im Zyklus – historisch die besten Einstiege für Geduldige.',
  Günstig: 'Eher günstig bewertet – kein Überschwang zu sehen.',
  Neutral: 'Weder günstig noch überhitzt.',
  Erhitzt: 'Der Markt läuft heiß – Vorsicht bei neuen Käufen.',
  Überhitzt: 'Überhitzt – in vergangenen Zyklen folgten darauf oft starke Rückgänge.',
};
const BUY_OF_RISK = { Tief: 'Kaufen', Günstig: 'Eher kaufen', Neutral: 'Halten', Erhitzt: 'Eher verkaufen', Überhitzt: 'Verkaufen' };
const seasonLabel = (v) => (v >= 75 ? 'Altcoin-Saison' : v <= 25 ? 'Bitcoin-Saison' : 'Übergang');
const dayMs = (d) => d * 86_400_000;

// Rückblick-Tabelle: je Bereich, wie oft Bitcoin 90 Tage und 1 Jahr später höher stand – alle Tage seit Januar 2022
const btCell = (b, h) => b[h] ?? b.periods?.[1]?.[h];   // ältere Datei: zwei Zeiträume, der zweite ist der neuere
function backtestTable(rows, current) {
  const cell = (x) => (x ? `<strong class="${x.up >= 55 ? 'up' : x.up <= 45 ? 'down' : ''}">${x.up} %</strong><div class="muted fc-range">Median ${signed(x.median, 0)} %</div>` : '<span class="muted">–</span>');
  return `<div class="table-wrap"><table class="bt-table"><thead><tr><th>Bereich</th><th class="num">90 Tage später</th><th class="num">1 Jahr später</th></tr></thead>
    <tbody>${rows.map((b) => `<tr class="${current >= b.lo && current < b.hi ? 'now' : ''}"><td>${esc(b.label)}${current >= b.lo && current < b.hi ? ' <span class="badge hold">heute</span>' : ''}</td>
      <td class="num">${cell(btCell(b, '90'))}</td><td class="num">${cell(btCell(b, '365'))}</td></tr>`).join('')}</tbody></table></div>
    <p class="hint">Anteil der Tage seit Januar 2022, nach denen Bitcoin höher stand, und das mittlere Ergebnis. „–“: zu wenige Tage in diesem Bereich. Ein Zyklus ist eine schmale Grundlage.</p>`;
}

function compassView() {
  markSeen('compass');
  const open = () => !!access().plan;
  view.innerHTML = `
    <section class="panel compass-head">
      <div class="label">Neu · Zyklus-Kompass</div>
      <h1 class="page-title">Wo steht Bitcoin im Zyklus?</h1>
      <p class="muted">Die bekanntesten Zyklus-Indikatoren an einem Ort – und zu jedem der ehrliche Rückblick: Wie oft stand Bitcoin danach wirklich höher?
        Dazu unser eigener Index, der Kauf-Score – dieselbe Zahl wie auf der Startseite.</p>
    </section>
    <div id="compass"><section class="panel"><p class="muted">Lade die Indikatoren …</p></section></div>`;

  async function render() {
    const x = await loadIndices();
    const el = $('#compass');
    if (!el) return;
    if (!x) { el.innerHTML = '<section class="panel"><p class="muted">Die Indikatoren sind gerade nicht erreichbar. Bitte später noch einmal versuchen.</p></section>'; return; }
    const full = open();
    const lockedBox = (what) => `<div class="locked-box"><span aria-hidden="true">🔒</span><div><strong>${what}</strong>
        <div class="muted">Mit einem kostenlosen Konto 30 Tage lang sichtbar, danach im Paket ${esc(SITE.plans.standard.name)}.</div></div>
        <a class="btn" href="${depot.user ? '#/preise' : '#/konto'}">${depot.user ? 'Pakete ansehen' : 'Kostenlos starten'}</a></div>`;
    const chartBox = (id) => (full ? `<div id="${id}" class="chart small-chart"></div>` : lockedBox('Verlauf und Rückblick'));
    // Derselbe Wert wie der Kauf-Score der Startseite (live gerechnet), damit beide Seiten immer übereinstimmen
    const live = state.market?.buy;
    const r = live ? { ...x.risk, value: 100 - live.value, parts: live.parts } : x.risk, label = RISK_LABEL(r.value);
    const buy = 100 - r.value, buyLabel = live?.label ?? BUY_OF_RISK[label];
    // Rückblick-Bereiche des Zyklus-Risikos als Kauf-Score-Stufen (Risiko unter 25 = Kauf-Score über 75 usw.)
    // 1 Jahr: dieselbe Tabelle wie Startseite, Coin-Seiten und Beiträge (unter 45 seit 2018, sonst zu wenige Tage)
    const buyRows = r.backtest.map((b) => ({ ...b, ...(btCell(b, '365') ? { 365: yearAfterBuy(100 - (b.lo + Math.min(100, b.hi)) / 2).btc } : {}), label: `${BUY_OF_RISK[b.label] ?? b.label} · ${Math.max(0, 100 - b.hi)}–${100 - b.lo}` }));
    const y1 = yearAfterBuy(100 - r.value)?.btc;
    const s = x.altseason, d = x.dominance;
    el.innerHTML = `
      <section class="panel compass-risk">
        <div class="gauge-panel"><div class="label">Kauf-Score</div>${gauge(buy, SELL_TO_BUY)}
          <div class="gauge-value">${num(buy, 0)}<small> / 100</small></div><span class="badge big ${buy >= 62 ? 'buy' : buy >= 45 ? 'hold' : 'sell'}">${buyLabel}</span></div>
        <div>
          <h2>${RISK_TEXT[label]}</h2>
          ${y1 ? `<div class="buy-history"><div class="label">Nach Ständen wie heute · seit 2022</div>
            <div class="bh-grid"><div><strong class="${y1.up >= 55 ? 'up' : y1.up <= 45 ? 'down' : ''}">${y1.up} %</strong><span>Bitcoin ein Jahr später höher</span></div>
            <div><strong class="${tone(y1.median)}">${signed(y1.median, 0)} %</strong><span>mittleres Ergebnis nach einem Jahr</span></div></div></div>` : ''}
          <div class="label">Das steckt im Kauf-Score</div>
          ${buyInputs(live ?? { parts: r.parts })}
          <p class="hint">Zyklus-Risiko ${num(r.value, 0)}/100 · ${label} · dieselbe Rechnung, andersherum gezählt ${infoBtn('compass')}</p>
        </div>
        <div class="compass-wide">${full ? `${backtestTable(buyRows, r.value)}<p class="hint">Unter einem Kauf-Score von 45 ist „1 Jahr später“ seit 2018 gerechnet, weil es seit 2022 zu wenige solche Tage gab.</p>` : ''}${chartBox('c-risk')}</div>
      </section>
      <div class="compass-grid">
        ${s ? `<section class="panel"><div class="label">Altcoin-Saison-Index</div>
          <div class="ind-value">${s.value}<small> / 100</small></div><span class="badge ${s.value >= 75 ? 'buy' : s.value <= 25 ? 'sell' : 'hold'}">${seasonLabel(s.value)}</span>
          <p class="hint">${s.value} % der ${s.n} größten Coins liefen in 90 Tagen besser als Bitcoin (${signed(s.btc90, 0)} %). Ab 75 spricht man von Altcoin-Saison, bis 25 von Bitcoin-Saison.</p>
          ${full ? `<div class="mini-lists"><div><div class="label">Vorne</div>${s.leaders.map((l) => `<div>${esc(l.symbol)} <span class="up">${signed(l.ret, 0)} %</span></div>`).join('')}</div>
            <div><div class="label">Hinten</div>${s.laggards.map((l) => `<div>${esc(l.symbol)} <span class="down">${signed(l.ret, 0)} %</span></div>`).join('')}</div></div>` : ''}
          ${chartBox('c-season')}</section>` : ''}
        <section class="panel"><div class="label">Pi-Cycle-Top</div>
          <div class="ind-value">${num(x.pi.ratio * 100, 0)}<small> %</small></div><span class="badge ${x.pi.ratio >= 0.95 ? 'sell' : x.pi.ratio >= 0.8 ? 'hold' : 'buy'}">${x.pi.ratio >= 1 ? 'Signal: Hoch' : x.pi.ratio >= 0.95 ? 'Kurz vor dem Signal' : 'Kein Signal'}</span>
          <p class="hint">Der 111-Tage-Schnitt (${money(x.pi.sma111)}) steht bei ${num(x.pi.ratio * 100, 0)} % des doppelten 350-Tage-Schnitts (${money(x.pi.line)}). Bei 100 % kreuzen sie – das traf zuletzt im April 2021 das damalige Hoch.</p>
          ${full ? backtestTable(x.pi.backtest, x.pi.ratio) : ''}${chartBox('c-pi')}</section>
        <section class="panel"><div class="label">Mayer-Multiple</div>
          <div class="ind-value">${num(x.mayer.value, 2)}</div><span class="badge ${x.mayer.value >= 2.4 ? 'sell' : x.mayer.value < 0.8 ? 'buy' : 'hold'}">${x.mayer.value >= 2.4 ? 'Überhitzt' : x.mayer.value < 0.8 ? 'Günstig' : 'Normal'}</span>
          <p class="hint">Kurs geteilt durch den 200-Tage-Schnitt (${money(x.mayer.sma200)}). Unter 0,8 galt Bitcoin historisch als günstig, über 2,4 als überhitzt.</p>
          ${full ? backtestTable(x.mayer.backtest, x.mayer.value) : ''}${chartBox('c-mayer')}</section>
        <section class="panel"><div class="label">2-Jahres-MA-Multiplikator</div>
          <div class="ind-value">${num(x.twoYear.ratio, 2)}<small>×</small></div><span class="badge ${x.twoYear.ratio < 1 ? 'buy' : x.twoYear.ratio >= 3.5 ? 'sell' : 'hold'}">${x.twoYear.ratio < 1 ? 'Kaufzone' : x.twoYear.ratio >= 5 ? 'Verkaufszone' : 'Dazwischen'}</span>
          <p class="hint">Kurs im Verhältnis zum 2-Jahres-Schnitt (${money(x.twoYear.sma730)}). Darunter lag historisch die Kaufzone, über dem Fünffachen (${money(x.twoYear.top)}) die Verkaufszone.</p>
          ${full ? backtestTable(x.twoYear.backtest, x.twoYear.ratio) : ''}${chartBox('c-2y')}</section>
        <section class="panel"><div class="label">Volatilität (30 Tage)</div>
          <div class="ind-value">${num(x.volatility.value, 0)}<small> % p. a.</small></div><span class="badge hold">ruhiger als an ${100 - x.volatility.percentile} % der Tage</span>
          <p class="hint">Wie stark Bitcoin zuletzt schwankte, aufs Jahr gerechnet – eingeordnet gegen die letzten 4 Jahre. Lange ruhige Phasen endeten oft mit einer großen Bewegung, die Richtung verrät die Ruhe nicht.</p>
          ${chartBox('c-vol')}</section>
        ${d ? `<section class="panel"><div class="label">Bitcoin-Dominanz</div>
          <div class="ind-value">${num(d.btc, 1)}<small> %</small></div><span class="badge hold">Ethereum ${num(d.eth, 1)} %</span>
          <p class="hint">Anteil von Bitcoin am Marktwert aller Coins. Steigt er, fließt Geld eher in Bitcoin; sinkt er deutlich, laufen oft die Altcoins.</p></section>` : ''}
      </div>
      <p class="hint">Stand ${new Date(x.time).toLocaleString(settings.locale)} · Tageskurse von Binance seit ${new Date(x.since).getUTCFullYear()}, Fear & Greed von alternative.me, Dominanz von CoinGecko.
        Indikatoren beschreiben vergangene Zyklen – keine Garantie für den nächsten. Keine Anlageberatung.</p>
      <p class="share-row hint">${shareLinks(shareUrl('#/indikatoren'), `${i18n.say('Kauf-Score')}: ${buy}/100 (${i18n.say(buyLabel)}) – Coinweather`)}</p>`;
    if (!full) return;
    const line = (id, hist, opts = {}) => { const box = $(`#${id}`); if (!box || !hist?.length) return; drawChart(box, { t: hist.map((h) => dayMs(h[0])), p: hist.map((h) => h[1]), plain: true, ...opts }); };
    line('c-risk', r.history.map((h) => [h[0], 100 - h[1]]), { note: 'Kauf-Score' });
    line('c-season', s?.history, { note: 'Altcoin-Saison-Index' });
    line('c-pi', x.pi.history.map((h) => [h[0], h[1] * 100]), { note: 'Pi-Cycle: 111-Tage-Schnitt in % des doppelten 350-Tage-Schnitts', marker: null });
    line('c-mayer', x.mayer.history, { note: 'Mayer-Multiple' });
    line('c-2y', x.twoYear.history, { note: 'Kurs / 2-Jahres-Schnitt' });
    line('c-vol', x.volatility.history, { note: 'Volatilität in % pro Jahr' });
  }
  let shown = null;
  return { update() { const key = `${!!access().plan}|${state.market?.buy?.value ?? ''}`; if (key === shown) return; shown = key; render(); } };
}

// ---------- Modell-Portfolio: der Portfolio-Manager als Musterdepot zum Mitverfolgen ----------
// Wertentwicklung gegen Bitcoin ist für alle sichtbar; was das Modell gerade hält und zuletzt gehandelt hat, gehört zum Paket Komplett.
const TRADE_TYPE = { buy: 'Kauf', add: 'Aufstocken', sell: 'Verkauf', reduce: 'Reduzieren', profit: 'Gewinnmitnahme', 'swap-in': 'Tausch: gekauft', 'swap-out': 'Tausch: verkauft' };

async function modelSection(el) {
  const c = await loadModelCurve();
  if (!el.isConnected) return;
  if (!c?.nav?.length) { el.innerHTML = '<section class="panel"><p class="muted">Das Modell-Portfolio ist gerade nicht erreichbar. Bitte später noch einmal versuchen.</p></section>'; return; }
  const full = access().plan === 'full';
  const startYear = new Date(c.t[0]).getUTCFullYear();
  const stat = (label, value, cls = '', sub = '') => `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="muted">${sub}</div>` : ''}</div>`;
  // Rendite über die letzten n Tage (pro Jahr ab einem Jahr) – für Modell und Bitcoin
  const since = (arr, days) => { const i = Math.max(0, arr.length - 1 - days); const a = arr[i], b = arr[arr.length - 1]; if (!(a > 0) || !(b > 0)) return null;
    const years = (arr.length - 1 - i) / 365; return years > 1.01 ? (Math.pow(b / a, 1 / years) - 1) * 100 : (b / a - 1) * 100; };
  const y1 = since(c.nav, 365), y4 = since(c.nav, 1461), b1 = c.btc ? since(c.btc, 365) : null, b4 = c.btc ? since(c.btc, 1461) : null;
  const lockedBox = (what) => `<div class="locked-box"><span aria-hidden="true">🔒</span><div><strong>${what}</strong>
      <div class="muted">Mit einem kostenlosen Konto 30 Tage lang sichtbar, danach im Paket ${esc(SITE.plans.full.name)}.</div></div>
      <a class="btn" href="${depot.user ? '#/preise' : '#/konto'}">${depot.user ? 'Pakete ansehen' : 'Kostenlos starten'}</a></div>`;
  const date = (ms) => new Date(ms).toLocaleDateString(settings.locale);
  el.innerHTML = `
    <section class="panel model-head">
      <div class="label">Modell-Portfolio</div>
      <h2>Der Portfolio-Manager als Musterdepot</h2>
      <p class="muted">So wäre ein Depot gelaufen, das seit ${startYear} jede Woche genau den Regeln des Portfolio-Managers folgt – mit Reserve in schwachen Phasen,
        Auswahl aus ${c.coins} geprüften Coins und 0,25 % Gebühr je Handel. Daneben Bitcoin zum Vergleich.</p>
      <div class="kpi-grid">
        ${isNum(y1) ? stat('Letzte 12 Monate', `${signed(y1, 0)} %`, tone(y1), isNum(b1) ? `Bitcoin ${signed(b1, 0)} %` : '') : ''}
        ${isNum(y4) ? stat('Letzte 4 Jahre', `${signed(y4, 0)} % pro Jahr`, tone(y4), isNum(b4) ? `Bitcoin ${signed(b4, 0)} % pro Jahr` : '') : ''}
        ${stat(`Seit ${startYear}`, `${signed(c.stats.cagr, 0)} % pro Jahr`, tone(c.stats.cagr), `Bitcoin ${signed(c.stats.btcCagr, 0)} % pro Jahr`)}
        ${stat('Größter Rückgang', `${num(c.stats.maxDrawdown, 0)} %`, 'down')}
        ${stat('Reserve heute', `${num(c.cash, 0)} %`)}
      </div>
      <div class="panel-top"><span></span><div class="chips" id="m-range"><button class="chip active" data-years="4">4 Jahre</button><button class="chip" data-years="0">seit ${startYear}</button></div></div>
      <div id="m-chart" class="chart"></div>
      <p class="hint">Diese Kurve beginnt an einem bestimmten Wochentag. Je nach Starttag schwankt das Ergebnis um rund ±10 Punkte pro Jahr – im Mittel aus 7 Starttagen:
        +${RESERVE_BACKTEST.balanced.perYear} % pro Jahr, seit 2022 +${RESERVE_BACKTEST.balanced.recent} %, größter Rückgang −${RESERVE_BACKTEST.balanced.drawdown} %.</p>
      ${autopilotLive()}
      ${(state.record?.ap?.series?.length ?? 0) >= 3 ? '<div class="label">Live-Messung (Start = 100)</div><div id="m-live" class="chart small-chart"></div>' : ''}
      <p class="hint"><strong>Wichtig:</strong> Das ist eine Rückrechnung an den Kursen, an denen die Regeln entwickelt wurden. Die Zukunft fällt meist schlechter aus;
        Coins, die es nicht mehr gibt, fehlen; Steuern sind nicht berücksichtigt. Keine Anlageberatung.</p>
    </section>
    <div class="model-grid">
      <section class="panel"><h2>Bestand heute</h2>
        ${full ? `<table class="m-table">${c.holdings.map((h) => `<tr><td><strong>${esc(h.symbol)}</strong></td><td class="num">${num(h.share, 1)} %</td><td class="m-bar"><span class="mini-bar"><i style="width:${Math.min(100, h.share)}%;background:var(--accent)"></i></span></td></tr>`).join('')}
          <tr><td>Reserve (Bargeld)</td><td class="num">${num(c.cash, 1)} %</td><td class="m-bar"><span class="mini-bar"><i style="width:${Math.min(100, c.cash)}%;background:var(--muted)"></i></span></td></tr></table>
          <p class="hint">Stand ${date(c.asOf)} · wird jeden Morgen neu gerechnet.</p>` : lockedBox('Bestand des Modell-Portfolios')}
      </section>
      <section class="panel"><h2>Letzte Käufe und Verkäufe</h2>
        ${full ? `<table class="m-table">${c.trades.slice(0, 15).map((tr) => `<tr><td class="muted">${date(tr.t)}</td><td><span class="tag ${['buy', 'add', 'swap-in'].includes(tr.type) ? 'up' : 'down'}">${TRADE_TYPE[tr.type] ?? tr.type}</span></td>
            <td><strong>${esc(tr.symbol)}</strong></td><td class="num">${num(tr.share, 1)} %</td></tr>`).join('')}</table>
          <p class="hint">Anteil am Wert des Portfolios zum Zeitpunkt des Handels.</p>` : lockedBox('Handel des Modell-Portfolios')}
      </section>
    </div>
    <section class="panel upsell"><div><h3>Diesem Modell mit deinem eigenen Geld folgen</h3>
      <p class="muted">Der Autopilot im Portfolio sagt dir, was du kaufst, damit dein Portfolio genau diesem Modell folgt – und meldet sich, wenn sich etwas ändert.
        Hast du schon Coins, prüft der Manager sie auf Wunsch einzeln. Ausführen tust du alles selbst bei deiner Börse.</p></div>
      <div class="btn-row"><a class="btn" href="${depot.user ? '#/portfolio' : '#/konto'}">${depot.user ? 'Autopilot starten' : 'Kostenlos starten'}</a></div></section>
    <p class="share-row hint">${shareLinks(shareUrl('#/modell'), `${i18n.say('Modell-Portfolio des Portfolio-Managers')}: ${signed(c.stats.cagr, 0)} % / ${i18n.say('Jahr')} – Coinweather`)}</p>`;
  // Diagramm: beide Linien ab dem gewählten Start auf 100 gesetzt
  const chart = (years) => {
    const from = years ? Math.max(0, c.nav.length - 1 - years * 365) : 0;
    const base = c.nav[from], bb = c.btc?.[from];
    drawChart($('#m-chart'), { t: c.t.slice(from), p: c.nav.slice(from).map((v) => v / base * 100), plain: true, note: 'Modell-Portfolio (Start = 100)',
      overlays: c.btc ? [{ values: c.btc.slice(from).map((v) => (v === null ? null : v / bb * 100)), color: 'var(--muted)', label: 'Bitcoin (Start = 100)' }] : [] });
  };
  chart(4);
  // Live-Messung seit dem Start: Autopilot und Bitcoin, beide auf 100 gesetzt
  const live = state.record?.ap?.series;
  if ($('#m-live') && live?.length >= 3) {
    drawChart($('#m-live'), { t: live.map(([d]) => d * 86_400_000 + 43_200_000), p: live.map(([, v]) => v), plain: true, note: 'Autopilot live',
      overlays: [{ values: live.map(([, , b]) => b), color: 'var(--muted)', label: 'Bitcoin' }] });
  }
  $('#m-range').addEventListener('click', (e) => {
    const b = e.target.closest('[data-years]');
    if (!b) return;
    for (const x of $('#m-range').children) x.classList.toggle('active', x === b);
    chart(Number(b.dataset.years));
  });
}

// ---------- Challenge: Schlag den Autopiloten (#/challenge?c=bitcoin@80728,solana@190&d=20751&n=Name) ----------
// Für alle offen, ohne Konto und ohne Server: Auswahl, Startkurse und Starttag stehen in der Adresse. Verglichen wird mit echten
// Kursen gegen die Live-Messung des Autopiloten (state.record.ap) und Bitcoin. Wer den Link teilt, lädt andere zum Mitmachen ein.
const CHALLENGE_KEY = 'coinwetter-challenge';
function challengeView() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const picks = (params.get('c') ?? '').split(',').map((x) => x.split('@')).filter(([id, p]) => id && Number(p) > 0).slice(0, 3).map(([id, p]) => ({ id, p0: Number(p) }));
  const day0 = Number(params.get('d')) || null, who = (params.get('n') ?? '').slice(0, 24);
  let mine = null; try { mine = localStorage.getItem(CHALLENGE_KEY); } catch { /* ohne Speicher */ }
  view.innerHTML = `
    <section class="panel challenge-head">
      <div class="label">🏁 Challenge</div>
      <h1 class="page-title">Schlag den Autopiloten</h1>
      <p class="muted">Wähle bis zu drei Coins. Ab heute vergleichen wir mit echten Kursen: deine Auswahl gegen den Autopiloten und gegen Bitcoin.
        Teile den Link – wer schlägt euch beide?</p>
      <form id="ch-form" class="calc-form ch-form">
        ${[1, 2, 3].map((i) => `<label>Coin ${i}<input id="ch-c${i}" list="ch-coins" autocomplete="off" ${i === 1 ? 'required' : ''} placeholder="${i === 1 ? 'z. B. Solana' : 'optional'}"></label>`).join('')}
        <label>Dein Name (optional)<input id="ch-name" maxlength="24" autocomplete="off"></label>
        <datalist id="ch-coins"></datalist>
        <button class="btn" type="submit">Antreten</button>
      </form>
      ${mine && !picks.length ? `<p><a class="btn ghost small" href="${esc(mine)}">Meine Challenge ansehen</a></p>` : ''}
    </section>
    <div id="ch-out"></div>`;
  const find = (text) => {
    const q = text.trim().toLowerCase();
    if (!q) return null;
    return state.byId.get(q) ?? state.coins.find((c) => c.name.toLowerCase() === q || c.symbol.toLowerCase() === q)
      ?? state.coins.find((c) => (c.market_cap_rank ?? 9999) <= 500 && (c.name.toLowerCase().startsWith(q) || c.symbol.toLowerCase().startsWith(q)));
  };
  $('#ch-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const chosen = [1, 2, 3].map((i) => find($(`#ch-c${i}`).value)).filter((c) => c && isNum(c.current_price) && !c.analysis?.stable);
    const uniq = [...new Map(chosen.map((c) => [c.id, c])).values()];
    if (!uniq.length) return;
    const today = Math.floor(Date.now() / 86_400_000);
    const name = $('#ch-name').value.trim().slice(0, 24);
    const hash = `#/challenge?c=${uniq.map((c) => `${encodeURIComponent(c.id)}@${Number(c.current_price.toPrecision(6))}`).join(',')}&d=${today}${name ? `&n=${encodeURIComponent(name)}` : ''}`;
    try { localStorage.setItem(CHALLENGE_KEY, hash); } catch { /* nur jetzt */ }
    location.hash = hash;
  });

  function render() {
    const out = $('#ch-out');
    if (!out || !picks.length || !state.coins.length) return;
    const ap = state.record?.ap;
    // Wert an einem Tag aus der Live-Messung; vor ihrem Start gilt ihr erster Tag
    const at = (d) => { const s = ap?.series ?? []; return s.filter(([x]) => x <= d).pop() ?? s[0] ?? null; };
    // Autopilot und Bitcoin erst ab dem Start der Live-Messung – davor gibt es keine echten Werte
    const start = day0 && ap && day0 >= ap.since ? at(day0) : null, now = ap?.series?.at(-1) ?? null;
    const apRet = start && now ? (now[1] / start[1] - 1) * 100 : null;
    const btcRet = start && now ? (now[2] / start[2] - 1) * 100 : null;
    const rows = picks.map((p) => { const c = state.byId.get(p.id); return { c, p, r: c && isNum(c.current_price) ? (c.current_price / p.p0 - 1) * 100 : null }; });
    const valid = rows.filter((x) => isNum(x.r));
    const myRet = valid.length ? valid.reduce((a, x) => a + x.r, 0) / valid.length : null;
    const days = day0 ? Math.max(0, Math.floor(Date.now() / 86_400_000) - day0) : 0;
    const label = who ? who : i18n.say('Deine Auswahl');
    const all = [[label, myRet, 'var(--accent)'], ['🤖 Autopilot', apRet, 'var(--up)'], ['₿ Bitcoin', btcRet, 'var(--accent-2)']].filter(([, v]) => isNum(v));
    const max = Math.max(1, ...all.map(([, v]) => Math.abs(v)));
    const best = all.length ? all.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    const url = `${location.origin}/${location.hash}`;
    out.innerHTML = `<section class="panel challenge">
        <div class="label">${who ? `${esc(who)} – ` : ''}seit ${new Date((day0 ?? 0) * 86_400_000).toLocaleDateString(settings.locale)} · ${days} ${days === 1 ? 'Tag' : 'Tage'}</div>
        <h2>${best && days >= 1 ? `🏆 ${esc(best[0])} liegt vorne` : 'Die Challenge läuft – morgen gibt es die ersten Ergebnisse'}</h2>
        <div class="ch-bars">${all.map(([n, v, color]) => `<div class="ch-bar"><span class="ch-name">${esc(n)}</span>
          <span class="ch-track"><i style="width:${Math.max(2, Math.abs(v) / max * 100)}%;background:${color}"></i></span><strong class="${tone(v)}">${signed(v, 1)} %</strong></div>`).join('')}</div>
        <table class="m-table ch-table"><thead><tr><th>Coin</th><th class="num">Start</th><th class="num">Jetzt</th><th class="num">Veränderung</th></tr></thead><tbody>
          ${rows.map(({ c, p, r }) => `<tr><td>${c ? `<a href="#/coin/${encodeURIComponent(c.id)}">${esc(c.name)}</a>` : esc(p.id)}</td><td class="num">${money(p.p0)}</td>
            <td class="num">${c ? money(c.current_price) : '–'}</td><td class="num ${tone(r)}">${isNum(r) ? `${signed(r, 1)} %` : '–'}</td></tr>`).join('')}</tbody></table>
        ${!isNum(apRet) ? '<p class="hint">Der Vergleich mit dem Autopiloten erscheint, sobald seine Live-Messung für diesen Zeitraum vorliegt.</p>' : ''}
        <p class="hint">Gleich gewichtet, ohne Gebühren. Der Autopilot mit 0,25 % Gebühr je Handel und Reserve. Keine Anlageberatung.</p>
        <p class="share-row hint">${shareLinks(url, i18n.say('Ich trete gegen den Krypto-Autopiloten an – schlägst du uns beide?'), 'Herausfordern')}</p>
      </section>
      <section class="panel upsell"><div><h3>Lieber gleich mit dem Autopiloten?</h3>
        <p class="muted">Du sagst, wie viel du anlegen willst – der Autopilot sagt dir, was du kaufst. 30 Tage kostenlos, ohne Zahlungsdaten.</p></div>
        <div class="btn-row"><a class="btn" href="${depot.user ? '#/portfolio' : '#/konto'}" data-next="#/portfolio">${depot.user ? 'Autopilot starten' : 'Kostenlos starten'}</a></div></section>`;
  }
  let filled = false;
  return { update() {
    if (!filled && state.coins.length) {
      filled = true;
      $('#ch-coins').innerHTML = state.coins.filter((c) => (c.market_cap_rank ?? 9999) <= 300 && !c.analysis?.stable && !DERIVATIVE.test(c.name))
        .map((c) => `<option value="${esc(c.name)}">${esc(c.symbol.toUpperCase())}</option>`).join('');
      picks.forEach((p, i) => { const c = state.byId.get(p.id); if (c && $(`#ch-c${i + 1}`)) $(`#ch-c${i + 1}`).value = c.name; });
    }
    render();
  } };
}

// ---------- Coin-Vergleich: zwei Coins nebeneinander (#/vergleich/bitcoin,ethereum) ----------
// Kurse und Kennzahlen sind für alle sichtbar; das Signal nur, wo es auch sonst sichtbar ist (Paket oder Beispiel-Coin).
function compareView(arg) {
  const ids = (arg ?? '').split('?')[0].split(',').filter(Boolean);
  const pick = { a: ids[0] || 'bitcoin', b: ids[1] || 'ethereum' };
  let range = 365, run = 0;
  view.innerHTML = `
    <section class="panel calc">
      <div class="label">Coin-Vergleich</div>
      <h1 class="page-title">Zwei Coins im Vergleich</h1>
      <form id="cmp-form" class="calc-form cmp-form">
        <label>Coin 1<input id="cmp-a" list="cmp-coins" autocomplete="off" required></label>
        <label>Coin 2<input id="cmp-b" list="cmp-coins" autocomplete="off" required></label>
        <datalist id="cmp-coins"></datalist>
        <button class="btn" type="submit">Vergleichen</button>
      </form>
    </section>
    <div id="cmp-out"></div>`;
  const find = (text) => {
    const q = text.trim().toLowerCase();
    return state.byId.get(q) ?? state.coins.find((c) => c.name.toLowerCase() === q || c.symbol.toLowerCase() === q)
      ?? state.coins.find((c) => c.name.toLowerCase().startsWith(q) || c.symbol.toLowerCase().startsWith(q));
  };
  function fill() {
    if (!state.coins.length) return;
    $('#cmp-coins').innerHTML = state.coins.filter((c) => (c.market_cap_rank ?? 9999) <= 300 && c.analysis?.signal !== 'none')
      .map((c) => `<option value="${esc(c.name)}">${esc(c.symbol.toUpperCase())}</option>`).join('');
    if (!$('#cmp-a').value) $('#cmp-a').value = state.byId.get(pick.a)?.name ?? '';
    if (!$('#cmp-b').value) $('#cmp-b').value = state.byId.get(pick.b)?.name ?? '';
  }
  async function compare() {
    const a = find($('#cmp-a').value), b = find($('#cmp-b').value), out = $('#cmp-out');
    if (!a || !b) { out.innerHTML = '<section class="panel"><p class="muted">Diesen Coin kenne ich nicht. Wähle einen aus der Liste.</p></section>'; return; }
    pick.a = a.id; pick.b = b.id;
    history.replaceState(null, '', `#/vergleich/${encodeURIComponent(a.id)},${encodeURIComponent(b.id)}`);
    const mine = ++run;
    out.innerHTML = '<section class="panel"><p class="muted">Lade Kursgeschichte …</p></section>';
    try {
      const [da, db] = await Promise.all([dailyOf(a), dailyOf(b)]);
      if (mine !== run || current?.cmp !== true) return;
      // Gemeinsame Tage der letzten „range“ Tage, beide Kurse auf 100 gesetzt
      const mapB = new Map(db.t.map((t, i) => [Math.floor(t / 86_400_000), db.p[i]]));
      const from = Date.now() - range * 86_400_000;
      const rows = da.t.map((t, i) => [t, da.p[i], mapB.get(Math.floor(t / 86_400_000))]).filter((r) => r[0] >= from && r[2] > 0);
      const show = (c) => !!access().plan || SAMPLES.includes(c.id);
      const vol = (d) => { const p = d.p.slice(-91); const r = p.slice(1).map((x, i) => Math.log(x / p[i])); const mu = r.reduce((s, x) => s + x, 0) / r.length;
        return Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (r.length - 1)) * 100; };
      const line = (label, fa, fb, cls) => `<tr><td>${label}</td><td class="num ${cls ? tone(fa) : ''}">${fa}</td><td class="num ${cls ? tone(fb) : ''}">${fb}</td></tr>`;
      const pc = (c, k) => { const v = c[`price_change_percentage_${k}_in_currency`]; return isNum(v) ? `${signed(v, 1)} %` : '–'; };
      const pcTone = (c, k) => c[`price_change_percentage_${k}_in_currency`];
      const row = (label, k) => `<tr><td>${label}</td><td class="num ${tone(pcTone(a, k))}">${pc(a, k)}</td><td class="num ${tone(pcTone(b, k))}">${pc(b, k)}</td></tr>`;
      const head = (c) => `<a class="coin-cell" href="#/coin/${encodeURIComponent(c.id)}"><img src="${esc(c.image)}" alt=""><div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol)}</div></div></a>`;
      out.innerHTML = `<section class="panel">
          <div class="panel-top"><h2>Kursverlauf (Start = 100)</h2><div class="chips" id="cmp-range">${[[90, '90T'], [365, '1J'], [1461, '4J']].map(([d, l]) => `<button class="chip ${d === range ? 'active' : ''}" data-days="${d}">${i18n.span(l)}</button>`).join('')}</div></div>
          <div id="cmp-chart" class="chart"></div>
        </section>
        <section class="panel"><div class="table-wrap"><table class="cmp-table">
          <thead><tr><th></th><th>${head(a)}</th><th>${head(b)}</th></tr></thead><tbody>
          ${line('Kurs', money(a.current_price), money(b.current_price))}
          ${line('Rang nach Marktwert', `#${a.market_cap_rank ?? '–'}`, `#${b.market_cap_rank ?? '–'}`)}
          ${line('Marktkapitalisierung', compact(a.market_cap), compact(b.market_cap))}
          ${row('24 Stunden', '24h')}${row('7 Tage', '7d')}${row('30 Tage', '30d')}${row('1 Jahr', '1y')}
          ${line('Abstand zum Allzeithoch', isNum(a.ath_change_percentage) ? `${num(a.ath_change_percentage, 0)} %` : '–', isNum(b.ath_change_percentage) ? `${num(b.ath_change_percentage, 0)} %` : '–')}
          ${line('Schwankung am Tag (90 Tage)', `${num(vol(da), 1)} %`, `${num(vol(db), 1)} %`)}
          ${line('Signal', show(a) ? badge(a.analysis) : '🔒', show(b) ? badge(b.analysis) : '🔒')}
          ${line('Risiko', show(a) ? riskTag(a.analysis.risk) : '🔒', show(b) ? riskTag(b.analysis.risk) : '🔒')}
          </tbody></table></div>
          ${show(a) && show(b) ? '' : `<p class="hint">Signal und Risiko aller Coins siehst du mit einem kostenlosen Konto. <a href="${depot.user ? '#/preise' : '#/konto'}">${depot.user ? 'Pakete ansehen' : 'Kostenlos starten'}</a></p>`}
          <p class="hint">Vergangene Entwicklung ist keine Prognose. Keine Anlageberatung.</p>
          <p class="share-row hint">${shareLinks(shareUrl(location.hash), `${a.name} vs. ${b.name} – Coinweather`)}</p>
        </section>`;
      const base = rows[0];
      drawChart($('#cmp-chart'), { t: rows.map((r) => r[0]), p: rows.map((r) => r[1] / base[1] * 100), plain: true, note: a.name,
        overlays: [{ values: rows.map((r) => r[2] / base[2] * 100), color: 'var(--accent)', label: b.name }] });
      $('#cmp-range').addEventListener('click', (e) => { const btn = e.target.closest('[data-days]'); if (!btn) return; range = Number(btn.dataset.days); compare(); });
    } catch (err) {
      if (mine === run) out.innerHTML = `<section class="panel"><p class="muted">Kursgeschichte nicht erreichbar: ${esc(err.message)}</p></section>`;
    }
  }
  $('#cmp-form').addEventListener('submit', (e) => { e.preventDefault(); compare(); });
  let started = false;
  return { cmp: true, update() { fill(); if (!started && state.coins.length) { started = true; compare(); } } };
}

// ---------- Rechner: Sparplan und Einmalanlage im Rückblick ----------
// Für alle offen, auch ohne Konto: Was wäre aus einem monatlichen Sparplan oder einer Einmalanlage geworden?
// Gerechnet mit echten Tageskursen (Binance oder Gate.io, bis zu 4 Jahre; sonst CoinGecko, 1 Jahr), ohne Gebühren und Steuern.
// Die Einstellungen stehen in der Adresse (#/rechner/bitcoin?m=plan&b=100&s=2023-01) – so lässt sich ein Ergebnis teilen.

// Modell-Portfolio des Portfolio-Managers (scripts/model-curve.mjs, beim Veröffentlichen täglich neu gerechnet): Anteilswert je Tag
let modelCurve = null;
const loadModelCurve = () => (modelCurve ??= fetch(['localhost', '127.0.0.1'].includes(location.hostname) ? 'out/model-curve.json' : '/data/model-curve.json')
  .then((r) => (r.ok ? r.json() : null)).catch(() => null));

async function dailyOf(c) {
  if (state.daily.has(c.id)) return state.daily.get(c.id);
  let data = null;
  try { data = await api.history(c.symbol, histSource(c)); } catch { /* Börsen nicht erreichbar */ }
  if (data && Math.abs(data.p[data.p.length - 1] / c.current_price - 1) > 0.1) data = null;
  if (!data) data = { ...(await api.chart(c.id, 'usd')), source: 'CoinGecko' };
  state.daily.set(c.id, data);
  rebuild();
  return data;
}

// mode: 'plan' (am ersten Kurstag jedes Monats kaufen) oder 'once'; amount in US-Dollar; der letzte Kurs ist der aktuelle
function simulate(data, price, { mode, amount, startMs }) {
  const t = data.t, p = [...data.p.slice(0, -1), price];
  const i0 = t.findIndex((x) => x >= startMs);
  if (i0 < 0 || i0 >= t.length - 1) return null;
  let units = 0, invested = 0, buys = 0, month = null, worst = 0, worstAt = null;
  const days = [], value = [], paid = [];
  for (let i = i0; i < t.length; i++) {
    const d = new Date(t[i]), key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (mode === 'once' ? i === i0 : key !== month) { units += amount / p[i]; invested += amount; buys++; month = key; }
    const v = units * p[i];
    days.push(t[i]); value.push(v); paid.push(invested);
    if (v / invested - 1 < worst) { worst = v / invested - 1; worstAt = t[i]; }
  }
  const last = value[value.length - 1];
  return { days, value, paid, invested, last, gain: last - invested, ret: last / invested - 1, buys, avg: invested / units, worst, worstAt, from: t[i0] };
}

// Sparplan- und Portfolio-Rechner: derselbe Plan mit einem Coin, mit Bitcoin und mit dem Portfolio-Manager nebeneinander,
// darunter das Modell-Portfolio im Detail. #/modell öffnet dieselbe Seite beim Modell-Portfolio.
function calculatorView(arg, { focus } = {}) {
  markSeen('calc');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const now = new Date();
  const monthStr = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const minMonth = monthStr(new Date(Date.UTC(now.getUTCFullYear() - 4, now.getUTCMonth() + 1, 1)));
  const maxMonth = monthStr(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const f = {
    id: (arg ?? '').split('?')[0] || 'bitcoin',
    mode: params.get('m') === 'once' ? 'once' : 'plan',
    amount: Math.max(1, Number(params.get('b')) || (params.get('m') === 'once' ? 1000 : 100)),
    start: /^\d{4}-\d{2}$/.test(params.get('s') ?? '') ? params.get('s') : `${now.getUTCFullYear() - 3}-01`,
  };
  if (f.start < minMonth) f.start = minMonth;
  if (f.start > maxMonth) f.start = maxMonth;
  let run = 0;
  const candidates = () => state.coins.filter((c) => (c.market_cap_rank ?? 9999) <= 300 && c.analysis?.signal !== 'none');
  const find = (text) => {
    const q = text.trim().toLowerCase();
    return state.byId.get(q) ?? state.coins.find((c) => c.name.toLowerCase() === q || c.symbol.toLowerCase() === q)
      ?? candidates().find((c) => c.name.toLowerCase().startsWith(q) || c.symbol.toLowerCase().startsWith(q));
  };

  view.innerHTML = `
    <section class="panel calc">
      <div class="label">Kostenloser Rechner</div>
      <h1 class="page-title">Sparplan- und Portfolio-Rechner</h1>
      <p class="muted">Was wäre aus einem monatlichen Sparplan oder einer Einmalanlage geworden – mit einem Coin, mit Bitcoin oder mit dem Portfolio-Manager von Coinweather?
        Gerechnet mit echten Tageskursen der letzten bis zu 4 Jahre.</p>
      <form id="calc-form" class="calc-form">
        <label>Coin<input id="calc-coin" list="calc-coins" autocomplete="off" required></label>
        <datalist id="calc-coins"></datalist>
        <label>Art<select id="calc-mode"><option value="plan">Monatlicher Sparplan</option><option value="once">Einmalanlage</option></select></label>
        <label><span>Betrag (<span translate="no">${currencyCode()}</span>)</span><input id="calc-amount" type="number" min="1" step="any" inputmode="decimal" required></label>
        <label>Start<input id="calc-start" type="month" min="${minMonth}" max="${maxMonth}" required></label>
        <button class="btn" type="submit">Berechnen</button>
      </form>
      <div class="chips calc-quick" id="calc-quick" role="group" aria-label="Schnellauswahl">
        ${[['bitcoin', 'Bitcoin'], ['ethereum', 'Ethereum'], ['solana', 'Solana'], ['ripple', 'XRP']].map(([id, n]) => `<button type="button" class="chip" data-coin="${id}" translate="no">${n}</button>`).join('')}
      </div>
    </section>
    <div id="calc-out"></div>
    <div id="model"></div>`;
  $('#calc-mode').value = f.mode;
  $('#calc-amount').value = inputText(toDisplay(f.amount));
  $('#calc-start').value = f.start;
  $('#calc-quick').addEventListener('click', (e) => {
    const id = e.target.closest('[data-coin]')?.dataset.coin;
    const c = id && state.byId.get(id);
    if (!c) return;
    $('#calc-coin').value = c.name;
    calculate();
  });

  function fillCoins() {
    const list = candidates();
    if (!list.length) return;
    $('#calc-coins').innerHTML = list.map((c) => `<option value="${esc(c.name)}">${esc(c.symbol.toUpperCase())}</option>`).join('');
    if (!$('#calc-coin').value) $('#calc-coin').value = state.byId.get(f.id)?.name ?? 'Bitcoin';
  }

  async function calculate() {
    const c = find($('#calc-coin').value);
    const out = $('#calc-out');
    if (!c) { out.innerHTML = '<section class="panel"><p class="muted">Diesen Coin kenne ich nicht. Wähle einen aus der Liste.</p></section>'; return; }
    const amount = fromDisplay(Number(String($('#calc-amount').value).replace(',', '.')));
    if (!(amount > 0)) return;
    f.id = c.id; f.mode = $('#calc-mode').value; f.amount = amount; f.start = $('#calc-start').value || f.start;
    history.replaceState(null, '', `#/rechner/${encodeURIComponent(f.id)}?m=${f.mode}&b=${Math.round(f.amount * 100) / 100}&s=${f.start}`);
    for (const b of $('#calc-quick').children) b.classList.toggle('active', b.dataset.coin === c.id);
    const mine = ++run;
    out.innerHTML = '<section class="panel"><p class="muted">Lade Kursgeschichte …</p></section>';
    const [y, m] = f.start.split('-').map(Number);
    const startMs = Date.UTC(y, m - 1, 1);
    try {
      const btc = state.byId.get('bitcoin');
      const [data, btcData, curve] = await Promise.all([dailyOf(c), c.id !== 'bitcoin' && btc ? dailyOf(btc).catch(() => null) : null, loadModelCurve()]);
      if (mine !== run || current?.calc !== true) return;
      const r = simulate(data, c.current_price, { mode: f.mode, amount, startMs });
      if (!r) { out.innerHTML = '<section class="panel"><p class="muted">Für diesen Zeitraum gibt es keine Kursdaten.</p></section>'; return; }
      const b = btcData ? simulate(btcData, btc.current_price, { mode: f.mode, amount, startMs: r.from }) : null;
      // Derselbe Plan mit dem Portfolio-Manager: monatlich Anteile am Modell-Portfolio kaufen
      const mgr = curve?.t?.length && curve.t[0] <= r.from + 5 * 86_400_000
        ? simulate({ t: curve.t, p: curve.nav }, curve.nav[curve.nav.length - 1], { mode: f.mode, amount, startMs: r.from }) : null;
      const dayKey = (t) => Math.floor(t / 86_400_000);
      const mgrAt = mgr ? new Map(mgr.days.map((t, i) => [dayKey(t), mgr.value[i]])) : null;
      const btcAt = b ? new Map(b.days.map((t, i) => [dayKey(t), b.value[i]])) : null;
      const late = r.from - startMs > 20 * 86_400_000;
      const date = (ms) => new Date(ms).toLocaleDateString(settings.locale, { month: 'long', year: 'numeric' });
      const msg = `${c.name}: ${f.mode === 'plan' ? i18n.say('Monatlicher Sparplan') : i18n.say('Einmalanlage')} – ${signed(r.ret * 100, 1)} % · Coinweather`;
      // Drei Wege mit demselben Geld: der gewählte Coin, Bitcoin, der Portfolio-Manager
      const ways = [
        { key: 'coin', title: `Nur <span translate="no">${esc(c.name)}</span>`, img: c.image, res: r, color: 'var(--text)' },
        ...(b ? [{ key: 'btc', title: 'Nur Bitcoin', img: btc.image, res: b, color: 'var(--accent-2)' }] : []),
        ...(mgr ? [{ key: 'mgr', title: 'Mit dem Portfolio-Manager', icon: '🤖', res: mgr, color: 'var(--accent)', note: `wählt aus ${curve.coins} geprüften Coins, Reserve in schwachen Phasen` }] : []),
      ];
      const best = ways.length > 1 ? ways.reduce((x, w) => (w.res.last > x.res.last ? w : x)) : null;
      const card = (w) => `<div class="way ${w.key}${w === best ? ' best' : ''}">
          <div class="way-top">${w.img ? `<img src="${esc(w.img)}" alt="">` : `<span class="way-icon" aria-hidden="true">${w.icon}</span>`}<strong>${w.title}</strong>${w === best ? '<span class="badge buy">bestes Ergebnis</span>' : ''}</div>
          <div class="way-nums"><span class="way-value ${tone(w.res.gain)}">${money(w.res.last)}</span><span class="way-ret ${tone(w.res.ret)}">${signed(w.res.ret * 100, 1)} %</span></div>
          <dl class="way-meta"><div><dt>Gewinn oder Verlust</dt><dd class="${tone(w.res.gain)}">${w.res.gain >= 0 ? '+' : '−'}${money(Math.abs(w.res.gain))}</dd></div>
            <div><dt>Tiefster Stand unterwegs</dt><dd class="${w.res.worst < 0 ? 'down' : 'up'}">${w.res.worst < 0 ? `${signed(w.res.worst * 100, 1)} %` : 'nie im Minus'}</dd></div></dl>
          ${w.note ? `<div class="muted way-note">${w.note}</div>` : ''}
          ${w.key === 'mgr' ? `<a class="btn small way-cta" href="#/portfolio/auto?b=${Math.round(f.amount * 100) / 100}&m=${f.mode}">Mit dem Autopiloten umsetzen →</a>` : ''}
        </div>`;
      out.innerHTML = `<section class="panel calc-result">
          <div class="calc-head"><img src="${esc(c.image)}" alt=""><div><h2><span translate="no">${esc(c.name)}</span> · ${f.mode === 'plan' ? 'Monatlicher Sparplan' : 'Einmalanlage'}</h2>
            <div class="muted">Start: ${date(r.from)}${late ? ' · Kursgeschichte erst ab hier' : ''} · ${r.buys} ${r.buys === 1 ? 'Kauf' : 'Käufe'} · Eingezahlt ${money(r.invested)} · Durchschnittlicher Kaufkurs ${money(r.avg)}</div></div></div>
          <div class="ways">${ways.map(card).join('')}</div>
          <div id="calc-chart" class="chart"></div>
          ${r.worst < 0 ? `<p class="hint">Am ${new Date(r.worstAt).toLocaleDateString(settings.locale)} lag der Wert in ${esc(c.name)} ${num(-r.worst * 100, 0)} % unter dem eingezahlten Betrag. Wer da verkauft hätte, hätte den Verlust mitgenommen.</p>` : ''}
          ${mgr ? `<p class="hint"><strong>Portfolio-Manager:</strong> Rückrechnung an den Kursen, an denen die Regeln entwickelt wurden, mit 0,25 % Gebühr je Handel. Die Zukunft fällt meist schlechter aus;
            Coins, die es nicht mehr gibt, fehlen. Größter Rückgang des Modell-Portfolios seit ${new Date(curve.t[0]).getUTCFullYear()}: ${num(-curve.stats.maxDrawdown, 0)} %.</p>` : ''}
          <p class="hint">Rückblick mit echten Tageskursen, ohne Steuern. Die Vergangenheit ist keine Prognose – Kryptowerte können stark fallen, bis zum Totalverlust.</p>
          <p class="share-row hint">${shareLinks(shareUrl(location.hash), msg, 'Ergebnis teilen')}</p>
        </section>
        ${access().plan ? `<p><a class="btn ghost" href="#/coin/${encodeURIComponent(c.id)}">Signal und Aussicht für <span translate="no">${esc(c.name)}</span> ansehen</a></p>`
          : previewCta('Und wie sieht es heute aus?', 'Mit einem kostenlosen Konto siehst du für jeden der 1000 Coins das Signal, die Aussicht für 7 und 30 Tage und den Rückblick. 30 Tage alle Funktionen, ohne Zahlungsdaten.')}`;
      drawChart($('#calc-chart'), { t: r.days, p: r.value, note: c.name, overlays: [{ values: r.paid, color: 'var(--muted)', label: 'Eingezahlt' },
        ...(btcAt ? [{ values: r.days.map((t) => btcAt.get(dayKey(t)) ?? null), color: 'var(--accent-2)', label: 'Bitcoin' }] : []),
        ...(mgrAt ? [{ values: r.days.map((t) => mgrAt.get(dayKey(t)) ?? null), color: 'var(--accent)', label: 'Mit dem Portfolio-Manager' }] : [])] });
    } catch (err) {
      if (mine === run) out.innerHTML = `<section class="panel"><p class="muted">Kursgeschichte nicht erreichbar: ${esc(err.message)}</p></section>`;
    }
  }

  $('#calc-form').addEventListener('submit', (e) => { e.preventDefault(); calculate(); });
  let started = false, modelShown = null;
  return {
    calc: true,
    update() {
      fillCoins();
      // Sobald die Coin-Liste da ist, gleich mit den Einstellungen aus der Adresse rechnen
      if (!started && state.coins.length) { started = true; calculate(); }
      const key = access().plan ?? 'none';
      if (key !== modelShown) {
        modelShown = key;
        modelSection($('#model')).then(() => { if (focus === 'model') { focus = null; $('#model')?.scrollIntoView({ block: 'start' }); } });
      }
    },
  };
}

let routedFor = null;   // für wen die Ansicht zuletzt aufgebaut wurde: 'wait', 'guest' oder die Konto-Kennung
function route() {
  routedFor = !depot.ready && maybeSignedIn() ? 'wait' : (depot.user?.uid ?? 'guest');
  const [rawName, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const name = (rawName ?? '').split('?')[0];
  const pages = ['preise', ...site.LEGAL_KINDS];
  const section = name === 'portfolio' ? 'portfolio' : name === 'konto' ? 'account' : name === 'daytrading' ? 'trading' : name === 'admin' ? 'admin' : name === 'rechner' || name === 'modell' ? 'tools' : name === 'indikatoren' ? 'compass' : name === 'vergleich' ? 'market'
    : pages.includes(name) ? null : 'market';
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.nav === section);
  let id = arg;
  try { id = decodeURIComponent(arg ?? ''); } catch { /* fehlerhafte Adresse – unverändert verwenden */ }
  const open = ['konto', 'rechner', 'indikatoren', 'modell', 'vergleich', 'challenge'].includes(name) || pages.includes(name);
  const sales = () => site.pricingView(view, { access, user: () => depot.user, record: () => state.record });
  // Mit Bezahlschranke erst abwarten, wer angemeldet ist und ob ein Abo läuft – sonst blitzt die Verkaufsseite kurz auf
  usagePage(name || 'markt', arg);
  if (name === 'admin') current = !depot.ready ? waitView() : depot.owner ? adminView() : accountView();
  else if (SITE.paywall && !open && ((!depot.ready && maybeSignedIn()) || (depot.user && !depot.owner && !abo.loaded))) current = waitView();
  // Ohne Abo: Markt als kostenlose Vorschau, Bitcoin und Ethereum als Beispiel, sonst das Angebot
  else if (!open && !access().plan) {
    current = name === 'coin' && id ? (SAMPLES.includes(id) ? detailView(id) : lockedCoinView(id))
      : section === 'market' ? marketView(true) : sales();
  }
  else if (name === 'coin' && id) current = detailView(id);
  else if (name === 'portfolio') current = !depot.user ? accountView(true) : fullAccess() ? portfolioView(arg) : lockedView('portfolio');
  else if (name === 'konto') current = accountView();
  else if (name === 'daytrading') { current = fullAccess() ? tradingView() : lockedView('trading'); if (fullAccess()) tradingAck(); }
  else if (name === 'preise') current = sales();
  else if (name === 'rechner') current = calculatorView(arg);
  else if (name === 'indikatoren') current = compassView();
  else if (name === 'modell') current = calculatorView('', { focus: 'model' });
  else if (name === 'vergleich') current = compareView(arg);
  else if (name === 'challenge') current = challengeView();
  else if (site.LEGAL_KINDS.includes(name)) current = site.legalView(view, name);
  else current = marketView();
  current.update();
  window.scrollTo(0, 0);
  navBadge().catch(() => {});
}

// Als App installierbar: Service Worker (nur über https) und ein eigener Knopf, sobald der Browser die Installation anbietet
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#install-app').hidden = false; });
$('#install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $('#install-app').hidden = true;
});

window.addEventListener('hashchange', route);
route();
start();
fngLoop();
bitcoinLoop();
