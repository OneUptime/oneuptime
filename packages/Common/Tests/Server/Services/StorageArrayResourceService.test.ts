import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import StorageArrayResourceService, {
  CRITICAL_HARDWARE_STATUSES,
  HARDWARE_KINDS,
  ParsedStorageArrayResource,
  StorageArrayInventorySummary,
  UNHEALTHY_HARDWARE_STATUSES,
} from "../../../Server/Services/StorageArrayResourceService";
import {
  isCriticalComponentStatus,
  isUnhealthyComponentStatus,
} from "../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";

/*
 * The StorageArrayResource inventory write path — same mocked-query-runner
 * shape as the Ceph and VMware resource service tests. Locks in the exact
 * column / cast / parameter order of the hand-built bulk upsert, the
 * COALESCE-per-column contract (a scrape lacking a series never blanks a
 * value), the lastSeenAt dominance guard, every value coercion that keeps
 * one bad value from aborting a 500-row chunk, the stale cleanup's two
 * thresholds, and the inventory summary parsing.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ARRAY_ID: ObjectID = ObjectID.generate();
const SEEN_AT: Date = new Date("2026-10-05T10:00:00.000Z");

type QueryCall = [string, Array<unknown>];

const COLUMNS: Array<[string, string]> = [
  ["projectId", "uuid"],
  ["storageArrayId", "uuid"],
  ["kind", "text"],
  ["externalId", "text"],
  ["name", "text"],
  ["status", "text"],
  ["statusDetail", "text"],
  ["componentType", "text"],
  ["model", "text"],
  ["firmwareVersion", "text"],
  ["groupName", "text"],
  ["capacityBytes", "bigint"],
  ["usedBytes", "bigint"],
  ["dataReductionRatio", "numeric"],
  ["readLatencyUsec", "numeric"],
  ["writeLatencyUsec", "numeric"],
  ["readIops", "numeric"],
  ["writeIops", "numeric"],
  ["readBytesPerSec", "numeric"],
  ["writeBytesPerSec", "numeric"],
  ["temperatureCelsius", "numeric"],
  ["replicationLagMs", "numeric"],
  ["connectionCount", "integer"],
  ["details", "jsonb"],
  ["metricsUpdatedAt", "timestamptz"],
  ["lastSeenAt", "timestamptz"],
  ["version", "integer"],
];

const COLUMN_COUNT: number = COLUMNS.length;

const IDENTITY_COLUMNS: Array<string> = [
  "projectId",
  "storageArrayId",
  "kind",
  "externalId",
  "lastSeenAt",
  "version",
];

const COALESCED_COLUMNS: Array<string> = COLUMNS.map(
  ([name]: [string, string]) => {
    return name;
  },
).filter((name: string) => {
  return !IDENTITY_COLUMNS.includes(name);
});

const METRIC_FIELDS: Array<keyof ParsedStorageArrayResource> = [
  "capacityBytes",
  "usedBytes",
  "dataReductionRatio",
  "readLatencyUsec",
  "writeLatencyUsec",
  "readIops",
  "writeIops",
  "readBytesPerSec",
  "writeBytesPerSec",
  "temperatureCelsius",
  "replicationLagMs",
];

function mockQueryRunner(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result as never);
  jest
    .spyOn(StorageArrayResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

function resource(
  overrides: Partial<ParsedStorageArrayResource> = {},
): ParsedStorageArrayResource {
  return {
    kind: StorageArrayResourceKind.Hardware,
    externalId: "CH0.PWR1",
    name: "CH0.PWR1",
    status: "ok",
    statusDetail: null,
    componentType: "power_supply",
    model: null,
    firmwareVersion: null,
    groupName: null,
    capacityBytes: null,
    usedBytes: null,
    dataReductionRatio: null,
    readLatencyUsec: null,
    writeLatencyUsec: null,
    readIops: null,
    writeIops: null,
    readBytesPerSec: null,
    writeBytesPerSec: null,
    temperatureCelsius: null,
    replicationLagMs: null,
    connectionCount: null,
    details: null,
    lastSeenAt: SEEN_AT,
    ...overrides,
  };
}

async function upsert(
  resources: Array<ParsedStorageArrayResource>,
): Promise<jest.Mock> {
  const query: jest.Mock = mockQueryRunner();
  await StorageArrayResourceService.bulkUpsert({
    projectId: PROJECT_ID,
    storageArrayId: ARRAY_ID,
    resources,
  });
  return query;
}

// The parameter one column got for the first row.
async function paramFor(
  column: string,
  overrides: Partial<ParsedStorageArrayResource>,
): Promise<unknown> {
  const query: jest.Mock = await upsert([resource(overrides)]);
  const [, params] = query.mock.calls[0] as QueryCall;
  const index: number = COLUMNS.findIndex(([name]: [string, string]) => {
    return name === column;
  });
  return params[index];
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StorageArrayResourceService.bulkUpsert - statement shape", () => {
  test("does nothing for an empty batch", async () => {
    const query: jest.Mock = await upsert([]);
    expect(query).not.toHaveBeenCalled();
  });

  test("inserts the 27 columns in order and upserts on the unique identity index", async () => {
    const query: jest.Mock = await upsert([resource()]);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as QueryCall;
    const columnList: string = COLUMNS.map(([name]: [string, string]) => {
      return `"${name}"`;
    }).join(", ");

    expect(sql).toContain(`INSERT INTO "StorageArrayResource" (${columnList})`);
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "storageArrayId", "kind", "externalId")',
    );
    expect(sql).toContain("DO UPDATE SET");
  });

  test("COALESCEs every non-identity column, so a scrape missing a series never blanks it", async () => {
    const query: jest.Mock = await upsert([resource()]);
    const [sql] = query.mock.calls[0] as QueryCall;

    expect(COALESCED_COLUMNS).toHaveLength(21);
    for (const column of COALESCED_COLUMNS) {
      expect(sql).toContain(
        `"${column}" = COALESCE(EXCLUDED."${column}", "StorageArrayResource"."${column}")`,
      );
    }
    // The identity never changes on conflict, and lastSeenAt is replaced.
    for (const column of IDENTITY_COLUMNS) {
      expect(sql).not.toContain(`"${column}" = COALESCE`);
    }
    expect(sql).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
    expect(sql).toContain('"updatedAt" = now()');
  });

  test("an out-of-order (older) scrape never regresses a newer row", async () => {
    const query: jest.Mock = await upsert([resource()]);
    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "StorageArrayResource"."lastSeenAt"',
    );
  });

  test("every placeholder carries its column's cast", async () => {
    const query: jest.Mock = await upsert([resource()]);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(params).toHaveLength(COLUMN_COUNT);
    const tuple: string = COLUMNS.map(
      ([, cast]: [string, string], index: number) => {
        return `$${index + 1}::${cast}`;
      },
    ).join(", ");
    expect(sql).toContain(`VALUES (${tuple})`);
  });

  test("the second row's placeholders continue where the first row's stop", async () => {
    const query: jest.Mock = await upsert([
      resource({ externalId: "CH0.PWR0" }),
      resource({ externalId: "CH0.PWR1" }),
    ]);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(params).toHaveLength(2 * COLUMN_COUNT);
    expect(sql).toContain(`($${COLUMN_COUNT + 1}::uuid, `);
    expect(sql).toContain(`$${2 * COLUMN_COUNT}::integer)`);
    expect(sql).not.toContain(`$${2 * COLUMN_COUNT + 1}`);
  });

  test("parameter tuple matches the column order exactly", async () => {
    const query: jest.Mock = await upsert([
      resource({
        kind: StorageArrayResourceKind.Volume,
        externalId: "pod1::vmfs-01",
        name: "pod1::vmfs-01",
        status: "healthy",
        statusDetail: "Redundant",
        componentType: "eth",
        model: "FA-X70R4",
        firmwareVersion: "6.7.3",
        groupName: "pod1",
        capacityBytes: 1099511627776,
        usedBytes: 214748364.8,
        dataReductionRatio: 3.7,
        readLatencyUsec: 250.5,
        writeLatencyUsec: 410,
        readIops: 1200.7,
        writeIops: 800,
        readBytesPerSec: 52428800,
        writeBytesPerSec: 10485760,
        temperatureCelsius: 31.5,
        replicationLagMs: 1500,
        connectionCount: 2,
        details: { naaId: "naa.624a9370", qosIopsLimit: 50000 },
      }),
    ]);
    const [, params] = query.mock.calls[0] as QueryCall;

    expect(params).toEqual([
      PROJECT_ID.toString(),
      ARRAY_ID.toString(),
      "Volume",
      "pod1::vmfs-01",
      "pod1::vmfs-01",
      "healthy",
      "Redundant",
      "eth",
      "FA-X70R4",
      "6.7.3",
      "pod1",
      "1099511627776", // bigint rides as a string
      "214748364", // whole bytes
      3.7,
      250.5,
      410,
      1200.7,
      800,
      52428800,
      10485760,
      31.5,
      1500,
      2,
      JSON.stringify({ naaId: "naa.624a9370", qosIopsLimit: 50000 }),
      SEEN_AT, // metricsUpdatedAt: the row carried metrics
      SEEN_AT,
      0, // version
    ]);
  });

  test("an identity-only row (no metric) never writes metricsUpdatedAt", async () => {
    expect(await paramFor("metricsUpdatedAt", {})).toBeNull();
    expect(await paramFor("lastSeenAt", {})).toBe(SEEN_AT);
  });

  test.each(METRIC_FIELDS)(
    "%s alone stamps metricsUpdatedAt",
    async (field: keyof ParsedStorageArrayResource) => {
      expect(
        await paramFor("metricsUpdatedAt", {
          [field]: 1,
        } as Partial<ParsedStorageArrayResource>),
      ).toBe(SEEN_AT);
    },
  );

  test("a connection count or a non-finite metric is not a metric reading", async () => {
    expect(
      await paramFor("metricsUpdatedAt", { connectionCount: 4 }),
    ).toBeNull();
    expect(
      await paramFor("metricsUpdatedAt", {
        readLatencyUsec: NaN,
        capacityBytes: Infinity,
      }),
    ).toBeNull();
  });

  test("details are NULL when empty, so COALESCE keeps the last ones", async () => {
    expect(await paramFor("details", { details: null })).toBeNull();
    expect(await paramFor("details", { details: {} })).toBeNull();
    expect(
      await paramFor("details", {
        details: { speedBytesPerSec: 3125000000, enabled: true, slot: "0" },
      }),
    ).toBe(
      JSON.stringify({
        speedBytesPerSec: 3125000000,
        enabled: true,
        slot: "0",
      }),
    );
  });
});

describe("StorageArrayResourceService.bulkUpsert - value coercion", () => {
  test.each([
    ["a TiB", 1099511627776, "1099511627776"],
    ["a fraction", 1234.9, "1234"],
    ["zero", 0, "0"],
    ["a multi-PiB value past 2^53", 2 ** 53 + 2, "9007199254740994"],
    ["just under the bigint limit", 9.2e18, "9200000000000000000"],
    ["a negative", -1, null],
    ["NaN", NaN, null],
    ["Infinity", Infinity, null],
    ["2^63, past bigint", 2 ** 63, null],
    ["1e21, which would print in exponent notation", 1e21, null],
    ["null", null, null],
  ])(
    "bigint columns: %s -> %p",
    async (_: string, value: number | null, expected: string | null) => {
      /*
       * One value Postgres cannot cast to bigint fails the whole 500-row
       * statement, so it is dropped to NULL instead (COALESCE keeps the last
       * good value).
       */
      expect(await paramFor("capacityBytes", { capacityBytes: value })).toBe(
        expected,
      );
      expect(await paramFor("usedBytes", { usedBytes: value })).toBe(expected);
    },
  );

  test.each([
    ["a fraction", 3.14159, 3.14159],
    ["zero", 0, 0],
    ["a negative (a temperature below zero)", -5.5, -5.5],
    ["a tiny value", 1e-7, 1e-7],
    ["NaN", NaN, null],
    ["Infinity", Infinity, null],
    ["-Infinity", -Infinity, null],
    ["null", null, null],
  ])(
    "numeric columns: %s -> %p",
    async (_: string, value: number | null, expected: number | null) => {
      for (const column of [
        "dataReductionRatio",
        "readLatencyUsec",
        "writeLatencyUsec",
        "readIops",
        "writeIops",
        "readBytesPerSec",
        "writeBytesPerSec",
        "temperatureCelsius",
        "replicationLagMs",
      ]) {
        expect(
          await paramFor(column, {
            [column]: value,
          } as Partial<ParsedStorageArrayResource>),
        ).toBe(expected);
      }
    },
  );

  test.each([
    ["a whole count", 3, 3],
    ["zero", 0, 0],
    ["a fraction", 3.9, 3],
    ["a negative", -1, null],
    ["NaN", NaN, null],
    ["Infinity", Infinity, null],
    ["a count past the integer column", 1e12, 2147483647],
    ["null", null, null],
  ])(
    "connectionCount: %s -> %p",
    async (_: string, value: number | null, expected: number | null) => {
      expect(
        await paramFor("connectionCount", { connectionCount: value }),
      ).toBe(expected);
    },
  );

  test("over-long text is clamped to its column, and a clamped externalId is logged", async () => {
    const query: jest.Mock = await upsert([
      resource({
        kind: "K".repeat(150),
        externalId: "e".repeat(600),
        name: "n".repeat(600),
        status: "s".repeat(150),
        statusDetail: "d".repeat(150),
        componentType: "c".repeat(150),
        model: "m".repeat(150),
        firmwareVersion: "f".repeat(150),
        groupName: "g".repeat(600),
      }),
    ]);
    const [, params] = query.mock.calls[0] as QueryCall;
    const valueOf: (column: string) => unknown = (column: string): unknown => {
      return params[
        COLUMNS.findIndex(([name]: [string, string]) => {
          return name === column;
        })
      ];
    };

    // ShortText columns: varchar(100); LongText columns: varchar(500).
    for (const column of [
      "kind",
      "status",
      "statusDetail",
      "componentType",
      "model",
      "firmwareVersion",
    ]) {
      expect((valueOf(column) as string).length).toBe(100);
    }
    for (const column of ["externalId", "name", "groupName"]) {
      expect((valueOf(column) as string).length).toBe(500);
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("externalId exceeds 500 chars; truncated"),
    );
  });

  test("text within bounds is never touched or logged", async () => {
    await upsert([resource({ externalId: "e".repeat(500) })]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("an Invalid Date falls back to now instead of failing the cast", async () => {
    const before: number = Date.now();
    const lastSeenAt: unknown = await paramFor("lastSeenAt", {
      lastSeenAt: new Date(NaN),
      readIops: 1,
    });
    const after: number = Date.now();

    expect(lastSeenAt).toBeInstanceOf(Date);
    expect((lastSeenAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((lastSeenAt as Date).getTime()).toBeLessThanOrEqual(after);
  });
});

describe("StorageArrayResourceService.bulkUpsert - duplicate keys after clamping", () => {
  test("two ids that differ only past character 500 collapse to the newest, in first-seen order", async () => {
    /*
     * Postgres refuses two VALUES tuples with one conflict target in one
     * statement (SQLSTATE 21000) — the whole chunk would be lost.
     */
    const prefix: string = "d".repeat(500);
    const query: jest.Mock = await upsert([
      resource({
        kind: "Directory",
        externalId: `${prefix}-old`,
        name: "older",
        lastSeenAt: new Date("2026-10-05T09:00:00.000Z"),
      }),
      resource({ kind: "Directory", externalId: "other" }),
      resource({
        kind: "Directory",
        externalId: `${prefix}-new`,
        name: "newer",
        lastSeenAt: new Date("2026-10-05T09:05:00.000Z"),
      }),
    ]);
    const [, params] = query.mock.calls[0] as QueryCall;

    expect(params).toHaveLength(2 * COLUMN_COUNT);
    // The collided key keeps its first position, with the newer data.
    expect(params[3]).toBe(prefix);
    expect(params[4]).toBe("newer");
    expect(params[COLUMN_COUNT + 3]).toBe("other");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped 1 duplicate (kind, externalId) entry"),
    );
  });

  test("the same id under two kinds is not a duplicate", async () => {
    const query: jest.Mock = await upsert([
      resource({ kind: "Hardware", externalId: "CT0" }),
      resource({ kind: "Controller", externalId: "CT0" }),
    ]);
    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params).toHaveLength(2 * COLUMN_COUNT);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("StorageArrayResourceService.bulkUpsert - chunking", () => {
  function many(count: number): Array<ParsedStorageArrayResource> {
    const list: Array<ParsedStorageArrayResource> = [];
    for (let i: number = 0; i < count; i++) {
      list.push(
        resource({
          kind: StorageArrayResourceKind.Volume,
          externalId: `v${i}`,
        }),
      );
    }
    return list;
  }

  test("splits 501 rows into a 500-row and a 1-row statement, each numbered from $1", async () => {
    const query: jest.Mock = await upsert(many(501));

    expect(query).toHaveBeenCalledTimes(2);
    const [, firstParams] = query.mock.calls[0] as QueryCall;
    const [secondSql, secondParams] = query.mock.calls[1] as QueryCall;
    expect(firstParams).toHaveLength(500 * COLUMN_COUNT);
    expect(secondParams).toHaveLength(COLUMN_COUNT);
    expect(secondSql).toContain("VALUES ($1::uuid,");
    expect(secondParams[3]).toBe("v500");
  });

  test.each([
    [500, 1],
    [1000, 2],
    [1001, 3],
  ])("%p rows take %p statements", async (rowCount: number, calls: number) => {
    const query: jest.Mock = await upsert(many(rowCount));
    expect(query).toHaveBeenCalledTimes(calls);
  });

  test("500 rows stay well inside Postgres's 65535 parameter limit", () => {
    expect(500 * COLUMN_COUNT).toBeLessThan(65535);
  });
});

describe("StorageArrayResourceService.deleteStaleForArray", () => {
  const OLDER_THAN: Date = new Date("2026-10-05T09:45:00.000Z");
  const SLOW_OLDER_THAN: Date = new Date("2026-10-05T08:30:00.000Z");

  async function deleteStale(result: unknown): Promise<{
    affected: number;
    call: QueryCall;
  }> {
    const query: jest.Mock = mockQueryRunner(result);
    const affected: number =
      await StorageArrayResourceService.deleteStaleForArray({
        storageArrayId: ARRAY_ID,
        olderThan: OLDER_THAN,
        slowScrapeOlderThan: SLOW_OLDER_THAN,
      });
    return { affected, call: query.mock.calls[0] as QueryCall };
  }

  test("deletes per kind against its own threshold: directories use the slow-scrape cutoff", async () => {
    const { call } = await deleteStale([[], 0]);
    const [sql, params] = call;

    expect(sql).toContain('DELETE FROM "StorageArrayResource"');
    expect(sql).toContain('WHERE "storageArrayId" = $1');
    expect(sql).toContain('("kind" <> ALL($4::text[]) AND "lastSeenAt" < $2)');
    expect(sql).toContain('("kind" = ANY($4::text[]) AND "lastSeenAt" < $3)');
    expect(params).toEqual([
      ARRAY_ID.toString(),
      OLDER_THAN,
      SLOW_OLDER_THAN,
      [StorageArrayResourceKind.Directory],
    ]);
  });

  test("normalizes the postgres [rows, affected] DELETE result", async () => {
    expect((await deleteStale([[], 7])).affected).toBe(7);
  });

  test.each([
    ["an empty array", []],
    ["a rows-only array", [[]]],
    ["an object", { affected: 3 }],
    ["a string count", [[], "7"]],
    ["undefined", undefined],
  ])(
    "returns 0 when the driver result is %s",
    async (_: string, result: unknown) => {
      expect((await deleteStale(result)).affected).toBe(0);
    },
  );

  test("warns only when more than 500 rows went stale at once", async () => {
    await deleteStale([[], 500]);
    expect(warnSpy).not.toHaveBeenCalled();

    await deleteStale([[], 501]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("deleted 501 stale rows"),
    );
  });
});

describe("StorageArrayResourceService.getInventorySummary", () => {
  test("counts per kind and distinct unhealthy components in one grouped query", async () => {
    const query: jest.Mock = mockQueryRunner([]);
    await StorageArrayResourceService.getInventorySummary({
      projectId: PROJECT_ID,
      storageArrayId: ARRAY_ID,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('FROM "StorageArrayResource"');
    expect(sql).toContain('"projectId" = $1 AND "storageArrayId" = $2');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('lower(h."status") = ANY($3::text[])');
    expect(sql).toContain('h."kind" = ANY($4::text[])');
    // One physical part is several rows under one name — count names.
    expect(sql).toContain('COUNT(DISTINCT lower(h."externalId"))');
    expect(sql).toContain('GROUP BY "kind"');
    expect(params).toEqual([
      PROJECT_ID.toString(),
      ARRAY_ID.toString(),
      UNHEALTHY_HARDWARE_STATUSES,
      HARDWARE_KINDS,
    ]);
    expect(HARDWARE_KINDS).toEqual(["Hardware", "Drive", "Controller"]);
  });

  test("parses the text counts and the distinct unhealthy component count every row carries", async () => {
    mockQueryRunner([
      { kind: "Volume", count: "12", unhealthyHardwareCount: "3" },
      { kind: "Hardware", count: "30", unhealthyHardwareCount: "3" },
      { kind: "Drive", count: "24", unhealthyHardwareCount: "3" },
      { kind: "Controller", count: "2", unhealthyHardwareCount: "3" },
      { kind: "NetworkInterface", count: "8", unhealthyHardwareCount: "3" },
      { kind: "Host", count: "garbage", unhealthyHardwareCount: "3" },
    ]);

    const summary: StorageArrayInventorySummary =
      await StorageArrayResourceService.getInventorySummary({
        projectId: PROJECT_ID,
        storageArrayId: ARRAY_ID,
      });

    expect(summary).toEqual({
      countsByKind: {
        Volume: 12,
        Hardware: 30,
        Drive: 24,
        Controller: 2,
        NetworkInterface: 8,
        Host: 0,
      },
      unhealthyHardwareCount: 3,
    });
  });

  test("a missing or garbage unhealthy count reads as 0", async () => {
    mockQueryRunner([{ kind: "Volume", count: "1", unhealthyHardwareCount: null }]);
    await expect(
      StorageArrayResourceService.getInventorySummary({
        projectId: PROJECT_ID,
        storageArrayId: ARRAY_ID,
      }),
    ).resolves.toEqual({
      countsByKind: { Volume: 1 },
      unhealthyHardwareCount: 0,
    });
  });

  test("an empty inventory is all zeros", async () => {
    mockQueryRunner([]);
    await expect(
      StorageArrayResourceService.getInventorySummary({
        projectId: PROJECT_ID,
        storageArrayId: ARRAY_ID,
      }),
    ).resolves.toEqual({ countsByKind: {}, unhealthyHardwareCount: 0 });
  });
});

describe("StorageArrayResourceService status vocabularies", () => {
  /*
   * The summary query, the UI and the snapshot scan must agree on what an
   * unhealthy or critical component is, or the sidebar badge and the
   * StorageArray.unhealthyHardwareCount column drift apart.
   */
  const KNOWN_STATUSES: Array<string> = [
    // purefa_hw_component_status
    "ok",
    "critical",
    "degraded",
    "device_off",
    "identifying",
    "not_installed",
    "unknown",
    // purefa_drive_capacity_bytes
    "empty",
    "failed",
    "healthy",
    "missing",
    "recovering",
    "unadmitted",
    "unhealthy",
    "unrecognized",
    "updating",
    // purefa_hw_controller_info
    "ready",
    "not ready",
    // purefb_hardware_health as the scan maps it
    "unused",
  ];

  test("the lists are lowercase and duplicate-free", () => {
    for (const list of [
      UNHEALTHY_HARDWARE_STATUSES,
      CRITICAL_HARDWARE_STATUSES,
    ]) {
      expect(new Set(list).size).toBe(list.length);
      for (const status of list) {
        expect(status).toBe(status.toLowerCase());
      }
    }
  });

  test("UNHEALTHY_HARDWARE_STATUSES is exactly the scan's unhealthy predicate", () => {
    for (const status of KNOWN_STATUSES) {
      expect({
        status,
        listed: UNHEALTHY_HARDWARE_STATUSES.includes(status),
      }).toEqual({ status, listed: isUnhealthyComponentStatus(status) });
    }
    for (const status of UNHEALTHY_HARDWARE_STATUSES) {
      expect(KNOWN_STATUSES).toContain(status);
    }
  });

  test("REGRESSION: CRITICAL_HARDWARE_STATUSES is exactly the scan's critical predicate", () => {
    /*
     * `unhealthy` (a FlashBlade component reporting 0, a FlashArray drive
     * Purity calls unhealthy) turns the array Critical in the scan, but was
     * missing here.
     */
    for (const status of KNOWN_STATUSES) {
      expect({
        status,
        listed: CRITICAL_HARDWARE_STATUSES.includes(status),
      }).toEqual({ status, listed: isCriticalComponentStatus(status) });
    }
    for (const status of CRITICAL_HARDWARE_STATUSES) {
      expect(UNHEALTHY_HARDWARE_STATUSES).toContain(status);
    }
  });
});

describe("StorageArrayResourceService stale thresholds", () => {
  const ENV_KEY: string = "STORAGE_ARRAY_INVENTORY_STALE_MINUTES";
  const NOW: Date = new Date("2026-10-05T12:00:00.000Z");
  let savedValue: string | undefined;

  function minutesBefore(minutes: number): string {
    return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
  }

  beforeEach(() => {
    savedValue = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedValue;
    }
  });

  test("defaults to 15 minutes: 3x the slowest regular scrape", () => {
    expect(StorageArrayResourceService.getStaleThresholdMinutes()).toBe(15);
  });

  test.each([
    ["30", 30],
    ["5", 5],
    ["  20", 20],
    ["4", 15],
    ["0", 15],
    ["-30", 15],
    ["not-a-number", 15],
    ["", 15],
  ])(
    "the override %p gives %p minutes (minimum 5)",
    (raw: string, expected: number) => {
      process.env[ENV_KEY] = raw;
      expect(StorageArrayResourceService.getStaleThresholdMinutes()).toBe(
        expected,
      );
    },
  );

  test("getStaleThresholdDate subtracts the threshold from the supplied now", () => {
    expect(
      StorageArrayResourceService.getStaleThresholdDate(NOW).toISOString(),
    ).toBe(minutesBefore(15));
    process.env[ENV_KEY] = "45";
    expect(
      StorageArrayResourceService.getStaleThresholdDate(NOW).toISOString(),
    ).toBe(minutesBefore(45));
  });

  test("getStaleThresholdDate defaults to the current time", () => {
    const before: number = Date.now();
    const threshold: Date = StorageArrayResourceService.getStaleThresholdDate();
    const after: number = Date.now();
    expect(threshold.getTime()).toBeGreaterThanOrEqual(before - 15 * 60 * 1000);
    expect(threshold.getTime()).toBeLessThanOrEqual(after - 15 * 60 * 1000);
  });

  test("directories, scraped every 30 minutes, go stale only after 90", () => {
    expect(
      StorageArrayResourceService.getSlowScrapeStaleThresholdDate(
        NOW,
      ).toISOString(),
    ).toBe(minutesBefore(90));

    // An override below 90 never shortens it ...
    process.env[ENV_KEY] = "30";
    expect(
      StorageArrayResourceService.getSlowScrapeStaleThresholdDate(
        NOW,
      ).toISOString(),
    ).toBe(minutesBefore(90));

    // ... and one above 90 lengthens both.
    process.env[ENV_KEY] = "120";
    expect(
      StorageArrayResourceService.getSlowScrapeStaleThresholdDate(
        NOW,
      ).toISOString(),
    ).toBe(minutesBefore(120));
  });
});
