# فرستادن داده پروفایل‌گیری پیوسته به OneUptime

## نمای کلی

پروفایل‌گیری پیوسته چهارمین ستون رصدپذیری در کنار گزارش‌ها، سنجه‌ها و ردیابی‌هاست. پروفایل‌ها ثبت می‌کنند که برنامه شما چگونه زمان CPU را خرج می‌کند و در سطح تابع حافظه تخصیص می‌دهد، و OneUptime آن‌ها را در کنار باقی تله‌متری‌تان به‌صورت فلیم‌گراف‌های تعاملی ترسیم می‌کند.

OneUptime یک **API دریافت سازگار با Pyroscope** ارائه می‌دهد. هر چیزی که بتواند به یک کارساز Pyroscope بفرستد — پروفایل‌گیر eBPF در Grafana Alloy یا یک SDK زبانی Pyroscope — می‌تواند به OneUptime بفرستد.

## نقطه پایانی دریافت

| تنظیم | مقدار |
| ----------------------------------- | --------------------------------------------------- |
| نشانی پایه (نشانی کارساز Pyroscope) | `https://oneuptime.com/pyroscope` |
| هدر احراز هویت | `x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_TOKEN` |

SDKهای Pyroscope به نشانی پایه `/ingest` را می‌افزایند و Grafana Alloy `/push.v1.PusherService/Push` را — شما همیشه فقط نشانی پایه را پیکربندی می‌کنید. SDKهایی که گزینه `authToken` / `auth_token` می‌گیرند آن را به‌صورت `Authorization: Bearer <token>` می‌فرستند، که OneUptime آن را به‌عنوان نام مستعار هدر `x-oneuptime-token` می‌پذیرد.

**OneUptime خودمیزبان:** به‌جای `https://oneuptime.com` میزبان خودتان را بگذارید، برای نمونه `http(s)://YOUR-ONEUPTIME-HOST/pyroscope`.

## قالب‌های پشتیبانی‌شده پروفایل

| قالب | فرستنده | پشتیبانی |
| ------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| pprof (پروتوباف دودویی، اختیاراً gzip‌شده) | SDKهای Pyroscope برای Go، Node.js و ‎.NET؛ Grafana Alloy | بله |
| متن تاشده/فروریخته | SDKهای Pyroscope برای Python، Ruby و Rust (قالب بارگذاری پیش‌فرضشان) | بله |
| JFR (Java Flight Recorder) | عامل Java در Pyroscope | هنوز نه — برای سرویس‌های Java از Grafana Alloy استفاده کنید |

## گام ۱ — ساخت یک توکن دریافت تله‌متری

پس از ثبت‌نام در OneUptime و ساختن یک پروژه، در نوار پیمایش روی «Products» و سپس روی «Project Settings» کلیک کنید.

در صفحه Telemetry Ingestion Key، برای ساختن توکن روی «Create Ingestion Key» کلیک کنید.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

پس از ساختن توکن، برای دیدنش روی «View» کلیک کنید.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## گام ۲ — فرستادن پروفایل‌ها

### گزینه الف: Grafana Alloy با eBPF (توصیه‌شده، بدون هیچ تغییر کد)

