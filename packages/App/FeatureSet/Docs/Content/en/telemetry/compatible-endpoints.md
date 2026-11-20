# Prometheus, Loki, Splunk, Datadog & Sentry

Already running Prometheus, a Loki client, a Splunk forwarder, the Datadog Agent or a Sentry SDK? Keep it. OneUptime accepts what each of these tools sends, at the paths the tool already uses, and stores it as OpenTelemetry data. Trying OneUptime is a change of URL and key, not a re-instrumentation, and your drop filters, scrub rules, log pipelines, retention and ingestion budgets apply to this data as to any other.

:::cards
- [Prometheus remote write](#prometheus-remote-write): Metrics from Prometheus, Grafana Alloy or any remote write sender.
- [Loki](#loki): Logs from Promtail, Grafana Alloy, Fluent Bit or Vector.
- [Splunk HTTP Event Collector](#splunk-http-event-collector): Logs and metric events from any HEC client.
- [Datadog Agent](#datadog-agent): Metrics, logs and APM traces from the Datadog Agent.
- [Sentry SDKs](#sentry-sdks): Errors, transactions, logs, cron check-ins, feedback and profiles from any Sentry SDK.
:::

## How it works

```mermaid title="From the tools you run to OneUptime"
flowchart TB
    subgraph tools["The agents and SDKs you already run"]
        direction LR
        prometheus["Prometheus"]
        loki["Loki clients"]
        splunk["Splunk HEC clients"]
        datadog["Datadog Agent"]
        sentry["Sentry SDKs"]
    end
    tools -->|"Their own protocol + your ingestion key"| endpoint["OneUptime compatible endpoints"]
    endpoint --> otlp["Stored as OpenTelemetry data"]
    otlp --> signals["Logs, metrics, traces, exceptions and profiles"]
```

Each endpoint answers in its tool's own terms — a `204` for Prometheus and Loki, HEC's `{"text": "Success", "code": 0}`, Datadog's `202`, Sentry's event ID — so the tool reports success and failure the way it always has. The data is then processed exactly like data from an OpenTelemetry SDK.

## Before you begin

- **A OneUptime project** – on OneUptime Cloud, telemetry is billed per GB ingested, and a project on the Free plan needs a payment method before it can send telemetry.
- **Telemetry ingestion key** – create a **Server** key under **Products → Project Settings → Telemetry & APM → Ingestion Keys**, and copy its **Secret Key**. Each tool sends it where it sends its own credential. A browser app's Sentry DSN takes a **Browser** key instead, with your site's origins on it.
- **Your host** – the examples use `oneuptime.com`. If you self-host OneUptime, use your own host.

> [!TIP]
> The Setup Guide tab on Logs, Metrics, Traces and Exceptions has these tools under its own ways to send, with your host and a key you pick already filled in.

## Endpoints

| Tool | Point it at | Where the key goes |
| --- | --- | --- |
| Prometheus remote write | `https://oneuptime.com/telemetry/prometheus/api/v1/write` | A bearer token, or basic auth with the key as the password. |
| Loki | `https://oneuptime.com/telemetry/loki/api/v1/push` | Basic auth with the key as the password, or a bearer token. |
| Splunk HTTP Event Collector | `https://oneuptime.com/telemetry/services/collector` | The HEC token: `Authorization: Splunk <key>`. |
| Datadog Agent | `https://oneuptime.com/telemetry/datadog` | The API key: `DD-API-KEY`. |
| Sentry SDKs | The DSN `https://<key>@oneuptime.com/telemetry/sentry/1` | The DSN's public key. |

Every endpoint also takes the key in an `x-oneuptime-token` header, and an `x-oneuptime-service-name` header names the service everything it sends belongs to. A key can be written as its 32 hex digits without hyphens; the Sentry DSN and the Datadog API key must be written that way.

## Prometheus remote write

Add OneUptime as a remote write target. Prometheus keeps scraping as it does now and sends a copy of every sample:

```yaml title="prometheus.yml"
remote_write:
  - url: https://oneuptime.com/telemetry/prometheus/api/v1/write
    authorization:
      credentials: YOUR_TELEMETRY_KEY
    send_exemplars: true
```

With Grafana Alloy, add a `prometheus.remote_write` component and forward your scrapes to it:

```text title="config.alloy"
prometheus.remote_write "oneuptime" {
  endpoint {
    url          = "https://oneuptime.com/telemetry/prometheus/api/v1/write"
    bearer_token = "YOUR_TELEMETRY_KEY"
  }
}

prometheus.scrape "app" {
  targets    = [{"__address__" = "localhost:8080"}]
  forward_to = [prometheus.remote_write.oneuptime.receiver]
}
```

Remote write 1.0 and 2.0 are both accepted, snappy-compressed as every sender sends them. To send 2.0, which carries each series' type, unit and description, set `protobuf_message: io.prometheus.write.v2.Request` (Prometheus 3) or `protobuf_message = "io.prometheus.write.v2.Request"` (Alloy). Prometheus sends exemplars with `send_exemplars: true` once it keeps them (`--enable-feature=exemplar-storage`); Alloy sends them by default.

### What a series becomes

- **Its name and labels stay.** `http_requests_total{job="checkout", code="500"}` is the metric `http_requests_total` with the attributes `job` and `code`, so a query moved from Grafana finds it.
- **The job is the service.** Each `job` becomes a service, and each `instance` its service instance, as OpenTelemetry's Prometheus rules map them.
- **Types are kept.** Counters, and a histogram's buckets and counts, are cumulative sums, so their rates chart correctly. A type comes from the metadata the sender includes; without it, a `_total` name is a counter and a `_bucket` with an `le` label a histogram bucket.
- **Classic histograms chart their percentiles.** A classic histogram keeps its `_bucket`, `_count` and `_sum` series. Chart its `_bucket` metric with P50 to P99 in the [Metrics explorer](/docs/telemetry/metrics-explorer) and each scrape's buckets are read as one histogram, whichever request each bucket arrived in. In [PromQL](/docs/telemetry/promql), `histogram_quantile(0.95, sum by (le) (rate(<name>_bucket[5m])))` answers as it does in Prometheus.
- **Native histograms** become exponential histograms, and native histograms with custom buckets become histograms.
- **Exemplars link to traces.** An exemplar with a `trace_id` (or `traceID`) label links its datapoint to that trace and span: on the metric's chart, click its dot to view the trace or its logs. Its value and its other labels are not kept, nor is an exemplar whose datapoint arrived in another request.
- **Not kept:** staleness markers and other NaN or infinite values, and the `_created` series of counters. They are still counted as written, so the sender reports no failed samples.
- **Refused:** data neither remote write version allows, such as a series with no metric name or a sample with a negative timestamp. The rest of the request is stored, and the sender is answered `400` with what was refused.

## Loki

OneUptime takes Loki's push API at Loki's own path, in JSON or as the snappy-compressed protobuf Promtail and Grafana Alloy send. Add it as a client:

```yaml title="promtail.yaml"
clients:
  - url: https://oneuptime.com/telemetry/loki/api/v1/push
    bearer_token: YOUR_TELEMETRY_KEY
```

Fluent Bit's `loki` output takes the host and the path apart:

```text title="fluent-bit.conf"
[OUTPUT]
    Name         loki
    Match        *
    Host         oneuptime.com
    Port         443
    Tls          On
    Uri          /telemetry/loki/api/v1/push
    Http_User    oneuptime
    Http_Passwd  YOUR_TELEMETRY_KEY
    Labels       job=fluent-bit
```

OneUptime answers as Loki does: `204` once a push is stored, `400` for one it cannot read, `413` for one over the limits below, `401` for a missing or unknown key, `403` for a used-up daily budget, `429` with `Retry-After` over a rate, and `503` when it cannot take one right now. Promtail, Alloy and Vector retry a `429` or a `503`, and drop any other refused batch, logging why; Fluent Bit drops a `400` and retries anything else, up to its `Retry_Limit`.

### What a stream becomes

- **Every entry is a log**, with its own timestamp to the nanosecond and its line as the body.
- **Labels and structured metadata are attributes**, under the names they have in Loki.
- **The service** comes from the first of `service_name`, `service`, `app`, `application`, `name`, `app_kubernetes_io_name`, `container`, `container_name`, `component`, `workload` and `job` a stream has, as Loki finds it. A `host` or `hostname` label names the host.
- **The level** comes from a `level`, `detected_level` or `severity` label or metadata, or else from a logfmt `level=` or a JSON line's `level` field.
- **Trace context:** a `trace_id` and `span_id` in the structured metadata link the log to its trace.

## Splunk HTTP Event Collector

Use OneUptime as the HTTP Event Collector, with your ingestion key as the HEC token. Splunk's Docker logging driver adds the path itself, so it takes just the host:

```bash
docker run \
  --log-driver=splunk \
  --log-opt splunk-url=https://oneuptime.com \
  --log-opt splunk-token=YOUR_TELEMETRY_KEY \
  --log-opt splunk-format=json \
  your-image
```

Any other HEC client posts to `/services/collector/event` or `/services/collector/raw`. To send one event:

```bash
curl https://oneuptime.com/telemetry/services/collector/event \
  -H "Authorization: Splunk YOUR_TELEMETRY_KEY" \
  -d '{"event": "Payment failed for order 42", "sourcetype": "app", "fields": {"service": "checkout"}}'
```

A `200` with `{"text": "Success", "code": 0}` means the event was accepted. The endpoint answers with HEC's own codes too — `No data` (5), `Invalid data format` (6) with the number of the event that was not valid, and `Event field is required` (12) — and answers `GET /services/collector/health` without a token.

### What an event becomes

- **A log**, with its `time` as its timestamp. A string event is the body; an object event's `message`, `msg`, `log`, `line` or `text` is the body, and its other fields are attributes.
- **Its metadata stays:** `host` is the host, and `source`, `sourcetype` and `index` are kept as `com.splunk.source`, `com.splunk.sourcetype` and `com.splunk.index`. The query string's `host`, `source`, `sourcetype` and `index` fill in what an event leaves out.
- **Its fields are attributes.** A `service.name` field names the service, and so does a log's `service` field.
- **Metric events** (`"event": "metric"`, with `metric_name` and `_value`, or `metric_name:<name>` fields) are stored as metrics, never as logs.
- **Not offered:** indexer acknowledgement. A client that asks for it gets no `ackId`.

## Datadog Agent

Point the Agent's metrics, logs and APM traces at OneUptime, with your ingestion key as its API key:

```yaml title="datadog.yaml"
api_key: YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS
dd_url: https://oneuptime.com/telemetry/datadog
logs_enabled: true
logs_config:
  use_http: true
  logs_dd_url: oneuptime.com:443
apm_config:
  enabled: true
  apm_dd_url: https://oneuptime.com/telemetry/datadog
process_config:
  process_collection:
    enabled: false
```

The Agent adds its own paths to `dd_url` and `apm_dd_url`, and sends logs to `/api/v2/logs` on the host and port `logs_dd_url` names. OneUptime answers those paths at the root only for a request that carries a `DD-API-KEY` header. Restart the Agent after the change; `datadog-agent status` shows its API key as valid when OneUptime accepts it.

### What the Agent's data becomes

- **Metrics** keep their names. Gauges are gauges, counts are sums, and rates are gauges of their per-second value.
- **Distributions** become summaries with their count, sum, minimum and maximum.
- **Service checks** become a metric named after the check, whose value is the check's status: 0 OK, 1 warning, 2 critical, 3 unknown.
- **Logs** keep their message, status, host and service, and the rest of their fields as attributes.
- **APM traces** appear in Traces. Each span is named by its resource (`GET /users/:id`, a query) and belongs to its service; a span an integration gave a service name of its own, such as `checkout-postgres`, belongs to the service that made the call. Its operation name and type are kept as `datadog.operation_name` and `datadog.span_type`.
- **Errors** in a span appear in Exceptions, with the stack trace the tracer recorded.
- **Tags are attributes**, and the `service`, `env` and `version` tags name the service, its environment and its version. A span's HTTP and database tags are also written under their OpenTelemetry names: `http.status_code` as `http.response.status_code`, `db.type` as `db.system.name`.
- **Not read yet:** processes, containers, network data and profiles. Leave them off in `datadog.yaml`, as above. The Agent's APM stats are accepted and not kept: OneUptime computes its own from the spans.

Datadog's HTTP API clients — a log library posting to `/api/v2/logs`, a script posting series — can send to the same endpoint with the `DD-API-KEY` header.

### Without an Agent

dd-trace-go can send its traces to OneUptime itself, with your ingestion key as the password of its Agent URL:

```bash
DD_TRACE_AGENT_URL=https://oneuptime:YOUR_TELEMETRY_KEY@oneuptime.com/telemetry/datadog
```

The Python and Node.js tracers leave the URL's path and password out, so send their traces through the Agent.

## Sentry SDKs

Replace the DSN where you set up Sentry. The rest of your Sentry code stays as it is:

```javascript
Sentry.init({
  dsn: "https://YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS@oneuptime.com/telemetry/sentry/1",
  release: "checkout@1.4.2",
  environment: "production",
});
```

```python
sentry_sdk.init(
    dsn="https://YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS@oneuptime.com/telemetry/sentry/1",
    release="checkout@1.4.2",
    environment="production",
)
```

The `1` at the end of the DSN is required by Sentry's SDKs and not read. A browser app's DSN is public, so use a **Browser** ingestion key there, with your site's origins on it.

### What an envelope becomes

- **Errors** appear in Exceptions, with their stack traces and the exceptions that caused them, grouped as any other exception. Each is a span on its trace, under the span that was active.
- **Transactions** and their spans appear in Traces.
- **Sentry logs** and messages captured with `capture_message` appear in Logs.
- **Cron check-ins** appear in Logs, one record each, with the monitor's slug in `sentry.monitor.slug` and its status in `sentry.check_in.status`. A failed, timed-out or missed check-in is logged at Error. To be told when a job fails or does not run, create a [logs monitor](/docs/monitor/logs-monitor) on its slug.
- **User feedback**, from Sentry's feedback widget or `capture_user_feedback`, appears in Logs, in the trace it was sent from. Its `sentry.feedback.associated_event_id` is the `sentry.event_id` of the error it is about.
- **Profiles**, of transactions and from continuous profiling, appear in Profiles as wall-time profiles, linked to their transaction's trace. Android profiles are not read yet.
- **The service** is a `service` tag, or else the release's name before the `@`: `checkout@1.4.2` is `checkout`. The release is the service version, and the environment is kept.
- **Not kept:** sessions, replays and attachments. The SDK still sends them; OneUptime accepts and drops them.

## Limits and ingestion budgets

- **Request size** – OneUptime's ingress accepts requests of up to 4 MB under `/telemetry`, and each body may decompress to at most 64 MB. A Prometheus remote write request may decompress to at most 32 MB and hold at most 500,000 series, labels and samples, so that no single request can exhaust the server's memory. Prometheus and Alloy send 2,000 samples a request by default, far below both; a request over either is refused with `413`, so lower `queue_config`'s `max_samples_per_send` if you see one.
- **Loki pushes** – a push may decompress to at most 32 MB and hold at most 500,000 entries, labels and structured metadata, counting a stream's labels once for each of its entries. Promtail and Alloy send batches of 1 MB by default, far below both; a push over either is refused with `413`, so lower the client's batch size if you see one.
- **JSON, MessagePack and Datadog payloads** – a JSON or MessagePack body may hold at most 1,000,000 values (objects, arrays, strings and numbers), and a Datadog Agent protobuf payload at most 500,000 series, points, spans, tags and sketches. Each is counted before it is read, and a request over a limit is refused with `413`.
- **Ingestion budgets** – Prometheus remote write and Loki are checked against the metrics or logs budget before their body is read, and are refused with `403` when it is used up. Every request is then counted at its size decompressed, as an OTLP request is, against team and label budgets too. A HEC batch, a Datadog payload or a Sentry envelope can carry several signals, so each signal is counted against its own budget as it is stored, and dropped when that budget is used up: a HEC batch's logs and metric events share its size, and a Sentry envelope's items are each counted against their own signal — its profiles against the profiles budget, its check-ins and feedback against the logs one — while its attachments, replays and sessions, which are not kept, count against none.

## Troubleshooting

### Every request is refused with 401

The key did not arrive where the endpoint looks for it, or it is not a key of this project. Check the tool's credential setting against the [Endpoints](#endpoints) table, and that the key is not turned off or expired.

### A Sentry SDK says the DSN is invalid

Sentry's SDKs refuse a DSN whose key has hyphens. Write the key as its 32 hex digits, without the hyphens.

### Datadog metrics arrive, but logs do not

Check that `logs_config.use_http` is `true` and that `logs_config.logs_dd_url` is a host and port, not a URL. The Agent sends logs over TCP when `use_http` is not set.

### A Datadog log does not link to its trace

The tracer wrote only the lower 64 bits of the trace ID into the log. Set `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true` on the tracer, so it writes the whole ID.

### Prometheus reports 415

The sender asked for a remote write protocol OneUptime does not read. Send remote write 1.0 or 2.0.
