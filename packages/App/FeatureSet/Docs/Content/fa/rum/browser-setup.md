# راه‌اندازی مرورگر

برنامه‌ای وب را با SDK مرورگری OpenTelemetry ابزارگذاری کنید تا به OneUptime به‌عنوان برنامه‌ای RUM گزارش دهد.

## پیش‌نیازها

یک **توکن دریافت تله‌متری**. در داشبورد به _Project Settings → Telemetry & APM → Ingestion Keys_ بروید و روی **Create Ingestion Key** کلیک کنید.

![Telemetry Ingestion Keys](/docs/static/images/TelemetryIngestionKeys.png)

روی کلیدی که ساختید **View** را بزنید تا توکن را بخوانید.

![View Telemetry Ingestion Key](/docs/static/images/TelemetryIngestionKeyView.png)

توکن در JavaScript صفحه شما جاسازی می‌شود، پس عمومی بدانیدش. فقط دریافت را اعطا می‌کند — نمی‌تواند چیزی از پروژه‌تان بخواند. اگر [بازپخش نشست](/docs/telemetry/session-replay) را هم فعال کنید، آنجا فهرست مبدأهای مجاز بگذارید تا توکنی کپی‌شده نتواند ضبط‌هایی را در پروژه شما بنویسد.

## نصب

```bash
npm install @opentelemetry/api \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/opentelemetry-browser-detector \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/context-zone \
  @opentelemetry/instrumentation \
  @opentelemetry/instrumentation-document-load \
  @opentelemetry/instrumentation-fetch \
  @opentelemetry/instrumentation-xml-http-request
```

## پیکربندی

فایل `src/telemetry.ts` را بسازید و **پیش از هر چیز دیگری** در نقطه ورودتان واردش کنید — ابزارگذاری‌ها `fetch` و `XMLHttpRequest` را وصله می‌کنند، و هر چیزی که پیش از وصله اجرا شود ردیابی نمی‌شود.

```ts
// src/telemetry.ts
import {
  WebTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import {
  defaultResource,
  detectResources,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { browserDetector } from "@opentelemetry/opentelemetry-browser-detector";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const ONEUPTIME_URL = "https://oneuptime.com";
const ONEUPTIME_TOKEN = "YOUR_TELEMETRY_INGESTION_TOKEN";

/*
 * browserDetector supplies the browser.* attributes. Without them this
 * telemetry is classified as a backend Service, not a RUM application.
 * The attributes set last win, so service.name here overrides the
 * "unknown_service" that defaultResource() provides.
 */
const resource = defaultResource()
  .merge(detectResources({ detectors: [browserDetector] }))
  .merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "storefront-web",
    }),
  );

const provider = new WebTracerProvider({
  resource: resource,
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${ONEUPTIME_URL}/otlp/v1/traces`,
        headers: { "x-oneuptime-token": ONEUPTIME_TOKEN },
      }),
    ),
  ],
});

