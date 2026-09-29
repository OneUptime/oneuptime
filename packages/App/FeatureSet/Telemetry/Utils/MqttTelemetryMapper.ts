import ColumnLength from "Common/Types/Database/ColumnLength";
import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * ------------------------------------------------------------------
 * MQTT telemetry mapper — pure parse & map helpers
 * ------------------------------------------------------------------
 *
 * MqttServer.ts owns the I/O (broker, sockets, queue). Everything in
 * this module is pure — no DB, no network — which is what makes the
 * MQTT topic/payload contract unit-testable.
 *
 * Topic contract (all under the fixed "oneuptime/" prefix so the
 * broker can reject foreign topics up front; fleet and device segments
 * must not contain "/", "+" or "#"):
 *
 *   oneuptime/<fleet>/<device>/telemetry
 *     JSON payload. Either { "metrics": { "<name>": <number>, ... } }
 *     or a flat object whose numeric top-level fields are the metrics.
 *     Optional "attributes" (string map, stamped on every datapoint)
 *     and "timestamp" (ISO-8601 string, or unix seconds/milliseconds —
 *     auto-detected by magnitude).
 *
 *   oneuptime/<fleet>/<device>/metrics/<metricName>
 *     Single value. Payload is a bare number ("23.4") or
 *     { "value": <number>, "attributes": {...}, "timestamp": ... }.
 *
 *   oneuptime/<fleet>/<device>/status
 *     Device liveness — this is the Last Will topic. Payload
 *     "online"/"offline" (also 1/0, true/false, up/down, or
 *     { "status": "..." }) maps to the iot_device_up metric the
 *     existing offline alert template and inventory isUp read.
 *
 * The mapped output is the standard OTLP-JSON resourceMetrics
 * envelope: the fleet rides the iot.fleet.name RESOURCE attribute and
 * the device rides the device.id DATAPOINT label, so fleet
 * auto-discovery, the IoT snapshot scan, IoT Device monitors and the
 * dashboard all work unchanged regardless of transport.
 */

export const MQTT_TOPIC_PREFIX: string = "oneuptime";

/*
 * A single publish is one device's scrape — 128 KB of JSON is already
 * hundreds of datapoints. This is the application-level cap on a
 * parsed publish payload; the raw byte stream is additionally bounded
 * BEFORE the broker buffers a packet by MqttPacketSizeGuard, since
 * the MQTT remaining-length header allows declaring ~256 MB.
 */
export const MQTT_MAX_PAYLOAD_BYTES: number = 128 * 1024;

export const MQTT_MAX_METRICS_PER_PUBLISH: number = 100;
export const MQTT_MAX_ATTRIBUTES_PER_PUBLISH: number = 20;
export const MQTT_MAX_METRIC_NAME_LENGTH: number = 255;
export const MQTT_MAX_ATTRIBUTE_LENGTH: number = 256;

// The metric the IoT offline template and inventory isUp key off.
export const MQTT_DEVICE_UP_METRIC_NAME: string = "iot_device_up";

/*
 * Top-level keys of the telemetry JSON payload that are envelope
 * fields, not metric values, in the flat-object form.
 */
const RESERVED_TELEMETRY_KEYS: ReadonlySet<string> = new Set([
  "metrics",
  "attributes",
  "timestamp",
]);

const ONLINE_STATUS_VALUES: ReadonlySet<string> = new Set([
  "online",
  "1",
  "true",
  "up",
  "connected",
]);

const OFFLINE_STATUS_VALUES: ReadonlySet<string> = new Set([
  "offline",
  "0",
  "false",
  "down",
  "disconnected",
]);

export interface MqttMetricPoint {
  name: string;
  value: number;
  attributes: Record<string, string>;
}

export interface MqttIngestPayload {
  fleetName: string;
  deviceId: string;
  timestampMs: number;
  points: Array<MqttMetricPoint>;
}

export type MqttPublishParseResult =
  | { payload: MqttIngestPayload; error?: undefined }
  | { error: string; payload?: undefined };

