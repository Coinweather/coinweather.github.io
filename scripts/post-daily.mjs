// Postet einmal am Tag den „Wetterbericht“ des Kryptomarkts mit Bildern auf allen eingerichteten Kanälen.
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
// Aufruf: node scripts/post-daily.mjs [Optionen]   – ohne Geheimnisse wird nichts gepostet
//   --dry               nur Bilder erzeugen, nicht posten
//   --images <ordner>   die Bilder als slide-1.jpg … slide-4.jpg ablegen
//   --save-data <datei> den Tagesstand speichern; DATA_FILE=<datei> postet später genau diesen Stand
//   --show              die Texte je Kanal anzeigen
//   --check             nur den Facebook-/Instagram-Zugang prüfen, nichts posten

import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { buyHistory } from '../js/model.js';

const REPO = 'Coinweather/coinweather.github.io';
const SNAPSHOT = `https://raw.githubusercontent.com/${REPO}/data/snapshot.json`;
const SITE = 'https://coinweather.github.io/';
const env = process.env;
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const lang = (env.POST_LANG ?? env.TELEGRAM_LANG) === 'de' ? 'de' : 'en';
const GRAPH = 'https://graph.facebook.com/v21.0';

// ---------- Zugang zu Facebook und Instagram ----------
// Hinterlegt sein darf der Seiten-Token oder der verlängerte Benutzer-Token (ein häufiger Stolperstein beim Einrichten).
// Auf einer Facebook-Seite posten darf nur der Seiten-Token – ist ein Benutzer-Token hinterlegt, holt der Ablauf ihn daraus.
// Ein Seiten-Token aus einem verlängerten Benutzer-Token läuft nie ab; der Benutzer-Token selbst gilt 60 Tage.
const when = (s) => new Date(s * 1000).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });
const graph = async (path, p) => (await fetch(`${GRAPH}/${path}?${new URLSearchParams(p)}`)).json();
const describe = async (token) => (await graph('debug_token', { input_token: token, access_token: token }));
let metaReady;
const metaToken = () => (metaReady ??= (async () => {
  const stored = env.FACEBOOK_PAGE_TOKEN;
  if (!stored || !env.FACEBOOK_PAGE_ID) return { token: stored };
  const info = (await describe(stored)).data;
  if (info?.type !== 'USER') return { token: stored, info };
  const page = await graph(env.FACEBOOK_PAGE_ID, { fields: 'access_token', access_token: stored });
  return page.access_token ? { token: page.access_token, derived: true, info } : { token: stored, info };
})());

// Prüfen ohne zu posten: ob der Token gültig ist und wann er abläuft. Der Token selbst wird nie ausgegeben.
async function checkMeta() {
  if (!env.FACEBOOK_PAGE_TOKEN) return console.log('FACEBOOK_PAGE_TOKEN fehlt.');
  const show = async (label, token) => {
    const debug = await describe(token), info = debug.data;
    if (!info) { console.log(`${label}: UNGÜLTIG – ${debug.error?.message ?? 'keine Antwort'}`); return null; }
    console.log(`${label}: ${info.is_valid ? 'gültig' : 'UNGÜLTIG'} · Art: ${info.type ?? '?'} · läuft ab: ${info.expires_at ? when(info.expires_at) : 'nie'}`);
    if (info.error?.message) console.log(`  Meldung von Facebook: ${info.error.message}`);
    return info;
  };
  const stored = await show('Hinterlegter Token', env.FACEBOOK_PAGE_TOKEN);
  if (stored?.scopes) console.log(`  Berechtigungen: ${stored.scopes.join(', ')}`);
  const meta = await metaToken();
  const used = meta.derived ? await show('Daraus geholter Seiten-Token', meta.token) : stored;
  if (meta.derived && stored?.expires_at) console.log(`  Hinweis: Der hinterlegte Benutzer-Token gilt bis ${stored.expires_at ? when(stored.expires_at) : '–'}. Bis dahin läuft alles;
  danach einen neuen Token erzeugen – oder jetzt schon den Seiten-Token (me/accounts) hinterlegen, der nie abläuft.`);
  for (const [label, id, fields] of [['Facebook-Seite', env.FACEBOOK_PAGE_ID, 'name'], ['Instagram-Konto', env.INSTAGRAM_USER_ID, 'username']]) {
    if (!id) { console.log(`${label}: nicht eingerichtet`); continue; }
    const r = await graph(id, { fields, access_token: meta.token });
    console.log(`${label}: ${r.error ? `FEHLER – ${r.error.message}` : `erreichbar (${r[fields]})`}`);
    if (r.error) process.exitCode = 1;
  }
  if (env.INSTAGRAM_USER_ID) {
    const media = await graph(`${env.INSTAGRAM_USER_ID}/media`, { fields: 'timestamp,media_type,permalink', limit: '5', access_token: meta.token });
    for (const m of media.data ?? []) console.log(`  Instagram-Beitrag: ${new Date(m.timestamp).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' })} · ${m.media_type} · ${m.permalink}`);
    const limit = await graph(`${env.INSTAGRAM_USER_ID}/content_publishing_limit`, { fields: 'quota_usage,config', access_token: meta.token });
    if (limit.data?.[0]) console.log(`  Instagram-Tageslimit: ${limit.data[0].quota_usage} von ${limit.data[0].config?.quota_total ?? '?'} Beiträgen in 24 h`);
  }
  // Reichweite: Follower, Likes und Kommentare der letzten Beiträge – zeigt, ob die Beiträge überhaupt jemanden erreichen
  const fmtDay = (t) => new Date(t).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' });
  if (env.INSTAGRAM_USER_ID) {
    const acc = await graph(env.INSTAGRAM_USER_ID, { fields: 'followers_count,follows_count,media_count', access_token: meta.token });
    if (!acc.error) console.log(`Instagram: ${acc.followers_count} Follower · ${acc.media_count} Beiträge`);
    const media = await graph(`${env.INSTAGRAM_USER_ID}/media`, { fields: 'timestamp,like_count,comments_count', limit: '10', access_token: meta.token });
    for (const m of media.data ?? []) console.log(`  ${fmtDay(m.timestamp)}: ${m.like_count ?? 0} Likes · ${m.comments_count ?? 0} Kommentare`);
  }
  if (env.FACEBOOK_PAGE_ID) {
    const page = await graph(env.FACEBOOK_PAGE_ID, { fields: 'followers_count,fan_count', access_token: meta.token });
    if (!page.error) console.log(`Facebook: ${page.followers_count ?? '?'} Follower · ${page.fan_count ?? '?'} Gefällt-mir`);
    const reels = await graph(`${env.FACEBOOK_PAGE_ID}/video_reels`, { fields: 'created_time,permalink_url,status', limit: '5', access_token: meta.token });
    if (reels.error) console.log(`  Reels: ${reels.error.message}`);
    for (const v of reels.data ?? []) console.log(`  Facebook-Reel: ${new Date(v.created_time).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' })} · Video ${v.status?.video_status ?? '?'} · Veröffentlichung ${v.status?.publishing_phase?.status ?? '?'}${v.status?.processing_phase?.error?.message ? ` · Fehler: ${v.status.processing_phase.error.message}` : ''} · ${v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : ''}`);
    const posts = await graph(`${env.FACEBOOK_PAGE_ID}/posts`, { fields: 'created_time,reactions.summary(true).limit(0),comments.summary(true).limit(0),shares', limit: '10', access_token: meta.token });
    if (posts.error) console.log(`  Beiträge: ${posts.error.message}`);
    for (const m of posts.data ?? []) console.log(`  ${fmtDay(m.created_time)}: ${m.reactions?.summary?.total_count ?? 0} Reaktionen · ${m.comments?.summary?.total_count ?? 0} Kommentare · ${m.shares?.count ?? 0} geteilt`);
  }
  if (!used?.is_valid || (used.type === 'PAGE' && used.expires_at)) process.exitCode = 1;
}
if (args.includes('--check')) { await checkMeta(); process.exit(); }

// ---------- Tagesstand ----------
// Der Ablauf erzeugt die Bilder und postet in getrennten Schritten; mit DATA_FILE passen Text und Bilder sicher zusammen
const snap = env.DATA_FILE ? JSON.parse(await readFile(env.DATA_FILE, 'utf8')) : await (async () => {
  const res = await fetch(`${SNAPSHOT}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Daten nicht ladbar (${res.status})`);
  return res.json();
})();
if (Date.now() - snap.time > 6 * 3_600_000) throw new Error('Die Daten sind älter als 6 Stunden – heute kein Beitrag');
if (arg('--save-data')) await writeFile(arg('--save-data'), JSON.stringify(snap));

const { market, fng, coins } = snap;
const btc = coins.find((c) => c.id === 'bitcoin');
const buys = coins.filter((c) => c.analysis?.signal === 'buy').length;
const rated = coins.filter((c) => c.analysis?.signal && c.analysis.signal !== 'none').length;
const fc = market.forecast;

