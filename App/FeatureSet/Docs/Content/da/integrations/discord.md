# Discord-integration

Post hændelsesopdateringer til en [Discord](https://discord.com)-kanal. OneUptime har en indbygget **Discord**-workflowkomponent, så dette er en af de hurtigste integrationer at sætte op.

Denne integration er **udgående**: OneUptime poster til en Discord-kanal via en indkommende webhook-URL.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Trin 1 — Opret en Discord-webhook

1. I Discord, åbn målkanalens **Edit Channel → Integrations → Webhooks**.
2. Klik **New Webhook**, giv den et navn (f.eks. `OneUptime`), vælg kanalen, og **kopiér webhook-URL'en**.

## Trin 2 — Gem webhook-URL'en (valgfrit men anbefalet)

1. I OneUptime, gå til **Workflows → Global Variables → Create**.
2. Navngiv den `DISCORD_WEBHOOK_URL`, indsæt URL'en, og slå **Is Secret** til.

At holde den i en variabel betyder, at du kan genbruge den på tværs af workflows og rotere den ét sted.

## Trin 3 — Byg workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → Discord`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **Discord**-komponent forbundet til triggeren:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (eller indsæt den direkte).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Gem**, aktivér, og opret en testhændelse. Beskeden vises i din kanal.

## Alternativ: API-komponenten

Hvis du foretrækker ikke at bruge den dedikerede komponent, gør en **API**-blok det samme:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Dette er praktisk, hvis du ønsker Discords rigere [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) — tilføj et `embeds`-array til bodyen.

## Tips

- Brug **Conditions** til kun at poste for bestemte alvorligheder — forgren på `{{Incident.incidentSeverity.name}}` før Discord-blokken.
- Tilføj flere workflows på **Incident → On Update** for at poste bekræftelser og løsninger til den samme kanal.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — det udgående mønster.
- [Telegram](/docs/integrations/telegram) — den samme idé for Telegram.
- [Komponenter → Discord](/docs/workflows/components#discord) — komponentreferencen.
