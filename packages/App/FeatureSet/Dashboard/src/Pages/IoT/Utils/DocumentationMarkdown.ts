import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideKeyStep,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * How the devices' readings reach OneUptime. There is no agent to install:
 * an OpenTelemetry SDK on the device, a Collector on a gateway, or any MQTT
 * client all feed the same fleet inventory, dashboards and monitors. The
 * two OpenTelemetry paths are separate options because the reader does
 * different things for each — set environment variables on a device, or
 * run a collector with a config file on a gateway.
 */
export type IoTIngestionMethod =
  | "opentelemetry-sdk"
  | "opentelemetry-collector"
  | "mqtt";

export const IOT_INGESTION_METHODS: Array<
  SetupGuideOption<IoTIngestionMethod>
> = [
  {
    key: "opentelemetry-sdk",
    label: "OpenTelemetry SDK",
    description:
      "An OpenTelemetry SDK on the device sends OTLP/HTTP straight to OneUptime.",
  },
  {
    key: "opentelemetry-collector",
    label: "OpenTelemetry Collector",
    description:
      "A Collector on a gateway forwards the readings of many devices.",
  },
  {
    key: "mqtt",
    label: "MQTT",
    description:
      "Publish JSON readings straight to OneUptime's built-in MQTT endpoint — no SDK or collector.",
  },
];

export const DEFAULT_IOT_INGESTION_METHOD: IoTIngestionMethod =
  "opentelemetry-sdk";

export function resolveIoTIngestionMethod(
  method: string | null | undefined,
): IoTIngestionMethod {
  return (
    resolveSetupGuideOption(IOT_INGESTION_METHODS, method) ||
    DEFAULT_IOT_INGESTION_METHOD
  );
}

// The fleet and device the snippets use until the reader substitutes theirs.
export const IOT_EXAMPLE_FLEET_NAME: string = "building-a-sensors";
export const IOT_EXAMPLE_DEVICE_ID: string = "sensor-001";
export const IOT_EXAMPLE_GATEWAY_FLEET_NAME: string = "field-gateways";

// The one topic prefix the MQTT endpoint accepts.
export const IOT_MQTT_TOPIC_PREFIX: string = "oneuptime";

/**
 * The MQTT-over-WebSocket endpoint: the instance URL with its scheme turned
 * into ws(s)://, at /mqtt. It rides the same ingress as the dashboard, so it
 * works on every deployment.
 */
export function getIoTMqttWebSocketUrl(oneuptimeUrl: string): string {
  return `${oneuptimeUrl.replace(/^http/, "ws")}/mqtt`;
}

export interface IoTMetricConvention {
  name: string;
  meaning: string;
}

// The iot_* metric names OneUptime reads into the device inventory.
export const IOT_METRIC_CONVENTIONS: Array<IoTMetricConvention> = [
  {
    name: "iot_device_up",
    meaning:
      "Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor",
  },
  {
    name: "iot_device_info",
    meaning:
      "Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings",
  },
  {
    name: "iot_battery_percent",
    meaning: "Battery charge level, `0`–`100` (%)",
  },
  {
    name: "iot_signal_strength_dbm",
    meaning:
      "Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI)",
  },
  {
    name: "iot_temperature_celsius",
    meaning: "Device or sensor temperature in °C",
  },
  {
    name: "iot_cpu_usage_ratio",
    meaning:
      "CPU utilization as a ratio `0`–`1` (OneUptime stores it as a percentage)",
  },
  {
    name: "iot_memory_usage_bytes",
    meaning: "Memory currently used, in bytes",
  },
  {
    name: "iot_memory_size_bytes",
    meaning: "Total memory available on the device, in bytes",
  },
  {
    name: "iot_uptime_seconds",
    meaning: "Seconds since the device last booted",
  },
];

export interface IoTSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  method: IoTIngestionMethod;
}

function isMqtt(method: IoTIngestionMethod): boolean {
  return method === "mqtt";
}