const T = {
  en: {
    title: 'Crypto weather', index: 'Buy score', weather: 'Weather', sky: ['Stormy', 'Rainy', 'Cloudy', 'Partly cloudy', 'Sunny'], fng: 'Fear & Greed', week: '7 days ago', cycle: 'Cycle', btc: 'Bitcoin',
    signals: (n, of) => `${n} of ${of} rated coins with a short-term buy signal`, note: 'Probabilities, not promises. Not financial advice.',
    cta: 'Full picture – 30 days free', bio: 'Link in bio', locale: 'en-US', tags: '#Bitcoin #Crypto #FearAndGreed #CryptoMarket',
    label: { 'Kaufen': 'Buy', 'Eher kaufen': 'Lean buy', 'Halten': 'Hold', 'Eher verkaufen': 'Lean sell', 'Verkaufen': 'Sell' },
    zone: { deep: 'deep in the cycle', low: 'lower third of the cycle', mid: 'middle of the cycle', high: 'near the high' },
    mood: ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed'], alt: 'Crypto weather report: buy score, Fear & Greed, Bitcoin and market weather',
  },
  de: {
    title: 'Krypto-Wetter', index: 'Kauf-Score', weather: 'Wetter', sky: ['Stürmisch', 'Regnerisch', 'Bewölkt', 'Heiter bis wolkig', 'Sonnig'], fng: 'Fear & Greed', week: 'vor 7 Tagen', cycle: 'Zyklus', btc: 'Bitcoin',
    signals: (n, of) => `${n} von ${of} bewerteten Coins mit Kaufsignal für die nächsten Wochen`, note: 'Wahrscheinlichkeiten, keine Versprechen. Keine Anlageberatung.',
    cta: 'Alles im Detail – 30 Tage kostenlos', bio: 'Link in der Bio', locale: 'de-CH', tags: '#Bitcoin #Krypto #Crypto #FearAndGreed',
    label: { 'Kaufen': 'Kaufen', 'Eher kaufen': 'Eher kaufen', 'Halten': 'Halten', 'Eher verkaufen': 'Eher verkaufen', 'Verkaufen': 'Verkaufen' },
    zone: { deep: 'tief im Zyklus', low: 'unteres Drittel des Zyklus', mid: 'Mitte des Zyklus', high: 'nahe am Hoch' },
    mood: ['extreme Angst', 'Angst', 'neutral', 'Gier', 'extreme Gier'], alt: 'Krypto-Wetterbericht: Kauf-Score, Fear & Greed, Bitcoin und Markt-Wetter',
  },
}[lang];

const weather = (v) => (v < 30 ? '⛈️' : v < 45 ? '🌧️' : v < 55 ? '☁️' : v < 70 ? '🌤️' : '☀️');
const mood = (v) => T.mood[v < 25 ? 0 : v < 45 ? 1 : v <= 55 ? 2 : v <= 75 ? 3 : 4];
const fmt = (v, d = 0) => v.toLocaleString(T.locale, { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)} %`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = new Date(snap.time).toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
// Datum in der Adresse: X, Facebook & Co. laden die Vorschau dann jeden Tag neu (die Seite hat ein tagesaktuelles Vorschaubild)
const link = (channel) => `${SITE}?von=${channel}&d=${new Date(snap.time).toISOString().slice(0, 10)}`;
const daily = Math.floor(snap.time / 86_400_000);   // wechselt täglich: Aufhänger und Frage

// Das Wetter zeigt die Stimmung (Markt-Wetter), der Kauf-Score ist antizyklisch: bei Regen und günstigem Zyklus hoch
const moodV = market.mood?.value ?? market.value, skyI = moodV < 30 ? 0 : moodV < 45 ? 1 : moodV < 55 ? 2 : moodV < 70 ? 3 : 4;
const TIP = {
  en: { rain: '☔ Rain is buying weather: the mood is poor, but the cycle is cheap.', sun: '🌡️ Sunshine is expensive: the mood is great, but the cycle is hot.' },
  de: { rain: '☔ Regen ist Kaufwetter: Die Stimmung ist schlecht, der Zyklus aber günstig.', sun: '🌡️ Sonne ist teuer: Die Stimmung ist gut, der Zyklus aber heiß.' },
}[lang];
const R = {
  icon: weather(moodV),
  sky: T.sky[skyI],
  tip: market.buy && skyI <= 1 && market.value >= 62 ? TIP.rain : market.buy && skyI >= 3 && market.value < 45 ? TIP.sun : null,
  label: T.label[market.label] ?? market.label,
  index: `${T.index}: ${market.value}/100 – ${T.label[market.label] ?? market.label}`,
  fng: fng ? `${T.fng}: ${fng.value} – ${mood(fng.value)}${Number.isFinite(fng.week) ? ` (${T.week}: ${fng.week})` : ''}` : null,
  btc: btc ? `${T.btc}: $${fmt(btc.current_price)} (${signed(btc.price_change_percentage_24h_in_currency ?? 0)} 24h)` : null,
  cycle: market.cycle ? `${T.cycle}: ${T.zone[market.cycle.zone] ?? market.cycle.label}` : null,
  signals: T.signals(buys, rated),
};
// Autopilot: Hat das Modell-Portfolio heute gehandelt, sagt der Beitrag es – das ist die Erinnerung für alle, die ihm folgen.
// Welche Coins, steht nur in der App.
const autoLine = await (async () => {
  try {
    const c = await (await fetch(`${SITE}data/model-curve.json?t=${Date.now()}`)).json();
    const today = Math.floor(snap.time / 86_400_000) * 86_400_000;
    const done = (c.profiles?.balanced?.trades ?? c.trades ?? []).filter((x) => x.t >= today);
    if (!done.length || env.EDITION === 'evening') return null;
    const buys = done.filter((x) => ['buy', 'add', 'swap-in'].includes(x.type)).length, sells = done.length - buys;
    return lang === 'de' ? `🤖 Autopilot: Das Modell hat heute umgeschichtet (${buys} Käufe, ${sells} Verkäufe) – deine Schritte stehen in der App.`
      : `🤖 Autopilot: the model rebalanced today (${buys} buys, ${sells} sells) – your steps are waiting in the app.`;
  } catch { return null; }
})();
const body = [`${T.weather}: ${R.sky}`, R.index, R.fng, R.btc, R.signals, autoLine].filter(Boolean);

// Größte Bewegungen der 100 größten Coins in 24 Stunden – Beobachtungen, keine Empfehlungen; Stablecoins zählen nicht
const movers = coins.filter((c) => c.market_cap_rank <= 100 && c.analysis?.signal !== 'none' && !c.analysis?.stable
  && Number.isFinite(c.price_change_percentage_24h_in_currency))
  .sort((a, b) => b.price_change_percentage_24h_in_currency - a.price_change_percentage_24h_in_currency);
const gainers = movers.slice(0, 3).filter((c) => c.price_change_percentage_24h_in_currency > 0);
const losers = movers.slice(-3).reverse().filter((c) => c.price_change_percentage_24h_in_currency < 0);
const gainer = gainers[0];

// Fassungen je Kanal: Telegram mit Formatierung, X und Bluesky kurz, Facebook und Instagram ausführlich
// Aufhänger der ersten Zeile: das Auffälligste des Tages – eine deutliche Stimmungsänderung, ein großer Bitcoin-Tag
// oder sonst eine von mehreren Einstiegsfragen. Die Frage am Ende lädt zum Kommentieren ein und wechselt täglich.
const btcDay = btc?.price_change_percentage_24h_in_currency ?? 0;
const H = {
  en: {
    mood: (from, to) => `Sentiment ${to > from ? 'heated up' : 'cooled down'} this week: Fear & Greed ${from} → ${to}`,
    rain: (v) => `Rainy market, cheap cycle: our buy score is ${v}/100 – rain is buying weather`,
    sun: (v) => `Sunny market, hot cycle: our buy score is only ${v}/100`,
    btc: (v) => `Bitcoin ${v > 0 ? 'up' : 'down'} ${fmt(Math.abs(v), 1)} % today – here’s the bigger picture`,
    plain: ['Your 30-second crypto weather check', 'Is now a good time to buy crypto? Today’s forecast', 'Sun or storm? The crypto market in 30 seconds'],
    ask: ['Buying, holding or waiting? 👇', 'What’s your read on the market today? 👇', 'Fear or greed – where are you today? 👇',
      'Does this match your gut feeling? 👇', 'Sun or storm ahead – what do you think? 👇'],
    tagsShort: '#Bitcoin #Crypto',
    tagsFb: '#Bitcoin #Crypto #CryptoNews',
    tagsIg: '#bitcoin #crypto #cryptocurrency #btc #cryptonews',   // Instagram erlaubt seit Dezember 2025 höchstens 5
  },
  de: {
    mood: (from, to) => `Die Stimmung hat sich diese Woche ${to > from ? 'erhitzt' : 'abgekühlt'}: Fear & Greed ${from} → ${to}`,
    rain: (v) => `Regnerischer Markt, günstiger Zyklus: Unser Kauf-Score steht bei ${v}/100 – Regen ist Kaufwetter`,
    sun: (v) => `Sonniger Markt, heißer Zyklus: Unser Kauf-Score steht nur bei ${v}/100`,
    btc: (v) => `Bitcoin heute ${v > 0 ? 'plus' : 'minus'} ${fmt(Math.abs(v), 1)} % – so steht der Markt insgesamt`,
    plain: ['Dein 30-Sekunden-Wettercheck für Krypto', 'Ist jetzt ein guter Zeitpunkt für Krypto? Die Vorhersage für heute',
      'Sonne oder Sturm? Der Kryptomarkt in 30 Sekunden'],
    ask: ['Kaufen, halten oder abwarten? 👇', 'Wie schätzt du den Markt heute ein? 👇', 'Angst oder Gier – wo stehst du heute? 👇',
      'Passt das zu deinem Bauchgefühl? 👇', 'Sonne oder Sturm – was erwartest du? 👇'],
    tagsShort: '#Bitcoin #Krypto',
    tagsFb: '#Bitcoin #Krypto #Kryptowährung',
    tagsIg: '#bitcoin #krypto #crypto #kryptowährung #btc',
  },
}[lang];
// Abend-Ausgabe (EDITION=evening): nur ein Reel mit den größten Bewegungen des Tages vorne – eine zweite Chance am Tag,
// Leuten angezeigt zu werden, die dem Konto noch nicht folgen
const evening = env.EDITION === 'evening';
const EVENING = { en: 'Today’s biggest crypto movers', de: 'Die größten Krypto-Bewegungen heute' }[lang];
const hook = evening ? EVENING : R.tip ? (R.tip === TIP.rain ? H.rain(market.value) : H.sun(market.value)) : fng && Number.isFinite(fng.week) && Math.abs(fng.value - fng.week) >= 8 ? H.mood(fng.week, fng.value)
  : Math.abs(btcDay) >= 3 ? H.btc(btcDay) : H.plain[daily % H.plain.length];
const ask = H.ask[daily % H.ask.length];
// X erlaubt 280 Zeichen (Links zählen 23, Emojis doppelt), Bluesky 300 – notfalls entfällt die Frage, dann die Hashtags
const fngShort = fng ? `${T.fng}: ${fng.value} – ${mood(fng.value)}` : null;
// noLink: X verlangt für Beiträge mit Link ein Vielfaches – dort steht der Link im Profil
const short = (channel, limit, noLink = false) => {
  const nfa = lang === 'de' ? 'Keine Anlageberatung.' : 'Not financial advice.';
  const make = (withAsk, withTags) => [`${R.icon} ${hook}`, '', R.index, fngShort, R.btc, autoLine, ...(withAsk ? ['', ask] : []), '',
    noLink ? `${T.cta} – ${T.bio} 🔗` : `${T.cta}: ${link(channel)}`, withTags ? `${nfa} ${H.tagsShort}` : nfa].filter((l) => l !== null).join('\n');
  // Bluesky zählt Schriftzeichen (Grapheme), den Link in voller Länge
  const size = (t) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)].length;
  return [make(true, true), make(true, false), make(false, false)].find((t) => size(t) <= limit) ?? make(false, false);
};

// ---------- X: reicher Text mit Stimmungsbalken, grösstem Gewinner und täglicher Umfrage ----------
// X rechnet pro Beitrag ab, nicht nach Länge – Text und Umfrage kosten nichts extra. Gezählt wird nach den Regeln von X:
// Emojis und die meisten Sonderzeichen zählen doppelt.
const xLength = (t) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)].reduce((n, { segment: g }) => {
  if (/\p{Extended_Pictographic}/u.test(g)) return n + 2;
  const c = g.codePointAt(0);
  return n + ((c <= 4351) || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2);
}, 0);
const XT = {
  en: { index: 'Buy score', fng: 'Fear & Greed', week: 'last week', top: 'Top gainer', vote: 'Your move today? Vote 👇',
    foot: 'Full picture: link in bio · Not financial advice', poll: ['🟢 Buying', '🟡 Holding', '🔴 Selling', '👀 Just watching'] },
  de: { index: 'Kauf-Score', fng: 'Fear & Greed', week: 'letzte Woche', top: 'Top-Gewinner', vote: 'Was machst du heute? Stimm ab 👇',
    foot: 'Alles im Detail: Link im Profil · Keine Anlageberatung', poll: ['🟢 Ich kaufe', '🟡 Ich halte', '🔴 Ich verkaufe', '👀 Ich schaue zu'] },
}[lang];
const moodIcon = (v) => (v < 25 ? '😱' : v < 45 ? '😨' : v <= 55 ? '😐' : v <= 75 ? '😏' : '🔥');
const bar = (v) => '▰'.repeat(Math.round(v / 10)) + '▱'.repeat(10 - Math.round(v / 10));
const fngLine = (shortWeek) => fng ? `${moodIcon(fng.value)} ${XT.fng}: ${fng.value} (${mood(fng.value)})${Number.isFinite(fng.week) && fng.week !== fng.value && !hook.includes('→') ? ` · ${shortWeek} ${fng.week}` : ''}` : null;
const btcLine = btc ? `₿ Bitcoin: $${fmt(btc.current_price)} (${signed(btc.price_change_percentage_24h_in_currency ?? 0)})` : null;
// Zyklus-Kompass (beim Veröffentlichen der Seite berechnet): Zyklus-Risiko und Altcoin-Saison als zusätzliche Zeile
const compass = await fetch(`${SITE}data/indices.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const compassLine = (() => {
  // Das Zyklus-Risiko steckt bereits im Kauf-Score (100 − Zyklus-Risiko) – hier nur, was er nicht zeigt
  const s = compass?.altseason?.value;
  if (!Number.isFinite(s)) return null;
  return lang === 'de' ? `🧭 Altcoin-Saison: ${s}/100` : `🧭 Altcoin season: ${s}/100`;
})();