type ParsedMqttTopic =
  | {
      fleetName: string;
      deviceId: string;
      kind: "telemetry" | "status";
      metricName?: undefined;
    }
  | { fleetName: string; deviceId: string; kind: "metric"; metricName: string };

/*
 * Fleet and device ride Postgres ShortText columns (IoTFleet.name,
 * IoTDevice.externalId). Reject over-long segments at the broker
 * instead of silently truncating — a truncated fleet name would
 * find-or-create a DIFFERENT fleet than the device intended.
 */
function isValidIdentitySegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= ColumnLength.ShortText &&
    !segment.includes("+") &&
    !segment.includes("#") &&
    !segment.startsWith("$")
  );
}

function parseMqttTopic(topic: string): ParsedMqttTopic | null {
  const segments: Array<string> = topic.split("/");

  if (segments[0] !== MQTT_TOPIC_PREFIX) {
    return null;
  }

  const fleetName: string = segments[1] || "";
  const deviceId: string = segments[2] || "";

  if (!isValidIdentitySegment(fleetName) || !isValidIdentitySegment(deviceId)) {
    return null;
  }

  if (segments.length === 4 && segments[3] === "telemetry") {
    return { fleetName, deviceId, kind: "telemetry" };
  }

  if (segments.length === 4 && segments[3] === "status") {
    return { fleetName, deviceId, kind: "status" };
  }

  if (
    segments.length === 5 &&
    segments[3] === "metrics" &&
    isValidMetricName(segments[4] || "")
  ) {
    return {
      fleetName,
      deviceId,
      kind: "metric",
      metricName: (segments[4] as string).trim(),
    };
  }

  return null;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX: RegExp = /[\u0000-\u001f\u007f]/;

function isValidMetricName(name: string): boolean {
  const trimmed: string = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MQTT_MAX_METRIC_NAME_LENGTH &&
    !CONTROL_CHARS_REGEX.test(trimmed)
  );
}

/*
 * Finite-or-null coercion. Booleans fold to 1/0 so a device can
 * publish { "door_open": true } without hand-rolling the conversion.
 */
function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return null;
}

/*
 * Timestamps: ISO-8601 strings, or unix epoch numbers. Devices send
 * both seconds and milliseconds in the wild — magnitude disambiguates
 * (anything below 1e11 is seconds until the year 5138). Invalid or
 * absent timestamps fall back to ingest time; far-future skew is
 * additionally clamped downstream by clampIoTTimestamp on the
 * inventory path.
 */
function resolveTimestampMs(raw: unknown, nowMs: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw >= 1e11 ? Math.trunc(raw) : Math.trunc(raw * 1000);
  }

  if (typeof raw === "string" && raw.trim()) {
    const parsedMs: number = Date.parse(raw.trim());
    if (!Number.isNaN(parsedMs)) {
      return parsedMs;
    }
  }

  return nowMs;
}

/*
 * Attribute maps are capped and coerced to strings — the IoT ingest
 * path reads datapoint attributes via stringValue only (device.id,
 * iot.device.kind/type/firmware and any user-defined labels).
 * device.id is reserved: it is stamped from the topic, and a payload
 * must not be able to move a datapoint onto another device.
 */
function sanitizeAttributes(raw: unknown): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return attributes;
  }

  let count: number = 0;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MQTT_MAX_ATTRIBUTES_PER_PUBLISH) {
      break;
    }

    const trimmedKey: string = key.trim();

    if (
      !trimmedKey ||
      trimmedKey.length > MQTT_MAX_ATTRIBUTE_LENGTH ||
      trimmedKey === "device.id"
    ) {
      continue;
    }

    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }

    const stringValue: string = String(value)
      .trim()
      .substring(0, MQTT_MAX_ATTRIBUTE_LENGTH);

    if (!stringValue) {
      continue;
    }

    attributes[trimmedKey] = stringValue;
    count++;
  }

  return attributes;
}

