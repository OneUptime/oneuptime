import {
  IOT_DEVICE_ID_ATTRIBUTE_KEY,
  buildAbsentIoTDeviceSeries,
  getIoTDeviceAbsenceGroupByKey,
} from "../../../../Server/Utils/Monitor/IoTDeviceAbsenceSeries";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test } from "@jest/globals";

/*
 * The absence-series helpers are what turn a silent registered device
 * into a per-device offline incident — pin down the gating and the
 * synthetic-series shape (which must match what the device's real
 * series would carry so incidents dedupe and auto-resolve).
 */

function presentSeries(deviceIds: Array<string>): Array<MetricSeriesResult> {
  return deviceIds.map((id: string) => {
    return {
      fingerprint: MetricSeriesFingerprint.computeFingerprint({
        [IOT_DEVICE_ID_ATTRIBUTE_KEY]: id,
      }),
      labels: { [IOT_DEVICE_ID_ATTRIBUTE_KEY]: id },
      // present series carry samples; the builder only reads labels.
      aggregatedResults: [],
    };
  });
}

describe("getIoTDeviceAbsenceGroupByKey", () => {
  test("returns the key only for a pure device.id group-by", () => {
    expect(getIoTDeviceAbsenceGroupByKey(["device.id"])).toBe("device.id");
  });

  test.each([
    [[]],
    [["iot.device.type"]],
    [["device.id", "iot.device.type"]],
    [["resource.iot.fleet.name"]],
  ])("returns null for %j", (keys: Array<string>) => {
    expect(getIoTDeviceAbsenceGroupByKey(keys)).toBeNull();
  });
});

describe("buildAbsentIoTDeviceSeries", () => {
  test("emits one empty series per registered-but-absent device", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentIoTDeviceSeries({
      presentSeries: presentSeries(["sensor-1"]),
      expectedDeviceExternalIds: ["sensor-1", "sensor-2", "sensor-3"],
      deviceKey: IOT_DEVICE_ID_ATTRIBUTE_KEY,
      slotCount: 2,
    });

    expect(absent).toHaveLength(2);
    const ids: Array<string> = absent.map((s: MetricSeriesResult) => {
      return String(s.labels["device.id"]);
    });
    expect(ids.sort()).toEqual(["sensor-2", "sensor-3"]);

    for (const series of absent) {
      // One empty slot per query+formula so criteria alias resolution lines up.
      expect(series.aggregatedResults).toHaveLength(2);
      for (const slot of series.aggregatedResults) {
        expect(slot.data).toEqual([]);
      }
      // Fingerprint must match what the device's REAL series would carry.
      expect(series.fingerprint).toBe(
        MetricSeriesFingerprint.computeFingerprint(series.labels),
      );
    }
  });

  test("device ids are compared byte-exact — no canonicalization", () => {
    /*
     * device.id labels are stored verbatim (unlike host.name). A
     * registered id differing only in case is a DIFFERENT device and
     * must be treated as absent; lowercasing would fork the
     * fingerprint from the real series and break dedupe.
     */
    const absent: Array<MetricSeriesResult> = buildAbsentIoTDeviceSeries({
      presentSeries: presentSeries(["Sensor-A"]),
      expectedDeviceExternalIds: ["Sensor-A", "sensor-a"],
      deviceKey: IOT_DEVICE_ID_ATTRIBUTE_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(1);
    expect(absent[0]?.labels["device.id"]).toBe("sensor-a");
  });

  test("dedupes duplicate registered ids and skips empties", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentIoTDeviceSeries({
      presentSeries: [],
      expectedDeviceExternalIds: ["sensor-1", "sensor-1", ""],
      deviceKey: IOT_DEVICE_ID_ATTRIBUTE_KEY,
      slotCount: 0, // clamps to 1
    });

    expect(absent).toHaveLength(1);
    expect(absent[0]?.aggregatedResults).toHaveLength(1);
  });

  test("returns nothing when every registered device is present", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentIoTDeviceSeries({
      presentSeries: presentSeries(["a", "b"]),
      expectedDeviceExternalIds: ["a", "b"],
      deviceKey: IOT_DEVICE_ID_ATTRIBUTE_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(0);
  });
});
