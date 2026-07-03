import IoTDeviceService, {
  IoTDeviceLatestMetric,
  ParsedIoTDevice,
  SilentIoTDevice,
} from "../../../Server/Services/IoTDeviceService";
import IoTDeviceState from "../../../Types/IoT/IoTDeviceState";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";

/*
 * Lifecycle + statement-shape coverage for the IoTDevice inventory
 * service. The service builds raw parameterized SQL against the
 * TypeORM manager — these tests mock the query runner (no Postgres,
 * captured-query pattern shared with ProxmoxResourceService.test.ts)
 * and lock in:
 *
 *   - bulkUpsert: the 13-value parameter tuple in exact UPSERT_COLUMNS
 *     order, the Online/Offline state derivation from isUp, the state
 *     CASE + stateChangedAt CASE inside ON CONFLICT, the lastSeenAt
 *     dominance guard, and 500-row chunking,
 *   - markStaleForFleet: the per-device GREATEST(grace x interval,
 *     stale threshold) cutoff, the Online/Offline-only state match,
 *     and the exact parameter order,
 *   - retireStaleDevices: table-wide (no fleet filter) with the
 *     state != Retired predicate,
 *   - querySilentDevices (via findDevicesGoneSilent /
 *     findSilentDownDevices): placeholder numbering with 1 vs 2 state
 *     params, the isArchived exclusion, and the COALESCE-interval
 *     NULL semantics (fleet default null + device interval null means
 *     the row can never match),
 *   - getInventorySummary: Retired/archived exclusion and the
 *     state-based upCount with the legacy isUp fallback,
 *   - the stale/retire threshold env parsing bounds.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET_ID: ObjectID = ObjectID.generate();

// One param per UPSERT_COLUMNS entry (13 since the lifecycle columns).
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IoTDeviceService.bulkUpsert — parameter tuple and state derivation", () => {
  test("one row carries exactly one param per UPSERT column, in column order", async () => {
    const query: jest.Mock = mockQueryRunner();
    const lastSeenAt: Date = new Date("2026-06-13T00:00:00.000Z");

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice({ uptimeSeconds: 3600.9, lastSeenAt })],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    // Placeholder tuple matches the 13-column INSERT list exactly.
    expect(params).toHaveLength(UPSERT_PARAMS_PER_ROW);
    expect(sql).toContain(
      "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    );
    // INSERT column list, in tuple order (whitespace-insensitive).
    expect(sql.replace(/\s+/g, " ")).toContain(
      '"projectId", "iotFleetId", "kind", "externalId", "name", "deviceType", "firmwareVersion", "isUp", "uptimeSeconds", "lastSeenAt", "state", "stateChangedAt", "version"',
    );

    expect(params).toEqual([
      PROJECT_ID.toString(),
      FLEET_ID.toString(),
      "Sensor",
      "sensor-1",
      "greenhouse-sensor",
      "temperature",
      "1.2.3",
      true,
      3600, // uptimeSeconds truncated
      lastSeenAt,
      IoTDeviceState.Online, // state derives from isUp
      lastSeenAt, // stateChangedAt = first observation
      0, // version (BaseModel @VersionColumn)
    ]);
  });

  test("isUp false derives an Offline insert state", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice({ isUp: false })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params[7]).toBe(false); // isUp
    expect(params[10]).toBe(IoTDeviceState.Offline); // state
  });

  test("isUp true and isUp null both derive an Online insert state", async () => {
    for (const isUp of [true, null]) {
      const query: jest.Mock = mockQueryRunner();

      await IoTDeviceService.bulkUpsert({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
        devices: [parsedDevice({ isUp })],
      });

      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params[7]).toBe(isUp);
      expect(params[10]).toBe(IoTDeviceState.Online);
      jest.restoreAllMocks();
    }
  });

  test("null uptimeSeconds rides through as NULL (COALESCE keeps last-known)", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [
        parsedDevice({
          name: null,
          deviceType: null,
          firmwareVersion: null,
          uptimeSeconds: null,
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params[4]).toBeNull(); // name
    expect(params[5]).toBeNull(); // deviceType
    expect(params[6]).toBeNull(); // firmwareVersion
    expect(params[8]).toBeNull(); // uptimeSeconds
  });

  test("chunks batches of more than 500 devices into multiple statements", async () => {
    const query: jest.Mock = mockQueryRunner();
    const devices: Array<ParsedIoTDevice> = [];
    for (let i: number = 0; i < 501; i++) {
      devices.push(parsedDevice({ externalId: `sensor-${i}` }));
    }

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [, firstParams] = query.mock.calls[0] as QueryCall;
    const [, secondParams] = query.mock.calls[1] as QueryCall;
    expect(firstParams).toHaveLength(500 * UPSERT_PARAMS_PER_ROW);
    expect(secondParams).toHaveLength(UPSERT_PARAMS_PER_ROW);
  });
});

describe("IoTDeviceService.bulkUpsert — ON CONFLICT statement shape", () => {
  test("upserts on the fleet identity with COALESCE per identity/status column", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('INSERT INTO "IoTDevice"');
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "iotFleetId", "kind", "externalId")',
    );

    /*
     * Identity/status columns COALESCE against the existing row — a
     * batch that lacks an info series must not blank a previously
     * learned name/deviceType/firmwareVersion.
     */
    for (const column of [
      "name",
      "deviceType",
      "firmwareVersion",
      "isUp",
      "uptimeSeconds",
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(EXCLUDED."${column}", "IoTDevice"."${column}")`,
      );
    }

    // lastSeenAt is overwritten (not COALESCEd) under the dominance guard.
    expect(sql).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
  });

  test("state CASE snaps the row back to Online/Offline from the post-merge isUp", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;

    /*
     * The CASE reads the POST-MERGE isUp (EXCLUDED coalesced against
     * the existing row) so a batch without an up series keeps the
     * last-known Online/Offline half instead of defaulting.
     */
    expect(sql).toContain(
      `WHEN COALESCE(EXCLUDED."isUp", "IoTDevice"."isUp") IS FALSE THEN '${IoTDeviceState.Offline}'`,
    );
    expect(sql).toContain(`ELSE '${IoTDeviceState.Online}'`);
    expect(sql).toContain('"state" = CASE');
  });

  test("stateChangedAt CASE only advances when the state actually flips", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('"stateChangedAt" = CASE');
    expect(sql).toContain('IS DISTINCT FROM "IoTDevice"."state"');
    expect(sql).toContain('THEN EXCLUDED."lastSeenAt"');
    expect(sql).toContain('ELSE "IoTDevice"."stateChangedAt"');

    /*
     * The same state CASE fragment must appear twice: once in the SET
     * list and once inside the stateChangedAt comparison — they are
     * built from one shared fragment so they can never drift.
     */
    const stateCaseOccurrences: number = sql.split(
      `WHEN COALESCE(EXCLUDED."isUp", "IoTDevice"."isUp") IS FALSE`,
    ).length;
    expect(stateCaseOccurrences - 1).toBe(2);
  });

  test("dominance guard rejects out-of-order snapshots", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpsert({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      devices: [parsedDevice()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "IoTDevice"."lastSeenAt"',
    );
  });
});

describe("IoTDeviceService.bulkUpdateLatestMetrics — VALUES tuple shape", () => {
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

  /*
   * Regression guard: the VALUES tuple must render exactly one slot
   * per aliased column. The temperature `::numeric` slot was once
   * missing (9 slots vs 10 params vs 10 alias columns), which made
   * every live UPDATE fail with a bind-count mismatch — the mirror
   * silently never updated. Asserting the full fragment string keeps
   * slot count, order and casts pinned.
   */
  test("renders 10 placeholders per row matching 10 pushed params and 10 alias columns", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [latestMetric()],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    // 2 shared params + 10 per row are pushed...
    expect(params).toHaveLength(2 + 10);

    // ...and the VALUES tuple numbers all 10 slots, temp included.
    expect(sql).toContain(
      "($3, $4, $5::numeric, $6::bigint, $7::bigint, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::timestamptz)",
    );

    // The alias declares all 10 columns.
    expect(sql).toContain(
      'AS v("kind", "externalId", "cpu", "mem", "maxMem", "memPct", "battery", "signal", "temp", "observedAt")',
    );
  });

  test("COALESCEs every mirror column and guards on metricsUpdatedAt", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [latestMetric()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('UPDATE "IoTDevice" AS p');
    for (const [column, alias] of [
      ["latestCpuPercent", "cpu"],
      ["latestMemoryBytes", "mem"],
      ["maxMemoryBytes", "maxMem"],
      ["latestMemoryPercent", "memPct"],
      ["latestBatteryPercent", "battery"],
      ["latestSignalStrengthDbm", "signal"],
      ["latestTemperatureCelsius", "temp"],
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(v."${alias}", p."${column}")`,
      );
    }
    expect(sql).toContain(
      '(p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")',
    );
  });

  test("missing series stay NULL and bigints are sent as strings", async () => {
    const query: jest.Mock = mockQueryRunner();

    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      metrics: [
        latestMetric({
          batteryPercent: null,
          signalStrengthDbm: null,
          temperatureCelsius: null,
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    /*
     * Params: projectId, fleetId, then per row (kind, externalId, cpu,
     * mem, maxMem, memPct, battery, signal, temp, observedAt).
     */
    expect(params[2]).toBe("Sensor");
    expect(params[3]).toBe("sensor-1");
    expect(params[5]).toBe("1024"); // memoryBytes as string (bigint)
    expect(params[6]).toBe("4096"); // maxMemoryBytes as string (bigint)
    expect(params[8]).toBeNull(); // battery — never coerced to 0
    expect(params[9]).toBeNull(); // signal
    expect(params[10]).toBeNull(); // temperature
  });
});

describe("IoTDeviceService.markStaleForFleet", () => {
  const ENV_KEY: string = "IOT_INVENTORY_STALE_MINUTES";
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[ENV_KEY];
    delete process.env[ENV_KEY]; // default 15 min → 900s in the SQL
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedValue;
    }
  });

  test("cutoff is per-device: GREATEST(grace x COALESCE(interval, fleet default, 0), stale seconds)", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);
    const anchor: Date = new Date("2026-06-13T00:00:00.000Z");

    await IoTDeviceService.markStaleForFleet({
      iotFleetId: FLEET_ID,
      anchor,
      fleetDefaultCheckinIntervalSeconds: 3600,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('UPDATE "IoTDevice"');
    expect(sql).toContain('"iotFleetId" = $1');
    expect(sql).toContain(
      '"lastSeenAt" < ($2::timestamptz - make_interval(secs =>',
    );
    // Grace factor 3, per-device interval else fleet default else 0…
    expect(sql).toContain(
      '3 * COALESCE("expectedCheckinIntervalSeconds", $6, 0)',
    );
    // …floored at the fleet-wide stale threshold (default 15 min).
    expect(sql).toMatch(
      /GREATEST\(\s*3 \* COALESCE\("expectedCheckinIntervalSeconds", \$6, 0\),\s*900\s*\)/,
    );

    expect(params).toEqual([
      FLEET_ID.toString(),
      anchor,
      IoTDeviceState.Stale,
      IoTDeviceState.Online,
      IoTDeviceState.Offline,
      3600,
    ]);
  });

  test("only walks Online/Offline rows (never re-marks Stale or resurrects Retired)", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);

    await IoTDeviceService.markStaleForFleet({
      iotFleetId: FLEET_ID,
      anchor: new Date("2026-06-13T00:00:00.000Z"),
      fleetDefaultCheckinIntervalSeconds: null,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('AND "state" IN ($4, $5)');
    expect(params[3]).toBe(IoTDeviceState.Online);
    expect(params[4]).toBe(IoTDeviceState.Offline);
    // A fleet without a default check-in interval passes NULL through.
    expect(params[5]).toBeNull();
  });

  test("normalizes the postgres [rows, affected] UPDATE result", async () => {
    mockQueryRunner([[], 7]);
    const affected: number = await IoTDeviceService.markStaleForFleet({
      iotFleetId: FLEET_ID,
      anchor: new Date("2026-06-13T00:00:00.000Z"),
      fleetDefaultCheckinIntervalSeconds: null,
    });
    expect(affected).toBe(7);
  });

  test("returns 0 when the driver result carries no affected count", async () => {
    mockQueryRunner({});
    const affected: number = await IoTDeviceService.markStaleForFleet({
      iotFleetId: FLEET_ID,
      anchor: new Date("2026-06-13T00:00:00.000Z"),
      fleetDefaultCheckinIntervalSeconds: null,
    });
    expect(affected).toBe(0);
  });
});

