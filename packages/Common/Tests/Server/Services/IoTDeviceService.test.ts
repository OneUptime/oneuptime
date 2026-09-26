import IoTDevice from "../../../Models/DatabaseModels/IoTDevice";
import IoTDeviceService, {
  IoTDeviceLatestMetric,
  LATEST_METRIC_COLUMNS,
  LatestMetricColumn,
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
const UPSERT_PARAMS_PER_ROW: number = 11;

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

/*
 * GitHub #3998: the mirror UPDATE bound 10 params per row into a 9-slot
 * VALUES tuple under a 10-name AS v(...) list, so Postgres rejected every
 * call and no battery / signal / temperature / CPU / memory reading ever
 * reached the row. These hold the statement's pieces to each other and
 * to the entity; IoTDeviceLatestMetricsPostgres.test.ts executes it.
 */
describe("IoTDeviceService.bulkUpdateLatestMetrics — statement shape (#3998)", () => {
  const LATEST_METRIC_MODEL_COLUMNS: Array<string> = [
    "latestCpuPercent",
    "latestMemoryBytes",
    "maxMemoryBytes",
    "latestMemoryPercent",
    "latestBatteryPercent",
    "latestSignalStrengthDbm",
    "latestTemperatureCelsius",
  ];

  function aliasList(sql: string): Array<string> {
    const match: RegExpMatchArray | null = sql.match(/AS v\(([^)]*)\)/);
    expect(match).not.toBeNull();
    return match![1]!.split(",").map((alias: string) => {
      return alias.trim().replace(/^"|"$/g, "");
    });
  }

  function valueTuples(sql: string): Array<Array<string>> {
    const match: RegExpMatchArray | null = sql.match(
      /FROM \(VALUES ([\s\S]*?)\)\s+AS v\(/,
    );
    expect(match).not.toBeNull();
    return Array.from(`${match![1]!})`.matchAll(/\(([^()]*)\)/g)).map(
      (m: RegExpMatchArray) => {
        return m[1]!.split(",").map((slot: string) => {
          return slot.trim();
        });
      },
    );
  }

  // Each VALUES row read back as { alias: bound param }.
  function rowsByAlias(call: QueryCall): Array<Record<string, unknown>> {
    const [sql, params] = call;
    const aliases: Array<string> = aliasList(sql);
    return valueTuples(sql).map((tuple: Array<string>) => {
      expect(tuple).toHaveLength(aliases.length);
      const row: Record<string, unknown> = {};
      tuple.forEach((slot: string, i: number) => {
        const index: number = Number(slot.match(/^\$(\d+)/)![1]);
        expect(index).toBeLessThanOrEqual(params.length);
        row[aliases[i]!] = params[index - 1];
      });
      return row;
    });
  }

  test("the column table has unique aliases and mirrors every latest-metric column once", () => {
    const aliases: Array<string> = LATEST_METRIC_COLUMNS.map(
      (column: LatestMetricColumn) => {
        return column.alias;
      },
    );
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases).toEqual(
      expect.arrayContaining(["kind", "externalId", "observedAt"]),
    );

    const mirrored: Array<string> = LATEST_METRIC_COLUMNS.filter(
      (column: LatestMetricColumn) => {
        return column.mirrorColumn !== null;
      },
    ).map((column: LatestMetricColumn) => {
      return column.mirrorColumn!;
    });
    expect([...mirrored].sort()).toEqual(
      [...LATEST_METRIC_MODEL_COLUMNS].sort(),
    );
  });

  test("every mirrored column is a real IoTDevice column", () => {
    const model: IoTDevice = new IoTDevice();
    for (const column of LATEST_METRIC_COLUMNS) {
      if (column.mirrorColumn) {
        expect(
          Object.prototype.hasOwnProperty.call(model, column.mirrorColumn),
        ).toBe(true);
      }
    }
  });

  test("each VALUES tuple has one slot per alias and one bound param per slot", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({ externalId: "a" }),
        latestMetric({ externalId: "b" }),
        latestMetric({ externalId: "c" }),
      ],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    const aliases: Array<string> = aliasList(sql);
    const tuples: Array<Array<string>> = valueTuples(sql);

    expect(aliases).toHaveLength(LATEST_METRIC_COLUMNS.length);
    expect(tuples).toHaveLength(3);
    for (const tuple of tuples) {
      expect(tuple).toHaveLength(aliases.length);
    }
    expect(params).toHaveLength(2 + 3 * aliases.length);

    // $3..$N, each used exactly once, in order.
    const numbers: Array<number> = tuples.flat().map((slot: string) => {
      return Number(slot.match(/^\$(\d+)/)![1]);
    });
    expect(numbers).toEqual(
      numbers.map((_: number, i: number) => {
        return i + 3;
      }),
    );
  });

  test("every reading binds under its own alias, on its own row", async () => {
    const query: jest.Mock = mockQueryRunner();
    const first: IoTDeviceLatestMetric = latestMetric({
      externalId: "greenhouse-1",
      cpuPercent: 11,
      memoryBytes: 1111,
      maxMemoryBytes: 2222,
      memoryPercent: 50,
      batteryPercent: 87.5,
      signalStrengthDbm: -61.5,
      temperatureCelsius: 21.43,
    });
    const second: IoTDeviceLatestMetric = latestMetric({
      kind: "Gateway",
      externalId: "gw-7",
      cpuPercent: 22,
      memoryBytes: 3333,
      maxMemoryBytes: 4444,
      memoryPercent: 75,
      batteryPercent: 12,
      signalStrengthDbm: -90,
      temperatureCelsius: -4,
      observedAt: new Date("2026-06-13T00:05:00.000Z"),
    });

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [first, second],
    });

    expect(rowsByAlias(query.mock.calls[0] as QueryCall)).toEqual([
      {
        kind: "Sensor",
        externalId: "greenhouse-1",
        cpu: 11,
        mem: "1111",
        maxMem: "2222",
        memPct: 50,
        battery: 87.5,
        signal: -61.5,
        temp: 21.43,
        observedAt: first.observedAt,
      },
      {
        kind: "Gateway",
        externalId: "gw-7",
        cpu: 22,
        mem: "3333",
        maxMem: "4444",
        memPct: 75,
        battery: 12,
        signal: -90,
        temp: -4,
        observedAt: second.observedAt,
      },
    ]);
  });

  test("the SET clause writes each column from its own alias, exactly once", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [latestMetric()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    const expected: Record<string, string> = {
      latestCpuPercent: "cpu",
      latestMemoryBytes: "mem",
      maxMemoryBytes: "maxMem",
      latestMemoryPercent: "memPct",
      latestBatteryPercent: "battery",
      latestSignalStrengthDbm: "signal",
      latestTemperatureCelsius: "temp",
    };
    for (const [column, alias] of Object.entries(expected)) {
      const assignment: string = `"${column}" = COALESCE(v."${alias}", p."${column}")`;
      expect(sql.split(assignment)).toHaveLength(2);
    }
    expect(sql).toContain('"metricsUpdatedAt" = v."observedAt"');
    expect(sql).toContain(
      '(p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")',
    );
  });

  test("slots carry the casts the column types need", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [latestMetric()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    const aliases: Array<string> = aliasList(sql);
    const tuple: Array<string> = valueTuples(sql)[0]!;
    const castOf: Record<string, string> = {};
    aliases.forEach((alias: string, i: number) => {
      castOf[alias] = tuple[i]!.split("::")[1] ?? "";
    });

    expect(castOf).toEqual({
      kind: "",
      externalId: "",
      cpu: "numeric",
      mem: "bigint",
      maxMem: "bigint",
      memPct: "numeric",
      battery: "numeric",
      signal: "numeric",
      temp: "numeric",
      observedAt: "timestamptz",
    });
  });

  test("a missing series binds NULL (COALESCE keeps the last reading), never 0", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({
          cpuPercent: null,
          memoryBytes: null,
          maxMemoryBytes: null,
          memoryPercent: null,
          batteryPercent: null,
          signalStrengthDbm: null,
          temperatureCelsius: null,
        }),
      ],
    });

    const [row] = rowsByAlias(query.mock.calls[0] as QueryCall);
    for (const alias of [
      "cpu",
      "mem",
      "maxMem",
      "memPct",
      "battery",
      "signal",
      "temp",
    ]) {
      expect(row![alias]).toBeNull();
    }
  });

  test("zero readings are kept as 0, not mistaken for missing", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({
          cpuPercent: 0,
          memoryBytes: 0,
          batteryPercent: 0,
          signalStrengthDbm: 0,
          temperatureCelsius: 0,
        }),
      ],
    });

    const [row] = rowsByAlias(query.mock.calls[0] as QueryCall);
    expect(row).toMatchObject({
      cpu: 0,
      mem: "0",
      battery: 0,
      signal: 0,
      temp: 0,
    });
  });

  test("byte counts bind as whole-number strings, past 2^32 too", async () => {
    const query: jest.Mock = mockQueryRunner();
    const eightGiB: number = 8 * 1024 * 1024 * 1024;

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({
          memoryBytes: eightGiB + 0.75,
          maxMemoryBytes: 2 * eightGiB,
        }),
      ],
    });

    const [row] = rowsByAlias(query.mock.calls[0] as QueryCall);
    expect(row!["mem"]).toBe(String(eightGiB));
    expect(row!["maxMem"]).toBe(String(2 * eightGiB));
  });

  test("a flush over 500 devices splits into chunks that are each well-formed", async () => {
    const query: jest.Mock = mockQueryRunner();
    const metrics: Array<IoTDeviceLatestMetric> = Array.from(
      { length: 501 },
      (_: unknown, i: number) => {
        return latestMetric({ externalId: `bulk-${i}`, batteryPercent: i });
      },
    );

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const firstRows: Array<Record<string, unknown>> = rowsByAlias(
      query.mock.calls[0] as QueryCall,
    );
    const secondRows: Array<Record<string, unknown>> = rowsByAlias(
      query.mock.calls[1] as QueryCall,
    );
    expect(firstRows).toHaveLength(500);
    expect(secondRows).toHaveLength(1);

    // The second chunk numbers its params from $3 again, after its own $1/$2.
    const [secondSql, secondParams] = query.mock.calls[1] as QueryCall;
    expect(secondParams).toHaveLength(2 + LATEST_METRIC_COLUMNS.length);
    expect(valueTuples(secondSql)[0]![0]).toBe("$3");
    expect(secondRows[0]).toMatchObject({
      externalId: "bulk-500",
      battery: 500,
    });
    expect(firstRows[499]).toMatchObject({
      externalId: "bulk-499",
      battery: 499,
    });
  });

  test("an empty batch sends no statement", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [],
    });

    expect(query).not.toHaveBeenCalled();
  });
});

