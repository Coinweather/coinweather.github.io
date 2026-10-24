// Berechnet alle Kurse, Bewertungen und den Markt-Index einmal zentral und schreibt sie in eine Datei.
// Läuft regelmäßig über GitHub Actions (.github/workflows/snapshot.yml). Die Website lädt nur noch
// dieses Ergebnis, statt bei jedem Besuch selbst alles nachzuladen und zu rechnen.
//
// Aufruf: node scripts/snapshot.mjs out/snapshot.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { quickAnalyse, detailAnalyse, marketIndex, prepare, analyseNews } from '../js/model.js';
import { settings } from '../js/util.js';

// Zahlen in den Texten als Platzhalter ablegen: Die Website schreibt sie in der Sprache des Nutzers (util.js, localise)
settings.tokens = true;

const OUT = process.argv[2] ?? 'out/snapshot.json';
const PAGES = 4;
const DAYS_4Y = 1461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Felder, die die Website je Coin braucht
const FIELDS = ['id', 'symbol', 'name', 'image', 'current_price', 'market_cap', 'market_cap_rank', 'total_volume',
  'high_24h', 'low_24h', 'ath', 'ath_change_percentage', 'circulating_supply', 'max_supply',
  'price_change_percentage_24h_in_currency', 'price_change_percentage_7d_in_currency', 'price_change_percentage_14d_in_currency',
  'price_change_percentage_30d_in_currency', 'price_change_percentage_200d_in_currency', 'price_change_percentage_1y_in_currency'];

async function getJson(url, { tries = 6, wait = 30_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res = null;
    try { res = await fetch(url, { headers: { accept: 'application/json' } }); } catch { /* Netzwerkfehler */ }
    if (res?.ok) return res.json();
    if (attempt >= tries) throw new Error(`${url.split('?')[0]} antwortet nicht (${res?.status ?? 'kein Netz'})`);
    await sleep(wait);
  }
}

async function markets() {
  const coins = new Map();
  for (let page = 1; page <= PAGES; page++) {
    const list = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc' +
      `&per_page=250&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d,14d,30d,200d,1y`);
    for (const c of list) coins.set(c.id, c);
    await sleep(5000);   // kostenloses Limit: etwa 5 Anfragen pro Minute
  }
  return [...coins.values()].sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
}

// Tageskurse der letzten 4 Jahre von Binance; null, wenn das Paar nicht existiert
async function history(symbol) {
  let rows = [], end = Date.now();
  for (let k = 0; k < 2 && rows.length < DAYS_4Y; k++) {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=1d&limit=1000&endTime=${end}`);
    if (!res.ok) return null;
    const part = await res.json();
    if (!part.length) break;
    rows = part.concat(rows);
    end = part[0][0] - 1;
    if (part.length < 1000) break;
  }
  // Wird das Paar nicht mehr gehandelt, liefert Binance alte Kerzen – die taugen nicht für eine aktuelle Bewertung
  if (rows.length < 60 || Date.now() - rows[rows.length - 1][0] > 3 * 86_400_000) return null;
  const cut = rows.slice(-DAYS_4Y);
  return { t: cut.map((r) => r[0]), p: cut.map((r) => Number(r[4])), v: cut.map((r) => Number(r[7])) };
}

// Tageskurse der letzten 4 Jahre von Gate.io für Coins, die Binance nicht führt (höchstens 1000 Tage je Anfrage)
async function gateHistory(symbol) {
  const now = Math.floor(Date.now() / 1000), day = 86_400;
  let rows = [];
  for (const [from, to] of [[now - DAYS_4Y * day, now - 731 * day], [now - 730 * day, now]]) {
    const res = await fetch(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(symbol)}_USDT&interval=1d&from=${from}&to=${to}`);
    if (!res.ok) return null;
    const part = await res.json();
    if (Array.isArray(part)) rows = rows.concat(part);
  }
  // Spalten: 0 = Tagesbeginn (Sekunden), 1 = Handelsvolumen in USDT, 2 = Schlusskurs
  rows = [...new Map(rows.map((r) => [Number(r[0]), r])).values()].sort((a, b) => a[0] - b[0]);
  if (rows.length < 60 || Date.now() - Number(rows[rows.length - 1][0]) * 1000 > 3 * 86_400_000) return null;
  return { t: rows.map((r) => Number(r[0]) * 1000), p: rows.map((r) => Number(r[2])), v: rows.map((r) => Number(r[1])) };
}

