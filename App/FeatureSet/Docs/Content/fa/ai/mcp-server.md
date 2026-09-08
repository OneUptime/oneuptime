# کارساز MCP

کارساز پروتکل بافتار مدل (MCP) در OneUptime به LLMها دسترسی مستقیم به نمونه OneUptime شما می‌دهد، و مانیتورینگ، مدیریت حادثه و عملیات رصدپذیری مبتنی بر هوش مصنوعی را ممکن می‌کند.

## کارساز MCP در OneUptime چیست؟

کارساز MCP در OneUptime پلی میان مدل‌های زبانی بزرگ (LLM) و نمونه OneUptime شماست. پروتکل بافتار مدل (MCP) را پیاده می‌کند، و به دستیارهای هوش مصنوعی مانند Claude امکان می‌دهد مستقیم با زیرساخت مانیتورینگ شما تعامل کنند.

## چگونه کار می‌کند

کارساز MCP در کنار نمونه OneUptime شما میزبانی می‌شود و از راه حامل Streamable HTTP دست‌یافتنی است. نصب محلی لازم نیست.

**کاربران ابری**: `https://oneuptime.com/mcp`
**کاربران خودمیزبان**: `https://your-oneuptime-domain.com/mcp`

## قابلیت‌های کلیدی

- **حدود ۱۵۵ ابزار**: ابزارهای کامل CRUD برای ۲۲ نوع منبع (حادثه، هشدار، مانیتور، صفحه وضعیت، کشیک و بیشتر)، ابزارهای فقط‌خواندنی تله‌متری، به‌علاوه ابزارهای گردش کاری و کمکی
- **عملیات بی‌درنگ**: ساخت، خواندن، به‌روزرسانی و حذف منابع به‌صورت بی‌درنگ
- **رابط تایپ‌ایمن**: کاملاً تایپ‌شده با اعتبارسنجی جامع ورودی
- **احراز هویت امن**: احراز هویت با کلید API به ازای هر درخواست با مدیریت درست خطا
- **حاشیه‌نویسی ایمنی**: ابزارهای فقط‌خواندنی `readOnlyHint` و ابزارهای حذف `destructiveHint` حمل می‌کنند، پس کلاینت‌های MCP می‌توانند فراخوان‌های امن را خودکار تأیید کنند و پیش از ویرانگرها بپرسند
- **یکپارچه‌سازی آسان**: با Claude Desktop و دیگر کلاینت‌های سازگار با MCP کار می‌کند
- **بی‌حالت بنا به طراحی**: بدون شناسه نشست — هر درخواستی خودبسنده است، پس کارساز پشت متعادل‌کننده بار و استقرارهای چندنسخه‌ای کار می‌کند

## چه می‌توانید بکنید

با کارساز MCP در OneUptime، دستیارهای هوش مصنوعی می‌توانند کمکتان کنند:

- **مدیریت مانیتور**: ساخت و پیکربندی مانیتورها، بررسی وضعیتشان، و مرور تاریخچه وضعیت
- **پاسخ به حادثه**: ساخت، تصدیق و برطرف کردن حادثه‌ها، افزودن یادداشت داخلی یا عمومی، و ردیابی برطرف شدن
- **عملیات تیمی**: مدیریت تیم‌ها و سیاست‌های کشیک
- **صفحه‌های وضعیت**: مدیریت صفحه‌های وضعیت و ساخت اعلامیه
- **هشداردهی**: تصدیق و برطرف کردن هشدارها، افزودن یادداشت هشدار، و مدیریت وضعیت‌ها و شدت‌های هشدار
- **نگهداری زمان‌بندی‌شده**: ساخت و مدیریت رویدادهای نگهداری زمان‌بندی‌شده
- **تله‌متری**: پرس‌وجوی گزارش‌ها، سنجه‌ها، ردیابی‌ها، استثناها و گزارش‌های مانیتور (فقط‌خواندنی)

