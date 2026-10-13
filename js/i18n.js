// Sprache und Währung der Anzeige.
//
// Die Texte der Seite stehen auf Deutsch im Programm. Für jede andere Sprache übersetzt ein Wörterbuch (js/lang/…) die
// fertige Seite: Jeder Text wird auf eine Grundform gebracht – Zahlen, Beträge, Daten und Uhrzeiten werden zu „#“ –,
// nachgeschlagen und mit den Zahlen wieder zusammengesetzt. So bleibt die Logik der Seite unberührt, und eine weitere
// Sprache ist nur eine weitere Wörterbuch-Datei. Zahlen und Beträge schreibt die Seite von sich aus in der gewählten
// Schreibweise (util.js).

import { settings } from './util.js';

// Sprache: [Name in der Sprache selbst, Schreibweise von Zahlen und Daten, Titel der Seite]
export const LANGS = {
  en: ['English', 'en-US', 'Coinwetter – the weather report for the crypto market'],
  de: ['Deutsch', 'de-DE', 'Coinwetter – die Wetterlage am Kryptomarkt'],
};
export const CURRENCIES = ['usd', 'eur', 'chf', 'gbp', 'cad', 'aud', 'jpy'];
const KEY = 'coinwetter-einstellungen', RATES_KEY = 'coinwetter-wechselkurse';

const stored = (key) => { try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; } };
const saved = stored(KEY);
export const prefs = {
  lang: LANGS[saved.lang] ? saved.lang : 'en',
  currency: CURRENCIES.includes(saved.currency) ? saved.currency : 'usd',
};

let rates = { ...stored(RATES_KEY), usd: 1 };
function applyCurrency() {
  // Ohne bekannten Wechselkurs bleibt die Anzeige vorerst in US-Dollar
  const rate = rates[prefs.currency];
  settings.currency = rate > 0 ? prefs.currency : 'usd';
  settings.rate = rate > 0 ? rate : 1;
}
settings.locale = LANGS[prefs.lang][1];
applyCurrency();

// Wechselkurse je US-Dollar aus der zentralen Berechnung. Gibt true zurück, wenn sich die Anzeige dadurch ändert.
export function setRates(fx) {
  if (!fx || typeof fx !== 'object') return false;
  const before = `${settings.currency}${settings.rate}`;
  rates = { ...fx, usd: 1 };
  try { localStorage.setItem(RATES_KEY, JSON.stringify(rates)); } catch { /* dann gelten die Kurse nur für diesen Aufruf */ }
  applyCurrency();
  return before !== `${settings.currency}${settings.rate}`;
}

// Einstellung speichern; wirksam wird sie mit dem Neuladen der Seite
export function savePrefs(next) {
  if (LANGS[next.lang]) prefs.lang = next.lang;
  if (CURRENCIES.includes(next.currency)) prefs.currency = next.currency;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ohne Speicher gilt die Wahl nicht dauerhaft */ }
}

// Auswahlfelder für Sprache und Währung; die Namen der Währungen liefert der Browser in der gewählten Sprache
export function prefsControls() {
  let names = null;
  try { names = new Intl.DisplayNames(settings.locale, { type: 'currency' }); } catch { /* dann nur das Kürzel */ }
  const option = (value, label, chosen) => `<option value="${value}"${chosen ? ' selected' : ''}>${label}</option>`;
  return `<label><span>Sprache</span> <select data-pref="lang" translate="no">${Object.entries(LANGS).map(([k, [name]]) => option(k, name, k === prefs.lang)).join('')}</select></label>
    <label><span>Währung</span> <select data-pref="currency" translate="no">${CURRENCIES.map((c) => option(c, `${c.toUpperCase()}${names ? ` – ${names.of(c.toUpperCase())}` : ''}`, c === prefs.currency)).join('')}</select></label>`;
}

