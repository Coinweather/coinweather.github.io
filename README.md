# Coinweather

> Was für den Verkauf als Abo fertig ist und was noch fehlt, steht in [GO-LIVE.md](GO-LIVE.md). Name, Betreiber, Preise und Bezahlung werden in `js/config.js` eingestellt.

Live-Kurse der Top 1000 Kryptowährungen mit Kauf-Score von 0 bis 100 je Coin (nach dem Zyklus-Kompass), Kauf-/Verkaufssignal, Markt-Wetter, Portfolio und Portfolio-Manager. Reine statische Website (HTML, CSS, JavaScript-Module) – kein Build-Schritt.

**Keine Anlageberatung.** Die Signale sind Rechenwerte aus vergangenen Kursen und können falsch liegen.

## Für Besucher ohne Konto

- **Das Krypto-Wetter** oben auf der Startseite: das Markt-Wetter (Stimmung der nächsten Wochen aus Marktphase, Marktbreite, Nachrichten) als Wetterlage, sonnig bis stürmisch, mit der Antwort auf „Jetzt kaufen?“ in einem Satz.
- **Kauf-Score** („Jetzt kaufen?“, js/model.js `buyScore`): antizyklisch, Sicht 12 Monate – 100 minus Zyklus-Risiko aus Mayer-Multiple, 2-Jahres-Schnitt, Pi-Cycle, Abstand zum Allzeithoch und Fear & Greed (30 Tage). Regen und Angst heben ihn, Sonne und Gier senken ihn („Regen ist Kaufwetter“). Stufen: ab 75 Kaufen, 62–74 Eher kaufen, 45–61 Halten, 30–44 Eher verkaufen, darunter Verkaufen.
  Geprüft an Bitcoin-Tageskursen seit 2022: ab 62 ein Jahr später in 71–76 % der Fälle höher (Median +50 bis +104 %), 45–61 nur in 48 %; 2018–21 dieselbe Richtung. Auf 90 Tage kein Vorteil. Varianten mit mehr Gewicht auf kurzfristiger Angst (Fear & Greed 7/14 Tage) waren auf ein Jahr schlechter. Den Portfolio-Manager zusätzlich ab Kauf-Score 62 Bitcoin und Ethereum aufstocken zu lassen brachte 71 % statt 73 % pro Jahr (7 Starttage) – deshalb nicht eingebaut (`coreFillBuy`). Die Coin-Signale bleiben beim Trendmodell für die nächsten Wochen; die Seite erklärt, wenn beide verschieden aussehen.
- **Kostenlose Vorschau:** Großwetterlage, Zyklus, Aussicht; die Signale einzelner Coins sind verdeckt (außer Bitcoin und Ethereum).
- **Sparplan- und Portfolio-Rechner** (`#/rechner`, `#/modell` springt zum Modell-Portfolio): derselbe Sparplan oder dieselbe Einmalanlage mit dem gewählten Coin, mit Bitcoin und mit dem Portfolio-Manager nebeneinander (Wert, Rendite, tiefster Stand, bestes Ergebnis markiert), darunter das Modell-Portfolio; die Einstellungen stehen in der Adresse und lassen sich teilen.
- **Als App installierbar** (manifest.webmanifest, sw.js – der Service Worker lädt immer zuerst aus dem Netz).
- **Suchmaschinen-Seiten** in 7 Sprachen (scripts/seo-pages.mjs): Kryptomarkt heute, „Soll ich jetzt Bitcoin kaufen?“ und „… Ethereum kaufen?“ (mit FAQ für Google), Fear & Greed, 500 Coins, Sparpläne der 40 größten Coins, Indikatoren; dazu ein tagesaktuelles Vorschaubild je Sprache für geteilte Links.

