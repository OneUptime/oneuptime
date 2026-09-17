# راه‌اندازی موبایل

برنامه‌ای Android، ‏iOS یا React Native را ابزارگذاری کنید تا به OneUptime به‌عنوان برنامه RUM موبایلی گزارش دهد.

## ‏OneUptime چه لازم دارد

دو چیز، و فقط دو چیز:

1. **`service.name`** — هویت برنامه، برای نمونه `storefront-android`.
2. **دست‌کم یکی از `device.id`، `device.model.identifier` یا `device.manufacturer`** — همین است که تله‌متری را *موبایلی* علامت می‌زند نه سرویسی بک‌اند.

هر دو ویژگی **منبع**اند، و هر دو باید روی هر دسته‌ای که صادر می‌کنید باشند. اگر ویژگی‌های دستگاه نباشند، تله‌متری همچنان می‌رسد و همچنان قابل پرس‌وجوست — فقط به‌جای برنامه RUM به‌عنوان Service بک‌اند بایگانی می‌شود.

مقدار `device.id` باید شناسه‌ای محدود به نصب باشد، نه شناسه تبلیغاتی یا هر چیزی که شخصی را شناسایی می‌کند. برای گروه‌بندی به کار می‌رود، هرگز به‌عنوان هویت نمایش داده نمی‌شود.

## پیکربندی مشترک

هر SDK ‏OpenTelemetry موبایلی کلیدهای استاندارد محیطی/پیکربندی را می‌خواند، پس سمت OneUptime همه‌جا یکی است:

| تنظیم | مقدار |
| --- | --- |
| نقطه پایانی OTLP | `https://oneuptime.com/otlp` |
| هدر | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| ردیابی‌ها | `POST https://oneuptime.com/otlp/v1/traces` |
| سنجه‌ها | `POST https://oneuptime.com/otlp/v1/metrics` |
| گزارش‌ها | `POST https://oneuptime.com/otlp/v1/logs` |

توکن را در _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید. خودمیزبان: به‌جای میزبان، میزبان خودتان را بگذارید.

چون توکن باینری موبایلی منتشرشده را نمی‌توان سریع چرخاند، با آن همان‌گونه رفتار کنید که با توکن مرورگر — اعتبارنامه‌ای فقط برای دریافت است و عملاً عمومی است.

> قطعه‌های زیر شکل پیکربندی را نشان می‌دهند. SDKهای موبایلی OpenTelemetry پیش از نسخه ۱٫۰ هستند و APIهای سازنده‌شان میان انتشارها تغییر می‌کند، پس نام دقیق متدها را در برابر نسخه‌ای که سنجاق می‌کنید بررسی کنید. آنچه OneUptime لازم دارد — نقطه پایانی، هدر، `service.name` و یک ویژگی `device.*` — تغییر نمی‌کند.

## Android

عامل [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) را بیفزایید:

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("io.opentelemetry.android:android-agent:<latest>")
}
```

```kotlin
// Application.onCreate()
val config = OtelRumConfig()

val rum = OpenTelemetryRum.builder(this, config)
    .addSpanExporterCustomizer {
        OtlpHttpSpanExporter.builder()
            .setEndpoint("https://oneuptime.com/otlp/v1/traces")
            .addHeader("x-oneuptime-token", BuildConfig.ONEUPTIME_TOKEN)
            .build()
    }
    .addResourceCustomizer { resource, _ ->
        resource.toBuilder()
            .put("service.name", "storefront-android")
            .build()
    }
    .build()
