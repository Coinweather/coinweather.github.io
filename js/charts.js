// Charts im Stil von TradingView – gezeichnet mit „Lightweight Charts“ von TradingView (js/vendor, Apache-2.0, liegt auf der
// eigenen Seite, lädt also nichts von fremden Servern). Zwei Arten:
//   lineChart(el, …)  für alle Verläufe der Seite (Indikatoren, Portfolio, Modell, Rechner): Zoom, Verschieben, Fadenkreuz,
//                     Log-Skala, Vollbild, Schwellen als Linien
//   proChart(el, …)   für jeden Coin: Kerzen oder Linie, Intervalle von 15 Minuten bis 1 Monat, Indikatoren (Durchschnitte,
//                     Bollinger, Volumen, RSI, MACD), Zeichnen (Trendlinie, waagrechte Linie), auf Wunsch der volle TradingView-Chart
// Alle Texte deutsch – die Seite übersetzt sie wie überall.

import { esc, money, num, settings, isNum } from './util.js';
import * as i18n from './i18n.js';
import * as api from './api.js';

let lib = null;
const LW = () => (lib ??= import('./vendor/lightweight-charts.mjs'));

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const resolve = (c) => (typeof c === 'string' && c.startsWith('var(') ? css(c.slice(4, -1).split(',')[0].trim(), '#888888') : c);
const theme = () => ({ text: css('--muted', '#8d97ac'), strong: css('--text', '#edf0f6'), line: css('--line', '#222b3d'), up: css('--up', '#2dd36f'),
  down: css('--down', '#f2545b'), accent: css('--accent', '#f7931a'), violet: css('--violet', '#a78bfa'), sky: '#38bdf8', pink: '#f472b6' });
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex);
// Zeitstempel so verschieben, dass die Achse die Ortszeit zeigt (die Bibliothek rechnet in UTC)
const toTime = (ms) => Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60;
const fromTime = (s) => (s + new Date(s * 1000).getTimezoneOffset() * 60) * 1000;

function baseOptions(L, th, { hourly = false } = {}) {
  return {
    autoSize: true,
    layout: { background: { type: L.ColorType.Solid, color: 'transparent' }, textColor: th.text, fontSize: 12,
      fontFamily: getComputedStyle(document.body).fontFamily, attributionLogo: true,
      panes: { separatorColor: th.line, separatorHoverColor: alpha(th.accent, 0.3) } },
    grid: { vertLines: { color: alpha(th.line, 0.55) }, horzLines: { color: alpha(th.line, 0.55) } },
    rightPriceScale: { borderColor: th.line },
    timeScale: { borderColor: th.line, timeVisible: hourly, secondsVisible: false, rightOffset: 4, minBarSpacing: 0.05 },   // damit „Alles zeigen“ auch Jahre auf schmale Handys bringt
    crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: th.text, labelBackgroundColor: th.line }, horzLine: { color: th.text, labelBackgroundColor: th.line } },
    localization: { locale: settings.locale },
    handleScroll: { vertTouchDrag: false },
  };
}

const dateLabel = (ms, hourly) => new Date(ms).toLocaleString(settings.locale, hourly
  ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });

// Vollbild für einen Bereich; ohne Unterstützung im Browser (iPhone) wird er groß über die Seite gelegt
function toggleFull(box) {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (box.requestFullscreen) return box.requestFullscreen().catch(() => box.classList.toggle('chart-max'));
  box.classList.toggle('chart-max');
}

