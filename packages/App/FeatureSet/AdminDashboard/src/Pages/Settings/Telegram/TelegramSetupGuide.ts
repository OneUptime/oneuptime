/*
 * The setup guide on Admin Dashboard > Settings > Telegram, as Markdown.
 *
 * The last part walks the server admin through a first message end to end.
 * Telegram starts off in every project (each project switches its own SMS,
 * phone calls, WhatsApp and Telegram on), and until a project has it on
 * nobody there can link a Telegram account - UserTelegramService refuses
 * the row. Only a project owner, a Billing Admin or someone with Manage
 * Billing may switch it on (the Project column's own update permissions,
 * Common/Utils/Project/NotificationChannels), and the server admin reading
 * this is often neither, so the guide says who turns it on, and where,
 * before it sends anyone to link an account.
 */

export const TELEGRAM_PROJECT_SWITCH_STEP: string =
  "In each project that should use Telegram, a project owner, a **Billing Admin** or someone with **Manage Billing** turns **Telegram** on in **Project Settings → Notification Settings**, in the **Notification Channels** card. It starts off in every project, and until it is on nobody in the project can link a Telegram account.";

export const buildTelegramSetupMarkdown: (webhookUrl: string) => string = (
  webhookUrl: string,
): string => {
  return [
    "### What you'll need",
    "- A Telegram account and access to [@BotFather](https://t.me/BotFather).",
    "- Admin access to OneUptime with permission to edit global notification settings.",
    "",
    "### 1. Create a bot and grab its token",
    "1. Open Telegram and chat with [@BotFather](https://t.me/BotFather).",
    "2. Send `/newbot` and follow the prompts. BotFather will return two things:",
    "   - A **bot token** that looks like `8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321` — this goes into the **Bot Token** field above.",
    "   - A **bot username** ending in `bot` (for example, `OneUptimeAlertsBot`) — this goes into the **Bot Username** field above (without the leading `@`).",
    "3. Pick a strong random string to use as your **Webhook Secret Token** and paste it into the third field. OneUptime sends this back to itself via `X-Telegram-Bot-Api-Secret-Token` so spoofed webhook calls get rejected.",
    "4. Save the form.",
    "",
    "### 2. Register the webhook with Telegram",
    "Run this command in a terminal (replace `<BOT_TOKEN>` and `<SECRET>` with the values you just saved). **Do not paste this command back into the form above — it belongs in your shell.**",
    "",
    "```bash",
    `curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \\`,
    '  -H "Content-Type: application/json" \\',
    "  -d '{",
    `    "url": "${webhookUrl}",`,
    '    "secret_token": "<SECRET>",',
    '    "allowed_updates": ["message"]',
    "  }'",
    "```",
    "",
    "Confirm the webhook is live with `curl https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` — the `url` field should match the value above.",
    "",
    "### 3. Test end-to-end",
    "1. Use the **Send Test Telegram Message** card below to confirm your bot can reach a chat. You can get your own chat ID by sending any message to [@userinfobot](https://t.me/userinfobot).",
    `2. ${TELEGRAM_PROJECT_SWITCH_STEP}`,
    "3. Ask users to open **User Settings → Notification Methods → Telegram** in the OneUptime dashboard. They'll scan a QR (or tap a deep link) to send `/start <code>` to your bot — that's how we capture their chat ID and mark the account verified.",
    "4. Once verified, users can toggle Telegram in **User Settings → Notification Settings** and include Telegram in any on-call notification rule.",
    "",
    "### Webhook endpoint",
    `- \`${webhookUrl}\``,
    "",
    "This endpoint only reacts to `/start <code>` messages from users. Every other update is ignored.",
  ].join("\n");
};
