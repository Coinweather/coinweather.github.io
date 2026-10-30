// Wertentwicklung des Portfolios.
//
// Festgehalten wird nicht der Wert, sondern jeder geänderte Bestand mit seinem Zeitpunkt. Aus den Beständen und den
// Tageskursen lässt sich der Wert für jeden Tag nachrechnen – auch für Tage, an denen die Seite nicht offen war.
// Daneben läuft mit, wie viel Geld von außen ins Portfolio kam (Einzahlungen minus Entnahmen). So lässt sich der
// Gewinn von bloßen Einzahlungen trennen.
//
// state: { t: Zeitpunkt in ms, cash, pos: [[Coin-ID, Menge], …], in: bis dahin eingezahlt }
//
// dates: Kaufdaten zu den Erfassungen – { t, id, day, amount, cost }. t ist der Zeitpunkt der Erfassung, t = 0 gilt für alle
// Erfassungen dieses Coins ohne eigenes Datum. id ist die Coin-ID oder CASH für die Reserve. Siehe backdated().

const DAY_MS = 86_400_000;
const MAX_STATES = 400;
const MAX_LOG = 60;
const MERGE_MS = 90_000;     // schnelle Änderungen hintereinander zählen als eine

export const dayOf = (ms) => Math.floor(ms / DAY_MS);
export const empty = () => ({ states: [], dates: [] });
export const CASH = '$';      // die Reserve (Bargeld) in den Kaufdaten
const MAX_DATES = 300;
const CORRECTION_MS = 7 * DAY_MS;   // wird eine Erfassung so bald wieder entfernt, war sie ein Versehen

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
  const dates = (Array.isArray(track?.dates) ? track.dates : [])
    .filter((d) => d && Number.isFinite(d.t) && typeof d.id === 'string' && Number.isFinite(d.day))
    .map((d) => ({ t: d.t, id: d.id, day: d.day, ...(d.amount > 0 ? { amount: d.amount } : {}), ...(d.cost > 0 ? { cost: d.cost } : {}) }));
  return { states: states.slice(-MAX_STATES), dates: dates.slice(-MAX_DATES) };
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
    return { ...track, states: [{ t: now, cash, pos, in: num(valueAfter) }] };
  }
  if (same(last.pos, pos) && Math.abs(last.cash - cash) < 0.005) return track;
  const state = { t: now, cash, pos, in: last.in + (internal ? 0 : num(valueAfter) - num(valueBefore)) };
  // Schnelle Erfassungen zusammenfassen; Käufe und Verkäufe bleiben eigene Einträge, sonst wären sie von Geld von außen nicht zu trennen
  const lastInternal = states.length > 1 && Math.abs(last.in - states[states.length - 2].in) <= 0.005;
  if (now - last.t < MERGE_MS && states.length > 1 && !internal && !lastInternal) states[states.length - 1] = state; else states.push(state);
  return { ...track, states: states.slice(-MAX_STATES) };
}

// Kaufdaten einer Erfassung anhängen (now: derselbe Zeitpunkt wie in record)
export const addDates = (track, list, now) => ({ ...track,
  dates: [...(track.dates ?? []), ...list.map((d) => ({ ...d, t: now }))].slice(-MAX_DATES) });

// Kaufdatum eines Coins oder der Reserve nachträglich setzen: gilt für alle seine Erfassungen. day = null: wieder ohne Datum
export function setDate(track, id, day, cost = null) {
  const rest = (track.dates ?? []).filter((d) => d.id !== id);
  return { ...track, dates: day === null ? rest : [...rest, { t: 0, id, day, ...(cost > 0 ? { cost } : {}) }].slice(-MAX_DATES) };
}

// Das eingetragene Kaufdatum (Tag) eines Coins oder der Reserve, oder null
export function dateOf(track, id) {
  const list = (track.dates ?? []).filter((d) => d.id === id);
  return list.length ? Math.min(...list.map((d) => d.day)) : null;
}

