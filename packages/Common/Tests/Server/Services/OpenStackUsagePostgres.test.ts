import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OpenStackProjectUsageService, {
  OpenStackUsagePeriodRow,
  OpenStackWasteRows,
} from "../../../Server/Services/OpenStackProjectUsageService";
import OpenStackResourceService, {
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import logger from "../../../Server/Utils/Logger";
import OpenStackUsageRefresh, {
  OpenStackUsageRefreshResult,
} from "../../../Server/Utils/OpenStack/OpenStackUsageRefresh";
import {
  OpenStackResourceBufferEntry,
  getOpenStackHostsToReconcile,
  getOpenStackHostsWithPartReadings,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_INSTANCE_STATUS_SHUT_OFF,
  OpenStackUsageRows,
  getOpenStackFlavorUsageKey,
  getOpenStackProjectHoldings,
  getOpenStackUsageTotals,
} from "../../../Types/OpenStack/OpenStackProjectUsage";
import {
  OpenStackPriceList,
  readOpenStackPriceList,
} from "../../../Types/OpenStack/OpenStackPriceList";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_LARGE_CLOUD } from "../../../Types/OpenStack/OpenStackScale";
import {
  OpenStackWasteFinding,
  OpenStackWasteItem,
  OpenStackWasteRuleId,
} from "../../../Types/OpenStack/OpenStackWaste";
import {
  OpenStackSpendSnapshot,
  readOpenStackSpendSnapshot,
} from "../../../Types/OpenStack/OpenStackSpendSnapshot";
import {
  OPENSTACK_USAGE_SCENES,
  idOfProject,
  recordedAtOfUsageScene,
  scanUsageScene,
} from "../../Helpers/OpenStackRecordedScan";
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";

