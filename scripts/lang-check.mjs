// Prüft die Wörterbücher in js/lang/: Jede Sprache braucht dieselben Einträge wie die englische Datei,
// und eine Übersetzung darf nicht mehr Zahlen oder Namen einsetzen, als der deutsche Text hergibt.
// Außerdem muss jeder Schlüssel schon in der Grundform stehen (Zahlen als #, ohne Satzzeichen am Rand) – sonst passt er nie.
//
// Aufruf: node scripts/lang-check.mjs

import { readdir } from 'node:fs/promises';
import { LANGS, NUMBER, shape, tidy } from '../js/i18n.js';

const dir = new URL('../js/lang/', import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
const dicts = Object.fromEntries(await Promise.all(files.map(async (f) => [f.slice(0, -3), (await import(new URL(f, dir).href)).default])));
const count = (text, re) => (text.match(re) ?? []).length;
// Die Schalter für Zeiträume tragen je Sprache eigene Buchstaben („30D“, „30J“, „30G“)
const period = (key) => /^Zeitraum #[A-Z]$/.test(key);
const base = Object.keys(dicts.en).filter((key) => !period(key));
let problems = 0;
const report = (text) => { problems++; console.log(text); };

for (const lang of Object.keys(LANGS)) if (lang !== 'de' && !dicts[lang]) report(`${lang}: js/lang/${lang}.js fehlt`);
for (const [lang, dict] of Object.entries(dicts)) {
  if (!LANGS[lang]) report(`${lang}: nicht in LANGS (js/i18n.js) eingetragen`);
  for (const key of base) if (dict[key] === undefined) report(`${lang}: fehlt „${key}“`);
  for (const [key, value] of Object.entries(dict)) {
    const numbers = count(key, /#/g);
    const used = (value.match(/\{(\d)\}/g) ?? []).map((m) => Number(m[1]));
    if (count(value, /#/g) > numbers || used.some((n) => n > numbers)) report(`${lang}: mehr Zahlen als im deutschen Text – „${key}“`);
    if (count(value, /\{\*\d?\}/g) !== count(key, /\{\*\}/g)) report(`${lang}: Namen ({*}) passen nicht – „${key}“`);
  }
  console.log(`${lang}: ${Object.keys(dict).length} Einträge`);
}
for (const key of base) {
  const [lead, , trail] = shape(key);
  const why = tidy(key) !== key ? 'Leerraum' : key.replace(NUMBER, '#') !== key ? 'Zahl statt #'
    : lead || (trail && !trail.includes('{*}')) ? `Satzzeichen am Rand („${lead}“ / „${trail}“)` : null;
  if (why) report(`Schlüssel passt nie (${why}): „${key}“`);
}
console.log(problems ? `${problems} Auffälligkeiten` : 'Alles vollständig.');
process.exitCode = problems ? 1 : 0;
