# OneUptime IoT Devices

## Overview

OneUptime monitors fleets of IoT devices — sensors, gateways, controllers, and edge boxes — by ingesting standard OpenTelemetry (OTLP) metrics. Each device (or a gateway on its behalf) pushes a small set of `iot_*` metrics over OTLP HTTP, tagged with which **fleet** it belongs to and its own **device id**. OneUptime groups those metrics into a fleet, builds a live device inventory, and tracks per-device battery, connectivity, temperature, CPU, memory, and availability.

There is no agent to install on the device side — anything that can speak OTLP (an OpenTelemetry SDK on the device, or an OpenTelemetry Collector running on a gateway that fans out to many devices) works. This page is the **ingestion guide**. For configuring IoT monitors and alerts on top of the data you push, see [IoT Device Monitor](/docs/monitor/iot-device-monitor).

## Prerequisites

- A device, gateway, or collector that can send OTLP/HTTP to OneUptime
- Network reachability from the device/gateway to your OneUptime instance
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry Ingestion Keys_ and copy the `x-oneuptime-token` value

## How OneUptime Models IoT

OneUptime maps your devices onto two concepts using OpenTelemetry resource attributes:

- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.
- **Device** — an individual device within a fleet, identified by the `device.id` attribute. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.

Optional attributes refine how each device is classified and scoped in monitors:

| Attribute            | Required | Description                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Yes      | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>`    |
| `device.id`          | Yes      | Stable, unique id for the device within the fleet                                |
| `iot.device.kind`    | No       | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |
| `iot.device.type`    | No       | A finer device type/model used for filtering monitors (for example `temp-sensor`) |
| `iot.device.firmware`| No       | Firmware version reported by the device                                          |

## Sending Metrics via the OpenTelemetry SDK

If your device runs an OpenTelemetry SDK directly, point it at OneUptime and stamp the IoT resource attributes via the standard `OTEL_*` environment variables. Replace the token, endpoint, fleet name, and device id with values for your environment.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Environment Variable          | Required | Description                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Yes      | OneUptime OTLP endpoint (`https://oneuptime.com/otlp`, or `http(s)://YOUR-ONEUPTIME-HOST/otlp` self-hosted) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Yes      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Yes      | Comma-separated resource attributes. Must include `iot.fleet.name`, `device.id`, and `service.name=iot/<fleet>` |