[Grafana Alloy](https://grafana.com/docs/alloy/latest/) با استفاده از eBPF پروفایل‌های CPU را از هر فرایند روی یک میزبان لینوکسی جمع می‌کند — بدون عاملی درون برنامه شما و بدون تغییر کد. برای Go، Rust، C/C++، Java، Python، Ruby، PHP، Node.js و ‎.NET کار می‌کند.

فایل `alloy-config.alloy` را بسازید:

```hcl
discovery.process "all" {
  refresh_interval = "60s"
}

discovery.relabel "alloy_profiles" {
  targets = discovery.process.all.targets

  rule {
    action       = "replace"
    source_labels = ["__meta_process_exe"]
    target_label  = "service_name"
  }
}

pyroscope.ebpf "default" {
  targets    = discovery.relabel.alloy_profiles.output
  forward_to = [pyroscope.write.oneuptime.receiver]

  collect_interval = "15s"
  sample_rate      = 97
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_INGESTION_TOKEN",
    }
  }
}
```

آن را با Docker اجرا کنید (eBPF به یک کانتینر ممتاز با فضای‌نام PID میزبان نیاز دارد):

```yaml
# docker-compose.yml
services:
  alloy:
    image: grafana/alloy:latest
    privileged: true
    pid: host
    volumes:
      - ./alloy-config.alloy:/etc/alloy/config.alloy
      - /proc:/proc:ro
      - /sys:/sys:ro
    command:
      - run
      - /etc/alloy/config.alloy
```

یا مستقیم روی میزبان اجرایش کنید:

```bash
alloy run alloy-config.alloy
```

### گزینه ب: SDKهای زبانی Pyroscope (پروفایل‌گیری درون‌فرایندی)

SDKهای Pyroscope درون برنامه شما اجرا می‌شوند و پیوسته پروفایل‌ها را بارگذاری می‌کنند. نشانی کارساز SDK را روی نشانی پایه OneUptime بگذارید و توکن دریافتتان را به‌عنوان توکن احراز هویت بدهید.

**Go** (pprof بارگذاری می‌کند):

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "my-service",
    ServerAddress:   "https://oneuptime.com/pyroscope",
    AuthToken:       "YOUR_ONEUPTIME_INGESTION_TOKEN",
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileAllocObjects,
        pyroscope.ProfileAllocSpace,
        pyroscope.ProfileInuseObjects,
        pyroscope.ProfileInuseSpace,
        pyroscope.ProfileGoroutines,
    },
})
```

**Node.js** (pprof بارگذاری می‌کند):

```javascript
const Pyroscope = require("@pyroscope/nodejs");

Pyroscope.init({
  serverAddress: "https://oneuptime.com/pyroscope",
  appName: "my-service",
  authToken: "YOUR_ONEUPTIME_INGESTION_TOKEN",
});

Pyroscope.start();
```

**Python** (متن تاشده بارگذاری می‌کند):

```python
import pyroscope

pyroscope.configure(
    application_name="my-service",
    server_address="https://oneuptime.com/pyroscope",
    auth_token="YOUR_ONEUPTIME_INGESTION_TOKEN",
)
```

**‎.NET** (pprof بارگذاری می‌کند)، **Ruby** و **Rust** (متن تاشده بارگذاری می‌کنند) به همین شکل کار می‌کنند: [SDK پایروسکوپ برای زبان خود](https://grafana.com/docs/pyroscope/latest/configure-client/) را نصب کنید و نشانی کارساز را با توکن دریافتتان به‌عنوان توکن احراز هویت روی `https://oneuptime.com/pyroscope` بگذارید.

### Java

عامل Java در Pyroscope پروفایل‌ها را در قالب JFR بارگذاری می‌کند، که OneUptime هنوز آن را دریافت نمی‌کند. به‌جایش سرویس‌های Java را با یکپارچه‌سازی eBPF در Grafana Alloy (گزینه الف بالا) پروفایل بگیرید — پروفایل‌های CPU روی JVM را بدون عامل یا تغییر کد ثبت می‌کند.

## نوع‌های پشتیبانی‌شده پروفایل

هر پروفایل بارگذاری‌شده بر پایه نخستین نوع نمونه‌ای که اعلام می‌کند دسته‌بندی می‌شود (قرارداد استاندارد pprof / Pyroscope). هر نوعی ذخیره و قابل مشاهده است؛ نوع‌های زیر در رابط کاربری OneUptime گروه‌بندی، یکاها و برچسب‌های درجه‌یک می‌گیرند:

| نوع پروفایل | نمایش به‌صورت | یکا |
| ------------------------------------ | ---------------------- | ----------- |
| `cpu`، `samples` | زمان CPU | نانوثانیه |
| `wall` | زمان دیواری | نانوثانیه |
| `inuse_space`، `alloc_space`، `heap` | حافظه (بایت) | بایت |
| `inuse_objects`، `alloc_objects` | حافظه (شمار اشیا) | شمار |
| `mutex`، `contention`، `block` | رقابت بر سر قفل | نانوثانیه |
| `goroutine` | گوروتین‌ها (Go) | شمار |

