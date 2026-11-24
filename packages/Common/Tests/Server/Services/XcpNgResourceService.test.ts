import XcpNgResourceService, {
  XCP_NG_INVENTORY_STALE_MINUTES,
  XCP_NG_RESOURCE_UPSERT_COLUMNS,
  getXcpNgResourceUpsertParams,
  getXcpNgResourceUpsertSql,
  sanitizeXcpNgResource,
} from "../../../Server/Services/XcpNgResourceService";
import { ParsedXcpNgResource } from "../../../Server/Utils/Telemetry/XcpNgSnapshotScan";
import ObjectID from "../../../Types/ObjectID";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * XcpNgResourceService's hand-written SQL, without a database: the upsert's
 * columns and parameters stay in step, what it keeps and what it follows,
 * the clamps, the prune's cutoff and guard, and the reads' parameters.
 * XcpNgResourceWritesPostgres.test.ts runs the same statements on Postgres.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const POOL: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function resource(
  overrides: Partial<ParsedXcpNgResource> = {},
): ParsedXcpNgResource {
  return {
    kind: XcpNgResourceKind.VM,
    externalId: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
    name: "web-01",
    powerState: "Running",
    isUp: true,
    isEnabled: null,
    isControlDomain: false,
    parentHostExternalId: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
    parentHostName: "xcp-prod-01",
    storageRepositoryExternalId: null,
    storageRepositoryName: null,
    vmExternalId: null,
    vmName: null,
    uptimeSeconds: 172800.7,
    lastRunningAt: new Date(1795000000000),
    latestCpuPercent: 24.5,
    cpuCount: 2,
    runningVcpuCount: null,
    loadAverage: null,
    latestMemoryBytes: 2791728742.4,
    maxMemoryBytes: 4294967296,
    latestMemoryPercent: 65,
    latestDiskBytes: null,
    maxDiskBytes: null,
    latestDiskPercent: null,
    virtualAllocationBytes: null,
    srType: null,
    contentType: null,
    isShared: null,
    powerWatts: 12.5,
    tags: "production,web",
    lastSeenAt: new Date(1795000000000),
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env["XCP_NG_INVENTORY_STALE_MINUTES"];
});

