# Core Web Vitals

The **Core Web Vitals** card on a RUM application's overview shows LCP, INP, CLS, FCP and TTFB, each averaged over the selected time range and rated good / needs improvement / poor. Below it, **INP by route** lists the routes with the slowest INP once your INP carries a route — the view that matters in a single-page app. See [Single-page apps](#single-page-apps).

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

The card shows the mean over the whole selected range, which is **not** the same as the p75 that Google's field tooling reports. That is deliberate: OneUptime reads a histogram's percentiles from its bucket boundaries, so a percentile is only as accurate as your buckets, while the mean comes from the histogram's exact sum and count. With OpenTelemetry's default buckets (`0, 5, 10, 25, 50, …`) every CLS value lands in the `0 – 5` bucket, and a p75 would read 2.5 for a page that barely moves.

Read the card as a trend indicator. For the p75, record with the bucket boundaries below and chart the metric on the Metrics tab with the **P75** aggregation — the same choice is available in a Metrics Monitor.

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

// Histograms, so the Metrics tab can compute percentiles later. The bucket
// edges sit on each vital's good / poor limits: a percentile is read from
// the buckets, and the defaults are far too coarse for these ranges.
const buckets = (...edges: number[]) => ({ advice: { explicitBucketBoundaries: edges } });

const lcp = meter.createHistogram("web_vital.lcp", { unit: "ms", ...buckets(0, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 7500, 10000) });
const inp = meter.createHistogram("web_vital.inp", { unit: "ms", ...buckets(0, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 2000) });
const fcp = meter.createHistogram("web_vital.fcp", { unit: "ms", ...buckets(0, 600, 1200, 1800, 2400, 3000, 4000, 6000, 10000) });
const ttfb = meter.createHistogram("web_vital.ttfb", { unit: "ms", ...buckets(0, 200, 400, 600, 800, 1200, 1800, 2500, 4000) });
const cls = meter.createHistogram("web_vital.cls", { unit: "1", ...buckets(0, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.4, 0.6, 1) });

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

## Single-page apps

`onINP` measures INP the way the browser defines it: **one value per page load**. A single-page app loads once and then changes route with `history.pushState`, so a visit through `/products`, `/products/42` and `/checkout` produces one INP for the whole visit: every view's interactions compete for that single number, and a route attribute on it names whichever page the tab showed when it was reported, not the page that was slow.

To see INP per view, measure it per view: every route change ends the current view and starts a new one, and each view reports its own INP. The helper below does that with the browser's Event Timing API — the same data `onINP` uses — and handles the part that is easy to get wrong: the click that **caused** a navigation is delivered after the route has already changed, but it belongs to the page it was clicked on.

```ts
// src/inp-per-route.ts — INP for each view of a single-page app.
type Report = (inpMs: number, route: string) => void;

interface View {
  route: string;
  path: string; // the URL path it was opened for
  start: number; // performance.now() when the view began
  latencies: Map<number, number>; // interactionId -> its slowest entry
}

// Long enough for the click that navigated to be delivered: its entry
// arrives after the next paint, i.e. after the route has changed.
const SETTLE_MS = 1000;

let views: Array<View> = [];
let report: Report = () => {};

// The path, plus the hash when a hash router keeps the route there.
const currentPath = (): string =>
  location.pathname + (location.hash.startsWith("#/") ? location.hash : "");

function close(view: View): void {
  if (!views.includes(view)) return; // already reported
  views = views.filter((v) => v !== view);

  const sorted = [...view.latencies.values()].sort((a, b) => b - a);
  if (sorted.length === 0) return; // nobody interacted: no INP, not 0

  // web-vitals' p98: skip one outlier for every 50 interactions.
  report(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))]!, view.route);
}

function record(entries: PerformanceEntryList): void {
  for (const entry of entries as Array<PerformanceEventTiming & { interactionId?: number }>) {
    if (!entry.interactionId) continue; // hovers, scrolls: not interactions

    // The view the interaction STARTED in, so the click that navigated
    // counts towards the page it was clicked on.
    const view = [...views].reverse().find((v) => entry.startTime >= v.start);
    if (!view) continue;

    const slowest = view.latencies.get(entry.interactionId) ?? 0;
    view.latencies.set(entry.interactionId, Math.max(slowest, entry.duration));
  }
}

export function observeInpPerRoute(route: string, onReport: Report): void {
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("event")) return;

  report = onReport;
  views = [{ route, path: currentPath(), start: 0, latencies: new Map() }];

  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: "event", durationThreshold: 40, buffered: true } as PerformanceObserverInit);

  // The tab may never come back: report every view now, then keep
  // measuring the current route as a fresh view.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    record(observer.takeRecords());
    const current = views[views.length - 1]?.route ?? route;
    [...views].forEach(close);
    views = [{ route: current, path: currentPath(), start: performance.now(), latencies: new Map() }];
  });
}

// Call after every navigation, with the route PATTERN ("/products/:id").
// Safe to call when nothing changed (a router's initial navigation, a
// query-string update): the view only ends when the path does.
export function startView(route: string): void {
  const closing = views[views.length - 1];
  if (!closing || closing.path === currentPath()) return;

  views.push({ route, path: currentPath(), start: performance.now(), latencies: new Map() });
  setTimeout(() => close(closing), SETTLE_MS);
}
```