## نیازمندی‌ها

- نمونه‌ای از OneUptime (ابری یا خودمیزبان)
- کلاینتی سازگار با MCP (‏Claude Desktop، ‏VS Code با GitHub Copilot و غیره)
- کلید API معتبر OneUptime (فقط برای عملیات احراز شده لازم است — ابزارهای عمومی بدون آن کار می‌کنند)

## گرفتن کلید API

1. به نمونه OneUptime خود وارد شوید
2. به **Project Settings** → **API Keys** بروید
3. روی **Create API Key** کلیک کنید
4. نامی بدهید (برای نمونه «MCP Server»)
5. دسترسی‌های مناسب مورد کاربردتان را برگزینید
6. کلید API تولیدشده را کپی کنید

کلیدهای API به پروژه محدودند: کارساز MCP پروژه شما را از کلید استنتاج می‌کند، پس ابزارهای ساخت هرگز به آرگومان `projectId` نیاز ندارند.

> **هشدار — هرگز کلید ارشد به عاملی هوش مصنوعی ندهید.** کلید API *ارشد* در OneUptime روی این هدر هم پذیرفته می‌شود و دسترسی مدیریتی در سطح نمونه اعطا می‌کند. همیشه کلید API پروژه‌ای با کمترین امتیازی که عامل لازم دارد به کار ببرید (کلیدی فقط‌خواندنی برای همه ابزارهای `get_`/`list_`/`count_` بس است).

## پیکربندی

### پیکربندی Claude Desktop

فایل پیکربندی Claude Desktop خود را بیابید:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### برای OneUptime Cloud

این پیکربندی را بیفزایید:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### برای OneUptime خودمیزبان

به‌جای `oneuptime.com` دامنه OneUptime خود را بگذارید:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### دسترسی عمومی (بدون کلید API)

برای استفاده فقط از ابزارهای عمومی (اطلاعات صفحه وضعیت، راهنما)، می‌توانید بدون کلید API وصل شوید:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

