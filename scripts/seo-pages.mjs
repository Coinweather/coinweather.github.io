// Baut die Seite zum Veröffentlichen: die App-Dateien plus täglich neue, einzeln auffindbare Seiten für Suchmaschinen.
// Die App selbst steckt in einer einzigen Seite mit #-Adressen – die kann Google kaum lesen. Darum gibt es zusätzlich,
// in allen 7 Sprachen der App (Englisch ohne Vorsilbe, die anderen unter /de/, /es/, /fr/, /it/, /pt/, /tr/):
//   /crypto-weather-today/   der Kryptomarkt heute: Markt-Index, Fear & Greed, Zyklus, Aussicht, größte Bewegungen
//   /fear-and-greed-index/   der Fear & Greed Index heute mit dem, was die Rückrechnung über Angst und Gier zeigt
//   /coin/<id>/              je eine Seite für die 500 größten Coins: Kurs, Entwicklung, Großwetterlage, Signal (verdeckt)
//   /coins/                  Übersicht mit Links auf alle Coin-Seiten
//   /bitcoin-cycle-risk/, /altcoin-season-index/, /pi-cycle-top/, /mayer-multiple/   Indikatoren aus dem Zyklus-Kompass
//   /savings-plan/<id>/      Sparplan-Rückblick für die 40 größten Coins (100 $ pro Monat, 1000 $ einmalig) und eine Übersicht
//   sitemap.xml, robots.txt, feed.xml (RSS, englisch)
// Jede Seite verweist auf ihre Fassungen in den anderen Sprachen (hreflang), damit Google jedem Land die passende zeigt.
// Die Seiten sagen klar: keine Anlageberatung. Die Signale einzelner Coins bleiben wie in der App dem kostenlosen Konto
// vorbehalten – außer Bitcoin und Ethereum als Beispiel.
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

// Modell-Portfolio des Portfolio-Managers für den Sparplan-Rechner (scripts/model-curve.mjs) – fehlt es, zeigt der Rechner es nicht
try {
  const { buildCurve } = await import('./model-curve.mjs');
  const curve = await buildCurve();
  await mkdir(`${out}/data`, { recursive: true });
  await writeFile(`${out}/data/model-curve.json`, JSON.stringify(curve));
  console.log(`Modell-Portfolio: ${curve.stats.cagr} % pro Jahr seit ${new Date(curve.t[0]).toISOString().slice(0, 10)}`);
} catch (err) { console.log(`Modell-Portfolio nicht berechnet: ${err.message}`); }

// ---------- Tagesstand ----------
const snap = await (await fetch(`${SNAPSHOT}?t=${Date.now()}`)).json();
const { market, fng, coins, record } = snap;

