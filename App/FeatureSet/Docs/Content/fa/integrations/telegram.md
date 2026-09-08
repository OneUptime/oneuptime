# یکپارچه‌سازی Telegram

به‌روزرسانی‌های حادثه را به یک گفتگو یا گروه [Telegram](https://telegram.org) بفرستید. OneUptime یک مؤلفه گردش کاری داخلی به نام **Telegram** دارد، بنابراین راه‌اندازی سریع است.

این یکپارچه‌سازی **خروجی** است: OneUptime پیام‌ها را از طریق یک ربات Telegram می‌فرستد.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## گام ۱ — ساخت یک ربات و گرفتن توکن آن

1. در Telegram به [@BotFather](https://t.me/BotFather) پیام بدهید و `/newbot` بفرستید.
2. راهنما را دنبال کنید. BotFather یک **توکن ربات** مانند `123456789:AA...` به شما می‌دهد.

## گام ۲ — پیدا کردن شناسه گفتگو

1. ربات را به گروه اضافه کنید (یا گفتگوی مستقیمی با آن شروع کنید) و هر پیامی برایش بفرستید.
2. نشانی `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` را در مرورگر باز کنید.
3. در پاسخ به دنبال `"chat":{"id":...}` بگردید — آن عدد **شناسه گفتگو** شماست (شناسه گروه‌ها منفی است).

## گام ۳ — ذخیره اسرار

1. در OneUptime به **Workflows → Global Variables → Create** بروید.
2. متغیرهای `TELEGRAM_BOT_TOKEN` (محرمانه) و `TELEGRAM_CHAT_ID` را بسازید.

## گام ۴ — ساخت گردش کاری

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → Telegram` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک مؤلفه **Telegram** متصل به تریگر اضافه کنید:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. پیام به گفتگوی شما می‌رسد.

## جایگزین: مؤلفه API

یک بلوک **API** هم کار می‌کند:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## نکته‌ها

- ربات فقط پیام‌هایی را می‌بیند که پس از افزوده شدنش به گروه فرستاده شده باشند و **حالت حریم خصوصی** اجازه دهد — اگر `getUpdates` خالی بود، ابتدا به ربات پیام بفرستید یا از طریق BotFather حالت حریم خصوصی را خاموش کنید.
- با **Conditions** پیش از ارسال بر اساس شدت فیلتر کنید.
- برای متن پررنگ و پیوند، `"parse_mode": "Markdown"` را به بدنه API اضافه کنید (یا از قالب‌بندی خود مؤلفه استفاده کنید).

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوی خروجی.
- [Discord](/docs/integrations/discord) — همین ایده برای Discord.
- [مؤلفه‌ها → Telegram](/docs/workflows/components#telegram) — مرجع مؤلفه.
