# جمع‌کننده OpenTelemetry میزبان (Linux، macOS، Windows)

## نمای کلی

می‌توانید **جمع‌کننده OpenTelemetry** را به‌صورت یک سرویس، مستقیم روی میزبان‌های Linux، macOS یا Windows خود اجرا کنید تا تله‌متری میزبان را روی OTLP به OneUptime بفرستد. این صفحه شما را در نصب جمع‌کننده، پیکربندی‌اش برای هر سیستم‌عامل و برگزیدن گیرنده‌های درست برای آنچه می‌خواهید جمع کنید همراهی می‌کند:

- **سنجه‌های میزبان** (‏CPU، حافظه، دیسک، سامانه فایل، شبکه، بار، فرایندها) روی هر سیستم‌عاملی
- **گزارش‌های مبتنی بر فایل** زیر `/var/log/**` (‏Linux، macOS) از راه [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **ژورنال systemd** (‏Linux) از راه [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **وضعیت واحدهای systemd** (به زبانه **Systemd Units** میزبان نیرو می‌دهد) از راه [`systemdreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/systemdreceiver) — از **v0.142.0** در ساخت بالادستی `otelcol-contrib` همراه شده و از **v0.143.0** به بعد قابل استفاده است (پایین‌تر «سرویس‌های Linux (واحدهای systemd)» را ببینید)
- **گزارش یکپارچه Apple** (‏macOS) از راه [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) که خروجی دنبال‌شده `log stream` را دربر می‌گیرد
- **گزارش‌های رویداد Windows** از راه [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **وضعیت سرویس‌های Windows** (به زبانه **Services** میزبان نیرو می‌دهد) از راه [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — از **v0.155.0** به بعد در ساخت بالادستی `otelcol-contrib` همراه شده (پایین‌تر «سرویس‌های Windows (سنجه‌ها)» را ببینید)

> **عامل زیرساخت OneUptime چطور؟** آن عامل دیمن Go جداگانه و سبکی است که بر سنجه‌های پایه و قابلیت _Server / VM Monitor_ (وضعیت، فرایندها، هشداردهی) متمرکز است. جمع‌کننده OpenTelemetry که اینجا شرح داده می‌شود مستقل است و وقتی گزارش می‌خواهید (گزارش‌های فایلی، journald، گزارش‌های رویداد Windows) یا سنجه‌های غنی‌تر میزبان که به‌صورت OTLP استاندارد دریافت شوند، ابزار درست همین است. هر دو می‌توانند بدون تداخل روی یک میزبان اجرا شوند.

## پیش‌نیازها

- یک **توکن دریافت تله‌متری OneUptime** — یکی را از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید و مقدار `x-oneuptime-token` را کپی کنید.
- توزیع **OpenTelemetry Collector Contrib** (`otelcol-contrib`). ساخت پیش‌فرض `otelcol` گیرنده‌هایی مانند `windowseventlogreceiver`، `journaldreceiver` یا افزوده‌های `hostmetrics` را دربر **نمی‌گیرد** — حتماً از توزیع `contrib` استفاده کنید. گیرنده آلفای `windowsservicereceiver` که به زبانه **Services** در Windows نیرو می‌دهد از **v0.155.0** به بعد در `otelcol-contrib` همراه است، و گیرنده آلفای `systemdreceiver` که به زبانه **Systemd Units** در Linux نیرو می‌دهد از **v0.143.0** به بعد؛ پس انتشاری جاری نصب کنید. پایین‌تر «سرویس‌های Windows (سنجه‌ها)» و «سرویس‌های Linux (واحدهای systemd)» را ببینید.
- دسترسی ریشه / مدیر روی میزبان، برای نصب جمع‌کننده به‌عنوان سرویس و (جایی که کاربرد دارد) خواندن منابع گزارشی ممتاز.

## گام ۱ — نصب جمع‌کننده OpenTelemetry

بخش مربوط به سیستم‌عامل خود را برگزینید. همه نمونه‌ها فرض می‌گیرند که تازه‌ترین انتشار `otelcol-contrib` را از [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) نصب می‌کنید.

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

بسته Debian باینری را در `/usr/bin/otelcol-contrib`، پیکربندی پیش‌فرض را در `/etc/otelcol-contrib/config.yaml` و واحد systemd را در `/etc/systemd/system/otelcol-contrib.service` نصب می‌کند.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

مسیرها با بسته Debian یکی‌اند (`/usr/bin/otelcol-contrib`، `/etc/otelcol-contrib/config.yaml`، واحد systemd به نام `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.156.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

فایل `/etc/otelcol-contrib/config.yaml` را در گام ۲ و یک plist برای `launchd` را در گام ۳ می‌سازید.

### Windows

روی Windows، انتشار بالادستی **`otelcol-contrib`** را دانلود کنید — گیرنده `windows_service` را که به زبانه **Services** میزبان نیرو می‌دهد همراه دارد (از **v0.155.0** به بعد).

**دارایی `contrib` را دانلود کنید، نه دارایی هسته را.** هر انتشاری دو بایگانی Windows منتشر می‌کند که نامشان در یک واژه فرق دارد، و برگزیدن نادرست رایج‌ترین راهی است که این نصب شکست می‌خورد:

| دارایی انتشار                                    | باز می‌شود به         | همین را استفاده کنم؟                                  |
| ------------------------------------------------ | --------------------- | ----------------------------------------------------- |
| `otelcol-contrib_<version>_windows_amd64.tar.gz` | `otelcol-contrib.exe` | **بله** — توزیع contrib                               |
| `otelcol_<version>_windows_amd64.tar.gz`         | `otelcol.exe`         | خیر — ساخت هسته، بدون گیرنده‌های Windows که پایین‌تر به کار می‌روند |

نام دارایی باید **با `otelcol-contrib_` آغاز شود**. ساخت هسته `otelcol_` هیچ گیرنده `windowseventlog` یا `windows_service`ای عرضه نمی‌کند، و تغییر نام `otelcol.exe` به `otelcol-contrib.exe` آن‌ها را نمی‌افزاید — فقط یک شکست راه‌اندازی را با شکستی دیگر عوض می‌کند ([رفع اشکال](#troubleshooting) را ببینید).

از یک خط فرمان **PowerShell با دسترسی مدیر**، این بلوک را یکجا اجرا کنید — هر خطی به متغیرهایی که بالایش تنظیم شده‌اند وابسته است:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$ARCH    = "amd64"                            # use "arm64" on ARM hosts
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"

# Note the "-contrib" in the asset name; otelcol_... is the wrong archive.
$url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_${ARCH}.tar.gz"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest -Uri $url -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+

Get-ChildItem $dest                            # expect otelcol-contrib.exe, not otelcol.exe
```

کل بلوک را اجرا کنید و خطی را از دلش بیرون نکشید: نشانی از `$VERSION` و `$ARCH` سرِ هم می‌شود، پس `Invoke-WebRequest`ای که تنها در نشستی تازه چسبانده شود با `-Uri` تهی شکست می‌خورد و چیزی دانلود نمی‌کند. ساختن نشانی در `$url` روی خطی جدا عمدی است — درج مستقیم نسخه در آرگومان `Invoke-WebRequest` به‌جایش متغیری تنظیم‌نشده را به یک ۴۰۴ خاموش تبدیل می‌کند.

این کار `otelcol-contrib.exe` را — **نه** `otelcol.exe` — در `C:\Program Files\otelcol-contrib` باز می‌کند؛ خط `Get-ChildItem` بالا تأیید می‌کند کدام را گرفته‌اید. فایل `config.yaml` را در گام ۲ در همان پوشه می‌سازید و در گام ۳ سرویسی در Windows ثبت می‌کنید.

> نصب‌کننده بومی را ترجیح می‌دهید؟ OpenTelemetry یک **`.msi`** امضاشده (`otelcol-contrib_<version>_windows_x64.msi`) را هم در همان [صفحه انتشارها](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) منتشر می‌کند که جمع‌کننده را به‌عنوان سرویس Windows برایتان ثبت می‌کند. اگر از آن استفاده می‌کنید، آن را به `config.yaml` گام ۲ نشانه بگیرید و مطمئن شوید سرویس به‌عنوان `LocalSystem` اجرا می‌شود تا زبانه **Services** بتواند Service Control Manager را بخواند.

## گام ۲ — پیکربندی جمع‌کننده

فایل پیکربندی اینجا زندگی می‌کند:

| سیستم‌عامل | مسیر                                                  |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

هر پیکربندی از یک شکل پیروی می‌کند — گیرنده‌هایی را که می‌خواهید برگزینید، پردازنده‌های `batch` و `resource` را بیفزایید، و روی OTLP HTTP به OneUptime صادر کنید. نمونه‌های پایین برای هر سیستم‌عامل یک پیکربندی کامل و کپی‌چسباندنی نشان می‌دهند، سپس هر بلوک گیرنده را مرور می‌کنند تا بتوانید ترکیبشان کنید.

مقدار `YOUR_TELEMETRY_INGESTION_TOKEN` و مقدار `service.name` را متناسب با محیط خود جایگزین کنید.

### تکه‌های مشترک (به کار رفته در هر سیستم‌عاملی)

```yaml
processors:
  batch:
    send_batch_size: 512
    timeout: 5s

  resource:
    attributes:
      - key: service.name
        value: host-telemetry
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

- **`batch`** رکوردها را پیش از صدور دسته می‌کند تا به ازای هر رکورد یک رفت‌وبرگشت HTTP نپردازید.
- **`resource`** هر رکوردی را با `service.name` مهر می‌زند. اگر می‌خواهید هر ماشین به‌صورت سرویس تله‌متری خودش در OneUptime پدیدار شود، به ازای هر میزبان مقدار متفاوتی به کار ببرید (مثلاً `prod-web-01`).
- **`otlphttp`** روی HTTPS با توکن دریافتِ پیوست‌شده به OneUptime می‌فرستد.

### سنجه‌های میزبان (Linux، macOS، Windows)

روی هر سیستم‌عاملی کار می‌کند. سنجه‌های CPU، حافظه، دیسک، سامانه فایل، شبکه، بار، صفحه‌بندی و فرایند را از هسته میزبان برمی‌دارد:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:
      process:
        mute_process_name_error: true
        mute_process_user_error: true
```

> روی Linux، جمع‌کننده `/proc` و `/sys` را می‌خواند. وقتی جمع‌کننده درون کانتینری اجرا می‌شود، `/proc` و `/sys` میزبان را سوار کنید و متغیرهای محیطی `HOST_PROC` / `HOST_SYS` را بگذارید. وقتی مستقیم به‌عنوان سرویس systemd اجرا می‌شود (همان‌طور که بالا نصب شد)، راه‌اندازی اضافه‌ای لازم نیست.

### گزارش‌های فایلی (Linux، macOS)

هر فایل گزارشی روی دیسک را دنبال کنید. پایین مجموعه شروع رایجی است:

```yaml
receivers:
  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
    start_at: end

  filelog/auth:
    include:
      - /var/log/auth.log
      - /var/log/secure
    start_at: end
```

مقدار `start_at: end` یعنی خط‌های تازه از لحظه‌ای که جمع‌کننده آغاز می‌شود؛ برای پر کردن گذشته در نخستین اجرا آن را به `beginning` تغییر دهید. جمع‌کننده جابه‌جایی فایل‌ها را دنبال می‌کند، پس در بازراه‌اندازی‌ها درست از سر می‌گیرد.

**تبدیل ردیابی‌های پشته گزارش‌های میزبان به Exceptions.** ‏OneUptime خودکار خط‌های گزارش error و fatal را برای یافتن ردیابی پشته می‌پوید و آن‌ها را در نمای **Exceptions** (‏Issues) جمع می‌کند، منسوب به همین میزبان — بدون هیچ پیکربندی اضافه‌ای. برای اینکه این گروه‌بندی خوب انجام شود، ردیابی پشته چندخطی (‏Java، Python، ‎.NET، Ruby) باید به‌صورت **یک** رکورد گزارش برسد، نه یک رکورد به ازای هر خط. بازترکیب چندخطی را روی گیرنده `filelog` فعال کنید تا ردیابی و فریم‌هایش کنار هم بمانند:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    multiline:
      # A new log entry starts with a timestamp; continuation lines (the
      # "at ...", "File ...", "Caused by: ..." frames) are folded into it.
      line_start_pattern: '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
```

بدون بازترکیب، هر فریمی به‌صورت گزارشی جدا دریافت می‌شود و استثنا به‌صورت مسئله‌ای تک‌خطی و بدگروه‌شده پدیدار می‌شود. اگر برنامه شما می‌تواند ویژگی‌های گزارش `exception.type` / `exception.message` / `exception.stacktrace` در OpenTelemetry را مستقیم منتشر کند، همان را بکنید — مطمئن‌ترین راه است و به تجزیه چندخطی وابسته نیست.

### ژورنال systemd (Linux)

اگر میزبان شما از systemd استفاده می‌کند، گیرنده `journald` اغلب از دنبال کردن `/var/log/*` مناسب‌تر است — همه‌چیز را در یک جا می‌گیرد و فیلدهای ساختارمند را نگه می‌دارد:

```yaml
receivers:
  journald:
    directory: /var/log/journal
    units:
      # Drop this list to ingest everything; restrict it to limit volume.
      - ssh.service
      - cron.service
      - nginx.service
    priority: info
```

باینری جمع‌کننده باید بتواند `journalctl` را اجرا کند (بسته‌های Debian / RPM آن را از پیش به‌عنوان وابستگی دربر دارند).

### سرویس‌های Linux (واحدهای systemd، سنجه‌ها)

زبانه **Systemd Units** میزبان از [`systemdreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/systemdreceiver) نیرو می‌گیرد (نوع پیکربندی `systemd`)، که وضعیت فعال واحدهای systemd را به‌صورت سنجه گزارش می‌دهد — همتای Linux زبانه **Services** روی Windows.

**این گیرنده نخستین بار در باینری بالادستی `otelcol-contrib` در v0.142.0 عرضه شد، و v0.143.0 نخستین انتشاری است که ارزش اجرا کردن دارد** — روی هر چیزی قدیمی‌تر، افزودن `systemd` هنگام راه‌اندازی با `'receivers' unknown type: "systemd"` شکست می‌خورد، و v0.142.0 به‌تنهایی سنجه CPU خود را `systemd.unit.cpu.time` نام می‌دهد و روی هر واحدی دنبال آمار cgroup می‌گردد، که برای هر واحد غیر `.service` خطای برداشت ثبت می‌کند. نسخه v0.143.0 نام آن سنجه را به `systemd.service.cpu.time` تغییر داد و آن جست‌وجو را به سرویس‌ها محدود کرد. انتشاری جاری نصب کنید (گام ۱)، سپس گیرنده را در `config.yaml` خود فعال کنید و به خط لوله سنجه‌ها بیفزاییدش:

```yaml
receivers:
  systemd:
    collection_interval: 30s
    # The service manager to read: "system" (default) or "user".
    scope: system
    # Which units to scrape, as systemctl unit patterns. The default is
    # every service; widen it to include timers, sockets or mounts, or
    # narrow it to cut volume on hosts with hundreds of units:
    units: ["*.service"]
    # units: [nginx.service, postgresql.service, "*.timer"]
    metrics:
      # Per-service CPU time is on by default and doubles this receiver's
      # datapoint count. The Systemd Units tab does not use it, so turn it
      # off unless you chart it. On v0.142.0 the key is
      # systemd.unit.cpu.time — naming a metric the running build does not
      # have stops the collector at startup.
      systemd.service.cpu.time:
        enabled: false

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, systemd]
      processors: [resourcedetection, batch]
```

گیرنده `systemd.unit.state` را به‌صورت **مجموعه وضعیت** منتشر می‌کند: در هر برداشتی هر واحدی به ازای هر وضعیت ممکن یک نقطه داده می‌گیرد (`active`، `reloading`، `inactive`، `failed`، `activating`، `deactivating`، `maintenance`، `refreshing`)، با مقدار `1` روی وضعیتی که واحد واقعاً در آن است و `0` روی بقیه. نام واحد به‌صورت ویژگی منبع `systemd.unit.name` و وضعیت به‌صورت ویژگی نقطه داده `systemd.unit.active_state` سفر می‌کند. چون نام واحد ویژگی _منبع_ است، **`resourcedetection` باید در خط لوله سنجه‌ها بماند** — همان است که `host.name` را روی منبع هر واحدی مهر می‌زند، و بدون آن نمونه‌ها هرگز به میزبانی نمی‌چسبند و زبانه خالی می‌ماند.

جمع‌کننده وضعیت واحدها را روی **D-Bus سیستم** می‌خواند، با همان فراخوان‌های فقط-خواندنی که `systemctl list-units` می‌کند. ‏systemd آن‌ها را بدون امتیاز ویژه اجازه می‌دهد، پس سرویس بسته‌بندی‌شده — که به‌عنوان کاربر `otelcol-contrib` اجرا می‌شود، نه ریشه — می‌تواند واحدها را بی‌هیچ امتیاز اضافه‌ای برداشت کند. آنچه واقعاً لازم دارد گذرگاهی دست‌یافتنی است: جمع‌کننده‌ای که درون کانتینری اجرا شود `/run/dbus/system_bus_socket` ندارد مگر سوکت میزبان را bind-mount کنید، و به همین دلیل این گیرنده برای نصب‌های بومی است. این گیرنده **آلفا** و **فقط Linux** است — روی macOS یا Windows ساخته نمی‌شود.

> **روی میزبان‌هایی با واحدهای فراوان مراقب حجم باشید.** مجموعه وضعیت به ازای هر واحد در هر برداشتی هشت نقطه داده منتشر می‌کند، و `systemd.service.cpu.time` که پیش‌فرض روشن است دو تای دیگر می‌افزاید (`user` و `system`)، پس ده تا را بودجه بگیرید. میزبانی که ۳۰۰ واحد را با فاصله ۳۰ ثانیه دنبال می‌کند تنها از همین گیرنده حدود ۶ هزار نقطه داده در دقیقه می‌دهد، یا حدود ۴٫۸ هزار با سنجه CPU خاموش‌شده مانند بالا. پیش از فعال کردنش در سراسر ناوگان، `units:` را به سرویس‌هایی که واقعاً روی آن‌ها هشدار می‌دهید تنگ کنید، یا `collection_interval` را بالا ببرید.

### گزارش یکپارچه Apple (macOS)

‏macOS فایل `/var/log/system.log` را به سود Apple Unified Log منسوخ کرد، که با `log show` / `log stream` پرس‌وجو می‌شود. ساده‌ترین راه دریافتش، جاری کردن خروجی `log` از راه گیرنده `filelog` با پوششی کوچک است. فایل `/usr/local/otelcol-contrib/log-stream.sh` را بسازید:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

اجراپذیرش کنید، زیر launchd اجرایش کنید (یا با `nohup` برای آزمونی سریع)، سپس جمع‌کننده را به فایل نشانه بگیرید:

```yaml
receivers:
  filelog/apple-unified:
    include:
      - /var/log/apple-unified.log
    start_at: end
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.timestamp
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
```

(اگر به گزارش یکپارچه نیاز ندارید، از این بگذرید — ناوگان‌های Mac اغلب فقط با سنجه‌های میزبان به‌علاوه چند گزارش فایلی خوب کار می‌کنند.)

### گزارش‌های رویداد Windows

از راه `wevtapi` بومی به کانال‌هایی که برایتان مهم‌اند مشترک شوید:

```yaml
receivers:
  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end
```

برای تنگ کردن کانال پرحجم `Security` به شناسه‌های رویداد مشخص:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

برای خواندن کانالی سفارشی یا ویژه یک برنامه (هر چیزی که زیر _Event Viewer → Applications and Services Logs_ می‌بینید)، از نام نمایشی دقیقش استفاده کنید:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### سرویس‌های Windows (سنجه‌ها)

زبانه **Services** میزبان از [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) نیرو می‌گیرد (نوع پیکربندی `windows_service`)، که وضعیت اجرا و نوع راه‌اندازی سرویس‌های Windows را به‌صورت سنجه گزارش می‌دهد.

**این گیرنده از v0.155.0 به بعد در باینری بالادستی `otelcol-contrib` عرضه می‌شود** — روی انتشارهای پیشین، افزودن `windows_service` هنگام راه‌اندازی با `'receivers' unknown type: "windows_service"` شکست می‌خورد. انتشاری جاری نصب کنید (گام ۱)، سپس آن را در `config.yaml` خود فعال کنید و به خط لوله سنجه‌ها بیفزاییدش:

```yaml
receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume — and avoid the
    # "access denied" noise from services the collector can't open —
    # list just the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]
    # Or collect everything except a few:
    # exclude_services: [TrustedInstaller]

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
```

گیرنده به ازای هر سرویسی یک سنجه لحظه‌ای `windows.service.status` منتشر می‌کند — عدد صحیح همان وضعیت سرویس Win32 است (`4` = در حال اجرا، `1` = متوقف) — با ویژگی‌های `name` و `startup_mode`. جمع‌کننده را به‌عنوان `LocalSystem` اجرا کنید (پیش‌فرض `sc.exe`) تا بتواند هر سرویسی را بخواند؛ هر کدام را نتواند باز کند رد می‌شود. این گیرنده **آلفا** و **فقط Windows** است؛ مسائل شناخته‌شده شامل خطای برداشتی است که می‌تواند جمع‌کننده را از کار بیندازد و یک `access denied` روی یک سرویس که بقیه را متأثر می‌کند — اگر به آن‌ها خوردید به `include_services` محدود کنید.

> **‏`include_services` اثری ندارد؟** پالایه فقط می‌تواند مجموعه را *تنگ* کند، پس اگر سرویس‌هایی را فهرست کرده‌اید و هنوز همه را می‌بینید، تقریباً بی‌شک پیکربندی ویرایش‌شده به جمع‌کننده در حال اجرا نرسیده است. پس از ویرایش، سرویس را بازراه‌اندازی کنید (گام ۳)؛ مطمئن شوید `include_services` فهرستی پرشده در همان تورفتگی `collection_interval` است (نه رها شده به‌صورت توضیح یا خالی)؛ و به زبانه **Services** چند دقیقه فرصت دهید تا سرویس‌هایی که پیش از تغییر گزارش شده بودند از پنجره غلتانش کهنه شوند. نام‌ها دقیق و حساس به بزرگی و کوچکی حروف‌اند و نام _کلید_ سرویس در Windows‌اند (مثلاً `Spooler`، `W3SVC`)، که می‌توانید با `Get-Service | Select-Object Name` فهرستشان کنید.

### نمونه کامل — میزبان Linux

فایل `/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
      - /var/log/auth.log
    start_at: end

  journald:
    directory: /var/log/journal
    priority: info

  # Powers the Systemd Units tab (otelcol-contrib v0.143.0+).
  systemd:
    collection_interval: 30s
    units: ["*.service"]

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, systemd]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
```

### نمونه کامل — میزبان macOS

فایل `/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
  resource:
    attributes:
      - key: service.name
        value: macos-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
```

### نمونه کامل — میزبان Windows

فایل `C:\Program Files\otelcol-contrib\config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      # On Windows the 'load' scraper only emulates an average from the
      # Processor Queue Length counter (it starts at 0) — omitted here.
      paging:
      processes:

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  # Powers the Services tab (otelcol-contrib v0.155.0+).
  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
  resource:
    attributes:
      - key: service.name
        value: windows-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
```

## گام ۳ — اجرای جمع‌کننده به‌عنوان سرویس

### Linux (systemd)

بسته‌های Debian / RPM از پیش واحد systemd را نصب می‌کنند. فقط فعال و آغازش کنید:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

برای دنبال کردن گزارش‌های خودِ جمع‌کننده:

```bash
sudo journalctl -u otelcol-contrib -f
```

واحد بسته‌بندی‌شده جمع‌کننده را به‌عنوان کاربر بی‌امتیاز `otelcol-contrib` اجرا می‌کند. برای گیرنده `systemd` همین بس است — فقط همان فراخوان‌های فقط-خواندنی D-Bus را می‌کند که systemd از پیش به هر کاربری اجازه می‌دهد، همان‌هایی که `systemctl list-units` به کار می‌برد.

### macOS (launchd)

فایل `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` را بسازید:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>
```

بارگذاری‌اش کنید:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

از یک خط فرمان **PowerShell با دسترسی مدیر**:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

سرویس به‌طور پیش‌فرض زیر `LocalSystem` اجرا می‌شود، که امتیازهای لازم برای خواندن کانال `Security` در گزارش رویداد Windows و هر سرویس Windows را دارد.

## گام ۴ — راستی‌آزمایی در OneUptime

1. روی میزبان کمی سیگنال تولید کنید:
   - **Linux / macOS:** ‏`logger "hello from oneuptime"` (در syslog / journald می‌نویسد).
   - **Windows:** ‏`eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` از خط فرمانی با دسترسی مدیر.
2. در داشبورد OneUptime، مسیر **Products → Services** را باز کنید و `service.name`ای را که پیکربندی کرده‌اید برگزینید.
3. بخش **Metrics** را باز کنید — سنجه‌های میزبان (‏CPU، حافظه، سامانه فایل و جز آن) باید ظرف یک دقیقه پدیدار شوند.
4. بخش **Logs** را باز کنید — گزارش‌های فایلی / مدخل‌های journald / گزارش‌های رویداد Windows شما باید در حال جاری شدن باشند. ویژگی‌های جست‌وجوپذیر مفید شامل `log.file.name`، `systemd.unit`، `winlog.channel`، `winlog.event_id` و `winlog.provider.name` است.
5. اگر گیرنده `systemd` (‏Linux) یا `windows_service` (‏Windows) را فعال کرده‌اید، مسیر **Infrastructure → Hosts** را باز کنید، میزبان را برگزینید و زبانه **Systemd Units** / **Services** را بررسی کنید — هر واحد برداشت‌شده‌ای باید با وضعیت جاری‌اش فهرست شده باشد.

## کاهش حجم داده جمع‌آوری‌شده

چون پیکربندی جمع‌کننده از آنِ خودتان است، شما دقیقاً تصمیم می‌گیرید چه چیزی میزبان را ترک کند — چیزی جمع نمی‌شود مگر گیرنده‌ای که افزوده‌اید بخواهدش. اگر میزبانی بیش از آنچه می‌خواهید می‌فرستد (که به‌صورت حجم دریافت بالاتر و، روی OneUptime Cloud، هزینه بالاتر نمایان می‌شود)، همین‌جا تنظیمش کنید. دو اهرم بزرگ‌تر **اینکه چه منابع گزارشی را دنبال می‌کنید** و **اینکه هر چند وقت یک بار سنجه‌ها را برمی‌دارید** هستند؛ پردازنده `filter` بقیه را رسیدگی می‌کند.

اصل کار همان اصل خودِ پیکربندی است: **فقط گیرنده‌هایی را بیفزایید که به داده‌شان نگاه خواهید کرد**، سپس درونشان هرس کنید. هر تغییری در پایین ویرایشی در `config.yaml` است — اعمالش کنید و جمع‌کننده را بازراه‌اندازی کنید (گام ۳).

### حجم از کجا می‌آید

| سیگنال                 | بزرگ‌ترین عامل                                       | با این کمش کنید                                                      |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| **گزارش‌ها**               | هر خطی از هر فایل / واحد journald / کانال | تنگ کردن گیرنده‌ها؛ پالایه‌های `query:`؛ پردازنده `filter` روی شدت |
| **سنجه‌های میزبان**       | فراوانی برداشت × شمار سری‌ها                 | `collection_interval`؛ انداختن برداشت‌گر `process`؛ گزینش برداشت‌گرها |
| **کاردینالیتی سنجه** | سنجه‌های به‌ازای-فرایند (یک مجموعه سری به ازای هر فرایند)     | حذف یا محدود کردن برداشت‌گر `process`                                  |
| **واحدهای systemd**      | ۱۰ نقطه داده به ازای هر واحد در هر برداشت (مجموعه وضعیت + CPU)  | تنگ کردن `units:`؛ خاموش کردن سنجه CPU؛ بالا بردن `collection_interval` |

### اهرم ۱ — فقط منابع گزارشی را که لازم دارید دنبال کنید

گزارش‌ها تقریباً همیشه بزرگ‌ترین برش‌اند. جمع‌کننده فقط آنچه را فهرست می‌کنید می‌خواند، پس راه‌حل فهرست کردن کمتر است:

- **فایل‌ها** — گیرنده `filelog` را به مسیرهای مشخص نشانه بگیرید، نه به glob‌های فراخ. ‏`/var/log/myapp/error.log` به‌جای `/var/log/**`.
- **journald** — مقدار `units:` را به سرویس‌هایی که برایتان مهم‌اند محدود کنید و `priority:` را بالا ببرید تا مدخل‌های پرحرف `info`/`debug` را در همان سرچشمه بیندازید:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **گزارش‌های رویداد Windows** — کانال `Security` با اختلاف پرحجم‌ترین است. آن را با یک `query:` به شناسه‌های رویدادی که واقعاً ممیزی می‌کنید تنگ کنید (همان‌طور که بالا در [گزارش‌های رویداد Windows](#windows-event-logs) نشان داده شد)، یا اگر لازمش ندارید کانال را یکسره بیندازید.

### اهرم ۲ — فاصله سنجه‌ها را کند کنید

حجم `hostmetrics` مستقیم با `collection_interval` مقیاس می‌گیرد. اگر به تفکیک‌پذیری ۳۰ ثانیه‌ای نیاز ندارید، ۶۰ ثانیه شمار نقاط داده را نصف می‌کند:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### اهرم ۳ — برداشت‌گر به‌ازای-فرایند را بیندازید (عامل کاردینالیتی)

برداشت‌گر `process` **به ازای هر فرایند در حال اجرا** روی میزبان مجموعه سری جداگانه‌ای منتشر می‌کند — روی ماشینی شلوغ این بزرگ‌ترین منبع تکی کاردینالیتی سنجه است. مگر به CPU/حافظه به‌ازای-فرایند نیاز داشته باشید، از فهرست `scrapers:` بیرونش بگذارید. مقدار `processes` را نگه دارید (که فقط مشتی سنجه شمارش فرایند تجمیعی است) — ارزان است. اگر واقعاً سنجه‌های به‌ازای-فرایند می‌خواهید، آن‌ها را به فرایندهایی که اهمیت دارند محدود کنید:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes: # aggregate counts only — cheap
      # 'process:' (per-process series) intentionally omitted.
      # If you need it, scope it instead of collecting every process:
      # process:
      #   mute_process_name_error: true
      #   mute_process_user_error: true
      #   include:
      #     names: [nginx, postgres, node]
      #     match_type: strict
```

### اهرم ۴ — مجموعه واحدهای systemd را تنگ کنید

گیرنده `systemd` در هر برداشتی **به ازای هر وضعیت در هر واحد** یک نقطه داده منتشر می‌کند — هشت به ازای هر واحد — به‌علاوه دو تای دیگر برای `systemd.service.cpu.time` که پیش‌فرض روشن است، پس حجمش را این تعیین می‌کند که `units:` با چند واحد می‌خواند. پیش‌فرض `["*.service"]` هر سرویسی روی میزبان را برمی‌دارد، از جمله ده‌ها واحد یک‌باره‌ای که هرگز وضعیتشان تغییر نمی‌کند. واحدهایی را که واقعاً روی آن‌ها هشدار می‌دهید فهرست کنید، و سنجه CPU را — مگر ترسیمش کنید — خاموش کنید:

```yaml
receivers:
  systemd:
    collection_interval: 60s
    units: [nginx.service, postgresql.service, ssh.service]
    metrics:
      # On otelcol-contrib v0.142.0 this key is systemd.unit.cpu.time.
      systemd.service.cpu.time:
        enabled: false
```

این‌ها با هم میزبانی ۳۰۰ واحدی را از حدود ۶ هزار نقطه داده در دقیقه به خیلی زیر ۱۰۰ می‌رسانند. واحدهایی که از فهرست انداخته شوند چند دقیقه بعد، وقتی آخرین نمونه‌هایشان از پنجره غلتان کهنه شود، دیگر روی زبانه **Systemd Units** پدیدار نمی‌شوند.

### اهرم ۵ — رکوردهای کم‌ارزش را با پردازنده `filter` بیندازید

وقتی گیرنده را می‌خواهید اما نه همه خروجی‌اش را، پردازنده [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) را بیفزایید — شرطی از جنس [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) را می‌سنجد و **هر رکوردی را که بخواند می‌اندازد**، پیش از آنکه چیزی صادر شود.

انداختن گزارش‌های زیر آستانه‌ای از شدت:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        # The UNSPECIFIED guard is required — see the warning below.
        - "severity_number != SEVERITY_NUMBER_UNSPECIFIED and severity_number < SEVERITY_NUMBER_WARN"
```

> **نگهبان `UNSPECIFIED` را نیندازید.** مقدار `SEVERITY_NUMBER_UNSPECIFIED` برابر `0` و `SEVERITY_NUMBER_WARN` برابر `13` است، پس یک `severity_number < SEVERITY_NUMBER_WARN` برهنه یعنی `0 < 13` — که **برای هر رکوردی که شدتش هرگز تجزیه نشده درست است**. گیرنده `filelog` ساده شدت را از خط گزارش تجزیه نمی‌کند: هیچ‌کدام از نمونه‌های `filelog` این صفحه `operators:` نمی‌گذارند، پس آن رکوردها با `severity_number: 0` به پالایه می‌رسند. بدون نگهبان، آن شرط **۱۰۰٪** محتوای `/var/log/syslog`، `/var/log/messages` و `/var/log/auth.log` را خاموشانه حذف می‌کند — بی‌هیچ خطایی، هیچ‌جا. با نگهبان، رکوردهای رده‌بندی‌نشده نگه داشته می‌شوند و می‌بینید که با شدت `Unspecified` به OneUptime می‌رسند، که به شما می‌گوید آنچه واقعاً لازم دارید تجزیه‌گر شدت است.

برای پالایش *درستِ* گزارش‌های فایلی بر پایه شدت، نخست با عملگر [`severity_parser`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/severity_parser.md) روی گیرنده شدتی را تجزیه کنید تا رکوردها پیش از رسیدن به پالایه سطحی واقعی حمل کنند:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    operators:
      # Pull a level out of lines like "2026-01-01 ERROR something broke".
      - type: regex_parser
        regex: '(?i)(?P<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)'
        parse_from: body
        # Lines with no recognisable level fall through unparsed rather
        # than being discarded, and are then kept by the guard above.
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        preset: default
        mapping:
          warn: warning
          error: err
          fatal: panic
```

روی میزبان‌های systemd به هیچ‌کدام از این‌ها نیاز ندارید — `priority:` در `journald` (اهرم ۱) در خودِ `journalctl` بر پایه سطح پالایش می‌کند، پیش از آنکه رکورد OTelای وجود داشته باشد.

انداختن سنجه‌هایی که ترسیمشان نمی‌کنید — با نام دقیق، یا با الگویی:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        # Exact metric name.
        - 'name == "system.paging.faults"'
        # Or a whole family. IsMatch is RE2 and UNANCHORED, so anchor it
        # yourself with ^ when you mean "starts with".
        - 'IsMatch(name, "^system\\.paging\\.")'
```

برای فرستادن **فقط** مجموعه‌ای ثابت از سنجه‌ها (یک فهرست مجاز) شرط را وارونه کنید — `filter` آنچه را می‌خواند می‌اندازد، پس `not (...)` هر چیزی را که نام نبرده‌اید می‌اندازد:

```yaml
processors:
  filter/allowlist:
    error_mode: ignore
    metrics:
      metric:
        - 'not (name == "system.cpu.utilization" or name == "system.memory.utilization" or name == "system.filesystem.utilization")'
```

آن شرط را روی **یک خط** نگه دارید. فهرست مجاز پتک بزرگی است: هر چیزی که نام بردنش را فراموش کنید رفته است، همراه با مانیتورهایی که رویش ساخته شده‌اند. ترجیحاً همان چند سنجه‌ای را که نمی‌خواهید بیندازید، یا صرفاً برداشت‌گری را که تولیدشان می‌کند حذف کنید (اهرم ۳) — سنجه‌ای که هرگز جمع نشود، پالایشش هیچ هزینه‌ای ندارد.

سپس پردازنده را به خط لوله مربوط بیفزایید — ترتیب مهم است، پس `filter` را پیش از `batch` بگذارید:

```yaml
service:
  pipelines:
    logs:
      receivers: [journald]
      processors: [filter/drop-low-severity, resource, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [hostmetrics]
      processors: [filter/drop-metrics, resource, batch]
      exporters: [otlphttp]
```

> **پیکربندی‌ای را که OneUptime برایتان تولید کرده ویرایش می‌کنید؟** خط لوله بالا با نمونه‌های کامل این صفحه می‌خواند. پیکربندی داشبورد (‏Hosts → Documentation) چیزها را جور دیگری نام می‌برد: پردازنده‌هایش `resourcedetection` و `batch` هستند (هیچ پردازنده `resource`ای **نیست**) و صادرکننده‌اش `otlphttp/oneuptime` است. ارجاع به پردازنده‌ای که تعریف نشده، جمع‌کننده را هنگام راه‌اندازی با `references processor "resource" which is not configured` متوقف می‌کند. پالایه را به آنچه از پیش هست بیفزایید، به‌جای اینکه این بلوک را رویش بچسبانید:
>
> ```yaml
> service:
>   pipelines:
>     metrics:
>       receivers: [hostmetrics]
>       processors: [filter/drop-metrics, resourcedetection, batch]
>       exporters: [otlphttp/oneuptime]
> ```
>
> ‏`resourcedetection` را نگه دارید — OneUptime تله‌متری را با `host.name` / `host.id`ای که آن تنظیم می‌کند به میزبان تطبیق می‌دهد. آن پیکربندی تولیدشده همچنین **فقط سنجه** است: تا وقتی خودتان نیفزایید خط لوله `logs:` ندارد، پس `filter/drop-low-severity` تا وقتی گیرنده‌ای `filelog` یا `journald` کنارش نیفزایید چیزی برای پالایش ندارد.

> **روی macOS از تاربال استفاده کنید، نه Homebrew.** فرمول Homebrew جمع‌کننده **هسته** را عرضه می‌کند، و `filter` پردازنده‌ای فقط-contrib است — جمع‌کننده صرف‌نظر از اینکه YAML شما درست باشد یا نه، از آغاز شدن سر باز می‌زند.

### نقطه شروعی لاغر

میزبانی **فقط-سنجه** — بدون گزارش، با فاصله درشت، بدون سری‌های به‌ازای-فرایند — کوچک‌ترین ردپای مفید است:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
```

وقتی لازمش داشتید، خط لوله `logs` را با گیرنده‌ای `filelog` یا `journald` با دامنه‌ای تنگ برگردانید.

> **مراقب باشید چه می‌برید.** هشدارهای مبتنی بر گزارش به رسیدن گزارش‌ها نیاز دارند: اگر شدتی یا کانالی را پالایه کنید، مانیتورهایی که بر آن کلید می‌خورند ساکت می‌شوند. منابعی را هرس کنید که بر پایه‌شان کاری نمی‌کنید، نه آن‌هایی را که مانیتوری تماشایشان می‌کند. هر بار یک اهرم را تغییر دهید و پیش از رفتن به بعدی، افت را زیر **Project Settings → Usage History** تأیید کنید (مصرف روزانه تجمیع می‌شود، پس یکی دو روز فرصت دهید).

## ‏OneUptime خودمیزبان

اگر OneUptime را خودمیزبانی می‌کنید، صادرکننده را به میزبان خودتان نشانه بگیرید:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

اگر نمونه شما فقط HTTP است، طرح را به `http://` تغییر دهید و از درگاه مناسب استفاده کنید.

## پشت پروکسی

جمع‌کننده OpenTelemetry متغیرهای محیطی استاندارد `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` را رعایت می‌کند. آن‌ها را روی سرویس بگذارید:

- **‏systemd (‏Linux):** فایلی به‌صورت drop-in در `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` با محتوای `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"` بگذارید، سپس `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **‏launchd (‏macOS):** دیکشنری `<EnvironmentVariables>` را به plist بیفزایید.
- **سرویس Windows:** متغیرهای محیطی را از راه `sc.exe config` یا رجیستری زیر `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment` روی سرویس بگذارید.

## رفع اشکال

- **هیچ تله‌متری‌ای در OneUptime پدیدار نمی‌شود**
  - برای خروجی پرحرف، `service.telemetry.logs.level: debug` را به پیکربندی بیفزایید و جمع‌کننده را بازراه‌اندازی کنید.
  - **Linux / macOS:** ‏`journalctl -u otelcol-contrib -f` (‏Linux) یا `tail -f /var/log/otelcol-contrib.err.log` (‏macOS).
  - **Windows:** زیر _Event Viewer → Windows Logs → Application_ دنبال منبع `otelcol-contrib` بگردید.
  - تأیید کنید میزبان می‌تواند به `https://oneuptime.com/otlp` (یا نقطه پایانی خودمیزبان شما) برسد: از همان ماشین `curl -v https://oneuptime.com/otlp` را اجرا کنید.
- **‏HTTP 401 از صادرکننده** — توکن دریافت نامعتبر یا باطل‌شده است. یکی تازه از _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید.
- **کانال `Security` در گزارش رویداد Windows دسترسیِ ردشده برمی‌گرداند** — سرویس با امتیازهای کافی اجرا نمی‌شود. آن را زیر `LocalSystem` (پیش‌فرض `sc.exe create`) دوباره بسازید یا به حساب سرویس حق کاربری _Manage auditing and security log_ را بدهید.
- **سرویس Windows با `Error 2: The system cannot find the file specified` آغاز نمی‌شود** — ‏Service Control Manager نمی‌تواند فایل اجرایی‌ای را که سرویس در برابرش ثبت شده پیدا کند. فرمان `sc.exe qc "otelcol-contrib"` را اجرا کنید و `BINARY_PATH_NAME` را با آنچه واقعاً در `C:\Program Files\otelcol-contrib` هست بسنجید. تقریباً همیشه بایگانی هسته `otelcol_<version>_windows_amd64.tar.gz` دانلود شده است — که `otelcol.exe` را باز می‌کند — در حالی که گام ۳ سرویس را در برابر `otelcol-contrib.exe` ثبت می‌کند، که فقط بایگانی `otelcol-contrib_<version>_...` آن را دربر دارد. دارایی `contrib` را از گام ۱ دوباره دانلود کنید؛ نام `otelcol.exe` را عوض **نکنید**، که به‌جایش همان `1064` پایین را تولید می‌کند. علت دیگر `binPath=` بدون نقل‌قول است: مسیری که از `C:\Program Files` می‌گذرد روی فاصله می‌شکند مگر دقیقاً همان‌طور که گام ۳ نشان می‌دهد نقل‌قول شود.
- **سرویس Windows با `Error 1064: An exception occurred in the service when handling the control request` آغاز نمی‌شود** — ‏SCM باینری را راه انداخت، اما جمع‌کننده هنگام راه‌اندازی بیرون رفت. تغییر نام `otelcol.exe` به `otelcol-contrib.exe` مسیر را قابل تحلیل می‌کند بی‌آنکه آنچه درون باینری است عوض شود: ساخت هسته گیرنده `windowseventlog` یا `windows_service` ندارد، پس پیکربندی گام ۲ را رد می‌کند و پیش از آنکه سرویس اصلاً در حال اجرا گزارش شود می‌میرد. مسیر `--config` بدون نقل‌قول همان `1064` را حتی با باینری درست می‌دهد: بدون نقل‌قول‌های درونی، آرگومان روی فاصله `Program Files` می‌شکند و جمع‌کننده به‌خاطر فایل پیکربندی‌ای که نمی‌تواند بخواند بیرون می‌رود. بررسی کنید واقعاً چه دارید:
  - `otelcol-contrib.exe --version` باید `otelcol-contrib version ...` چاپ کند. اگر `otelcol version ...` چاپ کرد، ساخت هسته با نام عوض‌شده است — دارایی `contrib` را از گام ۱ دوباره دانلود کنید.
  - `otelcol-contrib.exe components` باید `windowseventlog` و `windows_service` را میان گیرنده‌ها فهرست کند. با `hostmetrics` نیازمایید — ساخت هسته آن یکی را هم عرضه می‌کند، پس دیدنش چیزی را ثابت نمی‌کند. هر چیزی که پیکربندی به آن ارجاع می‌دهد و این فرمان فهرستش نمی‌کند، جمع‌کننده را هنگام راه‌اندازی متوقف می‌کند.
  - به‌جای `1064` عمومی، آن را در پیش‌زمینه اجرا کنید تا خطای واقعی را ببینید: `& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" --config="C:\Program Files\otelcol-contrib\config.yaml"`.
  - مسیر _Event Viewer → Windows Logs → Application_ را برای منبع `otelcol-contrib` بررسی کنید، که خطای راه‌اندازیِ بلعیده‌شده به دست SCM را ثبت می‌کند.
- **گیرنده `journald` آغاز نمی‌شود** — مطمئن شوید `journalctl` روی `PATH` جمع‌کننده هست و `/var/log/journal` وجود دارد (اگر نه، `sudo systemd-tmpfiles --create --prefix /var/log/journal` را اجرا کنید).
- **گیرنده `systemd` خطای اتصال D-Bus گزارش می‌دهد** — جمع‌کننده نمی‌تواند به گذرگاه سیستم برسد. تأیید کنید `/run/dbus/system_bus_socket` وجود دارد و کاربر جمع‌کننده می‌تواند بازش کند؛ اجرای `systemctl list-units` با آن کاربر سریع‌ترین بررسی است. ریشه بودن لازم نیست. جمع‌کننده‌ای که درون کانتینری اجرا شود اصلاً گذرگاهی نمی‌بیند مگر سوکت میزبان را bind-mount کنید، پس برای این گیرنده نصب بومی را ترجیح دهید.
- **گیرنده `systemd` به ازای هر واحدی خطای برداشت ثبت می‌کند، یا جمع‌کننده به‌خاطر سنجه‌ای ناشناخته از آغاز شدن سر باز می‌زند** — هر دو کج‌شدگی نسخه‌اند. نسخه v0.142.0 روی هر واحدی دنبال آمار cgroup می‌گردد (به ازای هر واحد غیر `.service` در هر برداشتی یک خطا) و سنجه CPU خود را `systemd.unit.cpu.time` می‌نامد؛ v0.143.0 و بالاتر آن جست‌وجو را به سرویس‌ها محدود کردند و نام سنجه را به `systemd.service.cpu.time` تغییر دادند. به v0.143.0 یا بالاتر ارتقا دهید، و مطمئن شوید هر بازنویسی `metrics:` کلیدی را نام می‌برد که ساخت شما واقعاً دارد.
- **زبانه Systemd Units خالی است هرچند گیرنده در حال اجراست** — بررسی کنید `resourcedetection` در همان خط لوله سنجه‌ها باشد. گیرنده فقط `systemd.unit.name` را به منبع هر واحدی می‌چسباند، پس بدون `resourcedetection` هیچ `host.name`ای نیست و نمونه‌ها هرگز به میزبانی نمی‌چسبند.
- **حجم / هزینه بالا** — بخش [کاهش حجم داده جمع‌آوری‌شده](#reducing-the-volume-of-data-collected) را ببینید: گیرنده‌ها را تنگ کنید (کانال‌های مشخص Windows، واحدهای systemd، فایل‌های گزارشی)، `collection_interval` سنجه‌ها را بالا ببرید، برداشت‌گر به‌ازای-فرایند را بیندازید، یا پردازنده‌ای `filter` بیفزایید تا رکوردهای کم‌شدت را پیش از صدور بیندازد.

## گام‌های بعدی

- **Logs Monitors** بیفزایید تا روی الگوهای گزارشی مشخص هشدار بدهند (برای نمونه، وقتی بیش از ۵ ورود ناموفق با `winlog.event_id = 4625` در پنجره‌ای ۵ دقیقه‌ای رخ دهد هشدار بدهد).
- **Metrics Monitors** روی سنجه‌های میزبان بیفزایید (اشباع CPU، فضای کم دیسک، مصرف swap).
- برای دید سرتاسری میزبان، این را با [مانیتور Server / VM](/docs/monitor/server-monitor) و [عامل زیرساخت OneUptime](/docs/monitor/server-monitor) ترکیب کنید.
- همین پیکربندی را از راه Ansible / Chef / Puppet / Group Policy / Intune / ابزار مدیریت پیکربندی موجودتان به هر میزبانی بفرستید.
