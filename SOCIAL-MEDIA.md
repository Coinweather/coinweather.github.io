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

| Kanal | Aufwand | Geheimnisse |
|---|---|---|
| Telegram | 10 Minuten | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Bluesky | 5 Minuten | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| X (Twitter) | 20 Minuten | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
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

Hinweis: Die Bedingungen des kostenlosen X-Zugangs ändern sich immer wieder. Ein Beitrag pro Tag lag bisher im Rahmen.
Bei X geht der Beitrag ohne Bild raus (nur Text mit Link).

## Facebook-Seite

1. Mit deinem Facebook-Konto eine **Seite** erstellen: https://www.facebook.com/pages/create → Name *Coinweather*.
2. https://developers.facebook.com → **Meine Apps → App erstellen** → Anwendungsfall „Andere“ → Typ **Business** → Name *Coinweather Poster*.
3. **Tools → Graph API Explorer**: rechts deine App wählen → **User Token** → Berechtigungen hinzufügen:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`
   (für Instagram zusätzlich `instagram_basic`, `instagram_content_publish`) → **Generate Access Token** → bestätigen.
4. **Langlebig machen:** Tools → **Access Token Debugger** → Token einfügen → **Debug** → unten **Extend Access Token**.
5. Im Graph API Explorer mit dem verlängerten Token die Abfrage `me/accounts` senden. Bei deiner Seite stehen
   `id` (= Seiten-ID) und `access_token` (= Seiten-Token; aus einem verlängerten Token läuft er nicht ab).
6. **Bei GitHub:** `FACEBOOK_PAGE_ID` = id, `FACEBOOK_PAGE_TOKEN` = access_token der Seite.

## Instagram

1. Instagram-Konto in ein **professionelles Konto** (Business oder Creator) umwandeln:
   Instagram → Einstellungen → Kontotyp und Tools → Zu professionellem Konto wechseln.
2. Es mit der Facebook-Seite verbinden: Facebook-Seite → Einstellungen → **Verknüpfte Konten → Instagram**.
3. Im Graph API Explorer (Token aus dem Facebook-Abschnitt mit den Instagram-Berechtigungen) die Abfrage
   `<Seiten-ID>?fields=instagram_business_account` senden. Die angezeigte `id` ist die Instagram-Kennung.
4. **Bei GitHub:** `INSTAGRAM_USER_ID` = diese id. (`FACEBOOK_PAGE_TOKEN` ist schon hinterlegt.)

Instagram holt das Bild von einer öffentlichen Adresse. Der Ablauf legt es dafür täglich im Zweig `media` ab.
In Instagram sind Links in Beiträgen nicht anklickbar – trag deshalb `https://coinweather.github.io/?von=instagram`
in der Bio deines Profils ein.

---

## Was gepostet wird

Ein Bild (1080 × 1080) mit Markt-Index, Fear & Greed, Bitcoin-Kurs und Zyklus, dazu ein kurzer Text mit dem Hinweis
„Keine Anlageberatung“ und einem Link mit `?von=<kanal>` – so siehst du in der Nutzerübersicht, welcher Kanal Anmeldungen bringt.
Einzelne Coins werden bewusst nicht als Kauftipp gepostet.
