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
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)} %`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = new Date(snap.time).toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const link = (channel) => `${SITE}?von=${channel}`;
const daily = Math.floor(snap.time / 86_400_000);   // wechselt täglich: Aufhänger und Frage

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
const hook = fng && Number.isFinite(fng.week) && Math.abs(fng.value - fng.week) >= 8 ? H.mood(fng.week, fng.value)
  : Math.abs(btcDay) >= 3 ? H.btc(btcDay) : H.plain[daily % H.plain.length];
const ask = H.ask[daily % H.ask.length];
// X erlaubt 280 Zeichen (Links zählen 23, Emojis doppelt), Bluesky 300 – notfalls entfällt die Frage, dann die Hashtags
const fngShort = fng ? `${T.fng}: ${fng.value} – ${mood(fng.value)}` : null;
// noLink: X verlangt für Beiträge mit Link ein Vielfaches – dort steht der Link im Profil
const short = (channel, limit, noLink = false) => {
  const nfa = lang === 'de' ? 'Keine Anlageberatung.' : 'Not financial advice.';
  const make = (withAsk, withTags) => [`${R.icon} ${hook}`, '', R.index, fngShort, R.btc, ...(withAsk ? ['', ask] : []), '',
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
  en: { index: 'Market index', fng: 'Fear & Greed', week: 'last week', top: 'Top gainer', vote: 'Your move today? Vote 👇',
    foot: 'Full picture: link in bio · Not financial advice', poll: ['🟢 Buying', '🟡 Holding', '🔴 Selling', '👀 Just watching'] },
  de: { index: 'Markt-Index', fng: 'Fear & Greed', week: 'letzte Woche', top: 'Top-Gewinner', vote: 'Was machst du heute? Stimm ab 👇',
    foot: 'Alles im Detail: Link im Profil · Keine Anlageberatung', poll: ['🟢 Ich kaufe', '🟡 Ich halte', '🔴 Ich verkaufe', '👀 Ich schaue zu'] },
}[lang];
const moodIcon = (v) => (v < 25 ? '😱' : v < 45 ? '😨' : v <= 55 ? '😐' : v <= 75 ? '😏' : '🔥');
const bar = (v) => '▰'.repeat(Math.round(v / 10)) + '▱'.repeat(10 - Math.round(v / 10));
const fngLine = (shortWeek) => fng ? `${moodIcon(fng.value)} ${XT.fng}: ${fng.value} (${mood(fng.value)})${Number.isFinite(fng.week) && fng.week !== fng.value && !hook.includes('→') ? ` · ${shortWeek} ${fng.week}` : ''}` : null;
const btcLine = btc ? `₿ Bitcoin: $${fmt(btc.current_price)} (${signed(btc.price_change_percentage_24h_in_currency ?? 0)})` : null;
function richX() {
  const parts = (withBar, withTop, withTags) => [
    `${R.icon} ${hook}`, '',
    `📊 ${XT.index}: ${market.value}/100 · ${R.label}`,
    withBar ? bar(market.value) : null,
    fngLine(XT.week),
    btcLine,
    withTop && gainer ? `🚀 ${XT.top}: ${gainer.symbol.toUpperCase()} ${signed(gainer.price_change_percentage_24h_in_currency)}` : null,
    '', XT.vote, XT.foot, withTags ? H.tagsShort : null,
  ].filter((l) => l !== null).join('\n');
  return [parts(true, true, true), parts(true, true, false), parts(false, true, false), parts(false, false, false)].find((t) => xLength(t) <= 280) ?? parts(false, false, false);
}

// ---------- Facebook und Instagram: ausführlich, mit Einordnung, Abstimmung per Kommentar und klarem Angebot ----------
// Länge kostet dort nichts. Die Einordnung nennt eine Häufigkeit aus den Tests seit 2018 – ausdrücklich keine Zusage.
const M = {
  en: {
    top: 'Top gainer (top 100)', flop: 'Biggest drop (top 100)', cycle: 'Cycle', signals: (n, of) => `Buy signals: ${n} of ${of} coins`,
    odds: (up, days) => `📈 After comparable market days since 2018, Bitcoin was higher ${days} days later in ${up} of 100 cases – a tendency, not a promise.`,
    more: { facebook: '📸 More in the photos: the outlook and today’s top movers.', instagram: '👉 Swipe for the outlook and today’s top movers.' },
    vote: 'Comment your move: 🟢 buying · 🟡 holding · 🔴 selling',
    offer: '✅ Signals for 1,000 coins, portfolio check and an open track record of every call – 30 days free, no payment details needed',
    save: '💾 Save this post and share it with a friend who checks the charts every morning.',
    follow: { facebook: '🔔 Follow the page for your crypto weather every morning.', instagram: '🔔 Follow for your crypto weather every morning.' },
  },
  de: {
    top: 'Top-Gewinner (Top 100)', flop: 'Größter Verlierer (Top 100)', cycle: 'Zyklus', signals: (n, of) => `Kaufsignale: ${n} von ${of} Coins`,
    odds: (up, days) => `📈 Nach vergleichbaren Markttagen seit 2018 stand Bitcoin ${days} Tage später in ${up} von 100 Fällen höher – eine Tendenz, kein Versprechen.`,
    more: { facebook: '📸 Mehr auf den Bildern: die Aussicht und die größten Bewegungen des Tages.', instagram: '👉 Wischen für die Aussicht und die größten Bewegungen des Tages.' },
    vote: 'Schreib in die Kommentare: 🟢 ich kaufe · 🟡 ich halte · 🔴 ich verkaufe',
    offer: '✅ Signale für 1000 Coins, Portfolio-Check und eine offene Erfolgskontrolle jedes Signals – 30 Tage kostenlos, ohne Zahlungsdaten',
    save: '💾 Speichere den Beitrag und teile ihn mit jemandem, der jeden Morgen die Charts checkt.',
    follow: { facebook: '🔔 Folge der Seite für dein Krypto-Wetter jeden Morgen.', instagram: '🔔 Folge uns für dein Krypto-Wetter jeden Morgen.' },
  },
}[lang];
const odds = fc?.btc?.short && Number.isFinite(fc.btc.short.up) ? M.odds(fc.btc.short.up, fc.btc.short.days) : null;
function rich(channel) {
  const loser = losers[0];
  return [
    `${R.icon} ${hook}`, `🗓️ ${T.title} · ${day}`, '',
    `📊 ${XT.index}: ${market.value}/100 · ${R.label}`,
    bar(market.value),
    fngLine(XT.week),
    btcLine,
    market.cycle ? `🔁 ${M.cycle}: ${T.zone[market.cycle.zone] ?? market.cycle.label}` : null,
    `🎯 ${M.signals(buys, rated)}`,
    gainer ? `🚀 ${M.top}: ${gainer.symbol.toUpperCase()} ${signed(gainer.price_change_percentage_24h_in_currency)}` : null,
    loser ? `🧊 ${M.flop}: ${loser.symbol.toUpperCase()} ${signed(loser.price_change_percentage_24h_in_currency)}` : null,
    ...(odds ? ['', odds] : []),
    '', M.more[channel],
    '', ask, M.vote,
    '', channel === 'facebook' ? `${M.offer}:\n👉 ${link('facebook')}` : `${M.offer} 🔗 ${T.bio}`,
    '', ...(channel === 'instagram' ? [M.save] : []), M.follow[channel],
    '', T.note,
    channel === 'facebook' ? H.tagsFb : H.tagsIg,
  ].filter((l) => l !== null).join('\n');
}

const text = {
  telegram: [`${R.icon} <b>${T.title} – ${esc(day)}</b>`, `<i>${esc(hook)}</i>`, '', ...body.map(esc), '', `<i>${T.note}</i>`, `👉 <a href="${link('telegram')}">${T.cta}</a>`].join('\n'),
  x: richX(),
  bluesky: short('bluesky', 300),
  facebook: rich('facebook'),
  instagram: rich('instagram'),
};

// ---------- Bilder 1080 × 1350 (Hochformat 4:5 – nimmt im Feed am meisten Platz ein) ----------
// 1 Wetterbericht · 2 Aussicht · 3 größte Bewegungen · 4 Angebot. Instagram zeigt sie als Karussell, Facebook als Album.
const S = {
  en: {
    outlook: 'Outlook', outlookSub: 'How often was the price higher after', outlookSub2: 'comparable market days since 2018?',
    days: (n) => `${n} days`, btcRow: 'Bitcoin', altRow: 'Average coin', btcHint: 'the market leader', altHint: 'a typical altcoin',
    coin: '50 % = coin flip. Above 50: more often up than down.', tendency: 'A tendency from past data – not a guarantee.',
    movers: 'Top movers · 24h', moversSub: 'The 100 largest coins by market cap', gainers: 'Gainers', losers: 'Losers',
    obs: 'Observations, not recommendations.', signals: 'Buy signals', signalsVal: (n, of) => `${n} of ${of} coins`,
    ctaTitle: 'Want the full picture?', bullets: ['Signals for 1,000 coins', 'Outlook for 7 days, 30 days and 12 months',
      'Portfolio check with a reserve target', 'Open track record – including the bad calls'],
    free: '30 days free', nopay: 'No payment details needed', bio: 'Link in bio', follow: 'Follow for your crypto weather every morning',
  },
  de: {
    outlook: 'Aussicht', outlookSub: 'Wie oft stand der Kurs höher nach', outlookSub2: 'vergleichbaren Markttagen seit 2018?',
    days: (n) => `${n} Tage`, btcRow: 'Bitcoin', altRow: 'Mittlerer Coin', btcHint: 'die Leitwährung', altHint: 'ein typischer Altcoin',
    coin: '50 % = Münzwurf. Über 50: öfter rauf als runter.', tendency: 'Eine Tendenz aus vergangenen Daten – keine Garantie.',
    movers: 'Größte Bewegungen · 24 h', moversSub: 'Die 100 größten Coins nach Marktwert', gainers: 'Gewinner', losers: 'Verlierer',
    obs: 'Beobachtungen, keine Empfehlungen.', signals: 'Kaufsignale', signalsVal: (n, of) => `${n} von ${of} Coins`,
    ctaTitle: 'Alles im Detail?', bullets: ['Signale für 1000 Coins', 'Aussicht für 7 Tage, 30 Tage und 12 Monate',
      'Portfolio-Check mit Reserve-Ziel', 'Offene Erfolgskontrolle – auch die Fehlgriffe'],
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
  const accent = v < 45 ? C.rain : v < 55 ? C.muted : C.sun;
  const sky = v < 30 ? 'storm' : v < 45 ? 'rain' : v < 55 ? 'cloud' : v < 70 ? 'partly' : 'sun';
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
    ${fng ? row(880, T.fng, `${fng.value} – ${mood(fng.value)}`) : ''}
    ${btc ? row(955, T.btc, `$${fmt(btc.current_price)} (${signed(b24)})`, b24 > 0 ? C.up : b24 < 0 ? C.down : C.text) : ''}
    ${market.cycle ? row(1030, T.cycle, T.zone[market.cycle.zone] ?? market.cycle.label) : ''}
    ${row(1105, S.signals, S.signalsVal(buys, rated))}`);
}