provider.register({
  contextManager: new ZoneContextManager(),
});

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({
      // See "Linking to your backend traces" below before widening this.
      propagateTraceHeaderCorsUrls: [/^https:\/\/api\.example\.com/],
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [/^https:\/\/api\.example\.com/],
    }),
  ],
});
```

سپس، به‌عنوان **نخستین** import برنامه‌تان:

```ts
// src/index.tsx (React), src/main.ts (Vue / Angular), etc.
import "./telemetry";
import React from "react";
// ... the rest of your app
```

صفحه‌ای بارگذاری کنید. ظرف یک دقیقه برنامه زیر **Resources → Real User Monitoring** با نام `service.name` خود پدیدار می‌شود.

## تنظیم `browser.*` بدون تشخیص‌دهنده

مؤلفه `browserDetector` از [API ‏UA Client Hints](https://wicg.github.io/ua-client-hints/) می‌خواند. آن API فقط Chromium است، پس روی Safari و Firefox تشخیص‌دهنده `browser.language` و `user_agent.original` را می‌گذارد اما `browser.platform`، `browser.brands` یا `browser.mobile` را **نه**.

این هنوز برای دسته‌بندی بس است — `browser.language` به‌تنهایی دسته را RUM مرورگری علامت می‌زند — اما زبانه **Clients** از `browser.platform` پر می‌شود، پس ترافیک Safari و Firefox تا وقتی خودتان تأمینش نکنید سطر کلاینتی تولید نمی‌کند.

اگر ترجیح می‌دهید اصلاً وابستگی تشخیص‌دهنده را نیفزایید، یا روی هر مرورگری مقدار پلتفرم می‌خواهید، ویژگی‌ها را مستقیم بگذارید:

```ts
const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "storefront-web",
    // Any one of these three marks the telemetry as browser RUM.
    "browser.language": navigator.language,
    "browser.platform":
      (navigator as any).userAgentData?.platform ?? "unknown",
    "browser.mobile": (navigator as any).userAgentData?.mobile ?? false,
    "user_agent.original": navigator.userAgent,
  }),
);
```

مقدار `browser.platform` را درشت نگه دارید. ویژگی **منبع** است، پس هر مقدار متمایزی به سطری در زبانه Clients تبدیل می‌شود — گذاشتن رشته کامل عامل کاربر یا مقداری به ازای هر کاربر آنجا، فهرستی بی‌کران می‌سازد و افزون بر آن مشکلی برای حریم خصوصی است.

## برنامه‌های تک‌صفحه‌ای

مؤلفه `DocumentLoadInstrumentation` فقط بارگذاری اولیه را ردیابی می‌کند. در یک SPA، تغییرهای مسیر بعدی نامرئی‌اند مگر خودتان منتشرشان کنید، که معمولاً چند خط در مسیریابتان است:

```ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("app-router");

function onRouteChange(to: string): void {
  const span = tracer.startSpan("route-change", {
    attributes: { "app.route": to },
  });
  // End it when the route's data has loaded and the view has painted.
  requestAnimationFrame(() => {
    return span.end();
  });
}
```

اگر می‌خواهید کلیک‌ها و دیگر رویدادهای DOM هم ردیابی شوند، افزودن `@opentelemetry/instrumentation-user-interaction` می‌ارزد.

## پیوند دادن به ردیابی‌های بک‌اندتان

مقدار `propagateTraceHeaderCorsUrls` تصمیم می‌گیرد کدام درخواست‌های میان‌مبدأ هدر `traceparent` استاندارد W3C بگیرند، و اسپن مرورگر را به ردیابی بک‌اندی که راه انداخته می‌پیوندد.

**آن را روی `/.*/` نگذارید.** افزودن هدری، درخواست میان‌مبدأ ساده را به درخواستی با preflight تبدیل می‌کند، و هر API شخص ثالثی که `traceparent` را در `Access-Control-Allow-Headers` خود فهرست نکرده باشد شروع به شکست می‌کند — چون شما ابزارگذاری نصب کرده‌اید. فقط مبدأهایی را فهرست کنید که کنترلشان می‌کنید و پیکربندی‌شان کرده‌اید:

```ts
new FetchInstrumentation({
  propagateTraceHeaderCorsUrls: [
    /^https:\/\/api\.example\.com/,
    /^https:\/\/auth\.example\.com/,
  ],
});
```

درخواست‌های هم‌مبدأ بدون هیچ پیکربندی‌ای انتشار می‌یابند. با نصب [بازپخش نشست](/docs/telemetry/session-replay)، همین درخواست‌ها شناسه نشست بازپخش را هم حمل می‌کنند، که تله‌متری بک‌اندتان را به ضبط پیوند می‌دهد؛ [پیوستن ردیابی‌ها به بازپخش نشست](#پیوستن-ردیابیها-به-بازپخش-نشست) را ببینید.

## پیوستن ردیابی‌ها به بازپخش نشست

اگر [بازپخش نشست](/docs/telemetry/session-replay) را هم اجرا می‌کنید، تله‌متری **بک‌اند** شما بی‌هیچ کدی در این‌جا به ضبط می‌پیوندد. تا وقتی نشستی فرستاده می‌شود، ضبط‌کننده به درخواست‌هایی که صفحه شما به مبدأ خودش می‌زند عضوی از `tracestate` می‌افزاید که شناسه نشست را حمل می‌کند، و `traceparent` را به `FetchInstrumentation` / `XMLHttpRequestInstrumentation` شما می‌سپارد. اسپن‌های بک‌اند شما هنگام دریافت، در هر سرویسی که زمینه ردیابی W3C را ادامه دهد، با شناسه نشست مهر می‌خورند، و گزارش‌ها و استثناهایش بر پایه شناسه ردیابی به ضبط می‌پیوندند. برای اینکه چطور کار می‌کند، چه چیزی را پوشش نمی‌دهد و کلیدی که خاموشش می‌کند، [همبسته کردن با دیگر تله‌متری شما](/docs/telemetry/session-replay#correlating-with-your-other-telemetry) را ببینید.

ضبط‌کننده هدر `traceparent`ای را هم که ابزارگذاری‌های شما می‌گذارند بازمی‌خواند — چه فراخوانی یک نشانی بدهد (با شیء init یا بی آن) و چه شیئی از نوع `Request` — پس سطر هر درخواست در بازپخش به ردیابی بک‌اندش پیوند می‌خورد. برای APIای روی مبدأی دیگر، آن را در `propagateTraceHeaderCorsUrls` بالا فهرست کنید؛ درخواست‌هایش هیچ شناسه نشستی حمل نمی‌کنند و بر پایه شناسه ردیابی به ضبط می‌پیوندند. گزینه **Trace propagation origins** در سیاست بازپخش برنامه همین کار را برای صفحه‌هایی می‌کند که این SDK را *ندارند*.

آنچه هدرها به آن نمی‌رسند اسپن‌های مرورگری خود این SDK است: بارگذاری سند، تغییر مسیرها و خطاهایی که گزارش می‌کنید. برای اینکه آن‌ها هم زیر ضبط بایگانی شوند، `session.id` را هنگام آغاز هر اسپن رویش مهر بزنید. ضبط‌کننده شناسه را از راه `onSessionChange` به شما می‌گوید، که اگر نشستی از پیش وجود داشته باشد بی‌درنگ شلیک می‌کند و هر بار که شناسه بچرخد دوباره (پس از ۳۰ دقیقه بیکاری، در سقف ۴ ساعت، یا وقتی زبانه دیگری از همان بازدیدکننده زودتر چرخانده باشد):

```ts
// src/replaySession.ts
import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-web";

