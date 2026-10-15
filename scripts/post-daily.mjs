// Postet einmal am Tag den „Wetterbericht“ des Kryptomarkts mit Bild auf allen eingerichteten Kanälen.
// Läuft über GitHub Actions (.github/workflows/daily-posts.yml). Jeder Kanal ist aktiv, sobald seine Geheimnisse
// im Repository hinterlegt sind; fehlen sie, wird er übersprungen. Die Schritte zum Einrichten stehen in SOCIAL-MEDIA.md.
//
//   Telegram   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   X          X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
//   Bluesky    BLUESKY_HANDLE, BLUESKY_APP_PASSWORD
//   Facebook   FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN
//   Instagram  INSTAGRAM_USER_ID und FACEBOOK_PAGE_TOKEN (Business-Konto, mit der Facebook-Seite verbunden)
//   Sprache    POST_LANG = en (Standard) oder de
//
// Aufruf: node scripts/post-daily.mjs [--image datei.jpg]   – ohne Geheimnisse wird nur angezeigt, was gepostet würde

import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const REPO = 'Coinweather/coinweather.github.io';
const SNAPSHOT = `https://raw.githubusercontent.com/${REPO}/data/snapshot.json`;
const SITE = 'https://coinweather.github.io/';
const env = process.env;
const lang = (env.POST_LANG ?? env.TELEGRAM_LANG) === 'de' ? 'de' : 'en';

// ---------- Tagesstand ----------
const res = await fetch(`${SNAPSHOT}?t=${Date.now()}`);
if (!res.ok) throw new Error(`Daten nicht ladbar (${res.status})`);
const snap = await res.json();
if (Date.now() - snap.time > 6 * 3_600_000) throw new Error('Die Daten sind älter als 6 Stunden – heute kein Beitrag');

const { market, fng, coins } = snap;
const btc = coins.find((c) => c.id === 'bitcoin');
const buys = coins.filter((c) => c.analysis?.signal === 'buy').length;
const rated = coins.filter((c) => c.analysis?.signal && c.analysis.signal !== 'none').length;

const T = {
  en: {
    title: 'Crypto weather', index: 'Market index', fng: 'Fear & Greed', week: '7 days ago', cycle: 'Cycle', btc: 'Bitcoin',
    signals: (n, of) => `${n} of ${of} rated coins with a buy signal`, note: 'Probabilities, not promises. Not financial advice.',
    cta: 'Full picture – 30 days free', bio: 'Link in bio', locale: 'en-US', tags: '#Bitcoin #Crypto #FearAndGreed #CryptoMarket',
    label: { 'Kaufen': 'Buy', 'Eher kaufen': 'Lean buy', 'Halten': 'Hold', 'Eher verkaufen': 'Lean sell', 'Verkaufen': 'Sell' },
    zone: { deep: 'deep in the cycle', low: 'lower third of the cycle', mid: 'middle of the cycle', high: 'near the high' },
    mood: ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed'], alt: 'Crypto weather report: market index, Fear & Greed, Bitcoin and cycle',
  },
  de: {
    title: 'Krypto-Wetter', index: 'Markt-Index', fng: 'Fear & Greed', week: 'vor 7 Tagen', cycle: 'Zyklus', btc: 'Bitcoin',
    signals: (n, of) => `${n} von ${of} bewerteten Coins mit Kaufsignal`, note: 'Wahrscheinlichkeiten, keine Versprechen. Keine Anlageberatung.',
    cta: 'Alles im Detail – 30 Tage kostenlos', bio: 'Link in der Bio', locale: 'de-CH', tags: '#Bitcoin #Krypto #Crypto #FearAndGreed',
    label: { 'Kaufen': 'Kaufen', 'Eher kaufen': 'Eher kaufen', 'Halten': 'Halten', 'Eher verkaufen': 'Eher verkaufen', 'Verkaufen': 'Verkaufen' },
    zone: { deep: 'tief im Zyklus', low: 'unteres Drittel des Zyklus', mid: 'Mitte des Zyklus', high: 'nahe am Hoch' },
    mood: ['extreme Angst', 'Angst', 'neutral', 'Gier', 'extreme Gier'], alt: 'Krypto-Wetterbericht: Markt-Index, Fear & Greed, Bitcoin und Zyklus',
  },
}[lang];

