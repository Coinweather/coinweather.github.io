// Seiten rund um das Angebot: Einstieg, Preise, Rechtstexte und die Hinweise auf das Abo.
// Die Texte zu Recht und Risiko sind Vorlagen – vor dem Verkauf von einer Fachperson prüfen lassen (siehe GO-LIVE.md).

import { SITE, operatorReady, selling } from './config.js';
import { esc, num } from './util.js';

const eur = (x) => `${num(x, Number.isInteger(x) ? 0 : 2)} €`;
const dateText = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const op = SITE.operator;
const or = (value, placeholder) => (value ? esc(value) : `<span class="todo">[${placeholder}]</span>`);

// ---------- Einstieg auf der Marktübersicht (nur ohne Anmeldung) ----------

export function landing() {
  const free = !SITE.paywall;
  return `<section class="intro">
    <div class="intro-text">
      <span class="intro-tag">${free ? 'Einführungsphase – derzeit kostenlos' : `${SITE.trialDays} Tage kostenlos testen`}</span>
      <h1>${esc(SITE.claim)}.</h1>
      <p class="lead">${esc(SITE.name)} zeigt für 1000 Coins, wie die Aussichten stehen – als Wahrscheinlichkeit, nicht als Versprechen.
        Jede Regel ist an Kursen seit 2018 geprüft, und was aus den Signalen wird, messen wir offen nach.</p>
      <div class="btn-row">
        <a class="btn" href="#/konto">${free ? 'Kostenlos starten' : 'Kostenlos testen'}</a>
        <a class="btn ghost" href="#/preise">Preise und Leistungen</a>
      </div>
      <p class="intro-note">Keine Anlageberatung. Kryptowerte können stark fallen – bis zum Totalverlust.</p>
    </div>
    <ul class="intro-points">
      <li><strong>Signale mit Trefferquote</strong><span>Zu jedem Signal steht, wie oft vergleichbare Fälle im Plus endeten.</span></li>
      <li><strong>Großwetterlage</strong><span>Markt-Index, Fear &amp; Greed und Zyklus – wann das Modell kauft und wann es abwartet.</span></li>
      <li><strong>Portfolio mit Reserve-Ziel</strong><span>Wertentwicklung, Vergleich mit Bitcoin und Modell-Schritte nach festen Regeln.</span></li>
      <li><strong>Offene Erfolgskontrolle</strong><span>Jedes Kaufsignal wird nach 7 und 30 Tagen nachgemessen – auch die schlechten.</span></li>
    </ul>
  </section>`;
}

// ---------- Hinweis auf das Abo an gesperrten Stellen ----------

const UPSELL = {
  coin: ['Signal und Aussicht für diesen Coin', `Ohne Abo zeigt ${SITE.name} Signale für die ${SITE.freeCoins} größten Coins. Mit dem Abo siehst du Signal, Aussicht und Rückblick für alle 1000.`],
  picks: ['Die stärksten Kaufsignale', 'Welche Coins im Modell gerade am besten abschneiden, gehört zum Abo.'],
  trading: ['Daytrading-Muster', 'Geprüfte Muster mit Einstieg, Ziel und Stopp gehören zum Abo.'],
  manager: ['Reserve-Ziel und Modell-Schritte', 'Was das Modell nach seinen Regeln für deinen Bestand vorsieht, gehört zum Abo. Dein Portfolio und seine Wertentwicklung bleiben sichtbar.'],
};

export function upsell(kind, access) {
  const [title, text] = UPSELL[kind];
  const guest = access.reason === 'guest';
  return `<section class="panel upsell">
    <div><div class="label">Im Abo enthalten</div><h3>${title}</h3><p class="muted">${text}</p></div>
    <div class="btn-row"><a class="btn" href="${guest ? '#/konto' : '#/preise'}">${guest ? `${SITE.trialDays} Tage kostenlos testen` : 'Abo ansehen'}</a></div>
  </section>`;
}

// ---------- Preise ----------

const FAQ = [
  ['Ist das eine Anlageberatung?', `Nein. ${SITE.name} ist ein Informationsdienst. Alle sehen dieselben Signale; sie berücksichtigen weder dein Vermögen noch deine Ziele oder deine Erfahrung. Was du kaufst oder verkaufst, entscheidest du allein.`],
  ['Wie gut sind die Signale?', 'Ehrlich: Ein „Eher kaufen“ ist ein schwaches Signal – in der Prüfung lief etwas mehr als jeder zweite Fall ins Plus. Der Vorteil entsteht über viele Käufe, nicht beim einzelnen. Unter „Erfolgskontrolle“ auf der Startseite steht, was aus den Signalen der Seite tatsächlich geworden ist.'],
  ['Versprecht ihr Gewinne?', 'Nein. Kurse lassen sich nicht sicher vorhersagen. Die Rückrechnungen beruhen auf vergangenen Kursen und fallen besser aus als die Wirklichkeit, weil sie nur Coins enthalten, die es heute noch gibt.'],
  ['Habt ihr Zugriff auf mein Geld oder mein Börsenkonto?', 'Nein. Du trägst deine Bestände selbst ein oder importierst eine Tabelle. Es gibt keine Verbindung zu einer Börse, und die Seite führt keine Käufe oder Verkäufe aus.'],
  ['Kann ich jederzeit kündigen?', 'Ja, zum Ende der bezahlten Laufzeit – ohne Frist. Dein Portfolio bleibt danach gespeichert, bis du dein Konto löschst.'],
  ['Welche Daten speichert ihr?', 'Deine E-Mail-Adresse für die Anmeldung und das Portfolio, das du einträgst. Kein Tracking, keine Werbe-Cookies. Im Konto kannst du alles exportieren und löschen.'],
];

