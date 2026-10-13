// Alles, was das Angebot betrifft: Name, Betreiber, Preise und Bezahlung – an einer Stelle.
// Die Schritte bis zum Verkauf stehen in GO-LIVE.md.

export const SITE = {
  name: 'Coinwetter',
  claim: 'Die Wetterlage am Kryptomarkt',

  // Betreiber – Pflichtangaben für Impressum, AGB und Datenschutz.
  // Solange Name, Adresse oder E-Mail fehlen, bleibt der Verkauf gesperrt und die Rechtstexte zeigen einen Hinweis.
  operator: {
    name: '',          // Vor- und Nachname oder Firma
    street: '',        // Strasse und Hausnummer
    city: '',          // PLZ und Ort
    country: 'Schweiz',
    email: '',         // Kontakt-Adresse für Kunden
    register: '',      // UID / Handelsregister-Nummer, falls vorhanden
  },

  // Stand der Rechtstexte. Ändert sich das Datum, werden angemeldete Nutzer erneut um Zustimmung gebeten.
  legalVersion: '2026-10-12',
  hosting: 'GitHub Pages (GitHub Inc., USA)',

  // Abo: zwei Pakete, monatliche Abrechnung, kein kostenloser Umfang. Preise inklusive Mehrwertsteuer.
  // Standard zeigt den Markt (Index, Signale, Detailansichten), Komplett zusätzlich Portfolio und Daytrading.
  paywall: true,       // true: Inhalte nur mit Abo. false: alles offen – nur zum Entwickeln
  currency: 'EUR',     // Währung, in der das Abo verkauft wird
  plans: {
    standard: { name: 'Standard', price: 3.99, checkout: '' },   // checkout: Bezahl-Link des Zahlungsanbieters
    full: { name: 'Komplett', price: 7.99, checkout: '' },
  },
  manageUrl: '',       // Seite des Zahlungsanbieters, auf der Kunden kündigen und Rechnungen abrufen
  paymentProvider: '', // Name des Zahlungsanbieters, erscheint in AGB und Datenschutz

  // Betreiber-Zugang ohne Abo: Konto-Kennungen (stehen unter „Konto“) …
  owners: ['nxsRHSRqofXDVi6cmYhZXTr3csq1'],
  // … oder bestätigte E-Mail-Adressen, hinterlegt als SHA-256-Prüfsumme, damit die Adresse nicht im Quelltext steht
  ownerMails: ['f8a5c29ce669607b870a6bc7a3bebfabae03515d0efbb5d48c9a7ad69be1f268', '941589d9f0ffe173319979b71000b2c6c8563d1e3dcc1d995fa22724dff304e5'],
};

// Lokaler Testbetrieb: Bezahlschranke und Betreiberangaben lassen sich auf localhost zum Prüfen einschalten
try {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const test = JSON.parse(localStorage.getItem('coinwetter-test') ?? 'null');
    if (test) Object.assign(SITE, test, { operator: { ...SITE.operator, ...test.operator }, plans: { ...SITE.plans, ...test.plans } });
  }
} catch { /* ohne Zugriff auf den Speicher gilt die Einstellung oben */ }

// Sind die Pflichtangaben des Betreibers vollständig?
export const operatorReady = () => !!(SITE.operator.name && SITE.operator.street && SITE.operator.city && SITE.operator.email);

// Wird das Abo tatsächlich verkauft? Nur mit Bezahlschranke, vollständigen Angaben und beiden Bezahl-Links.
export const selling = () => SITE.paywall && operatorReady() && !!SITE.plans.standard.checkout && !!SITE.plans.full.checkout;
