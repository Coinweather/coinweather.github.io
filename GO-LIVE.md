# Coinwetter verkaufen – was fertig ist und was noch fehlt

Stand: 12. Oktober 2026. Diese Liste ersetzt keine Rechtsberatung. Die Rechtstexte der Seite sind Vorlagen.

## Fertig eingebaut

- Name, Logo, Einstieg für Besucher, Seite „Preise“ mit häufigen Fragen
- Impressum, AGB, Datenschutzerklärung, Risikohinweis (`js/site.js`), Verweise im Fuß jeder Seite
- Zustimmung zu AGB und Risikohinweis nach dem ersten Anmelden, gespeichert mit Zeitpunkt und Stand der Texte;
  bei geändertem `legalVersion` wird neu gefragt
- Eigener Risikohinweis vor dem Bereich Daytrading
- Konto: Abo-Stand, Konto und Daten löschen, Portfolio als Tabelle exportieren
- Abo-Logik: Testzeit, kostenloser Umfang (Signale für die 20 größten Coins), Sperren mit Hinweis aufs Abo,
  Freischaltung über `subscriptions/{Konto-Kennung}` – alles in `js/config.js` einstellbar, derzeit ausgeschaltet
- Quellenangaben: „Data provided by CoinGecko“, alternative.me direkt beim Fear-&-Greed-Index

## Vor dem ersten Verkauf zwingend

### 1. Aufsichtsrecht klären (Fachanwalt für Finanzmarktrecht)

Das ist der wichtigste Punkt, und ein Haftungsausschluss löst ihn nicht.

- **Allgemeine Signale** für alle Nutzer gelten eher als Information. **Vorschläge, die auf dem eigenen Bestand eines Nutzers beruhen**
  (Portfolio-Manager, Reserve-Ziel, Einsatz-Rechner mit Hebel), können als persönliche Empfehlung gelten.
- EU: „Beratung zu Kryptowerten“ ist nach MiCA (Art. 3 Abs. 1 Nr. 24) zulassungspflichtig; die ESMA legt den Begriff weit aus
  und stellt auf den Inhalt ab, nicht auf die Bezeichnung.
- Schweiz: Das FIDLEG knüpft an Finanzinstrumente an. Reine Zahlungstoken fallen nach bisheriger FINMA-Praxis nicht darunter,
  Anlage-Token und gehebelte Produkte (Derivate) schon.
- Zu klären: In welchen Ländern wird verkauft? Dürfen Portfolio-Manager und Daytrading-Bereich im bezahlten Angebot bleiben,
  oder nur die allgemeinen Signale? Braucht es eine Registrierung oder Bewilligung?

### 2. Betreiber eintragen und Texte prüfen lassen

- `js/config.js` → `operator` ausfüllen (Name, Adresse, E-Mail). Vorher bleibt der Verkauf gesperrt.
- AGB, Datenschutzerklärung, Risikohinweis und Impressum von einer Fachperson prüfen lassen
  (Widerrufsrecht, Kündigung, Haftung, Zielmärkte Schweiz / Deutschland / Österreich).
- Haftung lässt sich nicht vollständig ausschließen: Für Vorsatz und grobe Fahrlässigkeit haftet man immer.
  Persönliches Vermögen schützt eine Kapitalgesellschaft (GmbH), dazu eine Vermögensschaden-Haftpflicht.

### 3. Datenlizenzen

| Quelle | Lage | Was zu tun ist |
|---|---|---|
| CoinGecko | Der kostenlose Zugang (Demo) hat keine Lizenz für kommerzielle Nutzung | Bezahlplan buchen (Basic 35 $ im Monat, 29 $ bei Jahreszahlung), Schlüssel als Secret hinterlegen |
| Binance (`data-api.binance.vision`) | Die Daten stehen unter einer Lizenz ohne kommerzielle Nutzung; bezahlte Abo-Dienste sind ausdrücklich ausgeschlossen | Kursgeschichte auf eine lizenzierte Quelle umstellen (z. B. CoinGecko-Bezahlplan) |
| alternative.me | Kommerzielle Nutzung erlaubt, wenn die Quelle direkt bei den Daten steht | erledigt |
| cryptocurrency.cv (Nachrichten) | Bedingungen ungeklärt | klären oder Nachrichten abschalten |

Folge für die Technik: Der Browser darf Daten dann nicht mehr selbst bei Dritten abrufen (der Schlüssel wäre sichtbar).
Alle Daten müssen über den Schnappschuss laufen. Dieser Umbau steht noch aus und setzt den CoinGecko-Schlüssel voraus.

### 4. Hosting und Schutz des Angebots

- GitHub Pages erlaubt keine Seiten, die vor allem dem Verkauf dienen oder kommerzielle Software als Dienst anbieten → umziehen
  (z. B. Cloudflare Pages, Netlify oder Firebase Hosting), eigene Domain einrichten, in Firebase als erlaubte Domain eintragen,
  `hosting` in `js/config.js` anpassen.
