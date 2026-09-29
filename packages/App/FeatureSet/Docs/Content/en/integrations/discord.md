# Discord Integration

Post incident updates to a [Discord](https://discord.com) channel. OneUptime has a built-in **Discord** workflow component, so this is one of the quickest integrations to set up.

This integration is **outbound**: OneUptime posts to a Discord channel through an incoming webhook URL.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Step 1 — Create a Discord webhook

1. In Discord, open the target channel's **Edit Channel → Integrations → Webhooks**.
2. Click **New Webhook**, give it a name (e.g. `OneUptime`), pick the channel, and **Copy Webhook URL**.

## Step 2 — Store the webhook URL (optional but recommended)

1. In OneUptime, go to **Workflows → Global Variables → Create**.
2. Name it `DISCORD_WEBHOOK_URL`, paste the URL, and turn on **Is Secret**.

Keeping it in a variable means you can reuse it across workflows and rotate it in one place.

## Step 3 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → Discord`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add a **Discord** component connected to the trigger:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (or paste it directly).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save**, enable, and create a test incident. The message appears in your channel.

## Alternative: the API component

If you'd rather not use the dedicated component, an **API** block does the same thing:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

This is handy if you want Discord's richer [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) — add an `embeds` array to the body.

## Tips

- Use **Conditions** to only post for certain severities — branch on `{{Incident.incidentSeverity.name}}` before the Discord block.
- Add more workflows on **Incident → On Update** to post acknowledgements and resolutions to the same channel.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the outbound pattern.
- [Telegram](/docs/integrations/telegram) — the same idea for Telegram.
- [Components → Discord](/docs/workflows/components#discord) — the component reference.
