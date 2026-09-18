# پیکربندی SMTP

‏OneUptime از فرستادن ایمیل از راه کارسازهای سفارشی SMTP با سه روش احراز هویت پشتیبانی می‌کند:

- **نام کاربری و گذرواژه** — احراز هویت سنتی SMTP
- **OAuth 2.0** — احراز هویت امروزی برای Microsoft 365 و Google Workspace
- **هیچ** — برای کارسازهای رله که به احراز هویت نیاز ندارند

این راهنما نحوه پیکربندی احراز هویت OAuth 2.0 برای Microsoft 365 و Google Workspace را پوشش می‌دهد.

## احراز هویت OAuth 2.0

‏OAuth 2.0 راهی امن‌تر برای احراز هویت با کارسازهای ایمیل فراهم می‌کند، به‌ویژه برای محیط‌های سازمانی‌ای که احراز هویت پایه را غیرفعال کرده‌اند. OneUptime از دو نوع اعطای OAuth پشتیبانی می‌کند:

- **Client Credentials** — به کار رفته توسط Microsoft 365 و بیشتر ارائه‌دهندگان OAuth
- **JWT Bearer** — به کار رفته توسط حساب‌های سرویس Google Workspace

### فیلدهای الزامی برای OAuth

هنگام پیکربندی SMTP با احراز هویت OAuth در OneUptime، به این‌ها نیاز خواهید داشت:

| فیلد | توضیح |
| ----------------------- | ----------------------------------------------------------------------------------- |
| **Hostname** | نشانی کارساز SMTP |
| **Port** | درگاه SMTP (معمولاً ۵۸۷ برای STARTTLS یا ۴۶۵ برای TLS ضمنی) |
| **Username** | نشانی ایمیلی که از آن فرستاده می‌شود |
| **Authentication Type** | «OAuth» را برگزینید |
| **OAuth Provider Type** | برای Microsoft 365 «Client Credentials»، یا برای Google Workspace «JWT Bearer» را برگزینید |
| **Client ID** | شناسه برنامه/کلاینت از ارائه‌دهنده OAuth شما (برای Google: ایمیل حساب سرویس) |
| **Client Secret** | راز کلاینت از ارائه‌دهنده OAuth شما (برای Google: کلید خصوصی) |
| **Token URL** | نشانی نقطه پایانی توکن OAuth |
| **Scope** | دامنه(های) لازم OAuth برای دسترسی SMTP |

---

## پیکربندی Microsoft 365

برای استفاده از OAuth با Microsoft 365/Exchange Online، باید برنامه‌ای در Microsoft Entra (‏Azure AD) ثبت کنید و دسترسی‌های مناسب را پیکربندی کنید.

### گام ۱: ثبت یک برنامه در Microsoft Entra