// Rechnet die Aufzeichnung auf die Kaufdaten um. Festgehalten ist, wann etwas eingetragen wurde – wer seinen Bestand nach und nach
// erfasst, hätte sonst einen Sprung im Verlauf. Jede Erfassung von außen (Coin oder Reserve) wandert deshalb auf ihr Kaufdatum:
// Ab dann zählt sie zum Wert und zu „eingezahlt“. Käufe und Verkäufe innerhalb des Portfolios bleiben, wo sie sind. Was kurz nach dem
// Erfassen wieder entfernt wird, war ein Versehen und verschwindet ganz; später Entferntes ist eine Entnahme an jenem Tag.
//   priceOn(id, day): Kurs des Coins an diesem Tag
//   undatedDays: Erfassungen ohne Datum so viele Tage vor der allerersten Erfassung ansetzen – alle am selben Tag, sonst wäre der
//                Sprung nur verschoben; null: am Tag des Eintragens lassen
// Ergebnis: { states, undated: Set der Coins/Reserve ohne Datum }. states tragen zusätzlich mkt: eingezahlt zum Marktwert jenes Tages –
// damit trennt die Wertentwicklung Gewinn von Einzahlungen, auch wenn der eingetragene Kaufpreis davon abweicht.
export function backdated(track, { priceOn, undatedDays = null }) {
  const dates = track.dates ?? [], undated = new Set(), events = [], open = new Map();
  const anchor = track.states.length && undatedDays !== null ? dayOf(track.states[0].t) - undatedDays : null;
  const priceAt = (id, day) => (id === CASH ? 1 : num(priceOn(id, day)));
  let prev = { t: -Infinity, cash: 0, pos: [], in: 0 };
  for (const s of track.states) {
    const before = new Map(prev.pos), after = new Map(s.pos), day = dayOf(s.t);
    const deltas = [...new Set([...before.keys(), ...after.keys()])].map((id) => [id, (after.get(id) ?? 0) - (before.get(id) ?? 0)])
      .filter(([id, d]) => Math.abs(d) > 1e-12 * Math.max(1, before.get(id) ?? 0));
    if (Math.abs(s.cash - prev.cash) >= 0.01) deltas.push([CASH, s.cash - prev.cash]);
    const flow = s.in - prev.in;
    if (prev.t !== -Infinity && Math.abs(flow) <= 0.005) {
      if (deltas.length) events.push({ t: s.t, deltas, in: 0, mkt: 0 });
    } else {
      // Geld von außen: auf die einzelnen Coins verteilen, gemessen an ihrem Wert beim Eintragen
      const vals = deltas.map(([id, d]) => d * priceAt(id, day));
      const abs = vals.reduce((a, v) => a + Math.abs(v), 0), gap = flow - vals.reduce((a, v) => a + v, 0);
      deltas.forEach(([id, d], i) => {
        const share = vals[i] + (abs ? gap * Math.abs(vals[i]) / abs : 0);
        if (d > 0) {
          const parts = [];
          let rest = d;
          for (const x of dates) {
            if (x.id !== id || x.t <= prev.t || x.t > s.t || rest <= 0) continue;
            const amount = Math.min(rest, x.amount ?? rest);
            parts.push({ amount, day: x.day, cost: x.cost });
            rest -= amount;
          }
          if (rest > 1e-12 * d) {
            const all = dates.find((x) => x.id === id && x.t === 0);
            if (!all && undatedDays !== null) undated.add(id);
            parts.push({ amount: rest, day: all ? all.day : anchor ?? day, cost: all?.cost });
          }
          for (const part of parts) {
            const moved = part.day < day, frac = part.amount / d;
            const mkt = moved ? part.amount * priceAt(id, part.day) : share * frac;
            const ev = { t: moved ? part.day * DAY_MS : s.t, deltas: [[id, part.amount]], in: part.cost > 0 ? part.amount * part.cost : mkt, mkt };
            events.push(ev);
            if (!open.has(id)) open.set(id, []);
            open.get(id).push({ ev, entered: s.t });
          }
        } else {
          // Entfernt: zuerst gerade erst Erfasstes zurücknehmen, der Rest ist eine Entnahme
          let rest = -d;
          const lots = open.get(id) ?? [];
          for (let k = lots.length - 1; k >= 0 && rest > 0; k--) {
            if (s.t - lots[k].entered > CORRECTION_MS) break;
            const { ev } = lots[k], have = ev.deltas[0][1], take = Math.min(rest, have), left = have > 0 ? 1 - take / have : 0;
            ev.deltas = [[id, have - take]]; ev.in *= left; ev.mkt *= left;
            rest -= take;
          }
          if (rest > 1e-12 * -d) events.push({ t: s.t, deltas: [[id, -rest]], in: share * (rest / -d), mkt: share * (rest / -d) });
        }
      });
      if (!deltas.length) events.push({ t: s.t, deltas: [], in: flow, mkt: flow });
    }
    prev = s;
  }
  // Neu abspielen, in der Reihenfolge der Kaufdaten
  const holding = new Map();
  let cash = 0, paid = 0, mkt = 0;
  const states = events.sort((a, b) => a.t - b.t).map((ev) => {
    for (const [id, d] of ev.deltas) {
      if (id === CASH) cash += d; else holding.set(id, (holding.get(id) ?? 0) + d);
    }
    paid += ev.in; mkt += ev.mkt;
    const pos = [...holding.entries()].filter(([, n]) => n > 1e-12);
    return { t: ev.t, cash: Math.max(0, cash), pos, in: paid, mkt };
  });
  return { states, undated };
}

export const addLog = (log, text, now = Date.now()) => [...log, { t: now, text }].slice(-MAX_LOG);

// Tageswerte von fromDay bis toDay.
//   priceOn(id, day): Kurs des Coins an diesem Tag (Tagesende) oder null, wenn unbekannt
//   btcOn(day): Bitcoin-Kurs an diesem Tag für den Vergleich, oder null
// Vor dem ersten Eintrag wird mit dem ersten festgehaltenen Bestand zurückgerechnet (tracked = false).
// Ergebnis je Tag: { day, value, in, mkt, btc, tracked }
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
    if (day >= fromDay) out.push({ day, value, in: tracked ? s.in : null, mkt: tracked ? s.mkt ?? s.in : null, btc, tracked });
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
    const flow = a.mkt !== null && b.mkt !== null ? b.mkt - a.mkt : 0;
    const r = (b.value - flow) / a.value;
    if (!(r > 0) || !Number.isFinite(r)) continue;
    factor *= r; used = true;
  }
  return used ? (factor - 1) * 100 : null;
}
