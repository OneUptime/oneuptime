# محیط‌های ابری

## نمای کلی

OneUptime محاسبات ابری مدیریت‌شده را در قالب **محیط‌های ابری** گروه‌بندی می‌کند — AWS ECS / Fargate، Google Cloud Run، Azure Container Apps / Container Instances، AWS Elastic Beanstalk، AWS App Runner و Azure App Service. برای هر ترکیب یکتا از `cloud.platform` + `cloud.account.id` + `cloud.region` یک محیط ساخته می‌شود، بنابراین چیزی مانند _«AWS ECS · us-east-1 · 123456789012»_ یک موجودیت واحد است که همه بارهای کاری در حال اجرا روی آن را تجمیع می‌کند.

ماشین‌های مجازی خام (EC2، Compute Engine، Azure VM) همچنان **میزبان** می‌مانند و Kubernetes زیر بخش **Kubernetes** باقی می‌ماند. این نما مخصوص محاسبات مدیریت‌شده / PaaS است.

## پیش‌نیازها

- یک **توکن دریافت تله‌متری OneUptime** — یکی را از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید.
- یک کالکتور یا SDK مربوط به OpenTelemetry که درون یا کنار بارهای کاری شما اجرا می‌شود.

## OneUptime چگونه یک محیط را شناسایی می‌کند

| ویژگی                 | الزامی   | هدف                                                                                             |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **بله**  | باید یک بستر محاسبات مدیریت‌شده باشد (برای نمونه `aws_ecs`، `gcp_cloud_run`، `azure_container_apps`) |
| `cloud.account.id`    | خیر      | بخشی از کلید محیط                                                                                |
| `cloud.region`        | خیر      | بخشی از کلید محیط                                                                                |
| `service.instance.id` | خیر      | به تفکیک هر وظیفه/نمونه زیر **Instances** دنبال می‌شود (با پردازنده / حافظه زنده)                 |

این‌ها معمولاً به‌صورت خودکار توسط **تشخیص‌دهنده‌های منبع** در OpenTelemetry پر می‌شوند.

## گام ۱ — فعال کردن تشخیص‌دهنده منبع ابری

در کالکتور OpenTelemetry، پردازشگر `resourcedetection` را اضافه کنید:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

اگر از SDK استفاده می‌کنید، به‌جای آن `OTEL_RESOURCE_DETECTORS` را تنظیم کنید:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## گام ۲ — ارسال OTLP به OneUptime

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

اگر OneUptime را خودمیزبانی می‌کنید، از `https://YOUR-ONEUPTIME-HOST/otlp` استفاده کنید.

## چه چیزی به دست می‌آورید

نمای کلی محیط این‌ها را نشان می‌دهد:

- **پردازنده** و **حافظه** به ازای هر وظیفه/نمونه در حال اجرا (از `container.cpu.utilization` / `container.memory.usage`)، به‌همراه فهرست **بیشترین نمونه‌ها بر اساس پردازنده**.
- **نمونه‌ها** — شمارش زنده وظایف.
- **درخواست‌ها** و نمودارهای روند که از ترِیس‌های شما استخراج می‌شوند.
- زبانه‌های کامل **لاگ‌ها**، **ترِیس‌ها**، **متریک‌ها** و **نمونه‌ها**.

تفکیک همین بارهای کاری به ازای هر سرویس، زیر بخش **سرویس‌ها** در دسترس است.