function richX() {
  const parts = (withBar, withTop, withTags, withCompass = false) => [
    `${R.icon} ${hook}`, '',
    `📊 ${XT.index}: ${market.value}/100 · ${R.label}`,
    withBar ? bar(market.value) : null,
    fngLine(XT.week),
    btcLine,
    withCompass ? compassLine : null,
    withTop && gainer ? `🚀 ${XT.top}: ${gainer.symbol.toUpperCase()} ${signed(gainer.price_change_percentage_24h_in_currency)}` : null,
    '', XT.vote, XT.foot, withTags ? H.tagsShort : null,
  ].filter((l) => l !== null).join('\n');
  return [parts(true, true, true, true), parts(true, true, false, true), parts(false, true, false, true), parts(true, true, true), parts(true, true, false), parts(false, true, false), parts(false, false, false)]
    .find((t) => xLength(t) <= 280) ?? parts(false, false, false);
}

// ---------- Facebook und Instagram: ausführlich, mit Einordnung, Abstimmung per Kommentar und klarem Angebot ----------
// Länge kostet dort nichts. Die Einordnung nennt eine Häufigkeit aus den Tests seit 2018 – ausdrücklich keine Zusage.
const M = {
  en: {
    top: 'Top gainer (top 100)', flop: 'Biggest drop (top 100)', movesHead: 'Biggest moves of the top 100 in 24 h:', obs: 'Observations, not recommendations.', cycle: 'Cycle', signals: (n, of) => `Short-term buy signals: ${n} of ${of} coins`,
    odds: (b, e) => `📈 Since 2022, after buy scores like today, Bitcoin was higher one year later in ${b} of 100 cases, Ethereum in ${e} – a tendency, not a promise.`,
    more: { facebook: '📸 More in the photos: the outlook and today’s top movers.', instagram: '👉 Swipe for the outlook and today’s top movers.' },
    vote: 'Comment your move: 🟢 buying · 🟡 holding · 🔴 selling',
    offer: '✅ Signals for 1,000 coins, portfolio check and an open track record of every call – 30 days free, no payment details needed',
    save: '💾 Save this post and share it with a friend who checks the charts every morning.',
    follow: { facebook: '🔔 Follow the page for your crypto weather every morning.', instagram: '🔔 Follow for your crypto weather every morning.' },
  },
  de: {
    top: 'Top-Gewinner (Top 100)', flop: 'Größter Verlierer (Top 100)', movesHead: 'Größte Bewegungen der Top 100 in 24 h:', obs: 'Beobachtungen, keine Empfehlungen.', cycle: 'Zyklus', signals: (n, of) => `Kaufsignale für die nächsten Wochen: ${n} von ${of} Coins`,
    odds: (b, e) => `📈 Seit 2022 stand Bitcoin nach Kauf-Scores wie heute ein Jahr später in ${b} von 100 Fällen höher, Ethereum in ${e} – eine Tendenz, kein Versprechen.`,
    more: { facebook: '📸 Mehr auf den Bildern: die Aussicht und die größten Bewegungen des Tages.', instagram: '👉 Wischen für die Aussicht und die größten Bewegungen des Tages.' },
    vote: 'Schreib in die Kommentare: 🟢 ich kaufe · 🟡 ich halte · 🔴 ich verkaufe',
    offer: '✅ Signale für 1000 Coins, Portfolio-Check und eine offene Erfolgskontrolle jedes Signals – 30 Tage kostenlos, ohne Zahlungsdaten',
    save: '💾 Speichere den Beitrag und teile ihn mit jemandem, der jeden Morgen die Charts checkt.',
    follow: { facebook: '🔔 Folge der Seite für dein Krypto-Wetter jeden Morgen.', instagram: '🔔 Folge uns für dein Krypto-Wetter jeden Morgen.' },
  },
}[lang];
// Dieselbe Aussage wie die Seite: Wie es ein Jahr nach vergleichbaren Kauf-Scores weiterging (Zyklus-Kompass, seit 2022)
const year = market.buy ? buyHistory(market.value) : null;
const odds = year ? M.odds(year.btc.up, year.eth.up) : null;
function rich(channel, reel = false) {
  const loser = losers[0];
  const list = (icon, l) => l.map((c) => `${icon} ${c.symbol.toUpperCase()} ${signed(c.price_change_percentage_24h_in_currency)}`);
  const moves = evening ? [M.movesHead, ...list('🚀', gainers), ...list('🧊', losers), M.obs]
    : [gainer ? `🚀 ${M.top}: ${gainer.symbol.toUpperCase()} ${signed(gainer.price_change_percentage_24h_in_currency)}` : null,
      loser ? `🧊 ${M.flop}: ${loser.symbol.toUpperCase()} ${signed(loser.price_change_percentage_24h_in_currency)}` : null];
  return [
    `${R.icon} ${hook}`, `🗓️ ${T.title} · ${day}`, '',
    `${R.icon} ${T.weather}: ${R.sky}`,
    `📊 ${XT.index}: ${market.value}/100 · ${R.label}`,
    bar(market.value),
    fngLine(XT.week),
    btcLine,
    `🎯 ${M.signals(buys, rated)}`,
    compassLine,
    ...(autoLine ? ['', autoLine] : []),
    ...(evening ? ['', ...moves] : moves),
    ...(odds ? ['', odds] : []),
    ...(reel ? [] : ['', M.more[channel]]),
    '', ask, M.vote,
    '', channel === 'facebook' ? `${M.offer}:\n👉 ${link('facebook')}` : `${M.offer} 🔗 ${T.bio}`,
    '', ...(channel === 'instagram' ? [M.save] : []), M.follow[channel],
    '', T.note,
    channel === 'facebook' ? H.tagsFb : H.tagsIg,
  ].filter((l) => l !== null).join('\n');
}

