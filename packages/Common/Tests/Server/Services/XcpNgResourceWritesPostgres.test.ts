import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import XcpNgResourceService, {
  XcpNgInventorySummary,
} from "../../../Server/Services/XcpNgResourceService";
import {
  ParsedXcpNgResource,
  XcpNgPoolResourceBuffer,
  XcpNgPoolSnapshotBufferEntry,
  bufferXcpNgSnapshotMetric,
  getXcpNgResourceRows,
} from "../../../Server/Utils/Telemetry/XcpNgSnapshotScan";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import { JSONObject } from "../../../Types/JSON";
import {
  PRODUCTION_POOL_ID,
  SCRAPE_1_NOW_SECONDS,
  SCRAPE_2_NOW_SECONDS,
  UNNAMED_POOL_ID,
  getDatapoints,
  getResourceOfPool,
  parseOpenMetrics,
  readRecordedScrape,
  toAgentResourceMetrics,
} from "../Utils/Telemetry/XcpNgScrapeFixture";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * WHAT THE XCP-NG INVENTORY WRITES TO "XcpNgResource", ON POSTGRES.
 *
 * XcpNgResourceService writes its rows with hand-written SQL (an upsert of
 * every column, an aggregate of the pool's counts, the prune, the "ran in
 * the last day" read), which only a database can say is right. This folds
 * the recorded Xen Orchestra scrapes (two pools, Fixtures/XcpNg) the way
 * the metrics ingest does and runs the service's own statements:
 *
 *   - the recorded lab lands as rows, and the pool's counts and capacity
 *     read back exactly (control domains and ISO libraries left out);
 *   - a minute later, a VM shut down keeps when it last ran, a VM started
 *     gets its host, and nothing regresses when an older batch arrives
 *     late; a disk detached stops naming its VM; a name is never blanked;
 *   - the prune takes only what stopped being reported, never a whole pool;
 *   - which stopped VMs ran in the last day.
 *
 * Opt in with RUN_POSTGRES_XCP_NG_RESOURCE_TESTS=true against a Postgres
 * migrated to the current head (the Postgres Schema Drift workflow's
 * database right after its drift check). The XcpNgResource table's
 * STRUCTURE (indexes included) is cloned into a unique schema that is
 * dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from DATABASE_NAME, endpoint from
 * XCP_NG_RESOURCE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_XCP_NG_RESOURCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const GiB: number = 1024 * 1024 * 1024;

const VM_WEB01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const VM_APP02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const VM_WIN03: string = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";
const VDI_ORPHAN: string = "cc33dd44-ee55-4f66-8077-118899001122";
const VDI_WEB01: string = "aa11bb22-cc33-4d44-8e55-ff6677889900";

function labRows(scrape: 1 | 2, poolId: string): Array<ParsedXcpNgResource> {
  const resourceBuffer: Map<string, XcpNgPoolResourceBuffer> = new Map();
  const poolBuffer: Map<string, XcpNgPoolSnapshotBufferEntry> = new Map();
  const envelope: JSONObject = getResourceOfPool(
    toAgentResourceMetrics(parseOpenMetrics(readRecordedScrape(scrape)), {
      scrapeSeconds: scrape === 1 ? SCRAPE_1_NOW_SECONDS : SCRAPE_2_NOW_SECONDS,
    }),
    poolId,
  );
  for (const { metricName, datapoint } of getDatapoints(envelope)) {
    bufferXcpNgSnapshotMetric({
      poolIdStr: poolId,
      metricName,
      datapoint,
      resourceBuffer,
      poolBuffer,
    });
  }
  return getXcpNgResourceRows(resourceBuffer.get(poolId));
}

describePostgres("XcpNgResourceService on Postgres", () => {
  const schema: string = `xcp_ng_resource_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  const projectId: ObjectID = ObjectID.generate();
  const productionPool: ObjectID = ObjectID.generate();
  const unnamedPool: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["XCP_NG_RESOURCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["XCP_NG_RESOURCE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
        max: 1,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."XcpNgResource" (LIKE public."XcpNgResource" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`TRUNCATE "${schema}"."XcpNgResource"`);
  });

  async function upsert(
    scrape: 1 | 2,
    pool: ObjectID = productionPool,
    poolUuid: string = PRODUCTION_POOL_ID,
  ): Promise<void> {
    await XcpNgResourceService.bulkUpsert({
      projectId,
      xcpNgPoolId: pool,
      resources: labRows(scrape, poolUuid),
    });
  }

  async function row(
    kind: XcpNgResourceKind,
    externalId: string,
  ): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."XcpNgResource" WHERE "kind" = $1 AND "externalId" = $2`,
      [kind, externalId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  test("the recorded lab lands as rows, and the pool's counts read back", async () => {
    await upsert(1);
    const summary: XcpNgInventorySummary =
      await XcpNgResourceService.getInventorySummary({
        projectId,
        xcpNgPoolId: productionPool,
      });
    expect(summary).toEqual({
      hostCount: 3,
      runningHostCount: 2,
      disabledHostCount: 1,
      // web-01, db-01, app-02, win-03: control domains left out.
      vmCount: 4,
      runningVmCount: 2,
      storageRepositoryCount: 3,
      vdiCount: 3,
      // The local and NFS repositories; the ISO library holds no VM disk.
      storageCapacityBytes: 500 * GiB + 2048 * GiB,
      storageUsedBytes: 120 * GiB + Math.round(1894.4 * GiB),
    });
  });

  test("columns are written as the scan folded them", async () => {
    await upsert(1);
    const web: Record<string, unknown> = await row(
      XcpNgResourceKind.VM,
      VM_WEB01,
    );
    expect(web["name"]).toBe("web-01");
    expect(web["powerState"]).toBe("Running");
    expect(web["isUp"]).toBe(true);
    expect(web["isControlDomain"]).toBe(false);
    expect(web["tags"]).toBe("production,web");
    expect(Number(web["maxMemoryBytes"])).toBe(4 * GiB);
    expect(Number(web["latestCpuPercent"])).toBe(24);
    expect(new Date(web["lastRunningAt"] as string).getTime()).toBe(
      SCRAPE_1_NOW_SECONDS * 1000,
    );
  });

  test("a minute later: the VM shut down keeps when it last ran, the VM started gets its host", async () => {
    await upsert(1);
    await upsert(2);
    const web: Record<string, unknown> = await row(
      XcpNgResourceKind.VM,
      VM_WEB01,
    );
    expect(web["powerState"]).toBe("Halted");
    expect(web["isUp"]).toBe(false);
    expect(new Date(web["lastRunningAt"] as string).getTime()).toBe(
      SCRAPE_1_NOW_SECONDS * 1000,
    );
    // Its last host stays known while it is halted.
    expect(web["parentHostExternalId"]).toBe(
      "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
    );

    const app: Record<string, unknown> = await row(
      XcpNgResourceKind.VM,
      VM_APP02,
    );
    expect(app["powerState"]).toBe("Running");
    expect(app["parentHostExternalId"]).toBe(
      "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
    );
    expect(new Date(app["lastRunningAt"] as string).getTime()).toBe(
      SCRAPE_2_NOW_SECONDS * 1000,
    );

    const summary: XcpNgInventorySummary =
      await XcpNgResourceService.getInventorySummary({
        projectId,
        xcpNgPoolId: productionPool,
      });
    expect(summary.runningVmCount).toBe(2);
    // The deleted disk is still a row until the prune takes it.
    expect(summary.vdiCount).toBe(3);
  });

  test("an older batch arriving late never regresses a newer one", async () => {
    await upsert(2);
    await upsert(1);
    const web: Record<string, unknown> = await row(
      XcpNgResourceKind.VM,
      VM_WEB01,
    );
    expect(web["powerState"]).toBe("Halted");
  });

  test("a batch without a name never blanks it, and a disk detached stops naming its VM", async () => {
    await upsert(1);
    await XcpNgResourceService.bulkUpsert({
      projectId,
      xcpNgPoolId: productionPool,
      resources: [
        {
          ...labRows(1, PRODUCTION_POOL_ID).find((r: ParsedXcpNgResource) => {
            return r.externalId === VDI_WEB01;
          })!,
          name: null,
          vmExternalId: null,
          vmName: null,
          lastSeenAt: new Date(SCRAPE_2_NOW_SECONDS * 1000),
        },
      ],
    });
    const vdi: Record<string, unknown> = await row(
      XcpNgResourceKind.VDI,
      VDI_WEB01,
    );
    expect(vdi["name"]).toBe("web-01 system");
    expect(vdi["vmExternalId"]).toBe(null);
    expect(vdi["vmName"]).toBe(null);
  });

  test("the prune takes only what stopped being reported", async () => {
    await upsert(1);
    /*
     * Twenty minutes of scrapes later, everything but the deleted disk is
     * still reported. Xen Orchestra stamps its RRD series with the RRD's own
     * clock, a minute or two behind its status series, so a control domain
     * (RRD series only) always looks a little older than its neighbours:
     * the 15-minute cutoff, anchored on the pool's last read, leaves it be.
     */
    const twentyMinutesMs: number = 20 * 60 * 1000;
    await XcpNgResourceService.bulkUpsert({
      projectId,
      xcpNgPoolId: productionPool,
      resources: labRows(2, PRODUCTION_POOL_ID).map(
        (r: ParsedXcpNgResource) => {
          return {
            ...r,
            lastSeenAt: new Date(r.lastSeenAt.getTime() + twentyMinutesMs),
          };
        },
      ),
    });
    const deleted: number = await XcpNgResourceService.deleteStaleForPool({
      projectId,
      xcpNgPoolId: productionPool,
      olderThan: XcpNgResourceService.getStaleThresholdDate(
        new Date(SCRAPE_2_NOW_SECONDS * 1000 + twentyMinutesMs),
      ),
    });
    expect(deleted).toBe(1);
    const left: Array<{ externalId: string }> = await database.query(
      `SELECT "externalId" FROM "${schema}"."XcpNgResource" WHERE "externalId" = $1`,
      [VDI_ORPHAN],
    );
    expect(left).toHaveLength(0);
  });

  test("the prune never takes a whole pool at once", async () => {
    await upsert(1);
    const deleted: number = await XcpNgResourceService.deleteStaleForPool({
      projectId,
      xcpNgPoolId: productionPool,
      olderThan: new Date(SCRAPE_2_NOW_SECONDS * 1000 + 3600 * 1000),
    });
    expect(deleted).toBe(0);
    const summary: XcpNgInventorySummary =
      await XcpNgResourceService.getInventorySummary({
        projectId,
        xcpNgPoolId: productionPool,
      });
    expect(summary.hostCount).toBe(3);
  });

  test("the prune of one pool never touches another", async () => {
    await upsert(1);
    await upsert(1, unnamedPool, UNNAMED_POOL_ID);
    await upsert(2);
    await XcpNgResourceService.deleteStaleForPool({
      projectId,
      xcpNgPoolId: productionPool,
      olderThan: new Date(SCRAPE_2_NOW_SECONDS * 1000 + 3600 * 1000),
    });
    const unnamed: XcpNgInventorySummary =
      await XcpNgResourceService.getInventorySummary({
        projectId,
        xcpNgPoolId: unnamedPool,
      });
    expect(unnamed).toEqual({
      hostCount: 1,
      runningHostCount: 1,
      disabledHostCount: 0,
      vmCount: 1,
      runningVmCount: 1,
      storageRepositoryCount: 1,
      vdiCount: 1,
      storageCapacityBytes: 250 * GiB,
      storageUsedBytes: 40 * GiB,
    });
  });

  test("which stopped VMs ran in the last day", async () => {
    await upsert(1);
    await upsert(2);
    expect(
      await XcpNgResourceService.findVmsThatRanRecently({
        projectId,
        xcpNgPoolId: productionPool,
        vmExternalIds: [VM_WEB01.toUpperCase(), VM_APP02, VM_WIN03],
        now: new Date(SCRAPE_2_NOW_SECONDS * 1000),
      }),
    ).toEqual(new Set([VM_WEB01, VM_APP02]));
    expect(
      await XcpNgResourceService.findVmsThatRanRecently({
        projectId,
        xcpNgPoolId: productionPool,
        vmExternalIds: [VM_WEB01],
        now: new Date(SCRAPE_1_NOW_SECONDS * 1000 + 25 * 3600 * 1000),
      }),
    ).toEqual(new Set());
    expect(
      await XcpNgResourceService.findVmsThatRanRecently({
        projectId,
        xcpNgPoolId: productionPool,
        vmExternalIds: [],
        now: new Date(SCRAPE_2_NOW_SECONDS * 1000),
      }),
    ).toEqual(new Set());
  });

  test("an oversized name is clamped, and the rest of the batch still lands", async () => {
    const rows: Array<ParsedXcpNgResource> = labRows(1, PRODUCTION_POOL_ID);
    rows[0] = { ...rows[0]!, name: "x".repeat(500) };
    await XcpNgResourceService.bulkUpsert({
      projectId,
      xcpNgPoolId: productionPool,
      resources: rows,
    });
    const count: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*) AS count FROM "${schema}"."XcpNgResource"`,
    );
    expect(Number(count[0]!.count)).toBe(rows.length);
  });

  test("a big pool upserts in chunks", async () => {
    const template: ParsedXcpNgResource = labRows(1, PRODUCTION_POOL_ID).find(
      (r: ParsedXcpNgResource) => {
        return r.kind === XcpNgResourceKind.VDI;
      },
    )!;
    const many: Array<ParsedXcpNgResource> = Array.from(
      { length: 1234 },
      (_: unknown, i: number) => {
        return {
          ...template,
          externalId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        };
      },
    );
    await XcpNgResourceService.bulkUpsert({
      projectId,
      xcpNgPoolId: productionPool,
      resources: many,
    });
    const summary: XcpNgInventorySummary =
      await XcpNgResourceService.getInventorySummary({
        projectId,
        xcpNgPoolId: productionPool,
      });
    expect(summary.vdiCount).toBe(1234);
  });
});