function slideOutlook() {
  const cell = (x, y, s) => {
    if (!s || !Number.isFinite(s.up)) return `<text x="${x}" y="${y}" font-size="80" fill="${C.dim}" text-anchor="middle" font-weight="700">–</text>`;
    return `<text x="${x}" y="${y}" font-size="88" fill="${upColor(s.up)}" text-anchor="middle" font-weight="700">${s.up}<tspan font-size="44"> %</tspan></text>
      ${gaugeBar(x - 120, y + 30, 240, 16, s.up, upColor(s.up))}`;
  };
  const row = (y, label, hint, f) => `<text x="90" y="${y - 20}" font-size="44" fill="${C.text}" font-weight="700">${esc(label)}</text>
    <text x="90" y="${y + 28}" font-size="30" fill="${C.muted}">${esc(hint)}</text>${cell(590, y + 10, f?.short)}${cell(860, y + 10, f?.medium)}`;
  return frame(2, `
    <text x="90" y="330" font-size="72" fill="${C.text}" font-weight="700">${esc(S.outlook)}</text>
    <text x="90" y="395" font-size="36" fill="${C.muted}">${esc(S.outlookSub)}</text>
    <text x="90" y="442" font-size="36" fill="${C.muted}">${esc(S.outlookSub2)}</text>
    <text x="590" y="545" font-size="34" fill="${C.muted}" text-anchor="middle">${esc(S.days(fc?.btc?.short?.days ?? 7))}</text>
    <text x="860" y="545" font-size="34" fill="${C.muted}" text-anchor="middle">${esc(S.days(fc?.btc?.medium?.days ?? 30))}</text>
    <line x1="90" y1="575" x2="990" y2="575" stroke="${C.line}" stroke-width="2"/>
    ${row(690, S.btcRow, S.btcHint, fc?.btc)}
    <line x1="90" y1="790" x2="990" y2="790" stroke="${C.line}" stroke-width="2"/>
    ${row(905, S.altRow, S.altHint, fc?.alt)}
    <line x1="90" y1="1005" x2="990" y2="1005" stroke="${C.line}" stroke-width="2"/>
    <text x="90" y="1075" font-size="32" fill="${C.text}">${esc(S.coin)}</text>
    <text x="90" y="1125" font-size="32" fill="${C.muted}">${esc(S.tendency)}</text>`);
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
    if (album.id) return `gepostet (${ids.length} Bilder)`;
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
  const latest = async () => (await call('Kontrolle', `${ig}/media`, { fields: 'timestamp', limit: '1' })).data?.[0];
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
  if (urls.length === 1) { await single(); return 'gepostet'; }
  try {
    const children = [];
    for (const [i, url] of urls.entries()) children.push(await create(`Bild ${i + 1}`, { image_url: url, is_carousel_item: 'true' }));
    for (const [i, id] of children.entries()) await ready(`Bild ${i + 1}`, id);
    const post = await create('Karussell', { media_type: 'CAROUSEL', children: children.join(','), caption: text.instagram });
    await ready('Karussell', post);
    await publish(post);
    return `gepostet (Karussell mit ${urls.length} Bildern)`;
  } catch (err) {
    // Ist der Beitrag trotz Fehler erschienen, nicht noch einmal posten
    const last = await latest().catch(() => null);
    if (last && Date.parse(last.timestamp) >= started - 60_000) return `gepostet (Meldung unterwegs: ${err.message})`;
    console.log(`Instagram: Karussell ging nicht (${err.message}) – versuche das Hauptbild allein`);
    await single();
    return 'gepostet (nur Hauptbild)';
  }
}

const CHANNELS = [
  ['Telegram', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], telegram],
  ['X', ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'], x],
  ['Bluesky', ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'], bluesky],
  ['Facebook', ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'], facebook],
  ['Instagram', ['INSTAGRAM_USER_ID', 'FACEBOOK_PAGE_TOKEN'], instagram],
];

const jpgs = await images();
if (arg('--images')) {
  await mkdir(arg('--images'), { recursive: true });
  await Promise.all(jpgs.map((jpg, i) => writeFile(`${arg('--images')}/slide-${i + 1}.jpg`, jpg)));
}
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
