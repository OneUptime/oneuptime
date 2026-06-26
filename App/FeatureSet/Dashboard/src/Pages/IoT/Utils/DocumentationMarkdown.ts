export function getIoTInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- A device, gateway, or OpenTelemetry Collector that can send OTLP/HTTP to OneUptime
- Network reachability from the device/gateway to your OneUptime instance
- The telemetry ingestion key selected above (sent as the \`x-oneuptime-token\` header)

There is **no agent to install on the device side** — anything that can speak OTLP (an OpenTelemetry SDK on the device, or an OpenTelemetry Collector running on a gateway that fans out to many devices) works. For the full ingestion guide, see the [IoT Devices documentation](/docs/telemetry/iot-devices).

## How OneUptime Models IoT

OneUptime maps your devices onto two concepts using OpenTelemetry resource attributes:

- **Fleet** — a logical group of devices (for example \`building-a-sensors\` or \`field-gateways\`). The fleet is derived from the \`iot.fleet.name\` resource attribute and appears in OneUptime as the telemetry service \`iot/<fleet>\`. Set \`service.name=iot/<fleet>\` so logs and metrics line up under the same service.
- **Device** — an individual device within a fleet, identified by the \`device.id\` attribute. OneUptime builds and maintains a per-fleet device inventory keyed on \`device.id\`.

Optional attributes refine how each device is classified and scoped in monitors:

| Attribute | Required | Description |
|-----------|----------|-------------|
| \`iot.fleet.name\` | Yes | The fleet this device belongs to. Becomes the OneUptime service \`iot/<fleet>\` |
| \`device.id\` | Yes | Stable, unique id for the device within the fleet |
| \`iot.device.kind\` | No | The device class — for example \`Device\`, \`Sensor\`, or \`Gateway\`. Defaults to \`Device\` |
| \`iot.device.type\` | No | A finer device type/model used for filtering monitors (for example \`temp-sensor\`) |
| \`iot.device.firmware\` | No | Firmware version reported by the device |

## Quick Start — OpenTelemetry SDK

If your device runs an OpenTelemetry SDK directly, point it at OneUptime and stamp the IoT resource attributes via the standard \`OTEL_*\` environment variables. Replace the fleet name and device id with values for your environment:

\`\`\`bash
export OTEL_EXPORTER_OTLP_ENDPOINT=${data.oneuptimeUrl}/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${data.apiKey}
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
\`\`\`

Emit your readings as metrics using the \`iot_*\` names below. Within a minute or so the device appears under the **IoT** section of the OneUptime dashboard. Keep \`iot.fleet.name\` stable: changing it registers a brand-new fleet.

## Quick Start — OpenTelemetry Collector

When many devices report through a gateway, run an OpenTelemetry Collector on the gateway and export to OneUptime. The \`resource\` processor stamps the fleet attributes; receive readings from your devices (OTLP, an MQTT bridge, file logs, etc.) and forward them on:

\`\`\`yaml
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
    endpoint: "${data.oneuptimeUrl}/otlp"
    # OneUptime requires the JSON encoder instead of the default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "${data.apiKey}"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
\`\`\`

- **\`resource\`** stamps every record with the fleet attributes. Set \`iot.fleet.name\` (and the matching \`service.name=iot/<fleet>\`) per gateway so each gateway's devices land in the right fleet.
- Keep \`device.id\` (and optionally \`iot.device.kind\` / \`iot.device.type\` / \`iot.device.firmware\`) on each datapoint so OneUptime can resolve the individual device inside the fleet.
- **\`otlphttp\`** sends to OneUptime over HTTPS with the ingestion token attached. Note \`encoding: json\` and the \`Content-Type: application/json\` header are required.

## Metric Conventions

OneUptime recognizes the following \`iot_*\` metric names. Each datapoint should carry the \`device.id\` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.

| Metric Name | Meaning |
|-------------|---------|
| \`iot_device_up\` | Device availability. \`1\` = up/reachable, \`0\` = down. Drives the IoT Device monitor |
| \`iot_device_info\` | Identity-only signal. Carries \`device.id\` / kind / type / firmware so a device appears in the inventory even before it reports readings |
| \`iot_battery_percent\` | Battery charge level, \`0\`–\`100\` (%) |
| \`iot_signal_strength_dbm\` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |
| \`iot_temperature_celsius\` | Device or sensor temperature in °C |
| \`iot_cpu_usage_ratio\` | CPU utilization as a ratio \`0\`–\`1\` (OneUptime stores it as a percentage) |
| \`iot_memory_usage_bytes\` | Memory currently used, in bytes |
| \`iot_memory_size_bytes\` | Total memory available on the device, in bytes |
| \`iot_uptime_seconds\` | Seconds since the device last booted |

## Verify the Installation

1. Confirm your device or gateway is exporting without errors (check the SDK/collector logs for export failures and HTTP \`401\`/\`403\` responses).
2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.
3. Open the fleet's **Devices** tab — each \`device.id\` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.
4. Open **Metrics** under the fleet to chart any of the \`iot_*\` series above.

## Troubleshooting

### Fleet Does Not Appear

1. Verify \`iot.fleet.name\` is set as a **resource** attribute (not a datapoint label), and that \`service.name\` is \`iot/<fleet>\`.
2. Confirm the exporter endpoint is \`${data.oneuptimeUrl}/otlp\` and the \`x-oneuptime-token\` header carries a valid ingestion key.
3. If using a collector, ensure \`encoding: json\` and \`Content-Type: application/json\` are set on the \`otlphttp\` exporter.

### Devices Missing from the Inventory

1. Make sure each datapoint carries a \`device.id\` label — devices are keyed on it.
2. Send \`iot_device_info\` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.
3. Check that \`device.id\` values are stable across reports; a changing id creates duplicate device rows.

### HTTP 401 / 403 from the Exporter

The ingestion key is invalid, revoked, or missing. Select a different key above (or create a new one) and update the \`x-oneuptime-token\` header your device or collector sends.

For the complete ingestion guide — including the SDK and collector setup in depth, self-hosted endpoints, and configuring IoT monitors — see the [IoT Devices documentation](/docs/telemetry/iot-devices).
`;
}