1. به [مرکز مدیریت Microsoft Entra](https://entra.microsoft.com) وارد شوید
2. به **Identity** > **Applications** > **App registrations** بروید
3. روی **New registration** کلیک کنید
4. نامی برای برنامه‌تان وارد کنید (برای نمونه «OneUptime SMTP»)
5. برای **Supported account types**، گزینه «Accounts in this organizational directory only» را برگزینید
6. **Redirect URI** را خالی بگذارید (برای جریان اعتبارنامه کلاینت لازم نیست)
7. روی **Register** کلیک کنید

پس از ثبت، این مقادیر را از صفحه **Overview** یادداشت کنید:

- **Application (client) ID** — این Client ID شماست
- **Directory (tenant) ID** — برای Token URL لازمش خواهید داشت

### گام ۲: ساخت یک Client Secret

1. در ثبت برنامه‌تان، به **Certificates & secrets** بروید
2. روی **New client secret** کلیک کنید
3. توضیحی بیفزایید و دوره انقضایی برگزینید
4. روی **Add** کلیک کنید
5. **مقدار راز را فوراً کپی کنید** — دوباره نشان داده نمی‌شود

### گام ۳: افزودن دسترسی‌های API برای SMTP

1. به **API permissions** بروید
2. روی **Add a permission** کلیک کنید
3. گزینه **APIs my organization uses** را برگزینید
4. **Office 365 Exchange Online** را جستجو و برگزینید
5. **Application permissions** را برگزینید
6. **SMTP.SendAsApp** را بیابید و تیک بزنید
7. روی **Add permissions** کلیک کنید
8. روی **Grant admin consent for [سازمان شما]** کلیک کنید (به امتیاز مدیر نیاز دارد)

### گام ۴: ثبت Service Principal در Exchange Online

پیش از آنکه برنامه‌تان بتواند ایمیل بفرستد، باید service principal را در Exchange Online ثبت کنید و دسترسی صندوق پستی بدهید.

1. ماژول PowerShell برای Exchange Online را نصب کنید:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. به Exchange Online وصل شوید:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. ‏service principal را ثبت کنید (از Object ID در **Enterprise Applications** استفاده کنید، نه App Registrations):

```powershell
# Find the Object ID in Microsoft Entra > Enterprise Applications > Your App > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. به service principal دسترسی فرستادن به‌عنوان صندوق پستی مشخصی بدهید:

```powershell
# Grant full mailbox access to the service principal
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **توجه:** از `Add-MailboxPermission` استفاده کنید (نه `Add-RecipientPermission`). دستور `Add-RecipientPermission` فقط `SendAs` را روی گیرنده اعطا می‌کند و برای فرستادن نامه از راه SMTP با OAuth توسط service principal کافی نیست — هنگام فرستادن خطای احراز هویت/دسترسی می‌گیرید. دستور `Add-MailboxPermission` با `FullAccess` همان چیزی است که واقعاً کار می‌کند.

### گام ۵: پیکربندی در OneUptime

در OneUptime، پیکربندی SMTPای با این تنظیمات بسازید یا ویرایش کنید:

| فیلد | مقدار |
| ------------------- | ---------------------------------------------------------------------------- |
| Hostname | `smtp.office365.com` |
| Port | `587` |
| Username | نشانی ایمیلی که به آن دسترسی داده‌اید (برای نمونه `sender@yourdomain.com`) |
| Authentication Type | `OAuth` |
| OAuth Provider Type | `Client Credentials` |
| Client ID | شناسه Application (client) شما از گام ۱ |
| Client Secret | مقدار راز از گام ۲ |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| From Email | همان Username |
| Secure (TLS) | فعال |

به‌جای `<tenant-id>` شناسه Directory (tenant) خود از گام ۱ را بگذارید.

---

## پیکربندی Google Workspace

‏Google Workspace به **حساب سرویس** با واگذاری در سطح دامنه نیاز دارد تا از طرف کاربران ایمیل بفرستد. این لازم است چون کارسازهای SMTP گوگل از جریان مستقیم اعتبارنامه کلاینت OAuth برای Gmail پشتیبانی نمی‌کنند.

### پیش‌نیازها

- حساب Google Workspace (نه Gmail معمولی — حساب‌های مصرفی Gmail از این پشتیبانی نمی‌کنند)
- دسترسی Super Admin به کنسول مدیریت Google Workspace
- دسترسی به Google Cloud Console

### گام ۱: ساخت یک پروژه Google Cloud

1. به [Google Cloud Console](https://console.cloud.google.com) بروید
2. روی فهرست کشویی پروژه کلیک کنید و **New Project** را برگزینید
3. نام پروژه‌ای وارد کنید و روی **Create** کلیک کنید
4. پروژه تازه‌تان را برگزینید

### گام ۲: فعال کردن Gmail API

1. به **APIs & Services** > **Library** بروید
2. «Gmail API» را جستجو کنید
3. روی **Gmail API** و سپس **Enable** کلیک کنید

### گام ۳: ساخت یک حساب سرویس

1. به **APIs & Services** > **Credentials** بروید
2. روی **Create Credentials** > **Service account** کلیک کنید
3. نام و توضیحی برای حساب سرویس وارد کنید
4. روی **Create and Continue** کلیک کنید
5. گام‌های اختیاری را رد کنید و روی **Done** کلیک کنید

### گام ۴: ساخت کلیدهای حساب سرویس

1. روی حساب سرویسی که تازه ساختید کلیک کنید
2. به زبانه **Keys** بروید
3. روی **Add Key** > **Create new key** کلیک کنید
4. **JSON** را برگزینید و روی **Create** کلیک کنید
5. فایل JSON دانلودشده را امن ذخیره کنید — این‌ها را دربر دارد:
   - `client_id` — شناسه کلاینت شما
   - `private_key` — راز کلاینت شما (کلید خصوصی)

### گام ۵: فعال کردن واگذاری در سطح دامنه

1. در جزئیات حساب سرویس، روی **Show Advanced Settings** کلیک کنید
2. **Client ID** (شناسه عددی) را یادداشت کنید
3. گزینه **Enable Google Workspace Domain-wide Delegation** را تیک بزنید
4. روی **Save** کلیک کنید

### گام ۶: مجاز کردن حساب سرویس در مدیریت Google Workspace

1. به [کنسول مدیریت Google Workspace](https://admin.google.com) وارد شوید
2. به **Security** > **Access and data control** > **API Controls** بروید
3. روی **Manage Domain Wide Delegation** کلیک کنید
4. روی **Add new** کلیک کنید
5. **Client ID** از گام ۵ را وارد کنید
6. برای **OAuth Scopes** این را وارد کنید: `https://mail.google.com/`
7. روی **Authorize** کلیک کنید

توجه: ممکن است چند دقیقه تا ۲۴ ساعت طول بکشد تا واگذاری منتشر شود.

### گام ۷: پیکربندی در OneUptime

در OneUptime، پیکربندی SMTPای با این تنظیمات بسازید یا ویرایش کنید:

| فیلد | مقدار |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostname | `smtp.gmail.com` |
| Port | `587` |
| Username | نشانی ایمیل Google Workspaceای که از آن فرستاده می‌شود (برای نمونه `notifications@yourdomain.com`). حساب سرویس نقش این کاربر را جعل می‌کند. |
| Authentication Type | `OAuth` |
| OAuth Provider Type | `JWT Bearer` |
| Client ID | مقدار `client_email` از JSON حساب سرویس شما (برای نمونه `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret | مقدار `private_key` از JSON حساب سرویس شما (کل کلید، شامل `-----BEGIN PRIVATE KEY-----` و `-----END PRIVATE KEY-----`) |
| Token URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| From Email | همان Username |
| Secure (TLS) | فعال |

**مهم:** برای گوگل (JWT Bearer)، شناسه کلاینت همان **ایمیل حساب سرویس** (`client_email`) است، نه `client_id` عددی. حساب سرویس برای فرستادن ایمیل، نقش کاربر مشخص‌شده در فیلد Username را جعل می‌کند.

---

## رفع اشکال

### Microsoft 365

| مشکل | راه‌حل |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| «Authentication unsuccessful» | تأیید کنید service principal در Exchange ثبت شده و دسترسی صندوق پستی دارد |
| «AADSTS700016: Application not found» | بررسی کنید شناسه کلاینت درست است و برنامه در مستأجر شما وجود دارد |
| «AADSTS7000215: Invalid client secret» | راز کلاینت را دوباره تولید کنید — ممکن است منقضی شده باشد |
| «The mailbox is not enabled for this operation» | برای اعطای دسترسی به صندوق پستی `Add-MailboxPermission` را اجرا کنید |

### Google Workspace

| مشکل | راه‌حل |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| «invalid_grant» | مطمئن شوید واگذاری در سطح دامنه درست پیکربندی و منتشر شده است |
| «unauthorized_client» | تأیید کنید شناسه کلاینت در کنسول مدیریت Google Workspace مجاز شده است |
| «access_denied» | بررسی کنید دامنه `https://mail.google.com/` مجاز شده باشد |
| «Domain policy has disabled third-party Drive apps» | دسترسی API را در Google Workspace Admin > Security > API Controls فعال کنید |

### عمومی

- **پیکربندی خود را بیازمایید**: برای تأیید راه‌اندازی‌تان از دکمه «Send Test Email» در OneUptime استفاده کنید
- **گزارش‌ها را بررسی کنید**: گزارش‌های OneUptime را برای پیام‌های خطای تفصیلی مرور کنید
- **حافظه نهان توکن**: OneUptime توکن‌های OAuth را در حافظه نهان می‌گذارد و پیش از انقضا خودکار تازه‌شان می‌کند

---

## بهترین شیوه‌های امنیتی

1. **اسرار را مرتب بچرخانید**: یادآور تقویمی بگذارید تا رازهای کلاینت را پیش از انقضا بچرخانید
2. **از حساب‌های سرویس اختصاصی استفاده کنید**: به‌جای اشتراک با برنامه‌های دیگر، اعتبارنامه‌های جداگانه برای OneUptime بسازید
3. **اصل کمترین امتیاز**: فقط کمترین دسترسی لازم را اعطا کنید (SMTP.SendAsApp برای مایکروسافت، دامنه mail.google.com برای گوگل)
4. **مصرف را بپایید**: گزارش‌های ایمیل و ورودهای برنامه OAuth را برای فعالیت غیرعادی مرور کنید
5. **ذخیره‌سازی امن**: هرگز رازهای کلاینت را در کنترل نسخه کامیت نکنید

---

## منابع بیشتر

### Microsoft 365

- [احراز هویت اتصال IMAP، ‏POP یا SMTP با OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [ثبت یک برنامه در پلتفرم هویت مایکروسافت](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [استفاده از OAuth 2.0 برای برنامه‌های کارساز به کارساز](https://developers.google.com/identity/protocols/oauth2/service-account)
- [مستندات Gmail API](https://developers.google.com/gmail/api)
- [پروتکل XOAUTH2](https://developers.google.com/gmail/imap/xoauth2-protocol)
