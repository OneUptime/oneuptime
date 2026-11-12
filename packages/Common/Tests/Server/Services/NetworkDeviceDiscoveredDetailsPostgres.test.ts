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
import logger from "../../../Server/Utils/Logger";
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
 *   - it leaves updatedAt alone;
 *   - it never waits for a device another writer holds while it holds
 *     others (issue #7194): the batch takes the devices nobody holds and
 *     commits them, and each held device is merged on its own afterwards -
 *     or, with skipLockedDevices, left for the next reading; a device held
 *     past lock_timeout is logged and left; and two merges of the same
 *     devices in opposite orders never deadlock.
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
 *     leaves updatedAt alone;
 *   - findControllerIdentityHolders finds every device - archived ones too,
 *     never a deleted one or another project's - that holds one of a device
 *     list's serial numbers (without case or padding), MACs (typed or
 *     learned) or addresses: what Add devices never adds twice.
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

const LOCK_TIMEOUT_MS: number = 3000;

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
      /*
       * The product's own lock_timeout (DATABASE_LOCK_TIMEOUT_MS), for the
       * device held past it below; several connections, so the merges made
       * at once are made at once.
       */
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        max: 8,
      },
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
   * A device another writer holds (OneUptime issue #7194)
   * ------------------------------------------------------------------
   *
   * The merge used to lock every device of a batch in one statement, in
   * whatever order the join gave, and wait for each one another writer
   * held - with the others already locked: a router's ARP readings for
   * hundreds of devices queued behind the polls of each of them, held
   * every device it had reached while it waited, and past lock_timeout
   * failed whole.
   */
  describe("a device another writer holds", () => {
    // Another writer - a poll's own write, say - holding a device's row.
    async function holdDevice(
      id: ObjectID,
    ): Promise<{ release: () => Promise<void> }> {
      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT "_id" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1 FOR UPDATE`,
        [id.toString()],
      );

      return {
        release: async (): Promise<void> => {
          await holder.rollbackTransaction();
          await holder.release();
        },
      };
    }

    function sysNamePatch(
      id: ObjectID,
      name: string,
    ): { deviceId: ObjectID; set: JSONObject } {
      return {
        deviceId: id,
        set: { sysName: scanReading(name, "2026-11-12T07:00:00.000Z") },
      };
    }

    // Until `id` has a record, or `withinMs` passes.
    async function recordOf(
      id: ObjectID,
      withinMs: number,
    ): Promise<JSONObject | null> {
      const until: number = Date.now() + withinMs;

      for (;;) {
        const details: JSONObject | null = await detailsOf(id);

        if (details || Date.now() > until) {
          return details;
        }

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 50);
        });
      }
    }

    test("the devices nobody holds are written - and committed - while the held one is still waited for", async () => {
      const free: ObjectID = await insertDevice({});
      const held: ObjectID = await insertDevice({});
      const lock: { release: () => Promise<void> } = await holdDevice(held);

      let merged: Promise<number> | undefined = undefined;

      try {
        merged = NetworkDeviceService.mergeDiscoveredDetails({
          projectId: PROJECT_ID,
          patches: [
            sysNamePatch(held, "held-sw"),
            sysNamePatch(free, "free-sw"),
          ],
        });

        // Visible from another connection: the batch has committed it.
        expect(await recordOf(free, LOCK_TIMEOUT_MS / 2)).toEqual({
          sysName: scanReading("free-sw", "2026-11-12T07:00:00.000Z"),
        });
        expect(await detailsOf(held)).toBeNull();
      } finally {
        await lock.release();
      }

      // Then the held one, on its own, once it is free.
      expect(await merged).toBe(2);
      expect(await detailsOf(held)).toEqual({
        sysName: scanReading("held-sw", "2026-11-12T07:00:00.000Z"),
      });
    });

    test("with skipLockedDevices a held device is left as it is, at once", async () => {
      const free: ObjectID = await insertDevice({});
      const held: ObjectID = await insertDevice({});
      const lock: { release: () => Promise<void> } = await holdDevice(held);

      let written: number | "blocked";
      const startedAt: number = Date.now();

      try {
        written = await Promise.race([
          NetworkDeviceService.mergeDiscoveredDetails({
            projectId: PROJECT_ID,
            patches: [
              sysNamePatch(held, "held-sw"),
              sysNamePatch(free, "free-sw"),
            ],
            skipLockedDevices: true,
          }),
          new Promise<"blocked">((resolve: (value: "blocked") => void) => {
            setTimeout(() => {
              resolve("blocked");
            }, LOCK_TIMEOUT_MS / 2);
          }),
        ]);
      } finally {
        await lock.release();
      }

      expect(written).toBe(1);
      expect(Date.now() - startedAt).toBeLessThan(LOCK_TIMEOUT_MS / 2);
      expect(await detailsOf(free)).not.toBeNull();
      expect(await detailsOf(held)).toBeNull();
    });

    test("a device held past lock_timeout is logged and left, and the devices around it are written", async () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(logger, "warn")
        .mockImplementation((() => {
          return undefined;
        }) as never);
      const first: ObjectID = await insertDevice({});
      const held: ObjectID = await insertDevice({});
      const last: ObjectID = await insertDevice({});
      const lock: { release: () => Promise<void> } = await holdDevice(held);

      let written: number;

      try {
        written = await NetworkDeviceService.mergeDiscoveredDetails({
          projectId: PROJECT_ID,
          patches: [
            sysNamePatch(first, "first-sw"),
            sysNamePatch(held, "held-sw"),
            sysNamePatch(last, "last-sw"),
          ],
        });
      } finally {
        await lock.release();
      }

      expect(written).toBe(2);
      expect(await detailsOf(first)).not.toBeNull();
      expect(await detailsOf(last)).not.toBeNull();
      expect(await detailsOf(held)).toBeNull();

      const said: Array<string> = warn.mock.calls.map(
        (call: Array<unknown>) => {
          return String(call[0]);
        },
      );
      expect(
        said.some((line: string) => {
          return line.includes(held.toString());
        }),
      ).toBe(true);
    });

    test("two merges of the same devices in opposite orders never deadlock, and both land on every device", async () => {
      const ids: Array<ObjectID> = [];

      for (let index: number = 0; index < 30; index++) {
        ids.push(await insertDevice({}));
      }

      for (let round: number = 0; round < 5; round++) {
        await Promise.all([
          NetworkDeviceService.mergeDiscoveredDetails({
            projectId: PROJECT_ID,
            patches: ids.map((id: ObjectID) => {
              return sysNamePatch(id, `round-${round}`);
            }),
          }),
          NetworkDeviceService.mergeDiscoveredDetails({
            projectId: PROJECT_ID,
            patches: [...ids].reverse().map((id: ObjectID) => {
              return {
                deviceId: id,
                set: {
                  macAddress: arpReading(
                    "00:1b:54:c2:7a:07",
                    "2026-11-12T07:00:00.000Z",
                  ),
                },
              };
            }),
          }),
        ]);
      }

      for (const id of ids) {
        expect(Object.keys((await detailsOf(id)) || {}).sort()).toEqual([
          "macAddress",
          "sysName",
        ]);
      }
    });
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
    name?: string;
    sysName?: string;
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
         ("_id", "projectId", "name", "sysName", "hostname", "serialNumber", "macAddress",
          "discoveredDetails", "isArchived", "deletedAt", "refreshRequestedAt",
          "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
               '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1)`,
      [
        id.toString(),
        (data.projectId || PROJECT_ID).toString(),
        data.name || "device",
        data.sysName || null,
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
    const byOwnMac: string = await insertCandidate({
      hostname: "10.20.30.45",
      discoveredDetails: {
        ownMacAddress: {
          value: "e0:55:3d:12:34:58",
          method: "snmp",
          readBy: { type: "probe", id: CONNECTION_ID },
          readAt: "2026-10-23T08:00:00.000Z",
        },
      },
    });
    const byScannedMac: string = await insertCandidate({
      hostname: "10.20.30.49",
      discoveredDetails: {
        scannedMacAddress: {
          value: "e0:55:3d:12:34:58",
          method: "snmp",
          readBy: { type: "discoveryScan", id: CONNECTION_ID },
          readAt: "2026-10-23T08:00:00.000Z",
        },
      },
    });
    const byName: string = await insertCandidate({
      hostname: "10.20.30.46",
      name: " Store 12 Gateway ",
    });
    const bySysName: string = await insertCandidate({
      hostname: "10.20.30.47",
      sysName: "STORE 12 GATEWAY",
    });
    const byScannedName: string = await insertCandidate({
      hostname: "10.20.30.48",
      discoveredDetails: {
        sysName: {
          value: "Store 12 gateway",
          method: "snmp",
          readBy: { type: "discoveryScan", id: CONNECTION_ID },
          readAt: "2026-10-23T08:00:00.000Z",
        },
      },
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
        names: ["store 12 gateway"],
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
      [
        bySerial,
        byTypedMac,
        byLearnedMac,
        byAddress,
        byOwnMac,
        byScannedMac,
        byName,
        bySysName,
        byScannedName,
        describedBefore,
      ].sort(),
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
            names: [],
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
          lookup: { serials: [], macs: [], addresses: [], names: [] },
          limit: 100,
        })
      ).map((row: { id: string }) => {
        return row.id;
      }),
    ).toEqual([describedBefore]);
  });

  test("the devices that hold a device list's identities: live and archived, never deleted or another project's", async () => {
    await insertCandidate({
      hostname: "10.20.40.1",
      serialNumber: " q2hp-swch-0001 ",
    });
    await insertCandidate({
      hostname: "10.20.40.2",
      macAddress: "e0:55:3d:aa:00:01",
      isArchived: true,
    });
    await insertCandidate({
      hostname: "10.20.40.3",
      discoveredDetails: {
        macAddress: arpReading("34:56:fe:00:00:01", "2026-10-23T06:00:00.000Z"),
      },
    });
    await insertCandidate({
      hostname: "10.66.0.40",
      serialNumber: "FOC1840X0AB",
    });

    // None of these.
    await insertCandidate({
      projectId: OTHER_PROJECT_ID,
      hostname: "10.66.0.40",
      serialNumber: "Q2HP-SWCH-0001",
    });
    await insertCandidate({
      hostname: "10.66.0.40",
      deletedAt: new Date("2026-10-22T00:00:00.000Z"),
    });
    await insertCandidate({
      hostname: "10.20.40.9",
      serialNumber: "Q2HP-ELSE-0001",
      macAddress: "aa:bb:cc:00:00:09",
    });

    const held: Awaited<
      ReturnType<typeof NetworkDeviceService.findControllerIdentityHolders>
    > = await NetworkDeviceService.findControllerIdentityHolders({
      projectId: PROJECT_ID,
      serials: ["Q2HP-SWCH-0001"],
      macs: ["e0:55:3d:aa:00:01", "34:56:fe:00:00:01"],
      addresses: ["10.66.0.40"],
      limit: 100,
    });

    expect(
      held
        .map((row: { hostname: string | null }): string => {
          return row.hostname || "";
        })
        .sort(),
    ).toEqual(["10.20.40.1", "10.20.40.2", "10.20.40.3", "10.66.0.40"]);

    const archived: (typeof held)[number] | undefined = held.find(
      (row: { hostname: string | null }) => {
        return row.hostname === "10.20.40.2";
      },
    );
    expect(archived).toEqual({
      serialNumber: null,
      macAddress: "e0:55:3d:aa:00:01",
      learnedMacAddress: null,
      hostname: "10.20.40.2",
      isArchived: true,
    });
    expect(
      held.find((row: { hostname: string | null }) => {
        return row.hostname === "10.20.40.3";
      })?.learnedMacAddress,
    ).toBe("34:56:fe:00:00:01");

    // At most `limit` rows.
    expect(
      (
        await NetworkDeviceService.findControllerIdentityHolders({
          projectId: PROJECT_ID,
          serials: ["Q2HP-SWCH-0001"],
          macs: ["e0:55:3d:aa:00:01", "34:56:fe:00:00:01"],
          addresses: ["10.66.0.40"],
          limit: 2,
        })
      ).length,
    ).toBe(2);
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

  test("a deleted connection's links go with its reading, and nobody else's do", async () => {
    const reader: JSONObject = {
      type: "networkController",
      id: CONNECTION_ID.toString(),
      name: "Stores",
    };
    const links: JSONObject = {
      provider: "meraki",
      readBy: reader,
      readAt: "2026-11-01T06:00:00.000Z",
      links: [{ port: "Port 49", peerName: "core", protocols: ["lldp"] }],
    };
    const theirLinks: JSONObject = {
      ...links,
      readBy: { ...reader, id: ObjectID.generate().toString() },
    };

    const ours: ObjectID = await insertDevice({
      discoveredDetails: { controllerLinks: links },
    });
    const theirs: ObjectID = await insertDevice({
      discoveredDetails: { controllerLinks: theirLinks },
    });

    await NetworkDeviceService.forgetControllerReadings({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
    });

    expect(await detailsOf(ours)).toEqual({});
    expect(await detailsOf(theirs)).toEqual({ controllerLinks: theirLinks });
  });

  test("a device known only by the links this connection read is still a candidate, with its site", async () => {
    const reader: JSONObject = {
      type: "networkController",
      id: CONNECTION_ID.toString(),
    };
    const device: ObjectID = await insertDevice({
      discoveredDetails: {
        controllerLinks: {
          provider: "meraki",
          readBy: reader,
          readAt: "2026-11-01T06:00:00.000Z",
          links: [{ peerName: "core", protocols: [] }],
        },
      },
    });

    type Candidates = Awaited<
      ReturnType<typeof NetworkDeviceService.findControllerMatchCandidates>
    >;

    const candidates: Candidates =
      await NetworkDeviceService.findControllerMatchCandidates({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
        lookup: { serials: [], macs: [], addresses: [], names: [] },
        limit: 10,
      });

    expect(
      candidates.map((candidate: Candidates[number]): string => {
        return candidate.id;
      }),
    ).toEqual([device.toString()]);
    expect(candidates[0]?.siteId).toBeNull();
  });
});
