# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) یک عامل سبک است که لاگ‌ها را از فایل‌ها، systemd، کانتینرها، syslog، HTTP و بسیاری منبع دیگر جمع‌آوری می‌کند. [خروجی OpenTelemetry](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) آن، هر آنچه جمع می‌کند را به نقطهٔ پایانی OpenTelemetry (OTLP) در OneUptime می‌فرستد و لاگ‌ها در **محصولات ← لاگ‌ها** قابل جستجو می‌شوند.

:::cards
- [پیکربندی Fluent Bit](#پیکربندی-fluent-bit): خروجی OpenTelemetry را اضافه کنید و برای سرویس‌تان نام بگذارید.
- [نمونهٔ کامل](#نمونهٔ-کامل): یک فایل پیکربندی کامل برای شروع.
- [OneUptime با میزبانی شخصی](#oneuptime-با-میزبانی-شخصی): Fluent Bit را به سمت نمونهٔ خودتان بفرستید.
:::

## چگونه کار می‌کند

```mermaid title="از Fluent Bit تا OneUptime"
flowchart TB
    sources["فایل‌ها، کانتینرها، syslog، HTTP"] --> inputs["ورودی‌های Fluent Bit"]
    inputs --> envelope["پردازشگر opentelemetry_envelope"]
    envelope --> name["content_modifier مقدار service.name را تنظیم می‌کند"]
    name --> output["خروجی opentelemetry"]
    output -->|"OTLP/HTTP + کلید دریافت داده"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["لاگ‌ها"]
```

Fluent Bit هر رکورد را در یک پاکت OpenTelemetry می‌پیچد تا بتواند attributeهای منبع مانند `service.name` را با خود ببرد. سپس خروجی OpenTelemetry رکوردها را با کلید دریافت داده‌تان در سرآیند `x-oneuptime-token` به OneUptime می‌فرستد. OneUptime آن‌ها را زیر سرویسی که `service.name` نام می‌برد ثبت می‌کند و نخستین باری که داده‌ای برسد آن سرویس را می‌سازد.

## پیش از شروع

- **نصب Fluent Bit**: [راهنمای نصب](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit) را ببینید. پیکربندی این صفحه از قالب YAML در Fluent Bit و پردازشگر `opentelemetry_envelope` استفاده می‌کند، پس از یک نسخهٔ به‌روز استفاده کنید.
- **یک پروژهٔ OneUptime.** در OneUptime Cloud هزینهٔ تله‌متری بر پایهٔ هر گیگابایت دریافت‌شده محاسبه می‌شود ([قیمت‌ها](https://oneuptime.com/pricing) را ببینید)، و پروژه‌ای که روی پلن Free است پیش از ارسال تله‌متری به یک روش پرداخت نیاز دارد.
- **یک کلید دریافت دادهٔ تله‌متری.** اگر ندارید:

:::steps
### کلیدهای دریافت داده را باز کنید

به **محصولات ← تنظیمات پروژه** بروید، در منوی کناری **تله‌متری و APM** را باز کنید و **کلیدهای دریافت داده** را برگزینید.

![فهرست «کلیدهای دریافت داده»، با «ساخت کلید دریافت داده» که دورش خط کشیده شده](screen:ingestion-keys)

### یک کلید بسازید

روی **ساخت کلید دریافت داده** کلیک کنید. در پنجره، نام کلید از پیش پر شده و **سرور** انتخاب شده است، یعنی همان نوع کلیدی که برنامه‌ها و Collectorها با آن داده می‌فرستند؛ پس برای ساختن کلید روی **ساخت کلید دریافت داده** کلیک کنید، یا پیش از آن نامش را تغییر دهید.

### کلید محرمانه را کپی کنید

کلید تازه در صفحهٔ خودش باز می‌شود. **کلید محرمانه** آن را کپی کنید: این همان `YOUR_TELEMETRY_INGESTION_TOKEN` در پیکربندی زیر است.

![صفحهٔ یک کلید دریافت دادهٔ تله‌متری که کلید محرمانه‌اش را نشان می‌دهد](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## پیکربندی Fluent Bit

Fluent Bit پیکربندی YAML خود را از فایلی مانند `/etc/fluent-bit/fluent-bit.yaml` می‌خواند.

:::steps
### خروجی OpenTelemetry را اضافه کنید

یک خروجی `opentelemetry` اضافه کنید که به OneUptime بفرستد. اگر می‌خواهید رکوردها را به‌صورت محلی ببینید، هنگام آزمایش خروجی `stdout` را نگه دارید:

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` وقتی OneUptime شلوغ است (`429`) یا دارد دوباره راه‌اندازی می‌شود (`502`، `503`، `504`)، یک تکه را تقریباً هر ۳۰ ثانیه (`scheduler.base` و `scheduler.cap`) و تا حدود ۷۲ ساعت دوباره می‌فرستد؛ پیش‌فرض Fluent Bit این است که یک بار دیگر تلاش کند و سپس آن را دور بیندازد. `storage.path` تکه‌هایی را که هنوز باید فرستاده شوند روی دیسک نگه می‌دارد، تا راه‌اندازی دوبارهٔ Fluent Bit هیچ‌کدام را از دست ندهد، برای هر ورودی با `storage.type: filesystem`، مانند گام بعد. Fluent Bit باید بتواند در آن پوشه بنویسد: سرویس بسته با کاربر root اجرا می‌شود، و برای اجرای دستی آن را با `sudo` اجرا کنید. `storage.total_limit_size: 512M` برای خروجی حداکثر ۵۱۲ مگابایت نگه می‌دارد؛ وقتی پر شود، قدیمی‌ترین تکه‌ها دور انداخته می‌شوند.

### لاگ‌ها را در یک پاکت OpenTelemetry بپیچید و برای سرویس نام بگذارید

به هر ورودی پردازشگر `opentelemetry_envelope` را اضافه کنید و پس از آن یک `content_modifier` بگذارید که `service.name` را تنظیم کند. به‌جای `YOUR_SERVICE_NAME` نامی را بنویسید که لاگ‌ها باید در OneUptime با آن نمایش داده شوند:

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` جای tail را در هر فایل نگه می‌دارد، تا راه‌اندازی دوباره از همان‌جا ادامه دهد؛ بدون آن، Fluent Bit دوباره از انتهای هر فایل شروع می‌کند و خط‌هایی که در زمان خاموش بودنش نوشته شده‌اند هرگز فرستاده نمی‌شوند. `storage.type: filesystem` تکه‌های ورودی را در `storage.path` نگه می‌دارد.

### Fluent Bit را دوباره راه‌اندازی کنید

سرویس بستهٔ `fluent-bit` فایل `/etc/fluent-bit/fluent-bit.conf` را می‌خواند که نمونهٔ خود بسته است، نه این فایل را. با یک drop-in آن را به `/etc/fluent-bit/fluent-bit.yaml` ببرید، سپس آن را همین حالا و در هر راه‌اندازی سیستم اجرا کنید:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

`ExecStart=` خالی خط اجرای خود بسته را پاک می‌کند. برای اینکه فایل را اول در پیش‌زمینه امتحان کنید، `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml` را اجرا کنید: بسته برنامه را در `/opt/fluent-bit/bin` می‌گذارد که در `PATH` نیست. در چند ثانیه لاگ‌ها در **محصولات ← لاگ‌ها** نمایش داده می‌شوند و سرویس در **محصولات ← سرویس‌ها** فهرست می‌شود.
:::

## نمونهٔ کامل

این پیکربندی لاگ‌ها را از راه HTTP روی پورت `8888`، فقط از همین میزبان، می‌گیرد و به OneUptime می‌فرستد:

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` لاگ‌ها را فقط از همین میزبان می‌گیرد: ورودی `http` هیچ کلیدی نمی‌خواهد، پس با `listen: 0.0.0.0` هرکسی که به پورت برسد می‌تواند با کلید دریافت داده‌تان لاگ به OneUptime بفرستد. به‌جای ورودی `http` ورودی‌هایی را بگذارید که لازم دارید، مانند `tail` برای فایل‌های لاگ یا `systemd` برای ژورنال، و دو پردازشگر و `storage.type: filesystem` را روی هرکدام نگه دارید.

## فرستادن با خروجی HTTP

[خروجی HTTP](https://docs.fluentbit.io/manual/pipeline/outputs/http) در Fluent Bit می‌تواند به نقطهٔ پایانی Fluentd در OneUptime هم بفرستد، که هر رکورد را همان‌طور می‌خواند که [صفحهٔ Fluentd](/docs/telemetry/fluentd) شرح می‌دهد. `format` را روی `json_lines`، مانند نمونهٔ زیر، یا روی `json` بگذارید: OneUptime هر دو را می‌خواند، چه با `compress: gzip` فشرده شده باشند چه نه. قالب پیش‌فرض Fluent Bit، یعنی `msgpack`، پذیرفته نمی‌شود.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## OneUptime با میزبانی شخصی

`host` را روی میزبان نمونهٔ OneUptime خود تنظیم کنید. اگر آن را با HTTP ساده به‌جای HTTPS ارائه می‌کنید، `port` را هم روی پورتی که به آن گوش می‌دهد بگذارید (معمولاً `80`) و `tls` را حذف کنید:

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## عیب‌یابی

:::details Fluent Bit از خروجی OpenTelemetry خطای `401` ثبت می‌کند
کلید دریافت داده وجود ندارد، ناشناخته است یا منقضی شده است. خط `header` را بررسی کنید: نخست `x-oneuptime-token`، سپس یک فاصله، و بعد **کلید محرمانه** آن کلید.
:::

:::details Fluent Bit خطای `402` یا `422` ثبت می‌کند
`402`: در OneUptime Cloud، پروژه روی پلن Free است و روش پرداخت ندارد. یکی در **تنظیمات پروژه ← صورت‌حساب و فاکتورها ← صورت‌حساب** اضافه کنید. `422`: کلید غیرفعال است، یا کلید مرورگر است. **فعال** را در تنظیمات کلید دوباره روشن کنید، یا یک کلید **سرور** بسازید.
:::

:::details لاگ‌ها زیر سرویسی نامنتظر می‌رسند
سرویس از `service.name` می‌آید. بررسی کنید هر ورودی پردازشگر `opentelemetry_envelope` را داشته باشد و پس از آن `content_modifier` که آن را تنظیم می‌کند.
:::

:::details چیزی نمی‌رسد و Fluent Bit خطای اتصال ثبت می‌کند
بررسی کنید که برای یک نقطهٔ پایانی HTTPS مقدارهای `tls: On` و `port: 443` تنظیم شده باشند، و میزبانی که Fluent Bit را اجرا می‌کند بتواند روی آن پورت به میزبان OneUptime شما برسد.
:::

:::details Fluent Bit پیام `cannot be retried` ثبت می‌کند
Fluent Bit تکه‌ای را که نتوانست بفرستد دور انداخت. با `retry_limit: 8640`، مانند پیکربندی بالا، تکه‌ای را که OneUptime به آن `429`، `502`، `503` یا `504` پاسخ دهد تقریباً هر ۳۰ ثانیه و تا حدود ۷۲ ساعت دوباره می‌فرستد؛ با پیش‌فرض Fluent Bit فقط یک بار دیگر تلاش می‌کند. پاسخ `400`، `401`، `402`، `413`، `422` یا `500` بی‌درنگ دور انداخته می‌شود، چون هر بار همان پاسخ است: کلید، طرح و اندازهٔ درخواست را بررسی کنید.
:::

اگر پرسشی دارید یا برای پیکربندی به کمک نیاز دارید، به support@oneuptime.com ایمیل بزنید.

## گام‌های بعدی

:::cards
- [خط‌های لوله لاگ](/docs/telemetry/log-pipelines): لاگ‌هایی را که Fluent Bit می‌فرستد تجزیه و غنی کنید.
- [نحو جستجو](/docs/telemetry/search-syntax): لاگ‌ها را در کاوشگر لاگ پیدا کنید.
- [OpenTelemetry](/docs/telemetry/open-telemetry): نقطه‌های پایانی، کلیدها و محدودیت‌ها برای همهٔ تله‌متری.
- [Fluentd](/docs/telemetry/fluentd): به‌جای آن از Fluentd استفاده کنید.
:::
