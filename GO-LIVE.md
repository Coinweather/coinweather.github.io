# Coinweather verkaufen – was fertig ist und was noch fehlt

Stand: 12. Oktober 2026. Diese Liste ersetzt keine Rechtsberatung. Die Rechtstexte der Seite sind Vorlagen.

## Fertig eingebaut

- Name, Logo, Einstieg für Besucher, Seite „Preise“ mit häufigen Fragen
- Impressum, AGB, Datenschutzerklärung, Risikohinweis (`js/site.js`), Verweise im Fuß jeder Seite
- Zustimmung zu AGB und Risikohinweis nach dem ersten Anmelden, gespeichert mit Zeitpunkt und Stand der Texte;
  bei geändertem `legalVersion` wird neu gefragt
- Eigener Risikohinweis vor dem Bereich Daytrading
- Konto: Abo-Stand, Konto und Daten löschen, Portfolio als Tabelle exportieren
- Abo-Logik: zwei Pakete mit monatlicher Abrechnung. Neue Konten haben 30 Tage lang alles kostenlos (`trialDays` in `js/config.js`, ohne Zahlungsdaten, endet von selbst). Ohne Abo oder Testphase erscheint überall die Seite
  „Pakete und Preise“. Standard (3,99 €): der Markt – Index, Signale und Detailansichten für alle 1000 Coins.
  Komplett (7,99 €): zusätzlich Portfolio (Wertentwicklung, Reserve-Ziel, Modell-Schritte) und Daytrading.
  Freischaltung über `subscriptions/{Konto-Kennung}`; alles in `js/config.js` einstellbar. Die Bezahlschranke ist eingeschaltet,
  kaufen lässt sich noch nichts („Der Verkauf startet in Kürze“).
- Nutzerübersicht für Betreiber unter `#/admin` (Konten, online, aktiv, Testphase, aufgerufene Bereiche und Coins, Portfolio). Braucht die veröffentlichten `firestore.rules`.
- Reiter „Besucher“ unter `#/admin`: alle Besuche, auch ohne Konto – live online, Herkunft, Einstiegsseiten, Länder, Geräte, Handlungen, Weg zum Konto, letzte Besuche mit Klickpfad.
  Gezählt wird erst, wenn die aktuellen `firestore.rules` (Abschnitte `visits` und `stats`) veröffentlicht sind.
- Betreiber-Zugang ohne Abo: über eine bestätigte E-Mail-Adresse (Google-Anmeldung) oder die Konto-Kennung in `owners`.
  Die Konto-Kennung steht unter „Konto“.
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
- **Neu seit 25.10.2026 – der Autopilot:** Er sagt einem Nutzer für seinen Betrag, welche Coins er in welcher Menge kauft. Das ist für
  alle Nutzer derselbe Modellbestand (wie ein veröffentlichtes Musterdepot), die Mengen werden aber auf den Betrag und den Bestand des
  Nutzers umgerechnet. Ob das als allgemeine Information oder als persönliche Anlageempfehlung / Vermögensverwaltung gilt, muss der
  Anwalt ausdrücklich beurteilen – bevor der Autopilot Teil eines bezahlten Pakets wird. Mögliche Ausweichwege, falls nötig:
  nur das Musterdepot in Prozent zeigen (ohne Umrechnung auf den Nutzer), oder den Autopiloten nur in Ländern anbieten, in denen das zulässig ist.

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
| Gate.io (`api.gateio.ws`) | Zweite Quelle der Kursgeschichte für Coins, die Binance nicht führt. Die API-Bedingungen von Gate.io zur Weitergabe von Daten in einem bezahlten Dienst sind nicht geprüft | Bedingungen prüfen; mit dem CoinGecko-Bezahlplan (volle Kursgeschichte) entfällt die Quelle |
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
- Einbau: je Paket ein Bezahl-Link in `js/config.js` → `plans.standard.checkout` und `plans.full.checkout`, dazu `manageUrl` und `paymentProvider`.
  Die Seite hängt die Konto-Kennung als `custom` an den Link.
