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

  // Abo. Preise in Euro inklusive Mehrwertsteuer.
  paywall: false,      // false: Einführungsphase – alle Funktionen sind frei
  trialDays: 14,       // kostenlose Testzeit ab Erstellen des Kontos
  freeCoins: 20,       // ohne Abo: Signale für die größten Coins
  plans: {
    monthly: { price: 14.9, checkout: '' },    // Bezahl-Link des Zahlungsanbieters
    yearly: { price: 119, checkout: '' },
  },
  manageUrl: '',       // Seite des Zahlungsanbieters, auf der Kunden kündigen und Rechnungen abrufen
  paymentProvider: '', // Name des Zahlungsanbieters, erscheint in AGB und Datenschutz
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

// Wird das Abo tatsächlich verkauft? Nur mit Bezahlschranke, vollständigen Angaben und Bezahl-Link.
export const selling = () => SITE.paywall && operatorReady() && !!SITE.plans.monthly.checkout;
