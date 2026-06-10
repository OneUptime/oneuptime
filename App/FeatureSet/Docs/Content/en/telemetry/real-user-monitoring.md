# Real User Monitoring (Browser & Mobile)

## Overview

OneUptime classifies incoming telemetry as **RUM** when it carries client attributes — `browser.*` for web or `device.*` for mobile. Each application is identified by its `service.name` and is owned entirely by its RUM application (client telemetry is never duplicated as a backend Service).

Use it to see what your users actually experience: page views, errors, latency, the platforms / devices in use, and — when your SDK emits them — Core Web Vitals.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create one from *Project Settings → Telemetry Ingestion Keys*.
- The OpenTelemetry browser or mobile SDK.

## How OneUptime identifies a RUM application

| Attribute | Required | Purpose |
|---|---|---|
| `service.name` | **yes** | Application identity (e.g. `storefront-web`) |
| `browser.*` | for web | Marks the telemetry as browser RUM |
| `device.*` | for mobile | Marks the telemetry as mobile RUM |
| `telemetry.sdk.language` | no | e.g. `webjs`, `swift`, shown on the overview |

## Browser (OpenTelemetry Web)

Point the OTLP/HTTP exporter at OneUptime and set `service.name` to your app's name:

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

The browser instrumentation adds `browser.*` resource attributes automatically — that is what routes the data to RUM.

## Mobile (Swift / Android)

Use the OpenTelemetry Swift or Android SDK, set `service.name`, and export OTLP to OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

The SDK's `device.*` attributes route the telemetry to RUM. If you self-host OneUptime, use `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

If your browser instrumentation emits web vitals (LCP, INP, CLS, FCP, TTFB) as OpenTelemetry metrics, OneUptime surfaces them on the application overview with good / needs-improvement / poor ratings. If no web-vital metrics are reported, the panel explains how to start sending them.

## What you get

- **Page views**, **error rate** and **p95 duration** with trend charts over a selectable range.
- **Clients** — the browser platforms / device models seen.
- **Core Web Vitals** (when reported).
- Full **Logs**, **Traces** and **Metrics** tabs scoped to the application.
