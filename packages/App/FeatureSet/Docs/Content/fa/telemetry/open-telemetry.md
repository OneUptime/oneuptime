# یکپارچه‌سازی OpenTelemetry (لاگ، متریک و ترِیس) با OneUptime.

### گام ۱ — ساخت توکن دریافت تله‌متری.

پس از ساخت حساب OneUptime، می‌توانید یک توکن دریافت تله‌متری بسازید تا لاگ‌ها، متریک‌ها و ترِیس‌ها را از برنامه خود بفرستید.

پس از ثبت‌نام در OneUptime و ساخت پروژه، روی «Products» در نوار ناوبری و سپس روی «Project Settings» کلیک کنید.

در صفحه Telemetry Ingestion Key روی «Create Ingestion Key» کلیک کنید تا یک توکن بسازید.

![ساخت سرویس](/docs/static/images/TelemetryIngestionKeys.png)

پس از ساخت توکن، برای دیدن آن روی «View» کلیک کنید.

![مشاهده سرویس](/docs/static/images/TelemetryIngestionKeyView.png)

### گام ۲

#### سرویس تله‌متری را در برنامه خود پیکربندی کنید.

#### لاگ‌های برنامه

ما برای جمع‌آوری لاگ‌های برنامه از OpenTelemetry استفاده می‌کنیم. OneUptime هم‌اکنون از دریافت لاگ از این SDKهای OpenTelemetry پشتیبانی می‌کند. برای پیکربندی سرویس تله‌متری در برنامه خود، دستورالعمل‌ها را دنبال کنید.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**یکپارچه‌سازی با OneUptime**

پس از پیکربندی سرویس تله‌متری در برنامه خود، می‌توانید با تنظیم متغیرهای محیطی زیر با OneUptime یکپارچه شوید.

| متغیر محیطی                 | مقدار                                          |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**نمونه**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**OneUptime خودمیزبان**

اگر OneUptime را خودمیزبانی می‌کنید، این را می‌توانید به نقطه پایانی کالکتور OpenTelemetry خودمیزبان خود تغییر دهید (برای نمونه `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

پس از اجرای برنامه، باید لاگ‌ها را در صفحه سرویس تله‌متری OneUptime ببینید. اگر به کمکی نیاز داشتید با support@oneuptime.com تماس بگیرید.

#### استفاده از کالکتور OpenTelemetry

به‌جای فرستادن مستقیم داده تله‌متری از برنامه خود، می‌توانید از کالکتور OpenTelemetry هم استفاده کنید.
اگر از کالکتور OpenTelemetry استفاده می‌کنید، می‌توانید خروجی‌گیرنده OneUptime را در فایل پیکربندی کالکتور تنظیم کنید.

نمونه پیکربندی برای کالکتور OpenTelemetry:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # Export over HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Requires use JSON encoder insted of default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Your OneUptime token

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```

### استثناها از روی لاگ‌ها

OneUptime استثناها را درون **لاگ‌های** شما تشخیص می‌دهد و آن‌ها را در همان نمای **استثناها** (Issues) جمع می‌کند که خطاهای ترِیس هم به آن می‌ریزند. چون هر لاگ از پیش به یک سرویس یا میزبان تفکیک می‌شود، استثناهای برآمده از لاگ به منبع درست نسبت داده می‌شوند و همان گروه‌بندی اثر انگشت را دارند — بنابراین خطایی که هم با ترِیس و هم با لاگ گزارش شده باشد در یک issue واحد جمع می‌شود.

دو مسیر تشخیص وجود دارد:

1. **ویژگی‌های صریح استثنا (توصیه‌شده).** رکورد لاگی که ویژگی‌های `exception.type`، `exception.message` یا `exception.stacktrace` از OpenTelemetry را داشته باشد مستقیماً به استثنا تبدیل می‌شود. بیشتر یکپارچه‌سازی‌های لاگ (پیوست‌های Logback / Log4j، Serilog، ابزارگذاری logging در Python و مانند آن) وقتی استثنایی لاگ می‌کنید این‌ها را تنظیم می‌کنند. این روش دقیق و مستقل از زبان است.

2. **ردیابی پشته در بدنه لاگ.** برای لاگ‌های error/fatal بدون آن ویژگی‌ها — برای نمونه stdout خام، syslog یا journald — OneUptime بدنه را برای یافتن یک ردیابی پشته (JavaScript، Python، Java، Go، Ruby، C#/.NET، PHP) پویش می‌کند و نوع، پیام و فریم‌ها را استخراج می‌کند. ردیابی‌های چندخطی باید به‌صورت یک رکورد لاگ واحد برسند؛ اگر لاگ‌های متنی ساده جمع می‌کنید، در کالکتور بازترکیب چندخطی را فعال کنید (راهنمای [کالکتور OpenTelemetry روی میزبان](/docs/telemetry/host-otel-collector) را ببینید).

این قابلیت به‌صورت پیش‌فرض روشن است. در OneUptime خودمیزبان می‌توانید با تنظیم `TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED=false` روی سرویس ingest آن را غیرفعال کنید.