// Zyklus-Kompass (scripts/indices.mjs) für die App und die Indikator-Seiten
let indices = null;
try {
  const { buildIndices } = await import('./indices.mjs');
  indices = await buildIndices(snap);
  await mkdir(`${out}/data`, { recursive: true });
  await writeFile(`${out}/data/indices.json`, JSON.stringify(indices));
  console.log(`Zyklus-Kompass: Zyklus-Risiko ${indices.risk.value}, Altcoin-Saison ${indices.altseason?.value}`);
} catch (err) { console.log(`Zyklus-Kompass nicht berechnet: ${err.message}`); }
const SAMPLES = ['bitcoin', 'ethereum'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const tone = (v) => (!isNum(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const slug = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]/g, '');
const iso = new Date(snap.time).toISOString();
const btcUp7 = market.forecast?.btc?.short?.up, btcUp30 = market.forecast?.btc?.medium?.up, altUp7 = market.forecast?.alt?.short?.up;
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
    idx: 'Market index', fng: 'Fear & Greed', ago7: (v) => `7 days ago ${v}`, cyc: 'Cycle (12 months)', belowAth: 'below Bitcoin’s all-time high', sig: 'Buy signals', ofRated: (n) => `of ${n} rated coins`,
    label: { 'Kaufen': 'Buy', 'Eher kaufen': 'Lean buy', 'Halten': 'Hold', 'Eher verkaufen': 'Lean sell', 'Verkaufen': 'Sell' },
    zone: { deep: 'deep in the cycle', low: 'lower third of the cycle', mid: 'middle of the cycle', high: 'near the high' },
    mood: ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed'],
    odds: (a, b) => `After comparable market days since 2018, Bitcoin was higher 7 days later in ${a} of 100 cases${isNum(b) ? ` and 30 days later in ${b} of 100` : ''}.`,
    tTitle: (d, l, v) => `Crypto market today (${d}): Fear & Greed, market index and outlook`,
    tDesc: (v, l, f, m, p) => `Is now a good time to buy crypto? Today’s crypto weather: market index ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Updated daily. Not financial advice.`,
    tH1: (l, v) => `Crypto market today: ${l} (${v}/100)`, tSub: (d) => `Crypto weather report for ${d} – updated every day.`,
    buyQ: 'Is now a good time to buy crypto?',
    tPara: (v, l, f, m, odds, alt) => `Nobody can know that for sure. What the data says today: Coinweather’s market index stands at <strong>${v} out of 100 – “${l}”</strong>. It combines Bitcoin’s market phase, market breadth and news sentiment and looks at the next few weeks. The Fear &amp; Greed index is at <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `For the average coin it was ${alt} of 100 after 7 days.` : ''} These are tendencies from past data, not promises.`,
    btcH: 'Bitcoin today', btcPara: (p, d1, d7, ath) => `Bitcoin trades at <strong>${p}</strong> (${d1} in 24 hours, ${d7} in 7 days) and is ${ath} % below its all-time high.`, btcLink: 'Bitcoin page →',
    movH: 'Top movers of the 100 largest coins (24 hours)', obs: 'Observations, not recommendations.', gain: 'Gainers', lose: 'Losers', price: 'Price', h24: '24 h', d7h: '7 days',
    recH: 'Open track record', recPara: (since, avg, up, n, b, mkt) => `Every buy signal of the site is re-measured. Since ${since}: after 7 days on average <strong>${avg}</strong>, ${up} of ${n} in profit (Bitcoin over the same period ${b}${mkt ? `, the average top-100 coin ${mkt}` : ''}). Since 24 October 2026 buy signals are limited to the 100 largest coins – the size range the model was tested on. Including the bad results – that is the point.`,
    tOffer: 'Which coins have a buy signal today?',
    cTitle: (n, s, d) => `${n} (${s}) price today and outlook – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} is at ${p} (${d1} in 24h, ${d7} in 7 days). Crypto market index ${v}/100 (${l}), Fear & Greed ${f}. Not financial advice.`,
    cH1: (n, s) => `${n} (${s}) today`, cSub: (d) => `Price, trend and crypto weather for ${d} – updated every day.`, rank: 'Rank',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} trades at <strong>${p}</strong>, ${d1} in the last 24 hours and ${d7} over 7 days. It is number ${r} by market capitalisation (${cap})${ath ? ` and ${ath} % below its all-time high of ${athP}` : ''}.`,
    period: 'Period', change: 'Change', periods: ['24 hours', '7 days', '30 days', '200 days', '1 year'],
    cBuyQ: (n) => `Is now a good time to buy ${n}?`,
    cPara2: (v, l, f, m, odds) => `Nobody can know that for sure. What the data says today: the overall crypto market index is <strong>${v}/100 (“${l}”)</strong> and the Fear &amp; Greed index is at ${f} (${m}). ${odds}`,
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
    fHist: 'Coinweather tested the daily index values since 2018 against what prices did afterwards, in two separate periods (2018–22 and 2022–26):',
    fLi: ['<strong>Extreme greed was a warning:</strong> when the 7-day average was between 75 and 85, the median coin was higher 30 days later in only 20–33 % of cases (median about −20 %). Coinweather gives no buy signals in that zone.',
      '<strong>Long fear in a deep market was an opportunity – for Bitcoin:</strong> after long periods of fear (at least 54 of 60 days below 45) with Bitcoin at least 40 % below its all-time high, Bitcoin was higher one year later in 84–100 % of cases. For the average altcoin this did not hold.',
      '<strong>On its own the index was no reliable timing signal</strong> – “buy fear, sell greed” as a simple rule did worse than following the market trend.'],
    fNow: (v, m, a) => `Today’s reading: <strong>${v} (${m})</strong>${a ? `, 7-day average ${a}` : ''}.`, brakeOn: 'The greed brake is active.', brakeOff: 'The greed brake is not active.',
    fIdx: (v, l) => `Coinweather’s overall market index stands at <strong>${v}/100 (“${l}”)</strong>.`, fOffer: 'See how fear and greed affect each of 1,000 coins',
    lTitle: (d) => `Crypto prices today: the 500 largest coins – ${d}`,
    lDesc: (v, l) => `Prices, 24-hour and 7-day changes of the 500 largest cryptocurrencies, plus today’s crypto weather: market index ${v}/100 (${l}). Updated daily.`,
    lH1: 'The 500 largest coins today', lSub: (d, v, l) => `Updated ${d}. Market index today: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Which of these coins have a buy signal today?',
  },
  de: {
    open: 'App öffnen', today: 'Kryptomarkt heute', fngNav: 'Fear & Greed Index', all: 'Alle Coins', risk: 'Risikohinweis', legal: 'Impressum', privacy: 'Datenschutz',
    foot: (d) => `Keine Anlageberatung. Coinweather ist ein Informationsdienst. Kurse lassen sich nicht sicher vorhersagen; die Wahrscheinlichkeiten beruhen auf vergangenen Kursen und können falsch liegen. Kryptowerte können stark fallen – bis zum Totalverlust. Stand ${d}.`,
    offer: 'Kostenloses Konto: Signal und Aussicht für 1000 Coins, Portfolio-Check und eine offene Erfolgskontrolle – 30 Tage alle Funktionen, ohne Zahlungsdaten.',
    start: 'Kostenlos starten', noSignup: 'Markt heute ansehen – ohne Anmeldung',
    idx: 'Markt-Index', fng: 'Fear & Greed', ago7: (v) => `vor 7 Tagen ${v}`, cyc: 'Zyklus (12 Monate)', belowAth: 'unter dem Allzeithoch von Bitcoin', sig: 'Kaufsignale', ofRated: (n) => `von ${n} bewerteten Coins`,
    label: { 'Kaufen': 'Kaufen', 'Eher kaufen': 'Eher kaufen', 'Halten': 'Halten', 'Eher verkaufen': 'Eher verkaufen', 'Verkaufen': 'Verkaufen' },
    zone: { deep: 'tief im Zyklus', low: 'unteres Drittel des Zyklus', mid: 'Mitte des Zyklus', high: 'nahe am Hoch' },
    mood: ['extreme Angst', 'Angst', 'neutral', 'Gier', 'extreme Gier'],
    odds: (a, b) => `Nach vergleichbaren Markttagen seit 2018 stand Bitcoin 7 Tage später in ${a} von 100 Fällen höher${isNum(b) ? `, 30 Tage später in ${b} von 100` : ''}.`,
    tTitle: (d) => `Kryptomarkt heute (${d}): Fear & Greed, Markt-Index und Aussicht`,
    tDesc: (v, l, f, m, p) => `Ist jetzt ein guter Zeitpunkt für Krypto? Das Krypto-Wetter heute: Markt-Index ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Täglich aktuell. Keine Anlageberatung.`,
    tH1: (l, v) => `Kryptomarkt heute: ${l} (${v}/100)`, tSub: (d) => `Krypto-Wetterbericht vom ${d} – täglich aktualisiert.`,
    buyQ: 'Ist jetzt ein guter Zeitpunkt, Krypto zu kaufen?',
    tPara: (v, l, f, m, odds, alt) => `Sicher wissen kann das niemand. Was die Daten heute sagen: Der Markt-Index von Coinweather steht bei <strong>${v} von 100 – „${l}“</strong>. Er verbindet die Marktphase von Bitcoin, die Marktbreite und die Nachrichtenlage und blickt auf die nächsten Wochen. Der Fear-&amp;-Greed-Index steht bei <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Beim mittleren Coin waren es nach 7 Tagen ${alt} von 100.` : ''} Das sind Tendenzen aus vergangenen Daten, keine Versprechen.`,
    btcH: 'Bitcoin heute', btcPara: (p, d1, d7, ath) => `Bitcoin steht bei <strong>${p}</strong> (${d1} in 24 Stunden, ${d7} in 7 Tagen) und ${ath} % unter seinem Allzeithoch.`, btcLink: 'Zur Bitcoin-Seite →',
    movH: 'Größte Bewegungen der 100 größten Coins (24 Stunden)', obs: 'Beobachtungen, keine Empfehlungen.', gain: 'Gewinner', lose: 'Verlierer', price: 'Kurs', h24: '24 h', d7h: '7 Tage',
    recH: 'Offene Erfolgskontrolle', recPara: (since, avg, up, n, b, mkt) => `Jedes Kaufsignal der Seite wird nachgemessen. Seit ${since}: nach 7 Tagen im Schnitt <strong>${avg}</strong>, ${up} von ${n} im Plus (Bitcoin im selben Zeitraum ${b}${mkt ? `, der Durchschnitt der Top 100 ${mkt}` : ''}). Seit dem 24. Oktober 2026 gibt es Kaufsignale nur für die 100 größten Coins – an solchen ist das Modell geprüft. Auch schlechte Ergebnisse stehen hier – genau darum geht es.`,
    tOffer: 'Welche Coins haben heute ein Kaufsignal?',
    cTitle: (n, s, d) => `${n} (${s}) Kurs heute und Aussicht – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} steht bei ${p} (${d1} in 24 h, ${d7} in 7 Tagen). Krypto-Markt-Index ${v}/100 (${l}), Fear & Greed ${f}. Keine Anlageberatung.`,
    cH1: (n, s) => `${n} (${s}) heute`, cSub: (d) => `Kurs, Entwicklung und Krypto-Wetter vom ${d} – täglich aktualisiert.`, rank: 'Rang',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} steht bei <strong>${p}</strong>, ${d1} in den letzten 24 Stunden und ${d7} über 7 Tage. Nach Marktwert ist der Coin die Nummer ${r} (${cap})${ath ? ` und liegt ${ath} % unter seinem Allzeithoch von ${athP}` : ''}.`,
    period: 'Zeitraum', change: 'Veränderung', periods: ['24 Stunden', '7 Tage', '30 Tage', '200 Tage', '1 Jahr'],
    cBuyQ: (n) => `Ist jetzt ein guter Zeitpunkt, ${n} zu kaufen?`,
    cPara2: (v, l, f, m, odds) => `Sicher wissen kann das niemand. Was die Daten heute sagen: Der Markt-Index für den ganzen Kryptomarkt steht bei <strong>${v}/100 („${l}“)</strong>, der Fear-&amp;-Greed-Index bei ${f} (${m}). ${odds}`,
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
    fHist: 'Coinweather hat die Tageswerte seit 2018 mit dem verglichen, was die Kurse danach taten, in zwei getrennten Zeiträumen (2018–22 und 2022–26):',
    fLi: ['<strong>Extreme Gier war eine Warnung:</strong> Lag der 7-Tage-Schnitt zwischen 75 und 85, stand der mittlere Coin 30 Tage später nur in 20–33 % der Fälle höher (im Mittel etwa −20 %). Coinweather gibt in dieser Zone keine Kaufsignale.',
      '<strong>Lange Angst in einem tiefen Markt war eine Gelegenheit – für Bitcoin:</strong> Nach langer Angst (mindestens 54 von 60 Tagen unter 45) und mit Bitcoin mindestens 40 % unter dem Allzeithoch stand Bitcoin ein Jahr später in 84–100 % der Fälle höher. Für den mittleren Altcoin galt das nicht.',
      '<strong>Allein war der Index kein verlässliches Signal</strong> – „bei Angst kaufen, bei Gier verkaufen“ als einfache Regel schnitt schlechter ab, als dem Markttrend zu folgen.'],
    fNow: (v, m, a) => `Heute: <strong>${v} (${m})</strong>${a ? `, 7-Tage-Schnitt ${a}` : ''}.`, brakeOn: 'Die Gier-Bremse ist aktiv.', brakeOff: 'Die Gier-Bremse ist nicht aktiv.',
    fIdx: (v, l) => `Der Markt-Index von Coinweather steht bei <strong>${v}/100 („${l}“)</strong>.`, fOffer: 'Sieh, wie Angst und Gier auf jeden der 1000 Coins wirken',
    lTitle: (d) => `Kryptokurse heute: die 500 größten Coins – ${d}`,
    lDesc: (v, l) => `Kurse und Veränderungen über 24 Stunden und 7 Tage der 500 größten Kryptowährungen, dazu das Krypto-Wetter: Markt-Index ${v}/100 (${l}). Täglich aktuell.`,
    lH1: 'Die 500 größten Coins heute', lSub: (d, v, l) => `Stand ${d}. Markt-Index heute: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Welche dieser Coins haben heute ein Kaufsignal?',
  },
  es: {
    open: 'Abrir la app', today: 'Mercado cripto hoy', fngNav: 'Índice Fear & Greed', all: 'Todas las monedas', risk: 'Aviso de riesgo', legal: 'Aviso legal', privacy: 'Privacidad',
    foot: (d) => `No es asesoramiento financiero. Coinweather es un servicio informativo. Los precios no se pueden predecir con seguridad; las probabilidades se basan en precios pasados y pueden fallar. Las criptomonedas pueden caer con fuerza, hasta la pérdida total. Actualizado el ${d}.`,
    offer: 'Cuenta gratuita: señal y perspectiva de 1000 monedas, revisión de cartera y un historial abierto, 30 días con todas las funciones, sin datos de pago.',
    start: 'Empezar gratis', noSignup: 'Ver el mercado de hoy, sin registro',
    idx: 'Índice de mercado', fng: 'Fear & Greed', ago7: (v) => `hace 7 días ${v}`, cyc: 'Ciclo (12 meses)', belowAth: 'por debajo del máximo histórico de Bitcoin', sig: 'Señales de compra', ofRated: (n) => `de ${n} monedas evaluadas`,
    label: { 'Kaufen': 'Comprar', 'Eher kaufen': 'Más bien comprar', 'Halten': 'Mantener', 'Eher verkaufen': 'Más bien vender', 'Verkaufen': 'Vender' },
    zone: { deep: 'en lo profundo del ciclo', low: 'tercio inferior del ciclo', mid: 'mitad del ciclo', high: 'cerca del máximo' },
    mood: ['miedo extremo', 'miedo', 'neutral', 'codicia', 'codicia extrema'],
    odds: (a, b) => `Tras días de mercado comparables desde 2018, Bitcoin estaba más alto 7 días después en ${a} de 100 casos${isNum(b) ? ` y 30 días después en ${b} de 100` : ''}.`,
    tTitle: (d) => `Mercado cripto hoy (${d}): Fear & Greed, índice de mercado y perspectiva`,
    tDesc: (v, l, f, m, p) => `¿Es buen momento para comprar cripto? El tiempo cripto de hoy: índice de mercado ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Actualizado a diario. No es asesoramiento financiero.`,
    tH1: (l, v) => `Mercado cripto hoy: ${l} (${v}/100)`, tSub: (d) => `Parte del tiempo cripto del ${d}, actualizado cada día.`,
    buyQ: '¿Es buen momento para comprar cripto?',
    tPara: (v, l, f, m, odds, alt) => `Nadie puede saberlo con certeza. Lo que dicen hoy los datos: el índice de mercado de Coinweather está en <strong>${v} de 100, «${l}»</strong>. Combina la fase de mercado de Bitcoin, la amplitud del mercado y el tono de las noticias, y mira las próximas semanas. El índice Fear &amp; Greed está en <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Para la moneda media fueron ${alt} de 100 tras 7 días.` : ''} Son tendencias de datos pasados, no promesas.`,
    btcH: 'Bitcoin hoy', btcPara: (p, d1, d7, ath) => `Bitcoin cotiza a <strong>${p}</strong> (${d1} en 24 horas, ${d7} en 7 días) y está un ${ath} % por debajo de su máximo histórico.`, btcLink: 'Página de Bitcoin →',
    movH: 'Mayores movimientos de las 100 monedas más grandes (24 horas)', obs: 'Observaciones, no recomendaciones.', gain: 'Ganadoras', lose: 'Perdedoras', price: 'Precio', h24: '24 h', d7h: '7 días',
    recH: 'Historial abierto', recPara: (since, avg, up, n, b, mkt) => `Cada señal de compra del sitio se vuelve a medir. Desde el ${since}: tras 7 días de media <strong>${avg}</strong>, ${up} de ${n} en positivo (Bitcoin en el mismo periodo ${b}${mkt ? `, la media del top 100 ${mkt}` : ''}). Desde el 24 de octubre de 2026 solo hay señales de compra para las 100 monedas más grandes, con las que se probó el modelo. También con los malos resultados: de eso se trata.`,
    tOffer: '¿Qué monedas tienen hoy una señal de compra?',
    cTitle: (n, s, d) => `${n} (${s}) precio hoy y perspectiva – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} está en ${p} (${d1} en 24 h, ${d7} en 7 días). Índice del mercado cripto ${v}/100 (${l}), Fear & Greed ${f}. No es asesoramiento financiero.`,
    cH1: (n, s) => `${n} (${s}) hoy`, cSub: (d) => `Precio, tendencia y tiempo cripto del ${d}, actualizado cada día.`, rank: 'Puesto',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} cotiza a <strong>${p}</strong>, ${d1} en las últimas 24 horas y ${d7} en 7 días. Es la número ${r} por capitalización (${cap})${ath ? ` y está un ${ath} % por debajo de su máximo histórico de ${athP}` : ''}.`,
    period: 'Periodo', change: 'Variación', periods: ['24 horas', '7 días', '30 días', '200 días', '1 año'],
    cBuyQ: (n) => `¿Es buen momento para comprar ${n}?`,
    cPara2: (v, l, f, m, odds) => `Nadie puede saberlo con certeza. Lo que dicen hoy los datos: el índice del mercado cripto está en <strong>${v}/100 («${l}»)</strong> y el índice Fear &amp; Greed en ${f} (${m}). ${odds}`,
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
    fHist: 'Coinweather comparó los valores diarios desde 2018 con lo que hicieron después los precios, en dos periodos separados (2018–22 y 2022–26):',
    fLi: ['<strong>La codicia extrema fue una advertencia:</strong> con una media de 7 días entre 75 y 85, la moneda media estaba más alta 30 días después solo en el 20–33 % de los casos (mediana de cerca de −20 %). Coinweather no da señales de compra en esa zona.',
      '<strong>El miedo largo en un mercado hundido fue una oportunidad, para Bitcoin:</strong> tras largos periodos de miedo (al menos 54 de 60 días por debajo de 45) con Bitcoin al menos un 40 % bajo su máximo, Bitcoin estaba más alto un año después en el 84–100 % de los casos. Para la altcoin media no fue así.',
      '<strong>Por sí solo, el índice no fue una señal fiable</strong>: «comprar con miedo, vender con codicia» como regla simple funcionó peor que seguir la tendencia del mercado.'],
    fNow: (v, m, a) => `Hoy: <strong>${v} (${m})</strong>${a ? `, media de 7 días ${a}` : ''}.`, brakeOn: 'El freno de codicia está activo.', brakeOff: 'El freno de codicia no está activo.',
    fIdx: (v, l) => `El índice de mercado de Coinweather está en <strong>${v}/100 («${l}»)</strong>.`, fOffer: 'Mira cómo afectan el miedo y la codicia a cada una de las 1000 monedas',
    lTitle: (d) => `Precios cripto hoy: las 500 monedas más grandes – ${d}`,
    lDesc: (v, l) => `Precios y variaciones de 24 horas y 7 días de las 500 criptomonedas más grandes, más el tiempo cripto de hoy: índice de mercado ${v}/100 (${l}). Actualizado a diario.`,
    lH1: 'Las 500 monedas más grandes hoy', lSub: (d, v, l) => `Actualizado el ${d}. Índice de mercado hoy: ${v}/100 – ${l}.`, coin: 'Moneda', lOffer: '¿Cuáles de estas monedas tienen hoy una señal de compra?',
  },
  fr: {
    open: 'Ouvrir l’app', today: 'Marché crypto aujourd’hui', fngNav: 'Indice Fear & Greed', all: 'Toutes les cryptos', risk: 'Avertissement sur les risques', legal: 'Mentions légales', privacy: 'Confidentialité',
    foot: (d) => `Pas un conseil en investissement. Coinweather est un service d’information. Les cours ne peuvent pas être prédits de façon sûre ; les probabilités reposent sur des cours passés et peuvent se tromper. Les cryptos peuvent chuter fortement, jusqu’à la perte totale. Mis à jour le ${d}.`,
    offer: 'Compte gratuit : signal et perspectives pour 1000 cryptos, bilan de portefeuille et suivi public – 30 jours avec toutes les fonctions, sans données de paiement.',
    start: 'Commencer gratuitement', noSignup: 'Voir le marché du jour – sans inscription',
    idx: 'Indice de marché', fng: 'Fear & Greed', ago7: (v) => `il y a 7 jours ${v}`, cyc: 'Cycle (12 mois)', belowAth: 'sous le record de Bitcoin', sig: 'Signaux d’achat', ofRated: (n) => `sur ${n} cryptos évaluées`,
    label: { 'Kaufen': 'Acheter', 'Eher kaufen': 'Plutôt acheter', 'Halten': 'Conserver', 'Eher verkaufen': 'Plutôt vendre', 'Verkaufen': 'Vendre' },
    zone: { deep: 'au creux du cycle', low: 'tiers inférieur du cycle', mid: 'milieu du cycle', high: 'près du sommet' },
    mood: ['peur extrême', 'peur', 'neutre', 'avidité', 'avidité extrême'],
    odds: (a, b) => `Après des jours de marché comparables depuis 2018, le Bitcoin était plus haut 7 jours plus tard dans ${a} cas sur 100${isNum(b) ? ` et 30 jours plus tard dans ${b} sur 100` : ''}.`,
    tTitle: (d) => `Marché crypto aujourd’hui (${d}) : Fear & Greed, indice de marché et perspectives`,
    tDesc: (v, l, f, m, p) => `Est-ce le bon moment pour acheter des cryptos ? La météo crypto du jour : indice de marché ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Mis à jour chaque jour. Pas un conseil en investissement.`,
    tH1: (l, v) => `Marché crypto aujourd’hui : ${l} (${v}/100)`, tSub: (d) => `Bulletin météo crypto du ${d} – mis à jour chaque jour.`,
    buyQ: 'Est-ce le bon moment pour acheter des cryptos ?',
    tPara: (v, l, f, m, odds, alt) => `Personne ne peut le savoir avec certitude. Ce que disent les données aujourd’hui : l’indice de marché de Coinweather est à <strong>${v} sur 100 – « ${l} »</strong>. Il combine la phase de marché du Bitcoin, l’étendue du marché et le ton des actualités, et regarde les prochaines semaines. L’indice Fear &amp; Greed est à <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Pour la crypto moyenne, c’était ${alt} sur 100 après 7 jours.` : ''} Ce sont des tendances issues de données passées, pas des promesses.`,
    btcH: 'Bitcoin aujourd’hui', btcPara: (p, d1, d7, ath) => `Le Bitcoin s’échange à <strong>${p}</strong> (${d1} sur 24 heures, ${d7} sur 7 jours) et se situe ${ath} % sous son record.`, btcLink: 'Page Bitcoin →',
    movH: 'Plus forts mouvements des 100 plus grandes cryptos (24 heures)', obs: 'Des observations, pas des recommandations.', gain: 'Hausses', lose: 'Baisses', price: 'Cours', h24: '24 h', d7h: '7 jours',
    recH: 'Suivi public', recPara: (since, avg, up, n, b, mkt) => `Chaque signal d’achat du site est re-mesuré. Depuis le ${since} : après 7 jours en moyenne <strong>${avg}</strong>, ${up} sur ${n} en hausse (Bitcoin sur la même période ${b}${mkt ? `, la moyenne du top 100 ${mkt}` : ''}). Depuis le 24 octobre 2026, les signaux d’achat ne concernent que les 100 plus grandes cryptos, celles sur lesquelles le modèle a été testé. Les mauvais résultats y figurent aussi – c’est tout l’intérêt.`,
    tOffer: 'Quelles cryptos ont un signal d’achat aujourd’hui ?',
    cTitle: (n, s, d) => `${n} (${s}) cours aujourd’hui et perspectives – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} est à ${p} (${d1} sur 24 h, ${d7} sur 7 jours). Indice du marché crypto ${v}/100 (${l}), Fear & Greed ${f}. Pas un conseil en investissement.`,
    cH1: (n, s) => `${n} (${s}) aujourd’hui`, cSub: (d) => `Cours, tendance et météo crypto du ${d} – mis à jour chaque jour.`, rank: 'Rang',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} s’échange à <strong>${p}</strong>, ${d1} sur les dernières 24 heures et ${d7} sur 7 jours. C’est la numéro ${r} par capitalisation (${cap})${ath ? ` et elle se situe ${ath} % sous son record de ${athP}` : ''}.`,
    period: 'Période', change: 'Variation', periods: ['24 heures', '7 jours', '30 jours', '200 jours', '1 an'],
    cBuyQ: (n) => `Est-ce le bon moment pour acheter ${n} ?`,
    cPara2: (v, l, f, m, odds) => `Personne ne peut le savoir avec certitude. Ce que disent les données aujourd’hui : l’indice du marché crypto est à <strong>${v}/100 (« ${l} »)</strong> et l’indice Fear &amp; Greed à ${f} (${m}). ${odds}`,
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
    fHist: 'Coinweather a comparé les valeurs quotidiennes depuis 2018 avec l’évolution des cours ensuite, sur deux périodes distinctes (2018–22 et 2022–26) :',
    fLi: ['<strong>L’avidité extrême était un avertissement :</strong> avec une moyenne sur 7 jours entre 75 et 85, la crypto médiane n’était plus haute 30 jours plus tard que dans 20–33 % des cas (médiane d’environ −20 %). Coinweather ne donne pas de signal d’achat dans cette zone.',
      '<strong>Une longue peur dans un marché au plus bas était une opportunité – pour le Bitcoin :</strong> après de longues périodes de peur (au moins 54 jours sur 60 sous 45) avec le Bitcoin au moins 40 % sous son record, le Bitcoin était plus haut un an plus tard dans 84–100 % des cas. Pas pour l’altcoin moyen.',
      '<strong>Seul, l’indice n’était pas un signal fiable</strong> – « acheter la peur, vendre l’avidité » comme règle simple a fait moins bien que suivre la tendance du marché.'],
    fNow: (v, m, a) => `Aujourd’hui : <strong>${v} (${m})</strong>${a ? `, moyenne sur 7 jours ${a}` : ''}.`, brakeOn: 'Le frein d’avidité est actif.', brakeOff: 'Le frein d’avidité n’est pas actif.',
    fIdx: (v, l) => `L’indice de marché de Coinweather est à <strong>${v}/100 (« ${l} »)</strong>.`, fOffer: 'Voir comment la peur et l’avidité agissent sur chacune des 1000 cryptos',
    lTitle: (d) => `Cours crypto aujourd’hui : les 500 plus grandes cryptos – ${d}`,
    lDesc: (v, l) => `Cours et variations sur 24 heures et 7 jours des 500 plus grandes cryptomonnaies, plus la météo crypto du jour : indice de marché ${v}/100 (${l}). Mis à jour chaque jour.`,
    lH1: 'Les 500 plus grandes cryptos aujourd’hui', lSub: (d, v, l) => `Mis à jour le ${d}. Indice de marché du jour : ${v}/100 – ${l}.`, coin: 'Crypto', lOffer: 'Lesquelles de ces cryptos ont un signal d’achat aujourd’hui ?',
  },
  it: {
    open: 'Apri l’app', today: 'Mercato crypto oggi', fngNav: 'Indice Fear & Greed', all: 'Tutti i coin', risk: 'Avvertenza sui rischi', legal: 'Note legali', privacy: 'Privacy',
    foot: (d) => `Non è una consulenza finanziaria. Coinweather è un servizio informativo. I prezzi non si possono prevedere con certezza; le probabilità si basano su prezzi passati e possono sbagliare. Le crypto possono crollare, fino alla perdita totale. Aggiornato il ${d}.`,
    offer: 'Account gratuito: segnale e prospettive per 1000 coin, controllo del portafoglio e track record pubblico – 30 giorni con tutte le funzioni, senza dati di pagamento.',
    start: 'Inizia gratis', noSignup: 'Vedi il mercato di oggi – senza registrazione',
    idx: 'Indice di mercato', fng: 'Fear & Greed', ago7: (v) => `7 giorni fa ${v}`, cyc: 'Ciclo (12 mesi)', belowAth: 'sotto il massimo storico di Bitcoin', sig: 'Segnali di acquisto', ofRated: (n) => `su ${n} coin valutati`,
    label: { 'Kaufen': 'Comprare', 'Eher kaufen': 'Piuttosto comprare', 'Halten': 'Mantenere', 'Eher verkaufen': 'Piuttosto vendere', 'Verkaufen': 'Vendere' },
    zone: { deep: 'in fondo al ciclo', low: 'terzo inferiore del ciclo', mid: 'metà del ciclo', high: 'vicino al massimo' },
    mood: ['paura estrema', 'paura', 'neutrale', 'avidità', 'avidità estrema'],
    odds: (a, b) => `Dopo giorni di mercato simili dal 2018, Bitcoin era più alto 7 giorni dopo in ${a} casi su 100${isNum(b) ? ` e 30 giorni dopo in ${b} su 100` : ''}.`,
    tTitle: (d) => `Mercato crypto oggi (${d}): Fear & Greed, indice di mercato e prospettive`,
    tDesc: (v, l, f, m, p) => `È un buon momento per comprare crypto? Il meteo crypto di oggi: indice di mercato ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Aggiornato ogni giorno. Non è una consulenza finanziaria.`,
    tH1: (l, v) => `Mercato crypto oggi: ${l} (${v}/100)`, tSub: (d) => `Bollettino meteo crypto del ${d} – aggiornato ogni giorno.`,
    buyQ: 'È un buon momento per comprare crypto?',
    tPara: (v, l, f, m, odds, alt) => `Nessuno può saperlo con certezza. Cosa dicono oggi i dati: l’indice di mercato di Coinweather è a <strong>${v} su 100 – «${l}»</strong>. Combina la fase di mercato di Bitcoin, l’ampiezza del mercato e il tono delle notizie e guarda alle prossime settimane. L’indice Fear &amp; Greed è a <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Per il coin medio erano ${alt} su 100 dopo 7 giorni.` : ''} Sono tendenze dai dati passati, non promesse.`,
    btcH: 'Bitcoin oggi', btcPara: (p, d1, d7, ath) => `Bitcoin quota <strong>${p}</strong> (${d1} in 24 ore, ${d7} in 7 giorni) ed è del ${ath} % sotto il suo massimo storico.`, btcLink: 'Pagina di Bitcoin →',
    movH: 'Maggiori movimenti dei 100 coin più grandi (24 ore)', obs: 'Osservazioni, non raccomandazioni.', gain: 'In rialzo', lose: 'In ribasso', price: 'Prezzo', h24: '24 h', d7h: '7 giorni',
    recH: 'Track record pubblico', recPara: (since, avg, up, n, b, mkt) => `Ogni segnale di acquisto del sito viene rimisurato. Dal ${since}: dopo 7 giorni in media <strong>${avg}</strong>, ${up} su ${n} in positivo (Bitcoin nello stesso periodo ${b}${mkt ? `, la media della top 100 ${mkt}` : ''}). Dal 24 ottobre 2026 i segnali di acquisto valgono solo per i 100 coin più grandi, quelli su cui il modello è stato testato. Anche i risultati negativi restano qui: è proprio questo il punto.`,
    tOffer: 'Quali coin hanno oggi un segnale di acquisto?',
    cTitle: (n, s, d) => `${n} (${s}) prezzo oggi e prospettive – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} è a ${p} (${d1} in 24 h, ${d7} in 7 giorni). Indice del mercato crypto ${v}/100 (${l}), Fear & Greed ${f}. Non è una consulenza finanziaria.`,
    cH1: (n, s) => `${n} (${s}) oggi`, cSub: (d) => `Prezzo, andamento e meteo crypto del ${d} – aggiornato ogni giorno.`, rank: 'Posizione',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} quota <strong>${p}</strong>, ${d1} nelle ultime 24 ore e ${d7} in 7 giorni. È il numero ${r} per capitalizzazione (${cap})${ath ? ` ed è del ${ath} % sotto il suo massimo storico di ${athP}` : ''}.`,
    period: 'Periodo', change: 'Variazione', periods: ['24 ore', '7 giorni', '30 giorni', '200 giorni', '1 anno'],
    cBuyQ: (n) => `È un buon momento per comprare ${n}?`,
    cPara2: (v, l, f, m, odds) => `Nessuno può saperlo con certezza. Cosa dicono oggi i dati: l’indice del mercato crypto è a <strong>${v}/100 («${l}»)</strong> e l’indice Fear &amp; Greed a ${f} (${m}). ${odds}`,
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
    fHist: 'Coinweather ha confrontato i valori giornalieri dal 2018 con l’andamento successivo dei prezzi, in due periodi separati (2018–22 e 2022–26):',
    fLi: ['<strong>L’avidità estrema era un segnale d’allarme:</strong> con una media a 7 giorni tra 75 e 85, il coin mediano era più alto 30 giorni dopo solo nel 20–33 % dei casi (mediana di circa −20 %). In quella zona Coinweather non dà segnali di acquisto.',
      '<strong>Una lunga paura in un mercato molto basso era un’occasione – per Bitcoin:</strong> dopo lunghi periodi di paura (almeno 54 giorni su 60 sotto 45) con Bitcoin almeno il 40 % sotto il massimo, Bitcoin era più alto un anno dopo nell’84–100 % dei casi. Per l’altcoin medio non è stato così.',
      '<strong>Da solo l’indice non era un segnale affidabile</strong>: «comprare con la paura, vendere con l’avidità» come regola semplice ha reso meno che seguire il trend del mercato.'],
    fNow: (v, m, a) => `Oggi: <strong>${v} (${m})</strong>${a ? `, media a 7 giorni ${a}` : ''}.`, brakeOn: 'Il freno all’avidità è attivo.', brakeOff: 'Il freno all’avidità non è attivo.',
    fIdx: (v, l) => `L’indice di mercato di Coinweather è a <strong>${v}/100 («${l}»)</strong>.`, fOffer: 'Guarda come paura e avidità agiscono su ciascuno dei 1000 coin',
    lTitle: (d) => `Prezzi crypto oggi: i 500 coin più grandi – ${d}`,
    lDesc: (v, l) => `Prezzi e variazioni a 24 ore e 7 giorni delle 500 criptovalute più grandi, più il meteo crypto di oggi: indice di mercato ${v}/100 (${l}). Aggiornato ogni giorno.`,
    lH1: 'I 500 coin più grandi oggi', lSub: (d, v, l) => `Aggiornato il ${d}. Indice di mercato oggi: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Quali di questi coin hanno oggi un segnale di acquisto?',
  },
  pt: {
    open: 'Abrir o app', today: 'Mercado cripto hoje', fngNav: 'Índice Fear & Greed', all: 'Todas as moedas', risk: 'Aviso de risco', legal: 'Aviso legal', privacy: 'Privacidade',
    foot: (d) => `Não é recomendação de investimento. O Coinweather é um serviço informativo. Os preços não podem ser previstos com segurança; as probabilidades se baseiam em preços passados e podem errar. Criptoativos podem cair muito, até a perda total. Atualizado em ${d}.`,
    offer: 'Conta gratuita: sinal e perspectiva de 1000 moedas, checagem da carteira e um histórico aberto – 30 dias com todos os recursos, sem dados de pagamento.',
    start: 'Começar grátis', noSignup: 'Ver o mercado de hoje – sem cadastro',
    idx: 'Índice de mercado', fng: 'Fear & Greed', ago7: (v) => `há 7 dias ${v}`, cyc: 'Ciclo (12 meses)', belowAth: 'abaixo da máxima histórica do Bitcoin', sig: 'Sinais de compra', ofRated: (n) => `de ${n} moedas avaliadas`,
    label: { 'Kaufen': 'Comprar', 'Eher kaufen': 'Tendência de compra', 'Halten': 'Manter', 'Eher verkaufen': 'Tendência de venda', 'Verkaufen': 'Vender' },
    zone: { deep: 'no fundo do ciclo', low: 'terço inferior do ciclo', mid: 'meio do ciclo', high: 'perto da máxima' },
    mood: ['medo extremo', 'medo', 'neutro', 'ganância', 'ganância extrema'],
    odds: (a, b) => `Depois de dias de mercado parecidos desde 2018, o Bitcoin estava mais alto 7 dias depois em ${a} de 100 casos${isNum(b) ? ` e 30 dias depois em ${b} de 100` : ''}.`,
    tTitle: (d) => `Mercado cripto hoje (${d}): Fear & Greed, índice de mercado e perspectiva`,
    tDesc: (v, l, f, m, p) => `É um bom momento para comprar cripto? A previsão cripto de hoje: índice de mercado ${v}/100 (${l}), Fear & Greed ${f} (${m}), Bitcoin ${p}. Atualizado diariamente. Não é recomendação de investimento.`,
    tH1: (l, v) => `Mercado cripto hoje: ${l} (${v}/100)`, tSub: (d) => `Previsão do tempo cripto de ${d} – atualizada todos os dias.`,
    buyQ: 'É um bom momento para comprar cripto?',
    tPara: (v, l, f, m, odds, alt) => `Ninguém pode saber com certeza. O que os dados dizem hoje: o índice de mercado do Coinweather está em <strong>${v} de 100 – “${l}”</strong>. Ele combina a fase de mercado do Bitcoin, a amplitude do mercado e o tom das notícias e olha para as próximas semanas. O índice Fear &amp; Greed está em <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Para a moeda média foram ${alt} de 100 após 7 dias.` : ''} São tendências de dados passados, não promessas.`,
    btcH: 'Bitcoin hoje', btcPara: (p, d1, d7, ath) => `O Bitcoin está cotado a <strong>${p}</strong> (${d1} em 24 horas, ${d7} em 7 dias) e ${ath} % abaixo da sua máxima histórica.`, btcLink: 'Página do Bitcoin →',
    movH: 'Maiores movimentos das 100 maiores moedas (24 horas)', obs: 'Observações, não recomendações.', gain: 'Em alta', lose: 'Em baixa', price: 'Preço', h24: '24 h', d7h: '7 dias',
    recH: 'Histórico aberto', recPara: (since, avg, up, n, b, mkt) => `Cada sinal de compra do site é medido de novo. Desde ${since}: após 7 dias em média <strong>${avg}</strong>, ${up} de ${n} no positivo (Bitcoin no mesmo período ${b}${mkt ? `, a média do top 100 ${mkt}` : ''}). Desde 24 de outubro de 2026 só há sinais de compra para as 100 maiores moedas, nas quais o modelo foi testado. Os resultados ruins também ficam aqui – é esse o objetivo.`,
    tOffer: 'Quais moedas têm sinal de compra hoje?',
    cTitle: (n, s, d) => `${n} (${s}) preço hoje e perspectiva – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} está em ${p} (${d1} em 24 h, ${d7} em 7 dias). Índice do mercado cripto ${v}/100 (${l}), Fear & Greed ${f}. Não é recomendação de investimento.`,
    cH1: (n, s) => `${n} (${s}) hoje`, cSub: (d) => `Preço, tendência e previsão cripto de ${d} – atualizado todos os dias.`, rank: 'Posição',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} está cotada a <strong>${p}</strong>, ${d1} nas últimas 24 horas e ${d7} em 7 dias. É a número ${r} em capitalização (${cap})${ath ? ` e está ${ath} % abaixo da sua máxima histórica de ${athP}` : ''}.`,
    period: 'Período', change: 'Variação', periods: ['24 horas', '7 dias', '30 dias', '200 dias', '1 ano'],
    cBuyQ: (n) => `É um bom momento para comprar ${n}?`,
    cPara2: (v, l, f, m, odds) => `Ninguém pode saber com certeza. O que os dados dizem hoje: o índice do mercado cripto está em <strong>${v}/100 (“${l}”)</strong> e o índice Fear &amp; Greed em ${f} (${m}). ${odds}`,
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
    fHist: 'O Coinweather comparou os valores diários desde 2018 com o que os preços fizeram depois, em dois períodos separados (2018–22 e 2022–26):',
    fLi: ['<strong>A ganância extrema foi um alerta:</strong> com a média de 7 dias entre 75 e 85, a moeda mediana estava mais alta 30 dias depois em apenas 20–33 % dos casos (mediana de cerca de −20 %). O Coinweather não dá sinais de compra nessa zona.',
      '<strong>Medo longo num mercado no fundo foi uma oportunidade – para o Bitcoin:</strong> depois de longos períodos de medo (pelo menos 54 de 60 dias abaixo de 45) com o Bitcoin pelo menos 40 % abaixo da máxima, o Bitcoin estava mais alto um ano depois em 84–100 % dos casos. Para a altcoin média isso não valeu.',
      '<strong>Sozinho, o índice não foi um sinal confiável</strong> – “comprar no medo, vender na ganância” como regra simples foi pior do que seguir a tendência do mercado.'],
    fNow: (v, m, a) => `Hoje: <strong>${v} (${m})</strong>${a ? `, média de 7 dias ${a}` : ''}.`, brakeOn: 'O freio de ganância está ativo.', brakeOff: 'O freio de ganância não está ativo.',
    fIdx: (v, l) => `O índice de mercado do Coinweather está em <strong>${v}/100 (“${l}”)</strong>.`, fOffer: 'Veja como medo e ganância afetam cada uma das 1000 moedas',
    lTitle: (d) => `Preços cripto hoje: as 500 maiores moedas – ${d}`,
    lDesc: (v, l) => `Preços e variações de 24 horas e 7 dias das 500 maiores criptomoedas, mais a previsão cripto de hoje: índice de mercado ${v}/100 (${l}). Atualizado diariamente.`,
    lH1: 'As 500 maiores moedas hoje', lSub: (d, v, l) => `Atualizado em ${d}. Índice de mercado hoje: ${v}/100 – ${l}.`, coin: 'Moeda', lOffer: 'Quais dessas moedas têm sinal de compra hoje?',
  },
  tr: {
    open: 'Uygulamayı aç', today: 'Bugün kripto piyasası', fngNav: 'Korku ve Açgözlülük Endeksi', all: 'Tüm coinler', risk: 'Risk uyarısı', legal: 'Künye', privacy: 'Gizlilik',
    foot: (d) => `Yatırım tavsiyesi değildir. Coinweather bir bilgi hizmetidir. Fiyatlar kesin olarak tahmin edilemez; olasılıklar geçmiş fiyatlara dayanır ve yanılabilir. Kripto varlıklar sert düşebilir – tamamen değer kaybına kadar. Güncelleme: ${d}.`,
    offer: 'Ücretsiz hesap: 1000 coin için sinyal ve görünüm, portföy kontrolü ve açık performans kaydı – 30 gün tüm özellikler, ödeme bilgisi olmadan.',
    start: 'Ücretsiz başla', noSignup: 'Bugünkü piyasayı gör – kayıt olmadan',
    idx: 'Piyasa endeksi', fng: 'Korku ve Açgözlülük', ago7: (v) => `7 gün önce ${v}`, cyc: 'Döngü (12 ay)', belowAth: 'Bitcoin’in zirvesinin altında', sig: 'Alım sinyalleri', ofRated: (n) => `değerlendirilen ${n} coinden`,
    label: { 'Kaufen': 'Al', 'Eher kaufen': 'Almaya yakın', 'Halten': 'Tut', 'Eher verkaufen': 'Satmaya yakın', 'Verkaufen': 'Sat' },
    zone: { deep: 'döngünün dibinde', low: 'döngünün alt üçte biri', mid: 'döngünün ortası', high: 'zirveye yakın' },
    mood: ['aşırı korku', 'korku', 'nötr', 'açgözlülük', 'aşırı açgözlülük'],
    odds: (a, b) => `2018’den bu yana benzer piyasa günlerinden sonra Bitcoin 7 gün sonra 100 vakanın ${a} tanesinde daha yüksekti${isNum(b) ? `, 30 gün sonra 100 vakanın ${b} tanesinde` : ''}.`,
    tTitle: (d) => `Bugün kripto piyasası (${d}): Korku ve Açgözlülük, piyasa endeksi ve görünüm`,
    tDesc: (v, l, f, m, p) => `Kripto almak için iyi bir zaman mı? Bugünün kripto hava durumu: piyasa endeksi ${v}/100 (${l}), Korku ve Açgözlülük ${f} (${m}), Bitcoin ${p}. Her gün güncellenir. Yatırım tavsiyesi değildir.`,
    tH1: (l, v) => `Bugün kripto piyasası: ${l} (${v}/100)`, tSub: (d) => `${d} tarihli kripto hava durumu – her gün güncellenir.`,
    buyQ: 'Kripto almak için iyi bir zaman mı?',
    tPara: (v, l, f, m, odds, alt) => `Bunu kimse kesin olarak bilemez. Verilerin bugün söyledikleri: Coinweather piyasa endeksi <strong>100 üzerinden ${v} – “${l}”</strong>. Bitcoin’in piyasa evresini, piyasa genişliğini ve haber tonunu birleştirir ve önümüzdeki haftalara bakar. Korku ve Açgözlülük Endeksi <strong>${f}</strong> (${m}). ${odds} ${isNum(alt) ? `Ortalama coin için 7 gün sonra 100 vakanın ${alt} tanesiydi.` : ''} Bunlar geçmiş verilerden eğilimlerdir, vaat değildir.`,
    btcH: 'Bugün Bitcoin', btcPara: (p, d1, d7, ath) => `Bitcoin <strong>${p}</strong> seviyesinde (24 saatte ${d1}, 7 günde ${d7}) ve tüm zamanların zirvesinin %${ath} altında.`, btcLink: 'Bitcoin sayfası →',
    movH: 'En büyük 100 coinin en büyük hareketleri (24 saat)', obs: 'Gözlemdir, tavsiye değildir.', gain: 'Yükselenler', lose: 'Düşenler', price: 'Fiyat', h24: '24 sa', d7h: '7 gün',
    recH: 'Açık performans kaydı', recPara: (since, avg, up, n, b, mkt) => `Sitenin her alım sinyali yeniden ölçülür. ${since} tarihinden beri: 7 gün sonra ortalama <strong>${avg}</strong>, ${n} sinyalin ${up} tanesi artıda (aynı dönemde Bitcoin ${b}${mkt ? `, ilk 100 ortalaması ${mkt}` : ''}). 24 Ekim 2026’dan beri alım sinyalleri yalnızca modelin test edildiği en büyük 100 coin için verilir. Kötü sonuçlar da burada – asıl mesele bu.`,
    tOffer: 'Bugün hangi coinlerin alım sinyali var?',
    cTitle: (n, s, d) => `${n} (${s}) bugün fiyat ve görünüm – ${d}`,
    cDesc: (n, p, d1, d7, v, l, f) => `${n} ${p} seviyesinde (24 saatte ${d1}, 7 günde ${d7}). Kripto piyasa endeksi ${v}/100 (${l}), Korku ve Açgözlülük ${f}. Yatırım tavsiyesi değildir.`,
    cH1: (n, s) => `Bugün ${n} (${s})`, cSub: (d) => `${d} tarihli fiyat, eğilim ve kripto hava durumu – her gün güncellenir.`, rank: 'Sıra',
    cPara: (n, p, d1, d7, r, cap, ath, athP) => `${n} <strong>${p}</strong> seviyesinde; son 24 saatte ${d1}, 7 günde ${d7}. Piyasa değerine göre ${r}. sırada (${cap})${ath ? ` ve ${athP} olan zirvesinin %${ath} altında` : ''}.`,
    period: 'Dönem', change: 'Değişim', periods: ['24 saat', '7 gün', '30 gün', '200 gün', '1 yıl'],
    cBuyQ: (n) => `${n} almak için iyi bir zaman mı?`,
    cPara2: (v, l, f, m, odds) => `Bunu kimse kesin olarak bilemez. Verilerin bugün söyledikleri: genel kripto piyasa endeksi <strong>${v}/100 (“${l}”)</strong>, Korku ve Açgözlülük Endeksi ${f} (${m}). ${odds}`,
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
    fHist: 'Coinweather 2018’den beri günlük değerleri sonrasında fiyatların ne yaptığıyla iki ayrı dönemde (2018–22 ve 2022–26) karşılaştırdı:',
    fLi: ['<strong>Aşırı açgözlülük bir uyarıydı:</strong> 7 günlük ortalama 75 ile 85 arasındayken ortanca coin 30 gün sonra vakaların yalnızca %20–33’ünde daha yüksekti (ortanca yaklaşık −%20). Coinweather bu bölgede alım sinyali vermez.',
      '<strong>Dipteki bir piyasada uzun korku bir fırsattı – Bitcoin için:</strong> uzun korku dönemlerinden sonra (60 günün en az 54’ünde 45’in altında) ve Bitcoin zirvesinin en az %40 altındayken, Bitcoin bir yıl sonra vakaların %84–100’ünde daha yüksekti. Ortalama altcoin için bu geçerli olmadı.',
      '<strong>Endeks tek başına güvenilir bir sinyal değildi</strong> – basit bir kural olarak “korkuda al, açgözlülükte sat” piyasa trendini izlemekten daha kötü sonuç verdi.'],
    fNow: (v, m, a) => `Bugün: <strong>${v} (${m})</strong>${a ? `, 7 günlük ortalama ${a}` : ''}.`, brakeOn: 'Açgözlülük freni etkin.', brakeOff: 'Açgözlülük freni etkin değil.',
    fIdx: (v, l) => `Coinweather piyasa endeksi <strong>${v}/100 (“${l}”)</strong>.`, fOffer: 'Korku ve açgözlülüğün 1000 coinin her birini nasıl etkilediğini gör',
    lTitle: (d) => `Bugün kripto fiyatları: en büyük 500 coin – ${d}`,
    lDesc: (v, l) => `En büyük 500 kripto paranın fiyatları, 24 saatlik ve 7 günlük değişimleri ile bugünkü kripto hava durumu: piyasa endeksi ${v}/100 (${l}). Her gün güncellenir.`,
    lH1: 'Bugün en büyük 500 coin', lSub: (d, v, l) => `Güncelleme: ${d}. Bugünkü piyasa endeksi: ${v}/100 – ${l}.`, coin: 'Coin', lOffer: 'Bu coinlerden hangilerinin bugün alım sinyali var?',
  },
};
// ---------- Indikator-Seiten (Zyklus-Kompass) ----------
const IX = {
  en: { nav: 'Cycle Compass', label: { Tief: 'deep', Günstig: 'cheap', Neutral: 'neutral', Erhitzt: 'heated', Überhitzt: 'overheated' },
    season: (v) => (v >= 75 ? 'altcoin season' : v <= 25 ? 'Bitcoin season' : 'transition'),
    riskT: (v, l, d) => `Bitcoin cycle risk today: ${v}/100 (${l}) – ${d}`, riskD: (v, l) => `Coinweather’s cycle risk index combines Mayer Multiple, 2-year MA, Pi Cycle, distance to the all-time high and Fear & Greed: today ${v}/100 (${l}). With an honest backtest. Not financial advice.`,
    riskH: (v, l) => `Bitcoin cycle risk today: ${v}/100 – ${l}`, riskP: 'Our own index from 0 (deep, cheap) to 100 (overheated): the average of five well-known cycle components. Tested on Bitcoin daily prices since 2017, separately for 2018–22 and 2022–26.',
    riskBt: (a, b) => `After readings like today, Bitcoin was higher one year later in ${a} (2018–22) and ${b} (2022–26) of cases.`,
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
    riskH: (v, l) => `Bitcoin Zyklus-Risiko heute: ${v}/100 – ${l}`, riskP: 'Unser eigener Index von 0 (tief, günstig) bis 100 (überhitzt): der Mittelwert aus fünf bekannten Zyklus-Bausteinen. Geprüft an Bitcoin-Tageskursen seit 2017, getrennt für 2018–22 und 2022–26.',
    riskBt: (a, b) => `Nach Ständen wie heute stand Bitcoin ein Jahr später in ${a} (2018–22) bzw. ${b} (2022–26) der Fälle höher.`,
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
    riskH: (v, l) => `Riesgo del ciclo de Bitcoin hoy: ${v}/100 – ${l}`, riskP: 'Nuestro propio índice de 0 (bajo, barato) a 100 (sobrecalentado): la media de cinco componentes de ciclo conocidos. Probado con precios diarios de Bitcoin desde 2017, por separado para 2018–22 y 2022–26.',
    riskBt: (a, b) => `Tras niveles como el de hoy, Bitcoin estaba más alto un año después en el ${a} (2018–22) y el ${b} (2022–26) de los casos.`,
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
    riskH: (v, l) => `Risque de cycle du Bitcoin aujourd’hui : ${v}/100 – ${l}`, riskP: 'Notre propre indice de 0 (bas, bon marché) à 100 (surchauffé) : la moyenne de cinq composantes de cycle connues. Testé sur les cours quotidiens du Bitcoin depuis 2017, séparément pour 2018–22 et 2022–26.',
    riskBt: (a, b) => `Après des niveaux comme aujourd’hui, Bitcoin était plus haut un an plus tard dans ${a} (2018–22) et ${b} (2022–26) des cas.`,
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
    riskH: (v, l) => `Rischio di ciclo di Bitcoin oggi: ${v}/100 – ${l}`, riskP: 'Il nostro indice da 0 (basso, conveniente) a 100 (surriscaldato): la media di cinque componenti di ciclo note. Testato sui prezzi giornalieri di Bitcoin dal 2017, separatamente per 2018–22 e 2022–26.',
    riskBt: (a, b) => `Dopo livelli come oggi, Bitcoin era più alto un anno dopo nel ${a} (2018–22) e nel ${b} (2022–26) dei casi.`,
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
    riskH: (v, l) => `Risco do ciclo do Bitcoin hoje: ${v}/100 – ${l}`, riskP: 'Nosso próprio índice de 0 (baixo, barato) a 100 (superaquecido): a média de cinco componentes de ciclo conhecidos. Testado com preços diários do Bitcoin desde 2017, separadamente para 2018–22 e 2022–26.',
    riskBt: (a, b) => `Depois de níveis como o de hoje, o Bitcoin estava mais alto um ano depois em ${a} (2018–22) e ${b} (2022–26) dos casos.`,
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
    riskH: (v, l) => `Bugün Bitcoin döngü riski: ${v}/100 – ${l}`, riskP: 'Kendi endeksimiz 0 (dip, ucuz) ile 100 (aşırı ısınmış) arasında: bilinen beş döngü bileşeninin ortalaması. 2017’den beri Bitcoin günlük fiyatlarında, 2018–22 ve 2022–26 için ayrı ayrı test edildi.',
    riskBt: (a, b) => `Bugünkü gibi seviyelerden sonra Bitcoin bir yıl sonra vakaların ${a} (2018–22) ve ${b} (2022–26) kadarında daha yüksekti.`,
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
  en: { nav: 'Widget for your website', t: 'Free crypto weather widget for your website', d: 'Embed today’s crypto weather on your blog or website: market index, Fear & Greed and Bitcoin – free, updated every 15 minutes, one line of code.',
    h: 'Free crypto weather widget', p: 'Show your readers today’s crypto weather – market index, Fear & Greed and Bitcoin, updated every 15 minutes. Free, no sign-up, one line of code. Copy the code into your page:', dark: 'Dark', light: 'Light' },
  de: { nav: 'Kästchen für deine Webseite', t: 'Kostenloses Krypto-Wetter-Widget für deine Webseite', d: 'Bau das Krypto-Wetter von heute in deinen Blog oder deine Webseite ein: Markt-Index, Fear & Greed und Bitcoin – kostenlos, alle 15 Minuten aktuell, eine Zeile Code.',
    h: 'Kostenloses Krypto-Wetter-Widget', p: 'Zeig deinen Lesern das Krypto-Wetter von heute – Markt-Index, Fear & Greed und Bitcoin, alle 15 Minuten aktuell. Kostenlos, ohne Anmeldung, eine Zeile Code. Kopiere den Code in deine Seite:', dark: 'Dunkel', light: 'Hell' },
  es: { nav: 'Widget para tu web', t: 'Widget gratuito del tiempo cripto para tu web', d: 'Integra el tiempo cripto de hoy en tu blog o web: índice de mercado, Fear & Greed y Bitcoin, gratis, actualizado cada 15 minutos, una línea de código.',
    h: 'Widget gratuito del tiempo cripto', p: 'Muestra a tus lectores el tiempo cripto de hoy: índice de mercado, Fear & Greed y Bitcoin, actualizado cada 15 minutos. Gratis, sin registro, una línea de código. Copia el código en tu página:', dark: 'Oscuro', light: 'Claro' },
  fr: { nav: 'Widget pour ton site', t: 'Widget météo crypto gratuit pour ton site', d: 'Intègre la météo crypto du jour sur ton blog ou ton site : indice de marché, Fear & Greed et Bitcoin – gratuit, mis à jour toutes les 15 minutes, une ligne de code.',
    h: 'Widget météo crypto gratuit', p: 'Montre à tes lecteurs la météo crypto du jour – indice de marché, Fear & Greed et Bitcoin, mis à jour toutes les 15 minutes. Gratuit, sans inscription, une ligne de code. Copie le code dans ta page :', dark: 'Sombre', light: 'Clair' },
  it: { nav: 'Widget per il tuo sito', t: 'Widget gratuito del meteo crypto per il tuo sito', d: 'Integra il meteo crypto di oggi nel tuo blog o sito: indice di mercato, Fear & Greed e Bitcoin – gratis, aggiornato ogni 15 minuti, una riga di codice.',
    h: 'Widget gratuito del meteo crypto', p: 'Mostra ai tuoi lettori il meteo crypto di oggi – indice di mercato, Fear & Greed e Bitcoin, aggiornato ogni 15 minuti. Gratis, senza registrazione, una riga di codice. Copia il codice nella tua pagina:', dark: 'Scuro', light: 'Chiaro' },
  pt: { nav: 'Widget para o seu site', t: 'Widget gratuito da previsão cripto para o seu site', d: 'Incorpore a previsão cripto de hoje no seu blog ou site: índice de mercado, Fear & Greed e Bitcoin – grátis, atualizado a cada 15 minutos, uma linha de código.',
    h: 'Widget gratuito da previsão cripto', p: 'Mostre aos seus leitores a previsão cripto de hoje – índice de mercado, Fear & Greed e Bitcoin, atualizada a cada 15 minutos. Grátis, sem cadastro, uma linha de código. Copie o código para a sua página:', dark: 'Escuro', light: 'Claro' },
  tr: { nav: 'Web siten için widget', t: 'Web siten için ücretsiz kripto hava durumu widget’ı', d: 'Bugünün kripto hava durumunu blog veya web sitene yerleştir: piyasa endeksi, Korku ve Açgözlülük ve Bitcoin – ücretsiz, 15 dakikada bir güncel, tek satır kod.',
    h: 'Ücretsiz kripto hava durumu widget’ı', p: 'Okuyucularına bugünün kripto hava durumunu göster – piyasa endeksi, Korku ve Açgözlülük ve Bitcoin, 15 dakikada bir güncel. Ücretsiz, kayıt yok, tek satır kod. Kodu sayfana kopyala:', dark: 'Koyu', light: 'Açık' },
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
.langs a{margin-right:10px}.share a{margin-right:12px;font-weight:700;text-decoration:none}`;

// ---------- Seiten einer Sprache ----------
const pages = [];   // { lang, key, path, html }
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
  const add = (key, path, title, description, body) => pages.push({ lang, key, path: `${pre}${path}`, title, description, body, day, L, app });
  const offer = (text) => `<section class="panel cta"><strong>${text}</strong><p class="muted">${L.offer}</p>
    <p><a class="btn" href="${app('#/konto')}">${L.start}</a> <a class="btn ghost" href="${app()}">${L.noSignup}</a></p></section>`;
  const stats = () => `<div class="grid">
    <div class="panel stat"><div class="l">${L.idx}</div><div class="v">${market.value}/100</div><div>${esc(label)}</div></div>
    ${fng ? `<div class="panel stat"><div class="l">${esc(L.fng)}</div><div class="v">${fng.value}</div><div>${mood(fng.value)}${isNum(fng.week) ? ` · ${L.ago7(fng.week)}` : ''}</div></div>` : ''}
    ${market.cycle ? `<div class="panel stat"><div class="l">${L.cyc}</div><div class="v">${num(-market.cycle.dd, 0)} %</div><div>${L.belowAth} · ${L.zone[market.cycle.zone] ?? ''}</div></div>` : ''}
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
    ${offer(L.tOffer)}`);

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
    const RL = (v) => (v < 20 ? 'Tief' : v < 40 ? 'Günstig' : v < 60 ? 'Neutral' : v < 80 ? 'Erhitzt' : 'Überhitzt');
    const rl = X.label[RL(ri.value)], se = indices.altseason;
    const names = { risk: X.riskH(ri.value, rl).split(':')[0], season: se ? X.seasonH(se.value, X.season(se.value)).split(':')[0] : null,
      pi: X.piH(0).split(':')[0], mayer: X.mayerH(0).split(':')[0] };
    const paths = { risk: '/bitcoin-cycle-risk/', season: '/altcoin-season-index/', pi: '/pi-cycle-top/', mayer: '/mayer-multiple/' };
    const more = (self) => `<h2>${X.also}</h2><ul class="links">${Object.entries(paths).filter(([k]) => k !== self && names[k]).map(([k, p]) => `<li><a href="${pre}${p}">${esc(names[k])}</a></li>`).join('')}
      <li><a href="${pre}/fear-and-greed-index/">${esc(L.fngNav)}</a></li></ul>`;
    const cta = `<section class="panel cta"><strong>${X.full}</strong><p><a class="btn" href="${app('#/indikatoren')}">${X.fullBtn}</a></p></section><p class="muted">${X.note}</p>`;
    const stat = (l, v) => `<div class="panel stat"><div class="l">${l}</div><div class="v">${v}</div></div>`;
    const bucket = ri.backtest.find((b) => ri.value >= b.lo && ri.value < b.hi);
    const y1 = bucket?.periods.map((pp) => (pp['365'] ? `${pp['365'].up} %` : '–'));
    add('ix:risk', paths.risk, X.riskT(ri.value, rl, day), X.riskD(ri.value, rl),
      `<h1>${esc(X.riskH(ri.value, rl))}</h1><p class="muted">${esc(day)}</p>
      <div class="grid">${stat(names.risk, `${ri.value}/100`)}${stat(X.parts.mayer, num(indices.mayer.value, 2))}${stat(X.parts.pi, `${num(indices.pi.ratio * 100, 0)} %`)}${se ? stat(names.season, `${se.value}/100`) : ''}</div>
      <p>${X.riskP}</p>${y1 ? `<p><strong>${X.riskBt(y1[0], y1[1])}</strong></p>` : ''}
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
<link rel="canonical" href="${SITE}${p.path}">${alternates}<meta name="theme-color" content="#0b0f17">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${SITE}${p.path}"><meta property="og:image" content="${SITE}/og-image.jpg"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2714%27 fill=%27%23f7931a%27/%3E%3C/svg%3E">
<style>${CSS}</style></head>
<body><header><div class="wrap"><a class="brand" href="${app()}">☁️ Coinweather</a><a class="btn" href="${app()}">${L.open}</a></div></header>
<main class="wrap">${p.body}
<p class="share muted">↗ <a href="https://wa.me/?text=${shareText}%20${share}" rel="noopener" target="_blank">WhatsApp</a><a href="https://t.me/share/url?url=${share}&text=${shareText}" rel="noopener" target="_blank">Telegram</a><a href="https://twitter.com/intent/tweet?url=${share}&text=${shareText}" rel="noopener" target="_blank">X</a><a href="https://www.facebook.com/sharer/sharer.php?u=${share}" rel="noopener" target="_blank">Facebook</a></p></main>
<footer><div class="wrap"><p><a href="${pre}/crypto-weather-today/">${L.today}</a> · <a href="${pre}/fear-and-greed-index/">${esc(L.fngNav)}</a> · <a href="${pre}/coins/">${L.all}</a> · <a href="${pre}/savings-plan/">${SP[lang].nav}</a> · <a href="${pre}/bitcoin-cycle-risk/">${IX[lang].nav}</a> · <a href="${pre}/embed/">${EMB[lang].nav}</a> ·
<a href="/?lang=${lang}#/risiko">${L.risk}</a> · <a href="/?lang=${lang}#/impressum">${L.legal}</a> · <a href="/?lang=${lang}#/datenschutz">${L.privacy}</a></p>
<p class="langs">${twins.map((t) => `<a href="${t.path}" hreflang="${t.lang}"${t.lang === lang ? ' aria-current="page"' : ''}>${LANG_NAME[t.lang]}</a>`).join('')}</p>
<p class="muted">${L.foot(esc(p.day))} Data: CoinGecko, Binance, Gate.io, alternative.me.</p></div></footer>
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
const reportDesc = `Market index ${market.value}/100 (${enLabel}), Fear & Greed ${fng?.value ?? '–'} (${enMood}), Bitcoin $${Math.round(btc?.current_price ?? 0).toLocaleString('en-US')}. ${isNum(btcUp7) ? E.odds(btcUp7, btcUp30) : ''} Not financial advice.`;
await writeFile(`${out}/feed.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Coinweather – daily crypto weather report</title><link>${SITE}/</link>
<atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/><description>Is now a good time to buy crypto? A daily weather report for the crypto market. Not financial advice.</description><language>en</language>
<item><title>${esc(`Crypto weather ${enDay}: ${enLabel} (${market.value}/100), Fear & Greed ${fng?.value ?? '–'}`)}</title><link>${SITE}/crypto-weather-today/</link>
<guid isPermaLink="false">coinweather-${iso.slice(0, 10)}</guid><pubDate>${new Date(snap.time).toUTCString()}</pubDate><description>${esc(reportDesc)}</description></item>
</channel></rss>
`);
await writeFile(`${out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`${pages.length} Seiten für Suchmaschinen gebaut in ${LANG_ORDER.length} Sprachen`);