- **Zyklus-Kompass** (`#/indikatoren`, scripts/indices.mjs): Zyklus-Risiko (eigener Index aus Mayer-Multiple, 2-Jahres-MA, Pi-Cycle, Abstand zum Hoch, Fear & Greed), Altcoin-Saison-Index, Pi-Cycle-Top, Mayer-Multiple, 2-Jahres-MA-Multiplikator, Volatilität, Bitcoin-Dominanz – je mit Rückblick (Bitcoin 90 Tage / 1 Jahr später, alle Tage seit Januar 2022 – ein Zeitraum, damit sich die Zahlen nicht widersprechen). Werte frei, Verläufe und Rückblicke mit Paket. Das Zyklus-Risiko heute ist genau 100 minus Kauf-Score.
  Ergebnis seit 2022: Zyklus-Risiko unter 25 → ein Jahr später in 76 % der Fälle höher (Median +50 %), 25–37 → 71 % (+104 %), 38–54 → 48 % (−14 %); überhitzt (ab 70) gab es seit 2022 nicht.
- **Modell-Portfolio** (im Rechner, scripts/model-curve.mjs): die Regeln des Portfolio-Managers wöchentlich an den 84 geprüften Coins seit 2018, 0,25 % Gebühr; rund +70 % pro Jahr bei −42 % größtem Rückgang (Bitcoin +25 %). In-Sample-Rückrechnung – steht so auf der Seite. Bestand und Handel im Paket Komplett. Der Sparplan-Rechner vergleicht damit.
- **Portfolio** (`#/portfolio`, Paket Komplett): zwei Wege. **Autopilot**: Startbetrag, Sparrate und Strategie eingeben – der Bestand folgt den Anteilen des Modell-Portfolios der Strategie (dieselbe Kurve wie im Rechner); Schritte entstehen nur, wenn das Modell am wöchentlichen Prüftag handelt oder Geld dazukommt (Schwelle 1 % bzw. 10 $). Einzahlen, Auszahlen (anteilig) und monatliche Erinnerung an die Sparrate. **Selbst pflegen**: eigene Coins eintragen oder importieren, der Manager schlägt Schritte vor. Strategien: Ausgewogen (+81 % pro Jahr, −46 %) und Vorsichtig (+60 %, −30 %); die Reserve kommt in beiden Modi aus dem Modell-Portfolio. Geprüft und verworfen: Antizyklisch (78 %, −51 %), nur Bitcoin und Ethereum (36 %, −38 %), nur ruhige Coins (64 %, −46 %).
- **Markt-Heatmap**, **Coin-Vergleich** (`#/vergleich/a,b`), **Widget** zum Einbetten (widget.html, Anleitung /embed/), **Erste Schritte** für neue Konten.
- **Schnellstart:** lite.json (150 größte Coins, rund 130 KB) vor snapshot.json (rund 850 KB).

Mit kostenlosem Konto zusätzlich: alle Signale, **Favoriten** (Stern an jedem Coin, im Konto gespeichert), Portfolio.

## Lokal starten

```bash
python -m http.server 8123
```

