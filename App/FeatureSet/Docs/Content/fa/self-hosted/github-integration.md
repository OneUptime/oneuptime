# یکپارچه‌سازی GitHub

برای یکپارچه کردن GitHub با نمونه خودمیزبان OneUptime خود، باید یک GitHub App بسازید و متغیرهای محیطی لازم را پیکربندی کنید. این به OneUptime امکان می‌دهد برای مدیریت مخزن کد به مخزن‌های GitHub شما وصل شود.

## پیش‌نیازها

- حسابی در GitHub با دسترسی مدیر سازمان (برای مخزن‌های سازمانی) یا دسترسی حساب شخصی
- دسترسی به پیکربندی کارساز OneUptime شما

## دستورالعمل راه‌اندازی

### گام ۱: ساخت یک GitHub App

1. به GitHub بروید و به تنظیمات سازمان یا حساب شخصی خود بروید:

   - **برای سازمان‌ها:** به `https://github.com/organizations/YOUR_ORG/settings/apps` بروید
   - **برای حساب شخصی:** به `https://github.com/settings/apps` بروید

2. روی **"New GitHub App"** کلیک کنید

3. فرم ثبت‌نام را پر کنید:
   - **GitHub App name:** OneUptime (یا هر نام یکتای دیگری) — **این نام را ذخیره کنید، برای متغیر محیطی `GITHUB_APP_NAME` لازمش خواهید داشت**
   - **Homepage URL:** `https://your-oneuptime-domain.com`
   - **Callback URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` — **مهم: این نشانی جایی است که GitHub پس از نصب برنامه، کاربران را به آن هدایت می‌کند. برای کار کردن هدایت باید تنظیم شود.**
   - **Redirect on update:** این گزینه را تیک بزنید تا کاربران پس از به‌روزرسانی نصب برنامه هدایت شوند
   - **Request user authorization (OAuth) during installation:** **این گزینه را تیک بزنید — الزامی است.** پایین‌تر را ببینید.
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret:** رشته‌ای تصادفی و امن تولید کنید (برای بعد ذخیره‌اش کنید). **الزامی است** — OneUptime وب‌هوک‌های بدون امضا را رد می‌کند، پس تنظیم‌نکردن `GITHUB_APP_WEBHOOK_SECRET` به‌جای پذیرفتن محموله‌های تأییدنشده، همگام‌سازی مخزن را متوقف می‌کند.

> **چرا «Request user authorization (OAuth) during installation» الزامی است**
>
> پس از نصب، GitHub با یک `installation_id` در نشانی برمی‌گرداند. آن عدد به‌تنهایی چیزی درباره مالک نصب اثبات نمی‌کند — هر کسی می‌تواند عدد دیگری تایپ کند. با فعال بودن این گزینه، GitHub یک `code` یک‌بارمصرف OAuth هم برمی‌گرداند که به حساب GitHubای گره خورده که نصب را انجام داده، و OneUptime آن را مبادله می‌کند تا پیش از وصل کردنش به پروژه شما تأیید کند آن حساب واقعاً نصب را مدیریت می‌کند.
>
> بدون آن، OneUptime از وصل کردن نصب سر باز می‌زند و داشبورد خطایی نشان می‌دهد که از شما می‌خواهد این تنظیم را فعال کنید. این عمدی است: پذیرفتن شناسه نصب بدون تأیید، به یک پروژه OneUptime امکان می‌داد مخزن‌های سازمانی دیگر را از آن خود کند.

### گام ۲: پیکربندی دسترسی‌های برنامه

در بخش «Permissions & events»، دسترسی‌های زیر را پیکربندی کنید:

**دسترسی‌های مخزن:**

| دسترسی | سطح دسترسی | هدف |
| --------------- | ------------ | ------------------------------------------------------------ |
| Contents | Read & Write | خواندن فایل‌های مخزن، فرستادن شاخه‌ها (برای عامل هوش مصنوعی الزامی است) |
| Pull requests | Read & Write | ساخت و مدیریت درخواست‌های ادغام |
| Issues | Read & Write | خواندن و نظر دادن روی issueها |
| Commit statuses | Read | بررسی وضعیت ساخت/CI |
| Actions | Read | خواندن اجراها و گزارش‌های گردش کاری GitHub Actions |
| Metadata | Read | فراداده پایه‌ای مخزن (الزامی) |

**دسترسی‌های سازمان (اگر با سازمان‌ها به کار می‌برید):**

| دسترسی | سطح دسترسی | هدف |
| ---------- | ------------ | ------------------------- |
| Members | Read | فهرست کردن اعضای سازمان |

**دسترسی‌های حساب:**

| دسترسی | سطح دسترسی | هدف |
| --------------- | ------------ | --------------------------------- |
| Email addresses | Read | خواندن ایمیل کاربر برای اعلان‌ها |

### گام ۳: اشتراک در رویدادهای وب‌هوک

OneUptime نصب و دسترسی مخزن را با `installation` و `installation_repositories` همگام می‌کند که GitHub Apps خودکار دریافت می‌کنند. رویدادهای دیگر از جمله **Pull request**، **Push** و **Workflow run** فقط تأیید دریافت می‌شوند؛ اشتراک آن‌ها اعلان یا خودکارسازی CI/CD را فعال نمی‌کند.

### گام ۴: تنظیم دسترسی نصب

زیر «Where can this GitHub App be installed?» برگزینید:

- **Only on this account** — برای استفاده خصوصی/داخلی
- **Any account** — اگر می‌خواهید دیگران هم برنامه‌تان را نصب کنند

### گام ۵: ساخت GitHub App

1. روی **"Create GitHub App"** کلیک کنید
2. به صفحه تنظیمات برنامه‌تان هدایت می‌شوید
3. این مقادیر را یادداشت کنید:
   - **App ID** — بالای صفحه تنظیمات برنامه
   - **Client ID** — در بخش «About»

### گام ۶: تولید Client Secret

1. در تنظیمات GitHub App خود، به «Client secrets» بروید
2. روی **"Generate a new client secret"** کلیک کنید
3. راز را فوراً کپی کنید — دیگر نمی‌توانید ببینیدش

### گام ۷: تولید کلید خصوصی

1. به بخش «Private keys» بروید
2. روی **"Generate a private key"** کلیک کنید
3. فایلی `.pem` به‌طور خودکار دانلود می‌شود
4. این فایل را امن نگه دارید — برای احراز هویت به‌عنوان GitHub App به کار می‌رود

### گام ۸: پیکربندی متغیرهای محیطی OneUptime

#### Docker Compose

اگر از Docker Compose استفاده می‌کنید، این متغیرهای محیطی را به فایل `config.env` خود اضافه کنید:

```bash
# GitHub App Configuration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # The exact name of your GitHub App (e.g., "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**توجه:** اگر محیط شما از رشته‌های چندخطی پشتیبانی نمی‌کند، کلید خصوصی را با base64 رمزگذاری کنید و بدون خط جدید بچسبانید.

