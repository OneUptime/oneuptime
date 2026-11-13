import Entities from "../../../Models/DatabaseModels/Index";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService, {
  NetworkDevicePollVerdict,
} from "../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService, {
  EndpointWriteCounts,
} from "../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService from "../../../Server/Services/NetworkInterfaceService";
import { isPostgresLockContentionError } from "../../../Server/Utils/Database/PostgresLockContention";
import logger from "../../../Server/Utils/Logger";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import ObjectID from "../../../Types/ObjectID";
import { holdRow } from "../TestingUtils/Postgres/ClaimRowLocks";
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
 * TWO POLLS OF ONE DEVICE PROCESSED OUT OF ORDER, EXECUTED on Postgres
 * (OneUptime issue #7389, a follow-up of #7194).
 *
 * During a queue backlog a poll waits many minutes for a worker, and two
 * polls of one device are not always processed in the order OneUptime
 * received them: a retried job goes back behind the backlog, and one job can
 * wait longer than the poll after it. The poll processed last used to win:
 * an older poll put its reachability back over a newer one's, and its
 * interfaces' answers back over the newer walk's.
 *
 * Now every write of a poll is judged by when the poll was received:
 *
 *   - the device's verdict (writePollVerdict) is one UPDATE whose own WHERE
 *     asks that the device hold no verdict from a poll received later
 *     (lastPollReceivedAt). It waits for a row another writer holds, and
 *     then asks again on the row that writer left - so the newer verdict
 *     stands whichever of two polls written at once commits first;
 *   - lastSeenAt and lastSnmpSeenAt never move backwards;
 *   - an interface is written only where it was last seen before the walk,
 *     by the UPDATE and by the INSERT's race branch alike;
 *   - an endpoint's lastSeenAt never moves backwards, and a sighting older
 *     than the stored one that says nothing new writes nothing.
 *
 * Opt in with RUN_POSTGRES_NETWORK_DEVICE_POLL_ORDER_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database. The NetworkDevice, NetworkInterface and
 * NetworkEndpoint STRUCTURES are cloned into a unique schema (search_path
 * holds only that schema) that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * NETWORK_DEVICE_POLL_ORDER_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from NETWORK_DEVICE_POLL_ORDER_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_DEVICE_POLL_ORDER_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const SITE_ID: ObjectID = ObjectID.generate();

const MINUTE: number = 60 * 1000;

// Two polls of one device, five minutes apart...
const OLDER_RECEIVED_AT: Date = new Date("2026-11-12T10:00:00.000Z");
const NEWER_RECEIVED_AT: Date = new Date("2026-11-12T10:05:00.000Z");
// ...both processed late, out of a backlog.
const PROCESSED_AT: Date = new Date("2026-11-12T10:20:00.000Z");
const LATER_PROCESSED_AT: Date = new Date(PROCESSED_AT.getTime() + MINUTE);

/*
 * Long enough for a write that waits for another poll's verdict to see it
 * commit, short enough that one held past it fails fast.
 */
const LOCK_TIMEOUT_MS: number = 3000;

interface Poll {
  receivedAt: Date;
  processedAt: Date;
  verdict: NetworkDevicePollVerdict;
}

interface DeviceRow {
  isReachable: boolean | null;
  isSnmpReachable: boolean | null;
  lastPollReceivedAt: Date | null;
  lastPolledAt: Date | null;
  lastSeenAt: Date | null;
  lastSnmpSeenAt: Date | null;
  interfacesTotal: number | null;
  interfacesUp: number | null;
  interfacesDown: number | null;
  updatedAt: Date;
}

interface InterfaceRow {
  interfaceIndex: number;
  name: string;
  isOperationallyUp: boolean | null;
  lastSeenAt: Date | null;
}

interface EndpointRow {
  macAddress: string;
  attachedInterfaceIndex: number | null;
  lastSeenAt: Date | null;
  updatedAt: Date;
}

const UP_AND_WALKED: NetworkDevicePollVerdict = {
  isReachable: true,
  isSnmpReachable: true,
  interfaceCounts: { total: 48, up: 46, down: 1 },
};

const DOWN: NetworkDevicePollVerdict = {
  isReachable: false,
  isSnmpReachable: false,
};

function iso(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value).toISOString();
}