export function pricingView(el, { access, user }) {
  function render() {
    const a = access();
    const m = SITE.plans.monthly, y = SITE.plans.yearly;
    const perMonth = y.price / 12;
    const link = (plan) => {
      if (a.reason === 'paid') return SITE.manageUrl ? `<a class="btn ghost" href="${esc(SITE.manageUrl)}" target="_blank" rel="noopener">Abo verwalten</a>` : '<span class="muted">Dein Abo ist aktiv.</span>';
      if (!SITE.paywall) return `<a class="btn" href="${user() ? '#/' : '#/konto'}">${user() ? 'Zur Marktübersicht' : 'Kostenlos starten'}</a>`;
      if (!selling()) return '<span class="muted">Das Abo ist noch nicht buchbar.</span>';
      if (!user()) return `<a class="btn" href="#/konto">${SITE.trialDays} Tage kostenlos testen</a>`;
      // Die Konto-Kennung geht mit, damit die Zahlung dem Konto zugeordnet werden kann
      const url = `${plan.checkout}${plan.checkout.includes('?') ? '&' : '?'}custom=${encodeURIComponent(user().uid)}`;
      return `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Jetzt abonnieren</a>`;
    };
    const status = a.reason === 'paid' ? `<p class="notice ok">Dein Abo ist aktiv${a.until ? ` bis ${new Date(a.until).toLocaleDateString('de-DE')}` : ''}${a.cancel ? ' und verlängert sich nicht mehr' : ''}.</p>`
      : a.reason === 'trial' ? `<p class="notice ok">Deine Testzeit läuft bis ${new Date(a.until).toLocaleDateString('de-DE')}. Bis dahin sind alle Funktionen frei.</p>`
      : a.reason === 'expired' ? '<p class="notice">Deine Testzeit ist abgelaufen. Mit einem Abo sind wieder alle Funktionen frei.</p>'
      : !SITE.paywall ? '<p class="notice ok"><strong>Einführungsphase:</strong> Zurzeit sind alle Funktionen kostenlos. Die Preise unten gelten, sobald das Abo startet – wir kündigen das rechtzeitig an.</p>' : '';
    const yes = (t) => `<li class="yes">${t}</li>`;
    el.innerHTML = `<div class="page-head"><div><h1 class="page-title">Preise und Leistungen</h1>
        <p class="hint">Ein Abo, alle Funktionen. ${SITE.trialDays} Tage kostenlos testen, jederzeit kündbar.</p></div></div>
      ${status}
      <div class="plans">
        <section class="panel plan">
          <div class="label">Kostenlos</div>
          <div class="plan-price">0 €</div>
          <p class="muted">Zum Kennenlernen, ohne Zeitlimit.</p>
          <ul class="plan-list">${yes('Live-Kurse für 1000 Coins')}${yes('Markt-Index, Fear &amp; Greed und Zyklus')}
            ${yes(`Signale und Aussicht für die ${SITE.freeCoins} größten Coins`)}${yes('Erfolgskontrolle der Signale')}</ul>
          <div class="plan-cta"><a class="btn ghost" href="#/">Zur Marktübersicht</a></div>
        </section>
        <section class="panel plan featured">
          <div class="label">Abo · jährlich</div>
          <div class="plan-price">${eur(y.price)}<small> pro Jahr</small></div>
          <p class="muted">Entspricht ${eur(Math.round(perMonth * 100) / 100)} im Monat – ${num((1 - y.price / (m.price * 12)) * 100, 0)} % günstiger als monatlich.</p>
          <ul class="plan-list">${yes('Signale und Aussicht für alle 1000 Coins')}${yes('Detailansicht mit Score-Bausteinen und Rückblick')}
            ${yes('Portfolio mit Wertentwicklung und Vergleich zu Bitcoin')}${yes('Reserve-Ziel und Modell-Schritte nach festen Regeln')}
            ${yes('Daytrading-Muster mit Einstieg, Ziel und Stopp')}${yes('Import und Export als Tabelle')}</ul>
          <div class="plan-cta">${link(y)}</div>
        </section>
        <section class="panel plan">
          <div class="label">Abo · monatlich</div>
          <div class="plan-price">${eur(m.price)}<small> pro Monat</small></div>
          <p class="muted">Alle Funktionen, monatlich kündbar.</p>
          <ul class="plan-list">${yes('Alles aus dem Jahres-Abo')}${yes('Kündigung zum Monatsende')}</ul>
          <div class="plan-cta">${link(m)}</div>
        </section>
      </div>
      <p class="hint">Preise inklusive Mehrwertsteuer. Das Abo verlängert sich um die gewählte Laufzeit, bis du kündigst. 14 Tage Widerrufsrecht.
        Es gelten die <a href="#/agb">AGB</a> und der <a href="#/risiko">Risikohinweis</a>.</p>
      <h2>Häufige Fragen</h2>
      <div class="faq">${FAQ.map(([q, t]) => `<details class="panel"><summary>${q}</summary><p>${t}</p></details>`).join('')}</div>`;
  }
  return { update: render };
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
    <p>Data provided by <a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener">CoinGecko</a> · Kursgeschichte: Binance ·
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
    <p>Für Portfolio und Abo brauchst du ein Konto. Du musst volljährig sein, richtige Angaben machen und deine Zugangsdaten geheim halten. Ein Konto ist für eine Person bestimmt.</p>
    <h3>4. Kostenloser Zugang und Abo</h3>
    <p>Ein Teil der Inhalte ist kostenlos. Der volle Umfang steht im Abo zur Verfügung; Umfang und Preise stehen unter <a href="#/preise">Preise</a>. Die Preise enthalten die gesetzliche Mehrwertsteuer.
      Neue Konten können den vollen Umfang ${SITE.trialDays} Tage kostenlos testen; die Testzeit endet von selbst.</p>
    <p>Das Abo läuft je nach Wahl einen Monat oder ein Jahr und verlängert sich jeweils um dieselbe Laufzeit, bis es gekündigt wird. Die Zahlung wird im Voraus fällig und über
      ${SITE.paymentProvider ? esc(SITE.paymentProvider) : 'einen Zahlungsanbieter oder Wiederverkäufer'} abgewickelt, der beim Kauf genannt wird.</p>
    <h3>5. Kündigung</h3>
    <p>Du kannst das Abo jederzeit zum Ende der bezahlten Laufzeit kündigen – über die Verwaltung deines Abos oder per E-Mail an die oben genannte Adresse. Dein Konto kannst du jederzeit unter „Konto“ löschen.
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
    <p>Ändern sich diese Bedingungen wesentlich, wirst du beim nächsten Anmelden um Zustimmung gebeten. Stimmst du nicht zu, kannst du das Abo zum Ende der bezahlten Laufzeit kündigen.</p>
    <h3>13. Recht und Gerichtsstand</h3>
    <p>Es gilt das Recht des Staates, in dem der Anbieter seinen Sitz hat (${esc(op.country)}), unter Ausschluss des UN-Kaufrechts. Zwingende Schutzvorschriften des Staates, in dem du als Verbraucher wohnst, bleiben unberührt.
      Gerichtsstand ist der Sitz des Anbieters, soweit das Gesetz nichts anderes vorschreibt.</p>
    <h3>14. Schlussbestimmung</h3>
    <p>Ist eine Bestimmung unwirksam, bleiben die übrigen gültig.</p>`],

  datenschutz: () => ['Datenschutzerklärung', `${missing()}
    <h3>Verantwortlich</h3>${address()}
    <h3>Kurz gesagt</h3>
    <p>${SITE.name} verwendet keine Werbe-Cookies und kein Tracking. Gespeichert wird nur, was für Anmeldung, Portfolio und Abo nötig ist.</p>
    <h3>Welche Daten verarbeitet werden</h3>
    <ul>
      <li><strong>Aufruf der Seite:</strong> Der Hosting-Anbieter (${esc(SITE.hosting)}) verarbeitet technisch nötige Daten wie IP-Adresse, Zeitpunkt und Browser, um die Seite auszuliefern.</li>
      <li><strong>Konto:</strong> E-Mail-Adresse und ein verschlüsselt gespeichertes Passwort oder – bei Anmeldung mit Google – Name und E-Mail-Adresse deines Google-Kontos.
        Anmeldung und Speicherung laufen über Firebase (Google Ireland Limited / Google LLC).</li>
      <li><strong>Portfolio:</strong> die Bestände, Kaufpreise und Einstellungen, die du einträgst, der Verlauf deiner Änderungen sowie Zeitpunkt und Stand deiner Zustimmung zu AGB und Risikohinweis.</li>
      <li><strong>Abo:</strong> Die Zahlung wickelt ${SITE.paymentProvider ? esc(SITE.paymentProvider) : 'ein Zahlungsanbieter'} ab. Der Anbieter erhält von dort keine Kartendaten, sondern nur, ob und bis wann dein Abo läuft.</li>
      <li><strong>In deinem Browser:</strong> Einstellungen, eine Kopie deines Portfolios und die Anmeldung werden lokal gespeichert, damit die Seite funktioniert.</li>
    </ul>
    <h3>Abrufe bei Dritten</h3>
    <p>Kurse, Coin-Bilder, Kursgeschichte, Stimmungsindex und Nachrichten lädt dein Browser direkt bei CoinGecko, Binance, alternative.me, cryptocurrency.cv, GitHub und Google.
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
