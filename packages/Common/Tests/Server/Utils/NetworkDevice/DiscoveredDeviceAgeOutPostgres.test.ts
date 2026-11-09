import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { KeepEditedDiscoveredDevices1809071320000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809071320000-KeepEditedDiscoveredDevices";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import DiscoveredDeviceAgeOut, {
  AGE_OUT_BATCH_SIZE,
  DiscoveredDeviceAgeOutSummary,
  MAX_AGE_OUT_BATCHES_PER_PROJECT,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut";
import DiscoveredDevices from "../../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
  DiscoveredDeviceListResponse,
} from "../../../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * Removing the discovered devices nothing sees any more (OneUptime issue
 * #6389), EXECUTED on Postgres.
 *
 * The age-out statements read NetworkEndpoint, NetworkDevice, Project and
 * NetworkTopologySuppression together and write two of them in one
 * statement - text the unit suite can only read. Only a database shows:
 *
 *   - a device is removed once it has not been seen for its project's own
 *     days, to the second, and Never removes nothing;
 *   - a monitored device stays, however either side wrote the MAC - unless
 *     only an archived, a deleted or another project's device has it;
 *   - a classified device stays, as do one a person changed or added and
 *     one never seen; a blank classification is none;
 *   - the devices of a switch that has reported nothing for a day stay,
 *     unless the switch was deleted, archived or is gone;
 *   - a removed device's Hide from map preference goes with it, and no
 *     other;
 *   - removed is soft deleted, stamped with the run's time: the list and
 *     its counts leave it out, and a device seen again is a new row;
 *   - a long backlog goes the oldest first, at most the run's batches;
 *   - the backfill marks the devices the API wrote as edited, and not the
 *     walks' own.
 *
 * The statements run through the job's own runner, the endpoint
 * repository's manager, pointed at the test database: TypeORM's Postgres
 * driver answers a bare UPDATE or DELETE with [rows, rowCount], which only
 * a run through it shows.
 *
 * Opt in with RUN_POSTGRES_DISCOVERED_DEVICES_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check, as DiscoveredDeviceListPostgres.
 * The STRUCTURE of the four tables is cloned into a unique schema
 * (search_path holds only that schema) that is dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * DISCOVERED_DEVICES_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * DISCOVERED_DEVICES_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DISCOVERED_DEVICES_TESTS"] === "true"
    ? describe
    : describe.skip;

