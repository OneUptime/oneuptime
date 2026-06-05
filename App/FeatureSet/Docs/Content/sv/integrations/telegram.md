# Telegram-integration

Skicka incidentuppdateringar till en [Telegram](https://telegram.org)-chatt eller -grupp. OneUptime har en inbyggd **Telegram**-arbetsflödeskomponent, så uppsättningen går snabbt.

Den här integrationen är **utgående**: OneUptime skickar meddelanden via en Telegram-bot.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Steg 1 — Skapa en bot och hämta dess token

1. I Telegram, meddela [@BotFather](https://t.me/BotFather) och skicka `/newbot`.
2. Följ anvisningarna. BotFather ger dig en **bot-token** som `123456789:AA...`.

## Steg 2 — Hitta ditt chatt-ID

1. Lägg till boten i gruppen (eller starta en direktchatt med den) och skicka den ett meddelande.
2. Öppna `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` i en webbläsare.
3. Hitta `"chat":{"id":...}` i svaret — det numret är ditt **chatt-ID** (grupp-ID:n är negativa).

## Steg 3 — Spara hemligheterna

1. Gå i OneUptime till **Workflows → Global Variables → Create**.
2. Skapa `TELEGRAM_BOT_TOKEN` (hemlighet) och `TELEGRAM_CHAT_ID`.

## Steg 4 — Bygg arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → Telegram` och öppna **Builder**.
2. Lägg till en **Incident**-utlösare inställd på **On Create**. Byt namn till `Incident`.
3. Lägg till en **Telegram**-komponent kopplad till utlösaren:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Spara**, aktivera och skapa en testincident. Meddelandet anländer i din chatt.

## Alternativ: API-komponenten

Ett **API**-block fungerar också:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Tips

- Boten ser bara meddelanden efter att den lagts till i en grupp och **sekretessläget** tillåter det — om `getUpdates` är tomt, skicka boten ett meddelande först, eller inaktivera sekretessläget via BotFather.
- Använd **Conditions** för att filtrera på allvarlighetsgrad innan du skickar.
- Lägg till `"parse_mode": "Markdown"` i API-bodyn (eller använd komponentens formatering) för fetstil och länkar.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — det utgående mönstret.
- [Discord](/docs/integrations/discord) — samma idé för Discord.
- [Komponenter → Telegram](/docs/workflows/components#telegram) — komponentreferensen.
