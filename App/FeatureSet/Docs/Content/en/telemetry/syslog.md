# Send Syslog Data to OneUptime

## Overview

The OpenTelemetry Ingest service now accepts native Syslog payloads. You can forward messages from any RFC3164 or RFC5424 compatible source directly to OneUptime over HTTPS. OneUptime parses the syslog priority, facility, severity, structured data, and message body before storing everything as searchable logs.

## Prerequisites

- **Telemetry Ingestion Token** – create one from *Project Settings → Telemetry Ingestion Keys* and copy the `x-oneuptime-token` value.
- **Syslog forwarder** – any tool capable of sending HTTP POST requests (for example `curl`, `rsyslog` via `omhttp`, or `syslog-ng` with the HTTP destination plugin).
- **Service name (optional)** – set the `x-oneuptime-service-name` header to group incoming logs under a specific telemetry service. When omitted, OneUptime falls back to the syslog `APP-NAME`, hostname, or `Syslog`.

## Endpoint

```
POST https://oneuptime.com/syslog/v1/logs
```

- Replace `oneuptime.com` with your host if you are self hosting OneUptime.
- Always include the `x-oneuptime-token` header in the request.

## Request Body

Send newline-delimited Syslog strings or a JSON payload with a `messages` array. Both RFC3164 (BSD) and RFC5424 formats are supported.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Supported Content Types

- `application/json` – recommended.
- `text/plain` – newline separated messages.
- `application/octet-stream` – raw payloads. Gzip compression (`Content-Encoding: gzip`) is also accepted.

## Quick Test with curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Forwarding from rsyslog

1. Install the HTTP output module:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Append the destination to `/etc/rsyslog.d/oneuptime.conf`:
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. Restart rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Common use cases we are already seeing

### 1. Network and security appliances

Most network gear still exposes configuration changes, ACL hits, and threat detections exclusively over syslog. Point your existing relay (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense, and more) directly to OneUptime, or keep an internal relay and forward over HTTPS:

```bash
# rsyslog snippet that batches messages into JSON and posts to OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linux servers and cron jobs

Many cron jobs and legacy daemons still log solely through the kernel/syslog facility. Forwarding `/var/log/syslog` or journald entries keeps operational breadcrumbs in one place. Systemd hosts can rely on the journald → syslog bridge:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

Because we map severity codes, you can alert on `syslog.severity.name = "error"` or slice by `syslog.hostname` to isolate noisy boxes quickly.

### 3. Kubernetes ingress controllers and edge nodes

If you already run Fluent Bit or Fluentd, keep them for container logs and add a lightweight syslog sink for hosts or appliances at the edge. Fluent Bit’s `syslog` input pairs with the HTTP output:

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

This setup lets you ingest syslog from bare-metal workers or hardware load balancers without creating another logging stack.

### 4. Compliance archives without the wait

Need to retain firewall logs for PCI or SOX? Send them straight to OneUptime, apply a long retention policy to the telemetry service, and export to cold storage from a single place. No more exporting from multiple syslog relays.

## Parsed Attributes

OneUptime automatically adds the following attributes to each log entry:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (flattened RFC5424 structured data)
- `syslog.raw` (original message for traceability)

These attributes become searchable inside the Telemetry → Logs explorer.

## Troubleshooting

- **HTTP 401 or empty results** – verify the `x-oneuptime-token` header belongs to the project receiving the logs.
- **No logs appear** – confirm the request body actually contains syslog lines. Empty bodies are rejected with HTTP 400.
- **Unexpected service name** – set `x-oneuptime-service-name` to override the default detection logic.
- **Large bursts** – batching up to 1,000 lines per request is supported. Larger bursts are queued and processed asynchronously.
