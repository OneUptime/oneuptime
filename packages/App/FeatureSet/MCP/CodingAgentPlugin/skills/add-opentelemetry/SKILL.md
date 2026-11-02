---
name: add-opentelemetry
description: Add OpenTelemetry to an application and send its traces, metrics and logs to OneUptime. Use when someone asks to instrument an app, add tracing, logging or APM, or send OpenTelemetry data to OneUptime.
---

# Add OpenTelemetry and send it to OneUptime

OneUptime takes telemetry over the OpenTelemetry Protocol (OTLP), so the app uses the standard OpenTelemetry SDK for its language. Nothing specific to OneUptime goes in the code: the exporter reads where to send and which key to use from environment variables.

## 1. See what is there

Read the project: its language and framework, how it runs (a process, Docker, Kubernetes), and whether it already has OpenTelemetry or runs a Collector. If it does, change only where the data goes.

## 2. Ask for an ingestion key

The person has to create this. No MCP tool or CLI command creates one:

1. Go to **Project Settings → Telemetry & APM → Ingestion Keys** and click **Create Ingestion Key**.
2. Keep the **Server** type, for anything that runs on a server. A **Browser** key is for web pages, and only works from its **Allowed Origins**.
3. Open the new key and copy its **Secret Key**.

It takes a Project Owner or Project Admin, or a role with the Create Telemetry Ingestion Key permission. On OneUptime Cloud, telemetry is billed per GB ingested, and a project on the Free plan needs a payment method first.

An ingestion key is not an API key. It only writes telemetry. Treat it as a secret: keep it in the app's secret store or environment, never in the code or in git, and do not ask the person to paste it into the conversation.

## 3. Set the environment

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_ONEUPTIME_INGESTION_KEY"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_SERVICE_NAME="my-service"
```

- The SDK adds `/v1/traces`, `/v1/metrics` and `/v1/logs` to the endpoint. Do not add them yourself.
- `OTEL_SERVICE_NAME` is what the service is called in OneUptime. The service is created the first time it sends.
- Keep the protocol line. The Python distribution, the .NET exporter and the Java SDK on its own default to gRPC, which uses a different endpoint: `https://oneuptime.com:443`.
- On a self-hosted OneUptime, use the person's host in place of `oneuptime.com`, such as `https://oneuptime.example.com/otlp`.
- To tag data with an environment, also set `OTEL_RESOURCE_ATTRIBUTES` to `deployment.environment=production`.

In Docker or Kubernetes, set these on the container, with the key in a secret, not in the image.

Quarkus reads `QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT` and its own names, not the variables above.

## 4. Add the SDK

Use the language's standard OpenTelemetry SDK and its automatic instrumentation, and add it the way the project already manages dependencies.

- **Node.js**: `@opentelemetry/sdk-node` and `@opentelemetry/auto-instrumentations-node`, started in a file of its own that loads before the app, with `node --import` or `node --require`. `NodeSDK` reads the variables above and sends traces, metrics and logs.
- **Python**: `pip install opentelemetry-distro opentelemetry-exporter-otlp`, then `opentelemetry-bootstrap -a install`, and start the app with `opentelemetry-instrument`. Set `OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true` to send records from Python's `logging` module too.
- **Other languages**: OneUptime publishes a step-by-step guide for each language and framework at https://oneuptime.com/integrations. Give the person the link for theirs.

Do not change what the app logs or add spans by hand until the automatic data is arriving.

## 5. Check that data arrives

Ask OneUptime whether it accepts the key. This changes nothing:

```bash
curl -i -H "x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY" \
  https://oneuptime.com/otlp/v1/validate
```

`200` with `"valid": true` means the key works. A `401` says why it does not: unknown, switched off or expired.

Then start the app and send it some traffic. OneUptime answers an export as soon as the data is queued, and it appears a few seconds later:

- In the dashboard: **Products → Resources → Services**, **Products → Observability → Traces**, **Products → Observability → Logs** and **Products → Observability → Metrics**.
- With the `oneuptime` MCP server connected, `list_spans` with a `startTime` filter, or `list_logs` with a `time` filter. Connecting an MCP client on OneUptime Cloud needs the Growth plan or higher. Sending telemetry does not.

## When nothing arrives

Read the exporter's log. Exporters drop a batch on `401`, `402`, `413`, `415` and `422` instead of retrying it.

| What it logs      | What it means                                                           | What to do                                                                                                    |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `401`             | The key is missing, unknown or expired                                  | Check that the header is `x-oneuptime-token=` followed by the **Secret Key**, with no quotes or spaces inside |
| `402`             | OneUptime Cloud: the project is on the Free plan with no payment method | Add one under **Project Settings → Billing and Invoices → Billing**                                           |
| `404`             | The SDK posts to the wrong path                                         | The endpoint ends in `/otlp`, with no trailing slash and no `/v1/...`                                         |
| `413`             | The batch is over the 4 MB limit                                        | Send smaller batches                                                                                          |
| `422`             | The key is disabled, or it is a Browser key                             | Turn it back on, or use a **Server** key                                                                      |
| Connection errors | The SDK is using gRPC, or `localhost`                                   | Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, and check that the process really sees the variables         |

Data under **Unknown Service** means `OTEL_SERVICE_NAME` is not set in that process.
