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
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import OpenStackResourceService, {
  ParsedOpenStackResource,
} from "Common/Server/Services/OpenStackResourceService";
import logger from "Common/Server/Utils/Logger";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackInstanceMetricsMode } from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OpenStackCollectionJob,
  OpenStackCollectionReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_ROLLING_BYTES_PER_DATAPOINT,
  OpenStackCloudCounts,
  getOpenStackCountsOfSize,
  getOpenStackRollingDatapoints,
} from "Common/Types/OpenStack/OpenStackScale";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import { splitOpenStackReport } from "../../../Utils/OpenStack/OpenStackReportParts";
import {
  FakeClock,
  ReportedDatapoint,
  collectionJob,
  createCollectorHarness,
  createFakeClock,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  OpenStackInventoryModel,
  OpenStackTestInventory,
  foldOpenStackUpload,
  toOpenStackInventoryRow,
} from "./Helpers/InventoryFold";
import MockOpenStackCloud, {
  MOCK_AUTH_URL,
} from "./Helpers/MockOpenStackCloud";

/*
 * A PART THAT IS STILL REPORTED IS NEVER DELETED, OVER THE WHOLE LIFE OF A CLOUD.
 *
 * The real collector reads a mock API, the real fold reads what it uploads, and the stale-row rule
 * runs in the worst order there is: each upload's `up` lands and the sweep runs before that
 * upload's rows do. So every scene asks one thing of a cloud past the summary size, whose unchanged
 * parts go in turns: whatever happens to it, nothing alive leaves the inventory, and what really
 * went does leave, in the time the docs state.
 *
 * Each scene is a few hundred instances standing for a cloud past the line, so they take moments.
 * A larger cloud differs only in how many, and OpenStackScaleBudget and the soak hold those. In CI
 * these run on a model of the two statements of SQL they rest on (OpenStackInventoryModel), which
 * OpenStackScalePostgres holds to the SQL itself. To run them on Postgres:
 *
 *   RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true OPENSTACK_INVENTORY_TEST_DATABASE_HOST=127.0.0.1 \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_PORT=5400 OPENSTACK_INVENTORY_TEST_DATABASE_NAME=oneuptimedb \
 *   DATABASE_PASSWORD=... node_modules/.bin/jest --runInBand \
 *     Tests/Utils/OpenStack/OpenStackStaleRowsLifecycle.test.ts --forceExit
 */

const INTERVAL_IN_MINUTES: number = 2;
const MINUTE_IN_MS: number = 60_000;
const WINDOW_IN_MINUTES: number = 15;

const COUNTS: OpenStackCloudCounts = getOpenStackCountsOfSize({
  hypervisors: 3,
  instances: 150,
  projects: 30,
});

// All of it past the line, and in as many turns as a scene asks.
const SUMMARY_LIMIT: number = 100;

function rollingBytesFor(counts: OpenStackCloudCounts, turns: number): number {
  return (
    (getOpenStackRollingDatapoints(counts) *
      OPENSTACK_ROLLING_BYTES_PER_DATAPOINT) /
    turns
  );
}

const IN_TURNS: ReadonlyArray<OpenStackResourceKind> = [
  OpenStackResourceKind.Instance,
  OpenStackResourceKind.Volume,
  OpenStackResourceKind.Snapshot,
  OpenStackResourceKind.Backup,
  OpenStackResourceKind.Network,
  OpenStackResourceKind.Subnet,
  OpenStackResourceKind.Router,
  OpenStackResourceKind.FloatingIp,
  OpenStackResourceKind.Image,
  OpenStackResourceKind.Project,
];

function countOfKind(
  counts: OpenStackCloudCounts,
  kind: OpenStackResourceKind,
): number {
  switch (kind) {
    case OpenStackResourceKind.Instance:
      return counts.instances;
    case OpenStackResourceKind.Volume:
      return counts.volumes;
    case OpenStackResourceKind.Snapshot:
      return counts.snapshots;
    case OpenStackResourceKind.Backup:
      return counts.backups;
    case OpenStackResourceKind.Network:
      return counts.networks;
    case OpenStackResourceKind.Subnet:
      return counts.subnets;
    case OpenStackResourceKind.Router:
      return counts.routers;
    case OpenStackResourceKind.FloatingIp:
      return counts.floatingIps;
    case OpenStackResourceKind.Image:
      return counts.images;
    default:
      return counts.projects;
  }
}

interface Scene {
  cloud: MockOpenStackCloud;
  clock: FakeClock;
  job: OpenStackCollectionJob;
  memory: OpenStackCollectorMemory;
  inventory: OpenStackTestInventory;
  counts: OpenStackCloudCounts;
  deleted: number;
  maxPayloadBytes?: number | undefined;
  rollingBytes: number;
  failing: Set<OpenStackServiceType>;
  // The kinds' rows as they stood at the last collection's end.
  reports: Array<OpenStackCollectionReport>;
}