describePostgres(
  "polls of one device processed out of order, on Postgres (issue #7389)",
  () => {
    const schema: string = `poll_order_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    const insertDevice: (data?: {
      projectId?: ObjectID;
      deletedAt?: Date;
      lastSeenAt?: Date;
      lastSnmpSeenAt?: Date;
      updatedAt?: Date;
    }) => Promise<ObjectID> = async (data?: {
      projectId?: ObjectID;
      deletedAt?: Date;
      lastSeenAt?: Date;
      lastSnmpSeenAt?: Date;
      updatedAt?: Date;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      const suffix: string = id.toString().slice(0, 8);

      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice"
           ("_id", "projectId", "name", "slug", "hostname", "version",
            "deletedAt", "lastSeenAt", "lastSnmpSeenAt", "updatedAt")
         VALUES ($1, $2, $3, $3, $4, 1, $5, $6, $7, COALESCE($8, now()))`,
        [
          id.toString(),
          (data?.projectId || PROJECT_ID).toString(),
          `switch-${suffix}`,
          `10.0.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`,
          data?.deletedAt || null,
          data?.lastSeenAt || null,
          data?.lastSnmpSeenAt || null,
          data?.updatedAt || null,
        ],
      );

      return id;
    };

    const readDevice: (id: ObjectID) => Promise<DeviceRow> = async (
      id: ObjectID,
    ): Promise<DeviceRow> => {
      const rows: Array<DeviceRow> = await database.query(
        `SELECT "isReachable", "isSnmpReachable", "lastPollReceivedAt",
                "lastPolledAt", "lastSeenAt", "lastSnmpSeenAt",
                "interfacesTotal", "interfacesUp", "interfacesDown",
                "updatedAt"
         FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
        [id.toString()],
      );

      expect(rows).toHaveLength(1);
      return rows[0]!;
    };

    const write: (
      deviceId: ObjectID,
      poll: Poll,
      projectId?: ObjectID,
    ) => Promise<boolean> = (
      deviceId: ObjectID,
      poll: Poll,
      projectId?: ObjectID,
    ): Promise<boolean> => {
      return NetworkDeviceService.writePollVerdict({
        projectId: projectId || PROJECT_ID,
        deviceId,
        receivedAt: poll.receivedAt,
        processedAt: poll.processedAt,
        verdict: poll.verdict,
      });
    };

    // The verdict columns a poll leaves on a device that held no newer one.
    const expectVerdictOf: (row: DeviceRow, poll: Poll) => void = (
      row: DeviceRow,
      poll: Poll,
    ): void => {
      expect(row.isReachable).toBe(poll.verdict.isReachable);
      expect(row.isSnmpReachable).toBe(poll.verdict.isSnmpReachable);
      expect(iso(row.lastPollReceivedAt)).toBe(iso(poll.receivedAt));
      expect(iso(row.lastPolledAt)).toBe(iso(poll.processedAt));
    };

    /*
     * The poll's verdict written in a transaction that stays open, so its
     * row lock is held until `commit`: another poll of the same device
     * written meanwhile waits for it. Only the write's own getRepository
     * call is pointed at that transaction.
     */
    const writeHeldOpen: (
      deviceId: ObjectID,
      poll: Poll,
    ) => Promise<{ commit: () => Promise<void> }> = async (
      deviceId: ObjectID,
      poll: Poll,
    ): Promise<{ commit: () => Promise<void> }> => {
      const runner: QueryRunner = database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        jest
          .spyOn(NetworkDeviceService, "getRepository")
          .mockReturnValueOnce({ manager: runner.manager } as never);

        expect(await write(deviceId, poll)).toBe(true);
      } catch (err) {
        await runner.rollbackTransaction();
        await runner.release();
        throw err;
      }

      return {
        commit: async (): Promise<void> => {
          await runner.commitTransaction();
          await runner.release();
        },
      };
    };

    // Until a statement of this suite's connections waits for a row lock.
    const waitUntilAWriteWaits: () => Promise<void> =
      async (): Promise<void> => {
        const deadline: number = Date.now() + LOCK_TIMEOUT_MS / 2;

        while (Date.now() < deadline) {
          const waiting: Array<{ count: string }> = await database.query(
            `SELECT count(*) AS "count" FROM pg_stat_activity
             WHERE application_name = $1 AND wait_event_type = 'Lock'`,
            [schema],
          );

          if (Number(waiting[0]?.count) > 0) {
            return;
          }

          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 10);
          });
        }

        throw new Error("No write waited for the held device.");
      };

    const walkInterfaces: (data: {
      deviceId: ObjectID;
      interfaces: Array<Partial<SnmpInterface> & { interfaceIndex: number }>;
      receivedAt: Date;
    }) => Promise<void> = async (data: {
      deviceId: ObjectID;
      interfaces: Array<Partial<SnmpInterface> & { interfaceIndex: number }>;
      receivedAt: Date;
    }): Promise<void> => {
      await NetworkInterfaceService.upsertWalkedInterfaces({
        projectId: PROJECT_ID,
        deviceId: data.deviceId,
        walkedInterfaces: data.interfaces.map(
          (
            walked: Partial<SnmpInterface> & { interfaceIndex: number },
          ): SnmpInterface => {
            return {
              name: `Gi0/${walked.interfaceIndex}`,
              isOperationallyUp: true,
              isAdministrativelyUp: true,
              ...walked,
            };
          },
        ),
        now: data.receivedAt,
      });
    };

    const readInterfaces: (
      deviceId: ObjectID,
    ) => Promise<Array<InterfaceRow>> = async (
      deviceId: ObjectID,
    ): Promise<Array<InterfaceRow>> => {
      return database.query(
        `SELECT "interfaceIndex", "name", "isOperationallyUp", "lastSeenAt"
         FROM "${schema}"."NetworkInterface"
         WHERE "networkDeviceId" = $1 AND "deletedAt" IS NULL
         ORDER BY "interfaceIndex"`,
        [deviceId.toString()],
      );
    };

    const walkEndpoint: (data: {
      deviceId: ObjectID;
      macAddress: string;
      interfaceIndex: number;
      receivedAt: Date;
    }) => Promise<EndpointWriteCounts> = (data: {
      deviceId: ObjectID;
      macAddress: string;
      interfaceIndex: number;
      receivedAt: Date;
    }): Promise<EndpointWriteCounts> => {
      return NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: data.deviceId,
        deviceSiteId: SITE_ID,
        attachments: [
          {
            macAddress: data.macAddress,
            attachedInterfaceIndex: data.interfaceIndex,
            attachedPortName: `Gi0/${data.interfaceIndex}`,
          },
        ],
        ipBindings: [],
        now: data.receivedAt,
      });
    };

    const readEndpoint: (macAddress: string) => Promise<EndpointRow> = async (
      macAddress: string,
    ): Promise<EndpointRow> => {
      const rows: Array<EndpointRow> = await database.query(
        `SELECT "macAddress", "attachedInterfaceIndex", "lastSeenAt", "updatedAt"
         FROM "${schema}"."NetworkEndpoint"
         WHERE "projectId" = $1 AND "macAddress" = $2 AND "deletedAt" IS NULL`,
        [PROJECT_ID.toString(), macAddress],
      );

      expect(rows).toHaveLength(1);
      return rows[0]!;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NETWORK_DEVICE_POLL_ORDER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["NETWORK_DEVICE_POLL_ORDER_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NETWORK_DEVICE_POLL_ORDER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          /*
           * application_name tells this suite's connections apart in
           * pg_stat_activity (waitUntilAWriteWaits).
           */
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS} -c application_name=${schema}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of [
        "NetworkDevice",
        "NetworkInterface",
        "NetworkEndpoint",
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

    beforeEach(async () => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest.spyOn(logger, "warn").mockImplementation((() => {
        return undefined;
      }) as never);

      for (const table of [
        "NetworkDevice",
        "NetworkInterface",
        "NetworkEndpoint",
      ]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the migrated table has the guard's column", async () => {
      const columns: Array<{ data_type: string }> = await database.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'NetworkDevice'
           AND column_name = 'lastPollReceivedAt'`,
        [schema],
      );

      expect(columns).toEqual([{ data_type: "timestamp with time zone" }]);
    });

    describe("the device's verdict", () => {
      test.each([
        ["the newer poll found it down, the older up", DOWN, UP_AND_WALKED],
        ["the newer poll found it up, the older down", UP_AND_WALKED, DOWN],
      ])(
        "two polls processed in reverse order leave the newer one's verdict: %s",
        async (
          _label: string,
          newerVerdict: NetworkDevicePollVerdict,
          olderVerdict: NetworkDevicePollVerdict,
        ) => {
          const deviceId: ObjectID = await insertDevice();
          const newer: Poll = {
            receivedAt: NEWER_RECEIVED_AT,
            processedAt: PROCESSED_AT,
            verdict: newerVerdict,
          };
          const older: Poll = {
            receivedAt: OLDER_RECEIVED_AT,
            processedAt: LATER_PROCESSED_AT,
            verdict: olderVerdict,
          };

          expect(await write(deviceId, newer)).toBe(true);
          const afterNewer: DeviceRow = await readDevice(deviceId);

          expect(await write(deviceId, older)).toBe(false);

          const row: DeviceRow = await readDevice(deviceId);
          expectVerdictOf(row, newer);
          // The older poll changed nothing at all.
          expect(row).toEqual(afterNewer);
        },
      );

      test("processed in order, each poll writes, and the last one's verdict stands", async () => {
        const deviceId: ObjectID = await insertDevice();
        const older: Poll = {
          receivedAt: OLDER_RECEIVED_AT,
          processedAt: PROCESSED_AT,
          verdict: UP_AND_WALKED,
        };
        const newer: Poll = {
          receivedAt: NEWER_RECEIVED_AT,
          processedAt: LATER_PROCESSED_AT,
          verdict: DOWN,
        };

        expect(await write(deviceId, older)).toBe(true);
        expect(await write(deviceId, newer)).toBe(true);

        const row: DeviceRow = await readDevice(deviceId);
        expectVerdictOf(row, newer);
        // When it last answered is the older poll's: the newer one found it down.
        expect(iso(row.lastSeenAt)).toBe(iso(OLDER_RECEIVED_AT));
        expect(iso(row.lastSnmpSeenAt)).toBe(iso(OLDER_RECEIVED_AT));
      });

      test("the same poll processed twice - a retried job - writes once", async () => {
        const deviceId: ObjectID = await insertDevice();
        const poll: Poll = {
          receivedAt: NEWER_RECEIVED_AT,
          processedAt: PROCESSED_AT,
          verdict: UP_AND_WALKED,
        };

        expect(await write(deviceId, poll)).toBe(true);
        expect(
          await write(deviceId, { ...poll, processedAt: LATER_PROCESSED_AT }),
        ).toBe(false);

        expect(iso((await readDevice(deviceId)).lastPolledAt)).toBe(
          iso(PROCESSED_AT),
        );
      });

      /*
       * Stamped before the upgrade, the last-seen times are processing
       * times - later than the receipt times of the polls still queued
       * behind them. The first of those writes its verdict, and leaves them.
       */
      test("lastSeenAt and lastSnmpSeenAt never move backwards", async () => {
        const stampedByAWorker: Date = new Date(
          NEWER_RECEIVED_AT.getTime() + 5 * MINUTE,
        );
        const deviceId: ObjectID = await insertDevice({
          lastSeenAt: stampedByAWorker,
          lastSnmpSeenAt: stampedByAWorker,
        });

        expect(
          await write(deviceId, {
            receivedAt: NEWER_RECEIVED_AT,
            processedAt: PROCESSED_AT,
            verdict: UP_AND_WALKED,
          }),
        ).toBe(true);

        let row: DeviceRow = await readDevice(deviceId);
        expect(row.isReachable).toBe(true);
        expect(iso(row.lastPollReceivedAt)).toBe(iso(NEWER_RECEIVED_AT));
        expect(iso(row.lastSeenAt)).toBe(iso(stampedByAWorker));
        expect(iso(row.lastSnmpSeenAt)).toBe(iso(stampedByAWorker));

        const later: Date = new Date(stampedByAWorker.getTime() + MINUTE);
        expect(
          await write(deviceId, {
            receivedAt: later,
            processedAt: LATER_PROCESSED_AT,
            verdict: UP_AND_WALKED,
          }),
        ).toBe(true);

        row = await readDevice(deviceId);
        expect(iso(row.lastSeenAt)).toBe(iso(later));
        expect(iso(row.lastSnmpSeenAt)).toBe(iso(later));
      });

      test("a poll that found the device down leaves when it last answered", async () => {
        const answeredAt: Date = new Date(
          OLDER_RECEIVED_AT.getTime() - 30 * MINUTE,
        );
        const deviceId: ObjectID = await insertDevice({
          lastSeenAt: answeredAt,
          lastSnmpSeenAt: answeredAt,
        });

        expect(
          await write(deviceId, {
            receivedAt: NEWER_RECEIVED_AT,
            processedAt: PROCESSED_AT,
            verdict: DOWN,
          }),
        ).toBe(true);

        const row: DeviceRow = await readDevice(deviceId);
        expect(row.isReachable).toBe(false);
        expect(row.isSnmpReachable).toBe(false);
        expect(iso(row.lastSeenAt)).toBe(iso(answeredAt));
        expect(iso(row.lastSnmpSeenAt)).toBe(iso(answeredAt));
      });

      test("a walk's interface counts are written, a failed walk keeps them, a ping-only poll clears them", async () => {
        const deviceId: ObjectID = await insertDevice();
        const at: (minutes: number) => Date = (minutes: number): Date => {
          return new Date(OLDER_RECEIVED_AT.getTime() + minutes * MINUTE);
        };

        await write(deviceId, {
          receivedAt: at(0),
          processedAt: PROCESSED_AT,
          verdict: UP_AND_WALKED,
        });
        expect(await readDevice(deviceId)).toMatchObject({
          interfacesTotal: 48,
          interfacesUp: 46,
          interfacesDown: 1,
        });

        await write(deviceId, {
          receivedAt: at(5),
          processedAt: PROCESSED_AT,
          verdict: { isReachable: true, isSnmpReachable: false },
        });
        expect(await readDevice(deviceId)).toMatchObject({
          isSnmpReachable: false,
          interfacesTotal: 48,
          interfacesUp: 46,
          interfacesDown: 1,
        });

        await write(deviceId, {
          receivedAt: at(10),
          processedAt: PROCESSED_AT,
          verdict: {
            isReachable: true,
            isSnmpReachable: null,
            interfaceCounts: null,
          },
        });
        expect(await readDevice(deviceId)).toMatchObject({
          isSnmpReachable: null,
          interfacesTotal: null,
          interfacesUp: null,
          interfacesDown: null,
        });
      });

      test("never writes a deleted device, nor one of another project", async () => {
        const deleted: ObjectID = await insertDevice({
          deletedAt: OLDER_RECEIVED_AT,
        });
        const elsewhere: ObjectID = await insertDevice({
          projectId: OTHER_PROJECT_ID,
        });
        const poll: Poll = {
          receivedAt: NEWER_RECEIVED_AT,
          processedAt: PROCESSED_AT,
          verdict: UP_AND_WALKED,
        };

        expect(await write(deleted, poll)).toBe(false);
        expect(await write(elsewhere, poll)).toBe(false);

        for (const id of [deleted, elsewhere]) {
          const row: DeviceRow = await readDevice(id);
          expect(row.isReachable).toBeNull();
          expect(row.lastPollReceivedAt).toBeNull();
          expect(row.lastPolledAt).toBeNull();
        }
      });

      test("moves updatedAt", async () => {
        const longAgo: Date = new Date("2026-01-01T00:00:00.000Z");
        const deviceId: ObjectID = await insertDevice({ updatedAt: longAgo });

        await write(deviceId, {
          receivedAt: NEWER_RECEIVED_AT,
          processedAt: PROCESSED_AT,
          verdict: DOWN,
        });

        expect(
          new Date((await readDevice(deviceId)).updatedAt).getTime(),
        ).toBeGreaterThan(longAgo.getTime());
      });
    });

    /*
     * Two polls of one device written at the same moment: the second waits
     * for the first's row lock, then asks its WHERE again on the row the
     * first left. So the newer verdict stands whichever commits first - and
     * a statement that skipped a held row (SKIP LOCKED) would have left an
     * older verdict standing whenever the older poll held it.
     */
    describe("two polls of one device written at once", () => {
      test.each([
        ["the newer one commits first: the older is refused", "newer"],
        ["the older one commits first: the newer is written over it", "older"],
      ])("%s", async (_label: string, first: string) => {
        const deviceId: ObjectID = await insertDevice();
        const newer: Poll = {
          receivedAt: NEWER_RECEIVED_AT,
          processedAt: PROCESSED_AT,
          verdict: DOWN,
        };
        const older: Poll = {
          receivedAt: OLDER_RECEIVED_AT,
          processedAt: PROCESSED_AT,
          verdict: UP_AND_WALKED,
        };
        const [holding, waiting] =
          first === "newer" ? [newer, older] : [older, newer];

        const held: { commit: () => Promise<void> } = await writeHeldOpen(
          deviceId,
          holding,
        );

        let settled: boolean = false;
        const waitingWrite: Promise<boolean> = write(deviceId, waiting).finally(
          () => {
            settled = true;
          },
        );

        try {
          await waitUntilAWriteWaits();
          expect(settled).toBe(false);
        } finally {
          await held.commit();
        }

        // Written only when it is the newer of the two.
        expect(await waitingWrite).toBe(waiting === newer);

        expectVerdictOf(await readDevice(deviceId), newer);
      });

      /*
       * Held past lock_timeout, the write fails rather than waiting on: the
       * caller (NetworkInventoryUtil) leaves this poll's verdict to the
       * next one, which writes it.
       */
      test("a device held past the lock timeout fails the write with a lock timeout, and the next poll writes", async () => {
        const deviceId: ObjectID = await insertDevice();
        const holder: { release: () => Promise<void> } = await holdRow({
          database,
          schema,
          table: "NetworkDevice",
          id: deviceId,
        });

        let failure: unknown = null;
        try {
          await write(deviceId, {
            receivedAt: OLDER_RECEIVED_AT,
            processedAt: PROCESSED_AT,
            verdict: UP_AND_WALKED,
          });
        } catch (err) {
          failure = err;
        } finally {
          await holder.release();
        }

        expect(isPostgresLockContentionError(failure)).toBe(true);
        expect((await readDevice(deviceId)).lastPollReceivedAt).toBeNull();

        const next: Poll = {
          receivedAt: NEWER_RECEIVED_AT,
          processedAt: LATER_PROCESSED_AT,
          verdict: UP_AND_WALKED,
        };
        expect(await write(deviceId, next)).toBe(true);
        expectVerdictOf(await readDevice(deviceId), next);
      });
    });

    describe("the device's interfaces", () => {
      test("an older walk leaves the interfaces a newer walk wrote, and adds the ones it did not report", async () => {
        const deviceId: ObjectID = await insertDevice();

        await walkInterfaces({
          deviceId,
          interfaces: [{ interfaceIndex: 1, alias: "uplink" }],
          receivedAt: NEWER_RECEIVED_AT,
        });
        await walkInterfaces({
          deviceId,
          interfaces: [
            { interfaceIndex: 1, isOperationallyUp: false, alias: "old" },
            { interfaceIndex: 2 },
          ],
          receivedAt: OLDER_RECEIVED_AT,
        });

        const rows: Array<InterfaceRow> = await readInterfaces(deviceId);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
          interfaceIndex: 1,
          isOperationallyUp: true,
        });
        expect(iso(rows[0]!.lastSeenAt)).toBe(iso(NEWER_RECEIVED_AT));
        expect(rows[1]).toMatchObject({ interfaceIndex: 2 });
        expect(iso(rows[1]!.lastSeenAt)).toBe(iso(OLDER_RECEIVED_AT));

        // A newer walk writes over both again.
        await walkInterfaces({
          deviceId,
          interfaces: [
            { interfaceIndex: 1, isOperationallyUp: false },
            { interfaceIndex: 2, isOperationallyUp: false },
          ],
          receivedAt: new Date(NEWER_RECEIVED_AT.getTime() + 5 * MINUTE),
        });
        for (const row of await readInterfaces(deviceId)) {
          expect(row.isOperationallyUp).toBe(false);
        }
      });

      /*
       * The insert's race branch: a walk whose read missed a row another
       * walk had just made inserts it, and the conflict decides the row by
       * the same rule as the update.
       */
      test.each([
        ["an older walk leaves the newer walk's row", "older"],
        ["a newer walk writes over the older walk's row", "newer"],
      ])(
        "when a walk's read missed an interface: %s",
        async (_label: string, missing: string) => {
          const deviceId: ObjectID = await insertDevice();
          const [storedAt, missedAt] =
            missing === "older"
              ? [NEWER_RECEIVED_AT, OLDER_RECEIVED_AT]
              : [OLDER_RECEIVED_AT, NEWER_RECEIVED_AT];

          await walkInterfaces({
            deviceId,
            interfaces: [{ interfaceIndex: 3, isOperationallyUp: true }],
            receivedAt: storedAt,
          });

          jest
            .spyOn(NetworkInterfaceService, "findBy")
            .mockResolvedValueOnce([] as Array<NetworkInterface>);

          await walkInterfaces({
            deviceId,
            interfaces: [{ interfaceIndex: 3, isOperationallyUp: false }],
            receivedAt: missedAt,
          });

          const rows: Array<InterfaceRow> = await readInterfaces(deviceId);
          expect(rows).toHaveLength(1);
          const newerAt: Date = missing === "older" ? storedAt : missedAt;
          expect(iso(rows[0]!.lastSeenAt)).toBe(iso(newerAt));
          expect(rows[0]!.isOperationallyUp).toBe(missing === "older");
        },
      );
    });

    describe("the endpoints the device saw", () => {
      const MAC: string = "aa:bb:cc:00:73:89";

      test("an older walk that saw nothing new about an endpoint writes nothing", async () => {
        const deviceId: ObjectID = await insertDevice();

        await walkEndpoint({
          deviceId,
          macAddress: MAC,
          interfaceIndex: 7,
          receivedAt: NEWER_RECEIVED_AT,
        });
        const before: EndpointRow = await readEndpoint(MAC);

        const counts: EndpointWriteCounts = await walkEndpoint({
          deviceId,
          macAddress: MAC,
          interfaceIndex: 7,
          receivedAt: OLDER_RECEIVED_AT,
        });

        expect(counts.written).toBe(0);
        expect(await readEndpoint(MAC)).toEqual(before);
      });

      /*
       * Several sources share an endpoint's lastSeenAt - forwarding tables,
       * ARP tables, controllers - so who it is attached to is decided by
       * their precedence, not by time. What time decides is that the last
       * sighting never goes back.
       */
      test("an older walk never takes an endpoint's last sighting back", async () => {
        const deviceId: ObjectID = await insertDevice();

        await walkEndpoint({
          deviceId,
          macAddress: MAC,
          interfaceIndex: 7,
          receivedAt: NEWER_RECEIVED_AT,
        });

        const counts: EndpointWriteCounts = await walkEndpoint({
          deviceId,
          macAddress: MAC,
          interfaceIndex: 3,
          receivedAt: OLDER_RECEIVED_AT,
        });

        expect(counts.written).toBe(1);
        expect(iso((await readEndpoint(MAC)).lastSeenAt)).toBe(
          iso(NEWER_RECEIVED_AT),
        );
      });
    });
  },
);