const text = {
  telegram: [`${R.icon} <b>${T.title} – ${esc(day)}</b>`, `<i>${esc(hook)}</i>`, '', ...body.map(esc), '', `<i>${T.note}</i>`, `👉 <a href="${esc(link('telegram'))}">${T.cta}</a>`].join('\n'),
  x: richX(),
  bluesky: short('bluesky', 300),
  facebook: rich('facebook'),
  instagram: rich('instagram'),
  facebookReel: rich('facebook', true),
  instagramReel: rich('instagram', true),
};

// ---------- Bilder 1080 × 1350 (Hochformat 4:5 – nimmt im Feed am meisten Platz ein) ----------
// 1 Wetterbericht · 2 Aussicht · 3 größte Bewegungen · 4 Angebot. Instagram zeigt sie als Karussell, Facebook als Album.
const S = {
  en: {
    outlook: 'One year later', outlookSub: 'How often was the price higher one year', outlookSub2: (v) => `after a buy score like today (${v})? Since 2022`,
    higher: 'higher', median: 'median', btcRow: 'Bitcoin', ethRow: 'Ethereum', altRow: 'Altcoins', btcHint: 'the market leader', ethHint: 'number two', altHint: 'the typical altcoin',
    coin: 'Rain is buying weather – for Bitcoin and Ethereum.', tendency: 'One cycle since 2022 – a tendency, not a guarantee.',
    movers: 'Top movers · 24h', moversSub: 'The 100 largest coins by market cap', gainers: 'Gainers', losers: 'Losers',
    obs: 'Observations, not recommendations.', signals: 'Short-term signals', signalsVal: (n, of) => `${n} of ${of} coins`,
    ctaTitle: 'Want the full picture?', bullets: ['Autopilot: you say how much, it says what to buy', 'Contrarian buy score from the Cycle Compass',
      'Signals for 1,000 coins', 'Tracked live – including the bad weeks'],
    free: '30 days free', nopay: 'No payment details needed', bio: 'Link in bio', follow: 'Follow for your crypto weather every morning',
  },
  de: {
    outlook: 'Ein Jahr später', outlookSub: 'Wie oft stand der Kurs ein Jahr nach', outlookSub2: (v) => `einem Kauf-Score wie heute (${v}) höher? Seit 2022`,
    higher: 'höher', median: 'Median', btcRow: 'Bitcoin', ethRow: 'Ethereum', altRow: 'Altcoins', btcHint: 'die Leitwährung', ethHint: 'die Nummer zwei', altHint: 'der typische Altcoin',
    coin: 'Regen ist Kaufwetter – für Bitcoin und Ethereum.', tendency: 'Ein Zyklus seit 2022 – eine Tendenz, keine Garantie.',
    movers: 'Größte Bewegungen · 24 h', moversSub: 'Die 100 größten Coins nach Marktwert', gainers: 'Gewinner', losers: 'Verlierer',
    obs: 'Beobachtungen, keine Empfehlungen.', signals: 'Signale (Wochen)', signalsVal: (n, of) => `${n} von ${of} Coins`,
    ctaTitle: 'Alles im Detail?', bullets: ['Autopilot: Du sagst, wie viel – er sagt, was du kaufst', 'Antizyklischer Kauf-Score aus dem Zyklus-Kompass',
      'Signale für 1000 Coins', 'Live mitgemessen – auch die schlechten Wochen'],
    free: '30 Tage kostenlos', nopay: 'Ohne Zahlungsdaten', bio: 'Link in der Bio', follow: 'Folge uns für dein Krypto-Wetter jeden Morgen',
  },
}[lang];
const C = { bg: '#0b0f17', text: '#e8ecf3', muted: '#9aa4b2', dim: '#6b7686', line: '#263042', up: '#3ecf8e', down: '#ef5b5b', sun: '#f5a524', rain: '#5b8def' };
const W = 1080, HGT = 1350, SLIDES = 4;

// Gemeinsamer Rahmen: Hintergrund, Kopf mit Marke und Datum, Fuß mit Hinweis, Adresse und Seitenpunkten
function frame(n, content, note = T.note) {
  const dots = Array.from({ length: SLIDES }, (_, i) => `<circle cx="${990 - (SLIDES - 1 - i) * 26}" cy="1282" r="7" fill="${i === n - 1 ? C.text : C.line}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HGT}" font-family="DejaVu Sans, Arial, sans-serif">
    <defs><radialGradient id="g" cx="0.2" cy="0.1" r="1.1"><stop offset="0" stop-color="#1b2433"/><stop offset="1" stop-color="${C.bg}"/></radialGradient></defs>
    <rect width="${W}" height="${HGT}" fill="url(#g)"/>
    <text x="90" y="125" font-size="46" fill="${C.text}" font-weight="700">Coinweather</text>
    <text x="90" y="180" font-size="32" fill="${C.muted}">${esc(T.title)} · ${esc(day)}</text>
    ${content}
    <text x="90" y="1230" font-size="26" fill="${C.dim}">${esc(note)}</text>
    <text x="90" y="1292" font-size="32" fill="${C.muted}" font-weight="700">coinweather.github.io</text>
    ${dots}
  </svg>`;
}
const gaugeBar = (x, y, w, h, v, color) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${C.line}"/>
  <rect x="${x}" y="${y}" width="${Math.max(h, w * Math.min(100, Math.max(0, v)) / 100)}" height="${h}" rx="${h / 2}" fill="${color}"/>`;
const upColor = (p) => (p >= 55 ? C.up : p <= 45 ? C.down : C.text);

function slideWeather() {
  const v = market.value;
  const accent = v >= 62 ? C.up : v < 45 ? C.down : C.sun;
  const sky = ['storm', 'rain', 'cloud', 'partly', 'sun'][skyI];
  const sun = `<circle cx="0" cy="0" r="70" fill="${C.sun}"/>`;
  const cloud = (fill) => `<g fill="${fill}"><circle cx="-40" cy="20" r="50"/><circle cx="20" cy="0" r="65"/><circle cx="80" cy="25" r="45"/><rect x="-90" y="20" width="215" height="50" rx="25"/></g>`;
  const drops = `<g stroke="${C.rain}" stroke-width="10" stroke-linecap="round"><line x1="-40" y1="95" x2="-50" y2="125"/><line x1="10" y1="95" x2="0" y2="125"/><line x1="60" y1="95" x2="50" y2="125"/></g>`;
  const icon = { sun, partly: `<g transform="translate(-30,-30)">${sun}</g>${cloud('#e8ecf3')}`, cloud: cloud('#9aa4b2'),
    rain: `${cloud('#7c8796')}${drops}`, storm: `${cloud('#5c6675')}<path d="M10 80 L-15 130 L10 130 L-5 175 L45 115 L20 115 L35 80 Z" fill="${C.sun}"/>` }[sky];
  const row = (y, label, value, color = C.text) => `<text x="90" y="${y}" font-size="38" fill="${C.muted}">${esc(label)}</text>
    <text x="990" y="${y}" font-size="38" fill="${color}" text-anchor="end" font-weight="700">${esc(value)}</text>`;
  const b24 = btc?.price_change_percentage_24h_in_currency ?? 0;
  return frame(1, `
    <g transform="translate(840,200)">${icon}</g>
    <text x="90" y="420" font-size="40" fill="${C.muted}">${esc(T.index)}</text>
    <text x="90" y="600" font-size="200" fill="${accent}" font-weight="700">${v}<tspan font-size="72" fill="${C.muted}">/100</tspan></text>
    <text x="90" y="685" font-size="60" fill="${C.text}" font-weight="700">${esc(R.label)}</text>
    ${gaugeBar(90, 725, 900, 26, v, accent)}
    <line x1="90" y1="805" x2="990" y2="805" stroke="${C.line}" stroke-width="2"/>
    ${row(880, T.weather, R.sky)}
    ${fng ? row(955, T.fng, `${fng.value} – ${mood(fng.value)}`) : ''}
    ${btc ? row(1030, T.btc, `$${fmt(btc.current_price)} (${signed(b24)})`, b24 > 0 ? C.up : b24 < 0 ? C.down : C.text) : ''}
    ${row(1105, S.signals, S.signalsVal(buys, rated))}`);
}

// Bild 2: Ein Jahr nach vergleichbaren Kauf-Scores – Bitcoin, Ethereum, Altcoins (dieselben Zahlen wie auf der Seite)
function slideOutlook() {
  const h = year ?? { btc: {}, eth: {}, alt: {} };
  const pct = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} %` : '–');
  const row = (y, label, hint, r) => `<text x="90" y="${y - 20}" font-size="44" fill="${C.text}" font-weight="700">${esc(label)}</text>
    <text x="90" y="${y + 28}" font-size="30" fill="${C.muted}">${esc(hint)}</text>
    ${Number.isFinite(r.up) ? `<text x="640" y="${y + 10}" font-size="80" fill="${upColor(r.up)}" text-anchor="middle" font-weight="700">${r.up}<tspan font-size="40"> %</tspan></text>
    ${gaugeBar(520, y + 34, 240, 14, r.up, upColor(r.up))}` : ''}
    <text x="900" y="${y + 10}" font-size="52" fill="${r.median > 0 ? C.up : r.median < 0 ? C.down : C.text}" text-anchor="middle" font-weight="700">${esc(pct(r.median))}</text>`;
  return frame(2, `
    <text x="90" y="320" font-size="72" fill="${C.text}" font-weight="700">${esc(S.outlook)}</text>
    <text x="90" y="385" font-size="34" fill="${C.muted}">${esc(S.outlookSub)}</text>
    <text x="90" y="430" font-size="34" fill="${C.muted}">${esc(S.outlookSub2(market.value))}</text>
    <text x="640" y="520" font-size="32" fill="${C.muted}" text-anchor="middle">${esc(S.higher)}</text>
    <text x="900" y="520" font-size="32" fill="${C.muted}" text-anchor="middle">${esc(S.median)}</text>
    <line x1="90" y1="545" x2="990" y2="545" stroke="${C.line}" stroke-width="2"/>
    ${row(650, S.btcRow, S.btcHint, h.btc)}
    <line x1="90" y1="725" x2="990" y2="725" stroke="${C.line}" stroke-width="2"/>
    ${row(830, S.ethRow, S.ethHint, h.eth)}
    <line x1="90" y1="905" x2="990" y2="905" stroke="${C.line}" stroke-width="2"/>
    ${row(1010, S.altRow, S.altHint, h.alt)}
    <text x="90" y="1135" font-size="32" fill="${C.text}">${esc(S.coin)}</text>
    <text x="90" y="1180" font-size="30" fill="${C.muted}">${esc(S.tendency)}</text>`);
}