- Solange Quelltext und Schnappschuss öffentlich abrufbar sind, wirkt die Sperre nur in der Oberfläche.
  Für eine echte Sperre: Repository privat stellen und die Daten nur an angemeldete Abo-Konten ausliefern.

### 5. Bezahlung

- Stripe schließt Dienste aus, die Informationen oder Werkzeuge zum Geldverdienen mit Krypto-Handel anbieten (Ausnahmen nur mit Genehmigung).
- Naheliegend für den deutschsprachigen Raum: ein Wiederverkäufer wie Digistore24 (ca. 7,9 % + 1 € je Zahlung). Er wird Vertragspartner
  für die Zahlung, stellt Rechnungen aus und führt die Mehrwertsteuer ab. Vorab schriftlich anfragen, ob das Angebot angenommen wird.
- Einbau: Bezahl-Links in `js/config.js` → `plans.monthly.checkout` und `plans.yearly.checkout`, `manageUrl`, `paymentProvider`.
  Die Seite hängt die Konto-Kennung als `custom` an den Link.
- Freischaltung: Nach einer Zahlung muss in Firestore das Dokument `subscriptions/{Konto-Kennung}` entstehen:
  `status` (`active`), `until` (Ende der bezahlten Zeit in Millisekunden), `cancel` (true, wenn gekündigt).
  Wege dorthin: eine Automatisierung (Zahlungs-Benachrichtigung → Firestore), eine kleine Cloud Function oder am Anfang von Hand in der Firebase-Konsole.
- `firestore.rules` in Firebase veröffentlichen (enthält die Regel für `subscriptions`).
- Zum Start: `paywall: true` in `js/config.js`.

### 6. Unternehmen und Steuern

- Selbständige Tätigkeit anmelden (Ausgleichskasse), Rechtsform wählen.
- Mehrwertsteuer: in der Schweiz ab 100 000 CHF Umsatz; digitale Leistungen an Privatkunden in der EU sind ab dem ersten Euro
  im Land des Kunden steuerpflichtig – ein Wiederverkäufer nimmt einem das ab.
- Name: coinwetter.com, .ch, .de und .io waren am 12.10.2026 nicht registriert. Vor der Nutzung Marken prüfen (Swissreg, DPMA, EUIPO).

## Preis

Empfehlung: **14,90 € im Monat oder 119 € im Jahr**, 14 Tage kostenlos testen. Zum Start ein Gründerpreis von 9,90 € im Monat für die ersten Kunden.

- Vergleich: Portfolio-Apps kosten 5–22 € im Monat, Analyse-Dienste 19–99 $, deutschsprachige Signal-Dienste 45–80 €.
- Die Erfolgskontrolle der Seite läuft erst seit dem 12.10.2026. Ohne nachgewiesene Ergebnisse trägt der Markt keinen höheren Preis.
  Nach sechs Monaten mit Messwerten lässt sich der Preis anheben.
- Feste Kosten: Daten ab rund 30 € im Monat, Domain rund 15 € im Jahr, Zahlungsgebühr rund 15 % beim Monats-Abo, 9 % beim Jahres-Abo.

## Werbung

- **Nichts versprechen.** Keine Gewinnzahlen ohne den Zusatz „Rückrechnung“, keine Aussagen wie „sicher“ oder „garantiert“.
  Bezahlte Anzeigen für Krypto-Angebote sind bei Google und Meta nur eingeschränkt oder mit Freigabe möglich.
- **Die Erfolgskontrolle ist das Verkaufsargument:** jede Woche veröffentlichen, was aus den Signalen wurde – auch die schlechten Wochen.
- Wöchentlicher „Wetterbericht“ als Newsletter und Kurzvideo (Marktphase, Fear & Greed, was das Modell tut und warum).
- Kostenloser Umfang als Einstieg, 14 Tage Testzeit, Jahres-Abo als Standard.
- Dort sein, wo die Zielgruppe fragt: deutschsprachige Krypto-Foren, YouTube, X, Reddit – mit Erklärungen statt Kaufaufrufen.
- Empfehlungsprogramm (ein Monat gratis je geworbenem Kunden), sobald zahlende Kunden da sind.

## Quellen der Prüfung

- GitHub Pages, Grenzen: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- CoinGecko, Preise und Lizenz: https://www.coingecko.com/en/api/pricing
- Binance Vision, Nutzungsbedingungen: https://data.binance.vision/Binance_Vision-Terms_of_Use.pdf
- alternative.me, Fear & Greed: https://alternative.me/crypto/fear-and-greed-index/
- Stripe, ausgeschlossene Geschäfte: https://stripe.com/legal/restricted-businesses
- Digistore24, Wiederverkäufer und Gebühren: https://help.digistore24.com/hc/en-us/articles/23314370906897
- ESMA, Fragen und Antworten zur Beratung nach MiCA: https://www.esma.europa.eu/publications-data/questions-answers/2882
