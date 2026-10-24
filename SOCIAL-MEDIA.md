# Tägliche Beiträge auf Social Media einrichten

Jeden Morgen um 07:30 Uhr (im Winter 06:30 Uhr) erstellt GitHub automatisch den Wetterbericht des Kryptomarkts mit Bild
und postet ihn auf allen Kanälen, die hier eingerichtet sind. Danach musst du nichts mehr tun.

Für jeden Kanal machst du **einmal**: Konto anlegen, einen Zugangsschlüssel erzeugen und ihn bei GitHub hinterlegen.
Die Schlüssel gehören nur dir – gib sie niemandem weiter, auch nicht im Chat.

**Wo die Schlüssel hinkommen:** https://github.com/Coinweather/coinweather.github.io/settings/secrets/actions
→ **New repository secret** → Name genau wie unten angegeben → Wert einfügen → **Add secret**.

**Sprache:** Standard ist Englisch. Für Deutsch: auf derselben Seite den Reiter **Variables** → **New repository variable**,
Name `POST_LANG`, Wert `de`.

**Testen:** https://github.com/Coinweather/coinweather.github.io/actions/workflows/daily-posts.yml → **Run workflow**.
Im Protokoll steht pro Kanal „gepostet“, „nicht eingerichtet“ oder der Fehler.
Nur Facebook/Instagram posten: im Feld **only** `Facebook,Instagram` eintragen.
**Nur prüfen, ohne zu posten:** Häkchen bei **check** setzen – das Protokoll zeigt, ob der Facebook-Token gültig ist und wann er abläuft.

| Kanal | Aufwand | Geheimnisse |
|---|---|---|
| Telegram | 10 Minuten | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Bluesky | 5 Minuten | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| X (Twitter) | 20 Minuten + Guthaben (rund 0,50 $ im Monat) | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
| Facebook-Seite | 30 Minuten | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN` |
| Instagram | +10 Minuten nach Facebook | `INSTAGRAM_USER_ID` (nutzt `FACEBOOK_PAGE_TOKEN` mit) |

Nicht automatisch möglich sind **TikTok und YouTube Shorts** (beide verlangen ein Video und eine Prüfung der App durch die
Plattform, sonst bleiben Beiträge privat) sowie **Reddit** (tägliche automatische Beiträge gelten dort als Spam).

---

## Telegram

1. **Kanal:** Telegram → Menü → **Neuer Kanal** → Name *Coinweather – Crypto Weather Report* → **Öffentlich** →
   Link festlegen, z. B. `t.me/coinweather_daily`.
2. **Bot:** In Telegram **@BotFather** öffnen → `/newbot` → Name *Coinweather Bot* → Benutzername, der auf `bot` endet.
   BotFather schickt den Schlüssel (sieht aus wie `123456:ABC…`).
3. **Bot als Administrator:** Kanal-Info → **Administratoren** → **Administrator hinzufügen** → Bot suchen →
   **Nachrichten veröffentlichen** muss an sein.
4. **Bei GitHub:** `TELEGRAM_BOT_TOKEN` = Schlüssel von BotFather, `TELEGRAM_CHAT_ID` = `@` + Kanalname, z. B. `@coinweather_daily`.

## Bluesky

1. Konto auf https://bsky.app anlegen, z. B. `coinweather.bsky.social`.
2. **Einstellungen → Privatsphäre und Sicherheit → App-Passwörter → App-Passwort hinzufügen**, Name *Coinweather*.
   (Nicht dein normales Passwort verwenden.)
3. **Bei GitHub:** `BLUESKY_HANDLE` = z. B. `coinweather.bsky.social`, `BLUESKY_APP_PASSWORD` = das App-Passwort.

## X (Twitter)

1. Konto auf https://x.com anlegen.
2. **Als automatisiertes Konto kennzeichnen** (verlangt X für Bots): Einstellungen → Dein Konto → Kontoinformationen →
   **Automatisierung** → dein persönliches Konto als Betreiber angeben.
3. https://developer.x.com → mit diesem Konto anmelden → **Free**-Zugang wählen (Verwendungszweck kurz beschreiben, z. B.
   „Posting one daily automated crypto market summary from my own website“).
4. Im Developer Portal unter dem Projekt die App öffnen → **User authentication settings → Set up** →
   App permissions **Read and write**, Type **Web App, Automated App or Bot**, Callback und Website:
   `https://coinweather.github.io/` → speichern.
5. Reiter **Keys and tokens**: **API Key and Secret** erzeugen (= Consumer Keys) und **Access Token and Secret** erzeugen.
   Wichtig: Das Access Token **nach** Schritt 4 erzeugen, sonst darf es nicht posten.
