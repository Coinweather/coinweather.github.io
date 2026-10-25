// Betreiber-Übersicht „Besucher“: alle Besuche, auch ohne Konto (gezählt von js/visits.js).
// Tagessummen kommen aus stats/{Tag}, „online“ und die letzten Besuche aus visits/{id}. Nur Deutsch, wie die übrige Übersicht.
import { esc } from './util.js';
import * as auth from './auth.js';
import { lineChart } from './charts.js';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const ONLINE_MS = 3 * MINUTE;   // „noch da“ kommt alle 90 Sekunden
const ZONE = 'Europe/Zurich';
const dayOf = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(t);
const int = (n) => new Intl.NumberFormat('de-CH').format(Math.round(n || 0));
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '–');
const clock = (t) => new Date(t).toLocaleString('de-CH', { timeZone: ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const span = (secs) => (!secs ? '0 s' : secs < 60 ? `${secs} s` : secs < 3600 ? `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s`
  : `${Math.floor(secs / 3600)} h ${Math.floor((secs % 3600) / 60)} min`);

const PAGES = { markt: 'Markt (Start)', coin: 'Coin-Seite', indikatoren: 'Zyklus-Kompass', rechner: 'Rechner', modell: 'Modell-Portfolio', vergleich: 'Vergleich',
  portfolio: 'Portfolio', konto: 'Konto / Anmelden', preise: 'Pakete und Preise', daytrading: 'Daytrading', challenge: 'Challenge',
  agb: 'AGB', datenschutz: 'Datenschutz', impressum: 'Impressum', risiko: 'Risikohinweis' };
const SOURCES = { direkt: 'Direkt (Adresse, Lesezeichen, App)', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', ecosia: 'Ecosia',
  brave: 'Brave Search', yandex: 'Yandex', qwant: 'Qwant', startpage: 'Startpage', baidu: 'Baidu', x: 'X / Twitter', telegram: 'Telegram', whatsapp: 'WhatsApp',
  reddit: 'Reddit', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn', tiktok: 'TikTok', pinterest: 'Pinterest',
  discord: 'Discord', github: 'GitHub', ki: 'KI-Assistent (ChatGPT, Perplexity …)', mail: 'E-Mail', seo: 'Eigene Info-Seiten (SEO)',
  teilen: 'Geteilter Link eines Nutzers', link: 'Werbe-Link (?von=)', andere: 'Andere Webseiten' };
const DEVICES = { handy: 'Handy', tablet: 'Tablet', computer: 'Computer' };
const EVENTS = { rechnen: 'Rechner berechnet', vergleichen: 'Coins verglichen', challenge: 'Challenge gestartet', autopilot_zeigen: 'Autopilot-Vorschau gezeigt',
  teilen: 'Teilen geklickt', zum_konto: '„Kostenlos starten“ / Konto geklickt', konto_formular: 'Anmeldeformular abgeschickt', registriert: 'Konto angelegt',
  angemeldet: 'Angemeldet', autopilot_gestartet: 'Autopilot eingerichtet', preise: 'Preise angesehen', installieren: 'Als App installiert', tradingview: 'TradingView geladen' };
const LANGS = { de: 'Deutsch', en: 'Englisch', es: 'Spanisch', fr: 'Französisch', it: 'Italienisch', pt: 'Portugiesisch', tr: 'Türkisch' };
// Zeitzone → Land (die häufigsten); sonst steht die Zeitzone da
const ZONES = { Europe_Zurich: 'Schweiz', Europe_Berlin: 'Deutschland', Europe_Busingen: 'Deutschland', Europe_Vienna: 'Österreich', Europe_Vaduz: 'Liechtenstein',
  Europe_Paris: 'Frankreich', Europe_Rome: 'Italien', Europe_Madrid: 'Spanien', Atlantic_Canary: 'Spanien', Europe_Lisbon: 'Portugal', Europe_London: 'Vereinigtes Königreich',
  Europe_Dublin: 'Irland', Europe_Amsterdam: 'Niederlande', Europe_Brussels: 'Belgien', Europe_Luxembourg: 'Luxemburg', Europe_Copenhagen: 'Dänemark',
  Europe_Stockholm: 'Schweden', Europe_Oslo: 'Norwegen', Europe_Helsinki: 'Finnland', Europe_Warsaw: 'Polen', Europe_Prague: 'Tschechien', Europe_Budapest: 'Ungarn',
  Europe_Bratislava: 'Slowakei', Europe_Ljubljana: 'Slowenien', Europe_Zagreb: 'Kroatien', Europe_Belgrade: 'Serbien', Europe_Bucharest: 'Rumänien',
  Europe_Sofia: 'Bulgarien', Europe_Athens: 'Griechenland', Europe_Istanbul: 'Türkei', Asia_Istanbul: 'Türkei', Europe_Kiev: 'Ukraine', Europe_Kyiv: 'Ukraine',
  Europe_Moscow: 'Russland', Europe_Riga: 'Lettland', Europe_Vilnius: 'Litauen', Europe_Tallinn: 'Estland', Europe_Malta: 'Malta', Asia_Nicosia: 'Zypern',
  America_New_York: 'USA (Osten)', America_Chicago: 'USA (Mitte)', America_Denver: 'USA (Berge)', America_Phoenix: 'USA (Arizona)', America_Los_Angeles: 'USA (Westen)',
  America_Toronto: 'Kanada', America_Vancouver: 'Kanada', America_Mexico_City: 'Mexiko', America_Sao_Paulo: 'Brasilien', America_Argentina_Buenos_Aires: 'Argentinien',
  America_Bogota: 'Kolumbien', America_Lima: 'Peru', America_Santiago: 'Chile', Asia_Dubai: 'Vereinigte Arabische Emirate', Asia_Kolkata: 'Indien', Asia_Calcutta: 'Indien',
  Asia_Singapore: 'Singapur', Asia_Hong_Kong: 'Hongkong', Asia_Shanghai: 'China', Asia_Tokyo: 'Japan', Asia_Seoul: 'Südkorea', Asia_Bangkok: 'Thailand',
  Asia_Jakarta: 'Indonesien', Asia_Manila: 'Philippinen', Asia_Ho_Chi_Minh: 'Vietnam', Asia_Saigon: 'Vietnam', Asia_Karachi: 'Pakistan', Asia_Tehran: 'Iran',
  Asia_Jerusalem: 'Israel', Asia_Riyadh: 'Saudi-Arabien', Africa_Lagos: 'Nigeria', Africa_Cairo: 'Ägypten', Africa_Johannesburg: 'Südafrika', Africa_Casablanca: 'Marokko',
  Africa_Nairobi: 'Kenia', Australia_Sydney: 'Australien', Australia_Melbourne: 'Australien', Australia_Brisbane: 'Australien', Australia_Perth: 'Australien',
  Pacific_Auckland: 'Neuseeland' };
const country = (k) => ZONES[k] ?? k.replace(/_/g, '/');

// Zahlenbäume zusammenzählen (mehrere Tage)
function sum(into, add) {
  for (const [k, v] of Object.entries(add)) {
    if (k === 'day') continue;
    if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
    else if (v && typeof v === 'object') sum(into[k] ??= {}, v);
  }
  return into;
}

export function visitorsPanel(el, { coinName, data }) {
  let stats = null, visits = null, live = null, error = null, range = 'heute', loading = false, pruned = false, openVisit = null, dead = false;
  // Nicht mehr auf der Seite (anderer Reiter oder andere Seite): Zeitgeber beenden – beim Zurückkehren entsteht die Übersicht neu
  const destroyed = () => { if (!el.isConnected) dead = true; return dead; };

  async function loadAll() {
    loading = true; draw();
    try {
      const from = dayOf(Date.now() - 34 * DAY);
      [stats, visits] = await Promise.all([auth.listStats(from), auth.listVisits(Date.now() - 2 * DAY, 300)]);
      live = visits.filter((x) => Date.now() - x.last < ONLINE_MS);
      error = null;
      // Einzelbesuche älter als 30 Tage löschen (so steht es in der Datenschutzerklärung); die Tagessummen bleiben
      if (!pruned) { pruned = true; auth.pruneVisits(Date.now() - 30 * DAY).catch(() => {}); }
    } catch (err) { error = err.message; }
    loading = false;
    if (!destroyed()) draw();
  }
  async function loadLive() {
    try { live = await auth.listVisits(Date.now() - ONLINE_MS, 200); if (!destroyed()) draw(); } catch { /* beim nächsten Mal */ }
  }

  function bars(title, entries, label = (k) => k, max = 12, total = null) {
    const list = entries.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, max);
    const top = list[0]?.[1] ?? 0, all = total ?? entries.reduce((s, [, n]) => s + Math.max(0, n), 0);
    return `<div class="vis-box"><div class="label">${title}</div>${list.length ? `<ul class="vis-bars">${list.map(([k, n]) => `<li>
        <span class="vis-name">${esc(label(k))}</span><span class="vis-num">${int(n)} <small>${pct(n, all)}</small></span>
        <i style="width:${Math.max(2, (n / top) * 100)}%"></i></li>`).join('')}</ul>` : '<p class="muted">Noch keine Daten.</p>'}</div>`;
  }
  const map = (o) => Object.entries(o ?? {});

  function rangeDays() {
    const today = dayOf(Date.now());
    if (range === 'heute') return [today];
    if (range === 'gestern') return [dayOf(Date.now() - DAY)];
    const n = range === '7' ? 7 : 30;
    return Array.from({ length: n }, (_, i) => dayOf(Date.now() - i * DAY));
  }

  function draw() {
    if (error) {
      el.innerHTML = `<section class="panel"><p class="notice">${esc(error)}</p>
        <p>Für die Besucher-Zählung müssen die neuen Firestore-Regeln veröffentlicht sein: Firebase-Konsole → Firestore Database → Regeln,
        den Inhalt der Datei <code>firestore.rules</code> einfügen und „Veröffentlichen“ klicken. Erst danach werden Besuche gezählt.</p>
        <button class="btn" data-vis-reload>Erneut laden</button></section>`;
      el.querySelector('[data-vis-reload]').addEventListener('click', loadAll);
      return;
    }
    if (!stats) { el.innerHTML = '<section class="panel"><p class="muted">Besucher werden geladen …</p></section>'; return; }
    const days = new Set(rangeDays());
    const s = stats.filter((d) => days.has(d.day)).reduce((acc, d) => sum(acc, d), {});
    const v = s.v ?? 0, pv = s.pv ?? 0;
    const card = (label, value, sub = '') => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="muted">${sub}</div></div>`;
    const ev = s.ev ?? {};
    const funnel = [['Besuche', v], ['„Kostenlos starten“ / Konto geklickt', ev.zum_konto ?? 0], ['Anmeldeformular abgeschickt', ev.konto_formular ?? 0],
      ['Konto angelegt', ev.registriert ?? 0], ['Autopilot eingerichtet', ev.autopilot_gestartet ?? 0]];
    const hours = Array.from({ length: 24 }, (_, h) => (s.hour ?? {})[String(h).padStart(2, '0')] ?? 0);
    const hourMax = Math.max(1, ...hours);
    const RANGES = [['heute', 'Heute'], ['gestern', 'Gestern'], ['7', '7 Tage'], ['30', '30 Tage']];
    const liveList = (live ?? []).slice().sort((a, b) => b.last - a.last);
    const pageLabel = (p) => (p?.startsWith('coin/') ? `Coin: ${coinName(p.slice(5))}` : PAGES[p] ?? p ?? '–');
    const where = (x) => [ZONES[String(x.tz ?? '').replace(/[^A-Za-z0-9_-]/g, '_')] ?? x.tz ?? '–'].join('');
    const from = (x) => `${SOURCES[x.src] ?? x.src ?? '–'}${x.ref && !['direkt'].includes(x.src) ? ` <span class="muted">(${esc(x.ref)})</span>` : ''}`;

    // Datenstand: Die Berechnung auf GitHub läuft alle 15 Minuten – älter als 45 Minuten heißt, sie ist ausgefallen
    const ds = data?.() ?? {}, age = ds.time ? Date.now() - ds.time : null;
    const health = !ds.coins ? ['none', 'Daten werden geladen …'] : !ds.server ? ['sell', 'Zentrale Berechnung fehlt – die Seite rechnet im Browser (langsamer). GitHub → Actions → „Daten berechnen“ prüfen.']
      : age > 45 * MINUTE ? ['sell', `Daten sind ${Math.round(age / MINUTE)} Minuten alt – die Berechnung auf GitHub ist wohl ausgefallen (Actions → „Daten berechnen“).`]
        : ['buy', `Daten von ${clock(ds.time)} Uhr, ${int(ds.coins)} Coins – alles in Ordnung.`];
    el.innerHTML = `
      <p class="vis-health"><span class="badge ${health[0]}">${health[0] === 'sell' ? 'Achtung' : 'Datenstand'}</span> ${esc(health[1])}</p>
      <div class="vis-head"><div class="chips" role="group" aria-label="Zeitraum">${RANGES.map(([k, l]) => `<button class="chip ${k === range ? 'active' : ''}" data-vis-range="${k}">${l}</button>`).join('')}</div>
        <button class="btn ghost small" data-vis-reload>${loading ? 'Lädt …' : 'Aktualisieren'}</button></div>
      <div class="summary">
        ${card('Jetzt online', int(liveList.length), 'aktiv in den letzten 3 Minuten')}
        ${card('Besuche', int(v), `${int(s.ret ?? 0)} kannten die Seite schon (${pct(s.ret ?? 0, v)})`)}
        ${card('Seitenaufrufe', int(pv), `${v ? (pv / v).toFixed(1).replace('.', ',') : '–'} Seiten je Besuch`)}
        ${card('Verweildauer', span(Math.round((s.secs ?? 0) / Math.max(1, v))), 'im Schnitt, nur sichtbare Zeit')}
        ${card('Absprungrate', pct(s.one ?? 0, v), 'nur eine Seite angesehen')}
        ${card('Handy', pct((s.dev ?? {}).handy ?? 0, v), `Tablet ${pct((s.dev ?? {}).tablet ?? 0, v)} · Computer ${pct((s.dev ?? {}).computer ?? 0, v)}`)}
        ${card('Mit Konto', int(s.acc ?? 0), `${pct(s.acc ?? 0, v)} der Besuche angemeldet`)}
        ${card('Neue Konten', int(ev.registriert ?? 0), `aus ${int(v)} Besuchen (${pct(ev.registriert ?? 0, v)})`)}
        ${card('Programmfehler', int(map(s.err).reduce((a, [, n]) => a + n, 0)), map(s.err).length ? 'Details unten bei „Programmfehler“' : 'keine – alles läuft')}
      </div>

      <section class="panel"><div class="label">Besuche je Tag (30 Tage)</div><div id="vis-chart" class="chart"></div></section>

      <section class="panel"><div class="label">Jetzt online (${liveList.length})</div>
        ${liveList.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Gerade auf</th><th>Seit</th><th class="num">Seiten</th><th>Gerät</th><th>Land</th><th>Herkunft</th></tr></thead><tbody>
          ${liveList.map((x) => `<tr><td>${esc(pageLabel(x.pages?.[x.pages.length - 1]?.p))}</td><td>${span(Math.round((Date.now() - x.start) / 1000))}</td><td class="num">${x.n ?? 0}</td>
            <td>${esc(DEVICES[x.dev] ?? x.dev ?? '–')} · ${esc(x.os ?? '')} · ${esc(x.br ?? '')}</td><td>${esc(where(x))}</td><td>${from(x)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Im Moment ist niemand auf der Seite.</p>'}</section>

      <div class="vis-grid">
        ${bars('Herkunft', map(s.src), (k) => SOURCES[k] ?? k)}
        ${bars('Herkunft im Detail (Seite oder Link)', map(s.ref), (k) => { const at = k.indexOf('__'); return at < 0 ? k : `${SOURCES[k.slice(0, at)] ?? k.slice(0, at)}: ${k.slice(at + 2).replace(/_/g, '.')}`; }, 15)}
        ${bars('Einstiegsseiten', map(s.land), (k) => PAGES[k] ?? k)}
        ${bars('Aufgerufene Bereiche', map(s.pages), (k) => PAGES[k] ?? k, 15)}
        ${bars('Meistgesehene Coins', map(s.coins), coinName, 15)}
        ${bars('Länder (nach Zeitzone)', Object.entries(map(s.tz).reduce((m, [k, n]) => { const c = country(k); m[c] = (m[c] ?? 0) + n; return m; }, {})), (k) => k, 15)}
        ${bars('Sprache der Seite', map(s.lang), (k) => LANGS[k] ?? k)}
        ${bars('Sprache des Browsers', map(s.loc), (k) => k.replace(/_/g, '-'), 12)}
        ${bars('Geräte', map(s.dev), (k) => DEVICES[k] ?? k)}
        ${bars('Betriebssysteme', map(s.os))}
        ${bars('Browser', map(s.br))}
        ${bars('Währung', map(s.cur), (k) => k.toUpperCase())}
        ${bars('Handlungen', map(ev), (k) => EVENTS[k] ?? k, 15, v)}
        ${map(s.err).length ? bars('Programmfehler (gekürzte Meldung)', map(s.err), (k) => k.replace(/_+/g, ' ').trim(), 15) : ''}
        <div class="vis-box"><div class="label">Weg zum Konto</div><ul class="vis-bars">${funnel.map(([l, n]) => `<li><span class="vis-name">${l}</span>
          <span class="vis-num">${int(n)} <small>${pct(n, v)}</small></span><i style="width:${Math.max(2, (n / Math.max(1, v)) * 100)}%"></i></li>`).join('')}</ul>
          <p class="hint">Als App geöffnet: ${int(s.pwa ?? 0)} Besuche.</p></div>
        <div class="vis-box vis-wide"><div class="label">Uhrzeit (Schweizer Zeit, Beginn des Besuchs)</div>
          <div class="vis-hours">${hours.map((n, h) => `<div title="${h}–${h + 1} Uhr: ${int(n)} Besuche"><i style="height:${(n / hourMax) * 100}%"></i><span>${h % 3 ? '' : h}</span></div>`).join('')}</div></div>
      </div>

      <section class="panel"><div class="label">Letzte Besuche (48 Stunden, höchstens 300)</div>
        <div class="table-wrap"><table class="admin-table"><thead><tr><th>Beginn</th><th>Dauer</th><th class="num">Seiten</th><th>Einstieg → zuletzt</th><th>Gerät</th><th>Land</th><th>Herkunft</th><th>Handlungen</th><th></th></tr></thead><tbody>
          ${(visits ?? []).map((x) => `<tr><td>${clock(x.start)}</td><td>${span(x.dur ?? 0)}</td><td class="num">${x.n ?? 0}</td>
            <td>${esc(pageLabel(x.land))}${(x.n ?? 0) > 1 ? ` → ${esc(pageLabel(x.pages?.[x.pages.length - 1]?.p))}` : ''}</td>
            <td>${esc(DEVICES[x.dev] ?? x.dev ?? '–')} · ${esc(x.os ?? '')} · ${esc(x.br ?? '')}${x.pwa ? ' · App' : ''}</td><td>${esc(where(x))}</td><td>${from(x)}</td>
            <td>${esc(Object.keys(x.ev ?? {}).map((k) => EVENTS[k] ?? k).join(', ')) || '–'}${x.acc ? ' <span class="badge buy">Konto</span>' : ''}${x.ret ? ' <span class="badge none">kennt die Seite</span>' : ''}${x.errs ? ` <span class="badge sell">${x.errs} Fehler</span>` : ''}</td>
            <td><button class="btn ghost small" data-vis-open="${esc(x.id)}">${openVisit === x.id ? 'Schließen' : 'Pfad'}</button></td></tr>
            ${openVisit === x.id ? `<tr class="admin-detail"><td colspan="9"><ol class="vis-path">${(x.pages ?? []).map((pg) => `<li><span class="muted">+${span(pg.t)}</span> ${esc(pageLabel(pg.p))}</li>`).join('')}</ol>
              <p class="muted">Sprache ${esc(LANGS[x.lang] ?? x.lang ?? '–')} · Browser-Sprache ${esc(x.loc ?? '–')} · Währung ${esc((x.cur ?? '–').toUpperCase())} · Zeitzone ${esc(x.tz ?? '–')}</p></td></tr>` : ''}`).join('')
            || '<tr><td colspan="9" class="empty">Noch keine Besuche erfasst.</td></tr>'}
        </tbody></table></div>
        <p class="hint">Gezählt wird ohne Cookies und ohne Kennung: Wer die Seite morgen wieder öffnet, ist ein neuer Besuch. „Kennt die Seite“ heißt, der Browser hatte schon
          Einstellungen der Seite gespeichert. Nicht gezählt werden Betreiber, Suchmaschinen-Roboter und Aufrufe auf localhost.</p></section>`;

    // Verlauf der letzten 30 Tage
    const all = Array.from({ length: 30 }, (_, i) => dayOf(Date.now() - (29 - i) * DAY));
    const byDay = new Map(stats.map((d) => [d.day, d]));
    const t = all.map((d) => Date.parse(`${d}T12:00:00Z`));
    lineChart(el.querySelector('#vis-chart'), { t, p: all.map((d) => byDay.get(d)?.v ?? 0), plain: true, note: 'Besuche',
      overlays: [{ values: all.map((d) => byDay.get(d)?.pv ?? 0), color: 'var(--accent)', label: 'Seitenaufrufe' }] }).catch(() => {});

    for (const b of el.querySelectorAll('[data-vis-range]')) b.addEventListener('click', () => { range = b.dataset.visRange; draw(); });
    el.querySelector('[data-vis-reload]').addEventListener('click', loadAll);
    for (const b of el.querySelectorAll('[data-vis-open]')) b.addEventListener('click', () => { openVisit = openVisit === b.dataset.visOpen ? null : b.dataset.visOpen; draw(); });
  }

  loadAll();
  // „Online“ jede Minute, alles andere alle 5 Minuten – solange die Übersicht offen und sichtbar ist
  const liveTimer = setInterval(() => { if (destroyed()) return clearInterval(liveTimer); if (document.visibilityState === 'visible') loadLive(); }, MINUTE);
  const fullTimer = setInterval(() => { if (destroyed()) return clearInterval(fullTimer); if (document.visibilityState === 'visible') loadAll(); }, 5 * MINUTE);
  return { reload: loadAll, dead: () => dead };
}