function sceneOf(
  inventory: OpenStackTestInventory,
  data: {
    turns?: number | undefined;
    counts?: OpenStackCloudCounts | undefined;
    job?: Partial<OpenStackCollectionJob> | undefined;
    maxPayloadBytes?: number | undefined;
  } = {},
): Scene {
  const counts: OpenStackCloudCounts = data.counts || COUNTS;
  const clock: FakeClock = createFakeClock(
    // Close to now, because Postgres' own rules take the date as given.
    Date.parse("2026-11-04T12:00:00.000Z"),
  );
  const failing: Set<OpenStackServiceType> = new Set();
  const cloud: MockOpenStackCloud = new MockOpenStackCloud({
    counts: counts,
    clock: clock,
    answer: (
      _request: unknown,
      service: OpenStackServiceType,
    ): { status: number; headers: JSONObject; body: string } | undefined => {
      return failing.has(service)
        ? { status: 500, headers: {}, body: "" }
        : undefined;
    },
  } as never);

  return {
    cloud,
    clock,
    counts,
    failing,
    inventory,
    job: collectionJob({
      authUrl: MOCK_AUTH_URL,
      collectionIntervalInMinutes: INTERVAL_IN_MINUTES,
      ...data.job,
    }),
    memory: new OpenStackCollectorMemory(),
    deleted: 0,
    maxPayloadBytes: data.maxPayloadBytes,
    rollingBytes: rollingBytesFor(counts, data.turns ?? 6),
    reports: [],
  };
}

async function collectAndLand(scene: Scene): Promise<OpenStackCollectionReport> {
  const startedAt: number = scene.clock.now();
  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    scene.job,
    createCollectorHarness({
      transport: scene.cloud.transport,
      clock: scene.clock,
      memory: scene.memory,
      overrides: {
        summaryModeInstanceLimit: SUMMARY_LIMIT,
        rollingBytesPerCollection: scene.rollingBytes,
        maxPayloadBytes: scene.maxPayloadBytes,
      },
    }).dependencies,
  );

  for (const part of splitOpenStackReport(report)) {
    const entries: Array<OpenStackResourceBufferEntry> =
      foldOpenStackUpload(part);
    const toRows: (kept: boolean) => Array<ParsedOpenStackResource> = (
      apis: boolean,
    ): Array<ParsedOpenStackResource> => {
      return entries
        .filter((entry: OpenStackResourceBufferEntry): boolean => {
          return (entry.kind === OpenStackResourceKind.Api) === apis;
        })
        .map(toOpenStackInventoryRow);
    };

    await scene.inventory.write(toRows(true));
    scene.deleted += await scene.inventory.sweep();
    await scene.inventory.write(toRows(false));
    scene.deleted += await scene.inventory.sweep();
  }

  scene.reports.push(report);
  scene.clock.advance(
    Math.max(
      0,
      startedAt + INTERVAL_IN_MINUTES * MINUTE_IN_MS - scene.clock.now(),
    ),
  );

  return report;
}

async function collectFor(scene: Scene, collections: number): Promise<void> {
  for (let collection: number = 0; collection < collections; collection++) {
    await collectAndLand(scene);
  }
}

// What the inventory holds of each kind, against what the cloud does.
async function expectEverythingThere(scene: Scene): Promise<void> {
  for (const kind of IN_TURNS) {
    expect({
      kind,
      rows: (await scene.inventory.externalIdsOf(kind)).length,
    }).toEqual({ kind, rows: countOfKind(scene.counts, kind) });
  }
}

const describeOnPostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

