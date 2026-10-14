// Seiten rund um das Angebot: Einstieg, Preise, Rechtstexte und die Hinweise auf das Abo.
// Die Texte zu Recht und Risiko sind Vorlagen – vor dem Verkauf von einer Fachperson prüfen lassen (siehe GO-LIVE.md).

import { SITE, operatorReady, selling } from './config.js';
import { esc, num, signed, settings } from './util.js';

const price = (x) => new Intl.NumberFormat(settings.locale, { style: 'currency', currency: SITE.currency }).format(x);
const dateText = (iso) => new Date(iso).toLocaleDateString(settings.locale, { day: 'numeric', month: 'long', year: 'numeric' });
const op = SITE.operator;
// Angaben des Betreibers bleiben in jeder Sprache, wie sie eingetragen sind
const or = (value, placeholder) => (value ? `<span translate="no">${esc(value)}</span>` : `<span class="todo">[${placeholder}]</span>`);

// ---------- Betreiber-Zugang ----------

// Gehört das Konto dem Betreiber? Über die Konto-Kennung oder über eine bestätigte E-Mail-Adresse (als Prüfsumme hinterlegt).
export async function isOwner(user) {
  if (!user) return false;
  if (SITE.owners.includes(user.uid)) return true;
  if (!user.verified || !user.email || !SITE.ownerMails.length || !globalThis.crypto?.subtle) return false;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.email.trim().toLowerCase()));
  return SITE.ownerMails.includes([...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

// ---------- Einstieg (oben auf der Seite „Preise“, solange kein Abo läuft) ----------

function landing(signedIn) {
  const trial = SITE.trialDays > 0;
  return `<section class="intro">
    <div class="intro-text">
      <span class="intro-tag">${trial && !signedIn ? `${SITE.trialDays} Tage kostenlos testen · danach ab ${price(SITE.plans.standard.price)} im Monat` : `Ab ${price(SITE.plans.standard.price)} im Monat · monatlich kündbar`}</span>
      <h1>${esc(SITE.claim)}.</h1>
      <p class="lead">${esc(SITE.name)} zeigt für 1000 Coins, wie die Aussichten stehen – als Wahrscheinlichkeit, nicht als Versprechen.
        Jede Regel ist an Kursen seit 2018 geprüft, und was aus den Signalen wird, messen wir offen nach.</p>
      <div class="btn-row">${trial && !signedIn ? `<a class="btn" href="#/konto">${SITE.trialDays} Tage kostenlos testen</a> ` : ''}<button class="btn${trial && !signedIn ? ' ghost' : ''}" type="button" data-to-plans>Pakete ansehen</button></div>
      ${trial && !signedIn ? '<p class="intro-note">Ohne Zahlungsdaten. Die Testphase endet von selbst – es verlängert sich nichts kostenpflichtig.</p>' : ''}
      <p class="intro-note">Keine Anlageberatung. Kryptowerte können stark fallen – bis zum Totalverlust.</p>
    </div>
    <ul class="intro-points">
      <li><strong>Signale mit Trefferquote</strong><span>Zu jedem Signal steht, wie oft vergleichbare Fälle im Plus endeten.</span></li>
      <li><strong>Großwetterlage</strong><span>Markt-Index, Fear &amp; Greed und Zyklus – wann das Modell kauft und wann es abwartet.</span></li>
      <li><strong>Portfolio und Daytrading</strong><span>Im Paket ${esc(SITE.plans.full.name)}: dein Bestand mit Wertentwicklung, Reserve-Ziel und Modell-Schritten, dazu geprüfte Handelsmuster.</span></li>
      <li><strong>Offene Erfolgskontrolle</strong><span>Jedes Kaufsignal wird nach 7 und 30 Tagen nachgemessen – auch die schlechten.</span></li>
    </ul>
  </section>`;
}

// ---------- Hinweis auf das größere Paket: Portfolio und Daytrading ----------

const FULL = SITE.plans.full.name, STD = SITE.plans.standard.name;
const UPSELL = {
  portfolio: ['Portfolio', `Dein Bestand mit Wertentwicklung, Vergleich zu Bitcoin, Reserve-Ziel und Modell-Schritten gehört zum Paket ${FULL}.`],
  trading: ['Daytrading-Muster', `Geprüfte Muster mit Einstieg, Ziel und Stopp gehören zum Paket ${FULL}.`],
};

export function upsell(kind) {
  const [title, text] = UPSELL[kind];
  return `<section class="panel upsell">
    <div><div class="label">Im Paket ${esc(FULL)} enthalten</div><h3>${title}</h3><p class="muted">${esc(text)}</p></div>
    <div class="btn-row"><a class="btn" href="#/preise">Pakete ansehen</a></div>
  </section>`;
}

// ---------- Preise: zugleich die Seite, die ohne Abo überall erscheint ----------

const FAQ = [
  [`Was ist der Unterschied zwischen ${STD} und ${FULL}?`, `${STD} zeigt den Markt: Markt-Index, Signale und Aussicht für alle 1000 Coins, die stärksten Kaufsignale und die Detailansichten. ${FULL} enthält zusätzlich das Portfolio mit Wertentwicklung, Reserve-Ziel und Modell-Schritten sowie die Daytrading-Muster.`],
  ['Gibt es eine kostenlose Version oder eine Testzeit?', SITE.trialDays > 0
    ? `Ja: Mit einem neuen Konto kannst du ${SITE.trialDays} Tage lang alle Funktionen kostenlos testen, ohne Zahlungsdaten. Danach endet der Zugang von selbst; ein Abo schließt du nur ab, wenn du ein Paket wählst.`
    : 'Nein. Dafür ist das Abo monatlich kündbar, und du kannst den Kauf 14 Tage lang widerrufen.'],
  ['Ist das eine Anlageberatung?', `Nein. ${SITE.name} ist ein Informationsdienst. Alle sehen dieselben Signale; sie berücksichtigen weder dein Vermögen noch deine Ziele oder deine Erfahrung. Was du kaufst oder verkaufst, entscheidest du allein.`],
  ['Wie gut sind die Signale?', 'Ehrlich: Ein „Eher kaufen“ ist ein schwaches Signal – in der Prüfung lief etwas mehr als jeder zweite Fall ins Plus. Der Vorteil entsteht über viele Käufe, nicht beim einzelnen. Die Erfolgskontrolle zeigt, was aus den Signalen der Seite tatsächlich geworden ist.'],
  ['Versprecht ihr Gewinne?', 'Nein. Kurse lassen sich nicht sicher vorhersagen. Die Rückrechnungen beruhen auf vergangenen Kursen und fallen besser aus als die Wirklichkeit, weil sie nur Coins enthalten, die es heute noch gibt.'],
  ['Habt ihr Zugriff auf mein Geld oder mein Börsenkonto?', 'Nein. Du trägst deine Bestände selbst ein oder importierst eine Tabelle. Es gibt keine Verbindung zu einer Börse, und die Seite führt keine Käufe oder Verkäufe aus.'],
  ['Wie kündige ich?', 'Jederzeit zum Ende des bezahlten Monats, ohne Frist. Dein Portfolio bleibt danach gespeichert, bis du dein Konto löschst.'],
  ['Welche Daten speichert ihr?', 'Deine E-Mail-Adresse für die Anmeldung, das Portfolio, das du einträgst, und eine einfache Nutzungsstatistik deines Kontos (wann und welche Bereiche du nutzt). Keine Werbe-Cookies, keine Analyse-Dienste von Dritten. Im Konto kannst du alles löschen.'],
];

export function pricingView(el, { access, user, record }) {
  let shown = null;
  function render() {
    const a = access();
    const manage = (label, otherwise) => (SITE.manageUrl ? `<a class="btn ghost" href="${esc(SITE.manageUrl)}" target="_blank" rel="noopener">${label}</a>` : otherwise);
    const button = (key) => {
      const plan = SITE.plans[key];
      if (a.reason === 'open' || a.reason === 'owner') return '<span class="muted">Für dich freigeschaltet.</span>';
      if (a.reason === 'trial') return '<span class="muted">In deiner Testphase freigeschaltet.</span>';
      if (!user() && SITE.trialDays > 0) return `<a class="btn" href="#/konto">${SITE.trialDays} Tage kostenlos testen</a>`;
      if (a.reason === 'paid') return a.plan === key ? `<span class="badge buy">Dein Paket</span> ${manage('Abo verwalten', '')}`
        : manage('Paket wechseln', '<span class="muted">Wechsel über die Abo-Verwaltung deines Zahlungsanbieters.</span>');
      if (!selling()) return '<span class="muted">Der Verkauf startet in Kürze.</span>';
      if (!user()) return '<a class="btn" href="#/konto">Konto erstellen und abonnieren</a>';
      // Die Konto-Kennung geht mit, damit die Zahlung dem Konto zugeordnet werden kann
      const url = `${plan.checkout}${plan.checkout.includes('?') ? '&' : '?'}custom=${encodeURIComponent(user().uid)}`;
      return `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${esc(plan.name)} abonnieren</a>`;
    };
    const until = a.until ? ` bis ${new Date(a.until).toLocaleDateString(settings.locale)}` : '';
    const status = a.reason === 'paid' ? `<p class="notice ok">Dein Paket ${esc(SITE.plans[a.plan].name)} ist aktiv${until}${a.cancel ? ' und verlängert sich nicht mehr' : ''}.</p>`
      : a.reason === 'owner' ? '<p class="notice ok">Betreiber-Zugang: Alle Funktionen sind für dich freigeschaltet.</p>'
      : a.reason === 'open' ? '<p class="notice">Die Bezahlschranke ist ausgeschaltet – alle Funktionen sind offen.</p>'
      : a.reason === 'trial' ? `<p class="notice ok">Deine kostenlose Testphase läuft${until} – alle Funktionen sind freigeschaltet. Danach endet der Zugang von selbst.</p>`
      : a.reason === 'expired' ? `<p class="notice">Deine kostenlose Testphase ist abgelaufen${until ? ` (${new Date(a.until).toLocaleDateString(settings.locale)})` : ''}. Wähle ein Paket, um weiterzumachen.</p>`
      : a.reason === 'none' ? '<p class="notice">Für dein Konto läuft kein Abo. Wähle ein Paket, um die Inhalte zu sehen.</p>' : '';
    const rec = record?.();
    const measured = !rec ? '' : `<section class="panel"><div class="label">Erfolgskontrolle – offen nachgemessen</div>
      <p>${rec.d7 ? `Kaufsignale der Seite seit ${new Date(rec.since * 86_400_000).toLocaleDateString(settings.locale)}: nach 7 Tagen im Schnitt <strong>${signed(rec.d7.avg, 1)} %</strong>,
        ${rec.d7.up} von ${rec.d7.n} im Plus (Bitcoin im selben Zeitraum ${signed(rec.d7.btc, 1)} %).`
        : `Jedes Kaufsignal der Seite wird seit ${new Date(rec.since * 86_400_000).toLocaleDateString(settings.locale)} nach 7 und 30 Tagen nachgemessen. Erste Ergebnisse erscheinen 7 Tage nach den ersten Signalen.`}</p></section>`;
    const yes = (t) => `<li class="yes">${t}</li>`;
    const card = (key, featured, hint, list) => `<section class="panel plan${featured ? ' featured' : ''}">
        <div class="label">${esc(SITE.plans[key].name)}</div>
        <div class="plan-price">${price(SITE.plans[key].price)}<small> pro Monat</small></div>
        <p class="muted">${hint}</p>
        <ul class="plan-list">${list.map(yes).join('')}</ul>
        <div class="plan-cta">${button(key)}</div>
      </section>`;
    el.innerHTML = `${a.plan ? '' : landing(!!user())}
      <div class="page-head" id="plans"><div><h1 class="page-title">Pakete und Preise</h1>
        <p class="hint">Zwei Pakete, monatliche Abrechnung, jederzeit zum Monatsende kündbar.</p></div></div>
      ${status}
      <div class="plans">
        ${card('standard', false, 'Der Markt im Überblick.', ['Markt-Index „Jetzt kaufen?“, Fear &amp; Greed und Zyklus',
          'Signale und Aussicht für alle 1000 Coins', 'Die stärksten Kaufsignale auf einen Blick', 'Detailansicht mit Score-Bausteinen und Rückblick'])}
        ${card('full', true, 'Der Markt, dein Portfolio und Daytrading.', [`Alles aus ${esc(STD)}`, 'Portfolio mit Wertentwicklung und Vergleich zu Bitcoin',
          'Reserve-Ziel und Modell-Schritte für dein Portfolio', 'Import und Export als Tabelle', 'Daytrading-Muster mit Einstieg, Ziel und Stopp'])}
      </div>
      ${SITE.trialDays > 0 ? `<p class="hint">Neue Konten können alle Funktionen ${SITE.trialDays} Tage kostenlos testen – ohne Zahlungsdaten. Die Testphase endet von selbst.</p>` : ''}
      <p class="hint">Preise pro Monat inklusive Mehrwertsteuer. Das Abo verlängert sich jeweils um einen Monat, bis du kündigst. 14 Tage Widerrufsrecht.
        Es gelten die <a href="#/agb">AGB</a> und der <a href="#/risiko">Risikohinweis</a>. ${esc(SITE.name)} ist keine Anlageberatung.</p>
      ${measured}
      <h2>Häufige Fragen</h2>
      <div class="faq">${FAQ.map(([q, t]) => `<details class="panel"><summary>${esc(q)}</summary><p>${esc(t)}</p></details>`).join('')}</div>`;
    el.querySelector('[data-to-plans]')?.addEventListener('click', () => el.querySelector('#plans').scrollIntoView({ behavior: 'smooth' }));
  }
  // Nur neu aufbauen, wenn sich am Zugang etwas ändert – sonst klappten geöffnete Fragen bei jeder Kursaktualisierung zu
  function update() {
    const a = access(), rec = record?.();
    const key = JSON.stringify([a.plan, a.reason, a.until, a.cancel, user()?.uid, selling(), rec?.since, rec?.d7?.n]);
    if (key === shown) return;
    shown = key;
    render();
  }
  return { update };
}

// ---------- Rechtstexte ----------

const missing = () => (operatorReady() ? '' : `<p class="notice"><strong>Die Angaben des Betreibers sind noch nicht eingetragen.</strong>
  Bis dahin ist das Angebot nicht zum Verkauf freigegeben.</p>`);

const address = () => `<p>${or(op.name, 'Name oder Firma des Betreibers')}<br>${or(op.street, 'Strasse und Hausnummer')}<br>${or(op.city, 'PLZ und Ort')}<br>${esc(op.country)}</p>
  <p>E-Mail: ${op.email ? `<a href="mailto:${esc(op.email)}">${esc(op.email)}</a>` : or('', 'E-Mail-Adresse')}${op.register ? `<br>${esc(op.register)}` : ''}</p>`;

const RISK_POINTS = `
  <ul>
    <li><strong>Keine Anlageberatung.</strong> ${SITE.name} ist ein Informationsdienst. Alle Nutzer sehen dieselben Signale. Sie berücksichtigen weder dein Vermögen
      noch deine Ziele, deine Kenntnisse oder deine Risikobereitschaft und sind keine persönliche Empfehlung, etwas zu kaufen, zu halten oder zu verkaufen.</li>
    <li><strong>Totalverlust möglich.</strong> Kryptowerte schwanken stark und können wertlos werden. Setze nur Geld ein, dessen Verlust du verkraften kannst.</li>
    <li><strong>Hebel vervielfacht Verluste.</strong> Beim Handel mit Hebel kann der gesamte Einsatz innerhalb von Minuten verloren gehen.
      Die Angaben unter „Daytrading“ sind Rechenbeispiele aus Rückrechnungen, keine Aufforderung zum Handel.</li>
    <li><strong>Modelle können falsch liegen.</strong> Signale, Aussichten und Reserve-Ziel beruhen auf vergangenen Kursen. Die Rückrechnungen enthalten nur Coins,
      die es heute noch gibt, und die Regeln wurden an denselben Jahren ausgewählt, an denen sie gemessen sind. Echte Ergebnisse fallen schlechter aus.
      Frühere Ergebnisse sagen nichts Verlässliches über künftige.</li>
    <li><strong>Der Portfolio-Manager rechnet, er rät nicht.</strong> Er wendet feste Regeln auf den Bestand an, den du einträgst. Er kennt deine übrige Lage nicht,
      erteilt keine Aufträge und führt nichts aus. Jede Entscheidung triffst du selbst.</li>
    <li><strong>Daten können fehlen oder falsch sein.</strong> Kurse und Kennzahlen stammen von Dritten und können verzögert, unvollständig oder fehlerhaft sein.</li>
    <li><strong>Steuern und Recht.</strong> Gewinne können steuerpflichtig sein. Ob und wie du Kryptowerte handeln darfst, hängt von deinem Wohnsitz ab.</li>
  </ul>`;

const LEGAL = {
  impressum: () => ['Impressum', `${missing()}
    <h3>Betreiber</h3>${address()}
    <h3>Keine Anlageberatung</h3>
    <p>${SITE.name} stellt allgemeine Informationen bereit und erbringt keine Anlageberatung, Vermögensverwaltung oder Vermittlung. Einzelheiten stehen im <a href="#/risiko">Risikohinweis</a>.</p>
    <h3>Inhalte und Verweise</h3>
    <p>Die Inhalte werden sorgfältig erstellt, eine Gewähr für Richtigkeit, Vollständigkeit und Aktualität gibt es nicht. Für Inhalte verlinkter fremder Seiten ist deren Betreiber verantwortlich.</p>
    <h3>Daten</h3>
    <p>Data provided by <a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener">CoinGecko</a> · Kursgeschichte: Binance, Gate.io ·
      Fear &amp; Greed Index: <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener">alternative.me</a> · Nachrichten: cryptocurrency.cv</p>`],

  risiko: () => ['Risikohinweis', `<p class="lead">Bitte lies diesen Hinweis, bevor du dich auf ein Signal verlässt.</p>${RISK_POINTS}`],

  agb: () => ['Allgemeine Geschäftsbedingungen', `${missing()}
    <h3>1. Anbieter und Geltung</h3>
    <p>Diese Bedingungen gelten für die Nutzung von ${SITE.name}. Anbieter ist ${or(op.name, 'Name oder Firma des Betreibers')}, ${or(op.street, 'Strasse')}, ${or(op.city, 'PLZ und Ort')}, ${esc(op.country)}.</p>
    <h3>2. Leistung</h3>
    <p>${SITE.name} ist ein Informationsdienst zu Kryptowerten: Kurse, modellbasierte Signale und Auswertungen sowie ein Werkzeug, mit dem du ein selbst eingetragenes Portfolio verfolgen kannst.
      Der Anbieter erbringt <strong>keine Anlageberatung, keine Vermögensverwaltung und keine Vermittlung</strong>, nimmt keine Gelder entgegen, hat keinen Zugriff auf Börsenkonten und führt keine Aufträge aus.
      Alle Inhalte sind allgemeine Informationen für alle Nutzer und keine persönliche Empfehlung. Es gilt der <a href="#/risiko">Risikohinweis</a>.</p>
    <h3>3. Konto</h3>
    <p>Für das Abo brauchst du ein Konto. Du musst volljährig sein, richtige Angaben machen und deine Zugangsdaten geheim halten. Ein Konto ist für eine Person bestimmt.</p>
    <h3>4. Abo und Preise</h3>
    <p>Die Inhalte stehen im Abo${SITE.trialDays > 0 ? ' oder während der kostenlosen Testphase' : ''} zur Verfügung. Es gibt die Pakete ${esc(STD)} und ${esc(FULL)}; Umfang und Preise stehen unter <a href="#/preise">Preise</a>.
      Die Preise gelten pro Monat und enthalten die gesetzliche Mehrwertsteuer.</p>
    <p>Das Abo läuft einen Monat und verlängert sich jeweils um einen weiteren Monat, bis es gekündigt wird. Die Zahlung wird monatlich im Voraus fällig und über
      ${SITE.paymentProvider ? esc(SITE.paymentProvider) : 'einen Zahlungsanbieter oder Wiederverkäufer'} abgewickelt, der beim Kauf genannt wird.</p>
    ${SITE.trialDays > 0 ? `<p>Neue Konten können alle Funktionen ${SITE.trialDays} Tage ab dem Erstellen des Kontos kostenlos nutzen. Dafür sind keine Zahlungsdaten nötig.
      Die Testphase endet von selbst und geht nicht in ein kostenpflichtiges Abo über. Je Person ist eine Testphase vorgesehen; der Anbieter kann das Angebot für neue Konten ändern oder beenden.</p>` : ''}
    <h3>5. Kündigung</h3>
    <p>Du kannst das Abo jederzeit zum Ende des bezahlten Monats kündigen – über die Verwaltung deines Abos oder per E-Mail an die oben genannte Adresse. Dein Konto kannst du jederzeit unter „Konto“ löschen.
      Der Anbieter kann den Zugang sperren oder kündigen, wenn gegen diese Bedingungen verstoßen wird; bereits bezahlte Entgelte für die Zeit danach werden dann anteilig erstattet, sofern die Sperre nicht auf einem schuldhaften Verstoß beruht.</p>
    <h3>6. Widerrufsrecht</h3>
    <p>Als Verbraucher kannst du den Abschluss des Abos innerhalb von 14 Tagen ohne Angabe von Gründen widerrufen. Dafür genügt eine eindeutige Erklärung per E-Mail an die oben genannte Adresse
      oder an den beim Kauf genannten Zahlungsanbieter. Bereits geleistete Zahlungen werden innerhalb von 14 Tagen nach Eingang des Widerrufs erstattet.</p>
    <h3>7. Nutzung</h3>
    <p>Die Inhalte sind für deinen persönlichen Gebrauch bestimmt. Nicht erlaubt ist es, Signale oder Auswertungen weiterzuverkaufen, gesammelt zu veröffentlichen oder automatisiert auszulesen.</p>
    <h3>8. Verfügbarkeit und Änderungen</h3>
    <p>Der Dienst wird laufend weiterentwickelt; Modelle, Regeln und Funktionen können sich ändern. Eine ununterbrochene Verfügbarkeit wird nicht zugesagt. Kurse und Kennzahlen stammen von Dritten
      und können verzögert, unvollständig oder fehlerhaft sein.</p>
    <h3>9. Keine Gewähr für Ergebnisse</h3>
    <p>Signale, Aussichten, Reserve-Ziele und Rückrechnungen sind Ergebnisse von Rechenmodellen auf der Grundlage vergangener Kurse. Der Anbieter sagt keinen Erfolg zu.
      Entscheidungen über Käufe und Verkäufe triffst du auf eigenes Risiko.</p>
    <h3>10. Haftung</h3>
    <p>Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit sowie dort, wo das Gesetz eine Haftung zwingend vorschreibt.
      Im Übrigen ist die Haftung ausgeschlossen, soweit das Gesetz es zulässt – insbesondere für Kursverluste, entgangene Gewinne und andere Folgen von Anlageentscheidungen
      sowie für fehlerhafte oder verspätete Daten Dritter. Soweit eine Haftung bei leichter Fahrlässigkeit nicht ausgeschlossen werden kann, ist sie auf den vorhersehbaren, vertragstypischen Schaden begrenzt,
      höchstens auf die Entgelte, die du in den zwölf Monaten vor dem Schadensfall bezahlt hast.</p>
    <h3>11. Datenschutz</h3>
    <p>Wie mit deinen Daten umgegangen wird, steht in der <a href="#/datenschutz">Datenschutzerklärung</a>.</p>
    <h3>12. Änderungen dieser Bedingungen</h3>
    <p>Ändern sich diese Bedingungen wesentlich, wirst du beim nächsten Anmelden um Zustimmung gebeten. Stimmst du nicht zu, kannst du das Abo zum Ende des bezahlten Monats kündigen.</p>
    <h3>13. Recht und Gerichtsstand</h3>
    <p>Es gilt das Recht des Staates, in dem der Anbieter seinen Sitz hat (${esc(op.country)}), unter Ausschluss des UN-Kaufrechts. Zwingende Schutzvorschriften des Staates, in dem du als Verbraucher wohnst, bleiben unberührt.
      Gerichtsstand ist der Sitz des Anbieters, soweit das Gesetz nichts anderes vorschreibt.</p>
    <h3>14. Schlussbestimmung</h3>
    <p>Ist eine Bestimmung unwirksam, bleiben die übrigen gültig. Maßgeblich ist die deutsche Fassung dieser Bedingungen. Übersetzungen dienen nur dem Verständnis.</p>`],

  datenschutz: () => ['Datenschutzerklärung', `${missing()}
    <h3>Verantwortlich</h3>${address()}
    <h3>Kurz gesagt</h3>
    <p>${SITE.name} verwendet keine Werbe-Cookies und keine Analyse-Dienste von Dritten. Gespeichert wird, was für Anmeldung, Portfolio und Abo nötig ist, und – nur mit Konto – eine einfache Nutzungsstatistik.</p>
    <h3>Welche Daten verarbeitet werden</h3>
    <ul>
      <li><strong>Aufruf der Seite:</strong> Der Hosting-Anbieter (${esc(SITE.hosting)}) verarbeitet technisch nötige Daten wie IP-Adresse, Zeitpunkt und Browser, um die Seite auszuliefern.</li>
      <li><strong>Konto:</strong> E-Mail-Adresse und ein verschlüsselt gespeichertes Passwort oder – bei Anmeldung mit Google – Name und E-Mail-Adresse deines Google-Kontos.
        Anmeldung und Speicherung laufen über Firebase (Google Ireland Limited / Google LLC).</li>
      <li><strong>Portfolio:</strong> die Bestände, Kaufpreise und Einstellungen, die du einträgst, der Verlauf deiner Änderungen sowie Zeitpunkt und Stand deiner Zustimmung zu AGB und Risikohinweis.</li>
      <li><strong>Nutzung (nur mit Konto):</strong> wann du die Seite zuerst und zuletzt genutzt hast, wie oft, welche Bereiche und Coins du aufrufst, die letzten 20 aufgerufenen Seiten,
        über welchen Werbe-Link du gekommen bist, Sprache, Währung und ob du ein Handy oder einen Computer verwendest. Der Betreiber sieht diese Angaben zusammen mit deiner E-Mail-Adresse und deinem Portfolio, um Konten zu betreuen,
        Fehler zu finden und das Angebot zu verbessern. Sie werden mit deinem Konto gelöscht.</li>
      <li><strong>Abo:</strong> Die Zahlung wickelt ${SITE.paymentProvider ? esc(SITE.paymentProvider) : 'ein Zahlungsanbieter'} ab. Der Anbieter erhält von dort keine Kartendaten, sondern nur, ob und bis wann dein Abo läuft.</li>
      <li><strong>In deinem Browser:</strong> Einstellungen, eine Kopie deines Portfolios und die Anmeldung werden lokal gespeichert, damit die Seite funktioniert.</li>
    </ul>
    <h3>Abrufe bei Dritten</h3>
    <p>Kurse, Coin-Bilder, Kursgeschichte, Stimmungsindex und Nachrichten lädt dein Browser direkt bei CoinGecko, Binance, Gate.io, alternative.me, cryptocurrency.cv, GitHub und Google.
      Dabei erfahren diese Anbieter technisch bedingt deine IP-Adresse. Weitere Daten von dir werden dabei nicht übermittelt.</p>
    <h3>Zwecke und Rechtsgrundlagen</h3>
    <p>Die Daten werden verarbeitet, um den Dienst bereitzustellen und den Vertrag mit dir zu erfüllen, um gesetzliche Pflichten einzuhalten und auf Grundlage des berechtigten Interesses
      an einem sicheren und funktionierenden Betrieb.</p>
    <h3>Empfänger und Übermittlung ins Ausland</h3>
    <p>Die genannten Dienstleister verarbeiten Daten auch außerhalb der Schweiz und der EU, insbesondere in den USA. Die Übermittlung stützt sich auf Angemessenheitsbeschlüsse
      (Data Privacy Framework) oder Standardvertragsklauseln.</p>
    <h3>Speicherdauer</h3>
    <p>Konto und Portfolio bleiben gespeichert, bis du dein Konto löschst. Das geht jederzeit unter „Konto“. Zahlungsbelege werden so lange aufbewahrt, wie das Gesetz es vorschreibt.</p>
    <h3>Deine Rechte</h3>
    <p>Du kannst Auskunft, Berichtigung, Löschung und Herausgabe deiner Daten verlangen sowie der Verarbeitung widersprechen. Dein Portfolio kannst du selbst als Tabelle exportieren.
      Wende dich dafür an die oben genannte Adresse. Du kannst dich außerdem bei der zuständigen Aufsichtsbehörde beschweren – in der Schweiz beim EDÖB, in der EU bei der Datenschutzbehörde deines Wohnsitzes.</p>
    <h3>Keine automatisierten Entscheidungen</h3>
    <p>Es werden keine Entscheidungen mit rechtlicher Wirkung für dich automatisiert getroffen. Die Modell-Schritte im Portfolio sind Rechenergebnisse, über die du selbst entscheidest.</p>`],
};

export function legalView(el, kind) {
  return { update() {
    const [title, body] = LEGAL[kind]();
    el.innerHTML = `<article class="legal"><h1 class="page-title">${title}</h1>
      <p class="hint">Stand: ${dateText(SITE.legalVersion)}</p>${body}</article>`;
  } };
}

export const LEGAL_KINDS = Object.keys(LEGAL);

// ---------- Zustimmung nach dem ersten Anmelden ----------

export const consentHtml = () => `<h2>Bevor es losgeht</h2>
  <p>${esc(SITE.name)} ist ein Informationsdienst und <strong>keine Anlageberatung</strong>. Bitte bestätige, dass du das verstanden hast:</p>
  ${RISK_POINTS}
  <p>Mit „Ich stimme zu“ akzeptierst du die <a href="#/agb" target="_blank">AGB</a> und bestätigst, dass du den <a href="#/risiko" target="_blank">Risikohinweis</a>
    und die <a href="#/datenschutz" target="_blank">Datenschutzerklärung</a> gelesen hast und volljährig bist.</p>`;

// Kurzer Hinweis vor Bereichen mit erhöhtem Risiko (Hebel)
export const tradingRiskHtml = () => `<h2>Hinweis zum Daytrading</h2>
  <p>Dieser Bereich zeigt Muster aus Rückrechnungen mit Einstieg, Ziel, Stopp und einem rechnerisch höchsten Hebel.</p>
  <ul><li>Das sind <strong>Rechenbeispiele, keine Aufforderung zum Handel</strong> und keine persönliche Empfehlung.</li>
    <li>Mit Hebel kann der gesamte Einsatz innerhalb von Minuten verloren gehen.</li>
    <li>Auch beim besten Muster endete etwa jeder sechste Handel im Minus; im jüngsten Abschnitt waren die Ergebnisse schwächer.</li></ul>
  <p>Mit „Verstanden“ bestätigst du, dass du auf eigenes Risiko handelst.</p>`;