function slideMovers() {
  const line = (y, c) => {
    const p = c.price_change_percentage_24h_in_currency;
    const name = c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name;
    return `<text x="90" y="${y}" font-size="46" fill="${C.text}" font-weight="700">${esc(c.symbol.toUpperCase())}</text>
      <text x="330" y="${y}" font-size="34" fill="${C.muted}">${esc(name)}</text>
      <text x="990" y="${y}" font-size="46" fill="${p > 0 ? C.up : C.down}" text-anchor="end" font-weight="700">${esc(signed(p))}</text>`;
  };
  const block = (y, title, color, list) => `<text x="90" y="${y}" font-size="36" fill="${color}" font-weight="700">${esc(title)}</text>
    <line x1="90" y1="${y + 25}" x2="990" y2="${y + 25}" stroke="${C.line}" stroke-width="2"/>
    ${list.length ? list.map((c, i) => line(y + 105 + i * 80, c)).join('') : `<text x="90" y="${y + 105}" font-size="34" fill="${C.dim}">–</text>`}`;
  return frame(3, `
    <text x="90" y="330" font-size="72" fill="${C.text}" font-weight="700">${esc(S.movers)}</text>
    <text x="90" y="395" font-size="36" fill="${C.muted}">${esc(S.moversSub)}</text>
    ${block(470, `▲ ${S.gainers}`, C.up, gainers)}
    ${block(830, `▼ ${S.losers}`, C.down, losers)}`, `${S.obs} ${lang === 'de' ? 'Keine Anlageberatung.' : 'Not financial advice.'}`);
}

function slideOffer() {
  const bullets = S.bullets.map((b, i) => `<circle cx="112" cy="${528 + i * 80}" r="12" fill="${C.sun}"/>
    <text x="150" y="${540 + i * 80}" font-size="38" fill="${C.text}">${esc(b)}</text>`).join('');
  return frame(4, `
    <text x="90" y="350" font-size="72" fill="${C.text}" font-weight="700">${esc(S.ctaTitle)}</text>
    <line x1="90" y1="420" x2="990" y2="420" stroke="${C.line}" stroke-width="2"/>
    ${bullets}
    <rect x="90" y="870" width="900" height="200" rx="28" fill="${C.sun}"/>
    <text x="540" y="965" font-size="72" fill="${C.bg}" text-anchor="middle" font-weight="700">${esc(S.free)}</text>
    <text x="540" y="1030" font-size="36" fill="${C.bg}" text-anchor="middle">${esc(S.nopay)} · ${esc(S.bio)}</text>
    <text x="540" y="1150" font-size="34" fill="${C.muted}" text-anchor="middle">${esc(S.follow)}</text>`);
}

async function images() {
  return Promise.all([slideWeather(), slideOutlook(), slideMovers(), slideOffer()]
    .map((svg) => sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()));
}

