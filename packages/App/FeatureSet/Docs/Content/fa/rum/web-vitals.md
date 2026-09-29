# Core Web Vitals

کارت **Core Web Vitals** در نمای کلی یک برنامه RUM مقادیر LCP، ‏INP، ‏CLS، ‏FCP و TTFB را نشان می‌دهد، هرکدام میانگین‌گرفته روی بازه زمانی برگزیده و رتبه‌بندی‌شده به خوب / نیازمند بهبود / ضعیف.

هیچ‌چیز استنتاج یا ساخته نمی‌شود. کارت کاملاً از سنجه‌هایی پر می‌شود که ابزارگذاری مرورگری **شما** گزارش می‌کند. اگر می‌گوید *No web vitals reported yet*، برنامه شما آن‌ها را منتشر نمی‌کند — این صفحه راه آغازش است.

## چرا اصلاً به پیکربندی نیاز دارد

‏OpenTelemetry برای web vitals قرارداد معنایی نهایی‌ای ندارد. SDKها و یکپارچه‌سازی‌های اجتماعی مختلف نام‌های متفاوتی برگزیدند، پس OneUptime برای هر معیار حیاتی فهرستی از نام‌های شناخته را می‌کاود و نخستین نامی را که داده دارد به کار می‌برد.

یعنی لازم نیست دقیقاً یک نام را رعایت کنید — اما باید یکی از نام‌های زیر را به کار ببرید.

## نام سنجه‌هایی که OneUptime می‌شناسد

نام‌ها به ترتیب آزموده می‌شوند؛ نخستین نامی که در بازه برگزیده داده دارد برنده است.

| معیار حیاتی | نام سنجه (هرکدام) | یکا |
| --- | --- | --- |
| **LCP** — Largest Contentful Paint | `web_vital.lcp`، `browser.largest_contentful_paint`، `largest_contentful_paint`، `web.vitals.lcp` | میلی‌ثانیه |
| **INP** — Interaction to Next Paint | `web_vital.inp`، `browser.interaction_to_next_paint`، `interaction_to_next_paint`، `web.vitals.inp` | میلی‌ثانیه |
| **CLS** — Cumulative Layout Shift | `web_vital.cls`، `browser.cumulative_layout_shift`، `cumulative_layout_shift`، `web.vitals.cls` | امتیاز |
| **FCP** — First Contentful Paint | `web_vital.fcp`، `browser.first_contentful_paint`، `first_contentful_paint`، `web.vitals.fcp` | میلی‌ثانیه |
| **TTFB** — Time to First Byte | `web_vital.ttfb`، `browser.time_to_first_byte`، `time_to_first_byte`، `web.vitals.ttfb` | میلی‌ثانیه |

برای ابزارگذاری تازه از نام‌های `web_vital.*` استفاده کنید. بقیه وجود دارند تا برنامه‌ای که از پیش قراردادی اجتماعی منتشر می‌کند بدون بازنویسی پدیدار شود.

## آستانه‌های رتبه‌بندی

این‌ها آستانه‌های منتشرشده Core Web Vitals گوگل‌اند که روی میانگین بازه اعمال می‌شوند:

| معیار حیاتی | خوب | نیازمند بهبود | ضعیف |
| --- | --- | --- | --- |
| LCP | < ۲۵۰۰ میلی‌ثانیه | ۲۵۰۰ تا ۴۰۰۰ میلی‌ثانیه | ≥ ۴۰۰۰ میلی‌ثانیه |
| INP | < ۲۰۰ میلی‌ثانیه | ۲۰۰ تا ۵۰۰ میلی‌ثانیه | ≥ ۵۰۰ میلی‌ثانیه |
| CLS | < ۰٫۱ | ۰٫۱ تا ۰٫۲۵ | ≥ ۰٫۲۵ |
| FCP | < ۱۸۰۰ میلی‌ثانیه | ۱۸۰۰ تا ۳۰۰۰ میلی‌ثانیه | ≥ ۳۰۰۰ میلی‌ثانیه |
| TTFB | < ۸۰۰ میلی‌ثانیه | ۸۰۰ تا ۱۸۰۰ میلی‌ثانیه | ≥ ۱۸۰۰ میلی‌ثانیه |

کارت میانگین می‌گیرد، که عمداً ساده است و **همان** p75ای **نیست** که ابزارهای میدانی گوگل گزارش می‌دهند. آن را نشانگر روند بخوانید؛ وقتی صدک لازم دارید از زبانه Metrics استفاده کنید.