function getPlaceholderNote(apiKey: string): string {
  if (apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    return "";
  }
  return `\n\nPick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;
}

const TOPIC_PREFIX: string = `${IOT_MQTT_TOPIC_PREFIX}/${IOT_EXAMPLE_FLEET_NAME}/${IOT_EXAMPLE_DEVICE_ID}`;

// The example reading, as the MQTT step publishes it.
const EXAMPLE_TELEMETRY_PAYLOAD: string =
  '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5}}';

function getKeyStep(data: IoTSetupGuideOptions): SetupGuideKeyStep {
  if (isMqtt(data.method)) {
    return {
      description:
        "Devices authenticate to the MQTT endpoint with this key as their password. Pick an existing key or create a new one — the snippets below update to use it.",
      endpointLabel: "MQTT WebSocket URL",
      endpointValue: getIoTMqttWebSocketUrl(data.oneuptimeUrl),
      endpointHint:
        "Send the ingestion token below as the MQTT password — the username is ignored.",
    };
  }

  return {
    description:
      data.method === "opentelemetry-collector"
        ? "The gateway's collector sends readings to OneUptime with this key, in the x-oneuptime-token header. Pick an existing key or create a new one — the config below updates to use it."
        : "Your devices send readings to OneUptime with this key, in the x-oneuptime-token header. Pick an existing key or create a new one — the snippets below update to use it.",
    endpointLabel: "OTLP Endpoint",
    endpointValue: `${data.oneuptimeUrl}/otlp`,
  };
}

function getPrerequisites(method: IoTIngestionMethod): Array<string> {
  switch (method) {
    case "opentelemetry-sdk":
      return [
        "A device running an OpenTelemetry SDK that exports OTLP over HTTP",
        "Network access from the device to your OneUptime instance",
      ];
    case "opentelemetry-collector":
      return [
        "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)",
        "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance",
      ];
    case "mqtt":
      return [
        "Any MQTT client that can connect over WebSocket",
        "Network access from the device to your OneUptime instance",
      ];
  }
}

function getSdkConfigureStep(data: IoTSetupGuideOptions): SetupGuideStep {
  return {
    title: "Point the SDK at OneUptime",
    description:
      "Set the standard OpenTelemetry environment variables on the device.",
    markdown: `${codeBlock(
      "bash",
      `export OTEL_EXPORTER_OTLP_ENDPOINT=${shellQuote(`${data.oneuptimeUrl}/otlp`)}
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS=${shellQuote(`x-oneuptime-token=${data.apiKey}`)}
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=${IOT_EXAMPLE_FLEET_NAME},device.id=${IOT_EXAMPLE_DEVICE_ID},service.name=iot/${IOT_EXAMPLE_FLEET_NAME}`,
    )}

Replace \`${IOT_EXAMPLE_FLEET_NAME}\` and \`${IOT_EXAMPLE_DEVICE_ID}\` with your fleet name and device id. Keep \`iot.fleet.name\` stable: changing it registers a brand-new fleet.${getPlaceholderNote(data.apiKey)}`,
  };
}

function getSdkRecordStep(): SetupGuideStep {
  return {
    title: "Record readings as iot_* metrics",
    description:
      "Use the metric names OneUptime recognizes, with the device id on every datapoint.",
    markdown: `Emit your readings as metrics named after the \`iot_*\` conventions, and give every datapoint a \`device.id\` attribute — for example:

| Metric | Value | Datapoint attribute |
|--------|-------|---------------------|
| \`iot_device_up\` | \`1\` | \`device.id=${IOT_EXAMPLE_DEVICE_ID}\` |
| \`iot_battery_percent\` | \`87\` | \`device.id=${IOT_EXAMPLE_DEVICE_ID}\` |
| \`iot_temperature_celsius\` | \`21.5\` | \`device.id=${IOT_EXAMPLE_DEVICE_ID}\` |

The device inventory is keyed on the datapoint's \`device.id\`, not the resource's, so set it on each measurement as well as in \`OTEL_RESOURCE_ATTRIBUTES\`. Every recognized name is under **Metric conventions** in Advanced.`,
  };
}

