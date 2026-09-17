import {
  IoTDeviceBufferEntry,
  IoTFleetSnapshotBufferEntry,
  IOT_MAX_FUTURE_CLOCK_SKEW_MINUTES,
  bufferIoTSnapshotMetric,
  clampIoTTimestamp,
} from "../../../../Server/Utils/Telemetry/IoTSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Malformed-device hardening for the IoT snapshot scan:
 *
 *   - a `device.id` longer than the ShortText column limit (100) is
 *     truncated at ingest, so one bad device can never fail the
 *     500-row inventory INSERT chunk downstream — and two ids sharing
 *     the truncated prefix fold into ONE entry (a duplicate conflict
 *     target inside a single INSERT would abort the statement),
 *   - a future-skewed device clock is clamped to ingest time, so the
 *     `>=` lastSeenAt dominance guard can't get wedged by one bogus
 *     future timestamp and then reject every legitimate update.
 */

const FLEET: string = "0a1b2c3d-0000-0000-0000-000000000001";
const SHORT_TEXT_LIMIT: number = 100;

type LabelMap = Record<string, string>;

function toNano(ms: number): string {
  return `${ms}000000`;
}

function datapoint(data: {
  value: number;
  atMs?: number;
  labels?: LabelMap;
  asDouble?: boolean;
}): JSONObject {
  const attributes: Array<JSONObject> = Object.entries(data.labels || {}).map(
    ([key, value]: [string, string]) => {
      return { key, value: { stringValue: value } };
    },
  );
  return {
    ...(data.asDouble ? { asDouble: data.value } : { asInt: data.value }),
    timeUnixNano: toNano(data.atMs ?? Date.now()),
    attributes,
  };
}

interface IoTBuffers {
  resourceBuffer: Map<string, Map<string, IoTDeviceBufferEntry>>;
  fleetBuffer: Map<string, IoTFleetSnapshotBufferEntry>;
}

function iotBuffers(): IoTBuffers {
  return { resourceBuffer: new Map(), fleetBuffer: new Map() };
}

function feed(buffers: IoTBuffers, metricName: string, dp: JSONObject): void {
  bufferIoTSnapshotMetric({
    fleetIdStr: FLEET,
    metricName,
    datapoint: dp,
    resourceBuffer: buffers.resourceBuffer,
    fleetBuffer: buffers.fleetBuffer,
  });
}

function entries(buffers: IoTBuffers): Array<IoTDeviceBufferEntry> {
  return Array.from(buffers.resourceBuffer.get(FLEET)?.values() || []);
}

describe("clampIoTTimestamp", () => {
  const now: Date = new Date("2026-07-02T12:00:00.000Z");

  test("keeps a past timestamp untouched", () => {
    const past: Date = new Date("2026-07-02T11:00:00.000Z");
    expect(clampIoTTimestamp(past, now)).toEqual(past);
  });

  test("keeps a future timestamp within the skew tolerance", () => {
    const slightlyAhead: Date = new Date(
      now.getTime() + (IOT_MAX_FUTURE_CLOCK_SKEW_MINUTES - 1) * 60 * 1000,
    );
    expect(clampIoTTimestamp(slightlyAhead, now)).toEqual(slightlyAhead);
  });

  test("clamps a timestamp beyond the skew tolerance back to now", () => {
    const farAhead: Date = new Date(now.getTime() + 60 * 60 * 1000);
    expect(clampIoTTimestamp(farAhead, now)).toEqual(now);
  });
});

describe("bufferIoTSnapshotMetric — device.id length hardening", () => {
  test("truncates a device.id longer than the 100-char column limit", () => {
    const longId: string = "x".repeat(150);
    const buffers: IoTBuffers = iotBuffers();

    feed(buffers, "iot_device_up", {
      ...datapoint({ value: 1, labels: { "device.id": longId } }),
    });

    const buffered: Array<IoTDeviceBufferEntry> = entries(buffers);
    expect(buffered).toHaveLength(1);
    expect(buffered[0]!.externalId).toBe("x".repeat(SHORT_TEXT_LIMIT));
    expect(buffered[0]!.externalId.length).toBe(SHORT_TEXT_LIMIT);
  });

  test("keeps a device.id exactly at the column limit untouched", () => {
    const exactId: string = "y".repeat(SHORT_TEXT_LIMIT);
    const buffers: IoTBuffers = iotBuffers();

    feed(buffers, "iot_device_up", {
      ...datapoint({ value: 1, labels: { "device.id": exactId } }),
    });

    expect(entries(buffers)[0]!.externalId).toBe(exactId);
  });

  test("two over-long ids sharing the truncated prefix fold into one entry", () => {
    const shared: string = "z".repeat(SHORT_TEXT_LIMIT);
    const buffers: IoTBuffers = iotBuffers();

    feed(buffers, "iot_device_up", {
      ...datapoint({ value: 1, labels: { "device.id": `${shared}-alpha` } }),
    });
    feed(buffers, "iot_device_up", {
      ...datapoint({ value: 0, labels: { "device.id": `${shared}-bravo` } }),
    });

    // One folded identity — never two rows hitting one conflict target.
    const buffered: Array<IoTDeviceBufferEntry> = entries(buffers);
    expect(buffered).toHaveLength(1);
    expect(buffered[0]!.externalId).toBe(shared);
  });
});

describe("bufferIoTSnapshotMetric — future clock-skew hardening", () => {
  test("clamps an observedAt beyond the skew tolerance to ingest time", () => {
    const buffers: IoTBuffers = iotBuffers();
    const before: number = Date.now();

    feed(buffers, "iot_battery_percent", {
      ...datapoint({
        value: 55,
        asDouble: true,
        atMs: Date.now() + 60 * 60 * 1000, // device clock 1h ahead
        labels: { "device.id": "sensor-1" },
      }),
    });

    const after: number = Date.now();
    const observedAt: Date = entries(buffers)[0]!.observedAt;
    expect(observedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(observedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("keeps an observedAt within the skew tolerance untouched", () => {
    const buffers: IoTBuffers = iotBuffers();
    const slightlyAheadMs: number =
      Date.now() + (IOT_MAX_FUTURE_CLOCK_SKEW_MINUTES - 1) * 60 * 1000;

    feed(buffers, "iot_battery_percent", {
      ...datapoint({
        value: 55,
        asDouble: true,
        atMs: slightlyAheadMs,
        labels: { "device.id": "sensor-1" },
      }),
    });

    expect(entries(buffers)[0]!.observedAt.getTime()).toBe(
      Math.trunc(slightlyAheadMs),
    );
  });

  test("a clamped future point no longer wedges newest-wins folding", () => {
    const buffers: IoTBuffers = iotBuffers();

    // Skewed device stamps 1h ahead — clamped to ~now at ingest.
    feed(buffers, "iot_battery_percent", {
      ...datapoint({
        value: 50,
        asDouble: true,
        atMs: Date.now() + 60 * 60 * 1000,
        labels: { "device.id": "sensor-1" },
      }),
    });

    // A legitimate later reading must still win the fold.
    feed(buffers, "iot_battery_percent", {
      ...datapoint({
        value: 80,
        asDouble: true,
        atMs: Date.now() + 1000,
        labels: { "device.id": "sensor-1" },
      }),
    });

    expect(entries(buffers)[0]!.latestBatteryPercent).toBe(80);
  });
});
