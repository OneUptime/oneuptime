# استفاده از Fluentd برای فرستادن داده تله‌متری به OneUptime

## نمای کلی

می‌توانید با افزونه [Fluentd](https://www.fluentd.org/) لاگ‌ها و داده‌های تله‌متری را از برنامه‌ها و سرویس‌های خود جمع‌آوری کنید. این افزونه داده تله‌متری را به منبع HTTP OneUptime می‌فرستد. می‌توانید از افزونه خروجی http در fluentd برای فرستادن داده تله‌متری به منبع HTTP OneUptime استفاده کنید. این افزونه را اینجا می‌یابید: https://docs.fluentd.org/output/http

## شروع به کار

Fluentd از صدها منبع داده پشتیبانی می‌کند و می‌توانید لاگ‌ها را از هر یک از آن‌ها به OneUptime بفرستید. برخی از منابع پرکاربرد:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

و بسیاری دیگر.

فهرست کامل منابع پشتیبانی‌شده را [اینجا](https://www.fluentd.org/datasources) می‌یابید

## پیش‌نیازها

- **گام ۱: Fluentd را روی سامانه خود نصب کنید** — می‌توانید Fluentd را با دستورالعمل‌های [اینجا](https://docs.fluentd.org/installation) نصب کنید
- **گام ۲: در OneUptime حساب بسازید** — می‌توانید [اینجا](https://oneuptime.com) یک حساب رایگان بسازید. توجه کنید که هرچند حساب رایگان است، دریافت لاگ یک قابلیت پولی است. جزئیات بیشتر درباره قیمت‌گذاری را [اینجا](https://oneuptime.com/pricing) می‌یابید.
- **گام ۳: پروژه OneUptime بسازید** — پس از داشتن حساب، می‌توانید از داشبورد OneUptime یک پروژه بسازید. اگر برای ساخت پروژه کمک می‌خواهید یا پرسشی دارید، با support@oneuptime.com تماس بگیرید
- **گام ۴: توکن دریافت تله‌متری بسازید** — پس از ساخت حساب OneUptime، می‌توانید یک توکن دریافت تله‌متری بسازید تا لاگ‌ها، متریک‌ها و ترِیس‌ها را از برنامه خود بفرستید.

پس از ثبت‌نام در OneUptime و ساخت پروژه، روی «Products» در نوار ناوبری و سپس روی «Project Settings» کلیک کنید.

در صفحه Telemetry Ingestion Key روی «Create Ingestion Key» کلیک کنید تا یک توکن بسازید.

![ساخت سرویس](/docs/static/images/TelemetryIngestionKeys.png)

پس از ساخت توکن، برای دیدن آن روی «View» کلیک کنید.

![مشاهده سرویس](/docs/static/images/TelemetryIngestionKeyView.png)

## پیکربندی

می‌توانید از پیکربندی زیر برای فرستادن داده تله‌متری به منبع HTTP OneUptime استفاده کنید. این پیکربندی را می‌توانید به فایل پیکربندی fluentd اضافه کنید. فایل پیکربندی معمولاً در `/etc/fluentd/fluent.conf` یا `/etc/td-agent/td-agent.conf` قرار دارد.

باید `YOUR_SERVICE_TOKEN` را با توکنی که در گام قبل ساختید جایگزین کنید. همچنین باید `YOUR_SERVICE_NAME` را با نام سرویس خود جایگزین کنید. نام سرویس می‌تواند هر نامی باشد که دوست دارید. اگر آن سرویس در OneUptime وجود نداشته باشد، به‌صورت خودکار ساخته می‌شود.

```yaml
# Match all patterns
<match **>
@type http

endpoint https://oneuptime.com/fluentd/logs
open_timeout 2

headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

content_type application/json
json_array true

<format>
@type json
</format>
<buffer>
flush_interval 10s
</buffer>
</match>
```

نمونه‌ای از فایل پیکربندی کامل در ادامه آمده است:

```yaml
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

<match **>
@type http

endpoint https://oneuptime.com/fluentd/logs
open_timeout 2

headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

content_type application/json
json_array true

<format>
@type json
</format>
<buffer>
flush_interval 10s
</buffer>
</match>
```

**اگر OneUptime را خودمیزبانی می‌کنید**: می‌توانید `endpoint_url` را با نشانی نمونه OneUptime خود جایگزین کنید. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## استفاده

پس از افزودن پیکربندی به فایل پیکربندی fluentd، می‌توانید سرویس fluentd را راه‌اندازی مجدد کنید. پس از راه‌اندازی مجدد، داده تله‌متری به منبع HTTP OneUptime فرستاده می‌شود. اکنون می‌توانید داده تله‌متری را در داشبورد OneUptime ببینید. اگر پرسشی دارید یا برای پیکربندی به کمک نیاز دارید، با support@oneuptime.com تماس بگیرید
