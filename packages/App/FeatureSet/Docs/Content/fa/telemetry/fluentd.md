# Fluentd

[Fluentd](https://www.fluentd.org/) لاگ‌ها را از فایل‌ها، کانتینرها، syslog، برنامه‌ها و [بسیاری منبع دیگر](https://www.fluentd.org/datasources) جمع‌آوری می‌کند. [خروجی HTTP](https://docs.fluentd.org/output/http) داخلی آن، لاگ‌ها را به نقطهٔ پایانی Fluentd در OneUptime می‌فرستد و آن‌ها در **محصولات ← لاگ‌ها** قابل جستجو می‌شوند.

:::cards
- [پیکربندی Fluentd](#پیکربندی-fluentd): یک خروجی HTTP اضافه کنید که به OneUptime اشاره کند.
- [رکوردها چگونه خوانده می‌شوند](#رکوردها-چگونه-خوانده-میشوند): کدام فیلدها به پیام، شدت و attributeها تبدیل می‌شوند.
- [OneUptime با میزبانی شخصی](#oneuptime-با-میزبانی-شخصی): Fluentd را به سمت نمونهٔ خودتان بفرستید.
:::

## چگونه کار می‌کند

```mermaid title="از Fluentd تا OneUptime"
flowchart TB
    sources["فایل‌ها، کانتینرها، syslog، برنامه‌ها"] --> fluentd["Fluentd"]
    fluentd -->|"خروجی HTTP، JSON + کلید دریافت داده"| ingest["OneUptime /fluentd/logs"]
    ingest --> service["سرویسی که در درخواست نام برده شده"]
    service --> logs["لاگ‌ها"]
```

Fluentd رکوردها را به‌صورت دسته‌های JSON می‌فرستد، با کلید دریافت داده‌تان در سرآیند `x-oneuptime-token` و نام سرویس در `x-oneuptime-service-name`. OneUptime هر رکورد را به یک لاگ از آن سرویس تبدیل می‌کند و نخستین باری که داده‌ای برسد سرویس را می‌سازد.

## پیش از شروع

- **نصب Fluentd**: [راهنمای نصب](https://docs.fluentd.org/installation) را ببینید.
- **یک پروژهٔ OneUptime.** در OneUptime Cloud هزینهٔ تله‌متری بر پایهٔ هر گیگابایت دریافت‌شده محاسبه می‌شود ([قیمت‌ها](https://oneuptime.com/pricing) را ببینید)، و پروژه‌ای که روی پلن Free است پیش از ارسال تله‌متری به یک روش پرداخت نیاز دارد.
- **یک کلید دریافت دادهٔ تله‌متری.** اگر ندارید:

:::steps
### کلیدهای دریافت داده را باز کنید

به **محصولات ← تنظیمات پروژه** بروید، در منوی کناری **تله‌متری و APM** را باز کنید و **کلیدهای دریافت داده** را برگزینید.

![فهرست «کلیدهای دریافت داده»، با «ساخت کلید دریافت داده» که دورش خط کشیده شده](screen:ingestion-keys)

### یک کلید بسازید

روی **ساخت کلید دریافت داده** کلیک کنید. در پنجره، نام کلید از پیش پر شده و **سرور** انتخاب شده است، یعنی همان نوع کلیدی که برنامه‌ها و Collectorها با آن داده می‌فرستند؛ پس برای ساختن کلید روی **ساخت کلید دریافت داده** کلیک کنید، یا پیش از آن نامش را تغییر دهید.

### کلید محرمانه را کپی کنید

کلید تازه در صفحهٔ خودش باز می‌شود. **کلید محرمانه** آن را کپی کنید: این همان `YOUR_SERVICE_TOKEN` در پیکربندی زیر است.

![صفحهٔ یک کلید دریافت دادهٔ تله‌متری که کلید محرمانه‌اش را نشان می‌دهد](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## پیکربندی Fluentd

فایل پیکربندی Fluentd معمولاً `/etc/fluent/fluentd.conf` است، یا برای بستهٔ قدیمی‌تر td-agent، `/etc/td-agent/td-agent.conf`.

:::steps
### یک خروجی HTTP اضافه کنید

یک بخش `<match>` اضافه کنید که رکوردها را به OneUptime بفرستد. به‌جای `YOUR_SERVICE_TOKEN` کلید دریافت داده‌تان را بنویسید، و به‌جای `YOUR_SERVICE_NAME` نامی را که لاگ‌ها باید با آن نمایش داده شوند؛ هر نامی که بخواهید:

```text title="fluentd.conf"
# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time ${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

# Match all patterns
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

`json_array true` هر تکهٔ بافر را به‌صورت یک آرایهٔ JSON می‌فرستد، و `flush_interval 10s` هر ۱۰ ثانیه بافر را می‌فرستد. `chunk_limit_size 900k` هر درخواست را زیر ۱ مگابایت نگه می‌دارد، یعنی بیشترین اندازه‌ای که OneUptime در این نقطهٔ پایانی می‌پذیرد.

`retryable_response_codes 429,502,503,504` وقتی OneUptime شلوغ است (`429`) یا دارد دوباره راه‌اندازی می‌شود (`502`، `503`، `504`)، دسته را دوباره می‌فرستد؛ بدون آن، Fluentd با هر پاسخی جز `503` دسته را دور می‌اندازد. `retry_max_interval 30s` بین دو تلاش حداکثر ۳۰ ثانیه صبر می‌کند، و `retry_timeout 72h` دسته‌ای را که پس از ۷۲ ساعت هنوز فرستاده نشده دور می‌اندازد. فیلتر `record_transformer` زمانی را که Fluentd به هر رکورد داده، با نام `fluentd_time` به آن اضافه می‌کند: خروجی HTTP فقط خود رکورد را می‌فرستد، و OneUptime زمان لاگ را از آن می‌خواند.

### Fluentd را دوباره راه‌اندازی کنید

سرویس Fluentd را دوباره راه‌اندازی کنید تا خروجی تازه را بارگذاری کند.

### بررسی کنید لاگ‌ها می‌رسند

چند ثانیه پس از تخلیهٔ بعدی، لاگ‌ها در **محصولات ← لاگ‌ها** نمایش داده می‌شوند. سرویس در **محصولات ← سرویس‌ها** فهرست می‌شود؛ اگر هنوز وجود نداشته باشد، OneUptime آن را می‌سازد.
:::

## نمونهٔ کامل

این پیکربندی رکوردها را با پروتکل forward در Fluentd روی درگاه `24224` می‌گیرد و همه را به OneUptime می‌فرستد:

```text title="fluentd.conf"
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time ${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

برای فرستادن منبع‌های گوناگون به‌عنوان سرویس‌های گوناگون، برای هر تگ یک بخش `<match>` به کار ببرید که هرکدام `x-oneuptime-service-name` خودش را داشته باشد.

## رکوردها چگونه خوانده می‌شوند

OneUptime این فیلدها را از هر رکورد می‌خواند:

| فیلد لاگ | از نخستین فیلد موجود در رکورد از میان | توضیح |
| --- | --- | --- |
| بدنه | `message`، `log`، `msg`، `body`، `text` | خط لاگ. رکوردی که هیچ‌کدام از این‌ها را نداشته باشد، به‌طور کامل و به‌صورت JSON ذخیره می‌شود. |
| شدت | `level`، `severity`، `loglevel`، `log_level`، `priority`، `severityText`، `severity_text` | نام‌هایی مانند `trace`، `debug`، `info`، `notice`، `warn`، `error`، `critical` و `fatal`، با حروف بزرگ یا کوچک. هر مقدار دیگری به‌صورت `Unspecified` ذخیره می‌شود. |
| شناسهٔ ترِیس | `trace_id`، `traceId`، `traceid` | لاگ را به ترِیس خودش پیوند می‌دهد. |
| شناسهٔ span | `span_id`، `spanId`، `spanid` | لاگ را به span خودش پیوند می‌دهد. |
| سرویس | سرآیند `x-oneuptime-service-name` | وقتی سرآیند تنظیم نشده باشد، `Fluentd`. |
| زمان | `time`، `timestamp`، `@timestamp`، `ts`، `fluentd_time` | زمانی به قالب ISO 8601، مانند `2026-11-14T08:00:00.123Z`، یا ثانیه، میلی‌ثانیه، میکروثانیه یا نانوثانیه از مبدأ زمان یونیکس؛ زمانی که منطقهٔ زمانی ندارد UTC در نظر گرفته می‌شود. زمانی پیش از ۲۰۰۰ یا بیش از یک روز جلوتر خوانده نمی‌شود. فیلدی که زمان از آن خوانده می‌شود به‌صورت attribute نگه داشته نمی‌شود. رکوردی که زمان ندارد با زمانی ذخیره می‌شود که OneUptime آن را دریافت می‌کند. |

هر فیلد دیگر به attributeی با نام `fluentd.` و پس از آن نام فیلد تبدیل می‌شود که می‌توانید بر پایهٔ آن جستجو و فیلتر کنید: فیلد `container_name` در کاوشگر لاگ‌ها `@fluentd.container_name` است. یک شیء تودرتو با نقطه تخت می‌شود، مانند `fluentd.kubernetes.pod_name`، و یک فهرست به‌صورت JSON ذخیره می‌شود.

لاگ‌های Fluentd هم مثل هر لاگ دیگری از [خط‌های لوله لاگ](/docs/telemetry/log-pipelines)، فیلترهای حذف و قواعد پاک‌سازی شما می‌گذرند.

## OneUptime با میزبانی شخصی

در `endpoint` به‌جای `https://oneuptime.com` نشانی نمونهٔ OneUptime خود را بنویسید: `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`.

## عیب‌یابی

:::details Fluentd از خروجی HTTP خطای `401` ثبت می‌کند
کلید دریافت داده وجود ندارد، ناشناخته است یا منقضی شده است. مقدار `x-oneuptime-token` را در `headers` بررسی کنید.
:::

:::details Fluentd خطای `402` یا `422` ثبت می‌کند
`402`: در OneUptime Cloud، پروژه روی پلن Free است و روش پرداخت ندارد. یکی در **تنظیمات پروژه ← صورت‌حساب و فاکتورها ← صورت‌حساب** اضافه کنید. `422`: کلید غیرفعال است، یا کلید مرورگر است. **فعال** را در تنظیمات کلید دوباره روشن کنید، یا یک کلید **سرور** بسازید.
:::

:::details Fluentd خطای `413` ثبت می‌کند
درخواست از ۱ مگابایت بزرگ‌تر است، یعنی از بیشترین اندازه‌ای که OneUptime در این نقطهٔ پایانی می‌پذیرد. `chunk_limit_size 900k` را مانند پیکربندی بالا در بخش `<buffer>` تنظیم کنید.
:::

:::details Fluentd خطای `429`، `502`، `503` یا `504` ثبت می‌کند
OneUptime شلوغ است یا دارد دوباره راه‌اندازی می‌شود. با `retryable_response_codes 429,502,503,504` در بخش `<match>`، مانند پیکربندی بالا، Fluentd دسته را نگه می‌دارد و دوباره می‌فرستد؛ بدون آن، Fluentd دسته را دور می‌اندازد.
:::

:::details لاگ‌ها زمانی را نشان می‌دهند که OneUptime آن‌ها را دریافت کرده، نه زمان خودشان را
OneUptime زمان هر لاگ را از رکورد آن می‌خواند، و خروجی HTTP در Fluentd فقط خود رکورد را می‌فرستد. بخش `<parse>` فیلد `time` را از رکورد بیرون می‌کشد: `keep_time_key true` را به آن اضافه کنید. فیلتر `record_transformer` پیکربندی بالا را هم اضافه کنید: زمانی را که Fluentd به هر رکورد داده، با نام `fluentd_time` به آن اضافه می‌کند.
:::

:::details لاگ‌ها زیر سرویس `Fluentd` می‌رسند
سرآیند `x-oneuptime-service-name` وجود ندارد. آن را در هر بخش `<match>` به `headers` اضافه کنید.
:::

:::details بدنهٔ لاگ کل رکورد را به‌صورت JSON نشان می‌دهد
OneUptime بدنه را از نخستین فیلد موجود در رکورد از میان `message`، `log`، `msg`، `body` یا `text` برمی‌دارد، و اگر هیچ‌کدام نباشد کل رکورد را ذخیره می‌کند. نام فیلدی را که خط لاگ شما را دارد به یکی از این‌ها تغییر دهید، برای نمونه با فیلتر `record_transformer` در Fluentd.
:::

اگر پرسشی دارید یا برای پیکربندی به کمک نیاز دارید، به support@oneuptime.com ایمیل بزنید.

## گام‌های بعدی

:::cards
- [خط‌های لوله لاگ](/docs/telemetry/log-pipelines): لاگ‌هایی را که Fluentd می‌فرستد تجزیه و غنی کنید.
- [نحو جستجو](/docs/telemetry/search-syntax): لاگ‌ها را در کاوشگر لاگ پیدا کنید.
- [Fluent Bit](/docs/telemetry/fluentbit): عاملی سبک‌تر که از راه OpenTelemetry می‌فرستد.
- [مانیتور لاگ‌ها](/docs/monitor/logs-monitor): وقتی لاگ‌های منطبق پیدا شدند هشدار بدهید.
:::