#### Kubernetes با Helm

اگر از Kubernetes با Helm استفاده می‌کنید، این‌ها را به فایل `values.yaml` خود اضافه کنید:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**مهم:** پس از افزودن این متغیرهای محیطی، کارساز OneUptime خود را بازراه‌اندازی کنید تا اثر کنند.

### گام ۹: نصب GitHub App

1. به صفحه عمومی GitHub App خود بروید: `https://github.com/apps/YOUR_APP_NAME`
2. روی **"Install"** یا **"Configure"** کلیک کنید
3. سازمان یا حسابی را که می‌خواهید برنامه را در آن نصب کنید برگزینید
4. برگزینید برنامه به کدام مخزن‌ها دسترسی داشته باشد:
   - **All repositories** — دسترسی به همه مخزن‌های جاری و آینده
   - **Only select repositories** — مخزن‌های مشخصی را برگزینید
5. روی **"Install"** کلیک کنید

### گام ۱۰: وصل کردن مخزن‌ها در OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Products** > **Code Repositories** بروید
3. روی **"Create Repository"** کلیک کنید یا از جریان نصب GitHub App استفاده کنید
4. اگر از GitHub هدایت شده باشید، شناسه نصب به‌طور خودکار ثبت می‌شود
5. مخزن‌هایی را که می‌خواهید وصل کنید از فهرست برگزینید
6. برای پیوند دادن مخزن به پروژه OneUptime خود روی **"Connect"** کلیک کنید

## مرجع متغیرهای محیطی

| متغیر | توضیح | الزامی |
| --------------------------- | -------------------------------------------------------------- | -------------------- |
| `GITHUB_APP_ID` | شناسه برنامه از تنظیمات GitHub App شما | بله |
| `GITHUB_APP_NAME` | نام دقیق GitHub App شما (برای نشانی‌های نصب به کار می‌رود) | بله |
| `GITHUB_APP_CLIENT_ID` | شناسه کلاینت از تنظیمات GitHub App شما | بله |
| `GITHUB_APP_CLIENT_SECRET` | راز کلاینتی که تولید کردید | بله |
| `GITHUB_APP_PRIVATE_KEY` | محتوای کلید خصوصی (فایل ‎.pem) | بله |
| `GITHUB_APP_WEBHOOK_SECRET` | راز وب‌هوک برای تأیید محموله‌های وب‌هوک | بله، برای وب‌هوک‌ها |

