import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService, {
  DISCOVERED_DETAILS_MERGE_CHUNK_SIZE,
} from "../../../Server/Services/NetworkDeviceService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
 * NetworkDeviceService.mergeDiscoveredDetails EXECUTED on Postgres
 * (OneUptime issue #5185).
 *
 * The one write of a device's discovered details after it is created is a
 * single UPDATE that unpacks every patch of a batch with jsonb_to_recordset
 * and merges each as `(details - unset) || set`. The unit suite pins the
 * statement's text; only a database shows what it does:
 *
 *   - it starts a device with no record at {} and adds the keys it sets;
 *   - it replaces its own keys and keeps every key another writer (the ARP
 *     learner, the poll) left, and drops only the keys it names;
 *   - it never reaches a device of another project, nor a deleted one;
 *   - two writers merging at once into the same row both land: the row lock
 *     serialises the statements, and neither reads a stale column;
 *   - a batch larger than one chunk is written whole;
 *   - it leaves updatedAt alone.
 *
 * Opt in with RUN_POSTGRES_NETWORK_DEVICE_DISCOVERED_DETAILS_TESTS=true
 * against a Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The NetworkDevice
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema) that is dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from
 * NETWORK_DEVICE_DISCOVERED_DETAILS_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from NETWORK_DEVICE_DISCOVERED_DETAILS_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_DEVICE_DISCOVERED_DETAILS_TESTS"] === "true"
    ? describe
    : describe.skip;

// Columns a fixture row must fill; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

const SCAN_READER: JSONObject = {
  type: "discoveryScan",
  id: "80000000-0000-4000-8000-000000000001",
  name: "Store subnets",
};
const ROUTER_READER: JSONObject = {
  type: "networkDevice",
  id: "40000000-0000-4000-8000-000000000099",
  name: "core-rtr-01",
};

function scanReading(value: string, readAt: string): JSONObject {
  return { value: value, method: "snmp", readBy: SCAN_READER, readAt: readAt };
}

function arpReading(value: string, readAt: string): JSONObject {
  return {
    value: value,
    method: "arpTable",
    readBy: ROUTER_READER,
    readAt: readAt,
  };
}