function lifecycleScenes(newInventory: () => OpenStackTestInventory): void {
  test("the first cycle fills the lists a share at a time, says so, and takes nothing", async () => {
    const scene: Scene = sceneOf(newInventory());

    const first: OpenStackCollectionReport = await collectAndLand(scene);

    // The collection read all of it, and says so, however little of it has gone yet.
    expect(first.summary?.instanceCount).toBe(COUNTS.instances);
    expect(first.summary?.isSummaryMode).toBe(true);
    expect(first.summary?.refreshCycleInMinutes).toBe(12);
    expect(first.summary?.firstCycleEndsAt).toBe(
      new Date(Date.parse(first.collectedAt) + 12 * MINUTE_IN_MS).toISOString(),
    );

    const afterOne: number = (
      await scene.inventory.externalIdsOf(OpenStackResourceKind.Instance)
    ).length;

    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(COUNTS.instances / 2);

    await collectFor(scene, 4);

    const fifth: OpenStackCollectionReport = await collectAndLand(scene);

    expect(fifth.summary?.firstCycleEndsAt).toBeDefined();

    // A cycle, and what Keystone and Glance's slower reads wait for theirs.
    const after: OpenStackCollectionReport = await collectAndLand(scene);

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
    expect(after.summary?.firstCycleEndsAt).toBeUndefined();
  });

  test("nothing goes while nothing happens, for many cycles, whatever each service's cadence", async () => {
    // An even number of turns is what used to lose half of Keystone's and Glance's, which are read every second collection.
    for (const turns of [2, 3, 4, 6]) {
      const scene: Scene = sceneOf(newInventory(), { turns: turns });

      await collectFor(scene, turns * 5 + 8);

      await expectEverythingThere(scene);
      expect({ turns, deleted: scene.deleted }).toEqual({ turns, deleted: 0 });
    }
  });

  test("an instance read as changed goes at once, and one in trouble goes every time", async () => {
    const scene: Scene = sceneOf(newInventory());

    await collectFor(scene, 7);

    scene.cloud.changeInstances([11, 12], "ERROR");

    const changed: OpenStackCollectionReport = await collectAndLand(scene);
    const inError: (report: OpenStackCollectionReport) => number = (
      report: OpenStackCollectionReport,
    ): number => {
      return datapointsOf(report.resourceMetrics).filter(
        (point: ReportedDatapoint): boolean => {
          return (
            point.metric === "openstack_nova_server_status" &&
            point.labels["status"] === "ERROR"
          );
        },
      ).length;
    };

    expect(inError(changed)).toBe(2);
    expect(inError(await collectAndLand(scene))).toBe(2);
    expect(scene.deleted).toBe(0);
  });

  test("a service that fails at its parts' moments costs them nothing, and they catch up", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 6 });

    await collectFor(scene, 7);

    // Every few collections, for long enough that each part's moment fell in a failure.
    for (let round: number = 0; round < 8; round++) {
      scene.failing.add(OpenStackServiceType.Volume);
      await collectFor(scene, 1);
      scene.failing.delete(OpenStackServiceType.Volume);
      await collectFor(scene, 2);
    }

    await collectFor(scene, 8);

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
  });

  test("a service down for longer than the window keeps its parts, and comes back whole", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 6 });

    await collectFor(scene, 8);

    scene.failing.add(OpenStackServiceType.Compute);
    scene.failing.add(OpenStackServiceType.Network);
    await collectFor(scene, 30);
    scene.failing.delete(OpenStackServiceType.Compute);
    scene.failing.delete(OpenStackServiceType.Network);
    await collectFor(scene, 30);

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
  });

  test("a probe that restarts remembers nothing, and takes nothing that is still there", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 6 });

    await collectFor(scene, 9);

    for (let restart: number = 0; restart < 5; restart++) {
      // Part of a cycle, and an outage longer than the window on the way.
      scene.memory = new OpenStackCollectorMemory();
      scene.clock.advance(restart * 10 * MINUTE_IN_MS);
      await collectFor(scene, 3 + restart * 2);
    }

    await collectFor(scene, 8);

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
  });

  test("a probe away for hours finds what it left, even while its first cycle has hardly begun", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 6 });

    await collectFor(scene, 9);

    scene.memory = new OpenStackCollectorMemory();
    scene.clock.advance(6 * 60 * MINUTE_IN_MS);

    for (let collection: number = 0; collection < 7; collection++) {
      await collectAndLand(scene);
      await expectEverythingThere(scene);
    }

    expect(scene.deleted).toBe(0);
  });

  test("a cloud that grows past a turn takes nothing, and a cycle that shrinks takes nothing", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 3 });

    await collectFor(scene, 5);

    // More datapoints, against the same target, means more turns: a part's moment moves.
    scene.rollingBytes = rollingBytesFor(COUNTS, 12);
    await collectFor(scene, 3);
    expect(
      scene.reports[scene.reports.length - 1]?.summary?.refreshCycleInMinutes,
    ).toBe(24);
    await collectFor(scene, 20);

    // Far fewer: the cycle falls by more than half, while rows still wait on the old one.
    scene.rollingBytes = rollingBytesFor(COUNTS, 2);
    await collectFor(scene, 3);
    expect(
      scene.reports[scene.reports.length - 1]?.summary?.refreshCycleInMinutes,
    ).toBe(4);
    await collectFor(scene, 30);

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
  });

  test("collecting less often or more often takes nothing", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 4 });

    await collectFor(scene, 6);

    scene.job = { ...scene.job, collectionIntervalInMinutes: 10 };

    for (let collection: number = 0; collection < 6; collection++) {
      await collectAndLand(scene);
      scene.clock.advance(8 * MINUTE_IN_MS);
    }

    scene.job = { ...scene.job, collectionIntervalInMinutes: 2 };
    await collectFor(scene, 40);

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
  });

  test("a cloud that falls below the line sends everything once, and then says nothing is waiting", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 6 });

    await collectFor(scene, 8);

    const goneIndexes: Array<number> = [];

    for (let index: number = 50; index < COUNTS.instances; index++) {
      goneIndexes.push(index);
    }

    scene.cloud.deleteInstances(goneIndexes);
    await collectFor(scene, 1);

    const report: OpenStackCollectionReport = await collectAndLand(scene);

    expect(report.summary?.isSummaryMode).toBeUndefined();

    const instances: Array<string> = await scene.inventory.externalIdsOf(
      OpenStackResourceKind.Instance,
    );

    // None of the fifty that stayed has left.
    expect(instances.length).toBeGreaterThanOrEqual(50);

    await collectFor(scene, Math.ceil((WINDOW_IN_MINUTES + 12) / 2) + 4);

    expect(
      await scene.inventory.externalIdsOf(OpenStackResourceKind.Instance),
    ).toHaveLength(50);
    expect(scene.deleted).toBe(COUNTS.instances - 50);
  });

  test("a part that really went leaves within the window, a cycle and two reads", async () => {
    const scene: Scene = sceneOf(newInventory(), { turns: 6 });

    await collectFor(scene, 8);

    scene.cloud.deleteInstances([7]);

    let collections: number = 0;

    while (
      (await scene.inventory.externalIdsOf(OpenStackResourceKind.Instance))
        .length === COUNTS.instances &&
      collections < 40
    ) {
      await collectAndLand(scene);
      collections++;
    }

    expect(scene.deleted).toBe(1);
    expect(collections * INTERVAL_IN_MINUTES).toBeLessThanOrEqual(
      WINDOW_IN_MINUTES + 12 + INTERVAL_IN_MINUTES * 2 + INTERVAL_IN_MINUTES,
    );
  });

  test("a cloud too large to upload takes nothing, however long it stays that way", async () => {
    const scene: Scene = sceneOf(newInventory(), {
      job: {
        options: { instanceSeriesMode: OpenStackInstanceMetricsMode.All },
      },
    });

    await collectFor(scene, 3);
    await expectEverythingThere(scene);

    // Whatever it held before, it now holds more than an upload can.
    scene.maxPayloadBytes = 1000;

    for (let collection: number = 0; collection < 60; collection++) {
      const report: OpenStackCollectionReport = await collectAndLand(scene);

      expect(report.status).toBe("Failed");
      expect(report.errorMessage).toContain("Use the OpenStack agent");
    }

    await expectEverythingThere(scene);
    expect(scene.deleted).toBe(0);
  });

  test("a cloud that keeps everything, and is small enough to, goes on as it always did", async () => {
    const scene: Scene = sceneOf(newInventory(), {
      job: {
        options: { instanceSeriesMode: OpenStackInstanceMetricsMode.All },
      },
    });

    const first: OpenStackCollectionReport = await collectAndLand(scene);

    expect(first.summary?.isSummaryMode).toBeUndefined();
    await expectEverythingThere(scene);

    await collectFor(scene, 20);
    expect(scene.deleted).toBe(0);
  });
}

