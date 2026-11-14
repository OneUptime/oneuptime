import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import logger from "../../../Server/Utils/Logger";
import { isPostgresLockContentionError } from "../../../Server/Utils/Database/PostgresLockContention";
import OneUptimeDate from "../../../Types/Date";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * NetworkDeviceService.claimDevicesForPolling EXECUTED on Postgres
 * (OneUptime issue #7194).
 *
 * The claim used to be a transaction - SELECT ... FOR UPDATE, the next poll
 * times worked out in Node, an UPDATE, COMMIT - and every claimed device's
 * row stayed locked FOR UPDATE across those round trips. FOR UPDATE blocks
 * the FOR KEY SHARE every foreign key check takes, so the interface and
 * endpoint writes of the polls the probe had just sent for those devices -
 * and the walk's own writes to the device - queued behind it, and on a busy
 * database ran past lock_timeout ("canceling statement due to lock
 * timeout"). It is now one statement that locks the due devices FOR NO KEY
 * UPDATE SKIP LOCKED and moves their next poll in the same breath. Only a
 * database shows that statement:
 *
 *   - claims the probe's due devices, oldest first, up to the limit, and
 *     moves each one's nextPollAt by its own interval (NULL and 0 are the
 *     5-minute default, anything under a minute is a minute);
 *   - claims nothing the predicate leaves out (not due, another probe's,
 *     polling off, deleted, monitor-backed, no address, a blocked,
 *     suspended or deleted project, a probe of another project);
 *   - skips a device another writer holds instead of waiting for it;
 *   - never hands one device to two claims made at the same moment;
 *   - and, while its row locks are held, lets the device's interfaces be
 *     written - a foreign key check does not wait for it - where a write of
 *     the device row itself does.
 *
 * Opt in with RUN_POSTGRES_NETWORK_DEVICE_POLL_CLAIM_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The NetworkDevice,
 * NetworkInterface, Project and Probe tables' STRUCTURE is cloned into a
 * unique schema (search_path holds only that schema) that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from NETWORK_DEVICE_POLL_CLAIM_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from NETWORK_DEVICE_POLL_CLAIM_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_DEVICE_POLL_CLAIM_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "NetworkDevice",
  "NetworkInterface",
];

// A claim that waits instead of skipping fails within this, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

