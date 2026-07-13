import {
  buildOtlpMetricsBody,
  parseMqttPublish,
  MqttIngestPayload,
  MqttPublishParseResult,
  MQTT_MAX_METRICS_PER_PUBLISH,
  MQTT_MAX_PAYLOAD_BYTES,
} from "../../FeatureSet/Telemetry/Utils/MqttTelemetryMapper";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The MQTT topic/payload contract is what devices in the field are
 * programmed against — these tests pin it down so a refactor cannot
 * silently change what a fleet of deployed sensors is publishing to.
 */

const NOW_MS: number = 1750000000000;

function parse(topic: string, payload: string): MqttPublishParseResult {
  return parseMqttPublish({
    topic,
    payload: Buffer.from(payload, "utf8"),
    nowMs: NOW_MS,
  });
}

function expectPayload(result: MqttPublishParseResult): MqttIngestPayload {
  expect(result.error).toBeUndefined();
  expect(result.payload).toBeDefined();
  return result.payload as MqttIngestPayload;
}

describe("parseMqttPublish — telemetry topic", () => {
  test("parses the metrics-wrapper form and stamps fleet/device from the topic", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/building-a/sensor-001/telemetry",
      JSON.stringify({
        metrics: { iot_device_up: 1, iot_temperature_celsius: 21.5 },
      }),
    );

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.fleetName).toBe("building-a");
    expect(payload.deviceId).toBe("sensor-001");
    expect(payload.timestampMs).toBe(NOW_MS);
    expect(payload.points).toHaveLength(2);
    expect(payload.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "iot_device_up", value: 1 }),
        expect.objectContaining({
          name: "iot_temperature_celsius",
          value: 21.5,
        }),
      ]),
    );
  });

  test("parses the flat form, skipping reserved keys and non-numeric fields", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/fleet/dev/telemetry",
      JSON.stringify({
        iot_battery_percent: 87,
        door_open: true,
        label: "not-a-metric",
        timestamp: 1750000000,
        attributes: { "iot.device.type": "temp-sensor" },
      }),
    );

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.points).toHaveLength(2);
    expect(payload.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "iot_battery_percent", value: 87 }),
        // booleans coerce to 1/0
        expect.objectContaining({ name: "door_open", value: 1 }),
      ]),
    );
    // attributes ride every datapoint
    for (const point of payload.points) {
      expect(point.attributes["iot.device.type"]).toBe("temp-sensor");
    }
  });

  test("unix-seconds timestamps are auto-detected and scaled to ms", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({ metrics: { m: 1 }, timestamp: 1750000123 }),
    );
    expect(expectPayload(result).timestampMs).toBe(1750000123000);
  });

  test("unix-milliseconds and ISO-8601 timestamps are accepted", () => {
    const ms: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({ metrics: { m: 1 }, timestamp: 1750000123456 }),
    );
    expect(expectPayload(ms).timestampMs).toBe(1750000123456);

    const iso: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({ metrics: { m: 1 }, timestamp: "2025-06-15T00:00:00Z" }),
    );
    expect(expectPayload(iso).timestampMs).toBe(
      Date.parse("2025-06-15T00:00:00Z"),
    );
  });

  test("invalid timestamps fall back to ingest time", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({ metrics: { m: 1 }, timestamp: "not-a-date" }),
    );
    expect(expectPayload(result).timestampMs).toBe(NOW_MS);
  });

  test("device.id cannot be overridden through payload attributes", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/real-device/telemetry",
      JSON.stringify({
        metrics: { m: 1 },
        attributes: { "device.id": "spoofed-device", ok: "yes" },
      }),
    );

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.points[0]?.attributes["device.id"]).toBeUndefined();
    expect(payload.points[0]?.attributes["ok"]).toBe("yes");
  });

  test("non-scalar attribute values are dropped", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({
        metrics: { m: 1 },
        attributes: { nested: { a: 1 }, list: [1], fine: 42 },
      }),
    );

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.points[0]?.attributes).toEqual({ fine: "42" });
  });

  test("rejects non-JSON payloads", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      "not json",
    );
    expect(result.error).toBeDefined();
  });

  test("rejects payloads with no numeric metric values", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({ metrics: { m: "NaN-ish" } }),
    );
    expect(result.error).toBeDefined();
  });

  test("rejects payloads with too many metrics", () => {
    const metrics: Record<string, number> = {};
    for (let i: number = 0; i <= MQTT_MAX_METRICS_PER_PUBLISH; i++) {
      metrics[`metric_${i}`] = i;
    }
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/telemetry",
      JSON.stringify({ metrics }),
    );
    expect(result.error).toBeDefined();
  });

  test("rejects oversized payloads", () => {
    const result: MqttPublishParseResult = parseMqttPublish({
      topic: "oneuptime/f/d/telemetry",
      payload: Buffer.alloc(MQTT_MAX_PAYLOAD_BYTES + 1),
      nowMs: NOW_MS,
    });
    expect(result.error).toBeDefined();
  });
});

