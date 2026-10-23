// Baut die Seite zum Veröffentlichen: die App-Dateien plus täglich neue, einzeln auffindbare Seiten für Suchmaschinen.
// Die App selbst steckt in einer einzigen Seite mit #-Adressen – die kann Google kaum lesen. Darum gibt es zusätzlich:
//   /crypto-weather-today/   der Kryptomarkt heute: Markt-Index, Fear & Greed, Zyklus, Aussicht, größte Bewegungen
//   /coin/<id>/              je eine Seite für die 250 größten Coins: Kurs, Entwicklung, Großwetterlage, Signal (verdeckt)
//   /coins/                  Übersicht mit Links auf alle Coin-Seiten
//   sitemap.xml, robots.txt  damit Suchmaschinen alles finden
// Die Seiten sind englisch (größte Suchnachfrage) und sagen klar: keine Anlageberatung. Die Signale einzelner Coins bleiben
// wie in der App dem kostenlosen Konto vorbehalten – außer Bitcoin und Ethereum als Beispiel.
//
// Aufruf: node scripts/seo-pages.mjs <ordner>           baut die ganze Seite in <ordner>
//         node scripts/seo-pages.mjs --indexnow <ordner>  meldet alle Adressen aus der Sitemap an Bing & Co. (IndexNow)

import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import * as i18n from '../js/i18n.js';

const SITE = 'https://coinweather.github.io';
const SNAPSHOT = 'https://raw.githubusercontent.com/Coinweather/coinweather.github.io/data/snapshot.json';
const INDEXNOW_KEY = 'c0a1e3f9b7d24e6a8f51b2c7d9e04a36';   // öffentlich gedacht: liegt als Datei auf der Seite
const root = new URL('..', import.meta.url);
const args = process.argv.slice(2);

// ---------- IndexNow: neue und geänderte Seiten an Bing, Yandex, Seznam und Naver melden ----------
if (args[0] === '--indexnow') {
  const xml = await readFile(`${args[1]}/sitemap.xml`, 'utf8');
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'coinweather.github.io', key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList }) });
  console.log(`IndexNow: ${urlList.length} Adressen gemeldet – Antwort ${r.status}`);
  process.exit();
}

const out = args[0];
if (!out) throw new Error('Zielordner fehlt');

// ---------- App-Dateien übernehmen ----------
await mkdir(out, { recursive: true });
for (const f of ['index.html', 'style.css', 'og-image.jpg', '.nojekyll']) await cp(new URL(f, root), `${out}/${f}`);
await cp(new URL('js', root), `${out}/js`, { recursive: true });
await mkdir(`${out}/werbung`, { recursive: true });
for (const f of await readdir(new URL('werbung', root))) if (f.endsWith('.jpg')) await cp(new URL(`werbung/${f}`, root), `${out}/werbung/${f}`);
await writeFile(`${out}/${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);

// ---------- Tagesstand ----------
const snap = await (await fetch(`${SNAPSHOT}?t=${Date.now()}`)).json();
const { market, fng, coins, record } = snap;
i18n.useDictionary((await import('../js/lang/en.js')).default);
const en = (t) => (t ? i18n.say(t) : t);
const LABEL = { 'Kaufen': 'Buy', 'Eher kaufen': 'Lean buy', 'Halten': 'Hold', 'Eher verkaufen': 'Lean sell', 'Verkaufen': 'Sell' };
const ZONE = { deep: 'deep in the cycle', low: 'lower third of the cycle', mid: 'middle of the cycle', high: 'near the high' };
const MOOD = (v) => (v < 25 ? 'extreme fear' : v < 45 ? 'fear' : v <= 55 ? 'neutral' : v <= 75 ? 'greed' : 'extreme greed');
const SAMPLES = ['bitcoin', 'ethereum'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = (v) => (!isNum(v) ? '–' : `$${v >= 1 ? num(v, v >= 1000 ? 0 : 2) : v.toPrecision(3)}`);
const big = (v) => (!isNum(v) ? '–' : v >= 1e12 ? `$${num(v / 1e12, 2)} trillion` : v >= 1e9 ? `$${num(v / 1e9, 1)} billion` : `$${num(v / 1e6, 0)} million`);
const pct = (v) => (!isNum(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), 1)} %`);
const tone = (v) => (!isNum(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const day = new Date(snap.time).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const iso = new Date(snap.time).toISOString();
const label = LABEL[market.label] ?? market.label;
const app = (hash = '') => `/?von=seo${hash}`;
const btcUp7 = market.forecast?.btc?.short?.up, btcUp30 = market.forecast?.btc?.medium?.up;
const altUp7 = market.forecast?.alt?.short?.up, altUp30 = market.forecast?.alt?.medium?.up;
const buys = coins.filter((c) => c.analysis?.signal === 'buy').length;
const rated = coins.filter((c) => c.analysis?.signal && c.analysis.signal !== 'none').length;
const slug = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]/g, '');