## دسترسی شبکه برای استقرارهای خودمیزبان

### جهت ترافیک و نقطه‌های پایانی

| ترافیک | دسترسی لازم |
| --- | --- |
| OneUptime → GitHub | DNS و HTTPS خروجی روی TCP 443 به `api.github.com` برای توکن برنامه و API مخزن، و `github.com` برای تبادل OAuth و عملیات Git روی HTTPS |
| GitHub → OneUptime | HTTPS عمومی روی TCP 443 به `POST /api/github/webhook` برای همگام‌سازی نصب و دسترسی مخزن |
| مرورگر کاربر → OneUptime | داشبورد و `GET /api/github/auth/callback` برای تغییرمسیر نصب/مجوزدهی؛ می‌توانند از طریق VPN کاربر در دسترس بمانند |

نشانی‌های Callback/Setup برای [تغییرمسیر مرورگر](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url) هستند؛ سرورهای GitHub وب‌هوک را فراخوانی می‌کنند. VPN کاربر به GitHub دسترسی وب‌هوک نمی‌دهد. دامنه‌ها درخواست‌های اصلی را پوشش می‌دهند؛ ابزارها، دانلودها، LFS یا بسته‌ها ممکن است مقصدهای دیگری بخواهند. این تنظیمات مربوط به GitHub.com هستند؛ تغییر دیوار آتش پشتیبانی از نام میزبان GitHub Enterprise Server را پیکربندی نمی‌کند.

### استقرار خصوصی و امنیت کال‌بک‌ها

از DNS عمومی و دروازه‌ای با گواهی HTTPS مورد اعتماد عمومی، زنجیره کامل گواهی و مسیر خصوصی به ingress در OneUptime استفاده کنید. TCP 443 ورودی را مجاز کنید و فقط کال‌بک‌های POST ارائه‌دهنده در بالا را منتشر کنید. `ClusterIP` خصوصی، DNS داخلی یا VPN کارمند به‌تنهایی به ارائه‌دهنده دسترسی نمی‌دهد. DNS تفکیک‌شده می‌تواند داشبورد و مسیرهای OAuth مرورگر را با همان نام میزبان خصوصی نگه دارد.

در `config.env` مقادیر `HOST=oneuptime.example.com` و `HTTP_PROTOCOL=https`، یا در Helm مقادیر `host: oneuptime.example.com` و `httpProtocol: https` را تنظیم کنید. تنظیمات را اعمال کنید و منتظر راه‌اندازی مجدد بمانید. این مقادیر URL تولید می‌کنند و DNS، TLS یا قواعد دیوار آتش را ایجاد نمی‌کنند. پس از تغییر نام میزبان، URLهای Webhook، Callback، Setup و Homepage برنامه GitHub را به‌روزرسانی کنید.

روش، مسیر اصلی، رشته پرس‌وجو، بدنه، `Content-Type`، `X-Hub-Signature-256`، `X-GitHub-Event` و `X-GitHub-Delivery` را حفظ کنید. میزبان عمومی و HTTPS را با هدرهای پراکسی قابل اعتماد نگه دارید. وب‌هوک را از SSO مرورگر، CAPTCHA و ورود پراکسی معاف کنید. تأیید SSL در GitHub را روشن نگه دارید و در هر دو سیستم `GITHUB_APP_WEBHOOK_SECRET` یکسان قرار دهید: OneUptime درخواست بی‌امضا را رد می‌کند و بدون این راز نمی‌تواند وب‌هوک را تأیید کند. [راهنمای تأیید GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) را ببینید.