async function optional(label, fn) {
  try { return await fn(); } catch (err) { console.warn(`${label} nicht verfügbar: ${err.message}`); return null; }
}

const started = Date.now();
const coins = await markets();
console.log(`${coins.length} Coins geladen`);

// 150 Tage Verlauf: Das Modell braucht, wie lange der Index schon in einer Zone steht (bis zu 60 Tage zurück)
const fngData = await optional('Fear & Greed', async () => (await getJson('https://api.alternative.me/fng/?limit=150', { tries: 2, wait: 5000 })).data);
const fng = fngData ? { value: Number(fngData[0].value), week: Number(fngData[7]?.value), month: Number(fngData[29]?.value),
  values: fngData.map((d) => Number(d.value)),
  byDay: new Map(fngData.map((d) => [Math.floor(Number(d.timestamp) / 86400), Number(d.value)])) } : null;

// Fear & Greed Index von CoinMarketCap, nur zur Anzeige und nur mit eigenem API-Schlüssel (Umgebungsvariable CMC_API_KEY).
// Gerechnet wird mit dem Index von alternative.me: Er liegt seit 2018 vor und ist damit prüfbar, der von CoinMarketCap
// erst seit Mitte 2023. Beide laufen zu rund 90 % gleich, lösen die Regeln aber an teils anderen Tagen aus.
const cmc = process.env.CMC_API_KEY ? await optional('Fear & Greed von CoinMarketCap', async () => {
  const res = await fetch('https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest',
    { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY, accept: 'application/json' } });
  if (!res.ok) throw new Error(`Antwort ${res.status}`);
  const d = (await res.json()).data;
  if (!Number.isFinite(Number(d?.value))) throw new Error('unerwartete Antwort');
  return { value: Math.round(Number(d.value)), label: String(d.value_classification ?? '') };
}) : null;

const news = await optional('Nachrichten', async () => {
  const json = await getJson('https://cryptocurrency.cv/api/search?q=crypto&limit=30', { tries: 1 });
  return analyseNews((json.articles || []).filter((a) => a.title && a.pubDate)
    .map((a) => ({ title: a.title, description: (a.description || '').slice(0, 300), time: Date.parse(a.pubDate) })));
});

const btcData = await optional('Bitcoin-Kursgeschichte', () => history('BTC'));
const btc = coins.find((c) => c.id === 'bitcoin');
const btcInd = btcData && btc ? prepare(btcData.t, [...btcData.p.slice(0, -1), btc.current_price], btcData.v) : null;
const market = marketIndex(coins, btcInd, fng, news && news.score !== null ? news : null);
if (!market) throw new Error('Markt-Index nicht berechenbar');
const regime = market.regime;

// Welche Coins führt Binance? Gleiches Kürzel mit stark abweichendem Kurs ist ein anderer Coin.
const prices = await optional('Binance-Kurse', async () =>
  new Map((await getJson('https://data-api.binance.vision/api/v3/ticker/price', { tries: 2, wait: 5000 })).map((x) => [x.symbol, Number(x.price)])));

// Coins, die Binance nicht führt, bekommen ihre Tageskurse von Gate.io – so rechnet der Score bei allen Coins,
// die an einer der beiden Börsen gehandelt werden, mit bis zu 4 Jahren Kursgeschichte
const gatePrices = await optional('Gate.io-Kurse', async () =>
  new Map((await getJson('https://api.gateio.ws/api/v4/spot/tickers', { tries: 2, wait: 5000 })).map((x) => [x.currency_pair, Number(x.last)])));