// ---------- Rahmen ----------
const CSS = `:root{--bg:#0b0f17;--panel:#121826;--line:#263042;--text:#e8ecf3;--muted:#9aa4b2;--accent:#f7931a;--up:#3ecf8e;--down:#ef5b5b}
@media (prefers-color-scheme:light){:root{--bg:#f6f7fb;--panel:#fff;--line:#e3e7ef;--text:#141a26;--muted:#5b6575;--up:#12864a;--down:#c53b3b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
a{color:var(--accent)}.wrap{max-width:860px;margin:0 auto;padding:0 16px}header{border-bottom:1px solid var(--line);padding:14px 0}
header .wrap{display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{color:var(--text);font-weight:800;text-decoration:none;font-size:19px}
.btn{display:inline-block;background:var(--accent);color:#111;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:999px;white-space:nowrap;margin:4px 0}
header .btn{padding:7px 14px;font-size:14px}
.btn.ghost{background:none;color:var(--text);border:1px solid var(--line)}h1{font-size:clamp(26px,5vw,38px);line-height:1.15;margin:28px 0 6px}
h2{margin:30px 0 8px;font-size:22px}.muted{color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:14px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.stat .v{font-size:24px;font-weight:800}.stat .l{color:var(--muted);font-size:13px}
.up{color:var(--up)}.down{color:var(--down)}table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}
td.n,th.n{text-align:right}.cta{border-color:var(--accent)}.links{columns:3 160px;padding-left:18px}footer{border-top:1px solid var(--line);margin-top:40px;padding:18px 0 40px;font-size:13.5px}`;
const page = ({ path, title, description, body }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}"><meta name="theme-color" content="#0b0f17">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/og-image.jpg"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2714%27 fill=%27%23f7931a%27/%3E%3C/svg%3E">
<style>${CSS}</style></head>
<body><header><div class="wrap"><a class="brand" href="/">☁️ Coinweather</a><a class="btn" href="${app()}">Open the app</a></div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap"><p><a href="/crypto-weather-today/">Crypto market today</a> · <a href="/coins/">All coins</a> · <a href="/#/risiko">Risk notice</a> ·
<a href="/#/impressum">Legal notice</a> · <a href="/#/datenschutz">Privacy</a></p>
<p class="muted">Not financial advice. Coinweather is an information service. Prices cannot be predicted reliably; probabilities are based on past
prices and can be wrong. Crypto assets can fall sharply – up to a total loss. Updated ${esc(day)}. Data: CoinGecko, Binance, Gate.io, alternative.me.</p></div></footer>
</body></html>`;
const offer = (text) => `<section class="panel cta"><strong>${text}</strong>
  <p class="muted">Free account: the signal and outlook for 1,000 coins, portfolio check and an open track record – 30 days of all features, no payment details.</p>
  <p><a class="btn" href="${app('#/konto')}">Start free</a> <a class="btn ghost" href="${app()}">See today’s market – no signup</a></p></section>`;
const marketStats = () => `<div class="grid">
  <div class="panel stat"><div class="l">Market index</div><div class="v">${market.value}/100</div><div>${esc(label)}</div></div>
  ${fng ? `<div class="panel stat"><div class="l">Fear &amp; Greed</div><div class="v">${fng.value}</div><div>${MOOD(fng.value)}${isNum(fng.week) ? ` · 7 days ago ${fng.week}` : ''}</div></div>` : ''}
  ${market.cycle ? `<div class="panel stat"><div class="l">Cycle (12 months)</div><div class="v">${num(-market.cycle.dd, 0)} %</div><div>below Bitcoin’s all-time high · ${ZONE[market.cycle.zone] ?? ''}</div></div>` : ''}
  <div class="panel stat"><div class="l">Buy signals</div><div class="v">${buys}</div><div>of ${rated} rated coins</div></div></div>`;
const odds = isNum(btcUp7) ? `After comparable market days since 2018, Bitcoin was higher 7 days later in ${btcUp7} of 100 cases${isNum(btcUp30) ? ` and 30 days later in ${btcUp30} of 100` : ''}.` : '';

// ---------- Kryptomarkt heute ----------
const movers = coins.filter((c) => c.market_cap_rank <= 100 && c.analysis?.signal !== 'none' && !c.analysis?.stable && isNum(c.price_change_percentage_24h_in_currency))
  .sort((a, b) => b.price_change_percentage_24h_in_currency - a.price_change_percentage_24h_in_currency);
const moverRows = (list) => list.map((c) => `<tr><td><a href="/coin/${slug(c.id)}/">${esc(c.name)}</a> <span class="muted">${esc(c.symbol.toUpperCase())}</span></td>
  <td class="n">${usd(c.current_price)}</td><td class="n ${tone(c.price_change_percentage_24h_in_currency)}">${pct(c.price_change_percentage_24h_in_currency)}</td></tr>`).join('');
const btc = coins.find((c) => c.id === 'bitcoin');
const pages = [];
pages.push({ path: '/crypto-weather-today/', title: `Crypto market today (${day}): Fear & Greed, market index and outlook`,
  description: `Is now a good time to buy crypto? Today’s crypto weather: market index ${market.value}/100 (${label}), Fear & Greed ${fng?.value ?? '–'} (${fng ? MOOD(fng.value) : '–'}), Bitcoin ${usd(btc?.current_price)}. Updated daily. Not financial advice.`,
  body: `<h1>Crypto market today: ${esc(label)} (${market.value}/100)</h1><p class="muted">Crypto weather report for ${esc(day)} – updated every day.</p>
  ${marketStats()}
  <h2>Is now a good time to buy crypto?</h2>
  <p>Nobody can know that for sure. What the data says today: Coinweather’s market index stands at <strong>${market.value} out of 100 – “${esc(label)}”</strong>.
  It combines Bitcoin’s market phase, market breadth and news sentiment and looks at the next few weeks. The Fear &amp; Greed index is at
  <strong>${fng?.value ?? '–'}</strong> (${fng ? MOOD(fng.value) : '–'}). ${odds} ${isNum(altUp7) ? `For the average coin it was ${altUp7} of 100 after 7 days.` : ''}
  These are tendencies from past data, not promises.</p>
  <h2>Bitcoin today</h2><p>Bitcoin trades at <strong>${usd(btc?.current_price)}</strong> (${pct(btc?.price_change_percentage_24h_in_currency)} in 24 hours,
  ${pct(btc?.price_change_percentage_7d_in_currency)} in 7 days) and is ${num(Math.abs(btc?.ath_change_percentage ?? 0), 0)} % below its all-time high.
  <a href="/coin/bitcoin/">Bitcoin page →</a></p>
  <h2>Top movers of the 100 largest coins (24 hours)</h2><p class="muted">Observations, not recommendations.</p>
  <div class="panel"><table><tr><th>Gainers</th><th class="n">Price</th><th class="n">24 h</th></tr>${moverRows(movers.slice(0, 5))}</table></div>
  <div class="panel"><table><tr><th>Losers</th><th class="n">Price</th><th class="n">24 h</th></tr>${moverRows(movers.slice(-5).reverse())}</table></div>
  ${record?.d7 ? `<h2>Open track record</h2><p>Every buy signal of the site is re-measured. Since ${new Date(record.since * 86_400_000).toLocaleDateString('en-US')}:
  after 7 days on average <strong>${pct(record.d7.avg)}</strong>, ${record.d7.up} of ${record.d7.n} in profit (Bitcoin over the same period ${pct(record.d7.btc)}).
  Including the bad results – that is the point.</p>` : ''}
  ${offer('Which coins have a buy signal today?')}` });

// ---------- Coin-Seiten ----------
const top = coins.filter((c) => isNum(c.market_cap_rank) && c.market_cap_rank <= 250).sort((a, b) => a.market_cap_rank - b.market_cap_rank);
for (const [i, c] of top.entries()) {
  const a = c.analysis ?? {}, sym = c.symbol.toUpperCase(), name = c.name;
  const sample = SAMPLES.includes(c.id);
  const near = top.slice(Math.max(0, i - 6), i + 7).filter((x) => x.id !== c.id);
  const signal = a.stable ? `${esc(name)} is a stablecoin – it is meant to keep its value, so Coinweather gives it no buy or sell signal.`
    : sample ? `Coinweather’s signal for ${esc(name)} today: <strong>${esc(LABEL[a.label] ?? a.label)}</strong>${a.horizon ? `, holding period ${esc(en(a.horizon))}` : ''}${a.risk?.label ? `, risk ${esc(en(a.risk.label))}` : ''}.`
    : `Coinweather rates ${esc(name)} every 15 minutes. The current signal, holding period and risk are shown in a free account.`;
  pages.push({ path: `/coin/${slug(c.id)}/`, title: `${name} (${sym}) price today and outlook – ${day}`,
    description: `${name} is at ${usd(c.current_price)} (${pct(c.price_change_percentage_24h_in_currency)} in 24h, ${pct(c.price_change_percentage_7d_in_currency)} in 7 days). Crypto market index ${market.value}/100 (${label}), Fear & Greed ${fng?.value ?? '–'}. Not financial advice.`,
    body: `<h1>${esc(name)} (${esc(sym)}) today</h1><p class="muted">Price, trend and crypto weather for ${esc(day)} – updated every day.</p>
    <div class="grid"><div class="panel stat"><div class="l">Price</div><div class="v">${usd(c.current_price)}</div></div>
      <div class="panel stat"><div class="l">24 hours</div><div class="v ${tone(c.price_change_percentage_24h_in_currency)}">${pct(c.price_change_percentage_24h_in_currency)}</div></div>
      <div class="panel stat"><div class="l">7 days</div><div class="v ${tone(c.price_change_percentage_7d_in_currency)}">${pct(c.price_change_percentage_7d_in_currency)}</div></div>
      <div class="panel stat"><div class="l">Rank</div><div class="v">#${c.market_cap_rank}</div></div></div>
    <p>${esc(name)} trades at <strong>${usd(c.current_price)}</strong>, ${pct(c.price_change_percentage_24h_in_currency)} in the last 24 hours and
    ${pct(c.price_change_percentage_7d_in_currency)} over 7 days. It is number ${c.market_cap_rank} by market capitalisation (${big(c.market_cap)})
    ${isNum(c.ath_change_percentage) ? `and ${num(Math.abs(c.ath_change_percentage), 0)} % below its all-time high of ${usd(c.ath)}` : ''}.</p>
    <div class="panel"><table><tr><th>Period</th><th class="n">Change</th></tr>
      ${[['24 hours', c.price_change_percentage_24h_in_currency], ['7 days', c.price_change_percentage_7d_in_currency], ['30 days', c.price_change_percentage_30d_in_currency],
        ['200 days', c.price_change_percentage_200d_in_currency], ['1 year', c.price_change_percentage_1y_in_currency]]
        .map(([l, v]) => `<tr><td>${l}</td><td class="n ${tone(v)}">${pct(v)}</td></tr>`).join('')}</table></div>
    <h2>Is now a good time to buy ${esc(name)}?</h2>
    <p>Nobody can know that for sure. What the data says today: the overall crypto market index is <strong>${market.value}/100 (“${esc(label)}”)</strong> and the
    Fear &amp; Greed index is at ${fng?.value ?? '–'} (${fng ? MOOD(fng.value) : '–'}). ${odds}</p><p>${signal}</p>
    ${sample ? offer(`See the signal for all 1,000 coins`) : offer(`See the signal for ${esc(name)}`)}
    <h2>Market today</h2>${marketStats()}<p><a href="/crypto-weather-today/">Full crypto weather report →</a></p>
    <h2>Similar by market cap</h2><ul class="links">${near.map((x) => `<li><a href="/coin/${slug(x.id)}/">${esc(x.name)} (${esc(x.symbol.toUpperCase())})</a></li>`).join('')}</ul>` });
}

// ---------- Übersicht ----------
pages.push({ path: '/coins/', title: `Crypto prices today: the 250 largest coins – ${day}`,
  description: `Prices, 24-hour and 7-day changes of the 250 largest cryptocurrencies, plus today’s crypto weather: market index ${market.value}/100 (${label}). Updated daily.`,
  body: `<h1>The 250 largest coins today</h1><p class="muted">Updated ${esc(day)}. Market index today: ${market.value}/100 – ${esc(label)}.
  <a href="/crypto-weather-today/">Crypto weather report →</a></p>
  <div class="panel"><table><tr><th>#</th><th>Coin</th><th class="n">Price</th><th class="n">24 h</th><th class="n">7 days</th></tr>
  ${top.map((c) => `<tr><td>${c.market_cap_rank}</td><td><a href="/coin/${slug(c.id)}/">${esc(c.name)}</a> <span class="muted">${esc(c.symbol.toUpperCase())}</span></td>
    <td class="n">${usd(c.current_price)}</td><td class="n ${tone(c.price_change_percentage_24h_in_currency)}">${pct(c.price_change_percentage_24h_in_currency)}</td>
    <td class="n ${tone(c.price_change_percentage_7d_in_currency)}">${pct(c.price_change_percentage_7d_in_currency)}</td></tr>`).join('')}</table></div>
  ${offer('Which of these coins have a buy signal today?')}` });

for (const p of pages) {
  await mkdir(`${out}${p.path}`, { recursive: true });
  await writeFile(`${out}${p.path}index.html`, page(p));
}
const urls = ['/', ...pages.map((p) => p.path)];
await writeFile(`${out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map((u) => `<url><loc>${SITE}${u}</loc><lastmod>${iso}</lastmod><changefreq>daily</changefreq></url>`).join('\n')}\n</urlset>\n`);
await writeFile(`${out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`${pages.length} Seiten für Suchmaschinen gebaut (${day})`);
