# SMTP

ایمیل‌های OneUptime را از راه سرور ایمیل خودتان بفرستید. یک پروژه پیکربندی SMTP می‌افزاید که صفحات وضعیتش هنگام فرستادن ایمیل به کار می‌برند، و یک نصب خودمیزبان سروری را تنظیم می‌کند که OneUptime بقیهٔ ایمیل‌ها را با آن می‌فرستد. هر دو از سه روش ورود پشتیبانی می‌کنند:

- **نام کاربری و رمز عبور**: احراز هویت سنتی SMTP.
- **OAuth 2.0**: برای Microsoft 365 و Google Workspace، که احراز هویت پایه در آن‌ها اغلب خاموش است.
- **هیچ‌کدام**: برای سرورهای رله‌ای که به احراز هویت نیاز ندارند.

```mermaid title="کدام سرور ایمیل چه چیزی را می‌فرستد"
flowchart TB
    SP["ایمیل‌های یک صفحهٔ وضعیت"] --> Q{"صفحه یک پیکربندی<br/>SMTP سفارشی برگزیده؟"}
    Q -->|"بله"| P["پیکربندی SMTP پروژه"]
    Q -->|"نه"| D["سرور ایمیل خود OneUptime"]
    E["همهٔ ایمیل‌های دیگر OneUptime"] --> D
```

در یک نصب خودمیزبان، سرور ایمیل خود OneUptime همان سروری است که در Admin Dashboard تنظیم می‌کنید. یک صفحهٔ وضعیت پیکربندی SMTP را در کارت **SMTP سفارشی** صفحهٔ **تنظیمات مشترکان** خود برمی‌گزیند.