// ---------- Verläufe ----------
const FOCUS_MIN_RANGE = 0.01;   // die Y-Achse umfasst bei focus mindestens 1 % des Werts
// Gleiche Angaben wie das frühere SVG-Diagramm: t (ms), p (Werte), overlays [{ values, color, label }], note, marker { index, label },
// plain (Kennzahl statt Betrag), hourly; neu: levels [{ value, label, color }] als waagrechte Linien;
// focus: Die Y-Achse richtet sich nur nach der Hauptlinie, damit kleine Bewegungen sichtbar sind – mit einer Mindesthöhe, sonst sähe ein fast
// gleichbleibender Wert wild aus
export async function lineChart(el, { t, p, overlays = [], note, marker, plain, hourly, levels = [], focus = false }) {
  const L = await LW();
  el._lw?.remove(); el._lw = null;
  const pts = t.map((ms, i) => [toTime(ms), p[i]]).filter(([, v]) => isNum(v));
  if (pts.length < 2) { el.innerHTML = `<p class="muted">${esc(i18n.say('Keine Kursdaten für diesen Zeitraum.'))}</p>`; return; }
  const th = theme();
  const fmt = plain ? (v) => num(v, Math.abs(v) < 10 && Math.round(v * 100) % 100 !== 0 ? 2 : 0) : money;
  const positive = p.every((v) => !isNum(v) || v > 0);
  el.innerHTML = `<div class="lw-wrap">
      <div class="lw-tools">${positive ? '<button type="button" class="chip" data-lw="log">Log</button>' : ''}
        <button type="button" class="chip" data-lw="fit" title="Alles zeigen">⤢</button><button type="button" class="chip" data-lw="full" title="Vollbild">⛶</button></div>
      <div class="lw-legend"></div><div class="lw-box"></div></div>
    <div class="legend">${overlays.map((o) => `<span><i style="background:${o.color}"></i>${esc(o.label)}</span>`).join('')}${note ? `<span class="muted">${esc(note)}</span>` : ''}</div>`;
  const wrap = el.querySelector('.lw-wrap'), box = el.querySelector('.lw-box'), legend = el.querySelector('.lw-legend');
  const chart = L.createChart(box, { ...baseOptions(L, th, { hourly }), localization: { locale: settings.locale, priceFormatter: fmt } });
  el._lw = chart;
  const rising = pts[pts.length - 1][1] >= pts[0][1];
  const main = chart.addSeries(L.AreaSeries, { lineColor: rising ? th.up : th.down, topColor: alpha(rising ? th.up : th.down, 0.22), bottomColor: alpha(rising ? th.up : th.down, 0.01),
    lineWidth: 2, priceLineVisible: false,
    ...(focus ? { autoscaleInfoProvider: (original) => {
      const r = original();
      if (!r?.priceRange) return r;
      const { minValue, maxValue } = r.priceRange, gap = Math.max(0, Math.abs(maxValue) * FOCUS_MIN_RANGE - (maxValue - minValue)) / 2;
      return { ...r, priceRange: { minValue: minValue - gap, maxValue: maxValue + gap } };
    } } : {}) });
  const dedupe = (arr) => arr.filter((x, i) => i === arr.length - 1 || x.time !== arr[i + 1].time);
  main.setData(dedupe(pts.map(([time, value]) => ({ time, value }))));
  const extra = overlays.map((o) => {
    const s = chart.addSeries(L.LineSeries, { color: resolve(o.color), lineWidth: 1.5, lineStyle: L.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...(focus ? { autoscaleInfoProvider: () => null } : {}) });
    s.setData(dedupe(t.map((ms, i) => (isNum(o.values[i]) ? { time: toTime(ms), value: o.values[i] } : { time: toTime(ms) })).filter((x, i, a) => i === 0 || x.time > a[i - 1].time)));
    return [o, s];
  });
  for (const lv of levels) main.createPriceLine({ price: lv.value, color: resolve(lv.color ?? 'var(--muted)'), lineWidth: 1, lineStyle: L.LineStyle.Dotted, axisLabelVisible: true, title: i18n.say(lv.label ?? '') });
  if (marker && t[marker.index]) L.createSeriesMarkers(main, [{ time: toTime(t[marker.index]), position: 'aboveBar', shape: 'arrowDown', color: th.accent, text: i18n.say(marker.label) }]);
  if (focus) {
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.06 } });
    chart.timeScale().applyOptions({ rightOffset: 0.4 });   // bei wenigen Tagen wäre der übliche Rand rechts ein Drittel des Bilds
  }
  chart.timeScale().fitContent();
  // Wert unter dem Fadenkreuz, sonst der letzte
  const show = (time) => {
    const i = time === undefined ? pts.length - 1 : pts.findIndex(([x]) => x === time);
    if (i < 0) return;
    const ms = fromTime(pts[i][0]);
    legend.innerHTML = `<strong>${esc(fmt(pts[i][1]))}</strong> <span class="muted">${esc(dateLabel(ms, hourly))}</span>
      ${extra.map(([o, s]) => { const d = time === undefined ? null : s.data().find((x) => x.time === time); return d && isNum(d.value) ? `<span style="color:${resolve(o.color)}">${esc(fmt(d.value))}</span>` : ''; }).join(' ')}`;
  };
  show();
  chart.subscribeCrosshairMove((param) => show(param.time));
  let log = false;
  el.querySelector('.lw-tools').addEventListener('click', (e) => {
    const k = e.target.closest('[data-lw]')?.dataset.lw;
    if (k === 'log') { log = !log; e.target.classList.toggle('active', log); chart.priceScale('right').applyOptions({ mode: log ? L.PriceScaleMode.Logarithmic : L.PriceScaleMode.Normal }); }
    if (k === 'fit') chart.timeScale().fitContent();
    if (k === 'full') toggleFull(wrap);
  });
  return chart;
}

