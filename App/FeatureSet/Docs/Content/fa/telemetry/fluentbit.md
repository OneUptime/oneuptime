# استفاده از FluentBit برای فرستادن داده تله‌متری به OneUptime

## نمای کلی

می‌توانید با افزونه [FluentBit](https://docs.fluentbit.io/manual) لاگ‌ها و داده‌های تله‌متری را از برنامه‌ها و سرویس‌های خود جمع‌آوری کنید. این افزونه داده تله‌متری را به کالکتور HTTP مربوط به OpenTelemetry در OneUptime می‌فرستد. می‌توانید از افزونه خروجی opentelemetry در fluentbit برای فرستادن داده تله‌متری به آن کالکتور استفاده کنید. این افزونه را اینجا می‌یابید: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## شروع به کار

FluentBit از صدها منبع داده پشتیبانی می‌کند و می‌توانید لاگ‌ها و تله‌متری را از هر یک از آن‌ها به OneUptime بفرستید. برخی از منابع پرکاربرد:

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

فهرست کامل منابع پشتیبانی‌شده را [اینجا](https://docs.fluentbit.io/manual) می‌یابید

## پیش‌نیازها

- **گام ۱: FluentBit را روی سامانه خود نصب کنید** — می‌توانید FluentBit را با دستورالعمل‌های [اینجا](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit) نصب کنید
- **گام ۲: در OneUptime حساب بسازید** — می‌توانید [اینجا](https://oneuptime.com) یک حساب رایگان بسازید. توجه کنید که هرچند حساب رایگان است، دریافت لاگ یک قابلیت پولی است. جزئیات بیشتر درباره قیمت‌گذاری را [اینجا](https://oneuptime.com/pricing) می‌یابید.
- **گام ۳: پروژه OneUptime بسازید** — پس از داشتن حساب، می‌توانید از داشبورد OneUptime یک پروژه بسازید. اگر برای ساخت پروژه کمک می‌خواهید یا پرسشی دارید، با support@oneuptime.com تماس بگیرید
- **گام ۴: توکن دریافت تله‌متری بسازید** — پس از ساخت حساب OneUptime، می‌توانید یک توکن دریافت تله‌متری بسازید تا لاگ‌ها، متریک‌ها و ترِیس‌ها را از برنامه خود بفرستید.

پس از ثبت‌نام در OneUptime و ساخت پروژه، روی «Products» در نوار ناوبری و سپس روی «Project Settings» کلیک کنید.

در صفحه Telemetry Ingestion Key روی «Create Ingestion Key» کلیک کنید تا یک توکن بسازید.

![ساخت سرویس](/docs/static/images/TelemetryIngestionKeys.png)

پس از ساخت توکن، برای دیدن آن روی «View» کلیک کنید.

![مشاهده سرویس](/docs/static/images/TelemetryIngestionKeyView.png)

## پیکربندی

می‌توانید از پیکربندی زیر برای فرستادن داده تله‌متری به کالکتور HTTP مربوط به OpenTelemetry در OneUptime استفاده کنید. این پیکربندی را می‌توانید به فایل پیکربندی fluentbit اضافه کنید. فایل پیکربندی معمولاً در `/etc/fluent-bit/fluent-bit.yaml` قرار دارد. بخش outputs فایل پیکربندی این‌گونه خواهد بود:

```yaml
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
```

مطمئن شوید که در بخش input خود opentelemetry_envelope را دارید. نمونه‌ای از بخش input:

```yaml
pipeline:
  inputs:
    # Your inputs

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Please replace YOUR_SERVICE_NAME with the name of your service
          value: YOUR_SERVICE_NAME
```

نمونه فایل پیکربندی کامل:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

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
```

**اگر OneUptime را خودمیزبانی می‌کنید**: می‌توانید `host` را با میزبان نمونه OneUptime خود جایگزین کنید. اگر روی سرور http و نه https میزبانی می‌کنید، می‌توانید `port` را با پورت نمونه خود (احتمالاً پورت ۸۰) جایگزین کنید.

در این حالت پیکربندی این‌گونه خواهد بود:

```yaml
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
```

## استفاده

پس از افزودن پیکربندی به فایل پیکربندی fluentbit، می‌توانید سرویس fluentbit را راه‌اندازی مجدد کنید. پس از راه‌اندازی مجدد، داده تله‌متری به منبع HTTP OneUptime فرستاده می‌شود. اکنون می‌توانید داده تله‌متری را در داشبورد OneUptime ببینید. اگر پرسشی دارید یا برای پیکربندی به کمک نیاز دارید، با support@oneuptime.com تماس بگیرید