describePostgres("claiming network devices to poll, on Postgres", () => {
  const schema: string = `device_poll_claim_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const PROJECT_ID: ObjectID = ObjectID.generate();
  const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
  const PROBE_ID: ObjectID = ObjectID.generate();
  const OTHER_PROBE_ID: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["NETWORK_DEVICE_POLL_CLAIM_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["NETWORK_DEVICE_POLL_CLAIM_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["NETWORK_DEVICE_POLL_CLAIM_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // Several connections, so claims made at once are made at once.
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        max: 8,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the statements touch.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
           AND column_name NOT IN ('_id', 'nextPollAt', 'isPollingEnabled')`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    // The foreign key a poll's interface rows check, as on public.
    await database.query(
      `ALTER TABLE "${schema}"."NetworkInterface"
         ADD CONSTRAINT "interface_device" FOREIGN KEY ("networkDeviceId")
         REFERENCES "${schema}"."NetworkDevice"("_id") ON DELETE CASCADE`,
    );

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProject(PROJECT_ID, {});
    await insertProject(OTHER_PROJECT_ID, {});
    await insertProbe(PROBE_ID, PROJECT_ID);
    await insertProbe(OTHER_PROBE_ID, PROJECT_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertProject(
    id: ObjectID,
    data: {
      isBlocked?: boolean;
      subscriptionStatus?: string;
      deletedAt?: Date;
    },
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project"
         ("_id", "name", "isBlocked", "paymentProviderSubscriptionStatus", "deletedAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id.toString(),
        `Project ${id.toString()}`,
        data.isBlocked || false,
        data.subscriptionStatus || null,
        data.deletedAt || null,
      ],
    );
  }

  async function insertProbe(id: ObjectID, projectId: ObjectID): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Probe" ("_id", "name", "projectId", "isGlobalProbe")
       VALUES ($1, $2, $3, false)`,
      [id.toString(), `Probe ${id.toString()}`, projectId.toString()],
    );
  }

  async function insertDevice(data: {
    nextPollAt: Date;
    pollingIntervalInMinutes?: number | null;
    projectId?: ObjectID;
    probeId?: ObjectID;
    isPollingEnabled?: boolean;
    deletedAt?: Date;
    hostname?: string | null;
    monitoringMethod?: string | null;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "probeId", "name", "hostname", "isPollingEnabled",
          "pollingIntervalInMinutes", "nextPollAt", "deletedAt", "monitoringMethod",
          "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, 'edge-sw', $4, $5, $6, $7, $8, $9, $10, $10, 1)`,
      [
        id.toString(),
        (data.projectId || PROJECT_ID).toString(),
        (data.probeId || PROBE_ID).toString(),
        data.hostname === undefined ? "10.20.12.7" : data.hostname,
        data.isPollingEnabled === undefined ? true : data.isPollingEnabled,
        data.pollingIntervalInMinutes === undefined
          ? 5
          : data.pollingIntervalInMinutes,
        data.nextPollAt,
        data.deletedAt || null,
        data.monitoringMethod === undefined ? "Probe" : data.monitoringMethod,
        new Date("2026-10-01T00:00:00.000Z"),
      ],
    );

    return id;
  }

  async function nextPollAtOf(id: ObjectID): Promise<Date> {
    const rows: Array<{ nextPollAt: Date }> = await database.query(
      `SELECT "nextPollAt" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
      [id.toString()],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.nextPollAt;
  }

  async function claim(
    limit: number = 50,
    probeId: ObjectID = PROBE_ID,
  ): Promise<Array<string>> {
    const claimed: Array<ObjectID> =
      await NetworkDeviceService.claimDevicesForPolling({
        probeId: probeId,
        limit: limit,
      });

    return claimed
      .map((id: ObjectID) => {
        return id.toString();
      })
      .sort();
  }

  function sorted(ids: Array<ObjectID>): Array<string> {
    return ids
      .map((id: ObjectID) => {
        return id.toString();
      })
      .sort();
  }

  // Another writer - a poll's own write, say - holding a device's row lock.
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

  test("claims every due device and moves each one's next poll by its own interval", async () => {
    // [interval stored, minutes to the next poll]
    const intervals: Array<[number | null, number]> = [
      [null, 5],
      [0, 5],
      [-3, 1],
      [1, 1],
      [7, 7],
      [60, 60],
    ];
    const ids: Array<ObjectID> = [];

    for (const [index, [stored]] of intervals.entries()) {
      ids.push(
        await insertDevice({
          nextPollAt: minutesFromNow(-10 - index),
          pollingIntervalInMinutes: stored,
        }),
      );
    }

    expect(await claim()).toEqual(sorted(ids));

    for (const [index, [, minutes]] of intervals.entries()) {
      expect((await nextPollAtOf(ids[index]!)).toISOString()).toBe(
        minutesFromNow(minutes).toISOString(),
      );
    }

    // Moved on: nothing is due any more.
    expect(await claim()).toEqual([]);
  });

  test("a device the predicate leaves out is neither claimed nor moved", async () => {
    const due: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-1),
    });

    const BLOCKED_PROJECT: ObjectID = ObjectID.generate();
    const SUSPENDED_PROJECT: ObjectID = ObjectID.generate();
    const DELETED_PROJECT: ObjectID = ObjectID.generate();
    await insertProject(BLOCKED_PROJECT, { isBlocked: true });
    await insertProject(SUSPENDED_PROJECT, { subscriptionStatus: "canceled" });
    await insertProject(DELETED_PROJECT, {
      deletedAt: minutesFromNow(-60),
    });

    const leftOut: Array<ObjectID> = [
      // Not due yet.
      await insertDevice({ nextPollAt: minutesFromNow(1) }),
      // Another probe's.
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        probeId: OTHER_PROBE_ID,
      }),
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        isPollingEnabled: false,
      }),
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        deletedAt: minutesFromNow(-5),
      }),
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        monitoringMethod: "Monitor",
      }),
      await insertDevice({ nextPollAt: minutesFromNow(-1), hostname: null }),
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        projectId: BLOCKED_PROJECT,
      }),
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        projectId: SUSPENDED_PROJECT,
      }),
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        projectId: DELETED_PROJECT,
      }),
      // The tenancy backstop: this probe is another project's.
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        projectId: OTHER_PROJECT_ID,
      }),
    ];

    const before: Array<string> = [];
    for (const id of leftOut) {
      before.push((await nextPollAtOf(id)).toISOString());
    }

    expect(await claim()).toEqual([due.toString()]);

    for (const [index, id] of leftOut.entries()) {
      expect((await nextPollAtOf(id)).toISOString()).toBe(before[index]);
    }
  });

  test("the longest-waiting devices first, and never more than the limit", async () => {
    const oldest: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-30),
    });
    const older: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-20),
    });
    const newest: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-10),
    });

    expect(await claim(2)).toEqual(sorted([oldest, older]));
    expect(await claim(2)).toEqual([newest.toString()]);
  });

  test("a device another writer holds is skipped at once, and claimed once it is free", async () => {
    const held: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-10),
    });
    const free: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-5),
    });
    const lock: { release: () => Promise<void> } = await holdDevice(held);

    let whileHeld: Array<string> | "blocked";
    const startedAt: number = Date.now();

    try {
      whileHeld = await Promise.race([
        claim(),
        new Promise<"blocked">((resolve: (value: "blocked") => void) => {
          setTimeout(() => {
            resolve("blocked");
          }, LOCK_TIMEOUT_MS / 2);
        }),
      ]);
    } finally {
      await lock.release();
    }

    expect(whileHeld).toEqual([free.toString()]);
    expect(Date.now() - startedAt).toBeLessThan(LOCK_TIMEOUT_MS / 2);
    // Left as it was, for the next claim.
    expect((await nextPollAtOf(held)).toISOString()).toBe(
      minutesFromNow(-10).toISOString(),
    );
    expect(await claim()).toEqual([held.toString()]);
  });

  test("claims made at the same moment never hand out one device twice, and lose none", async () => {
    const ids: Array<ObjectID> = [];

    for (let index: number = 0; index < 60; index++) {
      ids.push(await insertDevice({ nextPollAt: minutesFromNow(-index - 1) }));
    }

    const rounds: Array<Array<string>> = await Promise.all([
      claim(20),
      claim(20),
      claim(20),
      claim(20),
    ]);
    const handedOut: Array<string> = rounds.flat();

    expect(new Set<string>(handedOut).size).toBe(handedOut.length);

    // Whatever a racing claim skipped is still due, for the next one.
    const rest: Array<string> = await claim(100);
    expect([...handedOut, ...rest].sort()).toEqual(sorted(ids));

    for (const id of ids) {
      expect((await nextPollAtOf(id)).toISOString()).toBe(
        minutesFromNow(5).toISOString(),
      );
    }
  });

  /*
   * The failure the issue reported, at its root. The claim's locks are held
   * here as long as a transaction keeps them - the worst case, which the
   * old claim's two round trips made the common one. A foreign key check
   * (FOR KEY SHARE) does not wait for FOR NO KEY UPDATE; it did wait for
   * FOR UPDATE.
   */
  test("while a claim's row locks are held, the device's interfaces are still written; only the device row itself waits", async () => {
    const device: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-1),
    });

    const claimer: QueryRunner = database.createQueryRunner();
    await claimer.connect();
    await claimer.startTransaction();

    const writer: QueryRunner = database.createQueryRunner();
    await writer.connect();

    try {
      jest
        .spyOn(NetworkDeviceService, "getRepository")
        .mockReturnValue({ manager: claimer.manager } as never);

      expect(await claim()).toEqual([device.toString()]);

      await writer.startTransaction();
      await writer.query("SET LOCAL lock_timeout = '1s'");

      // A poll's interface row: its foreign key check does not wait.
      await writer.query(
        `INSERT INTO "${schema}"."NetworkInterface"
           ("_id", "projectId", "networkDeviceId", "interfaceIndex", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, 1, now(), now(), 1)`,
        [
          ObjectID.generate().toString(),
          PROJECT_ID.toString(),
          device.toString(),
        ],
      );

      // The device row itself is held: a write to it waits, and times out.
      let rowWrite: unknown = null;

      try {
        await writer.query("SAVEPOINT device_write");
        await writer.query(
          `UPDATE "${schema}"."NetworkDevice" SET "name" = 'renamed' WHERE "_id" = $1`,
          [device.toString()],
        );
      } catch (err) {
        rowWrite = err;
        await writer.query("ROLLBACK TO SAVEPOINT device_write");
      }

      expect(isPostgresLockContentionError(rowWrite)).toBe(true);

      await writer.commitTransaction();
    } finally {
      if (writer.isTransactionActive) {
        await writer.rollbackTransaction();
      }
      await writer.release();
      await claimer.rollbackTransaction();
      await claimer.release();
    }

    const interfaces: Array<{ count: string }> = await database.query(
      `SELECT count(*)::text AS count FROM "${schema}"."NetworkInterface" WHERE "networkDeviceId" = $1`,
      [device.toString()],
    );
    expect(interfaces[0]!.count).toBe("1");
  });
});
