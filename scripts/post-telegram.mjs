// Schickt einmal am Tag den „Wetterbericht“ des Kryptomarkts in einen Telegram-Kanal.
// Läuft über GitHub Actions (.github/workflows/telegram.yml). Braucht zwei Geheimnisse im Repository:
//   TELEGRAM_BOT_TOKEN – Schlüssel des Bots von @BotFather
//   TELEGRAM_CHAT_ID   – Kanal, z. B. @coinweather_daily (der Bot muss dort Administrator sein)
// Optional: TELEGRAM_LANG = en (Standard) oder de.
// Ohne Schlüssel wird der Beitrag nur angezeigt und nicht verschickt.
//
// Aufruf: node scripts/post-telegram.mjs

const SNAPSHOT = 'https://raw.githubusercontent.com/Coinweather/coinweather.github.io/data/snapshot.json';
const SITE = 'https://coinweather.github.io/?von=telegram';
const lang = process.env.TELEGRAM_LANG === 'de' ? 'de' : 'en';

const res = await fetch(`${SNAPSHOT}?t=${Date.now()}`);
if (!res.ok) throw new Error(`Daten nicht ladbar (${res.status})`);
const snap = await res.json();
// Ältere Daten als 6 Stunden würden einen falschen Tagesstand melden
if (Date.now() - snap.time > 6 * 3_600_000) throw new Error('Die Daten sind älter als 6 Stunden – heute kein Beitrag');

const { market, fng, coins } = snap;
const btc = coins.find((c) => c.id === 'bitcoin');
const buys = coins.filter((c) => c.analysis?.signal === 'buy').length;
const rated = coins.filter((c) => c.analysis?.signal && c.analysis.signal !== 'none').length;

const T = {
  en: {
    title: 'Crypto weather', index: 'Market index', fng: 'Fear & Greed', week: '7 days ago', cycle: 'Cycle', btc: 'Bitcoin',
    signals: (n, of) => `${n} of ${of} rated coins with a buy signal`, note: 'Probabilities, not promises. Not financial advice.',
    cta: 'Full picture – 30 days free', locale: 'en-US',
    label: { 'Kaufen': 'Buy', 'Eher kaufen': 'Lean buy', 'Halten': 'Hold', 'Eher verkaufen': 'Lean sell', 'Verkaufen': 'Sell' },
    zone: { deep: 'deep in the cycle', low: 'lower third of the cycle', mid: 'middle of the cycle', high: 'near the high' },
    mood: ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed'],
  },
  de: {
    title: 'Krypto-Wetter', index: 'Markt-Index', fng: 'Fear & Greed', week: 'vor 7 Tagen', cycle: 'Zyklus', btc: 'Bitcoin',
    signals: (n, of) => `${n} von ${of} bewerteten Coins mit Kaufsignal`, note: 'Wahrscheinlichkeiten, keine Versprechen. Keine Anlageberatung.',
    cta: 'Alles im Detail – 30 Tage kostenlos', locale: 'de-CH',
    label: { 'Kaufen': 'Kaufen', 'Eher kaufen': 'Eher kaufen', 'Halten': 'Halten', 'Eher verkaufen': 'Eher verkaufen', 'Verkaufen': 'Verkaufen' },
    zone: { deep: 'tief im Zyklus', low: 'unteres Drittel des Zyklus', mid: 'Mitte des Zyklus', high: 'nahe am Hoch' },
    mood: ['extreme Angst', 'Angst', 'neutral', 'Gier', 'extreme Gier'],
  },
}[lang];

// Wetter-Symbol nach dem Markt-Index; Stimmungsstufen wie bei alternative.me
const weather = (v) => (v < 30 ? '⛈️' : v < 45 ? '🌧️' : v < 55 ? '☁️' : v < 70 ? '🌤️' : '☀️');
const mood = (v) => T.mood[v < 25 ? 0 : v < 45 ? 1 : v <= 55 ? 2 : v <= 75 ? 3 : 4];
const fmt = (v, d = 0) => v.toLocaleString(T.locale, { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v, d = 1) => `${v > 0 ? '+' : ''}${fmt(v, d)} %`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = new Date(snap.time).toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });

const lines = [
  `${weather(market.value)} <b>${T.title} – ${esc(day)}</b>`,
  '',
  `${T.index}: <b>${market.value}/100</b> – ${esc(T.label[market.label] ?? market.label)}`,
  fng ? `${T.fng}: <b>${fng.value}</b> – ${mood(fng.value)}${Number.isFinite(fng.week) ? ` (${T.week}: ${fng.week})` : ''}` : null,
  btc ? `${T.btc}: <b>$${fmt(btc.current_price)}</b> (${signed(btc.price_change_percentage_24h_in_currency ?? 0)} 24h)` : null,
  market.cycle ? `${T.cycle}: ${esc(T.zone[market.cycle.zone] ?? market.cycle.label)}` : null,
  T.signals(buys, rated),
  '',
  `<i>${T.note}</i>`,
  `👉 <a href="${SITE}">${T.cta}</a>`,
].filter((l) => l !== null);
const text = lines.join('\n');

const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) {
  console.log('Telegram ist noch nicht eingerichtet (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID fehlen). Der Beitrag wäre:\n');
  console.log(text);
  process.exit(0);
}
const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
});
const answer = await sent.json().catch(() => ({}));
if (!answer.ok) throw new Error(`Telegram lehnt ab: ${answer.description ?? sent.status}`);
console.log('Beitrag verschickt.');