/*
 * THE WORKER'S USAGE READING, ON POSTGRES.
 *
 * Hand-written SQL over the inventory's rows, and a transaction whose last statement is what stops
 * a time being counted twice, which only a real database can prove. Opt in as
 * OpenStackResourcePostgres.test.ts does (RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true and
 * OPENSTACK_INVENTORY_TEST_DATABASE_*), against a database with the migrations applied. It works on
 * a structure-only clone in a schema of its own, dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OpenStackResource";
const USAGE: string = "OpenStackProjectUsage";
const CLOUD: string = "OpenStackCloud";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OTHER_CLOUD_ID: ObjectID = ObjectID.generate();
const SCOPE: { projectId: ObjectID; openStackCloudId: ObjectID } = {
  projectId: PROJECT_ID,
  openStackCloudId: CLOUD_ID,
};
const GB: number = 1024 * 1024 * 1024;
const SEEN: Date = new Date("2026-11-10T00:00:00.000Z");

function resource(
  overrides: Partial<ParsedOpenStackResource> & {
    kind: OpenStackResourceKind;
    externalId: string;
  },
): ParsedOpenStackResource {
  return {
    name: null,
    regionName: "RegionOne",
    availabilityZone: null,
    hypervisorName: null,
    openStackProjectId: null,
    status: null,
    adminState: null,
    disabledReason: null,
    vcpuCapacity: null,
    vcpuAllocated: null,
    memoryCapacityBytes: null,
    memoryAllocatedBytes: null,
    diskCapacityBytes: null,
    diskAllocatedBytes: null,
    instanceCount: null,
    facts: {},
    lastSeenAt: SEEN,
    ...overrides,
  };
}

function flavor(
  id: string,
  name: string,
  vcpus: number,
  memoryGb: number,
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Flavor,
    externalId: `RegionOne/${id}`,
    name,
    vcpuCapacity: vcpus,
    memoryCapacityBytes: memoryGb * GB,
    diskCapacityBytes: 20 * GB,
  });
}

function instance(
  id: string,
  project: string | null,
  flavorId: string,
  status: string = "ACTIVE",
  host: string | null = "cmp-1",
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Instance,
    externalId: id,
    name: id,
    openStackProjectId: project,
    hypervisorName: host,
    status,
    facts: { flavorId },
  });
}

function storage(
  kind: OpenStackResourceKind,
  id: string,
  project: string | null,
  gb: number,
  status: string,
  facts: JSONObject = {},
): ParsedOpenStackResource {
  return resource({
    kind,
    externalId: id,
    name: id,
    openStackProjectId: project,
    status,
    diskCapacityBytes: gb * GB,
    facts,
  });
}

describePostgres(
  "what a reading of usage reads and writes, on Postgres",
  () => {
    const schema: string = `openstack_usage_${Date.now()}`;
    let database: DataSource;

    const write: (
      resources: Array<ParsedOpenStackResource>,
      openStackCloudId?: ObjectID,
    ) => Promise<void> = async (
      resources: Array<ParsedOpenStackResource>,
      openStackCloudId: ObjectID = CLOUD_ID,
    ): Promise<void> => {
      await OpenStackResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        openStackCloudId,
        resources,
      });
    };

    const removeRow: (externalId: string) => Promise<void> = async (
      externalId: string,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."${TABLE}" WHERE "openStackCloudId" = $1 AND "externalId" = $2`,
        [CLOUD_ID.toString(), externalId],
      );
    };

    const readCloud: () => Promise<{
      lastReadAt: Date | null;
      previous: OpenStackSpendSnapshot | null;
    }> = async (): Promise<{
      lastReadAt: Date | null;
      previous: OpenStackSpendSnapshot | null;
    }> => {
      const rows: Array<{
        usageReadAt: Date | null;
        spendSnapshot: unknown;
      }> = await database.query(
        `SELECT "usageReadAt", "spendSnapshot" FROM "${schema}"."${CLOUD}" WHERE "_id" = $1`,
        [CLOUD_ID.toString()],
      );
      return {
        lastReadAt: rows[0]!.usageReadAt
          ? new Date(rows[0]!.usageReadAt)
          : null,
        previous: readOpenStackSpendSnapshot(rows[0]!.spendSnapshot),
      };
    };

    const readAt: (
      now: string,
      priceList?: OpenStackPriceList | null,
    ) => Promise<OpenStackUsageRefreshResult> = async (
      now: string,
      priceList: OpenStackPriceList | null = null,
    ): Promise<OpenStackUsageRefreshResult> => {
      const { lastReadAt, previous } = await readCloud();

      return await OpenStackUsageRefresh.refresh({
        ...SCOPE,
        lastReadAt,
        previous,
        priceList,
        now: new Date(now),
      });
    };

    const rowOf: (
      openStackProjectId: string,
      period: string,
    ) => Promise<OpenStackUsagePeriodRow | undefined> = async (
      openStackProjectId: string,
      period: string,
    ): Promise<OpenStackUsagePeriodRow | undefined> => {
      const rows: Array<OpenStackUsagePeriodRow> =
        await OpenStackProjectUsageService.getPeriodRows({ ...SCOPE, period });

      return rows.find((row: OpenStackUsagePeriodRow): boolean => {
        return row.openStackProjectId === openStackProjectId;
      });
    };

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
        extra: { options: `-c search_path=${schema},pg_catalog,public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of [TABLE, USAGE, CLOUD]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      for (const table of [TABLE, USAGE, CLOUD]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
      await database.query(
        `INSERT INTO "${schema}"."${CLOUD}" ("_id", "projectId", "name", "slug", "version")
       VALUES ($1, $2, 'test', 'test', 0)`,
        [CLOUD_ID.toString(), PROJECT_ID.toString()],
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        try {
          await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await database.destroy();
        }
      }
    });

    describe("what each project holds", () => {
      test("counts this cloud's rows, by project, flavor and status, and leaves out what holds nothing", async () => {
        await write([
          flavor("small", "m1.small", 1, 2),
          instance("a-1", "a", "small"),
          instance("a-2", "a", "small"),
          instance("a-off", "a", "small", OPENSTACK_INSTANCE_STATUS_SHUT_OFF),
          // Never placed, or shelved off its host: neither holds a flavor's worth of anything.
          instance("a-failed", "a", "small", "ERROR", null),
          instance("a-shelved", "a", "small", "SHELVED_OFFLOADED"),
          // Nobody's.
          instance("nobody", null, "small"),
          storage(OpenStackResourceKind.Volume, "v-ok", "a", 10, "in-use", {
            volumeType: "ssd",
          }),
          storage(OpenStackResourceKind.Volume, "v-free", "a", 5, "available", {
            volumeType: "ssd",
          }),
          storage(OpenStackResourceKind.Volume, "v-bad", "a", 99, "error", {
            volumeType: "ssd",
          }),
          storage(OpenStackResourceKind.Volume, "v-hdd", "a", 1, "in-use", {
            volumeType: "hdd",
          }),
          storage(OpenStackResourceKind.Volume, "v-none", "a", 2, "in-use"),
          storage(OpenStackResourceKind.Snapshot, "s-ok", "a", 3, "available"),
          storage(OpenStackResourceKind.Snapshot, "s-bad", "a", 99, "error"),
          storage(OpenStackResourceKind.Image, "i-ok", "a", 4, "active"),
          storage(OpenStackResourceKind.Image, "i-queued", "a", 99, "queued"),
          resource({
            kind: OpenStackResourceKind.FloatingIp,
            externalId: "f-1",
            openStackProjectId: "a",
            status: "ACTIVE",
          }),
          resource({
            kind: OpenStackResourceKind.FloatingIp,
            externalId: "f-2",
            openStackProjectId: "a",
            status: "DOWN",
          }),
        ]);
        await write([instance("other", "a", "small")], OTHER_CLOUD_ID);

        const rows: OpenStackUsageRows =
          await OpenStackProjectUsageService.getUsageRows(SCOPE);
        const holdings: ReturnType<typeof getOpenStackProjectHoldings> =
          getOpenStackProjectHoldings(rows);

        expect(holdings.length).toBe(1);
        expect(holdings[0]!.flavors).toEqual([
          {
            regionName: "RegionOne",
            flavorId: "small",
            name: "m1.small",
            vcpus: 1,
            ramMib: 2048,
            running: 2,
            shutOff: 1,
          },
        ]);
        expect(holdings[0]!.volumeGbByType).toEqual({ ssd: 15, hdd: 1, "": 2 });
        expect(holdings[0]!.floatingIps).toBe(2);
        expect(holdings[0]!.imageGb).toBe(4);
        expect(holdings[0]!.snapshotGb).toBe(3);
      });
    });

    describe("readings over a test period", () => {
      test("adds up by hand across a resize and a deletion, on real rows and a real transaction", async () => {
        /*
         *   t0 (00:00)  web m1.small, batch m1.small, 10 GB of ssd. First reading: counts nothing.
         *   t1 (00:15)  as t0.                          0.25 h of 2 small, 0.25 h of 10 GB
         *   t2 (00:30)  web is now m1.medium.           0.25 h of 1 small + 1 medium, 0.25 h of 10 GB
         *   t3 (00:45)  batch has been deleted.         0.25 h of 1 medium, 0.25 h of 10 GB
         *
         *   m1.small: 0.5 + 0.25 = 0.75 instance-hours, x 1 vCPU = 0.75, x 2 GB = 1.5
         *   m1.medium: 0.25 + 0.25 = 0.5 instance-hours, x 2 vCPUs = 1.0, x 4 GB = 2.0
         *   vCPU-hours 1.75. Memory 3.5 GB-hours. Volume 10 x 0.75 = 7.5 GB-hours.
         */
        await write([
          flavor("small", "m1.small", 1, 2),
          flavor("medium", "m1.medium", 2, 4),
          instance("web", "payments", "small"),
          instance("batch", "payments", "small"),
          storage(
            OpenStackResourceKind.Volume,
            "data",
            "payments",
            10,
            "in-use",
            {
              volumeType: "ssd",
            },
          ),
          resource({
            kind: OpenStackResourceKind.Project,
            externalId: "payments",
            name: "Payments",
            openStackProjectId: "payments",
            facts: { domainId: "d1" },
          }),
          resource({
            kind: OpenStackResourceKind.Domain,
            externalId: "d1",
            name: "Default",
          }),
        ]);

        await readAt("2026-11-10T00:00:00.000Z");
        await readAt("2026-11-10T00:15:00.000Z");

        await write([instance("web", "payments", "medium")]);
        await readAt("2026-11-10T00:30:00.000Z");

        await removeRow("batch");
        const last: OpenStackUsageRefreshResult = await readAt(
          "2026-11-10T00:45:00.000Z",
          readOpenStackPriceList({
            currency: "EUR",
            vcpuHour: 0.1,
            memoryGbHour: 0.01,
            volumeGbHour: 0.001,
          }),
        );

        const row: OpenStackUsagePeriodRow = (await rowOf(
          "payments",
          "2026-11",
        ))!;
        const small: string = getOpenStackFlavorUsageKey({
          regionName: "RegionOne",
          flavorId: "small",
        });
        const medium: string = getOpenStackFlavorUsageKey({
          regionName: "RegionOne",
          flavorId: "medium",
        });

        expect(row.quantities.flavors[small]!.runningHours).toBe(0.75);
        expect(row.quantities.flavors[medium]!.runningHours).toBe(0.5);
        expect(getOpenStackUsageTotals(row.quantities).vcpuHours).toBe(1.75);
        expect(getOpenStackUsageTotals(row.quantities).memoryGbHours).toBe(3.5);
        expect(row.quantities.volumeGbHoursByType["ssd"]).toBe(7.5);
        expect(row.name).toBe("Payments");
        expect(row.domainName).toBe("Default");

        // vCPUs 1.75 x 0.1 + memory 3.5 x 0.01 + volume 7.5 x 0.001 = 0.175 + 0.035 + 0.0075.
        expect(last.snapshot.thisMonth).toBeCloseTo(0.2175, 4);
        expect(last.snapshot.currency).toBe("EUR");
        expect(last.snapshot.source).toBe("price-list");
        expect(last.snapshot.usage.vcpuHours).toBe(1.75);
        expect(last.snapshot.coverage.countedHours).toBeCloseTo(0.75, 6);
        expect(last.snapshot.coverage.notCountedHours).toBe(0);

        // Read back as the columns a list sorts and shows.
        const stored: Array<{
          vcpuHours: string;
          estimatedCost: string;
          costSource: string;
          sortValue: string;
        }> = await database.query(
          `SELECT "vcpuHours", "estimatedCost", "costSource", "sortValue" FROM "${schema}"."${USAGE}"
         WHERE "openStackProjectId" = 'payments' AND "period" = '2026-11'`,
        );

        expect(Number(stored[0]!.vcpuHours)).toBe(1.75);
        expect(Number(stored[0]!.estimatedCost)).toBeCloseTo(0.2175, 4);
        expect(stored[0]!.costSource).toBe("price-list");
        expect(Number(stored[0]!.sortValue)).toBeCloseTo(0.2175, 4);
      });

      test("CloudKitty's figure is preferred where there is one, and prices are used where there isn't", async () => {
        const month: string = "2026-11";

        await write([
          flavor("small", "m1.small", 1, 2),
          instance("rated", "rated", "small"),
          instance("priced", "priced", "small"),
          resource({
            kind: OpenStackResourceKind.Project,
            externalId: "rated",
            name: "Rated",
            openStackProjectId: "rated",
            facts: {
              "rated:RegionOne": {
                [month]: { total: 90, readAt: "2026-11-09T23:00:00.000Z" },
                "2026-10": { total: 40, readAt: "2026-11-09T23:00:00.000Z" },
              },
              "rated:RegionTwo": {
                [month]: { total: 9.5, readAt: "2026-11-09T23:30:00.000Z" },
              },
            },
          }),
          resource({
            kind: OpenStackResourceKind.Project,
            externalId: "priced",
            name: "Priced",
            openStackProjectId: "priced",
          }),
        ]);

        const prices: OpenStackPriceList | null = readOpenStackPriceList({
          vcpuHour: 1,
        });

        await readAt("2026-11-10T00:00:00.000Z", prices);

        const reading: OpenStackUsageRefreshResult = await readAt(
          "2026-11-10T01:00:00.000Z",
          prices,
        );

        expect(reading.snapshot.source).toBe("cloudkitty-and-price-list");
        expect(reading.snapshot.projectsRatedByCloudKitty).toBe(1);
        expect(reading.snapshot.cloudKittyReadAt).toBe(
          "2026-11-09T23:00:00.000Z",
        );
        // 90 and 9.5 rated, by a CloudKitty per region, and an hour of one vCPU at 1.
        expect(reading.snapshot.thisMonth).toBe(100.5);

        const stored: Array<{
          openStackProjectId: string;
          estimatedCost: string;
          lastMonthCost: string | null;
          costSource: string;
        }> = await database.query(
          `SELECT "openStackProjectId", "estimatedCost", "lastMonthCost", "costSource"
           FROM "${schema}"."${USAGE}" WHERE "period" = '${month}'
           ORDER BY "openStackProjectId"`,
        );

        expect(Number(stored[0]!.estimatedCost)).toBe(1);
        expect(stored[0]!.costSource).toBe("price-list");
        expect(Number(stored[1]!.estimatedCost)).toBe(99.5);
        expect(Number(stored[1]!.lastMonthCost)).toBe(40);
        expect(stored[1]!.costSource).toBe("cloudkitty");
      });

      test("a time is counted once, however many workers read it at once", async () => {
        await write([
          flavor("small", "m1.small", 1, 2),
          instance("web", "a", "small"),
        ]);
        await readAt("2026-11-10T00:00:00.000Z");

        const { lastReadAt, previous } = await readCloud();
        const reading: () => Promise<OpenStackUsageRefreshResult> =
          async () => {
            return await OpenStackUsageRefresh.refresh({
              ...SCOPE,
              lastReadAt,
              previous,
              priceList: null,
              now: new Date("2026-11-10T00:15:00.000Z"),
            });
          };

        const results: Array<OpenStackUsageRefreshResult> = await Promise.all([
          reading(),
          reading(),
        ]);

        expect(
          results.filter((result: OpenStackUsageRefreshResult): boolean => {
            return result.wasSaved;
          }).length,
        ).toBe(1);
        expect(
          getOpenStackUsageTotals((await rowOf("a", "2026-11"))!.quantities)
            .instanceHours,
        ).toBe(0.25);

        // And one that comes along later, with the old time, changes nothing.
        const late: OpenStackUsageRefreshResult = await reading();
        expect(late.wasSaved).toBe(false);
        expect(
          getOpenStackUsageTotals((await rowOf("a", "2026-11"))!.quantities)
            .instanceHours,
        ).toBe(0.25);
      });

      test("a midnight keeps the day's rows, and a month's end starts over with last month kept", async () => {
        await write([
          flavor("small", "m1.small", 1, 2),
          instance("web", "a", "small"),
        ]);

        await readAt("2026-11-30T23:45:00.000Z");
        await readAt("2026-12-01T00:15:00.000Z");

        expect(
          getOpenStackUsageTotals((await rowOf("a", "2026-11"))!.quantities)
            .instanceHours,
        ).toBe(0.25);
        expect(
          getOpenStackUsageTotals((await rowOf("a", "2026-11-30"))!.quantities)
            .instanceHours,
        ).toBe(0.25);
        expect(
          getOpenStackUsageTotals((await rowOf("a", "2026-12"))!.quantities)
            .instanceHours,
        ).toBe(0.25);

        const { previous } = await readCloud();

        expect(previous!.month).toBe("2026-12");
        expect(previous!.lastMonthUsage!.instanceHours).toBe(0.25);
        expect(previous!.coverage.countedHours).toBeCloseTo(0.25, 6);
        expect(previous!.lastMonthCoverage!.countedHours).toBeCloseTo(0.25, 6);
        expect(previous!.lastMonthCoverage!.firstReadAt).toBe(
          "2026-11-30T23:45:00.000Z",
        );
        expect(
          previous!.days.map((day: { day: string }) => {
            return day.day;
          }),
        ).toEqual(["2026-11-30"]);
      });

      test("this month's full days against the same days last month, and at today's prices", async () => {
        await write([
          flavor("small", "m1.small", 1, 2),
          instance("web", "a", "small"),
        ]);

        // A quarter hour on the 4th of November, kept at its midnight.
        await readAt("2026-11-04T23:45:00.000Z");
        await readAt("2026-11-05T00:00:00.000Z");

        // On the 4th of December, the last hour of a long gap and then half an hour, kept at its midnight.
        await readAt("2026-12-04T23:30:00.000Z");
        await readAt("2026-12-05T00:00:00.000Z");

        const atOne: OpenStackUsageRefreshResult = await readAt(
          "2026-12-05T10:00:00.000Z",
          readOpenStackPriceList({ vcpuHour: 1 }),
        );

        expect(atOne.snapshot.comparison).toMatchObject({
          throughDay: "2026-12-04",
          lastMonthThroughDay: "2026-11-04",
          thisMonth: 1.5,
          lastMonth: 0.25,
          thisMonthVcpuHours: 1.5,
          lastMonthVcpuHours: 0.25,
        });

        // Worked out again at a new price, for both months, and not otherwise.
        const atTwo: OpenStackUsageRefreshResult = await readAt(
          "2026-12-05T10:15:00.000Z",
          readOpenStackPriceList({ vcpuHour: 2 }),
        );

        expect(atTwo.snapshot.comparison).toMatchObject({
          thisMonth: 3,
          lastMonth: 0.5,
        });

        // A day with nothing to go on says nothing: the 5th of November kept no row.
        const noRow: OpenStackUsageRefreshResult = await readAt(
          "2026-12-06T10:00:00.000Z",
          readOpenStackPriceList({ vcpuHour: 2 }),
        );

        expect(noRow.snapshot.comparison).toBeNull();
      });

      test("old rows go: a day's after 62 days and a month's after 13 months", async () => {
        const seed: (period: string) => Promise<void> = async (
          period: string,
        ): Promise<void> => {
          await database.query(
            `INSERT INTO "${schema}"."${USAGE}"
            ("projectId", "openStackCloudId", "openStackProjectId", "period", "version", "sortValue")
           VALUES ($1, $2, 'a', $3, 1, 0)`,
            [PROJECT_ID.toString(), CLOUD_ID.toString(), period],
          );
        };

        for (const period of [
          "2026-09-08",
          "2026-09-10",
          "2025-10",
          "2025-11",
        ]) {
          await seed(period);
        }

        const deleted: number =
          await OpenStackProjectUsageService.deleteOldRows({
            ...SCOPE,
            now: new Date("2026-11-10T00:00:00.000Z"),
          });

        expect(deleted).toBe(2);

        const left: Array<{ period: string }> = await database.query(
          `SELECT "period" FROM "${schema}"."${USAGE}" ORDER BY "period"`,
        );

        expect(
          left.map((row: { period: string }): string => {
            return row.period;
          }),
        ).toEqual(["2025-11", "2026-09-10"]);
      });
    });

    describe("what the waste rules are given", () => {
      test("reads only what could be named, and what says an image is in use", async () => {
        await write([
          storage(OpenStackResourceKind.Volume, "free", "a", 1, "available", {
            attachedToInstance: null,
          }),
          storage(OpenStackResourceKind.Volume, "used", "a", 1, "in-use", {
            attachedToInstance: "x",
          }),
          storage(OpenStackResourceKind.Image, "active", "a", 1, "active"),
          storage(OpenStackResourceKind.Image, "queued", "a", 1, "queued"),
          storage(OpenStackResourceKind.Snapshot, "snap", "a", 1, "available"),
          instance("off", "a", "small", "SHUTOFF"),
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: "on-image",
            openStackProjectId: "a",
            hypervisorName: "h",
            status: "ACTIVE",
            facts: { imageId: "active", flavorId: "small" },
          }),
        ]);

        const rows: OpenStackWasteRows =
          await OpenStackProjectUsageService.getWasteRows(SCOPE);

        expect(
          rows.volumes.map((row: { externalId: string }): string => {
            return row.externalId;
          }),
        ).toEqual(["free"]);
        expect(
          rows.instances.map((row: { externalId: string }): string => {
            return row.externalId;
          }),
        ).toEqual(["off"]);
        expect(
          rows.images.map((row: { externalId: string }): string => {
            return row.externalId;
          }),
        ).toEqual(["active"]);
        expect(rows.snapshotRowCount).toBe(1);
        expect(rows.instanceImageIds.sort()).toEqual(["active", null]);
        // "off" says nothing of an image, so nobody can say what's in use.
        expect(rows.instancesNotSaying).toBe(1);
      });
    });

    /*
     * What the docs say a reading costs, at each size #5732 tests at. It grows with projects, not
     * instances, so a smaller cloud costs what's worked out here, exactly, and the largest is below.
     */
    describe.each([
      { projects: 10, statements: 6 + 2 + 1 + 1 + 1 + 1 + 1 },
      { projects: 1000, statements: 6 + 2 + 1 + 1 + 1 + 2 + 1 },
    ])(
      "with $projects projects",
      (size: { projects: number; statements: number }) => {
        test("a reading asks exactly what the docs say", async () => {
          await write([flavor("small", "m1.small", 1, 2)]);
          await database.query(
            `INSERT INTO "${schema}"."${TABLE}"
              ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
               "hypervisorName", "openStackProjectId", "status", "lastSeenAt", "version", "facts")
             SELECT $1, $2, 'Instance', 'i-' || g, 'i-' || g, 'RegionOne', 'cmp-1',
                    'p-' || g, 'ACTIVE', now(), 0, jsonb_build_object('flavorId', 'small')
             FROM generate_series(1, ${size.projects}) AS g`,
            [PROJECT_ID.toString(), CLOUD_ID.toString()],
          );

          await readAt("2026-11-10T00:00:00.000Z");

          const statements: { calls: Array<unknown> } = jest.spyOn(
            database,
            "query",
          ).mock;
          const reading: OpenStackUsageRefreshResult = await readAt(
            "2026-11-10T00:15:00.000Z",
          );

          expect(statements.calls.length).toBe(1 + size.statements);
          expect(reading.rowsWritten).toBe(size.projects);
        });
      },
    );

    /*
     * The whole of it, on what a real cloud did: what the agent's exporter really answered, through
     * the real scan, written as ingest writes it, and read by the real reading at the times it was
     * really taken. The arithmetic is written out in OpenStackUsageOnARealCloud.test.ts.
     */
    describe("on a real cloud's recording", () => {
      const toResource: (
        entry: OpenStackResourceBufferEntry,
      ) => ParsedOpenStackResource = (
        entry: OpenStackResourceBufferEntry,
      ): ParsedOpenStackResource => {
        return {
          kind: entry.kind,
          externalId: entry.externalId,
          name: entry.name,
          regionName: entry.regionName,
          availabilityZone: entry.availabilityZone,
          hypervisorName: entry.hypervisorName,
          openStackProjectId: entry.openStackProjectId,
          status: entry.status,
          adminState: entry.adminState,
          disabledReason: entry.disabledReason,
          vcpuCapacity: entry.vcpuCapacity,
          vcpuAllocated: entry.vcpuAllocated,
          memoryCapacityBytes: entry.memoryCapacityBytes,
          memoryAllocatedBytes: entry.memoryAllocatedBytes,
          diskCapacityBytes: entry.diskCapacityBytes,
          diskAllocatedBytes: entry.diskAllocatedBytes,
          instanceCount: entry.instanceCount,
          facts: entry.facts,
          lastSeenAt: entry.observedAt,
        };
      };

      test("a real resize and a real deletion come to the hand calculation, and a month on each rule finds what the rig left", async () => {
        const prices: OpenStackPriceList | null = readOpenStackPriceList({
          vcpuHour: 0.36,
          memoryGbHour: 0.72,
        });
        let rows: Array<OpenStackResourceBufferEntry> = [];

        for (const scene of OPENSTACK_USAGE_SCENES) {
          const next: Array<OpenStackResourceBufferEntry> =
            scanUsageScene(scene);

          await write(next.map(toResource));
          await OpenStackResourceService.reconcileHypervisorStates({
            ...SCOPE,
            shortHostNames: getOpenStackHostsToReconcile(next),
          });
          await OpenStackResourceService.reconcileHypervisorCapacity({
            ...SCOPE,
            hypervisorNames: getOpenStackHostsWithPartReadings(next),
          });

          // What the inventory's stale sweep does with what's gone, in its own time.
          for (const row of rows) {
            if (
              !next.some((entry: OpenStackResourceBufferEntry): boolean => {
                return (
                  entry.kind === row.kind && entry.externalId === row.externalId
                );
              })
            ) {
              await removeRow(row.externalId);
            }
          }

          rows = next;
          await readAt(recordedAtOfUsageScene(scene).toISOString(), prices);
        }

        const adminId: string = idOfProject(rows, "admin");
        const admin: OpenStackUsagePeriodRow = (await rowOf(
          adminId,
          "2026-11",
        ))!;
        const totals: ReturnType<typeof getOpenStackUsageTotals> =
          getOpenStackUsageTotals(admin.quantities);

        expect(totals.vcpuHours).toBeCloseTo(10280 / 3600, 5);
        expect(totals.memoryGbHours).toBeCloseTo(12467.5 / 3600, 5);

        const stored: Array<{ estimatedCost: string }> = await database.query(
          `SELECT "estimatedCost" FROM "${schema}"."${USAGE}"
           WHERE "openStackProjectId" = $1 AND "period" = '2026-11'`,
          [adminId],
        );

        expect(Number(stored[0]!.estimatedCost)).toBeCloseTo(3.5215, 3);

        const later: OpenStackUsageRefreshResult = await readAt(
          new Date(
            recordedAtOfUsageScene("usage-end").getTime() +
              31 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          prices,
        );
        const finding: (rule: OpenStackWasteRuleId) => OpenStackWasteFinding = (
          rule: OpenStackWasteRuleId,
        ): OpenStackWasteFinding => {
          return later.snapshot.waste!.find(
            (entry: OpenStackWasteFinding): boolean => {
              return entry.rule === rule;
            },
          )!;
        };
        const namesOf: (rule: OpenStackWasteRuleId) => Array<string | null> = (
          rule: OpenStackWasteRuleId,
        ): Array<string | null> => {
          return finding(rule)
            .items.map((item: OpenStackWasteItem): string | null => {
              return item.name;
            })
            .sort();
        };

        expect(namesOf(OpenStackWasteRuleId.UnattachedVolume)).toEqual([
          "ou-vol-free",
          "ou-vol-from-image",
        ]);
        expect(namesOf(OpenStackWasteRuleId.SpareFloatingIp)).toEqual([
          "172.24.4.67",
        ]);
        expect(namesOf(OpenStackWasteRuleId.ShutOffInstance)).toEqual([
          "ou-stopped",
        ]);
        expect(namesOf(OpenStackWasteRuleId.MovableHost)).toEqual([
          "ou-use-quiet",
        ]);
        // These are the agent's series, which can't say what's in use or list snapshots.
        expect(finding(OpenStackWasteRuleId.UnusedImage).cannotTell).toBe(
          "images-in-use-not-reported",
        );
        expect(finding(OpenStackWasteRuleId.OldSnapshot).cannotTell).toBe(
          "snapshots-not-reported",
        );
      }, 120000);
    });

    describe("at the largest size tested", () => {
      const seed: () => Promise<void> = async (): Promise<void> => {
        const { hypervisors, instances, projects } = OPENSTACK_LARGE_CLOUD;
        const scope: Array<string> = [
          PROJECT_ID.toString(),
          CLOUD_ID.toString(),
        ];

        await database.query(
          `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
           "hypervisorName", "openStackProjectId", "status", "lastSeenAt", "version", "facts")
         SELECT $1, $2, 'Instance', 'i-' || g, 'i-' || g, 'RegionOne',
                'compute-' || (g % ${hypervisors}) || '.example.org', 'p-' || (g % ${projects}),
                CASE WHEN g % 20 = 0 THEN 'SHUTOFF' ELSE 'ACTIVE' END, now(), 0,
                jsonb_build_object('family', 'compute', 'flavorId', 'f' || (g % 40))
         FROM generate_series(1, ${instances}) AS g`,
          scope,
        );
        await database.query(
          `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
           "vcpuCapacity", "memoryCapacityBytes", "diskCapacityBytes", "lastSeenAt", "version", "facts")
         SELECT $1, $2, 'Flavor', 'RegionOne/f' || g, 'flavor-' || g, 'RegionOne',
                1 + (g % 16), (1 + (g % 32)) * 1073741824::bigint, 20 * 1073741824::bigint, now(), 0,
                jsonb_build_object('isPublic', true)
         FROM generate_series(0, 39) AS g`,
          scope,
        );
        await database.query(
          `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
           "openStackProjectId", "status", "diskCapacityBytes", "stateChangedAt", "lastSeenAt", "version", "facts")
         SELECT $1, $2, 'Volume', 'v-' || g, 'v-' || g, 'RegionOne', 'p-' || (g % ${projects}),
                CASE WHEN g % 10 = 0 THEN 'available' ELSE 'in-use' END,
                (1 + (g % 100)) * 1073741824::bigint, now() - interval '40 days', now(), 0,
                jsonb_build_object('volumeType', 'type-' || (g % 5), 'attachedToInstance',
                  CASE WHEN g % 10 = 0 THEN NULL ELSE 'x' END)
         FROM generate_series(1, 100000) AS g`,
          scope,
        );
        await database.query(
          `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "openStackProjectId",
           "status", "lastSeenAt", "version", "facts")
         SELECT $1, $2, 'Project', 'p-' || g, 'project-' || g, 'p-' || g, 'enabled', now(), 0,
                jsonb_build_object('domainId', 'd-' || (g % 50))
         FROM generate_series(0, ${projects - 1}) AS g`,
          scope,
        );
        await database.query(`ANALYZE "${schema}"."${TABLE}"`);
      };

      test("reads, writes and keeps a whole cloud within budget", async () => {
        await seed();
        const { projects, instances } = OPENSTACK_LARGE_CLOUD;

        /*
         * A worker pays for this once a cloud every quarter of an hour. These budgets are this test's,
         * and were not raised to pass.
         */
        const rows: FastestRun<OpenStackUsageRows> = await fastestRunAsync({
          run: () => {
            return OpenStackProjectUsageService.getUsageRows(SCOPE);
          },
          limitInMs: 5000,
        });

        expect(rows.inMs).toBeLessThan(5000);

        const holdings: ReturnType<typeof getOpenStackProjectHoldings> =
          getOpenStackProjectHoldings(rows.result);

        expect(holdings.length).toBe(projects);

        let counted: number = 0;

        for (const holding of holdings) {
          for (const line of holding.flavors) {
            counted += line.running + line.shutOff;
          }
        }

        expect(counted).toBe(instances);

        await readAt("2026-11-10T00:00:00.000Z");

        /*
         * What a reading asks of Postgres doesn't depend on the machine, so it's held exactly:
         *
         *    6  what each project holds
         *    2  the names of its projects and domains
         *    6  this month's 10,000 rows, 2,000 at a time, and the page that says there are no more
         *    1  last month's, of which there are none
         *    1  the same day last month, of which there's none, so this month's day isn't read
         *   20  this month's rows written back, 500 at a time
         *    1  the cloud's row, in the same transaction
         *
         * The waste rules read too, once an hour, and they read at the first reading above.
         */
        const statements: { calls: Array<unknown> } = jest.spyOn(
          database,
          "query",
        ).mock;
        const second: OpenStackUsageRefreshResult = await readAt(
          "2026-11-10T00:15:00.000Z",
          readOpenStackPriceList({ vcpuHour: 0.01, memoryGbHour: 0.005 }),
        );

        // One read of the cloud's own row by this test's readAt, before the reading itself.
        expect(statements.calls.length).toBe(1 + 6 + 2 + 6 + 1 + 1 + 20 + 1);

        /*
         * And what it takes: a whole reading, as a worker runs one every quarter of an hour. Each
         * attempt is the next reading, because each has to do all the work again.
         */
        let attempt: number = 0;
        const whole: FastestRun<OpenStackUsageRefreshResult> =
          await fastestRunAsync({
            run: () => {
              attempt++;
              return readAt(
                new Date(
                  new Date("2026-11-10T00:15:00.000Z").getTime() +
                    attempt * 15 * 60 * 1000,
                ).toISOString(),
                readOpenStackPriceList({ vcpuHour: 0.01, memoryGbHour: 0.005 }),
              );
            },
            limitInMs: 30000,
          });

        expect(whole.inMs).toBeLessThan(30000);

        // The rules' reads, once an hour, over every instance's row.
        const waste: FastestRun<OpenStackWasteRows> = await fastestRunAsync({
          run: () => {
            return OpenStackProjectUsageService.getWasteRows(SCOPE);
          },
          limitInMs: 5000,
        });

        expect(waste.inMs).toBeLessThan(5000);
        expect(waste.result.instancesNotSaying).toBe(instances);

        expect(second.wasSaved).toBe(true);
        expect(second.rowsWritten).toBe(projects);

        // The row the page reads stays small: under 2 MB, as the Capacity page's does.
        expect(JSON.stringify(second.snapshot).length).toBeLessThan(
          2 * 1024 * 1024,
        );
        expect(second.snapshot.projectCount).toBe(projects);
        expect(second.snapshot.domainCount).toBe(50);
        expect(second.snapshot.flavorCount).toBe(40);
        expect(second.snapshot.growers.length).toBeLessThanOrEqual(10);
        // Every instance held for a quarter hour.
        expect(second.snapshot.usage.instanceHours).toBeCloseTo(
          instances * 0.25,
          2,
        );

        const countOfRows: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${USAGE}" WHERE "period" = '2026-11'`,
        );

        expect(Number(countOfRows[0]!.count)).toBe(projects);
      }, 600000);
    });
  },
);