function getGatewayConfig(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `receivers:
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
        value: ${IOT_EXAMPLE_GATEWAY_FLEET_NAME}
        action: upsert
      - key: service.name
        value: iot/${IOT_EXAMPLE_GATEWAY_FLEET_NAME}
        action: upsert

exporters:
  otlphttp:
    endpoint: "${data.oneuptimeUrl}/otlp"
    headers:
      "x-oneuptime-token": "${data.apiKey}"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]`;
}

function getGatewayConfigStep(data: IoTSetupGuideOptions): SetupGuideStep {
  return {
    title: "Save the gateway's collector config",
    description:
      "The collector receives OTLP from your devices, stamps the fleet on it and forwards it to OneUptime.",
    markdown: `Save this as \`config.yaml\` on the gateway:

${codeBlock("yaml", getGatewayConfig(data))}

- Set \`iot.fleet.name\` (and the matching \`service.name=iot/<fleet>\`) per gateway so each gateway's devices land in the right fleet.
- Keep \`device.id\` (and optionally \`iot.device.kind\` / \`iot.device.type\` / \`iot.device.firmware\`) on each datapoint so OneUptime can resolve the individual device inside the fleet.${getPlaceholderNote(data.apiKey)}`,
  };
}

// Where devices send once the gateway runs: the ports its otlp receiver opens.
const GATEWAY_DEVICES_NOTE: string =
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.";