6. **Bei GitHub:** `X_API_KEY`, `X_API_SECRET` (Consumer Keys), `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` (Access Token und Secret).

**Kosten:** Den Gratis-Zugang gibt es seit Februar 2026 nicht mehr. X rechnet pro Beitrag ab: im Developer Portal unter
**Billing / Credits** Guthaben kaufen. Ein Beitrag ohne Link kostet etwa 0,015 $, mit Link etwa 0,20 $ (Stand Oktober 2026,
Preise ändern sich). Der tägliche X-Beitrag kommt deshalb **ohne Link und ohne Bild** aus und verweist auf den Link im Profil –
die Website-Adresse im X-Profil muss also eingetragen sein. Ohne Guthaben meldet der Ablauf „kein Guthaben – nicht gepostet“.

## Facebook-Seite

1. Mit deinem Facebook-Konto eine **Seite** erstellen: https://www.facebook.com/pages/create → Name *Coinweather*.
2. https://developers.facebook.com → **Meine Apps → App erstellen** → Anwendungsfall „Andere“ → Typ **Business** → Name *Coinweather Poster*.
3. **Tools → Graph API Explorer**: rechts deine App wählen → **User Token** → Berechtigungen hinzufügen:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`
   (für Instagram zusätzlich `instagram_basic`, `instagram_content_publish`) → **Generate Access Token** → bestätigen.
4. **Langlebig machen (wichtig!):** https://developers.facebook.com/tools/debug/accesstoken/ → das eben erzeugte Token einfügen →
   **Debuggen** → ganz unten **Zugriffsschlüssel verlängern / Extend Access Token** → das **neue, lange** Token kopieren.
5. Zurück im Graph API Explorer: das verlängerte Token oben ins Feld **Zugriffsschlüssel** einfügen (das alte ersetzen),
   die Abfrage `me/accounts` senden. Bei deiner Seite stehen `id` (= Seiten-ID) und `access_token` (= Seiten-Token).
6. **Kontrolle:** diesen Seiten-Token im Access Token Debugger prüfen. Dort muss **Läuft ab: Nie** stehen.
   Steht dort eine Uhrzeit, wurde in Schritt 5 noch das kurze Token verwendet – dann Schritt 4 und 5 wiederholen.
7. **Bei GitHub:** `FACEBOOK_PAGE_ID` = id, `FACEBOOK_PAGE_TOKEN` = access_token der Seite.

Ein kurzes Token läuft nach etwa einer Stunde ab; dann meldet der Ablauf „Session has expired“ und Facebook und Instagram fallen aus.
Ein Seiten-Token aus einem verlängerten Token läuft nicht ab – es wird nur ungültig, wenn du das Facebook-Passwort änderst,
dich bei der App abmeldest oder die Berechtigungen entziehst. Dann die Schritte 3–7 wiederholen.

**Einfacher, aber befristet:** Hinterlegst du statt des Seiten-Tokens den **verlängerten Benutzer-Token** aus Schritt 4,
holt sich der Ablauf den Seiten-Token selbst. Das klappt 60 Tage lang; zwei Wochen vor Ablauf steht im Protokoll ein Hinweis.
Ob alles passt, zeigt **Run workflow → check**.

## Instagram

1. Instagram-Konto in ein **professionelles Konto** (Business oder Creator) umwandeln:
   Instagram → Einstellungen → Kontotyp und Tools → Zu professionellem Konto wechseln.
2. Es mit der Facebook-Seite verbinden: Facebook-Seite → Einstellungen → **Verknüpfte Konten → Instagram**.
3. Im Graph API Explorer (Token aus dem Facebook-Abschnitt mit den Instagram-Berechtigungen) die Abfrage
   `<Seiten-ID>?fields=instagram_business_account` senden. Die angezeigte `id` ist die Instagram-Kennung.
4. **Bei GitHub:** `INSTAGRAM_USER_ID` = diese id. (`FACEBOOK_PAGE_TOKEN` ist schon hinterlegt.)

Instagram holt die Bilder von öffentlichen Adressen. Der Ablauf legt sie dafür täglich im Zweig `media` ab.
In Instagram sind Links in Beiträgen nicht anklickbar – trag deshalb `https://coinweather.github.io/?von=instagram`
in der Bio deines Profils ein.

---

## Was gepostet wird

Vier Bilder im Hochformat (1080 × 1350 – nimmt im Feed am meisten Platz ein):
1. **Wetterbericht:** Kauf-Score mit Balken, Wetter (Stimmung), Fear & Greed, Bitcoin, Zahl der Kaufsignale für die nächsten Wochen; bei Regen und günstigem Zyklus der Hinweis „Regen ist Kaufwetter“
2. **Aussicht:** wie oft Bitcoin und der mittlere Coin nach vergleichbaren Markttagen seit 2018 nach 7 und 30 Tagen höher standen
3. **Größte Bewegungen:** je 3 Gewinner und Verlierer der 100 größten Coins in 24 Stunden (Beobachtung, keine Empfehlung)
4. **Angebot:** was die Seite kann, „30 Tage kostenlos“, Link in der Bio

