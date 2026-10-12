// Wertentwicklung des Portfolios.
//
// Festgehalten wird nicht der Wert, sondern jeder geänderte Bestand mit seinem Zeitpunkt. Aus den Beständen und den
// Tageskursen lässt sich der Wert für jeden Tag nachrechnen – auch für Tage, an denen die Seite nicht offen war.
// Daneben läuft mit, wie viel Geld von außen ins Portfolio kam (Einzahlungen minus Entnahmen). So lässt sich der
// Gewinn von bloßen Einzahlungen trennen.
//
// state: { t: Zeitpunkt in ms, cash, pos: [[Coin-ID, Menge], …], in: bis dahin eingezahlt }

const DAY_MS = 86_400_000;
const MAX_STATES = 400;
const MAX_LOG = 60;
const MERGE_MS = 90_000;     // schnelle Änderungen hintereinander zählen als eine

export const dayOf = (ms) => Math.floor(ms / DAY_MS);
export const empty = () => ({ states: [] });

const num = (x) => (Number.isFinite(x) ? x : 0);

// Im Konto liegt der Bestand je Eintrag als Text (die Datenbank kennt keine Listen in Listen)
const parsePos = (pos) => {
  if (typeof pos !== 'string') return pos;
  try { return JSON.parse(pos); } catch { return null; }
};

export function normalise(track) {
  const states = (Array.isArray(track?.states) ? track.states : [])
    .map((s) => (s ? { ...s, pos: parsePos(s.pos) } : s))
    .filter((s) => s && Number.isFinite(s.t) && Array.isArray(s.pos))
    .map((s) => ({ t: s.t, cash: num(s.cash), in: num(s.in),
      pos: s.pos.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && p[1] > 0).map((p) => [p[0], p[1]]) }))
    .sort((a, b) => a.t - b.t);
  return { states: states.slice(-MAX_STATES) };
}

export function normaliseLog(log) {
  return (Array.isArray(log) ? log : []).filter((e) => e && Number.isFinite(e.t) && typeof e.text === 'string')
    .map((e) => ({ t: e.t, text: e.text.slice(0, 200) })).slice(-MAX_LOG);
}

// Bestand in der Form, in der er festgehalten wird: nur Coins mit bekannter ID
const holdings = (positions) => {
  const sum = new Map();
  for (const p of positions) if (p.id && p.amount > 0) sum.set(p.id, (sum.get(p.id) ?? 0) + p.amount);
  return [...sum.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

const same = (a, b) => a.length === b.length && a.every(([id, n], i) => id === b[i][0] && Math.abs(n - b[i][1]) <= 1e-12 * Math.max(1, n));

// Hält einen geänderten Bestand fest und gibt die neue Aufzeichnung zurück.
//   valueBefore / valueAfter: Wert des Portfolios vor und nach der Änderung, zu den Kursen dieses Augenblicks
//   internal: Verkauf, Kauf oder Tausch innerhalb des Portfolios – der Wert ändert sich nur um die Gebühr.
//             Alles andere (Position hinzufügen oder entfernen, Bargeld ändern) ist Geld von außen oder nach außen.
export function record(track, data, { valueBefore, valueAfter, internal = false, now = Date.now() }) {
  const states = track.states.slice();
  const pos = holdings(data.positions), cash = num(data.cash);
  const last = states[states.length - 1];
  if (!last) {
    if (!pos.length && !cash) return track;
    // Beginn der Aufzeichnung: Was jetzt da ist, gilt als eingezahlt
    return { states: [{ t: now, cash, pos, in: num(valueAfter) }] };
  }
  if (same(last.pos, pos) && Math.abs(last.cash - cash) < 0.005) return track;
  const state = { t: now, cash, pos, in: last.in + (internal ? 0 : num(valueAfter) - num(valueBefore)) };
  if (now - last.t < MERGE_MS && states.length > 1) states[states.length - 1] = state; else states.push(state);
  return { states: states.slice(-MAX_STATES) };
}

export const addLog = (log, text, now = Date.now()) => [...log, { t: now, text }].slice(-MAX_LOG);

// Tageswerte von fromDay bis toDay.
//   priceOn(id, day): Kurs des Coins an diesem Tag (Tagesende) oder null, wenn unbekannt
//   btcOn(day): Bitcoin-Kurs an diesem Tag für den Vergleich, oder null
// Vor dem Beginn der Aufzeichnung wird mit dem ersten festgehaltenen Bestand zurückgerechnet (tracked = false).
// Ergebnis je Tag: { day, value, in, btc, tracked }
export function series(track, { fromDay, toDay, priceOn, btcOn = () => null }) {
  const states = track.states;
  if (!states.length) return [];
  const startDay = dayOf(states[0].t);
  const out = [];
  let k = 0, btcUnits = null, paid = null;
  const last = new Map();          // letzter bekannter Kurs je Coin, falls an einem Tag einer fehlt
  for (let day = Math.min(fromDay, startDay); day <= toDay; day++) {
    while (k + 1 < states.length && dayOf(states[k + 1].t) <= day) k++;
    const s = day < startDay ? states[0] : states[k];
    let value = s.cash;
    for (const [id, amount] of s.pos) {
      const p = priceOn(id, day);
      if (Number.isFinite(p) && p > 0) last.set(id, p);
      value += amount * (last.get(id) ?? 0);
    }
    const tracked = day >= startDay;
    let btc = null;
    if (tracked) {
      // Vergleich: Jede Einzahlung wäre am selben Tag in Bitcoin geflossen
      const b = btcOn(day);
      if (Number.isFinite(b) && b > 0) {
        const flow = s.in - (paid ?? 0);
        if (btcUnits === null) btcUnits = s.in / b; else if (Math.abs(flow) > 0.005) btcUnits += flow / b;
        paid = s.in;
        btc = btcUnits * b;
      }
    }
    if (day >= fromDay) out.push({ day, value, in: tracked ? s.in : null, btc, tracked });
  }
  return out;
}

// Zeitgewichtete Wertentwicklung in Prozent über eine Reihe aus series(): Einzahlungen und Entnahmen zählen nicht
// als Gewinn oder Verlust. null, wenn sich nichts rechnen lässt.
export function performance(points) {
  let factor = 1, used = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!(a.value > 0)) continue;
    const flow = a.in !== null && b.in !== null ? b.in - a.in : 0;
    const r = (b.value - flow) / a.value;
    if (!(r > 0) || !Number.isFinite(r)) continue;
    factor *= r; used = true;
  }
  return used ? (factor - 1) * 100 : null;
}