const refined = { Binance: 0, 'Gate.io': 0 };
const queue = [...coins];
async function worker() {
  for (let c = queue.shift(); c; c = queue.shift()) {
    c.analysis = quickAnalyse(c, regime);
    if (c.analysis.signal === 'none') continue;
    const sym = c.symbol.toUpperCase();
    const near = (p) => p && Math.abs(p / c.current_price - 1) < 0.1;   // gleiches Kürzel mit anderem Kurs ist ein anderer Coin
    let daily = null, source = null;
    if (c.id === 'bitcoin') { daily = btcData; source = 'Binance'; }
    else if (near(prices?.get(sym + 'USDT'))) { daily = await optional(c.symbol, () => history(sym)); source = 'Binance'; }
    if (!daily && near(gatePrices?.get(sym + '_USDT'))) { daily = await optional(c.symbol, () => gateHistory(sym)); source = 'Gate.io'; }
    if (!daily) continue;
    c.hist = source;   // die Seite lädt das Diagramm dann direkt von dieser Börse
    c.analysis = detailAnalyse(c, prepare(daily.t, [...daily.p.slice(0, -1), c.current_price], daily.v), regime);
    // Die Daytrading-Muster sind an Binance-Kursen geprüft – für andere Börsen gibt es keine Handelsvorschläge
    if (source !== 'Binance') delete c.analysis.trade;
    refined[source]++;
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`Mit Tageskursen verfeinert: ${refined.Binance} Coins von Binance, ${refined['Gate.io']} von Gate.io`);

// ---------- Erfolgskontrolle ----------
// Einmal am Tag werden die stärksten Kaufsignale mit ihrem Kurs festgehalten. 7 und 30 Tage später wird nachgesehen,
// was aus ihnen geworden ist. So entsteht eine Messung mit echten, vorher unbekannten Kursen – die Rückrechnung kann
// das nicht leisten. Die Datei track.json liegt neben snapshot.json im Zweig "data"; der Workflow holt sie vor jedem Lauf.
const TRACK = join(dirname(OUT), 'track.json');
const TRACK_SIGNALS = 25, TRACK_KEEP_DAYS = 400;
const today = Math.floor(Date.now() / 86_400_000);
let track = { version: 1, since: today, days: [] };
try {
  // Eine vorhandene, aber unlesbare Datei bricht den Lauf ab – sonst würde die bisherige Messung überschrieben
  track = JSON.parse(await readFile(TRACK, 'utf8'));
  if (!Array.isArray(track.days)) throw new Error('track.json hat ein unerwartetes Format');
} catch (err) { if (err.code !== 'ENOENT') throw err; }

const byId = new Map(coins.map((c) => [c.id, c]));
// Ergebnis eines Tages nach einer Frist: wie viele Signale höher stehen, mittlere Veränderung, Bitcoin zum Vergleich
function outcome(entry) {
  const rets = entry.sig.map(([id, , price]) => byId.get(id)?.current_price / price - 1).filter(Number.isFinite);
  if (!rets.length || !(btc?.current_price > 0)) return null;
  // Vergleich: Durchschnitt der 100 größten Coins (ohne Stablecoins) über dieselbe Frist – fällt der ganze Markt, fallen auch gute Signale
  const market = (entry.top ?? []).map(([id, price]) => byId.get(id)?.current_price / price - 1).filter(Number.isFinite);
  return { n: rets.length, up: rets.filter((r) => r > 0).length, avg: Number((rets.reduce((a, b) => a + b, 0) / rets.length * 100).toFixed(2)),
    btc: Number(((btc.current_price / entry.btc - 1) * 100).toFixed(2)),
    ...(market.length >= 50 ? { mkt: Number((market.reduce((a, b) => a + b, 0) / market.length * 100).toFixed(2)) } : {}) };
}
for (const e of track.days) {
  if (!e.sig) continue;
  const age = today - e.d;
  // Fiel die Berechnung länger aus, wird die Frist nicht nachträglich mit einem späteren Kurs „erfüllt“ (false = ausgelassen)
  if (e.e7 === undefined && age >= 7) e.e7 = age <= 10 ? outcome(e) : false;
  if (e.e30 === undefined && age >= 30) { e.e30 = age <= 35 ? outcome(e) : false; delete e.sig; delete e.top; }   // danach werden die Listen nicht mehr gebraucht
}
if (!track.days.some((e) => e.d === today) && btc?.current_price > 0) {
  // dieselbe Auswahl wie bei den Kaufvorschlägen im Portfolio: große, handelbare Coins, keine verpackten Token
  const sig = coins.filter((c) => c.analysis.signal === 'buy' && (c.market_cap_rank ?? 9999) <= 300 && c.total_volume >= 5e6 && c.current_price > 0
    && !/wrapped|staked|staking|bridged|restaked|usd|usd/i.test(c.name))
    .sort((a, b) => b.analysis.score - a.analysis.score).slice(0, TRACK_SIGNALS)
    .map((c) => [c.id, c.symbol, c.current_price, c.analysis.score]);
  const top = coins.filter((c) => (c.market_cap_rank ?? 9999) <= 100 && !c.analysis.stable && c.current_price > 0).map((c) => [c.id, c.current_price]);
  track.days.push({ d: today, btc: btc.current_price, idx: market.value, mood: market.mood?.value, sig, top });
}
track.days = track.days.filter((e) => today - e.d <= TRACK_KEEP_DAYS);
// Zusammenfassung für die Seite
const sumUp = (key) => {
  const done = track.days.map((e) => e[key]).filter(Boolean);
  const n = done.reduce((a, o) => a + o.n, 0);
  if (!n) return null;
  return { days: done.length, n, up: done.reduce((a, o) => a + o.up, 0), avg: Number((done.reduce((a, o) => a + o.avg * o.n, 0) / n).toFixed(2)),
    btc: Number((done.reduce((a, o) => a + o.btc, 0) / done.length).toFixed(2)),
    ...(done.some((o) => Number.isFinite(o.mkt)) ? { mkt: Number((done.filter((o) => Number.isFinite(o.mkt)).reduce((a, o) => a + o.mkt, 0) / done.filter((o) => Number.isFinite(o.mkt)).length).toFixed(2)), mktDays: done.filter((o) => Number.isFinite(o.mkt)).length } : {}) };
};
const record = { since: track.since, days: track.days.length, d7: sumUp('e7'), d30: sumUp('e30') };

// Wechselkurse je US-Dollar für die Anzeige in anderen Währungen – abgeleitet aus dem Bitcoin-Kurs in jeder Währung
const FX = ['eur', 'chf', 'gbp', 'cad', 'aud', 'jpy'];
let fx = null;
try {
  const btc = (await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,${FX.join(',')}`)).bitcoin;
  if (btc?.usd > 0) fx = Object.fromEntries(FX.filter((c) => btc[c] > 0).map((c) => [c, Number((btc[c] / btc.usd).toPrecision(6))]));
} catch (err) { console.warn('Wechselkurse nicht geladen:', err.message); }

const snapshot = {
  version: 1,
  time: Date.now(),
  record,
  fx,
  market: { value: market.value, signal: market.signal, label: market.label, buy: market.buy, mood: market.mood, parts: market.parts, regime, cycle: market.cycle, forecast: market.forecast },
  fng: fng ? { value: fng.value, week: fng.week, month: fng.month, cmc } : null,
  coins: coins.map((c) => {
    const out = {};
    for (const f of FIELDS) out[f] = c[f];
    out.sparkline_in_7d = { price: (c.sparkline_in_7d?.price || []).filter(Number.isFinite).map((x) => Number(x.toPrecision(5))) };
    // Die Marktphase ist für alle Coins gleich und steht einmal unter market.regime
    const { regime: _shared, ...analysis } = c.analysis;
    out.analysis = analysis;
    if (c.hist) out.hist = c.hist;
    return out;
  }),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(snapshot));
await writeFile(TRACK, JSON.stringify(track));
// Schnellstart: dieselben Daten für die 150 größten Coins – die Seite zeigt sie sofort und lädt die übrigen im Hintergrund nach
const lite = { ...snapshot, lite: true, coins: snapshot.coins.filter((c) => (c.market_cap_rank ?? 9999) <= 150) };
await writeFile(join(dirname(OUT), 'lite.json'), JSON.stringify(lite));
console.log(`Geschrieben: ${OUT} (${(JSON.stringify(snapshot).length / 1e6).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)} s) · Markt-Index ${market.value} ${market.label}`);