// ---------- Reel: 15 Sekunden im Hochformat 9:16 aus den 4 Bildern ----------
// Reels zeigen Instagram und Facebook auch Leuten, die dem Konto (noch) nicht folgen – normale Beiträge kaum.
// Oben steht die Frage, die neugierig macht, unten der Aufruf zum Folgen. Gebaut mit ffmpeg (auf GitHub vorhanden).
const RW = 1080, RH = 1920, TOP = 285;
const RT = {
  en: { ask: evening ? ['Today’s biggest', 'crypto movers'] : ['Is now a good time', 'to buy crypto?'], follow: 'Follow for your daily crypto weather' },
  de: { ask: evening ? ['Die größten Krypto-', 'Bewegungen heute'] : ['Ist jetzt ein guter Zeitpunkt', 'für Krypto?'], follow: 'Folge für dein tägliches Krypto-Wetter' },
}[lang];
// Abends zuerst die Bewegungen, dann das Wetter, zum Schluss das Angebot
const reelJpgs = (jpgs) => (evening ? [jpgs[2], jpgs[0], jpgs[3]] : jpgs);
async function reelFrames(jpgs, withFollow = true, withHook = true) {
  const back = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${RH}" font-family="DejaVu Sans, Arial, sans-serif">
    <defs><radialGradient id="g" cx="0.2" cy="0.05" r="1.2"><stop offset="0" stop-color="#1b2433"/><stop offset="1" stop-color="${C.bg}"/></radialGradient></defs>
    <rect width="${RW}" height="${RH}" fill="url(#g)"/>
    ${withHook ? `<text x="540" y="140" font-size="64" fill="${C.text}" font-weight="700" text-anchor="middle">${esc(RT.ask[0])}</text>
    <text x="540" y="225" font-size="64" fill="${C.sun}" font-weight="700" text-anchor="middle">${esc(RT.ask[1])}</text>` : ''}
    ${withFollow ? `<text x="540" y="${TOP + HGT + 95}" font-size="40" fill="${C.text}" font-weight="700" text-anchor="middle">${esc(RT.follow)}</text>` : ''}
  </svg>`);
  return Promise.all(jpgs.map((jpg) => sharp(back).composite([{ input: jpg, top: TOP, left: 0 }]).jpeg({ quality: 92 }).toBuffer()));
}
// Je Bild 4 Sekunden (das letzte 3), mit halbsekündiger Überblendung, dazu eine stille Tonspur (manche Prüfungen verlangen Ton)
async function makeReel(jpgs, file) {
  const { execFile } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const dir = `${tmpdir()}/coinweather-reel`;
  await mkdir(dir, { recursive: true });
  const frames = await reelFrames(jpgs);
  await Promise.all(frames.map((f, i) => writeFile(`${dir}/f${i}.jpg`, f)));
  const show = frames.map((_, i) => (i === frames.length - 1 ? 3.5 : 4.5)), fade = 0.5;
  const inputs = frames.flatMap((_, i) => ['-loop', '1', '-t', String(show[i]), '-i', `${dir}/f${i}.jpg`]);
  let chain = '', last = '[0:v]', at = 0;
  for (let i = 1; i < frames.length; i++) {
    at += show[i - 1] - fade;
    chain += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${at.toFixed(2)}[v${i}];`;
    last = `[v${i}]`;
  }
  const total = show.reduce((a, b) => a + b, 0) - fade * (frames.length - 1);
  const argv = ['-y', ...inputs, '-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', `${chain}${last}format=yuv420p,fps=30[out]`, '-map', '[out]', '-map', `${frames.length}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart', file];
  await new Promise((ok, fail) => execFile(env.FFMPEG ?? 'ffmpeg', argv, { maxBuffer: 1 << 24 }, (err, _o, e) => (err ? fail(new Error(`ffmpeg: ${String(e).slice(-300)}`)) : ok())));
  return readFile(file);
}
// ---------- Reel mit KI-Sprecher: Piper (offene Sprach-KI, läuft im Ablauf ohne Konto) ----------
// PIPER_MODEL zeigt auf eine Piper-Stimme (.onnx). Gewählt: en_US-joe-medium (Datensatz CC0) bzw. de_DE-thorsten (CC0) –
// beide dürfen für Werbung genutzt werden. Die Bilder zoomen langsam, Untertitel laufen synchron zur Stimme.
// Fehlt die Stimme oder scheitert etwas, entsteht wie bisher das stille Reel (makeReel).
const SAY = {
  en: {
    sky: ['stormy', 'rainy', 'cloudy', 'partly cloudy', 'sunny'],
    mood: ['The market is falling hard and the mood is bad.', 'The market is weak and many investors are scared.', 'The market has no clear direction.', 'The market is friendly.', 'The market is strong and the mood is great.'],
    label: { 'Kaufen': 'buy', 'Eher kaufen': 'lean buy', 'Halten': 'hold', 'Eher verkaufen': 'lean sell', 'Verkaufen': 'sell' },
    open: (d) => `Your crypto weather for ${d}.`,
    sky2: (s, m) => `Today it is ${s}. ${m}`,
    score: (v, l) => `But here is the twist. The Coinweather buy score is ${v} out of 100. That means: ${l}.`,
    scoreFlat: (v, l) => `The Coinweather buy score is ${v} out of 100. That means: ${l}.`,
    rain: 'Rain is buying weather. When everyone is scared, Bitcoin is usually cheap.',
    sun: 'Sunshine is expensive. When everyone is greedy, the cycle is hot.',
    year: (b, e, a) => `Since 2022, after readings like this, Bitcoin was higher one year later in ${b} out of 100 cases. Ethereum in ${e}. The typical altcoin only in ${a}.`,
    end: 'Not financial advice. Follow for your daily crypto weather.',
    movers: 'Today’s biggest crypto movers.',
    up: (s, v) => `${s} up ${v} percent.`, down: (s, v) => `${s} down ${v} percent.`,
    locale: 'en-US',
  },
  de: {
    sky: ['stürmisch', 'regnerisch', 'bewölkt', 'heiter bis wolkig', 'sonnig'],
    mood: ['Der Markt fällt deutlich, die Stimmung ist schlecht.', 'Der Markt ist schwach, viele Anleger haben Angst.', 'Der Markt hat keine klare Richtung.', 'Der Markt ist freundlich.', 'Der Markt ist stark, die Stimmung ist bestens.'],
    label: { 'Kaufen': 'kaufen', 'Eher kaufen': 'eher kaufen', 'Halten': 'halten', 'Eher verkaufen': 'eher verkaufen', 'Verkaufen': 'verkaufen' },
    open: (d) => `Dein Krypto-Wetter für den ${d}.`,
    sky2: (s, m) => `Heute ist es ${s}. ${m}`,
    score: (v, l) => `Aber jetzt kommt’s: Der Kauf-Score von Coinweather steht bei ${v} von 100. Das heißt: ${l}.`,
    scoreFlat: (v, l) => `Der Kauf-Score von Coinweather steht bei ${v} von 100. Das heißt: ${l}.`,
    rain: 'Regen ist Kaufwetter. Wenn alle Angst haben, ist Bitcoin meist günstig.',
    sun: 'Sonne ist teuer. Wenn alle gierig sind, ist der Zyklus heiß.',
    year: (b, e, a) => `Seit 2022 stand Bitcoin nach solchen Ständen ein Jahr später in ${b} von 100 Fällen höher. Ethereum in ${e}. Der typische Altcoin nur in ${a}.`,
    end: 'Keine Anlageberatung. Folge uns für dein tägliches Krypto-Wetter.',
    movers: 'Die größten Krypto-Bewegungen heute.',
    up: (s, v) => `${s} plus ${v} Prozent.`, down: (s, v) => `${s} minus ${v} Prozent.`,
    locale: 'de-CH',
  },
}[lang];

// Sätze und das Bild, zu dem sie gehören (Index in reelJpgs)
function reelScript() {
  const day = new Date(snap.time).toLocaleDateString(SAY.locale, { day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
  const label = SAY.label[market.label] ?? market.label;
  const rain = market.buy && skyI <= 1 && market.value >= 62, sun = market.buy && skyI >= 3 && market.value < 45;
  if (evening) {
    const pctWord = (v) => Math.abs(v).toLocaleString(SAY.locale, { maximumFractionDigits: 0 });
    return [
      [0, SAY.movers],
      ...gainers.slice(0, 2).map((c) => [0, SAY.up(c.name, pctWord(c.price_change_percentage_24h_in_currency))]),
      ...losers.slice(0, 1).map((c) => [0, SAY.down(c.name, pctWord(c.price_change_percentage_24h_in_currency))]),
      [1, (rain || sun ? SAY.score : SAY.scoreFlat)(market.value, label)],
      ...(rain ? [[1, SAY.rain]] : sun ? [[1, SAY.sun]] : []),
      [2, SAY.end],
    ];
  }
  return [
    [0, SAY.open(day)],
    [0, SAY.sky2(SAY.sky[skyI], SAY.mood[skyI])],
    [0, (rain || sun ? SAY.score : SAY.scoreFlat)(market.value, label)],
    ...(rain ? [[0, SAY.rain]] : sun ? [[0, SAY.sun]] : []),
    ...(year ? [[1, SAY.year(year.btc.up, year.eth.up, year.alt.up)]] : []),
    [3, SAY.end],
  ];
}

// Ein Satz als WAV über Piper (python -m piper); liefert Dauer in Sekunden und PCM-Daten
async function speak(text, file) {
  const { spawn } = await import('node:child_process');
  await new Promise((ok, fail) => {
    const p = spawn(env.PYTHON ?? 'python', ['-m', 'piper', '-m', env.PIPER_MODEL, '-f', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`piper: ${err.slice(-300)}`))));
    p.stdin.end(text);
  });
  const buf = await readFile(file);
  const rate = buf.readUInt32LE(24), bytesPerSample = buf.readUInt16LE(34) / 8 * buf.readUInt16LE(22);
  let at = 12; while (at < buf.length - 8 && buf.toString('ascii', at, at + 4) !== 'data') at += 8 + buf.readUInt32LE(at + 4);
  const pcm = buf.subarray(at + 8, at + 8 + buf.readUInt32LE(at + 4));
  return { pcm, rate, bytesPerSample, seconds: pcm.length / bytesPerSample / rate, header: buf.subarray(0, at + 8) };
}

// Untertitel als Bild: weiße, fette Schrift auf halbdurchsichtigem Kasten, bis zu drei Zeilen
function captionPng(text) {
  const words = text.split(' '), lines = [];
  for (const w of words) { const last = lines[lines.length - 1]; if (last && (last + ' ' + w).length <= 30) lines[lines.length - 1] = last + ' ' + w; else lines.push(w); }
  const shown = lines.slice(0, 4), lh = 62, h = shown.length * lh + 50;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${h}" font-family="DejaVu Sans, Arial, sans-serif">
    <rect x="60" y="0" width="${RW - 120}" height="${h}" rx="28" fill="#000000" fill-opacity="0.55"/>
    ${shown.map((l, i) => `<text x="${RW / 2}" y="${55 + i * lh}" font-size="48" font-weight="700" fill="${i === 0 && /Rain|Regen|Sunshine|Sonne/.test(text) ? C.sun : '#ffffff'}" text-anchor="middle">${esc(l)}</text>`).join('')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function makeVoiceReel(jpgs, file) {
  const { execFile } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const dir = `${tmpdir()}/coinweather-voice`;
  await mkdir(dir, { recursive: true });
  const script = reelScript();
  // Stimme: Satz für Satz, mit kurzer Pause dazwischen
  const parts = [];
  for (let i = 0; i < script.length; i++) parts.push(await speak(script[i][1], `${dir}/s${i}.wav`));
  const { rate, bytesPerSample, header } = parts[0];
  const gap = Buffer.alloc(Math.round(rate * 0.3) * bytesPerSample), lead = Buffer.alloc(Math.round(rate * 0.4) * bytesPerSample);
  const times = []; let t = lead.length / bytesPerSample / rate;
  const chunks = [lead];
  for (const p of parts) { times.push([t, t + p.seconds]); chunks.push(p.pcm, gap); t += p.seconds + gap.length / bytesPerSample / rate; }
  const pcm = Buffer.concat(chunks), total = t + 0.6;
  const head = Buffer.from(header); head.writeUInt32LE(36 + pcm.length, 4); head.writeUInt32LE(pcm.length, head.length - 4);
  await writeFile(`${dir}/voice.wav`, Buffer.concat([head, pcm]));
  // Bilder: jedes so lange, wie über es gesprochen wird; langsamer Zoom, weiche Überblendung
  const frames = await reelFrames(jpgs, false, false);
  const used = [...new Set(script.map(([k]) => k))];
  const span = used.map((k, n) => {
    const idx = script.map(([kk], i) => (kk === k ? i : -1)).filter((i) => i >= 0);
    const start = n === 0 ? 0 : times[idx[0]][0] - 0.3, end = n === used.length - 1 ? total : times[script.findIndex(([kk]) => kk === used[n + 1])][0] - 0.3;
    return { k, start, end };
  });
  const fade = 0.5;
  await Promise.all(used.map((k, n) => writeFile(`${dir}/f${n}.jpg`, frames[k])));
  // Untertitel: jeder Satz in Häppchen von höchstens rund 55 Zeichen, Zeit nach Länge verteilt
  const cues = [];
  script.forEach(([, text], i) => {
    const bits = []; for (const w of text.split(' ')) { const l = bits[bits.length - 1]; if (l && (l + ' ' + w).length <= 55) bits[bits.length - 1] = l + ' ' + w; else bits.push(w); }
    const [a, b] = times[i], len = bits.reduce((x, y) => x + y.length, 0); let at = a;
    for (const bit of bits) { const d = (b - a) * bit.length / len; cues.push([at, at + d, bit]); at += d; }
  });
  const caps = await Promise.all(cues.map(([, , text]) => captionPng(text)));
  await Promise.all(caps.map((c, i) => writeFile(`${dir}/c${i}.png`, c)));
  // Die Frage oben bleibt fest stehen, nur die Grafik darunter zoomt
  const hook = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${TOP - 20}" font-family="DejaVu Sans, Arial, sans-serif">
    <defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg}"/><stop offset="0.85" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></linearGradient></defs>
    <rect width="${RW}" height="${TOP - 20}" fill="url(#h)"/>
    <text x="540" y="140" font-size="64" fill="${C.text}" font-weight="700" text-anchor="middle">${esc(RT.ask[0])}</text>
    <text x="540" y="225" font-size="64" fill="${C.sun}" font-weight="700" text-anchor="middle">${esc(RT.ask[1])}</text></svg>`)).png().toBuffer();
  await writeFile(`${dir}/hook.png`, hook);
  const inputs = [], filters = [];
  span.forEach((sp, n) => {
    const dur = sp.end - sp.start + (n < span.length - 1 ? fade : 0);
    const nf = Math.ceil(dur * 30);
    inputs.push('-i', `${dir}/f${n}.jpg`);
    filters.push(`[${n}:v]scale=1188:2112,zoompan=z='min(1+0.0009*on,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${nf}:s=${RW}x${RH}:fps=30,trim=duration=${dur.toFixed(2)},setsar=1[z${n}]`);
  });
  let last = '[z0]', at = 0;
  for (let n = 1; n < span.length; n++) {
    at = span[n].start;
    filters.push(`${last}[z${n}]xfade=transition=smoothup:duration=${fade}:offset=${(at).toFixed(2)}[x${n}]`);
    last = `[x${n}]`;
  }
  const capBase = span.length;
  caps.forEach((_, i) => inputs.push('-i', `${dir}/c${i}.png`));
  cues.forEach(([a, b], i) => {
    filters.push(`${last}[${capBase + i}:v]overlay=x=0:y=${RH - 300}:enable='between(t,${a.toFixed(2)},${(b + 0.05).toFixed(2)})'[o${i}]`);
    last = `[o${i}]`;
  });
  const hookIn = capBase + caps.length;
  inputs.push('-i', `${dir}/hook.png`);
  filters.push(`${last}[${hookIn}:v]overlay=x=0:y=0[hk]`, '[hk]format=yuv420p[out]');
  const voiceIn = hookIn + 1;
  inputs.push('-i', `${dir}/voice.wav`);
  const argv = ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-map', `${voiceIn}:a`,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad', '-ar', '48000', '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', '+faststart', file];
  await new Promise((ok, fail) => execFile(env.FFMPEG ?? 'ffmpeg', argv, { maxBuffer: 1 << 25 }, (err, _o, e) => (err ? fail(new Error(`ffmpeg: ${String(e).slice(-600)}`)) : ok())));
  console.log(`Reel mit KI-Stimme: ${total.toFixed(1)} s, ${script.length} Sätze`);
  return readFile(file);
}
const buildReel = async (jpgs, file) => {
  if (env.PIPER_MODEL) {
    try { return await makeVoiceReel(jpgs, file); } catch (err) { console.warn(`Reel mit Stimme gescheitert, stilles Reel: ${err.message}`); }
  }
  return makeReel(jpgs, file);
};
let reelReady;
// Der Ablauf baut das Reel schon im Bild-Schritt (REEL_FILE) – dann wird es nur noch gelesen
const reel = (jpgs) => (reelReady ??= readFile(env.REEL_FILE ?? 'reel.mp4').catch(() => buildReel(reelJpgs(jpgs), env.REEL_FILE ?? 'reel.mp4')));

