// Prognosemodell (Version 2)
//
// Die Bewertungskurven unten stammen aus einer Auswertung von 4 Jahren Tageskursen (Okt. 2022 – Okt. 2026)
// von 38 großen Coins: Für jeden Indikator wurde gemessen, wie sich der Kurs 7, 14, 30 und 90 Tage später
// entwickelt hat. Die wichtigsten Ergebnisse:
//   1. Die Marktphase (Bitcoin) erklärt am meisten: Ist Bitcoin stark, steigen die meisten Coins mit.
//   2. Überdehnung ist langfristig negativ: Coins weit über ihrem 200-Tage-Schnitt fielen danach meist.
//      Am besten liefen frühe, noch nicht überhitzte Aufwärtstrends.
//   3. Nach einem Ausverkauf (RSI unter 30, mehr als 20 % Wochenverlust) folgte kurzfristig oft eine Erholung.
//   4. Momentum über 2–4 Wochen und steigendes Handelsvolumen helfen mittelfristig.
// Jeder Faktor liefert einen Wert von -1 (negativ) bis +1 (positiv). Vier Jahre sind nur ein Marktzyklus –
// die Kurven beschreiben, was in dieser Zeit funktioniert hat, und sind keine Garantie für die Zukunft.

import { clamp, avg, isNum, num, signed } from './util.js';

// Gewichte nach Gegenprüfung an 2018–2022 und an 48 weiteren Coins: Die Marktphase trägt auch außerhalb des
// Anpassungszeitraums am besten, der langfristige Baustein am schlechtesten.
const W_SHORT = 0.2, W_MEDIUM = 0.25, W_LONG = 0.1, W_REGIME = 0.45;
export const WEIGHTS = { short: W_SHORT, medium: W_MEDIUM, long: W_LONG, regime: W_REGIME };
const BEAR_CAP = 0.11;          // im Bärenmarkt gibt es kein Kaufsignal
// Gier-Bremse: Liegt der Fear-&-Greed-Index im 7-Tage-Schnitt zwischen 75 und 85, gibt es keine Kaufsignale.
// Auswertung 2018–2026: In dieser Zone stand der mittlere Coin 30 Tage später nur in 20–33 % der Fälle höher
// (Median −19 bis −21 %), und zwar in beiden Prüfzeiträumen und in jeder Marktphase. Im Portfolio blieb die Rendite
// gleich, der größte Rückgang sank leicht. Über 85 gibt es nur eine einzige Phase (Ende 2020 bis Anfang 2021), in der
// die Kurse weiter stark stiegen – dafür lässt sich keine Regel belegen, deshalb endet die Bremse dort.
const GREED_FROM = 75, GREED_TO = 86, GREED_CAP = 0.14;
export const greedZone = (regime) => isNum(regime?.fng?.avg7) && regime.fng.avg7 >= GREED_FROM && regime.fng.avg7 < GREED_TO;

// Angst-Zone, von 0 (keine) bis 1 (voll): Der Fear-&-Greed-Index stand an mindestens 9 von 10 der letzten 60 Tage unter 45
// oder fast durchgehend 14 Tage unter 25, und Bitcoin liegt mindestens 30–40 % unter seinem Allzeithoch.
// Dieselbe Regel senkt das Reserve-Ziel (manager.js) und hebt den Kaufscore von Bitcoin und Ethereum.
// Auswertung 2018–2026, ein Jahr später: Bitcoin in 86–100 % der Fälle höher, Ethereum in 64–100 %, große Altcoins in
// 50–65 %, die übrigen Coins in 29–58 % (2018–22 im Mittel −34 %). Deshalb gilt die Regel nur für die beiden Kern-Coins.
const FEAR = { shareFrom: 0.9, shareFull: 1, extremeFrom: 0.8, extremeFull: 1, ddFrom: -30, ddFull: -40 };
export function fearZone(regime) {
  const f = regime?.fng, dd = regime?.cycle?.dd;
  if (!f || !isNum(f.fearShare60) || !isNum(dd)) return 0;
  const deep = clamp((FEAR.ddFrom - dd) / (FEAR.ddFrom - FEAR.ddFull), 0, 1);
  return deep * Math.max(clamp((f.fearShare60 - FEAR.shareFrom) / (FEAR.shareFull - FEAR.shareFrom), 0, 1),
    clamp(((f.extremeFearShare14 ?? 0) - FEAR.extremeFrom) / (FEAR.extremeFull - FEAR.extremeFrom), 0, 1));
}

// Kern-Coins: Für sie gilt tief im Zyklus der antizyklische Einstieg – im Reserve-Ziel wie im Kaufscore.
// Ein Jahr nach Ständen von mindestens 40 % unter dem Allzeithoch stand Bitcoin in 77–100 % der Fälle höher,
// Ethereum in 57–100 %. Eigene Regeln je Altcoin (kein Kauf im eigenen Abwärtstrend, kein Kauf nach eigener Gier,
// Kauf nach eigener Angst) halfen jeweils nur in einem der beiden Prüfzeiträume und sind deshalb nicht eingebaut.
export const CORE_IDS = new Set(['bitcoin', 'ethereum']);
// Kaufsignale nur dort, wo das Modell geprüft ist: an 84 großen Coins mit mehrjährigen Tageskursen. Die offene
// Erfolgskontrolle (12.–16.10.2026) zeigte, was außerhalb passiert: Kaufsignale ab Rang 200 lagen 7 Tage später im
// Mittel bei −6,5 % (15 % im Plus), in den Top 10 bei +0,2 %, während der mittlere Top-100-Coin −2 % machte.
// Kleinere Coins lassen sich auch nicht fair zurückrechnen – in alten Daten fehlen alle, die es nicht mehr gibt.
export const SIGNAL_RANK = 100;
export const CORE_DD = -40;
const W_NEWS = 0.1;             // Nachrichten verschieben den Score um höchstens ±10 Punkte
// Schwellen des Gesamt-Scores (-100 … +100). Kaufsignal ab 15: Erst ab dort lag das mittlere Ergebnis
// nach 7 und nach 30 Tagen im Plus – ein Kaufsignal soll sich mit einer positiven Prognose begründen lassen.
const BUY = 15, STRONG = 28;
// „Kaufen“ ohne Einschränkung erst ab 40: Erst dort lag das mittlere Ergebnis in beiden Prüfzeiträumen klar im Plus
const STRONG_BUY = 40;
const HORIZON_MIN = 0.1;

const factor = (name, text, score, weight) => ({ name, text, score, weight });