Instagram zeigt sie als Karussell (zum Wischen), Facebook als Album, Bluesky alle vier, Telegram das erste; X bekommt nur Text
mit Umfrage. Der Text auf Facebook und Instagram ist ausführlich: Aufhänger, alle Werte mit Symbolen, größter Gewinner und
Verlierer, eine Häufigkeit aus den Tests, eine täglich wechselnde Frage, Abstimmen per Kommentar (🟢/🟡/🔴), das Angebot mit Link
(Facebook) bzw. „Link in der Bio“ (Instagram), Aufforderung zum Speichern und Folgen, „Keine Anlageberatung“ und Hashtags
(Instagram erlaubt seit Dezember 2025 höchstens 5). Jeder Link trägt `?von=<kanal>` – so siehst du in der Nutzerübersicht,
welcher Kanal Anmeldungen bringt. Einzelne Coins werden bewusst nicht als Kauftipp gepostet.

**Mehr Reichweite:** In der ersten Stunde nach dem Posten (07:30 Uhr) auf Kommentare antworten – das zeigen Facebook und
Instagram dann mehr Leuten.

---

## Profiltexte (zum Kopieren)

Profilbild: `werbung/coinweather-profilbild.jpg` · Titelbild: `werbung/coinweather-titelbild.jpg`

**Name überall:** Coinweather · **Benutzername:** möglichst `coinweather` (sonst `coinweather_app` oder `coinweatherhq`)

**X – Bio** (max. 160 Zeichen) · Website: `https://coinweather.github.io/?von=x`
```
Is now a good time to buy crypto? ☀️🌧️ Daily crypto weather: contrarian buy score, Fear & Greed & signals for 1,000 coins. Probabilities, not promises. NFA
```

**Instagram – Bio** (max. 150 Zeichen) · Link: `https://coinweather.github.io/?von=instagram`
```
☀️🌧️ Daily crypto weather report
📊 Market index · Fear & Greed · 1,000 coins
🎯 Probabilities, not promises · NFA
👇 Try 30 days free
```

**Bluesky – Beschreibung** (max. 256 Zeichen) · Website im Profil: `https://coinweather.github.io/?von=bluesky`
```
Is now a good time to buy crypto? ☀️🌧️
A daily weather report for the crypto market: 0–100 contrarian buy score, Fear & Greed and signals for 1,000 coins – with an open track record.
Probabilities, not promises. Not financial advice.
👇 Try 30 days free
```

**Telegram – Kanalbeschreibung** (max. 255 Zeichen)
```
☀️🌧️ The daily weather report for the crypto market.
Every morning: buy score (0–100), market weather, Fear & Greed and Bitcoin – in one short message.
Probabilities, not promises. Not financial advice.
👉 coinweather.github.io
```

**Facebook-Seite – Kurzbeschreibung (Intro)** (max. 101 Zeichen) · Website: `https://coinweather.github.io/?von=facebook`
```
Daily crypto weather report: buy score, Fear & Greed and signals for 1,000 coins. NFA.
```

**Facebook-Seite – Info (ausführlich)**
```
Is now a good time to buy crypto? Coinweather turns the crypto market into a simple daily weather report – from storm to sunshine.

• Market index from 0 to 100 that rates the next few weeks
• Fear & Greed and the position in the market cycle at a glance
• Signals for 1,000 coins, each showing how often comparable cases ended higher
• An open track record: every buy signal is re-measured after 7 and 30 days

Every rule is tested on daily prices since 2018. Probabilities, not promises – not financial advice.
Try everything free for 30 days, no payment details required.
```

**Angeheftete Vorstellung** (als ersten Beitrag posten und oben anheften – auf X, Bluesky, Facebook und Telegram)
```
👋 Welcome to Coinweather – the weather report for the crypto market.

Every morning you get one short update: is the market stormy ⛈️ or sunny ☀️?

📊 Market index (0–100)
😨 Fear & Greed
🔁 Where we are in the cycle
🎯 Signals for 1,000 coins – with an open track record, including the bad calls

No hype, no price targets, no promises. Just probabilities from a model tested on prices since 2018.

Try it free for 30 days 👉 https://coinweather.github.io/?von=x
Not financial advice.
```
(Für Bluesky, Facebook und Telegram im Link `?von=x` durch `?von=bluesky`, `?von=facebook` bzw. `?von=telegram` ersetzen.)
