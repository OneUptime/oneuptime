import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import DiscoveredDevices, {
  ClassifiedDiscoveredDevice,
  HIDDEN_FROM_LIST_REASON,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
  DiscoveredDeviceListRequest,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMatch,
  DiscoveredDeviceRow,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "../../../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { getEndpointSightingWindowMs } from "../../../../Utils/Monitor/NetworkTopologyUtil";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
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

/*
 * The Discovered Devices list (OneUptime issue #5775), EXECUTED on Postgres.
 *
 * Its statements classify every endpoint row in the database the way the
 * topology map does, across NetworkEndpoint, NetworkDevice and
 * NetworkTopologySuppression - text the unit suite can only read. Only a
 * database shows:
 *
 *   - a device monitors an endpoint by its MAC however either was typed,
 *     in any site and however long ago it was seen; never an archived, a
 *     deleted or another project's device;
 *   - by its address only while the sighting is current - a controller's
 *     for longer than a walk's - and only in the same site;
 *   - a search is data: every word must match a name, the address, the
 *     maker or the MAC, and LIKE's wildcards are only characters;
 *   - the counts agree with the rows, and a page never repeats a row;
 *   - addresses sort as numbers, whatever else is stored;
 *   - hiding writes a suppression the map reads (version 1, the person,
 *     the reason) only for rows not monitored and not hidden yet, showing
 *     removes it, and "Show them" removes the project's every one and no
 *     other project's;
 *   - a few thousand endpoints of one site are listed quickly.
 *
 * The statements run through the list's own runner, the endpoint
 * repository's manager, pointed at the test database: TypeORM's Postgres
 * driver answers a bare DELETE with [rows, rowCount], which only a run
 * through it shows.
 *
 * Opt in with RUN_POSTGRES_DISCOVERED_DEVICES_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The three tables' STRUCTURE is
 * cloned into a unique schema (search_path holds only that schema) that is
 * dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from DISCOVERED_DEVICES_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from DISCOVERED_DEVICES_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DISCOVERED_DEVICES_TESTS"] === "true"
    ? describe
    : describe.skip;

const NOW: Date = new Date("2026-11-08T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const WALK_WINDOW_MS: number = getEndpointSightingWindowMs(undefined);
const CONTROLLER_WINDOW_MS: number = getEndpointSightingWindowMs("meraki");

interface EndpointFields {
  id?: string;
  projectId?: string;
  macAddress: string;
  ipAddress?: string | null;
  hostname?: string | null;
  vendor?: string | null;
  classification?: string | null;
  siteId?: string | null;
  attachmentSource?: string | null;
  attachedNetworkDeviceId?: string;
  attachedPortName?: string | null;
  vlanId?: number | null;
  lastSeenAt?: Date | null;
  firstSeenAt?: Date | null;
  deletedAt?: Date | null;
}

interface DeviceFields {
  id?: string;
  projectId?: string;
  name?: string;
  hostname: string;
  macAddress?: string | null;
  siteId?: string | null;
  isArchived?: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;
}

function propsFor(
  projectId: ObjectID,
  userId: ObjectID,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: projectId,
    userId: userId,
    userTenantAccessPermission: { [projectId.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

describePostgres("the Discovered Devices list on Postgres", () => {
  const schema: string = `discovered_devices_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  const PERSON: ObjectID = ObjectID.generate();
  const SWITCH_ID: string = ObjectID.generate().toString();
  const SITE_A: string = ObjectID.generate().toString();
  const SITE_B: string = ObjectID.generate().toString();

  async function addEndpoint(fields: EndpointFields): Promise<string> {
    const id: string = fields.id || ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "NetworkEndpoint"
        ("_id", "version", "projectId", "macAddress", "ipAddress", "hostname",
         "vendor", "classification", "siteId", "attachmentSource",
         "attachedNetworkDeviceId", "attachedPortName", "vlanId",
         "lastSeenAt", "firstSeenAt", "deletedAt")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        fields.projectId || projectId.toString(),
        fields.macAddress,
        fields.ipAddress ?? null,
        fields.hostname ?? null,
        fields.vendor ?? null,
        fields.classification ?? null,
        fields.siteId ?? null,
        fields.attachmentSource ?? null,
        fields.attachedNetworkDeviceId || SWITCH_ID,
        fields.attachedPortName ?? null,
        fields.vlanId ?? null,
        fields.lastSeenAt === undefined
          ? new Date(NOW.getTime() - MINUTE)
          : fields.lastSeenAt,
        fields.firstSeenAt ?? null,
        fields.deletedAt ?? null,
      ],
    );

    return id;
  }

  async function addDevice(fields: DeviceFields): Promise<string> {
    const id: string = fields.id || ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "NetworkDevice"
        ("_id", "version", "projectId", "name", "slug", "hostname",
         "macAddress", "siteId", "isArchived", "deletedAt", "createdAt")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        fields.projectId || projectId.toString(),
        fields.name || fields.hostname,
        `device-${id}`,
        fields.hostname,
        fields.macAddress ?? null,
        fields.siteId ?? null,
        fields.isArchived ?? false,
        fields.deletedAt ?? null,
        fields.createdAt || new Date(NOW.getTime() - 60 * MINUTE),
      ],
    );

    return id;
  }

  async function list(
    request: Partial<DiscoveredDeviceListRequest> = {},
  ): Promise<DiscoveredDeviceListResponse> {
    return DiscoveredDevices.list({
      projectId: projectId,
      props: props,
      request: { ...DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST, ...request },
    });
  }

  async function rowOf(id: string): Promise<ClassifiedDiscoveredDevice> {
    const rows: Array<ClassifiedDiscoveredDevice> =
      await DiscoveredDevices.classify({
        projectId: projectId,
        endpointIds: [id],
      });

    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function suppressions(project: ObjectID = projectId): Promise<
    Array<{
      nodeKey: string;
      nodeName: string;
      reason: string;
      version: number;
      createdByUserId: string | null;
    }>
  > {
    return await database.query(
      `SELECT "nodeKey", "nodeName", "reason", "version", "createdByUserId"
       FROM "NetworkTopologySuppression"
       WHERE "projectId" = $1 AND "deletedAt" IS NULL
       ORDER BY "nodeKey"`,
      [project.toString()],
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["DISCOVERED_DEVICES_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DISCOVERED_DEVICES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DISCOVERED_DEVICES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [
      "NetworkEndpoint",
      "NetworkDevice",
      "NetworkTopologySuppression",
    ]) {
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

  beforeEach(() => {
    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    props = propsFor(projectId, PERSON, [
      Permission.ReadNetworkEndpoint,
      Permission.CreateNetworkTopologySuppression,
      Permission.DeleteNetworkTopologySuppression,
    ]);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    DiscoveredDevices.now = (): Date => {
      return NOW;
    };

    // Names are read as the person through the services; not the point here.
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the import of a selection keeps no scan: the migration let the column go empty", async () => {
    const columns: Array<{ is_nullable: string }> = await database.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'NetworkDeviceDiscoveryImport'
         AND column_name = 'networkDeviceDiscoveryScanId'`,
    );

    expect(columns).toEqual([{ is_nullable: "YES" }]);
  });

  describe("which rows are monitored", () => {
    test("by MAC, however either side wrote it, in any site, however long ago", async () => {
      const device: string = await addDevice({
        hostname: "10.9.9.9",
        macAddress: "00-1A-2B-3C-4D-5E",
        siteId: SITE_B,
      });
      const endpoint: string = await addEndpoint({
        macAddress: "00:1a:2b:3c:4d:5e",
        ipAddress: "10.0.0.5",
        siteId: SITE_A,
        lastSeenAt: new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE),
      });

      expect(await rowOf(endpoint)).toMatchObject({
        monitoredDevice: { id: device },
        monitoredBy: DiscoveredDeviceMatch.MacAddress,
        isSeenRecently: false,
      });
    });

    test("the earliest of two devices with one MAC is the one it points at", async () => {
      const first: string = await addDevice({
        hostname: "10.0.1.1",
        macAddress: "00:1a:2b:3c:4d:5f",
        createdAt: new Date(NOW.getTime() - 120 * MINUTE),
      });
      await addDevice({
        hostname: "10.0.1.2",
        macAddress: "001a.2b3c.4d5f",
        createdAt: new Date(NOW.getTime() - 60 * MINUTE),
      });
      const endpoint: string = await addEndpoint({
        macAddress: "00:1a:2b:3c:4d:5f",
      });

      expect((await rowOf(endpoint)).monitoredDevice).toEqual({ id: first });
    });

    test("never by an archived, a deleted or another project's device", async () => {
      await addDevice({
        hostname: "10.0.0.6",
        macAddress: "00:00:00:00:00:61",
        isArchived: true,
      });
      await addDevice({
        hostname: "10.0.0.6",
        macAddress: "00:00:00:00:00:61",
        deletedAt: new Date(NOW.getTime() - MINUTE),
      });
      await addDevice({
        projectId: otherProjectId.toString(),
        hostname: "10.0.0.6",
        macAddress: "00:00:00:00:00:61",
      });
      const endpoint: string = await addEndpoint({
        macAddress: "00:00:00:00:00:61",
        ipAddress: "10.0.0.6",
      });

      expect((await rowOf(endpoint)).monitoredDevice).toBeUndefined();
    });

    test("by address only while the sighting is current, and only in its site", async () => {
      const inA: string = await addDevice({
        hostname: "10.0.0.7",
        siteId: SITE_A,
      });
      await addDevice({ hostname: "10.0.0.8", siteId: SITE_B });
      const unsited: string = await addDevice({ hostname: "10.0.0.9" });

      const current: string = await addEndpoint({
        macAddress: "00:00:00:00:00:71",
        ipAddress: " 10.0.0.7 ",
        siteId: SITE_A,
        lastSeenAt: new Date(NOW.getTime() - WALK_WINDOW_MS),
      });
      const stale: string = await addEndpoint({
        macAddress: "00:00:00:00:00:72",
        ipAddress: "10.0.0.7",
        siteId: SITE_A,
        lastSeenAt: new Date(NOW.getTime() - WALK_WINDOW_MS - 1000),
      });
      const otherSite: string = await addEndpoint({
        macAddress: "00:00:00:00:00:73",
        ipAddress: "10.0.0.8",
        siteId: SITE_A,
      });
      const neitherSited: string = await addEndpoint({
        macAddress: "00:00:00:00:00:74",
        ipAddress: "10.0.0.9",
      });
      const sitedOnlyHere: string = await addEndpoint({
        macAddress: "00:00:00:00:00:75",
        ipAddress: "10.0.0.9",
        siteId: SITE_A,
      });

      expect(await rowOf(current)).toMatchObject({
        monitoredDevice: { id: inA },
        monitoredBy: DiscoveredDeviceMatch.IpAddress,
        isSeenRecently: true,
      });
      expect((await rowOf(stale)).monitoredDevice).toBeUndefined();
      expect((await rowOf(otherSite)).monitoredDevice).toBeUndefined();
      expect((await rowOf(neitherSited)).monitoredDevice).toEqual({
        id: unsited,
      });
      expect((await rowOf(sitedOnlyHere)).monitoredDevice).toBeUndefined();
    });

    test("a controller's sighting stays current for longer than a walk's", async () => {
      expect(CONTROLLER_WINDOW_MS).toBeGreaterThan(WALK_WINDOW_MS);
      await addDevice({ hostname: "10.0.0.20" });

      const age: number = WALK_WINDOW_MS + 10 * MINUTE;
      const byController: string = await addEndpoint({
        macAddress: "00:00:00:00:00:81",
        ipAddress: "10.0.0.20",
        attachmentSource: "meraki",
        lastSeenAt: new Date(NOW.getTime() - age),
      });
      const byWalk: string = await addEndpoint({
        macAddress: "00:00:00:00:00:82",
        ipAddress: "10.0.0.20",
        lastSeenAt: new Date(NOW.getTime() - age),
      });
      const never: string = await addEndpoint({
        macAddress: "00:00:00:00:00:83",
        ipAddress: "10.0.0.20",
        lastSeenAt: null,
      });

      expect(await rowOf(byController)).toMatchObject({
        isFromController: true,
        isSeenRecently: true,
        monitoredBy: DiscoveredDeviceMatch.IpAddress,
      });
      expect(await rowOf(byWalk)).toMatchObject({
        isFromController: false,
        isSeenRecently: false,
      });
      expect((await rowOf(byWalk)).monitoredDevice).toBeUndefined();
      expect((await rowOf(never)).isSeenRecently).toBe(false);
    });

    test("a deleted endpoint and another project's are not listed", async () => {
      await addEndpoint({
        macAddress: "00:00:00:00:00:91",
        deletedAt: new Date(NOW.getTime() - MINUTE),
      });
      await addEndpoint({
        projectId: otherProjectId.toString(),
        macAddress: "00:00:00:00:00:92",
      });
      const listed: string = await addEndpoint({
        macAddress: "00:00:00:00:00:93",
      });

      const page: DiscoveredDeviceListResponse = await list({
        show: DiscoveredDeviceShow.All,
      });

      expect(
        page.rows.map((row: DiscoveredDeviceRow): string => {
          return row.id;
        }),
      ).toEqual([listed]);
      expect(page.counts.all).toBe(1);
    });
  });

  describe("searching, counting and paging", () => {
    let printer: string;
    let register: string;
    let camera: string;
    let wildcard: string;

    beforeEach(async () => {
      await addDevice({ hostname: "10.0.0.30", siteId: SITE_A });

      printer = await addEndpoint({
        macAddress: "00:1b:2c:3d:4e:01",
        ipAddress: "10.0.0.10",
        hostname: "prn-back-office",
        vendor: "Zebra Technologies",
        siteId: SITE_A,
      });
      register = await addEndpoint({
        macAddress: "00:1b:2c:3d:4e:02",
        ipAddress: "10.0.0.9",
        classification: "Front register",
        vendor: "Verifone",
        siteId: SITE_A,
      });
      camera = await addEndpoint({
        macAddress: "00:1b:2c:3d:4e:03",
        ipAddress: "10.0.0.30",
        vendor: "Axis",
        siteId: SITE_A,
      });
      wildcard = await addEndpoint({
        macAddress: "00:1b:2c:3d:4e:04",
        hostname: "lab_10",
        siteId: SITE_B,
      });
    });

    async function ids(
      request: Partial<DiscoveredDeviceListRequest>,
    ): Promise<Array<string>> {
      return (
        await list({ show: DiscoveredDeviceShow.All, ...request })
      ).rows.map((row: DiscoveredDeviceRow): string => {
        return row.id;
      });
    }

    test("finds a row by any of its names, its address, its maker or its MAC", async () => {
      const sorted: Partial<DiscoveredDeviceListRequest> = {
        sort: DiscoveredDeviceSort.IpAddress,
        sortOrder: "asc",
      };

      expect(await ids({ ...sorted, search: "BACK-office" })).toEqual([
        printer,
      ]);
      expect(await ids({ ...sorted, search: "register" })).toEqual([register]);
      expect(await ids({ ...sorted, search: "verif" })).toEqual([register]);
      expect(await ids({ ...sorted, search: "10.0.0.3" })).toEqual([camera]);
      expect(await ids({ ...sorted, search: "00:1B:2C:3D:4E:02" })).toEqual([
        register,
      ]);
      // A MAC however it is separated, as a Windows or a Cisco box prints it.
      expect(await ids({ ...sorted, search: "001b.2c3d.4e03" })).toEqual([
        camera,
      ]);
      expect(await ids({ ...sorted, search: "3d-4e-01" })).toEqual([printer]);
    });

    test("every word must match, and wildcards are only characters", async () => {
      expect(await ids({ search: "zebra 10.0.0.10" })).toEqual([printer]);
      expect(await ids({ search: "zebra axis" })).toEqual([]);
      expect(await ids({ search: "lab_1" })).toEqual([wildcard]);
      expect(await ids({ search: "lab%" })).toEqual([]);
      expect(await ids({ search: "10_0" })).toEqual([]);
    });

    test("the counts are the search's, and agree with what each choice lists", async () => {
      await DiscoveredDevices.hideFromMap({
        projectId: projectId,
        props: props,
        endpointIds: [printer, camera],
      });

      const all: DiscoveredDeviceListResponse = await list({
        show: DiscoveredDeviceShow.All,
      });

      // The camera is monitored by address: it is never hidden.
      expect(all.counts).toEqual({
        all: 4,
        notMonitored: 3,
        monitored: 1,
        hidden: 1,
      });

      for (const show of [
        DiscoveredDeviceShow.NotMonitored,
        DiscoveredDeviceShow.Monitored,
        DiscoveredDeviceShow.Hidden,
        DiscoveredDeviceShow.All,
      ]) {
        const page: DiscoveredDeviceListResponse = await list({ show: show });

        expect(page.rows).toHaveLength(page.count);
      }

      expect(await ids({ show: DiscoveredDeviceShow.Hidden })).toEqual([
        printer,
      ]);
      expect(await ids({ show: DiscoveredDeviceShow.Monitored })).toEqual([
        camera,
      ]);

      const searched: DiscoveredDeviceListResponse = await list({
        search: "zebra",
      });

      expect(searched.counts).toEqual({
        all: 1,
        notMonitored: 1,
        monitored: 0,
        hidden: 1,
      });
    });

    test("one site's rows only, when a site is asked for", async () => {
      expect(
        await ids({
          siteId: SITE_B,
        }),
      ).toEqual([wildcard]);
    });

    test("addresses sort as numbers, and rows without one after", async () => {
      expect(
        await ids({ sort: DiscoveredDeviceSort.IpAddress, sortOrder: "asc" }),
      ).toEqual([register, printer, camera, wildcard]);
      expect(
        await ids({ sort: DiscoveredDeviceSort.IpAddress, sortOrder: "desc" }),
      ).toEqual([camera, printer, register, wildcard]);
    });

    test("names sort by what the row is called, ignoring case", async () => {
      expect(
        await ids({ sort: DiscoveredDeviceSort.Name, sortOrder: "asc" }),
      ).toEqual([camera, register, wildcard, printer]);
    });

    test("pages of one never repeat or skip a row, even when every sort key ties", async () => {
      await database.query(
        `UPDATE "NetworkEndpoint" SET "lastSeenAt" = $1 WHERE "projectId" = $2`,
        [new Date(NOW.getTime() - MINUTE), projectId.toString()],
      );

      const seen: Array<string> = [];

      for (let skip: number = 0; skip < 4; skip++) {
        seen.push(...(await ids({ limit: 1, skip: skip })));
      }

      expect(new Set(seen).size).toBe(4);
      expect(await ids({ limit: 1, skip: 4 })).toEqual([]);
    });

    test("select all answers every matching id in the list's order", async () => {
      expect(
        await DiscoveredDevices.listIds({
          projectId: projectId,
          props: props,
          request: {
            ...DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
            sort: DiscoveredDeviceSort.IpAddress,
            sortOrder: "asc",
          },
        }),
      ).toEqual({ ids: [register, printer, wildcard], count: 3 });
    });
  });

  describe("hiding and showing on the map", () => {
    test("hides what is not monitored and not hidden yet, as a suppression the map reads", async () => {
      await addDevice({ hostname: "10.0.0.40" });
      const loose: string = await addEndpoint({
        macAddress: "00:00:00:00:01:01",
        ipAddress: "10.0.0.41",
        classification: "Shelf scanner",
      });
      const monitored: string = await addEndpoint({
        macAddress: "00:00:00:00:01:02",
        ipAddress: "10.0.0.40",
      });

      expect(
        await DiscoveredDevices.hideFromMap({
          projectId: projectId,
          props: props,
          endpointIds: [loose, monitored],
        }),
      ).toEqual({ changed: 1, unchanged: 0, skippedMonitored: 1, notFound: 0 });

      expect(await suppressions()).toEqual([
        {
          nodeKey: `endpoint:${loose}`,
          nodeName: "Shelf scanner",
          reason: HIDDEN_FROM_LIST_REASON,
          version: 1,
          createdByUserId: PERSON.toString(),
        },
      ]);

      // Again: nothing new is written.
      expect(
        await DiscoveredDevices.hideFromMap({
          projectId: projectId,
          props: props,
          endpointIds: [loose],
        }),
      ).toEqual({ changed: 0, unchanged: 1, skippedMonitored: 0, notFound: 0 });
      expect(await suppressions()).toHaveLength(1);
      expect((await rowOf(loose)).isHidden).toBe(true);
    });

    test("a node the map hid itself counts as hidden, and is not hidden twice", async () => {
      const endpoint: string = await addEndpoint({
        macAddress: "00:00:00:00:01:11",
      });
      await database.query(
        `INSERT INTO "NetworkTopologySuppression"
          ("_id", "version", "projectId", "nodeKey", "nodeName")
         VALUES ($1, 1, $2, $3, 'from the map')`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          `endpoint:${endpoint}`,
        ],
      );

      expect((await rowOf(endpoint)).isHidden).toBe(true);
      expect(
        (
          await DiscoveredDevices.hideFromMap({
            projectId: projectId,
            props: props,
            endpointIds: [endpoint],
          })
        ).changed,
      ).toBe(0);
    });

    test("showing removes the selected rows' suppressions and nothing else", async () => {
      const first: string = await addEndpoint({
        macAddress: "00:00:00:00:01:21",
      });
      const second: string = await addEndpoint({
        macAddress: "00:00:00:00:01:22",
      });

      await DiscoveredDevices.hideFromMap({
        projectId: projectId,
        props: props,
        endpointIds: [first, second],
      });

      expect(
        await DiscoveredDevices.showOnMap({
          projectId: projectId,
          props: props,
          endpointIds: [first],
        }),
      ).toEqual({ changed: 1, unchanged: 0, skippedMonitored: 0, notFound: 0 });
      expect(
        (await suppressions()).map((row: { nodeKey: string }): string => {
          return row.nodeKey;
        }),
      ).toEqual([`endpoint:${second}`]);
    });

    test("Show them shows every hidden node of the project, and no other project's", async () => {
      const endpoint: string = await addEndpoint({
        macAddress: "00:00:00:00:01:31",
      });
      await DiscoveredDevices.hideFromMap({
        projectId: projectId,
        props: props,
        endpointIds: [endpoint],
      });

      for (const [project, nodeKey] of [
        [projectId, `device:${ObjectID.generate().toString()}`],
        [otherProjectId, `endpoint:${ObjectID.generate().toString()}`],
      ] as Array<[ObjectID, string]>) {
        await database.query(
          `INSERT INTO "NetworkTopologySuppression"
            ("_id", "version", "projectId", "nodeKey")
           VALUES ($1, 1, $2, $3)`,
          [ObjectID.generate().toString(), project.toString(), nodeKey],
        );
      }

      expect(
        await DiscoveredDevices.showEverythingOnMap({
          projectId: projectId,
          props: props,
        }),
      ).toEqual({ changed: 2 });
      expect(await suppressions()).toEqual([]);
      expect(await suppressions(otherProjectId)).toHaveLength(1);
    });
  });

  test("a site of thousands of endpoints is listed, counted and selected quickly", async () => {
    const endpoints: number = 6000;
    const devices: number = 3000;

    await database.query(
      `INSERT INTO "NetworkDevice"
        ("_id", "version", "projectId", "name", "slug", "hostname", "macAddress", "siteId")
       SELECT gen_random_uuid(), 1, $1::uuid, 'device ' || n, 'device-' || n,
         '10.1.' || (n / 250) || '.' || (n % 250 + 1),
         CASE WHEN n % 2 = 0 THEN '02:00:00:' || lpad(to_hex(n / 65536), 2, '0') || ':' || lpad(to_hex((n / 256) % 256), 2, '0') || ':' || lpad(to_hex(n % 256), 2, '0') END,
         $2::uuid
       FROM generate_series(1, $3::int) AS n`,
      [projectId.toString(), SITE_A, devices],
    );
    await database.query(
      `INSERT INTO "NetworkEndpoint"
        ("_id", "version", "projectId", "macAddress", "ipAddress", "attachedNetworkDeviceId", "siteId", "lastSeenAt")
       SELECT gen_random_uuid(), 1, $1::uuid,
         '02:00:00:' || lpad(to_hex(n / 65536), 2, '0') || ':' || lpad(to_hex((n / 256) % 256), 2, '0') || ':' || lpad(to_hex(n % 256), 2, '0'),
         '10.1.' || (n / 250) || '.' || (n % 250 + 1),
         $2::uuid, $3::uuid, $4::timestamptz
       FROM generate_series(1, $5::int) AS n`,
      [
        projectId.toString(),
        SWITCH_ID,
        SITE_A,
        new Date(NOW.getTime() - MINUTE),
        endpoints,
      ],
    );
    await database.query(`ANALYZE "${schema}"."NetworkEndpoint"`);
    await database.query(`ANALYZE "${schema}"."NetworkDevice"`);

    const started: number = Date.now();
    const page: DiscoveredDeviceListResponse = await list({
      siteId: SITE_A,
      search: "10.1.",
      sort: DiscoveredDeviceSort.IpAddress,
      sortOrder: "asc",
      skip: 100,
    });
    const selected: { ids: Array<string>; count: number } =
      await DiscoveredDevices.listIds({
        projectId: projectId,
        props: props,
        request: { ...DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST, siteId: SITE_A },
      });
    const took: number = Date.now() - started;

    // Every device matches by address (and every other one by MAC too).
    expect(page.counts).toEqual({
      all: endpoints,
      notMonitored: endpoints - devices,
      monitored: devices,
      hidden: 0,
    });
    expect(page.rows).toHaveLength(25);
    expect(page.rows[0]!.ipAddress).toBe("10.1.12.102");
    expect(selected.ids).toHaveLength(endpoints - devices);
    expect(took).toBeLessThan(10000);
  });
});