Both functions take the route **pattern**, never the URL: `/products/42` and `/products/7` must be one route, or every product becomes its own series. Use your router's pattern where it has one; otherwise collapse the ids yourself:

```ts
// "/products/42" -> "/products/:id", also for UUIDs.
export const toRoutePattern = (path: string): string =>
  path.replace(/\/(\d+|[0-9a-f]{8}-[0-9a-f-]{27})(?=\/|$)/gi, "/:id");
```

Record what the helper reports on the same `web_vital.inp` histogram, with the route as `app.route`, and **drop `onINP`** from the snippet above — keeping both would count every interaction twice:

```ts
// src/web-vitals.ts, in place of onINP(record(inp))
import { observeInpPerRoute } from "./inp-per-route";

observeInpPerRoute(toRoutePattern(location.pathname), (inpMs, route) => {
  inp.record(inpMs, {
    "app.route": route,
    "web_vital.rating": inpMs <= 200 ? "good" : inpMs <= 500 ? "needs-improvement" : "poor",
  });
});
```

Then call `startView` wherever your router announces a finished navigation. It ignores a call when the URL path has not changed, so a router that also reports the initial load, or a query-string update, does not split the view:

```ts
// Vue Router
router.afterEach((to) => startView(to.matched[to.matched.length - 1]?.path ?? toRoutePattern(to.path)));
```

```tsx
// React Router: in a component that stays mounted inside the router
const { pathname } = useLocation();
useEffect(() => startView(toRoutePattern(pathname)), [pathname]);
```

What you get:

- **INP by route** on the overview, slowest first, from `app.route` (OneUptime also reads OpenTelemetry's `url.template`).
- A route filter for alerting: in a Metrics Monitor on `web_vital.inp`, filter on `app.route` to watch one flow, such as `/checkout`, on its own.
- The app-wide INP on the Core Web Vitals card keeps working — it is the same metric, now with one sample per view instead of one per page load.

Chromium-based browsers report the interaction ids this needs; Safari reports none, which is also why `onINP` reports nothing there. Chrome's experimental Soft Navigations API aims to do this natively, but it is not generally available — this helper works today.

> **Using Session Replay?** The replay recorder already measures INP per view, with no code: each recording shows an INP row for every route the user interacted on, with the slow element and how its time split into input delay, processing and presentation. See [Session Replay](/docs/telemetry/session-replay).

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

You can also alert on them like any other metric, with a **Metrics Monitor** — for example, "LCP over the last hour is above 4000 ms". The RUM application's monitor recommendations include a ready-made **Poor Interaction to Next Paint** monitor on `web_vital.inp`; add an `app.route` filter to it to alert on a single route. See [Metrics Monitor](/docs/monitor/metrics-monitor).
