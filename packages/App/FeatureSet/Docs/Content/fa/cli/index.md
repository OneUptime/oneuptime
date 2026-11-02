# نمای کلی CLI

CLI OneUptime، یعنی `oneuptime`، پروژهٔ OneUptime شما را از ترمینال یا یک اسکریپت مدیریت می‌کند. با یک کلید API از پروژه‌تان، مانیتورها، حادثه‌ها، هشدارها، صفحه‌های وضعیت و دیگر رکوردهایی را که API OneUptime ارائه می‌دهد فهرست کنید، بخوانید، بسازید، تغییر دهید، حذف کنید و بشمارید.

:::cards
- [CLI چگونه کار می‌کند](#cli-چگونه-کار-میکند): یک دستور، درخواست‌هایی که به API می‌فرستد و پاسخ آن.
- [نصب CLI](#نصب-cli): نصب‌کننده‌ای که OneUptime شما در اختیار می‌گذارد، یا npm.
- [اجرای نخستین دستورها](#اجرای-نخستین-دستورها): کلید API خود را ذخیره و بررسی کنید، سپس حادثه‌هایتان را فهرست کنید.
- [نگاهی کلی به دستورها](#نگاهی-کلی-به-دستورها): همهٔ دستورها، و صفحه‌ای که هر کدام را توضیح می‌دهد.
:::

## CLI چگونه کار می‌کند

بیشتر دستورها یک درخواست به REST API OneUptime می‌فرستند و پاسخ را چاپ می‌کنند؛ یک کنش، مانند `acknowledge`، همان چند درخواستی را می‌فرستد که دکمهٔ داشبورد می‌فرستد. CLI کلید API و نشانی OneUptime شما را از پرچم‌ها، متغیرهای محیطی یا زمینه‌ای که `oneuptime login` ذخیره کرده است برمی‌دارد. کلید تعیین می‌کند که یک دستور چه چیزی را می‌تواند بخواند و تغییر دهد، دقیقاً همان‌طور که برای API.

```mermaid title="یک دستور، یک درخواست"
flowchart TB
    T["ترمینال شما<br/>یا یک جاب CI"] -->|"oneuptime incident list"| C["oneuptime CLI"]
    K["کلید API و URL:<br/>پرچم‌ها، متغیرهای محیطی<br/>یا زمینهٔ ذخیره‌شده"] --> C
    C -->|"POST /api/incident/get-list"| A["OneUptime REST API"]
    A -->|"رکوردهایی که کلید<br/>می‌تواند بخواند، به‌صورت JSON"| C
    C -->|"جدول در ترمینال،<br/>JSON در پایپ"| T
```

هر منبع API OneUptime یک دستور است، ۴۵۰ دستور و بیشتر، از `incident` و `monitor` تا `status-page-subscriber` و `telemetry-ingestion-key`، و هر کدام عملیاتی را دارد که API برای آن می‌پذیرد. CLI همراه با OneUptime منتشر می‌شود، پس CLI هم‌نسخهٔ OneUptime شما برای هر منبعی که سرور شما دارد یک دستور دارد. برای فهرست کردن آن‌ها `oneuptime resources` را اجرا کنید.

## پیش از شروع

- **Node.js و npm**، یک نسخهٔ LTS فعلی، برای نصب CLI.
- **یک کلید API از پروژهٔ شما.** آن را در **تنظیمات پروژه** > **پیشرفته** > **کلیدهای API** با **ساخت کلید API** بسازید: [یک کلید API بسازید](/docs/api-reference/api-reference#یک-کلید-api-بسازید) را ببینید.
- **در OneUptime Cloud، طرح Growth یا بالاتر.** کلیدهای API یک پروژه فقط روی آن کار می‌کنند: [کلیدهای API و SCIM پایین‌تر از طرحشان](/docs/api-reference/api-reference#کلیدهای-api-و-scim-پایینتر-از-طرحشان) را ببینید.

## نصب CLI

هر OneUptime اسکریپت نصب CLI را برای نسخهٔ خودش در اختیار می‌گذارد: دستورهای زیر آن را از `https://oneuptime.com` دریافت می‌کنند، پس در OneUptime خودمیزبان این نشانی را با URL خود جایگزین کنید. اسکریپت نخست با نام `install.sh` ذخیره می‌شود تا بتوانید پیش از اجرا آن را بخوانید. این اسکریپت نسخهٔ OneUptime شما را از آن می‌پرسد و CLI همان نسخه را با npm نصب می‌کند:

```bash
curl -fsSL https://oneuptime.com/install/cli -o install.sh
ONEUPTIME_URL=https://oneuptime.com bash install.sh
```

یا بستهٔ `@oneuptime/cli` را خودتان از npm نصب کنید. این بسته دستور `oneuptime` را اضافه می‌کند و `--version` نسخه‌ای را که نصب کرده‌اید چاپ می‌کند:

```bash
npm install -g @oneuptime/cli
oneuptime --version
```

CLI همراه با OneUptime منتشر می‌شود و همان شمارهٔ نسخه را دارد. در OneUptime خودمیزبان، CLI هم‌نسخهٔ OneUptime خود را نصب کنید تا دستورهایش با رکوردهای سرور شما جور باشند:

```bash
npm install -g @oneuptime/cli@<your-oneuptime-version>
```

> [!WARNING]
> نسخه‌های CLI پیش از 14.0.64 همان لحظهٔ اجرا با خطایی مانند `Cannot find module 'Common/Models/DatabaseModels/Index'` متوقف می‌شوند. نسخهٔ 14.0.64 یا جدیدتر را با `npm install -g @oneuptime/cli@latest` نصب کنید. در OneUptime خودمیزبانِ قدیمی‌تر از 14.0.64، نخست [OneUptime را ارتقا دهید](/docs/installation/upgrading#روش-ارتقا) و سپس CLI همان نسخه‌ای را نصب کنید که به آن ارتقا داده‌اید.

## اجرای نخستین دستورها

:::steps
### کلید API خود را ذخیره کنید

با کلید و نشانی OneUptime خود وارد شوید. CLI آن‌ها را به‌عنوان زمینه‌ای به نام `default` ذخیره می‌کند و از این پس از آن استفاده می‌کند:

```bash
oneuptime login <your-api-key> https://oneuptime.com
```

پاسخ آن `Logged in successfully. Context "default" is now active.` است. در OneUptime خودمیزبان، به‌جای `https://oneuptime.com` نشانی آن را بنویسید.

### بررسی کلید

```bash
oneuptime whoami --check
```

`login` کلید را بدون پرسیدن از OneUptime ذخیره می‌کند. `--check` می‌پرسد: پروژهٔ کلید، نسخهٔ OneUptime شما و نسخهٔ CLI را نشان می‌دهد، و این‌که وقتی این دو با هم فرق دارند چه چیزی را نصب کنید. اگر OneUptime کلید را رد کرد، [عیب‌یابی](/docs/cli/authentication#عیبیابی) را ببینید.

### حادثه‌هایتان را فهرست کنید

```bash
oneuptime incident list
```

تازه‌ترین ده حادثه به‌صورت جدول نمایش داده می‌شوند.

### ببینید چه چیزهای دیگری را می‌توانید مدیریت کنید

```bash
oneuptime resources
```

این فهرست هر نوع رکوردی را که می‌توانید با آن کار کنید همراه با دستورش نشان می‌دهد، مانند `monitor`، `status-page` یا `on-call-policy`. `oneuptime monitor fields` فیلدهای یک مانیتور و پرچم‌هایی را که آن‌ها را تنظیم می‌کنند فهرست می‌کند.
:::

## نگاهی کلی به دستورها

| دستور | چه می‌کند | بیشتر بخوانید |
| --- | --- | --- |
| `oneuptime login <api-key> <instance-url>` | یک کلید API و یک نشانی را به‌عنوان زمینه ذخیره می‌کند | [احراز هویت](/docs/cli/authentication#ورود) |
| `oneuptime context list`, `use`, `current`, `delete` | زمینه‌های ذخیره‌شده را فهرست می‌کند، عوض می‌کند، نشان می‌دهد و حذف می‌کند | [احراز هویت](/docs/cli/authentication#زمینهها) |
| `oneuptime whoami` | URL و کلید API را که دستور بعدی به کار می‌برد نشان می‌دهد، و با `--check` این‌که OneUptime کلید را می‌پذیرد یا نه | [احراز هویت](/docs/cli/authentication#ببینید-cli-از-چه-چیزی-استفاده-خواهد-کرد) |
| `oneuptime deploy` | یک استقرار، یا تغییری دیگر، را برای نمودارها و OneUptime AI ثبت می‌کند | [استقرارها و تغییرها](/docs/telemetry/change-events) |
| `oneuptime <resource> list`, `get`, `create`, `update`, `delete`, `count` | با یک نوع رکورد کار می‌کند | [عملیات روی منابع](/docs/cli/resource-operations) |
| `oneuptime <resource> fields` | فیلدهای یک منبع و پرچم‌هایی را که آن‌ها را تنظیم می‌کنند فهرست می‌کند | [عملیات روی منابع](/docs/cli/resource-operations#دیدن-فیلدهای-یک-منبع) |
| `oneuptime <resource> acknowledge`, `resolve`, `start`, `end`, `add-note` | روی حادثه‌ها، هشدارها و تعمیر و نگهداری زمان‌بندی‌شده همان کاری را می‌کند که دکمه‌های داشبورد می‌کنند | [عملیات روی منابع](/docs/cli/resource-operations#تأیید-رفع-و-افزودن-یادداشت) |
| `oneuptime resources` | انواع رکورد را همراه با دستورهایشان فهرست می‌کند | [مرجع دستورها](/docs/cli/command-reference#oneuptime-resources) |
| `oneuptime version` | نسخهٔ CLI را چاپ می‌کند | [مرجع دستورها](/docs/cli/command-reference#oneuptime-version) |
| `oneuptime help [command]` | راهنمای یک دستور را نشان می‌دهد | [گرفتن راهنما](#گرفتن-راهنما) |

## گزینه‌های سراسری

این گزینه‌ها با هر دستوری کار می‌کنند، پیش یا پس از آن:

| گزینه | چه می‌کند |
| --- | --- |
| `--api-key <key>` | کلید API برای همین دستور، به‌جای کلید ذخیره‌شده |
| `--url <url>` | نشانی OneUptime شما برای همین دستور |
| `--context <name>` | یک زمینهٔ ذخیره‌شده برای همین دستور، به‌جای زمینهٔ فعلی |
| `-o, --output <format>` | `table`، `json` یا `wide`: [قالب‌های خروجی](/docs/cli/output-formats) را ببینید |
| `--json` | همان `-o json` |
| `--no-color` | بدون رنگ چاپ می‌کند |
| `-V, --version` | نسخهٔ CLI را چاپ می‌کند |
| `-h, --help` | راهنمای دستور را نشان می‌دهد |

## گرفتن راهنما

هر دستور راهنمای خودش را دارد، با آرگومان‌ها، گزینه‌ها و مقادیر پیش‌فرضش:

```bash
oneuptime --help
oneuptime help incident
oneuptime incident list --help
```

## گام‌های بعدی

:::cards
- [احراز هویت](/docs/cli/authentication): زمینه‌ای برای هر محیط، و این‌که یک دستور کدام کلید را به کار می‌برد.
- [عملیات روی منابع](/docs/cli/resource-operations): رکوردها را فهرست کنید، بخوانید، بسازید، تغییر دهید، حذف کنید و بشمارید.
- [قالب‌های خروجی](/docs/cli/output-formats): جدول برای آدم‌ها، JSON برای اسکریپت‌ها.
- [اسکریپت‌نویسی و CI/CD](/docs/cli/scripting): کدهای خروج، jq و خط لوله‌ها.
- [CLI برای عامل‌های هوش مصنوعی](/docs/cli/ai-agents): یک عامل کی CLI را اجرا می‌کند و کی از سرور MCP استفاده می‌کند.
- [مرجع دستورها](/docs/cli/command-reference): همهٔ دستورها، گزینه‌ها و مقادیر پیش‌فرض.
:::