describe("a cloud's whole life, on the stale-row rule's model", () => {
  lifecycleScenes((): OpenStackTestInventory => {
    return new OpenStackInventoryModel(WINDOW_IN_MINUTES);
  });
});

describeOnPostgres("a cloud's whole life, on Postgres", () => {
  const schema: string = `openstack_lifecycle_${Date.now()}`;
  const TABLE: string = "OpenStackResource";
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},pg_catalog` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
  }, 120000);

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);
    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  }, 120000);

  lifecycleScenes((): OpenStackTestInventory => {
    const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
      projectId: ObjectID.generate(),
      openStackCloudId: ObjectID.generate(),
    };

    return {
      write: async (rows: Array<ParsedOpenStackResource>): Promise<void> => {
        await OpenStackResourceService.bulkUpsert({
          ...scope,
          resources: rows,
        });
      },
      sweep: (): Promise<number> => {
        return OpenStackResourceService.deleteStaleForCloud(scope);
      },
      externalIdsOf: async (
        kind: OpenStackResourceKind,
      ): Promise<Array<string>> => {
        const rows: Array<{ externalId: string }> = await database.query(
          `SELECT "externalId" FROM "${schema}"."${TABLE}"
           WHERE "openStackCloudId" = $1 AND "kind" = $2`,
          [scope.openStackCloudId.toString(), kind],
        );

        return rows.map((row: { externalId: string }): string => {
          return row.externalId;
        });
      },
    };
  });
});
