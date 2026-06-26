# Discord-Integration

Posten Sie Vorfallsaktualisierungen in einen [Discord](https://discord.com)-Kanal. OneUptime hat eine integrierte **Discord**-Workflow-Komponente, sodass dies eine der schnellsten Integrationen zur Einrichtung ist.

Diese Integration ist **ausgehend**: OneUptime postet über eine eingehende Webhook-URL in einen Discord-Kanal.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Schritt 1 — Einen Discord-Webhook erstellen

1. Öffnen Sie in Discord **Edit Channel → Integrations → Webhooks** des Zielkanals.
2. Klicken Sie auf **New Webhook**, geben Sie ihm einen Namen (z. B. `OneUptime`), wählen Sie den Kanal und **kopieren Sie die Webhook-URL**.

## Schritt 2 — Die Webhook-URL speichern (optional, aber empfohlen)

1. Gehen Sie in OneUptime zu **Workflows → Global Variables → Create**.
2. Benennen Sie die Variable `DISCORD_WEBHOOK_URL`, fügen Sie die URL ein und aktivieren Sie **Is Secret**.

Die Speicherung in einer Variablen ermöglicht es Ihnen, sie in mehreren Workflows wiederzuverwenden und an einer Stelle zu rotieren.

## Schritt 3 — Den Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → Discord`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie eine **Discord**-Komponente verbunden mit dem Auslöser hinzu:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (oder direkt einfügen).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Die Nachricht erscheint in Ihrem Kanal.

## Alternative: die API-Komponente

Wenn Sie die dedizierte Komponente nicht verwenden möchten, macht ein **API**-Block dasselbe:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Dies ist praktisch, wenn Sie Discords reichhaltigere [Embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) verwenden möchten – fügen Sie dem Body ein `embeds`-Array hinzu.

## Tipps

- Verwenden Sie **Conditions**, um nur für bestimmte Schweregrade zu posten – verzweigen Sie auf `{{Incident.incidentSeverity.name}}` vor dem Discord-Block.
- Fügen Sie weitere Workflows für **Incident → On Update** hinzu, um Bestätigungen und Auflösungen in denselben Kanal zu posten.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — das ausgehende Muster.
- [Telegram](/docs/integrations/telegram) — dasselbe Prinzip für Telegram.
- [Komponenten → Discord](/docs/workflows/components#discord) — die Komponentenreferenz.
