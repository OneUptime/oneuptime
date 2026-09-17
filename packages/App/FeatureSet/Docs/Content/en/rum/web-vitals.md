# Core Web Vitals

The **Core Web Vitals** card on a RUM application's overview shows LCP, INP, CLS, FCP and TTFB, each averaged over the selected time range and rated good / needs improvement / poor.

Nothing is inferred or synthesised. The card is populated entirely from metrics **your** browser instrumentation reports. If it says *No web vitals reported yet*, your app is not emitting them — this page is how to start.

## Why it needs configuration at all

OpenTelemetry has no finalised semantic convention for web vitals. Different SDKs and community integrations picked different metric names, so OneUptime probes a list of known names for each vital and uses the first one that has data.

That means you do not have to match one exact name — but you do have to use one of the names below.

## Metric names OneUptime recognises

Names are tried in order; the first with data in the selected range wins.

| Vital | Metric names (any one) | Unit |
| --- | --- | --- |
| **LCP** — Largest Contentful Paint | `web_vital.lcp`, `browser.largest_contentful_paint`, `largest_contentful_paint`, `web.vitals.lcp` | ms |
| **INP** — Interaction to Next Paint | `web_vital.inp`, `browser.interaction_to_next_paint`, `interaction_to_next_paint`, `web.vitals.inp` | ms |
| **CLS** — Cumulative Layout Shift | `web_vital.cls`, `browser.cumulative_layout_shift`, `cumulative_layout_shift`, `web.vitals.cls` | score |
| **FCP** — First Contentful Paint | `web_vital.fcp`, `browser.first_contentful_paint`, `first_contentful_paint`, `web.vitals.fcp` | ms |
| **TTFB** — Time to First Byte | `web_vital.ttfb`, `browser.time_to_first_byte`, `time_to_first_byte`, `web.vitals.ttfb` | ms |

Use the `web_vital.*` names for new instrumentation. The others exist so that an app already emitting a community convention shows up without being rewritten.

## Rating thresholds

These are Google's published Core Web Vitals thresholds, applied to the range average:

| Vital | Good | Needs improvement | Poor |
| --- | --- | --- | --- |
| LCP | < 2500 ms | 2500 – 4000 ms | ≥ 4000 ms |
| INP | < 200 ms | 200 – 500 ms | ≥ 500 ms |
| CLS | < 0.1 | 0.1 – 0.25 | ≥ 0.25 |
| FCP | < 1800 ms | 1800 – 3000 ms | ≥ 3000 ms |
| TTFB | < 800 ms | 800 – 1800 ms | ≥ 1800 ms |

The card averages, which is deliberately simple and is **not** the same as the p75 that Google's field tooling reports. Read it as a trend indicator; use the Metrics tab when you need a percentile.

## Emitting them

The [`web-vitals`](https://github.com/GoogleChrome/web-vitals) library does the measurement — getting LCP, INP and CLS right from scratch is genuinely hard, and it is the same library Chrome's own tooling uses. You only have to forward what it reports.

```bash
npm install web-vitals
```

This assumes you already have a metrics pipeline from [Browser Setup](/docs/rum/browser-setup) — the `MeterProvider` is what actually exports these.

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

Then import it once, after your telemetry setup:

```ts
import "./telemetry";
import "./web-vitals";
```

### A note on timing

`onINP` and `onCLS` report on page hide, not during the visit. With the 30-second export interval from the browser guide, a user who closes the tab immediately after the final value may leave before the export happens. If you care about completeness, shorten `exportIntervalMillis`, or keep a reference to the `MeterProvider` you built in `telemetry.ts` and force a flush on `visibilitychange`:

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

## Keeping cardinality under control

Metric attributes multiply. `web_vital.rating` has three possible values, which is fine. A route or page-type attribute is usually worth it:

```ts
histogram.record(metric.value, {
  "web_vital.rating": metric.rating,
  "app.route": routePattern, // "/product/:id" — the PATTERN, not "/product/8842"
});
```

Recording the concrete URL instead of the route pattern creates one time series per product page, which will make the Metrics tab slow and the storage bill large. The same applies to user ids, session ids and screen sizes.

## Checking your work

Web vitals are ordinary metrics, so they are queryable on the application's **Metrics** tab before the overview card picks them up. Search for `web_vital.lcp` there: if the metric is present but the card is blank, the range you selected has no data in it; if the metric is absent, the export never arrived — start at [Troubleshooting](/docs/rum/troubleshooting).

You can also alert on them like any other metric, with a **Metrics Monitor** — for example, "LCP over the last hour is above 4000 ms". See [Metrics Monitor](/docs/monitor/metrics-monitor).
