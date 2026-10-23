// Zyklus-Kompass: bekannte Zyklus-Indikatoren für Bitcoin plus ein eigener Index, jeweils mit einem ehrlichen Rückblick,
// was danach geschah. Berechnet beim Veröffentlichen (scripts/seo-pages.mjs) und als /data/indices.json abgelegt.
//
//   Pi-Cycle-Top            111-Tage-Schnitt gegen 2 × 350-Tage-Schnitt (Philip Swift). Kreuzt der kurze den langen, galt das als Hoch.
//   Mayer-Multiple          Kurs / 200-Tage-Schnitt (Trace Mayer). Unter 0,8 historisch günstig, über 2,4 überhitzt.
//   2-Jahres-MA-Multiplikator  Kurs gegen 730-Tage-Schnitt und dessen Fünffaches: darunter Kaufzone, darüber Verkaufszone.
//   Volatilität             Schwankung von Bitcoin über 30 Tage, aufs Jahr gerechnet, mit Einordnung gegen die letzten 4 Jahre.
//   Altcoin-Saison-Index    Anteil der 50 größten Coins (ohne Bitcoin und Stablecoins), die Bitcoin über 90 Tage geschlagen haben.
//   Bitcoin-Dominanz        Anteil von Bitcoin am Marktwert aller Coins (CoinGecko).
//   Zyklus-Risiko (eigener Index, 0–100): Mittel aus Mayer-Multiple, 2-Jahres-MA, Pi-Cycle, Abstand zum Allzeithoch und
//                           Fear & Greed (30 Tage). 0 = tief und günstig, 100 = überhitzt.
//
// Zu jedem Indikator steht, wie oft Bitcoin 90 und 365 Tage nach vergleichbaren Ständen höher stand – getrennt für zwei Zeiträume,
// damit sichtbar ist, ob ein Zusammenhang hält. Vergangene Zyklen sind keine Garantie für den nächsten.
//
// Aufruf: node scripts/indices.mjs <datei.json>   (oder als Modul: buildIndices(snapshot))

import { writeFile } from 'node:fs/promises';
import { klines, fearGreed } from './model-curve.mjs';