const NOW: Date = new Date("2026-11-09T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

interface EndpointFields {
  projectId?: string;
  macAddress: string;
  lastSeenAt?: Date | null;
  classification?: string | null;
  editedAt?: Date | null;
  createdByUserId?: string | null;
  attachedNetworkDeviceId?: string;
  version?: number;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

interface DeviceFields {
  id?: string;
  projectId?: string;
  macAddress?: string | null;
  isArchived?: boolean;
  deletedAt?: Date | null;
}

interface EndpointState {
  _id: string;
  deletedAt: Date | null;
  updatedAt: Date;
  editedAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  classification: string | null;
}

function propsFor(
  projectId: ObjectID,
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
    userId: ObjectID.generate(),
    userTenantAccessPermission: { [projectId.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

describePostgres("removing discovered devices nothing sees, on Postgres", () => {
  const schema: string = `discovered_device_age_out_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  let projectId: string;
  // A switch that saw something a minute ago: its devices may be aged.
  let reportingSwitch: string;
  let macCounter: number;

  function nextMac(): string {
    macCounter += 1;
    return `02:00:00:00:${String(Math.floor(macCounter / 100)).padStart(2, "0")}:${String(macCounter % 100).padStart(2, "0")}`;
  }

  async function addProject(
    id: string,
    retentionInDays?: number,
    deletedAt?: Date,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "Project" ("_id", "version", "name", "slug", "deletedAt")
       VALUES ($1, 1, 'Acme Retail', $2, $3)`,
      [id, `acme-${id}`, deletedAt ?? null],
    );

    if (retentionInDays !== undefined) {
      await database.query(
        `UPDATE "Project" SET "discoveredDeviceRetentionInDays" = $2 WHERE "_id" = $1`,
        [id, retentionInDays],
      );
    }
  }

  async function addDevice(fields: DeviceFields = {}): Promise<string> {
    const id: string = fields.id || ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "NetworkDevice"
        ("_id", "version", "projectId", "name", "slug", "hostname",
         "macAddress", "isArchived", "deletedAt")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        fields.projectId || projectId,
        `device-${id}`,
        `device-${id}`,
        `10.0.${macCounter % 250}.1`,
        fields.macAddress ?? null,
        fields.isArchived ?? false,
        fields.deletedAt ?? null,
      ],
    );

    return id;
  }

  async function addEndpoint(fields: EndpointFields): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "NetworkEndpoint"
        ("_id", "version", "projectId", "macAddress", "classification",
         "editedAt", "createdByUserId", "attachedNetworkDeviceId",
         "lastSeenAt", "firstSeenAt", "updatedAt", "deletedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)`,
      [
        id,
        fields.version ?? 0,
        fields.projectId || projectId,
        fields.macAddress,
        fields.classification ?? null,
        fields.editedAt ?? null,
        fields.createdByUserId ?? null,
        fields.attachedNetworkDeviceId || reportingSwitch,
        fields.lastSeenAt === undefined ? ago(MINUTE) : fields.lastSeenAt,
        fields.updatedAt || ago(40 * DAY),
        fields.deletedAt ?? null,
      ],
    );

    return id;
  }

  // A switch of the project that saw something a minute ago: it reports.
  async function addReportingSwitch(project: string): Promise<string> {
    const id: string = await addDevice({
      projectId: project,
      macAddress: nextMac(),
    });

    await addEndpoint({
      projectId: project,
      macAddress: nextMac(),
      attachedNetworkDeviceId: id,
      lastSeenAt: ago(MINUTE),
    });

    return id;
  }

  async function addSuppression(
    nodeKey: string,
    project: string = projectId,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "NetworkTopologySuppression" ("_id", "version", "projectId", "nodeKey")
       VALUES ($1, 1, $2, $3)`,
      [ObjectID.generate().toString(), project, nodeKey],
    );
  }

  async function stateOf(id: string): Promise<EndpointState> {
    const rows: Array<EndpointState> = await database.query(
      `SELECT "_id", "deletedAt", "updatedAt", "editedAt", "firstSeenAt",
              "lastSeenAt", "classification"
       FROM "NetworkEndpoint" WHERE "_id" = $1`,
      [id],
    );

    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function isLive(id: string): Promise<boolean> {
    return (await stateOf(id)).deletedAt === null;
  }

  async function suppressionKeys(project: string = projectId): Promise<
    Array<string>
  > {
    const rows: Array<{ nodeKey: string }> = await database.query(
      `SELECT "nodeKey" FROM "NetworkTopologySuppression"
       WHERE "projectId" = $1 ORDER BY "nodeKey"`,
      [project],
    );

    return rows.map((row: { nodeKey: string }): string => {
      return row.nodeKey;
    });
  }

  async function run(): Promise<DiscoveredDeviceAgeOutSummary> {
    return DiscoveredDeviceAgeOut.run();
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
      "Project",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // The columns and the index the migrations added, as they added them.
    const columns: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1
         AND ((table_name = 'Project' AND column_name = 'discoveredDeviceRetentionInDays')
           OR (table_name = 'NetworkEndpoint' AND column_name = 'editedAt'))
       ORDER BY table_name`,
      [schema],
    );

    expect(columns).toEqual([
      {
        table_name: "NetworkEndpoint",
        column_name: "editedAt",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "Project",
        column_name: "discoveredDeviceRetentionInDays",
        data_type: "integer",
        is_nullable: "NO",
        column_default: "30",
      },
    ]);

    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'IDX_aabb790d91b44c32192ba02414'`,
    );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.indexdef).toContain(
      `("projectId", "lastSeenAt") WHERE ("deletedAt" IS NULL)`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const table of [
      "NetworkEndpoint",
      "NetworkDevice",
      "NetworkTopologySuppression",
      "Project",
    ]) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    DiscoveredDeviceAgeOut.now = (): Date => {
      return NOW;
    };

    macCounter = 0;
    projectId = ObjectID.generate().toString();
    await addProject(projectId);
    reportingSwitch = await addReportingSwitch(projectId);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a device not seen for the project's 30 days is removed at the run's time, and one seen since stays", async () => {
    const gone: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: ago(30 * DAY + SECOND),
    });
    const exactly: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: ago(30 * DAY),
    });
    const recent: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: ago(29 * DAY),
    });

    expect(await run()).toEqual({
      projects: 1,
      failedProjects: 0,
      removed: 1,
      unhidden: 0,
      isCutShort: false,
    });

    const removed: EndpointState = await stateOf(gone);

    expect(removed.deletedAt).toEqual(NOW);
    expect(removed.updatedAt).toEqual(NOW);
    expect(await isLive(exactly)).toBe(true);
    expect(await isLive(recent)).toBe(true);

    // A second run finds nothing more to do.
    expect((await run()).removed).toBe(0);
  });

  test("each project goes by its own days, Never removes nothing, and a deleted project is left alone", async () => {
    const never: string = ObjectID.generate().toString();
    const year: string = ObjectID.generate().toString();
    const week: string = ObjectID.generate().toString();
    const deleted: string = ObjectID.generate().toString();

    await addProject(never, 0);
    await addProject(year, 365);
    await addProject(week, 7);
    await addProject(deleted, 7, ago(DAY));

    const switchOf: Record<string, string> = {};

    for (const project of [never, year, week, deleted]) {
      switchOf[project] = await addReportingSwitch(project);
    }

    const oldDeviceOf: (project: string, days: number) => Promise<string> = (
      project: string,
      days: number,
    ): Promise<string> => {
      return addEndpoint({
        projectId: project,
        macAddress: nextMac(),
        attachedNetworkDeviceId: switchOf[project]!,
        lastSeenAt: ago(days * DAY),
      });
    };

    const keptByNever: string = await oldDeviceOf(never, 900);
    const keptByYear: string = await oldDeviceOf(year, 300);
    const goneAfterYear: string = await oldDeviceOf(year, 366);
    const goneAfterWeek: string = await oldDeviceOf(week, 8);
    const keptByDeleted: string = await oldDeviceOf(deleted, 90);

    const summary: DiscoveredDeviceAgeOutSummary = await run();

    expect(summary.projects).toBe(2);
    expect(summary.removed).toBe(2);
    expect(await isLive(keptByNever)).toBe(true);
    expect(await isLive(keptByYear)).toBe(true);
    expect(await isLive(goneAfterYear)).toBe(false);
    expect(await isLive(goneAfterWeek)).toBe(false);
    expect(await isLive(keptByDeleted)).toBe(true);
  });

  test("a monitored device stays however either side wrote its MAC; one only an archived, deleted or other project's device has does not", async () => {
    await addDevice({ macAddress: "00-1A-2B-3C-4D-5E" });
    await addDevice({ macAddress: "001a.2b3c.4d60" });
    await addDevice({ macAddress: "00:1a:2b:3c:4d:61", isArchived: true });
    await addDevice({ macAddress: "00:1a:2b:3c:4d:62", deletedAt: ago(DAY) });
    await addDevice({
      projectId: ObjectID.generate().toString(),
      macAddress: "00:1a:2b:3c:4d:63",
    });
    // Not twelve hex digits: it monitors nothing.
    await addDevice({ macAddress: "00:1a" });

    const old: Date = ago(60 * DAY);
    const monitored: string = await addEndpoint({
      macAddress: "00:1a:2b:3c:4d:5e",
      lastSeenAt: old,
    });
    const monitoredDotted: string = await addEndpoint({
      macAddress: "00:1A:2B:3C:4D:60",
      lastSeenAt: old,
    });
    const archivedOnly: string = await addEndpoint({
      macAddress: "00:1a:2b:3c:4d:61",
      lastSeenAt: old,
    });
    const deletedOnly: string = await addEndpoint({
      macAddress: "00:1a:2b:3c:4d:62",
      lastSeenAt: old,
    });
    const otherProjectOnly: string = await addEndpoint({
      macAddress: "00:1a:2b:3c:4d:63",
      lastSeenAt: old,
    });
    const shortMac: string = await addEndpoint({
      macAddress: "00:1a",
      lastSeenAt: old,
    });

    expect((await run()).removed).toBe(4);
    expect(await isLive(monitored)).toBe(true);
    expect(await isLive(monitoredDotted)).toBe(true);
    expect(await isLive(archivedOnly)).toBe(false);
    expect(await isLive(deletedOnly)).toBe(false);
    expect(await isLive(otherProjectOnly)).toBe(false);
    expect(await isLive(shortMac)).toBe(false);
  });

  test("a classified, an edited, a person-added and a never-seen device stay; a blank classification is none", async () => {
    const old: Date = ago(45 * DAY);
    const classified: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: old,
      classification: "Back office printer",
    });
    const blank: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: old,
      classification: "   ",
    });
    const edited: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: old,
      editedAt: ago(50 * DAY),
    });
    const added: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: old,
      createdByUserId: ObjectID.generate().toString(),
    });
    const neverSeen: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: null,
    });

    expect((await run()).removed).toBe(1);
    expect(await isLive(classified)).toBe(true);
    expect(await isLive(blank)).toBe(false);
    expect(await isLive(edited)).toBe(true);
    expect(await isLive(added)).toBe(true);
    expect(await isLive(neverSeen)).toBe(true);
  });

  test("the devices of a switch quiet for a day wait for it; a deleted, archived or missing switch's do not", async () => {
    const old: Date = ago(40 * DAY);
    const quiet: string = await addDevice({ macAddress: nextMac() });
    const quietLately: string = await addDevice({ macAddress: nextMac() });
    const deleted: string = await addDevice({
      macAddress: nextMac(),
      deletedAt: ago(2 * DAY),
    });
    const archived: string = await addDevice({
      macAddress: nextMac(),
      isArchived: true,
    });
    const missing: string = ObjectID.generate().toString();

    // The quiet one saw its last device 25 hours ago: more than a day.
    await addEndpoint({
      macAddress: nextMac(),
      attachedNetworkDeviceId: quietLately,
      lastSeenAt: ago(25 * HOUR),
    });

    const onQuiet: string = await addEndpoint({
      macAddress: nextMac(),
      attachedNetworkDeviceId: quiet,
      lastSeenAt: old,
    });
    const onQuietLately: string = await addEndpoint({
      macAddress: nextMac(),
      attachedNetworkDeviceId: quietLately,
      lastSeenAt: old,
    });
    const onDeleted: string = await addEndpoint({
      macAddress: nextMac(),
      attachedNetworkDeviceId: deleted,
      lastSeenAt: old,
    });
    const onArchived: string = await addEndpoint({
      macAddress: nextMac(),
      attachedNetworkDeviceId: archived,
      lastSeenAt: old,
    });
    const onMissing: string = await addEndpoint({
      macAddress: nextMac(),
      attachedNetworkDeviceId: missing,
      lastSeenAt: old,
    });
    const onReporting: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: old,
    });

    expect((await run()).removed).toBe(4);
    expect(await isLive(onQuiet)).toBe(true);
    expect(await isLive(onQuietLately)).toBe(true);
    expect(await isLive(onDeleted)).toBe(false);
    expect(await isLive(onArchived)).toBe(false);
    expect(await isLive(onMissing)).toBe(false);
    expect(await isLive(onReporting)).toBe(false);
  });

  test("a removed device's Hide from map preference goes with it, and no other", async () => {
    const otherProject: string = ObjectID.generate().toString();
    const gone: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: ago(31 * DAY),
    });
    const kept: string = await addEndpoint({
      macAddress: nextMac(),
      lastSeenAt: ago(31 * DAY),
      classification: "Printer",
    });

    await addSuppression(`endpoint:${gone}`);
    await addSuppression(`endpoint:${kept}`);
    await addSuppression(`device:${reportingSwitch}`);
    await addSuppression(`endpoint:${gone}`, otherProject);

    expect(await run()).toMatchObject({ removed: 1, unhidden: 1 });
    expect(await suppressionKeys()).toEqual(
      [`device:${reportingSwitch}`, `endpoint:${kept}`].sort(),
    );
    expect(await suppressionKeys(otherProject)).toEqual([`endpoint:${gone}`]);
  });

  test("the list and its counts leave a removed device out, and still say how long devices stay", async () => {
    await addEndpoint({ macAddress: nextMac(), lastSeenAt: ago(31 * DAY) });
    await addEndpoint({ macAddress: nextMac(), lastSeenAt: ago(31 * DAY) });
    await addEndpoint({ macAddress: nextMac(), lastSeenAt: ago(2 * DAY) });

    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);
    DiscoveredDevices.now = (): Date => {
      return NOW;
    };

    const list: () => Promise<DiscoveredDeviceListResponse> =
      (): Promise<DiscoveredDeviceListResponse> => {
        return DiscoveredDevices.list({
          projectId: new ObjectID(projectId),
          props: propsFor(new ObjectID(projectId), [
            Permission.ReadNetworkEndpoint,
          ]),
          request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
        });
      };

    // The reporting device, two past the cut-off and one within it.
    expect((await list()).counts.all).toBe(4);

    await run();

    const after: DiscoveredDeviceListResponse = await list();

    expect(after.counts.all).toBe(2);
    expect(after.rows).toHaveLength(2);
    expect(after.retentionInDays).toBe(30);
  });

  test("a removed device seen again comes back as a new one: first seen now, nothing hidden", async () => {
    const mac: string = "aa:bb:cc:00:64:89";
    const gone: string = await addEndpoint({
      macAddress: mac,
      lastSeenAt: ago(31 * DAY),
    });

    await addSuppression(`endpoint:${gone}`);
    await run();

    expect(await isLive(gone)).toBe(false);

    jest
      .spyOn(NetworkEndpointService, "findBy")
      .mockImplementation((async (data: { query: { projectId: ObjectID } }) => {
        const rows: Array<Record<string, unknown>> = await database.query(
          `SELECT * FROM "NetworkEndpoint"
           WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
          [data.query.projectId.toString()],
        );

        return rows.map((row: Record<string, unknown>) => {
          return {
            ...row,
            attachedNetworkDeviceId: new ObjectID(
              String(row["attachedNetworkDeviceId"]),
            ),
            attachedInterfaceIndex: row["attachedInterfaceIndex"] ?? undefined,
            attachedPortName: row["attachedPortName"] ?? undefined,
            vlanId: row["vlanId"] ?? undefined,
            siteId: row["siteId"] ? new ObjectID(String(row["siteId"])) : undefined,
            ipAddress: row["ipAddress"] ?? undefined,
            hostname: row["hostname"] ?? undefined,
            attachmentSource: row["attachmentSource"] ?? undefined,
          };
        });
      }) as never);

    const seenAgainAt: Date = new Date(NOW.getTime() + HOUR);

    expect(
      await NetworkEndpointService.upsertControllerClients({
        projectId: new ObjectID(projectId),
        source: "meraki",
        clients: [
          {
            macAddress: mac,
            seenAt: seenAgainAt,
            deviceId: new ObjectID(reportingSwitch),
          },
        ],
        now: seenAgainAt,
      }),
    ).toBe(1);

    const rows: Array<EndpointState> = await database.query(
      `SELECT "_id", "deletedAt", "firstSeenAt", "lastSeenAt", "classification", "editedAt"
       FROM "NetworkEndpoint" WHERE "macAddress" = $1
       ORDER BY "deletedAt" NULLS LAST`,
      [mac],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!._id).toBe(gone);
    expect(rows[0]!.deletedAt).toEqual(NOW);
    expect(rows[1]!._id).not.toBe(gone);
    expect(rows[1]!.deletedAt).toBeNull();
    expect(rows[1]!.firstSeenAt).toEqual(seenAgainAt);
    expect(rows[1]!.editedAt).toBeNull();
    // Its old preference went with the old row: nothing hides the new one.
    expect(await suppressionKeys()).toEqual([]);
  });

  test("a long backlog goes the oldest first, at most the run's batches, and the rest next run", async () => {
    const backlog: number =
      MAX_AGE_OUT_BATCHES_PER_PROJECT * AGE_OUT_BATCH_SIZE + 500;

    await database.query(
      `INSERT INTO "NetworkEndpoint"
        ("version", "projectId", "macAddress", "attachedNetworkDeviceId", "lastSeenAt")
       SELECT 0, $1, '06' || lpad(to_hex(n), 10, '0'), $2,
              $3::timestamptz + make_interval(secs => n)
       FROM generate_series(1, $4::int) AS n`,
      [projectId, reportingSwitch, ago(60 * DAY), backlog],
    );
    await database.query(`ANALYZE "${schema}"."NetworkEndpoint"`);

    const first: DiscoveredDeviceAgeOutSummary = await run();

    expect(first.removed).toBe(
      MAX_AGE_OUT_BATCHES_PER_PROJECT * AGE_OUT_BATCH_SIZE,
    );

    // What is left is the newest of the backlog.
    const left: Array<{ count: number; oldest: Date }> = await database.query(
      `SELECT COUNT(*)::int AS "count", MIN("lastSeenAt") AS "oldest"
       FROM "NetworkEndpoint"
       WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "macAddress" LIKE '06%'`,
      [projectId],
    );

    expect(left[0]!.count).toBe(500);
    expect(left[0]!.oldest).toEqual(
      new Date(
        ago(60 * DAY).getTime() +
          (MAX_AGE_OUT_BATCHES_PER_PROJECT * AGE_OUT_BATCH_SIZE + 1) * SECOND,
      ),
    );

    expect((await run()).removed).toBe(500);
  });

  test("the backfill marks the devices the API wrote as edited, when they last changed, and not the walks' own", async () => {
    const changedAt: Date = ago(200 * DAY);
    const old: Date = ago(100 * DAY);
    const byApi: string = await addEndpoint({
      macAddress: nextMac(),
      version: 3,
      updatedAt: changedAt,
      lastSeenAt: old,
    });
    const byWalk: string = await addEndpoint({
      macAddress: nextMac(),
      version: 0,
      updatedAt: changedAt,
      lastSeenAt: old,
    });
    const alreadyEdited: string = await addEndpoint({
      macAddress: nextMac(),
      version: 2,
      updatedAt: changedAt,
      editedAt: ago(5 * DAY),
      lastSeenAt: old,
    });
    const deletedByPerson: string = await addEndpoint({
      macAddress: nextMac(),
      version: 2,
      updatedAt: changedAt,
      lastSeenAt: old,
      deletedAt: ago(DAY),
    });

    const runner: QueryRunner = database.createQueryRunner();

    try {
      await new KeepEditedDiscoveredDevices1809071320000().up(runner);
      // Run again, it changes nothing.
      await new KeepEditedDiscoveredDevices1809071320000().up(runner);
    } finally {
      await runner.release();
    }

    expect((await stateOf(byApi)).editedAt).toEqual(changedAt);
    expect((await stateOf(byWalk)).editedAt).toBeNull();
    expect((await stateOf(alreadyEdited)).editedAt).toEqual(ago(5 * DAY));
    expect((await stateOf(deletedByPerson)).editedAt).toBeNull();

    await run();

    expect(await isLive(byApi)).toBe(true);
    expect(await isLive(byWalk)).toBe(false);
    expect(await isLive(alreadyEdited)).toBe(true);
  });
});