describe("parseMqttPublish — single-metric topic", () => {
  test("accepts a bare-number payload", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/metrics/iot_temperature_celsius",
      "23.4",
    );

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.points).toEqual([
      { name: "iot_temperature_celsius", value: 23.4, attributes: {} },
    ]);
  });

  test("accepts the { value } JSON form with attributes and timestamp", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/metrics/iot_battery_percent",
      JSON.stringify({
        value: 55,
        timestamp: 1750000123,
        attributes: { "iot.device.kind": "Sensor" },
      }),
    );

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.timestampMs).toBe(1750000123000);
    expect(payload.points).toEqual([
      {
        name: "iot_battery_percent",
        value: 55,
        attributes: { "iot.device.kind": "Sensor" },
      },
    ]);
  });

  test("rejects non-numeric payloads", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/metrics/iot_battery_percent",
      "full",
    );
    expect(result.error).toBeDefined();
  });
});

describe("parseMqttPublish — status topic (Last Will)", () => {
  test.each([
    ["online", 1],
    ["offline", 0],
    ["1", 1],
    ["0", 0],
    ["true", 1],
    ["false", 0],
    ["up", 1],
    ["down", 0],
    ["  Online  ", 1],
  ])('maps "%s" to iot_device_up=%d', (text: string, expected: number) => {
    const result: MqttPublishParseResult = parse("oneuptime/f/d/status", text);

    const payload: MqttIngestPayload = expectPayload(result);
    expect(payload.points).toEqual([
      { name: "iot_device_up", value: expected, attributes: {} },
    ]);
  });

  test('accepts the { "status": ... } JSON form', () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/status",
      JSON.stringify({ status: "offline" }),
    );
    expect(expectPayload(result).points[0]?.value).toBe(0);
  });

  test("rejects unknown status text", () => {
    const result: MqttPublishParseResult = parse(
      "oneuptime/f/d/status",
      "sleepy",
    );
    expect(result.error).toBeDefined();
  });
});

describe("parseMqttPublish — topic validation", () => {
  test.each([
    ["outside the oneuptime/ prefix", "other/f/d/telemetry"],
    ["missing suffix", "oneuptime/f/d"],
    ["unknown suffix", "oneuptime/f/d/other"],
    ["empty fleet segment", "oneuptime//d/telemetry"],
    ["empty device segment", "oneuptime/f//telemetry"],
    ["wildcard in fleet", "oneuptime/+/d/telemetry"],
    ["wildcard in device", "oneuptime/f/#/telemetry"],
    ["$-prefixed fleet", "oneuptime/$sys/d/telemetry"],
    ["over-long fleet segment", `oneuptime/${"f".repeat(101)}/d/telemetry`],
    ["metrics suffix without a metric name", "oneuptime/f/d/metrics/"],
    ["too many segments", "oneuptime/f/d/telemetry/extra"],
  ])("rejects %s", (_label: string, topic: string) => {
    const result: MqttPublishParseResult = parse(
      topic,
      JSON.stringify({ metrics: { m: 1 } }),
    );
    expect(result.error).toBeDefined();
  });
});

