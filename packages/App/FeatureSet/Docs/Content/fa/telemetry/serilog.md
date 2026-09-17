# فرستادن گزارش‌های Serilog به OneUptime

## نمای کلی

[Serilog](https://serilog.net) محبوب‌ترین کتابخانه گزارش‌گیری ساخت‌یافته برای ‎.NET است. OneUptime گزارش‌های Serilog را روی پروتکل OpenTelemetry ‏(OTLP) و با استفاده از سینک رسمی [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) دریافت می‌کند. پس از پیکربندی، هر رویداد گزارشی که برنامه شما از راه Serilog می‌نویسد به OneUptime فرستاده می‌شود و آنجا در **Products → Logs** قابل جستجو می‌شود، همراه با ویژگی‌های ساخت‌یافته، شدت و هم‌بستگی ردیابی/اسپن.

هیچ بسته ویژه OneUptime برای نصب وجود ندارد — سینک با همان نقطه پایانی OTLP حرف می‌زند که OneUptime برای همه داده‌های OpenTelemetry در معرض می‌گذارد. این برای برنامه‌های کنسولی، سرویس‌های کارگر، برنامه‌های ASP.NET Core و هر چیز دیگری که روی ‎.NET اجرا می‌شود کار می‌کند.

## پیش‌نیازها

- **ثبت‌نام برای یک حساب OneUptime** — می‌توانید [اینجا](https://oneuptime.com) حسابی رایگان بسازید. توجه کنید که هرچند حساب رایگان است، دریافت گزارش قابلیتی پولی است. جزئیات بیشتر درباره قیمت‌گذاری را [اینجا](https://oneuptime.com/pricing) بیابید.
- **ساخت یک پروژه OneUptime** — پس از داشتن حساب، از داشبورد OneUptime پروژه‌ای بسازید. اگر کمک لازم دارید، با support@oneuptime.com تماس بگیرید.
- **ساخت یک توکن دریافت تله‌متری** — برای احراز هویت گزارش‌هایتان به توکنی نیاز دارید.

پس از ثبت‌نام در OneUptime و ساختن یک پروژه، در نوار پیمایش روی «Products» و سپس روی «Project Settings» کلیک کنید.

در صفحه Telemetry Ingestion Key، برای ساختن توکن روی «Create Ingestion Key» کلیک کنید.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

پس از ساختن توکن، برای دیدنش روی «View» کلیک کنید.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## چه چیزی از OneUptime لازم دارید

| تنظیم | مقدار |
| ------------- | ------------------------------------------------------------ |
| نقطه پایانی OTLP | `https://oneuptime.com/otlp` |
| هدر احراز هویت | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| نام سرویس | نامی که سرویس شما باید زیر آن پدیدار شود، برای نمونه `my-service` |

> **‏OneUptime را خودمیزبان می‌کنید؟** به‌جای `https://oneuptime.com/otlp` مقدار `https://YOUR-ONEUPTIME-HOST/otlp` را بگذارید (یا `http://...` اگر TLS را پایان نمی‌دهید). باقی همه‌چیز همان می‌ماند.

سینک از پروتکل **HTTP/protobuf** در OTLP استفاده می‌کند و مسیر `/v1/logs` را به‌طور خودکار به نقطه پایانی می‌افزاید، پس نشانی نهایی‌ای که به آن POST می‌کند `https://oneuptime.com/otlp/v1/logs` است. شما فقط باید نقطه پایانی پایه `/otlp` را بدهید.

## گام ۱ — نصب بسته‌های NuGet

‏Serilog و سینک OpenTelemetry را به پروژه‌تان اضافه کنید:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

اگر سینک را از `appsettings.json` پیکربندی می‌کنید (پایین‌تر را ببینید)، این را هم اضافه کنید:

```bash
dotnet add package Serilog.Settings.Configuration
```

برای برنامه‌های ASP.NET Core، بسته `Serilog.AspNetCore` سریلاگ را به میزبان و خط لوله درخواست سیم‌کشی می‌کند:

```bash
dotnet add package Serilog.AspNetCore
```

## گام ۲ — پیکربندی سینک در کد

مستقیم‌ترین راه، پیکربندی Serilog هنگام راه‌اندازی برنامه است. سینک را به نقطه پایانی OTLP در OneUptime نشانه بگیرید، پروتکل را روی `HttpProtobuf` بگذارید، توکن دریافتتان را به‌عنوان هدر بدهید و گزارش‌ها را با یک `service.name` برچسب بزنید.

```csharp
using Serilog;
using Serilog.Sinks.OpenTelemetry;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .Enrich.FromLogContext()
    .WriteTo.Console() // optional: keep local logs too
    .WriteTo.OpenTelemetry(options =>
    {
        // Base OTLP endpoint. The sink appends /v1/logs automatically.
        options.Endpoint = "https://oneuptime.com/otlp";
        options.Protocol = OtlpProtocol.HttpProtobuf;

        // Authenticate with your OneUptime telemetry ingestion token.
        options.Headers = new Dictionary<string, string>
        {
            ["x-oneuptime-token"] = "YOUR_TELEMETRY_INGESTION_TOKEN"
        };

        // Identify your service in OneUptime.
        options.ResourceAttributes = new Dictionary<string, object>
        {
            ["service.name"] = "my-service",
            ["deployment.environment"] = "production"
        };
    })
    .CreateLogger();

try
{
    Log.Information("Application starting up");
    // ... your application code ...
}
finally
{
    // Flush any buffered logs before the process exits.
    Log.CloseAndFlush();
}
```

> **مهم:** سینک رویدادهای گزارش را دسته‌بندی می‌کند و ناهمگام می‌فرستد. همیشه پیش از خروج برنامه `Log.CloseAndFlush()` را فرا بخوانید (یا لاگر را دور بریزید)، وگرنه ممکن است آخرین دسته گزارش‌ها از دست برود. در ASP.NET Core، بسته `Serilog.AspNetCore` این را هنگام خاموشی مؤدبانه برایتان انجام می‌دهد.

## گام ۳ — پیکربندی از appsettings.json (جایگزین)

اگر پیکربندی را به کد ترجیح می‌دهید، از `Serilog.Settings.Configuration` استفاده کنید و تنظیمات سینک را در `appsettings.json` بگذارید:

```json
{
  "Serilog": {
    "Using": ["Serilog.Sinks.OpenTelemetry"],
    "MinimumLevel": "Information",
    "WriteTo": [
      {
        "Name": "OpenTelemetry",
        "Args": {
          "endpoint": "https://oneuptime.com/otlp",
          "protocol": "HttpProtobuf",
          "headers": {
            "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
          },
          "resourceAttributes": {
            "service.name": "my-service",
            "deployment.environment": "production"
          }
        }
      }
    ]
  }
}
```

سپس لاگر را از پیکربندی بسازید:

```csharp
using Serilog;
using Microsoft.Extensions.Configuration;

IConfiguration configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json")
    .Build();

Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(configuration)
    .CreateLogger();
```

> توکن را بیرون از کنترل نسخه نگه دارید. به‌جای کامیت کردنش در `appsettings.json`، از یک متغیر محیطی یا انباره اسرار ارجاعش دهید و هنگام راه‌اندازی به پیکربندی تزریقش کنید.

## یکپارچه‌سازی با ASP.NET Core

برای ASP.NET Core (میزبانی کمینه ‎.NET 6 به بالا)، از `Serilog.AspNetCore` استفاده کنید تا Serilog جای لاگر پیش‌فرض را بگیرد و گزارش‌های چارچوب و درخواست را هم ثبت کند:

```csharp
using Serilog;
using Serilog.Sinks.OpenTelemetry;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) =>
{
    configuration
        .ReadFrom.Configuration(context.Configuration)
        .Enrich.FromLogContext()
        .WriteTo.OpenTelemetry(options =>
        {
            options.Endpoint = "https://oneuptime.com/otlp";
            options.Protocol = OtlpProtocol.HttpProtobuf;
            options.Headers = new Dictionary<string, string>
            {
                ["x-oneuptime-token"] = "YOUR_TELEMETRY_INGESTION_TOKEN"
            };
            options.ResourceAttributes = new Dictionary<string, object>
            {
                ["service.name"] = "my-service"
            };
        });
});

// Logs one summary event per HTTP request.
var app = builder.Build();
app.UseSerilogRequestLogging();

app.MapGet("/", () => "Hello World");
app.Run();
```

## نوشتن گزارش‌ها

پس از پیکربندی، Serilog را همان‌طور که همیشه به کار می‌برید به کار ببرید. ویژگی‌های ساخت‌یافته حفظ می‌شوند و در OneUptime به ویژگی‌های قابل جستجو تبدیل می‌شوند:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

هر ویژگی نام‌دار (`OrderId`، `CustomerId`، `Amount`، `LatencyMs`) به‌عنوان یک ویژگی گزارش فرستاده می‌شود، پس می‌توانید در کاوشگر **Products → Logs** بر پایه‌شان بپالایید و جستجو کنید.

## استثناها

وقتی استثنایی را با Serilog گزارش می‌کنید، سینک ویژگی‌های `exception.type`، `exception.message` و `exception.stacktrace` در OpenTelemetry را به رکورد گزارش پیوست می‌کند:

```csharp
try
{
    ProcessPayment();
}
catch (Exception ex)
{
    Log.Error(ex, "Failed to process payment for order {OrderId}", orderId);
}
```

‏OneUptime این ویژگی‌ها را تشخیص می‌دهد و خطا را به‌طور خودکار در نمای **Exceptions** (‏Issues) می‌غلتاند، گروه‌بندی‌شده بر پایه اثر انگشت و منتسب به سرویس درست. خطایی که هم ردیابی و هم گزارش آن را گزارش کنند، در یک issue تنها فرو می‌ریزد. برای جزئیات نحوه کار تشخیص، [استثناها از گزارش‌ها](/docs/telemetry/open-telemetry) را ببینید.

## هم‌بستگی با ردیابی

اگر برنامه شما برای ردیابی با SDK ‏OpenTelemetry برای ‎.NET هم ابزارگذاری شده باشد، رویدادهای گزارش Serilog که درون یک اسپن فعال منتشر می‌شوند به‌طور خودکار با `TraceId` و `SpanId` جاری مهر می‌خورند (این بخشی از `IncludedData` پیش‌فرض سینک است). این به OneUptime امکان می‌دهد یک خط گزارش را مستقیم به ردیابی‌ای که در آن رخ داده پیوند دهد، تا بتوانید از یک گزارش به درخواست پیرامونش و برعکس بپرید.

## بررسی

1. برنامه‌تان را اجرا کنید و چند رویداد گزارش تولید کنید.
2. ‏OneUptime را باز کنید، به **Telemetry** بروید، سرویستان (`my-service`) را برگزینید و **Logs** را باز کنید.
3. باید رویدادهای Serilog خود را ظرف چند ثانیه ببینید، با ویژگی‌های ساخت‌یافته‌شان که به‌عنوان پالایه در دسترس‌اند.

## رفع اشکال

- **هیچ گزارشی پدیدار نمی‌شود** — مقدار `x-oneuptime-token` را دوباره بررسی کنید و تأیید کنید که به پروژه‌ای که می‌بینید تعلق دارد. تأیید کنید نقطه پایانی `https://oneuptime.com/otlp` باشد (فقط مسیر پایه — خودتان `/v1/logs` را نیفزایید).
- **گزارش‌ها فقط هنگام خروج برنامه پدیدار می‌شوند، یا آخرین گزارش‌ها نیستند** — مطمئن شوید `Log.CloseAndFlush()` هنگام خاموشی اجرا می‌شود. سینک رویدادها را دسته‌بندی می‌کند، پس اگر فرایند بدون تخلیه کشته شود گزارش‌های بافرشده از دست می‌روند.
- **`401 Unauthorized` / چیزی دریافت نمی‌شود** — توکن نیست یا نامعتبر است. تأیید کنید کلید هدر دقیقاً `x-oneuptime-token` باشد.
- **نام سرویس اشتباه** — مقدار `service.name` را در `ResourceAttributes` (در کد) یا `resourceAttributes` (در appsettings.json) تنظیم کنید. بدون آن، گزارش‌ها به سرویسی پیش‌فرض/ناشناخته بازمی‌گردند.
- **خطاهای اتصال به نمونه خودمیزبان** — مطمئن شوید پروتکل با طرح نقطه پایانی‌تان می‌خواند (`https://` در برابر `http://`) و میزبان OneUptime شما از برنامه دست‌یافتنی است.

اگر پرسشی دارید یا کمکی لازم دارید، لطفاً با support@oneuptime.com تماس بگیرید.
