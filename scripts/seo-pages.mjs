// Baut die Seite zum Veröffentlichen: die App-Dateien plus täglich neue, einzeln auffindbare Seiten für Suchmaschinen.
// Die App selbst steckt in einer einzigen Seite mit #-Adressen – die kann Google kaum lesen. Darum gibt es zusätzlich,
// in allen 7 Sprachen der App (Englisch ohne Vorsilbe, die anderen unter /de/, /es/, /fr/, /it/, /pt/, /tr/):
//   /crypto-weather-today/   der Kryptomarkt heute: Kauf-Score, Fear & Greed, Zyklus, Aussicht, größte Bewegungen
//   /should-i-buy-bitcoin-now/  „Soll ich jetzt Bitcoin kaufen?“: Kauf-Score mit seinen fünf Bausteinen, Jahresrückblick, FAQ (für Google)
//   /should-i-buy-ethereum-now/ dasselbe für Ethereum (sein Kauf-Score wie in der App)
//   /best-crypto-to-buy-now/  die 10 stärksten Kauf-Scores des Tages
//   /crypto-portfolio-autopilot/  der Autopilot: Modell-Portfolio heute (teils verdeckt), Ablauf, Rückrechnung, FAQ
//   /fear-and-greed-index/   der Fear & Greed Index heute mit dem, was die Rückrechnung über Angst und Gier zeigt
//   /coin/<id>/              je eine Seite für die 500 größten Coins: Kurs, Entwicklung, Großwetterlage, Signal (verdeckt)
//   /coins/                  Übersicht mit Links auf alle Coin-Seiten
//   /bitcoin-cycle-risk/, /altcoin-season-index/, /pi-cycle-top/, /mayer-multiple/   Indikatoren aus dem Zyklus-Kompass
//   /savings-plan/<id>/      Sparplan-Rückblick für die 40 größten Coins (100 $ pro Monat, 1000 $ einmalig) und eine Übersicht
//   sitemap.xml, robots.txt, feed.xml (RSS, englisch)
//   og/<sprache>.jpg         tagesaktuelles Vorschaubild für geteilte Links (braucht sharp, sonst bleibt og-image.jpg)
// Jede Seite verweist auf ihre Fassungen in den anderen Sprachen (hreflang), damit Google jedem Land die passende zeigt.
// Die Seiten sagen klar: keine Anlageberatung. Die Signale einzelner Coins bleiben wie in der App dem kostenlosen Konto
// vorbehalten – außer Bitcoin und Ethereum als Beispiel.
//
// Aufruf: node scripts/seo-pages.mjs <ordner>           baut die ganze Seite in <ordner>
//         node scripts/seo-pages.mjs --indexnow <ordner>  meldet alle Adressen aus der Sitemap an Bing & Co. (IndexNow)

import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import * as i18n from '../js/i18n.js';
import { RISK_ZONES, buyZone, buyHistory } from '../js/model.js';
import { adjusted, RESERVE_BACKTEST, HOLD_BACKTEST } from '../js/manager.js';

const SITE = 'https://coinweather.github.io';
const SNAPSHOT = 'https://raw.githubusercontent.com/Coinweather/coinweather.github.io/data/snapshot.json';
const INDEXNOW_KEY = 'c0a1e3f9b7d24e6a8f51b2c7d9e04a36';   // öffentlich gedacht: liegt als Datei auf der Seite
const root = new URL('..', import.meta.url);
const args = process.argv.slice(2);

// ---------- IndexNow: neue und geänderte Seiten an Bing, Yandex, Seznam und Naver melden ----------
if (args[0] === '--indexnow') {
  const xml = await readFile(`${args[1]}/sitemap.xml`, 'utf8');
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (let i = 0; i < all.length; i += 10_000) {   // höchstens 10 000 Adressen je Meldung
    const urlList = all.slice(i, i + 10_000);
    const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'coinweather.github.io', key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList }) });
    console.log(`IndexNow: ${urlList.length} Adressen gemeldet – Antwort ${r.status}`);
  }
  process.exit();
}

const out = args[0];
if (!out) throw new Error('Zielordner fehlt');

