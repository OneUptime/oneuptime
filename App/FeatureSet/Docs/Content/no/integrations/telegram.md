# Telegram-integrasjon

Send hendelsesoppdateringer til en [Telegram](https://telegram.org)-chat eller -gruppe. OneUptime har en innebygd **Telegram**-arbeidsflytkomponent, så oppsettet er raskt.

Denne integrasjonen er **utgående**: OneUptime sender meldinger gjennom en Telegram-bot.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Steg 1 — Opprett en bot og hent tokenet

1. I Telegram, send melding til [@BotFather](https://t.me/BotFather) og send `/newbot`.
2. Følg instruksjonene. BotFather gir deg et **bot-token** som `123456789:AA...`.

## Steg 2 — Finn chat-ID-en din

1. Legg til boten i gruppen (eller start en direkte chat med den) og send den en melding.
2. Åpne `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` i en nettleser.
3. Finn `"chat":{"id":...}` i svaret — det nummeret er din **chat-ID** (gruppe-ID-er er negative).

## Steg 3 — Lagre hemmelighetene

1. I OneUptime, gå til **Workflows → Global Variables → Create**.
2. Opprett `TELEGRAM_BOT_TOKEN` (hemmelig) og `TELEGRAM_CHAT_ID`.

## Steg 4 — Bygg arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → Telegram`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **Telegram**-komponent koblet til triggeren:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Lagre**, aktiver, og opprett en testhendelse. Meldingen ankommer i chatten din.

## Alternativ: API-komponenten

En **API**-blokk fungerer også:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Tips

- Boten ser bare meldinger etter at den er lagt til i en gruppe og **personvernmodus** tillater det — hvis `getUpdates` er tomt, send boten en melding først, eller deaktiver personvernmodus via BotFather.
- Bruk **Conditions** for å filtrere etter alvorlighetsgrad før sending.
- Legg til `"parse_mode": "Markdown"` i API-body-en (eller bruk komponentens formatering) for fet tekst og lenker.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — det utgående mønsteret.
- [Discord](/docs/integrations/discord) — det samme for Discord.
- [Komponenter → Telegram](/docs/workflows/components#telegram) — komponentreferansen.
