# توابع بدون سرور

## نمای کلی

OneUptime به‌محض دریافت داده OpenTelemetry که با ویژگی منبع `faas.name` نشانه‌گذاری شده باشد، به‌صورت خودکار یک **تابع بدون سرور** را تشخیص می‌دهد. چیزی نیست که دستی بسازید — تابع خود را با SDK مربوط به OpenTelemetry برای محیط اجرایتان ابزارگذاری کنید، خروجی OTLP آن را به OneUptime بدهید، و تابع همراه با ترِیس‌ها، لاگ‌ها و متریک‌هایش زیر بخش **توابع بدون سرور** ظاهر می‌شود.

این برای AWS Lambda، Google Cloud Functions، Azure Functions، Cloudflare Workers یا هر محیط اجرای FaaS که بتواند OpenTelemetry تولید کند کار می‌کند.

## پیش‌نیازها

- یک **توکن دریافت تله‌متری OneUptime** — یکی را از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید و مقدار `x-oneuptime-token` را کپی کنید.
- SDK مربوط به OpenTelemetry (یا یک لایه ابزارگذاری خودکار) برای زبان تابع شما.

## OneUptime چگونه یک تابع را شناسایی می‌کند

OneUptime هر تابع را بر پایه ویژگی منبع `faas.name` کلیدگذاری می‌کند:

| ویژگی                                                  | الزامی   | هدف                                                          |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------ |
| `faas.name`                                            | **بله**  | هویت تابع (برای نمونه `checkout-handler`)                    |
| `faas.version`                                         | خیر      | در نمای کلی نمایش داده می‌شود                                 |
| `faas.instance`                                        | خیر      | به تفکیک نمونه زیر زبانه **Instances** دنبال می‌شود           |
| `cloud.platform`                                       | خیر      | `aws_lambda`، `gcp_cloud_functions`، `azure_functions` و ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | خیر      | در نمای کلی نمایش داده می‌شود                                 |

> تابعی که `service.name` هم تنظیم کند، همچنان زیر بخش **سرویس‌ها** نیز ظاهر می‌شود. نمای **توابع بدون سرور** عدسی متمرکز بر FaaS است که بر پایه `faas.name` محدود شده است.

## گام ۱ — تنظیم متغیرهای محیطی خروجی OTLP

بیشتر ابزارگذاری‌های خودکار زبان‌ها متغیرهای محیطی استاندارد OpenTelemetry را رعایت می‌کنند:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

اگر OneUptime را خودمیزبانی می‌کنید، نقطه پایانی را با `https://YOUR-ONEUPTIME-HOST/otlp` جایگزین کنید.

## گام ۲ — (AWS Lambda) افزودن لایه OpenTelemetry

برای AWS Lambda ساده‌ترین راه، [لایه Lambda مربوط به OpenTelemetry](https://opentelemetry.io/docs/faas/lambda-auto/) است. لایه مربوط به محیط اجرای خود را وصل کنید و این‌ها را تنظیم کنید:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

این لایه `faas.name` را به‌صورت خودکار از نام تابع تنظیم می‌کند و تشخیص‌دهنده منبع، `cloud.platform`، `cloud.region` و `cloud.account.id` را پر می‌کند.

## چه چیزی به دست می‌آورید

به‌محض اینکه تابع یک اسپن، لاگ یا متریک تولید کند، زیر بخش **توابع بدون سرور** ظاهر می‌شود. نمای کلی این‌ها را نشان می‌دهد:

- **فراخوانی‌ها**، **نرخ خطا** و **مدت p95** — که از ترِیس‌های شما در بازه زمانی قابل انتخاب استخراج می‌شود، به‌همراه نمودارهای روند.
- **نمونه‌ها** — شمارش زنده مقادیر `faas.instance` که دیده شده‌اند.
- زبانه‌های کامل **لاگ‌ها**، **ترِیس‌ها** و **متریک‌ها** که به همین تابع محدود شده‌اند.

همچنین می‌توانید از مسیر _Serverless → Settings → Label Rules / Owner Rules_ برچسب‌ها و مالکان را به‌صورت خودکار اعمال کنید.
