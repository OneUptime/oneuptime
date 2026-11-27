import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import XcpNgResourceService from "../../../Server/Services/XcpNgResourceService";
import { DEFAULT_XCP_NG_POOL_EVENTS_STORE } from "../../../Server/Utils/XcpNg/XcpNgPoolEventsIngest";
import {
  XcpNgPoolEventColumns,
  XcpNgStoredPool,
  XcpNgStoredResource,
  XcpNgVmBackupUpdate,
} from "../../../Server/Utils/XcpNg/XcpNgPoolEventsProcessing";
import { ParsedXcpNgResource } from "../../../Server/Utils/Telemetry/XcpNgSnapshotScan";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import {
  XCP_NG_MAX_PATCHES_PER_HOST,
  XcpNgBackupStatus,
  XcpNgMissingPatch,
} from "../../../Types/XcpNg/XcpNgPoolEvents";
import { XcpNgEventSource } from "../../../Types/XcpNg/XcpNgPoolEventState";
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
 * WHAT A PROBE'S READ OF A POOL BEYOND ITS METRICS WRITES, ON POSTGRES (#10997).
 *
 * The VMs' last backups, how often their jobs back them up, the hosts'
 * missing patches and the pool's HA, master and event state are written
 * with hand-written SQL (an UPDATE ... FROM (VALUES ...) per batch of 200)
 * and a hook-free column update, which only a database can say are right:
 *
 *   - a VM's last backup is written only when it is newer than the row's,
 *     so a run delivered late never undoes a newer one; its last success
 *     only ever moves forward; a VM id in any case lands on its row;
 *   - nothing reaches another pool's, another project's, another kind's or
 *     a deleted row;
 *   - more VMs than one statement carries all land;
 *   - a host's missing patches are replaced by each check, kept to the
 *     first XCP_NG_MAX_PATCHES_PER_HOST;
 *   - what the next collection reads back (findForEvents) is what was
 *     written;
 *   - the pool's columns are written round the service's hooks, a key
 *     left out keeps its value, updatedAt does not move, and the store's
 *     read hands the JSON back as it went in.
 *
 * Opt in with RUN_POSTGRES_XCP_NG_RESOURCE_TESTS=true against a Postgres
 * migrated to the current head (the Postgres Schema Drift workflow's
 * database right after its drift check). The XcpNgResource and XcpNgPool
 * tables' STRUCTURE (indexes included) is cloned into a unique schema that
 * is dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from DATABASE_NAME, endpoint from
 * XCP_NG_RESOURCE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_XCP_NG_RESOURCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const VM_WEB: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const VM_DB: string = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const HOST_A: string = "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function resource(
  kind: XcpNgResourceKind,
  externalId: string,
  name: string,
): ParsedXcpNgResource {
  return {
    kind,
    externalId,
    name,
    powerState: kind === XcpNgResourceKind.VM ? "Running" : null,
    isUp: true,
    isEnabled: kind === XcpNgResourceKind.Host ? true : null,
    isControlDomain: kind === XcpNgResourceKind.VM ? false : null,
    parentHostExternalId: null,
    parentHostName: null,
    storageRepositoryExternalId: null,
    storageRepositoryName: null,
    vmExternalId: null,
    vmName: null,
    uptimeSeconds: null,
    lastRunningAt: null,
    latestCpuPercent: null,
    cpuCount: null,
    runningVcpuCount: null,
    loadAverage: null,
    latestMemoryBytes: null,
    maxMemoryBytes: null,
    latestMemoryPercent: null,
    latestDiskBytes: null,
    maxDiskBytes: null,
    latestDiskPercent: null,
    virtualAllocationBytes: null,
    srType: null,
    contentType: null,
    isShared: null,
    powerWatts: null,
    tags: null,
    lastSeenAt: new Date("2026-11-27T10:00:00.000Z"),
  };
}