// Stückweise lineare Kurve durch Stützpunkte [x, y]
function curve(x, pts) {
  if (!isNum(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

// Bewertungskurven: [Indikatorwert, Bewertung]
const C = {
  // kurzfristig (Kurs 7 Tage später)
  rsiRebound: [[20, 1], [30, 0.7], [38, 0], [100, 0]],
  ret7: [[-25, 0.9], [-15, 0.3], [-8, 0], [10, 0], [25, 0.4], [45, 0.6]],
  sma20: [[-25, 0.9], [-15, 0.3], [-8, -0.1], [0, -0.1], [10, 0.2], [25, 0.5], [40, 0.8]],
  // mittelfristig (14–30 Tage später)
  rsiMomentum: [[20, 0.4], [30, 0.3], [38, 0], [45, -0.2], [55, -0.1], [62, 0.5], [75, 0.8], [90, 0.6]],
  sma50: [[-35, -0.2], [-20, -0.3], [-5, 0], [5, 0], [15, 0.3], [25, 0.7], [40, 0.4], [60, 0]],
  ret30: [[-35, -0.6], [-20, -0.3], [-5, 0], [5, 0.2], [20, 0.6], [45, 0.3], [70, -0.3]],
  ret14: [[-30, -0.4], [-15, -0.3], [-4, 0], [4, 0.1], [18, 0.5], [35, 0.5], [60, 0.1]],
  // langfristig (30–90 Tage später)
  sma200: [[-50, -0.2], [-30, 0], [-12, -0.1], [0, 0.6], [12, 0.6], [30, 0.2], [45, -0.6], [80, -0.9]],
  cross: [[-40, -0.3], [-22, 0.3], [-10, 0.2], [0, 0.7], [10, 0.2], [22, -0.5], [45, -1]],
  ret90: [[-60, -0.2], [-40, -0.4], [-20, 0.3], [0, 0.5], [20, 0.1], [45, -0.2], [90, -0.6], [150, -1]],
  high: [[-90, -0.7], [-75, -0.3], [-55, 0.2], [-35, 0.1], [-20, -0.2], [-5, 0.3]],
  ret200: [[-70, 0.1], [-50, 0.4], [-25, 0.3], [0, 0.1], [50, 0], [100, -0.5], [200, -0.8]],
  ret365: [[-80, -0.6], [-60, -0.3], [-35, 0], [-10, 0.5], [25, 0.5], [75, 0.1], [150, -0.2], [300, -0.7]],
  // Marktphase (Bitcoin)
  btcRsi: [[25, -0.8], [35, -0.6], [45, -0.2], [60, 0], [68, 0.6], [78, 1]],
  btcRet30: [[-20, -0.8], [-10, -0.7], [-3, -0.3], [0, 0.2], [8, 0.3], [15, 0.1], [22, 0.9], [35, 1]],
  btcSma50: [[-15, -0.8], [-8, -0.5], [-3, -0.1], [5, 0], [10, 0.6], [18, 1]],
  btcSma200: [[-25, 0], [-15, -0.6], [-5, 0.8], [5, 0.6], [15, 0.1], [35, 0], [50, -0.6], [60, -1]],
  fng: [[20, 0], [50, 0], [62, 0.4], [72, 0], [80, -0.6], [90, -1]],
};

function combine(factors) {
  let s = 0, w = 0;
  for (const f of factors) { s += f.score * f.weight; w += f.weight; }
  return w ? s / w : null;
}

const horizon = (factors) => {
  const valid = factors.filter((f) => f && f.score !== null);
  return { score: combine(valid), factors: valid };
};

// Schwankung des Coins. Auswertung 2018–2026: Ruhigere Coins schnitten in beiden Prüfzeiträumen besser ab als der Markt,
// stark schwankende schlechter – das verlässlichste Merkmal der ganzen Untersuchung (7, 30 und 90 Tage).
// Unter rund 1,5 % am Tag gab es in der Auswertung kaum Fälle – dort wird kein Vorteil unterstellt.
const SWING = [[1, 0], [1.5, 0.5], [2, 0.6], [3, 0.4], [4, 0.1], [5, -0.1], [6.5, -0.3], [9, -0.5]];
const SWING_W = { short: 0.3, medium: 0.5, long: 0.6 };
function swingFactor(sw, weight, onlyPenalty = false) {
  let score = curve(sw, SWING);
  if (onlyPenalty && score > 0) score = 0;
  if (score === null) return null;
  const text = sw < 1.3 ? 'außergewöhnlich ruhig – dafür ist kein zusätzlicher Vorteil belegt'
    : score > 0.3 ? 'ruhiger Coin, historisch im Vorteil' : score > 0.05 ? 'eher ruhig, leichter Vorteil'
    : score < -0.15 ? 'stark schwankend, historisch im Nachteil' : 'durchschnittlich';
  return factor('Schwankung', `${num(sw, 1)} % am Tag – ${text}`, score, weight);
}

const side = (x) => `${num(Math.abs(x))} % ${x >= 0 ? 'über' : 'unter'}`;
const verdict = (s, good, bad, neutral = 'neutral') => (s > 0.15 ? good : s < -0.15 ? bad : neutral);

// ---------- Indikatoren ----------

function rolling(a, w) {
  const out = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= w) s -= a[i - w];
    if (i >= w - 1) out[i] = s / w;
  }
  return out;
}

// RSI nach Wilder
function rsiSeries(a, period = 14) {
  const out = new Array(a.length).fill(null);
  if (a.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = a[i] - a[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

function stdev(a) {
  if (a.length < 2) return NaN;
  const m = avg(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

const logReturns = (p) => p.slice(1).map((x, i) => Math.log(x / p[i]));

// Tagesschwankung in Prozent: Standardabweichung der Tagesrenditen über ein gleitendes Fenster
function swingSeries(a, w) {
  const out = new Array(a.length).fill(null);
  let s = 0, q = 0;
  const r = a.map((x, i) => (i ? Math.log(x / a[i - 1]) : 0));
  for (let i = 1; i < a.length; i++) {
    s += r[i]; q += r[i] * r[i];
    if (i > w) { s -= r[i - w]; q -= r[i - w] * r[i - w]; }
    if (i >= w) out[i] = Math.sqrt(Math.max(0, (q - s * s / w) / (w - 1))) * 100;
  }
  return out;
}

// Alle Tagesindikatoren einmal berechnen. Jeder Wert an Stelle i nutzt nur Daten bis i,
// damit der Rückblick-Test nicht in die Zukunft schaut.
export function prepare(times, prices, volumes) {
  return {
    n: prices.length, times, prices,
    days: times.map((t) => Math.floor(t / 86_400_000)),
    sma20: rolling(prices, 20), sma50: rolling(prices, 50), sma200: rolling(prices, 200),
    rsi: rsiSeries(prices),
    vol20: rolling(volumes, 20), vol90: rolling(volumes, 90),
    swing: swingSeries(prices, 90),
  };
}

const retAt = (ind, i, d) => (i >= d ? (ind.prices[i] / ind.prices[i - d] - 1) * 100 : null);
const relAt = (ind, i, key) => (ind[key][i] ? (ind.prices[i] / ind[key][i] - 1) * 100 : null);

// ---------- Horizonte auf Tagesdaten (Detailansicht und Rückblick-Test) ----------

export function scoreAt(ind, i) {
  const r = ind.rsi[i];
  const s20 = relAt(ind, i, 'sma20'), s50 = relAt(ind, i, 'sma50'), s200 = relAt(ind, i, 'sma200');
  const m7 = retAt(ind, i, 7), m14 = retAt(ind, i, 14), m30 = retAt(ind, i, 30), m90 = retAt(ind, i, 90);
  const add = (list, name, value, text, pts, weight) => {
    const score = curve(value, pts);
    if (score !== null) list.push(factor(name, text(score), score, weight));
  };

  const short = [];
  add(short, 'RSI (14 Tage)', r, (s) => `${num(r, 0)} – ${s > 0.15 ? 'überverkauft, Erholung wahrscheinlicher' : 'kein Ausverkauf'}`, C.rsiRebound, 0.35);
  add(short, 'Veränderung 7 Tage', m7, (s) => `${signed(m7)} % – ${m7 < -8 ? verdict(s, 'Ausverkauf, oft folgt eine Gegenbewegung', '', 'Schwäche') : verdict(s, 'starker Schwung', '', 'unauffällig')}`, C.ret7, 0.3);
  add(short, 'Kurs zum 20-Tage-Schnitt', s20, () => `${side(s20)} dem 20-Tage-Schnitt`, C.sma20, 0.35);

  const medium = [];
  add(medium, 'RSI-Momentum', r, (s) => `${num(r, 0)} – ${verdict(s, r < 40 ? 'überverkauft' : 'Käufer klar im Vorteil', 'kein Schwung', 'neutral')}`, C.rsiMomentum, 0.2);
  add(medium, 'Kurs zum 50-Tage-Schnitt', s50, () => `${side(s50)} dem 50-Tage-Schnitt`, C.sma50, 0.2);
  add(medium, 'Momentum 30 Tage', m30, (s) => `${signed(m30)} % – ${m30 > 55 ? 'überhitzt' : verdict(s, 'gesunder Aufwärtstrend', 'Abwärtstrend', 'unauffällig')}`, C.ret30, 0.25);
  add(medium, 'Momentum 14 Tage', m14, () => `${signed(m14)} %`, C.ret14, 0.15);
  const v20 = ind.vol20[i], v90 = ind.vol90[i];
  if (v20 && v90 && m7 !== null && v20 / v90 >= 1.3 && Math.abs(m7) > 3) {
    medium.push(factor('Handelsvolumen', `${num((v20 / v90 - 1) * 100, 0)} % über Normal bei ${m7 > 0 ? 'steigendem' : 'fallendem'} Kurs`, m7 > 0 ? 0.8 : -0.5, 0.2));
  }

  const long = [];
  for (const [list, weight] of [[short, SWING_W.short], [medium, SWING_W.medium], [long, SWING_W.long]]) list.push(swingFactor(ind.swing[i], weight));
  add(long, 'Kurs zum 200-Tage-Schnitt', s200, (s) => `${side(s200)} dem 200-Tage-Schnitt – ${s200 > 40 ? 'überdehnt' : verdict(s, 'früher Aufwärtstrend', 'schwach')}`, C.sma200, 0.3);
  if (ind.sma50[i] && ind.sma200[i]) {
    const x = (ind.sma50[i] / ind.sma200[i] - 1) * 100;
    add(long, '50- zum 200-Tage-Schnitt', x, (s) => `50-Tage-Schnitt ${side(x)} dem 200-Tage-Schnitt – ${x > 18 ? 'Trend weit fortgeschritten' : verdict(s, 'Trendwende oder junger Trend', 'schwach')}`, C.cross, 0.3);
  }
  add(long, 'Momentum 90 Tage', m90, (s) => `${signed(m90)} % – ${m90 > 45 ? 'stark gelaufen, Rückschlaggefahr' : verdict(s, 'Raum nach oben', m90 > 0 ? 'schon weit gelaufen' : 'anhaltende Schwäche')}`, C.ret90, 0.25);
  if (i >= 120) {
    let high = 0;
    for (let k = Math.max(0, i - 364); k <= i; k++) high = Math.max(high, ind.prices[k]);
    const dist = (ind.prices[i] / high - 1) * 100;
    add(long, 'Abstand zum Jahreshoch', dist, () => `${num(-dist, 0)} % unter dem Jahreshoch`, C.high, 0.15);
  }

  // Ohne eigene Kursmerkmale gibt es keine Bewertung – die Schwankung allein trägt keinen Horizont
  const own = (list) => horizon(list.some((f) => f && f.name !== 'Schwankung') ? list : []);
  return { short: own(short), medium: own(medium), long: own(long) };
}

// ---------- Marktphase ----------

// Fear & Greed im Zeitverlauf. values: Tageswerte, der neueste zuerst.
// Liefert den heutigen Wert, Mittelwerte und wie viele Tage in Folge der Index schon in einer Zone steht.
export function fngState(values) {
  const v = (values ?? []).filter(isNum);
  if (!v.length) return null;
  const mean = (n) => avg(v.slice(0, n));
  const streak = (test) => { let n = 0; while (n < v.length && test(v[n])) n++; return n; };
  // Anteil der letzten n Tage in einer Zone. Ruhiger als „Tage in Folge“: Ein einzelner Ausreißer reißt die Zählung nicht ab.
  const share = (n, test) => { const a = v.slice(0, n); return a.filter(test).length / n; };
  return { value: v[0], avg7: mean(7), avg14: mean(14), avg30: mean(30), days: v.length,
    extremeFearDays: streak((x) => x < 25), fearDays: streak((x) => x < 45),
    greedDays: streak((x) => x > 55), extremeGreedDays: streak((x) => x > 75),
    fearShare60: share(60, (x) => x < 45), extremeFearShare14: share(14, (x) => x < 25),
    greedShare30: share(30, (x) => x > 55), extremeGreedShare14: share(14, (x) => x > 75) };
}

// Bewertung der Marktphase aus den Bitcoin-Tageskursen an Stelle j, optional mit Fear & Greed
export function regimeAt(btc, j, fng) {
  const f = [];
  const r = btc.rsi[j], m30 = retAt(btc, j, 30), s50 = relAt(btc, j, 'sma50'), s200 = relAt(btc, j, 'sma200');
  const add = (name, value, text, pts, weight) => {
    const score = curve(value, pts);
    if (score !== null) f.push(factor(name, text(score), score, weight));
  };
  add('Bitcoin RSI (14 Tage)', r, (s) => `${num(r, 0)} – ${verdict(s, 'starker Markt', 'schwacher Markt')}`, C.btcRsi, 0.3);
  add('Bitcoin Momentum 30 Tage', m30, (s) => `${signed(m30)} % – ${verdict(s, 'Rückenwind', 'Gegenwind')}`, C.btcRet30, 0.25);
  add('Bitcoin zum 50-Tage-Schnitt', s50, () => `${side(s50)} dem 50-Tage-Schnitt`, C.btcSma50, 0.2);
  add('Bitcoin zum 200-Tage-Schnitt', s200, (s) => `${side(s200)} dem 200-Tage-Schnitt – ${s200 > 45 ? 'Markt überhitzt' : verdict(s, 'günstige Zyklusphase', 'ungünstige Zyklusphase')}`, C.btcSma200, 0.15);
  if (isNum(fng)) {
    add('Fear & Greed', fng, (s) => `${fng} – ${fng >= 78 ? 'extreme Gier, historisch ein Warnzeichen' : verdict(s, 'Zuversicht ohne Übertreibung', 'Gier')}`, C.fng, 0.1);
  }
  // Bärenmarkt: Bitcoin unter dem 200-Tage-Schnitt und der 50-Tage-Schnitt darunter. In solchen Phasen
  // (z. B. 2022) lagen Kaufsignale in der Gegenprüfung überwiegend falsch.
  const bear = s200 !== null && s200 < 0 && btc.sma50[j] < btc.sma200[j];
  return { ...horizon(f), bear };
}

// Geglättete Marktphase: Mittel der letzten Tage. Ein einzelner schwacher Tag verschiebt die Bewertung
// dadurch nur wenig. Die angezeigten Einzelfaktoren sind die von heute; fngAt(tag) liefert Fear & Greed je Tag.
export function regimeSmooth(btc, j, fngAt = () => undefined, days = 7) {
  const today = regimeAt(btc, j, fngAt(btc.days[j]));
  if (today.score === null) return today;
  let sum = today.score, n = 1;
  const flags = [today.bear];
  for (let k = 1; k < days && j - k >= 0; k++) {
    const r = regimeAt(btc, j - k, fngAt(btc.days[j - k]));
    if (r.score !== null) { sum += r.score; n++; flags.push(r.bear); }
  }
  // bearShare: Anteil der letzten Tage im Bärenmarkt. Damit greift die Bremse der Reserve über wenige Tage verteilt
  // statt von einem Tag auf den anderen, und ein Hin und Her an der Grenze gleicht sich aus.
  // Für den Kaufscore gilt der Bärenmarkt, wenn die Mehrheit dieser Tage darin lag – dieselbe Grundlage wie bei der Reserve.
  const recent = flags.slice(0, BEAR_DAYS), bearShare = recent.filter(Boolean).length / recent.length;
  return { ...today, score: sum / n, today: today.score, bearShare, bear: bearShare >= 0.5, bearToday: today.bear };
}

export const REGIME_DAYS = 14;
const BEAR_DAYS = 5;   // geprüft mit 1 bis 14 Tagen: bis 5 Tage ohne Einbuße, darüber reagiert die Bremse zu spät

// Was nach vergleichbaren Zyklus-Ständen in 12 Monaten geschah – getrennt für die beiden Zyklen in den Daten
// (2018–2022 und 2022–2026). Sie widersprechen sich teils völlig: 25–40 % unter dem Hoch stand Bitcoin ein Jahr später
// einmal 42 % tiefer (2021/22, auf dem Weg nach unten) und einmal 124 % höher (2023/24, auf dem Weg nach oben).
// Ein Mittelwert aus beiden wäre eine Zahl, die es so nie gab. Zeigt ein Zyklus klar ins Minus und der andere klar
// ins Plus, gilt die Jahressicht deshalb als uneinheitlich – ohne Richtungsaussage.
// [Abstand zum Allzeithoch bis %, Bitcoin: höher in % der Fälle, mittleres Ergebnis 2018–22, 2022–26,
//  mittlerer Coin: höher in % der Fälle, mittleres Ergebnis 2018–22, 2022–26]. Trefferquoten: Schnitt beider Zyklen.
const CYCLE_HISTORY = [[-70, 100, 78, 130, 55, -20, 13], [-55, 96, 43, 126, 70, 28, 26], [-40, 81, 21, 110, 72, 36, 16],
  [-25, 58, -42, 124, 50, -63, 16], [-10, 45, -28, 61, 16, -53, -39], [Infinity, 38, -20, -16, 23, -20, -64]];
export const CYCLE_NAMES = ['2018–22', '2022–26'];
const mixedCycles = ([a, b]) => Math.min(a, b) <= -5 && Math.max(a, b) >= 5;

// Einordnung des Zyklus – die langfristige, antizyklische Sicht neben der kurzfristigen Marktphase
export function cycleInfo(dd) {
  const row = CYCLE_HISTORY.find(([limit]) => dd < limit) ?? CYCLE_HISTORY[CYCLE_HISTORY.length - 1];
  const zone = dd <= -55 ? 'deep' : dd <= -40 ? 'low' : dd <= -10 ? 'mid' : 'high';
  const label = { deep: 'Tief im Zyklus – antizyklische Kaufzone', low: 'Unteres Drittel des Zyklus', mid: 'Mitte des Zyklus', high: 'Nahe am Allzeithoch – Gewinne sichern' }[zone];
  const btc = [row[2], row[3]], alt = [row[5], row[6]];
  return { dd, zone, label, btcUp: row[1], btcMedian: Math.round((btc[0] + btc[1]) / 2), altUp: row[4], altMedian: Math.round((alt[0] + alt[1]) / 2),
    btcCycles: btc, altCycles: alt, btcMixed: mixedCycles(btc), altMixed: mixedCycles(alt) };
}

// Ersatz, falls keine Bitcoin-Tageskurse geladen werden konnten
function regimeFromMarket(btc) {
  const d30 = btc?.price_change_percentage_30d_in_currency;
  const score = curve(d30, C.btcRet30);
  return horizon(score === null ? [] : [factor('Bitcoin Momentum 30 Tage', `${signed(d30)} %`, score, 1)]);
}

// ---------- Prozent-Prognose ----------
// Was folgte in der Vergangenheit auf welchen Score? Ausgewertet an 174 000 Coin-Tagen (84 Coins, 2018–2026),
// gemessen in Einheiten der üblichen Schwankung des Coins, damit ruhige und nervöse Coins vergleichbar sind.
// Die beiden Prüfzeiträume (2018–2022, 2022–2026) zählen je zur Hälfte. Je Score-Stufe [Score, Wert]:
//   Z:   typisches Ergebnis (Median) – die Hälfte der Fälle lag darüber, die Hälfte darunter
//   UP:  Anteil der Fälle mit höherem Kurs in %
//   AVG: Durchschnitt aller Fälle; einzelne Ausreißer zählen höchstens mit dem Dreifachen der üblichen Schwankung
// Typischer Wert und Durchschnitt liegen weit auseinander. Bei Kaufsignalen (Score ab 15) lag der typische Fall auf
// 30 Tage nahe null (2018–22 leicht im Plus, 2022–26 leicht im Minus), der Durchschnitt aber in allen vier
// 2-Jahres-Abschnitten im Plus: Wenige starke Anstiege heben ihn. Ein Kaufsignal ist deshalb kein Versprechen für den
// einzelnen Kauf, sondern ein Vorteil über viele Käufe – und der Rückblick eines einzelnen Coins (app.js) zeigt
// Durchschnitte, die mit dem typischen Wert hier nicht vergleichbar sind. Deshalb stehen beide Größen in der Prognose.
const Z7 = [[-35, -0.18], [-20, -0.1], [-6, -0.05], [11, -0.04], [15, 0.03], [17.5, 0.07], [22.5, 0.11], [28.5, 0.14], [36, 0.14], [46, 0.25]];
const Z30 = [[-35, -0.24], [-20, -0.24], [-6, -0.08], [4, -0.08], [11, -0.15], [15, 0.02], [17.5, 0.07], [28.5, 0.08], [36, 0.25], [46, 0.35]];
const UP7 = [[-35, 36], [-20, 44], [-6, 47], [11, 48], [15, 53], [17.5, 54], [22.5, 55], [28.5, 56], [46, 58]];
const UP30 = [[-35, 32], [-20, 36], [-6, 46], [4, 46], [11, 44], [15, 53], [28.5, 54], [36, 57], [46, 60]];
const AVG7 = [[-35, -0.13], [-20, -0.08], [-6, 0], [4, 0.02], [11, 0.07], [15, 0.17], [17.5, 0.24], [22.5, 0.29], [28.5, 0.31], [36, 0.33], [46, 0.4]];
const AVG30 = [[-35, -0.12], [-20, -0.12], [-6, 0.06], [4, 0.13], [11, 0.12], [15, 0.28], [17.5, 0.36], [28.5, 0.38], [36, 0.44], [46, 0.45]];
// Spanne: unteres bis oberes Viertel der Fälle, als Abstand zum typischen Wert
const Z7_RANGE = [-0.5, 0.6], Z30_RANGE = [-0.55, 0.7];
// Auf 7 Tage zählt zusätzlich der kurzfristige Baustein: Lag er hoch (Ausverkauf, überverkaufter RSI), folgte in beiden
// Prüfzeiträumen eine Erholung – auch bei schwachem Gesamt-Score. Gilt ab Baustein +20; darunter entscheidet der Score.
const Z7_SHORT = [[20, 0.05], [30, 0.07], [50, 0.21], [65, 0.26]];
const UP7_SHORT = [[20, 51], [30, 53], [50, 63], [65, 67]];
const AVG7_SHORT = [[20, 0.14], [40, 0.14], [57, 0.29], [70, 0.29]];
// Auf 12 Monate zählt vor allem der Stand im Zyklus; der langfristige Baustein des Coins verschiebt das Ergebnis
const LONG_ADJ = [[0, -0.1], [10, 0], [30, 0.2], [45, 0.35]];
// Abschlag auf die 30-Tage-Prognose in der Gier-Zone, in Schwankungs-Einheiten (Mittel beider Prüfzeiträume)
const GREED_Z30 = -0.4, GREED_AVG30 = -0.2;
// Gesamtmarkt nach Marktphase: [Marktphase, mittleres Ergebnis in %]
const M = {
  alt7: [[-30, -1], [30, -1], [40, 0], [55, 3]], btc7: [[-30, 0], [40, 0.5], [55, 2]],
  alt30: [[-40, -7], [-20, -3], [40, -2], [55, 6]], btc30: [[-40, 1], [0, 0], [20, 2], [40, 4], [55, 5]],
  altUp7: [[-30, 44], [30, 45], [40, 49], [55, 60]], btcUp7: [[-30, 52], [30, 52], [40, 55], [55, 61]],
  altUp30: [[-40, 30], [-20, 42], [40, 45], [55, 54]], btcUp30: [[-40, 55], [0, 50], [20, 53], [40, 58], [55, 61]],
  // Durchschnitt bei Bitcoin: liegt nur wenig über dem typischen Wert, weil extreme Ausreißer fehlen
  btcAvg7: [[-30, 0.3], [-10, 0.3], [10, 1.3], [30, 1.4], [50, 2.5]], btcAvg30: [[-30, 2], [-10, 1.5], [10, 5], [30, 8], [50, 7.5]],
};

const r1 = (x) => Math.round(x * 10) / 10;
const span = (days, mid, low, high, up, avg) => ({ days, mid: r1(mid), low: r1(low), high: r1(high), up: isNum(up) ? Math.round(up) : null, avg: isNum(avg) ? r1(avg) : null });
const fromLog = (x) => (Math.exp(x) - 1) * 100;
const toLog = (p) => Math.log(1 + Math.max(p, -95) / 100);

function longSpan(cycle, btc, longScore) {
  if (!cycle) return null;
  const adj = btc || !isNum(longScore) ? 0 : curve(longScore * 100, LONG_ADJ);
  const cycles = (btc ? cycle.btcCycles : cycle.altCycles).map((p) => fromLog(toLog(p) + adj));
  // Auf Jahressicht gibt es nur die beiden Zyklen: Die Spanne reicht vom schwächeren zum stärkeren, die Mitte ist ihr Schnitt.
  // Eine Trefferquote ließe sich daraus nicht belastbar ableiten.
  return { ...span(365, (cycles[0] + cycles[1]) / 2, Math.min(...cycles), Math.max(...cycles)), cycles: cycles.map(Math.round), mixed: mixedCycles(cycles) };
}

// Erwartete Kursveränderung eines Coins: mittleres Ergebnis und übliche Spanne je Zeitraum
function forecastOf(score, volDaily, shortScore, longScore, regime, btc) {
  const sd = clamp(isNum(volDaily) ? volDaily / 100 : 0.05, 0.015, 0.12);
  const rebound = isNum(shortScore) && shortScore * 100 >= 20;
  const greed = greedZone(regime);
  const one = (days, pts, [lo, hi], upPts, avgPts) => {
    let z = curve(score, pts), up = curve(score, upPts), mean = curve(score, avgPts);
    if (days === 7 && rebound) {
      const x = shortScore * 100;
      z = Math.max(z, curve(x, Z7_SHORT)); up = Math.max(up, curve(x, UP7_SHORT)); mean = Math.max(mean, curve(x, AVG7_SHORT));
    }
    // Gier-Zone: Auf 30 Tage lagen die Ergebnisse unabhängig vom Score deutlich tiefer (siehe GREED_FROM)
    if (days === 30 && greed) { z = Math.min(z + GREED_Z30, -0.15); up = Math.min(up - 12, 42); mean = Math.min(mean + GREED_AVG30, -0.1); }
    const unit = sd * Math.sqrt(days);
    return span(days, fromLog(z * unit), fromLog((z + lo) * unit), fromLog((z + hi) * unit), up, mean * unit * 100);
  };
  const cycle = isNum(regime?.cycle?.dd) ? cycleInfo(regime.cycle.dd) : null;
  // Bitcoin bestimmt die Marktphase selbst – dafür gilt die Auswertung der Bitcoin-Geschichte aus der Marktprognose
  if (btc && regime?.score != null) return marketForecast(regime, cycle).btc;
  return { short: one(7, Z7, Z7_RANGE, UP7, AVG7), medium: one(30, Z30, Z30_RANGE, UP30, AVG30), long: longSpan(cycle, btc, longScore) };
}

// Erwartete Veränderung des Gesamtmarkts: Bitcoin und ein mittlerer Coin
function marketForecast(regime, cycle) {
  if (regime.score === null) return null;
  const x = regime.score * 100;
  // In der Gier-Zone (Fear & Greed im 7-Tage-Schnitt 75–85) gelten für 30 Tage die Ergebnisse dieser Zone:
  // Bitcoin stand in 33–36 % der Fälle höher (Median −3 bis −7 %), der mittlere Coin in 20–33 % (−19 bis −21 %).
  const greed = greedZone(regime);
  return {
    btc: { short: span(7, curve(x, M.btc7), curve(x, M.btc7) - 4, curve(x, M.btc7) + 5, curve(x, M.btcUp7), curve(x, M.btcAvg7)),
      medium: greed ? span(30, -5, -10, 5, 34) : span(30, curve(x, M.btc30), curve(x, M.btc30) - 10, curve(x, M.btc30) + 13, curve(x, M.btcUp30), curve(x, M.btcAvg30)), long: longSpan(cycle, true) },
    alt: { short: span(7, curve(x, M.alt7), curve(x, M.alt7) - 6, curve(x, M.alt7) + 6, curve(x, M.altUp7)),
      medium: greed ? span(30, -20, -26, 2, 27) : span(30, curve(x, M.alt30), curve(x, M.alt30) - 14, curve(x, M.alt30) + 17, curve(x, M.altUp30)), long: longSpan(cycle, false, null) },
  };
}

// Die stärksten Gründe für und gegen den Coin, gewichtet wie im Gesamt-Score
function reasons(short, medium, long, regime) {
  const all = [];
  for (const [h, w, label] of [[short, W_SHORT, 'kurzfristig'], [medium, W_MEDIUM, 'mittelfristig'], [long, W_LONG, 'langfristig'], [regime, W_REGIME, 'Marktphase']]) {
    const sum = h.factors.reduce((s, f) => s + f.weight, 0);
    for (const f of h.factors) {
      const points = f.score * f.weight / sum * w * 100;
      const same = all.find((x) => x.name === f.name);
      if (same) { same.points += points; same.horizon = 'alle Zeiträume'; } else all.push({ name: f.name, text: f.text, horizon: label, points });
    }
  }
  for (const f of all) f.points = Math.round(f.points);
  const top = (dir) => all.filter((f) => f.points * dir >= 2).sort((a, b) => (b.points - a.points) * dir).slice(0, 3);
  return { pro: top(1), contra: top(-1) };
}

// ---------- Schnellbewertung aus den Marktdaten (Liste mit 1000 Coins) ----------

const changes = (c) => ({
  d7: c.price_change_percentage_7d_in_currency,
  d14: c.price_change_percentage_14d_in_currency,
  d30: c.price_change_percentage_30d_in_currency,
  d200: c.price_change_percentage_200d_in_currency,
  y1: c.price_change_percentage_1y_in_currency,
});

const sparkline = (c) => (c.sparkline_in_7d?.price || []).filter(isNum);

export function isStable(c) {
  const p = sparkline(c);
  const d30 = c.price_change_percentage_30d_in_currency;
  if (p.length < 60) {
    // Ohne Stundenkurse: Kurs nahe 1 $ und praktisch keine Bewegung über 7 und 30 Tage
    const d7 = c.price_change_percentage_7d_in_currency;
    return Math.abs(c.current_price - 1) < 0.02 && isNum(d7) && Math.abs(d7) < 1 && isNum(d30) && Math.abs(d30) < 2;
  }
  return (Math.max(...p) - Math.min(...p)) / p[p.length - 1] < 0.02 && (!isNum(d30) || Math.abs(d30) < 3);
}

// Token, die den Kurs von Aktien, Fonds, Edelmetallen oder Währungen abbilden. Marktphase und Zyklus des
// Kryptomarkts gelten für sie nicht, und das Modell wurde nur an Krypto-Coins geprüft.
const FOREIGN_NAME = /xstock|bstock|tokenized|\betf\b|robinhood token|t-bills?|treasury|money market|\bfund\b.*\b(eur|usd|euro)\b|\b(gold|silver|precious metals)\b|\beuro?\b|eurø/i;
const FOREIGN_NOT = /adventure gold|gold park|yield guild/i;
export const isForeign = (c) => (FOREIGN_NAME.test(c.name ?? '') && !FOREIGN_NOT.test(c.name ?? '')) || /^eur/i.test(c.symbol ?? '');

function none(label, text, stable = false) {
  const empty = horizon([]);
  return { signal: 'none', label, score: null, stable, short: empty, medium: empty, long: empty, regime: empty,
    news: null, horizon: '–', risk: { level: 0, label: '–', vol: null }, agreement: null, notes: [text], forecast: null, reasons: null };
}

function riskOf(c, volDaily) {
  let level = !isNum(volDaily) ? 2 : volDaily < 2.5 ? 0 : volDaily < 5 ? 1 : volDaily < 9 ? 2 : 3;
  const turnover = c.market_cap ? c.total_volume / c.market_cap : 0;
  if ((c.market_cap_rank ?? 9999) > 300 || turnover < 0.005) level = Math.min(3, level + 1);
  return { level, label: ['Niedrig', 'Mittel', 'Hoch', 'Sehr hoch'][level], vol: volDaily };
}

export const outlook = (s) => (s === null ? 'Keine Daten' : s > 0.4 ? 'Sehr positiv' : s > 0.12 ? 'Positiv'
  : s < -0.4 ? 'Sehr negativ' : s < -0.12 ? 'Negativ' : 'Neutral');

// Gesamt-Score aus den drei Horizonten und der Marktphase, als Wert von -1 bis +1
export function totalScore(short, medium, long, regime) {
  const parts = [[short, W_SHORT], [medium, W_MEDIUM], [long, W_LONG], [regime, W_REGIME]]
    .filter(([h]) => h && h.score !== null);
  // Ohne eigene Kursdaten des Coins gibt es keine Prognose
  if (!parts.some(([h]) => h !== regime)) return null;
  let raw = parts.reduce((s, [h, w]) => s + h.score * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
  if (greedZone(regime)) raw = Math.min(raw, GREED_CAP);
  return regime?.bear ? Math.min(raw, BEAR_CAP) : raw;
}

export const signalOf = (score) => (score >= STRONG_BUY ? ['buy', 'Kaufen'] : score >= BUY ? ['buy', 'Eher kaufen']
  : score <= -STRONG ? ['sell', 'Verkaufen'] : score <= -BUY ? ['sell', 'Eher verkaufen'] : ['hold', 'Halten']);

// Wie viele der drei Prozent-Prognosen zeigen in die Richtung des Signals?
function agreementOf(forecast, dir) {
  const all = [forecast.short, forecast.medium, forecast.long].filter(Boolean);
  return { agreeing: all.filter((s) => dir !== 0 && !s.mixed && Math.sign(s.mid) === dir).length, of: all.length };
}

// Einordnung einer Prozent-Prognose in Worte – dieselbe Zahl, die auch als Prozentwert dasteht
export function outlookOf(s) {
  if (!s) return ['Keine Daten', 0];
  if (s.mixed) return ['Uneinheitlich', 0];
  if (s.days >= 365) return s.mid >= 50 ? ['Sehr positiv', 1] : s.mid >= 10 ? ['Positiv', 1] : s.mid <= -40 ? ['Sehr negativ', -1] : s.mid <= -10 ? ['Negativ', -1] : ['Neutral', 0];
  const up = s.up ?? 50;
  return s.mid > 0 && up >= 60 ? ['Sehr positiv', 1] : s.mid > 0 && up >= 53 ? ['Positiv', 1]
    : s.mid < 0 && up <= 40 ? ['Sehr negativ', -1] : s.mid < 0 && up <= 47 ? ['Negativ', -1] : ['Neutral', 0];
}

function assemble(c, short, medium, long, regime, volDaily, news) {
  let raw = totalScore(short, medium, long, regime);
  if (raw === null) return none('Keine Daten', 'Zu wenig Kursdaten für eine Prognose.');
  const notes = [];
  if (news && news.score !== null) raw += W_NEWS * news.score;
  if (greedZone(regime)) {
    raw = Math.min(raw, GREED_CAP);
    notes.push(`Gier-Bremse aktiv: Der Fear-&-Greed-Index liegt im 7-Tage-Schnitt bei ${num(regime.fng.avg7, 0)} (extreme Gier). In solchen Phasen stand der mittlere Coin 30 Tage später nur in rund jedem vierten Fall höher – das Modell gibt dann keine Kaufsignale.`);
  }
  if (regime.bear) {
    raw = Math.min(raw, BEAR_CAP);
    notes.push('Bärenmarkt-Filter aktiv: Bitcoin liegt unter seinem 200-Tage-Schnitt im Abwärtstrend. In solchen Phasen gibt das Modell keine Kaufsignale.');
  }
  // Antizyklischer Einstieg bei Bitcoin und Ethereum: tief im Zyklus hebt die Regel der Reserve auch den Kaufscore –
  // auf die Kaufschwelle, in der Angst-Zone bis auf „Kaufen“. Sonst zeigte der Score „Halten“, während der
  // Portfolio-Manager genau diese Coins aufstockt.
  const deep = CORE_IDS.has(c.id) && isNum(regime?.cycle?.dd) && regime.cycle.dd <= CORE_DD;
  const fear = deep ? fearZone(regime) : 0;
  const anticyclical = deep && raw < (BUY + (STRONG_BUY - BUY) * fear) / 100;
  // Die Prognosen für 7 und 30 Tage rechnen weiter mit dem Score ohne diese Anhebung – sie sagt nur etwas über 12 Monate
  const trendScore = Math.round(clamp(raw) * 100);
  if (anticyclical) raw = (BUY + (STRONG_BUY - BUY) * fear) / 100;
  const score = Math.round(clamp(raw) * 100);
  let [signal, label] = signalOf(score);
  if (anticyclical) label = 'Antizyklisch kaufen';

  const turnover = c.market_cap ? c.total_volume / c.market_cap : 0;
  if (signal === 'buy' && (turnover < 0.003 || c.total_volume < 50_000)) {
    [signal, label] = ['hold', 'Halten'];
    notes.push('Sehr geringes Handelsvolumen – das Kaufsignal wurde auf „Halten“ begrenzt, weil sich der Coin schwer handeln lässt.');
  }
  if (signal === 'buy' && !anticyclical && (c.market_cap_rank ?? 9999) > SIGNAL_RANK) {
    [signal, label] = ['hold', 'Halten'];
    notes.push(`Kaufsignale gibt es nur für die ${SIGNAL_RANK} größten Coins – nur an solchen ist das Modell geprüft. Kleinere Coins liefen in der offenen Erfolgskontrolle deutlich schlechter; der Score reicht hier für ein Kaufsignal, angezeigt wird trotzdem „Halten“.`);
  }
  if (regime.score !== null && Math.abs(regime.score) > 0.25) {
    notes.push(`Die Marktphase ${regime.score > 0 ? 'stützt' : 'belastet'} die Bewertung deutlich (${signed(regime.score * W_REGIME * 100, 0)} Punkte).`);
  }

  // Empfohlene Haltedauer: der längste Horizont, der das Signal trägt
  const pos = (h) => h.score !== null && h.score > HORIZON_MIN;
  const neg = (h) => h.score !== null && h.score < -HORIZON_MIN;
  let hold = '–';
  if (signal === 'buy') hold = pos(long) && !neg(medium) ? '1–3 Monate' : pos(medium) ? '2–4 Wochen' : pos(short) ? 'bis 1 Woche' : '2–4 Wochen';
  else if (signal === 'hold') hold = 'Abwarten';

  // Das Signal bewertet die nächsten Wochen. Zeigt die Jahressicht nach unten, ist ein Kaufsignal nur ein
  // Handel auf Zeit – das muss dastehen, sonst widersprechen sich Signal und 12-Monats-Prognose.
  const forecast = forecastOf(trendScore, volDaily, short.score, long.score, regime, c.id === 'bitcoin');
  // Ein Kaufsignal muss sich mit den Prozent-Prognosen decken: 7 und 30 Tage im Plus, sonst nur „Halten“
  if (anticyclical) {
    hold = 'mindestens 12 Monate';
    notes.unshift(`Antizyklischer Einstieg: Bitcoin liegt ${num(-regime.cycle.dd, 0)} % unter seinem Allzeithoch${fear > 0 ? ' und der Fear-&-Greed-Index steht seit Wochen in der Angstzone' : ''}. `
      + `Aus solchen Lagen stand ${c.id === 'bitcoin' ? 'Bitcoin ein Jahr später in 77–100 %' : 'Ethereum ein Jahr später in 57–100 %'} der Fälle höher. `
      + 'Kurzfristig kann der Kurs weiter fallen – das Signal gilt für Käufe in Raten und eine Haltedauer von mindestens 12 Monaten.');
  } else if (signal === 'buy' && (forecast.short.mid <= 0 || forecast.medium.mid <= 0)) {
    [signal, label, hold] = ['hold', 'Halten', 'Abwarten'];
    notes.push('Der Score reicht für ein Kaufsignal, aber die Prognose für 7 oder 30 Tage liegt nicht im Plus – deshalb nur „Halten“.');
  }
  const yearDown = forecast.long && !forecast.long.mixed && forecast.long.mid <= -5;
  if (signal === 'buy' && yearDown && !anticyclical) {
    if (hold === '1–3 Monate') hold = '2–4 Wochen';
    const [first, second] = forecast.long.cycles;
    notes.unshift(`Das Kaufsignal gilt für die nächsten Wochen, nicht zum langen Halten: Ein Jahr nach vergleichbaren Zyklus-Ständen lag das mittlere Ergebnis solcher Coins bei ${signed(first, 0)} % (${CYCLE_NAMES[0]}) und ${signed(second, 0)} % (${CYCLE_NAMES[1]}). Wer kauft, sollte nach der Haltedauer neu prüfen und bei einem Verkaufssignal aussteigen.`);
  }
  return { signal, label, score, stable: false, short, medium, long, regime, news: news ?? null, horizon: hold,
    anticyclical, scope: signal !== 'buy' ? null : anticyclical ? 'year' : yearDown ? 'weeks' : 'open',
    risk: riskOf(c, volDaily), agreement: agreementOf(forecast, signal === 'sell' ? -1 : signal === 'buy' ? 1 : Math.sign(score)), notes,
    forecast, reasons: withAnticyclical(reasons(short, medium, long, regime), anticyclical ? score - trendScore : 0, regime) };
}

// Der antizyklische Einstieg erscheint als eigener Grund – er ist kein Kursmerkmal, sondern die Regel der Reserve
function withAnticyclical(why, points, regime) {
  if (points > 0) why.pro.unshift({ name: 'Antizyklischer Einstieg', horizon: '12 Monate', points,
    text: `Bitcoin ${num(-regime.cycle.dd, 0)} % unter dem Allzeithoch${fearZone(regime) > 0 ? ', seit Wochen Angst am Markt' : ''}` });
  return why;
}

// Starker Tagesrückgang. Auswertung 2018–2026: Fiel ein Coin an einem Tag um mehr als 20 %, stand er 3 Tage
// später in 69 % der Fälle höher (bei 12–20 %: 58 %, bei weniger als 8 %: kein Vorteil). Das galt nur, wenn der
// ganze Markt mitfiel – fiel ein Coin allein, ging es meist weiter abwärts (nach 7 Tagen nur in rund 40 % höher).
const DIP = [[-25, 1], [-20, 0.9], [-12, 0.4], [-8, 0.1], [-5, 0], [100, 0]];
const DIP_ALONE = -10;     // so viel schlechter als der Markt gilt als Absturz aus eigenem Grund
const DIP_WEIGHT = 0.5;

function dipFactor(c, marketDay) {
  const h24 = c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h;
  if (!isNum(h24) || h24 > -8) return null;
  const market = isNum(marketDay) ? marketDay : null;
  if (market !== null && h24 - market <= DIP_ALONE) {
    return factor('Tagesrückgang', `${signed(h24)} % an einem Tag, der Gesamtmarkt nur ${signed(market)} % – fällt ein Coin allein, steckt oft eine schlechte Nachricht dahinter`, -0.4, DIP_WEIGHT);
  }
  const score = curve(h24, DIP);
  return score > 0 ? factor('Tagesrückgang', `${signed(h24)} % an einem Tag${market !== null ? ` (Gesamtmarkt ${signed(market)} %)` : ''} – nach solchen Ausverkäufen folgte in den nächsten Tagen oft eine Gegenbewegung`, score, DIP_WEIGHT) : null;
}

// Kurzfristiger Baustein samt Tagesrückgang, falls einer vorliegt
const withDip = (short, c, regime) => {
  const dip = dipFactor(c, regime?.marketDay);
  return dip ? horizon([...short.factors, dip]) : short;
};

export function quickAnalyse(c, regime) {
  if (isStable(c)) return none('Stablecoin', 'Der Kurs ist an einen festen Wert gebunden – keine Prognose nötig.', true);
  if (isForeign(c)) return none('Kein Krypto-Coin', 'Dieser Token bildet den Kurs einer Aktie, eines Fonds, eines Edelmetalls oder einer Währung ab. Das Modell ist an Krypto-Coins geprüft und gibt dafür keine Prognose.');
  const prices = sparkline(c);
  const ch = changes(c);
  const f = (name, value, pts, weight, text) => {
    const score = curve(value, pts);
    return score === null ? null : factor(name, text ?? `${signed(value)} %`, score, weight);
  };

  // Stundenkurse auf 4 Stunden ausdünnen, damit der RSI weniger rauscht
  const fourHour = prices.filter((_, i) => (prices.length - 1 - i) % 4 === 0);
  const r = prices.length >= 60 ? rsiSeries(fourHour).at(-1) : null;
  const short = [
    f('Veränderung 7 Tage', ch.d7, C.ret7, 0.5),
    isNum(r) ? factor('RSI (4 Stunden)', `${num(r, 0)} – ${r < 30 ? 'überverkauft' : 'kein Ausverkauf'}`, curve(r, C.rsiRebound), 0.5) : null,
  ];
  const medium = [
    f('Momentum 30 Tage', ch.d30, C.ret30, 0.6),
    f('Momentum 14 Tage', ch.d14, C.ret14, 0.4),
  ];
  const long = [
    f('Momentum 200 Tage', ch.d200, C.ret200, 0.4, isNum(ch.d200) ? `${signed(ch.d200)} %${ch.d200 > 80 ? ' – stark gelaufen, Rückschlaggefahr' : ''}` : null),
    f('Momentum 1 Jahr', ch.y1, C.ret365, 0.35),
    f('Abstand zum Allzeithoch', c.ath_change_percentage, C.high, 0.25, isNum(c.ath_change_percentage) ? `${num(-c.ath_change_percentage, 0)} % unter dem Allzeithoch` : null),
  ];

  const volDaily = prices.length >= 60 ? stdev(logReturns(prices)) * Math.sqrt(24) * 100 : null;
  // Hier stammt die Schwankung nur aus 7 Tagen Stundenkursen: Ruhe über so kurze Zeit ist kein Beleg, deshalb
  // zählt sie in der Schnellbewertung nur als Nachteil. Mit Tageskursen (90 Tage) zählt sie in beide Richtungen.
  const withSwing = (list, weight) => horizon(list.some(Boolean) ? [...list, swingFactor(volDaily, weight, true)] : []);
  const a = assemble(c, withDip(withSwing(short, SWING_W.short), c, regime), withSwing(medium, SWING_W.medium), withSwing(long, SWING_W.long), regime, volDaily);
  // Ohne mehrjährige Tageskurse ist ein Kaufsignal nicht geprüft – die Bewertung mit Tageskursen (detailAnalyse) ersetzt diese
  if (a.signal === 'buy') {
    Object.assign(a, { signal: 'hold', label: 'Halten', horizon: 'Abwarten', scope: null });
    a.notes.push('Für diesen Coin fehlen Tageskurse über mehrere Jahre. Ohne sie ist ein Kaufsignal nicht geprüft und wird auf „Halten“ begrenzt.');
  }
  return a;
}

// Stimmung des einzelnen Coins von 0 (Angst) bis 100 (Gier) – ein eigener Wert in der Art des Fear-&-Greed-Index,
// gerechnet aus dem Kursverlauf: RSI (30 %), Lage in der 30-Tage-Spanne (30 %) und 30-Tage-Veränderung gemessen an
// der üblichen Schwankung (40 %). Einen fertigen Index je Coin gibt es nicht frei verfügbar.
// Auswertung 2018–2026: Für sich allein sagt der Wert wenig voraus. Unter 15 folgte in 59 % der Fälle eine Erholung
// über 7 Tage, nach 30 Tagen stand der Kurs aber nur in 43 % der Fälle höher. Nach mehr als 14 Tagen über 75 stand
// der Kurs 7 Tage später nur in 43 % der Fälle höher. Deshalb wird der Wert angezeigt, aber nicht in den Score gerechnet
// (die kurzfristige Erholung nach Ausverkauf steckt schon im kurzfristigen Baustein).
function moodAt(ind, i) {
  if (i < 30 || !isNum(ind.swing[i]) || !isNum(ind.rsi[i])) return null;
  let lo = Infinity, hi = 0;
  for (let k = i - 29; k <= i; k++) { lo = Math.min(lo, ind.prices[k]); hi = Math.max(hi, ind.prices[k]); }
  const pos = hi > lo ? (ind.prices[i] - lo) / (hi - lo) * 100 : 50;
  const z = Math.log(ind.prices[i] / ind.prices[i - 30]) / (ind.swing[i] / 100 * Math.sqrt(30));
  return 0.3 * ind.rsi[i] + 0.3 * pos + 0.4 * 50 * (1 + Math.tanh(z * 0.8));
}

export function moodOf(ind) {
  const i = ind.n - 1, value = moodAt(ind, i);
  if (value === null) return null;
  const streak = (test) => { let n = 0; for (let k = i; k > i - 90 && k >= 0; k--) { const m = moodAt(ind, k); if (m === null || !test(m)) break; n++; } return n; };
  return { value: Math.round(value), fearDays: streak((m) => m < 25), greedDays: streak((m) => m > 75) };
}

// Verfeinerte Bewertung mit Tageskursen (bis zu 4 Jahre) und Nachrichten
export function detailAnalyse(c, ind, regime, news) {
  const quick = c.analysis;
  if (quick.signal === 'none' || ind.n < 30) return quick;
  const s = scoreAt(ind, ind.n - 1);
  const pick = (a, b) => (a.score !== null ? a : b);
  // quick.short enthält den Tagesrückgang schon; der Baustein aus Tageskursen bekommt ihn hier dazu
  const short = s.short.score !== null ? withDip(s.short, c, regime) : quick.short;
  const a = assemble(c, short, pick(s.medium, quick.medium), pick(s.long, quick.long), regime, quick.risk.vol, news);
  if (a.signal !== 'none') { a.trade = tradeSetup(c, a, ind, regime); a.mood = moodOf(ind); }
  return a;
}

// ---------- Kurzfristige Handelsmuster ----------
// Geprüft an Tageskerzen mit Hoch und Tief (84 Coins, 2018–2026), mit 0,5 % Gebühren je Handel und getrennt nach
// vier Zwei-Jahres-Abschnitten. Ziel und Stopp sind Vielfache der Tagesschwankung des Coins; trifft eine Kerze beides,
// zählt der Stopp. Aufgenommen sind nur Muster, die je Handel in allen vier Abschnitten im Plus lagen.
//
// selloff: Der Coin fiel in 7 Tagen um mindestens 25 % – zusammen mit dem Markt (mittlerer Coin −10 % oder mehr),
//   außerhalb eines Bärenmarkts und während der Fear-&-Greed-Index nicht in der Angstzone stand (7-Tage-Schnitt ab 45).
//   Die beiden letzten Bedingungen kamen aus der Prüfung: Fiel ein Coin allein, gab es keinen Vorteil (54 % Treffer,
//   im Schnitt −0,6 %), und in Angstphasen ging es nach Ausverkäufen in zwei von vier Abschnitten weiter abwärts.
// score: Prognose-Score ab +40. Mit dem weiteren Ziel (4-fache Schwankung, 14 Tage) war der Vorteil rund dreimal so
//   groß wie mit dem engen (2-fach, 7 Tage); beide Varianten lagen in allen vier Abschnitten im Plus.
// hit/avg: Treffer und mittlerer Ertrag je Handel; dayHit/dayAvg: dasselbe je Signaltag gemittelt (ein Tag mit vielen
//   Signalen zählt dann nur einmal). blocks: mittlerer Ertrag je Handel in den vier Abschnitten.
// Kein Short-Muster bestand die Prüfung: Von über 20 Varianten (Verkaufs-Score, Erholung im Bärenmarkt, extreme Gier
// nahe am Hoch, Bruch von Tiefs, starke Anstiege) lag keine in allen vier Abschnitten im Plus; die beste Familie
// (extreme Gier nahe am Hoch) gewann 2022–2026 und verlor 2020/21 im Schnitt 3–10 % je Handel.
export const TRADE_SETUPS = {
  selloff: { label: 'Erholung nach Wochen-Ausverkauf', target: 2, stop: 3, days: 7, hit: 83, avg: 7.3, dayHit: 71, dayAvg: 3.5,
    cases: 1250, signalDays: 118, blocks: [6.5, 12.5, 6.8, 6.0],
    caveat: 'Im jüngsten Abschnitt (2024–2026) lagen nur 59 % der Signaltage im Plus; über die Tage gemittelt blieb dort kein Gewinn.' },
  score: { label: 'Sehr starker Score', target: 4, stop: 3, days: 14, hit: 57, avg: 2.7, dayHit: 68, dayAvg: 3.2,
    cases: 3183, signalDays: 205, blocks: [1.7, 5.5, 2.0, 4.8], caveat: '' },
};
export const TRADE_LIMITS = { selloff: -25, score: 40, fng: 45, market: -10 };
// Die Short-Muster, die der Prüfung am nächsten kamen: mittlerer Ertrag je Handel in % nach Kosten (0,5 % Gebühren und
// 0,03 % Finanzierung je Tag; Ziel 2-fache, Stopp 3-fache Tagesschwankung, höchstens 7 Tage) in den vier Abschnitten
// 2018–20, 2020–22, 2022–24 und 2024–26. null: in dem Abschnitt kam das Muster nicht vor.
export const SHORT_TESTS = [
  ['Extreme Gier seit 1–7 Tagen, Bitcoin nahe am Allzeithoch (Altcoins)', [null, -3.3, 3.2, 1.8]],
  ['Verkaufssignal bei stark schwankenden Coins', [-6.1, 1.5, -2.3, 5.0]],
  ['Fear & Greed kippt aus der Gierzone (Altcoins)', [0.7, -9.9, 1.2, -2.5]],
  ['Gier-Zone und Coin in 30 Tagen über 30 % gestiegen', [null, -0.5, 1.6, -0.8]],
  ['Erholung im Bärenmarkt (+20 % in 7 Tagen)', [-1.2, -0.9, -5.5, -0.2]],
];

// Was Hebel in der Rückrechnung bewirkt hätte: je Signaltag 10 % des Kontos als Sicherheit, auf höchstens 5 Signale
// verteilt. Liquidation, sobald der Kurs um 0,9 / Hebel fällt; Finanzierungskosten 0,03 % je Tag.
// [Hebel, Ergebnis pro Jahr in %, größter Rückgang in %, Zahl der Liquidationen]
export const TRADE_LEVERAGE = {
  selloff: [[1, 6, 10, 0], [2, 10, 20, 2], [3, 14, 34, 7], [5, 21, 48, 62], [10, 7, 76, 173]],
  score: [[1, 7, 8, 0], [2, 13, 16, 0], [3, 18, 24, 1], [5, 26, 38, 10], [10, 28, 75, 145]],
};

function tradeSetup(c, a, ind, regime) {
  const i = ind.n - 1, sw = ind.swing[i], r7 = retAt(ind, i, 7);
  if (!isNum(sw) || sw < 1.5 || sw > 10 || !isNum(c.current_price)) return null;
  const sold = r7 !== null && r7 <= TRADE_LIMITS.selloff && !regime.bear;
  const calm = isNum(regime?.fng?.avg7) && regime.fng.avg7 >= TRADE_LIMITS.fng;
  // Der Markt muss mitgefallen sein – fällt ein Coin allein, steckt meist eine schlechte Nachricht dahinter
  const together = isNum(regime?.marketWeek) && regime.marketWeek <= TRADE_LIMITS.market;
  const kind = sold && calm && together ? 'selloff' : a.score >= TRADE_LIMITS.score ? 'score' : null;
  const info = { swing: r1(sw), r7: r7 === null ? null : r1(r7), blocked: !sold ? null : !together ? 'alone' : !calm ? 'fear' : null };
  if (!kind) return { ...info, kind: null };
  const s = TRADE_SETUPS[kind], entry = c.current_price;
  return { ...info, kind, side: 'long', entry, targetPct: r1(s.target * sw), stopPct: r1(s.stop * sw),
    target: entry * (1 + s.target * sw / 100), stop: entry * (1 - s.stop * sw / 100), days: s.days, time: Date.now() };
}

// ---------- Marktindex ----------

export function marketIndex(coins, btcInd, fng, news) {
  const btc = coins.find((c) => c.id === 'bitcoin');
  const top = coins.filter((c) => !isStable(c)).slice(0, 200);
  if (!btc || top.length < 20) return null;

  // Marktphase über 14 Tage geglättet, damit ein einzelner schwacher Tag nicht alle Bewertungen kippt
  const lastDay = btcInd ? btcInd.days[btcInd.n - 1] : null;
  const fngAt = (d) => fng?.byDay?.get(d) ?? (d === lastDay ? fng?.value : undefined);
  const regime = btcInd ? regimeSmooth(btcInd, btcInd.n - 1, fngAt, REGIME_DAYS) : regimeFromMarket(btc);
  // Fear & Greed im Zeitverlauf (fng.values: Tageswerte, neuester zuerst) – für Gier-Bremse und Reserve
  regime.fng = fngState(fng?.values ?? (isNum(fng?.value) ? [fng.value] : []));
  // Stand im Zyklus: Abstand von Bitcoin zu seinem Allzeithoch
  const cycle = isNum(btc.ath_change_percentage) ? cycleInfo(btc.ath_change_percentage) : null;
  regime.cycle = cycle ? { dd: cycle.dd, btcUp: cycle.btcUp } : null;
  // Tagesbewegung des Gesamtmarkts: mittlere 24-Stunden-Veränderung der größten Coins
  const day = top.map((c) => c.price_change_percentage_24h_in_currency).filter(isNum).sort((a, b) => a - b);
  regime.marketDay = day.length ? day[Math.floor(day.length / 2)] : null;
  // Wochenbewegung des Gesamtmarkts – für das Handelsmuster „Ausverkauf“ (der Markt muss mitgefallen sein)
  const week = top.map((c) => c.price_change_percentage_7d_in_currency).filter(isNum).sort((a, b) => a - b);
  regime.marketWeek = week.length ? week[Math.floor(week.length / 2)] : null;
  const share = (key) => {
    const vals = top.map((c) => c[key]).filter(isNum);
    return vals.length ? vals.filter((v) => v > 0).length / vals.length : 0.5;
  };
  const up7 = share('price_change_percentage_7d_in_currency');
  const up30 = share('price_change_percentage_30d_in_currency');

  // Der Index rechnet mit der geglätteten Marktphase (70 %), der Marktbreite (20 %) und der Nachrichtenlage (10 %)
  const smoothed = isNum(regime.today)
    ? `Schnitt der letzten ${REGIME_DAYS} Tage; der heutige Tag allein läge bei ${signed(regime.today * 100, 0)}`
    : 'aus der Bitcoin-Veränderung über 30 Tage';
  const parts = regime.score === null ? [] : [factor('Marktphase (Bitcoin)', smoothed, regime.score, 0.7)];
  parts.push(factor('Marktbreite', `${num(up7 * 100, 0)} % der Top 200 im Plus über 7 Tage, ${num(up30 * 100, 0)} % über 30 Tage`, clamp((up7 + up30 - 1) * 1.5), 0.2));
  if (news && news.score !== null) parts.push(factor('Nachrichtenlage', news.text, news.score, 0.1));

  let value = Math.round(50 + 50 * combine(parts));
  if (greedZone(regime)) {
    // Der Index darf nicht „Kaufen“ sagen, während die Gier-Bremse alle Kaufsignale sperrt
    value = Math.min(value, 56);
    parts.push(factor('Gier-Bremse', `Fear & Greed im 7-Tage-Schnitt bei ${num(regime.fng.avg7, 0)} – nach solchen Phasen fielen die meisten Coins; der Index bleibt höchstens bei „Halten“`, -1, 0));
  }
  let signal, label;
  if (value >= 68) [signal, label] = ['buy', 'Kaufen'];
  else if (value >= 57) [signal, label] = ['buy', 'Eher kaufen'];
  else if (value <= 32) [signal, label] = ['sell', 'Verkaufen'];
  else if (value <= 43) [signal, label] = ['sell', 'Eher verkaufen'];
  else [signal, label] = ['hold', 'Halten'];
  return { value, signal, label, parts, regime, cycle, forecast: marketForecast(regime, cycle) };
}

// ---------- Nachrichten ----------

const POSITIVE = /\b(surg\w*|soar\w*|rall(y|ies|ied)|jump\w*|climb\w*|gains?|record high|all[- ]time high|bullish|breakout|approv\w*|inflows?|adopt\w*|partner\w*|integrat\w*|launch\w*|upgrade\w*|mainnet|listing|listed|accumulat\w*|buys?|bought|purchas\w*|invest\w*|funding|raises?|raised|reclaim\w*|rebound\w*|recover\w*|outperform\w*|milestone|expand\w*|wins?|boost\w*|rises?|rose|tops?|strong\w*|optimis\w*)\b/gi;
const NEGATIVE = /\b(hack\w*|exploit\w*|breach\w*|stolen|theft|drain\w*|rug ?pull|scam\w*|fraud\w*|lawsuit|sue[sd]?|charges?|charged|indict\w*|investigat\w*|probe|bans?|banned|crackdown|delist\w*|bankrupt\w*|insolven\w*|collaps\w*|crash\w*|plung\w*|plummet\w*|tumbl\w*|slump\w*|sell[- ]?off|liquidat\w*|outage|halt\w*|depeg\w*|vulnerab\w*|dump\w*|bearish|warn\w*|fears?|loss(es)?|declin\w*|drops?|dropped|falls?|fell|sinks?|sank|outflows?|sanction\w*|reject\w*|slides?|slid|weak\w*|risks?|concerns?|struggl\w*|down|shut\w*|worr(y|ied|ies)|wobbl\w*|uncertain\w*)\b/gi;
const NEWS_WINDOW_MS = 7 * 86_400_000;

// Einfache Stichwort-Auswertung der Schlagzeilen. Erkennt keine Ironie und keinen Zusammenhang –
// deshalb fließt das Ergebnis nur mit kleinem Gewicht in die Prognose ein.
export function analyseNews(articles, now = Date.now()) {
  const items = articles.filter((a) => now - a.time < NEWS_WINDOW_MS).map((a) => {
    const text = `${a.title}. ${a.description ?? ''}`;
    const pos = (text.match(POSITIVE) || []).length, neg = (text.match(NEGATIVE) || []).length;
    return { ...a, tone: pos > neg ? 1 : neg > pos ? -1 : 0 };
  });
  if (items.length < 3) return { score: null, items, text: 'Zu wenige aktuelle Meldungen für eine Auswertung.' };
  // Neuere Meldungen zählen stärker
  let s = 0, w = 0;
  for (const it of items) {
    const weight = 1 / (1 + (now - it.time) / 86_400_000);
    s += it.tone * weight; w += weight;
  }
  const pos = items.filter((i) => i.tone > 0).length, neg = items.filter((i) => i.tone < 0).length;
  return { score: clamp(s / w * 1.5), items,
    text: `${items.length} Meldungen der letzten 7 Tage: ${pos} positiv, ${neg} negativ, ${items.length - pos - neg} neutral` };
}

// ---------- Rückblick-Test und erwartete Schwankung ----------

// Wie entwickelte sich der Kurs in der Vergangenheit, nachdem das Modell ein Signal zeigte?
// Bewertet wird der Gesamt-Score aus Tagesdaten und Marktphase; Nachrichten und Stundenkurse
// gibt es für die Vergangenheit nicht.
export function backtest(ind, btcInd, fngByDay, days) {
  const btcIndex = btcInd ? new Map(btcInd.days.map((d, j) => [d, j])) : null;
  const bucket = () => ({ n: 0, up: 0, sum: 0, list: [] });
  const res = { buy: bucket(), sell: bucket(), all: bucket() };
  // Die ersten 200 Tage dienen als Vorlauf für den 200-Tage-Schnitt, bei kurzer Historie weniger
  for (let i = Math.min(200, Math.floor(ind.n / 3)); i + days < ind.n; i++) {
    const j = btcIndex?.get(ind.days[i]);
    if (btcIndex && j === undefined) continue;
    const s = scoreAt(ind, i);
    const regime = btcInd ? regimeSmooth(btcInd, j, (d) => fngByDay?.get(d), REGIME_DAYS) : horizon([]);
    if (fngByDay) {
      const week = [];
      for (let k = 0; k < 7; k++) { const x = fngByDay.get(ind.days[i] - k); if (isNum(x)) week.push(x); }
      if (week.length >= 5) regime.fng = { avg7: avg(week) };
    }
    const raw = totalScore(s.short, s.medium, s.long, regime);
    if (raw === null) continue;
    const [signal] = signalOf(Math.round(raw * 100));
    const fwd = (ind.prices[i + days] / ind.prices[i] - 1) * 100;
    const targets = [res.all];
    if (signal === 'buy') targets.push(res.buy);
    if (signal === 'sell') targets.push(res.sell);
    for (const b of targets) { b.n++; b.sum += fwd; b.list.push(fwd); if (fwd > 0) b.up++; }
  }
  const middle = (list) => (list.length ? list.sort((x, y) => x - y)[list.length >> 1] : null);
  const done = (b) => ({ n: b.n, upRate: b.n ? b.up / b.n * 100 : null, mean: b.n ? b.sum / b.n : null, median: middle(b.list) });
  return { days, buy: done(res.buy), sell: done(res.sell), all: done(res.all) };
}

// Übliche Schwankungsbreite (eine Standardabweichung) aus den letzten 90 Tagen
export function expectedMove(prices) {
  const sd = stdev(logReturns(prices.slice(-91)));
  if (!isNum(sd)) return null;
  return { d7: sd * Math.sqrt(7), d30: sd * Math.sqrt(30) };
}