:::cards
- [افزودن یک سرور ایمیل](#افزودن-یک-سرور-smtp): دو گام، و بقیه بسته.
- [Microsoft 365](#پیکربندی-microsoft-365): OAuth با ثبت برنامه در Entra.
- [Google Workspace](#پیکربندی-google-workspace): OAuth با حساب سرویس.
- [عیب‌یابی](#عیبیابی): خطاهای رایج و معنای آن‌ها.
:::

## افزودن یک سرور SMTP

سرور ایمیل یک پروژه را در کارت **پیکربندی‌های SMTP سفارشی** در **تنظیمات پروژه** > **اعلان‌ها** > **تنظیمات اعلان** می‌افزایید. در یک نصب خودمیزبان، سروری که خود OneUptime با آن ایمیل می‌فرستد در کارت **تنظیمات ایمیل سفارشی و SMTP** در **Admin Dashboard** > **تنظیمات** > **اعلان‌ها** > **ایمیل‌ها** تنظیم می‌شود. هر دو فرم همان چیزها را در دو گام می‌پرسند.

:::steps
### فرم را باز کنید

:::tabs
@tab پروژه
در کارت **پیکربندی‌های SMTP سفارشی** در **تنظیمات پروژه** > **اعلان‌ها** > **تنظیمات اعلان**، روی **ساخت پیکربندی SMTP** کلیک کنید.
@tab نمونهٔ خودمیزبان
در Admin Dashboard، **تنظیمات** را باز کنید، سپس **اعلان‌ها** > **ایمیل‌ها** را در منوی کناری (**اعلان‌ها** در آغاز بسته است). در کارت **تنظیمات سرور ایمیل**، روی **ویرایش سرور** کلیک کنید و **نوع سرور ایمیل** را روی `Custom SMTP` بگذارید. سپس در کارت **تنظیمات ایمیل سفارشی و SMTP** که زیر آن پدیدار می‌شود، روی **ویرایش پیکربندی SMTP** کلیک کنید.
:::

### گام سرور را پر کنید

در گام **سرور**، **نام** (فقط پیکربندی‌های پروژه)، **نام میزبان**، **پورت** (پیکربندی‌های تازهٔ پروژه با `587` آغاز می‌شوند)، **نام کاربری** و **رمز عبور** را وارد کنید.

### فیلدهای بیشتر را بررسی کنید

بقیهٔ چیزها زیر **فیلدهای بیشتر** در پایان گام **سرور** بسته‌اند. تا وقتی بسته است، عنوانش می‌گوید ایمیل چگونه فرستاده می‌شود، برای نمونه: «ایمیل از طریق SMTP ارسال می‌شود و ورود با نام کاربری و رمز عبور انجام می‌شود. TLS الزامی است.» آن را فقط وقتی باز کنید که لازم است یکی از تنظیمات جدول زیر را تغییر دهید.

### گام فرستنده را پر کنید

در گام **فرستنده**، **ایمیل فرستنده** و **نام فرستنده** را که ایمیل‌هایتان از آن‌ها می‌آیند وارد کنید. سرور شما باید فرستادن از آن نشانی را مجاز بداند.

### ذخیره کنید و یک ایمیل آزمایشی بفرستید

پیکربندی را ذخیره کنید. پس از ذخیره کردن یک پیکربندی پروژه، با **ارسال ایمیل آزمایشی** در ردیف آن بررسی کنید که کار می‌کند. این کار به دسترسی افزودن پیکربندی SMTP نیاز دارد: **Project Owner**، **Project Admin**، یا **Create SMTP Config** و **Read SMTP Config** در یک نقش سفارشی. در OneUptime Cloud، مانند افزودن یک پیکربندی، به طرح **Growth** هم نیاز دارد. برای دیگران دکمه قفل است و راهنمای آن می‌گوید چه چیزی لازم است.

آزمایش می‌پرسد به کدام نشانی **ایمیل** فرستاده شود، که در آغاز نشانی خود شماست. بررسی کنید که پیام برسد.
:::

تنظیمات زیر **فیلدهای بیشتر** این‌ها هستند:

| فیلد | چه می‌کند |
| --- | --- |
| **انتقال** | `SMTP` (پیش‌فرض)، یا `Microsoft Graph` برای مستأجرهای Microsoft 365 که SMTP AUTH در آن‌ها خاموش است. انتخاب Microsoft Graph نام میزبان، پورت، نام کاربری و رمز عبور را پنهان می‌کند و فیلدهای OAuth را نشان می‌دهد. |
| **الزام TLS** | در پیکربندی‌های تازهٔ پروژه روشن است. ایمیل فقط از طریق اتصال رمزگذاری‌شده با گواهی معتبر ارسال می‌شود. وقتی این گزینه خاموش باشد، ایمیل فقط در صورتی رمزگذاری می‌شود که سرور آن را ارائه دهد و گواهی بررسی نمی‌شود. پورت ۴۶۵ همیشه رمزگذاری‌شده است. |
| **نوع احراز هویت** | `Username and Password` (پیش‌فرض)، `OAuth`، یا `None` برای رله‌هایی که ورود نمی‌خواهند. |
| **فیلدهای OAuth** | **نوع ارائه‌دهنده OAuth**، **شناسه کلاینت OAuth**، **کلید محرمانه کلاینت OAuth**، **نشانی توکن OAuth** و **دامنه دسترسی OAuth**، که با انتخاب OAuth یا Microsoft Graph نمایش داده می‌شوند. |
| **توضیحات** | یادداشتی برای تیم شما (فقط پیکربندی‌های پروژه). |

**Microsoft Graph.** **فیلدهای بیشتر** را باز کنید، **انتقال** را روی `Microsoft Graph` بگذارید، و اطلاعات یک برنامهٔ Azure با دسترسی برنامهٔ **Mail.Send** را وارد کنید: شناسهٔ کلاینت و کلید محرمانهٔ کلاینت آن، نشانی توکن `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` و دامنهٔ دسترسی `https://graph.microsoft.com/.default`. ایمیل از صندوق **ایمیل فرستنده** فرستاده می‌شود، که باید صندوقی دارای مجوز در مستأجر شما باشد.

> [!NOTE]
> در OneUptime Cloud، سرور ایمیل یک پروژه باید از اینترنت در دسترس باشد: میزبانی که به نشانی خصوصی یا داخلی ترجمه شود رد می‌شود. در یک نصب خودمیزبان، نشانی‌های خصوصی مجازند مگر آنکه `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` برابر `true` باشد، اما نشانی‌های loopback و link-local همیشه رد می‌شوند. سرور ایمیل خود نمونه به این شکل بررسی نمی‌شود.

## احراز هویت OAuth 2.0

OAuth 2.0 به OneUptime امکان می‌دهد بدون رمز عبور به سرور ایمیل شما وارد شود، و سرویس‌های ایمیل سازمانی روزبه‌روز بیشتر آن را الزامی می‌کنند. OneUptime از دو نوع اعطای OAuth پشتیبانی می‌کند:

- **Client Credentials**: Microsoft 365 و بیشتر ارائه‌دهندگان OAuth از آن استفاده می‌کنند.
- **JWT Bearer**: حساب‌های سرویس Google Workspace از آن استفاده می‌کنند.

```mermaid title="OneUptime چگونه با OAuth وارد می‌شود"
sequenceDiagram
    participant O as OneUptime
    participant T as نشانی توکن
    participant M as سرور ایمیل
    O->>T: درخواست توکن دسترسی
    T-->>O: توکن دسترسی
    Note over O: نگهداری در حافظهٔ نهان و<br/>تازه‌سازی پیش از انقضا
    O->>M: ورود با توکن
    O->>M: فرستادن ایمیل
```

**نوع احراز هویت** و فیلدهای OAuth در گام سرور فرم، زیر **فیلدهای بیشتر** هستند. برای ورود با OAuth این‌ها را پر کنید:

| فیلد | توضیح |
| --- | --- |
| **نام میزبان** | نشانی سرور SMTP |
| **پورت** | پورت SMTP (معمولاً ۵۸۷ برای STARTTLS، ۴۶۵ برای TLS ضمنی) |
| **نام کاربری** | نشانی ایمیل صندوقی که می‌فرستد |
| **نوع احراز هویت** | `OAuth` |
| **نوع ارائه‌دهنده OAuth** | `Client Credentials` برای Microsoft 365، `JWT Bearer` برای Google Workspace |
| **شناسه کلاینت OAuth** | شناسهٔ برنامه (کلاینت) از ارائه‌دهندهٔ OAuth شما (برای Google، ایمیل حساب سرویس) |
| **کلید محرمانه کلاینت OAuth** | کلید محرمانهٔ کلاینت از ارائه‌دهندهٔ OAuth شما (برای Google، کلید خصوصی) |
| **نشانی توکن OAuth** | نقطهٔ پایانی توکن OAuth ارائه‌دهنده |
| **دامنه دسترسی OAuth** | دامنهٔ دسترسی OAuth که دسترسی SMTP می‌دهد |

OneUptime توکن‌های OAuth را در حافظهٔ نهان نگه می‌دارد و پیش از انقضا خودکار تازه‌شان می‌کند.

## پیکربندی Microsoft 365

برای استفاده از OAuth با Microsoft 365 (Exchange Online)، یک برنامه در Microsoft Entra ثبت کنید، به آن اجازهٔ فرستادن ایمیل از راه SMTP بدهید، و بگذارید از صندوق فرستنده استفاده کند.

:::steps
### برنامه را در Microsoft Entra ثبت کنید

1. به [مرکز مدیریت Microsoft Entra](https://entra.microsoft.com) وارد شوید.
2. به **Identity** > **Applications** > **App registrations** بروید و روی **New registration** کلیک کنید.
3. یک نام وارد کنید (برای نمونه "OneUptime SMTP")، "Accounts in this organizational directory only" را برگزینید، و **Redirect URI** را خالی بگذارید.
4. روی **Register** کلیک کنید.

در صفحهٔ **Overview**، **Application (client) ID** (شناسهٔ کلاینت شما) و **Directory (tenant) ID** (برای نشانی توکن) را یادداشت کنید.

### یک کلید محرمانهٔ کلاینت بسازید

1. در ثبت برنامه، به **Certificates & secrets** بروید و روی **New client secret** کلیک کنید.
2. یک توضیح بیفزایید، دورهٔ انقضا را برگزینید و روی **Add** کلیک کنید.
3. **مقدار کلید محرمانه را بی‌درنگ کپی کنید**: دوباره نمایش داده نمی‌شود.

### دسترسی SMTP را بیفزایید

1. به **API permissions** بروید و روی **Add a permission** کلیک کنید.
2. **APIs my organization uses** را برگزینید، سپس **Office 365 Exchange Online** را جست‌وجو کنید و برگزینید.
3. **Application permissions** را برگزینید، **SMTP.SendAsApp** را تیک بزنید و روی **Add permissions** کلیک کنید.
4. روی **Grant admin consent for [your organization]** کلیک کنید (به حقوق مدیر نیاز دارد).

### اصل سرویس را در Exchange Online ثبت کنید

پیش از آنکه برنامه بتواند ایمیل بفرستد، اصل سرویس آن را در Exchange Online ثبت کنید و به آن دسترسی به صندوق فرستنده بدهید:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> از `Add-MailboxPermission` استفاده کنید، نه `Add-RecipientPermission`. `Add-RecipientPermission` فقط `SendAs` را روی گیرنده می‌دهد، که برای اینکه یک اصل سرویس با OAuth از راه SMTP ایمیل بفرستد کافی نیست، و فرستادن با خطای احراز هویت یا دسترسی شکست می‌خورد.

### پیکربندی SMTP را در OneUptime بسازید

یک پیکربندی SMTP با این تنظیمات بسازید یا ویرایش کنید، و `<tenant-id>` را با **Directory (tenant) ID** خود جایگزین کنید:

| فیلد | مقدار |
| --- | --- |
| نام میزبان | `smtp.office365.com` |
| پورت | `587` |
| نام کاربری | نشانی ایمیلی که مجوزش را داده‌اید (برای نمونه `sender@yourdomain.com`) |
| نوع احراز هویت | `OAuth` |
| نوع ارائه‌دهنده OAuth | `Client Credentials` |
| شناسه کلاینت OAuth | **Application (client) ID** شما |
| کلید محرمانه کلاینت OAuth | مقدار کلید محرمانهٔ کلاینت شما |
| نشانی توکن OAuth | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| دامنه دسترسی OAuth | `https://outlook.office365.com/.default` |
| ایمیل فرستنده | همان نام کاربری |
| الزام TLS | روشن |

سپس با **ارسال ایمیل آزمایشی** بررسی کنید.
:::

## پیکربندی Google Workspace

Google Workspace به یک **حساب سرویس** با واگذاری در سطح دامنه نیاز دارد، که از طرف یک کاربر دامنهٔ شما ایمیل می‌فرستد. سرورهای SMTP گوگل از جریان سادهٔ client credentials برای Gmail پشتیبانی نمی‌کنند.

### پیش از Google Workspace

- یک حساب Google Workspace. حساب‌های شخصی Gmail از این پشتیبانی نمی‌کنند.
- دسترسی مدیر ارشد به کنسول مدیریت Google Workspace.
- دسترسی به Google Cloud Console.

:::steps
### یک پروژهٔ Google Cloud بسازید

1. به [Google Cloud Console](https://console.cloud.google.com) بروید.
2. روی فهرست کشویی پروژه کلیک کنید و **New Project** را برگزینید.
3. یک نام پروژه وارد کنید، روی **Create** کلیک کنید و پروژهٔ تازه را برگزینید.

### Gmail API را فعال کنید

1. به **APIs & Services** > **Library** بروید.
2. "Gmail API" را جست‌وجو کنید، روی **Gmail API** کلیک کنید، سپس روی **Enable**.

### یک حساب سرویس بسازید

1. به **APIs & Services** > **Credentials** بروید.
2. روی **Create Credentials** > **Service account** کلیک کنید.
3. یک نام و توضیح وارد کنید، روی **Create and Continue** کلیک کنید، گام‌های اختیاری را رد کنید و روی **Done** کلیک کنید.

### یک کلید حساب سرویس بسازید

1. روی حساب سرویسی که تازه ساختید کلیک کنید و به زبانهٔ **Keys** بروید.
2. روی **Add Key** > **Create new key** کلیک کنید، **JSON** را برگزینید و روی **Create** کلیک کنید.
3. فایل JSON دانلودشده را امن نگه دارید. `client_email` آن شناسهٔ کلاینت OAuth شما و `private_key` آن کلید محرمانهٔ کلاینت OAuth شماست.

### واگذاری در سطح دامنه را فعال کنید

1. در جزئیات حساب سرویس، روی **Show Advanced Settings** کلیک کنید.
2. **Client ID** عددی را یادداشت کنید.
3. **Enable Google Workspace Domain-wide Delegation** را تیک بزنید و روی **Save** کلیک کنید.

### حساب سرویس را در مدیریت Google Workspace مجاز کنید

1. به [کنسول مدیریت Google Workspace](https://admin.google.com) وارد شوید.
2. به **Security** > **Access and data control** > **API Controls** بروید و روی **Manage Domain Wide Delegation** کلیک کنید.
3. روی **Add new** کلیک کنید، **Client ID** عددی گام پیش را وارد کنید، و `https://mail.google.com/` را در **OAuth Scopes** وارد کنید.
4. روی **Authorize** کلیک کنید.

اعمال واگذاری ممکن است از چند دقیقه تا ۲۴ ساعت طول بکشد.

### پیکربندی SMTP را برای Google Workspace بسازید

یک پیکربندی SMTP با این تنظیمات بسازید یا ویرایش کنید:

| فیلد | مقدار |
| --- | --- |
| نام میزبان | `smtp.gmail.com` |
| پورت | `587` |
| نام کاربری | نشانی ایمیل Google Workspace که ایمیل از آن فرستاده می‌شود (برای نمونه `notifications@yourdomain.com`). حساب سرویس جای این کاربر را می‌گیرد. |
| نوع احراز هویت | `OAuth` |
| نوع ارائه‌دهنده OAuth | `JWT Bearer` |
| شناسه کلاینت OAuth | `client_email` از JSON حساب سرویس (برای نمونه `your-service@your-project.iam.gserviceaccount.com`) |
| کلید محرمانه کلاینت OAuth | `private_key` از JSON حساب سرویس (کل کلید، همراه با `-----BEGIN PRIVATE KEY-----` و `-----END PRIVATE KEY-----`) |
| نشانی توکن OAuth | `https://oauth2.googleapis.com/token` |
| دامنه دسترسی OAuth | `https://mail.google.com/` |
| ایمیل فرستنده | همان نام کاربری |
| الزام TLS | روشن |

سپس با **ارسال ایمیل آزمایشی** بررسی کنید.
:::

> [!IMPORTANT]
> برای Google (JWT Bearer)، **شناسه کلاینت OAuth** همان **ایمیل حساب سرویس** (`client_email`) است، نه `client_id` عددی. حساب سرویس جای کاربر **نام کاربری** را می‌گیرد تا ایمیل بفرستد.

## عیب‌یابی

### خطاهای Microsoft 365

| مشکل | راه‌حل |
| --- | --- |
| "Authentication unsuccessful" | بررسی کنید که اصل سرویس در Exchange ثبت شده و دسترسی صندوق دارد |
| "AADSTS700016: Application not found" | بررسی کنید که شناسهٔ کلاینت درست است و برنامه در مستأجر شما وجود دارد |
| "AADSTS7000215: Invalid client secret" | یک کلید محرمانهٔ کلاینت تازه بسازید؛ شاید قبلی منقضی شده باشد |
| "The mailbox is not enabled for this operation" | `Add-MailboxPermission` را اجرا کنید تا دسترسی به صندوق داده شود |

### خطاهای Google Workspace

| مشکل | راه‌حل |
| --- | --- |
| "invalid_grant" | مطمئن شوید که واگذاری در سطح دامنه درست پیکربندی شده و اعمال شده است |
| "unauthorized_client" | بررسی کنید که شناسهٔ کلاینت در کنسول مدیریت Google Workspace مجاز شده است |
| "access_denied" | بررسی کنید که دامنهٔ دسترسی `https://mail.google.com/` مجاز شده است |
| "Domain policy has disabled third-party Drive apps" | دسترسی API را در مدیریت Google Workspace، زیر Security > API Controls، فعال کنید |

### مشکلات دیگر

:::details "Cannot send email. Please check your SMTP config."
**ارسال ایمیل آزمایشی** این را وقتی می‌گوید که سروری که با نام کاربری و رمز عبور، یا بدون ورود، کار می‌کند ایمیل را نپذیرد. **نام میزبان**، **پورت**، **نام کاربری** و **رمز عبور** را بررسی کنید. اگر سرور شما TLS ارائه نمی‌دهد، یا گواهی آن برای نام میزبانش معتبر نیست، **الزام TLS** را زیر **فیلدهای بیشتر** خاموش کنید و دوباره امتحان کنید. پاسخ خود سرور همراه آزمایش نگه داشته می‌شود: زبانهٔ **ایمیل** در **تنظیمات پروژه** > **اعلان‌ها** > **گزارش‌های اعلان** را باز کنید و در ردیف آن **مشاهده پیام وضعیت** را برگزینید.
:::

:::details "Cannot send email with OAuth authentication"
ورود با OAuth شکست خورد، و پیام با خطایی که ارائه‌دهندهٔ شما برگرداند پایان می‌یابد. **شناسه کلاینت OAuth**، **کلید محرمانه کلاینت OAuth**، **نشانی توکن OAuth** و **دامنه دسترسی OAuth** را بررسی کنید، و اینکه برنامه دسترسی‌های بالا را دارد و رضایت مدیر داده شده است. اگر SMTP AUTH در مستأجر Microsoft 365 شما خاموش است، به‌جای آن **انتقال** را روی `Microsoft Graph` بگذارید.
:::

:::details "Microsoft Graph send failed"
پیکربندی‌ای که **انتقال** آن `Microsoft Graph` است این را وقتی می‌گوید که Graph ایمیل را نپذیرد، و پس از آن خطای خود Microsoft می‌آید. بررسی کنید که برنامه دسترسی برنامهٔ **Mail.Send** را با رضایت مدیر دارد، که **دامنه دسترسی OAuth** برابر `https://graph.microsoft.com/.default` است، و که **ایمیل فرستنده** صندوقی دارای مجوز در مستأجر شماست.
:::

:::details "SMTP server host … could not be reached"
OneUptime از وصل شدن به سرور ایمیل پروژه خودداری کرد. در OneUptime Cloud، نام میزبانی که ترجمه نمی‌شود، یا به نشانی خصوصی، loopback یا link-local ترجمه می‌شود، با این پیام رد می‌شود و پیام هرگز نمی‌گوید کدام بوده است: از نام میزبان عمومی سرور ایمیل استفاده کنید. در یک نصب خودمیزبان، و برای سرور ایمیلی که با نشانی IP داده شده، پیام به‌جای آن دلیل را می‌گوید. **ارسال ایمیل آزمایشی** آن را فقط برای پیکربندی OAuth نشان می‌دهد؛ برای بقیه، آن را زیر **مشاهده پیام وضعیت** در زبانهٔ **ایمیل** گزارش‌های اعلان پیدا کنید.
:::

:::details ایمیل آزمایشی نمی‌رسد
**ایمیل فرستنده** را بررسی کنید: سرور شما باید فرستادن از آن را مجاز بداند. سپس پوشهٔ هرزنامهٔ گیرنده، و گزارش‌های سرور ایمیل خود را برای این تلاش بگردید.
:::

## بهترین شیوه‌های امنیتی

- **کلیدهای محرمانه را مرتب عوض کنید.** یادآوری بگذارید تا کلیدهای محرمانهٔ کلاینت را پیش از انقضا عوض کنید.
- **از اعتبارنامه‌های اختصاصی استفاده کنید.** برای OneUptime اعتبارنامه‌های جداگانه بسازید، به‌جای اشتراک با برنامه‌های دیگر.
- **کمترین دسترسی را بدهید.** فقط آنچه برای فرستادن لازم است بدهید: **SMTP.SendAsApp** برای Microsoft، و دامنهٔ دسترسی `https://mail.google.com/` برای Google.
- **استفاده را زیر نظر بگیرید.** گزارش‌های ایمیل و ورودهای برنامهٔ OAuth را برای فعالیت غیرعادی بازبینی کنید.
- **کلیدهای محرمانه را امن نگه دارید.** هرگز کلیدهای محرمانهٔ کلاینت را در کنترل نسخه کامیت نکنید.

## مطالعهٔ بیشتر

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## گام‌های بعدی

:::cards
- [تجمیع اعلان‌ها](/docs/emails/notification-rollup): OneUptime چگونه سیل ایمیل‌هایی را که به مالکان می‌رسد جمع می‌کند.
- [مشترکان و اعلامیه‌ها](/docs/status-pages/subscribers): با پیکربندی SMTP پروژه به مشترکان صفحهٔ وضعیت ایمیل بفرستید.
:::
