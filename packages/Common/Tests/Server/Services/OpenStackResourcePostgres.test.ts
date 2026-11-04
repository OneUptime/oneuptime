import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackInventorySummary,
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackBlastRadius } from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackRegionSummary,
  OpenStackTopConsumer,
  OpenStackTopConsumers,
} from "../../../Types/OpenStack/OpenStackOverview";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import { DataSource } from "typeorm";

/*
 * The OpenStack inventory's hand-written SQL, executed on Postgres against the
 * migrated "OpenStackResource" table.
 *
 * Opt in with RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true against a database the
 * registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_HOST=127.0.0.1 \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/OpenStackResourcePostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped. CI runs it in
 * .github/workflows/postgres-schema-drift.yaml, right after that job has applied
 * every registered migration to an empty database.
 *
 * It works on a structure-only clone (LIKE ... INCLUDING ALL, so the unique index
 * ON CONFLICT names comes along) in a uniquely named schema, dropped afterwards.
 * LIKE copies no foreign key, so no Project or OpenStackCloud row is needed.
 *
 * What it pins:
 *   - bulkUpsert inserts, merges a newer batch (a null never blanks a value, facts
 *     merge key by key), ignores an older batch outright, and writes more than a
 *     chunk of rows;
 *   - stateChangedAt moves only when the status really changes, which is what the
 *     stuck-state rules read;
 *   - a tenant's oversized name is clamped rather than losing the scrape;
 *   - getBlastRadius counts what a failed part reaches, by project, across Nova's two
 *     names for one host, and says when what was collected cannot tell;
 *   - getInventorySummary counts from the rows: a service someone disabled is not
 *     down, capacity comes only from hypervisors and pools, and another cloud's or
 *     project's rows never count;
 *   - a region reads only itself, with what is Keystone's: its summary, what needs
 *     attention in it however much is wrong elsewhere, and who holds the most of it;
 *   - deleteStaleForCloud removes only what its own service's good scrape left
 *     behind: a failing Nova keeps its instances, a good Nova removes what it no
 *     longer reports, each region answers for itself, and each family of workers
 *     answers to its own API;
 *   - the table holds 500,000 rows of one cloud, upserted and read within a stated
 *     budget, because that is a cloud OpenStack's largest operators really run.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OpenStackResource";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OTHER_CLOUD_ID: ObjectID = ObjectID.generate();

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

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

function api(
  service: OpenStackServiceType,
  overrides: Partial<ParsedOpenStackResource> & { vouchedAt?: Date } = {},
): ParsedOpenStackResource {
  const { vouchedAt, ...rest } = overrides;
  return resource({
    kind: OpenStackResourceKind.Api,
    externalId: `${rest.regionName || "RegionOne"}/${service}`,
    name: service,
    status: "up",
    facts: { vouchedAt: (vouchedAt || NOW).toISOString() },
    ...rest,
  });
}

describePostgres("OpenStackResourceService on Postgres", () => {
  const schema: string = `openstack_inventory_${Date.now()}`;
  let database: DataSource;

  type Row = Record<string, unknown>;

  const write = async (
    resources: Array<ParsedOpenStackResource>,
    cloudId: ObjectID = CLOUD_ID,
    projectId: ObjectID = PROJECT_ID,
  ): Promise<void> => {
    await OpenStackResourceService.bulkUpsert({
      projectId,
      openStackCloudId: cloudId,
      resources,
    });
  };

  const rowOf = async (
    kind: OpenStackResourceKind,
    externalId: string,
  ): Promise<Row> => {
    const rows: Array<Row> = await database.query(
      `SELECT * FROM "${schema}"."${TABLE}"
       WHERE "openStackCloudId" = $1 AND "kind" = $2 AND "externalId" = $3`,
      [CLOUD_ID.toString(), kind, externalId],
    );
    expect(rows).toHaveLength(1);
    return rows[0] as Row;
  };

  const externalIds = async (kind: OpenStackResourceKind): Promise<Array<string>> => {
    const rows: Array<{ externalId: string }> = await database.query(
      `SELECT "externalId" FROM "${schema}"."${TABLE}"
       WHERE "openStackCloudId" = $1 AND "kind" = $2 ORDER BY "externalId"`,
      [CLOUD_ID.toString(), kind],
    );
    return rows.map((row: { externalId: string }) => {
      return row.externalId;
    });
  };

  const summary = async (): Promise<OpenStackInventorySummary> => {
    return await OpenStackResourceService.getInventorySummary({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
    });
  };

  const sweep = async (): Promise<number> => {
    return await OpenStackResourceService.deleteStaleForCloud({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
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
      extra: { options: `-c search_path=${schema},pg_catalog` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
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
  });

  afterEach(() => {
    delete process.env["OPENSTACK_INVENTORY_STALE_MINUTES"];
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

  describe("bulkUpsert", () => {
    test("inserts a row with every column it was given", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          name: "compute-01",
          availabilityZone: "az-1",
          hypervisorName: "compute-01",
          vcpuCapacity: 128,
          vcpuAllocated: 16,
          memoryCapacityBytes: 64 * 1024 * 1024 * 1024,
          memoryAllocatedBytes: 8 * 1024 * 1024 * 1024,
          instanceCount: 7,
          facts: { aggregates: "ssd" },
        }),
      ]);
      const row: Row = await rowOf(
        OpenStackResourceKind.Hypervisor,
        "RegionOne/compute-01",
      );
      expect(row["name"]).toBe("compute-01");
      expect(row["regionName"]).toBe("RegionOne");
      expect(row["availabilityZone"]).toBe("az-1");
      expect(row["vcpuCapacity"]).toBe(128);
      expect(String(row["memoryCapacityBytes"])).toBe(
        String(64 * 1024 * 1024 * 1024),
      );
      expect(row["instanceCount"]).toBe(7);
      expect(row["facts"]).toEqual({ aggregates: "ssd" });
    });

    test("a null in a newer batch never blanks a value, and facts merge key by key", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          name: "compute-01",
          vcpuCapacity: 128,
          facts: { aggregates: "ssd", allocationRatios: { VCPU: 4 } },
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          instanceCount: 3,
          facts: { libvirtName: "instance-00000001" },
          lastSeenAt: at(MINUTE_MS),
        }),
      ]);
      const row: Row = await rowOf(
        OpenStackResourceKind.Hypervisor,
        "RegionOne/compute-01",
      );
      expect(row["name"]).toBe("compute-01");
      expect(row["vcpuCapacity"]).toBe(128);
      expect(row["instanceCount"]).toBe(3);
      expect(row["facts"]).toEqual({
        aggregates: "ssd",
        allocationRatios: { VCPU: 4 },
        libvirtName: "instance-00000001",
      });
      expect(new Date(row["lastSeenAt"] as string)).toEqual(at(MINUTE_MS));
    });

    test("an older batch changes nothing", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-1",
          status: "ACTIVE",
          lastSeenAt: at(MINUTE_MS),
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-1",
          status: "BUILD",
          lastSeenAt: at(-MINUTE_MS),
        }),
      ]);
      const row: Row = await rowOf(OpenStackResourceKind.Instance, "uuid-1");
      expect(row["status"]).toBe("ACTIVE");
      expect(new Date(row["lastSeenAt"] as string)).toEqual(at(MINUTE_MS));
    });

    test("stateChangedAt moves only when the status changes, which is how long a part has been stuck", async () => {
      const seen = async (status: string, offset: number): Promise<Date> => {
        await write([
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "vol-1",
            status,
            lastSeenAt: at(offset),
          }),
        ]);
        const row: Row = await rowOf(OpenStackResourceKind.Volume, "vol-1");
        return new Date(row["stateChangedAt"] as string);
      };

      expect(await seen("attaching", 0)).toEqual(at(0));
      expect(await seen("attaching", 5 * MINUTE_MS)).toEqual(at(0));
      expect(await seen("attaching", 30 * MINUTE_MS)).toEqual(at(0));
      expect(await seen("in-use", 31 * MINUTE_MS)).toEqual(at(31 * MINUTE_MS));
    });

    test("disabling a service moves stateChangedAt too, which is how long it has been disabled", async () => {
      const id: string = "RegionOne/compute/compute-01/nova-compute";
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status: "up",
          adminState: "enabled",
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status: "up",
          adminState: "disabled",
          lastSeenAt: at(5 * MINUTE_MS),
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status: "up",
          adminState: "disabled",
          lastSeenAt: at(10 * MINUTE_MS),
        }),
      ]);
      const row: Row = await rowOf(OpenStackResourceKind.Service, id);
      expect(new Date(row["stateChangedAt"] as string)).toEqual(
        at(5 * MINUTE_MS),
      );
    });

    test("a batch that does not mention the status leaves when it changed alone", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          status: "up",
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          status: null,
          lastSeenAt: at(MINUTE_MS),
        }),
      ]);
      const row: Row = await rowOf(
        OpenStackResourceKind.Hypervisor,
        "RegionOne/compute-01",
      );
      expect(row["status"]).toBe("up");
      expect(new Date(row["stateChangedAt"] as string)).toEqual(at(0));
    });

    test("an enabled service clears the reason it was disabled for, and a batch silent on it keeps it", async () => {
      const id: string = "RegionOne/compute/compute-01/nova-compute";
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status: "up",
          adminState: "disabled",
          disabledReason: "replacing a DIMM",
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status: "up",
          lastSeenAt: at(MINUTE_MS),
        }),
      ]);
      expect(
        (await rowOf(OpenStackResourceKind.Service, id))["disabledReason"],
      ).toBe("replacing a DIMM");

      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status: "up",
          adminState: "enabled",
          lastSeenAt: at(2 * MINUTE_MS),
        }),
      ]);
      const row: Row = await rowOf(OpenStackResourceKind.Service, id);
      expect(row["adminState"]).toBe("enabled");
      expect(row["disabledReason"]).toBeNull();
    });

    test("clamps a tenant's long name instead of losing the scrape it rides in", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-1",
          name: "x".repeat(5000),
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-2",
          name: "short",
        }),
      ]);
      const row: Row = await rowOf(OpenStackResourceKind.Instance, "uuid-1");
      expect((row["name"] as string).length).toBeLessThanOrEqual(100);
      expect(await externalIds(OpenStackResourceKind.Instance)).toEqual([
        "uuid-1",
        "uuid-2",
      ]);
    });

    test("writes more than a chunk of rows", async () => {
      const rows: Array<ParsedOpenStackResource> = [];
      for (let i: number = 0; i < 1234; i++) {
        rows.push(
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: `uuid-${i}`,
            status: "ACTIVE",
          }),
        );
      }
      await write(rows);
      expect((await summary()).instanceCount).toBe(1234);
    });

    test("nothing to write runs no statement", async () => {
      const query: jest.SpyInstance = jest.spyOn(database.manager, "query");
      await write([]);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("getInventorySummary", () => {
    test("counts from the rows, for this cloud of this project only", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        api(OpenStackServiceType.Compute, { regionName: "RegionTwo" }),
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          availabilityZone: "az-1",
          vcpuCapacity: 100,
          vcpuAllocated: 40,
          memoryCapacityBytes: 2000,
          memoryAllocatedBytes: 500,
        }),
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionTwo/compute-01",
          regionName: "RegionTwo",
          availabilityZone: "az-2",
          vcpuCapacity: 50,
          vcpuAllocated: 10,
          memoryCapacityBytes: 1000,
          memoryAllocatedBytes: 100,
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-1",
          status: "ACTIVE",
          // An instance's flavor is no capacity of the cloud.
          vcpuCapacity: 9999,
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-2",
          status: "ERROR",
        }),
        resource({
          kind: OpenStackResourceKind.StoragePool,
          externalId: "RegionOne/rbd",
          diskCapacityBytes: 10000,
          diskAllocatedBytes: 2500,
        }),
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "vol-1",
          // A volume's size is not more storage.
          diskCapacityBytes: 77777,
        }),
        resource({ kind: OpenStackResourceKind.Network, externalId: "net-1" }),
        resource({ kind: OpenStackResourceKind.Router, externalId: "r-1" }),
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-1",
        }),
        resource({
          kind: OpenStackResourceKind.Project,
          externalId: "p-1",
          regionName: null,
        }),
      ]);
      await write(
        [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: "other-cloud",
            status: "ACTIVE",
          }),
        ],
        OTHER_CLOUD_ID,
      );
      await write(
        [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: "other-project",
            status: "ACTIVE",
          }),
        ],
        CLOUD_ID,
        OTHER_PROJECT_ID,
      );

      expect(await summary()).toEqual({
        regionCount: 2,
        availabilityZoneCount: 2,
        hypervisorCount: 2,
        instanceCount: 2,
        activeInstanceCount: 1,
        volumeCount: 1,
        networkCount: 1,
        routerCount: 1,
        floatingIpCount: 1,
        projectCount: 1,
        serviceCount: 0,
        downServiceCount: 0,
        vcpuCapacity: 150,
        vcpuAllocated: 50,
        memoryCapacityBytes: 3000,
        memoryAllocatedBytes: 600,
        storageCapacityBytes: 10000,
        storageUsedBytes: 2500,
      });
    });

    test("a service someone disabled is not down, in Nova's words or Neutron's", async () => {
      const service = (
        id: string,
        status: string,
        adminState: string,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          status,
          adminState,
        });
      };
      await write([
        service("a", "up", "enabled"),
        service("b", "down", "enabled"),
        service("c", "down", "disabled"),
        service("d", "down", "up"),
        service("e", "down", "down"),
      ]);
      const result: OpenStackInventorySummary = await summary();
      expect(result.serviceCount).toBe(5);
      expect(result.downServiceCount).toBe(2);
    });

    /*
     * Nova keeps reporting a lost hypervisor's last numbers, and those must never read
     * as room to spare. Seen on a real cloud with nova-compute stopped.
     */
    test("a hypervisor that cannot take instances is no capacity", async () => {
      const hypervisor = (
        id: string,
        status: string,
        adminState: string,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: id,
          status,
          adminState,
          vcpuCapacity: 100,
          vcpuAllocated: 10,
          memoryCapacityBytes: 1000,
          memoryAllocatedBytes: 100,
          diskCapacityBytes: 500,
          diskAllocatedBytes: 50,
        });
      };
      await write([
        hypervisor("a", "up", "enabled"),
        hypervisor("lost", "down", "enabled"),
        hypervisor("planned", "up", "disabled"),
        // Not reported yet: its numbers are all there is to go on.
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "no-state",
          vcpuCapacity: 7,
          vcpuAllocated: 1,
        }),
      ]);
      const result: OpenStackInventorySummary = await summary();
      expect(result.hypervisorCount).toBe(4);
      expect(result.vcpuCapacity).toBe(107);
      expect(result.vcpuAllocated).toBe(11);
      expect(result.memoryCapacityBytes).toBe(1000);
      expect(result.memoryAllocatedBytes).toBe(100);
    });

    test("Nova's internal zone is not a zone, and neither is another service's", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/compute/control/nova-conductor",
          availabilityZone: "internal",
          facts: { family: "compute" },
        }),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/compute/compute-01/nova-compute",
          availabilityZone: "nova",
          facts: { family: "compute" },
        }),
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01",
          availabilityZone: "nova",
        }),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/volume/cinder/cinder-volume",
          availabilityZone: "storage-zone",
          facts: { family: "volume" },
        }),
      ]);
      expect((await summary()).availabilityZoneCount).toBe(1);
    });

    test("an empty cloud is all zeros, not an error", async () => {
      const result: OpenStackInventorySummary = await summary();
      expect(result.instanceCount).toBe(0);
      expect(result.vcpuCapacity).toBe(0);
      expect(result.regionCount).toBe(0);
    });
  });

  describe("a cloud's regions", () => {
    const worker = (
      regionName: string,
      binary: string,
      overrides: Partial<ParsedOpenStackResource> = {},
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Service,
        externalId: `${regionName}/compute/c-1/${binary}`,
        name: binary,
        regionName,
        status: "up",
        adminState: "enabled",
        facts: { family: "compute", host: "c-1" },
        ...overrides,
      });
    };

    const hypervisor = (
      regionName: string,
      host: string,
      overrides: Partial<ParsedOpenStackResource> = {},
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Hypervisor,
        externalId: `${regionName}/${host}`,
        name: host,
        regionName,
        status: "up",
        adminState: "enabled",
        vcpuCapacity: 100,
        vcpuAllocated: 40,
        memoryCapacityBytes: 2000,
        memoryAllocatedBytes: 500,
        ...overrides,
      });
    };

    const pool = (
      regionName: string,
      capacity: number,
      used: number,
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.StoragePool,
        externalId: `${regionName}/rbd`,
        name: "rbd",
        regionName,
        diskCapacityBytes: capacity,
        diskAllocatedBytes: used,
      });
    };

    const instance = (
      externalId: string,
      regionName: string,
      projectId: string | null = null,
      status: string = "ACTIVE",
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Instance,
        externalId,
        name: externalId,
        regionName,
        status,
        openStackProjectId: projectId,
      });
    };

    const volume = (
      externalId: string,
      regionName: string,
      projectId: string,
      size: number,
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Volume,
        externalId,
        regionName,
        status: "available",
        openStackProjectId: projectId,
        diskCapacityBytes: size,
      });
    };

    // Keystone's: a project and a domain belong to the cloud, and to no region of it.
    const keystone = (
      kind: OpenStackResourceKind,
      externalId: string,
      name: string,
    ): ParsedOpenStackResource => {
      return resource({ kind, externalId, name, regionName: null });
    };

    const TWO_REGIONS = (): Array<ParsedOpenStackResource> => {
      return [
        api(OpenStackServiceType.Compute),
        api(OpenStackServiceType.Volume, { status: "down", facts: {} }),
        api(OpenStackServiceType.Compute, { regionName: "RegionTwo" }),
        worker("RegionOne", "nova-compute"),
        worker("RegionOne", "nova-scheduler", { status: "down" }),
        // Someone disabled it: planned work, and not down in either service's word.
        worker("RegionOne", "nova-conductor", {
          status: "down",
          adminState: "disabled",
        }),
        worker("RegionOne", "neutron-l3-agent", {
          status: "down",
          adminState: "down",
        }),
        worker("RegionTwo", "nova-compute"),
        hypervisor("RegionOne", "c-1"),
        // Lost: its numbers are last known, and it is no capacity anyone can use.
        hypervisor("RegionOne", "c-2", {
          status: "down",
          vcpuCapacity: 1000,
          vcpuAllocated: 990,
        }),
        hypervisor("RegionTwo", "c-1", {
          vcpuCapacity: 50,
          vcpuAllocated: 10,
          memoryCapacityBytes: 1000,
          memoryAllocatedBytes: 100,
        }),
        pool("RegionOne", 10000, 2500),
        pool("RegionTwo", 1000, 900),
        instance("i-1", "RegionOne"),
        instance("i-2", "RegionOne"),
        instance("i-3", "RegionTwo"),
        keystone(OpenStackResourceKind.Project, "p-1", "payments"),
        keystone(OpenStackResourceKind.Domain, "d-1", "Default"),
      ];
    };

    describe("getInventorySummary of one", () => {
      const summaryOf = async (
        regionName: string,
      ): Promise<OpenStackInventorySummary> => {
        return await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          regionName,
        });
      };

      test("counts its own rows, and none of another's", async () => {
        await write(TWO_REGIONS());
        const two: OpenStackInventorySummary = await summaryOf("RegionTwo");

        expect(two.regionCount).toBe(1);
        expect(two.hypervisorCount).toBe(1);
        expect(two.instanceCount).toBe(1);
        expect(two.serviceCount).toBe(1);
        expect(two.downServiceCount).toBe(0);
        expect(two.vcpuCapacity).toBe(50);
        expect(two.vcpuAllocated).toBe(10);
        expect(two.memoryCapacityBytes).toBe(1000);
        expect(two.storageCapacityBytes).toBe(1000);
        expect(two.storageUsedBytes).toBe(900);
      });

      test("keeps what is Keystone's, which belongs to all of them", async () => {
        await write(TWO_REGIONS());
        const two: OpenStackInventorySummary = await summaryOf("RegionTwo");
        const one: OpenStackInventorySummary = await summaryOf("RegionOne");

        expect(two.projectCount).toBe(1);
        expect(one.projectCount).toBe(1);
      });

      test("the regions together are the cloud", async () => {
        await write(TWO_REGIONS());
        const whole: OpenStackInventorySummary = await summary();
        const one: OpenStackInventorySummary = await summaryOf("RegionOne");
        const two: OpenStackInventorySummary = await summaryOf("RegionTwo");

        expect(whole.regionCount).toBe(2);
        expect(one.hypervisorCount + two.hypervisorCount).toBe(
          whole.hypervisorCount,
        );
        expect(one.instanceCount + two.instanceCount).toBe(whole.instanceCount);
        expect(one.vcpuCapacity + two.vcpuCapacity).toBe(whole.vcpuCapacity);
        expect(one.downServiceCount + two.downServiceCount).toBe(
          whole.downServiceCount,
        );
      });

      test("one nobody has reads as nothing there", async () => {
        await write(TWO_REGIONS());
        const none: OpenStackInventorySummary = await summaryOf("RegionNine");

        expect(none.regionCount).toBe(0);
        expect(none.hypervisorCount).toBe(0);
        expect(none.instanceCount).toBe(0);
        expect(none.vcpuCapacity).toBe(0);
      });

      test("a name that is a piece of SQL is a name", async () => {
        await write(TWO_REGIONS());
        const none: OpenStackInventorySummary = await summaryOf(
          `RegionOne' OR '1'='1`,
        );

        expect(none.hypervisorCount).toBe(0);
      });
    });

    describe("getRegionSummaries", () => {
      const regions = async (
        cloudId: ObjectID = CLOUD_ID,
        projectId: ObjectID = PROJECT_ID,
      ): Promise<Array<OpenStackRegionSummary>> => {
        return await OpenStackResourceService.getRegionSummaries({
          projectId,
          openStackCloudId: cloudId,
        });
      };

      test("says what each holds, in order, and what's Keystone's is none of them", async () => {
        await write(TWO_REGIONS());

        const answer: Array<OpenStackRegionSummary> = await regions();

        expect(
          answer.map((region: OpenStackRegionSummary): string => {
            return region.regionName;
          }),
        ).toEqual(["RegionOne", "RegionTwo"]);
        expect(answer[1]).toEqual({
          regionName: "RegionTwo",
          apiCount: 1,
          downApiCount: 0,
          serviceCount: 1,
          downServiceCount: 0,
          hypervisorCount: 1,
          instanceCount: 1,
          vcpuCapacity: 50,
          vcpuAllocated: 10,
          memoryCapacityBytes: 1000,
          memoryAllocatedBytes: 100,
          storageCapacityBytes: 1000,
          storageUsedBytes: 900,
        });
      });

      test("one disabled is not down, in Nova's word or Neutron's", async () => {
        await write(TWO_REGIONS());

        const one: OpenStackRegionSummary = (await regions())[0]!;

        expect(one.serviceCount).toBe(4);
        expect(one.downServiceCount).toBe(1);
        expect(one.apiCount).toBe(2);
        expect(one.downApiCount).toBe(1);
      });

      test("a lost host counts as a host, and as no capacity", async () => {
        await write(TWO_REGIONS());

        const one: OpenStackRegionSummary = (await regions())[0]!;

        expect(one.hypervisorCount).toBe(2);
        expect(one.vcpuCapacity).toBe(100);
        expect(one.vcpuAllocated).toBe(40);
      });

      test("a cloud of one region says so, and one with nothing has none", async () => {
        expect(await regions()).toEqual([]);

        await write([api(OpenStackServiceType.Compute)]);

        expect(await regions()).toHaveLength(1);
      });

      test("never counts another cloud's, or another project's", async () => {
        await write(TWO_REGIONS(), OTHER_CLOUD_ID);
        await write(TWO_REGIONS(), CLOUD_ID, OTHER_PROJECT_ID);

        expect(await regions()).toEqual([]);
      });
    });

    describe("getTopConsumers", () => {
      const consumers = async (
        regionName?: string,
      ): Promise<OpenStackTopConsumers> => {
        return await OpenStackResourceService.getTopConsumers({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          regionName,
        });
      };

      test("most first, by what Nova and Cinder hold for each project", async () => {
        await write([
          keystone(OpenStackResourceKind.Project, "p-1", "payments"),
          keystone(OpenStackResourceKind.Project, "p-2", "research"),
          instance("i-1", "RegionOne", "p-1"),
          instance("i-2", "RegionOne", "p-2"),
          instance("i-3", "RegionOne", "p-2"),
          volume("v-1", "RegionOne", "p-1", 500),
          volume("v-2", "RegionOne", "p-1", 700),
          volume("v-3", "RegionOne", "p-2", 100),
        ]);

        const top: OpenStackTopConsumers = await consumers();

        expect(top.projectsByInstances).toEqual([
          { projectId: "p-2", name: "research", value: 2 },
          { projectId: "p-1", name: "payments", value: 1 },
        ]);
        expect(top.projectsByVolumeBytes).toEqual([
          { projectId: "p-1", name: "payments", value: 1200 },
          { projectId: "p-2", name: "research", value: 100 },
        ]);
      });

      test("a project Keystone hasn't named reads by its ID", async () => {
        await write([instance("i-1", "RegionOne", "p-unknown")]);

        expect((await consumers()).projectsByInstances).toEqual([
          { projectId: "p-unknown", name: null, value: 1 },
        ]);
      });

      test("holds no more than the card shows, whatever the cloud holds", async () => {
        const rows: Array<ParsedOpenStackResource> = [];
        for (let index: number = 0; index < 8; index++) {
          rows.push(instance(`i-${index}`, "RegionOne", `p-${index}`));
        }
        await write(rows);

        expect((await consumers()).projectsByInstances).toHaveLength(5);
      });

      test("the same count reads the same way every time", async () => {
        await write([
          instance("i-1", "RegionOne", "p-b"),
          instance("i-2", "RegionOne", "p-a"),
        ]);

        expect(
          (await consumers()).projectsByInstances.map(
            (one: OpenStackTopConsumer): string => {
              return one.projectId;
            },
          ),
        ).toEqual(["p-a", "p-b"]);
      });

      test("reads one region's, when one is being read", async () => {
        await write([
          instance("i-1", "RegionOne", "p-1"),
          instance("i-2", "RegionTwo", "p-2"),
          instance("i-3", "RegionTwo", "p-2"),
        ]);

        expect(
          (await consumers("RegionOne")).projectsByInstances.map(
            (one: OpenStackTopConsumer): string => {
              return one.projectId;
            },
          ),
        ).toEqual(["p-1"]);
      });

      test("leaves out what no project holds, and reads nothing for a cloud with none", async () => {
        await write([instance("i-1", "RegionOne")]);

        expect(await consumers()).toEqual({
          projectsByInstances: [],
          projectsByVolumeBytes: [],
        });
      });

      test("never reads another cloud's", async () => {
        await write(
          [instance("i-1", "RegionOne", "p-1")],
          OTHER_CLOUD_ID,
        );

        expect((await consumers()).projectsByInstances).toEqual([]);
      });
    });

    describe("getAttentionRows of one", () => {
      const attentionOf = async (
        regionName: string | undefined,
        rowsPerKind?: number,
      ): Promise<OpenStackAttentionRows> => {
        return await OpenStackResourceService.getAttentionRows({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          now: NOW,
          regionName,
          rowsPerKind,
        });
      };

      const rowsOfKind = (
        answer: OpenStackAttentionRows,
        kind: OpenStackResourceKind,
      ): Array<string> => {
        return answer.rows
          .filter((row: JSONObject): boolean => {
            return row["kind"] === kind;
          })
          .map((row: JSONObject): string => {
            return row["externalId"] as string;
          })
          .sort();
      };

      test("reads its own, and none of another's", async () => {
        await write([
          ...TWO_REGIONS(),
          instance("broken-1", "RegionOne", null, "ERROR"),
          instance("broken-2", "RegionTwo", null, "ERROR"),
        ]);

        const two: OpenStackAttentionRows = await attentionOf("RegionTwo");

        expect(rowsOfKind(two, OpenStackResourceKind.Instance)).toEqual([
          "broken-2",
        ]);
        expect(rowsOfKind(two, OpenStackResourceKind.Hypervisor)).toEqual([
          "RegionTwo/c-1",
        ]);
        expect(rowsOfKind(two, OpenStackResourceKind.Service)).toEqual([
          "RegionTwo/compute/c-1/nova-compute",
        ]);
        expect(rowsOfKind(two, OpenStackResourceKind.Api)).toEqual([]);
      });

      test("a region's list is whole, however much is wrong elsewhere", async () => {
        const rows: Array<ParsedOpenStackResource> = [
          instance("broken-in-two", "RegionTwo", null, "ERROR"),
        ];
        for (let index: number = 0; index < 8; index++) {
          rows.push(instance(`broken-${index}`, "RegionOne", null, "ERROR"));
        }
        await write(rows);

        const two: OpenStackAttentionRows = await attentionOf("RegionTwo", 2);
        expect(rowsOfKind(two, OpenStackResourceKind.Instance)).toEqual([
          "broken-in-two",
        ]);
        expect(two.totalsByKind[OpenStackResourceKind.Instance]).toBe(1);

        // Reading the whole cloud at the same cap could have left it out.
        const whole: OpenStackAttentionRows = await attentionOf(undefined, 2);
        expect(rowsOfKind(whole, OpenStackResourceKind.Instance)).toHaveLength(
          2,
        );
        expect(whole.totalsByKind[OpenStackResourceKind.Instance]).toBe(9);
      });
    });
  });

  describe("getBlastRadius", () => {
    const instance = (
      id: string,
      projectId: string,
      hypervisorName: string | null,
      regionName: string = "RegionOne",
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Instance,
        externalId: id,
        openStackProjectId: projectId,
        hypervisorName,
        regionName,
        status: "ACTIVE",
      });
    };

    const radius = async (
      part: Parameters<
        typeof OpenStackResourceService.getBlastRadius
      >[0]["part"],
    ): Promise<OpenStackBlastRadius> => {
      return await OpenStackResourceService.getBlastRadius({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        part,
      });
    };

    test("a hypervisor reaches its instances, by project, most affected first", async () => {
      await write([
        instance("i-1", "payments", "compute-01.example.internal"),
        instance("i-2", "payments", "compute-01.example.internal"),
        instance("i-3", "research", "compute-01.example.internal"),
        instance("i-4", "research", "compute-02.example.internal"),
        // Another region's host of the same name is another machine.
        instance("i-5", "other", "compute-01.example.internal", "RegionTwo"),
        resource({
          kind: OpenStackResourceKind.Project,
          externalId: "payments",
          name: "Payments team",
          regionName: null,
        }),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Hypervisor,
        hypervisorName: "compute-01.example.internal",
        regionName: "RegionOne",
      });
      expect(result.instanceCount).toBe(3);
      expect(result.projectCount).toBe(2);
      expect(result.projects[0]).toEqual(
        expect.objectContaining({
          projectId: "payments",
          name: "Payments team",
          instanceCount: 2,
        }),
      );
      expect(result.projects[1]).toEqual(
        expect.objectContaining({
          projectId: "research",
          name: null,
          instanceCount: 1,
        }),
      );
      expect(result.isKnown).toBe(true);
    });

    // Seen on a real cloud: Nova's service and its hypervisor name one machine differently.
    test("a nova-compute reaches its hypervisor's instances, across the two names", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-01.example.internal",
          hypervisorName: "compute-01.example.internal",
        }),
        instance("i-1", "payments", "compute-01.example.internal"),
        // A different machine whose name starts the same way.
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionOne/compute-011.example.internal",
          hypervisorName: "compute-011.example.internal",
        }),
        instance("i-2", "payments", "compute-011.example.internal"),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Service,
        name: "nova-compute",
        regionName: "RegionOne",
        facts: { host: "compute-01" },
      });
      expect(result.instanceCount).toBe(1);
    });

    test("an L3 agent reaches the routers no other alive agent holds, and their floating IPs", async () => {
      const router = (
        id: string,
        agents: JSONObject,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Router,
          externalId: id,
          openStackProjectId: "payments",
          facts: { l3Agents: agents },
        });
      };
      const alive: JSONObject = { isAlive: true, isAdminUp: true };
      const dead: JSONObject = { isAlive: false, isAdminUp: true };
      await write([
        router("only-here", { "agent-1": dead }),
        router("other-one-alive", { "agent-1": dead, "agent-2": alive }),
        router("other-one-dead", { "agent-1": dead, "agent-2": dead }),
        router("not-here", { "agent-2": alive }),
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-1",
          openStackProjectId: "research",
          facts: { routerId: "only-here" },
        }),
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-2",
          openStackProjectId: "research",
          facts: { routerId: "other-one-alive" },
        }),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Service,
        name: "neutron-l3-agent",
        facts: { agentId: "agent-1" },
      });
      expect(result.routerCount).toBe(2);
      expect(result.floatingIpCount).toBe(1);
      expect(result.projectCount).toBe(2);
    });

    test("an L3 agent with no ID on record cannot say", async () => {
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Service,
        name: "neutron-l3-agent",
      });
      expect(result.isKnown).toBe(false);
    });

    test("a router reaches the floating IPs going through it", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-1",
          openStackProjectId: "payments",
          facts: { routerId: "router-1" },
        }),
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-2",
          openStackProjectId: "payments",
          facts: { routerId: null },
        }),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Router,
        externalId: "router-1",
      });
      expect(result.floatingIpCount).toBe(1);
    });

    test("a pool says it cannot tell, when nothing says where volumes are", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "vol-1",
          openStackProjectId: "payments",
        }),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.StoragePool,
        name: "host@rbd#rbd",
      });
      expect(result.volumeCount).toBe(0);
      expect(result.isKnown).toBe(false);
    });

    test("a pool reaches its volumes, when the source says", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "vol-1",
          openStackProjectId: "payments",
          facts: { pool: "host@rbd#rbd" },
        }),
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "vol-2",
          openStackProjectId: "payments",
          facts: { pool: "host@lvm#lvm" },
        }),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.StoragePool,
        name: "host@rbd#rbd",
      });
      expect(result.volumeCount).toBe(1);
      expect(result.isKnown).toBe(true);
    });

    test("a region's compute API reaches that region's instances", async () => {
      await write([
        instance("i-1", "payments", "h-1"),
        instance("i-2", "research", "h-2"),
        instance("i-3", "other", "h-3", "RegionTwo"),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Api,
        name: OpenStackServiceType.Compute,
        regionName: "RegionOne",
      });
      expect(result.instanceCount).toBe(2);
      expect(result.projectCount).toBe(2);
    });

    test("Keystone is global, so it reaches every region", async () => {
      await write([
        instance("i-1", "payments", "h-1"),
        instance("i-3", "other", "h-3", "RegionTwo"),
      ]);
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Api,
        name: OpenStackServiceType.Identity,
        regionName: "RegionOne",
      });
      expect(result.instanceCount).toBe(2);
    });

    test("only ever counts this cloud of this project", async () => {
      await write(
        [instance("i-1", "payments", "compute-01")],
        OTHER_CLOUD_ID,
      );
      await write(
        [instance("i-2", "payments", "compute-01")],
        CLOUD_ID,
        OTHER_PROJECT_ID,
      );
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Hypervisor,
        hypervisorName: "compute-01",
        regionName: "RegionOne",
      });
      expect(result.instanceCount).toBe(0);
    });

    test("a kind with no reach of its own says it cannot tell", async () => {
      const result: OpenStackBlastRadius = await radius({
        kind: OpenStackResourceKind.Flavor,
      });
      expect(result.isKnown).toBe(false);
    });
  });

  describe("getAttentionRows", () => {
    const attention = async (): Promise<Map<string, Array<string>>> => {
      const result: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          now: NOW,
        });
      const byKind: Map<string, Array<string>> = new Map();
      for (const row of result.rows) {
        const kind: string = row["kind"] as string;
        byKind.set(kind, [
          ...(byKind.get(kind) || []),
          row["externalId"] as string,
        ]);
      }
      return byKind;
    };

    test("finds what the rules care about and leaves the healthy out", async () => {
      await write([
        api(OpenStackServiceType.Compute, { status: "down", facts: {} }),
        api(OpenStackServiceType.Volume),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "in-error",
          status: "ERROR",
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "fine",
          status: "ACTIVE",
        }),
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "vol-error",
          status: "error_deleting",
        }),
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "vol-fine",
          status: "available",
        }),
        resource({
          kind: OpenStackResourceKind.StoragePool,
          externalId: "nearly-full",
          diskCapacityBytes: 100,
          diskAllocatedBytes: 90,
        }),
        resource({
          kind: OpenStackResourceKind.StoragePool,
          externalId: "roomy",
          diskCapacityBytes: 100,
          diskAllocatedBytes: 50,
        }),
        resource({
          kind: OpenStackResourceKind.Network,
          externalId: "public-full",
          facts: { isExternal: true, ipsUsed: 95, ipsTotal: 100 },
        }),
        resource({
          kind: OpenStackResourceKind.Network,
          externalId: "public-roomy",
          facts: { isExternal: true, ipsUsed: 5, ipsTotal: 100 },
        }),
        resource({
          kind: OpenStackResourceKind.Network,
          externalId: "tenant-full",
          facts: { isExternal: false, ipsUsed: 100, ipsTotal: 100 },
        }),
        resource({
          kind: OpenStackResourceKind.Router,
          externalId: "router-error",
          status: "ERROR",
          adminState: "up",
        }),
        resource({
          kind: OpenStackResourceKind.Router,
          externalId: "router-ok",
          status: "ACTIVE",
          adminState: "up",
        }),
        resource({
          kind: OpenStackResourceKind.Router,
          externalId: "router-off",
          status: "ERROR",
          adminState: "down",
        }),
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-in-use-down",
          status: "DOWN",
          facts: { routerId: "router-1" },
        }),
        // What the APIs say where the exporter has only a router.
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-with-port-down",
          status: "DOWN",
          facts: { portId: "port-1", routerId: null },
        }),
        // What a released address writes.
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-released",
          status: "DOWN",
          facts: { routerId: null },
        }),
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-spare",
          status: "DOWN",
        }),
      ]);

      const found: Map<string, Array<string>> = await attention();
      expect(found.get(OpenStackResourceKind.Api)).toEqual([
        "RegionOne/compute",
      ]);
      expect(found.get(OpenStackResourceKind.Instance)).toEqual(["in-error"]);
      expect(found.get(OpenStackResourceKind.Volume)).toEqual(["vol-error"]);
      expect(found.get(OpenStackResourceKind.StoragePool)).toEqual([
        "nearly-full",
      ]);
      expect(found.get(OpenStackResourceKind.Network)).toEqual(["public-full"]);
      expect(found.get(OpenStackResourceKind.Router)).toEqual(["router-error"]);
      expect(found.get(OpenStackResourceKind.FloatingIp)).toEqual([
        "fip-in-use-down",
        "fip-with-port-down",
      ]);
    });

    test("a part is stuck only once it has been in its state for long enough", async () => {
      const volume = (id: string, minutes: number): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Volume,
          externalId: id,
          status: "attaching",
          lastSeenAt: at(-minutes * MINUTE_MS),
        });
      };
      await write([volume("just-started", 5), volume("stuck", 45)]);
      const found: Map<string, Array<string>> = await attention();
      expect(found.get(OpenStackResourceKind.Volume)).toEqual(["stuck"]);
    });

    test("reads every service and hypervisor, because the rules need them all", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "a",
          status: "up",
        }),
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "b",
        }),
      ]);
      const found: Map<string, Array<string>> = await attention();
      expect(found.get(OpenStackResourceKind.Service)).toEqual(["a"]);
      expect(found.get(OpenStackResourceKind.Hypervisor)).toEqual(["b"]);
    });

    test("caps a long list and still says how many there are", async () => {
      const rows: Array<ParsedOpenStackResource> = [];
      for (let i: number = 0; i < 250; i++) {
        rows.push(
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: `uuid-${i}`,
            status: "ERROR",
          }),
        );
      }
      await write(rows);
      const result: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          now: NOW,
        });
      expect(
        result.rows.filter((row: JSONObject) => {
          return row["kind"] === OpenStackResourceKind.Instance;
        }),
      ).toHaveLength(100);
      expect(result.totalsByKind[OpenStackResourceKind.Instance]).toBe(250);
    });

    test("never reads another cloud's rows", async () => {
      await write(
        [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: "other",
            status: "ERROR",
          }),
        ],
        OTHER_CLOUD_ID,
      );
      expect((await attention()).size).toBe(0);
    });

    test("a pool or network that reports no size is left out, not an error", async () => {
      await write([
        resource({
          kind: OpenStackResourceKind.StoragePool,
          externalId: "no-size",
        }),
        resource({
          kind: OpenStackResourceKind.Network,
          externalId: "no-ips",
          facts: { isExternal: true },
        }),
      ]);
      expect((await attention()).size).toBe(0);
    });
  });

  describe("deleteStaleForCloud", () => {
    const LONG_AGO: Date = at(-60 * MINUTE_MS);

    test("a good scrape of its service removes what it no longer reports", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "gone",
          lastSeenAt: LONG_AGO,
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "here",
          lastSeenAt: NOW,
        }),
      ]);
      expect(await sweep()).toBe(1);
      expect(await externalIds(OpenStackResourceKind.Instance)).toEqual([
        "here",
      ]);
    });

    test("a failing service removes nothing: its parts are not gone, it just cannot say", async () => {
      await write([
        api(OpenStackServiceType.Compute, {
          status: "down",
          facts: {},
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "still-there",
          lastSeenAt: LONG_AGO,
        }),
      ]);
      expect(await sweep()).toBe(0);
      expect(await externalIds(OpenStackResourceKind.Instance)).toEqual([
        "still-there",
      ]);
    });

    test("an API up but not read since keeps what it last vouched for", async () => {
      await write([
        api(OpenStackServiceType.Compute, {
          vouchedAt: at(-61 * MINUTE_MS),
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "still-there",
          lastSeenAt: LONG_AGO,
        }),
      ]);
      expect(await sweep()).toBe(0);
    });

    test("one service's good scrape never removes another service's parts", async () => {
      await write([
        api(OpenStackServiceType.Volume),
        api(OpenStackServiceType.Compute, { status: "down", facts: {} }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "nova-is-failing",
          lastSeenAt: LONG_AGO,
        }),
        resource({
          kind: OpenStackResourceKind.Volume,
          externalId: "gone",
          lastSeenAt: LONG_AGO,
        }),
      ]);
      expect(await sweep()).toBe(1);
      expect(await externalIds(OpenStackResourceKind.Instance)).toEqual([
        "nova-is-failing",
      ]);
      expect(await externalIds(OpenStackResourceKind.Volume)).toEqual([]);
    });

    test("each region answers for itself", async () => {
      await write([
        api(OpenStackServiceType.Compute, { regionName: "RegionOne" }),
        api(OpenStackServiceType.Compute, {
          regionName: "RegionTwo",
          status: "down",
          facts: {},
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "one-gone",
          regionName: "RegionOne",
          lastSeenAt: LONG_AGO,
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "two-failing",
          regionName: "RegionTwo",
          lastSeenAt: LONG_AGO,
        }),
      ]);
      expect(await sweep()).toBe(1);
      expect(await externalIds(OpenStackResourceKind.Instance)).toEqual([
        "two-failing",
      ]);
    });

    test("each family of workers answers to its own API", async () => {
      const worker = (
        id: string,
        family: string,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Service,
          externalId: id,
          facts: { family },
          lastSeenAt: LONG_AGO,
        });
      };
      await write([
        api(OpenStackServiceType.Network),
        worker("compute-worker", "compute"),
        worker("network-worker", "network"),
        worker("volume-worker", "volume"),
      ]);
      expect(await sweep()).toBe(1);
      expect(await externalIds(OpenStackResourceKind.Service)).toEqual([
        "compute-worker",
        "volume-worker",
      ]);
    });

    test("a cloud's last instance can still go, because the cutoff comes from the service and not the kind's newest row", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "the-last-one",
          lastSeenAt: LONG_AGO,
        }),
      ]);
      expect(await sweep()).toBe(1);
      expect(await externalIds(OpenStackResourceKind.Instance)).toEqual([]);
    });

    test("identity's parts are global, so any region's Keystone answers for them", async () => {
      await write([
        api(OpenStackServiceType.Identity),
        resource({
          kind: OpenStackResourceKind.Project,
          externalId: "gone",
          regionName: null,
          lastSeenAt: LONG_AGO,
        }),
        resource({
          kind: OpenStackResourceKind.Domain,
          externalId: "here",
          regionName: null,
          lastSeenAt: NOW,
        }),
      ]);
      expect(await sweep()).toBe(1);
      expect(await externalIds(OpenStackResourceKind.Project)).toEqual([]);
      expect(await externalIds(OpenStackResourceKind.Domain)).toEqual(["here"]);
    });

    test("a row within the stale window stays, and the window can be set", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "ten-minutes",
          lastSeenAt: at(-10 * MINUTE_MS),
        }),
      ]);
      expect(await sweep()).toBe(0);

      process.env["OPENSTACK_INVENTORY_STALE_MINUTES"] = "5";
      expect(await sweep()).toBe(1);
    });

    test("the window can never be set low enough to race a scrape", () => {
      process.env["OPENSTACK_INVENTORY_STALE_MINUTES"] = "1";
      expect(OpenStackResourceService.getStaleWindowInMinutes()).toBe(5);
      process.env["OPENSTACK_INVENTORY_STALE_MINUTES"] = "soon";
      expect(OpenStackResourceService.getStaleWindowInMinutes()).toBe(15);
    });

    test("never touches another cloud", async () => {
      await write([api(OpenStackServiceType.Compute)]);
      await write(
        [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: "other-cloud",
            lastSeenAt: LONG_AGO,
          }),
        ],
        OTHER_CLOUD_ID,
      );
      expect(await sweep()).toBe(0);
      const rows: Array<Row> = await database.query(
        `SELECT 1 FROM "${schema}"."${TABLE}" WHERE "openStackCloudId" = $1`,
        [OTHER_CLOUD_ID.toString()],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe("at the size of OpenStack's largest clouds", () => {
    const ROWS: number = 500_000;

    test(
      "holds 500,000 rows: writes keep up, and pages read an index, not the table",
      async () => {
        const startedAt: number = Date.now();
        for (let offset: number = 0; offset < ROWS; offset += 50_000) {
          /*
           * Directly in bulk, because this test is about the table and its reads,
           * not about how long the fixture takes on a loaded CI runner.
           */
          await database.query(
            `INSERT INTO "${schema}"."${TABLE}"
              ("projectId", "openStackCloudId", "kind", "externalId", "name",
               "regionName", "hypervisorName", "openStackProjectId", "status",
               "lastSeenAt", "version")
             SELECT $1, $2, $3, 'uuid-' || g, 'instance-' || g,
                    'RegionOne', 'compute-' || (g % 5000), 'project-' || (g % 10000),
                    CASE WHEN g % 100 = 0 THEN 'ERROR' ELSE 'ACTIVE' END, $4, 0
             FROM generate_series($5::int, $6::int) AS g`,
            [
              PROJECT_ID.toString(),
              CLOUD_ID.toString(),
              OpenStackResourceKind.Instance,
              NOW,
              offset,
              offset + 49_999,
            ],
          );
        }
        await database.query(`ANALYZE "${schema}"."${TABLE}"`);

        // One scrape's worth of upserts of rows that already exist.
        const upsertStart: number = Date.now();
        const batch: Array<ParsedOpenStackResource> = [];
        for (let i: number = 0; i < 2000; i++) {
          batch.push(
            resource({
              kind: OpenStackResourceKind.Instance,
              externalId: `uuid-${i * 200}`,
              status: "ACTIVE",
              lastSeenAt: at(MINUTE_MS),
            }),
          );
        }
        await write(batch);
        const upsertSeconds: number = (Date.now() - upsertStart) / 1000;

        const summaryStart: number = Date.now();
        const result: OpenStackInventorySummary = await summary();
        const summarySeconds: number = (Date.now() - summaryStart) / 1000;
        expect(result.instanceCount).toBe(ROWS);

        // A page of a list, filtered as the lists filter.
        const plan: Array<{ "QUERY PLAN": string }> = await database.query(
          `EXPLAIN SELECT "_id" FROM "${schema}"."${TABLE}"
           WHERE "projectId" = '${PROJECT_ID.toString()}'
             AND "openStackCloudId" = '${CLOUD_ID.toString()}'
             AND "kind" = 'Instance' AND "status" = 'ERROR'
           ORDER BY "name" LIMIT 10`,
        );
        const planText: string = plan
          .map((line: { "QUERY PLAN": string }) => {
            return line["QUERY PLAN"];
          })
          .join("\n");
        expect(planText).not.toContain(`Seq Scan on "${TABLE}"`);

        // The budgets, generous for a loaded runner, and stated so they are known.
        expect(upsertSeconds).toBeLessThan(30);
        expect(summarySeconds).toBeLessThan(10);
        logger.debug(
          `500,000 rows: fixture ${(Date.now() - startedAt) / 1000}s, upsert ${upsertSeconds}s, summary ${summarySeconds}s`,
        );
      },
      10 * 60 * 1000,
    );
  });
});