```

منبع خود عامل Android مقادیر `device.model.identifier`، `device.manufacturer` و `device.id` محدود به نصب را فراهم می‌کند، پس دسته‌بندی بدون پیکربندی اضافه کار می‌کند. **روی نسخه خودتان تأییدش کنید** — اگر زبانه Clients خالی بماند در حالی که Traces پر می‌شود، همان ویژگی‌های دستگاه است که کم است، و می‌توانید در همان بلوک `addResourceCustomizer` بیفزاییدشان.

اگر به‌جای استفاده از عامل، SDK را دستی می‌سازید، خودتان تنظیمشان کنید:

```kotlin
.addResourceCustomizer { resource, _ ->
    resource.toBuilder()
        .put("service.name", "storefront-android")
        .put("device.manufacturer", Build.MANUFACTURER)
        .put("device.model.identifier", Build.MODEL)
        .build()
}
```

## iOS / Swift

از [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) استفاده کنید:

```swift
let resource = Resource(attributes: [
    "service.name": .string("storefront-ios"),
    "device.model.identifier": .string(UIDevice.current.model),
    "device.manufacturer": .string("Apple"),
    "telemetry.sdk.language": .string("swift"),
])

let exporter = OtlpHttpTraceExporter(
    endpoint: URL(string: "https://oneuptime.com/otlp/v1/traces")!,
    config: OtlpConfiguration(
        headers: [("x-oneuptime-token", oneUptimeToken)]
    )
)

OpenTelemetry.registerTracerProvider(
    tracerProvider: TracerProviderBuilder()
        .with(resource: resource)
        .add(spanProcessor: BatchSpanProcessor(spanExporter: exporter))
        .build()
)
```

تنظیم صریح ویژگی‌های دستگاه، مانند بالا، مسیر قابل اتکا روی iOS است — منبعی که نسخه‌ای مشخص از SDK می‌دهد میان انتشارها تغییر کرده است.

## React Native / Expo

‏React Native ‏SDK ‏JavaScript را اجرا می‌کند، پس راه‌اندازی همان [راه‌اندازی مرورگر](/docs/rum/browser-setup) است با دو تفاوت: `browserDetector` وجود ندارد (`navigator.userAgentData` نیست)، و باید خودتان ویژگی‌های دستگاه را بدهید تا تله‌متری به‌جای سرویس بک‌اند موبایلی دسته‌بندی شود.

```ts
import { Platform } from "react-native";
import * as Device from "expo-device"; // or react-native-device-info
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";

const resource = defaultResource().merge(
  resourceFromAttributes({
    "service.name": "storefront-mobile",
    "device.manufacturer": Device.manufacturer ?? Platform.OS,
    "device.model.identifier": Device.modelId ?? "unknown",
    "telemetry.sdk.language": "webjs",
  }),
);
```

باقی همه‌چیز — صادرکننده OTLP، پردازشگر دسته‌ای، ثبت ارائه‌دهنده — با راهنمای مرورگر یکسان است.

## هر پلتفرم دیگری

هیچ‌چیز ویژه Android یا iOS در مسیر دریافت نیست. Flutter، ‏Unity، ‏.NET MAUI، کلاینتی نهفته، یا نویسنده‌ای دست‌ساز از OTLP همه کار می‌کنند تا وقتی منبع `service.name` به‌علاوه یک ویژگی `device.*` را حمل کند. شکل متغیر محیطی برای هر SDKای که آن را می‌خواند کار می‌کند:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-mobile,device.manufacturer=Acme,device.model.identifier=AC-100"
```

## تأیید

پیش از گشتن در پیکربندی SDK، توکن را بررسی کنید:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

پاسخ `200` با `"valid": true` یعنی توکن به پروژه‌ای تفکیک می‌شود. پاسخ `401` یعنی توکن اشتباه است، و هیچ اندازه پیکربندی SDK کمکی نمی‌کند.

سپس برنامه را بارگذاری کنید. با نخستین دسته تله‌متری‌اش زیر **Resources → Real User Monitoring** پدیدار می‌شود. اگر به‌جایش زیر Services پدیدار شد، ویژگی‌های `device.*` به منبع نمی‌رسند — [رفع اشکال](/docs/rum/troubleshooting) را ببینید.

## چه چیزی روی موبایل در دسترس نیست

بازپخش نشست فقط مرورگری است. ضبط‌کننده‌ای از DOM است که با برچسب اسکریپت بارگذاری می‌شود، پس در برنامه‌ای بومی چیزی برای ضبط ندارد. برنامه‌های موبایلی ردیابی، گزارش، سنجه، استثنا و موجودی Clients را می‌گیرند؛ زبانه Session Replay خالی می‌ماند.