## منتشر کردنشان

کتابخانه [`web-vitals`](https://github.com/GoogleChrome/web-vitals) اندازه‌گیری را انجام می‌دهد — درست درآوردن LCP، ‏INP و CLS از صفر واقعاً سخت است، و همان کتابخانه‌ای است که ابزارهای خود Chrome به کار می‌برند. شما فقط باید آنچه را گزارش می‌کند فوروارد کنید.

```bash
npm install web-vitals
```

این فرض می‌گیرد که از پیش خط لوله سنجه‌ای از [راه‌اندازی مرورگر](/docs/rum/browser-setup) دارید — `MeterProvider` همان چیزی است که واقعاً این‌ها را صادر می‌کند.

```ts
// src/web-vitals.ts — import after ./telemetry
import { metrics } from "@opentelemetry/api";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

const meter = metrics.getMeter("web-vitals");

// Histograms, so the Metrics tab can compute percentiles later.
const lcp = meter.createHistogram("web_vital.lcp", { unit: "ms" });
const inp = meter.createHistogram("web_vital.inp", { unit: "ms" });
const fcp = meter.createHistogram("web_vital.fcp", { unit: "ms" });
const ttfb = meter.createHistogram("web_vital.ttfb", { unit: "ms" });
const cls = meter.createHistogram("web_vital.cls", { unit: "1" });

function record(
  histogram: { record: (v: number, a?: Record<string, string>) => void },
) {
  return (metric: Metric): void => {
    histogram.record(metric.value, {
      // Keep attributes low-cardinality. Never put a full URL or a user id here.
      "web_vital.rating": metric.rating,
    });
  };
}

onLCP(record(lcp));
onINP(record(inp));
onCLS(record(cls));
onFCP(record(fcp));
onTTFB(record(ttfb));
```

سپس یک بار، پس از راه‌اندازی تله‌متری، واردش کنید:

```ts
import "./telemetry";
import "./web-vitals";
```

### یادداشتی درباره زمان‌بندی

توابع `onINP` و `onCLS` هنگام پنهان شدن صفحه گزارش می‌دهند، نه در حین بازدید. با فاصله صادرات ۳۰ ثانیه‌ای راهنمای مرورگر، کاربری که بلافاصله پس از مقدار نهایی زبانه را می‌بندد ممکن است پیش از رخ دادن صادرات برود. اگر کامل بودن برایتان مهم است، `exportIntervalMillis` را کوتاه کنید، یا ارجاعی به `MeterProvider` ساخته‌شده در `telemetry.ts` نگه دارید و روی `visibilitychange` تخلیه را وادار کنید:

```ts
// In telemetry.ts, export the provider you created:
export const meterProvider = new MeterProvider({ /* ... */ });

// Anywhere after setup:
import { meterProvider } from "./telemetry";

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void meterProvider.forceFlush();
  }
});
```

## مهار کردن تنوع

ویژگی‌های سنجه ضرب می‌شوند. `web_vital.rating` سه مقدار ممکن دارد، که مشکلی نیست. ویژگی مسیر یا نوع صفحه معمولاً ارزشش را دارد:

```ts
histogram.record(metric.value, {
  "web_vital.rating": metric.rating,
  "app.route": routePattern, // "/product/:id" — the PATTERN, not "/product/8842"
});
```

ثبت نشانی مشخص به‌جای الگوی مسیر، به ازای هر صفحه محصول یک سری زمانی می‌سازد، که زبانه Metrics را کند و صورت‌حساب ذخیره‌سازی را بزرگ می‌کند. همین درباره شناسه کاربر، شناسه نشست و اندازه صفحه هم صدق می‌کند.

## بررسی کارتان

‏Web vitals سنجه‌های معمولی‌اند، پس پیش از آنکه کارت نمای کلی برشان دارد در زبانه **Metrics** برنامه قابل پرس‌وجو هستند. آنجا `web_vital.lcp` را جستجو کنید: اگر سنجه هست اما کارت خالی است، بازه‌ای که برگزیده‌اید داده ندارد؛ اگر سنجه نیست، صادرات هرگز نرسیده — از [رفع اشکال](/docs/rum/troubleshooting) آغاز کنید.

می‌توانید مانند هر سنجه دیگری هم بر آن‌ها هشدار بگذارید، با یک **مانیتور سنجه** — برای نمونه، «LCP در ساعت گذشته بالای ۴۰۰۰ میلی‌ثانیه است». [مانیتور سنجه](/docs/monitor/metrics-monitor) را ببینید.
