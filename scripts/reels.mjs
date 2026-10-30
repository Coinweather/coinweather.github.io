// Reels mit Bewegung: jeden Tag ein anderes Format, aus echten Daten, 9 bis 13 Sekunden, Hochformat 1080×1920.
// Jedes Bild ist ein SVG, das sharp zeichnet und ffmpeg zum Video zusammensetzt; die Musik entsteht hier im Programm (keine Lizenzfragen).
//
// Regeln: Die erste Sekunde ist eine große Frage. Text steht innerhalb der Flächen, die Instagram nicht überdeckt. Verluste werden genauso
// gezeigt wie Gewinne, jede Rückschau trägt den Hinweis, dass sie keine Prognose ist. Coins aus dem Modell nur so weit, wie die Seite sie
// auch Gästen zeigt (Bitcoin und Ethereum), der Rest bleibt gesperrt.
import { execFileSync, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { buyHistory } from '../js/model.js';

const W = 1080, H = 1920, FPS = 30;
const C = { bg: '#0a0e17', panel: '#141b2b', line: '#2a3548', text: '#f4f6fb', muted: '#97a3b6', accent: '#f7931a', up: '#35d68b', down: '#ff5d5d', sun: '#ffd24a' };

// Anton ist schmal und laut; ohne die Schrift (fc-list) Impact oder notfalls DejaVu. RATIO: mittlere Zeichenbreite je Schriftgröße
const HAS_ANTON = (() => { try { return /Anton/.test(execFileSync('fc-list', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return false; } })();
const DISPLAY = HAS_ANTON ? 'Anton' : process.platform === 'win32' ? 'Impact' : 'DejaVu Sans';
const RATIO = HAS_ANTON ? 0.45 : process.platform === 'win32' ? 0.5 : 0.68;
const BODY = process.platform === 'win32' ? 'Arial' : 'DejaVu Sans';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const out3 = (x) => 1 - (1 - x) ** 3;
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
// Innerhalb des Bereichs, den Instagram nicht verdeckt (rechts die Knöpfe, unten der Text): Mitte bei 500, Breite 880
const CX = 500, MAXW = 800;

function fit(text, maxSize, maxW = MAXW) { return Math.min(maxSize, Math.floor(maxW / (Math.max(1, String(text).length) * RATIO))); }
const display = (text, y, size, fill = C.text, x = CX, anchor = 'middle') => `<text x="${x}" y="${y}" font-family="${DISPLAY}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
const big = (text, y, maxSize, fill = C.text, x = CX, anchor = 'middle') => display(text, y, fit(text, maxSize), fill, x, anchor);
const body = (text, y, size = 44, fill = C.muted, weight = 400, x = CX, anchor = 'middle') => `<text x="${x}" y="${y}" font-family="${BODY}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
// Taucht auf und wächst kurz über die volle Größe hinaus
function pop(t, at, inner, cy = 800) {
  const p = seg(t, at, at + 0.22);
  if (p <= 0) return '';
  const s = 0.7 + 0.3 * out3(p) + 0.06 * Math.sin(p * Math.PI);
  return `<g opacity="${clamp(p * 3)}" transform="translate(${CX} ${cy}) scale(${s.toFixed(3)}) translate(${-CX} ${-cy})">${inner}</g>`;
}
function bg(t, glow = C.accent) {
  const y = 700 + 120 * Math.sin(t * 0.9);
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101728"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="${glow}" stop-opacity=".38"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${glow}" stop-opacity=".35"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/><ellipse cx="${CX}" cy="${y}" rx="760" ry="760" fill="url(#glow)"/>`;
}
const brand = (color) => `<text x="60" y="222" font-family="${BODY}" font-size="36" font-weight="700" fill="${color}">coinweather</text>`;
const foot = (text) => body(text, 1350, 30, C.muted);
// Linie, die sich bis progress (0…1) zeichnet; gibt auch den Endpunkt zurück
function line(vals, box, progress, color, area = true) {
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const X = (i) => box.x + box.w * i / (vals.length - 1), Y = (v) => box.y + box.h - box.h * (v - lo) / span;
  const end = progress * (vals.length - 1), n = Math.floor(end), f = end - n;
  const pts = vals.slice(0, n + 1).map((v, i) => [X(i), Y(v)]);
  if (n < vals.length - 1) pts.push([X(n + f), Y(vals[n] + (vals[n + 1] - vals[n]) * f)]);
  const d = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [ex, ey] = pts[pts.length - 1];
  return { svg: `${area ? `<polygon points="${pts[0][0]},${box.y + box.h} ${d} ${ex},${box.y + box.h}" fill="url(#area)"/>` : ''}
      <polyline points="${d}" fill="none" stroke="${color}" stroke-opacity=".25" stroke-width="20" stroke-linejoin="round" stroke-linecap="round"/>
      <polyline points="${d}" fill="none" stroke="${color}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${ex}" cy="${ey}" r="14" fill="${color}"/>`, x: ex, y: ey };
}

// Die Frage steht schon im allerersten Bild, groß auf voller Farbe – sie ist auch das Titelbild und muss den Daumen stoppen
function hookScene(t, lines, color = C.accent) {
  const sizes = lines.map(([text, size]) => fit(text, size)), gap = 34;
  const height = sizes.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
  let y = 760 - height / 2;
  const rows = lines.map(([text, , fill], i) => {
    y += sizes[i];
    const row = display(text, y, sizes[i], fill === 'accent' ? '#ffffff' : fill === C.muted ? 'rgba(0,0,0,.62)' : '#10131b');
    y += gap;
    return row;
  }).join('');
  const k = 0.94 + 0.06 * out3(seg(t, 0, 0.16));
  return `<rect x="-600" y="-600" width="2400" height="3200" fill="${color}"/><g transform="translate(${CX} 760) scale(${k.toFixed(3)}) translate(${-CX} -760)">${rows}</g>`;
}
function ctaScene(t, at, title, sub, note, glow = C.accent) {
  return `${pop(t, at, big(title[0], 640, 130))}${title[1] ? pop(t, at + 0.15, big(title[1], 790, 130, C.accent)) : ''}
    ${pop(t, at + 0.35, `<rect x="${CX - 400}" y="880" width="800" height="170" rx="36" fill="${glow}"/>${big(sub, 992, 84, '#111')}`, 960)}
    ${pop(t, at + 0.55, body('Link in bio', 1140, 52, C.text, 700))}${foot(note)}`;
}

// ---------- Musik: 124 Schläge pro Minute, kurz und trocken; Kasse auf den Schnitten, leise Ticks beim Zählen ----------
function music(seconds, cuts = [], ticks = []) {
  const rate = 44100, n = Math.ceil(seconds * rate), L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / 124;
  const add = (at, len, fn, gainL = 1, gainR = 1) => { const a = Math.floor(at * rate), m = Math.min(n - a, Math.floor(len * rate)); for (let i = 0; i < m; i++) { const v = fn(i / rate); L[a + i] += v * gainL; R[a + i] += v * gainR; } };
  let seed = 7; const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const kick = (x) => Math.sin(2 * Math.PI * (48 * x + 14 * (1 - Math.exp(-x * 30)))) * Math.exp(-x * 7) * 0.9;
  const hat = (x) => noise() * Math.exp(-x * 90) * 0.13;
  const snare = (x) => (noise() * 0.5 + Math.sin(2 * Math.PI * 190 * x) * 0.3) * Math.exp(-x * 18) * 0.55;
  const bassNotes = [55, 55, 65.4, 49];
  for (let k = 0, at = 0; at < seconds; k++, at += beat) {
    add(at, 0.3, kick);
    add(at + beat / 2, 0.06, hat, 1, 0.7);
    add(at + beat * 0.75, 0.04, hat, 0.7, 1);
    if (k % 4 === 2) add(at, 0.25, snare);
    const f = bassNotes[Math.floor(k / 8) % 4];
    add(at + beat / 2, beat * 0.45, (x) => (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x)) * Math.exp(-x * 3.5) * 0.38);
  }
  for (const at of cuts) add(at, 0.35, (x) => noise() * Math.exp(-x * 11) * (1 - Math.exp(-x * 90)) * 0.35);
  for (const at of ticks) add(at, 0.03, (x) => Math.sin(2 * Math.PI * 1500 * x) * Math.exp(-x * 160) * 0.12);
  const fade = Math.floor(rate * 0.25);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, (n - i) / fade);
    const l = Math.tanh(L[i] * 1.1) * g * 0.85, r = Math.tanh(R[i] * 1.1) * g * 0.85;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return { wav: buf, peak };
}

// ---------- Daten ----------
const STABLE_OUT = (c) => !c.analysis?.stable && c.analysis?.signal !== 'none';
async function dailyCloses(symbol) {
  const pair = `${symbol.toUpperCase()}USDT`;
  let rows = [], end = Date.now();
  for (let k = 0; k < 2; k++) {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&endTime=${end}`);
    if (!res.ok) break;
    const part = await res.json();
    if (!part.length) break;
    rows = part.concat(rows); end = part[0][0] - 1;
    if (part.length < 1000) break;
  }
  if (rows.length < 400) throw new Error(`keine Kursgeschichte für ${symbol}`);
  return { t: rows.map((r) => r[0]), p: rows.map((r) => Number(r[4])) };
}
const every = (arr, step) => arr.filter((_, i) => i % step === 0 || i === arr.length - 1);

// ---------- Formate: jedes liefert { dur, draw(t), cuts, ticks, caption } oder null, wenn die Daten nicht reichen ----------
function makeFormats({ snap, lang, day, model }) {
  const de = lang === 'de';
  const L = (en, ge) => (de ? ge : en);
  const locale = de ? 'de-CH' : 'en-US';
  const usd = (v) => `$${Math.round(v).toLocaleString(locale)}`;
  const pct = (v, digits = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString(locale, { maximumFractionDigits: digits })}%`;
  const { market, fng, coins } = snap;
  const NOTE = L('Past results are no forecast. Not financial advice.', 'Vergangenheit ist keine Prognose. Keine Anlageberatung.');
  const TAGS = '#crypto #bitcoin #cryptocurrency #investing #btc';
  const caption = (lines) => ({
    instagram: [...lines, '', `🔗 ${L('Free tools: link in bio', 'Gratis-Tools: Link in der Bio')}`, '', NOTE, TAGS].join('\n'),
    facebook: [...lines, '', `👉 https://coinweather.github.io/?von=facebook`, '', NOTE].join('\n'),
  });
  const rankPick = (list) => list[day % list.length];
  const NAMES = [['bitcoin', 'BTC', 'Bitcoin'], ['ethereum', 'ETH', 'Ethereum'], ['solana', 'SOL', 'Solana'], ['ripple', 'XRP', 'XRP'], ['binancecoin', 'BNB', 'BNB'],
    ['dogecoin', 'DOGE', 'Dogecoin'], ['cardano', 'ADA', 'Cardano'], ['chainlink', 'LINK', 'Chainlink'], ['tron', 'TRX', 'TRON'], ['avalanche-2', 'AVAX', 'Avalanche']];

  return {
    // „1.000 $ in X vor 3 Jahren“: Linie zeichnet sich, der Betrag zählt mit – auch der tiefste Punkt unterwegs steht da
    async whatif() {
      const [, sym, name] = rankPick(NAMES);
      const h = await dailyCloses(sym), years = 3, from = h.p.length - years * 365;
      if (from < 0) return null;
      const p = every(h.p.slice(from), 5), start = p[0], vals = p.map((x) => 1000 * x / start), end = vals[vals.length - 1];
      let peak = 0, dd = 0; for (const v of vals) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
      const y0 = new Date(h.t[from]).getUTCFullYear(), color = end >= 1000 ? C.up : C.down;
      const T1 = 2.1, T2 = 7.2, T3 = 9.6, dur = 12;
      return { dur, glow: color, cuts: [0, T1, T2, T3], ticks: Array.from({ length: 30 }, (_, i) => T1 + i * (T2 - T1) / 30),
        caption: caption([`💸 ${L(`$1,000 in ${name} ${years} years ago is ${usd(end)} today.`, `1'000 $ in ${name} vor ${years} Jahren sind heute ${usd(end)}.`)}`,
          `${L('But on the way it fell', 'Unterwegs ging es aber')} ${pct(dd * 100)} ${L('from its peak. Would you have held?', 'unter den Höchststand. Hättest du gehalten?')}`, '', `👇 ${L('Which coin should we check next?', 'Welchen Coin sollen wir als Nächstes rechnen?')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [['$1,000', 230, 'accent'], [L(`IN ${name.toUpperCase()}`, `IN ${name.toUpperCase()}`), 150], [L(`${years} YEARS AGO`, `VOR ${years} JAHREN`), 110], [L('WORTH NOW?', 'WERT HEUTE?'), 110, C.muted]]);
          if (t < T2) {
            const pr = out3(seg(t, T1, T2 - 0.2)) , c = line(vals, { x: 110, y: 620, w: 780, h: 620 }, pr, color);
            const now = vals[Math.floor(pr * (vals.length - 1))];
            const date = new Date(h.t[from] + pr * (h.t[h.t.length - 1] - h.t[from])).toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
            return `${big(usd(now), 470, 190, now >= 1000 ? C.up : C.down)}${body(date, 550, 46)}${c.svg}${foot(NOTE)}`;
          }
          if (t < T3) return `${pop(t, T2, big(usd(end), 700, 260, color))}${pop(t, T2 + 0.25, big(pct((end / 1000 - 1) * 100), 870, 130, color))}
            ${pop(t, T2 + 0.9, `${body(L('Biggest fall on the way', 'Grösster Rückgang unterwegs'), 1020, 46)}${big(pct(dd * 100), 1140, 110, C.down)}`, 1060)}${foot(NOTE)}`;
          return ctaScene(t, T3, [L('YOUR PLAN?', 'DEIN PLAN?'), L('CALCULATE IT', 'AUSRECHNEN')], L('FREE CALCULATOR', 'GRATIS-RECHNER'), NOTE);
        } };
    },
    // „50 $ pro Woche“: eingezahlt gegen heutiger Wert
    async dca() {
      const pick = NAMES[[0, 1, 0, 2][day % 4]], [, sym, name] = pick;
      const h = await dailyCloses(sym), years = 3, from = h.p.length - years * 365;
      if (from < 0) return null;
      let units = 0, paid = 0; const worth = [], inv = [];
      for (let i = from; i < h.p.length; i++) { if ((i - from) % 7 === 0) { units += 50 / h.p[i]; paid += 50; } if ((i - from) % 5 === 0 || i === h.p.length - 1) { worth.push(units * h.p[i]); inv.push(paid); } }
      const end = worth[worth.length - 1], y0 = new Date(h.t[from]).getUTCFullYear(), color = end >= paid ? C.up : C.down;
      const T1 = 2.1, T2 = 7.4, T3 = 9.8, dur = 12.2;
      return { dur, glow: color, cuts: [0, T1, T2, T3], ticks: Array.from({ length: 30 }, (_, i) => T1 + i * (T2 - T1) / 30),
        caption: caption([`📅 ${L(`$50 a week into ${name} since ${y0}: ${usd(paid)} paid in, ${usd(end)} today.`, `50 $ pro Woche in ${name} seit ${y0}: ${usd(paid)} eingezahlt, heute ${usd(end)}.`)}`, '', `👇 ${L('What would your amount be? Calculate it free.', 'Was wäre es mit deinem Betrag? Gratis ausrechnen.')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [['$50', 300, 'accent'], [L('EVERY WEEK', 'JEDE WOCHE'), 150], [L(`${name.toUpperCase()} SINCE ${y0}`, `${name.toUpperCase()} SEIT ${y0}`), 120], [L('HOW MUCH NOW?', 'WIE VIEL HEUTE?'), 100, C.muted]]);
          if (t < T2) {
            const pr = seg(t, T1, T2 - 0.2), box = { x: 110, y: 640, w: 780, h: 600 };
            const c = line(worth, box, pr, color), i = Math.floor(pr * (worth.length - 1));
            return `${big(usd(worth[i]), 420, 170, color)}${body(`${L('paid in', 'eingezahlt')} ${usd(inv[i])}`, 510, 52, C.text, 700)}${c.svg}${foot(NOTE)}`;
          }
          if (t < T3) return `${pop(t, T2, `${body(L('Paid in', 'Eingezahlt'), 460, 54, C.text, 700)}${big(usd(paid), 620, 150, C.muted)}`, 560)}
            ${pop(t, T2 + 0.5, `${body(L('Worth today', 'Wert heute'), 740, 54, C.text, 700)}${big(usd(end), 980, 230, color)}`, 880)}${foot(NOTE)}`;
          return ctaScene(t, T3, [L('YOUR AMOUNT?', 'DEIN BETRAG?')], L('FREE CALCULATOR', 'GRATIS-RECHNER'), NOTE);
        } };
    },
    // „Am Hoch gekauft“: Wie tief ein großer Coin steht und was er bräuchte, um wieder auf null zu kommen
    async ath() {
      const list = coins.filter((c) => STABLE_OUT(c) && c.market_cap_rank <= 150 && c.ath_change_percentage <= -70).sort((a, b) => a.market_cap_rank - b.market_cap_rank).slice(0, 12);
      if (!list.length) return null;
      const c = rankPick(list), d = c.ath_change_percentage, left = 1000 * (1 + d / 100), need = 100 / (1 + d / 100) - 100, sym = c.symbol.toUpperCase();
      const T1 = 1.9, T2 = 5.4, T3 = 8.2, dur = 10.6;
      return { dur, glow: C.down, cuts: [0, T1, T2, T3], ticks: Array.from({ length: 24 }, (_, i) => T1 + i * (T2 - 0.6 - T1) / 24),
        caption: caption([`🏔️ ${L(`${c.name} is ${Math.abs(d).toFixed(0)}% below its all-time high.`, `${c.name} steht ${Math.abs(d).toFixed(0)} % unter dem Allzeithoch.`)}`, L(`It would need ${pct(need)} just to get back there. Buying high is expensive.`, `Es bräuchte ${pct(need)}, nur um wieder dort zu sein. Teuer kaufen kostet.`), '', `👇 ${L('Which coin hurt you the most?', 'Welcher Coin hat dir am meisten wehgetan?')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [[L('BOUGHT', 'GEKAUFT'), 130], [sym, 300, 'accent'], [L('AT THE TOP?', 'AM HOCH?'), 170]]);
          if (t < T2) {
            const pr = out3(seg(t, T1, T2 - 0.6)), v = 1000 - (1000 - left) * pr;
            return `${body(L('Your $1,000', 'Deine 1\'000 $'), 470, 60, C.text, 700)}${big(usd(v), 800, 300, C.down)}
              <rect x="100" y="900" width="800" height="50" rx="25" fill="${C.line}"/><rect x="100" y="900" width="${Math.max(6, 800 * v / 1000)}" height="50" rx="25" fill="${C.down}"/>
              ${pop(t, T2 - 0.7, big(pct(d), 1100, 150, C.down), 1050)}${foot(`${c.name} · ${L('all-time high to today', 'Allzeithoch bis heute')}`)}`;
          }
          if (t < T3) return `${pop(t, T2, big(L('TO BREAK EVEN', 'ZURÜCK AUF NULL'), 560, 110))}${pop(t, T2 + 0.3, big(pct(need), 780, 260, C.sun))}
            ${pop(t, T2 + 1, body(L('That is why the entry matters.', 'Deshalb zählt der Einstieg.'), 930, 52, C.text, 700))}${foot(NOTE)}`;
          return ctaScene(t, T3, [L('CHEAP OR', 'BILLIG ODER'), L('EXPENSIVE?', 'TEUER?')], L('FREE BUY SCORE', 'GRATIS KAUF-SCORE'), L('Score for 1,000 coins. Not financial advice.', 'Score für 1000 Coins. Keine Anlageberatung.'));
        } };
    },
    // „Errate den Coin“: Linie ohne Namen, Hinweise, Auflösung am Ende
    async guess() {
      const [, sym, name] = rankPick(NAMES.slice(1));
      const h = await dailyCloses(sym), p = every(h.p.slice(-365), 3), chg = (p[p.length - 1] / p[0] - 1) * 100, color = chg >= 0 ? C.up : C.down;
      const c = coins.find((x) => x.symbol.toUpperCase() === sym);
      const T1 = 1.8, T2 = 7.4, dur = 10.8;
      return { dur, glow: color, cuts: [0, T1, T2], ticks: [T2 - 2.4, T2 - 1.6, T2 - 0.8],
        caption: caption([`🤔 ${L('Guess the coin from its chart. No cheating 👀', 'Errate den Coin an seinem Chart. Nicht schummeln 👀')}`, '', `👇 ${L('How fast did you get it? Comment your time.', 'Wie schnell warst du? Schreib deine Zeit in die Kommentare.')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [[L('GUESS', 'ERRATE'), 240, 'accent'], [L('THE COIN', 'DEN COIN'), 220], [L('BEFORE THE TIMER ENDS', 'BEVOR DIE ZEIT ABLÄUFT'), 80, C.muted]]);
          const chart = line(p, { x: 110, y: 560, w: 780, h: 480 }, seg(t, T1, T1 + 3.2), color);
          if (t < T2) {
            const left = Math.ceil(T2 - t), hints = [[T1 + 1.4, L(`1 year: ${pct(chg)}`, `1 Jahr: ${pct(chg)}`)], [T1 + 3, L(`Rank #${c?.market_cap_rank ?? '?'}`, `Rang #${c?.market_cap_rank ?? '?'}`)], [T1 + 4.2, L(`${sym.length} letters`, `${sym.length} Buchstaben`)]];
            return `${big('? ? ?', 460, 220, C.accent)}${chart.svg}${hints.map(([at, text], i) => pop(t, at, body(text, 1120 + i * 70, 54, C.text, 700), 1150)).join('')}
              ${left <= 3 ? `<circle cx="830" cy="400" r="86" fill="${C.sun}"/>${display(String(left), 440, 110, '#10131b', 830)}` : ''}`;
          }
          return `${pop(t, T2, big(sym, 480, 300, color), 400)}${name.toUpperCase() === sym ? '' : pop(t, T2 + 0.15, body(name, 540, 56, C.text, 700), 520)}${chart.svg}
            ${pop(t, T2 + 0.9, big(L('DID YOU GET IT?', 'RICHTIG?'), 1180, 110), 1140)}${pop(t, T2 + 1.3, body(L('Comment your time', 'Schreib deine Zeit'), 1270, 54, C.text, 700), 1250)}`;
        } };
    },
    // Stimmung: Alle haben Angst – was die Daten dazu sagen
    async fear() {
      const v = fng?.value; if (!Number.isFinite(v) || !market?.buy) return null;
      const mood = v <= 40 ? L('EVERYONE IS SCARED', 'ALLE HABEN ANGST') : v >= 60 ? L('EVERYONE IS GREEDY', 'ALLE SIND GIERIG') : L('NOBODY KNOWS', 'KEINER WEISS WAS');
      const [m1, ...m2] = mood.split(' ');
      const y = buyHistory(market.value), color = v <= 40 ? C.down : v >= 60 ? C.up : C.sun;
      const T1 = 1.9, T2 = 5, T3 = 8.6, dur = 11;
      const needle = (a, r = 300) => { const rad = Math.PI * (1 - a / 100); return `<line x1="${CX}" y1="1020" x2="${CX + r * Math.cos(rad)}" y2="${1020 - r * Math.sin(rad)}" stroke="${C.text}" stroke-width="14" stroke-linecap="round"/><circle cx="${CX}" cy="1020" r="24" fill="${C.text}"/>`; };
      const arc = (a, b, col) => { const P = (x) => [CX + 340 * Math.cos(Math.PI * (1 - x / 100)), 1020 - 340 * Math.sin(Math.PI * (1 - x / 100))]; const [x1, y1] = P(a), [x2, y2] = P(b); return `<path d="M${x1} ${y1} A340 340 0 0 1 ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="56"/>`; };
      return { dur, glow: color, cuts: [0, T1, T2, T3],
        caption: caption([`😱 ${L(`Fear & Greed is at ${v}. Buy score: ${market.value}/100.`, `Fear & Greed steht bei ${v}. Kauf-Score: ${market.value}/100.`)}`, y ? L(`A year after similar scores since 2022, Bitcoin was higher in ${y.btc.up} of 100 cases. A small sample, not a promise.`, `Ein Jahr nach ähnlichen Ständen seit 2022 lag Bitcoin in ${y.btc.up} von 100 Fällen höher. Kleine Stichprobe, kein Versprechen.`) : '', '', `👇 ${L('Are you buying or waiting right now?', 'Kaufst du gerade oder wartest du?')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [[m1, 180, 'accent'], [m2.join(' '), 180]], color);
          if (t < T2) {
            const a = v * out3(seg(t, T1 + 0.2, T1 + 1.8));
            return `${big(L('FEAR & GREED TODAY', 'FEAR & GREED HEUTE'), 480, 90)}${arc(0, 25, C.down)}${arc(25, 45, '#ff9d4d')}${arc(45, 55, C.sun)}${arc(55, 75, '#9fdc6b')}${arc(75, 100, C.up)}${needle(a)}
              ${pop(t, T1 + 1.8, big(String(v), 1240, 200, color), 1180)}`;
          }
          if (t < T3) {
            if (!y) return ctaScene(t, T2, [L('BUY SCORE', 'KAUF-SCORE'), `${market.value}/100`], L('FREE EVERY DAY', 'GRATIS JEDEN TAG'), NOTE);
            return `${pop(t, T2, big(L('ONE YEAR LATER', 'EIN JAHR SPÄTER'), 520, 110))}${pop(t, T2 + 0.3, big(`${y.btc.up}%`, 780, 280, C.up))}
              ${pop(t, T2 + 0.6, body(L('of similar days: Bitcoin was higher', 'ähnlicher Tage: Bitcoin stand höher'), 880, 46, C.text, 700))}
              ${pop(t, T2 + 1.2, body(L(`Altcoins: ${y.alt.up}%. Since 2022, small sample.`, `Altcoins: ${y.alt.up} %. Seit 2022, kleine Stichprobe.`), 960, 42))}${foot(NOTE)}`;
          }
          return ctaScene(t, T3, [L('WHAT DOES', 'WAS SAGT'), L('THE SCORE SAY?', 'DER SCORE?')], L('FREE EVERY DAY', 'GRATIS JEDEN TAG'), NOTE);
        } };
    },
    // Vorführung: Betrag tippen, der Autopilot zeigt, was er kaufen würde – Bitcoin und Ethereum offen, der Rest gesperrt
    async demo() {
      const prof = model?.profiles?.balanced; if (!prof?.holdings?.length) return null;
      const amount = 1000, cash = (prof.cash ?? 0) / 100, rows = prof.holdings.map((h) => ({ sym: h.symbol.toUpperCase(), share: h.share / 100 })).sort((a, b) => b.share - a.share);
      const open = rows.filter((r) => ['BTC', 'ETH'].includes(r.sym)), locked = rows.length - open.length;
      const T1 = 1.8, T2 = 3.4, T3 = 7.6, dur = 10.2;
      const typed = '$1,000';
      const row = (y, a, b, col = C.text) => `<rect x="90" y="${y - 70}" width="820" height="110" rx="24" fill="${C.panel}"/>${display(a, y + 6, 70, col, 130, 'start')}${display(b, y + 6, 70, C.text, 870, 'end')}`;
      return { dur, cuts: [0, T1, T3], ticks: Array.from({ length: typed.length }, (_, i) => T1 + 0.2 + i * 0.2),
        caption: caption([`🤖 ${L('You say how much. The autopilot says what to buy and how much to keep in reserve.', 'Du sagst, wie viel. Der Autopilot sagt, was du kaufst und wie viel du in Reserve hältst.')}`, L('It never touches your money. Tracked live, including the bad weeks.', 'Er hat keinen Zugriff auf dein Geld. Live gemessen, auch die schlechten Wochen.'), '', `👇 ${L('What amount would you try?', 'Welchen Betrag würdest du testen?')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [[L('NO IDEA', 'KEINE AHNUNG'), 160], [L('WHAT TO BUY?', 'WAS KAUFEN?'), 170, 'accent'], [L('WATCH THIS', 'SCHAU MAL'), 110, C.muted]]);
          const shown = typed.slice(0, Math.floor(seg(t, T1 + 0.1, T2 - 0.3) * (typed.length + 0.99)));
          const input = `${body(L('I want to invest', 'Ich will anlegen'), 380, 48, C.text, 700)}<rect x="90" y="410" width="820" height="170" rx="30" fill="${C.panel}" stroke="${C.accent}" stroke-width="5"/>${big(`${shown}${t % 0.6 < 0.3 ? '|' : ' '}`, 540, 120, C.accent)}`;
          if (t < T2) return input + foot(L('Model portfolio, not advice.', 'Modell-Portfolio, keine Beratung.'));
          if (t < T3) {
            const lines = [...open.map((r) => [r.sym, usd(amount * r.share), C.text]), ...(locked ? [[L(`${locked} MORE`, `${locked} WEITERE`), '🔒', C.muted]] : []), [L('RESERVE', 'RESERVE'), usd(amount * cash), C.sun]];
            return `${input}${body(L('The autopilot says:', 'Der Autopilot sagt:'), 670, 48, C.text, 700)}${lines.map(([a, b, col], i) => pop(t, T2 + 0.15 + i * 0.5, row(780 + i * 130, a, b === '🔒' ? L('FREE ACCOUNT', 'GRATIS-KONTO') : b, col), 780 + i * 130)).join('')}${foot(L('You buy at your own exchange. Not financial advice.', 'Du kaufst selbst bei deiner Börse. Keine Anlageberatung.'))}`;
          }
          return ctaScene(t, T3, [L('TRY YOUR', 'TESTE DEINEN'), L('AMOUNT', 'BETRAG')], L('30 DAYS FREE', '30 TAGE GRATIS'), L('No payment details. Not financial advice.', 'Ohne Zahlungsdaten. Keine Anlageberatung.'));
        } };
    },
    // Bot gegen Bitcoin: die Live-Messung seit dem Start – gut oder schlecht
    async versus() {
      const ap = snap.record?.ap; if (!ap || !(ap.days >= 3)) return null;
      const bot = ap.nav - 100, b = ap.btc - 100, scale = 300 / Math.max(Math.abs(bot), Math.abs(b), 0.5);
      const T1 = 1.8, T2 = 6.2, T3 = 8.4, dur = 10.8;
      const barH = (v, p) => Math.max(14, Math.abs(v) * scale * p);
      return { dur, cuts: [0, T1, T2, T3], ticks: [],
        caption: caption([`🤖 ${L(`Day ${ap.days} live: our autopilot ${pct(bot, 1)}, Bitcoin ${pct(b, 1)}. Real prices, real fees, bad weeks included.`, `Tag ${ap.days} live: unser Autopilot ${pct(bot, 1)}, Bitcoin ${pct(b, 1)}. Echte Kurse und Gebühren, auch die schlechten Wochen.`)}`, '', `👇 ${L('Think you can beat it? Comment your 3 coins.', 'Kannst du ihn schlagen? Schreib deine 3 Coins in die Kommentare.')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [[L('OUR BOT', 'UNSER BOT'), 200, 'accent'], ['VS', 110, C.muted], ['BITCOIN', 220], [L(`LIVE · DAY ${ap.days}`, `LIVE · TAG ${ap.days}`), 90, C.muted]]);
          if (t < T2) {
            const p = out3(seg(t, T1 + 0.2, T1 + 2.2)), base = bot >= 0 && b >= 0 ? 950 : bot < 0 && b < 0 ? 620 : 780;
            const col = (x, label, v, fill) => { const h = barH(v, p), color = v >= 0 ? C.up : C.down, top = v >= 0 ? base - h : base; return `<rect x="${x}" y="${top}" width="260" height="${h}" rx="20" fill="${fill}"/>${big(label, v >= 0 ? base + 90 : base - 30, 72, C.text, x + 130)}${big(pct(v * p, 1), v >= 0 ? top - 40 : top + h + 110, 110, color, x + 130)}`; };
            return `${big(L(`DAY ${ap.days} OF TRACKING`, `TAG ${ap.days} DER MESSUNG`), 340, 80, C.muted)}<line x1="100" y1="${base}" x2="900" y2="${base}" stroke="${C.line}" stroke-width="6"/>${col(150, L('BOT', 'BOT'), bot, C.accent)}${col(590, 'BTC', b, C.muted)}${foot(L('Live test, real prices and fees. Not financial advice.', 'Live-Messung mit echten Kursen und Gebühren. Keine Anlageberatung.'))}`;
          }
          if (t < T3) return `${pop(t, T2, big(L('NOT A BACKTEST', 'KEIN BACKTEST'), 600, 130))}${pop(t, T2 + 0.3, big(L('BAD WEEKS STAY', 'SCHLECHTE WOCHEN'), 760, 110, C.accent))}${pop(t, T2 + 0.5, big(L('ON THE SITE', 'BLEIBEN DRIN'), 890, 110, C.accent))}`;
          return ctaScene(t, T3, [L('BEAT THE BOT?', 'SCHLÄGST DU IHN?'), L('PICK 3 COINS', 'WÄHL 3 COINS')], L('FREE CHALLENGE', 'GRATIS-CHALLENGE'), L('Not financial advice.', 'Keine Anlageberatung.'));
        } };
    },
    // Tagesbewegungen: Countdown, harte Schnitte, riesige Zahlen
    async movers() {
      const list = coins.filter((c) => c.market_cap_rank <= 100 && STABLE_OUT(c) && Number.isFinite(c.price_change_percentage_24h_in_currency)).sort((a, b) => b.price_change_percentage_24h_in_currency - a.price_change_percentage_24h_in_currency);
      if (list.length < 6) return null;
      const seq = [...list.slice(-2).reverse().slice(1).map((c) => [c, L('#2 LOSER', '#2 VERLIERER')]), [list[list.length - 1], L('#1 LOSER', '#1 VERLIERER')], [list[1], L('#2 WINNER', '#2 GEWINNER')], [list[0], L('#1 WINNER', '#1 GEWINNER')]];
      const T1 = 1.6, step = 1.6, T3 = T1 + seq.length * step, dur = T3 + 2.4;
      const ch = (c) => c.price_change_percentage_24h_in_currency;
      return { dur, cuts: [0, ...seq.map((_, i) => T1 + i * step), T3], ticks: [],
        caption: caption([`🚀 ${L('Biggest moves in the top 100 today:', 'Grösste Bewegungen der Top 100 heute:')} ${list[0].symbol.toUpperCase()} ${pct(ch(list[0]), 1)}, ${list[list.length - 1].symbol.toUpperCase()} ${pct(ch(list[list.length - 1]), 1)}.`, L('Observations, not recommendations.', 'Beobachtungen, keine Empfehlungen.'), '', `👇 ${L('Do you hold any of them?', 'Hältst du einen davon?')}`]),
        draw(t) {
          if (t < T1) return hookScene(t, [[L('TODAY’S', 'HEUTE'), 150], [L('WINNERS', 'GEWINNER'), 200, C.up], [L('& LOSERS', '& VERLIERER'), 170, C.down]]);
          if (t < T3) {
            const i = Math.floor((t - T1) / step), at = T1 + i * step, [c, label] = seq[i], v = ch(c), col = v >= 0 ? C.up : C.down;
            return `${pop(t, at, big(label, 500, 90, C.muted), 480)}${pop(t, at + 0.05, big(c.symbol.toUpperCase(), 760, 300, C.text), 680)}${pop(t, at + 0.2, big(pct(v, 1), 960, 190, col), 900)}${pop(t, at + 0.35, body(c.name, 1040, 50, C.text, 700), 1030)}${foot(L('24 h, top 100. Not financial advice.', '24 h, Top 100. Keine Anlageberatung.'))}`;
          }
          return ctaScene(t, T3, [L('WHO IS NEXT?', 'WER IST DRAN?')], L('1,000 COINS FREE', '1000 COINS GRATIS'), L('Not financial advice.', 'Keine Anlageberatung.'));
        } };
    },
  };
}

// Reihenfolge: jeden Tag anders, morgens und abends verschieden
const MORNING = ['whatif', 'fear', 'demo', 'ath', 'dca', 'versus', 'guess'];
const EVENING = ['movers', 'guess', 'whatif', 'demo', 'movers', 'ath', 'dca'];

// Baut das Format des Tages; reichen die Daten nicht, kommt das nächste
export async function pickReel({ snap, lang, evening, model, format = null }) {
  const day = Math.floor(snap.time / 86_400_000);
  const list = evening ? EVENING : MORNING, formats = makeFormats({ snap, lang, day, model });
  const order = format ? [format, ...list] : Array.from({ length: list.length }, (_, i) => list[(day + i) % list.length]);
  for (const name of [...new Set(order), 'movers']) {
    try {
      const f = await formats[name]?.();
      if (f) return { name, ...f };
    } catch (err) { console.warn(`Reel-Format ${name} geht nicht: ${err.message}`); }
  }
  throw new Error('kein Reel-Format verfügbar');
}

// Rahmen um jede Szene: Inhalt groß und in die Mitte der freien Fläche, langsamer Zoom je Schnitt, kurzer Blitz auf dem Schnitt, Fortschritt oben
export function frameSvg(f, t) {
  const cut = f.cuts.filter((c) => c <= t).pop() ?? 0, since = t - cut;
  const zoom = 1.13 + since * 0.008, flash = cut > 0 && since < 0.1 ? (1 - since / 0.1) * 0.6 : 0;
  const isHook = cut === 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg(t, f.glow)}
    <g transform="translate(${CX} 860) scale(${zoom.toFixed(4)}) translate(${-CX} -760)">${f.draw(t)}</g>
    ${brand(isHook ? 'rgba(0,0,0,.65)' : C.muted)}
    <rect x="60" y="242" width="880" height="8" rx="4" fill="${isHook ? 'rgba(0,0,0,.2)' : C.line}"/><rect x="60" y="242" width="${(880 * clamp(t / f.dur)).toFixed(1)}" height="8" rx="4" fill="${isHook ? '#10131b' : C.accent}"/>
    ${flash ? `<rect width="${W}" height="${H}" fill="#fff" opacity="${flash.toFixed(2)}"/>` : ''}</svg>`;
}
export const frameJpg = (f, t) => sharp(Buffer.from(frameSvg(f, t))).jpeg({ quality: 88, mozjpeg: false }).toBuffer();

// Video und Ton zusammensetzen
export async function renderReel(f, file, ffmpeg = 'ffmpeg') {
  const { wav, peak } = music(f.dur, f.cuts, f.ticks);
  const audio = `${file}.wav`;
  await writeFile(audio, wav);
  const argv = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-i', audio,
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-maxrate', '6M', '-bufsize', '12M',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-shortest', '-movflags', '+faststart', file];
  await new Promise((ok, fail) => {
    const p = spawn(ffmpeg, argv, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg: ${err}`))));
    p.on('error', fail);
    (async () => {
      const total = Math.ceil(f.dur * FPS);
      for (let i = 0; i < total; i++) {
        const jpg = await frameJpg(f, i / FPS);
        if (!p.stdin.write(jpg)) await new Promise((r) => p.stdin.once('drain', r));
      }
      p.stdin.end();
    })().catch(fail);
  });
  return { peak };
}
