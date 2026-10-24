// Modell-Portfolio des Portfolio-Managers: Rückrechnung mit den Regeln der Seite (js/manager.js, js/model.js)
// an den 84 Coins, an denen das Modell geprüft wurde – Tageskurse von Binance seit 2017, Fear & Greed von alternative.me.
// Wöchentlich geprüft, 0,25 % Gebühr je Handel, Marktphase über 14 Tage geglättet, Reserve „ausgewogen“ (Standard der Seite).
// Ergebnis: der Wert des Modell-Portfolios an jedem Tag, als Anteilswert (Start = 100). Der Sparplan-Rechner kauft damit
// monatlich Anteile – so lässt sich zeigen, was derselbe Sparplan mit dem Portfolio-Manager gebracht hätte.
//
// Grenzen (stehen auch auf der Seite): Die Regeln wurden an genau diesen Daten entwickelt und geprüft – eine Rückrechnung
// fällt deshalb besser aus als die Zukunft. Coins, die es nicht mehr gibt, fehlen. Steuern sind nicht berücksichtigt.
//
// Aufruf: node scripts/model-curve.mjs <datei.json>   (oder als Modul: buildCurve())

import { writeFile } from 'node:fs/promises';
import * as m from '../js/model.js';
import * as mg from '../js/manager.js';

// Die geprüften Coins (dieselben wie in der Rückrechnung im README), Kürzel bei Binance
export const COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'ATOM', 'UNI', 'XLM', 'ETC', 'NEAR', 'FIL',
  'AAVE', 'ALGO', 'HBAR', 'VET', 'ICP', 'SAND', 'MANA', 'AXS', 'EGLD', 'THETA', 'XTZ', 'GRT', 'CHZ', 'ENJ', 'SNX', 'CRV', 'COMP', 'ZEC', 'DASH', 'SHIB', 'PEPE',
  'ARB', 'OP', 'APT', 'SUI', 'INJ', 'RUNE', 'GALA', 'KAVA', 'ZIL', 'IOTA', 'NEO', 'QTUM', 'ONT', 'BAT', 'ZRX', 'KSM', '1INCH', 'SUSHI', 'YFI', 'STX', 'IMX',
  'LDO', 'FET', 'TIA', 'SEI', 'WLD', 'JUP', 'BONK', 'FLOKI', 'CAKE', 'DYDX', 'GMX', 'AR', 'MINA', 'ROSE', 'CELO', 'ONE', 'HOT', 'ANKR', 'IOST', 'RVN', 'RENDER', 'POL', 'ENS'];
const START = Date.UTC(2017, 7, 17);

