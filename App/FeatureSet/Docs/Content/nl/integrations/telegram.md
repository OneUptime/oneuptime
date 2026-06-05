# Telegram-integratie

Stuur incidentupdates naar een [Telegram](https://telegram.org)-chat of -groep. OneUptime heeft een ingebouwde **Telegram**-workflowcomponent, waardoor de installatie snel gaat.

Deze integratie is **outbound**: OneUptime verstuurt berichten via een Telegram-bot.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Stap 1 — Maak een bot aan en haal het token op

1. Stuur in Telegram een bericht naar [@BotFather](https://t.me/BotFather) en stuur `/newbot`.
2. Volg de stappen. BotFather geeft je een **bottoken** zoals `123456789:AA...`.

## Stap 2 — Vind je chat-ID

1. Voeg de bot toe aan de groep (of start een directe chat ermee) en stuur hem een willekeurig bericht.
2. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in een browser.
3. Zoek `"chat":{"id":...}` in de respons — dat getal is je **chat-ID** (groeps-ID's zijn negatief).

## Stap 3 — Sla de geheimen op

1. Ga in OneUptime naar **Workflows → Global Variables → Create**.
2. Maak `TELEGRAM_BOT_TOKEN` (geheim) en `TELEGRAM_CHAT_ID` aan.

## Stap 4 — Bouw de workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → Telegram`, en open de **Builder**.
2. Voeg een **Incident**-trigger toe ingesteld op **On Create**. Hernoem het naar `Incident`.
3. Voeg een **Telegram**-component toe verbonden met de trigger:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Sla op**, schakel in en maak een testincident aan. Het bericht komt binnen in je chat.

## Alternatief: de API-component

Een **API**-blok werkt ook:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Tips

- De bot ziet alleen berichten nadat hij aan een groep is toegevoegd en **privacy mode** hem toestaat — als `getUpdates` leeg is, stuur de bot dan eerst een bericht, of schakel privacy mode uit via BotFather.
- Gebruik **Conditions** om te filteren op severity vóór het sturen.
- Voeg `"parse_mode": "Markdown"` toe aan de API-body (of gebruik de opmaak van de component) voor vetgedrukte tekst en links.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — het outbound-patroon.
- [Discord](/docs/integrations/discord) — hetzelfde idee voor Discord.
- [Componenten → Telegram](/docs/workflows/components#telegram) — de componentreferentie.