// ---------- App-Dateien übernehmen ----------
await mkdir(out, { recursive: true });
for (const f of ['index.html', 'style.css', 'og-image.jpg', '.nojekyll', 'manifest.webmanifest', 'sw.js', 'widget.html']) await cp(new URL(f, root), `${out}/${f}`);
await cp(new URL('icons', root), `${out}/icons`, { recursive: true });
// Bestätigungsdatei der Google Search Console – muss dauerhaft erreichbar bleiben
for (const f of await readdir(root)) if (/^google[0-9a-f]+\.html$/.test(f)) await cp(new URL(f, root), `${out}/${f}`);
await cp(new URL('js', root), `${out}/js`, { recursive: true });
await mkdir(`${out}/werbung`, { recursive: true });
for (const f of await readdir(new URL('werbung', root))) if (f.endsWith('.jpg')) await cp(new URL(`werbung/${f}`, root), `${out}/werbung/${f}`);
await writeFile(`${out}/${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);

// ---------- Tagesstand ----------
// SNAPSHOT_FILE=<datei>: lokaler Stand zum Testen statt des veröffentlichten
const snap = process.env.SNAPSHOT_FILE ? JSON.parse(await readFile(process.env.SNAPSHOT_FILE, 'utf8')) : await (await fetch(`${SNAPSHOT}?t=${Date.now()}`)).json();
const { market, fng, coins, record } = snap;

// Modell-Portfolio des Autopiloten für den Sparplan-Rechner (scripts/model-curve.mjs) – fehlt es, zeigt der Rechner es nicht
let modelData = null;
try {
  const { buildCurve, COINS } = await import('./model-curve.mjs');
  // Auswahl: die 84 geprüften Coins plus die heutigen Top 200 mit Kursgeschichte bei Binance – so kann das Modell die Coins
  // mit den besten Kauf-Scores unter den großen Coins kaufen. Rückrechnung (7 Starttage, Oktober 2026): 82 % statt 81 % pro Jahr,
  // seit 2022 46 % statt 43 %, größter Rückgang gleich. Vorsicht: Die heutigen Top 200 sind im Nachhinein gewählt.
  const wide = [...new Set([...COINS, ...coins.filter((c) => (c.market_cap_rank ?? 9999) <= 200 && c.hist === 'Binance' && !c.analysis?.stable
    && c.analysis?.signal !== 'none').map((c) => c.symbol.toUpperCase()).filter((s) => /^[A-Z0-9]+$/.test(s))])];
  const curve = await buildCurve({ coins: wide });
  // Der Autopilot im Portfolio folgt dem Modell der gewählten Strategie: Bestand, Reserve und Prüftag je Strategie
  const { RESERVE_MODES } = await import('../js/manager.js');
  const target = (c) => ({ cash: c.cash, holdings: c.holdings, asOf: c.asOf, next: c.next, trades: c.trades.slice(0, 20) });
  curve.profiles = { balanced: target(curve) };
  for (const key of Object.keys(RESERVE_MODES).filter((k) => k !== 'balanced')) {
    // Vorsichtig bleibt bei den 84 geprüften Coins – mit der breiten Auswahl war die Rückrechnung dort schlechter
    const c = await buildCurve({ options: RESERVE_MODES[key].options });
    curve.profiles[key] = { ...target(c), stats: c.stats };
  }
  await mkdir(`${out}/data`, { recursive: true });
  await writeFile(`${out}/data/model-curve.json`, JSON.stringify(curve));
  modelData = curve;
  console.log(`Modell-Portfolio: ${curve.stats.cagr} % pro Jahr seit ${new Date(curve.t[0]).toISOString().slice(0, 10)}`);
} catch (err) { console.log(`Modell-Portfolio nicht berechnet: ${err.message}`); }


// Zyklus-Kompass (scripts/indices.mjs) für die App und die Indikator-Seiten
let indices = null;
try {
  const { buildIndices } = await import('./indices.mjs');
  indices = await buildIndices(snap);
  await mkdir(`${out}/data`, { recursive: true });
  await writeFile(`${out}/data/indices.json`, JSON.stringify(indices));
  console.log(`Zyklus-Kompass: Zyklus-Risiko ${indices.risk.value}, Altcoin-Saison ${indices.altseason?.value}`);
} catch (err) { console.log(`Zyklus-Kompass nicht berechnet: ${err.message}`); }
// Älterer Tagesstand ohne Kauf-Score: aus dem Zyklus-Risiko ableiten (Kauf-Score = 100 − Zyklus-Risiko)
if (!market.buy && Number.isFinite(indices?.risk?.value)) {
  const v = Math.round(100 - indices.risk.value), [, signal, label] = buyZone(v);
  Object.assign(market, { value: v, signal, label });
}
const SAMPLES = ['bitcoin', 'ethereum'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const tone = (v) => (!isNum(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const slug = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]/g, '');
const iso = new Date(snap.time).toISOString();
// Dieselbe Aussage wie die App: ein Jahr nach vergleichbaren Kauf-Scores (Zyklus-Kompass, seit 2022)
const year = buyHistory(market.value);
// Unter 45 ist der Rückblick seit 2018 gerechnet (seit 2022 zu wenige solche Tage) – die Texte nennen dann das richtige Jahr
const since = (t) => (market.value < 45 ? String(t).replaceAll('2022', '2018') : t);
const btcUp7 = year?.btc.up, btcUp30 = year?.eth.up, altUp7 = year?.alt.up;
const buys = coins.filter((c) => c.analysis?.signal === 'buy').length;
const rated = coins.filter((c) => c.analysis?.signal && c.analysis.signal !== 'none').length;
const btc = coins.find((c) => c.id === 'bitcoin');
const avg7 = market.regime?.fng?.avg7;
const movers = coins.filter((c) => c.market_cap_rank <= 100 && c.analysis?.signal !== 'none' && !c.analysis?.stable && isNum(c.price_change_percentage_24h_in_currency))
  .sort((a, b) => b.price_change_percentage_24h_in_currency - a.price_change_percentage_24h_in_currency);
const top = coins.filter((c) => isNum(c.market_cap_rank) && c.market_cap_rank <= 500).sort((a, b) => a.market_cap_rank - b.market_cap_rank);
const ch = (c, k) => c?.[`price_change_percentage_${k}_in_currency`];

// ---------- Sparplan-Seiten: Rückblick für die größten Coins (gleiche Rechnung wie der Rechner in der App) ----------
const { history } = await import('../js/api.js');
const SP_COINS = top.filter((c) => !c.analysis?.stable && c.analysis?.signal !== 'none' && ['Binance', 'Gate.io'].includes(c.hist)).slice(0, 40);
const spData = new Map();
for (let i = 0; i < SP_COINS.length; i += 4) {
  await Promise.all(SP_COINS.slice(i, i + 4).map(async (c) => {
    try { const d = await history(c.symbol, c.hist); if (d) spData.set(c.id, d); } catch { /* ohne Kursgeschichte keine Seite */ }
  }));
}
function simulate(data, price, mode, amount, startMs) {
  const t = data.t, p = [...data.p.slice(0, -1), price];
  const i0 = t.findIndex((x) => x >= startMs);
  if (i0 < 0 || i0 >= t.length - 1 || t[i0] - startMs > 20 * 86_400_000) return null;
  let units = 0, invested = 0, month = null, worst = 0;
  for (let i = i0; i < t.length; i++) {
    const d = new Date(t[i]), key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (mode === 'once' ? i === i0 : key !== month) { units += amount / p[i]; invested += amount; month = key; }
    worst = Math.min(worst, units * p[i] / invested - 1);
  }
  const last = units * p[p.length - 1];
  return { invested, last, ret: last / invested - 1, worst, from: t[i0] };
}
const nowY = new Date(snap.time).getUTCFullYear();
const SP_STARTS = [3, 2, 1].map((y) => Date.UTC(nowY - y, 0, 1));
const spResults = new Map(SP_COINS.filter((c) => spData.has(c.id)).map((c) => [c.id, {
  plan: SP_STARTS.map((s) => simulate(spData.get(c.id), c.current_price, 'plan', 100, s)),
  once: SP_STARTS.map((s) => simulate(spData.get(c.id), c.current_price, 'once', 1000, s)),
}]));
console.log(`Sparplan-Seiten: ${spResults.size} Coins mit Kursgeschichte`);

const SP = {
  en: { nav: 'Savings plan calculator', title: (n, y) => `${n} savings plan calculator: $100 a month since ${y} – result today`,
    desc: (n, y, inv, val, r) => `If you had invested $100 a month in ${n} since January ${y}, you would have paid in ${inv} – worth ${val} today (${r}). Past results with real daily prices, no forecast.`,
    h1: (n) => `${n} savings plan: what would it be worth today?`, sub: (d) => `Calculated with real daily prices, updated ${d}. Without fees and taxes.`,
    lead: (n, y, inv, val, r, w) => `If you had put <strong>$100 into ${n} every month since January ${y}</strong>, you would have paid in <strong>${inv}</strong> – today that would be worth <strong>${val}</strong> (${r}).${w ? ` Along the way the value was at times ${w} below the amount paid in.` : ''}`,
    planH: '$100 every month', onceH: '$1,000 one-time investment', start: 'Start', inv: 'Paid in', val: 'Value today', ret: 'Return', worst: 'Lowest point', never: 'never in the red',
    jan: (y) => `Jan ${y}`, try: 'Try your own amount and start date', tryBtn: 'Open the calculator', note: 'The past is no forecast. Crypto assets can fall sharply – up to a total loss. Not financial advice.',
    others: 'Savings plans for other coins', hubTitle: (y) => `Crypto savings plan comparison: $100 a month since ${y} in 40 coins`, hubDesc: (y) => `Which crypto savings plan did best since ${y}? $100 a month in the 40 largest coins, calculated with real daily prices. Past results, not a forecast.`,
    hubH1: 'Crypto savings plans compared', hubSub: (y, d) => `$100 every month since January ${y}, calculated with real daily prices – updated ${d}. Past results, not a forecast.`, coin: 'Coin' },
  de: { nav: 'Sparplan-Rechner', title: (n, y) => `${n} Sparplan-Rechner: 100 $ pro Monat seit ${y} – das Ergebnis heute`,
    desc: (n, y, inv, val, r) => `Wer seit Januar ${y} jeden Monat 100 $ in ${n} gesteckt hätte, hätte ${inv} eingezahlt – heute wären es ${val} (${r}). Rückblick mit echten Tageskursen, keine Prognose.`,
    h1: (n) => `${n}-Sparplan: Was wäre er heute wert?`, sub: (d) => `Gerechnet mit echten Tageskursen, Stand ${d}. Ohne Gebühren und Steuern.`,
    lead: (n, y, inv, val, r, w) => `Wer <strong>seit Januar ${y} jeden Monat 100 $ in ${n}</strong> gesteckt hätte, hätte <strong>${inv}</strong> eingezahlt – heute wären es <strong>${val}</strong> (${r}).${w ? ` Unterwegs lag der Wert zeitweise ${w} unter dem eingezahlten Betrag.` : ''}`,
    planH: '100 $ jeden Monat', onceH: '1000 $ einmalig', start: 'Start', inv: 'Eingezahlt', val: 'Wert heute', ret: 'Rendite', worst: 'Tiefster Stand', never: 'nie im Minus',
    jan: (y) => `Jan. ${y}`, try: 'Rechne mit deinem eigenen Betrag und Startmonat', tryBtn: 'Zum Rechner', note: 'Die Vergangenheit ist keine Prognose. Kryptowerte können stark fallen – bis zum Totalverlust. Keine Anlageberatung.',
    others: 'Sparpläne für andere Coins', hubTitle: (y) => `Krypto-Sparpläne im Vergleich: 100 $ pro Monat seit ${y} in 40 Coins`, hubDesc: (y) => `Welcher Krypto-Sparplan lief seit ${y} am besten? 100 $ pro Monat in die 40 größten Coins, gerechnet mit echten Tageskursen. Rückblick, keine Prognose.`,
    hubH1: 'Krypto-Sparpläne im Vergleich', hubSub: (y, d) => `100 $ jeden Monat seit Januar ${y}, gerechnet mit echten Tageskursen – Stand ${d}. Rückblick, keine Prognose.`, coin: 'Coin' },
  es: { nav: 'Calculadora de plan de ahorro', title: (n, y) => `Calculadora de plan de ahorro en ${n}: 100 $ al mes desde ${y} – resultado hoy`,
    desc: (n, y, inv, val, r) => `Si hubieras invertido 100 $ al mes en ${n} desde enero de ${y}, habrías aportado ${inv} – hoy valdría ${val} (${r}). Retrospectiva con precios diarios reales, no es una previsión.`,
    h1: (n) => `Plan de ahorro en ${n}: ¿cuánto valdría hoy?`, sub: (d) => `Calculado con precios diarios reales, actualizado el ${d}. Sin comisiones ni impuestos.`,
    lead: (n, y, inv, val, r, w) => `Si hubieras puesto <strong>100 $ en ${n} cada mes desde enero de ${y}</strong>, habrías aportado <strong>${inv}</strong> – hoy valdría <strong>${val}</strong> (${r}).${w ? ` Por el camino el valor estuvo a ratos un ${w} por debajo de lo aportado.` : ''}`,
    planH: '100 $ cada mes', onceH: '1000 $ de una vez', start: 'Inicio', inv: 'Aportado', val: 'Valor hoy', ret: 'Rentabilidad', worst: 'Punto más bajo', never: 'nunca en negativo',
    jan: (y) => `ene. ${y}`, try: 'Calcula con tu propio importe y fecha de inicio', tryBtn: 'Abrir la calculadora', note: 'El pasado no es una previsión. Las criptomonedas pueden caer con fuerza, hasta la pérdida total. No es asesoramiento financiero.',
    others: 'Planes de ahorro en otras monedas', hubTitle: (y) => `Planes de ahorro cripto comparados: 100 $ al mes desde ${y} en 40 monedas`, hubDesc: (y) => `¿Qué plan de ahorro cripto fue mejor desde ${y}? 100 $ al mes en las 40 monedas más grandes, con precios diarios reales. Retrospectiva, no previsión.`,
    hubH1: 'Planes de ahorro cripto comparados', hubSub: (y, d) => `100 $ cada mes desde enero de ${y}, con precios diarios reales – actualizado el ${d}. Retrospectiva, no previsión.`, coin: 'Moneda' },
  fr: { nav: 'Calculateur de plan d’épargne', title: (n, y) => `Calculateur de plan d’épargne ${n} : 100 $ par mois depuis ${y} – résultat aujourd’hui`,
    desc: (n, y, inv, val, r) => `En investissant 100 $ par mois en ${n} depuis janvier ${y}, tu aurais versé ${inv} – cela vaudrait ${val} aujourd’hui (${r}). Rétrospective avec de vrais cours quotidiens, pas une prévision.`,
    h1: (n) => `Plan d’épargne ${n} : combien vaudrait-il aujourd’hui ?`, sub: (d) => `Calculé avec de vrais cours quotidiens, mis à jour le ${d}. Sans frais ni impôts.`,
    lead: (n, y, inv, val, r, w) => `En plaçant <strong>100 $ en ${n} chaque mois depuis janvier ${y}</strong>, tu aurais versé <strong>${inv}</strong> – cela vaudrait aujourd’hui <strong>${val}</strong> (${r}).${w ? ` En chemin, la valeur a été par moments ${w} sous le montant versé.` : ''}`,
    planH: '100 $ chaque mois', onceH: '1000 $ en une fois', start: 'Début', inv: 'Versé', val: 'Valeur aujourd’hui', ret: 'Rendement', worst: 'Point le plus bas', never: 'jamais dans le rouge',
    jan: (y) => `janv. ${y}`, try: 'Calcule avec ton propre montant et ta date de début', tryBtn: 'Ouvrir le calculateur', note: 'Le passé n’est pas une prévision. Les cryptos peuvent chuter fortement, jusqu’à la perte totale. Pas un conseil en investissement.',
    others: 'Plans d’épargne pour d’autres cryptos', hubTitle: (y) => `Plans d’épargne crypto comparés : 100 $ par mois depuis ${y} dans 40 cryptos`, hubDesc: (y) => `Quel plan d’épargne crypto a le mieux marché depuis ${y} ? 100 $ par mois dans les 40 plus grandes cryptos, avec de vrais cours quotidiens. Rétrospective, pas une prévision.`,
    hubH1: 'Plans d’épargne crypto comparés', hubSub: (y, d) => `100 $ chaque mois depuis janvier ${y}, avec de vrais cours quotidiens – mis à jour le ${d}. Rétrospective, pas une prévision.`, coin: 'Crypto' },
  it: { nav: 'Calcolatore di piano di accumulo', title: (n, y) => `Calcolatore PAC ${n}: 100 $ al mese dal ${y} – il risultato oggi`,
    desc: (n, y, inv, val, r) => `Investendo 100 $ al mese in ${n} da gennaio ${y} avresti versato ${inv} – oggi varrebbero ${val} (${r}). Retrospettiva con prezzi giornalieri reali, non una previsione.`,
    h1: (n) => `Piano di accumulo in ${n}: quanto varrebbe oggi?`, sub: (d) => `Calcolato con prezzi giornalieri reali, aggiornato il ${d}. Senza commissioni e tasse.`,
    lead: (n, y, inv, val, r, w) => `Mettendo <strong>100 $ in ${n} ogni mese da gennaio ${y}</strong> avresti versato <strong>${inv}</strong> – oggi varrebbero <strong>${val}</strong> (${r}).${w ? ` Lungo il percorso il valore è stato a tratti ${w} sotto l’importo versato.` : ''}`,
    planH: '100 $ ogni mese', onceH: '1000 $ in un’unica soluzione', start: 'Inizio', inv: 'Versato', val: 'Valore oggi', ret: 'Rendimento', worst: 'Punto più basso', never: 'mai in perdita',
    jan: (y) => `gen. ${y}`, try: 'Calcola con il tuo importo e la tua data di inizio', tryBtn: 'Apri il calcolatore', note: 'Il passato non è una previsione. Le crypto possono crollare, fino alla perdita totale. Non è una consulenza finanziaria.',
    others: 'Piani di accumulo per altri coin', hubTitle: (y) => `Piani di accumulo crypto a confronto: 100 $ al mese dal ${y} in 40 coin`, hubDesc: (y) => `Quale piano di accumulo crypto è andato meglio dal ${y}? 100 $ al mese nei 40 coin più grandi, con prezzi giornalieri reali. Retrospettiva, non una previsione.`,
    hubH1: 'Piani di accumulo crypto a confronto', hubSub: (y, d) => `100 $ ogni mese da gennaio ${y}, con prezzi giornalieri reali – aggiornato il ${d}. Retrospettiva, non una previsione.`, coin: 'Coin' },
  pt: { nav: 'Calculadora de aporte mensal', title: (n, y) => `Calculadora de aporte mensal em ${n}: 100 $ por mês desde ${y} – resultado hoje`,
    desc: (n, y, inv, val, r) => `Se você tivesse investido 100 $ por mês em ${n} desde janeiro de ${y}, teria aportado ${inv} – hoje valeria ${val} (${r}). Retrospectiva com preços diários reais, não é previsão.`,
    h1: (n) => `Aporte mensal em ${n}: quanto valeria hoje?`, sub: (d) => `Calculado com preços diários reais, atualizado em ${d}. Sem taxas e impostos.`,
    lead: (n, y, inv, val, r, w) => `Se você tivesse colocado <strong>100 $ em ${n} todo mês desde janeiro de ${y}</strong>, teria aportado <strong>${inv}</strong> – hoje valeria <strong>${val}</strong> (${r}).${w ? ` No caminho o valor ficou às vezes ${w} abaixo do aportado.` : ''}`,
    planH: '100 $ todo mês', onceH: '1000 $ de uma vez', start: 'Início', inv: 'Aportado', val: 'Valor hoje', ret: 'Retorno', worst: 'Ponto mais baixo', never: 'nunca no negativo',
    jan: (y) => `jan. ${y}`, try: 'Calcule com seu próprio valor e data de início', tryBtn: 'Abrir a calculadora', note: 'O passado não é uma previsão. Criptoativos podem cair muito, até a perda total. Não é recomendação de investimento.',
    others: 'Aportes mensais em outras moedas', hubTitle: (y) => `Aportes mensais em cripto comparados: 100 $ por mês desde ${y} em 40 moedas`, hubDesc: (y) => `Qual aporte mensal em cripto foi melhor desde ${y}? 100 $ por mês nas 40 maiores moedas, com preços diários reais. Retrospectiva, não previsão.`,
    hubH1: 'Aportes mensais em cripto comparados', hubSub: (y, d) => `100 $ todo mês desde janeiro de ${y}, com preços diários reais – atualizado em ${d}. Retrospectiva, não previsão.`, coin: 'Moeda' },
  tr: { nav: 'Birikim planı hesaplayıcı', title: (n, y) => `${n} birikim planı hesaplayıcı: ${y}’ten beri ayda 100 $ – bugünkü sonuç`,
    desc: (n, y, inv, val, r) => `Ocak ${y}’ten beri her ay ${n} coinine 100 $ yatırsaydın ${inv} yatırmış olurdun – bugün değeri ${val} olurdu (${r}). Gerçek günlük fiyatlarla geriye dönük bakış, tahmin değildir.`,
    h1: (n) => `${n} birikim planı: bugün ne kadar ederdi?`, sub: (d) => `Gerçek günlük fiyatlarla hesaplandı, güncelleme: ${d}. Ücretler ve vergiler hariç.`,
    lead: (n, y, inv, val, r, w) => `<strong>Ocak ${y}’ten beri her ay ${n} coinine 100 $</strong> yatırsaydın <strong>${inv}</strong> yatırmış olurdun – bugün değeri <strong>${val}</strong> olurdu (${r}).${w ? ` Yol boyunca değer zaman zaman yatırılan tutarın ${w} altındaydı.` : ''}`,
    planH: 'Her ay 100 $', onceH: 'Tek seferde 1000 $', start: 'Başlangıç', inv: 'Yatırılan', val: 'Bugünkü değer', ret: 'Getiri', worst: 'En düşük nokta', never: 'hiç ekside değil',
    jan: (y) => `Oca ${y}`, try: 'Kendi tutarın ve başlangıç tarihinle hesapla', tryBtn: 'Hesaplayıcıyı aç', note: 'Geçmiş bir tahmin değildir. Kripto varlıklar sert düşebilir – tamamen değer kaybına kadar. Yatırım tavsiyesi değildir.',
    others: 'Diğer coinler için birikim planları', hubTitle: (y) => `Kripto birikim planları karşılaştırması: ${y}’ten beri 40 coinde ayda 100 $`, hubDesc: (y) => `${y}’ten beri hangi kripto birikim planı en iyi sonucu verdi? En büyük 40 coinde ayda 100 $, gerçek günlük fiyatlarla. Geriye dönük bakış, tahmin değil.`,
    hubH1: 'Kripto birikim planları karşılaştırması', hubSub: (y, d) => `Ocak ${y}’ten beri her ay 100 $, gerçek günlük fiyatlarla – güncelleme: ${d}. Geriye dönük bakış, tahmin değil.`, coin: 'Coin' },
};


// ---------- Texte je Sprache ----------
const TX = {
  en: {
    open: 'Open the app', today: 'Crypto market today', fngNav: 'Fear & Greed Index', all: 'All coins', risk: 'Risk notice', legal: 'Legal notice', privacy: 'Privacy',
    foot: (d) => `Not financial advice. Coinweather is an information service. Prices cannot be predicted reliably; probabilities are based on past prices and can be wrong. Crypto assets can fall sharply – up to a total loss. Updated ${d}.`,
    offer: 'Free account: the signal and outlook for 1,000 coins, portfolio check and an open track record – 30 days of all features, no payment details.',
    start: 'Start free', noSignup: 'See today’s market – no signup',
    idx: 'Buy score', fng: 'Fear & Greed', ago7: (v) => `7 days ago ${v}`, cyc: 'Cycle (12 months)', belowAth: 'below Bitcoin’s all-time high', sig: 'Buy signals', ofRated: (n) => `of ${n} rated coins`,
    label: { 'Kaufen': 'Buy', 'Eher kaufen': 'Lean buy', 'Halten': 'Hold', 'Eher verkaufen': 'Lean sell', 'Verkaufen': 'Sell' },
    zone: { deep: 'deep in the cycle', low: 'lower third of the cycle', mid: 'middle of the cycle', high: 'near the high' },
    mood: ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed'],
    odds: (a, b) => `Since 2022, after buy scores like today, Bitcoin was higher one year later in ${a} of 100 cases${isNum(b) ? `, Ethereum in ${b} of 100` : ''}.`,
    tTitle: (d, l, v) => `Crypto market today (${d}): Fear & Greed, buy score and outlook`,
    tDesc: (v, l, f, m, p) => `Is now a good time to buy crypto? Today’s crypto weather: buy score ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Updated daily. Not financial advice.`,
    tH1: (l, v) => `Crypto market today: ${l} (${v}/100)`, tSub: (d) => `Crypto weather report for ${d} – updated every day.`,
    buyQ: 'Is now a good time to buy crypto?',
    tPara: (v, l, f, m, odds, alt) => `Nobody can know that for sure. What the data says today: Coinweather’s buy score stands at <strong>${v} out of 100 – “${l}”</strong>. It is contrarian and looks 12 months ahead: it rises when Bitcoin is cheap relative to its long-term averages, far below its high and the market is fearful. The Fear &amp; Greed index is at <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `For the typical altcoin it was only ${alt} of 100 – that is why the buy score applies above all to Bitcoin and Ethereum.` : ''} These are tendencies from past data, not promises.`,
    btcH: 'Bitcoin today', btcPara: (p, d1, d7, ath) => `Bitcoin trades at <strong>${p}</strong> (${d1} in 24 hours, ${d7} in 7 days) and is ${ath} % below its all-time high.`, btcLink: 'Bitcoin page →',
    movH: 'Top movers of the 100 largest coins (24 hours)', obs: 'Observations, not recommendations.', gain: 'Gainers', lose: 'Losers', price: 'Price', h24: '24 h', d7h: '7 days',
    recH: 'Open track record', recPara: (since, avg, up, n, b, mkt) => `Every buy signal of the site is re-measured. Since ${since}: after 7 days on average <strong>${avg}</strong>, ${up} of ${n} in profit (Bitcoin over the same period ${b}${mkt ? `, the average top-100 coin ${mkt}` : ''}). Since 24 October 2026 buy signals are limited to the 100 largest coins – the size range the model was tested on. Including the bad results – that is the point.`,
    tOffer: 'Which coins have a buy signal today?',
    cTitle: (n, s, d) => `${n} (${s}) price today and outlook – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} is at ${p} (${d1} in 24h, ${d7} in 7 days). Crypto buy score ${v}/100 (${l}), Fear & Greed ${f}. Not financial advice.`,
    cH1: (n, s) => `${n} (${s}) today`, cSub: (d) => `Price, trend and crypto weather for ${d} – updated every day.`, rank: 'Rank',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} trades at <strong>${p}</strong>, ${d1} in the last 24 hours and ${d7} over 7 days. It is number ${r} by market capitalisation (${cap})${ath ? ` and ${ath} % below its all-time high of ${athP}` : ''}.`,
    period: 'Period', change: 'Change', periods: ['24 hours', '7 days', '30 days', '200 days', '1 year'],
    cComp: (n, core, v, l, up, med, zone) => `Coinweather’s Cycle Compass buy score is <strong>${v}/100 (“${l}”)</strong>. ${core ? `For ${n} it counts 80 % of the signal; its own trend counts 20 %. The signal is meant for 12 months and longer.` : zone === 'cheap' ? `The cycle is cheap, so ${n} gets a bonus in its buy score and no sell signal; its own trend counts too.` : zone === 'dear' ? `The cycle is expensive, so ${n} gets at most “Lean buy”, and only for the coming weeks.` : `The cycle is neither cheap nor expensive, so the signal of ${n} follows its trend today.`} ${isNum(up) ? `Since 2022, one year after readings like today, ${core ? n : 'altcoins'} were higher in ${up} % of cases (median ${med} %).` : ''}`,
    cBuyQ: (n) => `Is now a good time to buy ${n}?`,
    cPara2: (v, l, f, m, odds) => `Nobody can know that for sure. What the data says today: the crypto buy score is <strong>${v}/100 (“${l}”)</strong> and the Fear &amp; Greed index is at ${f} (${m}). ${odds}`,
    stable: (n) => `${n} is a stablecoin – it is meant to keep its value, so Coinweather gives it no buy or sell signal.`,
    sample: (n, l, h, r) => `Coinweather’s signal for ${n} today: <strong>${l}</strong>${h ? `, holding period ${h}` : ''}${r ? `, risk ${r}` : ''}.`,
    locked: (n) => `Coinweather rates ${n} every 15 minutes. The current signal, holding period and risk are shown in a free account.`,
    offAll: 'See the signal for all 1,000 coins', offCoin: (n) => `See the signal for ${n}`, mToday: 'Market today', fullRep: 'Full crypto weather report →', similar: 'Similar by market cap',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} trillion` : v >= 1e9 ? `${fmt(v / 1e9, 1)} billion` : `${fmt(v / 1e6, 0)} million`),
    fTitle: (v, m, d) => `Crypto Fear and Greed Index today: ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `The crypto Fear & Greed Index is at ${v} today (${m})${isNum(w) ? `, ${w} a week ago` : ''}. What fear and greed meant for prices since 2018 – updated daily. Not financial advice.`,
    fH1: (v, m) => `Crypto Fear &amp; Greed Index today: ${v} – ${m}`, fSub: (d) => `Updated ${d}. Source: alternative.me.`,
    fToday: 'Today', f7: '7 days ago', f30: '30 days ago', fAvg: '7-day average',
    fWhatH: 'What is the Fear &amp; Greed Index?',
    fWhat: 'The index measures the mood of the crypto market from 0 (extreme fear) to 100 (extreme greed), based on volatility, momentum, trading volume, social media and Bitcoin dominance. Below 25 is extreme fear, 25–45 fear, 45–55 neutral, 55–75 greed and above 75 extreme greed.',
    fHistH: 'What did fear and greed mean for prices since 2018?',
    fHist: 'Coinweather tested the daily index values since 2018 against what prices did afterwards:',
    fLi: ['<strong>Extreme greed was a warning:</strong> when the 7-day average was between 75 and 85, the median coin was higher 30 days later in only 20–33 % of cases (median about −20 %). In that zone Coinweather caps the trend part of altcoins, and the buy score falls too, because Fear & Greed is one of its five inputs.',
      '<strong>Long fear in a deep market was an opportunity – for Bitcoin:</strong> after long periods of fear (at least 54 of 60 days below 45) with Bitcoin at least 40 % below its all-time high, Bitcoin was higher one year later in 84–100 % of cases. For the average altcoin this did not hold.',
      '<strong>On its own the index was no reliable timing signal</strong> – “buy fear, sell greed” as a simple rule did worse than following the market trend.'],
    fNow: (v, m, a) => `Today’s reading: <strong>${v} (${m})</strong>${a ? `, 7-day average ${a}` : ''}.`, brakeOn: 'The greed brake is active.', brakeOff: 'The greed brake is not active.',
    fIdx: (v, l) => `Coinweather’s buy score stands at <strong>${v}/100 (“${l}”)</strong>.`, fOffer: 'See how fear and greed affect each of 1,000 coins',
    lTitle: (d) => `Crypto prices today: the 500 largest coins – ${d}`,
    lDesc: (v, l) => `Prices, 24-hour and 7-day changes of the 500 largest cryptocurrencies, plus today’s crypto weather: buy score ${v}/100 (${l}). Updated daily.`,
    lH1: 'The 500 largest coins today', lSub: (d, v, l) => `Updated ${d}. Buy score today: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Which of these coins have a buy signal today?',
  },
  de: {
    open: 'App öffnen', today: 'Kryptomarkt heute', fngNav: 'Fear & Greed Index', all: 'Alle Coins', risk: 'Risikohinweis', legal: 'Impressum', privacy: 'Datenschutz',
    foot: (d) => `Keine Anlageberatung. Coinweather ist ein Informationsdienst. Kurse lassen sich nicht sicher vorhersagen; die Wahrscheinlichkeiten beruhen auf vergangenen Kursen und können falsch liegen. Kryptowerte können stark fallen – bis zum Totalverlust. Stand ${d}.`,
    offer: 'Kostenloses Konto: Signal und Aussicht für 1000 Coins, Portfolio-Check und eine offene Erfolgskontrolle – 30 Tage alle Funktionen, ohne Zahlungsdaten.',
    start: 'Kostenlos starten', noSignup: 'Markt heute ansehen – ohne Anmeldung',
    idx: 'Kauf-Score', fng: 'Fear & Greed', ago7: (v) => `vor 7 Tagen ${v}`, cyc: 'Zyklus (12 Monate)', belowAth: 'unter dem Allzeithoch von Bitcoin', sig: 'Kaufsignale', ofRated: (n) => `von ${n} bewerteten Coins`,
    label: { 'Kaufen': 'Kaufen', 'Eher kaufen': 'Eher kaufen', 'Halten': 'Halten', 'Eher verkaufen': 'Eher verkaufen', 'Verkaufen': 'Verkaufen' },
    zone: { deep: 'tief im Zyklus', low: 'unteres Drittel des Zyklus', mid: 'Mitte des Zyklus', high: 'nahe am Hoch' },
    mood: ['extreme Angst', 'Angst', 'neutral', 'Gier', 'extreme Gier'],
    odds: (a, b) => `Seit 2022 stand Bitcoin nach Kauf-Scores wie heute ein Jahr später in ${a} von 100 Fällen höher${isNum(b) ? `, Ethereum in ${b} von 100` : ''}.`,
    tTitle: (d) => `Kryptomarkt heute (${d}): Fear & Greed, Kauf-Score und Aussicht`,
    tDesc: (v, l, f, m, p) => `Ist jetzt ein guter Zeitpunkt für Krypto? Das Krypto-Wetter heute: Kauf-Score ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Täglich aktuell. Keine Anlageberatung.`,
    tH1: (l, v) => `Kryptomarkt heute: ${l} (${v}/100)`, tSub: (d) => `Krypto-Wetterbericht vom ${d} – täglich aktualisiert.`,
    buyQ: 'Ist jetzt ein guter Zeitpunkt, Krypto zu kaufen?',
    tPara: (v, l, f, m, odds, alt) => `Sicher wissen kann das niemand. Was die Daten heute sagen: Der Kauf-Score von Coinweather steht bei <strong>${v} von 100 – „${l}“</strong>. Er ist antizyklisch und blickt 12 Monate voraus: Er steigt, wenn Bitcoin im Vergleich zu seinen langen Schnitten günstig ist, weit unter dem Hoch liegt und am Markt Angst herrscht. Der Fear-&amp;-Greed-Index steht bei <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Beim typischen Altcoin waren es nur ${alt} von 100 – deshalb gilt der Kauf-Score vor allem für Bitcoin und Ethereum.` : ''} Das sind Tendenzen aus vergangenen Daten, keine Versprechen.`,
    btcH: 'Bitcoin heute', btcPara: (p, d1, d7, ath) => `Bitcoin steht bei <strong>${p}</strong> (${d1} in 24 Stunden, ${d7} in 7 Tagen) und ${ath} % unter seinem Allzeithoch.`, btcLink: 'Zur Bitcoin-Seite →',
    movH: 'Größte Bewegungen der 100 größten Coins (24 Stunden)', obs: 'Beobachtungen, keine Empfehlungen.', gain: 'Gewinner', lose: 'Verlierer', price: 'Kurs', h24: '24 h', d7h: '7 Tage',
    recH: 'Offene Erfolgskontrolle', recPara: (since, avg, up, n, b, mkt) => `Jedes Kaufsignal der Seite wird nachgemessen. Seit ${since}: nach 7 Tagen im Schnitt <strong>${avg}</strong>, ${up} von ${n} im Plus (Bitcoin im selben Zeitraum ${b}${mkt ? `, der Durchschnitt der Top 100 ${mkt}` : ''}). Seit dem 24. Oktober 2026 gibt es Kaufsignale nur für die 100 größten Coins – an solchen ist das Modell geprüft. Auch schlechte Ergebnisse stehen hier – genau darum geht es.`,
    tOffer: 'Welche Coins haben heute ein Kaufsignal?',
    cTitle: (n, s, d) => `${n} (${s}) Kurs heute und Aussicht – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} steht bei ${p} (${d1} in 24 h, ${d7} in 7 Tagen). Krypto-Kauf-Score ${v}/100 (${l}), Fear & Greed ${f}. Keine Anlageberatung.`,
    cH1: (n, s) => `${n} (${s}) heute`, cSub: (d) => `Kurs, Entwicklung und Krypto-Wetter vom ${d} – täglich aktualisiert.`, rank: 'Rang',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} steht bei <strong>${p}</strong>, ${d1} in den letzten 24 Stunden und ${d7} über 7 Tage. Nach Marktwert ist der Coin die Nummer ${r} (${cap})${ath ? ` und liegt ${ath} % unter seinem Allzeithoch von ${athP}` : ''}.`,
    period: 'Zeitraum', change: 'Veränderung', periods: ['24 Stunden', '7 Tage', '30 Tage', '200 Tage', '1 Jahr'],
    cComp: (n, core, v, l, up, med, zone) => `Der Kauf-Score des Zyklus-Kompasses steht bei <strong>${v}/100 („${l}“)</strong>. ${core ? `Bei ${n} zählt er zu 80 % im Signal, der eigene Trend zu 20 %. Das Signal gilt für 12 Monate und länger.` : zone === 'cheap' ? `Der Zyklus ist günstig – deshalb bekommt ${n} einen Bonus im Kauf-Score und kein Verkaufssignal; dazu zählt sein eigener Trend.` : zone === 'dear' ? `Der Zyklus ist teuer – deshalb höchstens „Eher kaufen“ für ${n}, und nur für die nächsten Wochen.` : `Der Zyklus ist weder billig noch teuer – das Signal von ${n} folgt heute seinem Trend.`} ${isNum(up) ? `Seit 2022 standen ${core ? n : 'Altcoins'} ein Jahr nach solchen Ständen in ${up} % der Fälle höher (Median ${med} %).` : ''}`,
    cBuyQ: (n) => `Ist jetzt ein guter Zeitpunkt, ${n} zu kaufen?`,
    cPara2: (v, l, f, m, odds) => `Sicher wissen kann das niemand. Was die Daten heute sagen: Der Kauf-Score für den Kryptomarkt steht bei <strong>${v}/100 („${l}“)</strong>, der Fear-&amp;-Greed-Index bei ${f} (${m}). ${odds}`,
    stable: (n) => `${n} ist ein Stablecoin – er soll seinen Wert halten, deshalb gibt Coinweather kein Kauf- oder Verkaufssignal.`,
    sample: (n, l, h, r) => `Das Signal von Coinweather für ${n} heute: <strong>${l}</strong>${h ? `, Haltedauer ${h}` : ''}${r ? `, Risiko ${r}` : ''}.`,
    locked: (n) => `Coinweather bewertet ${n} alle 15 Minuten. Das aktuelle Signal, die Haltedauer und das Risiko siehst du mit einem kostenlosen Konto.`,
    offAll: 'Das Signal für alle 1000 Coins ansehen', offCoin: (n) => `Das Signal für ${n} ansehen`, mToday: 'Der Markt heute', fullRep: 'Zum ganzen Krypto-Wetterbericht →', similar: 'Ähnlich nach Marktwert',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} Billionen` : v >= 1e9 ? `${fmt(v / 1e9, 1)} Milliarden` : `${fmt(v / 1e6, 0)} Millionen`),
    fTitle: (v, m, d) => `Fear and Greed Index heute: ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `Der Krypto-Fear-&-Greed-Index steht heute bei ${v} (${m})${isNum(w) ? `, vor einer Woche bei ${w}` : ''}. Was Angst und Gier seit 2018 für die Kurse bedeuteten – täglich aktuell. Keine Anlageberatung.`,
    fH1: (v, m) => `Krypto Fear &amp; Greed Index heute: ${v} – ${m}`, fSub: (d) => `Stand ${d}. Quelle: alternative.me.`,
    fToday: 'Heute', f7: 'Vor 7 Tagen', f30: 'Vor 30 Tagen', fAvg: '7-Tage-Schnitt',
    fWhatH: 'Was ist der Fear &amp; Greed Index?',
    fWhat: 'Der Index misst die Stimmung am Kryptomarkt von 0 (extreme Angst) bis 100 (extreme Gier) – aus Schwankung, Momentum, Handelsvolumen, sozialen Medien und Bitcoin-Dominanz. Unter 25 gilt als extreme Angst, 25–45 Angst, 45–55 neutral, 55–75 Gier und über 75 extreme Gier.',
    fHistH: 'Was bedeuteten Angst und Gier seit 2018 für die Kurse?',
    fHist: 'Coinweather hat die Tageswerte seit 2018 mit dem verglichen, was die Kurse danach taten:',
    fLi: ['<strong>Extreme Gier war eine Warnung:</strong> Lag der 7-Tage-Schnitt zwischen 75 und 85, stand der mittlere Coin 30 Tage später nur in 20–33 % der Fälle höher (im Mittel etwa −20 %). In dieser Zone deckelt Coinweather den Trend-Teil der Altcoins, und auch der Kauf-Score sinkt, weil Fear & Greed einer seiner fünf Bausteine ist.',
      '<strong>Lange Angst in einem tiefen Markt war eine Gelegenheit – für Bitcoin:</strong> Nach langer Angst (mindestens 54 von 60 Tagen unter 45) und mit Bitcoin mindestens 40 % unter dem Allzeithoch stand Bitcoin ein Jahr später in 84–100 % der Fälle höher. Für den mittleren Altcoin galt das nicht.',
      '<strong>Allein war der Index kein verlässliches Signal</strong> – „bei Angst kaufen, bei Gier verkaufen“ als einfache Regel schnitt schlechter ab, als dem Markttrend zu folgen.'],
    fNow: (v, m, a) => `Heute: <strong>${v} (${m})</strong>${a ? `, 7-Tage-Schnitt ${a}` : ''}.`, brakeOn: 'Die Gier-Bremse ist aktiv.', brakeOff: 'Die Gier-Bremse ist nicht aktiv.',
    fIdx: (v, l) => `Der Kauf-Score von Coinweather steht bei <strong>${v}/100 („${l}“)</strong>.`, fOffer: 'Sieh, wie Angst und Gier auf jeden der 1000 Coins wirken',
    lTitle: (d) => `Kryptokurse heute: die 500 größten Coins – ${d}`,
    lDesc: (v, l) => `Kurse und Veränderungen über 24 Stunden und 7 Tage der 500 größten Kryptowährungen, dazu das Krypto-Wetter: Kauf-Score ${v}/100 (${l}). Täglich aktuell.`,
    lH1: 'Die 500 größten Coins heute', lSub: (d, v, l) => `Stand ${d}. Kauf-Score heute: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Welche dieser Coins haben heute ein Kaufsignal?',
  },
  es: {
    open: 'Abrir la app', today: 'Mercado cripto hoy', fngNav: 'Índice Fear & Greed', all: 'Todas las monedas', risk: 'Aviso de riesgo', legal: 'Aviso legal', privacy: 'Privacidad',
    foot: (d) => `No es asesoramiento financiero. Coinweather es un servicio informativo. Los precios no se pueden predecir con seguridad; las probabilidades se basan en precios pasados y pueden fallar. Las criptomonedas pueden caer con fuerza, hasta la pérdida total. Actualizado el ${d}.`,
    offer: 'Cuenta gratuita: señal y perspectiva de 1000 monedas, revisión de cartera y un historial abierto, 30 días con todas las funciones, sin datos de pago.',
    start: 'Empezar gratis', noSignup: 'Ver el mercado de hoy, sin registro',
    idx: 'Puntuación de compra', fng: 'Fear & Greed', ago7: (v) => `hace 7 días ${v}`, cyc: 'Ciclo (12 meses)', belowAth: 'por debajo del máximo histórico de Bitcoin', sig: 'Señales de compra', ofRated: (n) => `de ${n} monedas evaluadas`,
    label: { 'Kaufen': 'Comprar', 'Eher kaufen': 'Más bien comprar', 'Halten': 'Mantener', 'Eher verkaufen': 'Más bien vender', 'Verkaufen': 'Vender' },
    zone: { deep: 'en lo profundo del ciclo', low: 'tercio inferior del ciclo', mid: 'mitad del ciclo', high: 'cerca del máximo' },
    mood: ['miedo extremo', 'miedo', 'neutral', 'codicia', 'codicia extrema'],
    odds: (a, b) => `Desde 2022, tras puntuaciones de compra como la de hoy, Bitcoin estaba más alto un año después en ${a} de 100 casos${isNum(b) ? ` y Ethereum en ${b} de 100` : ''}.`,
    tTitle: (d) => `Mercado cripto hoy (${d}): Fear & Greed, puntuación de compra y perspectiva`,
    tDesc: (v, l, f, m, p) => `¿Es buen momento para comprar cripto? El tiempo cripto de hoy: puntuación de compra ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Actualizado a diario. No es asesoramiento financiero.`,
    tH1: (l, v) => `Mercado cripto hoy: ${l} (${v}/100)`, tSub: (d) => `Parte del tiempo cripto del ${d}, actualizado cada día.`,
    buyQ: '¿Es buen momento para comprar cripto?',
    tPara: (v, l, f, m, odds, alt) => `Nadie puede saberlo con certeza. Lo que dicen hoy los datos: la puntuación de compra de Coinweather está en <strong>${v} de 100, «${l}»</strong>. Es anticíclica y mira 12 meses adelante: sube cuando Bitcoin está barato frente a sus medias largas, muy por debajo de su máximo y el mercado tiene miedo. El índice Fear &amp; Greed está en <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Para la altcoin típica fueron solo ${alt} de 100; por eso la puntuación de compra vale sobre todo para Bitcoin y Ethereum.` : ''} Son tendencias de datos pasados, no promesas.`,
    btcH: 'Bitcoin hoy', btcPara: (p, d1, d7, ath) => `Bitcoin cotiza a <strong>${p}</strong> (${d1} en 24 horas, ${d7} en 7 días) y está un ${ath} % por debajo de su máximo histórico.`, btcLink: 'Página de Bitcoin →',
    movH: 'Mayores movimientos de las 100 monedas más grandes (24 horas)', obs: 'Observaciones, no recomendaciones.', gain: 'Ganadoras', lose: 'Perdedoras', price: 'Precio', h24: '24 h', d7h: '7 días',
    recH: 'Historial abierto', recPara: (since, avg, up, n, b, mkt) => `Cada señal de compra del sitio se vuelve a medir. Desde el ${since}: tras 7 días de media <strong>${avg}</strong>, ${up} de ${n} en positivo (Bitcoin en el mismo periodo ${b}${mkt ? `, la media del top 100 ${mkt}` : ''}). Desde el 24 de octubre de 2026 solo hay señales de compra para las 100 monedas más grandes, con las que se probó el modelo. También con los malos resultados: de eso se trata.`,
    tOffer: '¿Qué monedas tienen hoy una señal de compra?',
    cTitle: (n, s, d) => `${n} (${s}) precio hoy y perspectiva – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} está en ${p} (${d1} en 24 h, ${d7} en 7 días). Puntuación de compra cripto ${v}/100 (${l}), Fear & Greed ${f}. No es asesoramiento financiero.`,
    cH1: (n, s) => `${n} (${s}) hoy`, cSub: (d) => `Precio, tendencia y tiempo cripto del ${d}, actualizado cada día.`, rank: 'Puesto',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} cotiza a <strong>${p}</strong>, ${d1} en las últimas 24 horas y ${d7} en 7 días. Es la número ${r} por capitalización (${cap})${ath ? ` y está un ${ath} % por debajo de su máximo histórico de ${athP}` : ''}.`,
    period: 'Periodo', change: 'Variación', periods: ['24 horas', '7 días', '30 días', '200 días', '1 año'],
    cComp: (n, core, v, l, up, med, zone) => `La puntuación de compra de la Brújula del ciclo de Coinweather está en <strong>${v}/100 («${l}»)</strong>. ${core ? `En ${n} cuenta un 80 % de la señal; su propia tendencia, un 20 %. La señal es para 12 meses o más.` : zone === 'cheap' ? `El ciclo está barato, así que ${n} recibe una bonificación en su puntuación de compra y ninguna señal de venta; también cuenta su tendencia.` : zone === 'dear' ? `El ciclo está caro, así que ${n} recibe como mucho «Más bien comprar», y solo para las próximas semanas.` : `El ciclo no está ni barato ni caro, así que la señal de ${n} sigue hoy su tendencia.`} ${isNum(up) ? `Desde 2022, un año después de niveles como hoy, ${core ? n : 'las altcoins'} estaban más altas en el ${up} % de los casos (mediana ${med} %).` : ''}`,
    cBuyQ: (n) => `¿Es buen momento para comprar ${n}?`,
    cPara2: (v, l, f, m, odds) => `Nadie puede saberlo con certeza. Lo que dicen hoy los datos: la puntuación de compra cripto está en <strong>${v}/100 («${l}»)</strong> y el índice Fear &amp; Greed en ${f} (${m}). ${odds}`,
    stable: (n) => `${n} es una stablecoin: debe mantener su valor, por eso Coinweather no le da señal de compra ni de venta.`,
    sample: (n, l, h, r) => `La señal de Coinweather para ${n} hoy: <strong>${l}</strong>${h ? `, plazo ${h}` : ''}${r ? `, riesgo ${r}` : ''}.`,
    locked: (n) => `Coinweather evalúa ${n} cada 15 minutos. La señal actual, el plazo y el riesgo se ven con una cuenta gratuita.`,
    offAll: 'Ver la señal de las 1000 monedas', offCoin: (n) => `Ver la señal de ${n}`, mToday: 'El mercado hoy', fullRep: 'Parte completo del tiempo cripto →', similar: 'Similares por capitalización',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} billones` : v >= 1e9 ? `${fmt(v / 1e9, 1)} mil millones` : `${fmt(v / 1e6, 0)} millones`),
    fTitle: (v, m, d) => `Índice Fear and Greed cripto hoy: ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `El índice cripto Fear & Greed está hoy en ${v} (${m})${isNum(w) ? `, hace una semana en ${w}` : ''}. Qué significaron el miedo y la codicia para los precios desde 2018, actualizado a diario. No es asesoramiento financiero.`,
    fH1: (v, m) => `Índice cripto Fear &amp; Greed hoy: ${v} – ${m}`, fSub: (d) => `Actualizado el ${d}. Fuente: alternative.me.`,
    fToday: 'Hoy', f7: 'Hace 7 días', f30: 'Hace 30 días', fAvg: 'Media de 7 días',
    fWhatH: '¿Qué es el índice Fear &amp; Greed?',
    fWhat: 'El índice mide el ánimo del mercado cripto de 0 (miedo extremo) a 100 (codicia extrema), a partir de volatilidad, impulso, volumen, redes sociales y dominancia de Bitcoin. Por debajo de 25 es miedo extremo, 25–45 miedo, 45–55 neutral, 55–75 codicia y por encima de 75 codicia extrema.',
    fHistH: '¿Qué significaron el miedo y la codicia para los precios desde 2018?',
    fHist: 'Coinweather comparó los valores diarios desde 2018 con lo que hicieron después los precios:',
    fLi: ['<strong>La codicia extrema fue una advertencia:</strong> con una media de 7 días entre 75 y 85, la moneda media estaba más alta 30 días después solo en el 20–33 % de los casos (mediana de cerca de −20 %). En esa zona Coinweather limita la parte de tendencia de las altcoins, y la puntuación de compra también baja, porque Fear & Greed es uno de sus cinco componentes.',
      '<strong>El miedo largo en un mercado hundido fue una oportunidad, para Bitcoin:</strong> tras largos periodos de miedo (al menos 54 de 60 días por debajo de 45) con Bitcoin al menos un 40 % bajo su máximo, Bitcoin estaba más alto un año después en el 84–100 % de los casos. Para la altcoin media no fue así.',
      '<strong>Por sí solo, el índice no fue una señal fiable</strong>: «comprar con miedo, vender con codicia» como regla simple funcionó peor que seguir la tendencia del mercado.'],
    fNow: (v, m, a) => `Hoy: <strong>${v} (${m})</strong>${a ? `, media de 7 días ${a}` : ''}.`, brakeOn: 'El freno de codicia está activo.', brakeOff: 'El freno de codicia no está activo.',
    fIdx: (v, l) => `La puntuación de compra de Coinweather está en <strong>${v}/100 («${l}»)</strong>.`, fOffer: 'Mira cómo afectan el miedo y la codicia a cada una de las 1000 monedas',
    lTitle: (d) => `Precios cripto hoy: las 500 monedas más grandes – ${d}`,
    lDesc: (v, l) => `Precios y variaciones de 24 horas y 7 días de las 500 criptomonedas más grandes, más el tiempo cripto de hoy: puntuación de compra ${v}/100 (${l}). Actualizado a diario.`,
    lH1: 'Las 500 monedas más grandes hoy', lSub: (d, v, l) => `Actualizado el ${d}. Puntuación de compra hoy: ${v}/100 – ${l}.`, coin: 'Moneda', lOffer: '¿Cuáles de estas monedas tienen hoy una señal de compra?',
  },
  fr: {
    open: 'Ouvrir l’app', today: 'Marché crypto aujourd’hui', fngNav: 'Indice Fear & Greed', all: 'Toutes les cryptos', risk: 'Avertissement sur les risques', legal: 'Mentions légales', privacy: 'Confidentialité',
    foot: (d) => `Pas un conseil en investissement. Coinweather est un service d’information. Les cours ne peuvent pas être prédits de façon sûre ; les probabilités reposent sur des cours passés et peuvent se tromper. Les cryptos peuvent chuter fortement, jusqu’à la perte totale. Mis à jour le ${d}.`,
    offer: 'Compte gratuit : signal et perspectives pour 1000 cryptos, bilan de portefeuille et suivi public – 30 jours avec toutes les fonctions, sans données de paiement.',
    start: 'Commencer gratuitement', noSignup: 'Voir le marché du jour – sans inscription',
    idx: 'Score d’achat', fng: 'Fear & Greed', ago7: (v) => `il y a 7 jours ${v}`, cyc: 'Cycle (12 mois)', belowAth: 'sous le record de Bitcoin', sig: 'Signaux d’achat', ofRated: (n) => `sur ${n} cryptos évaluées`,
    label: { 'Kaufen': 'Acheter', 'Eher kaufen': 'Plutôt acheter', 'Halten': 'Conserver', 'Eher verkaufen': 'Plutôt vendre', 'Verkaufen': 'Vendre' },
    zone: { deep: 'au creux du cycle', low: 'tiers inférieur du cycle', mid: 'milieu du cycle', high: 'près du sommet' },
    mood: ['peur extrême', 'peur', 'neutre', 'avidité', 'avidité extrême'],
    odds: (a, b) => `Depuis 2022, après des scores d’achat comme aujourd’hui, le Bitcoin était plus haut un an plus tard dans ${a} cas sur 100${isNum(b) ? ` et Ethereum dans ${b} sur 100` : ''}.`,
    tTitle: (d) => `Marché crypto aujourd’hui (${d}) : Fear & Greed, score d’achat et perspectives`,
    tDesc: (v, l, f, m, p) => `Est-ce le bon moment pour acheter des cryptos ? La météo crypto du jour : score d’achat ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Mis à jour chaque jour. Pas un conseil en investissement.`,
    tH1: (l, v) => `Marché crypto aujourd’hui : ${l} (${v}/100)`, tSub: (d) => `Bulletin météo crypto du ${d} – mis à jour chaque jour.`,
    buyQ: 'Est-ce le bon moment pour acheter des cryptos ?',
    tPara: (v, l, f, m, odds, alt) => `Personne ne peut le savoir avec certitude. Ce que disent les données aujourd’hui : le score d’achat de Coinweather est à <strong>${v} sur 100 – « ${l} »</strong>. Il est anticyclique et regarde 12 mois en avant : il monte quand le Bitcoin est bon marché par rapport à ses moyennes longues, loin sous son record, et que le marché a peur. L’indice Fear &amp; Greed est à <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Pour l’altcoin typique, ce n’était que ${alt} sur 100 – c’est pourquoi le score d’achat vaut surtout pour Bitcoin et Ethereum.` : ''} Ce sont des tendances issues de données passées, pas des promesses.`,
    btcH: 'Bitcoin aujourd’hui', btcPara: (p, d1, d7, ath) => `Le Bitcoin s’échange à <strong>${p}</strong> (${d1} sur 24 heures, ${d7} sur 7 jours) et se situe ${ath} % sous son record.`, btcLink: 'Page Bitcoin →',
    movH: 'Plus forts mouvements des 100 plus grandes cryptos (24 heures)', obs: 'Des observations, pas des recommandations.', gain: 'Hausses', lose: 'Baisses', price: 'Cours', h24: '24 h', d7h: '7 jours',
    recH: 'Suivi public', recPara: (since, avg, up, n, b, mkt) => `Chaque signal d’achat du site est re-mesuré. Depuis le ${since} : après 7 jours en moyenne <strong>${avg}</strong>, ${up} sur ${n} en hausse (Bitcoin sur la même période ${b}${mkt ? `, la moyenne du top 100 ${mkt}` : ''}). Depuis le 24 octobre 2026, les signaux d’achat ne concernent que les 100 plus grandes cryptos, celles sur lesquelles le modèle a été testé. Les mauvais résultats y figurent aussi – c’est tout l’intérêt.`,
    tOffer: 'Quelles cryptos ont un signal d’achat aujourd’hui ?',
    cTitle: (n, s, d) => `${n} (${s}) cours aujourd’hui et perspectives – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} est à ${p} (${d1} sur 24 h, ${d7} sur 7 jours). Score d’achat crypto ${v}/100 (${l}), Fear & Greed ${f}. Pas un conseil en investissement.`,
    cH1: (n, s) => `${n} (${s}) aujourd’hui`, cSub: (d) => `Cours, tendance et météo crypto du ${d} – mis à jour chaque jour.`, rank: 'Rang',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} s’échange à <strong>${p}</strong>, ${d1} sur les dernières 24 heures et ${d7} sur 7 jours. C’est la numéro ${r} par capitalisation (${cap})${ath ? ` et elle se situe ${ath} % sous son record de ${athP}` : ''}.`,
    period: 'Période', change: 'Variation', periods: ['24 heures', '7 jours', '30 jours', '200 jours', '1 an'],
    cComp: (n, core, v, l, up, med, zone) => `Le score d’achat de la Boussole du cycle de Coinweather est à <strong>${v}/100 (« ${l} »)</strong>. ${core ? `Pour ${n}, il compte pour 80 % du signal ; sa propre tendance pour 20 %. Le signal vaut pour 12 mois et plus.` : zone === 'cheap' ? `Le cycle est bon marché : ${n} reçoit donc un bonus dans son score d’achat et aucun signal de vente ; sa tendance compte aussi.` : zone === 'dear' ? `Le cycle est cher : ${n} reçoit donc au plus « Plutôt acheter », et seulement pour les prochaines semaines.` : `Le cycle n’est ni bon marché ni cher : le signal de ${n} suit aujourd’hui sa tendance.`} ${isNum(up) ? `Depuis 2022, un an après des niveaux comme aujourd’hui, ${core ? n : 'les altcoins'} étaient plus haut dans ${up} % des cas (médiane ${med} %).` : ''}`,
    cBuyQ: (n) => `Est-ce le bon moment pour acheter ${n} ?`,
    cPara2: (v, l, f, m, odds) => `Personne ne peut le savoir avec certitude. Ce que disent les données aujourd’hui : le score d’achat crypto est à <strong>${v}/100 (« ${l} »)</strong> et l’indice Fear &amp; Greed à ${f} (${m}). ${odds}`,
    stable: (n) => `${n} est un stablecoin : il doit garder sa valeur, Coinweather ne lui donne donc ni signal d’achat ni signal de vente.`,
    sample: (n, l, h, r) => `Le signal de Coinweather pour ${n} aujourd’hui : <strong>${l}</strong>${h ? `, durée ${h}` : ''}${r ? `, risque ${r}` : ''}.`,
    locked: (n) => `Coinweather évalue ${n} toutes les 15 minutes. Le signal actuel, la durée et le risque sont visibles avec un compte gratuit.`,
    offAll: 'Voir le signal des 1000 cryptos', offCoin: (n) => `Voir le signal de ${n}`, mToday: 'Le marché aujourd’hui', fullRep: 'Bulletin météo crypto complet →', similar: 'Proches par capitalisation',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} billions` : v >= 1e9 ? `${fmt(v / 1e9, 1)} milliards` : `${fmt(v / 1e6, 0)} millions`),
    fTitle: (v, m, d) => `Indice crypto Fear and Greed aujourd’hui : ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `L’indice crypto Fear & Greed est aujourd’hui à ${v} (${m})${isNum(w) ? `, il y a une semaine à ${w}` : ''}. Ce que la peur et l’avidité ont signifié pour les cours depuis 2018 – mis à jour chaque jour. Pas un conseil en investissement.`,
    fH1: (v, m) => `Indice crypto Fear &amp; Greed aujourd’hui : ${v} – ${m}`, fSub: (d) => `Mis à jour le ${d}. Source : alternative.me.`,
    fToday: 'Aujourd’hui', f7: 'Il y a 7 jours', f30: 'Il y a 30 jours', fAvg: 'Moyenne sur 7 jours',
    fWhatH: 'Qu’est-ce que l’indice Fear &amp; Greed ?',
    fWhat: 'L’indice mesure l’humeur du marché crypto de 0 (peur extrême) à 100 (avidité extrême), à partir de la volatilité, du momentum, du volume, des réseaux sociaux et de la dominance du Bitcoin. Sous 25 : peur extrême, 25–45 peur, 45–55 neutre, 55–75 avidité, au-dessus de 75 avidité extrême.',
    fHistH: 'Qu’ont signifié la peur et l’avidité pour les cours depuis 2018 ?',
    fHist: 'Coinweather a comparé les valeurs quotidiennes depuis 2018 avec l’évolution des cours ensuite :',
    fLi: ['<strong>L’avidité extrême était un avertissement :</strong> avec une moyenne sur 7 jours entre 75 et 85, la crypto médiane n’était plus haute 30 jours plus tard que dans 20–33 % des cas (médiane d’environ −20 %). Dans cette zone, Coinweather plafonne la part tendance des altcoins, et le score d’achat baisse aussi, car le Fear & Greed est l’une de ses cinq composantes.',
      '<strong>Une longue peur dans un marché au plus bas était une opportunité – pour le Bitcoin :</strong> après de longues périodes de peur (au moins 54 jours sur 60 sous 45) avec le Bitcoin au moins 40 % sous son record, le Bitcoin était plus haut un an plus tard dans 84–100 % des cas. Pas pour l’altcoin moyen.',
      '<strong>Seul, l’indice n’était pas un signal fiable</strong> – « acheter la peur, vendre l’avidité » comme règle simple a fait moins bien que suivre la tendance du marché.'],
    fNow: (v, m, a) => `Aujourd’hui : <strong>${v} (${m})</strong>${a ? `, moyenne sur 7 jours ${a}` : ''}.`, brakeOn: 'Le frein d’avidité est actif.', brakeOff: 'Le frein d’avidité n’est pas actif.',
    fIdx: (v, l) => `Le score d’achat de Coinweather est à <strong>${v}/100 (« ${l} »)</strong>.`, fOffer: 'Voir comment la peur et l’avidité agissent sur chacune des 1000 cryptos',
    lTitle: (d) => `Cours crypto aujourd’hui : les 500 plus grandes cryptos – ${d}`,
    lDesc: (v, l) => `Cours et variations sur 24 heures et 7 jours des 500 plus grandes cryptomonnaies, plus la météo crypto du jour : score d’achat ${v}/100 (${l}). Mis à jour chaque jour.`,
    lH1: 'Les 500 plus grandes cryptos aujourd’hui', lSub: (d, v, l) => `Mis à jour le ${d}. Score d’achat du jour : ${v}/100 – ${l}.`, coin: 'Crypto', lOffer: 'Lesquelles de ces cryptos ont un signal d’achat aujourd’hui ?',
  },
  it: {
    open: 'Apri l’app', today: 'Mercato crypto oggi', fngNav: 'Indice Fear & Greed', all: 'Tutti i coin', risk: 'Avvertenza sui rischi', legal: 'Note legali', privacy: 'Privacy',
    foot: (d) => `Non è una consulenza finanziaria. Coinweather è un servizio informativo. I prezzi non si possono prevedere con certezza; le probabilità si basano su prezzi passati e possono sbagliare. Le crypto possono crollare, fino alla perdita totale. Aggiornato il ${d}.`,
    offer: 'Account gratuito: segnale e prospettive per 1000 coin, controllo del portafoglio e track record pubblico – 30 giorni con tutte le funzioni, senza dati di pagamento.',
    start: 'Inizia gratis', noSignup: 'Vedi il mercato di oggi – senza registrazione',
    idx: 'Punteggio di acquisto', fng: 'Fear & Greed', ago7: (v) => `7 giorni fa ${v}`, cyc: 'Ciclo (12 mesi)', belowAth: 'sotto il massimo storico di Bitcoin', sig: 'Segnali di acquisto', ofRated: (n) => `su ${n} coin valutati`,
    label: { 'Kaufen': 'Comprare', 'Eher kaufen': 'Piuttosto comprare', 'Halten': 'Mantenere', 'Eher verkaufen': 'Piuttosto vendere', 'Verkaufen': 'Vendere' },
    zone: { deep: 'in fondo al ciclo', low: 'terzo inferiore del ciclo', mid: 'metà del ciclo', high: 'vicino al massimo' },
    mood: ['paura estrema', 'paura', 'neutrale', 'avidità', 'avidità estrema'],
    odds: (a, b) => `Dal 2022, dopo punteggi di acquisto come oggi, Bitcoin era più alto un anno dopo in ${a} casi su 100${isNum(b) ? ` ed Ethereum in ${b} su 100` : ''}.`,
    tTitle: (d) => `Mercato crypto oggi (${d}): Fear & Greed, punteggio di acquisto e prospettive`,
    tDesc: (v, l, f, m, p) => `È un buon momento per comprare crypto? Il meteo crypto di oggi: punteggio di acquisto ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Aggiornato ogni giorno. Non è una consulenza finanziaria.`,
    tH1: (l, v) => `Mercato crypto oggi: ${l} (${v}/100)`, tSub: (d) => `Bollettino meteo crypto del ${d} – aggiornato ogni giorno.`,
    buyQ: 'È un buon momento per comprare crypto?',
    tPara: (v, l, f, m, odds, alt) => `Nessuno può saperlo con certezza. Cosa dicono oggi i dati: il punteggio di acquisto di Coinweather è a <strong>${v} su 100 – «${l}»</strong>. È anticiclico e guarda 12 mesi avanti: sale quando Bitcoin è conveniente rispetto alle sue medie lunghe, molto sotto il massimo e il mercato ha paura. L’indice Fear &amp; Greed è a <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Per l’altcoin tipico erano solo ${alt} su 100 – per questo il punteggio di acquisto vale soprattutto per Bitcoin ed Ethereum.` : ''} Sono tendenze dai dati passati, non promesse.`,
    btcH: 'Bitcoin oggi', btcPara: (p, d1, d7, ath) => `Bitcoin quota <strong>${p}</strong> (${d1} in 24 ore, ${d7} in 7 giorni) ed è del ${ath} % sotto il suo massimo storico.`, btcLink: 'Pagina di Bitcoin →',
    movH: 'Maggiori movimenti dei 100 coin più grandi (24 ore)', obs: 'Osservazioni, non raccomandazioni.', gain: 'In rialzo', lose: 'In ribasso', price: 'Prezzo', h24: '24 h', d7h: '7 giorni',
    recH: 'Track record pubblico', recPara: (since, avg, up, n, b, mkt) => `Ogni segnale di acquisto del sito viene rimisurato. Dal ${since}: dopo 7 giorni in media <strong>${avg}</strong>, ${up} su ${n} in positivo (Bitcoin nello stesso periodo ${b}${mkt ? `, la media della top 100 ${mkt}` : ''}). Dal 24 ottobre 2026 i segnali di acquisto valgono solo per i 100 coin più grandi, quelli su cui il modello è stato testato. Anche i risultati negativi restano qui: è proprio questo il punto.`,
    tOffer: 'Quali coin hanno oggi un segnale di acquisto?',
    cTitle: (n, s, d) => `${n} (${s}) prezzo oggi e prospettive – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} è a ${p} (${d1} in 24 h, ${d7} in 7 giorni). Punteggio di acquisto crypto ${v}/100 (${l}), Fear & Greed ${f}. Non è una consulenza finanziaria.`,
    cH1: (n, s) => `${n} (${s}) oggi`, cSub: (d) => `Prezzo, andamento e meteo crypto del ${d} – aggiornato ogni giorno.`, rank: 'Posizione',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} quota <strong>${p}</strong>, ${d1} nelle ultime 24 ore e ${d7} in 7 giorni. È il numero ${r} per capitalizzazione (${cap})${ath ? ` ed è del ${ath} % sotto il suo massimo storico di ${athP}` : ''}.`,
    period: 'Periodo', change: 'Variazione', periods: ['24 ore', '7 giorni', '30 giorni', '200 giorni', '1 anno'],
    cComp: (n, core, v, l, up, med, zone) => `Il punteggio di acquisto della Bussola del ciclo di Coinweather è a <strong>${v}/100 («${l}»)</strong>. ${core ? `Per ${n} conta per l’80 % del segnale, il suo trend per il 20 %. Il segnale vale per 12 mesi e oltre.` : zone === 'cheap' ? `Il ciclo è conveniente, quindi ${n} riceve un bonus nel punteggio di acquisto e nessun segnale di vendita; conta anche il suo trend.` : zone === 'dear' ? `Il ciclo è caro, quindi ${n} riceve al massimo «Piuttosto comprare», e solo per le prossime settimane.` : `Il ciclo non è né conveniente né caro, quindi oggi il segnale di ${n} segue il suo trend.`} ${isNum(up) ? `Dal 2022, un anno dopo livelli come oggi, ${core ? n : 'gli altcoin'} erano più alti nel ${up} % dei casi (mediana ${med} %).` : ''}`,
    cBuyQ: (n) => `È un buon momento per comprare ${n}?`,
    cPara2: (v, l, f, m, odds) => `Nessuno può saperlo con certezza. Cosa dicono oggi i dati: il punteggio di acquisto crypto è a <strong>${v}/100 («${l}»)</strong> e l’indice Fear &amp; Greed a ${f} (${m}). ${odds}`,
    stable: (n) => `${n} è una stablecoin: deve mantenere il suo valore, quindi Coinweather non le dà segnali di acquisto o vendita.`,
    sample: (n, l, h, r) => `Il segnale di Coinweather per ${n} oggi: <strong>${l}</strong>${h ? `, durata ${h}` : ''}${r ? `, rischio ${r}` : ''}.`,
    locked: (n) => `Coinweather valuta ${n} ogni 15 minuti. Il segnale attuale, la durata e il rischio si vedono con un account gratuito.`,
    offAll: 'Vedi il segnale di tutti i 1000 coin', offCoin: (n) => `Vedi il segnale di ${n}`, mToday: 'Il mercato oggi', fullRep: 'Bollettino meteo crypto completo →', similar: 'Simili per capitalizzazione',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} mila miliardi` : v >= 1e9 ? `${fmt(v / 1e9, 1)} miliardi` : `${fmt(v / 1e6, 0)} milioni`),
    fTitle: (v, m, d) => `Indice crypto Fear and Greed oggi: ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `L’indice crypto Fear & Greed è oggi a ${v} (${m})${isNum(w) ? `, una settimana fa a ${w}` : ''}. Cosa hanno significato paura e avidità per i prezzi dal 2018 – aggiornato ogni giorno. Non è una consulenza finanziaria.`,
    fH1: (v, m) => `Indice crypto Fear &amp; Greed oggi: ${v} – ${m}`, fSub: (d) => `Aggiornato il ${d}. Fonte: alternative.me.`,
    fToday: 'Oggi', f7: '7 giorni fa', f30: '30 giorni fa', fAvg: 'Media a 7 giorni',
    fWhatH: 'Che cos’è l’indice Fear &amp; Greed?',
    fWhat: 'L’indice misura l’umore del mercato crypto da 0 (paura estrema) a 100 (avidità estrema), in base a volatilità, momentum, volumi, social media e dominanza di Bitcoin. Sotto 25 è paura estrema, 25–45 paura, 45–55 neutrale, 55–75 avidità e sopra 75 avidità estrema.',
    fHistH: 'Cosa hanno significato paura e avidità per i prezzi dal 2018?',
    fHist: 'Coinweather ha confrontato i valori giornalieri dal 2018 con l’andamento successivo dei prezzi:',
    fLi: ['<strong>L’avidità estrema era un segnale d’allarme:</strong> con una media a 7 giorni tra 75 e 85, il coin mediano era più alto 30 giorni dopo solo nel 20–33 % dei casi (mediana di circa −20 %). In quella zona Coinweather limita la parte di trend degli altcoin, e anche il punteggio di acquisto scende, perché il Fear & Greed è una delle sue cinque componenti.',
      '<strong>Una lunga paura in un mercato molto basso era un’occasione – per Bitcoin:</strong> dopo lunghi periodi di paura (almeno 54 giorni su 60 sotto 45) con Bitcoin almeno il 40 % sotto il massimo, Bitcoin era più alto un anno dopo nell’84–100 % dei casi. Per l’altcoin medio non è stato così.',
      '<strong>Da solo l’indice non era un segnale affidabile</strong>: «comprare con la paura, vendere con l’avidità» come regola semplice ha reso meno che seguire il trend del mercato.'],
    fNow: (v, m, a) => `Oggi: <strong>${v} (${m})</strong>${a ? `, media a 7 giorni ${a}` : ''}.`, brakeOn: 'Il freno all’avidità è attivo.', brakeOff: 'Il freno all’avidità non è attivo.',
    fIdx: (v, l) => `Il punteggio di acquisto di Coinweather è a <strong>${v}/100 («${l}»)</strong>.`, fOffer: 'Guarda come paura e avidità agiscono su ciascuno dei 1000 coin',
    lTitle: (d) => `Prezzi crypto oggi: i 500 coin più grandi – ${d}`,
    lDesc: (v, l) => `Prezzi e variazioni a 24 ore e 7 giorni delle 500 criptovalute più grandi, più il meteo crypto di oggi: punteggio di acquisto ${v}/100 (${l}). Aggiornato ogni giorno.`,
    lH1: 'I 500 coin più grandi oggi', lSub: (d, v, l) => `Aggiornato il ${d}. Punteggio di acquisto oggi: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Quali di questi coin hanno oggi un segnale di acquisto?',
  },
  pt: {
    open: 'Abrir o app', today: 'Mercado cripto hoje', fngNav: 'Índice Fear & Greed', all: 'Todas as moedas', risk: 'Aviso de risco', legal: 'Aviso legal', privacy: 'Privacidade',
    foot: (d) => `Não é recomendação de investimento. O Coinweather é um serviço informativo. Os preços não podem ser previstos com segurança; as probabilidades se baseiam em preços passados e podem errar. Criptoativos podem cair muito, até a perda total. Atualizado em ${d}.`,
    offer: 'Conta gratuita: sinal e perspectiva de 1000 moedas, checagem da carteira e um histórico aberto – 30 dias com todos os recursos, sem dados de pagamento.',
    start: 'Começar grátis', noSignup: 'Ver o mercado de hoje – sem cadastro',
    idx: 'Pontuação de compra', fng: 'Fear & Greed', ago7: (v) => `há 7 dias ${v}`, cyc: 'Ciclo (12 meses)', belowAth: 'abaixo da máxima histórica do Bitcoin', sig: 'Sinais de compra', ofRated: (n) => `de ${n} moedas avaliadas`,
    label: { 'Kaufen': 'Comprar', 'Eher kaufen': 'Tendência de compra', 'Halten': 'Manter', 'Eher verkaufen': 'Tendência de venda', 'Verkaufen': 'Vender' },
    zone: { deep: 'no fundo do ciclo', low: 'terço inferior do ciclo', mid: 'meio do ciclo', high: 'perto da máxima' },
    mood: ['medo extremo', 'medo', 'neutro', 'ganância', 'ganância extrema'],
    odds: (a, b) => `Desde 2022, depois de pontuações de compra como a de hoje, o Bitcoin estava mais alto um ano depois em ${a} de 100 casos${isNum(b) ? ` e o Ethereum em ${b} de 100` : ''}.`,
    tTitle: (d) => `Mercado cripto hoje (${d}): Fear & Greed, pontuação de compra e perspectiva`,
    tDesc: (v, l, f, m, p) => `É um bom momento para comprar cripto? A previsão cripto de hoje: pontuação de compra ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Atualizado diariamente. Não é recomendação de investimento.`,
    tH1: (l, v) => `Mercado cripto hoje: ${l} (${v}/100)`, tSub: (d) => `Previsão do tempo cripto de ${d} – atualizada todos os dias.`,
    buyQ: 'É um bom momento para comprar cripto?',
    tPara: (v, l, f, m, odds, alt) => `Ninguém pode saber com certeza. O que os dados dizem hoje: a pontuação de compra do Coinweather está em <strong>${v} de 100 – “${l}”</strong>. Ela é anticíclica e olha 12 meses à frente: sobe quando o Bitcoin está barato em relação às suas médias longas, bem abaixo da máxima e o mercado está com medo. O índice Fear &amp; Greed está em <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Para a altcoin típica foram só ${alt} de 100 – por isso a pontuação de compra vale sobretudo para Bitcoin e Ethereum.` : ''} São tendências de dados passados, não promessas.`,
    btcH: 'Bitcoin hoje', btcPara: (p, d1, d7, ath) => `O Bitcoin está cotado a <strong>${p}</strong> (${d1} em 24 horas, ${d7} em 7 dias) e ${ath} % abaixo da sua máxima histórica.`, btcLink: 'Página do Bitcoin →',
    movH: 'Maiores movimentos das 100 maiores moedas (24 horas)', obs: 'Observações, não recomendações.', gain: 'Em alta', lose: 'Em baixa', price: 'Preço', h24: '24 h', d7h: '7 dias',
    recH: 'Histórico aberto', recPara: (since, avg, up, n, b, mkt) => `Cada sinal de compra do site é medido de novo. Desde ${since}: após 7 dias em média <strong>${avg}</strong>, ${up} de ${n} no positivo (Bitcoin no mesmo período ${b}${mkt ? `, a média do top 100 ${mkt}` : ''}). Desde 24 de outubro de 2026 só há sinais de compra para as 100 maiores moedas, nas quais o modelo foi testado. Os resultados ruins também ficam aqui – é esse o objetivo.`,
    tOffer: 'Quais moedas têm sinal de compra hoje?',
    cTitle: (n, s, d) => `${n} (${s}) preço hoje e perspectiva – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} está em ${p} (${d1} em 24 h, ${d7} em 7 dias). Pontuação de compra cripto ${v}/100 (${l}), Fear & Greed ${f}. Não é recomendação de investimento.`,
    cH1: (n, s) => `${n} (${s}) hoje`, cSub: (d) => `Preço, tendência e previsão cripto de ${d} – atualizado todos os dias.`, rank: 'Posição',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} está cotada a <strong>${p}</strong>, ${d1} nas últimas 24 horas e ${d7} em 7 dias. É a número ${r} em capitalização (${cap})${ath ? ` e está ${ath} % abaixo da sua máxima histórica de ${athP}` : ''}.`,
    period: 'Período', change: 'Variação', periods: ['24 horas', '7 dias', '30 dias', '200 dias', '1 ano'],
    cComp: (n, core, v, l, up, med, zone) => `A pontuação de compra da Bússola do ciclo do Coinweather está em <strong>${v}/100 (“${l}”)</strong>. ${core ? `Para ${n}, ela conta 80 % do sinal; a própria tendência, 20 %. O sinal vale por 12 meses ou mais.` : zone === 'cheap' ? `O ciclo está barato, então ${n} recebe um bônus na pontuação de compra e nenhum sinal de venda; a tendência também conta.` : zone === 'dear' ? `O ciclo está caro, então ${n} recebe no máximo “Tendência de compra”, e só para as próximas semanas.` : `O ciclo não está nem barato nem caro, então o sinal de ${n} segue hoje a tendência.`} ${isNum(up) ? `Desde 2022, um ano após níveis como hoje, ${core ? n : 'as altcoins'} estavam mais altas em ${up} % dos casos (mediana ${med} %).` : ''}`,
    cBuyQ: (n) => `É um bom momento para comprar ${n}?`,
    cPara2: (v, l, f, m, odds) => `Ninguém pode saber com certeza. O que os dados dizem hoje: a pontuação de compra cripto está em <strong>${v}/100 (“${l}”)</strong> e o índice Fear &amp; Greed em ${f} (${m}). ${odds}`,
    stable: (n) => `${n} é uma stablecoin – deve manter seu valor, por isso o Coinweather não dá sinal de compra nem de venda.`,
    sample: (n, l, h, r) => `O sinal do Coinweather para ${n} hoje: <strong>${l}</strong>${h ? `, prazo ${h}` : ''}${r ? `, risco ${r}` : ''}.`,
    locked: (n) => `O Coinweather avalia ${n} a cada 15 minutos. O sinal atual, o prazo e o risco aparecem com uma conta gratuita.`,
    offAll: 'Ver o sinal das 1000 moedas', offCoin: (n) => `Ver o sinal de ${n}`, mToday: 'O mercado hoje', fullRep: 'Previsão cripto completa →', similar: 'Parecidas por capitalização',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} trilhões` : v >= 1e9 ? `${fmt(v / 1e9, 1)} bilhões` : `${fmt(v / 1e6, 0)} milhões`),
    fTitle: (v, m, d) => `Índice Fear and Greed cripto hoje: ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `O índice cripto Fear & Greed está hoje em ${v} (${m})${isNum(w) ? `, há uma semana em ${w}` : ''}. O que medo e ganância significaram para os preços desde 2018 – atualizado diariamente. Não é recomendação de investimento.`,
    fH1: (v, m) => `Índice cripto Fear &amp; Greed hoje: ${v} – ${m}`, fSub: (d) => `Atualizado em ${d}. Fonte: alternative.me.`,
    fToday: 'Hoje', f7: 'Há 7 dias', f30: 'Há 30 dias', fAvg: 'Média de 7 dias',
    fWhatH: 'O que é o índice Fear &amp; Greed?',
    fWhat: 'O índice mede o humor do mercado cripto de 0 (medo extremo) a 100 (ganância extrema), com base em volatilidade, momentum, volume, redes sociais e dominância do Bitcoin. Abaixo de 25 é medo extremo, 25–45 medo, 45–55 neutro, 55–75 ganância e acima de 75 ganância extrema.',
    fHistH: 'O que medo e ganância significaram para os preços desde 2018?',
    fHist: 'O Coinweather comparou os valores diários desde 2018 com o que os preços fizeram depois:',
    fLi: ['<strong>A ganância extrema foi um alerta:</strong> com a média de 7 dias entre 75 e 85, a moeda mediana estava mais alta 30 dias depois em apenas 20–33 % dos casos (mediana de cerca de −20 %). Nessa zona o Coinweather limita a parte de tendência das altcoins, e a pontuação de compra também cai, porque o Fear & Greed é um dos seus cinco componentes.',
      '<strong>Medo longo num mercado no fundo foi uma oportunidade – para o Bitcoin:</strong> depois de longos períodos de medo (pelo menos 54 de 60 dias abaixo de 45) com o Bitcoin pelo menos 40 % abaixo da máxima, o Bitcoin estava mais alto um ano depois em 84–100 % dos casos. Para a altcoin média isso não valeu.',
      '<strong>Sozinho, o índice não foi um sinal confiável</strong> – “comprar no medo, vender na ganância” como regra simples foi pior do que seguir a tendência do mercado.'],
    fNow: (v, m, a) => `Hoje: <strong>${v} (${m})</strong>${a ? `, média de 7 dias ${a}` : ''}.`, brakeOn: 'O freio de ganância está ativo.', brakeOff: 'O freio de ganância não está ativo.',
    fIdx: (v, l) => `A pontuação de compra do Coinweather está em <strong>${v}/100 (“${l}”)</strong>.`, fOffer: 'Veja como medo e ganância afetam cada uma das 1000 moedas',
    lTitle: (d) => `Preços cripto hoje: as 500 maiores moedas – ${d}`,
    lDesc: (v, l) => `Preços e variações de 24 horas e 7 dias das 500 maiores criptomoedas, mais a previsão cripto de hoje: pontuação de compra ${v}/100 (${l}). Atualizado diariamente.`,
    lH1: 'As 500 maiores moedas hoje', lSub: (d, v, l) => `Atualizado em ${d}. Pontuação de compra hoje: ${v}/100 – ${l}.`, coin: 'Moeda', lOffer: 'Quais dessas moedas têm sinal de compra hoje?',
  },
  tr: {
    open: 'Uygulamayı aç', today: 'Bugün kripto piyasası', fngNav: 'Korku ve Açgözlülük Endeksi', all: 'Tüm coinler', risk: 'Risk uyarısı', legal: 'Künye', privacy: 'Gizlilik',
    foot: (d) => `Yatırım tavsiyesi değildir. Coinweather bir bilgi hizmetidir. Fiyatlar kesin olarak tahmin edilemez; olasılıklar geçmiş fiyatlara dayanır ve yanılabilir. Kripto varlıklar sert düşebilir – tamamen değer kaybına kadar. Güncelleme: ${d}.`,
    offer: 'Ücretsiz hesap: 1000 coin için sinyal ve görünüm, portföy kontrolü ve açık performans kaydı – 30 gün tüm özellikler, ödeme bilgisi olmadan.',
    start: 'Ücretsiz başla', noSignup: 'Bugünkü piyasayı gör – kayıt olmadan',
    idx: 'Alım skoru', fng: 'Korku ve Açgözlülük', ago7: (v) => `7 gün önce ${v}`, cyc: 'Döngü (12 ay)', belowAth: 'Bitcoin’in zirvesinin altında', sig: 'Alım sinyalleri', ofRated: (n) => `değerlendirilen ${n} coinden`,
    label: { 'Kaufen': 'Al', 'Eher kaufen': 'Almaya yakın', 'Halten': 'Tut', 'Eher verkaufen': 'Satmaya yakın', 'Verkaufen': 'Sat' },
    zone: { deep: 'döngünün dibinde', low: 'döngünün alt üçte biri', mid: 'döngünün ortası', high: 'zirveye yakın' },
    mood: ['aşırı korku', 'korku', 'nötr', 'açgözlülük', 'aşırı açgözlülük'],
    odds: (a, b) => `2022’den beri bugünkü gibi alım skorlarından sonra Bitcoin bir yıl sonra 100 vakanın ${a} tanesinde daha yüksekti${isNum(b) ? `, Ethereum 100 vakanın ${b} tanesinde` : ''}.`,
    tTitle: (d) => `Bugün kripto piyasası (${d}): Korku ve Açgözlülük, alım skoru ve görünüm`,
    tDesc: (v, l, f, m, p) => `Kripto almak için iyi bir zaman mı? Bugünün kripto hava durumu: alım skoru ${v}/100 (${l}), Korku ve Açgözlülük ${f} (${m}), Bitcoin ${p}. Her gün güncellenir. Yatırım tavsiyesi değildir.`,
    tH1: (l, v) => `Bugün kripto piyasası: ${l} (${v}/100)`, tSub: (d) => `${d} tarihli kripto hava durumu – her gün güncellenir.`,
    buyQ: 'Kripto almak için iyi bir zaman mı?',
    tPara: (v, l, f, m, odds, alt) => `Bunu kimse kesin olarak bilemez. Verilerin bugün söyledikleri: Coinweather alım skoru <strong>100 üzerinden ${v} – “${l}”</strong>. Döngüye karşıdır ve 12 ay ileriye bakar: Bitcoin uzun ortalamalarına göre ucuzsa, zirvesinin çok altındaysa ve piyasada korku varsa yükselir. Korku ve Açgözlülük Endeksi <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Tipik altcoin için bu yalnızca 100 vakanın ${alt} tanesiydi – bu yüzden alım skoru özellikle Bitcoin ve Ethereum için geçerlidir.` : ''} Bunlar geçmiş verilerden eğilimlerdir, vaat değildir.`,
    btcH: 'Bugün Bitcoin', btcPara: (p, d1, d7, ath) => `Bitcoin <strong>${p}</strong> seviyesinde (24 saatte ${d1}, 7 günde ${d7}) ve tüm zamanların zirvesinin %${ath} altında.`, btcLink: 'Bitcoin sayfası →',
    movH: 'En büyük 100 coinin en büyük hareketleri (24 saat)', obs: 'Gözlemdir, tavsiye değildir.', gain: 'Yükselenler', lose: 'Düşenler', price: 'Fiyat', h24: '24 sa', d7h: '7 gün',
    recH: 'Açık performans kaydı', recPara: (since, avg, up, n, b, mkt) => `Sitenin her alım sinyali yeniden ölçülür. ${since} tarihinden beri: 7 gün sonra ortalama <strong>${avg}</strong>, ${n} sinyalin ${up} tanesi artıda (aynı dönemde Bitcoin ${b}${mkt ? `, ilk 100 ortalaması ${mkt}` : ''}). 24 Ekim 2026’dan beri alım sinyalleri yalnızca modelin test edildiği en büyük 100 coin için verilir. Kötü sonuçlar da burada – asıl mesele bu.`,
    tOffer: 'Bugün hangi coinlerin alım sinyali var?',
    cTitle: (n, s, d) => `${n} (${s}) bugün fiyat ve görünüm – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} ${p} seviyesinde (24 saatte ${d1}, 7 günde ${d7}). Kripto alım skoru ${v}/100 (${l}), Korku ve Açgözlülük ${f}. Yatırım tavsiyesi değildir.`,
    cH1: (n, s) => `Bugün ${n} (${s})`, cSub: (d) => `${d} tarihli fiyat, eğilim ve kripto hava durumu – her gün güncellenir.`, rank: 'Sıra',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} <strong>${p}</strong> seviyesinde; son 24 saatte ${d1}, 7 günde ${d7}. Piyasa değerine göre ${r}. sırada (${cap})${ath ? ` ve ${athP} olan zirvesinin %${ath} altında` : ''}.`,
    period: 'Dönem', change: 'Değişim', periods: ['24 saat', '7 gün', '30 gün', '200 gün', '1 yıl'],
    cComp: (n, core, v, l, up, med, zone) => `Coinweather Döngü Pusulası’nın alım skoru <strong>${v}/100 (“${l}”)</strong>. ${core ? `${n} için sinyalin % 80’ini oluşturur, kendi trendi % 20’sini. Sinyal 12 ay ve üzeri içindir.` : zone === 'cheap' ? `Döngü ucuz, bu yüzden ${n} alım skorunda bonus alır ve satış sinyali almaz; kendi trendi de sayılır.` : zone === 'dear' ? `Döngü pahalı, bu yüzden ${n} en fazla “Almaya yakın” alır, o da yalnızca önümüzdeki haftalar için.` : `Döngü ne ucuz ne pahalı, bu yüzden ${n} sinyali bugün trendini izler.`} ${isNum(up) ? `2022’den beri bugünkü gibi seviyelerden bir yıl sonra ${core ? n : 'altcoinler'} vakaların % ${up} kadarında daha yüksekti (ortanca % ${med}).` : ''}`,
    cBuyQ: (n) => `${n} almak için iyi bir zaman mı?`,
    cPara2: (v, l, f, m, odds) => `Bunu kimse kesin olarak bilemez. Verilerin bugün söyledikleri: kripto alım skoru <strong>${v}/100 (“${l}”)</strong>, Korku ve Açgözlülük Endeksi ${f} (${m}). ${odds}`,
    stable: (n) => `${n} bir stablecoin – değerini korumak için tasarlanmıştır, bu yüzden Coinweather alım ya da satım sinyali vermez.`,
    sample: (n, l, h, r) => `Coinweather’ın bugün ${n} için sinyali: <strong>${l}</strong>${h ? `, tutma süresi ${h}` : ''}${r ? `, risk ${r}` : ''}.`,
    locked: (n) => `Coinweather ${n} coinini 15 dakikada bir değerlendirir. Güncel sinyal, tutma süresi ve risk ücretsiz bir hesapla görünür.`,
    offAll: '1000 coinin hepsinin sinyalini gör', offCoin: (n) => `${n} sinyalini gör`, mToday: 'Bugün piyasa', fullRep: 'Tam kripto hava durumu →', similar: 'Piyasa değerine göre benzerleri',
    big: (v, fmt) => (v >= 1e12 ? `${fmt(v / 1e12, 2)} trilyon` : v >= 1e9 ? `${fmt(v / 1e9, 1)} milyar` : `${fmt(v / 1e6, 0)} milyon`),
    fTitle: (v, m, d) => `Bugün kripto Korku ve Açgözlülük Endeksi: ${v} (${m}) – ${d}`,
    fDesc: (v, m, w) => `Kripto Korku ve Açgözlülük Endeksi bugün ${v} (${m})${isNum(w) ? `, bir hafta önce ${w}` : ''}. Korku ve açgözlülüğün 2018’den beri fiyatlar için anlamı – her gün güncellenir. Yatırım tavsiyesi değildir.`,
    fH1: (v, m) => `Bugün kripto Korku ve Açgözlülük Endeksi: ${v} – ${m}`, fSub: (d) => `Güncelleme: ${d}. Kaynak: alternative.me.`,
    fToday: 'Bugün', f7: '7 gün önce', f30: '30 gün önce', fAvg: '7 günlük ortalama',
    fWhatH: 'Korku ve Açgözlülük Endeksi nedir?',
    fWhat: 'Endeks, kripto piyasasının ruh halini 0 (aşırı korku) ile 100 (aşırı açgözlülük) arasında ölçer; oynaklık, momentum, işlem hacmi, sosyal medya ve Bitcoin hakimiyetine dayanır. 25’in altı aşırı korku, 25–45 korku, 45–55 nötr, 55–75 açgözlülük, 75’in üstü aşırı açgözlülüktür.',
    fHistH: 'Korku ve açgözlülük 2018’den beri fiyatlar için ne anlama geldi?',
    fHist: 'Coinweather 2018’den beri günlük değerleri sonrasında fiyatların ne yaptığıyla karşılaştırdı:',
    fLi: ['<strong>Aşırı açgözlülük bir uyarıydı:</strong> 7 günlük ortalama 75 ile 85 arasındayken ortanca coin 30 gün sonra vakaların yalnızca %20–33’ünde daha yüksekti (ortanca yaklaşık −%20). Bu bölgede Coinweather altcoinlerin trend kısmını sınırlar; Korku ve Açgözlülük beş bileşeninden biri olduğu için alım skoru da düşer.',
      '<strong>Dipteki bir piyasada uzun korku bir fırsattı – Bitcoin için:</strong> uzun korku dönemlerinden sonra (60 günün en az 54’ünde 45’in altında) ve Bitcoin zirvesinin en az %40 altındayken, Bitcoin bir yıl sonra vakaların %84–100’ünde daha yüksekti. Ortalama altcoin için bu geçerli olmadı.',
      '<strong>Endeks tek başına güvenilir bir sinyal değildi</strong> – basit bir kural olarak “korkuda al, açgözlülükte sat” piyasa trendini izlemekten daha kötü sonuç verdi.'],
    fNow: (v, m, a) => `Bugün: <strong>${v} (${m})</strong>${a ? `, 7 günlük ortalama ${a}` : ''}.`, brakeOn: 'Açgözlülük freni etkin.', brakeOff: 'Açgözlülük freni etkin değil.',
    fIdx: (v, l) => `Coinweather alım skoru <strong>${v}/100 (“${l}”)</strong>.`, fOffer: 'Korku ve açgözlülüğün 1000 coinin her birini nasıl etkilediğini gör',
    lTitle: (d) => `Bugün kripto fiyatları: en büyük 500 coin – ${d}`,
    lDesc: (v, l) => `En büyük 500 kripto paranın fiyatları, 24 saatlik ve 7 günlük değişimleri ile bugünkü kripto hava durumu: alım skoru ${v}/100 (${l}). Her gün güncellenir.`,
    lH1: 'Bugün en büyük 500 coin', lSub: (d, v, l) => `Güncelleme: ${d}. Bugünkü alım skoru: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Bu coinlerden hangilerinin bugün alım sinyali var?',
  },
};
// ---------- Indikator-Seiten (Zyklus-Kompass) ----------
const IX = {
  en: { nav: 'Cycle Compass', label: { Tief: 'deep', Günstig: 'cheap', Neutral: 'neutral', Erhitzt: 'heated', Überhitzt: 'overheated' },
    season: (v) => (v >= 75 ? 'altcoin season' : v <= 25 ? 'Bitcoin season' : 'transition'),
    riskT: (v, l, d) => `Bitcoin cycle risk today: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `Coinweather’s cycle risk index combines Mayer Multiple, 2-year MA, Pi Cycle, distance to the all-time high and Fear & Greed: today ${v}/100 (${l}). With an honest backtest. Not financial advice.`,
    riskH: (v, l) => `Bitcoin cycle risk today: ${v}/100 – ${l}`, riskP: 'Our own index from 0 (deep, cheap) to 100 (overheated): the average of five well-known cycle components. Tested on Bitcoin daily prices since 2022. Coinweather’s buy score is 100 minus this value.',
    riskBt: (a) => `Since 2022, after readings like today, Bitcoin was higher one year later in ${a} of cases.`,
    parts: { mayer: 'Mayer Multiple', twoYear: '2-year average', pi: 'Pi Cycle', ath: 'Closeness to all-time high', fng: 'Fear & Greed (30 days)' }, partsH: 'Components (0 = deep, 100 = overheated)',
    seasonT: (v, l, d) => `Altcoin Season Index today: ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `${v} % of the ${n} largest coins beat Bitcoin over the last 90 days. Updated daily – with the leading and lagging coins. Not financial advice.`,
    seasonH: (v, l) => `Altcoin Season Index today: ${v}/100 – ${l}`, seasonP: (v, n, b) => `${v} % of the ${n} largest coins (without Bitcoin and stablecoins) did better than Bitcoin over the last 90 days – Bitcoin itself changed by ${b}. From 75 on it’s called altcoin season, up to 25 Bitcoin season.`,
    lead: 'Leading over 90 days', lag: 'Lagging over 90 days',
    piT: (v, d) => `Pi Cycle Top indicator today: ${v} % – ${d}`, piD: (v) => `Bitcoin’s 111-day average stands at ${v} % of twice the 350-day average. At 100 % they cross – historically close to cycle tops. Updated daily.`,
    piH: (v) => `Pi Cycle Top indicator today: ${v} %`, piP: (a, b, v) => `The 111-day average (${a}) stands at ${v} % of twice the 350-day average (${b}). When they cross (100 %), it marked the top in the past – most recently in April 2021. ${v >= 95 ? 'The signal is close.' : 'There is no signal at the moment.'}`,
    mayerT: (v, d) => `Mayer Multiple today: ${v} – ${d}`, mayerD: (v) => `Bitcoin’s Mayer Multiple (price / 200-day average) is ${v} today. Below 0.8 was historically cheap, above 2.4 overheated. Updated daily.`,
    mayerH: (v) => `Bitcoin Mayer Multiple today: ${v}`, mayerP: (v, s) => `Price divided by the 200-day average (${s}): ${v}. Below 0.8 Bitcoin was historically considered cheap, above 2.4 overheated.`,
    full: 'See the full history and how often Bitcoin was higher afterwards – in the Cycle Compass', fullBtn: 'Open the Cycle Compass', also: 'More cycle indicators',
    note: 'Indicators describe past cycles – no guarantee for the next one. Not financial advice.' },
  de: { nav: 'Zyklus-Kompass', label: { Tief: 'tief', Günstig: 'günstig', Neutral: 'neutral', Erhitzt: 'erhitzt', Überhitzt: 'überhitzt' },
    season: (v) => (v >= 75 ? 'Altcoin-Saison' : v <= 25 ? 'Bitcoin-Saison' : 'Übergang'),
    riskT: (v, l, d) => `Bitcoin Zyklus-Risiko heute: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `Der Zyklus-Risiko-Index von Coinweather bündelt Mayer-Multiple, 2-Jahres-Schnitt, Pi-Cycle, Abstand zum Allzeithoch und Fear & Greed: heute ${v}/100 (${l}). Mit ehrlichem Rückblick. Keine Anlageberatung.`,
    riskH: (v, l) => `Bitcoin Zyklus-Risiko heute: ${v}/100 – ${l}`, riskP: 'Unser eigener Index von 0 (tief, günstig) bis 100 (überhitzt): der Mittelwert aus fünf bekannten Zyklus-Bausteinen. Geprüft an Bitcoin-Tageskursen seit 2022. Der Kauf-Score von Coinweather ist 100 minus dieser Wert.',
    riskBt: (a) => `Seit 2022 stand Bitcoin nach Ständen wie heute ein Jahr später in ${a} der Fälle höher.`,
    parts: { mayer: 'Mayer-Multiple', twoYear: '2-Jahres-Schnitt', pi: 'Pi-Cycle', ath: 'Nähe zum Allzeithoch', fng: 'Fear & Greed (30 Tage)' }, partsH: 'Bausteine (0 = tief, 100 = überhitzt)',
    seasonT: (v, l, d) => `Altcoin-Saison-Index heute: ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `${v} % der ${n} größten Coins haben Bitcoin in den letzten 90 Tagen geschlagen. Täglich aktuell – mit den stärksten und schwächsten Coins. Keine Anlageberatung.`,
    seasonH: (v, l) => `Altcoin-Saison-Index heute: ${v}/100 – ${l}`, seasonP: (v, n, b) => `${v} % der ${n} größten Coins (ohne Bitcoin und Stablecoins) liefen in den letzten 90 Tagen besser als Bitcoin – Bitcoin selbst veränderte sich um ${b}. Ab 75 spricht man von Altcoin-Saison, bis 25 von Bitcoin-Saison.`,
    lead: 'Vorne über 90 Tage', lag: 'Hinten über 90 Tage',
    piT: (v, d) => `Pi-Cycle-Top-Indikator heute: ${v} % – ${d}`, piD: (v) => `Der 111-Tage-Schnitt von Bitcoin steht bei ${v} % des doppelten 350-Tage-Schnitts. Bei 100 % kreuzen sie – historisch nahe an Zyklus-Hochs. Täglich aktuell.`,
    piH: (v) => `Pi-Cycle-Top-Indikator heute: ${v} %`, piP: (a, b, v) => `Der 111-Tage-Schnitt (${a}) steht bei ${v} % des doppelten 350-Tage-Schnitts (${b}). Kreuzten sie sich (100 %), markierte das früher das Hoch – zuletzt im April 2021. ${v >= 95 ? 'Das Signal ist nahe.' : 'Derzeit gibt es kein Signal.'}`,
    mayerT: (v, d) => `Mayer-Multiple heute: ${v} – ${d}`, mayerD: (v) => `Das Mayer-Multiple von Bitcoin (Kurs / 200-Tage-Schnitt) liegt heute bei ${v}. Unter 0,8 war historisch günstig, über 2,4 überhitzt. Täglich aktuell.`,
    mayerH: (v) => `Bitcoin Mayer-Multiple heute: ${v}`, mayerP: (v, s) => `Kurs geteilt durch den 200-Tage-Schnitt (${s}): ${v}. Unter 0,8 galt Bitcoin historisch als günstig, über 2,4 als überhitzt.`,
    full: 'Den ganzen Verlauf und wie oft Bitcoin danach höher stand, siehst du im Zyklus-Kompass', fullBtn: 'Zum Zyklus-Kompass', also: 'Weitere Zyklus-Indikatoren',
    note: 'Indikatoren beschreiben vergangene Zyklen – keine Garantie für den nächsten. Keine Anlageberatung.' },
  es: { nav: 'Brújula del ciclo', label: { Tief: 'bajo', Günstig: 'barato', Neutral: 'neutral', Erhitzt: 'recalentado', Überhitzt: 'sobrecalentado' },
    season: (v) => (v >= 75 ? 'temporada de altcoins' : v <= 25 ? 'temporada de Bitcoin' : 'transición'),
    riskT: (v, l, d) => `Riesgo del ciclo de Bitcoin hoy: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `El índice de riesgo del ciclo de Coinweather combina el múltiplo de Mayer, la media de 2 años, el Pi Cycle, la distancia al máximo y el Fear & Greed: hoy ${v}/100 (${l}). Con retrospectiva honesta. No es asesoramiento financiero.`,
    riskH: (v, l) => `Riesgo del ciclo de Bitcoin hoy: ${v}/100 – ${l}`, riskP: 'Nuestro propio índice de 0 (bajo, barato) a 100 (sobrecalentado): la media de cinco componentes de ciclo conocidos. Probado con precios diarios de Bitcoin desde 2022. La puntuación de compra de Coinweather es 100 menos este valor.',
    riskBt: (a) => `Desde 2022, tras niveles como el de hoy, Bitcoin estaba más alto un año después en el ${a} de los casos.`,
    parts: { mayer: 'Múltiplo de Mayer', twoYear: 'Media de 2 años', pi: 'Pi Cycle', ath: 'Cercanía al máximo histórico', fng: 'Fear & Greed (30 días)' }, partsH: 'Componentes (0 = bajo, 100 = sobrecalentado)',
    seasonT: (v, l, d) => `Índice de temporada de altcoins hoy: ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `El ${v} % de las ${n} monedas más grandes superó a Bitcoin en los últimos 90 días. Actualizado a diario, con las monedas más fuertes y más débiles. No es asesoramiento financiero.`,
    seasonH: (v, l) => `Índice de temporada de altcoins hoy: ${v}/100 – ${l}`, seasonP: (v, n, b) => `El ${v} % de las ${n} monedas más grandes (sin Bitcoin ni stablecoins) rindió mejor que Bitcoin en los últimos 90 días; Bitcoin cambió un ${b}. Desde 75 se habla de temporada de altcoins, hasta 25 de temporada de Bitcoin.`,
    lead: 'Delante en 90 días', lag: 'Detrás en 90 días',
    piT: (v, d) => `Indicador Pi Cycle Top hoy: ${v} % – ${d}`, piD: (v) => `La media de 111 días de Bitcoin está en el ${v} % del doble de la media de 350 días. Al 100 % se cruzan, históricamente cerca de los máximos del ciclo. Actualizado a diario.`,
    piH: (v) => `Indicador Pi Cycle Top hoy: ${v} %`, piP: (a, b, v) => `La media de 111 días (${a}) está en el ${v} % del doble de la media de 350 días (${b}). Cuando se cruzaron (100 %), marcaron el máximo en el pasado, la última vez en abril de 2021. ${v >= 95 ? 'La señal está cerca.' : 'Ahora mismo no hay señal.'}`,
    mayerT: (v, d) => `Múltiplo de Mayer hoy: ${v} – ${d}`, mayerD: (v) => `El múltiplo de Mayer de Bitcoin (precio / media de 200 días) es hoy ${v}. Por debajo de 0,8 fue históricamente barato, por encima de 2,4 sobrecalentado. Actualizado a diario.`,
    mayerH: (v) => `Múltiplo de Mayer de Bitcoin hoy: ${v}`, mayerP: (v, s) => `Precio dividido por la media de 200 días (${s}): ${v}. Por debajo de 0,8 Bitcoin se consideraba históricamente barato, por encima de 2,4 sobrecalentado.`,
    full: 'El historial completo y cuántas veces Bitcoin estuvo más alto después, en la Brújula del ciclo', fullBtn: 'Abrir la Brújula del ciclo', also: 'Más indicadores de ciclo',
    note: 'Los indicadores describen ciclos pasados, sin garantía para el próximo. No es asesoramiento financiero.' },
  fr: { nav: 'Boussole du cycle', label: { Tief: 'bas', Günstig: 'bon marché', Neutral: 'neutre', Erhitzt: 'échauffé', Überhitzt: 'surchauffé' },
    season: (v) => (v >= 75 ? 'saison des altcoins' : v <= 25 ? 'saison du Bitcoin' : 'transition'),
    riskT: (v, l, d) => `Risque de cycle du Bitcoin aujourd’hui : ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `L’indice de risque de cycle de Coinweather combine Mayer Multiple, moyenne sur 2 ans, Pi Cycle, distance au record et Fear & Greed : aujourd’hui ${v}/100 (${l}). Avec un bilan honnête. Pas un conseil en investissement.`,
    riskH: (v, l) => `Risque de cycle du Bitcoin aujourd’hui : ${v}/100 – ${l}`, riskP: 'Notre propre indice de 0 (bas, bon marché) à 100 (surchauffé) : la moyenne de cinq composantes de cycle connues. Testé sur les cours quotidiens du Bitcoin depuis 2022. Le score d’achat de Coinweather vaut 100 moins cette valeur.',
    riskBt: (a) => `Depuis 2022, après des niveaux comme aujourd’hui, Bitcoin était plus haut un an plus tard dans ${a} des cas.`,
    parts: { mayer: 'Multiple de Mayer', twoYear: 'Moyenne sur 2 ans', pi: 'Pi Cycle', ath: 'Proximité du record', fng: 'Fear & Greed (30 jours)' }, partsH: 'Composantes (0 = bas, 100 = surchauffé)',
    seasonT: (v, l, d) => `Indice de saison des altcoins aujourd’hui : ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `${v} % des ${n} plus grandes cryptos ont battu Bitcoin sur les 90 derniers jours. Mis à jour chaque jour, avec les cryptos en tête et en queue. Pas un conseil en investissement.`,
    seasonH: (v, l) => `Indice de saison des altcoins aujourd’hui : ${v}/100 – ${l}`, seasonP: (v, n, b) => `${v} % des ${n} plus grandes cryptos (hors Bitcoin et stablecoins) ont fait mieux que Bitcoin sur 90 jours – Bitcoin lui-même a varié de ${b}. À partir de 75 on parle de saison des altcoins, jusqu’à 25 de saison du Bitcoin.`,
    lead: 'En tête sur 90 jours', lag: 'En queue sur 90 jours',
    piT: (v, d) => `Indicateur Pi Cycle Top aujourd’hui : ${v} % – ${d}`, piD: (v) => `La moyenne sur 111 jours du Bitcoin est à ${v} % du double de la moyenne sur 350 jours. À 100 % elles se croisent – historiquement près des sommets de cycle. Mis à jour chaque jour.`,
    piH: (v) => `Indicateur Pi Cycle Top aujourd’hui : ${v} %`, piP: (a, b, v) => `La moyenne sur 111 jours (${a}) est à ${v} % du double de la moyenne sur 350 jours (${b}). Leur croisement (100 %) a marqué le sommet par le passé – la dernière fois en avril 2021. ${v >= 95 ? 'Le signal est proche.' : 'Pas de signal pour le moment.'}`,
    mayerT: (v, d) => `Multiple de Mayer aujourd’hui : ${v} – ${d}`, mayerD: (v) => `Le Multiple de Mayer du Bitcoin (cours / moyenne sur 200 jours) est de ${v} aujourd’hui. Sous 0,8 c’était historiquement bon marché, au-dessus de 2,4 surchauffé. Mis à jour chaque jour.`,
    mayerH: (v) => `Multiple de Mayer du Bitcoin aujourd’hui : ${v}`, mayerP: (v, s) => `Cours divisé par la moyenne sur 200 jours (${s}) : ${v}. Sous 0,8 Bitcoin était historiquement jugé bon marché, au-dessus de 2,4 surchauffé.`,
    full: 'L’historique complet et la fréquence à laquelle Bitcoin était plus haut ensuite, dans la Boussole du cycle', fullBtn: 'Ouvrir la Boussole du cycle', also: 'Autres indicateurs de cycle',
    note: 'Les indicateurs décrivent des cycles passés – aucune garantie pour le prochain. Pas un conseil en investissement.' },
  it: { nav: 'Bussola del ciclo', label: { Tief: 'basso', Günstig: 'conveniente', Neutral: 'neutrale', Erhitzt: 'surriscaldato', Überhitzt: 'molto surriscaldato' },
    season: (v) => (v >= 75 ? 'stagione delle altcoin' : v <= 25 ? 'stagione di Bitcoin' : 'transizione'),
    riskT: (v, l, d) => `Rischio di ciclo di Bitcoin oggi: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `L’indice di rischio di ciclo di Coinweather combina multiplo di Mayer, media a 2 anni, Pi Cycle, distanza dal massimo e Fear & Greed: oggi ${v}/100 (${l}). Con retrospettiva onesta. Non è una consulenza finanziaria.`,
    riskH: (v, l) => `Rischio di ciclo di Bitcoin oggi: ${v}/100 – ${l}`, riskP: 'Il nostro indice da 0 (basso, conveniente) a 100 (surriscaldato): la media di cinque componenti di ciclo note. Testato sui prezzi giornalieri di Bitcoin dal 2022. Il punteggio di acquisto di Coinweather è 100 meno questo valore.',
    riskBt: (a) => `Dal 2022, dopo livelli come oggi, Bitcoin era più alto un anno dopo nel ${a} dei casi.`,
    parts: { mayer: 'Multiplo di Mayer', twoYear: 'Media a 2 anni', pi: 'Pi Cycle', ath: 'Vicinanza al massimo storico', fng: 'Fear & Greed (30 giorni)' }, partsH: 'Componenti (0 = basso, 100 = surriscaldato)',
    seasonT: (v, l, d) => `Indice della stagione delle altcoin oggi: ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `Il ${v} % dei ${n} coin più grandi ha battuto Bitcoin negli ultimi 90 giorni. Aggiornato ogni giorno, con i coin in testa e in coda. Non è una consulenza finanziaria.`,
    seasonH: (v, l) => `Indice della stagione delle altcoin oggi: ${v}/100 – ${l}`, seasonP: (v, n, b) => `Il ${v} % dei ${n} coin più grandi (senza Bitcoin e stablecoin) è andato meglio di Bitcoin negli ultimi 90 giorni; Bitcoin è variato del ${b}. Da 75 si parla di stagione delle altcoin, fino a 25 di stagione di Bitcoin.`,
    lead: 'In testa su 90 giorni', lag: 'In coda su 90 giorni',
    piT: (v, d) => `Indicatore Pi Cycle Top oggi: ${v} % – ${d}`, piD: (v) => `La media a 111 giorni di Bitcoin è al ${v} % del doppio della media a 350 giorni. Al 100 % si incrociano, storicamente vicino ai massimi di ciclo. Aggiornato ogni giorno.`,
    piH: (v) => `Indicatore Pi Cycle Top oggi: ${v} %`, piP: (a, b, v) => `La media a 111 giorni (${a}) è al ${v} % del doppio della media a 350 giorni (${b}). Quando si sono incrociate (100 %), hanno segnato il massimo in passato, l’ultima volta ad aprile 2021. ${v >= 95 ? 'Il segnale è vicino.' : 'Al momento non c’è alcun segnale.'}`,
    mayerT: (v, d) => `Multiplo di Mayer oggi: ${v} – ${d}`, mayerD: (v) => `Il multiplo di Mayer di Bitcoin (prezzo / media a 200 giorni) oggi è ${v}. Sotto 0,8 era storicamente conveniente, sopra 2,4 surriscaldato. Aggiornato ogni giorno.`,
    mayerH: (v) => `Multiplo di Mayer di Bitcoin oggi: ${v}`, mayerP: (v, s) => `Prezzo diviso per la media a 200 giorni (${s}): ${v}. Sotto 0,8 Bitcoin era storicamente considerato conveniente, sopra 2,4 surriscaldato.`,
    full: 'L’andamento completo e quante volte Bitcoin è stato più alto dopo, nella Bussola del ciclo', fullBtn: 'Apri la Bussola del ciclo', also: 'Altri indicatori di ciclo',
    note: 'Gli indicatori descrivono cicli passati, nessuna garanzia per il prossimo. Non è una consulenza finanziaria.' },
  pt: { nav: 'Bússola do ciclo', label: { Tief: 'baixo', Günstig: 'barato', Neutral: 'neutro', Erhitzt: 'aquecido', Überhitzt: 'superaquecido' },
    season: (v) => (v >= 75 ? 'temporada de altcoins' : v <= 25 ? 'temporada do Bitcoin' : 'transição'),
    riskT: (v, l, d) => `Risco do ciclo do Bitcoin hoje: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `O índice de risco do ciclo do Coinweather reúne múltiplo de Mayer, média de 2 anos, Pi Cycle, distância da máxima e Fear & Greed: hoje ${v}/100 (${l}). Com retrospectiva honesta. Não é recomendação de investimento.`,
    riskH: (v, l) => `Risco do ciclo do Bitcoin hoje: ${v}/100 – ${l}`, riskP: 'Nosso próprio índice de 0 (baixo, barato) a 100 (superaquecido): a média de cinco componentes de ciclo conhecidos. Testado com preços diários do Bitcoin desde 2022. A pontuação de compra do Coinweather é 100 menos este valor.',
    riskBt: (a) => `Desde 2022, depois de níveis como o de hoje, o Bitcoin estava mais alto um ano depois em ${a} dos casos.`,
    parts: { mayer: 'Múltiplo de Mayer', twoYear: 'Média de 2 anos', pi: 'Pi Cycle', ath: 'Proximidade da máxima', fng: 'Fear & Greed (30 dias)' }, partsH: 'Componentes (0 = baixo, 100 = superaquecido)',
    seasonT: (v, l, d) => `Índice de temporada de altcoins hoje: ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `${v} % das ${n} maiores moedas superaram o Bitcoin nos últimos 90 dias. Atualizado diariamente, com as moedas mais fortes e mais fracas. Não é recomendação de investimento.`,
    seasonH: (v, l) => `Índice de temporada de altcoins hoje: ${v}/100 – ${l}`, seasonP: (v, n, b) => `${v} % das ${n} maiores moedas (sem Bitcoin e stablecoins) foram melhores que o Bitcoin nos últimos 90 dias – o Bitcoin variou ${b}. A partir de 75 fala-se de temporada de altcoins, até 25 de temporada do Bitcoin.`,
    lead: 'Na frente em 90 dias', lag: 'Atrás em 90 dias',
    piT: (v, d) => `Indicador Pi Cycle Top hoje: ${v} % – ${d}`, piD: (v) => `A média de 111 dias do Bitcoin está em ${v} % do dobro da média de 350 dias. Em 100 % elas se cruzam – historicamente perto dos topos de ciclo. Atualizado diariamente.`,
    piH: (v) => `Indicador Pi Cycle Top hoje: ${v} %`, piP: (a, b, v) => `A média de 111 dias (${a}) está em ${v} % do dobro da média de 350 dias (${b}). Quando se cruzaram (100 %), marcaram o topo no passado – da última vez em abril de 2021. ${v >= 95 ? 'O sinal está perto.' : 'No momento não há sinal.'}`,
    mayerT: (v, d) => `Múltiplo de Mayer hoje: ${v} – ${d}`, mayerD: (v) => `O múltiplo de Mayer do Bitcoin (preço / média de 200 dias) está hoje em ${v}. Abaixo de 0,8 foi historicamente barato, acima de 2,4 superaquecido. Atualizado diariamente.`,
    mayerH: (v) => `Múltiplo de Mayer do Bitcoin hoje: ${v}`, mayerP: (v, s) => `Preço dividido pela média de 200 dias (${s}): ${v}. Abaixo de 0,8 o Bitcoin era historicamente visto como barato, acima de 2,4 superaquecido.`,
    full: 'O histórico completo e quantas vezes o Bitcoin estava mais alto depois, na Bússola do ciclo', fullBtn: 'Abrir a Bússola do ciclo', also: 'Mais indicadores de ciclo',
    note: 'Indicadores descrevem ciclos passados – sem garantia para o próximo. Não é recomendação de investimento.' },
  tr: { nav: 'Döngü Pusulası', label: { Tief: 'dip', Günstig: 'ucuz', Neutral: 'nötr', Erhitzt: 'ısınmış', Überhitzt: 'aşırı ısınmış' },
    season: (v) => (v >= 75 ? 'altcoin sezonu' : v <= 25 ? 'Bitcoin sezonu' : 'geçiş'),
    riskT: (v, l, d) => `Bugün Bitcoin döngü riski: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `Coinweather döngü riski endeksi Mayer çarpanı, 2 yıllık ortalama, Pi Cycle, zirveye uzaklık ve Korku ve Açgözlülüğü birleştirir: bugün ${v}/100 (${l}). Dürüst geriye bakışla. Yatırım tavsiyesi değildir.`,
    riskH: (v, l) => `Bugün Bitcoin döngü riski: ${v}/100 – ${l}`, riskP: 'Kendi endeksimiz 0 (dip, ucuz) ile 100 (aşırı ısınmış) arasında: bilinen beş döngü bileşeninin ortalaması. 2022’den beri Bitcoin günlük fiyatlarında test edildi. Coinweather alım skoru 100 eksi bu değerdir.',
    riskBt: (a) => `2022’den beri, bugünkü gibi seviyelerden sonra Bitcoin bir yıl sonra vakaların ${a} kadarında daha yüksekti.`,
    parts: { mayer: 'Mayer Çarpanı', twoYear: '2 yıllık ortalama', pi: 'Pi Cycle', ath: 'Zirveye yakınlık', fng: 'Korku ve Açgözlülük (30 gün)' }, partsH: 'Bileşenler (0 = dip, 100 = aşırı ısınmış)',
    seasonT: (v, l, d) => `Bugün Altcoin Sezonu Endeksi: ${v}/100 (${l}) – ${d}`, seasonD: (v, n) => `En büyük ${n} coinin %${v} kadarı son 90 günde Bitcoin’i geçti. Her gün güncellenir – öndeki ve geride kalan coinlerle. Yatırım tavsiyesi değildir.`,
    seasonH: (v, l) => `Bugün Altcoin Sezonu Endeksi: ${v}/100 – ${l}`, seasonP: (v, n, b) => `En büyük ${n} coinin (Bitcoin ve stablecoinler hariç) %${v} kadarı son 90 günde Bitcoin’den iyi performans gösterdi – Bitcoin’in değişimi ${b}. 75 ve üzeri altcoin sezonu, 25 ve altı Bitcoin sezonu sayılır.`,
    lead: '90 günde önde', lag: '90 günde geride',
    piT: (v, d) => `Bugün Pi Cycle Top göstergesi: %${v} – ${d}`, piD: (v) => `Bitcoin’in 111 günlük ortalaması, 350 günlük ortalamanın iki katının %${v} seviyesinde. %100’de kesişirler – tarihsel olarak döngü zirvelerine yakın. Her gün güncellenir.`,
    piH: (v) => `Bugün Pi Cycle Top göstergesi: %${v}`, piP: (a, b, v) => `111 günlük ortalama (${a}), 350 günlük ortalamanın iki katının (${b}) %${v} seviyesinde. Kesiştiklerinde (%100) geçmişte zirveyi işaret etti – en son Nisan 2021’de. ${v >= 95 ? 'Sinyal yakın.' : 'Şu anda sinyal yok.'}`,
    mayerT: (v, d) => `Bugün Mayer Çarpanı: ${v} – ${d}`, mayerD: (v) => `Bitcoin’in Mayer Çarpanı (fiyat / 200 günlük ortalama) bugün ${v}. 0,8 altı tarihsel olarak ucuz, 2,4 üstü aşırı ısınmıştı. Her gün güncellenir.`,
    mayerH: (v) => `Bugün Bitcoin Mayer Çarpanı: ${v}`, mayerP: (v, s) => `Fiyatın 200 günlük ortalamaya (${s}) bölümü: ${v}. 0,8 altında Bitcoin tarihsel olarak ucuz, 2,4 üstünde aşırı ısınmış sayıldı.`,
    full: 'Tüm geçmişi ve Bitcoin’in sonrasında ne sıklıkla daha yüksek olduğunu Döngü Pusulası’nda gör', fullBtn: 'Döngü Pusulası’nı aç', also: 'Diğer döngü göstergeleri',
    note: 'Göstergeler geçmiş döngüleri anlatır – bir sonrakinin garantisi değildir. Yatırım tavsiyesi değildir.' },
};

// ---------- Seite zum Einbetten des Krypto-Wetters (Widget) ----------
const EMB = {
  en: { nav: 'Widget for your website', t: 'Free crypto weather widget for your website', d: 'Embed today’s crypto weather on your blog or website: buy score, Fear & Greed and Bitcoin – free, updated every 15 minutes, one line of code.',
    h: 'Free crypto weather widget', p: 'Show your readers today’s crypto weather – buy score, Fear & Greed and Bitcoin, updated every 15 minutes. Free, no sign-up, one line of code. Copy the code into your page:', dark: 'Dark', light: 'Light' },
  de: { nav: 'Kästchen für deine Webseite', t: 'Kostenloses Krypto-Wetter-Widget für deine Webseite', d: 'Bau das Krypto-Wetter von heute in deinen Blog oder deine Webseite ein: Kauf-Score, Fear & Greed und Bitcoin – kostenlos, alle 15 Minuten aktuell, eine Zeile Code.',
    h: 'Kostenloses Krypto-Wetter-Widget', p: 'Zeig deinen Lesern das Krypto-Wetter von heute – Kauf-Score, Fear & Greed und Bitcoin, alle 15 Minuten aktuell. Kostenlos, ohne Anmeldung, eine Zeile Code. Kopiere den Code in deine Seite:', dark: 'Dunkel', light: 'Hell' },
  es: { nav: 'Widget para tu web', t: 'Widget gratuito del tiempo cripto para tu web', d: 'Integra el tiempo cripto de hoy en tu blog o web: puntuación de compra, Fear & Greed y Bitcoin, gratis, actualizado cada 15 minutos, una línea de código.',
    h: 'Widget gratuito del tiempo cripto', p: 'Muestra a tus lectores el tiempo cripto de hoy: puntuación de compra, Fear & Greed y Bitcoin, actualizado cada 15 minutos. Gratis, sin registro, una línea de código. Copia el código en tu página:', dark: 'Oscuro', light: 'Claro' },
  fr: { nav: 'Widget pour ton site', t: 'Widget météo crypto gratuit pour ton site', d: 'Intègre la météo crypto du jour sur ton blog ou ton site : score d’achat, Fear & Greed et Bitcoin – gratuit, mis à jour toutes les 15 minutes, une ligne de code.',
    h: 'Widget météo crypto gratuit', p: 'Montre à tes lecteurs la météo crypto du jour – score d’achat, Fear & Greed et Bitcoin, mis à jour toutes les 15 minutes. Gratuit, sans inscription, une ligne de code. Copie le code dans ta page :', dark: 'Sombre', light: 'Clair' },
  it: { nav: 'Widget per il tuo sito', t: 'Widget gratuito del meteo crypto per il tuo sito', d: 'Integra il meteo crypto di oggi nel tuo blog o sito: punteggio di acquisto, Fear & Greed e Bitcoin – gratis, aggiornato ogni 15 minuti, una riga di codice.',
    h: 'Widget gratuito del meteo crypto', p: 'Mostra ai tuoi lettori il meteo crypto di oggi – punteggio di acquisto, Fear & Greed e Bitcoin, aggiornato ogni 15 minuti. Gratis, senza registrazione, una riga di codice. Copia il codice nella tua pagina:', dark: 'Scuro', light: 'Chiaro' },
  pt: { nav: 'Widget para o seu site', t: 'Widget gratuito da previsão cripto para o seu site', d: 'Incorpore a previsão cripto de hoje no seu blog ou site: pontuação de compra, Fear & Greed e Bitcoin – grátis, atualizado a cada 15 minutos, uma linha de código.',
    h: 'Widget gratuito da previsão cripto', p: 'Mostre aos seus leitores a previsão cripto de hoje – pontuação de compra, Fear & Greed e Bitcoin, atualizada a cada 15 minutos. Grátis, sem cadastro, uma linha de código. Copie o código para a sua página:', dark: 'Escuro', light: 'Claro' },
  tr: { nav: 'Web siten için widget', t: 'Web siten için ücretsiz kripto hava durumu widget’ı', d: 'Bugünün kripto hava durumunu blog veya web sitene yerleştir: alım skoru, Korku ve Açgözlülük ve Bitcoin – ücretsiz, 15 dakikada bir güncel, tek satır kod.',
    h: 'Ücretsiz kripto hava durumu widget’ı', p: 'Okuyucularına bugünün kripto hava durumunu göster – alım skoru, Korku ve Açgözlülük ve Bitcoin, 15 dakikada bir güncel. Ücretsiz, kayıt yok, tek satır kod. Kodu sayfana kopyala:', dark: 'Koyu', light: 'Açık' },
};

// ---------- „Should I buy Bitcoin now?“ – der Kauf-Score als eigene Seite (hohe Suchnachfrage) ----------
const BQ = {
  en: { rain: 'Rain is buying weather.', nav: 'Should I buy Bitcoin now?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `Should I buy Bitcoin now? Buy score ${v}/100 (${l}) – ${d}`,
    desc: (v, l, p) => `Today’s contrarian Bitcoin buy score: ${v}/100 (${l}). Bitcoin at ${p}. Built from Mayer Multiple, 2-year average, Pi Cycle, distance to the high and Fear & Greed – with what followed one year later. Not financial advice.`,
    h1: (v, l) => `Should I buy Bitcoin now? Buy score today: ${v}/100 – ${l}`,
    intro: 'Nobody can time the bottom. What the data can tell you is whether Bitcoin is cheap or expensive in its cycle. Coinweather’s buy score is contrarian: it rises when Bitcoin is far below its long-term averages and its high, and when the market is scared – and it falls when everyone is greedy. Rain is buying weather.',
    inputsH: 'What’s in the buy score today', cheap: 'cheap', neutral: 'neutral', dear: 'expensive', bar: 'The longer the bar, the cheaper. All five count equally.',
    histH: 'What happened one year after readings like today (since 2022)', higher: 'higher one year later', median: 'median result',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Typical altcoin',
    caveat: 'Over 90 days there was no edge – after cheap readings the price often kept falling first. The buy score is made for buying in instalments over 12 months and longer, not for timing. Since 2022 there has only been one cycle: a tendency, not a promise.',
    stats: { score: 'Buy score', price: 'Bitcoin', ath: 'below the all-time high', fng: 'Fear & Greed' },
    faq: [['Is now a good time to buy Bitcoin?', (v, l, up) => `Coinweather’s buy score is ${v}/100 today (${l}). Since 2022, after readings like this, Bitcoin was higher one year later in ${up} % of cases. In the short term the price can still fall further.`],
      ['How is the buy score calculated?', () => 'It averages five well-known cycle components – Mayer Multiple, the 2-year moving average, Pi Cycle, the distance to the all-time high and the 30-day Fear & Greed Index – and turns them into one number from 0 (overheated) to 100 (cheap).'],
      ['Does this work for altcoins too?', (v, l, up, alt) => `Less so. Since 2022 the typical altcoin was higher one year after comparable readings in only ${alt} % of cases. That is why Coinweather gives altcoins only a bonus from the buy score on top of their own trend.`]],
    cta: 'See the buy score for 1,000 coins, the Cycle Compass and the autopilot' },
  de: { rain: 'Regen ist Kaufwetter.', nav: 'Soll ich jetzt Bitcoin kaufen?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `Soll ich jetzt Bitcoin kaufen? Kauf-Score ${v}/100 („${l}“) – ${d}`,
    desc: (v, l, p) => `Der antizyklische Bitcoin-Kauf-Score heute: ${v}/100 („${l}“). Bitcoin bei ${p}. Aus Mayer-Multiple, 2-Jahres-Schnitt, Pi-Cycle, Abstand zum Hoch und Fear & Greed – mit dem, was ein Jahr später folgte. Keine Anlageberatung.`,
    h1: (v, l) => `Soll ich jetzt Bitcoin kaufen? Kauf-Score heute: ${v}/100 – ${l}`,
    intro: 'Den Boden erwischt niemand sicher. Was die Daten sagen können: ob Bitcoin in seinem Zyklus günstig oder teuer ist. Der Kauf-Score von Coinweather ist antizyklisch: Er steigt, wenn Bitcoin weit unter seinen langen Schnitten und seinem Hoch steht und Angst herrscht – und er sinkt, wenn alle gierig sind. Regen ist Kaufwetter.',
    inputsH: 'Das steckt heute im Kauf-Score', cheap: 'günstig', neutral: 'neutral', dear: 'teuer', bar: 'Je länger der Balken, desto günstiger. Alle fünf zählen gleich.',
    histH: 'Was ein Jahr nach Ständen wie heute geschah (seit 2022)', higher: 'ein Jahr später höher', median: 'mittleres Ergebnis',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Typischer Altcoin',
    caveat: 'Auf 90 Tage gab es keinen Vorteil – nach günstigen Ständen fiel der Kurs oft erst weiter. Der Kauf-Score ist für Käufe in Raten über 12 Monate und länger gemacht, nicht für den perfekten Zeitpunkt. Seit 2022 gab es nur einen Zyklus: eine Tendenz, kein Versprechen.',
    stats: { score: 'Kauf-Score', price: 'Bitcoin', ath: 'unter dem Allzeithoch', fng: 'Fear & Greed' },
    faq: [['Ist jetzt ein guter Zeitpunkt, Bitcoin zu kaufen?', (v, l, up) => `Der Kauf-Score von Coinweather steht heute bei ${v}/100 („${l}“). Seit 2022 stand Bitcoin nach solchen Ständen ein Jahr später in ${up} % der Fälle höher. Kurzfristig kann der Kurs trotzdem weiter fallen.`],
      ['Wie wird der Kauf-Score berechnet?', () => 'Er mittelt fünf bekannte Zyklus-Bausteine – Mayer-Multiple, 2-Jahres-Schnitt, Pi-Cycle, Abstand zum Allzeithoch und Fear & Greed der letzten 30 Tage – zu einer Zahl von 0 (überhitzt) bis 100 (günstig).'],
      ['Gilt das auch für Altcoins?', (v, l, up, alt) => `Weniger. Seit 2022 stand der typische Altcoin ein Jahr nach vergleichbaren Ständen nur in ${alt} % der Fälle höher. Deshalb bekommen Altcoins bei Coinweather nur einen Bonus aus dem Kauf-Score zu ihrem eigenen Trend.`]],
    cta: 'Kauf-Score für 1000 Coins, Zyklus-Kompass und Autopilot ansehen' },
  es: { rain: 'La lluvia es tiempo de compra.', nav: '¿Comprar Bitcoin ahora?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `¿Debo comprar Bitcoin ahora? Puntuación de compra ${v}/100 («${l}») – ${d}`,
    desc: (v, l, p) => `La puntuación de compra anticíclica de Bitcoin hoy: ${v}/100 («${l}»). Bitcoin a ${p}. Basada en el múltiplo de Mayer, la media de 2 años, Pi Cycle, la distancia al máximo y Fear & Greed, con lo que pasó un año después. No es asesoramiento financiero.`,
    h1: (v, l) => `¿Debo comprar Bitcoin ahora? Puntuación de compra hoy: ${v}/100 – ${l}`,
    intro: 'Nadie acierta el suelo con seguridad. Lo que sí dicen los datos es si Bitcoin está barato o caro en su ciclo. La puntuación de compra de Coinweather es anticíclica: sube cuando Bitcoin está muy por debajo de sus medias largas y de su máximo y domina el miedo, y baja cuando todos son codiciosos. La lluvia es tiempo de compra.',
    inputsH: 'Qué contiene hoy la puntuación de compra', cheap: 'barato', neutral: 'neutral', dear: 'caro', bar: 'Cuanto más larga la barra, más barato. Los cinco cuentan igual.',
    histH: 'Qué pasó un año después de niveles como hoy (desde 2022)', higher: 'más alto un año después', median: 'resultado medio',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Altcoin típica',
    caveat: 'A 90 días no hubo ventaja: tras niveles baratos el precio a menudo siguió cayendo al principio. La puntuación de compra sirve para comprar por partes a 12 meses o más, no para acertar el momento. Desde 2022 solo hubo un ciclo: una tendencia, no una promesa.',
    stats: { score: 'Puntuación de compra', price: 'Bitcoin', ath: 'por debajo del máximo histórico', fng: 'Fear & Greed' },
    faq: [['¿Es buen momento para comprar Bitcoin?', (v, l, up) => `La puntuación de compra de Coinweather está hoy en ${v}/100 («${l}»). Desde 2022, tras niveles así, Bitcoin estaba más alto un año después en el ${up} % de los casos. A corto plazo el precio puede seguir cayendo.`],
      ['¿Cómo se calcula la puntuación de compra?', () => 'Promedia cinco componentes de ciclo conocidos – múltiplo de Mayer, media de 2 años, Pi Cycle, distancia al máximo histórico y Fear & Greed de 30 días – en un número de 0 (sobrecalentado) a 100 (barato).'],
      ['¿Sirve también para las altcoins?', (v, l, up, alt) => `Menos. Desde 2022 la altcoin típica estaba más alta un año después de niveles comparables solo en el ${alt} % de los casos. Por eso Coinweather da a las altcoins solo una bonificación de la puntuación de compra sobre su propia tendencia.`]],
    cta: 'Ver la puntuación de compra de 1000 monedas, la Brújula del ciclo y el piloto automático' },
  fr: { rain: 'La pluie, c’est le temps d’acheter.', nav: 'Acheter du Bitcoin maintenant ?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `Faut-il acheter du Bitcoin maintenant ? Score d’achat ${v}/100 (« ${l} ») – ${d}`,
    desc: (v, l, p) => `Le score d’achat anticyclique du Bitcoin aujourd’hui : ${v}/100 (« ${l} »). Bitcoin à ${p}. Basé sur le Mayer Multiple, la moyenne sur 2 ans, le Pi Cycle, la distance au record et le Fear & Greed – avec ce qui a suivi un an plus tard. Pas un conseil en investissement.`,
    h1: (v, l) => `Faut-il acheter du Bitcoin maintenant ? Score d’achat du jour : ${v}/100 – ${l}`,
    intro: 'Personne ne trouve le creux à coup sûr. Ce que les données peuvent dire : si le Bitcoin est bon marché ou cher dans son cycle. Le score d’achat de Coinweather est anticyclique : il monte quand le Bitcoin est loin sous ses moyennes longues et son record et que la peur domine – et il baisse quand tout le monde est avide. La pluie, c’est le temps d’acheter.',
    inputsH: 'Ce que contient le score d’achat aujourd’hui', cheap: 'bon marché', neutral: 'neutre', dear: 'cher', bar: 'Plus la barre est longue, plus c’est bon marché. Les cinq comptent autant.',
    histH: 'Ce qui s’est passé un an après des niveaux comme aujourd’hui (depuis 2022)', higher: 'plus haut un an plus tard', median: 'résultat médian',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Altcoin typique',
    caveat: 'Sur 90 jours, aucun avantage – après des niveaux bon marché, le cours a souvent d’abord continué de baisser. Le score d’achat sert aux achats par étapes sur 12 mois et plus, pas à trouver le bon moment. Depuis 2022, il n’y a eu qu’un cycle : une tendance, pas une promesse.',
    stats: { score: 'Score d’achat', price: 'Bitcoin', ath: 'sous le record', fng: 'Fear & Greed' },
    faq: [['Est-ce le bon moment pour acheter du Bitcoin ?', (v, l, up) => `Le score d’achat de Coinweather est aujourd’hui de ${v}/100 (« ${l} »). Depuis 2022, après de tels niveaux, le Bitcoin était plus haut un an plus tard dans ${up} % des cas. À court terme, le cours peut encore baisser.`],
      ['Comment le score d’achat est-il calculé ?', () => 'Il fait la moyenne de cinq composantes de cycle connues – Mayer Multiple, moyenne sur 2 ans, Pi Cycle, distance au record et Fear & Greed sur 30 jours – en un nombre de 0 (surchauffe) à 100 (bon marché).'],
      ['Est-ce valable pour les altcoins ?', (v, l, up, alt) => `Moins. Depuis 2022, l’altcoin typique n’était plus haut un an après des niveaux comparables que dans ${alt} % des cas. C’est pourquoi Coinweather n’accorde aux altcoins qu’un bonus du score d’achat en plus de leur propre tendance.`]],
    cta: 'Voir le score d’achat de 1000 cryptos, la Boussole du cycle et le pilote automatique' },
  it: { rain: 'La pioggia è tempo di acquisto.', nav: 'Comprare Bitcoin ora?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `Devo comprare Bitcoin ora? Punteggio di acquisto ${v}/100 («${l}») – ${d}`,
    desc: (v, l, p) => `Il punteggio di acquisto anticiclico di Bitcoin oggi: ${v}/100 («${l}»). Bitcoin a ${p}. Basato su Mayer Multiple, media a 2 anni, Pi Cycle, distanza dal massimo e Fear & Greed – con ciò che è seguito un anno dopo. Non è una consulenza finanziaria.`,
    h1: (v, l) => `Devo comprare Bitcoin ora? Punteggio di acquisto oggi: ${v}/100 – ${l}`,
    intro: 'Nessuno becca il fondo con certezza. Quello che i dati possono dire è se Bitcoin è conveniente o caro nel suo ciclo. Il punteggio di acquisto di Coinweather è anticiclico: sale quando Bitcoin è molto sotto le sue medie lunghe e il massimo e domina la paura – e scende quando tutti sono avidi. La pioggia è tempo di acquisto.',
    inputsH: 'Cosa c’è oggi nel punteggio di acquisto', cheap: 'conveniente', neutral: 'neutro', dear: 'caro', bar: 'Più lunga è la barra, più è conveniente. Tutti e cinque contano allo stesso modo.',
    histH: 'Cosa è successo un anno dopo livelli come oggi (dal 2022)', higher: 'più alto un anno dopo', median: 'risultato mediano',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Altcoin tipico',
    caveat: 'Su 90 giorni nessun vantaggio – dopo livelli convenienti il prezzo spesso è prima sceso ancora. Il punteggio di acquisto serve per acquisti a rate su 12 mesi e oltre, non per azzeccare il momento. Dal 2022 c’è stato un solo ciclo: una tendenza, non una promessa.',
    stats: { score: 'Punteggio di acquisto', price: 'Bitcoin', ath: 'sotto il massimo storico', fng: 'Fear & Greed' },
    faq: [['È un buon momento per comprare Bitcoin?', (v, l, up) => `Il punteggio di acquisto di Coinweather oggi è ${v}/100 («${l}»). Dal 2022, dopo livelli simili, Bitcoin era più alto un anno dopo nel ${up} % dei casi. Nel breve periodo il prezzo può comunque scendere.`],
      ['Come si calcola il punteggio di acquisto?', () => 'Fa la media di cinque componenti di ciclo note – Mayer Multiple, media a 2 anni, Pi Cycle, distanza dal massimo storico e Fear & Greed a 30 giorni – in un numero da 0 (surriscaldato) a 100 (conveniente).'],
      ['Vale anche per gli altcoin?', (v, l, up, alt) => `Meno. Dal 2022 l’altcoin tipico era più alto un anno dopo livelli comparabili solo nel ${alt} % dei casi. Per questo Coinweather dà agli altcoin solo un bonus dal punteggio di acquisto sul loro trend.`]],
    cta: 'Vedi il punteggio di acquisto di 1000 coin, la Bussola del ciclo e il pilota automatico' },
  pt: { rain: 'Chuva é tempo de compra.', nav: 'Comprar Bitcoin agora?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `Devo comprar Bitcoin agora? Pontuação de compra ${v}/100 (“${l}”) – ${d}`,
    desc: (v, l, p) => `A pontuação de compra anticíclica do Bitcoin hoje: ${v}/100 (“${l}”). Bitcoin a ${p}. Baseada no Mayer Multiple, média de 2 anos, Pi Cycle, distância da máxima e Fear & Greed – com o que veio um ano depois. Não é recomendação de investimento.`,
    h1: (v, l) => `Devo comprar Bitcoin agora? Pontuação de compra hoje: ${v}/100 – ${l}`,
    intro: 'Ninguém acerta o fundo com certeza. O que os dados podem dizer é se o Bitcoin está barato ou caro no seu ciclo. A pontuação de compra do Coinweather é anticíclica: sobe quando o Bitcoin está bem abaixo das médias longas e da máxima e o medo domina – e cai quando todos estão gananciosos. Chuva é tempo de compra.',
    inputsH: 'O que compõe hoje a pontuação de compra', cheap: 'barato', neutral: 'neutro', dear: 'caro', bar: 'Quanto mais longa a barra, mais barato. Os cinco contam igualmente.',
    histH: 'O que aconteceu um ano depois de níveis como hoje (desde 2022)', higher: 'mais alto um ano depois', median: 'resultado mediano',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Altcoin típica',
    caveat: 'Em 90 dias não houve vantagem – após níveis baratos o preço muitas vezes caiu mais primeiro. A pontuação de compra serve para compras em parcelas por 12 meses ou mais, não para acertar o momento. Desde 2022 houve só um ciclo: uma tendência, não uma promessa.',
    stats: { score: 'Pontuação de compra', price: 'Bitcoin', ath: 'abaixo da máxima histórica', fng: 'Fear & Greed' },
    faq: [['É um bom momento para comprar Bitcoin?', (v, l, up) => `A pontuação de compra do Coinweather está hoje em ${v}/100 (“${l}”). Desde 2022, depois de níveis assim, o Bitcoin estava mais alto um ano depois em ${up} % dos casos. No curto prazo o preço ainda pode cair.`],
      ['Como a pontuação de compra é calculada?', () => 'Ela faz a média de cinco componentes de ciclo conhecidos – Mayer Multiple, média de 2 anos, Pi Cycle, distância da máxima histórica e Fear & Greed de 30 dias – em um número de 0 (superaquecido) a 100 (barato).'],
      ['Vale também para altcoins?', (v, l, up, alt) => `Menos. Desde 2022 a altcoin típica estava mais alta um ano após níveis comparáveis só em ${alt} % dos casos. Por isso o Coinweather dá às altcoins só um bônus da pontuação de compra sobre a própria tendência.`]],
    cta: 'Ver a pontuação de compra de 1000 moedas, a Bússola do ciclo e o piloto automático' },
  tr: { rain: 'Yağmur alım havasıdır.', nav: 'Şimdi Bitcoin alınır mı?', path: '/should-i-buy-bitcoin-now/',
    title: (v, l, d) => `Şimdi Bitcoin almalı mıyım? Alım skoru ${v}/100 (“${l}”) – ${d}`,
    desc: (v, l, p) => `Bugünün döngüye karşı Bitcoin alım skoru: ${v}/100 (“${l}”). Bitcoin ${p}. Mayer Multiple, 2 yıllık ortalama, Pi Cycle, zirveye uzaklık ve Korku ve Açgözlülük’ten oluşur – bir yıl sonra ne olduğuyla birlikte. Yatırım tavsiyesi değildir.`,
    h1: (v, l) => `Şimdi Bitcoin almalı mıyım? Bugünkü alım skoru: ${v}/100 – ${l}`,
    intro: 'Dibi kimse kesin yakalayamaz. Verilerin söyleyebileceği şey, Bitcoin’in döngüsünde ucuz mu pahalı mı olduğudur. Coinweather alım skoru döngüye karşıdır: Bitcoin uzun ortalamalarının ve zirvesinin çok altındayken ve korku hâkimken yükselir – herkes açgözlüyken düşer. Yağmur alım havasıdır.',
    inputsH: 'Bugün alım skorunda neler var', cheap: 'ucuz', neutral: 'nötr', dear: 'pahalı', bar: 'Çubuk ne kadar uzunsa o kadar ucuz. Beşi de eşit sayılır.',
    histH: 'Bugünkü gibi seviyelerden bir yıl sonra ne oldu (2022’den beri)', higher: 'bir yıl sonra daha yüksek', median: 'ortanca sonuç',
    btc: 'Bitcoin', eth: 'Ethereum', alt: 'Tipik altcoin',
    caveat: '90 günlük vadede avantaj yoktu – ucuz seviyelerden sonra fiyat çoğu zaman önce düşmeye devam etti. Alım skoru 12 ay ve üzeri kademeli alımlar içindir, doğru anı yakalamak için değil. 2022’den beri yalnızca bir döngü oldu: bir eğilim, vaat değil.',
    stats: { score: 'Alım skoru', price: 'Bitcoin', ath: 'zirvenin altında', fng: 'Korku ve Açgözlülük' },
    faq: [['Şimdi Bitcoin almak için iyi bir zaman mı?', (v, l, up) => `Coinweather alım skoru bugün ${v}/100 (“${l}”). 2022’den beri bu tür seviyelerden sonra Bitcoin bir yıl sonra vakaların % ${up} kadarında daha yüksekti. Kısa vadede fiyat yine de düşebilir.`],
      ['Alım skoru nasıl hesaplanır?', () => 'Bilinen beş döngü bileşeninin – Mayer Multiple, 2 yıllık ortalama, Pi Cycle, tüm zamanların zirvesine uzaklık ve 30 günlük Korku ve Açgözlülük – ortalamasını 0 (aşırı ısınmış) ile 100 (ucuz) arasında tek bir sayıya çevirir.'],
      ['Altcoinler için de geçerli mi?', (v, l, up, alt) => `Daha az. 2022’den beri tipik altcoin benzer seviyelerden bir yıl sonra vakaların yalnızca % ${alt} kadarında daha yüksekti. Bu yüzden Coinweather altcoinlere kendi trendlerinin üzerine alım skorundan yalnızca bir bonus verir.`]],
    cta: '1000 coinin alım skorunu, Döngü Pusulası’nı ve otomatik pilotu gör' },
};

// „Should I buy Ethereum now?“ – Ethereum folgt zu 80 % dem Kauf-Score des Markts, zu 20 % seinem Trend (wie in der App)
const BE = {
  en: { nav: 'Should I buy Ethereum now?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `Should I buy Ethereum now? Ethereum buy score ${v}/100 (${l}) – ${d}`,
    desc: (v, l, p, m) => `Ethereum’s buy score today: ${v}/100 (${l}). Ethereum at ${p}. 80 % from the Cycle Compass (market buy score ${m}/100), 20 % from Ethereum’s own trend – with what followed one year later. Not financial advice.`,
    h1: (v, l) => `Should I buy Ethereum now? Buy score today: ${v}/100 – ${l}`,
    intro: (m, ml) => `Ethereum moves in Bitcoin’s cycle. That is why Coinweather’s Ethereum buy score is 80 % the market buy score from the Cycle Compass – today ${m}/100 (“${ml}”) – and 20 % Ethereum’s own trend over the past weeks. It rises when the cycle is cheap and the market is scared. Rain is buying weather.`,
    score: 'Ethereum buy score', market: 'Market buy score', price: 'Ethereum', ath: 'below the all-time high',
    faq: [['Is now a good time to buy Ethereum?', (v, l, up) => `Coinweather’s Ethereum buy score is ${v}/100 today (${l}). Since 2022, after comparable market readings, Ethereum was higher one year later in ${up} % of cases. In the short term the price can still fall further.`],
      ['Why does Ethereum follow the Bitcoin cycle?', () => 'Since 2022 Ethereum rose and fell in the same cycle as Bitcoin – with bigger swings and, overall, weaker than Bitcoin. That is why the cycle components (Mayer Multiple, 2-year average, Pi Cycle, distance to the high, Fear & Greed) are calculated on Bitcoin and also count for Ethereum.']] },
  de: { nav: 'Soll ich jetzt Ethereum kaufen?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `Soll ich jetzt Ethereum kaufen? Ethereum-Kauf-Score ${v}/100 („${l}“) – ${d}`,
    desc: (v, l, p, m) => `Der Kauf-Score von Ethereum heute: ${v}/100 („${l}“). Ethereum bei ${p}. Zu 80 % aus dem Zyklus-Kompass (Kauf-Score des Markts ${m}/100), zu 20 % aus dem eigenen Trend – mit dem, was ein Jahr später folgte. Keine Anlageberatung.`,
    h1: (v, l) => `Soll ich jetzt Ethereum kaufen? Kauf-Score heute: ${v}/100 – ${l}`,
    intro: (m, ml) => `Ethereum bewegt sich im Zyklus von Bitcoin. Deshalb besteht der Kauf-Score von Ethereum bei Coinweather zu 80 % aus dem Kauf-Score des Markts aus dem Zyklus-Kompass – heute ${m}/100 („${ml}“) – und zu 20 % aus dem eigenen Trend der letzten Wochen. Er steigt, wenn der Zyklus günstig ist und Angst herrscht. Regen ist Kaufwetter.`,
    score: 'Kauf-Score Ethereum', market: 'Kauf-Score des Markts', price: 'Ethereum', ath: 'unter dem Allzeithoch',
    faq: [['Ist jetzt ein guter Zeitpunkt, Ethereum zu kaufen?', (v, l, up) => `Der Kauf-Score von Ethereum steht heute bei ${v}/100 („${l}“). Seit 2022 stand Ethereum nach vergleichbaren Marktständen ein Jahr später in ${up} % der Fälle höher. Kurzfristig kann der Kurs trotzdem weiter fallen.`],
      ['Warum folgt Ethereum dem Bitcoin-Zyklus?', () => 'Seit 2022 stieg und fiel Ethereum im selben Zyklus wie Bitcoin – mit größeren Schwankungen und insgesamt schwächer als Bitcoin. Deshalb werden die Zyklus-Bausteine (Mayer-Multiple, 2-Jahres-Schnitt, Pi-Cycle, Abstand zum Hoch, Fear & Greed) an Bitcoin gerechnet und gelten auch für Ethereum.']] },
  es: { nav: '¿Comprar Ethereum ahora?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `¿Debo comprar Ethereum ahora? Puntuación de compra de Ethereum ${v}/100 («${l}») – ${d}`,
    desc: (v, l, p, m) => `La puntuación de compra de Ethereum hoy: ${v}/100 («${l}»). Ethereum a ${p}. Un 80 % de la Brújula del ciclo (puntuación de compra del mercado ${m}/100) y un 20 % de su propia tendencia, con lo que pasó un año después. No es asesoramiento financiero.`,
    h1: (v, l) => `¿Debo comprar Ethereum ahora? Puntuación de compra hoy: ${v}/100 – ${l}`,
    intro: (m, ml) => `Ethereum se mueve en el ciclo de Bitcoin. Por eso la puntuación de compra de Ethereum en Coinweather es en un 80 % la puntuación de compra del mercado de la Brújula del ciclo – hoy ${m}/100 («${ml}») – y en un 20 % su propia tendencia de las últimas semanas. Sube cuando el ciclo está barato y domina el miedo. La lluvia es tiempo de compra.`,
    score: 'Puntuación de Ethereum', market: 'Puntuación del mercado', price: 'Ethereum', ath: 'por debajo del máximo histórico',
    faq: [['¿Es buen momento para comprar Ethereum?', (v, l, up) => `La puntuación de compra de Ethereum está hoy en ${v}/100 («${l}»). Desde 2022, tras niveles de mercado comparables, Ethereum estaba más alto un año después en el ${up} % de los casos. A corto plazo el precio puede seguir cayendo.`],
      ['¿Por qué Ethereum sigue el ciclo de Bitcoin?', () => 'Desde 2022 Ethereum subió y bajó en el mismo ciclo que Bitcoin, con oscilaciones mayores y, en conjunto, más débil que Bitcoin. Por eso los componentes del ciclo (múltiplo de Mayer, media de 2 años, Pi Cycle, distancia al máximo, Fear & Greed) se calculan con Bitcoin y valen también para Ethereum.']] },
  fr: { nav: 'Acheter de l’Ethereum maintenant ?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `Faut-il acheter de l’Ethereum maintenant ? Score d’achat Ethereum ${v}/100 (« ${l} ») – ${d}`,
    desc: (v, l, p, m) => `Le score d’achat de l’Ethereum aujourd’hui : ${v}/100 (« ${l} »). Ethereum à ${p}. À 80 % issu de la Boussole du cycle (score d’achat du marché ${m}/100), à 20 % de sa propre tendance – avec ce qui a suivi un an plus tard. Pas un conseil en investissement.`,
    h1: (v, l) => `Faut-il acheter de l’Ethereum maintenant ? Score d’achat du jour : ${v}/100 – ${l}`,
    intro: (m, ml) => `L’Ethereum évolue dans le cycle du Bitcoin. C’est pourquoi le score d’achat de l’Ethereum chez Coinweather provient à 80 % du score d’achat du marché de la Boussole du cycle – aujourd’hui ${m}/100 (« ${ml} ») – et à 20 % de sa propre tendance des dernières semaines. Il monte quand le cycle est bon marché et que la peur domine. La pluie, c’est le temps d’acheter.`,
    score: 'Score d’achat Ethereum', market: 'Score d’achat du marché', price: 'Ethereum', ath: 'sous le record',
    faq: [['Est-ce le bon moment pour acheter de l’Ethereum ?', (v, l, up) => `Le score d’achat de l’Ethereum est aujourd’hui de ${v}/100 (« ${l} »). Depuis 2022, après des niveaux de marché comparables, l’Ethereum était plus haut un an plus tard dans ${up} % des cas. À court terme, le cours peut encore baisser.`],
      ['Pourquoi l’Ethereum suit-il le cycle du Bitcoin ?', () => 'Depuis 2022, l’Ethereum a monté et baissé dans le même cycle que le Bitcoin – avec des écarts plus forts et, au total, moins bien que le Bitcoin. Les composantes du cycle (Mayer Multiple, moyenne sur 2 ans, Pi Cycle, distance au record, Fear & Greed) sont donc calculées sur le Bitcoin et valent aussi pour l’Ethereum.']] },
  it: { nav: 'Comprare Ethereum ora?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `Devo comprare Ethereum ora? Punteggio di acquisto Ethereum ${v}/100 («${l}») – ${d}`,
    desc: (v, l, p, m) => `Il punteggio di acquisto di Ethereum oggi: ${v}/100 («${l}»). Ethereum a ${p}. All’80 % dalla Bussola del ciclo (punteggio di acquisto del mercato ${m}/100), al 20 % dal proprio trend – con ciò che è seguito un anno dopo. Non è una consulenza finanziaria.`,
    h1: (v, l) => `Devo comprare Ethereum ora? Punteggio di acquisto oggi: ${v}/100 – ${l}`,
    intro: (m, ml) => `Ethereum si muove nel ciclo di Bitcoin. Per questo il punteggio di acquisto di Ethereum su Coinweather è all’80 % il punteggio di acquisto del mercato dalla Bussola del ciclo – oggi ${m}/100 («${ml}») – e al 20 % il suo trend delle ultime settimane. Sale quando il ciclo è conveniente e domina la paura. La pioggia è tempo di acquisto.`,
    score: 'Punteggio Ethereum', market: 'Punteggio del mercato', price: 'Ethereum', ath: 'sotto il massimo storico',
    faq: [['È un buon momento per comprare Ethereum?', (v, l, up) => `Il punteggio di acquisto di Ethereum oggi è ${v}/100 («${l}»). Dal 2022, dopo livelli di mercato simili, Ethereum era più alto un anno dopo nel ${up} % dei casi. Nel breve periodo il prezzo può comunque scendere.`],
      ['Perché Ethereum segue il ciclo di Bitcoin?', () => 'Dal 2022 Ethereum è salito e sceso nello stesso ciclo di Bitcoin – con oscillazioni maggiori e, nel complesso, più debole di Bitcoin. Per questo le componenti del ciclo (Mayer Multiple, media a 2 anni, Pi Cycle, distanza dal massimo, Fear & Greed) sono calcolate su Bitcoin e valgono anche per Ethereum.']] },
  pt: { nav: 'Comprar Ethereum agora?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `Devo comprar Ethereum agora? Pontuação de compra do Ethereum ${v}/100 (“${l}”) – ${d}`,
    desc: (v, l, p, m) => `A pontuação de compra do Ethereum hoje: ${v}/100 (“${l}”). Ethereum a ${p}. 80 % da Bússola do ciclo (pontuação de compra do mercado ${m}/100), 20 % da própria tendência – com o que veio um ano depois. Não é recomendação de investimento.`,
    h1: (v, l) => `Devo comprar Ethereum agora? Pontuação de compra hoje: ${v}/100 – ${l}`,
    intro: (m, ml) => `O Ethereum se move no ciclo do Bitcoin. Por isso a pontuação de compra do Ethereum no Coinweather é 80 % a pontuação de compra do mercado da Bússola do ciclo – hoje ${m}/100 (“${ml}”) – e 20 % a própria tendência das últimas semanas. Ela sobe quando o ciclo está barato e o medo domina. Chuva é tempo de compra.`,
    score: 'Pontuação do Ethereum', market: 'Pontuação do mercado', price: 'Ethereum', ath: 'abaixo da máxima histórica',
    faq: [['É um bom momento para comprar Ethereum?', (v, l, up) => `A pontuação de compra do Ethereum está hoje em ${v}/100 (“${l}”). Desde 2022, depois de níveis de mercado comparáveis, o Ethereum estava mais alto um ano depois em ${up} % dos casos. No curto prazo o preço ainda pode cair.`],
      ['Por que o Ethereum segue o ciclo do Bitcoin?', () => 'Desde 2022 o Ethereum subiu e caiu no mesmo ciclo do Bitcoin – com oscilações maiores e, no geral, mais fraco que o Bitcoin. Por isso os componentes do ciclo (Mayer Multiple, média de 2 anos, Pi Cycle, distância da máxima, Fear & Greed) são calculados com o Bitcoin e valem também para o Ethereum.']] },
  tr: { nav: 'Şimdi Ethereum alınır mı?', path: '/should-i-buy-ethereum-now/',
    title: (v, l, d) => `Şimdi Ethereum almalı mıyım? Ethereum alım skoru ${v}/100 (“${l}”) – ${d}`,
    desc: (v, l, p, m) => `Ethereum’un bugünkü alım skoru: ${v}/100 (“${l}”). Ethereum ${p}. %80 Döngü Pusulası’ndan (piyasa alım skoru ${m}/100), %20 kendi trendinden – bir yıl sonra ne olduğuyla birlikte. Yatırım tavsiyesi değildir.`,
    h1: (v, l) => `Şimdi Ethereum almalı mıyım? Bugünkü alım skoru: ${v}/100 – ${l}`,
    intro: (m, ml) => `Ethereum, Bitcoin’in döngüsü içinde hareket eder. Bu yüzden Coinweather’da Ethereum alım skorunun %80’i Döngü Pusulası’ndaki piyasa alım skorundan – bugün ${m}/100 (“${ml}”) – %20’si ise son haftalardaki kendi trendinden gelir. Döngü ucuzken ve korku hâkimken yükselir. Yağmur alım havasıdır.`,
    score: 'Ethereum alım skoru', market: 'Piyasa alım skoru', price: 'Ethereum', ath: 'zirvenin altında',
    faq: [['Şimdi Ethereum almak için iyi bir zaman mı?', (v, l, up) => `Ethereum alım skoru bugün ${v}/100 (“${l}”). 2022’den beri benzer piyasa seviyelerinden sonra Ethereum bir yıl sonra vakaların % ${up} kadarında daha yüksekti. Kısa vadede fiyat yine de düşebilir.`],
      ['Ethereum neden Bitcoin döngüsünü izler?', () => '2022’den beri Ethereum, Bitcoin ile aynı döngüde yükselip düştü – daha büyük dalgalanmalarla ve genel olarak Bitcoin’den daha zayıf. Bu yüzden döngü bileşenleri (Mayer Multiple, 2 yıllık ortalama, Pi Cycle, zirveye uzaklık, Korku ve Açgözlülük) Bitcoin üzerinden hesaplanır ve Ethereum için de geçerlidir.']] },
};

// „Best crypto to buy now“ – die stärksten Kauf-Scores des Tages (hohe Suchnachfrage), und der Autopilot als eigene Seite
const BB = {
  en: { nav: 'Best crypto to buy now', path: '/best-crypto-to-buy-now/',
    title: (d) => `Best crypto to buy now (${d}): top 10 by buy score`,
    desc: (n, list) => `Today’s 10 coins with the highest Coinweather buy score among the top 300 with enough trading volume: ${list}. Market buy score ${n}/100. Updated daily, not financial advice.`,
    h1: 'Best crypto to buy now – today’s top 10 by buy score',
    intro: (v, l) => `The ranking uses Coinweather’s buy score from 0 to 100: for Bitcoin and Ethereum mainly the Cycle Compass, for altcoins their own trend plus a cycle bonus. Riskier coins are marked down. Today the whole market stands at ${v}/100 (“${l}”).`,
    rank: '#', coin: 'Coin', score: 'Buy score', d7: '7 days', risk: 'Risk',
    note: 'A high buy score is not a promise. Since 2022 a typical altcoin was higher one year later in fewer than half of the cases, even after good readings – Bitcoin and Ethereum did clearly better. Spread your purchases and only use money you can afford to lose.',
    cta: 'Buy score, outlook and look-back for all 1,000 coins – and an autopilot that tells you what to buy', btn: 'Start free',
    faq: [['What is the best crypto to buy right now?', (top) => `By Coinweather’s buy score, today’s strongest coins are ${top}. The score changes daily; it describes the past and current trend, not a guaranteed future.`],
      ['Should I buy Bitcoin or altcoins?', () => 'Since 2022 Bitcoin and Ethereum were much more often higher one year after cheap cycle readings than the typical altcoin. That is why Coinweather’s autopilot keeps most of the money in the largest coins and only adds altcoins with strong buy scores.']] },
  de: { nav: 'Beste Kryptowährung zum Kaufen', path: '/best-crypto-to-buy-now/',
    title: (d) => `Welche Kryptowährung jetzt kaufen? (${d}): Top 10 nach Kauf-Score`,
    desc: (n, list) => `Die 10 Coins mit dem höchsten Kauf-Score von Coinweather unter den Top 300 mit genug Handelsvolumen: ${list}. Kauf-Score des Markts ${n}/100. Täglich aktuell, keine Anlageberatung.`,
    h1: 'Welche Kryptowährung jetzt kaufen? Die Top 10 nach Kauf-Score',
    intro: (v, l) => `Die Rangliste nutzt den Kauf-Score von Coinweather von 0 bis 100: bei Bitcoin und Ethereum vor allem den Zyklus-Kompass, bei Altcoins ihren eigenen Trend plus einen Zyklus-Bonus. Riskantere Coins werden abgewertet. Der ganze Markt steht heute bei ${v}/100 („${l}“).`,
    rank: '#', coin: 'Coin', score: 'Kauf-Score', d7: '7 Tage', risk: 'Risiko',
    note: 'Ein hoher Kauf-Score ist kein Versprechen. Seit 2022 stand der typische Altcoin ein Jahr später in weniger als der Hälfte der Fälle höher, auch nach guten Ständen – Bitcoin und Ethereum schnitten klar besser ab. Kauf in Raten und setz nur Geld ein, dessen Verlust du verkraften kannst.',
    cta: 'Kauf-Score, Aussicht und Rückblick für alle 1000 Coins – und ein Autopilot, der dir sagt, was du kaufst', btn: 'Kostenlos starten',
    faq: [['Welche Kryptowährung sollte ich jetzt kaufen?', (top) => `Nach dem Kauf-Score von Coinweather sind heute die stärksten Coins ${top}. Der Score ändert sich täglich; er beschreibt Vergangenheit und aktuellen Trend, keine sichere Zukunft.`],
      ['Bitcoin oder Altcoins kaufen?', () => 'Seit 2022 standen Bitcoin und Ethereum ein Jahr nach günstigen Zyklus-Ständen deutlich öfter höher als der typische Altcoin. Deshalb hält der Autopilot von Coinweather den Großteil in den größten Coins und nimmt Altcoins nur mit starkem Kauf-Score dazu.']] },
  es: { nav: 'Mejor cripto para comprar', path: '/best-crypto-to-buy-now/',
    title: (d) => `¿Qué criptomoneda comprar ahora? (${d}): top 10 por puntuación de compra`,
    desc: (n, list) => `Las 10 monedas con la mayor puntuación de compra de Coinweather entre las 300 mayores con volumen suficiente: ${list}. Puntuación del mercado ${n}/100. Actualizado a diario, no es asesoramiento financiero.`,
    h1: '¿Qué criptomoneda comprar ahora? El top 10 por puntuación de compra',
    intro: (v, l) => `La clasificación usa la puntuación de compra de Coinweather de 0 a 100: para Bitcoin y Ethereum sobre todo la Brújula del ciclo, para las altcoins su propia tendencia más una bonificación de ciclo. Las monedas más arriesgadas se penalizan. Hoy el mercado está en ${v}/100 («${l}»).`,
    rank: '#', coin: 'Moneda', score: 'Puntuación', d7: '7 días', risk: 'Riesgo',
    note: 'Una puntuación alta no es una promesa. Desde 2022 la altcoin típica estaba más alta un año después en menos de la mitad de los casos, incluso tras buenos niveles; Bitcoin y Ethereum lo hicieron claramente mejor. Compra por partes y usa solo dinero que puedas permitirte perder.',
    cta: 'Puntuación, previsión y retrospectiva de las 1000 monedas, y un piloto automático que te dice qué comprar', btn: 'Empezar gratis',
    faq: [['¿Qué criptomoneda comprar ahora mismo?', (top) => `Según la puntuación de compra de Coinweather, las monedas más fuertes hoy son ${top}. La puntuación cambia a diario; describe el pasado y la tendencia actual, no un futuro seguro.`],
      ['¿Comprar Bitcoin o altcoins?', () => 'Desde 2022 Bitcoin y Ethereum estaban mucho más a menudo más altos un año después de niveles de ciclo baratos que la altcoin típica. Por eso el piloto automático de Coinweather mantiene la mayor parte en las monedas más grandes y solo añade altcoins con una puntuación fuerte.']] },
  fr: { nav: 'Meilleure crypto à acheter', path: '/best-crypto-to-buy-now/',
    title: (d) => `Quelle crypto acheter maintenant ? (${d}) : top 10 par score d’achat`,
    desc: (n, list) => `Les 10 cryptos avec le meilleur score d’achat Coinweather parmi les 300 premières avec assez de volume : ${list}. Score du marché ${n}/100. Mis à jour chaque jour, pas un conseil en investissement.`,
    h1: 'Quelle crypto acheter maintenant ? Le top 10 par score d’achat',
    intro: (v, l) => `Le classement utilise le score d’achat Coinweather de 0 à 100 : pour Bitcoin et Ethereum surtout la Boussole du cycle, pour les altcoins leur propre tendance plus un bonus de cycle. Les cryptos plus risquées sont pénalisées. Aujourd’hui le marché est à ${v}/100 (« ${l} »).`,
    rank: '#', coin: 'Crypto', score: 'Score d’achat', d7: '7 jours', risk: 'Risque',
    note: 'Un score élevé n’est pas une promesse. Depuis 2022, l’altcoin typique n’était plus haut un an plus tard que dans moins de la moitié des cas, même après de bons niveaux – Bitcoin et Ethereum ont fait nettement mieux. Achète par étapes et n’investis que de l’argent que tu peux te permettre de perdre.',
    cta: 'Score d’achat, perspective et rétrospective pour les 1000 cryptos – et un pilote automatique qui te dit quoi acheter', btn: 'Commencer gratuitement',
    faq: [['Quelle crypto acheter en ce moment ?', (top) => `Selon le score d’achat Coinweather, les cryptos les plus fortes aujourd’hui sont ${top}. Le score change chaque jour ; il décrit le passé et la tendance actuelle, pas un avenir garanti.`],
      ['Acheter du Bitcoin ou des altcoins ?', () => 'Depuis 2022, Bitcoin et Ethereum étaient bien plus souvent plus hauts un an après des niveaux de cycle bon marché que l’altcoin typique. C’est pourquoi le pilote automatique de Coinweather garde l’essentiel dans les plus grandes cryptos et n’ajoute des altcoins qu’avec un score fort.']] },
  it: { nav: 'Migliore crypto da comprare', path: '/best-crypto-to-buy-now/',
    title: (d) => `Quale criptovaluta comprare ora? (${d}): top 10 per punteggio di acquisto`,
    desc: (n, list) => `I 10 coin con il punteggio di acquisto Coinweather più alto tra i primi 300 con volume sufficiente: ${list}. Punteggio del mercato ${n}/100. Aggiornato ogni giorno, non è una consulenza finanziaria.`,
    h1: 'Quale criptovaluta comprare ora? La top 10 per punteggio di acquisto',
    intro: (v, l) => `La classifica usa il punteggio di acquisto Coinweather da 0 a 100: per Bitcoin ed Ethereum soprattutto la Bussola del ciclo, per gli altcoin il loro trend più un bonus di ciclo. I coin più rischiosi vengono penalizzati. Oggi il mercato è a ${v}/100 («${l}»).`,
    rank: '#', coin: 'Coin', score: 'Punteggio', d7: '7 giorni', risk: 'Rischio',
    note: 'Un punteggio alto non è una promessa. Dal 2022 l’altcoin tipico era più alto un anno dopo in meno della metà dei casi, anche dopo buoni livelli – Bitcoin ed Ethereum sono andati nettamente meglio. Compra a rate e usa solo denaro che puoi permetterti di perdere.',
    cta: 'Punteggio, prospettiva e retrospettiva per tutti i 1000 coin – e un pilota automatico che ti dice cosa comprare', btn: 'Inizia gratis',
    faq: [['Quale criptovaluta comprare adesso?', (top) => `Secondo il punteggio di acquisto Coinweather, i coin più forti oggi sono ${top}. Il punteggio cambia ogni giorno; descrive il passato e il trend attuale, non un futuro sicuro.`],
      ['Comprare Bitcoin o altcoin?', () => 'Dal 2022 Bitcoin ed Ethereum erano molto più spesso più alti un anno dopo livelli di ciclo convenienti rispetto all’altcoin tipico. Per questo il pilota automatico di Coinweather tiene la maggior parte nei coin più grandi e aggiunge altcoin solo con un punteggio forte.']] },
  pt: { nav: 'Melhor cripto para comprar', path: '/best-crypto-to-buy-now/',
    title: (d) => `Qual criptomoeda comprar agora? (${d}): top 10 por pontuação de compra`,
    desc: (n, list) => `As 10 moedas com a maior pontuação de compra do Coinweather entre as 300 maiores com volume suficiente: ${list}. Pontuação do mercado ${n}/100. Atualizado diariamente, não é recomendação de investimento.`,
    h1: 'Qual criptomoeda comprar agora? O top 10 por pontuação de compra',
    intro: (v, l) => `O ranking usa a pontuação de compra do Coinweather de 0 a 100: para Bitcoin e Ethereum sobretudo a Bússola do ciclo, para altcoins a própria tendência mais um bônus de ciclo. Moedas mais arriscadas são penalizadas. Hoje o mercado está em ${v}/100 (“${l}”).`,
    rank: '#', coin: 'Moeda', score: 'Pontuação', d7: '7 dias', risk: 'Risco',
    note: 'Uma pontuação alta não é uma promessa. Desde 2022 a altcoin típica estava mais alta um ano depois em menos da metade dos casos, mesmo após bons níveis – Bitcoin e Ethereum foram claramente melhores. Compre em parcelas e use só dinheiro que você pode perder.',
    cta: 'Pontuação, perspectiva e retrospectiva para as 1000 moedas – e um piloto automático que diz o que comprar', btn: 'Começar grátis',
    faq: [['Qual criptomoeda comprar agora?', (top) => `Pela pontuação de compra do Coinweather, as moedas mais fortes hoje são ${top}. A pontuação muda diariamente; descreve o passado e a tendência atual, não um futuro garantido.`],
      ['Comprar Bitcoin ou altcoins?', () => 'Desde 2022 Bitcoin e Ethereum estavam bem mais vezes mais altos um ano após níveis de ciclo baratos do que a altcoin típica. Por isso o piloto automático do Coinweather mantém a maior parte nas maiores moedas e só adiciona altcoins com pontuação forte.']] },
  tr: { nav: 'Şimdi alınacak en iyi kripto', path: '/best-crypto-to-buy-now/',
    title: (d) => `Şimdi hangi kripto alınır? (${d}): alım skoruna göre ilk 10`,
    desc: (n, list) => `Yeterli işlem hacmine sahip ilk 300 içinde Coinweather alım skoru en yüksek 10 coin: ${list}. Piyasa alım skoru ${n}/100. Her gün güncellenir, yatırım tavsiyesi değildir.`,
    h1: 'Şimdi hangi kripto alınır? Alım skoruna göre ilk 10',
    intro: (v, l) => `Sıralama, Coinweather’ın 0–100 alım skorunu kullanır: Bitcoin ve Ethereum için çoğunlukla Döngü Pusulası, altcoinler için kendi trendleri artı bir döngü bonusu. Daha riskli coinlerin puanı düşürülür. Bugün tüm piyasa ${v}/100 (“${l}”).`,
    rank: '#', coin: 'Coin', score: 'Alım skoru', d7: '7 gün', risk: 'Risk',
    note: 'Yüksek bir alım skoru vaat değildir. 2022’den beri tipik altcoin, iyi seviyelerden sonra bile bir yıl sonra vakaların yarısından azında daha yüksekti – Bitcoin ve Ethereum açıkça daha iyiydi. Kademeli al ve yalnızca kaybetmeyi göze alabileceğin parayı kullan.',
    cta: '1000 coinin hepsi için alım skoru, görünüm ve geriye bakış – ve sana ne alacağını söyleyen bir otomatik pilot', btn: 'Ücretsiz başla',
    faq: [['Şu anda hangi kripto alınmalı?', (top) => `Coinweather alım skoruna göre bugünün en güçlü coinleri: ${top}. Skor her gün değişir; geçmişi ve güncel trendi anlatır, kesin bir geleceği değil.`],
      ['Bitcoin mi altcoin mi almalı?', () => '2022’den beri Bitcoin ve Ethereum, ucuz döngü seviyelerinden bir yıl sonra tipik altcoinden çok daha sık daha yüksekti. Bu yüzden Coinweather otomatik pilotu paranın çoğunu en büyük coinlerde tutar ve altcoinleri yalnızca güçlü alım skoruyla ekler.']] },
};
const AP = {
  en: { live: (d, r, b) => `Live since ${d}: autopilot ${r}, Bitcoin ${b} – with real prices and fees, no backtest.`, nav: 'Crypto portfolio autopilot', path: '/crypto-portfolio-autopilot/',
    title: 'Crypto portfolio autopilot: tells you what to buy – free for 30 days',
    desc: (r, n) => `Enter an amount and Coinweather’s autopilot tells you which coins to buy and how much to keep in reserve. Today: ${n} coins, ${r} % reserve. Checked every week. You trade yourself, no access to your money.`,
    h1: 'The crypto autopilot: you say how much – it says what to buy',
    intro: 'Most people buy crypto when everyone is euphoric and sell in panic. The autopilot does the opposite, with rules instead of gut feeling: more in when the cycle is cheap, more reserve in a bear market, only coins with strong buy scores. Every week it checks the portfolio and shows you the few steps to take.',
    today: (r, n, d) => `Today’s model portfolio (${d}): ${n} coins and ${r} % reserve.`, coin: 'Coin', share: 'Share', reserve: 'Reserve (cash or stablecoins)',
    how: 'How it works', steps: ['Enter a starting amount and an optional monthly savings rate.', 'The autopilot shows exactly what to buy – you do it at your own exchange.', 'Once a week it checks the model. If something changes, you see the steps; otherwise nothing to do.'],
    btH: 'Backtest', bt: (a, b, c, h) => `Balanced strategy since 2018: +${a} % per year, since 2022 +${b} %, largest drawdown −${c} %. Holding Bitcoin: +${h} % per year. Backtest on past prices – the future usually turns out worse.`,
    cta: 'Start the autopilot – 30 days free, no payment details', btn: 'Start free', calc: 'Try it in the calculator',
    faq: [['Does Coinweather have access to my money?', 'No. Coinweather never trades for you and never connects to your exchange. You see the steps and carry them out yourself.'],
      ['How often does the autopilot trade?', 'It checks once a week. Steps only appear when the model changes its holdings or you add money – small deviations are ignored to save fees.'],
      ['Is this financial advice?', 'No. The autopilot follows fixed, published rules tested on past prices. Crypto can fall sharply, up to a total loss.']] },
  de: { live: (d, r, b) => `Live seit ${d}: Autopilot ${r}, Bitcoin ${b} – mit echten Kursen und Gebühren, ohne Rückrechnung.`, nav: 'Krypto-Autopilot', path: '/crypto-portfolio-autopilot/',
    title: 'Krypto-Autopilot fürs Portfolio: sagt dir, was du kaufst – 30 Tage kostenlos',
    desc: (r, n) => `Betrag eingeben – der Autopilot von Coinweather sagt dir, welche Coins du kaufst und wie viel Reserve bleibt. Heute: ${n} Coins, ${r} % Reserve. Jede Woche geprüft. Du handelst selbst, kein Zugriff auf dein Geld.`,
    h1: 'Der Krypto-Autopilot: Du sagst, wie viel – er sagt, was du kaufst',
    intro: 'Die meisten kaufen Krypto, wenn alle euphorisch sind, und verkaufen in Panik. Der Autopilot macht es umgekehrt – mit Regeln statt Bauchgefühl: mehr investiert, wenn der Zyklus günstig ist, mehr Reserve im Bärenmarkt, nur Coins mit starkem Kauf-Score. Jede Woche prüft er das Portfolio und zeigt dir die wenigen Schritte.',
    today: (r, n, d) => `Das Modell-Portfolio heute (${d}): ${n} Coins und ${r} % Reserve.`, coin: 'Coin', share: 'Anteil', reserve: 'Reserve (Bargeld oder Stablecoins)',
    how: 'So funktioniert es', steps: ['Startbetrag und auf Wunsch eine monatliche Sparrate eingeben.', 'Der Autopilot zeigt genau, was du kaufst – du setzt es bei deiner Börse um.', 'Einmal pro Woche prüft er das Modell. Ändert sich etwas, siehst du die Schritte; sonst ist nichts zu tun.'],
    btH: 'Rückrechnung', bt: (a, b, c, h) => `Strategie Ausgewogen seit 2018: +${a} % pro Jahr, seit 2022 +${b} %, größter Rückgang −${c} %. Bitcoin halten: +${h} % pro Jahr. Rückrechnung an vergangenen Kursen – die Zukunft fällt meist schlechter aus.`,
    cta: 'Autopilot starten – 30 Tage kostenlos, ohne Zahlungsdaten', btn: 'Kostenlos starten', calc: 'Im Rechner ausprobieren',
    faq: [['Hat Coinweather Zugriff auf mein Geld?', 'Nein. Coinweather handelt nie für dich und verbindet sich nicht mit deiner Börse. Du siehst die Schritte und führst sie selbst aus.'],
      ['Wie oft handelt der Autopilot?', 'Er prüft einmal pro Woche. Schritte gibt es nur, wenn das Modell seinen Bestand ändert oder du Geld einzahlst – kleine Abweichungen bleiben liegen, das spart Gebühren.'],
      ['Ist das eine Anlageberatung?', 'Nein. Der Autopilot folgt festen, offengelegten Regeln, geprüft an vergangenen Kursen. Krypto kann stark fallen, bis zum Totalverlust.']] },
  es: { live: (d, r, b) => `En vivo desde ${d}: piloto automático ${r}, Bitcoin ${b}, con precios reales y comisiones, sin backtest.`, nav: 'Piloto automático cripto', path: '/crypto-portfolio-autopilot/',
    title: 'Piloto automático para tu cartera cripto: te dice qué comprar – 30 días gratis',
    desc: (r, n) => `Introduce un importe y el piloto automático de Coinweather te dice qué monedas comprar y cuánto dejar en reserva. Hoy: ${n} monedas, ${r} % de reserva. Revisado cada semana. Operas tú, sin acceso a tu dinero.`,
    h1: 'El piloto automático cripto: tú dices cuánto, él dice qué comprar',
    intro: 'La mayoría compra cripto cuando todos están eufóricos y vende con pánico. El piloto automático hace lo contrario, con reglas en lugar de intuición: más invertido cuando el ciclo está barato, más reserva en mercado bajista, solo monedas con puntuación de compra fuerte. Cada semana revisa la cartera y te muestra los pocos pasos a dar.',
    today: (r, n, d) => `La cartera modelo hoy (${d}): ${n} monedas y ${r} % de reserva.`, coin: 'Moneda', share: 'Peso', reserve: 'Reserva (efectivo o stablecoins)',
    how: 'Cómo funciona', steps: ['Introduce un importe inicial y, si quieres, una aportación mensual.', 'El piloto automático muestra exactamente qué comprar; lo haces en tu exchange.', 'Una vez por semana revisa el modelo. Si algo cambia, ves los pasos; si no, no hay nada que hacer.'],
    btH: 'Backtest', bt: (a, b, c, h) => `Estrategia Equilibrada desde 2018: +${a} % al año, desde 2022 +${b} %, mayor caída −${c} %. Mantener Bitcoin: +${h} % al año. Backtest con precios pasados: el futuro suele ser peor.`,
    cta: 'Inicia el piloto automático: 30 días gratis, sin datos de pago', btn: 'Empezar gratis', calc: 'Probar en la calculadora',
    faq: [['¿Tiene Coinweather acceso a mi dinero?', 'No. Coinweather nunca opera por ti ni se conecta a tu exchange. Ves los pasos y los ejecutas tú.'],
      ['¿Con qué frecuencia opera el piloto automático?', 'Revisa una vez por semana. Solo hay pasos cuando el modelo cambia sus posiciones o aportas dinero; las pequeñas desviaciones se ignoran para ahorrar comisiones.'],
      ['¿Es asesoramiento financiero?', 'No. El piloto automático sigue reglas fijas y publicadas, probadas con precios pasados. Las criptos pueden caer con fuerza, hasta la pérdida total.']] },
  fr: { live: (d, r, b) => `En direct depuis le ${d} : pilote automatique ${r}, Bitcoin ${b} – avec de vrais cours et frais, sans backtest.`, nav: 'Pilote automatique crypto', path: '/crypto-portfolio-autopilot/',
    title: 'Pilote automatique pour ton portefeuille crypto : il te dit quoi acheter – 30 jours gratuits',
    desc: (r, n) => `Saisis un montant et le pilote automatique Coinweather te dit quelles cryptos acheter et combien garder en réserve. Aujourd’hui : ${n} cryptos, ${r} % de réserve. Vérifié chaque semaine. Tu négocies toi-même, aucun accès à ton argent.`,
    h1: 'Le pilote automatique crypto : tu dis combien – il dit quoi acheter',
    intro: 'La plupart achètent des cryptos quand tout le monde est euphorique et vendent dans la panique. Le pilote automatique fait l’inverse, avec des règles plutôt que l’instinct : plus investi quand le cycle est bon marché, plus de réserve en marché baissier, seulement des cryptos avec un fort score d’achat. Chaque semaine, il vérifie le portefeuille et te montre les quelques étapes à faire.',
    today: (r, n, d) => `Le portefeuille modèle aujourd’hui (${d}) : ${n} cryptos et ${r} % de réserve.`, coin: 'Crypto', share: 'Part', reserve: 'Réserve (liquidités ou stablecoins)',
    how: 'Comment ça marche', steps: ['Saisis un montant de départ et, si tu veux, un versement mensuel.', 'Le pilote automatique montre exactement quoi acheter – tu le fais sur ta plateforme.', 'Une fois par semaine, il vérifie le modèle. Si quelque chose change, tu vois les étapes ; sinon, rien à faire.'],
    btH: 'Backtest', bt: (a, b, c, h) => `Stratégie Équilibrée depuis 2018 : +${a} % par an, depuis 2022 +${b} %, plus forte baisse −${c} %. Garder du Bitcoin : +${h} % par an. Backtest sur des cours passés – l’avenir est généralement moins bon.`,
    cta: 'Lance le pilote automatique – 30 jours gratuits, sans données de paiement', btn: 'Commencer gratuitement', calc: 'Essayer dans le calculateur',
    faq: [['Coinweather a-t-il accès à mon argent ?', 'Non. Coinweather ne négocie jamais pour toi et ne se connecte pas à ta plateforme. Tu vois les étapes et tu les exécutes toi-même.'],
      ['À quelle fréquence le pilote automatique négocie-t-il ?', 'Il vérifie une fois par semaine. Il n’y a des étapes que si le modèle change ses positions ou si tu ajoutes de l’argent – les petits écarts sont ignorés pour économiser des frais.'],
      ['Est-ce un conseil en investissement ?', 'Non. Le pilote automatique suit des règles fixes et publiées, testées sur des cours passés. Les cryptos peuvent chuter fortement, jusqu’à la perte totale.']] },
  it: { live: (d, r, b) => `Dal vivo dal ${d}: pilota automatico ${r}, Bitcoin ${b} – con prezzi reali e commissioni, senza backtest.`, nav: 'Pilota automatico crypto', path: '/crypto-portfolio-autopilot/',
    title: 'Pilota automatico per il tuo portafoglio crypto: ti dice cosa comprare – 30 giorni gratis',
    desc: (r, n) => `Inserisci un importo e il pilota automatico di Coinweather ti dice quali coin comprare e quanta riserva tenere. Oggi: ${n} coin, ${r} % di riserva. Controllato ogni settimana. Operi tu, nessun accesso al tuo denaro.`,
    h1: 'Il pilota automatico crypto: tu dici quanto – lui dice cosa comprare',
    intro: 'La maggior parte compra crypto quando tutti sono euforici e vende nel panico. Il pilota automatico fa il contrario, con regole invece che d’istinto: più investito quando il ciclo è conveniente, più riserva nel mercato ribassista, solo coin con un forte punteggio di acquisto. Ogni settimana controlla il portafoglio e ti mostra i pochi passi da fare.',
    today: (r, n, d) => `Il portafoglio modello oggi (${d}): ${n} coin e ${r} % di riserva.`, coin: 'Coin', share: 'Quota', reserve: 'Riserva (contanti o stablecoin)',
    how: 'Come funziona', steps: ['Inserisci un importo iniziale e, se vuoi, una rata mensile.', 'Il pilota automatico mostra esattamente cosa comprare – lo fai sul tuo exchange.', 'Una volta a settimana controlla il modello. Se cambia qualcosa vedi i passi; altrimenti niente da fare.'],
    btH: 'Backtest', bt: (a, b, c, h) => `Strategia Bilanciata dal 2018: +${a} % all’anno, dal 2022 +${b} %, calo massimo −${c} %. Tenere Bitcoin: +${h} % all’anno. Backtest su prezzi passati – il futuro di solito va peggio.`,
    cta: 'Avvia il pilota automatico – 30 giorni gratis, senza dati di pagamento', btn: 'Inizia gratis', calc: 'Prova nel calcolatore',
    faq: [['Coinweather ha accesso al mio denaro?', 'No. Coinweather non opera mai per te e non si collega al tuo exchange. Vedi i passi e li esegui tu.'],
      ['Quanto spesso opera il pilota automatico?', 'Controlla una volta a settimana. I passi compaiono solo quando il modello cambia le sue posizioni o versi denaro – le piccole differenze vengono ignorate per risparmiare commissioni.'],
      ['È una consulenza finanziaria?', 'No. Il pilota automatico segue regole fisse e pubbliche, testate su prezzi passati. Le crypto possono crollare, fino alla perdita totale.']] },
  pt: { live: (d, r, b) => `Ao vivo desde ${d}: piloto automático ${r}, Bitcoin ${b} – com preços reais e taxas, sem backtest.`, nav: 'Piloto automático cripto', path: '/crypto-portfolio-autopilot/',
    title: 'Piloto automático para sua carteira cripto: diz o que comprar – 30 dias grátis',
    desc: (r, n) => `Informe um valor e o piloto automático do Coinweather diz quais moedas comprar e quanto manter em reserva. Hoje: ${n} moedas, ${r} % de reserva. Verificado toda semana. Você negocia, sem acesso ao seu dinheiro.`,
    h1: 'O piloto automático cripto: você diz quanto – ele diz o que comprar',
    intro: 'A maioria compra cripto quando todos estão eufóricos e vende em pânico. O piloto automático faz o contrário, com regras em vez de intuição: mais investido quando o ciclo está barato, mais reserva em mercado de baixa, só moedas com pontuação de compra forte. Toda semana ele verifica a carteira e mostra os poucos passos a dar.',
    today: (r, n, d) => `A carteira modelo hoje (${d}): ${n} moedas e ${r} % de reserva.`, coin: 'Moeda', share: 'Peso', reserve: 'Reserva (dinheiro ou stablecoins)',
    how: 'Como funciona', steps: ['Informe um valor inicial e, se quiser, um aporte mensal.', 'O piloto automático mostra exatamente o que comprar – você faz isso na sua corretora.', 'Uma vez por semana ele verifica o modelo. Se algo mudar, você vê os passos; senão, nada a fazer.'],
    btH: 'Backtest', bt: (a, b, c, h) => `Estratégia Equilibrada desde 2018: +${a} % ao ano, desde 2022 +${b} %, maior queda −${c} %. Manter Bitcoin: +${h} % ao ano. Backtest com preços passados – o futuro costuma ser pior.`,
    cta: 'Inicie o piloto automático – 30 dias grátis, sem dados de pagamento', btn: 'Começar grátis', calc: 'Testar na calculadora',
    faq: [['O Coinweather tem acesso ao meu dinheiro?', 'Não. O Coinweather nunca negocia por você e não se conecta à sua corretora. Você vê os passos e os executa.'],
      ['Com que frequência o piloto automático negocia?', 'Ele verifica uma vez por semana. Só há passos quando o modelo muda suas posições ou você deposita dinheiro – pequenos desvios são ignorados para economizar taxas.'],
      ['Isso é recomendação de investimento?', 'Não. O piloto automático segue regras fixas e públicas, testadas com preços passados. Cripto pode cair muito, até a perda total.']] },
  tr: { live: (d, r, b) => `${d} tarihinden beri canlı: otomatik pilot ${r}, Bitcoin ${b} – gerçek fiyatlar ve ücretlerle, geriye dönük test olmadan.`, nav: 'Kripto otomatik pilot', path: '/crypto-portfolio-autopilot/',
    title: 'Kripto portföyün için otomatik pilot: ne alacağını söyler – 30 gün ücretsiz',
    desc: (r, n) => `Bir tutar gir; Coinweather otomatik pilotu hangi coinleri alacağını ve ne kadar rezerv tutacağını söyler. Bugün: ${n} coin, % ${r} rezerv. Her hafta kontrol edilir. İşlemi sen yaparsın, paran üzerinde erişim yok.`,
    h1: 'Kripto otomatik pilot: sen ne kadar dersin – o ne alacağını söyler',
    intro: 'Çoğu kişi herkes coşkuluyken kripto alır ve panikle satar. Otomatik pilot tersini yapar, sezgi yerine kurallarla: döngü ucuzken daha fazla yatırım, ayı piyasasında daha fazla rezerv, yalnızca güçlü alım skoruna sahip coinler. Her hafta portföyü kontrol eder ve yapılacak birkaç adımı gösterir.',
    today: (r, n, d) => `Bugünkü model portföy (${d}): ${n} coin ve % ${r} rezerv.`, coin: 'Coin', share: 'Pay', reserve: 'Rezerv (nakit veya stablecoin)',
    how: 'Nasıl çalışır', steps: ['Bir başlangıç tutarı ve istersen aylık birikim gir.', 'Otomatik pilot tam olarak ne alacağını gösterir – sen borsanda uygularsın.', 'Haftada bir modeli kontrol eder. Bir şey değişirse adımları görürsün; değişmezse yapılacak bir şey yok.'],
    btH: 'Geriye dönük test', bt: (a, b, c, h) => `2018’den beri Dengeli strateji: yılda +% ${a}, 2022’den beri +% ${b}, en büyük düşüş −% ${c}. Bitcoin tutmak: yılda +% ${h}. Geçmiş fiyatlarla geriye dönük test – gelecek genellikle daha kötü olur.`,
    cta: 'Otomatik pilotu başlat – 30 gün ücretsiz, ödeme bilgisi yok', btn: 'Ücretsiz başla', calc: 'Hesaplayıcıda dene',
    faq: [['Coinweather’ın paramla ilgili erişimi var mı?', 'Hayır. Coinweather asla senin yerine işlem yapmaz ve borsana bağlanmaz. Adımları görür ve kendin uygularsın.'],
      ['Otomatik pilot ne sıklıkla işlem yapar?', 'Haftada bir kontrol eder. Adımlar yalnızca model varlıklarını değiştirdiğinde veya para eklediğinde çıkar – ücretten tasarruf için küçük sapmalar yok sayılır.'],
      ['Bu yatırım tavsiyesi mi?', 'Hayır. Otomatik pilot, geçmiş fiyatlarla test edilmiş sabit ve açık kuralları izler. Kripto sert düşebilir, tamamen değer kaybına kadar.']] },
};

const LANG_ORDER = ['en', 'de', 'es', 'fr', 'it', 'pt', 'tr'];
const prefix = (lang) => (lang === 'en' ? '' : `/${lang}`);

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
td.n,th.n{text-align:right}.cta{border-color:var(--accent)}.links{columns:3 160px;padding-left:18px}footer{border-top:1px solid var(--line);margin-top:40px;padding:18px 0 40px;font-size:13.5px}
.langs,.share{display:flex;flex-wrap:wrap;gap:4px 12px}.share a{font-weight:700;text-decoration:none}`;

// ---------- Seiten einer Sprache ----------
const pages = [];   // { lang, key, path, html }
const ogText = {};  // je Sprache die Zeilen für das tagesaktuelle Vorschaubild
for (const lang of LANG_ORDER) {
  const L = TX[lang], pre = prefix(lang);
  const locale = i18n.LANGS[lang][1];
  i18n.useDictionary(lang === 'de' ? {} : (await import(`../js/lang/${lang}.js`)).default);
  const say = (t) => (t && lang !== 'de' ? i18n.say(t) : t);
  const num = (v, d = 0) => v.toLocaleString(locale, { maximumFractionDigits: d, minimumFractionDigits: d });
  const usd = (v) => (!isNum(v) ? '–' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : 6, minimumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : 2, maximumSignificantDigits: v < 1 ? 4 : undefined }).format(v));
  const pct = (v) => (!isNum(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), 1)} %`);
  const day = new Date(snap.time).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
  const label = L.label[market.label] ?? market.label;
  const mood = (v) => L.mood[v < 25 ? 0 : v < 45 ? 1 : v <= 55 ? 2 : v <= 75 ? 3 : 4];
  const app = (hash = '') => `/?von=seo${lang === 'en' ? '' : `-${lang}`}&lang=${lang}${hash}`;
  const odds = isNum(btcUp7) ? L.odds(btcUp7, btcUp30) : '';
  const fngV = fng?.value ?? '–', fngM = fng ? mood(fng.value) : '–';
  ogText[lang] = { label, day, idx: L.idx, fng: fng ? `${L.fng}: ${fng.value} – ${mood(fng.value)}` : '', btc: btc ? `Bitcoin ${usd(btc.current_price)}` : '' };
  const add = (key, path, title, description, body, head = '') => pages.push({ lang, key, path: `${pre}${path}`, title, description, body, head, day, L, app });
  const offer = (text) => `<section class="panel cta"><strong>${text}</strong><p class="muted">${L.offer}</p>
    <p><a class="btn" href="${app('#/konto')}">${L.start}</a> <a class="btn ghost" href="${app()}">${L.noSignup}</a></p></section>`;
  const stats = () => `<div class="grid">
    <div class="panel stat"><div class="l">${L.idx}</div><div class="v">${market.value}/100</div><div>${esc(label)}</div></div>
    ${fng ? `<div class="panel stat"><div class="l">${esc(L.fng)}</div><div class="v">${fng.value}</div><div>${mood(fng.value)}${isNum(fng.week) ? ` · ${L.ago7(fng.week)}` : ''}</div></div>` : ''}
    ${market.cycle ? `<div class="panel stat"><div class="l">${L.cyc}</div><div class="v">${num(-market.cycle.dd, 0)} %</div><div>${L.belowAth}</div></div>` : ''}
    <div class="panel stat"><div class="l">${L.sig}</div><div class="v">${buys}</div><div>${L.ofRated(rated)}</div></div></div>`;
  const rows = (list) => list.map((c) => `<tr><td><a href="${pre}/coin/${slug(c.id)}/">${esc(c.name)}</a> <span class="muted">${esc(c.symbol.toUpperCase())}</span></td>
    <td class="n">${usd(c.current_price)}</td><td class="n ${tone(ch(c, '24h'))}">${pct(ch(c, '24h'))}</td></tr>`).join('');

  // Kryptomarkt heute
  add('today', '/crypto-weather-today/', L.tTitle(day, label, market.value), L.tDesc(market.value, label, fngV, fngM, usd(btc?.current_price)),
    `<h1>${esc(L.tH1(label, market.value))}</h1><p class="muted">${esc(L.tSub(day))}</p>${stats()}
    <h2>${L.buyQ}</h2><p>${L.tPara(market.value, esc(label), fngV, fngM, odds, altUp7)}</p>
    <h2>${L.btcH}</h2><p>${L.btcPara(usd(btc?.current_price), pct(ch(btc, '24h')), pct(ch(btc, '7d')), num(Math.abs(btc?.ath_change_percentage ?? 0), 0))} <a href="${pre}/coin/bitcoin/">${L.btcLink}</a></p>
    <h2>${L.movH}</h2><p class="muted">${L.obs}</p>
    <div class="panel"><table><tr><th>${L.gain}</th><th class="n">${L.price}</th><th class="n">${L.h24}</th></tr>${rows(movers.slice(0, 5))}</table></div>
    <div class="panel"><table><tr><th>${L.lose}</th><th class="n">${L.price}</th><th class="n">${L.h24}</th></tr>${rows(movers.slice(-5).reverse())}</table></div>
    ${record?.d7 ? `<h2>${L.recH}</h2><p>${L.recPara(new Date(record.since * 86_400_000).toLocaleDateString(locale), pct(record.d7.avg), record.d7.up, record.d7.n, pct(record.d7.btc), isNum(record.d7.mkt) ? pct(record.d7.mkt) : null)}</p>` : ''}
    <p><a href="${pre}${BQ[lang].path}">${esc(BQ[lang].nav)} →</a> · <a href="${pre}${BE[lang].path}">${esc(BE[lang].nav)} →</a> · <a href="${pre}${BB[lang].path}">${esc(BB[lang].nav)} →</a> · <a href="${pre}${AP[lang].path}">${esc(AP[lang].nav)} →</a></p>
    ${offer(L.tOffer)}`);

  // „Soll ich jetzt Bitcoin kaufen?“ – Kauf-Score mit Bausteinen, Jahresrückblick und FAQ
  if (market.buy?.parts && year) {
    const Q = BQ[lang], X = IX[lang], v = market.value, ath = btc?.ath_change_percentage;
    const zone = (c) => (c >= 62 ? ['up', Q.cheap] : c < 45 ? ['down', Q.dear] : ['', Q.neutral]);
    const inputs = ['mayer', 'twoYear', 'pi', 'ath', 'fng'].filter((k) => isNum(market.buy.parts[k])).map((k) => {
      const c = Math.round(100 - market.buy.parts[k]), [t, w] = zone(c);
      return `<tr><td>${esc(X.parts[k])}</td><td style="width:38%"><div style="background:var(--line);border-radius:6px;height:10px"><div style="width:${c}%;height:10px;border-radius:6px;background:var(--accent)"></div></div></td>
        <td class="n">${c}</td><td class="n ${t}">${esc(w)}</td></tr>`;
    }).join('');
    const sign = (m) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} %`;
    const hrow = (n, h) => `<tr><td>${esc(n)}</td><td class="n">${h.up} %</td><td class="n ${tone(h.median)}">${sign(h.median)}</td></tr>`;
    const faq = Q.faq.map(([q, a]) => [q, a(v, label, year.btc.up, year.alt.up)]);
    const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
    add('bq', Q.path, Q.title(v, label, day), Q.desc(v, label, usd(btc?.current_price)),
      `<h1>${esc(Q.h1(v, label))}</h1><p class="muted">${esc(day)}</p>
      <div class="grid"><div class="panel stat"><div class="l">${esc(Q.stats.score)}</div><div class="v">${v}/100</div><div>${esc(label)}</div></div>
        <div class="panel stat"><div class="l">${esc(Q.stats.price)}</div><div class="v">${usd(btc?.current_price)}</div><div class="${tone(ch(btc, '24h'))}">${pct(ch(btc, '24h'))} · 24h</div></div>
        ${isNum(ath) ? `<div class="panel stat"><div class="l">${esc(Q.stats.ath)}</div><div class="v">${num(Math.abs(ath), 0)} %</div></div>` : ''}
        ${fng ? `<div class="panel stat"><div class="l">${esc(Q.stats.fng)}</div><div class="v">${fng.value}</div><div>${mood(fng.value)}</div></div>` : ''}</div>
      <p>${esc(Q.intro)}</p>
      <h2>${esc(Q.inputsH)}</h2><div class="panel"><table>${inputs}</table></div><p class="muted">${esc(Q.bar)}</p>
      <h2>${esc(since(Q.histH))}</h2><div class="panel"><table><tr><th></th><th class="n">${esc(Q.higher)}</th><th class="n">${esc(Q.median)}</th></tr>
        ${hrow(Q.btc, year.btc)}${hrow(Q.eth, year.eth)}${hrow(Q.alt, year.alt)}</table></div>
      <p class="muted">${esc(Q.caveat)}</p>
      <section class="panel cta"><strong>${esc(Q.cta)}</strong><p><a class="btn" href="${app()}">${L.open}</a> <a class="btn ghost" href="${app('#/indikatoren')}">${esc(X.fullBtn)}</a></p></section>
      ${faq.map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('')}
      <p><a href="${pre}/crypto-weather-today/">${L.fullRep}</a> · <a href="${pre}${BE[lang].path}">${esc(BE[lang].nav)}</a> · <a href="${pre}/bitcoin-cycle-risk/">${esc(X.nav)}</a> · <a href="${pre}/coin/bitcoin/">${L.btcLink}</a></p>`,
      `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);

    // Dasselbe für Ethereum: sein Kauf-Score wie in der App (80 % Kauf-Score des Markts, 20 % eigener Trend)
    const eth = coins.find((c) => c.id === 'ethereum'), ea = eth?.analysis;
    if (isNum(ea?.score) && ea.label) {
      const E2 = BE[lang], ev = Math.round(50 + ea.score / 2), el = L.label[ea.label] ?? ea.label, eath = eth.ath_change_percentage;
      const efaq = E2.faq.map(([q, a]) => [q, a(ev, el, year.eth.up)]);
      const eld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: efaq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
      add('be', E2.path, E2.title(ev, el, day), E2.desc(ev, el, usd(eth.current_price), v),
        `<h1>${esc(E2.h1(ev, el))}</h1><p class="muted">${esc(day)}</p>
        <div class="grid"><div class="panel stat"><div class="l">${esc(E2.score)}</div><div class="v">${ev}/100</div><div>${esc(el)}</div></div>
          <div class="panel stat"><div class="l">${esc(E2.market)}</div><div class="v">${v}/100</div><div>${esc(label)}</div></div>
          <div class="panel stat"><div class="l">${esc(E2.price)}</div><div class="v">${usd(eth.current_price)}</div><div class="${tone(ch(eth, '24h'))}">${pct(ch(eth, '24h'))} · 24h</div></div>
          ${isNum(eath) ? `<div class="panel stat"><div class="l">${esc(E2.ath)}</div><div class="v">${num(Math.abs(eath), 0)} %</div></div>` : ''}</div>
        <p>${esc(E2.intro(v, label))} <a href="${pre}${Q.path}">${esc(Q.inputsH)} →</a></p>
        <h2>${esc(since(Q.histH))}</h2><div class="panel"><table><tr><th></th><th class="n">${esc(Q.higher)}</th><th class="n">${esc(Q.median)}</th></tr>
          ${hrow(Q.eth, year.eth)}${hrow(Q.btc, year.btc)}${hrow(Q.alt, year.alt)}</table></div>
        <p class="muted">${esc(Q.caveat)}</p>
        <section class="panel cta"><strong>${esc(Q.cta)}</strong><p><a class="btn" href="${app('#/coin/ethereum')}">${L.open}</a> <a class="btn ghost" href="${app('#/indikatoren')}">${esc(X.fullBtn)}</a></p></section>
        ${efaq.map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('')}
        <p><a href="${pre}${Q.path}">${esc(Q.nav)}</a> · <a href="${pre}/coin/ethereum/">Ethereum</a> · <a href="${pre}/crypto-weather-today/">${L.fullRep}</a></p>`,
        `<script type="application/ld+json">${JSON.stringify(eld).replace(/</g, '\\u003c')}</script>`);
    }
  }

  // „Best crypto to buy now“: die 10 stärksten Kauf-Scores (wie „Stärkste Kaufsignale“ in der App, ohne Token auf Aktien und Gold)
  {
    const B = BB[lang];
    const best = coins.filter((c) => (c.market_cap_rank ?? 9999) <= 300 && c.total_volume >= 5e6 && c.analysis?.signal && c.analysis.signal !== 'none'
      && !c.analysis.stable && isNum(c.analysis.score)).sort((a, b) => adjusted(b.analysis) - adjusted(a.analysis)).slice(0, 10);
    if (best.length >= 5) {
      const k = (sc) => Math.round(50 + sc / 2);
      const names = best.map((c) => c.name);
      const top3 = names.slice(0, 3).join(', ');
      const faq = B.faq.map(([q, a]) => [q, a(top3)]);
      const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
      add('bb', B.path, B.title(day), B.desc(market.value, names.slice(0, 5).join(', ')),
        `<h1>${esc(B.h1)}</h1><p class="muted">${esc(day)}</p><p>${esc(B.intro(market.value, label))}</p>
        <div class="panel"><table><tr><th>${B.rank}</th><th>${esc(B.coin)}</th><th class="n">${esc(B.score)}</th><th class="n">${esc(B.d7)}</th><th>${esc(B.risk)}</th></tr>
        ${best.map((c, i) => `<tr><td>${i + 1}</td><td><a href="${pre}/coin/${slug(c.id)}/">${esc(c.name)}</a> <span class="muted">${esc(c.symbol.toUpperCase())}</span></td>
          <td class="n"><strong>${k(c.analysis.score)}</strong>/100</td><td class="n ${tone(ch(c, '7d'))}">${pct(ch(c, '7d'))}</td><td>${esc(say(c.analysis.risk?.label ?? '–'))}</td></tr>`).join('')}</table></div>
        <p class="muted">${esc(B.note)}</p>
        <section class="panel cta"><strong>${esc(B.cta)}</strong><p><a class="btn" href="${app('#/konto?next=portfolio')}">${esc(B.btn)}</a> <a class="btn ghost" href="${pre}${AP[lang].path}">${esc(AP[lang].nav)} →</a></p></section>
        ${faq.map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('')}
        <p><a href="${pre}${BQ[lang].path}">${esc(BQ[lang].nav)}</a> · <a href="${pre}/crypto-weather-today/">${L.fullRep}</a> · <a href="${pre}/coins/">${L.all}</a></p>`,
        `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
    }
  }

  // Der Autopilot als eigene Seite: Modell-Portfolio heute (die ersten zwei Coins offen), Ablauf, Rückrechnung, FAQ
  {
    const A = AP[lang], t = modelData?.profiles?.balanced;
    if (t?.holdings?.length) {
      const nameOf = (sym) => coins.filter((c) => c.symbol.toUpperCase() === sym).sort((a, b) => (a.market_cap_rank ?? 9999) - (b.market_cap_rank ?? 9999))[0]?.name ?? sym;
      const r = Math.round(t.cash), n = t.holdings.length, asOf = new Date(t.asOf).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
      const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: A.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
      const B2 = RESERVE_BACKTEST.balanced;
      add('ap', A.path, A.title, A.desc(r, n),
        `<h1>${esc(A.h1)}</h1><p>${esc(A.intro)}</p>
        <h2>${esc(A.today(r, n, asOf))}</h2>
        <div class="panel"><table><tr><th>${esc(A.coin)}</th><th class="n">${esc(A.share)}</th></tr>
          ${t.holdings.map((h, i) => `<tr><td>${i < 2 ? esc(nameOf(h.symbol)) : '🔒'}</td><td class="n">${i < 2 ? `${num(h.share, 1)} %` : '–'}</td></tr>`).join('')}
          <tr><td>${esc(A.reserve)}</td><td class="n">${num(t.cash, 1)} %</td></tr></table></div>
        ${record?.ap?.days ? `<p><strong>${esc(A.live(new Date(record.ap.since * 86_400_000).toLocaleDateString(locale), pct(record.ap.nav - 100), pct(record.ap.btc - 100)))}</strong></p>` : ''}
        <h2>${esc(A.how)}</h2><ol>${A.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <h2>${esc(A.btH)}</h2><p>${esc(A.bt(B2.perYear, B2.recent, B2.drawdown, HOLD_BACKTEST.perYear))}</p>
        <section class="panel cta"><strong>${esc(A.cta)}</strong><p><a class="btn" href="${app('#/konto?next=portfolio')}">${esc(A.btn)}</a> <a class="btn ghost" href="${app('#/rechner')}">${esc(A.calc)}</a></p></section>
        ${A.faq.map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('')}
        <p><a href="${pre}${BB[lang].path}">${esc(BB[lang].nav)}</a> · <a href="${pre}${BQ[lang].path}">${esc(BQ[lang].nav)}</a> · <a href="${pre}/savings-plan/">${SP[lang].nav}</a></p>`,
        `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
    }
  }

  // Coin-Seiten
  for (const [i, c] of top.entries()) {
    const a = c.analysis ?? {}, sym = c.symbol.toUpperCase(), name = esc(c.name);
    const sample = SAMPLES.includes(c.id);
    const near = top.slice(Math.max(0, i - 6), i + 7).filter((x) => x.id !== c.id);
    const signal = a.stable ? L.stable(name)
      : sample ? L.sample(name, esc(L.label[a.label] ?? a.label), a.horizon ? esc(say(a.horizon)) : '', a.risk?.label ? esc(say(a.risk.label)) : '')
      : L.locked(name);
    add(`coin:${c.id}`, `/coin/${slug(c.id)}/`, L.cTitle(c.name, sym, day), L.cDesc(c.name, usd(c.current_price), pct(ch(c, '24h')), pct(ch(c, '7d')), market.value, label, fngV),
      `<h1>${esc(L.cH1(c.name, sym))}</h1><p class="muted">${esc(L.cSub(day))}</p>
      <div class="grid"><div class="panel stat"><div class="l">${L.price}</div><div class="v">${usd(c.current_price)}</div></div>
        <div class="panel stat"><div class="l">${L.periods[0]}</div><div class="v ${tone(ch(c, '24h'))}">${pct(ch(c, '24h'))}</div></div>
        <div class="panel stat"><div class="l">${L.periods[1]}</div><div class="v ${tone(ch(c, '7d'))}">${pct(ch(c, '7d'))}</div></div>
        <div class="panel stat"><div class="l">${L.rank}</div><div class="v">#${c.market_cap_rank}</div></div></div>
      <p>${L.cPara(name, usd(c.current_price), pct(ch(c, '24h')), pct(ch(c, '7d')), c.market_cap_rank, isNum(c.market_cap) ? `${L.big(c.market_cap, num)} USD` : '–',
        isNum(c.ath_change_percentage) ? num(Math.abs(c.ath_change_percentage), 0) : null, usd(c.ath))}</p>
      <div class="panel"><table><tr><th>${L.period}</th><th class="n">${L.change}</th></tr>
        ${['24h', '7d', '30d', '200d', '1y'].map((k, j) => `<tr><td>${L.periods[j]}</td><td class="n ${tone(ch(c, k))}">${pct(ch(c, k))}</td></tr>`).join('')}</table></div>
      <h2>${esc(L.cBuyQ(c.name))}</h2><p>${L.cPara2(market.value, esc(label), fngV, fngM, odds)}</p><p>${signal}</p>
      ${year && !c.analysis?.stable ? `<h2>${IX[lang].nav}</h2><p>${since(L.cComp(name, c.id === 'bitcoin' || c.id === 'ethereum', market.value, esc(label),
        year[c.id === 'bitcoin' ? 'btc' : c.id === 'ethereum' ? 'eth' : 'alt'].up, ((m) => `${m > 0 ? '+' : ''}${m}`)(year[c.id === 'bitcoin' ? 'btc' : c.id === 'ethereum' ? 'eth' : 'alt'].median),
        market.value >= 62 ? 'cheap' : market.value < 45 ? 'dear' : 'mid'))} <a href="${pre}/bitcoin-cycle-risk/">${IX[lang].nav} →</a></p>` : ''}
      ${offer(sample ? L.offAll : L.offCoin(name))}
      <h2>${L.mToday}</h2>${stats()}<p><a href="${pre}/crypto-weather-today/">${L.fullRep}</a></p>
      <h2>${L.similar}</h2><ul class="links">${near.map((x) => `<li><a href="${pre}/coin/${slug(x.id)}/">${esc(x.name)} (${esc(x.symbol.toUpperCase())})</a></li>`).join('')}</ul>`);
  }

  // Fear & Greed Index
  if (fng) {
    add('fng', '/fear-and-greed-index/', L.fTitle(fng.value, mood(fng.value), day), L.fDesc(fng.value, mood(fng.value), fng.week),
      `<h1>${L.fH1(fng.value, mood(fng.value))}</h1><p class="muted">${esc(L.fSub(day))}</p>
      <div class="grid"><div class="panel stat"><div class="l">${L.fToday}</div><div class="v">${fng.value}</div><div>${mood(fng.value)}</div></div>
        ${isNum(fng.week) ? `<div class="panel stat"><div class="l">${L.f7}</div><div class="v">${fng.week}</div><div>${mood(fng.week)}</div></div>` : ''}
        ${isNum(fng.month) ? `<div class="panel stat"><div class="l">${L.f30}</div><div class="v">${fng.month}</div><div>${mood(fng.month)}</div></div>` : ''}
        ${isNum(avg7) ? `<div class="panel stat"><div class="l">${L.fAvg}</div><div class="v">${num(avg7, 0)}</div><div>${mood(avg7)}</div></div>` : ''}</div>
      <h2>${L.fWhatH}</h2><p>${L.fWhat}</p>
      <h2>${L.fHistH}</h2><p>${L.fHist}</p><ul>${L.fLi.map((x) => `<li>${x}</li>`).join('')}</ul>
      <p>${L.fNow(fng.value, mood(fng.value), isNum(avg7) ? num(avg7, 0) : null)} ${isNum(avg7) && avg7 >= 75 && avg7 < 85 ? L.brakeOn : L.brakeOff}
      ${L.fIdx(market.value, esc(label))} <a href="${pre}/crypto-weather-today/">${L.fullRep}</a></p>
      ${offer(L.fOffer)}`);
  }

  // Indikator-Seiten aus dem Zyklus-Kompass
  if (indices) {
    const X = IX[lang], ri = indices.risk;
    const RL = (v) => (RISK_ZONES.find(([lo, hi]) => v >= lo && v < hi) ?? RISK_ZONES[RISK_ZONES.length - 1])[2];
    const rl = X.label[RL(ri.value)], se = indices.altseason;
    const names = { risk: X.riskH(ri.value, rl).split(':')[0], season: se ? X.seasonH(se.value, X.season(se.value)).split(':')[0] : null,
      pi: X.piH(0).split(':')[0], mayer: X.mayerH(0).split(':')[0] };
    const paths = { risk: '/bitcoin-cycle-risk/', season: '/altcoin-season-index/', pi: '/pi-cycle-top/', mayer: '/mayer-multiple/' };
    const more = (self) => `<h2>${X.also}</h2><ul class="links">${Object.entries(paths).filter(([k]) => k !== self && names[k]).map(([k, p]) => `<li><a href="${pre}${p}">${esc(names[k])}</a></li>`).join('')}
      <li><a href="${pre}/fear-and-greed-index/">${esc(L.fngNav)}</a></li></ul>`;
    const cta = `<section class="panel cta"><strong>${X.full}</strong><p><a class="btn" href="${app('#/indikatoren')}">${X.fullBtn}</a></p></section><p class="muted">${X.note}</p>`;
    const stat = (l, v) => `<div class="panel stat"><div class="l">${l}</div><div class="v">${v}</div></div>`;
    const y1 = year?.btc;   // dieselbe Tabelle wie App, Coin-Seiten und Beiträge
    add('ix:risk', paths.risk, X.riskT(ri.value, rl, day), X.riskD(ri.value, rl),
      `<h1>${esc(X.riskH(ri.value, rl))}</h1><p class="muted">${esc(day)}</p>
      <div class="grid">${stat(names.risk, `${ri.value}/100`)}${stat(X.parts.mayer, num(indices.mayer.value, 2))}${stat(X.parts.pi, `${num(indices.pi.ratio * 100, 0)} %`)}${se ? stat(names.season, `${se.value}/100`) : ''}</div>
      <p>${X.riskP}</p>${y1 ? `<p><strong>${since(X.riskBt(`${y1.up} %`))}</strong></p>` : ''}
      <h2>${X.partsH}</h2><div class="panel"><table>${Object.entries(ri.parts ?? {}).map(([k, v]) => `<tr><td>${X.parts[k]}</td><td class="n">${num(v, 0)}</td></tr>`).join('')}</table></div>
      ${cta}${more('risk')}`);
    if (se) {
      const list = (arr) => arr.map((x) => `<tr><td>${esc(x.symbol)}</td><td class="n ${tone(x.ret)}">${pct(x.ret)}</td></tr>`).join('');
      add('ix:season', paths.season, X.seasonT(se.value, X.season(se.value), day), X.seasonD(se.value, se.n),
        `<h1>${esc(X.seasonH(se.value, X.season(se.value)))}</h1><p class="muted">${esc(day)}</p>
        <p>${X.seasonP(se.value, se.n, pct(se.btc90))}</p>
        <div class="grid"><div class="panel"><table><tr><th>${X.lead}</th><th class="n">90 d</th></tr>${list(se.leaders)}</table></div>
          <div class="panel"><table><tr><th>${X.lag}</th><th class="n">90 d</th></tr>${list(se.laggards)}</table></div></div>
        ${cta}${more('season')}`);
    }
    const piV = Math.round(indices.pi.ratio * 100);
    add('ix:pi', paths.pi, X.piT(piV, day), X.piD(piV),
      `<h1>${esc(X.piH(piV))}</h1><p class="muted">${esc(day)}</p><p>${X.piP(usd(indices.pi.sma111), usd(indices.pi.line), piV)}</p>${cta}${more('pi')}`);
    const mv = num(indices.mayer.value, 2);
    add('ix:mayer', paths.mayer, X.mayerT(mv, day), X.mayerD(mv),
      `<h1>${esc(X.mayerH(mv))}</h1><p class="muted">${esc(day)}</p><p>${X.mayerP(mv, usd(indices.mayer.sma200))}</p>${cta}${more('mayer')}`);
  }

  // Widget zum Einbetten
  {
    const E = EMB[lang];
    const code = (theme) => `<iframe src="${SITE}/widget.html?lang=${lang}${theme === 'light' ? '&theme=light' : ''}" width="340" height="112" style="border:0;max-width:100%" loading="lazy" title="Coinweather"></iframe>`;
    add('embed', '/embed/', E.t, E.d, `<h1>${esc(E.h)}</h1><p>${esc(E.p)}</p>
      ${['dark', 'light'].map((th) => `<h2>${esc(E[th])}</h2><div class="panel">${code(th)}</div>
        <textarea readonly rows="3" style="width:100%;font:13px monospace;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text)" onclick="this.select()">${esc(code(th))}</textarea>`).join('')}
      ${offer(L.tOffer)}`);
  }

  // Sparplan-Seiten je Coin und eine Übersicht
  const S2 = SP[lang], y3 = nowY - 3;
  const spList = SP_COINS.filter((c) => spResults.get(c.id)?.plan[0]);
  const noSign = (v) => pct(v).replace(/^[−+-]/, '');
  const spRow = (label, r) => (r ? `<tr><td>${label}</td><td class="n">${usd(r.invested)}</td><td class="n">${usd(r.last)}</td><td class="n ${tone(r.ret)}">${pct(r.ret * 100)}</td><td class="n">${r.worst < 0 ? pct(r.worst * 100) : S2.never}</td></tr>` : '');
  const spHead = (first) => `<tr><th>${first}</th><th class="n">${S2.inv}</th><th class="n">${S2.val}</th><th class="n">${S2.ret}</th><th class="n">${S2.worst}</th></tr>`;
  const spTable = (rows) => `<div class="panel"><table>${spHead(S2.start)}${rows.map((r, j) => spRow(S2.jan(y3 + j), r)).join('')}</table></div>`;
  for (const c of spList) {
    const R = spResults.get(c.id), r = R.plan[0], name = esc(c.name);
    add(`sp:${c.id}`, `/savings-plan/${slug(c.id)}/`, S2.title(c.name, y3), S2.desc(c.name, y3, usd(r.invested), usd(r.last), pct(r.ret * 100)),
      `<h1>${esc(S2.h1(c.name))}</h1><p class="muted">${esc(S2.sub(day))}</p>
      <p>${S2.lead(name, y3, usd(r.invested), usd(r.last), pct(r.ret * 100), r.worst < -0.05 ? noSign(r.worst * 100) : null)}</p>
      <h2>${S2.planH}</h2>${spTable(R.plan)}<h2>${S2.onceH}</h2>${spTable(R.once)}
      <section class="panel cta"><strong>${S2.try}</strong><p><a class="btn" href="${app(`#/rechner/${encodeURIComponent(c.id)}?m=plan&b=100&s=${y3}-01`)}">${S2.tryBtn}</a></p></section>
      <p class="muted">${S2.note}</p>
      <h2>${S2.others}</h2><ul class="links">${spList.filter((x) => x.id !== c.id).map((x) => `<li><a href="${pre}/savings-plan/${slug(x.id)}/">${esc(x.name)}</a></li>`).join('')}</ul>
      ${offer(L.offCoin(name))}`);
  }
  if (spList.length) {
    const ranked = [...spList].sort((a, b) => spResults.get(b.id).plan[0].ret - spResults.get(a.id).plan[0].ret);
    add('sp-hub', '/savings-plan/', S2.hubTitle(y3), S2.hubDesc(y3),
      `<h1>${S2.hubH1}</h1><p class="muted">${esc(S2.hubSub(y3, day))}</p>
      <div class="panel"><table>${spHead(S2.coin)}${ranked.map((c) => spRow(`<a href="${pre}/savings-plan/${slug(c.id)}/">${esc(c.name)}</a>`, spResults.get(c.id).plan[0])).join('')}</table></div>
      <section class="panel cta"><strong>${S2.try}</strong><p><a class="btn" href="${app('#/rechner')}">${S2.tryBtn}</a></p></section><p class="muted">${S2.note}</p>`);
  }

  // Übersicht
  add('coins', '/coins/', L.lTitle(day), L.lDesc(market.value, label),
    `<h1>${L.lH1}</h1><p class="muted">${esc(L.lSub(day, market.value, label))} <a href="${pre}/crypto-weather-today/">${L.fullRep}</a></p>
    <div class="panel"><table><tr><th>#</th><th>${L.coin}</th><th class="n">${L.price}</th><th class="n">${L.h24}</th><th class="n">${L.d7h}</th></tr>
    ${top.map((c) => `<tr><td>${c.market_cap_rank}</td><td><a href="${pre}/coin/${slug(c.id)}/">${esc(c.name)}</a> <span class="muted">${esc(c.symbol.toUpperCase())}</span></td>
      <td class="n">${usd(c.current_price)}</td><td class="n ${tone(ch(c, '24h'))}">${pct(ch(c, '24h'))}</td><td class="n ${tone(ch(c, '7d'))}">${pct(ch(c, '7d'))}</td></tr>`).join('')}</table></div>
    ${offer(L.lOffer)}`);
}

// ---------- Tagesaktuelles Vorschaubild je Sprache (beim Teilen auf WhatsApp, X, Facebook …) ----------
// Ohne sharp (lokal nicht installiert) bleibt das feste og-image.jpg.
const ogImage = {};
try {
  const { default: sharp } = await import('sharp');
  await mkdir(`${out}/og`, { recursive: true });
  const C = { bg: '#0b0f17', panel: '#121826', line: '#263042', text: '#e8ecf3', muted: '#9aa4b2', sun: '#f7931a', up: '#3ecf8e', down: '#ef5b5b', rain: '#5aa9ff' };
  const v = market.value, accent = v >= 62 ? C.up : v < 45 ? C.down : C.sun;
  const sky = ['storm', 'rain', 'cloud', 'partly', 'sun'][market.mood?.sky ?? 2] ?? 'cloud';
  const sun = `<circle cx="0" cy="0" r="62" fill="${C.sun}"/>`;
  const cloud = (fill) => `<g fill="${fill}"><circle cx="-40" cy="20" r="50"/><circle cx="20" cy="0" r="65"/><circle cx="80" cy="25" r="45"/><rect x="-90" y="20" width="215" height="50" rx="25"/></g>`;
  const drops = `<g stroke="${C.rain}" stroke-width="10" stroke-linecap="round"><line x1="-40" y1="95" x2="-50" y2="125"/><line x1="10" y1="95" x2="0" y2="125"/><line x1="60" y1="95" x2="50" y2="125"/></g>`;
  const icon = { sun, partly: `<g transform="translate(-30,-30)">${sun}</g>${cloud('#e8ecf3')}`, cloud: cloud('#9aa4b2'),
    rain: `${cloud('#7c8796')}${drops}`, storm: `${cloud('#5c6675')}<path d="M10 80 L-15 130 L10 130 L-5 175 L45 115 L20 115 L35 80 Z" fill="${C.sun}"/>` }[sky];
  for (const lang of LANG_ORDER) {
    const t = ogText[lang], Q = BQ[lang];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif">
      <rect width="1200" height="630" fill="${C.bg}"/><rect x="0" y="0" width="1200" height="10" fill="${C.sun}"/>
      <text x="70" y="92" font-size="38" font-weight="700" fill="${C.text}">☁ Coinweather</text>
      <text x="1130" y="92" font-size="28" fill="${C.muted}" text-anchor="end">${esc(t.day)}</text>
      <text x="70" y="165" font-size="44" font-weight="700" fill="${C.text}">${esc(Q.nav)}</text>
      <text x="70" y="235" font-size="30" fill="${C.muted}">${esc(t.idx)}</text>
      <text x="70" y="385" font-size="150" font-weight="700" fill="${accent}">${v}<tspan font-size="56" fill="${C.muted}">/100</tspan></text>
      <text x="70" y="455" font-size="50" font-weight="700" fill="${C.text}">${esc(t.label)}</text>
      <rect x="70" y="480" width="640" height="18" rx="9" fill="${C.line}"/><rect x="70" y="480" width="${Math.max(18, 6.4 * v)}" height="18" rx="9" fill="${accent}"/>
      <g transform="translate(960,265) scale(1.1)">${icon}</g>
      <text x="1130" y="505" font-size="30" fill="${C.text}" text-anchor="end">${esc(t.btc)}</text>
      <text x="1130" y="465" font-size="30" fill="${C.muted}" text-anchor="end">${esc(t.fng)}</text>
      <line x1="70" y1="540" x2="1130" y2="540" stroke="${C.line}" stroke-width="2"/>
      <text x="70" y="590" font-size="32" font-weight="700" fill="${C.sun}">${esc(Q.rain)}</text>
      <text x="1130" y="590" font-size="28" fill="${C.muted}" text-anchor="end">coinweather.github.io</text></svg>`;
    await writeFile(`${out}/og/${lang}.jpg`, await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer());
    ogImage[lang] = `${SITE}/og/${lang}.jpg?d=${iso.slice(0, 10)}`;
  }
  // Startseite der App: dasselbe Bild (englisch), mit Datum in der Adresse, damit Facebook & Co. es neu laden
  await cp(`${out}/og/en.jpg`, `${out}/og-image.jpg`);
  const ix = await readFile(`${out}/index.html`, 'utf8');
  await writeFile(`${out}/index.html`, ix.replaceAll(`${SITE}/og-image.jpg"`, `${SITE}/og-image.jpg?d=${iso.slice(0, 10)}"`));
  console.log('Vorschaubilder: 7 Sprachen');
} catch (err) { console.log(`Vorschaubilder nicht erstellt: ${err.message}`); }

// ---------- Schreiben: jede Seite mit Verweisen auf ihre anderen Sprachen ----------
const byKey = new Map();
for (const p of pages) { if (!byKey.has(p.key)) byKey.set(p.key, []); byKey.get(p.key).push(p); }
const LANG_NAME = Object.fromEntries(LANG_ORDER.map((l) => [l, i18n.LANGS[l][0]]));
for (const p of pages) {
  const { L, lang, app } = p, pre = prefix(lang);
  const twins = byKey.get(p.key);
  const alternates = twins.map((t) => `<link rel="alternate" hreflang="${t.lang}" href="${SITE}${t.path}">`).join('')
    + `<link rel="alternate" hreflang="x-default" href="${SITE}${twins.find((t) => t.lang === 'en').path}">`;
  const share = encodeURIComponent(`${SITE}${p.path}`), shareText = encodeURIComponent(p.title);
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title><meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${SITE}${p.path}">${alternates}<meta name="theme-color" content="#0b0f17">${p.head}
<meta property="og:type" content="article"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${SITE}${p.path}"><meta property="og:image" content="${ogImage[lang] ?? `${SITE}/og-image.jpg`}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2714%27 fill=%27%23f7931a%27/%3E%3C/svg%3E">
<style>${CSS}</style></head>
<body><header><div class="wrap"><a class="brand" href="${app()}">☁️ Coinweather</a><a class="btn" href="${app()}">${L.open}</a></div></header>
<main class="wrap">${p.body}
<p class="share muted">↗ <a href="https://wa.me/?text=${shareText}%20${share}" rel="noopener" target="_blank">WhatsApp</a><a href="https://t.me/share/url?url=${share}&text=${shareText}" rel="noopener" target="_blank">Telegram</a><a href="https://twitter.com/intent/tweet?url=${share}&text=${shareText}" rel="noopener" target="_blank">X</a><a href="https://www.facebook.com/sharer/sharer.php?u=${share}" rel="noopener" target="_blank">Facebook</a></p></main>
<footer><div class="wrap"><p><a href="${pre}/crypto-weather-today/">${L.today}</a> · <a href="${pre}${BQ[lang].path}">${esc(BQ[lang].nav)}</a> · <a href="${pre}${BB[lang].path}">${esc(BB[lang].nav)}</a> · <a href="${pre}${AP[lang].path}">${esc(AP[lang].nav)}</a> · <a href="${pre}/fear-and-greed-index/">${esc(L.fngNav)}</a> · <a href="${pre}/coins/">${L.all}</a> · <a href="${pre}/savings-plan/">${SP[lang].nav}</a> · <a href="${pre}/bitcoin-cycle-risk/">${IX[lang].nav}</a> · <a href="${pre}/embed/">${EMB[lang].nav}</a> ·
<a href="/?lang=${lang}#/risiko">${L.risk}</a> · <a href="/?lang=${lang}#/impressum">${L.legal}</a> · <a href="/?lang=${lang}#/datenschutz">${L.privacy}</a></p>
<p class="langs">${twins.map((t) => `<a href="${t.path}" hreflang="${t.lang}"${t.lang === lang ? ' aria-current="page"' : ''}>${LANG_NAME[t.lang]}</a>`).join('')}</p>
<p class="muted">${L.foot(esc(p.day))} Data: CoinGecko, Binance, Gate.io, alternative.me.</p></div></footer>
<script>(function(){var v=new URLSearchParams(location.search).get('von');if(!v||!/^[A-Za-z0-9_-]{1,30}$/.test(v))return;document.querySelectorAll('a[href*="von=seo"]').forEach(function(a){a.href=a.href.replace(/von=seo[^&#]*/,'von='+v);});})();</script>
</body></html>`;
  await mkdir(`${out}${p.path}`, { recursive: true });
  await writeFile(`${out}${p.path}index.html`, html);
}

const urls = ['/', ...pages.map((p) => p.path)];
await writeFile(`${out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map((u) => `<url><loc>${SITE}${u}</loc><lastmod>${iso}</lastmod><changefreq>daily</changefreq></url>`).join('\n')}\n</urlset>\n`);
// RSS-Feed (englisch): ein Eintrag je Tag mit dem Wetterbericht – Feed-Leser sammeln die Einträge selbst
const E = TX.en, enLabel = E.label[market.label] ?? market.label;
const enMood = fng ? E.mood[fng.value < 25 ? 0 : fng.value < 45 ? 1 : fng.value <= 55 ? 2 : fng.value <= 75 ? 3 : 4] : '–';
const enDay = new Date(snap.time).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const reportDesc = `Buy score ${market.value}/100 (${enLabel}), Fear & Greed ${fng?.value ?? '–'} (${enMood}), Bitcoin $${Math.round(btc?.current_price ?? 0).toLocaleString('en-US')}. ${isNum(btcUp7) ? E.odds(btcUp7, btcUp30) : ''} Not financial advice.`;
await writeFile(`${out}/feed.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Coinweather – daily crypto weather report</title><link>${SITE}/</link>
<atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/><description>Is now a good time to buy crypto? A daily weather report for the crypto market. Not financial advice.</description><language>en</language>
<item><title>${esc(`Crypto weather ${enDay}: ${enLabel} (${market.value}/100), Fear & Greed ${fng?.value ?? '–'}`)}</title><link>${SITE}/crypto-weather-today/</link>
<guid isPermaLink="false">coinweather-${iso.slice(0, 10)}</guid><pubDate>${new Date(snap.time).toUTCString()}</pubDate><description>${esc(reportDesc)}</description></item>
</channel></rss>
`);
await writeFile(`${out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`${pages.length} Seiten für Suchmaschinen gebaut in ${LANG_ORDER.length} Sprachen`);