اگر IP مبدأ را هم محدود می‌کنید، محدوده‌های فعلی `hooks` از GitHub Meta API را به‌کار برید و مرتب به‌روز کنید. محدوده اجراکننده‌های GitHub Actions را جایگزین نکنید و بررسی امضا را حذف نکنید. GitHub هشدار می‌دهد که [نشانی‌ها تغییر می‌کنند و فهرست کامل نیست](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### بررسی دسترسی و محدودیت‌ها

نصب را از OneUptime کامل کنید و **Advanced > Recent Deliveries** برنامه GitHub را ببینید. یک تحویل آزمایشی ارسال یا تکرار کنید و هدایت و پذیرش آن را بررسی کنید. مخزن آزمایشی را از نصب اضافه یا حذف کنید و به‌روزرسانی فهرست متصل را ببینید. GitHub [عیب‌یابی تحویل](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) را توضیح می‌دهد و [تأیید 2xx ظرف ده ثانیه](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) می‌خواهد. GET مرورگر، POST امضاشده را آزمایش نمی‌کند.

بدون دسترسی ورودی، مجوزدهی مرورگر و عملیات خروجی API/Git ممکن است کار کنند، اما حذف نصب و تغییر دسترسی مخزن با وب‌هوک همگام نمی‌شوند. OneUptime اکنون `installation` و `installation_repositories` را پردازش می‌کند؛ پذیرش رویداد دیگر به معنی خودکارسازی بیشتر نیست. [تنظیم دسترسی شبکه خصوصی](/docs/self-hosted/private-network-access) درخواست خروجی به مقصد خصوصی را کنترل می‌کند و وب‌هوک را دسترس‌پذیر نمی‌کند.

## رفع اشکال

### مشکل‌های رایج

**پس از نصب GitHub App به OneUptime برنگشتم:**

- مطمئن شوید **Setup URL** در تنظیمات GitHub App شما روی این تنظیم شده است: `https://your-oneuptime-domain.com/api/github/auth/callback`
- به تنظیمات GitHub App خود > بخش «Post installation» بروید و تأیید کنید Setup URL درست تنظیم شده است
- گزینه «Redirect on update» هم باید تیک خورده باشد
- توجه: Setup URL با Callback URL فرق دارد — هر دو باید به همان نقطه پایانی `/api/github/auth/callback` اشاره کنند

**خطای «GitHub App is not configured»:**

- مطمئن شوید متغیر محیطی `GITHUB_APP_CLIENT_ID` تنظیم شده است
- پس از تنظیم متغیرهای محیطی، کارساز OneUptime خود را بازراه‌اندازی کنید

**خطای «Invalid webhook signature»:**

- تأیید کنید `GITHUB_APP_WEBHOOK_SECRET` شما با رازی که در GitHub پیکربندی شده می‌خواند
- مطمئن شوید نشانی وب‌هوک درست و از اینترنت دست‌یافتنی است

**خطای «Failed to get installation access token»:**

- تأیید کنید `GITHUB_APP_PRIVATE_KEY` شما درست قالب‌بندی شده است
- بررسی کنید کلید خصوصی نشانگرهای BEGIN/END را دربر داشته باشد
- مطمئن شوید شناسه برنامه درست است

**پس از نصب مخزن‌ها را نمی‌بینم:**

- تأیید کنید GitHub App به مخزن‌هایی که می‌خواهید وصل کنید دسترسی دارد
- دسترسی‌های نصب را در GitHub بررسی کنید (Settings > Applications > Installed GitHub Apps)

**رویدادهای وب‌هوک دریافت نمی‌شوند:**

- مطمئن شوید نشانی وب‌هوکتان عمومی دست‌یافتنی است
- گزارش‌های تحویل وب‌هوک GitHub App را در تنظیمات برنامه‌تان بررسی کنید
- تأیید کنید راز وب‌هوک درست پیکربندی شده است

### بررسی تحویل وب‌هوک‌ها

1. به تنظیمات GitHub App خود بروید
2. در نوار کناری روی «Advanced» کلیک کنید
3. برای دیدن تلاش‌ها و پاسخ‌های وب‌هوک، «Recent Deliveries» را ببینید

## بهترین شیوه‌های امنیتی

1. **اسرار را مرتب بچرخانید** — گاه‌به‌گاه رازهای کلاینت و کلیدهای خصوصی تازه تولید کنید
2. **از راز وب‌هوک استفاده کنید** — همیشه برای تأیید اصالت محموله، راز وب‌هوکی پیکربندی کنید
3. **دسترسی مخزن را محدود کنید** — فقط به مخزن‌هایی دسترسی بدهید که باید وصل شوند
4. **تحویل وب‌هوک‌ها را بپایید** — مرتب تحویل‌های شکست‌خورده یا فعالیت مشکوک را بررسی کنید
5. **کلیدهای خصوصی را امن نگه دارید** — هرگز کلیدهای خصوصی را در کنترل نسخه کامیت نکنید

## پشتیبانی

اگر با یکپارچه‌سازی GitHub به مشکل خوردید، لطفاً:

1. بخش رفع اشکال بالا را بررسی کنید
2. گزارش‌های OneUptime را برای پیام‌های خطای تفصیلی مرور کنید
3. با [hello@oneuptime.com](mailto:hello@oneuptime.com) تماس بگیرید

از بازخوردتان برای بهبود این یکپارچه‌سازی استقبال می‌کنیم!