// Kurzform eines Zeitraums auf den Schaltflächen: „30T“ und „1J“ heißen in anderen Sprachen „30D“ und „1Y“
export const span = (label) => (prefs.lang === 'de' ? label : label.replace(/T$/, 'D').replace(/J$/, 'Y'));

// ---------- Übersetzung ----------

let dict = null;           // Grundform → Übersetzung
let patterns = [];         // Einträge mit {*}: beliebiger Text an dieser Stelle (Namen)
const cache = new Map();   // Text → Übersetzung oder null
const harvest = (() => { try { return ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('coinwetter-ernte') === '1'; } catch { return false; } })();
const missing = new Set(); // im Erntebetrieb: Grundformen ohne Eintrag

// Uhrzeit, Datum oder Zahl – in dieser Reihenfolge, damit „12.10.2026“ und „21:07“ je ein Platzhalter werden.
// Ein Währungszeichen direkt an der Zahl gehört dazu: So ist die Grundform in jeder Währung dieselbe.
export const NUMBER = /\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?|\d{1,2}[./]\d{1,2}[./]\d{2,4}|[+\-−]?(?:(?:(?:CA|AU|A|US|JP)?[$€£¥]|CHF)\s?)?\d(?:[\d.,]*\d)?(?:\s?(?:(?:CA|AU|A|US|JP)?[$€£¥]|CHF)(?!\p{L}))?/gu;
const LETTER = /\p{L}{2}/u;
export const tidy = (text) => text.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

// Satzzeichen und Klammern am Rand gehören nicht zur Grundform: „(alle Zeiträume)“, „alle Zeiträume.“ und „alle Zeiträume“
// sind ein Eintrag. Auch ein Klammerzusatz ohne Buchstaben am Ende („… (+12)“) bleibt außen vor.
const EDGE_LEFT = /^[\s:;,.(\[·]*/u, EDGE_RIGHT = /(?:\s*[(\[][^\p{L}]*|[\s:;,.)\]·]*)$/u;
export function shape(text) {
  const lead = text.match(EDGE_LEFT)[0], rest = text.slice(lead.length), trail = rest.match(EDGE_RIGHT)[0];
  return [lead, rest.slice(0, rest.length - trail.length), trail];
}

function fill(template, numbers, names = []) {
  let n = 0, w = 0;
  return template.replace(/\{\*(\d)?\}|\{(\d)\}|#/g, (m, wild, index) => (m.startsWith('{*') ? names[wild ? wild - 1 : w++] ?? ''
    : index ? numbers[index - 1] ?? '' : numbers[n++] ?? ''));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function compile(key) {
  // Reihenfolge der Gruppen: Zahlen (#) und Namen ({*}) so, wie sie im deutschen Text stehen
  const kinds = [];
  const source = key.split(/(\{\*\}|#)/).map((part) => {
    if (part === '#') { kinds.push('n'); return `(${NUMBER.source})`; }
    if (part === '{*}') { kinds.push('w'); return '(.+?)'; }
    return escapeRe(part);
  }).join('');
  return { re: new RegExp(`^${source}$`, 'u'), kinds };
}

// Zusammengesetzte Texte werden stückweise übersetzt, wenn es für das Ganze keinen Eintrag gibt:
// „Wert – Einordnung“, „Titel: Text“, mehrere Sätze hintereinander.
const SEPARATORS = [' – ', ' · ', ' → ', ': ', '; ', '. '];

// Übersetzt einen Text ohne umgebende Leerzeichen; null, wenn es keinen Eintrag gibt
function lookup(text, depth = 0) {
  const [lead, body, trail] = shape(text);
  if (!LETTER.test(body)) return null;
  const found = find(body, depth);
  return found === null ? null : lead + found + trail;
}

function find(text, depth) {
  const numbers = [];
  const key = text.replace(NUMBER, (m) => { numbers.push(m); return '#'; });
  const exact = dict[key];
  if (exact !== undefined) return fill(exact, numbers);
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const nums = [], names = [];
    p.kinds.forEach((kind, i) => (kind === 'n' ? nums : names).push(m[i + 1]));
    return fill(p.to, nums, names.map((name) => lookup(name, depth + 1) ?? name));
  }
  if (depth < 6) {
    for (const sep of SEPARATORS) {
      const at = text.indexOf(sep);
      if (at <= 0) continue;
      const parts = sep === ': ' ? [text.slice(0, at), text.slice(at + sep.length)] : text.split(sep);
      const done = parts.map((part) => lookup(part.trim(), depth + 1));
      if (done.some((x) => x !== null)) return parts.map((part, i) => done[i] ?? part.trim()).join(sep);
      if (harvest) return null;   // die einzelnen Teile sind schon als fehlend vermerkt
    }
  }
  if (harvest) missing.add(key);
  return null;
}

// Übersetzt einen beliebigen Text der Seite; unbekannte Texte bleiben, wie sie sind
export function say(text) {
  if (!dict || typeof text !== 'string') return text;
  let out = cache.get(text);
  if (out === undefined) {
    const core = tidy(text);
    const found = core ? lookup(core) : null;
    out = found === null ? null : text.match(/^\s*/)[0] + found + text.match(/\s*$/)[0];
    if (cache.size > 6000) cache.clear();
    cache.set(text, out);
  }
  return out ?? text;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'DATALIST', 'TEXTAREA', 'NOSCRIPT']);