// ---------- Indikatoren ----------
const sma = (v, n) => v.map((_, i) => (i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
function ema(v, n) {
  const k = 2 / (n + 1), out = []; let prev = null;
  v.forEach((x, i) => { prev = i < n - 1 ? null : prev === null ? v.slice(0, n).reduce((a, b) => a + b, 0) / n : x * k + prev * (1 - k); out.push(prev); });
  return out;
}
function bollinger(v, n = 20, m = 2) {
  const mid = sma(v, n);
  const sd = v.map((_, i) => { if (i < n - 1) return null; const w = v.slice(i - n + 1, i + 1), mu = mid[i]; return Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / n); });
  return { mid, up: mid.map((x, i) => (x === null ? null : x + m * sd[i])), lo: mid.map((x, i) => (x === null ? null : x - m * sd[i])) };
}
function rsi(v, n = 14) {
  const out = Array(v.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function macd(v, f = 12, s = 26, sig = 9) {
  const a = ema(v, f), b = ema(v, s), line = v.map((_, i) => (a[i] === null || b[i] === null ? null : a[i] - b[i]));
  const start = line.findIndex((x) => x !== null), sgl = Array(v.length).fill(null);
  if (start >= 0) ema(line.slice(start), sig).forEach((x, i) => { sgl[start + i] = x; });
  return { line, signal: sgl, hist: line.map((x, i) => (x === null || sgl[i] === null ? null : x - sgl[i])) };
}

const INDICATORS = [
  ['ma20', 'Durchschnitt 20'], ['ma50', 'Durchschnitt 50'], ['ma200', 'Durchschnitt 200'], ['ema21', 'EMA 21'],
  ['bb', 'Bollinger-Bänder (20, 2)'], ['vol', 'Volumen'], ['rsi', 'RSI (14)'], ['macd', 'MACD (12, 26, 9)'],
];
const IND_KEY = 'coinwetter-chart-indikatoren', TV_KEY = 'coinwetter-tradingview-ok';
const loadInd = () => { try { const x = JSON.parse(localStorage.getItem(IND_KEY)); if (Array.isArray(x)) return new Set(x); } catch { /* Standard */ } return new Set(['ma50', 'ma200', 'vol']); };
const INTERVALS = [['15m', '15m', '15 Minuten'], ['1h', '1h', '1 Stunde'], ['4h', '4h', '4 Stunden'], ['1d', '1D', '1 Tag'], ['1w', '1W', '1 Woche'], ['1M', '1M', '1 Monat']];
// Lücken und doppelte Zeitpunkte entfernen (z. B. „heute, jetzt“ neben dem Tageswert) – die Bibliothek bricht sonst beim Zeichnen ab
function clean(d) {
  const keep = [];
  let last = null;
  d.t.forEach((ms, i) => {
    if (!isNum(d.c[i]) || (d.o && ![d.o[i], d.h[i], d.l[i]].every(isNum))) return;
    const t = toTime(ms);
    if (last !== null && t < last) return;
    if (t === last) keep[keep.length - 1] = i; else keep.push(i);   // gleicher Zeitpunkt: der neuere Wert gilt
    last = t;
  });
  if (keep.length === d.t.length) return d;
  const pick = (a) => a && keep.map((i) => a[i]);
  return { ...d, t: pick(d.t), o: pick(d.o), h: pick(d.h), l: pick(d.l), c: pick(d.c), v: pick(d.v) };
}
// Dieselben Intervalle im eingebetteten TradingView-Chart
const TV_IV = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W', '1M': 'M' };
// Intervalle, für die es ohne Kerzen Kurse von CoinGecko gibt (api.intradayLine)
const LINE_IV = ['15m', '1h', '4h'];
// Tageskurse ohne Kerzen auf Wochen- oder Monatsschritte bringen: letzter Kurs je Woche bzw. Kalendermonat
function resample(d, iv) {
  if (iv !== '1w' && iv !== '1M') return d;
  const keyOf = (ms) => { const x = new Date(ms); return iv === '1M' ? `${x.getUTCFullYear()}-${x.getUTCMonth()}` : Math.floor((ms / 864e5 + 3) / 7); };
  const at = new Map();
  d.t.forEach((ms, i) => { if (isNum(d.c[i])) at.set(keyOf(ms), i); });
  const idx = [...at.values()];
  return { ...d, t: idx.map((i) => d.t[i]), c: idx.map((i) => d.c[i]), v: null };
}
// Sichtbarer Ausschnitt je Intervall: 15m = 1 Tag, 1h = 1 Woche, 4h = 1 Monat, 1D = 1 Jahr, 1W = 4 Jahre, 1M = alles
const BARS = { '15m': 96, '1h': 168, '4h': 180, '1d': 365, '1w': 209, '1M': null };

// ---------- Profi-Chart je Coin ----------
// coin: { id, symbol, name }, source: Börse der Kursgeschichte ('Binance', 'Gate.io' oder null),
// fallback: () => Tageskurse { t, p, v, source } ohne Kerzen (kommen oft erst später – dann retry())
export function proChart(el, { coin, source, fallback }) {
  const st = { iv: '1d', type: 'candles', ind: loadInd(), log: false, draw: null, pending: null, data: null, run: 0, bars: BARS['1d'], tv: false };
  el.innerHTML = `<div class="pro">
      <div class="pro-bar">
        <div class="chips" data-g="type"><button type="button" class="chip" data-type="candles" title="Kerzen">🕯️<span class="lbl"> Kerzen</span></button><button type="button" class="chip" data-type="line" title="Linie">📈<span class="lbl"> Linie</span></button></div>
        <div class="chips" data-g="iv">${INTERVALS.map(([k, l, title]) => `<button type="button" class="chip" data-iv="${k}" title="${title}" translate="no">${l}</button>`).join('')}</div>
        <div class="pro-more">
          <button type="button" class="chip" data-act="ind">Indikatoren ▾</button>
          <button type="button" class="chip" data-act="trend" title="Trendlinie: zwei Punkte anklicken">／<span class="lbl"> Trendlinie</span></button>
          <button type="button" class="chip" data-act="hline" title="Waagrechte Linie: einen Kurs anklicken">—<span class="lbl"> Linie</span></button>
          <button type="button" class="chip" data-act="clear" title="Zeichnungen löschen">🗑</button>
          <button type="button" class="chip" data-act="log">Log</button>
          <button type="button" class="chip" data-act="fit" title="Alles zeigen">⤢</button>
          <button type="button" class="chip" data-act="full" title="Vollbild">⛶</button>
          <button type="button" class="chip tv-chip" data-act="tv" title="Voller TradingView-Chart">TV<span class="lbl">: TradingView</span></button>
        </div>
      </div>
      <div class="pro-menu" hidden>${INDICATORS.map(([k, l]) => `<label><input type="checkbox" data-ind="${k}"> ${l}</label>`).join('')}</div>
      <div class="pro-stage"><div class="pro-legend"></div><div class="pro-hint" hidden></div><div class="pro-box"></div></div>
      <p class="hint pro-note"></p></div>`;
  const q = (s) => el.querySelector(s);
  const box = q('.pro-box'), legend = q('.pro-legend'), hint = q('.pro-hint');
  let chart = null, main = null, L = null, th = null;
  const drawKey = () => `coinwetter-zeichnungen-${coin.id}-${st.iv}`;
  const drawings = () => { try { return JSON.parse(localStorage.getItem(drawKey())) ?? []; } catch { return []; } };
  const saveDrawings = (list) => { try { localStorage.setItem(drawKey(), JSON.stringify(list)); } catch { /* nur jetzt */ } };

  function syncButtons() {
    // Ohne Kerzen (nur Kurse) gibt es nur die Linie; die Intervalle bleiben immer wählbar
    for (const b of el.querySelectorAll('[data-type]')) { b.classList.toggle('active', b.dataset.type === (st.data?.o ? st.type : 'line')); b.disabled = !st.data?.o; }
    for (const b of el.querySelectorAll('[data-iv]')) b.classList.toggle('active', b.dataset.iv === st.iv);
    for (const b of el.querySelectorAll('input[data-ind]')) b.checked = st.ind.has(b.dataset.ind);
    q('[data-act="log"]').classList.toggle('active', st.log);
    q('[data-act="trend"]').classList.toggle('active', st.draw === 'trend');
    q('[data-act="hline"]').classList.toggle('active', st.draw === 'hline');
    q('[data-act="tv"]').classList.toggle('active', st.tv);
    hint.hidden = !st.draw;
    hint.textContent = i18n.say(st.draw === 'trend' ? (st.pending ? 'Zweiten Punkt anklicken' : 'Ersten Punkt der Trendlinie anklicken') : 'Kurs für die waagrechte Linie anklicken');
  }

  async function load() {
    const mine = ++st.run;
    st.tv = false;
    box.innerHTML = `<p class="loading"><span class="spinner" aria-hidden="true"></span> ${esc(i18n.say('Lade Kursverlauf …'))}</p>`;
    const iv = st.iv;
    let data = source === null ? null : await api.candles(coin.symbol, iv, source ?? undefined).catch(() => null);
    // Keine Kerzen (Coin an keiner der beiden Börsen): kurzfristig Kurse von CoinGecko, ab einem Tag die Tageskurse der Seite
    if (!data && LINE_IV.includes(iv)) data = await api.intradayLine(coin.id, iv).catch(() => null);
    if (mine !== st.run) return;
    const fb = fallback?.();
    if (!data && !LINE_IV.includes(iv) && fb?.p?.length) data = resample({ t: fb.t, c: fb.p, v: fb.v ?? null, source: fb.source ?? 'CoinGecko' }, iv);
    st.data = data && clean(data);
    if (st.data && st.data.t.length < 2) st.data = null;
    if (!st.data) {
      box.innerHTML = `<p class="muted">${esc(i18n.say(fb?.p?.length || LINE_IV.includes(iv) ? 'Für dieses Intervall gibt es gerade keine Kursdaten. Versuch es gleich noch einmal oder wähle ein anderes.' : 'Für diesen Coin gibt es keine Kursdaten.'))}</p>`;
      legend.innerHTML = ''; q('.pro-note').textContent = '';
      syncButtons(); return;
    }
    await render();
  }

  async function render() {
    L ??= await LW();
    th = theme();
    chart?.remove(); chart = null;
    box.innerHTML = '';
    const d = st.data, hourly = !['1d', '1w', '1M'].includes(st.iv);
    const times = d.t.map(toTime);
    // Höhe: Kurs-Bereich plus je 120 Pixel für RSI und MACD
    const panes = (st.ind.has('rsi') ? 1 : 0) + (st.ind.has('macd') ? 1 : 0);
    const big = document.fullscreenElement === q('.pro') || q('.pro').classList.contains('chart-max');
    box.style.height = big ? '' : `${(innerWidth < 600 ? 360 : 440) + panes * 120}px`;
    chart = L.createChart(box, baseOptions(L, th, { hourly }));
    // Beträge in der gewählten Währung – je Reihe, damit RSI und MACD ihre eigene Schreibweise behalten
    const fmtMoney = { type: 'custom', formatter: money, minMove: 1e-8 };
    const candles = st.type === 'candles' && d.o;
    main = candles
      ? chart.addSeries(L.CandlestickSeries, { upColor: th.up, downColor: th.down, borderUpColor: th.up, borderDownColor: th.down, wickUpColor: th.up, wickDownColor: th.down, priceFormat: fmtMoney })
      : chart.addSeries(L.AreaSeries, { lineColor: th.accent, topColor: alpha(th.accent, 0.2), bottomColor: alpha(th.accent, 0.01), lineWidth: 2, priceFormat: fmtMoney });
    main.setData(times.map((time, i) => (candles ? { time, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i] } : { time, value: d.c[i] })));
    main.priceScale().applyOptions({ mode: st.log ? L.PriceScaleMode.Logarithmic : L.PriceScaleMode.Normal, scaleMargins: { top: 0.08, bottom: st.ind.has('vol') && d.v ? 0.22 : 0.06 } });
    const line = (vals, color, opts = {}, pane = 0) => {
      const s = chart.addSeries(L.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmtMoney, ...opts }, pane);
      s.setData(times.map((time, i) => (vals[i] === null || !isNum(vals[i]) ? { time } : { time, value: vals[i] })));
      return s;
    };
    const legendLines = [];
    const add = (label, color, vals, opts) => { line(vals, color, opts); legendLines.push([label, color, vals]); };
    if (st.ind.has('ma20')) add('MA 20', th.sky, sma(d.c, 20));
    if (st.ind.has('ma50')) add('MA 50', th.accent, sma(d.c, 50));
    if (st.ind.has('ma200')) add('MA 200', th.violet, sma(d.c, 200));
    if (st.ind.has('ema21')) add('EMA 21', th.pink, ema(d.c, 21));
    if (st.ind.has('bb')) {
      const b = bollinger(d.c);
      line(b.up, alpha(th.sky, 0.7), { lineStyle: L.LineStyle.Dashed }); line(b.lo, alpha(th.sky, 0.7), { lineStyle: L.LineStyle.Dashed });
      add('BB 20', th.sky, b.mid, { color: alpha(th.sky, 0.5) });
    }
    if (st.ind.has('vol') && d.v) {
      const vs = chart.addSeries(L.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vs.setData(times.map((time, i) => ({ time, value: d.v[i] ?? 0, color: alpha(!d.o || d.c[i] >= d.o[i] ? th.up : th.down, 0.35) })));
    }
    let pane = 1;
    if (st.ind.has('rsi')) {
      const s = line(rsi(d.c), th.violet, { lastValueVisible: true, priceFormat: { type: 'custom', formatter: (v) => num(v, 0), minMove: 1 } }, pane);
      s.createPriceLine({ price: 70, color: alpha(th.down, 0.6), lineStyle: L.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      s.createPriceLine({ price: 30, color: alpha(th.up, 0.6), lineStyle: L.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      pane++;
    }
    if (st.ind.has('macd')) {
      const m = macd(d.c);
      // Eigene Schreibweise ohne Währung – sonst gälte das Format der Kurse
      const fmtM = { type: 'custom', formatter: (v) => new Intl.NumberFormat(settings.locale, { notation: 'compact', maximumFractionDigits: 2 }).format(v), minMove: 0.0001 };
      const h = chart.addSeries(L.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: fmtM }, pane);
      h.setData(times.map((time, i) => (m.hist[i] === null ? { time } : { time, value: m.hist[i], color: alpha(m.hist[i] >= 0 ? th.up : th.down, 0.55) })));
      line(m.line, th.sky, { priceFormat: fmtM }, pane); line(m.signal, th.accent, { priceFormat: fmtM }, pane);
    }
    // Höhen der unteren Bereiche erst nach dem ersten Zeichnen setzen – vorher kennt die Bibliothek die Gesamthöhe nicht
    if (pane > 1 || st.ind.has('macd')) requestAnimationFrame(() => chart?.panes().slice(1).forEach((p) => p.setHeight(110)));
    // Zeichnungen dieses Coins in diesem Intervall
    for (const dr of drawings()) addDrawing(dr);
    // Sichtbarer Ausschnitt: so viele Kerzen wie gewählt, sonst alles
    const n = times.length;
    if (st.bars && n > st.bars) chart.timeScale().setVisibleLogicalRange({ from: n - st.bars, to: n + 3 });
    else chart.timeScale().fitContent();
    showLegend();
    chart.subscribeCrosshairMove((param) => showLegend(param));
    chart.subscribeClick(onClick);
    const src = d.source;
    q('.pro-note').innerHTML = `${esc(i18n.say('Daten'))}: ${esc(src)}${d.o ? '' : ` (${esc(i18n.say('nur Kurse, keine Kerzen'))})`} · ${esc(i18n.say('Mausrad oder zwei Finger zum Zoomen, ziehen zum Verschieben.'))} · <a href="https://www.tradingview.com/" target="_blank" rel="noopener">Charts by TradingView</a>`;
    syncButtons();

    function showLegend(param) {
      const i = param?.time ? times.indexOf(param.time) : n - 1;
      if (i < 0) return;
      const ch = d.o ? (d.c[i] / d.o[i] - 1) * 100 : i > 0 ? (d.c[i] / d.c[i - 1] - 1) * 100 : 0;
      const tone = ch >= 0 ? 'up' : 'down';
      legend.innerHTML = `<span class="muted">${esc(dateLabel(d.t[i], hourly))}</span>
        ${d.o ? `<span>O <b class="${tone}">${esc(money(d.o[i]))}</b></span><span>H <b class="${tone}">${esc(money(d.h[i]))}</b></span><span>L <b class="${tone}">${esc(money(d.l[i]))}</b></span>` : ''}
        <span>C <b class="${tone}">${esc(money(d.c[i]))}</b></span><span class="${tone}">${ch >= 0 ? '+' : ''}${num(ch, 2)} %</span>
        ${d.v ? `<span class="muted">Vol ${esc(new Intl.NumberFormat(settings.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(d.v[i] * settings.rate))}</span>` : ''}
        ${legendLines.map(([l, c, vals]) => (isNum(vals[i]) ? `<span style="color:${c}">${l} ${esc(money(vals[i]))}</span>` : '')).join('')}`;
    }
  }

  function addDrawing(dr) {
    if (!main) return;
    if (dr.type === 'h') main.createPriceLine({ price: dr.price, color: th.accent, lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: true });
    if (dr.type === 't') {
      const s = chart.addSeries(L.LineSeries, { color: th.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData([dr.a, dr.b].sort((x, y) => x[0] - y[0]).map(([time, value]) => ({ time, value })));
    }
  }

  function onClick(param) {
    if (!st.draw || !param.point || param.time === undefined) return;
    const price = main.coordinateToPrice(param.point.y);
    if (!isNum(price)) return;
    if (st.draw === 'hline') { const dr = { type: 'h', price }; saveDrawings([...drawings(), dr]); addDrawing(dr); st.draw = null; }
    else if (!st.pending) st.pending = [param.time, price];
    else if (param.time !== st.pending[0]) { const dr = { type: 't', a: st.pending, b: [param.time, price] }; saveDrawings([...drawings(), dr]); addDrawing(dr); st.pending = null; st.draw = null; }
    syncButtons();
  }

  // Der volle TradingView-Chart lädt erst nach einem Klick: Er kommt von tradingview.com
  function tradingView() {
    st.tv = true; st.run++;
    chart?.remove(); chart = null; main = null;
    // TradingView bringt eigene Werkzeugleisten mit – dafür mehr Höhe als der eigene Chart (außer im Vollbild)
    const big = document.fullscreenElement === q('.pro') || q('.pro').classList.contains('chart-max');
    box.style.height = big ? '' : `${innerWidth < 600 ? 520 : 600}px`;
    const ok = (() => { try { return localStorage.getItem(TV_KEY) === '1'; } catch { return false; } })();
    const sym = source === 'Binance' ? `BINANCE:${coin.symbol.toUpperCase()}USDT` : source === 'Gate.io' ? `GATEIO:${coin.symbol.toUpperCase()}USDT` : `CRYPTO:${coin.symbol.toUpperCase()}USD`;
    const lang = { de: 'de_DE', en: 'en', es: 'es', fr: 'fr', it: 'it', pt: 'br', tr: 'tr' }[i18n.prefs.lang] ?? 'en';
    const dark = !matchMedia('(prefers-color-scheme: light)').matches;
    const frame = () => { box.innerHTML = `<iframe class="tv-frame" title="TradingView" loading="lazy" src="https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(sym)}&interval=${TV_IV[st.iv] ?? 'D'}&theme=${dark ? 'dark' : 'light'}&style=1&locale=${lang}&timezone=exchange&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&saveimage=0&studies=%5B%5D"></iframe>`; };
    if (ok) frame();
    else {
      box.innerHTML = `<div class="tv-consent"><strong>${esc(i18n.say('Voller TradingView-Chart'))}</strong>
        <p class="muted">${esc(i18n.say('Mit allen Zeichenwerkzeugen und über 100 Indikatoren. Er wird von tradingview.com geladen – dabei gehen Daten wie deine IP-Adresse an TradingView.'))}</p>
        <button type="button" class="btn" data-tv-ok>${esc(i18n.say('TradingView laden'))}</button></div>`;
      box.querySelector('[data-tv-ok]').addEventListener('click', () => { try { localStorage.setItem(TV_KEY, '1'); } catch { /* nur jetzt */ } frame(); });
    }
    legend.innerHTML = ''; q('.pro-note').textContent = '';
    syncButtons();
  }

  // Größe geändert (Vollbild an oder aus): neu zeichnen – den TradingView-Chart mit passender Höhe neu laden
  function resized() { if (st.tv) { if (box.querySelector('iframe')) tradingView(); } else if (st.data) render(); }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.type) { st.type = b.dataset.type; render(); }
    // Im TradingView-Chart wechselt das Intervall dort, sonst im eigenen Chart
    if (b.dataset.iv) { st.iv = b.dataset.iv; st.bars = BARS[st.iv]; if (st.tv) tradingView(); else load(); }
    const act = b.dataset.act;
    if (act === 'ind') q('.pro-menu').hidden = !q('.pro-menu').hidden;
    if (act === 'log') { st.log = !st.log; main?.priceScale().applyOptions({ mode: st.log ? L.PriceScaleMode.Logarithmic : L.PriceScaleMode.Normal }); syncButtons(); }
    if (act === 'fit') chart?.timeScale().fitContent();
    if (act === 'full') { toggleFull(q('.pro')); setTimeout(resized, 200); }
    if (act === 'trend' || act === 'hline') { st.draw = st.draw === act ? null : act; st.pending = null; syncButtons(); }
    if (act === 'clear') { saveDrawings([]); render(); }
    if (act === 'tv') { if (st.tv) load(); else tradingView(); }
  });
  q('.pro-menu').addEventListener('change', (e) => {
    const k = e.target.dataset.ind;
    if (!k) return;
    if (e.target.checked) st.ind.add(k); else st.ind.delete(k);
    try { localStorage.setItem(IND_KEY, JSON.stringify([...st.ind])); } catch { /* nur jetzt */ }
    if (st.data && !st.tv) render();
  });
  // Nach dem Vollbild die Größe neu messen
  document.addEventListener('fullscreenchange', () => { if (el.isConnected) resized(); });

  load();
  return {
    // Tageskurse sind nachträglich da: neu laden, falls bisher nichts zu zeigen war
    retry() { if (!st.data && !st.tv && st.run && !LINE_IV.includes(st.iv) && fallback?.()?.p?.length) load(); },
    remove() { st.run++; chart?.remove(); },
  };
}