function getGatewayRunStep(): SetupGuideStep {
  return {
    title: "Run the collector on the gateway",
    description:
      "Start the OpenTelemetry Collector with the config, then point your devices at the gateway.",
    variants: [
      {
        label: "Docker",
        markdown: `Run it from the directory that holds \`config.yaml\`:

${codeBlock(
  "bash",
  `docker run -d \\
  --name otel-collector \\
  --restart unless-stopped \\
  -p 4317:4317 \\
  -p 4318:4318 \\
  -v $(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml:ro \\
  otel/opentelemetry-collector-contrib:latest \\
  --config /etc/otelcol-contrib/config.yaml`,
)}

${GATEWAY_DEVICES_NOTE}`,
      },
      {
        label: "otelcol-contrib binary",
        markdown: `Already have \`otelcol-contrib\` on the gateway? Point it at the file:

${codeBlock("bash", "otelcol-contrib --config config.yaml")}

${GATEWAY_DEVICES_NOTE}`,
      },
    ],
  };
}

function getMqttPublishStep(data: IoTSetupGuideOptions): SetupGuideStep {
  const url: string = getIoTMqttWebSocketUrl(data.oneuptimeUrl);

  return {
    title: "Publish a reading",
    description:
      "Connect with the key as the MQTT password, then publish JSON readings under the oneuptime/ topic prefix.",
    markdown: `${codeBlock(
      "text",
      `Topic:   ${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/telemetry
Payload: ${EXAMPLE_TELEMETRY_PAYLOAD}`,
    )}

For example, with the Node.js \`mqtt\` client (\`npm install mqtt\`):

${codeBlock(
  "javascript",
  `const mqtt = require("mqtt");

const client = mqtt.connect("${url}", {
  username: "oneuptime", // ignored — the key below is what authenticates
  password: "${data.apiKey}",
  will: {
    topic: "${TOPIC_PREFIX}/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("${TOPIC_PREFIX}/status", "online");
  client.publish(
    "${TOPIC_PREFIX}/telemetry",
    JSON.stringify({ metrics: { iot_device_up: 1, iot_temperature_celsius: 21.5 } }),
  );
});`,
)}

Replace \`${IOT_EXAMPLE_FLEET_NAME}\` and \`${IOT_EXAMPLE_DEVICE_ID}\` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).${getPlaceholderNote(data.apiKey)}`,
  };
}

function getVerifyStep(method: IoTIngestionMethod): SetupGuideStep {
  let first: string =
    "Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.";

  if (method === "opentelemetry-collector") {
    first =
      "Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).";
  } else if (method === "mqtt") {
    first =
      "Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.";
  }

  const devices: string = isMqtt(method)
    ? "each device you published for"
    : "each `device.id` you sent";

  return {
    title: "Check the fleet appears",
    description:
      "The fleet shows up in the IoT section within a minute or so of the first readings.",
    markdown: `1. ${first}
2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.
3. Open the fleet's **Devices** tab — ${devices} should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.
4. Open **Metrics** under the fleet to chart any of the \`iot_*\` series.`,
  };
}

function getSteps(data: IoTSetupGuideOptions): Array<SetupGuideStep> {
  switch (data.method) {
    case "opentelemetry-sdk":
      return [
        getSdkConfigureStep(data),
        getSdkRecordStep(),
        getVerifyStep(data.method),
      ];
    case "opentelemetry-collector":
      return [
        getGatewayConfigStep(data),
        getGatewayRunStep(),
        getVerifyStep(data.method),
      ];
    case "mqtt":
      return [getMqttPublishStep(data), getVerifyStep(data.method)];
  }
}

interface IoTAttribute {
  key: string;
  description: string;
}

// Optional attributes that classify a device; the inventory reads them from each datapoint.
const OPTIONAL_DEVICE_ATTRIBUTES: Array<IoTAttribute> = [
  {
    key: "iot.device.kind",
    description:
      "The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device`",
  },
  {
    key: "iot.device.type",
    description:
      "A finer device type/model used for filtering monitors (for example `temp-sensor`)",
  },
  {
    key: "iot.device.firmware",
    description: "Firmware version reported by the device",
  },
];

function getModelTopic(method: IoTIngestionMethod): SetupGuideTopic {
  const title: string = "How OneUptime models IoT";
  const summary: string =
    "Fleets and devices, and the attributes that identify and classify them.";

  if (isMqtt(method)) {
    return {
      title: title,
      summary: summary,
      markdown: `There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:

- **Fleet** — the \`<fleet>\` in \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/…\`: a logical group of devices (for example \`${IOT_EXAMPLE_FLEET_NAME}\`). It becomes the \`iot.fleet.name\` of the readings and appears in OneUptime as the telemetry service \`iot/<fleet>\`.
- **Device** — the \`<device>\` in \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/…\`: an individual device within the fleet. It becomes the \`device.id\` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.

Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish's \`"attributes"\` map — they are stamped on every datapoint of that publish:

| Attribute | Description |
|-----------|-------------|
${OPTIONAL_DEVICE_ATTRIBUTES.map((attribute: IoTAttribute): string => {
  return `| \`${attribute.key}\` | ${attribute.description} |`;
}).join("\n")}`,
    };
  }

  return {
    title: title,
    summary: summary,
    markdown: `There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:

- **Fleet** — a logical group of devices (for example \`${IOT_EXAMPLE_FLEET_NAME}\` or \`${IOT_EXAMPLE_GATEWAY_FLEET_NAME}\`). The fleet is derived from the \`iot.fleet.name\` resource attribute and appears in OneUptime as the telemetry service \`iot/<fleet>\`. Set \`service.name=iot/<fleet>\` so logs and metrics line up under the same service.
- **Device** — an individual device within a fleet, identified by the \`device.id\` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on \`device.id\`.

The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:

| Attribute | Set on | Required | Description |
|-----------|--------|----------|-------------|
| \`iot.fleet.name\` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service \`iot/<fleet>\` |
| \`device.id\` | Each datapoint | Yes | Stable, unique id for the device within the fleet |
${OPTIONAL_DEVICE_ATTRIBUTES.map((attribute: IoTAttribute): string => {
  return `| \`${attribute.key}\` | Each datapoint | No | ${attribute.description} |`;
}).join("\n")}`,
  };
}

function getMetricConventionsTopic(
  method: IoTIngestionMethod,
): SetupGuideTopic {
  const attribution: string = isMqtt(method)
    ? "Over MQTT the topic names the device, so every reading is attributed to it."
    : "Each datapoint should carry the `device.id` label so the reading is attributed to the right device.";

  return {
    title: "Metric conventions",
    summary:
      "The metric names OneUptime recognizes, such as iot_device_up and iot_battery_percent.",
    markdown: `OneUptime recognizes the following \`iot_*\` metric names. ${attribution} You only need to send the metrics that make sense for your device — missing ones are simply not charted.

| Metric Name | Meaning |
|-------------|---------|
${IOT_METRIC_CONVENTIONS.map((metric: IoTMetricConvention): string => {
  return `| \`${metric.name}\` | ${metric.meaning} |`;
}).join("\n")}`,
  };
}

function getGatewayExporterTopic(): SetupGuideTopic {
  return {
    title: "How the gateway config works",
    summary:
      "What each part of the gateway config does, and the encodings OneUptime accepts.",
    markdown: `- **\`otlp\`** receives from your devices over gRPC (\`4317\`) and HTTP (\`4318\`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.
- **\`resource\`** stamps every record with the fleet attributes. Set \`iot.fleet.name\` (and the matching \`service.name=iot/<fleet>\`) per gateway so each gateway's devices land in the right fleet.
- **\`batch\`** groups records before export so the gateway does not pay one HTTP round trip per reading.
- **\`otlphttp\`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and \`encoding: json\` are accepted.`,
  };
}

