# Discord-integration

Posta incidentuppdateringar till en [Discord](https://discord.com)-kanal. OneUptime har en inbyggd **Discord**-arbetsflödeskomponent, så det här är en av de snabbaste integrationerna att sätta upp.

Den här integrationen är **utgående**: OneUptime postar till en Discord-kanal via en inkommande webhook-URL.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Steg 1 — Skapa en Discord-webhook

1. I Discord, öppna målkanalens **Edit Channel → Integrations → Webhooks**.
2. Klicka på **New Webhook**, ge den ett namn (t.ex. `OneUptime`), välj kanalen och **Copy Webhook URL**.

## Steg 2 — Spara webhook-URL:en (valfritt men rekommenderas)

1. Gå i OneUptime till **Workflows → Global Variables → Create**.
2. Namnge det `DISCORD_WEBHOOK_URL`, klistra in URL:en och slå på **Is Secret**.

Att ha den i en variabel gör att du kan återanvända den i flera arbetsflöden och rotera den på ett ställe.

## Steg 3 — Bygg arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → Discord` och öppna **Builder**.
2. Lägg till en **Incident**-utlösare inställd på **On Create**. Byt namn till `Incident`.
3. Lägg till en **Discord**-komponent kopplad till utlösaren:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (eller klistra in den direkt).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Spara**, aktivera och skapa en testincident. Meddelandet visas i din kanal.

## Alternativ: API-komponenten

Om du hellre inte använder den dedikerade komponenten gör ett **API**-block samma sak:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Det är praktiskt om du vill ha Discords rikare [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) — lägg till en `embeds`-array i bodyn.

## Tips

- Använd **Conditions** för att bara posta för vissa allvarlighetsgrader — förgrena på `{{Incident.incidentSeverity.name}}` före Discord-blocket.
- Lägg till fler arbetsflöden på **Incident → On Update** för att posta bekräftelser och lösningar till samma kanal.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — det utgående mönstret.
- [Telegram](/docs/integrations/telegram) — samma idé för Telegram.
- [Komponenter → Discord](/docs/workflows/components#discord) — komponentreferensen.
