# Telegram Integration

Send incident updates to a [Telegram](https://telegram.org) chat or group. OneUptime has a built-in **Telegram** workflow component, so setup is quick.

This integration is **outbound**: OneUptime sends messages through a Telegram bot.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Step 1 — Create a bot and get its token

1. In Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Follow the prompts. BotFather gives you a **bot token** like `123456789:AA...`.

## Step 2 — Find your chat ID

1. Add the bot to the group (or start a direct chat with it) and send it any message.
2. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser.
3. Find `"chat":{"id":...}` in the response — that number is your **chat ID** (group IDs are negative).

## Step 3 — Store the secrets

1. In OneUptime, go to **Workflows → Global Variables → Create**.
2. Create `TELEGRAM_BOT_TOKEN` (secret) and `TELEGRAM_CHAT_ID`.

## Step 4 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → Telegram`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add a **Telegram** component connected to the trigger:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save**, enable, and create a test incident. The message arrives in your chat.

## Alternative: the API component

An **API** block works too:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Tips

- The bot only sees messages after it's been added to a group and **privacy mode** allows it — if `getUpdates` is empty, send the bot a message first, or disable privacy mode via BotFather.
- Use **Conditions** to filter by severity before sending.
- Add `"parse_mode": "Markdown"` to the API body (or use the component's formatting) for bold and links.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the outbound pattern.
- [Discord](/docs/integrations/discord) — the same idea for Discord.
- [Components → Telegram](/docs/workflows/components#telegram) — the component reference.