Emit your readings as metrics using the `iot_*` names below (see [Metric Conventions](#metric-conventions)). Within a minute or so the device appears under the **IoT** section of the OneUptime dashboard.

## Sending Metrics via an OpenTelemetry Collector

When many devices report through a gateway, run an OpenTelemetry Collector on the gateway and export to OneUptime. The `resource` processor stamps the fleet attributes; receive readings from your devices (OTLP, MQTT bridge, file logs, etc.) and forward them on:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # OneUptime requires the JSON encoder instead of the default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.
- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.
- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Note `encoding: json` and the `Content-Type: application/json` header are required.

## Metric Conventions

OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.

| Metric Name                 | Meaning                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |
| `iot_device_info`           | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |
| `iot_battery_percent`       | Battery charge level, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI)      |
| `iot_temperature_celsius`   | Device or sensor temperature in °C                                             |
| `iot_cpu_usage_ratio`       | CPU utilization as a ratio `0`–`1` (OneUptime stores it as a percentage)        |
| `iot_memory_usage_bytes`    | Memory currently used, in bytes                                                |
| `iot_memory_size_bytes`     | Total memory available on the device, in bytes                                 |
| `iot_uptime_seconds`        | Seconds since the device last booted                                           |

### Fleet Rollup Metrics (server-computed — do not send these)

In addition to the device-pushed metrics above, OneUptime **computes** the following fleet-level rollup series itself, once per minute per fleet, and writes them to the same metric store. Your devices and gateways must **not** send them — they are reserved, and the server-side values would collide with anything you push. Each series has one datapoint per fleet per minute and is stamped with `resource.iot.fleet.name` (the fleet name), `iot.scope = fleet`, and `oneuptime.synthetic = fleet-rollup`; they carry no `device.id` label.

| Metric Name                       | Meaning                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `iot_fleet_device_count`          | Active devices in the fleet (non-Retired, non-archived)                                          |
| `iot_fleet_online_count`          | Active devices currently online                                                                   |
| `iot_fleet_offline_count`         | Active devices currently offline                                                                  |
| `iot_fleet_stale_count`           | Active devices whose readings have gone stale                                                     |
| `iot_fleet_online_ratio`          | Online share of active devices, `0`–`1`. Only emitted while the fleet has active devices          |
| `iot_fleet_battery_percent_p50`   | Median battery (%) across devices with fresh battery readings. Only emitted while such readings exist |
| `iot_fleet_battery_percent_p10`   | 10th-percentile battery (%). Only emitted while fresh battery readings exist                      |
| `iot_fleet_weak_signal_count`     | Devices whose fresh signal readings are below -100 dBm                                            |

Chart them from the fleet's **Metrics** view like any other series, or alert on them with the Fleet Health monitor templates — see [IoT Device Monitor](/docs/monitor/iot-device-monitor#fleet-health-rollup-metrics).

## Device-side Recipes

There is no official OpenTelemetry SDK for constrained embedded targets, and you do not need one: OTLP/HTTP with JSON encoding is just an HTTP `POST` of a JSON document. Any device that can make an HTTPS request can push metrics directly to `POST /otlp/v1/metrics` with two headers — `Content-Type: application/json` and `x-oneuptime-token`.

The minimal payload for one gauge datapoint, with the required resource attributes and the `device.id` datapoint label, looks like this (portable to any RTOS or bare-metal HTTP stack):

```json
{
  "resourceMetrics": [{
    "resource": {
      "attributes": [
        { "key": "iot.fleet.name", "value": { "stringValue": "building-a-sensors" } },
        { "key": "device.id", "value": { "stringValue": "sensor-001" } },
        { "key": "service.name", "value": { "stringValue": "iot/building-a-sensors" } }
      ]
    },
    "scopeMetrics": [{
      "metrics": [{
        "name": "iot_temperature_celsius",
        "unit": "Cel",
        "gauge": {
          "dataPoints": [{
            "asDouble": 23.4,
            "timeUnixNano": "1751500000000000000",
            "attributes": [
              { "key": "device.id", "value": { "stringValue": "sensor-001" } }
            ]
          }]
        }
      }]
    }]
  }]
}
```

Two practical notes before the recipes:

- **Timestamps** — `timeUnixNano` is Unix time in nanoseconds (sent as a string). The device needs a synced clock, so run SNTP/NTP before pushing.
- **Batching** — each push opens a connection; on battery-powered devices, put all of a device's metrics in one `scopeMetrics[].metrics[]` array per push rather than posting them one at a time.

### ESP32 (ESP-IDF, C)

Uses `esp_http_client` and the ESP-IDF certificate bundle for TLS. Enable SNTP (`esp_netif_sntp`) first so `gettimeofday()` returns real time.

```c
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include "esp_http_client.h"
#include "esp_crt_bundle.h"

#define ONEUPTIME_URL   "https://oneuptime.com/otlp/v1/metrics"
#define ONEUPTIME_TOKEN "YOUR_TELEMETRY_INGESTION_TOKEN"
#define FLEET_NAME      "building-a-sensors"
#define DEVICE_ID       "sensor-001"

/* OTLP/HTTP JSON: one gauge datapoint with the required IoT attributes. */
static const char *OTLP_BODY_FMT =
  "{\"resourceMetrics\":[{"
    "\"resource\":{\"attributes\":["
      "{\"key\":\"iot.fleet.name\",\"value\":{\"stringValue\":\"" FLEET_NAME "\"}},"
      "{\"key\":\"device.id\",\"value\":{\"stringValue\":\"" DEVICE_ID "\"}},"
      "{\"key\":\"service.name\",\"value\":{\"stringValue\":\"iot/" FLEET_NAME "\"}}"
    "]},"
    "\"scopeMetrics\":[{\"metrics\":[{"
      "\"name\":\"iot_temperature_celsius\",\"unit\":\"Cel\","
      "\"gauge\":{\"dataPoints\":[{"
        "\"asDouble\":%.2f,"
        "\"timeUnixNano\":\"%llu\","
        "\"attributes\":[{\"key\":\"device.id\","
          "\"value\":{\"stringValue\":\"" DEVICE_ID "\"}}]"
      "}]}"
    "}]}]"
  "}]}";

void push_temperature(float celsius) {
  struct timeval tv;
  gettimeofday(&tv, NULL); /* requires SNTP-synced clock */
  unsigned long long now_ns =
      (unsigned long long)tv.tv_sec * 1000000000ULL +
      (unsigned long long)tv.tv_usec * 1000ULL;

  char body[1024];
  snprintf(body, sizeof(body), OTLP_BODY_FMT, celsius, now_ns);

  esp_http_client_config_t config = {
      .url = ONEUPTIME_URL,
      .method = HTTP_METHOD_POST,
      .crt_bundle_attach = esp_crt_bundle_attach, /* TLS root certs */
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_header(client, "x-oneuptime-token", ONEUPTIME_TOKEN);
  esp_http_client_set_post_field(client, body, strlen(body));
  esp_http_client_perform(client); /* expect HTTP 200 */
  esp_http_client_cleanup(client);
}
```

### Zephyr RTOS (C)

Uses Zephyr's `http_client`. The socket setup (DNS resolve, `connect()`, TLS via `CONFIG_NET_SOCKETS_SOCKOPT_TLS` with a provisioned CA certificate) is elided — Zephyr's `samples/net/sockets/http_get` sample shows it end to end. Pass in a socket already connected to your OneUptime host on port 443.

```c
#include <stdio.h>
#include <string.h>
#include <zephyr/net/http/client.h>
#include <zephyr/net/socket.h>

#define ONEUPTIME_HOST "oneuptime.com"
#define ONEUPTIME_PATH "/otlp/v1/metrics"
#define FLEET_NAME     "field-gateways"
#define DEVICE_ID      "sensor-002"

static const char *headers[] = {
  "Content-Type: application/json\r\n",
  "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN\r\n",
  NULL,
};

static char body[1024];
static uint8_t recv_buf[512];

static void response_cb(struct http_response *rsp,
                        enum http_final_call final_data, void *user_data) {
  /* expect "200 OK" in rsp->http_status */
  printf("OTLP push status: %s\n", rsp->http_status);
}

/* sock: already connected (and TLS-wrapped) to ONEUPTIME_HOST:443 */
int push_battery(int sock, double percent, uint64_t now_ns) {
  snprintf(body, sizeof(body),
    "{\"resourceMetrics\":[{"
      "\"resource\":{\"attributes\":["
        "{\"key\":\"iot.fleet.name\",\"value\":{\"stringValue\":\"" FLEET_NAME "\"}},"
        "{\"key\":\"device.id\",\"value\":{\"stringValue\":\"" DEVICE_ID "\"}},"
        "{\"key\":\"service.name\",\"value\":{\"stringValue\":\"iot/" FLEET_NAME "\"}}"
      "]},"
      "\"scopeMetrics\":[{\"metrics\":[{"
        "\"name\":\"iot_battery_percent\",\"unit\":\"%%\","
        "\"gauge\":{\"dataPoints\":[{"
          "\"asDouble\":%.1f,\"timeUnixNano\":\"%llu\","
          "\"attributes\":[{\"key\":\"device.id\","
            "\"value\":{\"stringValue\":\"" DEVICE_ID "\"}}]"
        "}]}"
      "}]}]"
    "}]}",
    percent, (unsigned long long)now_ns);

  struct http_request req = { 0 };
  req.method = HTTP_POST;
  req.url = ONEUPTIME_PATH;
  req.host = ONEUPTIME_HOST;
  req.protocol = "HTTP/1.1";
  req.header_fields = headers;
  req.payload = body;
  req.payload_len = strlen(body);
  req.response = response_cb;
  req.recv_buf = recv_buf;
  req.recv_buf_len = sizeof(recv_buf);

  return http_client_req(sock, &req, 5000 /* ms */, NULL);
}
```

For self-hosted OneUptime, replace the host with your instance (the path stays `/otlp/v1/metrics`). If a device cannot do TLS at all, push over plain HTTP to a local OpenTelemetry Collector on your gateway and let the collector forward to OneUptime over HTTPS, as shown in [Sending Metrics via an OpenTelemetry Collector](#sending-metrics-via-an-opentelemetry-collector).

## Scoping Ingestion Keys to Fleets

Telemetry ingestion keys are project-wide by default: any device holding a key can push data as **any** fleet (or any other telemetry service) in the project. That is a poor fit for device keys — a key flashed onto a sensor in the field is easy to extract, and an extracted project-wide key lets an attacker impersonate your whole fleet inventory.

To limit the blast radius, scope each device key to the fleet(s) it belongs to. In _Project Settings → Telemetry Ingestion Keys_, create (or edit) a key and set **Restrict to IoT Fleets** to the fleet name(s) the key may report for.

When a key is fleet-scoped:

- Every OTLP resource pushed with the key **must** carry an `iot.fleet.name` resource attribute whose value is in the key's allowed list. Requests containing a resource with a missing or out-of-scope `iot.fleet.name` are rejected with HTTP `403` (or gRPC `PERMISSION_DENIED`) before anything is stored — the error message names the offending fleet and the key's allowed scope.
- The syslog, fluentd, and profiling (Pyroscope) ingest paths carry no resource attributes and therefore reject fleet-scoped keys outright. Use an unscoped key for those.
- Keys with no fleet restriction behave exactly as before (project-wide).

Key hygiene tips:

- Use **one key per fleet** (or per deployment batch) so a leaked key can be revoked without re-flashing unrelated fleets.
- Never reuse a device key for backend services — create separate, unscoped keys for servers and collectors you control.
- Rotate a fleet's key from _Project Settings → Telemetry Ingestion Keys → Reset Secret Key_ if you suspect a device has been tampered with. Scope changes and revocations take effect within about a minute.

## Verify the Installation

1. Confirm your device or gateway is exporting without errors (check the SDK/collector logs for export failures and HTTP `401`/`403` responses).
2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear as `iot/<fleet>` within a minute or so.
3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.
4. Open **Metrics** under the fleet to chart any of the `iot_*` series above.

## Troubleshooting

### Fleet Does Not Appear

1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.
2. Confirm the exporter endpoint is `https://oneuptime.com/otlp` (or your self-hosted `…/otlp`) and the `x-oneuptime-token` header carries a valid token.
3. If using a collector, ensure `encoding: json` and `Content-Type: application/json` are set on the `otlphttp` exporter.

### Devices Missing from the Inventory

1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.
2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.
3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.

### HTTP 401 / 403 from the Exporter

- `401` — the ingestion token is invalid, revoked, or missing. Generate a new one from _Project Settings → Telemetry Ingestion Keys_ and update the `x-oneuptime-token` header.
- `403` — the token is valid but fleet-scoped, and the payload contained a resource whose `iot.fleet.name` is missing or outside the key's allowed fleets (the response body names the offending fleet and the allowed scope). Fix the device's `iot.fleet.name` resource attribute, or widen the key's scope in _Project Settings → Telemetry Ingestion Keys_. See [Scoping Ingestion Keys to Fleets](#scoping-ingestion-keys-to-fleets).

### Metrics Not Charting

1. Confirm you are using the exact `iot_*` metric names from the [Metric Conventions](#metric-conventions) table — unrecognized names are stored as generic metrics and will not populate IoT charts.
2. Remember `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.
3. Allow up to a minute for the first datapoints to surface after a device starts reporting.

## Self-hosted OneUptime

If you are self-hosting OneUptime, point the endpoint at your own instance:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Or, in a collector:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

If your instance is HTTP-only, change the scheme to `http://` and use the appropriate port.

## Next steps

- Configure an **IoT Device Monitor** to alert on device offline, low battery, weak signal, high temperature, high CPU, and high memory pressure conditions per device — or on fleet-wide offline ratio and battery health via the Fleet Health templates — see [IoT Device Monitor](/docs/monitor/iot-device-monitor).
- For non-containerized hosts (Linux / macOS / Windows VMs and bare metal), use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- To learn the underlying OTLP integration in depth, see [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry).
