# یکپارچه‌سازی SMSEagle

اعلان‌های هشدار را به‌صورت پیامک یا تماس تلفنی از طریق [SMSEagle](https://www.smseagle.eu) بفرستید؛ یک دروازه پیامک سخت‌افزاری که در شبکه خودتان نصب می‌شود. OneUptime مؤلفه‌های گردش کاری **SMSEagle** را به‌صورت داخلی دارد، پس راه‌اندازی سریع است.

این یکپارچه‌سازی **خروجی** است: OneUptime پیام‌ها را از طریق [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/) می‌فرستد.

```text
OneUptime Alert → On Create  ──►  SMSEagle component  ──►  SMS or call to a phone
```

## گام ۱: ساخت کلید API

1. در GUI وب SMSEagle به **Settings → API → API v2** بروید و روی **Create API key** بزنید.
2. در **Permissions** اجازه **Send SMS** را بدهید و اگر تماس می‌خواهید، **Make a TTS Advanced Call** را هم.
3. کلید را کپی کنید. OneUptime آن را **SMSEagle Access Token** می‌نامد.

## گام ۲: دسترسی OneUptime به دستگاه

1. اتصال از سرور OneUptime به نشانی دستگاه، برای نمونه `https://192.168.0.100`، را در فایروال‌ها و VPNهای میان آن دو مجاز کنید.
2. دستگاه SMSEagle معمولاً نشانی خصوصی دارد که گردش‌های کاری به‌طور پیش‌فرض آن را مسدود می‌کنند. در نمونه خودمیزبان، نشانی IP یا نام میزبان دستگاه را روی سرور API به `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` بیفزایید، برای نمونه `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`، و آن را دوباره راه‌اندازی کنید. [دسترسی به شبکه خصوصی](/docs/self-hosted/private-network-access) را ببینید.

## گام ۳: ذخیره رازها

1. در OneUptime به **گردش‌های کاری → متغیرهای سراسری → ساخت** بروید.
2. `SMSEAGLE_URL`، `SMSEAGLE_ACCESS_TOKEN` (محرمانه) و `ONCALL_PHONE` را بسازید.

## گام ۴: ساخت گردش کاری

1. **گردش‌های کاری → ساخت گردش کاری** را باز کنید، نام آن را `Alerts → SMSEagle` بگذارید و **سازنده** را باز کنید.
2. یک راه‌انداز **Alert** با تنظیم **On Create** اضافه کنید. نام آن را به `Alert` تغییر دهید.
3. یک مؤلفه **Send SMS via SMSEagle** متصل به راه‌انداز اضافه کنید:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. روی **ذخیره** بزنید، گردش کاری را روشن کنید و یک هشدار آزمایشی بسازید. پیامک به تلفن می‌رسد.

الگوی **Text a phone via SMSEagle when an alert fires** همین گردش کاری را می‌سازد.

## تماس به‌جای پیامک

به‌جای آن از **Make a Call via SMSEagle** استفاده کنید. همان تنظیمات را دارد به‌علاوه **Voice ID**، یعنی صدای تبدیل متن به گفتار روی دستگاه، و **Text to Read Out** را می‌خواند. کلید API به مجوز **Make a TTS Advanced Call** نیاز دارد.

الگوی **Call a phone via SMSEagle when an alert fires** همین گردش کاری را با تماس می‌سازد.

## جایگزین: مؤلفه API

یک بلوک **API** هم کار می‌کند:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## نکته‌ها

- اگر دستگاه پیام را رد کند، دلیل آن در مقدار **Error** مؤلفه است. آن را روی خروجی **خطا** در گزارش ثبت کنید.
- پیش از ارسال، با **شرط‌ها** بر اساس شدت فیلتر کنید.
- برای رسیدن به چند نفر، چند مؤلفه SMSEagle وصل کنید، برای هر شماره یکی.

## ادامه مطالعه

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index): الگوی خروجی.
- [مؤلفه‌ها → SMSEagle](/docs/workflows/components#smseagle): مرجع مؤلفه.
