// Anzeige-Einstellungen. Alle Werte im Programm sind US-Dollar; umgerechnet wird erst bei der Anzeige.
//   currency / rate: Währung der Anzeige und ihr Kurs je US-Dollar
//   locale:          Schreibweise von Zahlen und Daten
//   tokens:          nur bei der zentralen Berechnung – Zahlen in Texten werden als Platzhalter abgelegt und erst im
//                    Browser in der Sprache des Nutzers geschrieben (siehe localise)
export const settings = { currency: 'usd', rate: 1, locale: 'de-DE', tokens: false };

export const $ = (sel, root = document) => root.querySelector(sel);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isNum = Number.isFinite;
export const clamp = (x, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
export const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Betrag aus der Anzeige-Währung in US-Dollar und zurück – für Eingabefelder
export const fromDisplay = (value) => value / settings.rate;
export const toDisplay = (usd) => usd * settings.rate;
export const currencyCode = () => settings.currency.toUpperCase();

// Ein Formatierer je Schreibweise und Einstellung – jedes Mal einen neuen anzulegen wäre rund 50-mal langsamer
const formats = new Map();
function format(key, options) {
  const id = `${settings.locale}|${key}`;
  let f = formats.get(id);
  if (!f) { f = new Intl.NumberFormat(settings.locale, options()); formats.set(id, f); }
  return f;
}

// v: Betrag in US-Dollar
export function money(v) {
  if (!isNum(v)) return '–';
  const shown = v * settings.rate, a = Math.abs(shown);
  const digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return format(`m${settings.currency}${digits}`, () => ({ style: 'currency', currency: currencyCode(),
    minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits })).format(shown);
}

export function compact(v) {
  if (!isNum(v)) return '–';
  return format(`c${settings.currency}`, () => ({ style: 'currency', currency: currencyCode(), notation: 'compact', maximumFractionDigits: 2 }))
    .format(v * settings.rate);
}

const plain = (v, d) => format(`n${d}`, () => ({ minimumFractionDigits: d, maximumFractionDigits: d })).format(v);
// Vorzeichen nach dem Runden: aus -0,04 wird bei 0 Stellen „0“, nicht „-0“
const withSign = (v, d) => { const r = Number(v.toFixed(d)); return (r > 0 ? '+' : '') + plain(r === 0 ? 0 : v, d); };
const token = (kind, v, d) => `⟦${kind}|${Number(v.toFixed(Math.min(d + 4, 12)))}|${d}⟧`;

export const num = (v, d = 1) => (!isNum(v) ? '–' : settings.tokens ? token('n', v, d) : plain(v, d));
export const signed = (v, d = 1) => (!isNum(v) ? '–' : settings.tokens ? token('s', v, d) : withSign(v, d));

// Ersetzt die Zahlen-Platzhalter der zentralen Berechnung in allen Texten eines Objekts durch Zahlen in der eingestellten Schreibweise
const TOKEN = /⟦([ns])\|(-?[\d.e+-]+)\|(\d+)⟧/g;
export function localise(value) {
  if (typeof value === 'string') return value.includes('⟦') ? value.replace(TOKEN, (_, kind, v, d) => (kind === 's' ? withSign(Number(v), Number(d)) : plain(Number(v), Number(d)))) : value;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) if (typeof value[i] === 'string' || (value[i] && typeof value[i] === 'object')) value[i] = localise(value[i]); return value; }
  if (value && typeof value === 'object') { for (const k in value) { const x = value[k]; if (typeof x === 'string' || (x && typeof x === 'object')) value[k] = localise(x); } }
  return value;
}

export const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');

export function pct(v, d = 2) {
  if (!isNum(v)) return '<span class="muted">–</span>';
  return `<span class="${tone(v)}">${signed(v, d)} %</span>`;
}
