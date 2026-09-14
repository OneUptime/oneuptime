# یکپارچه‌سازی Slack

پروژه خودمیزبان OneUptime را به Slack متصل کنید تا اعلان بفرستید و از عملیات رخداد، فرمان‌ها و رویدادهای پیام استفاده کنید.

## راه‌اندازی

1. نام میزبان و HTTPS را طبق توضیحات زیر تنظیم کنید. مانیفست تولیدشده را در **Settings > Slack Integration** کپی کنید؛ این فایل در `https://your-oneuptime-domain.com/api/slack/app-manifest` نیز در دسترس است.
2. با مانیفست تولیدشده در استقرار خود، در فضای کاری یک [برنامه Slack بسازید](https://api.slack.com/apps) تا نشانی‌ها با نام میزبان شما مطابقت داشته باشند.
3. مقادیر **Client ID**، **Client Secret** و **Signing Secret** را از **Basic Information** برنامه برای Docker Compose در `config.env` کپی کنید:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   برای Helm این مقادیر را تنظیم کنید:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. پیکربندی را اعمال کنید و منتظر راه‌اندازی مجدد OneUptime بمانید. اگر بررسی Events URL پیش از تنظیم راز امضا ناموفق بود، اکنون دوباره امتحان کنید.
5. به **Settings > Slack Integration** برگردید، **Connect to Slack** را انتخاب کنید و به برنامه مجوز دهید. برای عملیات نیازمند هویت کاربر، حساب شخصی Slack را نیز در OneUptime متصل کنید.

## دسترسی شبکه برای استقرارهای خودمیزبان

### جهت ترافیک و نقطه‌های پایانی

| ترافیک | دسترسی لازم |
| --- | --- |
| OneUptime → Slack | DNS و HTTPS خروجی روی TCP 443 به `slack.com` برای Web API و تبادل توکن OAuth؛ به `hooks.slack.com` برای پاسخ فرمان‌ها و اعلان وب‌هوک‌های ورودی، در صورت استفاده |
| Slack → OneUptime | HTTPS عمومی روی TCP 443 به چهار مسیر POST زیر برای یکپارچه‌سازی کامل |
| مرورگر کاربر → OneUptime | داشبورد و تغییرمسیرهای OAuth به `/api/slack/auth/:projectId/:userId` و `/api/slack/auth/:projectId/:userId/user`؛ این مسیرها می‌توانند از طریق VPN کاربر در دسترس بمانند |

این دامنه‌های خروجی مربوط به یکپارچه‌سازی OneUptime هستند، نه فهرست کامل مجاز برای کلاینت‌ها یا همه قابلیت‌های Slack. وب‌هوک *ورودی* Slack در Slack میزبانی می‌شود و OneUptime به آن درخواست می‌فرستد؛ نقطه ورودی سرور شما نیست. [راهنمای وب‌هوک‌های ورودی](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) را ببینید.

این کال‌بک‌های ارائه‌دهنده را از طریق ingress به برنامه OneUptime هدایت کنید:

| روش و مسیر | کاربرد |
| --- | --- |
| `POST /api/slack/events` | تأیید Events API، واکنش‌ها، اشاره‌ها و پیام‌ها |
| `POST /api/slack/interactive` | دکمه‌ها، میان‌برها، ارسال فرم‌های مودال، `/incident` و `/maintenance` |
| `POST /api/slack/options-load` | درخواست گزینه‌های منوی تعاملی |
| `POST /api/slack/command` | فرمان `/oneuptime` |

OAuth از [تغییرمسیر مرورگر و سپس تبادل توکن در سرور](https://docs.slack.dev/authentication/installing-with-oauth/) استفاده می‌کند. مانیفست `/api/slack/auth` را به‌عنوان پیشوند ثبت می‌کند و OneUptime هنگام مجوزدهی مسیر پروژه و کاربر را می‌افزاید. دسترسی مرورگر به‌تنهایی امکان تحویل رویدادها یا عملیات دکمه‌ها از Slack را فراهم نمی‌کند.

### استقرار خصوصی و امنیت کال‌بک‌ها

از DNS عمومی و دروازه‌ای با گواهی HTTPS مورد اعتماد عمومی، زنجیره کامل گواهی و مسیر خصوصی به ingress در OneUptime استفاده کنید. TCP 443 ورودی را مجاز کنید و فقط کال‌بک‌های POST ارائه‌دهنده در بالا را منتشر کنید. `ClusterIP` خصوصی، DNS داخلی یا VPN کارمند به‌تنهایی به ارائه‌دهنده دسترسی نمی‌دهد. DNS تفکیک‌شده می‌تواند داشبورد و مسیرهای OAuth مرورگر را با همان نام میزبان خصوصی نگه دارد.

در `config.env` مقادیر `HOST=oneuptime.example.com` و `HTTP_PROTOCOL=https`، یا در Helm مقادیر `host: oneuptime.example.com` و `httpProtocol: https` را تنظیم کنید. تنظیمات را اعمال کنید و منتظر راه‌اندازی مجدد بمانید. این مقادیر URL تولید می‌کنند و DNS، TLS یا قواعد دیوار آتش را ایجاد نمی‌کنند. پس از تغییر نام میزبان، مانیفست Slack را دوباره تولید و به‌روزرسانی کنید.

روش، مسیر، رشته پرس‌وجو، بدنه اصلی، `Content-Type`، `X-Slack-Signature` و `X-Slack-Request-Timestamp` را حفظ کنید. میزبان عمومی و HTTPS را با هدرهای پراکسی قابل اعتماد نگه دارید. کال‌بک‌ها را از SSO مرورگر، CAPTCHA و صفحه ورود پراکسی معاف کنید، اما بررسی امضا و زمان OneUptime را حفظ کنید. ساعت سرور را همگام کنید. بررسی IP مبدأ جایگزین [تأیید امضای Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/) نیست.

### بررسی دسترسی و محدودیت‌ها

در **Event Subscriptions**، نشانی Events Request URL را تأیید کنید: Slack یک [چالش POST می‌فرستد و TLS را بررسی می‌کند](https://docs.slack.dev/apis/events-api/using-http-request-urls/). سپس اعلان آزمایشی بفرستید، فرمان اسلش اجرا کنید، دکمه رخداد را بزنید و رویداد مشترک‌شده را فعال کنید. لاگ دروازه و OneUptime را بدون ثبت اسرار بررسی کنید. Slack تأیید سریع می‌خواهد، از جمله [پاسخ ظرف سه ثانیه برای تعاملات](https://docs.slack.dev/interactivity/handling-user-interaction/). GET مرورگر یا موفقیت ارسال پیام، کال‌بک‌های POST را تأیید نمی‌کند.

با ممنوعیت همه ارتباطات ورودی، برنامه‌ای که قبلاً مجوز گرفته همچنان می‌تواند با HTTPS خروجی پیام بفرستد، اما رویدادها، دکمه‌ها، میان‌برها و فرمان‌ها کار نمی‌کنند. مانیفست OneUptime از کال‌بک HTTP استفاده می‌کند و Socket Mode را غیرفعال می‌کند؛ فعال‌کردن Socket Mode در Slack جایگزین پشتیبانی‌شده نیست. [تنظیم دسترسی شبکه خصوصی](/docs/self-hosted/private-network-access) درخواست‌های خروجی به مقصدهای خصوصی را کنترل می‌کند و کال‌بک را منتشر نمی‌کند.
