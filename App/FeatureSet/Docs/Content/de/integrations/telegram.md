# Telegram-Integration

Senden Sie Vorfallsaktualisierungen an einen [Telegram](https://telegram.org)-Chat oder eine Gruppe. OneUptime hat eine integrierte **Telegram**-Workflow-Komponente, sodass die Einrichtung schnell geht.

Diese Integration ist **ausgehend**: OneUptime sendet Nachrichten über einen Telegram-Bot.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Schritt 1 — Einen Bot erstellen und sein Token erhalten

1. Schreiben Sie in Telegram [@BotFather](https://t.me/BotFather) und senden Sie `/newbot`.
2. Folgen Sie den Anweisungen. BotFather gibt Ihnen ein **Bot-Token** wie `123456789:AA...`.

## Schritt 2 — Ihre Chat-ID herausfinden

1. Fügen Sie den Bot zur Gruppe hinzu (oder starten Sie einen Direktchat mit ihm) und senden Sie ihm eine beliebige Nachricht.
2. Öffnen Sie `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` im Browser.
3. Suchen Sie in der Antwort nach `"chat":{"id":...}` – diese Zahl ist Ihre **Chat-ID** (Gruppen-IDs sind negativ).

## Schritt 3 — Die Geheimnisse speichern

1. Gehen Sie in OneUptime zu **Workflows → Global Variables → Create**.
2. Erstellen Sie `TELEGRAM_BOT_TOKEN` (geheim) und `TELEGRAM_CHAT_ID`.

## Schritt 4 — Den Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → Telegram`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie eine **Telegram**-Komponente verbunden mit dem Auslöser hinzu:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Die Nachricht kommt in Ihrem Chat an.

## Alternative: die API-Komponente

Ein **API**-Block funktioniert ebenfalls:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Tipps

- Der Bot sieht Nachrichten erst, nachdem er zu einer Gruppe hinzugefügt wurde und der **Privacy-Modus** es erlaubt – wenn `getUpdates` leer ist, senden Sie dem Bot zuerst eine Nachricht oder deaktivieren Sie den Privacy-Modus über BotFather.
- Verwenden Sie **Conditions**, um vor dem Senden nach Schweregrad zu filtern.
- Fügen Sie `"parse_mode": "Markdown"` zum API-Body hinzu (oder verwenden Sie die Formatierung der Komponente) für Fett- und Links.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — das ausgehende Muster.
- [Discord](/docs/integrations/discord) — dasselbe Prinzip für Discord.
- [Komponenten → Telegram](/docs/workflows/components#telegram) — die Komponentenreferenz.