function getDeviceCredentialTopic(): SetupGuideTopic {
  return {
    title: "Give each device its own credential",
    summary:
      "Per-device MQTT credentials from the fleet's Device Registry tab, with topic isolation and revocation.",
    markdown: `The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab once the fleet exists: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**.

- **Topic isolation** — a device credential can only publish under its own \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/…\` topics; anything else is dropped.
- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within about a minute.
- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.`,
  };
}

function getLastWillTopic(): SetupGuideTopic {
  return {
    title: "Detect offline devices with a Last Will",
    summary:
      "Report a device offline the moment its connection drops, and keep the keepalive under five minutes.",
    markdown: `Register an MQTT **Last Will** on \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/status\` with payload \`offline\` — if the device dies, OneUptime publishes \`iot_device_up = 0\` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish \`online\` to the same topic after connecting so the device shows as up again; the example in step 2 does both. The status topic also accepts \`1\`/\`0\`, \`true\`/\`false\` and \`up\`/\`down\`.

Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.`,
  };
}

function getMqttTopicsTopic(): SetupGuideTopic {
  return {
    title: "MQTT topics and payloads",
    summary:
      "Every topic the MQTT endpoint accepts, and the payload each one takes.",
    markdown: `Publish under the fixed \`${IOT_MQTT_TOPIC_PREFIX}/\` prefix. The fleet and device segments must not contain \`/\`, \`+\` or \`#\` or start with \`$\`, and are limited to 100 characters.

| Topic | Payload |
|-------|---------|
| \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/telemetry\` | A JSON object of readings — \`{"metrics":{"iot_temperature_celsius":21.5}}\`, or a flat object whose numeric fields are the metrics |
| \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/metrics/<metricName>\` | A single value — a bare number (\`23.4\`) or \`{"value":23.4}\` |
| \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/status\` | \`online\` or \`offline\` — maps to \`iot_device_up\` |

Telemetry payloads may also carry \`"attributes"\` (a string map stamped on every datapoint — use it for \`iot.device.kind\`, \`iot.device.type\`, \`iot.device.firmware\`, or your own labels) and \`"timestamp"\` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when \`timestamp\` is absent.

The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.`,
  };
}