Danach `http://localhost:8123` öffnen.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/app.js` | Ansichten (Markt, Detail, Portfolio, Konto) und Datenabruf |
| `js/config.js` | Name, Betreiber, Preise, Bezahlschranke |
| `js/site.js` | Einstieg, Preise, Rechtstexte, Hinweise aufs Abo |
| `js/i18n.js` | Sprache und Währung der Anzeige; übersetzt die fertige Seite mit einem Wörterbuch |
| `js/lang/*.js` | Wörterbücher je Sprache (deutsche Grundform → Übersetzung): Englisch, Spanisch, Französisch, Italienisch, Portugiesisch, Türkisch |
| `scripts/lang-check.mjs` | Prüft, ob jedes Wörterbuch alle Einträge hat |
| `js/model.js` | Prognosemodell: Indikatoren, Bewertungskurven, Markt-Index, Rückblick-Test |
| `js/manager.js` | Portfolio-Manager: Regeln für Kaufen, Verkaufen, Tauschen, Gewinnmitnahme |
| `js/api.js` | Datenquellen: CoinGecko (Kurse), Binance und Gate.io (Kursgeschichte der letzten 4 Jahre), alternative.me (Fear & Greed), cryptocurrency.cv (Nachrichten) |
| `js/portfolio.js` | Speicherung im Browser und CSV-Import |
| `js/auth.js` | Konten und Speicherung im Konto (Firebase) |
| `js/firebase-config.js` | Zugangsdaten des Firebase-Projekts |
| `firestore.rules` | Zugriffsregeln: Jede Person sieht nur ihr eigenes Portfolio und ihre Nutzung; Betreiber lesen alles für die Nutzerübersicht |

## Konten einrichten (Firebase)

Das Portfolio ist nur angemeldet nutzbar. Ohne diese Schritte bleiben Kurse und Prognosen sichtbar, das Portfolio aber gesperrt.

1. Auf <https://console.firebase.google.com> ein Projekt anlegen (kostenloser Spark-Tarif reicht).
2. **Build → Authentication → Sign-in method:** „E-Mail/Passwort“ und „Google“ einschalten.
3. **Authentication → Settings → Authorized domains:** die Adresse der Website hinzufügen, z. B. `coinweather.github.io`.
4. **Build → Firestore Database:** Datenbank im Produktionsmodus anlegen und unter „Regeln“ den Inhalt von `firestore.rules` einfügen und veröffentlichen.
5. **Projekteinstellungen → Meine Apps → Web-App hinzufügen:** die angezeigte Konfiguration in `js/firebase-config.js` eintragen (statt `null`).
6. Committen und pushen.

Die Werte in `firebase-config.js` sind keine Geheimnisse; der Schutz läuft über die Firestore-Regeln.

### Konten lokal testen

Mit den Firebase-Emulatoren, ohne echtes Projekt (benötigt Node und Java):

```bash
npx firebase-tools@13.29.1 emulators:start --only auth,firestore --project demo-krypto
```

Dann in der Browser-Konsole der lokalen Seite einmal `localStorage.setItem('krypto-markt-emulator', '1')` ausführen und neu laden. Der Schalter wirkt nur auf `localhost`.

## Wie das Modell geprüft wurde

- **Erfolgskontrolle der ersten Woche (12.–16.10.2026) und Folgerung:** Die Kaufsignale lagen 7 Tage später im Mittel bei −2,8 %, der mittlere Top-100-Coin bei −2,0 % (Binance-Tageskurse). Signale bei Coins in den Top 10 lagen bei +0,2 %, ab Rang 200 bei −6,5 % (15 % im Plus). Die Rückrechnung 2018–2026 zeigt dazu: Der Vorteil der Kaufsignale liegt fast ganz im Timing des Gesamtmarkts (7 Tage nach einem Kaufsignal 54–58 % höher, an allen Tagen 46–49 %); gegenüber dem mittleren Coin desselben Tages lag ein Signal-Coin im Median bei null. Geprüft ist das Modell nur an 84 großen Coins – kleinere lassen sich nicht fair zurückrechnen, weil in alten Daten alle fehlen, die es nicht mehr gibt. Seit 24.10.2026 gibt es Kaufsignale deshalb nur für die 100 größten Coins mit mehrjährigen Tageskursen; die Erfolgskontrolle zeigt zusätzlich den Top-100-Schnitt über denselben Zeitraum. Die früheren Ergebnisse bleiben unverändert in der Messung.
- Bewertungskurven aus 4 Jahren Tageskursen (10/2022–10/2026) von 38 großen Coins.
- Gegenprüfung an Daten, die nicht zur Anpassung dienten: dieselben Coins 2018–2022 und 48 weitere Coins. Dort liegt das Modell schwächer, aber in derselben Richtung. 30 Tage nach dem Signal stand der Kurs höher: bei „Kaufen“ in 57–58 % der Fälle, bei „Halten“ in 39–48 %, bei Verkaufssignalen in 32–38 %. Das schwächere „Eher kaufen“ war uneinheitlich (60 % in den früheren Jahren, nur 41 % bei den anderen Coins).
- Nach dieser Gegenprüfung wurden die Gewichte angepasst (Marktphase stärker, langfristiger Baustein schwächer) und ein Bärenmarkt-Filter ergänzt: Liegt Bitcoin unter seinem 200-Tage-Schnitt im Abwärtstrend, gibt es keine Kaufsignale.
- Portfolio-Regeln mit 0,25 % Gebühr je Handel zurückgerechnet, wöchentlich geprüft, 2018–2026, mit denselben Einstellungen wie die Seite (Marktphase über 14 Tage geglättet) und als Mittel aus 7 Starttagen – je nach Starttag schwankt das Ergebnis um rund ±10 Prozentpunkte pro Jahr. Reserve-Strategien: „Mit dem Trend“ rund +86 % pro Jahr bei 40 % größtem Rückgang (2018–22: +114 %, 2022–26: +62 %), „Antizyklisch“ +68 % bei 40 %, „Vorsichtig“ +60 % bei 25 % (Bitcoin halten: +38 % pro Jahr, 77 % Rückgang). Enthalten ist eine Schutzregel: Verkauf, wenn ein Coin 25 % unter sein Hoch seit dem Kauf fällt. Frühere Angaben (rund 70 % pro Jahr für die damalige Mischung) stammten aus einem Lauf ohne Glättung und mit nur einem Starttag; mit den Einstellungen der Seite lag diese Mischung bei rund 60 %.
- Getestete Alternativen (engere Stops, Stop-Loss ab Kaufpreis, tägliches Prüfen, nur 3 große Positionen) lagen alle bei rund 4–5 % im Monatsdurchschnitt. Kein Monat der Rückrechnung erreichte +100 %; ein Durchschnitt von 50 % pro Monat ist nicht erreichbar.
- Antizyklischer Test: Auf Jahressicht stand Bitcoin aus Ständen von mehr als 55 % unter dem Allzeithoch in 96–100 % der Fälle höher, nahe am Hoch nur in 37 %. Auf 30 Tage gilt das Gegenteil (Trend setzt sich fort), und der Fear-&-Greed-Index allein war kein brauchbares Signal. Die Marktphase wird über 14 Tage geglättet.
- Reserve-Vorschlag, 40 Varianten verglichen: Am besten schnitt in beiden Zeiträumen eine Reserve ab, die der Marktphase folgt (im Bärenmarkt höchstens 15 % investiert, die Bremse greift über 5 Tage verteilt). Je antizyklischer, desto schlechter: Mischung aus Marktphase und Zyklus +60 % pro Jahr bei 46 % Rückgang, nur Zyklus +39 % bei 54 %, nur Fear & Greed (bei Angst investiert, bei Gier in Reserve) +29 % bei 56 %.
- Fear & Greed (alternative.me, Tageswerte seit 2018). Was trug: (1) Nach langer Angst (mindestens 54 der letzten 60 Tage unter 45, oder fast 14 Tage unter 25) und mit Bitcoin mindestens 40 % unter dem Allzeithoch mehr investieren, und zwar in Bitcoin und Ethereum – brachte in beiden Zeiträumen mehr Rendite (+72 % → +86 % pro Jahr). Nach mindestens 60 Tagen Angst stand Bitcoin ein Jahr später in 84–100 % der Fälle höher. (2) Bei einem 7-Tage-Schnitt von 75–85 keine Kaufsignale: Der mittlere Coin stand 30 Tage später nur in 20–33 % der Fälle höher (Median −19 bis −21 %), in beiden Zeiträumen und in jeder Marktphase. Was nicht trug: Altcoins in extremer Angst kaufen (ein Jahr später meist tiefer), bei extremer Gier die Reserve erhöhen (kostete 2018–22 viel Rendite, weil die Kurse Ende 2020 trotz Gier monatelang stiegen; 2022–26 kostete es kaum und senkte den Rückgang leicht – deshalb nur in der Strategie „Antizyklisch“), über 85 gibt es nur eine einzige Phase und damit keine Regel.
- Fear & Greed von CoinMarketCap: erst seit Juni 2023 verfügbar, also nicht über mehrere Zyklen prüfbar. Er läuft zu rund 90 % gleich wie der Index von alternative.me, löst die Regeln aber nur an etwa zwei Dritteln derselben Tage aus. Gerechnet wird deshalb mit alternative.me; der Wert von CoinMarketCap wird angezeigt, wenn ein API-Schlüssel hinterlegt ist.
- Stimmung je Coin (eigener Wert aus RSI, Lage in der 30-Tage-Spanne und 30-Tage-Veränderung): sagte für sich wenig voraus. Unter 15 folgte in 59 % der Fälle eine Erholung über 7 Tage, nach 30 Tagen stand der Kurs aber nur in 43 % der Fälle höher. Der Wert wird angezeigt, fließt aber nicht in den Score ein.
- Prüfung der Coin-Auswahl (welcher Coin läuft besser als der Markt, 174 000 Coin-Tage, zwei getrennte Zeiträume): Die bisherigen Coin-Merkmale halfen im zweiten Zeitraum kaum. Das einzige Merkmal, das in beiden Zeiträumen klar trug, ist die Schwankung – ruhigere Coins lagen 30 Tage später im Mittel 2–7 Prozentpunkte vor dem Markt, stark schwankende dahinter. Sie fließt deshalb in alle drei Zeithorizonte ein. In der Portfolio-Rückrechnung sank damit der größte Rückgang 2022–2026 von 33 % auf 23 %.
- Verworfen, weil nur in einem der beiden Zeiträume hilfreich: stärkere Belohnung für Nähe zum Jahreshoch, Abzug für stark gestiegene Coins.
- Kleine Tagesrückgänge (1–5 %) sind kein Signal: Der Kurs 7 und 30 Tage später unterschied sich nicht von Tagen mit kleinen Anstiegen.
- Prozent-Prognosen: Für jeden Score ist hinterlegt, wie sich Coins danach entwickelt haben (mittleres Ergebnis, mittlere Hälfte der Fälle, Anteil höherer Kurse), gemessen in Einheiten der Schwankung des Coins. Beide Zeiträume zählen je zur Hälfte. Die Kaufschwelle liegt bei 15, weil das mittlere Ergebnis erst ab dort nach 7 und 30 Tagen im Plus lag. Auf 12 Monate bestimmt der Stand im Zyklus die Prognose; dort widersprechen sich die beiden Zyklen teils stark.
- Typischer Fall und Durchschnitt: Die Prognose für 7 und 30 Tage zeigt beides. Bei Kaufsignalen (Score ab 15) lag der typische Fall (Median) auf 30 Tage nahe null (2018–22 leicht im Plus, 2022–26 leicht im Minus, Trefferquote 46–60 %), der Durchschnitt aber in allen vier 2-Jahres-Abschnitten im Plus, weil wenige starke Anstiege ihn heben (Ausreißer beim Dreifachen der üblichen Schwankung gekappt). Ein Kaufsignal ist damit ein Vorteil über viele Käufe, kein Versprechen für den einzelnen.
- Rückblick-Test je Coin: zeigt dieselben Zeiträume (7 und 30 Tage) und Größen wie die Prognose und stellt die Prognose von heute daneben. Geprüft wurde, ob der eigene Rückblick eines Coins etwas vorhersagt: Coins im besten Drittel (Vorsprung oder Trefferquote ihrer Kaufsignale in den zwei Jahren davor) liefen im Folgemonat nicht besser als das schwächste Drittel, 2022–26 sogar schlechter. Der Rückblick fließt deshalb nicht in die Prognose ein.
- 12 Monate: Seit 24.10.2026 zeigt die Seite für die Jahressicht nur noch eine Zahl – alle Tage seit Januar 2022 (Zyklus-Panel, Aussicht, Kompass, Indikator-Seiten). Zwei Zeiträume nebeneinander, die sich widersprachen (Bitcoin 25–40 % unter dem Hoch: 2018–22 −42 %, 2022–26 +124 %), waren verwirrend. Seit 2022 ist allerdings nur ein Zyklus; die Seite sagt das dazu. Neue Regeln werden intern weiter an beiden Zeiträumen geprüft.
- Anzeige: Die Seite zeigt je Zeitraum eine Einordnung (positiv, neutral, negativ, uneinheitlich) und wie oft der Kurs in vergleichbaren Fällen höher stand – keinen Prozentwert mehr. Der typische Fall lag meist bei ±1 % und wirkte genauer, als er ist; neben Rückblick und 12-Monats-Zahl führte er zu scheinbaren Widersprüchen. Gerechnet wird intern weiter damit (ein Kaufsignal braucht eine positive Aussicht für 7 und 30 Tage).
- Token auf Aktien, Fonds, Edelmetalle und Währungen sowie Paare, die Binance nicht mehr handelt, erhalten keine Prognose bzw. keine veralteten Tageskurse.
- Daytrading-Register: rund 40 kurzfristige Muster (davon über 20 Short) mit Ziel und Stopp an Tageskerzen mit Hoch und Tief geprüft, 0,5 % Gebühren je Handel, in vier Zwei-Jahres-Abschnitten. In allen vier Abschnitten im Plus lagen nur zwei Long-Muster: (1) Erholung nach einem Wochen-Ausverkauf von mindestens 25 %, wenn der Markt mitfiel, kein Bärenmarkt herrscht und Fear & Greed nicht in der Angstzone steht (Ziel 2-fache, Stopp 3-fache Tagesschwankung, 7 Tage; 83 % der Handel im Plus, im Mittel +7,3 %; im jüngsten Abschnitt über die Signaltage gemittelt aber etwa null) und (2) ein Score ab +40 (Ziel 4-fach, Stopp 3-fach, 14 Tage; 57 % im Plus, im Mittel +2,7 %). Kein Short-Muster bestand die Prüfung – auch nicht „bei extremer Gier shorten“ (2022–26 im Plus, 2020/21 im Minus). Hebel: Bis 3-fach wuchsen Ertrag und Rückgang im Gleichschritt, ab 5-fach häuften sich Zwangsauflösungen; die Seite schlägt deshalb höchstens 3-fach vor.
- Reserve-Logik je Coin: Tief im Zyklus (Bitcoin mindestens 40 % unter dem Allzeithoch) bekommen Bitcoin und Ethereum ein antizyklisches Kaufsignal, in der Angst-Zone bis „Kaufen“ – ein Jahr später stand Bitcoin in 77–100 % der Fälle höher, Ethereum in 57–100 %. Für die übrigen Coins gilt das nicht (2018–22 ein Jahr nach langer Angst im Mittel −34 %). Eigene Regeln je Altcoin wurden geprüft und verworfen, weil sie jeweils nur in einem der beiden Zeiträume halfen: kein Kauf im eigenen Abwärtstrend (Kaufsignale liefen dort 2018–22 sogar besser, 2022–26 schlechter), kein Kauf nach eigener Gier, Kauf nach eigener Angst. Der Bärenmarkt gilt für Score und Reserve gleich: Mehrheit der letzten 5 Tage.
- Erfolgskontrolle: Seit dem 12.10.2026 hält die zentrale Berechnung einmal täglich die bis zu 25 stärksten Kaufsignale fest und wertet sie 7 und 30 Tage später aus (`track.json` im Zweig `data`). Das ist die einzige Messung mit Kursen, die beim Signal noch unbekannt waren.

Grenzen: Die Rückrechnung enthält nur Coins, die heute noch gehandelt werden, die Regeln wurden an denselben Jahren ausgewählt, an denen sie gemessen sind, und Steuern sowie Kursabweichungen beim Handeln fehlen. Echte Ergebnisse werden schlechter ausfallen.

## Fear & Greed Index von CoinMarketCap anzeigen (optional)

Die Seite rechnet mit dem Index von alternative.me. Zusätzlich kann sie den Index von CoinMarketCap anzeigen. Dafür braucht die zentrale Berechnung einen eigenen, kostenlosen API-Schlüssel:

1. Auf <https://coinmarketcap.com/api/> ein kostenloses Konto anlegen und den API-Schlüssel kopieren.
2. Im GitHub-Projekt unter *Settings → Secrets and variables → Actions* ein Secret mit dem Namen `CMC_API_KEY` anlegen und den Schlüssel einfügen (oder im Terminal `gh secret set CMC_API_KEY` ausführen).

Beim nächsten Lauf von „Daten berechnen“ erscheint der Wert unter der Fear-&-Greed-Anzeige.


## Portfolio: Wertentwicklung

Die Seite hält jeden geänderten Bestand mit Zeitpunkt fest (`js/track.js`) und rechnet daraus mit den Tageskursen den Wert für jeden Tag nach. Geld von außen (neue Positionen, Bargeld, Entnahmen) wird getrennt mitgeführt; Käufe, Verkäufe und Tausche innerhalb des Portfolios zählen nicht als Einzahlung. Angezeigt werden Wert, Einzahlungen, zeitgewichtete Wertentwicklung und der Vergleich „dasselbe Geld in Bitcoin“. Vor dem Beginn der Aufzeichnung wird mit dem ersten erfassten Bestand zurückgerechnet.

## Vor einem Verkauf als Abo zu klären

Die Seite ist technisch ein öffentliches, kostenloses Werkzeug. Für ein bezahltes Angebot fehlen Dinge, die sich nicht im Code lösen lassen:

- **Recht:** Kauf- und Verkaufssignale gegen Geld können je nach Land als Anlageberatung oder Finanzdienstleistung gelten. Vor dem Start mit einer Fachperson klären; dazu Impressum, Datenschutzerklärung und AGB.
- **Datenlizenzen:** Die kostenlosen Zugänge (CoinGecko, Binance-Marktdaten, Gate.io, alternative.me, cryptocurrency.cv) sind teils nur für private Nutzung oder mit Auflagen freigegeben. Für ein kommerzielles Angebot die Bedingungen prüfen und nötigenfalls bezahlte Tarife buchen.
- **Bezahlschranke:** Derzeit liegen Code und berechnete Daten offen im Netz. Ein Abo braucht einen Zahlungsanbieter und einen Server, der die Daten nur an zahlende Konten ausliefert.
- **Betrieb:** Die Berechnung läuft über GitHub Actions ohne Zusage zur Pünktlichkeit. Zahlende Kunden brauchen einen verlässlicheren Dienst und eine Überwachung.
- **Nachweis:** Die Erfolgskontrolle misst seit dem 12.10.2026. Belastbar wird sie erst nach mehreren Monaten und Marktphasen.

## Sprachen und Währungen

- Die Texte stehen auf Deutsch im Programm. Für andere Sprachen übersetzt `js/i18n.js` die fertige Seite mit einem Wörterbuch aus `js/lang/`:
  Jeder Text wird auf eine Grundform gebracht (Zahlen, Beträge, Daten als `#`, Satzzeichen am Rand entfernt) und nachgeschlagen.
  Gibt es für einen ganzen Text keinen Eintrag, werden seine Teile einzeln übersetzt (getrennt an ` – `, `: `, Satzgrenzen).
  `{*}` in einem Schlüssel steht für einen beliebigen Namen.
- Hauptsprache der Seite ist Englisch. Im Fuß der Seite und unter „Konto“ lassen sich außerdem Deutsch, Spanisch, Französisch, Italienisch,
  Portugiesisch (Brasilien) und Türkisch wählen. Eine weitere Sprache ist eine weitere Datei in `js/lang/` und ein Eintrag in `LANGS`.
- In einer Übersetzung setzt `#` die Zahlen der Reihe nach ein; `{1}`, `{2}` … setzen eine bestimmte Zahl ein, wenn die Sprache eine andere
  Reihenfolge braucht (im Türkischen häufig). Satzzeichen am Rand kommen vom deutschen Text und gehören nicht in den Eintrag.
- Neue oder geänderte deutsche Texte brauchen einen Eintrag in jedem Wörterbuch, sonst bleiben sie in anderen Sprachen deutsch. Zum Finden: auf `localhost`
  in der Konsole `localStorage.setItem('coinwetter-ernte', '1')` setzen, die Seite durchklicken und `__ernte()` aufrufen – das listet die Grundformen aller Texte.
  `node scripts/lang-check.mjs` prüft, ob jede Sprache alle Einträge hat.
- Die Übersetzungen sind maschinell erstellt und nicht von Muttersprachlern gegengelesen; das gilt auch für die Rechtstexte. Maßgeblich ist die deutsche Fassung.
- Alle Werte im Programm sind US-Dollar. Die Anzeige rechnet mit den Wechselkursen aus dem Schnappschuss um (`fx`); Eingaben erfolgen in der gewählten Währung.
- Die zentrale Berechnung legt Zahlen in Texten sprachneutral ab; `localise` in `js/util.js` schreibt sie beim Laden in der gewählten Schreibweise.
