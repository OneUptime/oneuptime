# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) is a lightweight agent that collects logs from files, systemd, containers, syslog, HTTP and many other sources. Its [OpenTelemetry output](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) sends what it collects to OneUptime's OpenTelemetry (OTLP) endpoint, where the logs become searchable under **Products → Logs**.

:::cards
- [Configure Fluent Bit](#configure-fluent-bit): Add the OpenTelemetry output and name your service.
- [Complete example](#complete-example): A whole configuration file to start from.
- [Self-hosted OneUptime](#self-hosted-oneuptime): Point Fluent Bit at your own instance.
:::

## How it works

```mermaid title="From Fluent Bit to OneUptime"
flowchart TB
    sources["Files, containers, syslog, HTTP"] --> inputs["Fluent Bit inputs"]
    inputs --> envelope["opentelemetry_envelope processor"]
    envelope --> name["content_modifier sets service.name"]
    name --> output["opentelemetry output"]
    output -->|"OTLP/HTTP + ingestion key"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Logs"]
```

Fluent Bit wraps each record in an OpenTelemetry envelope, so it can carry resource attributes such as `service.name`. The OpenTelemetry output then posts the records to OneUptime with your ingestion key in the `x-oneuptime-token` header. OneUptime files them under the service named by `service.name`, and creates that service the first time it sends.

## Before you begin

- **Install Fluent Bit** — see the [installation guide](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). The configuration on this page uses Fluent Bit's YAML format and the `opentelemetry_envelope` processor, so use a current release.
- **A OneUptime project.** On OneUptime Cloud, telemetry is billed per GB ingested — see [pricing](https://oneuptime.com/pricing) — and a project on the Free plan needs a payment method before it can send telemetry.
- **A telemetry ingestion key.** If you do not have one:

:::steps
### Open the ingestion keys

Go to **Products → Project Settings**, open **Telemetry & APM** in the side menu and select **Ingestion Keys**.

![The "Ingestion Keys" list, with "Create Ingestion Key" ringed](screen:ingestion-keys)

### Create a key

Click **Create Ingestion Key**. The dialog has the key's name filled in and **Server** picked — the kind of key an application or a collector sends with — so click **Create Ingestion Key** to create it, or rename it first.

### Copy the secret

The new key opens on its own page. Copy its **Secret Key**: this is the `YOUR_TELEMETRY_INGESTION_TOKEN` in the configuration below.

![A telemetry ingestion key's page, showing its Secret Key](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Configure Fluent Bit

Fluent Bit reads its YAML configuration from a file such as `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Add the OpenTelemetry output

Add an `opentelemetry` output that sends to OneUptime. Keep the `stdout` output while you test if you want to see the records locally:

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` sends a chunk again when OneUptime is busy (`429`) or restarting (`502`, `503`, `504`), about every 30 seconds (`scheduler.base` and `scheduler.cap`), for about 72 hours; Fluent Bit's default is to try once more and drop it. `storage.path` keeps the chunks still to send on disk, so a restart of Fluent Bit loses none of them, for each input with `storage.type: filesystem`, as in the next step. Fluent Bit must be able to write that folder: the package's service runs as root, and by hand run it with `sudo`. `storage.total_limit_size: 512M` keeps at most 512 MB for the output; when it is full, the oldest chunks are dropped.

### Wrap logs in an OpenTelemetry envelope and name the service

Add the `opentelemetry_envelope` processor to each input, followed by a `content_modifier` that sets `service.name`. Replace `YOUR_SERVICE_NAME` with the name the logs should appear under in OneUptime:

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` keeps the tail's place in each file, so a restart reads on from where it was; without it, Fluent Bit starts again at the end of each file, and the lines written while it was down are never sent. `storage.type: filesystem` keeps the input's chunks in `storage.path`.

### Restart Fluent Bit

The `fluent-bit` package's service reads `/etc/fluent-bit/fluent-bit.conf`, the package's own example, not this file. Point it at `/etc/fluent-bit/fluent-bit.yaml` with a drop-in, then start it now and at every boot:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

The empty `ExecStart=` clears the package's own start line. To try the file in the foreground first, run `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: the package puts the binary in `/opt/fluent-bit/bin`, which is not on the `PATH`. Within a few seconds the logs appear under **Products → Logs**, and the service is listed under **Products → Services**.
:::

## Complete example

This configuration receives logs over HTTP on port `8888`, from this host alone, and forwards them to OneUptime:

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` takes logs from this host alone: the `http` input asks for no key, so with `listen: 0.0.0.0` anyone who can reach the port can send logs to OneUptime under your ingestion key. Replace the `http` input with the inputs you need — for example `tail` for log files or `systemd` for the journal — and keep the two processors and `storage.type: filesystem` on each of them.

## Send with the HTTP output

Fluent Bit's [HTTP output](https://docs.fluentbit.io/manual/pipeline/outputs/http) can send to OneUptime's Fluentd endpoint instead, which reads each record as the [Fluentd page](/docs/telemetry/fluentd) describes. Set `format` to `json_lines`, as below, or to `json`: OneUptime reads both, compressed with `compress: gzip` or not. Fluent Bit's default format, `msgpack`, is refused.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## Self-hosted OneUptime

Set `host` to the host of your OneUptime instance. If it is served over plain HTTP rather than HTTPS, also set `port` to the port it listens on (usually `80`) and remove `tls`:

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## Troubleshooting

:::details Fluent Bit logs `401` from the OpenTelemetry output
The ingestion key is missing, unknown or expired. Check the `header` line: it is `x-oneuptime-token`, a space, then the key's **Secret Key**.
:::

:::details Fluent Bit logs `402` or `422`
`402`: on OneUptime Cloud, the project is on the Free plan and has no payment method. Add one under **Project Settings → Billing and Invoices → Billing**. `422`: the key is disabled, or it is a Browser key. Turn **Enabled** back on in the key's settings, or create a **Server** key.
:::

:::details Logs arrive under an unexpected service
The service comes from `service.name`. Check that every input has the `opentelemetry_envelope` processor followed by the `content_modifier` that sets it.
:::

:::details Nothing arrives, and Fluent Bit logs connection errors
Check that `tls: On` and `port: 443` are set for an HTTPS endpoint, and that the host running Fluent Bit can reach your OneUptime host on that port.
:::

:::details Fluent Bit logs `cannot be retried`
Fluent Bit dropped a chunk it could not send. With `retry_limit: 8640`, as in the configuration above, it sends a chunk OneUptime answers `429`, `502`, `503` or `504` for again about every 30 seconds, for about 72 hours; with Fluent Bit's default, it tries once more. A `400`, `401`, `402`, `413`, `422` or `500` is dropped at once, as it answers the same every time: check the key, the plan and the request size.
:::

If you have any questions or need help with the configuration, please reach out to us at support@oneuptime.com.

## Next steps

:::cards
- [Log Pipelines](/docs/telemetry/log-pipelines): Parse and enrich the logs Fluent Bit sends.
- [Search Syntax](/docs/telemetry/search-syntax): Find the logs in the Logs explorer.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endpoints, keys and limits for all telemetry.
- [Fluentd](/docs/telemetry/fluentd): Use Fluentd instead.
:::