function parseJsonObjectOrNull(text: string): JSONObject | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JSONObject;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTelemetryPayload(data: {
  topic: ParsedMqttTopic;
  text: string;
  nowMs: number;
}): MqttPublishParseResult {
  const body: JSONObject | null = parseJsonObjectOrNull(data.text);

  if (!body) {
    return { error: "Telemetry payload must be a JSON object." };
  }

  const timestampMs: number = resolveTimestampMs(body["timestamp"], data.nowMs);
  const attributes: Record<string, string> = sanitizeAttributes(
    body["attributes"],
  );

  /*
   * Explicit { "metrics": {...} } wins; otherwise every numeric (or
   * boolean) top-level field outside the reserved envelope keys is a
   * metric — friendly to constrained firmware that just serializes a
   * readings struct.
   */
  const explicitMetrics: unknown = body["metrics"];
  let metricsSource: Record<string, unknown>;

  if (
    explicitMetrics &&
    typeof explicitMetrics === "object" &&
    !Array.isArray(explicitMetrics)
  ) {
    metricsSource = explicitMetrics as Record<string, unknown>;
  } else {
    metricsSource = {};
    for (const [key, value] of Object.entries(body)) {
      if (!RESERVED_TELEMETRY_KEYS.has(key)) {
        metricsSource[key] = value;
      }
    }
  }

  const entries: Array<[string, unknown]> = Object.entries(metricsSource);

  if (entries.length > MQTT_MAX_METRICS_PER_PUBLISH) {
    return {
      error: `Telemetry payload carries ${entries.length} metrics; the maximum per publish is ${MQTT_MAX_METRICS_PER_PUBLISH}.`,
    };
  }

  const points: Array<MqttMetricPoint> = [];

  for (const [rawName, rawValue] of entries) {
    const name: string = rawName.trim();
    const value: number | null = toFiniteNumberOrNull(rawValue);

    if (!isValidMetricName(name) || value === null) {
      continue;
    }

    points.push({ name, value, attributes });
  }

  if (points.length === 0) {
    return {
      error:
        'Telemetry payload carries no numeric metric values. Expected { "metrics": { "<name>": <number> } } or numeric top-level fields.',
    };
  }

  return {
    payload: {
      fleetName: data.topic.fleetName,
      deviceId: data.topic.deviceId,
      timestampMs,
      points,
    },
  };
}

