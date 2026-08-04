# Browser Setup

Instrument a web application with the OpenTelemetry browser SDK so it reports to OneUptime as a RUM application.

## Prerequisites

A **Telemetry Ingestion Token**. In the dashboard, go to _Project Settings → Telemetry Ingestion Keys_ and click **Create Ingestion Key**.

![Telemetry Ingestion Keys](/docs/static/images/TelemetryIngestionKeys.png)

Click **View** on the key you created to read the token.

![View Telemetry Ingestion Key](/docs/static/images/TelemetryIngestionKeyView.png)

The token is embedded in your page's JavaScript, so treat it as public. It grants ingestion only — it cannot read anything out of your project. If you also enable [Session Replay](/docs/telemetry/session-replay), set an origin allowlist there so a copied token cannot be used to write recordings into your project.

## Install

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

## Configure

Create `src/telemetry.ts` and import it **before anything else** in your entry point — instrumentations patch `fetch` and `XMLHttpRequest`, and anything that runs before the patch is not traced.

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

Then, as the **first** import of your app:

```ts
// src/index.tsx (React), src/main.ts (Vue / Angular), etc.
import "./telemetry";
import React from "react";
// ... the rest of your app
```

Load a page. Within a minute the application appears under **Resources → Real User Monitoring**, named after its `service.name`.

## Setting `browser.*` without the detector

`browserDetector` reads the [UA Client Hints API](https://wicg.github.io/ua-client-hints/). That API is Chromium-only, so on Safari and Firefox the detector sets `browser.language` and `user_agent.original` but **not** `browser.platform`, `browser.brands` or `browser.mobile`.

That is still enough for classification — `browser.language` alone marks the batch as browser RUM — but the **Clients** tab is populated from `browser.platform`, so Safari and Firefox traffic will not produce a client row unless you supply it yourself.

If you would rather not add the detector dependency at all, or you want a platform value on every browser, set the attributes directly:

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

Keep `browser.platform` coarse. It is a **resource** attribute, so every distinct value becomes a row on the Clients tab — putting a full user-agent string or a per-user value there produces an unbounded list and is a privacy problem besides.

## Single-page apps

`DocumentLoadInstrumentation` traces the initial load only. In a SPA the subsequent route changes are invisible unless you emit them yourself, which is usually a few lines in your router:

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

`@opentelemetry/instrumentation-user-interaction` is worth adding if you want clicks and other DOM events traced too.

## Linking to your backend traces

`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered.

**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing — because you installed instrumentation. List only origins you control and have configured:

```ts
new FetchInstrumentation({
  propagateTraceHeaderCorsUrls: [
    /^https:\/\/api\.example\.com/,
    /^https:\/\/auth\.example\.com/,
  ],
});
```

Same-origin requests are propagated without any configuration.

## Content Security Policy

If your site sends a CSP, the exporter's requests are blocked until you allow OneUptime. There is no error you can see from your own machine — the page simply reports nothing.

```
connect-src 'self' https://oneuptime.com;
```

Self-hosted: use your own host instead.

## Errors and exceptions

Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:

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

If you use [Session Replay](/docs/telemetry/session-replay), its recorder captures uncaught errors on its own — that is what triggers an upload — and the exception page then offers a **Watch what the user saw** card.

## Logs and metrics (optional)

Traces are enough to populate the overview. Add the log and metric pipelines if you want browser logs searchable in OneUptime, or if you want [Core Web Vitals](/docs/rum/web-vitals).

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

Reuse the same `resource` object. A logs or metrics pipeline built with a resource that lacks `browser.*` will be filed as a separate backend Service.

## Self-hosted OneUptime

Replace `https://oneuptime.com` with your own host everywhere above — the OTLP URLs and the CSP entry. Nothing else changes.

## Endpoint reference

| Signal | Endpoint | Header |
| --- | --- | --- |
| Traces | `POST {host}/otlp/v1/traces` | `x-oneuptime-token: <token>` |
| Metrics | `POST {host}/otlp/v1/metrics` | `x-oneuptime-token: <token>` |
| Logs | `POST {host}/otlp/v1/logs` | `x-oneuptime-token: <token>` |

Both OTLP/JSON and OTLP/protobuf are accepted. The endpoints answer cross-origin requests from any origin and allow the `x-oneuptime-token` header, so a browser can export to them directly — no collector or proxy of your own is required.
