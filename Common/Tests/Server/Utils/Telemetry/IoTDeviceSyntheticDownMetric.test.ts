import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import {
  IOT_SYNTHETIC_ATTRIBUTE_KEY,
  IOT_SYNTHETIC_OFFLINE_DETECTION,
  buildSyntheticDeviceDownMetricRow,
} from "../../../../Server/Utils/Telemetry/IoTSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

/*
 * buildSyntheticDeviceDownMetricRow — the iot_device_up = 0 row the
 * heartbeat sweep emits for a silence-detected device. The row must
 * group into the SAME monitor series as the device's real datapoints
 * (identical attribute keys — see monitorIoT's query scoping), so any
 * attribute drift here silently splits the series and the Device
 * Offline monitors stop seeing the outage. These tests lock in:
 *
 *   - the exact attribute set real device-scoped series carry
 *     (resource.iot.fleet.name, device.id, iot.device.kind,
 *     iot.scope = "device") plus the synthetic marker, with the
 *     optional iot.device.type / iot.device.firmware keys present
 *     only when known,
 *   - attributeKeys sorted (ClickHouse-side key lookups depend on it),
 *   - value 0 on the iot_device_up gauge,
 *   - timestamps: timeUnixNano = ms x 1e6 as a string, ClickHouse
 *     datetime for time/createdAt, and retentionDate derived from
 *     retentionDays,
 *   - the lean insertJsonRows column set with NO primaryEntityId
 *     (monitor queries filter on attributes, not service).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const AT: Date = new Date("2026-06-13T12:00:00.000Z");

function buildRow(
  overrides: Partial<
    Parameters<typeof buildSyntheticDeviceDownMetricRow>[0]
  > = {},
): JSONObject {
  return buildSyntheticDeviceDownMetricRow({
    projectId: PROJECT_ID,
    fleetName: "field-sensors-us-east",
    kind: "Sensor",
    externalId: "sensor-7",
    deviceType: "temp-sensor",
    firmwareVersion: "2.0.1",
    at: AT,
    retentionDays: 15,
    ...overrides,
  });
}

describe("buildSyntheticDeviceDownMetricRow — attributes", () => {
  test("carries the exact attribute set real device-scoped series carry, plus the synthetic marker", () => {
    const row: JSONObject = buildRow();

    expect(row["attributes"]).toEqual({
      "resource.iot.fleet.name": "field-sensors-us-east",
      "device.id": "sensor-7",
      "iot.device.kind": "Sensor",
      "iot.scope": "device",
      "oneuptime.synthetic": "offline-detection",
      "iot.device.type": "temp-sensor",
      "iot.device.firmware": "2.0.1",
    });
  });

  test("synthetic marker constants match the attribute stamped on the row", () => {
    const row: JSONObject = buildRow();
    const attributes: Record<string, string> = row["attributes"] as Record<
      string,
      string
    >;

    expect(IOT_SYNTHETIC_ATTRIBUTE_KEY).toBe("oneuptime.synthetic");
    expect(IOT_SYNTHETIC_OFFLINE_DETECTION).toBe("offline-detection");
    expect(attributes[IOT_SYNTHETIC_ATTRIBUTE_KEY]).toBe(
      IOT_SYNTHETIC_OFFLINE_DETECTION,
    );
  });

  test("omits iot.device.type and iot.device.firmware when unknown", () => {
    const row: JSONObject = buildRow({
      deviceType: null,
      firmwareVersion: null,
    });

    expect(row["attributes"]).toEqual({
      "resource.iot.fleet.name": "field-sensors-us-east",
      "device.id": "sensor-7",
      "iot.device.kind": "Sensor",
      "iot.scope": "device",
      "oneuptime.synthetic": "offline-detection",
    });
    expect(row["attributeKeys"]).toEqual([
      "device.id",
      "iot.device.kind",
      "iot.scope",
      "oneuptime.synthetic",
      "resource.iot.fleet.name",
    ]);
  });

  test("attributeKeys lists every attribute key, sorted", () => {
    const row: JSONObject = buildRow();
    const attributes: Record<string, string> = row["attributes"] as Record<
      string,
      string
    >;
    const keys: Array<string> = row["attributeKeys"] as Array<string>;

    expect(keys).toEqual([...Object.keys(attributes)].sort());
    expect(keys).toEqual([
      "device.id",
      "iot.device.firmware",
      "iot.device.kind",
      "iot.device.type",
      "iot.scope",
      "oneuptime.synthetic",
      "resource.iot.fleet.name",
    ]);
  });
});

describe("buildSyntheticDeviceDownMetricRow — metric identity and value", () => {
  test("is an iot_device_up gauge with value 0 under the OpenTelemetry entity type", () => {
    const row: JSONObject = buildRow();

    expect(row["name"]).toBe("iot_device_up");
    expect(row["value"]).toBe(0);
    expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
  });

  test("carries the lean insertJsonRows column set with no primaryEntityId", () => {
    const row: JSONObject = buildRow();

    expect(Object.keys(row).sort()).toEqual([
      "_id",
      "attributeKeys",
      "attributes",
      "createdAt",
      "metricPointType",
      "name",
      "primaryEntityType",
      "projectId",
      "retentionDate",
      "time",
      "timeUnixNano",
      "value",
    ]);
    expect(row).not.toHaveProperty("primaryEntityId");
  });

  test("generates a fresh time-ordered _id per row", () => {
    const first: JSONObject = buildRow();
    const second: JSONObject = buildRow();

    expect(typeof first["_id"]).toBe("string");
    expect((first["_id"] as string).length).toBeGreaterThan(0);
    expect(first["_id"]).not.toBe(second["_id"]);
  });
});

describe("buildSyntheticDeviceDownMetricRow — timestamps and retention", () => {
  test("timeUnixNano is the sweep time in ms x 1e6, serialized as a string", () => {
    const row: JSONObject = buildRow();

    expect(row["timeUnixNano"]).toBe((AT.getTime() * 1_000_000).toString());
    // 2026-06-13T12:00:00Z in nanoseconds.
    expect(row["timeUnixNano"]).toBe("1781352000000000000");
  });

  test("time and createdAt are the ClickHouse rendering of the sweep time", () => {
    const row: JSONObject = buildRow();
    const expected: string = OneUptimeDate.toClickhouseDateTime(AT);

    expect(row["time"]).toBe(expected);
    expect(row["createdAt"]).toBe(expected);
  });

  test("retentionDate is the sweep time plus retentionDays", () => {
    const row: JSONObject = buildRow({ retentionDays: 15 });

    expect(row["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(OneUptimeDate.addRemoveDays(AT, 15)),
    );
  });

  test("retentionDays drives the retention window", () => {
    const shortRow: JSONObject = buildRow({ retentionDays: 1 });
    const longRow: JSONObject = buildRow({ retentionDays: 30 });

    expect(shortRow["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(OneUptimeDate.addRemoveDays(AT, 1)),
    );
    expect(longRow["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(OneUptimeDate.addRemoveDays(AT, 30)),
    );
    expect(shortRow["retentionDate"]).not.toBe(longRow["retentionDate"]);
  });
});