describe("IoTDeviceService.deleteStaleForFleet — registered devices survive", () => {
  const CUTOFF: Date = new Date("2026-06-13T00:00:00.000Z");

  test("marks registered devices offline and deletes only unregistered ones", async () => {
    const query: jest.Mock = mockQueryRunner();
    query
      .mockResolvedValueOnce([[], 2]) // UPDATE (registered -> isUp=false)
      .mockResolvedValueOnce([[], 5]); // DELETE (unregistered)

    const result: { deleted: number; markedOffline: number } =
      await IoTDeviceService.deleteStaleForFleet({
        iotFleetId: FLEET_ID,
        olderThan: CUTOFF,
      });

    expect(query).toHaveBeenCalledTimes(2);

    const [updateSql, updateParams] = query.mock.calls[0] as QueryCall;
    expect(updateSql).toContain('UPDATE "IoTDevice" SET "isUp" = false');
    // Registered = credential on the same project + fleet + externalId.
    expect(updateSql).toContain('EXISTS (SELECT 1 FROM "IoTDeviceCredential"');
    expect(updateSql).toContain('c."externalId" = "IoTDevice"."externalId"');
    expect(updateSql).toContain('c."projectId" = "IoTDevice"."projectId"');
    // The credential correlation itself is kind-agnostic.
    expect(updateSql).not.toContain('c."kind"');
    // Reconnect recovery depends on lastSeenAt staying untouched.
    expect(updateSql).not.toContain('"lastSeenAt" =');
    // Idempotent across cron ticks: already-down rows are not rewritten.
    expect(updateSql).toContain('"isUp" IS DISTINCT FROM false');
    // Stale duplicate-kind rows self-heal instead of being pinned offline.
    expect(updateSql).toContain("NOT EXISTS");
    expect(updateParams).toEqual([FLEET_ID.toString(), CUTOFF]);

    const [deleteSql, deleteParams] = query.mock.calls[1] as QueryCall;
    expect(deleteSql).toContain('DELETE FROM "IoTDevice"');
    expect(deleteSql).toContain("NOT EXISTS");
    expect(deleteParams).toEqual([FLEET_ID.toString(), CUTOFF]);

    expect(result).toEqual({ deleted: 5, markedOffline: 2 });
  });

  test("normalizes a driver result without an affected count to zero", async () => {
    mockQueryRunner([]);

    const result: { deleted: number; markedOffline: number } =
      await IoTDeviceService.deleteStaleForFleet({
        iotFleetId: FLEET_ID,
        olderThan: CUTOFF,
      });

    expect(result).toEqual({ deleted: 0, markedOffline: 0 });
  });
});