describe("buildOtlpMetricsBody", () => {
  function firstMetric(body: JSONObject): JSONObject {
    const resourceMetrics: JSONArray = body["resourceMetrics"] as JSONArray;
    const scopeMetrics: JSONArray = (resourceMetrics[0] as JSONObject)[
      "scopeMetrics"
    ] as JSONArray;
    const metrics: JSONArray = (scopeMetrics[0] as JSONObject)[
      "metrics"
    ] as JSONArray;
    return metrics[0] as JSONObject;
  }

  test("builds the OTLP envelope the metrics queue worker decodes", () => {
    const body: JSONObject = buildOtlpMetricsBody({
      fleetName: "building-a",
      deviceId: "sensor-001",
      timestampMs: NOW_MS,
      points: [
        {
          name: "iot_battery_percent",
          value: 87.5,
          attributes: { "iot.device.type": "temp-sensor" },
        },
      ],
    });

    const resourceMetrics: JSONArray = body["resourceMetrics"] as JSONArray;
    expect(resourceMetrics).toHaveLength(1);

    /*
     * Fleet rides the RESOURCE attributes — that is the fleet join key —
     * and service.name follows the documented iot/<fleet> convention.
     */
    const resource: JSONObject = (resourceMetrics[0] as JSONObject)[
      "resource"
    ] as JSONObject;
    expect(resource["attributes"]).toEqual([
      { key: "iot.fleet.name", value: { stringValue: "building-a" } },
      { key: "service.name", value: { stringValue: "iot/building-a" } },
    ]);

    const metric: JSONObject = firstMetric(body);
    expect(metric["name"]).toBe("iot_battery_percent");

    const dataPoints: JSONArray = (metric["gauge"] as JSONObject)[
      "dataPoints"
    ] as JSONArray;
    expect(dataPoints).toHaveLength(1);

    const dataPoint: JSONObject = dataPoints[0] as JSONObject;
    // Non-integers ride asDouble; timeUnixNano is a nanosecond string.
    expect(dataPoint["asDouble"]).toBe(87.5);
    expect(dataPoint["asInt"]).toBeUndefined();
    expect(dataPoint["timeUnixNano"]).toBe(`${NOW_MS}000000`);

    // Device rides the DATAPOINT attributes — device.id first, then user attrs.
    expect(dataPoint["attributes"]).toEqual([
      { key: "device.id", value: { stringValue: "sensor-001" } },
      { key: "iot.device.type", value: { stringValue: "temp-sensor" } },
    ]);
  });

  test("integer values ride asInt", () => {
    const body: JSONObject = buildOtlpMetricsBody({
      fleetName: "f",
      deviceId: "d",
      timestampMs: NOW_MS,
      points: [{ name: "iot_device_up", value: 1, attributes: {} }],
    });

    const metric: JSONObject = firstMetric(body);
    const dataPoint: JSONObject = (
      (metric["gauge"] as JSONObject)["dataPoints"] as JSONArray
    )[0] as JSONObject;
    expect(dataPoint["asInt"]).toBe(1);
    expect(dataPoint["asDouble"]).toBeUndefined();
  });

  test("same-name points merge into one metric with multiple datapoints", () => {
    const body: JSONObject = buildOtlpMetricsBody({
      fleetName: "f",
      deviceId: "d",
      timestampMs: NOW_MS,
      points: [
        { name: "m", value: 1, attributes: {} },
        { name: "m", value: 2, attributes: {} },
        { name: "other", value: 3, attributes: {} },
      ],
    });

    const resourceMetrics: JSONArray = body["resourceMetrics"] as JSONArray;
    const scopeMetrics: JSONArray = (resourceMetrics[0] as JSONObject)[
      "scopeMetrics"
    ] as JSONArray;
    const metrics: JSONArray = (scopeMetrics[0] as JSONObject)[
      "metrics"
    ] as JSONArray;

    expect(metrics).toHaveLength(2);
    const merged: JSONObject = metrics[0] as JSONObject;
    expect(merged["name"]).toBe("m");
    expect(
      ((merged["gauge"] as JSONObject)["dataPoints"] as JSONArray).length,
    ).toBe(2);
  });
});