describe("IoTDeviceService.retireStaleDevices", () => {
  test("is table-wide: no fleet filter, cutoff on lastSeenAt alone", async () => {
    const query: jest.Mock = mockQueryRunner([[], 2]);
    const olderThan: Date = new Date("2026-05-13T00:00:00.000Z");

    const affected: number = await IoTDeviceService.retireStaleDevices({
      olderThan,
    });

    expect(affected).toBe(2);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('UPDATE "IoTDevice"');
    expect(sql).not.toContain('"iotFleetId"');
    expect(sql).toContain('"lastSeenAt" < $1');
    expect(params).toEqual([olderThan, IoTDeviceState.Retired]);
  });

  test("skips rows that are already Retired (NULL state still retires)", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);

    await IoTDeviceService.retireStaleDevices({
      olderThan: new Date("2026-05-13T00:00:00.000Z"),
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('AND ("state" IS NULL OR "state" != $2)');
  });
});

describe("IoTDeviceService silent-device sweeps (querySilentDevices)", () => {
  const NOW: Date = new Date("2026-06-13T12:00:00.000Z");

  function silentRow(overrides: Record<string, unknown> = {}): {
    _id: string;
    kind: string;
    externalId: string;
    deviceType: string | null;
    firmwareVersion: string | null;
    state: string;
  } {
    return {
      _id: ObjectID.generate().toString(),
      kind: "Sensor",
      externalId: "sensor-1",
      deviceType: "temperature",
      firmwareVersion: "1.2.3",
      state: IoTDeviceState.Online,
      ...overrides,
    };
  }

  test("findDevicesGoneSilent numbers ONE state placeholder ($5) after the four fixed params", async () => {
    const query: jest.Mock = mockQueryRunner([]);

    await IoTDeviceService.findDevicesGoneSilent({
      iotFleetId: FLEET_ID,
      fleetDefaultCheckinIntervalSeconds: 300,
      now: NOW,
      limit: 50,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('AND "state" IN ($5)');
    expect(sql).not.toContain("$6");
    expect(params).toEqual([
      FLEET_ID.toString(),
      300,
      NOW,
      50,
      IoTDeviceState.Online,
    ]);
  });

  test("findSilentDownDevices numbers TWO state placeholders ($5, $6)", async () => {
    const query: jest.Mock = mockQueryRunner([]);

    await IoTDeviceService.findSilentDownDevices({
      iotFleetId: FLEET_ID,
      fleetDefaultCheckinIntervalSeconds: 300,
      now: NOW,
      limit: 25,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('AND "state" IN ($5, $6)');
    expect(params).toEqual([
      FLEET_ID.toString(),
      300,
      NOW,
      25,
      IoTDeviceState.Offline,
      IoTDeviceState.Stale,
    ]);
  });

  test("excludes archived devices and orders oldest-silent first with the limit", async () => {
    const query: jest.Mock = mockQueryRunner([]);

    await IoTDeviceService.findDevicesGoneSilent({
      iotFleetId: FLEET_ID,
      fleetDefaultCheckinIntervalSeconds: 300,
      now: NOW,
      limit: 50,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('"iotFleetId" = $1');
    expect(sql).toContain('AND "isArchived" IS NOT TRUE');
    expect(sql).toContain('ORDER BY "lastSeenAt" ASC');
    expect(sql).toContain("LIMIT $4");
  });

  test("COALESCE-interval NULL semantics: no device interval and no fleet default means the row can never match", async () => {
    const query: jest.Mock = mockQueryRunner([]);

    await IoTDeviceService.findDevicesGoneSilent({
      iotFleetId: FLEET_ID,
      fleetDefaultCheckinIntervalSeconds: null,
      now: NOW,
      limit: 50,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    /*
     * $2 is the fleet default. With it NULL and the device's own
     * expectedCheckinIntervalSeconds NULL, COALESCE(...) IS NOT NULL
     * is false — silence detection is opt-in per device/fleet, so a
     * device with no effective interval is simply never swept.
     */
    expect(params[1]).toBeNull();
    expect(sql).toContain(
      'AND COALESCE("expectedCheckinIntervalSeconds", $2) IS NOT NULL',
    );

    // The effective cutoff: grace x interval, floored at 60s of silence.
    expect(sql).toMatch(
      /GREATEST\(\s*3 \* COALESCE\("expectedCheckinIntervalSeconds", \$2\),\s*60\s*\)/,
    );
    expect(sql).toContain(
      '"lastSeenAt" < ($3::timestamptz - make_interval(secs =>',
    );
  });

  test("maps rows to SilentIoTDevice with an ObjectID id", async () => {
    const idStr: string = ObjectID.generate().toString();
    mockQueryRunner([
      silentRow({ _id: idStr }),
      silentRow({
        _id: ObjectID.generate().toString(),
        kind: "Gateway",
        externalId: "gw-9",
        deviceType: null,
        firmwareVersion: null,
        state: IoTDeviceState.Stale,
      }),
    ]);

    const devices: Array<SilentIoTDevice> =
      await IoTDeviceService.findSilentDownDevices({
        iotFleetId: FLEET_ID,
        fleetDefaultCheckinIntervalSeconds: 300,
        now: NOW,
        limit: 10,
      });

    expect(devices).toHaveLength(2);
    expect(devices[0]!.id).toBeInstanceOf(ObjectID);
    expect(devices[0]!.id.toString()).toBe(idStr);
    expect(devices[0]!.kind).toBe("Sensor");
    expect(devices[0]!.externalId).toBe("sensor-1");
    expect(devices[0]!.deviceType).toBe("temperature");
    expect(devices[0]!.firmwareVersion).toBe("1.2.3");
    expect(devices[0]!.state).toBe(IoTDeviceState.Online);

    expect(devices[1]!.kind).toBe("Gateway");
    expect(devices[1]!.deviceType).toBeNull();
    expect(devices[1]!.firmwareVersion).toBeNull();
    expect(devices[1]!.state).toBe(IoTDeviceState.Stale);
  });
});

describe("IoTDeviceService.getInventorySummary", () => {
  test("excludes Retired and archived rows; upCount is lifecycle-Online with legacy isUp fallback", async () => {
    const query: jest.Mock = mockQueryRunner([]);

    await IoTDeviceService.getInventorySummary({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('AND ("state" IS NULL OR "state" != $4)');
    expect(sql).toContain('AND "isArchived" IS NOT TRUE');

    /*
     * "Online" means lifecycle-Online; rows predating the lifecycle
     * migration (NULL state) fall back to the legacy isUp flag.
     */
    expect(sql).toContain(
      'WHERE ("state" = $3 OR ("state" IS NULL AND "isUp" IS TRUE))',
    );

    expect(params).toEqual([
      PROJECT_ID.toString(),
      FLEET_ID.toString(),
      IoTDeviceState.Online,
      IoTDeviceState.Retired,
    ]);
  });

  test("aggregates per-kind rows into totals and countsByKind", async () => {
    mockQueryRunner([
      { kind: "Sensor", count: "3", upCount: "2" },
      { kind: "Gateway", count: "1", upCount: "0" },
    ]);

    const summary: {
      deviceCount: number;
      onlineDeviceCount: number;
      countsByKind: Record<string, number>;
    } = await IoTDeviceService.getInventorySummary({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
    });

    expect(summary).toEqual({
      deviceCount: 4,
      onlineDeviceCount: 2,
      countsByKind: { Sensor: 3, Gateway: 1 },
    });
  });

  test("returns zeros for an empty fleet and tolerates unparseable counts", async () => {
    mockQueryRunner([{ kind: "Weird", count: "not-a-number", upCount: "" }]);

    const summary: {
      deviceCount: number;
      onlineDeviceCount: number;
      countsByKind: Record<string, number>;
    } = await IoTDeviceService.getInventorySummary({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
    });

    expect(summary).toEqual({
      deviceCount: 0,
      onlineDeviceCount: 0,
      countsByKind: { Weird: 0 },
    });
  });
});

describe("IoTDeviceService threshold env parsing", () => {
  const STALE_KEY: string = "IOT_INVENTORY_STALE_MINUTES";
  const RETIRE_KEY: string = "IOT_INVENTORY_RETIRE_DAYS";
  let savedStale: string | undefined;
  let savedRetire: string | undefined;

  beforeEach(() => {
    savedStale = process.env[STALE_KEY];
    savedRetire = process.env[RETIRE_KEY];
  });

  afterEach(() => {
    if (savedStale === undefined) {
      delete process.env[STALE_KEY];
    } else {
      process.env[STALE_KEY] = savedStale;
    }
    if (savedRetire === undefined) {
      delete process.env[RETIRE_KEY];
    } else {
      process.env[RETIRE_KEY] = savedRetire;
    }
  });

  test("getStaleThresholdMinutes defaults to 15 (3x the 5-minute scrape interval)", () => {
    delete process.env[STALE_KEY];
    expect(IoTDeviceService.getStaleThresholdMinutes()).toBe(15);
  });

  test("getStaleThresholdMinutes honors overrides down to the 5-minute floor", () => {
    process.env[STALE_KEY] = "30";
    expect(IoTDeviceService.getStaleThresholdMinutes()).toBe(30);
    process.env[STALE_KEY] = "5";
    expect(IoTDeviceService.getStaleThresholdMinutes()).toBe(5);
  });

  test("getStaleThresholdMinutes rejects sub-floor, zero, and non-numeric overrides", () => {
    process.env[STALE_KEY] = "4";
    expect(IoTDeviceService.getStaleThresholdMinutes()).toBe(15);
    process.env[STALE_KEY] = "0";
    expect(IoTDeviceService.getStaleThresholdMinutes()).toBe(15);
    process.env[STALE_KEY] = "not-a-number";
    expect(IoTDeviceService.getStaleThresholdMinutes()).toBe(15);
  });

  test("getRetireThresholdDays defaults to 30", () => {
    delete process.env[RETIRE_KEY];
    expect(IoTDeviceService.getRetireThresholdDays()).toBe(30);
  });

  test("getRetireThresholdDays honors overrides down to the 1-day floor", () => {
    process.env[RETIRE_KEY] = "90";
    expect(IoTDeviceService.getRetireThresholdDays()).toBe(90);
    process.env[RETIRE_KEY] = "1";
    expect(IoTDeviceService.getRetireThresholdDays()).toBe(1);
  });

  test("getRetireThresholdDays rejects zero, negative, and non-numeric overrides", () => {
    process.env[RETIRE_KEY] = "0";
    expect(IoTDeviceService.getRetireThresholdDays()).toBe(30);
    process.env[RETIRE_KEY] = "-3";
    expect(IoTDeviceService.getRetireThresholdDays()).toBe(30);
    process.env[RETIRE_KEY] = "soon";
    expect(IoTDeviceService.getRetireThresholdDays()).toBe(30);
  });

  test("threshold dates subtract the configured window from the anchor", () => {
    delete process.env[STALE_KEY];
    delete process.env[RETIRE_KEY];
    const now: Date = new Date("2026-06-13T12:00:00.000Z");

    expect(IoTDeviceService.getStaleThresholdDate(now)).toEqual(
      OneUptimeDate.addRemoveMinutes(now, -15),
    );
    expect(IoTDeviceService.getRetireThresholdDate(now)).toEqual(
      OneUptimeDate.addRemoveDays(now, -30),
    );
  });
});