const SKIP = '.coin-name, .coin-sym, .d-name, [translate="no"]';
const ATTRS = ['placeholder', 'title', 'aria-label'];
const written = new WeakMap();   // Textknoten → zuletzt geschriebener Text, damit die eigene Änderung nicht erneut übersetzt wird

function textNode(node) {
  const value = node.nodeValue;
  if (!value || written.get(node) === value || !LETTER.test(value)) return;
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest(SKIP)) return;
  const out = say(value);
  written.set(node, out);
  if (out !== value) node.nodeValue = out;
}

function attributes(el) {
  for (const name of ATTRS) {
    const value = el.getAttribute?.(name);
    if (!value || !LETTER.test(value)) continue;
    const out = say(value);
    if (out !== value) el.setAttribute(name, out);
  }
}

function tree(root) {
  if (root.nodeType === Node.TEXT_NODE) { textNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName)) return;
  attributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) (n.nodeType === Node.TEXT_NODE ? textNode(n) : attributes(n));
}

const reveal = () => document.documentElement.classList.remove('i18n-wait');

// Lädt das Wörterbuch der gewählten Sprache. Deutsch braucht keins.
export const ready = (async () => {
  if (typeof document === 'undefined' || (prefs.lang === 'de' && !harvest)) return;
  try {
    useDictionary(harvest ? {} : (await import(`./lang/${prefs.lang}.js`)).default);
  } catch { useDictionary({}); }
})();

// Wörterbuch einsetzen: Grundform → Übersetzung; Einträge mit {*} gelten als Muster
export function useDictionary(entries) {
  dict = entries;
  // Genauere Muster zuerst: „# {*} werden entfernt“ vor „# {*} entfernt“
  patterns = Object.keys(dict).filter((k) => k.includes('{*}')).sort((a, b) => b.length - a.length).map((k) => ({ ...compile(k), to: dict[k] }));
  cache.clear();
}

// Übersetzt die vorhandene Seite und alles, was später hinzukommt. Erst nach „ready“ aufrufen.
export function start() {
  document.documentElement.lang = prefs.lang;
  document.title = LANGS[prefs.lang][2];
  if (!dict) { reveal(); return; }
  tree(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') attributes(m.target);
      else for (const node of m.addedNodes) tree(node);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // Rückfragen des Browsers laufen nicht über die Seite – ihre Texte werden eigens übersetzt
  for (const name of ['confirm', 'alert']) {
    const original = window[name].bind(window);
    window[name] = (message) => original(say(String(message)));
  }
  if (harvest) window.__ernte = () => [...missing];
  reveal();
}
