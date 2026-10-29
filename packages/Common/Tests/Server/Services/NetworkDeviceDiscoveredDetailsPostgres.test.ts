import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService, {
  DISCOVERED_DETAILS_MERGE_CHUNK_SIZE,
} from "../../../Server/Services/NetworkDeviceService";
import { JSONObject } from "../../../Types/JSON";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
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
 * And what a network controller connection (the Meraki dashboard) reads and
 * writes there (NetworkControllerInventory):
 *
 *   - its reading, the `controller` key, is merged whole beside the other
 *     writers' keys, and the next one replaces it whole;
 *   - findControllerMatchCandidates finds the devices its device list may
 *     describe - by serial number without case or padding, by a MAC typed
 *     or learned from an ARP table, by the address a device is polled at,
 *     or by the connection's own earlier reading - in the project only,
 *     never a deleted or archived device, and reads refreshRequestedAt, the
 *     column AddNetworkDeviceRefreshRequestedAt1808300000000 added;
 *   - forgetControllerReadings drops that connection's reading only, and
 *     leaves updatedAt alone.
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

  /*
   * ------------------------------------------------------------------
   * What a network controller connection reads and writes
   * ------------------------------------------------------------------
   */

  const CONNECTION_ID: ObjectID = ObjectID.generate();
  const OTHER_CONNECTION_ID: ObjectID = ObjectID.generate();

  function controllerReading(
    connectionId: ObjectID,
    values: Record<string, string>,
  ): NetworkDeviceControllerReading {
    const reading: NetworkDeviceControllerReading | undefined =
      buildControllerReading({
        provider: NetworkControllerProvider.Meraki,
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.NetworkController,
          id: connectionId.toString(),
          name: "Acme Retail",
        },
        readAt: "2026-10-28T10:00:00.000Z",
        values: values,
      });

    if (!reading) {
      throw new Error("The controller reading was not built");
    }

    return reading;
  }

  async function insertCandidate(data: {
    projectId?: ObjectID;
    hostname?: string;
    serialNumber?: string;
    macAddress?: string;
    discoveredDetails?: JSONObject;
    isArchived?: boolean;
    deletedAt?: Date;
    refreshRequestedAt?: Date;
  }): Promise<string> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "name", "hostname", "serialNumber", "macAddress",
          "discoveredDetails", "isArchived", "deletedAt", "refreshRequestedAt",
          "createdAt", "updatedAt", "version")
       VALUES ($1, $2, 'device', $3, $4, $5, $6::jsonb, $7, $8, $9,
               '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1)`,
      [
        id.toString(),
        (data.projectId || PROJECT_ID).toString(),
        data.hostname || null,
        data.serialNumber || null,
        data.macAddress || null,
        data.discoveredDetails ? JSON.stringify(data.discoveredDetails) : null,
        data.isArchived === true,
        data.deletedAt || null,
        data.refreshRequestedAt || null,
      ],
    );
    return id.toString();
  }

  test("a controller reading is merged whole beside the other writers' keys, and the next replaces it whole", async () => {
    const id: ObjectID = await insertDevice({
      discoveredDetails: {
        macAddress: arpReading("00:1b:54:c2:7a:07", "2026-10-23T06:00:00.000Z"),
      },
    });
    const first: NetworkDeviceControllerReading = controllerReading(
      CONNECTION_ID,
      {
        name: "Lobby AP",
        model: "MR46",
        serialNumber: "Q2KD-ABCD-1234",
        firmwareVersion: "wireless-29-7",
        networkName: "Branch 12",
      },
    );

    expect(
      await NetworkDeviceService.mergeDiscoveredDetails({
        projectId: PROJECT_ID,
        patches: [{ deviceId: id, set: { controller: first } }],
      }),
    ).toBe(1);
    expect(await detailsOf(id)).toEqual({
      macAddress: arpReading("00:1b:54:c2:7a:07", "2026-10-23T06:00:00.000Z"),
      controller: JSON.parse(JSON.stringify(first)),
    });

    // The next read: a firmware upgrade, and Meraki says no network now.
    const next: NetworkDeviceControllerReading = controllerReading(
      CONNECTION_ID,
      {
        name: "Lobby AP",
        model: "MR46",
        serialNumber: "Q2KD-ABCD-1234",
        firmwareVersion: "wireless-30-1",
      },
    );

    await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [{ deviceId: id, set: { controller: next } }],
    });

    const after: JSONObject | null = await detailsOf(id);
    expect(after?.["controller"]).toEqual(JSON.parse(JSON.stringify(next)));
    // Nothing of the reading before it is left behind.
    expect(
      (after?.["controller"] as { values: JSONObject }).values["networkName"],
    ).toBeUndefined();

    // A device the connection no longer describes loses it, and only it.
    await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [{ deviceId: id, unset: ["controller"] }],
    });
    expect(await detailsOf(id)).toEqual({
      macAddress: arpReading("00:1b:54:c2:7a:07", "2026-10-23T06:00:00.000Z"),
    });
  });

  test("the devices a connection's device list may describe, by each rule, in the project, live and not archived", async () => {
    const askedAt: Date = new Date("2026-10-28T11:59:00.000Z");
    const bySerial: string = await insertCandidate({
      serialNumber: " q2kd-abcd-1234 ",
      refreshRequestedAt: askedAt,
    });
    const byTypedMac: string = await insertCandidate({
      macAddress: "e0:55:3d:12:34:57",
    });
    const byLearnedMac: string = await insertCandidate({
      discoveredDetails: {
        macAddress: arpReading("e0:55:3d:12:34:58", "2026-10-23T06:00:00.000Z"),
      },
    });
    const byAddress: string = await insertCandidate({
      hostname: "10.20.30.44",
    });
    const describedBefore: string = await insertCandidate({
      hostname: "10.99.0.1",
      discoveredDetails: {
        controller: JSON.parse(
          JSON.stringify(
            controllerReading(CONNECTION_ID, {
              serialNumber: "Q2KD-GONE-0001",
            }),
          ),
        ),
      },
    });

    // None of these.
    await insertCandidate({
      hostname: "10.99.0.2",
      discoveredDetails: {
        controller: JSON.parse(
          JSON.stringify(
            controllerReading(OTHER_CONNECTION_ID, {
              serialNumber: "Q2KD-ELSE-0001",
            }),
          ),
        ),
      },
    });
    await insertCandidate({
      projectId: OTHER_PROJECT_ID,
      serialNumber: "Q2KD-ABCD-1234",
    });
    await insertCandidate({
      serialNumber: "Q2KD-ABCD-1234",
      deletedAt: new Date("2026-10-22T00:00:00.000Z"),
    });
    await insertCandidate({
      macAddress: "e0:55:3d:12:34:57",
      isArchived: true,
    });
    await insertCandidate({
      hostname: "10.20.30.99",
      serialNumber: "FOC1840X0AB",
      macAddress: "00:1b:54:c2:7a:01",
    });

    const found: Awaited<
      ReturnType<typeof NetworkDeviceService.findControllerMatchCandidates>
    > = await NetworkDeviceService.findControllerMatchCandidates({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      lookup: {
        serials: ["Q2KD-ABCD-1234"],
        macs: ["e0:55:3d:12:34:57", "e0:55:3d:12:34:58"],
        addresses: ["10.20.30.44"],
      },
      limit: 100,
    });

    expect(
      found
        .map((row: { id: string }) => {
          return row.id;
        })
        .sort(),
    ).toEqual(
      [bySerial, byTypedMac, byLearnedMac, byAddress, describedBefore].sort(),
    );

    const serialRow: (typeof found)[number] | undefined = found.find(
      (row: { id: string }) => {
        return row.id === bySerial;
      },
    );
    expect(serialRow?.serialNumber).toBe(" q2kd-abcd-1234 ");
    expect(serialRow?.isArchived).toBe(false);
    expect(new Date(serialRow!.refreshRequestedAt!).toISOString()).toBe(
      askedAt.toISOString(),
    );
    expect(
      found.find((row: { id: string }) => {
        return row.id === byLearnedMac;
      })?.discoveredDetails,
    ).toEqual({
      macAddress: arpReading("e0:55:3d:12:34:58", "2026-10-23T06:00:00.000Z"),
    });

    // At most `limit` rows.
    expect(
      (
        await NetworkDeviceService.findControllerMatchCandidates({
          projectId: PROJECT_ID,
          connectionId: CONNECTION_ID,
          lookup: {
            serials: ["Q2KD-ABCD-1234"],
            macs: ["e0:55:3d:12:34:57", "e0:55:3d:12:34:58"],
            addresses: ["10.20.30.44"],
          },
          limit: 2,
        })
      ).length,
    ).toBe(2);

    // An empty list finds only what the connection described before.
    expect(
      (
        await NetworkDeviceService.findControllerMatchCandidates({
          projectId: PROJECT_ID,
          connectionId: CONNECTION_ID,
          lookup: { serials: [], macs: [], addresses: [] },
          limit: 100,
        })
      ).map((row: { id: string }) => {
        return row.id;
      }),
    ).toEqual([describedBefore]);
  });

  test("forgetting a deleted connection drops its readings only, in its project, and leaves updatedAt alone", async () => {
    const arp: JSONObject = arpReading(
      "00:1b:54:c2:7a:07",
      "2026-10-23T06:00:00.000Z",
    );
    const ours: JSONObject = JSON.parse(
      JSON.stringify(
        controllerReading(CONNECTION_ID, { serialNumber: "Q2KD-ABCD-1234" }),
      ),
    );
    const theirs: JSONObject = JSON.parse(
      JSON.stringify(
        controllerReading(OTHER_CONNECTION_ID, {
          serialNumber: "Q2KD-ELSE-0001",
        }),
      ),
    );

    const described: ObjectID = await insertDevice({
      discoveredDetails: { macAddress: arp, controller: ours },
    });
    const describedByAnother: ObjectID = await insertDevice({
      discoveredDetails: { controller: theirs },
    });
    const anotherProjects: ObjectID = await insertDevice({
      projectId: OTHER_PROJECT_ID,
      discoveredDetails: { controller: ours },
    });

    const touched: number = await NetworkDeviceService.forgetControllerReadings(
      {
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
      },
    );

    expect(touched).toBe(1);
    expect(await detailsOf(described)).toEqual({ macAddress: arp });
    expect(await detailsOf(describedByAnother)).toEqual({ controller: theirs });
    expect(await detailsOf(anotherProjects)).toEqual({ controller: ours });

    const rows: Array<{ updatedAt: Date }> = await database.query(
      `SELECT "updatedAt" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
      [described.toString()],
    );
    expect(new Date(rows[0]!.updatedAt).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );

    // Again: nothing left to forget.
    expect(
      await NetworkDeviceService.forgetControllerReadings({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
      }),
    ).toBe(0);
  });
});
