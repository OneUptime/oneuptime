# سیاست تماس ورودی (یکپارچه‌سازی Twilio)

سیاست‌های تماس ورودی به تماس‌گیرندگان بیرونی امکان می‌دهند با شماره‌گیری یک شماره تلفن اختصاصی به مهندسان کشیک شما برسند. وقتی کسی تماس می‌گیرد، OneUptime تماس را از راه قواعد تشدید پیکربندی‌شده شما مسیردهی می‌کند تا مهندسی پاسخ دهد.

## چگونه کار می‌کند

```mermaid
flowchart TD
    A[Caller dials<br/>Incoming Call Number] --> B[Twilio receives call]
    B --> C[Twilio sends webhook<br/>to OneUptime]
    C --> D[OneUptime plays<br/>greeting message]
    D --> E[Load Escalation Rules]
    E --> F{Rule 1:<br/>Try On-Call User}
    F -->|No Answer| G{Rule 2:<br/>Try Backup Engineer}
    F -->|Answered| H[Connect Caller<br/>to Engineer]
    G -->|No Answer| I{Rule 3:<br/>Try Manager}
    G -->|Answered| H
    I -->|No Answer| J[Play No Answer<br/>Message & Hangup]
    I -->|Answered| H
    H --> K[Call Connected]
    K --> L[Call Ends]
    L --> M[Log Call Details]
```

## جریان مسیردهی تماس

```mermaid
sequenceDiagram
    participant Caller
    participant Twilio
    participant OneUptime
    participant OnCallEngineer

    Caller->>Twilio: Dials incoming call number
    Twilio->>OneUptime: POST /incoming-call/voice
    OneUptime->>Twilio: TwiML: Play greeting
    Twilio->>Caller: "Please wait while we connect you..."

    loop Escalation Rules
        OneUptime->>OneUptime: Get next escalation rule
        OneUptime->>Twilio: TwiML: Dial on-call user
        Twilio->>OnCallEngineer: Ring phone
        alt Engineer Answers
            OnCallEngineer->>Twilio: Picks up
            Twilio->>OneUptime: Dial status: completed
            Twilio->>Caller: Connect to engineer
            Note over Caller,OnCallEngineer: Call in progress
        else No Answer (timeout)
            Twilio->>OneUptime: Dial status: no-answer
            OneUptime->>OneUptime: Try next rule
        end
    end

    alt All Rules Exhausted
        OneUptime->>Twilio: TwiML: Play no-answer message
        Twilio->>Caller: "No one is available..."
        Twilio->>Caller: Hangup
    end
```

## پیش‌نیازها

