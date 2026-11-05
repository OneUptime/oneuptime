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
import OpenStackResourceService, {
  OpenStackCapacityRows,
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import MetricService from "../../../Server/Services/MetricService";
import logger from "../../../Server/Utils/Logger";
import OpenStackCapacityRefresh, {
  OpenStackCapacityRefreshResult,
} from "../../../Server/Utils/OpenStack/OpenStackCapacityRefresh";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackCapacitySnapshot,
  buildOpenStackCapacitySnapshot,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import {
  OpenStackInstancesOnHost,
  OpenStackInventoryField,
  getOpenStackInventoryFactKey,
  getOpenStackInventorySeenHour,
} from "../../../Types/OpenStack/OpenStackCapacity";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_LARGE_CLOUD } from "../../../Types/OpenStack/OpenStackScale";
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";

/*
 * The reads the worker's capacity refresh stands on, on Postgres: hand-written SQL over the facts
 * column, which only a real database can prove. Opt in as OpenStackResourcePostgres.test.ts does
 * (RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true and OPENSTACK_INVENTORY_TEST_DATABASE_*), against a
 * database with the migrations applied. It works on a structure-only clone in a schema of its
 * own, dropped afterwards.
 *
 * What it pins:
 *   - only this cloud's hosts, flavors, pools and external networks are read, with numbers as
 *     numbers;
 *   - instances are counted per region, host and flavor, with what is on its way somewhere apart;
 *   - a host whose Placement numbers came in several batches gets its capacity once they are all
 *     on the row, and only what differs is written;
 *   - at the largest size tested, it reads within a stated budget, and the row the page reads
 *     stays small.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OpenStackResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OTHER_CLOUD_ID: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const SEEN_HOUR: number = getOpenStackInventorySeenHour(new Date());
const SCOPE: { projectId: ObjectID; openStackCloudId: ObjectID } = {
  projectId: PROJECT_ID,
  openStackCloudId: CLOUD_ID,
};

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
    lastSeenAt: NOW,
    ...overrides,
  };
}

function hypervisor(
  name: string,
  facts: JSONObject = {},
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Hypervisor,
    externalId: `RegionOne/${name}`,
    name,
    hypervisorName: name,
    status: "up",
    adminState: "enabled",
    facts,
    ...overrides,
  });
}

function inventory(
  resourceClass: string,
  numbers: Partial<Record<OpenStackInventoryField, number>>,
): JSONObject {
  const facts: JSONObject = {};

  for (const [field, value] of Object.entries(numbers)) {
    facts[
      getOpenStackInventoryFactKey(
        resourceClass,
        field as OpenStackInventoryField,
      )
    ] = value;
  }

  return facts;
}

function instanceOn(
  id: string,
  host: string,
  flavorId: string,
  status: string = "ACTIVE",
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Instance,
    externalId: id,
    name: id,
    hypervisorName: host,
    status,
    facts: { flavorId },
  });
}

describePostgres("what the capacity refresh reads, on Postgres", () => {
  const schema: string = `openstack_capacity_${Date.now()}`;
  let database: DataSource;

  type Row = Record<string, unknown>;

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

  const hostRow: (name: string) => Promise<Row> = async (
    name: string,
  ): Promise<Row> => {
    const rows: Array<Row> = await database.query(
      `SELECT "vcpuCapacity", "memoryCapacityBytes", "diskCapacityBytes", "updatedAt", "version"
       FROM "${schema}"."${TABLE}"
       WHERE "openStackCloudId" = $1 AND "kind" = $2 AND "hypervisorName" = $3`,
      [CLOUD_ID.toString(), OpenStackResourceKind.Hypervisor, name],
    );
    return rows[0]!;
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
      extra: { options: `-c search_path=${schema},pg_catalog` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of [TABLE, "OpenStackCloud"]) {
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
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
    await database.query(`DELETE FROM "${schema}"."OpenStackCloud"`);
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

  describe("the rows a sum is worked out from", () => {
    test("are this cloud's own, of the four kinds it needs, with numbers as numbers", async () => {
      await write([
        hypervisor(
          "cmp-1.example.org",
          inventory("VCPU", {
            total: 16,
            reserved: 0,
            ratio: 4,
            used: 3,
            seen: SEEN_HOUR,
          }),
          {
            availabilityZone: "zone-a",
            memoryCapacityBytes: 34359738368,
            instanceCount: 3,
          },
        ),
        resource({
          kind: OpenStackResourceKind.Flavor,
          externalId: "RegionOne/f1",
          name: "m1.small",
          memoryCapacityBytes: 2147483648,
          diskCapacityBytes: 21474836480,
          vcpuCapacity: 1,
          facts: { isPublic: true },
        }),
        resource({
          kind: OpenStackResourceKind.StoragePool,
          externalId: "RegionOne/pool",
          name: "ceph",
          diskCapacityBytes: 1099511627776,
          diskAllocatedBytes: 549755813888,
        }),
        resource({
          kind: OpenStackResourceKind.Network,
          externalId: "public",
          name: "public",
          facts: { isExternal: true, ipUsed: 3, ipTotal: 253 },
        }),
        resource({
          kind: OpenStackResourceKind.Network,
          externalId: "private",
          name: "private",
          facts: { isExternal: false },
        }),
        // Never read: an instance is a row of its own count, and there are 200,000 of them.
        instanceOn("i-1", "cmp-1.example.org", "f1"),
      ]);
      await write([hypervisor("cmp-elsewhere.example.org")], OTHER_CLOUD_ID);

      const rows: OpenStackCapacityRows =
        await OpenStackResourceService.getCapacityRows(SCOPE);

      expect(
        rows.hypervisors.map((row: JSONObject) => {
          return row["hypervisorName"];
        }),
      ).toEqual(["cmp-1.example.org"]);
      expect(rows.hypervisors[0]!["availabilityZone"]).toBe("zone-a");
      // Postgres hands a bigint back as a string.
      expect(rows.hypervisors[0]!["memoryCapacityBytes"]).toBe(34359738368);
      expect(rows.flavors[0]!["diskCapacityBytes"]).toBe(21474836480);
      expect(rows.storagePools[0]!["diskAllocatedBytes"]).toBe(549755813888);
      expect(
        rows.externalNetworks.map((row: JSONObject) => {
          return row["name"];
        }),
      ).toEqual(["public"]);

      // What the hosts' facts hold reads back as Placement said it.
      expect(
        readOpenStackCapacityHost(rows.hypervisors[0] as never).inventories[
          "VCPU"
        ],
      ).toMatchObject({ total: 16, reserved: 0, allocationRatio: 4, used: 3 });
    });

    test("what Placement holds of bare metal comes back with its numbers, and is no host", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.PlacementProvider,
          externalId: "RegionOne/1062b540-62b5-44a7-805f-212d8778807c",
          name: "1062b540-62b5-44a7-805f-212d8778807c",
          facts: {
            "inventory:CUSTOM_GOLD:total": 1,
            "inventory:CUSTOM_GOLD:reserved": 1,
            "inventory:CUSTOM_GOLD:ratio": 1,
            "inventory:CUSTOM_GOLD:used": 0,
          },
        }),
      ]);

      const rows: OpenStackCapacityRows =
        await OpenStackResourceService.getCapacityRows(SCOPE);

      expect(rows.hypervisors).toEqual([]);
      expect(
        readOpenStackCapacityHost(rows.bareMetalProviders[0] as never),
      ).toMatchObject({
        name: "1062b540-62b5-44a7-805f-212d8778807c",
        state: "up",
        inventories: {
          CUSTOM_GOLD: { total: 1, reserved: 1, allocationRatio: 1, used: 0 },
        },
      });
    });

    test("a deleted row is no row", async () => {
      await write([hypervisor("cmp-1.example.org")]);
      await database.query(
        `UPDATE "${schema}"."${TABLE}" SET "deletedAt" = now() WHERE "openStackCloudId" = $1`,
        [CLOUD_ID.toString()],
      );

      expect(
        (await OpenStackResourceService.getCapacityRows(SCOPE)).hypervisors,
      ).toEqual([]);
    });
  });

  describe("instances on hosts", () => {
    test("counts per region, host and flavor, with what is on its way apart", async () => {
      await write([
        instanceOn("i-1", "cmp-1.example.org", "f1"),
        instanceOn("i-2", "cmp-1.example.org", "f1"),
        instanceOn("i-3", "cmp-1.example.org", "f1", "RESIZE"),
        instanceOn("i-4", "cmp-1.example.org", "f2"),
        instanceOn("i-5", "cmp-2.example.org", "f1", "MIGRATING"),
        // Not on a host at all: nothing to compare.
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "i-6",
          status: "ERROR",
          facts: { flavorId: "f1" },
        }),
      ]);
      await write(
        [instanceOn("i-7", "cmp-1.example.org", "f1")],
        OTHER_CLOUD_ID,
      );

      const rows: Array<OpenStackInstancesOnHost> | null =
        await OpenStackResourceService.getInstancesOnHosts(SCOPE);

      expect(
        rows!
          .map((row: OpenStackInstancesOnHost): string => {
            return `${row.regionName} ${row.hypervisorName} ${row.flavorId} ${row.count} ${row.movingCount}`;
          })
          .sort(),
      ).toEqual([
        "RegionOne cmp-1.example.org f1 3 1",
        "RegionOne cmp-1.example.org f2 1 0",
        "RegionOne cmp-2.example.org f1 1 1",
      ]);
    });
  });

  describe("a host's numbers parted by a collector's batches", () => {
    const allocatable: JSONObject = {
      ...inventory("VCPU", { total: 16, reserved: 1, ratio: 4 }),
      ...inventory("MEMORY_MB", { total: 8192, reserved: 512, ratio: 1.5 }),
      ...inventory("DISK_GB", { total: 100, reserved: 0, ratio: 1 }),
    };

    test("capacity is worked out once all three numbers are on the row", async () => {
      await write([
        hypervisor("cmp-1.example.org", {
          ...inventory("VCPU", { total: 16 }),
          ...inventory("MEMORY_MB", { total: 8192 }),
        }),
      ]);

      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      // Nothing yet: a host's total alone would read as 1:1, nothing reserved.
      expect(await hostRow("cmp-1.example.org")).toMatchObject({
        vcpuCapacity: null,
        memoryCapacityBytes: null,
        diskCapacityBytes: null,
      });

      await write([hypervisor("cmp-1.example.org", allocatable)]);
      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      const row: Row = await hostRow("cmp-1.example.org");

      // (16 - 1) * 4, (8192 - 512) * 1.5 MB and 100 GB.
      expect(row["vcpuCapacity"]).toBe(60);
      expect(Number(row["memoryCapacityBytes"])).toBe(11520 * 1024 * 1024);
      expect(Number(row["diskCapacityBytes"])).toBe(100 * 1024 * 1024 * 1024);
    });

    test("more reserved than there is leaves nothing, and never a negative", async () => {
      await write([
        hypervisor(
          "cmp-1.example.org",
          inventory("VCPU", { total: 4, reserved: 16, ratio: 4 }),
        ),
      ]);
      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      expect((await hostRow("cmp-1.example.org"))["vcpuCapacity"]).toBe(0);
    });

    test("a capacity already on the row stays until all a class's numbers say otherwise", async () => {
      await write([
        hypervisor("cmp-1.example.org", inventory("VCPU", { total: 16 }), {
          vcpuCapacity: 40,
        }),
      ]);
      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      expect((await hostRow("cmp-1.example.org"))["vcpuCapacity"]).toBe(40);
    });

    test("a reserved amount not read yet is no amount: its total and ratio don't make it 0", async () => {
      await write([
        hypervisor(
          "cmp-1.example.org",
          inventory("VCPU", { total: 16, ratio: 4 }),
        ),
      ]);
      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      expect((await hostRow("cmp-1.example.org"))["vcpuCapacity"]).toBe(null);
    });

    test("a second pass over the same numbers writes nothing", async () => {
      await write([hypervisor("cmp-1.example.org", allocatable)]);
      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      const before: Row = await hostRow("cmp-1.example.org");

      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      const after: Row = await hostRow("cmp-1.example.org");

      expect(after["updatedAt"]).toEqual(before["updatedAt"]);
    });

    test("leaves another host, and another cloud's, alone", async () => {
      await write([
        hypervisor("cmp-1.example.org", allocatable),
        hypervisor("cmp-2.example.org", allocatable),
      ]);
      await write(
        [hypervisor("cmp-1.example.org", allocatable)],
        OTHER_CLOUD_ID,
      );

      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: ["cmp-1.example.org"],
      });

      expect((await hostRow("cmp-2.example.org"))["vcpuCapacity"]).toBe(null);

      const other: Array<Row> = await database.query(
        `SELECT "vcpuCapacity" FROM "${schema}"."${TABLE}" WHERE "openStackCloudId" = $1`,
        [OTHER_CLOUD_ID.toString()],
      );

      expect(other[0]!["vcpuCapacity"]).toBe(null);
    });

    test("no hosts asks nothing", async () => {
      const query: jest.SpiedFunction<typeof database.query> = jest.spyOn(
        database,
        "query",
      );

      await OpenStackResourceService.reconcileHypervisorCapacity({
        ...SCOPE,
        hypervisorNames: [],
      });

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("the worker's whole refresh, with only the metric store stood in for", () => {
    test("is worked out from the rows, kept on the cloud, and reads nothing it isn't due", async () => {
      const metricReads: jest.SpiedFunction<typeof MetricService.aggregateBy> =
        jest.spyOn(MetricService, "aggregateBy").mockResolvedValue({
          data: [],
        } as never);
      const host: (used: {
        vcpus: number;
        memoryMb: number;
        diskGb: number;
      }) => JSONObject = (used: {
        vcpus: number;
        memoryMb: number;
        diskGb: number;
      }): JSONObject => {
        return {
          ...inventory("VCPU", {
            total: 16,
            reserved: 0,
            ratio: 4,
            used: used.vcpus,
          }),
          ...inventory("MEMORY_MB", {
            total: 8192,
            reserved: 512,
            ratio: 1,
            used: used.memoryMb,
          }),
          ...inventory("DISK_GB", {
            total: 100,
            reserved: 0,
            ratio: 1,
            used: used.diskGb,
          }),
        };
      };

      await database.query(
        `INSERT INTO "${schema}"."OpenStackCloud"
          ("_id", "projectId", "name", "slug", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, 'acme', 'acme', now(), now(), 1)`,
        [CLOUD_ID.toString(), PROJECT_ID.toString()],
      );
      await write([
        hypervisor(
          "cmp-1.example.org",
          host({ vcpus: 1, memoryMb: 2048, diskGb: 20 }),
          { availabilityZone: "zone-a", instanceCount: 1 },
        ),
        hypervisor(
          "cmp-2.example.org",
          host({ vcpus: 0, memoryMb: 0, diskGb: 0 }),
          { availabilityZone: "zone-a", instanceCount: 0 },
        ),
        resource({
          kind: OpenStackResourceKind.Flavor,
          externalId: "RegionOne/f1",
          name: "m1.small",
          vcpuCapacity: 1,
          memoryCapacityBytes: 2048 * 1024 * 1024,
          diskCapacityBytes: 20 * 1024 * 1024 * 1024,
          facts: { isPublic: true },
        }),
        instanceOn("i-1", "cmp-1.example.org", "f1"),
      ]);

      const first: OpenStackCapacityRefreshResult =
        await OpenStackCapacityRefresh.refresh({
          ...SCOPE,
          cloudName: "acme",
          previous: null,
          now: NOW,
        });
      const smallFirst: OpenStackCapacitySnapshot["flavors"][number] =
        first.snapshot.flavors[0]!;

      // (8192 - 512 - 2048) / 2048 on one, and (8192 - 512) / 2048 on the other.
      expect(smallFirst.fits).toBe(5);
      expect(smallFirst.instanceCount).toBe(1);
      expect(first.snapshot.zones[0]!.hostCount).toBe(2);

      // A new cloud: the store has nothing, so each says it can't tell yet.
      expect(first.snapshot.forecasts.length).toBeGreaterThan(0);

      for (const row of first.snapshot.forecasts) {
        expect(row.forecast.state).toBe("not-enough-history");
      }

      expect(first.snapshot.forecastsReadAt).toBe(NOW.toISOString());
      expect(first.snapshot.mismatchesCheckedAt).toBe(NOW.toISOString());
      expect(first.snapshot.mismatches).toEqual([]);
      expect(JSON.stringify(first.resourceMetrics)).toContain(
        "openstack_capacity_flavor_fits",
      );

      const readsOfFirst: number = metricReads.mock.calls.length;

      expect(readsOfFirst).toBeGreaterThan(0);

      await OpenStackCapacityRefresh.save({
        openStackCloudId: CLOUD_ID,
        snapshot: first.snapshot,
      });

      const saved: Array<Row> = await database.query(
        `SELECT "capacitySnapshot" FROM "${schema}"."OpenStackCloud" WHERE "_id" = $1`,
        [CLOUD_ID.toString()],
      );

      expect(saved[0]!["capacitySnapshot"]).toEqual(
        JSON.parse(JSON.stringify(first.snapshot)),
      );

      // The next run, two minutes on, as the worker makes it: from what it kept on the cloud.
      const instancesRead: jest.SpiedFunction<
        typeof OpenStackResourceService.getInstancesOnHosts
      > = jest.spyOn(OpenStackResourceService, "getInstancesOnHosts");
      const next: OpenStackCapacityRefreshResult =
        await OpenStackCapacityRefresh.refresh({
          ...SCOPE,
          cloudName: "acme",
          previous: saved[0]!["capacitySnapshot"] as OpenStackCapacitySnapshot,
          now: new Date(NOW.getTime() + 2 * 60 * 1000),
        });

      expect(instancesRead).not.toHaveBeenCalled();
      expect(metricReads.mock.calls.length).toBe(readsOfFirst);
      expect(next.snapshot.flavors[0]!.fits).toBe(5);
      expect(next.snapshot.flavors[0]!.instanceCount).toBe(1);
      expect(next.snapshot.forecasts).toEqual(first.snapshot.forecasts);
      expect(next.snapshot.forecastsReadAt).toBe(NOW.toISOString());
      expect(next.snapshot.mismatchesCheckedAt).toBe(NOW.toISOString());
    });
  });

  describe("at the largest size tested", () => {
    const seed: () => Promise<void> = async (): Promise<void> => {
      const { hypervisors, instances } = OPENSTACK_LARGE_CLOUD;
      const scope: Array<string> = [PROJECT_ID.toString(), CLOUD_ID.toString()];

      await database.query(
        `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
           "hypervisorName", "status", "lastSeenAt", "version", "facts")
         SELECT $1, $2, 'Instance', 'i-' || g, 'i-' || g, 'RegionOne',
                'compute-' || (g % ${hypervisors}) || '.example.org',
                CASE WHEN g % 500 = 0 THEN 'RESIZE' ELSE 'ACTIVE' END, now(), 0,
                jsonb_build_object('family', 'compute', 'flavorId', 'f' || (g % 40))
         FROM generate_series(1, ${instances}) AS g`,
        scope,
      );
      await database.query(
        `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
           "availabilityZone", "hypervisorName", "status", "adminState", "instanceCount", "lastSeenAt",
           "version", "facts")
         SELECT $1, $2, 'Hypervisor', 'RegionOne/compute-' || g, 'compute-' || g, 'RegionOne',
                'zone-' || (g % 20), 'compute-' || g || '.example.org', 'up', 'enabled', 40, now(), 0,
                jsonb_build_object(
                  'aggregates', 'rack-' || (g % 100),
                  '${getOpenStackInventoryFactKey("VCPU", "seen")}', ${SEEN_HOUR},
                  '${getOpenStackInventoryFactKey("MEMORY_MB", "seen")}', ${SEEN_HOUR},
                  '${getOpenStackInventoryFactKey("DISK_GB", "seen")}', ${SEEN_HOUR},
                  '${getOpenStackInventoryFactKey("VCPU", "total")}', 64,
                  '${getOpenStackInventoryFactKey("VCPU", "reserved")}', 0,
                  '${getOpenStackInventoryFactKey("VCPU", "ratio")}', 4,
                  '${getOpenStackInventoryFactKey("VCPU", "used")}', 80,
                  '${getOpenStackInventoryFactKey("MEMORY_MB", "total")}', 262144,
                  '${getOpenStackInventoryFactKey("MEMORY_MB", "reserved")}', 2048,
                  '${getOpenStackInventoryFactKey("MEMORY_MB", "ratio")}', 1,
                  '${getOpenStackInventoryFactKey("MEMORY_MB", "used")}', 100000,
                  '${getOpenStackInventoryFactKey("DISK_GB", "total")}', 2000,
                  '${getOpenStackInventoryFactKey("DISK_GB", "reserved")}', 0,
                  '${getOpenStackInventoryFactKey("DISK_GB", "ratio")}', 1,
                  '${getOpenStackInventoryFactKey("DISK_GB", "used")}', 800
                )
         FROM generate_series(1, ${hypervisors}) AS g`,
        scope,
      );
      await database.query(
        `INSERT INTO "${schema}"."${TABLE}"
          ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
           "vcpuCapacity", "memoryCapacityBytes", "diskCapacityBytes", "lastSeenAt", "version", "facts")
         SELECT $1, $2, 'Flavor', 'RegionOne/f' || g, 'flavor-' || g, 'RegionOne',
                1 + (g % 16), (1 + (g % 32)) * 1073741824::bigint, 20 * 1073741824::bigint, now(), 0,
                jsonb_build_object('isPublic', true)
         FROM generate_series(1, 40) AS g`,
        scope,
      );
      await database.query(`ANALYZE "${schema}"."${TABLE}"`);
    };

    test("reads a whole cloud within budget, and the row it writes stays small", async () => {
      await seed();

      /*
       * A worker pays for this once a cloud every two minutes. The rest of the refresh is sums.
       * Both budgets are this test's, and were not raised to pass: see FastestRun on why each
       * attempt repeats the whole read.
       */
      const rows: FastestRun<OpenStackCapacityRows> = await fastestRunAsync({
        run: () => {
          return OpenStackResourceService.getCapacityRows(SCOPE);
        },
        limitInMs: 2000,
      });

      expect(rows.inMs).toBeLessThan(2000);
      expect(rows.result.hypervisors).toHaveLength(
        OPENSTACK_LARGE_CLOUD.hypervisors,
      );
      expect(rows.result.flavors).toHaveLength(40);

      // Every 15 minutes, and over every instance's row, so never on the page's own time.
      const onHosts: FastestRun<Array<OpenStackInstancesOnHost> | null> =
        await fastestRunAsync({
          run: () => {
            return OpenStackResourceService.getInstancesOnHosts(SCOPE);
          },
          limitInMs: 5000,
        });

      expect(onHosts.inMs).toBeLessThan(5000);

      let counted: number = 0;

      for (const row of onHosts.result!) {
        counted += row.count;
      }

      expect(counted).toBe(OPENSTACK_LARGE_CLOUD.instances);

      const reconcile: FastestRun<void> = await fastestRunAsync({
        run: () => {
          return OpenStackResourceService.reconcileHypervisorCapacity({
            ...SCOPE,
            hypervisorNames: rows.result.hypervisors.map(
              (row: JSONObject): string => {
                return row["hypervisorName"] as string;
              },
            ),
          });
        },
        limitInMs: 5000,
      });

      expect(reconcile.inMs).toBeLessThan(5000);

      const snapshot: OpenStackCapacitySnapshot =
        buildOpenStackCapacitySnapshot({
          hosts: rows.result.hypervisors.map((row: JSONObject) => {
            return readOpenStackCapacityHost(row as never);
          }),
          flavors: rows.result.flavors.map((row: JSONObject) => {
            return readOpenStackCapacityFlavor({
              row: row as never,
              instanceCount: 0,
            });
          }),
          pools: [],
          now: NOW,
        });

      expect(snapshot.cloud.hostCount).toBe(OPENSTACK_LARGE_CLOUD.hypervisors);
      // One row, read once per page load, whichever size the cloud is.
      expect(JSON.stringify(snapshot).length).toBeLessThan(2 * 1024 * 1024);
    }, 600000);
  });
});
