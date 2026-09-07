# یکپارچه‌سازی Discord

به‌روزرسانی‌های حادثه را در یک کانال [Discord](https://discord.com) منتشر کنید. OneUptime یک مؤلفه گردش کاری داخلی به نام **Discord** دارد، بنابراین این یکی از سریع‌ترین یکپارچه‌سازی‌ها برای راه‌اندازی است.

این یکپارچه‌سازی **خروجی** است: OneUptime از طریق یک نشانی وب‌هوک ورودی در کانال Discord پیام می‌گذارد.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## گام ۱ — ساخت یک وب‌هوک Discord

1. در Discord، مسیر **Edit Channel → Integrations → Webhooks** کانال هدف را باز کنید.
2. روی **New Webhook** کلیک کنید، نامی به آن بدهید (برای نمونه `OneUptime`)، کانال را انتخاب کنید و **Copy Webhook URL** را بزنید.

## گام ۲ — ذخیره نشانی وب‌هوک (اختیاری اما توصیه‌شده)

1. در OneUptime به **Workflows → Global Variables → Create** بروید.
2. نام آن را `DISCORD_WEBHOOK_URL` بگذارید، نشانی را در آن بگذارید و **Is Secret** را روشن کنید.

نگه داشتن آن در یک متغیر یعنی می‌توانید در گردش‌های کاری مختلف از آن استفاده کنید و در یک جا بچرخانیدش.

## گام ۳ — ساخت گردش کاری

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → Discord` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک مؤلفه **Discord** متصل به تریگر اضافه کنید:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (یا نشانی را مستقیم بگذارید).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. پیام در کانال شما ظاهر می‌شود.

## جایگزین: مؤلفه API

اگر ترجیح می‌دهید از مؤلفه اختصاصی استفاده نکنید، یک بلوک **API** همین کار را می‌کند:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

اگر [embedهای](https://discord.com/developers/docs/resources/webhook#execute-webhook) غنی‌تر Discord را می‌خواهید این روش مفید است — یک آرایه `embeds` به بدنه اضافه کنید.

## نکته‌ها

- با **Conditions** فقط برای شدت‌های خاصی پیام بگذارید — پیش از بلوک Discord روی `{{Incident.incidentSeverity.name}}` انشعاب بزنید.
- گردش‌های کاری بیشتری روی **Incident → On Update** اضافه کنید تا تأییدها و رفع‌ها هم در همان کانال منتشر شوند.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوی خروجی.
- [Telegram](/docs/integrations/telegram) — همین ایده برای Telegram.
- [مؤلفه‌ها ← Discord](/docs/workflows/components#discord) — مرجع مؤلفه.
