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

The ingestion token is invalid, revoked, or missing. Generate a new one from _Project Settings → Telemetry Ingestion Keys_ and update the `x-oneuptime-token` header.

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

- Configure an **IoT Device Monitor** to alert on device offline, low battery, weak signal, high temperature, and high CPU conditions — see [IoT Device Monitor](/docs/monitor/iot-device-monitor).
- For non-containerized hosts (Linux / macOS / Windows VMs and bare metal), use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- To learn the underlying OTLP integration in depth, see [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry).