- حسابی در Twilio — در [https://www.twilio.com](https://www.twilio.com) بسازیدش
- ‏Account SID و Auth Token در Twilio
- دسترسی به نمونه خودمیزبان OneUptime شما

## نمای کلی

قابلیت سیاست تماس ورودی این‌گونه کار می‌کند:

1. دریافت تماس‌های ورودی روی شماره تلفنی از Twilio
2. پخش پیام خوش‌آمدگویی قابل سفارشی‌سازی
3. مسیردهی تماس از راه قواعد تشدید (زمان‌بندی‌های آنکال یا افراد)
4. وصل کردن تماس‌گیرنده به نخستین مهندس کشیک در دسترس
5. تشدید به قاعده بعدی اگر کسی پاسخ ندهد

چون OneUptime را خودمیزبان می‌کنید، باید حساب Twilio خودتان را پیکربندی کنید. این کنترل کامل بر شماره‌های تلفن و صورت‌حسابتان به شما می‌دهد.

## گام ۱: ساخت یک حساب Twilio

1. به [https://www.twilio.com](https://www.twilio.com) بروید و حسابی بسازید
2. فرایند تأیید را کامل کنید
3. **Account SID** و **Auth Token** خود را از داشبورد کنسول Twilio یادداشت کنید

## گام ۲: پیکربندی Call/SMS Config در OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Project Settings** > **Notifications** > **Notification Settings** بروید
3. در **Twilio Config** روی **Create Twilio Config** کلیک کنید
4. فیلدهای زیر را پر کنید:
   - **Name**: نامی دوستانه (برای نمونه «Production Twilio Config»)
   - **Description**: توضیح اختیاری
   - **Twilio Account SID**: مقدار Account SID شما در Twilio (با `AC` آغاز می‌شود)
   - **Twilio Auth Token**: مقدار Auth Token شما در Twilio
   - **Twilio Primary Phone Number**: شماره تلفنی از حساب Twilio شما برای تماس‌های خروجی
   - **Set as Project Default**: برای نخستین پیکربندی Twilio پروژه روشن است، بنابراین پیامک‌ها و تماس‌های اعضای پروژه هم از طریق این حساب فرستاده می‌شوند. اگر این حساب فقط برای تماس‌های ورودی است، آن را خاموش کنید.
5. روی **Save** کلیک کنید

## گام ۳: ساخت یک سیاست تماس ورودی

1. به **On-Call Duty** > **Incoming Call Policies** بروید
2. روی **Create Incoming Call Policy** کلیک کنید
3. فیلدهای زیر را پر کنید:
   - **Name**: نامی دوستانه (برای نمونه «Support Hotline»)
   - **Description**: توضیح اختیاری
4. روی **Save** کلیک کنید

## گام ۴: پیوند دادن پیکربندی Twilio به سیاست

1. سیاست تماس ورودی تازه‌ساخته‌تان را باز کنید
2. در کارت **Phone Number Routing**، بخش **Step 2: Link Twilio Configuration** را بیابید
3. روی **Select Twilio Config** کلیک کنید و پیکربندی‌ای را که در گام ۲ ساختید برگزینید
4. انتخاب را ذخیره کنید

## گام ۵: پیکربندی یک شماره تلفن

برای برپا کردن شماره تلفن دو گزینه دارید:

### گزینه الف: استفاده از شماره تلفن موجود در Twilio

اگر از پیش در حساب Twilio خود شماره تلفن دارید:

1. در کارت **Phone Number** روی **Use Existing Number** کلیک کنید
2. ‏OneUptime همه شماره‌های تلفن حساب Twilio شما را می‌گیرد
3. شماره تلفنی را که می‌خواهید به کار ببرید برگزینید
4. برای تخصیصش به سیاست روی **Use This** کلیک کنید

> **توجه**: اگر شماره تلفن از پیش وب‌هوکی پیکربندی‌شده داشته باشد، به‌روزرسانی می‌شود تا به OneUptime اشاره کند.

### گزینه ب: خرید یک شماره تلفن جدید

برای خرید شماره تلفنی تازه مستقیم از OneUptime:

1. در کارت **Phone Number** روی **Buy New Number** کلیک کنید
2. از فهرست کشویی یک **Country** برگزینید
3. اختیاراً یک **Area Code** وارد کنید (برای نمونه ۴۱۵ برای سان‌فرانسیسکو)
4. اختیاراً رقم‌هایی که شماره باید **Contain** کند وارد کنید (برای نمونه ۵۵۵)
5. برای یافتن شماره‌های در دسترس روی **Search** کلیک کنید
6. از نتایج شماره تلفنی برگزینید
7. برای خرید شماره روی **Purchase** کلیک کنید

شماره تلفن از حساب Twilio شما خریده می‌شود و وب‌هوک **به‌طور خودکار پیکربندی می‌شود** — به راه‌اندازی دستی نیازی نیست!

```mermaid
flowchart LR
    A[Create Policy] --> B[Link Twilio Config]
    B --> C{Choose Phone<br/>Number Option}
    C -->|Existing| D[Select from<br/>Twilio Account]
    C -->|New| E[Search & Purchase<br/>New Number]
    D --> F[Webhook Auto-Configured]
    E --> F
    F --> G[Add Escalation Rules]
    G --> H[Policy Ready!]
```

## گام ۶: پیکربندی قواعد تشدید

قواعد تشدید تعیین می‌کنند وقتی کسی شماره سیاست را می‌گیرد، از بالای فهرست به پایین با چه کسی تماس گرفته شود:

1. سیاست تماس ورودی خود را باز کنید
2. به زبانه **قواعد تشدید** بروید
3. روی **افزودن قاعده تشدید** کلیک کنید
4. قاعده را پر کنید. فقط یک گام است:
   - **تماس با چه کسی**: یک زمان‌بندی آنکال یا یک فرد. زمان‌بندی آنکال هنگام دریافت تماس، با کسی تماس می‌گیرد که در آن لحظه در آن آنکال است. افراد، اعضای پروژه شما هستند.
   - **مدت زنگ (به ثانیه)**: اینکه تلفن آن‌ها چه مدت زنگ بزند تا تماس به قاعده بعدی برود. از ۲۰ ثانیه شروع می‌شود و Twilio از ۵ تا ۶۰۰ را می‌پذیرد.
   - **نام** و **توضیحات** اختیاری‌اند و زیر **فیلدهای بیشتر** قرار دارند. قاعده بی‌نام با جایگاهش در فهرست نشان داده می‌شود: **Level 1**، **Level 2**.
5. آن را ذخیره کنید و برای هر زمان‌بندی یا فردی که باید بعد از آن امتحان شود، قاعده‌ای اضافه کنید

قواعد از بالای فهرست به پایین تماس گرفته می‌شوند و قاعده تازه به انتهای فهرست افزوده می‌شود. برای تغییر ترتیب، قاعده را با دستگیره بالا سمت چپش بکشید؛ با صفحه‌کلید، روی دستگیره فوکوس کنید، Space را بزنید، با کلیدهای جهت جابه‌جایش کنید و دوباره Space را بزنید.

> **حواستان به پیغام‌گیر باشد**: **مدت زنگ** را کوتاه‌تر از زمانی بگذارید که طول می‌کشد تلفن آن فرد تماسِ بی‌پاسخ را به پیغام‌گیر بفرستد. اگر پیغام‌گیر زودتر پاسخ دهد، تماس‌گیرنده به آن وصل می‌شود و تماس به قاعده بعدی نمی‌رود. Twilio خودش چند ثانیه به هر زنگ می‌افزاید. به همین دلیل هر قاعده تازه از ۲۰ ثانیه شروع می‌شود. قاعده‌هایی که وقتی پیش‌فرض ۳۰ ثانیه بود افزوده شده‌اند همان ۳۰ را نگه می‌دارند: اگر تماس‌هایشان به پیغام‌گیر می‌رسد، **مدت زنگ** آن قاعده‌ها را کمتر کنید.

### نمونه قاعده تشدید

```mermaid
flowchart TD
    subgraph "Escalation Chain"
        A[Level 1: Primary on-call schedule<br/>Ring for 20 seconds] --> B[Level 2: Secondary on-call schedule<br/>Ring for 20 seconds]
        B --> C[Level 3: Engineering lead<br/>Ring for 20 seconds]
        C --> D[No Answer Message]
    end
```

| سطح     | تماس با چه کسی          | مدت زنگ  |
| ------- | ----------------------- | -------- |
| Level 1 | زمان‌بندی کشیک اصلی     | ۲۰ ثانیه |
| Level 2 | زمان‌بندی کشیک ثانویه   | ۲۰ ثانیه |
| Level 3 | سرپرست مهندسی (یک فرد) | ۲۰ ثانیه |

## گام ۷: پیکربندی پیام‌های صوتی (اختیاری)

پیام‌هایی را که تماس‌گیرندگان می‌شنوند سفارشی کنید:

1. سیاست تماس ورودی خود را باز کنید
2. به **Settings** بروید
3. پیکربندی کنید:
   - **Greeting Message**: هنگام پاسخ داده شدن تماس پخش می‌شود
   - **No Answer Message**: وقتی همه قواعد تشدید شکست بخورند پخش می‌شود
   - **No One Available Message**: وقتی کسی کشیک نباشد پخش می‌شود

## گزینه‌های پیکربندی

### تنظیمات سیاست

| تنظیم | توضیح | پیش‌فرض |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Greeting Message | پیام TTS که هنگام پاسخ داده شدن تماس پخش می‌شود | "Please wait while we connect you to the on-call engineer." |
| No Answer Message | پیام وقتی همه قواعد تشدید شکست بخورند | "No one is available. Please try again later." |
| No One Available Message | پیام وقتی کسی کشیک نباشد | "We're sorry, but no on-call engineer is currently available." |
| Repeat Policy If No One Answers | اگر همه شکست خوردند از قاعده نخست دوباره آغاز کن | غیرفعال |
| Repeat Policy Times | بیشینه تلاش‌های تکرار | ۱ |

### تنظیمات قاعده تشدید

| تنظیم              | توضیح                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| تماس با چه کسی     | یک زمان‌بندی آنکال، که با کسی که در آن آنکال است تماس می‌گیرد، یا یک فرد. هر قاعده با یکی از آن‌ها تماس می‌گیرد                            |
| مدت زنگ (به ثانیه) | اینکه تلفن چه مدت زنگ بزند تا تماس به قاعده بعدی برود (پیش‌فرض: ۲۰؛ از ۵ تا ۶۰۰)                                                            |
| نام و توضیحات      | اختیاری، زیر فیلدهای بیشتر. قاعده بی‌نام با جایگاهش در فهرست، به شکل Level 1، Level 2 و مانند آن نشان داده می‌شود                                 |
| ترتیب              | جایگاه قاعده در فهرست: قواعد از بالا به پایین تماس گرفته می‌شوند. با کشیدن قواعد تنظیم می‌شود؛ از راه API، قاعده تازه بدون ترتیب به انتهای فهرست می‌رود |

از راه API، هر قاعده `onCallDutyPolicyScheduleId` یا `userId` را تعیین می‌کند (یکی از آن دو، نه هر دو) و `escalateAfterSeconds` را: مدت زنگ، که اگر داده نشود ۲۰ است.

## دیدن گزارش‌های تماس

برای دیدن تاریخچه تماس‌های ورودی:

1. به **On-Call Duty** > **Incoming Call Policies** بروید
2. روی سیاستتان کلیک کنید
3. به زبانه **Call Logs** بروید

گزارش‌ها این‌ها را نشان می‌دهند:

- شماره تلفن تماس‌گیرنده
- وضعیت تماس (Completed، No Answer، Failed و غیره)
- چه کسی به تماس پاسخ داد
- مدت تماس
- مهر زمانی

## پیکربندی شماره تلفن کاربر

برای اینکه کاربران تماس ورودی بگیرند، باید شماره تلفنی تأییدشده داشته باشند:

1. کاربران به **User Settings** > **Notification Methods** می‌روند
2. زیر **Incoming Call Numbers** شماره تلفنی می‌افزایند
3. شماره تلفن را با کد پیامکی تأیید می‌کنند

فقط کاربران با شماره تلفن تأییدشده می‌توانند از راه قواعد تشدید فراخوانده شوند.

شماره‌های تماس ورودی با پیامک تأیید می‌شوند، پس اول باید **SMS** برای پروژه روشن باشد. مالک پروژه یا کسی که **Billing Admin** یا **Manage Billing** دارد آن را در کارت **کانال‌های اعلان** در **Project Settings > Notifications > Notification Settings** روشن می‌کند.

## آزاد کردن یک شماره تلفن

اگر دیگر به شماره تلفنی نیاز ندارید:

1. سیاست تماس ورودی خود را باز کنید
2. در کارت **Phone Number** روی **Release Number** کلیک کنید
3. آزادسازی را تأیید کنید

> **هشدار**: شماره‌های آزادشده به Twilio بازمی‌گردند و ممکن است برای خرید دوباره در دسترس نباشند.

## رفع اشکال

### تماس‌ها دریافت نمی‌شوند

- تأیید کنید پیکربندی Twilio درست به سیاست پیوند خورده است
- بررسی کنید نمونه OneUptime شما از اینترنت دست‌یافتنی باشد
- درست بودن Account SID و Auth Token در Twilio را تأیید کنید
- کنسول Twilio را برای گزارش‌های خطا بررسی کنید

### تماس‌ها به مهندسان وصل نمی‌شوند

- تأیید کنید کاربران در تنظیمات اعلانشان شماره تلفن تأییدشده دارند
- بررسی کنید قواعد تشدید درست پیکربندی شده باشند
- مطمئن شوید زمان‌بندی‌های کشیک برای زمان جاری کاربری تخصیص‌یافته دارند
- تأیید کنید سیاست فعال باشد
- اگر تماس‌ها به پیغام‌گیر یک مهندس می‌رسند، **مدت زنگ** قاعده را کمتر از زمانی بگذارید که تلفن او به پیغام‌گیر می‌رود

### مشکل‌های کیفیت صدا

- مطمئن شوید کارساز شما اتصال اینترنتی پایداری دارد
- صفحه وضعیت Twilio را برای مشکل‌های جاری بررسی کنید
- تأیید کنید شماره‌های تلفن در قالب درست باشند (قالب E.164: ‏+15551234567)

## ملاحظات امنیتی

- ‏Auth Token خود در Twilio را امن نگه دارید و هرگز عمومی افشایش نکنید
- برای نمونه OneUptime خود از HTTPS استفاده کنید
- ‏OneUptime امضای وب‌هوک‌ها را تأیید می‌کند تا مطمئن شود درخواست‌ها از Twilio می‌آیند
- در نظر بگیرید محدود کنید چه شماره‌های تلفنی می‌توانند به سیاست‌های تماس ورودی شما تماس بگیرند

## نمای کلی معماری

```mermaid
graph TB
    subgraph "External"
        A[Caller]
        B[Twilio Cloud]
    end

    subgraph "OneUptime"
        C[Incoming Call API]
        D[Call Router]
        E[Escalation Engine]
        F[Database]
    end

    subgraph "On-Call Team"
        G[Engineer 1]
        H[Engineer 2]
        I[Manager]
    end

    A -->|1. Dials number| B
    B -->|2. Webhook| C
    C -->|3. Load policy| F
    C -->|4. Get rules| D
    D -->|5. Process rules| E
    E -->|6. TwiML response| B
    B -->|7. Dial| G
    B -->|8. Escalate| H
    B -->|9. Escalate| I
```

## پشتیبانی

برای مشکل‌های مربوط به قابلیت سیاست تماس ورودی، لطفاً:

1. کنسول Twilio را برای گزارش‌های خطا بررسی کنید
2. گزارش‌های کارساز OneUptime را مرور کنید
3. با پشتیبانی در [hello@oneuptime.com](mailto:hello@oneuptime.com) تماس بگیرید