const DAY = 86_400_000;
const SPLIT = Date.UTC(2022, 9, 6);   // wie in den übrigen Prüfungen: 2018–22 und 2022–26
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const r1 = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function sma(p, n) {
  const out = new Array(p.length).fill(null); let s = 0;
  for (let i = 0; i < p.length; i++) { s += p[i]; if (i >= n) s -= p[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

// Rückblick: Wie oft stand Bitcoin h Tage später höher, wenn der Indikator in einem Bereich lag – je Zeitraum
function backtest(t, p, values, buckets, hs = [90, 365]) {
  return buckets.map(([lo, hi, label]) => {
    const per = [0, 1].map((half) => Object.fromEntries(hs.map((h) => {
      const rets = [];
      for (let i = 0; i + h < p.length; i++) {
        const v = values[i];
        if (v === null || v < lo || v >= hi || (t[i] < SPLIT) !== (half === 0)) continue;
        rets.push(p[i + h] / p[i] - 1);
      }
      if (rets.length < 20) return [h, null];
      rets.sort((a, b) => a - b);
      return [h, { n: rets.length, up: Math.round(rets.filter((x) => x > 0).length / rets.length * 100), median: r1(rets[rets.length >> 1] * 100, 0) }];
    })));
    return { lo, hi, label, periods: per };
  });
}

export async function buildIndices(snap) {
  const btc = await klines('BTC');
  if (!btc) throw new Error('Bitcoin-Kurse fehlen');
  const { t, p } = btc;
  const livePrice = snap?.coins?.find((c) => c.id === 'bitcoin')?.current_price;
  if (livePrice > 0) p[p.length - 1] = livePrice;
  const F = await fearGreed();
  const n = p.length, last = n - 1;
  const s111 = sma(p, 111), s200 = sma(p, 200), s350 = sma(p, 350), s730 = sma(p, 730);
  const ath = []; { let hi = 0; for (let i = 0; i < n; i++) { hi = Math.max(hi, p[i]); ath[i] = hi; } }
  const fng30 = t.map((ms) => { let s = 0, k = 0; for (let d = 0; d < 30; d++) { const v = F.get(Math.floor(ms / DAY) - d); if (v !== undefined) { s += v; k++; } } return k >= 20 ? s / k : null; });
  const vol = t.map((_, i) => { if (i < 31) return null; const r = []; for (let k = i - 29; k <= i; k++) r.push(Math.log(p[k] / p[k - 1])); const mu = r.reduce((a, b) => a + b, 0) / 30; return Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / 29) * Math.sqrt(365) * 100; });

  const mayer = p.map((x, i) => (s200[i] ? x / s200[i] : null));
  const pi = p.map((_, i) => (s111[i] && s350[i] ? s111[i] / (2 * s350[i]) : null));
  const twoY = p.map((x, i) => (s730[i] ? x / s730[i] : null));
  const dd = p.map((x, i) => x / ath[i] - 1);
  // Zyklus-Risiko: jeder Baustein auf 0–100 gebracht, dann gemittelt
  const parts = (i) => (mayer[i] === null || pi[i] === null || twoY[i] === null || fng30[i] === null ? null : {
    mayer: clamp((mayer[i] - 0.7) / (2.4 - 0.7)) * 100,
    twoYear: clamp(Math.log(twoY[i]) / Math.log(5)) * 100,
    pi: clamp((pi[i] - 0.4) / 0.6) * 100,
    ath: clamp(1 + dd[i] / 0.8) * 100,
    fng: fng30[i],
  });
  const risk = t.map((_, i) => { const x = parts(i); return x ? (x.mayer + x.twoYear + x.pi + x.ath + x.fng) / 5 : null; });

  const RISK_BUCKETS = [[0, 20, 'Tief'], [20, 40, 'Günstig'], [40, 60, 'Neutral'], [60, 80, 'Erhitzt'], [80, 101, 'Überhitzt']];
  const weekly = (vals, d = 3) => t.map((ms, i) => [Math.floor(ms / DAY), vals[i] === null ? null : r1(vals[i], d)]).filter((x, i) => (last - i) % 7 === 0 && x[1] !== null);
  const pct = (arr, v) => { const a = arr.filter((x) => x !== null).sort((x, y) => x - y); return Math.round(a.filter((x) => x <= v).length / a.length * 100); };
  const volYears = vol.slice(-1461);

  // Altcoin-Saison: die 50 größten Coins ohne Bitcoin, Stablecoins und Token auf Aktien/Gold, mit Tageskursen von Binance
  const alts = (snap?.coins ?? []).filter((c) => c.id !== 'bitcoin' && !c.analysis?.stable && c.analysis?.signal !== 'none' && c.hist === 'Binance')
    .sort((a, b) => a.market_cap_rank - b.market_cap_rank).slice(0, 50);
  const altData = new Map();
  for (let i = 0; i < alts.length; i += 6) {
    await Promise.all(alts.slice(i, i + 6).map(async (c) => { try { const d = await klines(c.symbol.toUpperCase()); if (d) altData.set(c.id, d); } catch { /* fehlt */ } }));
  }
  const btcAt = new Map(t.map((ms, i) => [Math.floor(ms / DAY), p[i]]));
  const maps = [...altData.entries()].map(([id, d]) => [id, new Map(d.t.map((ms, i) => [Math.floor(ms / DAY), d.p[i]]))]);
  const today = Math.floor(t[last] / DAY);
  const seasonAt = (day) => {
    const b0 = btcAt.get(day - 90), b1 = btcAt.get(day); if (!b0 || !b1) return null;
    const rb = b1 / b0 - 1; let beat = 0, k = 0;
    for (const [, mp] of maps) { const a0 = mp.get(day - 90), a1 = mp.get(day); if (!a0 || !a1) continue; k++; if (a1 / a0 - 1 > rb) beat++; }
    return k >= 30 ? { value: Math.round(beat / k * 100), n: k } : null;
  };
  const seasonHist = []; for (let d = today - 730; d <= today; d += 3) { const s = seasonAt(d); if (s) seasonHist.push([d, s.value]); }
  const seasonNow = seasonAt(today);
  const leaders = maps.map(([id, mp]) => { const a0 = mp.get(today - 90), a1 = mp.get(today); return a0 && a1 ? { id, ret: r1((a1 / a0 - 1) * 100, 0) } : null; })
    .filter(Boolean).sort((a, b) => b.ret - a.ret);
  const symOf = (id) => alts.find((c) => c.id === id)?.symbol?.toUpperCase() ?? id;

  let dominance = null;
  try {
    const g = (await (await fetch('https://api.coingecko.com/api/v3/global')).json()).data;
    if (g?.market_cap_percentage?.btc) dominance = { btc: r1(g.market_cap_percentage.btc), eth: r1(g.market_cap_percentage.eth) };
  } catch { /* ohne Dominanz */ }

  const now = parts(last);
  return {
    version: 1, time: Date.now(), since: t[0],
    price: { value: p[last], ath: ath[last], dd: r1(dd[last] * 100) },
    risk: { value: r1(risk[last], 0), parts: now && Object.fromEntries(Object.entries(now).map(([k, v]) => [k, r1(v, 0)])),
      history: weekly(risk, 0), backtest: backtest(t, p, risk, RISK_BUCKETS) },
    pi: { ratio: r1(pi[last], 3), sma111: r1(s111[last], 0), line: r1(2 * s350[last], 0), history: weekly(pi),
      crossings: t.filter((_, i) => i > 0 && pi[i] !== null && pi[i - 1] !== null && pi[i] >= 1 && pi[i - 1] < 1).map((ms) => Math.floor(ms / DAY)),
      backtest: backtest(t, p, pi, [[0, 0.6, 'unter 0,6'], [0.6, 0.8, '0,6–0,8'], [0.8, 0.95, '0,8–0,95'], [0.95, 10, 'ab 0,95']]) },
    mayer: { value: r1(mayer[last], 2), sma200: r1(s200[last], 0), history: weekly(mayer, 2),
      backtest: backtest(t, p, mayer, [[0, 0.8, 'unter 0,8'], [0.8, 1, '0,8–1'], [1, 1.5, '1–1,5'], [1.5, 2.4, '1,5–2,4'], [2.4, 99, 'ab 2,4']]) },
    twoYear: { ratio: r1(twoY[last], 2), sma730: r1(s730[last], 0), top: r1(s730[last] * 5, 0), history: weekly(twoY, 2),
      backtest: backtest(t, p, twoY, [[0, 1, 'unter dem 2-Jahres-Schnitt'], [1, 2, '1–2-fach'], [2, 3.5, '2–3,5-fach'], [3.5, 99, 'ab 3,5-fach']]) },
    volatility: { value: r1(vol[last], 0), percentile: pct(volYears, vol[last]), history: weekly(vol, 0) },
    altseason: seasonNow && { value: seasonNow.value, n: seasonNow.n, history: seasonHist,
      leaders: leaders.slice(0, 5).map((x) => ({ ...x, symbol: symOf(x.id) })), laggards: leaders.slice(-5).reverse().map((x) => ({ ...x, symbol: symOf(x.id) })),
      btc90: r1((p[last] / (btcAt.get(today - 90) ?? p[last]) - 1) * 100, 0) },
    dominance,
    btcHistory: weekly(p, 0),
  };
}

if (process.argv[1]?.endsWith('indices.mjs')) {
  const snap = await (await fetch('https://raw.githubusercontent.com/Coinweather/coinweather.github.io/data/snapshot.json')).json();
  const x = await buildIndices(snap);
  await writeFile(process.argv[2] ?? 'indices.json', JSON.stringify(x));
  console.log(`Zyklus-Risiko ${x.risk.value} · Pi ${x.pi.ratio} · Mayer ${x.mayer.value} · 2J ${x.twoYear.ratio} · Vol ${x.volatility.value} % (P${x.volatility.percentile}) · Altseason ${x.altseason?.value} (${x.altseason?.n}) · Dominanz ${x.dominance?.btc}`);
  console.log(JSON.stringify(x.risk.backtest, null, 0));
}
