import IoTDeviceService, {
  IoTDeviceLatestMetric,
  ParsedIoTDevice,
} from "../../../Server/Services/IoTDeviceService";
import { IOT_MAX_FUTURE_CLOCK_SKEW_MINUTES } from "../../../Server/Utils/Telemetry/IoTSnapshotScan";
import ObjectID from "../../../Types/ObjectID";

/*
 * Malformed-device hardening for the IoTDevice inventory write path.
 * The service builds raw parameterized SQL against the TypeORM manager
 * — these tests mock the query runner (no Postgres) and lock in:
 *
 *   - ShortText values (externalId and friends) truncate to the
 *     100-char column limit BEFORE the chunk is built, so one bad
 *     device can never fail the whole 500-row INSERT and drop the
 *     other 499 with it,
 *   - identities that collide after truncation dedupe to the newest
 *     row (two VALUES rows on one conflict target abort the statement),
 *   - a future-skewed lastSeenAt / observedAt clamps to ingest time so
 *     the `>=` dominance guards can't get wedged by one bogus device
 *     clock,
 *   - the latest-metric mirror truncates identity the SAME way the
 *     upsert does, so the UPDATE still finds the row the upsert wrote.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET_ID: ObjectID = ObjectID.generate();
const SHORT_TEXT_LIMIT: number = 100;
/*
 * One param per UPSERT_COLUMNS entry: projectId, iotFleetId, kind,
 * externalId, name, deviceType, firmwareVersion, isUp, uptimeSeconds,
 * lastSeenAt, state, stateChangedAt, version. (Was 11 before the
 * lifecycle columns state/stateChangedAt joined the tuple.)
 */
const UPSERT_PARAMS_PER_ROW: number = 13;

type QueryCall = [string, Array<unknown>];

function mockQueryRunner(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);
  jest
    .spyOn(IoTDeviceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

function parsedDevice(
  overrides: Partial<ParsedIoTDevice> = {},
): ParsedIoTDevice {
  return {
    kind: "Sensor",
    externalId: "sensor-1",
    name: "greenhouse-sensor",
    deviceType: "temperature",
    firmwareVersion: "1.2.3",
    isUp: true,
    uptimeSeconds: 3600,
    lastSeenAt: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

function latestMetric(
  overrides: Partial<IoTDeviceLatestMetric> = {},
): IoTDeviceLatestMetric {
  return {
    kind: "Sensor",
    externalId: "sensor-1",
    cpuPercent: 12.5,
    memoryBytes: 1024,
    maxMemoryBytes: 4096,
    memoryPercent: 25,
    batteryPercent: 88,
    signalStrengthDbm: -61,
    temperatureCelsius: 21.4,
    observedAt: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IoTDeviceService.bulkUpsert — ShortText sanitation", () => {
  test("truncates an over-long externalId instead of failing the chunk", async () => {
    const query: jest.Mock = mockQueryRunner();
    const longId: string = "x".repeat(150);

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [
        parsedDevice({ externalId: longId }),
        parsedDevice({ externalId: "sensor-good" }),
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0] as QueryCall;

    // Both rows made it into the one chunk — the bad id dropped nobody.
    expect(params).toHaveLength(2 * UPSERT_PARAMS_PER_ROW);
    expect(params).toContain("x".repeat(SHORT_TEXT_LIMIT));
    expect(params).toContain("sensor-good");
    expect(params).not.toContain(longId);
  });

  test("truncates over-long kind/name/deviceType/firmwareVersion values", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [
        parsedDevice({
          kind: "k".repeat(140),
          name: "n".repeat(140),
          deviceType: "t".repeat(140),
          firmwareVersion: "f".repeat(140),
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params).toContain("k".repeat(SHORT_TEXT_LIMIT));
    expect(params).toContain("n".repeat(SHORT_TEXT_LIMIT));
    expect(params).toContain("t".repeat(SHORT_TEXT_LIMIT));
    expect(params).toContain("f".repeat(SHORT_TEXT_LIMIT));
  });

  test("identities colliding after truncation dedupe to the newest row", async () => {
    const query: jest.Mock = mockQueryRunner();
    const shared: string = "z".repeat(SHORT_TEXT_LIMIT);
    const older: Date = new Date("2026-06-13T00:00:00.000Z");
    const newer: Date = new Date("2026-06-13T00:05:00.000Z");

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [
        parsedDevice({
          externalId: `${shared}-alpha`,
          name: "older-device",
          lastSeenAt: older,
        }),
        parsedDevice({
          externalId: `${shared}-bravo`,
          name: "newer-device",
          lastSeenAt: newer,
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;

    // One conflict target → exactly one VALUES row, the newest one.
    expect(params).toHaveLength(UPSERT_PARAMS_PER_ROW);
    expect(params).toContain(shared);
    expect(params).toContain("newer-device");
    expect(params).not.toContain("older-device");
  });

  test("skips rows whose externalId is empty", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice({ externalId: "" })],
    });

    expect(query).not.toHaveBeenCalled();
  });
});

describe("IoTDeviceService.bulkUpsert — future clock-skew clamping", () => {
  test("clamps a lastSeenAt beyond the skew tolerance to ingest time", async () => {
    const query: jest.Mock = mockQueryRunner();
    const before: number = Date.now();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [
        parsedDevice({
          lastSeenAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
      ],
    });

    const after: number = Date.now();
    const [, params] = query.mock.calls[0] as QueryCall;
    const lastSeenAt: Date = params[9] as Date;

    expect(lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastSeenAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("keeps a lastSeenAt within the skew tolerance untouched", async () => {
    const query: jest.Mock = mockQueryRunner();
    const slightlyAhead: Date = new Date(
      Date.now() + (IOT_MAX_FUTURE_CLOCK_SKEW_MINUTES - 1) * 60 * 1000,
    );

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice({ lastSeenAt: slightlyAhead })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params[9]).toEqual(slightlyAhead);
  });
});

describe("IoTDeviceService.bulkUpdateLatestMetrics — sanitation matches the upsert", () => {
  test("truncates an over-long externalId to the same identity the upsert wrote", async () => {
    const query: jest.Mock = mockQueryRunner();
    const longId: string = "x".repeat(150);

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [latestMetric({ externalId: longId })],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0] as QueryCall;

    // Params: projectId, fleetId, then kind, externalId, ... per row.
    expect(params[3]).toBe("x".repeat(SHORT_TEXT_LIMIT));
  });

  test("clamps a future observedAt beyond the skew tolerance", async () => {
    const query: jest.Mock = mockQueryRunner();
    const before: number = Date.now();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({
          observedAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
      ],
    });

    const after: number = Date.now();
    const [, params] = query.mock.calls[0] as QueryCall;
    const observedAt: Date = params[11] as Date;

    expect(observedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(observedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("identities colliding after truncation dedupe to the newest observation", async () => {
    const query: jest.Mock = mockQueryRunner();
    const shared: string = "z".repeat(SHORT_TEXT_LIMIT);

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({
          externalId: `${shared}-alpha`,
          batteryPercent: 10,
          observedAt: new Date("2026-06-13T00:00:00.000Z"),
        }),
        latestMetric({
          externalId: `${shared}-bravo`,
          batteryPercent: 90,
          observedAt: new Date("2026-06-13T00:05:00.000Z"),
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;

    // 2 shared params + one 9-param row (kind..temp) + observedAt.
    expect(params).toHaveLength(2 + 10);
    expect(params[3]).toBe(shared);
    expect(params).toContain(90);
    expect(params).not.toContain(10);
  });
});