function parseSingleMetricPayload(data: {
  topic: ParsedMqttTopic & { kind: "metric" };
  text: string;
  nowMs: number;
}): MqttPublishParseResult {
  const body: JSONObject | null = parseJsonObjectOrNull(data.text);

  let value: number | null = null;
  let timestampMs: number = data.nowMs;
  let attributes: Record<string, string> = {};

  if (body) {
    value = toFiniteNumberOrNull(body["value"]);
    timestampMs = resolveTimestampMs(body["timestamp"], data.nowMs);
    attributes = sanitizeAttributes(body["attributes"]);
  } else {
    const trimmed: string = data.text.trim();
    if (trimmed) {
      const parsed: number = Number(trimmed);
      value = Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (value === null) {
    return {
      error: `Metric payload for "${data.topic.metricName}" must be a bare number or { "value": <number> }.`,
    };
  }

  return {
    payload: {
      fleetName: data.topic.fleetName,
      deviceId: data.topic.deviceId,
      timestampMs,
      points: [{ name: data.topic.metricName, value, attributes }],
    },
  };
}

function parseStatusPayload(data: {
  topic: ParsedMqttTopic;
  text: string;
  nowMs: number;
}): MqttPublishParseResult {
  let statusText: string = data.text;
  let timestampMs: number = data.nowMs;

  const body: JSONObject | null = parseJsonObjectOrNull(data.text);

  if (body) {
    timestampMs = resolveTimestampMs(body["timestamp"], data.nowMs);
    if (typeof body["status"] === "string") {
      statusText = body["status"];
    } else if (typeof body["status"] === "boolean") {
      statusText = body["status"] ? "online" : "offline";
    } else {
      statusText = "";
    }
  }

  const normalized: string = statusText.trim().toLowerCase();

  let isUp: boolean | null = null;

  if (ONLINE_STATUS_VALUES.has(normalized)) {
    isUp = true;
  } else if (OFFLINE_STATUS_VALUES.has(normalized)) {
    isUp = false;
  }

  if (isUp === null) {
    return {
      error:
        'Status payload must be "online" or "offline" (also accepted: 1/0, true/false, up/down, or { "status": "..." }).',
    };
  }

  return {
    payload: {
      fleetName: data.topic.fleetName,
      deviceId: data.topic.deviceId,
      timestampMs,
      points: [
        {
          name: MQTT_DEVICE_UP_METRIC_NAME,
          value: isUp ? 1 : 0,
          attributes: {},
        },
      ],
    },
  };
}

/*
 * Parse one MQTT publish (topic + payload) into datapoints. Returns
 * { error } for anything outside the contract — the broker rejects
 * the publish so the device gets immediate feedback instead of a
 * silent drop.
 */
export function parseMqttPublish(data: {
  topic: string;
  payload: Buffer;
  nowMs: number;
}): MqttPublishParseResult {
  if (data.payload.length > MQTT_MAX_PAYLOAD_BYTES) {
    return {
      error: `Payload is ${data.payload.length} bytes; the maximum is ${MQTT_MAX_PAYLOAD_BYTES}.`,
    };
  }

  const topic: ParsedMqttTopic | null = parseMqttTopic(data.topic);

  if (!topic) {
    return {
      error: `Unsupported topic "${data.topic}". Expected oneuptime/<fleet>/<device>/telemetry, oneuptime/<fleet>/<device>/metrics/<metricName>, or oneuptime/<fleet>/<device>/status.`,
    };
  }

  const text: string = data.payload.toString("utf8");

  if (topic.kind === "status") {
    return parseStatusPayload({ topic, text, nowMs: data.nowMs });
  }

  if (topic.kind === "metric") {
    return parseSingleMetricPayload({
      topic: topic as ParsedMqttTopic & { kind: "metric" },
      text,
      nowMs: data.nowMs,
    });
  }

  return parseTelemetryPayload({ topic, text, nowMs: data.nowMs });
}

/*
 * Map parsed datapoints onto the OTLP-JSON resourceMetrics envelope
 * the queue worker already decodes — identical shape to what an OTel
 * SDK would POST to /otlp/v1/metrics. Every metric is a gauge: MQTT
 * devices report point-in-time readings, and gauge is what the IoT
 * snapshot scan and the metric row builder read.
 */
export function buildOtlpMetricsBody(payload: MqttIngestPayload): JSONObject {
  const timeUnixNano: string = `${payload.timestampMs}000000`;

  const dataPointsByMetricName: Map<string, JSONArray> = new Map();

  for (const point of payload.points) {
    const attributes: JSONArray = [
      { key: "device.id", value: { stringValue: payload.deviceId } },
    ];

    for (const [key, value] of Object.entries(point.attributes)) {
      attributes.push({ key, value: { stringValue: value } });
    }

    const dataPoint: JSONObject = {
      timeUnixNano,
      attributes,
    };

    if (Number.isInteger(point.value)) {
      dataPoint["asInt"] = point.value;
    } else {
      dataPoint["asDouble"] = point.value;
    }

    let dataPoints: JSONArray | undefined = dataPointsByMetricName.get(
      point.name,
    );
    if (!dataPoints) {
      dataPoints = [];
      dataPointsByMetricName.set(point.name, dataPoints);
    }
    dataPoints.push(dataPoint);
  }

  const metrics: JSONArray = [];

  for (const [name, dataPoints] of dataPointsByMetricName) {
    metrics.push({ name, gauge: { dataPoints } });
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: "iot.fleet.name",
              value: { stringValue: payload.fleetName },
            },
            /*
             * Same convention the OTLP ingestion guide documents:
             * without a service.name the metrics would be attributed
             * to "Unknown Service" instead of the fleet's iot/<fleet>
             * telemetry service.
             */
            {
              key: "service.name",
              value: { stringValue: `iot/${payload.fleetName}` },
            },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "oneuptime-mqtt-ingest" },
            metrics,
          },
        ],
      },
    ],
  };
}