export async function klines(sym) {
  let rows = [], start = START;
  for (let k = 0; k < 6; k++) {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=1000&startTime=${start}`);
    if (!res.ok) return null;
    const part = await res.json();
    if (!Array.isArray(part) || !part.length) break;
    rows = rows.concat(part);
    start = part[part.length - 1][0] + 86_400_000;
    if (part.length < 1000) break;
  }
  // Wird das Paar nicht mehr gehandelt, fehlt der aktuelle Rand – solche Coins bleiben draußen
  if (rows.length < 250 || Date.now() - rows[rows.length - 1][0] > 4 * 86_400_000) return null;
  return { t: rows.map((r) => r[0]), p: rows.map((r) => Number(r[4])), v: rows.map((r) => Number(r[5])) };
}

export async function fearGreed() {
  const res = await fetch('https://api.alternative.me/fng/?limit=0&format=json');
  const json = await res.json();
  return new Map(json.data.map((x) => [Math.floor(Number(x.timestamp) / 86400), Number(x.value)]));
}

// Kurse und Fear & Greed werden einmal geladen und für alle Profile verwendet
let loaded = null;
async function loadData() {
  const data = {};
  for (let i = 0; i < COINS.length; i += 6) {
    await Promise.all(COINS.slice(i, i + 6).map(async (s) => { try { const d = await klines(s); if (d) data[s] = d; } catch { /* Coin fehlt dann */ } }));
  }
  if (!data.BTC) throw new Error('Bitcoin-Kurse fehlen');
  return { all: data, F: await fearGreed() };
}

// only: nur diese Coins (Binance-Kürzel), z. B. ['BTC', 'ETH']
export async function buildCurve({ offset = 0, options = {}, coinScore = null, only = null } = {}) {
  const { all, F } = await (loaded ??= loadData());
  const data = only ? Object.fromEntries(Object.entries(all).filter(([s]) => only.includes(s))) : all;
  const syms = Object.keys(data);
  const I = {}, IDX = {};
  for (const s of syms) { I[s] = m.prepare(data[s].t, data[s].p, data[s].v); IDX[s] = new Map(I[s].days.map((d, i) => [d, i])); }
  const btc = I.BTC;
  const ATH = []; { let hi = 0; for (let j = 0; j < btc.n; j++) { hi = Math.max(hi, btc.prices[j]); ATH[j] = hi; } }
  const vol30 = (ind, i) => { let mu = 0; const a = []; for (let k = i - 29; k <= i; k++) { const r = Math.log(ind.prices[k] / ind.prices[k - 1]); a.push(r); mu += r; } mu /= 30; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / 29) * 100; };
  const fgState = (day) => { const vals = []; for (let k = 0; k < 150; k++) { const v = F.get(day - k); if (v === undefined) break; vals.push(v); } return vals.length ? m.fngState(vals) : null; };
  const regimeOf = (j) => {
    const R = m.regimeSmooth(btc, j, (d) => F.get(d), m.REGIME_DAYS); R.cycle = { dd: (btc.prices[j] / ATH[j] - 1) * 100 }; R.fng = fgState(btc.days[j]);
    // Kauf-Score wie auf der Seite: aus den Bitcoin-Tageskursen bis zu diesem Tag
    R.buy = m.buyScore(btc.prices.slice(Math.max(0, j - 800), j + 1), R.cycle.dd, R.fng?.days >= 20 ? R.fng.avg30 : null)?.value ?? null;
    return R;
  };

  // Wie die Rückrechnung im README (sim2.mjs): Start mit 10 000 $ in bar, jede Woche nach dem Plan des Managers handeln
  const fee = 0.0025, step = 7;
  const startDay = btc.days[200];
  let cash = 10000; const pos = {}; const days = [], values = [], cashShare = []; let trades = 0;
  const log = [];   // Handel der letzten Zeit: Tag, Art, Coin, Anteil am Portfolio
  for (let j = 200; j < btc.n; j++) {
    const day = btc.days[j];
    const price = (s) => { const i = IDX[s].get(day); return i === undefined ? null : I[s].prices[i]; };
    for (const s in pos) { const p = price(s); if (p) { pos[s].last = p; pos[s].peak = Math.max(pos[s].peak ?? 0, p); } }
    let value = cash; for (const s in pos) value += pos[s].units * pos[s].last;
    days.push(day); values.push(value); cashShare.push(cash / value);
    if ((day - startDay - offset) % step) continue;
    const R = regimeOf(j);
    const A = {};
    for (const s of syms) {
      const i = IDX[s].get(day); if (i === undefined || i < 200) continue;
      const x = m.scoreAt(I[s], i); const raw = m.totalScore(x.short, x.medium, x.long, R); if (raw === null) continue;
      // dieselbe Regel wie auf der Seite: Bitcoin und Ethereum vor allem nach dem Kauf-Score, Altcoins nach dem Trend (js/model.js coinScore)
      const score = coinScore ? coinScore(raw, R, s) : m.coinScore(s === 'BTC' ? 'bitcoin' : s === 'ETH' ? 'ethereum' : s, raw, R.buy), v = vol30(I[s], i);
      const [signal] = m.signalOf(score);
      A[s] = { price: I[s].prices[i], analysis: { score, signal, long: x.long, risk: { level: v < 2.5 ? 0 : v < 5 ? 1 : v < 9 ? 2 : 3 }, horizon: '2–4 Wochen', stable: false } };
    }
    const idOf = (s) => (s === 'BTC' ? 'bitcoin' : s === 'ETH' ? 'ethereum' : s), sym = (id) => (id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : id);
    const holdings = Object.keys(pos).filter((s) => A[s]).map((s) => ({ id: idOf(s), name: s, symbol: s, units: pos[s].units, price: A[s].price, cost: pos[s].cost, peak: pos[s].peak, trimPrice: pos[s].trim, analysis: A[s].analysis }));
    const candidates = Object.keys(A).filter((s) => !pos[s] && A[s].analysis.signal === 'buy').map((s) => ({ id: idOf(s), name: s, symbol: s, price: A[s].price, analysis: A[s].analysis }));
    const core = ['BTC', 'ETH'].filter((s) => A[s]).map((s) => ({ id: idOf(s), name: s, symbol: s, price: A[s].price, analysis: A[s].analysis }));
    const p = mg.plan({ holdings, cash, candidates, core, regime: R, options, now: day * 86400000 });
    if (!p) continue;
    const total = values[values.length - 1];
    const sell = (s, usd, type) => { const pr = A[s].price; const u = Math.min(pos[s].units, usd / pr); pos[s].units -= u; cash += u * pr * (1 - fee); trades++; log.push([day, type, s, Math.round(u * pr / total * 1000) / 10]); if (pos[s].units * pr < 1) delete pos[s]; return u * pr * (1 - fee); };
    const buy = (s, usd, type) => { usd = Math.min(usd, cash); if (usd < 1 || !A[s]) return; const pr = A[s].price; const u = usd * (1 - fee) / pr; const o = pos[s] ?? { units: 0, cost: 0 }; o.cost = (o.cost * o.units + usd) / (o.units + u); o.units += u; o.last = pr; o.peak = Math.max(o.peak ?? 0, pr); pos[s] = o; cash -= usd; trades++; log.push([day, type, s, Math.round(usd / total * 1000) / 10]); };
    for (const mv of p.moves.filter((x) => ['sell', 'reduce', 'profit'].includes(x.type))) { if (pos[sym(mv.id)]) { sell(sym(mv.id), mv.usd, mv.type); if (mv.type === 'profit' && pos[sym(mv.id)]) pos[sym(mv.id)].trim = mv.price; } }
    for (const mv of p.moves.filter((x) => x.type === 'swap')) { if (!pos[sym(mv.id)]) continue; const got = sell(sym(mv.id), mv.usd, 'swap-out'); if (mv.from === 'profit' && pos[sym(mv.id)]) pos[sym(mv.id)].trim = mv.price; buy(sym(mv.to), got, 'swap-in'); }
    for (const mv of p.moves.filter((x) => ['buy', 'add'].includes(x.type))) buy(sym(mv.id), mv.usd, mv.type);
  }
  // Anteilswert, Start = 100; dazu Bitcoin über denselben Zeitraum zum Vergleich
  const nav = values.map((v) => Math.round(v / values[0] * 100 * 1000) / 1000);
  const years = (days[days.length - 1] - days[0]) / 365.25;
  let peak = 0, dd = 0; for (const v of nav) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  const btcStart = btc.prices[200], btcEnd = btc.prices[btc.n - 1];
  // Bestand heute und Bitcoin zum Vergleich (ebenfalls Start = 100)
  const lastDay = days[days.length - 1], total = values[values.length - 1];
  // price: Kurs am Stichtag – damit rechnet der Autopilot die Anteile auf die Kurse von heute um
  const holdings = Object.entries(pos).map(([s, o]) => ({ symbol: s, share: Math.round(o.units * o.last / total * 10000) / 100, price: o.last })).sort((a, b) => b.share - a.share);
  // Nächster Prüftag: Das Modell handelt alle 7 Tage zum Tagesschluss
  const k = (((lastDay - startDay - offset) % step) + step) % step;
  const btcNav = days.map((d) => { const i = IDX.BTC.get(d); return i === undefined ? null : Math.round(btc.prices[i] / btc.prices[200] * 100 * 100) / 100; });
  return {
    version: 2, built: Date.now(), coins: syms.length, fee, stepDays: step,
    t: days.map((d) => d * 86_400_000), nav, btc: btcNav,
    cash: Math.round(cash / total * 10000) / 100, holdings, asOf: lastDay * 86_400_000, next: (lastDay + (step - k)) * 86_400_000,
    cashHistory: days.map((d, i) => [d, Math.round(cashShare[i] * 100)]).filter((_, i) => (days.length - 1 - i) % 7 === 0),
    trades: log.slice(-40).reverse().map(([d, type, s, share]) => ({ t: d * 86_400_000, type, symbol: s, share })),
    stats: { years: Math.round(years * 10) / 10, cagr: Math.round((Math.pow(nav[nav.length - 1] / 100, 1 / years) - 1) * 1000) / 10, maxDrawdown: Math.round(dd * 1000) / 10,
      trades, btcCagr: Math.round((Math.pow(btcEnd / btcStart, 1 / years) - 1) * 1000) / 10 },
  };
}

if (process.argv[1]?.endsWith('model-curve.mjs')) {
  const out = process.argv[2] ?? 'model-curve.json';
  const c = await buildCurve();
  await writeFile(out, JSON.stringify(c));
  console.log(`Modell-Portfolio: ${c.coins} Coins, ${c.nav.length} Tage seit ${new Date(c.t[0]).toISOString().slice(0, 10)}, ${c.stats.cagr} % pro Jahr, größter Rückgang ${c.stats.maxDrawdown} %, Bitcoin ${c.stats.btcCagr} % pro Jahr, ${c.stats.trades} Handel`);
}