const weather = (v) => (v < 30 ? '⛈️' : v < 45 ? '🌧️' : v < 55 ? '☁️' : v < 70 ? '🌤️' : '☀️');
const mood = (v) => T.mood[v < 25 ? 0 : v < 45 ? 1 : v <= 55 ? 2 : v <= 75 ? 3 : 4];
const fmt = (v, d = 0) => v.toLocaleString(T.locale, { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v, d = 1) => `${v > 0 ? '+' : ''}${fmt(v, d)} %`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = new Date(snap.time).toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const link = (channel) => `${SITE}?von=${channel}`;

const R = {
  icon: weather(market.value),
  label: T.label[market.label] ?? market.label,
  index: `${T.index}: ${market.value}/100 – ${T.label[market.label] ?? market.label}`,
  fng: fng ? `${T.fng}: ${fng.value} – ${mood(fng.value)}${Number.isFinite(fng.week) ? ` (${T.week}: ${fng.week})` : ''}` : null,
  btc: btc ? `${T.btc}: $${fmt(btc.current_price)} (${signed(btc.price_change_percentage_24h_in_currency ?? 0)} 24h)` : null,
  cycle: market.cycle ? `${T.cycle}: ${T.zone[market.cycle.zone] ?? market.cycle.label}` : null,
  signals: T.signals(buys, rated),
};
const body = [R.index, R.fng, R.btc, R.cycle, R.signals].filter(Boolean);

// Fassungen je Kanal: Telegram mit Formatierung, X und Bluesky kurz, Facebook und Instagram mit Hashtags
// Aufhänger der ersten Zeile: das Auffälligste des Tages – eine deutliche Stimmungsänderung, ein großer Bitcoin-Tag
// oder sonst der kurze Wetter-Check. Die Frage am Ende lädt zum Kommentieren ein und wechselt täglich.
const btcDay = btc?.price_change_percentage_24h_in_currency ?? 0;
const H = {
  en: {
    mood: (from, to) => `Sentiment ${to > from ? 'heated up' : 'cooled down'} this week: Fear & Greed ${from} → ${to}`,
    btc: (v) => `Bitcoin ${v > 0 ? 'up' : 'down'} ${fmt(Math.abs(v), 1)} % today – here’s the bigger picture`,
    plain: 'Your 30-second crypto weather check',
    ask: ['Buying, holding or waiting? 👇', 'What’s your read on the market today? 👇', 'Fear or greed – where are you today? 👇',
      'Does this match your gut feeling? 👇', 'Sun or storm ahead – what do you think? 👇'],
    tagsShort: '#Bitcoin #Crypto',
    tagsLong: '#bitcoin #crypto #cryptocurrency #btc #ethereum #cryptomarket #fearandgreed #cryptotrading #altcoins #blockchain',
  },
  de: {
    mood: (from, to) => `Die Stimmung hat sich diese Woche ${to > from ? 'erhitzt' : 'abgekühlt'}: Fear & Greed ${from} → ${to}`,
    btc: (v) => `Bitcoin heute ${v > 0 ? 'plus' : 'minus'} ${fmt(Math.abs(v), 1)} % – so steht der Markt insgesamt`,
    plain: 'Dein 30-Sekunden-Wettercheck für Krypto',
    ask: ['Kaufen, halten oder abwarten? 👇', 'Wie schätzt du den Markt heute ein? 👇', 'Angst oder Gier – wo stehst du heute? 👇',
      'Passt das zu deinem Bauchgefühl? 👇', 'Sonne oder Sturm – was erwartest du? 👇'],
    tagsShort: '#Bitcoin #Krypto',
    tagsLong: '#bitcoin #krypto #crypto #kryptowährung #btc #ethereum #fearandgreed #altcoins #blockchain #investieren',
  },
}[lang];
const hook = fng && Number.isFinite(fng.week) && Math.abs(fng.value - fng.week) >= 8 ? H.mood(fng.week, fng.value)
  : Math.abs(btcDay) >= 3 ? H.btc(btcDay) : H.plain;
const ask = H.ask[Math.floor(snap.time / 86_400_000) % H.ask.length];
// X erlaubt 280 Zeichen (Links zählen 23, Emojis doppelt), Bluesky 300 – notfalls entfällt die Frage, dann die Hashtags
const fngShort = fng ? `${T.fng}: ${fng.value} – ${mood(fng.value)}` : null;
const short = (channel, limit) => {
  const nfa = lang === 'de' ? 'Keine Anlageberatung.' : 'Not financial advice.';
  const make = (withAsk, withTags) => [`${R.icon} ${hook}`, '', R.index, fngShort, R.btc, ...(withAsk ? ['', ask] : []), '',
    `${T.cta}: ${link(channel)}`, withTags ? `${nfa} ${H.tagsShort}` : nfa].filter((l) => l !== null).join('\n');
  const size = (t) => [...t.replace(link(channel), 'x'.repeat(23))].length + (t.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  return [make(true, true), make(true, false), make(false, false)].find((t) => size(t) <= limit) ?? make(false, false);
};

const text = {
  telegram: [`${R.icon} <b>${T.title} – ${esc(day)}</b>`, `<i>${esc(hook)}</i>`, '', ...body.map(esc), '', `<i>${T.note}</i>`, `👉 <a href="${link('telegram')}">${T.cta}</a>`].join('\n'),
  x: short('x', 280),
  bluesky: short('bluesky', 300),
  facebook: [`${R.icon} ${hook}`, '', ...body, '', ask, '', `${T.cta}: ${link('facebook')}`, '', T.note, '', H.tagsShort].join('\n'),
  instagram: [`${R.icon} ${hook}`, '', ...body, '', ask, '', `${T.cta} – ${T.bio}`, '', T.note, '.', H.tagsLong].join('\n'),
};

// ---------- Bild 1080 × 1080 ----------
async function image() {
  const v = market.value;
  const accent = v < 45 ? '#5b8def' : v < 55 ? '#9aa4b2' : '#f5a524';
  const sky = v < 30 ? 'storm' : v < 45 ? 'rain' : v < 55 ? 'cloud' : v < 70 ? 'partly' : 'sun';
  const sun = '<circle cx="0" cy="0" r="70" fill="#f5a524"/>';
  const cloud = (fill) => `<g fill="${fill}"><circle cx="-40" cy="20" r="50"/><circle cx="20" cy="0" r="65"/><circle cx="80" cy="25" r="45"/><rect x="-90" y="20" width="215" height="50" rx="25"/></g>`;
  const drops = '<g stroke="#5b8def" stroke-width="10" stroke-linecap="round"><line x1="-40" y1="95" x2="-50" y2="125"/><line x1="10" y1="95" x2="0" y2="125"/><line x1="60" y1="95" x2="50" y2="125"/></g>';
  const icon = { sun, partly: `<g transform="translate(-30,-30)">${sun}</g>${cloud('#e8ecf3')}`, cloud: cloud('#9aa4b2'),
    rain: `${cloud('#7c8796')}${drops}`, storm: `${cloud('#5c6675')}<path d="M10 80 L-15 130 L10 130 L-5 175 L45 115 L20 115 L35 80 Z" fill="#f5a524"/>` }[sky];
  const row = (y, label, value) => `<text x="90" y="${y}" font-size="38" fill="#9aa4b2">${esc(label)}</text>
    <text x="990" y="${y}" font-size="38" fill="#e8ecf3" text-anchor="end" font-weight="700">${esc(value)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" font-family="DejaVu Sans, Arial, sans-serif">
    <defs><radialGradient id="g" cx="0.2" cy="0.1" r="1"><stop offset="0" stop-color="#1b2433"/><stop offset="1" stop-color="#0b0f17"/></radialGradient></defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
    <text x="90" y="130" font-size="44" fill="#e8ecf3" font-weight="700">Coinweather</text>
    <text x="90" y="185" font-size="32" fill="#9aa4b2">${esc(T.title)} · ${esc(day)}</text>
    <g transform="translate(830,180)">${icon}</g>
    <text x="90" y="430" font-size="40" fill="#9aa4b2">${esc(T.index)}</text>
    <text x="90" y="590" font-size="190" fill="${accent}" font-weight="700">${v}<tspan font-size="70" fill="#9aa4b2">/100</tspan></text>
    <text x="90" y="670" font-size="56" fill="#e8ecf3" font-weight="700">${esc(R.label)}</text>
    <line x1="90" y1="730" x2="990" y2="730" stroke="#263042" stroke-width="2"/>
    ${fng ? row(795, T.fng, `${fng.value} – ${mood(fng.value)}`) : ''}
    ${btc ? row(860, T.btc, `$${fmt(btc.current_price)} (${signed(btc.price_change_percentage_24h_in_currency ?? 0)})`) : ''}
    ${market.cycle ? row(925, T.cycle, T.zone[market.cycle.zone] ?? market.cycle.label) : ''}
    <text x="90" y="995" font-size="24" fill="#6b7686">${esc(T.note)}</text>
    <text x="90" y="1040" font-size="28" fill="#9aa4b2" font-weight="700">coinweather.github.io</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

// ---------- Kanäle ----------
async function telegram(jpg) {
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('caption', text.telegram);
  form.append('parse_mode', 'HTML');
  form.append('photo', new Blob([jpg], { type: 'image/jpeg' }), 'coinweather.jpg');
  const r = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form })).json();
  if (!r.ok) throw new Error(r.description ?? 'abgelehnt');
}

// X: Textbeitrag über die API v2, angemeldet mit OAuth 1.0a (Schlüssel der App und des Kontos)
async function x() {
  const url = 'https://api.twitter.com/2/tweets';
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const oauth = { oauth_consumer_key: env.X_API_KEY, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: env.X_ACCESS_TOKEN, oauth_version: '1.0' };
  const params = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join('&');
  const base = ['POST', enc(url), enc(params)].join('&');
  oauth.oauth_signature = crypto.createHmac('sha1', `${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_SECRET)}`).update(base).digest('base64');
  const header = 'OAuth ' + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ');
  const r = await fetch(url, { method: 'POST', headers: { authorization: header, 'content-type': 'application/json' }, body: JSON.stringify({ text: text.x }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function bluesky(jpg) {
  const api = 'https://bsky.social/xrpc';
  const session = await (await fetch(`${api}/com.atproto.server.createSession`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }) })).json();
  if (!session.accessJwt) throw new Error(session.message ?? 'Anmeldung abgelehnt');
  const auth = { authorization: `Bearer ${session.accessJwt}` };
  const blob = await (await fetch(`${api}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg' }, body: jpg })).json();
  // Links sind bei Bluesky eigene Markierungen mit Byte-Positionen im Text
  const bytes = Buffer.from(text.bluesky), target = link('bluesky'), start = bytes.indexOf(Buffer.from(target));
  const record = { $type: 'app.bsky.feed.post', text: text.bluesky, createdAt: new Date().toISOString(), langs: [lang],
    facets: start < 0 ? [] : [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength(target) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: target }] }],
    ...(blob.blob ? { embed: { $type: 'app.bsky.embed.images', images: [{ alt: T.alt, image: blob.blob }] } } : {}) };
  const r = await fetch(`${api}/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
}

const GRAPH = 'https://graph.facebook.com/v21.0';
async function facebook(jpg) {
  const form = new FormData();
  form.append('caption', text.facebook);
  form.append('access_token', env.FACEBOOK_PAGE_TOKEN);
  form.append('source', new Blob([jpg], { type: 'image/jpeg' }), 'coinweather.jpg');
  const r = await (await fetch(`${GRAPH}/${env.FACEBOOK_PAGE_ID}/photos`, { method: 'POST', body: form })).json();
  if (!r.id) throw new Error(r.error?.message ?? 'abgelehnt');
}

// Instagram holt das Bild selbst von einer öffentlichen Adresse (imageUrl, vom Ablauf bereitgestellt)
async function instagram(_jpg, imageUrl) {
  if (!imageUrl) throw new Error('Keine öffentliche Bildadresse (IMAGE_URL)');
  const q = (p) => new URLSearchParams({ ...p, access_token: env.FACEBOOK_PAGE_TOKEN });
  const made = await (await fetch(`${GRAPH}/${env.INSTAGRAM_USER_ID}/media?${q({ image_url: imageUrl, caption: text.instagram })}`, { method: 'POST' })).json();
  if (!made.id) throw new Error(made.error?.message ?? 'Bild abgelehnt');
  for (let i = 0; i < 10; i++) {   // Instagram verarbeitet das Bild erst, bevor es veröffentlicht werden kann
    const s = await (await fetch(`${GRAPH}/${made.id}?${q({ fields: 'status_code' })}`)).json();
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR') throw new Error('Instagram konnte das Bild nicht verarbeiten');
    await new Promise((r) => setTimeout(r, 3000));
  }
  const done = await (await fetch(`${GRAPH}/${env.INSTAGRAM_USER_ID}/media_publish?${q({ creation_id: made.id })}`, { method: 'POST' })).json();
  if (!done.id) throw new Error(done.error?.message ?? 'Veröffentlichen abgelehnt');
}

const CHANNELS = [
  ['Telegram', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], telegram],
  ['X', ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'], x],
  ['Bluesky', ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'], bluesky],
  ['Facebook', ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'], facebook],
  ['Instagram', ['INSTAGRAM_USER_ID', 'FACEBOOK_PAGE_TOKEN'], instagram],
];

const jpg = await image();
const out = process.argv.indexOf('--image');
if (out > 0) await writeFile(process.argv[out + 1], jpg);
if (process.argv.includes('--show')) for (const [k, t] of Object.entries(text)) console.log(`--- ${k} (${[...t].length} Zeichen)\n${t}\n`);

// --dry: nur das Bild erzeugen (der Ablauf stellt es danach öffentlich bereit, bevor gepostet wird)
if (process.argv.includes('--dry')) process.exit(0);

let failed = 0, active = 0;
for (const [name, keys, send] of CHANNELS) {
  if (!keys.every((k) => env[k])) { console.log(`${name}: nicht eingerichtet – übersprungen`); continue; }
  active++;
  try { await send(jpg, env.IMAGE_URL); console.log(`${name}: gepostet`); }
  catch (err) { failed++; console.error(`${name}: FEHLER – ${err.message}`); }
}
if (!active) console.log('Noch kein Kanal eingerichtet. Die Schritte stehen in SOCIAL-MEDIA.md.');
// Ein fehlgeschlagener Kanal hält die anderen nicht auf; der Ablauf meldet den Fehler aber, damit er auffällt
if (failed) process.exitCode = 1;
