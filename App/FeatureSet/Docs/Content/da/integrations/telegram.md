# Telegram-integration

Send hændelsesopdateringer til en [Telegram](https://telegram.org)-chat eller -gruppe. OneUptime har en indbygget **Telegram**-workflowkomponent, så opsætningen er hurtig.

Denne integration er **udgående**: OneUptime sender beskeder via en Telegram-bot.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Trin 1 — Opret en bot og hent dens token

1. I Telegram, skriv til [@BotFather](https://t.me/BotFather) og send `/newbot`.
2. Følg vejledningen. BotFather giver dig et **bot-token** som `123456789:AA...`.

## Trin 2 — Find dit chat-ID

1. Tilføj botten til gruppen (eller start en direkte chat med den) og send den en hvilken som helst besked.
2. Åbn `https://api.telegram.org/bot<DIT_TOKEN>/getUpdates` i en browser.
3. Find `"chat":{"id":...}` i svaret — det tal er dit **chat-ID** (gruppe-ID'er er negative).

## Trin 3 — Gem hemmelighederne

1. I OneUptime, gå til **Workflows → Global Variables → Create**.
2. Opret `TELEGRAM_BOT_TOKEN` (hemmelighed) og `TELEGRAM_CHAT_ID`.

## Trin 4 — Byg workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → Telegram`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **Telegram**-komponent forbundet til triggeren:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Gem**, aktivér, og opret en testhændelse. Beskeden ankommer i din chat.

## Alternativ: API-komponenten

En **API**-blok virker også:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Tips

- Botten ser kun beskeder, efter den er tilføjet til en gruppe, og **privatlivstilstand** tillader det — hvis `getUpdates` er tom, send en besked til botten først, eller deaktivér privatlivstilstand via BotFather.
- Brug **Conditions** til at filtrere efter alvorlighed, før der sendes.
- Tilføj `"parse_mode": "Markdown"` til API-bodyen (eller brug komponentens formatering) for fed skrift og links.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — det udgående mønster.
- [Discord](/docs/integrations/discord) — den samme idé for Discord.
- [Komponenter → Telegram](/docs/workflows/components#telegram) — komponentreferencen.