function backup(
  vmId: string,
  at: string,
  status: XcpNgBackupStatus,
  extra: Partial<XcpNgVmBackupUpdate> = {},
): XcpNgVmBackupUpdate {
  const isSuccess: boolean = status === XcpNgBackupStatus.Success;
  return {
    vmId,
    lastBackupAt: new Date(at),
    lastBackupStatus: status,
    lastBackupJobName: "Nightly delta",
    lastBackupError: isSuccess ? null : "Remote unreachable",
    lastBackupBytes: isSuccess ? 2147483648 : null,
    lastSuccessfulBackupAt: isSuccess ? new Date(at) : null,
    ...extra,
  };
}

function patches(count: number): Array<XcpNgMissingPatch> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return {
      name: `xcp-ng-update-${index}`,
      version: "8.3.0",
      release: `${index}.xcpng8.3`,
    };
  });
}

describePostgres("XCP-ng pool event writes on Postgres", () => {
  const schema: string = `xcp_ng_events_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const poolId: ObjectID = ObjectID.generate();
  const otherPoolId: ObjectID = ObjectID.generate();

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
    for (const table of ["XcpNgResource", "XcpNgPool"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
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
    await database.query(`TRUNCATE "${schema}"."XcpNgPool"`);

    // The same ids in the pool, in another pool and in another project.
    for (const [project, pool] of [
      [projectId, poolId],
      [projectId, otherPoolId],
      [otherProjectId, poolId],
    ] as Array<[ObjectID, ObjectID]>) {
      await XcpNgResourceService.bulkUpsert({
        projectId: project,
        xcpNgPoolId: pool,
        resources: [
          resource(XcpNgResourceKind.VM, VM_WEB, "web01"),
          resource(XcpNgResourceKind.VM, VM_DB, "db01"),
          resource(XcpNgResourceKind.Host, HOST_A, "xcp-host-a"),
        ],
      });
    }
  });

  async function vmRow(
    externalId: string,
    pool: ObjectID = poolId,
    project: ObjectID = projectId,
  ): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "XcpNgResource" WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "kind" = $3 AND "externalId" = $4`,
      [project.toString(), pool.toString(), XcpNgResourceKind.VM, externalId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function hostRow(
    pool: ObjectID = poolId,
  ): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "XcpNgResource" WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "kind" = $3`,
      [projectId.toString(), pool.toString(), XcpNgResourceKind.Host],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function writeBackups(
    updates: Array<XcpNgVmBackupUpdate>,
  ): Promise<void> {
    await XcpNgResourceService.applyVmBackups({
      projectId,
      xcpNgPoolId: poolId,
      updates,
    });
  }

  test("a VM's last backup lands on its row, and only its row", async () => {
    await writeBackups([
      backup(
        VM_WEB.toUpperCase(),
        "2026-11-27T02:00:00.000Z",
        XcpNgBackupStatus.Success,
      ),
    ]);

    const web: Record<string, unknown> = await vmRow(VM_WEB);
    expect((web["lastBackupAt"] as Date).toISOString()).toBe(
      "2026-11-27T02:00:00.000Z",
    );
    expect(web["lastBackupStatus"]).toBe(XcpNgBackupStatus.Success);
    expect(web["lastBackupJobName"]).toBe("Nightly delta");
    expect(web["lastBackupError"]).toBeNull();
    expect(String(web["lastBackupBytes"])).toBe("2147483648");
    expect((web["lastSuccessfulBackupAt"] as Date).toISOString()).toBe(
      "2026-11-27T02:00:00.000Z",
    );

    // The other VM, the same VM in another pool or project, untouched.
    expect((await vmRow(VM_DB))["lastBackupAt"]).toBeNull();
    expect((await vmRow(VM_WEB, otherPoolId))["lastBackupAt"]).toBeNull();
    expect(
      (await vmRow(VM_WEB, poolId, otherProjectId))["lastBackupAt"],
    ).toBeNull();
  });

  test("a run delivered late never undoes a newer one, and the last success only moves forward", async () => {
    await writeBackups([
      backup(VM_WEB, "2026-11-27T02:00:00.000Z", XcpNgBackupStatus.Success),
    ]);
    await writeBackups([
      backup(VM_WEB, "2026-11-28T02:00:00.000Z", XcpNgBackupStatus.Failure),
    ]);
    // Yesterday's run, read again after today's.
    await writeBackups([
      backup(VM_WEB, "2026-11-26T02:00:00.000Z", XcpNgBackupStatus.Success),
    ]);

    const web: Record<string, unknown> = await vmRow(VM_WEB);
    expect((web["lastBackupAt"] as Date).toISOString()).toBe(
      "2026-11-28T02:00:00.000Z",
    );
    expect(web["lastBackupStatus"]).toBe(XcpNgBackupStatus.Failure);
    expect(web["lastBackupError"]).toBe("Remote unreachable");
    expect(web["lastBackupBytes"]).toBeNull();
    expect((web["lastSuccessfulBackupAt"] as Date).toISOString()).toBe(
      "2026-11-27T02:00:00.000Z",
    );
  });

  test("two runs of one VM in a read: the newest is its last backup, the newest success its last success", async () => {
    await writeBackups([
      backup(VM_DB, "2026-11-27T01:00:00.000Z", XcpNgBackupStatus.Success),
      backup(VM_DB, "2026-11-27T03:00:00.000Z", XcpNgBackupStatus.Skipped, {
        lastBackupError: "unhealthy VDI chain",
      }),
    ]);

    const db: Record<string, unknown> = await vmRow(VM_DB);
    expect((db["lastBackupAt"] as Date).toISOString()).toBe(
      "2026-11-27T03:00:00.000Z",
    );
    expect(db["lastBackupStatus"]).toBe(XcpNgBackupStatus.Skipped);
    expect(db["lastBackupError"]).toBe("unhealthy VDI chain");
    expect((db["lastSuccessfulBackupAt"] as Date).toISOString()).toBe(
      "2026-11-27T01:00:00.000Z",
    );
  });

  test("a deleted VM's row is never written", async () => {
    await database.query(
      `UPDATE "XcpNgResource" SET "deletedAt" = now() WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "externalId" = $3`,
      [projectId.toString(), poolId.toString(), VM_DB],
    );
    await writeBackups([
      backup(VM_DB, "2026-11-27T02:00:00.000Z", XcpNgBackupStatus.Success),
    ]);

    expect((await vmRow(VM_DB))["lastBackupAt"]).toBeNull();
    expect((await vmRow(VM_DB))["lastSuccessfulBackupAt"]).toBeNull();
  });

  test("more VMs than one statement carries all land, and a long error is cut to fit", async () => {
    const many: Array<ParsedXcpNgResource> = Array.from(
      { length: 450 },
      (_: unknown, index: number): ParsedXcpNgResource => {
        return resource(
          XcpNgResourceKind.VM,
          `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          `vm-${index}`,
        );
      },
    );
    await XcpNgResourceService.bulkUpsert({
      projectId,
      xcpNgPoolId: poolId,
      resources: many,
    });

    await writeBackups(
      many.map((vm: ParsedXcpNgResource): XcpNgVmBackupUpdate => {
        return backup(
          vm.externalId,
          "2026-11-27T04:00:00.000Z",
          XcpNgBackupStatus.Failure,
          { lastBackupError: "x".repeat(20000) },
        );
      }),
    );

    const written: Array<Record<string, unknown>> = await database.query(
      `SELECT count(*)::int AS "count", max(length("lastBackupError"))::int AS "longest"
       FROM "XcpNgResource"
       WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "lastBackupAt" IS NOT NULL`,
      [projectId.toString(), poolId.toString()],
    );
    expect(written[0]!["count"]).toBe(450);
    expect(written[0]!["longest"] as number).toBeLessThan(20000);
  });

  test("how often each VM is backed up is set, and cleared once no scheduled job backs it up", async () => {
    await XcpNgResourceService.applyVmBackupIntervals({
      projectId,
      xcpNgPoolId: poolId,
      updates: [
        { vmId: VM_WEB, intervalSeconds: 86400 },
        { vmId: VM_DB.toUpperCase(), intervalSeconds: 3600.7 },
      ],
    });
    expect((await vmRow(VM_WEB))["backupIntervalSeconds"]).toBe(86400);
    expect((await vmRow(VM_DB))["backupIntervalSeconds"]).toBe(3600);
    expect(
      (await vmRow(VM_WEB, otherPoolId))["backupIntervalSeconds"],
    ).toBeNull();

    await XcpNgResourceService.applyVmBackupIntervals({
      projectId,
      xcpNgPoolId: poolId,
      updates: [{ vmId: VM_WEB, intervalSeconds: null }],
    });
    expect((await vmRow(VM_WEB))["backupIntervalSeconds"]).toBeNull();
    expect((await vmRow(VM_DB))["backupIntervalSeconds"]).toBe(3600);
  });

  test("a host's missing patches are replaced by each check, kept to the most a row holds", async () => {
    await XcpNgResourceService.applyHostPatches({
      projectId,
      xcpNgPoolId: poolId,
      hosts: [
        {
          hostId: HOST_A.toUpperCase(),
          patchCount: XCP_NG_MAX_PATCHES_PER_HOST + 50,
          patches: patches(XCP_NG_MAX_PATCHES_PER_HOST + 50),
        },
      ],
    });
    let host: Record<string, unknown> = await hostRow();
    expect(host["missingPatchCount"]).toBe(XCP_NG_MAX_PATCHES_PER_HOST + 50);
    expect(host["missingPatches"] as Array<unknown>).toHaveLength(
      XCP_NG_MAX_PATCHES_PER_HOST,
    );
    expect((host["missingPatches"] as Array<XcpNgMissingPatch>)[0]).toEqual({
      name: "xcp-ng-update-0",
      version: "8.3.0",
      release: "0.xcpng8.3",
    });
    // A VM row with the host's id would never be written: the kind is part of the match.
    expect((await hostRow(otherPoolId))["missingPatchCount"]).toBeNull();

    // Installed since: the next check lists two.
    await XcpNgResourceService.applyHostPatches({
      projectId,
      xcpNgPoolId: poolId,
      hosts: [{ hostId: HOST_A, patchCount: 2, patches: patches(2) }],
    });
    host = await hostRow();
    expect(host["missingPatchCount"]).toBe(2);
    expect(host["missingPatches"] as Array<unknown>).toHaveLength(2);
  });

  test("the next collection reads back what was written", async () => {
    await writeBackups([
      backup(VM_WEB, "2026-11-27T02:00:00.000Z", XcpNgBackupStatus.Success),
    ]);
    await XcpNgResourceService.applyVmBackupIntervals({
      projectId,
      xcpNgPoolId: poolId,
      updates: [{ vmId: VM_WEB, intervalSeconds: 86400 }],
    });
    await XcpNgResourceService.applyHostPatches({
      projectId,
      xcpNgPoolId: poolId,
      hosts: [{ hostId: HOST_A, patchCount: 3, patches: patches(3) }],
    });

    const read: Array<XcpNgStoredResource> =
      await DEFAULT_XCP_NG_POOL_EVENTS_STORE.readInventory({
        projectId,
        xcpNgPoolId: poolId,
      });
    const web: XcpNgStoredResource | undefined = read.find(
      (row: XcpNgStoredResource): boolean => {
        return row.externalId === VM_WEB;
      },
    );
    const hostA: XcpNgStoredResource | undefined = read.find(
      (row: XcpNgStoredResource): boolean => {
        return row.externalId === HOST_A;
      },
    );

    expect(read).toHaveLength(3);
    expect(web?.kind).toBe(XcpNgResourceKind.VM);
    expect(web?.name).toBe("web01");
    expect(web?.lastSuccessfulBackupAt?.toISOString()).toBe(
      "2026-11-27T02:00:00.000Z",
    );
    expect(web?.backupIntervalSeconds).toBe(86400);
    expect(web?.isControlDomain).toBe(false);
    expect(hostA?.missingPatchCount).toBe(3);
    expect(hostA?.isEnabled).toBe(true);
  });

  test("the pool's columns are written round the hooks, a key left out keeps its value, and the store reads the JSON back", async () => {
    await database.query(
      `INSERT INTO "XcpNgPool" ("_id", "projectId", "name", "slug", "poolIdentifier", "version", "updatedAt")
       VALUES ($1, $2, 'Production', 'production', $3, 1, '2026-11-01T00:00:00.000Z')`,
      [
        poolId.toString(),
        projectId.toString(),
        "b7c1e2d3-0a4f-4b5c-9d8e-7f6a5b4c3d2e",
      ],
    );
    const columns: XcpNgPoolEventColumns = {
      isHaEnabled: true,
      haHostFailuresToTolerate: 1,
      haPlanExistsFor: 1,
      isHaOvercommitted: false,
      masterHostExternalId: HOST_A,
      eventsReadAt: new Date("2026-11-27T10:00:00.000Z"),
      backupsReadAt: new Date("2026-11-27T10:00:00.000Z"),
      eventReadStatus: {
        source: XcpNgEventSource.XenOrchestra,
        problems: {},
        backupsWatchedSince: "2026-11-20T10:00:00.000Z",
      },
      backupJobs: [
        {
          jobId: "job-nightly",
          name: "Nightly delta",
          mode: "delta",
          isScheduled: true,
          intervalSeconds: 86400,
          runs: [],
          vmCount: 2,
          lastSuccessAt: "2026-11-27T02:00:00.000Z",
        },
      ],
      eventState: {
        openMessages: [],
        backupsWatchedSince: "2026-11-20T10:00:00.000Z",
        jobVmIds: { "job-nightly": [VM_WEB, VM_DB] },
      },
    };
    await DEFAULT_XCP_NG_POOL_EVENTS_STORE.writePool({
      xcpNgPoolId: poolId,
      columns,
    });

    // The next read: HA unread this time, so its keys are left out.
    await DEFAULT_XCP_NG_POOL_EVENTS_STORE.writePool({
      xcpNgPoolId: poolId,
      columns: {
        eventsReadAt: new Date("2026-11-27T10:01:00.000Z"),
        eventReadStatus: {
          source: XcpNgEventSource.XenOrchestra,
          problems: { messages: "Xen Orchestra did not answer in time." },
        },
        eventState: { openMessages: [] },
      },
    });

    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "XcpNgPool" WHERE "_id" = $1`,
      [poolId.toString()],
    );
    const pool: Record<string, unknown> = rows[0]!;
    expect(pool["isHaEnabled"]).toBe(true);
    expect(pool["haHostFailuresToTolerate"]).toBe(1);
    expect(pool["masterHostExternalId"]).toBe(HOST_A);
    expect((pool["eventsReadAt"] as Date).toISOString()).toBe(
      "2026-11-27T10:01:00.000Z",
    );
    expect((pool["backupsReadAt"] as Date).toISOString()).toBe(
      "2026-11-27T10:00:00.000Z",
    );
    expect(pool["eventReadStatus"]).toEqual({
      source: XcpNgEventSource.XenOrchestra,
      problems: { messages: "Xen Orchestra did not answer in time." },
    });
    // Written every minute by OneUptime itself: the row's updatedAt stays.
    expect((pool["updatedAt"] as Date).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );

    const stored: Array<XcpNgStoredPool> =
      await DEFAULT_XCP_NG_POOL_EVENTS_STORE.readPools({
        projectId,
        xcpNgPoolIds: [poolId],
      });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.isHaEnabled).toBe(true);
    expect(stored[0]!.backupJobs).toEqual(columns.backupJobs);
    expect(stored[0]!.eventState).toEqual({ openMessages: [] });

    // Another project's ids read nothing.
    expect(
      await DEFAULT_XCP_NG_POOL_EVENTS_STORE.readPools({
        projectId: otherProjectId,
        xcpNgPoolIds: [poolId],
      }),
    ).toEqual([]);
  });
});