// Hochladen direkt zu Meta (rupload): Instagram und Facebook brauchen dafür keine öffentliche Adresse
async function rupload(url, token, data) {
  const r = await fetch(url, { method: 'POST', headers: { authorization: `OAuth ${token}`, offset: '0', file_size: String(data.length) }, body: data });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false || body.error || body.debug_info) throw new Error(`Hochladen: ${body.error?.message ?? body.debug_info?.message ?? `HTTP ${r.status}`}`);
}

async function instagramReel(jpgs) {
  const video = await reel(jpgs);
  const meta = await metaToken();
  const ig = env.INSTAGRAM_USER_ID;
  const call = async (token, step, path, params, method = 'GET') => {
    const r = await (await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`, { method })).json();
    if (r.error) throw new Error(`${step}: ${r.error.error_user_msg ?? r.error.message} (Code ${r.error.code}${r.error.error_subcode ? `/${r.error.error_subcode}` : ''})`);
    return r;
  };
  const params = { media_type: 'REELS', caption: text.instagramReel, share_to_feed: 'true' };
  // Wege der Reihe nach: das Video von der öffentlichen Adresse holen lassen, die der Ablauf im Zweig "media" bereitstellt
  // (bewährt), sonst direkt hochladen
  const ways = [];
  for (const token of [...new Set([env.FACEBOOK_PAGE_TOKEN, meta.token])]) {
    ways.push(['Hochladen', token, async () => {
      const made = await call(token, 'Anlegen', `${ig}/media`, { ...params, upload_type: 'resumable' }, 'POST');
      await rupload(made.uri ?? `https://rupload.facebook.com/ig-api-upload/v21.0/${made.id}`, token, video);
      return made.id;
    }]);
  }
  if (env.REEL_URL) ways.unshift(['Adresse', meta.token, async () => (await call(meta.token, 'Anlegen', `${ig}/media`, { ...params, video_url: env.REEL_URL }, 'POST')).id]);
  const errors = [];
  for (const [way, token, create] of ways) {
    try {
      const id = await create();
      // Videos verarbeitet Instagram länger als Bilder – bis zu 5 Minuten warten
      for (let i = 0; ; i++) {
        const s = await call(token, 'Verarbeiten', id, { fields: 'status_code,status' });
        if (s.status_code === 'FINISHED') break;
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Verarbeiten: ${s.status ?? s.status_code}`);
        if (i >= 60) throw new Error('Verarbeiten: nach 5 Minuten nicht fertig');
        await sleep(5000);
      }
      const done = await call(token, 'Veröffentlichen', `${ig}/media_publish`, { creation_id: id }, 'POST');
      const link = (await call(token, 'Kontrolle', done.id, { fields: 'permalink' }).catch(() => ({}))).permalink;
      if (!link) throw new Error('Kontrolle: Reel nach dem Veröffentlichen nicht auffindbar');
      return `online: ${link} (${way}${errors.length ? ` – vorher: ${errors.join(' / ')}` : ''})`;
    } catch (err) { errors.push(`${way}: ${err.message}`); }
  }
  throw new Error(errors.join(' / '));
}

async function facebookReel(jpgs) {
  const video = await reel(jpgs);
  const { token } = await metaToken();
  const page = env.FACEBOOK_PAGE_ID;
  const call = async (step, params) => {
    const r = await (await fetch(`${GRAPH}/${page}/video_reels?${new URLSearchParams({ ...params, access_token: token })}`, { method: 'POST' })).json();
    if (r.error) throw new Error(`${step}: ${r.error.error_user_msg ?? r.error.message} (Code ${r.error.code})`);
    return r;
  };
  const start = await call('Anlegen', { upload_phase: 'start' });
  await rupload(start.upload_url ?? `https://rupload.facebook.com/video-upload/v21.0/${start.video_id}`, token, video);
  await call('Veröffentlichen', { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: text.facebookReel });
  // Facebook bestätigt das Veröffentlichen sofort, verarbeitet das Video aber erst danach – erst „fertig“ zählt
  for (let i = 0; ; i++) {
    const v = await (await fetch(`${GRAPH}/${start.video_id}?${new URLSearchParams({ fields: 'status,permalink_url', access_token: token })}`)).json();
    const st = v.status ?? {};
    if (st.video_status === 'error' || st.processing_phase?.status === 'error' || st.publishing_phase?.status === 'error') {
      throw new Error(`Verarbeiten: ${st.processing_phase?.error?.message ?? st.publishing_phase?.errors?.[0]?.message ?? 'von Facebook abgelehnt'}`);
    }
    if (st.video_status === 'ready' && st.publishing_phase?.status === 'complete') return `online: https://www.facebook.com${v.permalink_url ?? `/reel/${start.video_id}`}`;
    if (i >= 60) throw new Error(`nach 5 Minuten nicht online (Video ${st.video_status ?? '?'}, Veröffentlichung ${st.publishing_phase?.status ?? '?'})`);
    await sleep(5000);
  }
}

// ---------- Kanäle ----------
async function telegram(jpgs) {
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('caption', text.telegram);
  form.append('parse_mode', 'HTML');
  form.append('photo', new Blob([jpgs[0]], { type: 'image/jpeg' }), 'coinweather.jpg');
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
  const r = await fetch(url, { method: 'POST', headers: { authorization: header, 'content-type': 'application/json' }, body: JSON.stringify({ text: text.x, poll: { options: XT.poll, duration_minutes: 1440 } }) });
  // Ohne Guthaben im X-Entwicklerkonto lehnt X jeden Beitrag ab – das ist kein Fehler der Seite und soll den Ablauf nicht rot färben
  if (r.status === 402) return 'kein Guthaben im X-Entwicklerkonto – nicht gepostet';
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function bluesky(jpgs) {
  const api = 'https://bsky.social/xrpc';
  const session = await (await fetch(`${api}/com.atproto.server.createSession`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }) })).json();
  if (!session.accessJwt) throw new Error(session.message ?? 'Anmeldung abgelehnt');
  const auth = { authorization: `Bearer ${session.accessJwt}` };
  // Bluesky zeigt bis zu 4 Bilder pro Beitrag
  const blobs = [];
  for (const jpg of jpgs.slice(0, 4)) {
    const b = await (await fetch(`${api}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg' }, body: jpg })).json();
    if (b.blob) blobs.push({ alt: T.alt, image: b.blob, aspectRatio: { width: W, height: HGT } });
  }
  // Links sind bei Bluesky eigene Markierungen mit Byte-Positionen im Text
  const bytes = Buffer.from(text.bluesky), target = link('bluesky'), start = bytes.indexOf(Buffer.from(target));
  const record = { $type: 'app.bsky.feed.post', text: text.bluesky, createdAt: new Date().toISOString(), langs: [lang],
    facets: start < 0 ? [] : [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength(target) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: target }] }],
    ...(blobs.length ? { embed: { $type: 'app.bsky.embed.images', images: blobs } } : {}) };
  const r = await fetch(`${api}/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
}

// Facebook: alle Bilder unveröffentlicht hochladen, dann als ein Beitrag (Album) mit Text veröffentlichen.
// Klappt das Album nicht, kommt wenigstens das Hauptbild mit Text – so fällt kein Tag aus.
async function facebook(jpgs) {
  const { token } = await metaToken();
  const upload = async (jpg, extra) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ access_token: token, ...extra })) form.append(k, v);
    form.append('source', new Blob([jpg], { type: 'image/jpeg' }), 'coinweather.jpg');
    const r = await (await fetch(`${GRAPH}/${env.FACEBOOK_PAGE_ID}/photos`, { method: 'POST', body: form })).json();
    if (!r.id) throw new Error(r.error?.message ?? 'abgelehnt');
    return r.id;
  };
  let album;
  try {
    const ids = [];
    for (const jpg of jpgs) ids.push(await upload(jpg, { published: 'false' }));
    const form = new URLSearchParams({ message: text.facebook, access_token: token });
    ids.forEach((id, i) => form.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    album = await (await fetch(`${GRAPH}/${env.FACEBOOK_PAGE_ID}/feed`, { method: 'POST', body: form })).json();
    if (album.id) {
      const post = await (await fetch(`${GRAPH}/${album.id}?${new URLSearchParams({ fields: 'permalink_url,is_published', access_token: token })}`)).json();
      if (post.is_published === false) throw new Error('Kontrolle: Album angelegt, aber nicht veröffentlicht');
      return `online: ${post.permalink_url ?? `https://www.facebook.com/${album.id}`} (${ids.length} Bilder)`;
    }
  } catch (err) {
    // Ein abgelaufener Token betrifft auch das Einzelbild – dann gleich mit der eigentlichen Meldung abbrechen
    if (/access token|session/i.test(err.message)) throw err;
    album = { error: { message: err.message } };
  }
  await upload(jpgs[0], { caption: text.facebook });
  return `gepostet (nur Hauptbild – Album abgelehnt: ${album?.error?.message ?? 'unbekannt'})`;
}