declare global {
  interface Window {
    OneUptimeReplayQueue?: Array<Array<unknown>>;
  }
}

let replaySessionId: string | null = null;

// The recorder script loads asynchronously. The queue is applied the
// moment it starts and stays live afterwards, so this works either way.
(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push([
  "onSessionChange",
  (sessionId: string): void => {
    replaySessionId = sessionId;
  },
]);

export class ReplaySessionSpanProcessor implements SpanProcessor {
  public onStart(span: Span, _parentContext: Context): void {
    if (replaySessionId) {
      span.setAttribute("session.id", replaySessionId);
    }
  }

  public onEnd(_span: ReadableSpan): void {}

  public forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  public shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
```

سپس آن را نخستین پردازشگر اسپن ارائه‌دهنده در `src/telemetry.ts` بگذارید:

```ts
import { ReplaySessionSpanProcessor } from "./replaySession";

const provider = new WebTracerProvider({
  resource: resource,
  spanProcessors: [
    new ReplaySessionSpanProcessor(),
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${ONEUPTIME_URL}/otlp/v1/traces`,
        headers: { "x-oneuptime-token": ONEUPTIME_TOKEN },
      }),
    ),
  ],
});
```

اسپن‌هایی که پس از آن آغاز می‌شوند شناسه را حمل می‌کنند، زبانه **Traces** پخش‌کننده بازپخش آن‌ها را روی ساعت ضبط فهرست می‌کند، و هر یک از آن‌ها در داشبورد به همان لحظه در بازپخش پیوند می‌خورد. پردازشگر اسپن هر اسپن را با شناسه‌ای مهر می‌زند که هنگام آغازش جاری بوده؛ نوشتن شناسه در `resource.attributes` به‌جایش، اسپن‌هایی را که هنگام چرخش نشست هنوز در دسته صدور منتظر بوده‌اند دوباره برچسب می‌زند. شناسه به‌محض آغاز ضبط‌کننده، پیش از رضایت یا تریگر ثبت، به شنونده گفته می‌شود، پس اگر اهمیت دارد، فقط وقتی صفحه‌تان رضایت دارد مهر بزنید.

## سیاست امنیت محتوا

اگر سایت شما CSP می‌فرستد، درخواست‌های صادرکننده تا وقتی OneUptime را مجاز نکنید مسدودند. خطایی نیست که از ماشین خودتان ببینید — صفحه صرفاً چیزی گزارش نمی‌کند.

```
connect-src 'self' https://oneuptime.com;
```

خودمیزبان: به‌جایش میزبان خودتان را به کار ببرید.

## خطاها و استثناها

خطاهای گرفته‌نشده را SDK مرورگری OpenTelemetry خودکار ثبت نمی‌کند. آن‌ها را صریح گزارش کنید تا در کنار خطاهای بک‌اندتان به نمای **Exceptions** بغلتند:

```ts
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("app-errors");

window.addEventListener("error", (event: ErrorEvent) => {
  const span = tracer.startSpan("window.onerror");
  span.recordException(event.error ?? new Error(event.message));
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
});

window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const span = tracer.startSpan("unhandledrejection");
  span.recordException(
    event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
  );
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
});
```

اگر از [بازپخش نشست](/docs/telemetry/session-replay) استفاده می‌کنید، ضبط‌کننده‌اش خودش خطاهای گرفته‌نشده را ثبت می‌کند و روی خط زمانی بازپخش علامتشان می‌زند، و آنگاه صفحه استثنا کارتی به نام **Watch what the user saw** ارائه می‌دهد که بازپخش را ده ثانیه پیش از خطا باز می‌کند. زیر سیاست پیش‌فرض، نشست چه چیزی پرتاب شود و چه نشود ضبط می‌شود؛ خطا فقط تصمیم می‌گیرد کارت به کجا اشاره کند.

## گزارش‌ها و سنجه‌ها (اختیاری)

ردیابی‌ها برای پر کردن نمای کلی بس‌اند. اگر می‌خواهید گزارش‌های مرورگر در OneUptime قابل جستجو باشند، یا [Core Web Vitals](/docs/rum/web-vitals) می‌خواهید، خط لوله گزارش و سنجه را بیفزایید.

```bash
npm install @opentelemetry/api-logs @opentelemetry/sdk-logs \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http
```

```ts
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { logs } from "@opentelemetry/api-logs";
import { metrics } from "@opentelemetry/api";

const headers = { "x-oneuptime-token": ONEUPTIME_TOKEN };

logs.setGlobalLoggerProvider(
  new LoggerProvider({
    resource: resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${ONEUPTIME_URL}/otlp/v1/logs`,
          headers,
        }),
      }),
    ],
  }),
);