describePostgres("a device's discovered details merged on Postgres", () => {
  const schema: string = `discovered_details_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["NETWORK_DEVICE_DISCOVERED_DETAILS_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["NETWORK_DEVICE_DISCOVERED_DETAILS_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["NETWORK_DEVICE_DISCOVERED_DETAILS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."NetworkDevice" (LIKE public."NetworkDevice" INCLUDING ALL)`,
    );
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'NetworkDevice' AND is_nullable = 'NO'`,
      [schema],
    );
    for (const column of columns) {
      if (!KEPT_NOT_NULL.includes(column.column_name)) {
        await database.query(
          `ALTER TABLE "${schema}"."NetworkDevice" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }
    // The column the migration added, as the migration added it.
    const added: Array<{ data_type: string }> = await database.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'NetworkDevice'
         AND column_name = 'discoveredDetails'`,
      [schema],
    );
    expect(added).toEqual([{ data_type: "jsonb" }]);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`DELETE FROM "${schema}"."NetworkDevice"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertDevice(data: {
    projectId?: ObjectID;
    discoveredDetails?: JSONObject | null;
    deletedAt?: Date;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "name", "hostname", "discoveredDetails",
          "deletedAt", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, 'edge-sw-07', '10.20.12.7', $3::jsonb, $4,
               '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1)`,
      [
        id.toString(),
        (data.projectId || PROJECT_ID).toString(),
        data.discoveredDetails ? JSON.stringify(data.discoveredDetails) : null,
        data.deletedAt || null,
      ],
    );
    return id;
  }

  async function detailsOf(id: ObjectID): Promise<JSONObject | null> {
    const rows: Array<{ discoveredDetails: JSONObject | null }> =
      await database.query(
        `SELECT "discoveredDetails" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
        [id.toString()],
      );
    expect(rows).toHaveLength(1);
    return rows[0]!.discoveredDetails;
  }

  test("a device with no record starts at {} and gets what is set", async () => {
    const id: ObjectID = await insertDevice({});

    const sent: number = await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: id,
          set: {
            sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
          },
        },
      ],
    });

    expect(sent).toBe(1);
    expect(await detailsOf(id)).toEqual({
      sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
    });
  });

  test("a merge replaces its own keys and keeps every other writer's", async () => {
    const id: ObjectID = await insertDevice({
      discoveredDetails: {
        sysName: scanReading("old-name", "2026-10-20T07:00:00.000Z"),
        macAddress: arpReading("00:1b:54:c2:7a:07", "2026-10-23T06:00:00.000Z"),
      },
    });

    await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: id,
          set: {
            sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
          },
        },
      ],
    });

    expect(await detailsOf(id)).toEqual({
      sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
      macAddress: arpReading("00:1b:54:c2:7a:07", "2026-10-23T06:00:00.000Z"),
    });
  });

  test("unset drops only the keys it names", async () => {
    const id: ObjectID = await insertDevice({
      discoveredDetails: {
        sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
        sysLocation: scanReading("Back office", "2026-10-23T07:00:00.000Z"),
      },
    });

    await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [{ deviceId: id, unset: ["sysLocation"] }],
    });

    expect(await detailsOf(id)).toEqual({
      sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
    });
  });

  test("another project's device, and a deleted one, are never touched", async () => {
    const theirs: ObjectID = await insertDevice({
      projectId: OTHER_PROJECT_ID,
    });
    const deleted: ObjectID = await insertDevice({
      deletedAt: new Date("2026-10-22T00:00:00.000Z"),
    });

    await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [theirs, deleted].map((deviceId: ObjectID) => {
        return {
          deviceId: deviceId,
          set: {
            sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
          },
        };
      }),
    });

    expect(await detailsOf(theirs)).toBeNull();
    expect(await detailsOf(deleted)).toBeNull();
  });

  test("two writers merging into one row at once both land", async () => {
    const id: ObjectID = await insertDevice({});

    await Promise.all([
      NetworkDeviceService.mergeDiscoveredDetails({
        projectId: PROJECT_ID,
        patches: [
          {
            deviceId: id,
            set: {
              sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
            },
          },
        ],
      }),
      NetworkDeviceService.mergeDiscoveredDetails({
        projectId: PROJECT_ID,
        patches: [
          {
            deviceId: id,
            set: {
              macAddress: arpReading(
                "00:1b:54:c2:7a:07",
                "2026-10-23T07:00:00.000Z",
              ),
            },
          },
        ],
      }),
    ]);

    expect(Object.keys((await detailsOf(id)) || {}).sort()).toEqual([
      "macAddress",
      "sysName",
    ]);
  });

  test("a batch larger than one chunk is written whole", async () => {
    const count: number = DISCOVERED_DETAILS_MERGE_CHUNK_SIZE + 3;
    const ids: Array<ObjectID> = [];
    for (let index: number = 0; index < count; index++) {
      ids.push(ObjectID.generate());
    }
    await database.query(
      `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "name", "createdAt", "updatedAt", "version")
       SELECT id::uuid, $2::uuid, 'device', now(), now(), 1
       FROM unnest($1::text[]) AS id`,
      [
        ids.map((id: ObjectID) => {
          return id.toString();
        }),
        PROJECT_ID.toString(),
      ],
    );

    const sent: number = await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: ids.map((deviceId: ObjectID) => {
        return {
          deviceId: deviceId,
          set: {
            sysName: scanReading("device", "2026-10-23T07:00:00.000Z"),
          },
        };
      }),
    });

    expect(sent).toBe(count);
    const rows: Array<{ written: string }> = await database.query(
      `SELECT count(*)::text AS written FROM "${schema}"."NetworkDevice"
       WHERE "discoveredDetails" ? 'sysName'`,
    );
    expect(rows[0]!.written).toBe(String(count));
  });

  test("an entry the column's reader refuses writes nothing", async () => {
    const id: ObjectID = await insertDevice({});

    const sent: number = await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: id,
          set: {
            // A system name is read over SNMP, never from an ARP table.
            sysName: arpReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
            notADetail: { value: "x" },
          },
        },
      ],
    });

    expect(sent).toBe(0);
    expect(await detailsOf(id)).toBeNull();
  });

  test("updatedAt does not move: nothing about the device's settings changed", async () => {
    const id: ObjectID = await insertDevice({});

    await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: id,
          set: {
            sysName: scanReading("edge-sw-07", "2026-10-23T07:00:00.000Z"),
          },
        },
      ],
    });

    const rows: Array<{ updatedAt: Date }> = await database.query(
      `SELECT "updatedAt" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
      [id.toString()],
    );
    expect(new Date(rows[0]!.updatedAt).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
});