// Instagram holt die Bilder selbst von öffentlichen Adressen (IMAGE_BASE + 1.jpg … 4.jpg, vom Ablauf bereitgestellt)
// und zeigt sie als Karussell. Ohne IMAGE_BASE, aber mit IMAGE_URL, kommt nur das Hauptbild.
// Instagram meldet ab und zu vorübergehende Fehler („An unknown error has occurred“) oder braucht für die Bilder länger.
// Darum: jeder Schritt mit Wiederholung, Warten bis zu 5 Minuten, vor einem zweiten Veröffentlichen prüfen, ob der Beitrag
// schon da ist (sonst gäbe es ihn doppelt), und falls das Karussell gar nicht geht, wenigstens das Hauptbild.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function instagram() {
  const urls = env.IMAGE_BASE ? Array.from({ length: SLIDES }, (_, i) => `${env.IMAGE_BASE}${i + 1}.jpg`) : env.IMAGE_URL ? [env.IMAGE_URL] : [];
  if (!urls.length) throw new Error('Keine öffentliche Bildadresse (IMAGE_BASE)');
  const { token } = await metaToken();
  const ig = env.INSTAGRAM_USER_ID, started = Date.now();
  const call = async (step, path, params, method = 'GET') => {
    const r = await (await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`, { method })).json();
    if (r.error) {
      const e = r.error;
      const err = new Error(`${step}: ${e.error_user_msg ?? e.message} (Code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})`);
      err.transient = e.is_transient || [1, 2, 4, 17, 32, 341, -1, -2].includes(e.code);
      throw err;
    }
    return r;
  };
  const retry = async (fn, tries = 3) => {
    for (let i = 1; ; i++) {
      try { return await fn(); } catch (err) {
        if (!err.transient || i >= tries) throw err;
        console.log(`Instagram: ${err.message} – neuer Versuch in ${15 * i} s`);
        await sleep(15_000 * i);
      }
    }
  };
  const create = (step, p) => retry(async () => (await call(step, `${ig}/media`, p, 'POST')).id);
  // Instagram verarbeitet jedes Bild erst, bevor es weiterverwendet werden kann
  const ready = async (step, id) => {
    for (let i = 0; i < 60; i++) {
      const s = await retry(() => call(step, id, { fields: 'status_code,status' }));
      if (s.status_code === 'FINISHED') return;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`${step}: Instagram konnte es nicht verarbeiten (${s.status ?? s.status_code})`);
      await sleep(5000);
    }
    throw new Error(`${step}: nach 5 Minuten noch nicht verarbeitet`);
  };
  const latest = async () => (await call('Kontrolle', `${ig}/media`, { fields: 'timestamp,permalink', limit: '1' })).data?.[0];
  // Nach dem Veröffentlichen nachsehen, ob der Beitrag wirklich im Profil steht
  const online = async (what) => {
    const last = await latest();
    if (!last || Date.parse(last.timestamp) < started - 60_000) throw new Error('Kontrolle: Beitrag nach dem Veröffentlichen nicht im Profil');
    return `online: ${last.permalink} (${what})`;
  };
  const publish = (id) => retry(async () => {
    try { await call('Veröffentlichen', `${ig}/media_publish`, { creation_id: id }, 'POST'); }
    catch (err) {
      // Manchmal meldet Instagram einen Fehler, obwohl der Beitrag erschienen ist
      await sleep(10_000);
      const last = await latest().catch(() => null);
      if (last && Date.parse(last.timestamp) >= started - 60_000) return;
      throw err;
    }
  });
  const single = async () => {
    const id = await create('Hauptbild', { image_url: urls[0], caption: text.instagram });
    await ready('Hauptbild', id);
    await publish(id);
  };
  if (urls.length === 1) { await single(); return online('Bild'); }
  try {
    const children = [];
    for (const [i, url] of urls.entries()) children.push(await create(`Bild ${i + 1}`, { image_url: url, is_carousel_item: 'true' }));
    for (const [i, id] of children.entries()) await ready(`Bild ${i + 1}`, id);
    const post = await create('Karussell', { media_type: 'CAROUSEL', children: children.join(','), caption: text.instagram });
    await ready('Karussell', post);
    await publish(post);
    return await online(`Karussell mit ${urls.length} Bildern`);
  } catch (err) {
    // Ist der Beitrag trotz Fehler erschienen, nicht noch einmal posten
    const last = await latest().catch(() => null);
    if (last && Date.parse(last.timestamp) >= started - 60_000) return `online: ${last.permalink} (Meldung unterwegs: ${err.message})`;
    console.log(`Instagram: Karussell ging nicht (${err.message}) – versuche das Hauptbild allein`);
    await single();
    return online('nur Hauptbild');
  }
}

const CHANNELS = [
  ['Telegram', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], telegram],
  ['X', ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'], x],
  ['Bluesky', ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'], bluesky],
  ['Facebook', ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'], facebook],
  ['Instagram', ['INSTAGRAM_USER_ID', 'FACEBOOK_PAGE_TOKEN'], instagram],
  ['Instagram-Reel', ['INSTAGRAM_USER_ID', 'FACEBOOK_PAGE_TOKEN'], instagramReel],
  ['Facebook-Reel', ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'], facebookReel],
];

const jpgs = await images();
if (arg('--images')) {
  await mkdir(arg('--images'), { recursive: true });
  await Promise.all(jpgs.map((jpg, i) => writeFile(`${arg('--images')}/slide-${i + 1}.jpg`, jpg)));
  if (args.includes('--frames')) await Promise.all((await reelFrames(reelJpgs(jpgs))).map((f, i) => writeFile(`${arg('--images')}/reel-${i + 1}.jpg`, f)));
}
// --video <datei>: nur das Reel bauen (zum Prüfen)
if (arg('--video')) { await buildReel(reelJpgs(jpgs), arg('--video')); console.log(`Reel: ${arg('--video')}`); }
if (args.includes('--show')) for (const [k, t] of Object.entries(text)) console.log(`--- ${k} (${[...t].length} Zeichen)\n${t}\n`);

// --dry: nur die Bilder erzeugen (der Ablauf stellt sie danach öffentlich bereit, bevor gepostet wird)
if (args.includes('--dry')) process.exit(0);

let failed = 0, active = 0;
// Rechtzeitig erinnern, bevor ein hinterlegter Benutzer-Token abläuft (Seiten-Token laufen nicht ab)
if (env.FACEBOOK_PAGE_TOKEN && env.FACEBOOK_PAGE_ID) {
  const { derived, info } = await metaToken();
  if (derived && info?.expires_at && info.expires_at * 1000 - Date.now() < 14 * 86_400_000) {
    console.log(`Hinweis: Der Facebook-Token läuft am ${when(info.expires_at)} ab – bitte neu erzeugen (SOCIAL-MEDIA.md).`);
  }
}
for (const [name, keys, send] of CHANNELS) {
  // Von Hand gestartet, kann der Ablauf auf einzelne Kanäle beschränkt werden (Eingabe „only“, z. B. „Facebook“)
  if (env.ONLY && !env.ONLY.toLowerCase().split(/[ ,]+/).includes(name.toLowerCase())) { console.log(`${name}: diesmal nicht gewählt`); continue; }
  if (!keys.every((k) => env[k])) { console.log(`${name}: nicht eingerichtet – übersprungen`); continue; }
  active++;
  try { const note = await send(jpgs); console.log(`${name}: ${note ?? 'gepostet'}`); }
  catch (err) {
    failed++;
    const expired = /session has expired|access token/i.test(err.message);
    console.error(`${name}: FEHLER – ${err.message}${expired ? ' → Seiten-Token abgelaufen: neuen, unbefristeten Token erzeugen (SOCIAL-MEDIA.md, Facebook-Seite)' : ''}`);
  }
}
if (!active) console.log('Noch kein Kanal eingerichtet. Die Schritte stehen in SOCIAL-MEDIA.md.');
// Ein fehlgeschlagener Kanal hält die anderen nicht auf; der Ablauf meldet den Fehler aber, damit er auffällt
if (failed) process.exitCode = 1;