metrics.setGlobalMeterProvider(
  new MeterProvider({
    resource: resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${ONEUPTIME_URL}/otlp/v1/metrics`,
          headers,
        }),
        exportIntervalMillis: 30000,
      }),
    ],
  }),
);
```

همان شیء `resource` را بازاستفاده کنید. خط لوله گزارش یا سنجه‌ای که با منبعی بدون `browser.*` ساخته شود به‌عنوان Service بک‌اند جداگانه‌ای بایگانی می‌شود.

## ‏OneUptime خودمیزبان

در همه‌جای بالا به‌جای `https://oneuptime.com` میزبان خودتان را بگذارید — نشانی‌های OTLP و مدخل CSP. هیچ چیز دیگری تغییر نمی‌کند.

## مرجع نقطه‌های پایانی

| سیگنال | نقطه پایانی | هدر |
| --- | --- | --- |
| ردیابی‌ها | `POST {host}/otlp/v1/traces` | `x-oneuptime-token: <token>` |
| سنجه‌ها | `POST {host}/otlp/v1/metrics` | `x-oneuptime-token: <token>` |
| گزارش‌ها | `POST {host}/otlp/v1/logs` | `x-oneuptime-token: <token>` |

هم OTLP/JSON و هم OTLP/protobuf پذیرفته می‌شوند. نقطه‌های پایانی به درخواست‌های میان‌مبدأ از هر مبدأیی پاسخ می‌دهند و هدر `x-oneuptime-token` را مجاز می‌کنند، پس مرورگر می‌تواند مستقیم به آن‌ها صادر کند — به جمع‌کننده یا پراکسی خودتان نیازی نیست.