describe("XcpNgResourceService upsert", () => {
  test("one parameter per column, in the columns' order", () => {
    const params: Array<unknown> = getXcpNgResourceUpsertParams({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      resource: resource(),
    });
    expect(params).toHaveLength(XCP_NG_RESOURCE_UPSERT_COLUMNS.length);
    const byColumn: Record<string, unknown> = {};
    XCP_NG_RESOURCE_UPSERT_COLUMNS.forEach((column: string, i: number) => {
      byColumn[column] = params[i];
    });
    expect(byColumn["projectId"]).toBe(PROJECT.toString());
    expect(byColumn["xcpNgPoolId"]).toBe(POOL.toString());
    expect(byColumn["kind"]).toBe("VM");
    expect(byColumn["name"]).toBe("web-01");
    // Integers truncated, bigints as strings, decimals kept.
    expect(byColumn["uptimeSeconds"]).toBe(172800);
    expect(byColumn["latestMemoryBytes"]).toBe("2791728742");
    expect(byColumn["maxMemoryBytes"]).toBe("4294967296");
    expect(byColumn["latestCpuPercent"]).toBe(24.5);
    expect(byColumn["powerWatts"]).toBe(12.5);
    expect(byColumn["metricsUpdatedAt"]).toEqual(new Date(1795000000000));
    expect(byColumn["lastSeenAt"]).toEqual(new Date(1795000000000));
    expect(byColumn["version"]).toBe(0);
  });

  test("unknown readings go in as NULL, never 0", () => {
    const params: Array<unknown> = getXcpNgResourceUpsertParams({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      resource: resource({
        uptimeSeconds: null,
        latestMemoryBytes: null,
        latestCpuPercent: Number.NaN,
        maxMemoryBytes: Number.POSITIVE_INFINITY,
      }),
    });
    const at: (column: string) => unknown = (column: string): unknown => {
      return params[XCP_NG_RESOURCE_UPSERT_COLUMNS.indexOf(column)];
    };
    expect(at("uptimeSeconds")).toBe(null);
    expect(at("latestMemoryBytes")).toBe(null);
    expect(at("latestCpuPercent")).toBe(null);
    expect(at("maxMemoryBytes")).toBe(null);
  });

  test("a negative byte count is never written", () => {
    const params: Array<unknown> = getXcpNgResourceUpsertParams({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      resource: resource({ latestDiskBytes: -5 }),
    });
    expect(
      params[XCP_NG_RESOURCE_UPSERT_COLUMNS.indexOf("latestDiskBytes")],
    ).toBe("0");
  });

  test("the statement has one placeholder per value, in tuples of the columns", () => {
    const sql: string = getXcpNgResourceUpsertSql(3);
    const placeholders: Array<string> = sql.match(/\$\d+/g) || [];
    expect(placeholders).toHaveLength(
      3 * XCP_NG_RESOURCE_UPSERT_COLUMNS.length,
    );
    expect(placeholders[placeholders.length - 1]).toBe(
      `$${3 * XCP_NG_RESOURCE_UPSERT_COLUMNS.length}`,
    );
    for (const column of XCP_NG_RESOURCE_UPSERT_COLUMNS) {
      expect(sql).toContain(`"${column}"`);
    }
  });

  test("it conflicts on the unique row of a pool's object, and never regresses a newer row", () => {
    const sql: string = getXcpNgResourceUpsertSql(1);
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "xcpNgPoolId", "kind", "externalId")',
    );
    expect(sql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "XcpNgResource"."lastSeenAt"',
    );
  });

  test("names and readings are kept when a batch does not carry them; when a VM last ran only moves forward", () => {
    const sql: string = getXcpNgResourceUpsertSql(1);
    expect(sql).toContain(
      '"name" = COALESCE(EXCLUDED."name", "XcpNgResource"."name")',
    );
    expect(sql).toContain(
      '"parentHostExternalId" = COALESCE(EXCLUDED."parentHostExternalId", "XcpNgResource"."parentHostExternalId")',
    );
    expect(sql).toContain(
      '"lastRunningAt" = GREATEST(EXCLUDED."lastRunningAt", "XcpNgResource"."lastRunningAt")',
    );
  });

  test("a virtual disk's VM follows the batch, so a detached disk stops naming one", () => {
    const sql: string = getXcpNgResourceUpsertSql(1);
    expect(sql).toContain(
      `"vmExternalId" = CASE WHEN EXCLUDED."kind" = 'VDI' THEN EXCLUDED."vmExternalId"`,
    );
  });

  test("oversized text is clamped to the columns' lengths", () => {
    const clamped: ParsedXcpNgResource = sanitizeXcpNgResource(
      resource({
        name: "x".repeat(400),
        parentHostName: "h".repeat(400),
        tags: "t".repeat(20000),
      }),
    );
    expect(clamped.name!.length).toBeLessThanOrEqual(100);
    expect(clamped.parentHostName!.length).toBeLessThanOrEqual(100);
    expect(clamped.tags!.length).toBeLessThanOrEqual(10000);
    expect(clamped.externalId).toBe(resource().externalId);
  });

  test("an empty batch writes nothing", async () => {
    const query: jest.Mock = jest.fn();
    jest
      .spyOn(XcpNgResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    await XcpNgResourceService.bulkUpsert({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      resources: [],
    });
    await XcpNgResourceService.bulkUpsert({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      resources: [resource({ externalId: "" })],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("a big batch goes in chunks of at most 300 rows", async () => {
    const query: jest.Mock = jest.fn(async () => {
      return [];
    });
    jest
      .spyOn(XcpNgResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    await XcpNgResourceService.bulkUpsert({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      resources: Array.from({ length: 650 }, (_: unknown, i: number) => {
        return resource({ externalId: `vm-${i}` });
      }),
    });
    expect(query).toHaveBeenCalledTimes(3);
    const lastParams: Array<unknown> = query.mock
      .calls[2]![1] as Array<unknown>;
    expect(lastParams).toHaveLength(50 * XCP_NG_RESOURCE_UPSERT_COLUMNS.length);
  });
});

describe("XcpNgResourceService prune", () => {
  test("the cutoff is 15 minutes before the pool's own last read", () => {
    const lastRead: Date = new Date("2026-11-24T12:00:00.000Z");
    expect(XcpNgResourceService.getStaleThresholdDate(lastRead)).toEqual(
      new Date("2026-11-24T11:45:00.000Z"),
    );
    expect(XCP_NG_INVENTORY_STALE_MINUTES).toBe(15);
  });

  test("XCP_NG_INVENTORY_STALE_MINUTES moves it, never below 5 minutes", () => {
    const lastRead: Date = new Date("2026-11-24T12:00:00.000Z");
    process.env["XCP_NG_INVENTORY_STALE_MINUTES"] = "30";
    expect(XcpNgResourceService.getStaleThresholdDate(lastRead)).toEqual(
      new Date("2026-11-24T11:30:00.000Z"),
    );
    process.env["XCP_NG_INVENTORY_STALE_MINUTES"] = "1";
    expect(XcpNgResourceService.getStaleThresholdDate(lastRead)).toEqual(
      new Date("2026-11-24T11:45:00.000Z"),
    );
    process.env["XCP_NG_INVENTORY_STALE_MINUTES"] = "soon";
    expect(XcpNgResourceService.getStaleThresholdDate(lastRead)).toEqual(
      new Date("2026-11-24T11:45:00.000Z"),
    );
  });

  test("a pool never read is measured from now", () => {
    const cutoff: Date = XcpNgResourceService.getStaleThresholdDate(undefined);
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(
      15 * 60 * 1000 - 1000,
    );
    expect(
      XcpNgResourceService.getStaleThresholdDate(
        new Date("nonsense"),
      ).getTime(),
    ).not.toBeNaN();
  });

  test("the delete keeps a pool whose every row is stale, and says how many rows went", async () => {
    const query: jest.Mock = jest.fn(async () => {
      return [[], 2];
    });
    jest
      .spyOn(XcpNgResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const cutoff: Date = new Date("2026-11-24T11:45:00.000Z");
    expect(
      await XcpNgResourceService.deleteStaleForPool({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        olderThan: cutoff,
      }),
    ).toBe(2);
    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toMatch(
      /AND EXISTS \(\s*SELECT 1 FROM "XcpNgResource" AS fresh/,
    );
    expect(params).toEqual([PROJECT.toString(), POOL.toString(), cutoff]);
  });
});

describe("XcpNgResourceService reads", () => {
  test("the inventory summary reads its counts, and an empty pool reads zeros", async () => {
    const query: jest.Mock = jest.fn(async () => {
      return [
        {
          hostCount: "3",
          runningHostCount: "2",
          disabledHostCount: "1",
          vmCount: "4",
          runningVmCount: "2",
          storageRepositoryCount: "3",
          vdiCount: "3",
          storageCapacityBytes: "2735894167552",
          storageUsedBytes: null,
        },
      ];
    });
    jest
      .spyOn(XcpNgResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    expect(
      await XcpNgResourceService.getInventorySummary({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
      }),
    ).toEqual({
      hostCount: 3,
      runningHostCount: 2,
      disabledHostCount: 1,
      vmCount: 4,
      runningVmCount: 2,
      storageRepositoryCount: 3,
      vdiCount: 3,
      storageCapacityBytes: 2735894167552,
      storageUsedBytes: 0,
    });
    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`"isControlDomain" IS NOT TRUE`);
    expect(sql).toContain(`NOT IN ('iso', 'disk')`);
    expect(params).toEqual([
      PROJECT.toString(),
      POOL.toString(),
      "Host",
      "VM",
      "StorageRepository",
      "VDI",
    ]);

    query.mockImplementation(async () => {
      return [];
    });
    expect(
      (
        await XcpNgResourceService.getInventorySummary({
          projectId: PROJECT,
          xcpNgPoolId: POOL,
        })
      ).hostCount,
    ).toBe(0);
  });

  test("which VMs ran recently: lower-cased, de-duplicated, a day back", async () => {
    const query: jest.Mock = jest.fn(async () => {
      return [{ externalId: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c" }];
    });
    jest
      .spyOn(XcpNgResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const now: Date = new Date("2026-11-24T12:00:00.000Z");
    const result: Set<string> =
      await XcpNgResourceService.findVmsThatRanRecently({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        vmExternalIds: [
          "E8A5B2C1-3D4E-4F5A-8B6C-7D8E9F0A1B2C",
          "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
          "",
        ],
        now,
      });
    expect(result).toEqual(new Set(["e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c"]));
    const params: Array<unknown> = query.mock.calls[0]![1] as Array<unknown>;
    expect(params[3]).toEqual(["e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c"]);
    expect(params[4]).toEqual(new Date("2026-11-23T12:00:00.000Z"));
  });

  test("no VM asked about, no read", async () => {
    const query: jest.Mock = jest.fn();
    jest
      .spyOn(XcpNgResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    expect(
      await XcpNgResourceService.findVmsThatRanRecently({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        vmExternalIds: [],
        now: new Date(),
      }),
    ).toEqual(new Set());
    expect(query).not.toHaveBeenCalled();
  });
});