این پیکربندی بدون نیاز به احراز هویت به ابزارهای عمومی صفحه وضعیت و منابع راهنما دسترسی می‌دهد. صفحه‌های وضعیت منفرد می‌توانند از دسترسی MCP انصراف دهند؛ [ابزارهای عمومی](#public-tools-no-authentication-required) را ببینید.

### ‏VS Code با GitHub Copilot

‏VS Code از کارسازهای MCP با GitHub Copilot به‌صورت بومی پشتیبانی می‌کند (نسخه ۱٫۹۹ به بالا). این به Copilot امکان می‌دهد مستقیم به داده OneUptime دسترسی داشته باشد.

#### گام ۱: نیازمندی‌ها

- ‏VS Code نسخه ۱٫۹۹ یا بالاتر
- افزونه GitHub Copilot نصب و فعال
- ‏GitHub Copilot Chat فعال

#### گام ۲: باز کردن پیکربندی MCP

1. `Ctrl+Shift+P` (ویندوز/لینوکس) یا `Cmd+Shift+P` (macOS) را بزنید
2. «MCP: Open User Configuration» را تایپ کنید و Enter بزنید
3. این فایل پیکربندی `mcp.json` را باز یا می‌سازد

یا برای پیکربندی مخصوص پروژه، `.vscode/mcp.json` را در فضای کاری‌تان بسازید.

#### برای OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### برای OneUptime خودمیزبان

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### گام ۳: آغاز کارساز MCP

1. `Ctrl+Shift+P` / `Cmd+Shift+P` را بزنید
2. «MCP: List Servers» را تایپ کنید تا کارسازهای در دسترس را ببینید
3. روی «oneuptime» کلیک کنید تا کارساز آغاز شود
4. وقتی پرسیده شد، کلید API خود در OneUptime را وارد کنید

#### گام ۴: استفاده با Copilot Chat

‏GitHub Copilot Chat را باز کنید و از حالت Agent استفاده کنید (`@workspace` یا مستقیم بپرسید):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### یادداشت امنیتی

پیکربندی بالا از متغیرهای ورودی با `"password": true` استفاده می‌کند تا به‌جای ذخیره کلید API به‌صورت متن ساده، امن بپرسدش. VS Code هنگام نخستین آغاز کارساز MCP از شما می‌خواهد اعتماد را تأیید کنید.

## نقطه‌های پایانی در دسترس

| نقطه پایانی | متد | توضیح |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp` | POST | درخواست‌های JSON-RPC برای فراخوان ابزار و دیگر عملیات |
| `/mcp` | GET | بدون هدر `Accept` از نوع SSE: محموله کشف JSON دوستانه. با آن: `405` — کارساز بی‌حالت جریان SSE مستقلی ارائه نمی‌دهد (کلاینت‌های سازگار بدون آن ادامه می‌دهند) |
| `/mcp` | DELETE | بی‌اثر (کارساز بی‌حالت است، پس نشستی برای خاتمه دادن نیست) |
| `/mcp/health` | GET | نقطه پایانی بررسی سلامت |
| `/mcp/tools` | GET | ‏API از نوع REST برای فهرست کردن ابزارهای در دسترس |

## احراز هویت

کارساز MCP از دو حالت کارکرد پشتیبانی می‌کند:

### ابزارهای عمومی (بدون نیاز به احراز هویت)

می‌توانید بدون کلید API به کارساز MCP وصل شوید تا به ابزارهای عمومی دسترسی داشته باشید:

- **`oneuptime_help`**: گرفتن راهنما و راهبری درباره توانایی‌های MCP در OneUptime
- **`oneuptime_list_resources`**: فهرست کردن منابع در دسترس و عملیاتشان
- **`get_public_status_page_overview`**: گرفتن نمای کلی صفحه وضعیتی عمومی
- **`get_public_status_page_incidents`**: گرفتن حادثه‌ها از صفحه وضعیتی عمومی
- **`get_public_status_page_scheduled_maintenance`**: گرفتن رویدادهای نگهداری زمان‌بندی‌شده
- **`get_public_status_page_announcements`**: گرفتن اعلامیه‌ها از صفحه وضعیتی عمومی

ابزارهای صفحه وضعیت عمومی یا شناسه صفحه وضعیت (UUID) یا نام دامنه صفحه وضعیت را می‌پذیرند.

مالکان صفحه وضعیت می‌توانند دسترسی MCP را برای صفحه وضعیتی منفرد زیر **Status Page → Advanced Settings → MCP Server** خاموش کنند. دسترسی MCP به‌طور پیش‌فرض فعال است. وقتی غیرفعال باشد، چهار ابزار `get_public_status_page_*` برای آن صفحه وضعیت خطا برمی‌گردانند؛ وب‌سایت صفحه وضعیت، خوراک RSS و API عمومی JSON آن متأثر نمی‌شوند، و ابزارهای احراز شده صفحه وضعیت (`get_status_page`، `list_status_pages` و مانند آن) برای پروژه خود صفحه به کار کردن ادامه می‌دهند.

### ابزارهای احراز شده (نیازمند کلید API)

برای همه عملیات دیگر (مدیریت مانیتورها، حادثه‌ها، تیم‌ها و غیره)، احراز هویت از راه یکی از این هدرها لازم است:

- `x-api-key`: کلید API شما در OneUptime
- `Authorization`: توکن Bearer با کلید API شما (برای نمونه `Bearer your-api-key-here`)

طرح `Bearer` به بزرگی و کوچکی حروف حساس نیست. خطاهای ابزار به‌صورت نتایج ابزار درون‌باند (`isError: true`) با `statusCode`، جزئیات و پیشنهادی برمی‌گردند — نه به‌عنوان خطای پروتکل MCP — پس عامل‌ها می‌توانند شکست را بخوانند و خودشان اصلاح کنند.

## ابزارهای گردش کاری

فراتر از ابزارهای CRUD به ازای هر منبع، کارساز ابزارهایی ساخته‌شده برای هدف پاسخ به حادثه و هشدار عرضه می‌کند:

- **`acknowledge_incident`** / **`resolve_incident`**: حادثه‌ای را به وضعیت Acknowledged یا Resolved پروژه ببرید — معادل زدن دکمه در داشبورد
- **`acknowledge_alert`** / **`resolve_alert`**: همان برای هشدارها
- **`add_incident_note`**: افزودن یادداشتی به حادثه‌ای با `visibility: "internal"` (فقط تیم، پیش‌فرض) یا `visibility: "public"` (منتشرشده روی صفحه وضعیت). مارک‌داون پشتیبانی می‌شود
- **`add_alert_note`**: افزودن یادداشتی داخلی به هشداری

حلقه‌ای معمول: `list_incidents` → `acknowledge_incident` → بررسی با `list_logs` → `add_incident_note` (عمومی) → `resolve_incident`.

## من که هستم

ابزار **`oneuptime_whoami`** پروژه‌ای را که کلید API شما به آن تعلق دارد برمی‌گرداند (شناسه و نام). نخستین فراخوان مفیدی برای عاملی است که خودش را جهت‌یابی کند — و چون ابزارهای ساخت `projectId` را از کلید API استنتاج می‌کنند، عامل هرگز نیازی به دادن شناسه پروژه ندارد.

## پرس‌وجوی تله‌متری

گزارش‌ها، سنجه‌ها، ردیابی‌ها (اسپن‌ها)، استثناها و گزارش‌های مانیتور به‌صورت ابزارهای فقط‌خواندنی `list_` و `count_` در معرض‌اند (`list_logs`، `list_metrics`، `list_spans`، `list_exception_instances`، `list_monitor_logs` و همتاهای `count_` آن‌ها). تله‌متری از راه OpenTelemetry دریافت می‌شود، پس ابزار ساختی نیست.

همیشه تله‌متری را با پالایه بازه زمانی پرس‌وجو کنید. فیلدهای پرس‌وجو یا مقداری مستقیم یا شیئی از عملگر می‌پذیرند:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

عملگرهای پشتیبانی‌شده: `EqualTo`، `NotEqual`، `IsNull`، `NotNull`، `EqualToOrNull`، `GreaterThan`، `LessThan`، `GreaterThanOrEqual`، `LessThanOrEqual`، `InBetween`، `Search`، `Includes`. مقادیر مرتب‌سازی `"ASC"` یا `"DESC"` هستند.

## انتخاب فیلد و صفحه‌بندی

ابزارهای `get_` و `list_` آرایه اختیاری `select` از نام فیلدها می‌پذیرند. به‌طور پیش‌فرض همه فیلدهای خواندنی جز سنگین‌ها (ستون‌های JSON، متن‌های خیلی بلند و HTML) برمی‌گردند، که باید صریح در `select` درخواست شوند.

ابزارهای فهرست با `limit` (پیش‌فرض ۱۰، بیشینه ۱۰۰) و `skip` صفحه‌بندی می‌کنند، و هر پاسخ فهرستی دقیقاً گزارش می‌دهد چه برگردانده است:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## تأیید

تأیید کنید کارساز MCP در حال اجراست:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

ابزارهای در دسترس را فهرست کنید:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## نمونه استفاده‌ها

### پرس‌وجوهای پایه‌ای اطلاعات

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### مدیریت مانیتور

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### مدیریت حادثه

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### تیم و کشیک

```
"List the teams in this project"
"Show me our on-call policies"
```

### مدیریت صفحه وضعیت

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### پرس‌وجوهای صفحه وضعیت عمومی (بدون نیاز به کلید API)

این پرس‌وجوها بدون احراز هویت و فقط با ابزارهای عمومی صفحه وضعیت کار می‌کنند:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### عملیات پیشرفته

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## دسترسی‌های کلید API

### دسترسی فقط‌خواندنی

برای فقط دیدن داده، دسترسی خواندن را به کلید API خود بیفزایید.

### دسترسی کامل

برای دسترسی کامل به ساخت، به‌روزرسانی و حذف منابع، مطمئن شوید کلید API شما دسترسی Project Admin دارد.

### بهترین شیوه‌ها

- دسترسی‌های مشخص به کار ببرید: فقط کمترین دسترسی لازم را اعطا کنید
- کلیدهای API را بچرخانید: مرتب کلیدهای API خود را بچرخانید
- مصرف را بپایید: مصرف کلید API را در OneUptime ردیابی کنید
- کلیدهای جدا: برای محیط‌های متفاوت کلیدهای API متفاوت به کار ببرید

## رفع اشکال

### خطاهای دسترسی

مطمئن شوید کلید API شما دسترسی‌های لازم را دارد:

- دسترسی خواندن برای فهرست کردن منابع
- دسترسی نوشتن برای ساخت/به‌روزرسانی منابع
- دسترسی حذف اگر می‌خواهید منابعی را بردارید

### مشکل‌های اتصال

1. تأیید کنید نشانی OneUptime شما درست است
2. بررسی کنید کلید API شما معتبر است
3. مطمئن شوید نمونه OneUptime شما دست‌یافتنی است
4. نقطه پایانی سلامت را بیازمایید

### کلید API نامعتبر

- کلید API را در تنظیمات OneUptime خود تأیید کنید
- فاصله یا نویسه اضافه را بررسی کنید
- مطمئن شوید کلید منقضی نشده است

### خطاهای نشست

اگر خطاهای مربوط به نشست گرفتید:

- کارساز MCP بی‌حالت است — شناسه نشستی صادر یا ردیابی نمی‌کند، پس هر درخواستی روی هر نسخه‌ای از کارساز کار می‌کند
- کلاینت‌هایی که هدر `mcp-session-id` را از نسخه‌ای پیشین از کارساز می‌فرستند می‌توانند صرفاً نگذارندش؛ نادیده گرفته می‌شود
- پیکربندی‌های قدیمی‌تر کلاینت MCP را که انتظار دارند کارساز شناسه نشستی برگرداند به‌روزرسانی کنید

## منابع در دسترس

کارساز MCP برای منابع زیر ابزار فراهم می‌کند:

**مانیتورینگ**: Monitor، ‏Monitor Status، ‏Monitor Status Event
**حادثه‌ها**: Incident، ‏Incident State، ‏Incident Severity، ‏Incident State Timeline، ‏Incident Public Note، ‏Incident Internal Note
**هشدارها**: Alert، ‏Alert State، ‏Alert Severity، ‏Alert State Timeline، ‏Alert Internal Note
**صفحه‌های وضعیت**: Status Page، ‏Status Page Announcement
**نگهداری زمان‌بندی‌شده**: Scheduled Maintenance Event، ‏Scheduled Maintenance State، ‏Scheduled Maintenance State Timeline
**تیم‌ها و کشیک**: Team، ‏On-Call Policy
**برچسب‌ها**: Label
**تله‌متری (فقط‌خواندنی)**: Log، ‏Metric، ‏Span، ‏Exception Instance، ‏Monitor Log

هر منبع پایگاه داده‌ای از Create، ‏Get، ‏List، ‏Update، ‏Delete و Count با ابزارهایی به شکل snake_case پشتیبانی می‌کند — برای نمونه `create_incident`، `get_incident`، `list_incidents`، `update_incident`، `delete_incident`، `count_incidents`. منابع تله‌متری فقط ابزارهای `list_` و `count_` در معرض می‌گذارند (برای نمونه `list_logs`، `count_spans`).
