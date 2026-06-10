# Serverless Functions

## Overview

OneUptime automatically recognises a **Serverless Function** the moment it receives OpenTelemetry data tagged with the `faas.name` resource attribute. There is nothing to create by hand — instrument your function with the OpenTelemetry SDK for your runtime, point its OTLP exporter at OneUptime, and the function shows up under **Serverless Functions** with its traces, logs and metrics.

This works for AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers, or any FaaS runtime that can emit OpenTelemetry.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create one from *Project Settings → Telemetry Ingestion Keys* and copy the `x-oneuptime-token` value.
- The OpenTelemetry SDK (or an auto-instrumentation layer) for your function's language.

## How OneUptime identifies a function

OneUptime keys each function on the `faas.name` resource attribute:

| Attribute | Required | Purpose |
|---|---|---|
| `faas.name` | **yes** | Function identity (e.g. `checkout-handler`) |
| `faas.version` | no | Shown on the overview |
| `faas.instance` | no | Tracked per-instance under the **Instances** tab |
| `cloud.platform` | no | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | no | Shown on the overview |

> A function that also sets `service.name` still appears under **Services** too. The **Serverless Functions** view is the FaaS-focused lens, scoped by `faas.name`.

## Step 1 — Set the OTLP exporter environment variables

Most language auto-instrumentations honour the standard OpenTelemetry environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

If you self-host OneUptime, replace the endpoint with `https://YOUR-ONEUPTIME-HOST/otlp`.

## Step 2 — (AWS Lambda) add the OpenTelemetry layer

For AWS Lambda the simplest path is the [OpenTelemetry Lambda layer](https://opentelemetry.io/docs/faas/lambda-auto/). Attach the layer for your runtime and set:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

The layer sets `faas.name` from the function name automatically, and the resource detector fills in `cloud.platform`, `cloud.region` and `cloud.account.id`.

## What you get

Once the function emits a span, log or metric it appears under **Serverless Functions**. The overview shows:

- **Invocations**, **error rate** and **p95 duration** — derived from your traces, over a selectable time range, with trend charts.
- **Instances** — a live count of the `faas.instance` values seen.
- Full **Logs**, **Traces** and **Metrics** tabs scoped to this function.

You can also auto-apply labels and owners via *Serverless → Settings → Label Rules / Owner Rules*.