function getRawTcpTopic(apiKey: string): SetupGuideTopic {
  return {
    title: "Raw MQTT over TCP (self-hosted)",
    summary:
      "Expose the app's MQTT TCP listener, port 1883 by default, for devices that cannot use WebSocket.",
    markdown: `Self-hosted deployments can additionally expose raw MQTT TCP (\`MQTT_INGEST_PORT\`, default \`1883\`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.

${codeBlock(
  "bash",
  `mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \\
  -u oneuptime -P ${shellQuote(apiKey)} \\
  -t "${TOPIC_PREFIX}/telemetry" \\
  -m '${EXAMPLE_TELEMETRY_PAYLOAD}'`,
)}

Set \`MQTT_INGEST_ENABLED=false\` on the app service to turn the MQTT listeners off.`,
  };
}

function getAdvancedTopics(data: IoTSetupGuideOptions): Array<SetupGuideTopic> {
  const topics: Array<SetupGuideTopic> = [
    getModelTopic(data.method),
    getMetricConventionsTopic(data.method),
  ];

  if (data.method === "opentelemetry-collector") {
    topics.push(getGatewayExporterTopic());
  }

  if (isMqtt(data.method)) {
    topics.push(
      getDeviceCredentialTopic(),
      getLastWillTopic(),
      getMqttTopicsTopic(),
      getRawTcpTopic(data.apiKey),
    );
  }

  return topics;
}

const NOT_CHARTING_TOPIC: SetupGuideTopic = {
  title: "Readings do not show on the fleet's charts",
  markdown: `1. Use the exact \`iot_*\` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.
2. \`iot_cpu_usage_ratio\` is a \`0\`–\`1\` ratio; send the raw ratio and OneUptime renders it as a percentage.
3. Allow up to a minute for the first datapoints to surface after a device starts reporting.`,
};

function getTroubleshootingTopics(
  data: IoTSetupGuideOptions,
): Array<SetupGuideTopic> {
  if (isMqtt(data.method)) {
    return [
      {
        title: "The fleet does not appear",
        markdown: `1. Confirm the topic follows \`${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/…\` exactly — the fleet segment of the topic is what creates the fleet.
2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (\`MQTT: dropped publish to …\`).`,
      },
      {
        title: 'The connection is refused with "bad username or password"',
        markdown: `OneUptime rejects bad credentials at CONNECT with return code 4. Check that:

- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;
- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.`,
      },
      {
        title: "Devices are missing from the inventory",
        markdown: `1. The device id is the \`<device>\` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.
2. Publish \`iot_device_info\` (identity-only) or a \`status\` message for devices that have not yet reported readings, so they still show up in the inventory.`,
      },
      {
        title: "Devices flip to offline while they are running",
        markdown:
          "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.",
      },
      NOT_CHARTING_TOPIC,
    ];
  }

  return [
    {
      title: "The fleet does not appear",
      markdown: `1. Verify \`iot.fleet.name\` is set as a **resource** attribute (not a datapoint label), and that \`service.name\` is \`iot/<fleet>\`.
2. Confirm the exporter endpoint is \`${data.oneuptimeUrl}/otlp\` and the \`x-oneuptime-token\` header carries a valid ingestion key.`,
    },
    {
      title: "Devices are missing from the inventory",
      markdown: `1. Make sure each datapoint carries a \`device.id\` label — devices are keyed on it.
2. Send \`iot_device_info\` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.
3. Check that \`device.id\` values are stable across reports; a changing id creates duplicate device rows.`,
    },
    {
      title: "HTTP 401 or 422 from the exporter",
      markdown:
        "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.",
    },
    NOT_CHARTING_TOPIC,
  ];
}

/**
 * The IoT ingestion guide for one way of connecting devices, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getIoTSetupGuide(
  options: IoTSetupGuideOptions,
): SetupGuideContent {
  return {
    keyStep: getKeyStep(options),
    prerequisites: getPrerequisites(options.method),
    steps: getSteps(options),
    advanced: getAdvancedTopics(options),
    troubleshooting: getTroubleshootingTopics(options),
    links: [
      {
        title: "IoT Devices documentation",
        url: "/docs/telemetry/iot-devices",
      },
      {
        title: "IoT Device Monitor",
        url: "/docs/monitor/iot-device-monitor",
      },
    ],
  };
}