- Freischaltung: Nach einer Zahlung muss in Firestore das Dokument `subscriptions/{Konto-Kennung}` entstehen:
  `status` (`active`), `plan` (`standard` oder `full`), `until` (Ende des bezahlten Monats in Millisekunden), `cancel` (true, wenn gekündigt).
  Wege dorthin: eine Automatisierung (Zahlungs-Benachrichtigung → Firestore), eine kleine Cloud Function oder am Anfang von Hand in der Firebase-Konsole.
- `firestore.rules` in Firebase veröffentlichen (Regeln für `subscriptions`, `users`, die Nutzerübersicht und die Besuchszählung `visits`/`stats`).
- Sind Betreiberangaben und beide Bezahl-Links eingetragen, erscheinen die Kauf-Knöpfe von selbst.

### 6. Ohne Firma verkaufen

Eine Firma muss man in der Schweiz nicht gründen: Wer unter eigenem Namen selbständig etwas verkauft, ist automatisch Einzelunternehmer.
Das heißt aber auch:

- Im Impressum stehen der eigene Name und die Wohnadresse – öffentlich.
- Gehaftet wird mit dem gesamten Privatvermögen. Eine GmbH begrenzt das, kostet aber Gründung und 20 000 CHF Stammkapital.
- Die selbständige Tätigkeit bei der Ausgleichskasse (AHV) melden; die Einnahmen gehören in die Steuererklärung.
  Der Eintrag ins Handelsregister und die Mehrwertsteuer in der Schweiz werden erst ab 100 000 CHF Umsatz Pflicht.
- Digitale Leistungen an Privatkunden in der EU sind ab dem ersten Euro im Land des Kunden mehrwertsteuerpflichtig –
  ein Wiederverkäufer nimmt einem das ab. Vorab klären, ob er Anbieter ohne Firma und ohne EU-Steuernummer annimmt.
- Name: coinwetter.com, .ch, .de und .io waren am 12.10.2026 nicht registriert. Vor der Nutzung Marken prüfen (Swissreg, DPMA, EUIPO).

Die Einzelheiten bitte bei der Ausgleichskasse oder einer Treuhänderin bestätigen lassen.

## Preis

Festgelegt: **Standard 3,99 € und Komplett 7,99 € im Monat**, nur monatliche Abrechnung, davor 30 Tage kostenlos testen.

Was davon übrig bleibt, am Beispiel eines Wiederverkäufers mit 7,9 % + 1 € je Zahlung und 19 % Mehrwertsteuer:

| Paket | Preis | Mehrwertsteuer | Gebühr | bleibt |
|---|---|---|---|---|
| Standard | 3,99 € | 0,64 € | 1,32 € | rund 2,00 € |
| Komplett | 7,99 € | 1,28 € | 1,63 € | rund 5,10 € |

- Der feste Euro je Zahlung fällt bei kleinen Preisen stark ins Gewicht: Beim Standard-Paket geht ein Drittel des Preises an den Zahlungsweg.
  Ein Anbieter mit kleinerem Festbetrag lohnt sich hier besonders.
- Die Daten kosten rund 30 € im Monat. Das ist ab etwa 15 Standard- oder 6 Komplett-Kunden gedeckt.
- Die Erfolgskontrolle läuft erst seit dem 12.10.2026. Ein niedriger Einstiegspreis passt dazu; mit nachgewiesenen Ergebnissen lässt er sich später anheben.

## Werbung

- **Nichts versprechen.** Keine Gewinnzahlen ohne den Zusatz „Rückrechnung“, keine Aussagen wie „sicher“ oder „garantiert“.
  Bezahlte Anzeigen für Krypto-Angebote sind bei Google und Meta nur eingeschränkt oder mit Freigabe möglich.
- **Die Erfolgskontrolle ist das Verkaufsargument:** jede Woche veröffentlichen, was aus den Signalen wurde – auch die schlechten Wochen.
- Wöchentlicher „Wetterbericht“ als Newsletter und Kurzvideo (Marktphase, Fear & Greed, was das Modell tut und warum).
- Die Testphase senkt die Hürde; danach muss die Verkaufsseite überzeugen: Beispiele zeigen (Bildschirmfotos, ein Muster-Coin), Erfolgskontrolle offen ausweisen, monatliche Kündbarkeit betonen.
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