هر چیز دیگری (برای نمونه یک نوع نمونه سفارشی) زیر «Other» با نام خامش پدیدار می‌شود.

## بررسی اینکه کار می‌کند

1. **توکنتان را بررسی کنید.** نقطه‌های پایانی دریافت عمداً حتی برای توکن نامعتبر هم HTTP 200 برمی‌گردانند (تا عاملی که بد پیکربندی شده کارساز را با تلاش دوباره طوفانی نکند)، یعنی یک غلط تایپی خاموش در توکن از سمت عامل نامرئی است. به‌جایش از نقطه پایانی اعتبارسنجی بپرسید:

   ```bash
   curl -i -H "x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_TOKEN" \
     https://oneuptime.com/otlp/v1/validate
   ```

   توکن معتبر `200` با `{"valid": true, ...}` برمی‌گرداند؛ توکن ناشناخته یا باطل‌شده `401` برمی‌گرداند.

2. **صفحه Profiles را باز کنید.** در داشبورد OneUptime به **Products > Performance Profiles** بروید. با فاصله جمع‌آوری پیش‌فرض ۱۵ ثانیه‌ای Alloy (یا فاصله بارگذاری حدود ۱۰ ثانیه‌ای SDKها)، نخستین پروفایل‌ها و فلیم‌گراف‌هایشان یکی دو دقیقه پس از شروع عامل پدیدار می‌شوند.

3. **سرویس را بررسی کنید.** پروفایل‌ها به سرویس تله‌متری‌ای پیوست می‌شوند که `application_name` / `appName` در SDK نامش می‌برد (یا نام فایل اجرایی فرایند، زیر قاعده پیش‌فرض relabel در Alloy که بالاتر آمد).

## قابلیت‌ها

### مصورسازی فلیم‌گراف

OneUptime داده پروفایل را به‌صورت فلیم‌گراف‌های تعاملی ترسیم می‌کند. هر میله نماینده یک تابع در پشته فراخوانی است و پهنایش با زمان یا منابع مصرف‌شده متناسب است. می‌توانید روی هر تابعی کلیک کنید تا بزرگ‌نمایی شود و فراخوانان و فراخوانده‌هایش را ببینید.

### فهرست توابع

جدولی مرتب‌شدنی از همه توابع ثبت‌شده در یک پروفایل ببینید، رتبه‌بندی‌شده بر پایه زمان خودی، زمان کل یا شمار تخصیص. این به شما کمک می‌کند به‌سرعت پرهزینه‌ترین توابع برنامه‌تان را بیابید.

### هم‌بستگی با ردیابی

وقتی پروفایلی شناسه ردیابی و اسپن را حمل کند (برای نمونه به‌عنوان برچسب‌های نمونه `trace_id` / `span_id`)، می‌توانید مستقیم از یک اسپن کند به پروفایل CPU یا حافظه متناظر بروید تا دقیقاً بفهمید چه کدی در حال اجرا بوده است.

### پالایش بر پایه نوع پروفایل

پروفایل‌ها را بر پایه دسته (CPU، حافظه، قفل‌ها، زمان دیواری، گوروتین‌ها) بپالایید تا روی بعد منبعی مشخصی که بررسی می‌کنید تمرکز کنید.

## نگهداشت داده

نگهداشت داده پروفایل به ازای هر سرویس تله‌متری در تنظیمات پروژه OneUptime شما پیکربندی می‌شود. دوره نگهداشت پیش‌فرض ۱۵ روز است. داده پس از پایان دوره نگهداشت به‌طور خودکار حذف می‌شود.

برای تغییر دوره نگهداشت یک سرویس، به **Products > Services > [Your Service] > Settings** بروید و مقدار نگهداشت داده را به‌روزرسانی کنید.

## کمک لازم دارید؟

اگر برای راه‌اندازی پروفایل‌گیری با OneUptime به کمکی نیاز دارید، لطفاً با support@oneuptime.com تماس بگیرید.
