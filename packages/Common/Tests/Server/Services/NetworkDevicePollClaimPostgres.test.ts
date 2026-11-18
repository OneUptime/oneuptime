import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import {
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_SPREAD_IN_MINUTES,
} from "../../../Server/Utils/Probe/ClaimSetAside";
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
 *     the device row itself does;
 *   - hands every due device out once, interval after interval, to copies
 *     of a probe asking again while their batches are full, several at once
 *     (#9499), to another probe's beside them, and to a probe that
 *     restarted after a claim - never what it lost, in that interval;
 *   - counts a device's next poll from the whole minute nearest the claim,
 *     so the probe's ask that many minutes on finds it due (#9499);
 *   - reads, for many probes in a few statements, when each one's
 *     longest-waiting poll was due, by the same rule (what says a probe is
 *     behind on its devices, #9499).
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

  // Set aside by a claim at NOW: SET_ASIDE_FOR_MINUTES on, plus the spread.
  function expectSetAside(nextPollAt: Date): void {
    expect(nextPollAt.getTime()).toBeGreaterThanOrEqual(
      minutesFromNow(SET_ASIDE_FOR_MINUTES).getTime(),
    );
    expect(nextPollAt.getTime()).toBeLessThanOrEqual(
      minutesFromNow(
        SET_ASIDE_FOR_MINUTES + SET_ASIDE_SPREAD_IN_MINUTES,
      ).getTime(),
    );
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

  /*
   * Nothing the predicate leaves out is ever handed out. What is due on
   * this probe is set aside (setAsideUnpollable), so later claims stop
   * stepping over it; what is not due, or another probe's, is not touched.
   */
  test("a device the predicate leaves out is never claimed: due on this probe, it is set aside; otherwise left alone", async () => {
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

    const untouched: Array<ObjectID> = [
      // Not due yet.
      await insertDevice({ nextPollAt: minutesFromNow(1) }),
      // Another probe's.
      await insertDevice({
        nextPollAt: minutesFromNow(-1),
        probeId: OTHER_PROBE_ID,
      }),
    ];

    const setAside: Array<ObjectID> = [
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
    for (const id of untouched) {
      before.push((await nextPollAtOf(id)).toISOString());
    }

    expect(await claim()).toEqual([due.toString()]);

    for (const [index, id] of untouched.entries()) {
      expect((await nextPollAtOf(id)).toISOString()).toBe(before[index]);
    }

    for (const id of setAside) {
      expectSetAside(await nextPollAtOf(id));
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

  test("set aside, a device nothing may poll is no longer due for the next claim", async () => {
    const pollingOff: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-30),
      isPollingEnabled: false,
    });
    const noAddress: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-20),
      hostname: null,
    });
    const due: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-1),
    });

    expect(await claim()).toEqual([due.toString()]);

    const stillDue: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM "${schema}"."NetworkDevice"
       WHERE "probeId" = $1 AND "nextPollAt" <= $2`,
      [PROBE_ID.toString(), NOW],
    );
    expect(stillDue[0]!.count).toBe(0);

    expectSetAside(await nextPollAtOf(pollingOff));
    expectSetAside(await nextPollAtOf(noAddress));
  });

  test("a pollable device the claim had no room for is left due, never set aside", async () => {
    const first: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-3),
    });
    const waiting: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-2),
    });

    expect(await claim(1)).toEqual([first.toString()]);
    expect((await nextPollAtOf(waiting)).toISOString()).toBe(
      minutesFromNow(-2).toISOString(),
    );
  });

  test("turning polling back on brings a set-aside device back for the next claim", async () => {
    const device: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-5),
      isPollingEnabled: false,
    });

    expect(await claim()).toEqual([]);
    expectSetAside(await nextPollAtOf(device));

    await database.query(
      `UPDATE "${schema}"."NetworkDevice" SET "isPollingEnabled" = true WHERE "_id" = $1`,
      [device.toString()],
    );
    // What onUpdateSuccess does after a write that turns polling on.
    await (
      NetworkDeviceService as unknown as {
        makeDueNow: (ids: Array<ObjectID>) => Promise<void>;
      }
    ).makeDueNow([device]);

    expect((await nextPollAtOf(device)).toISOString()).toBe(NOW.toISOString());
    expect(await claim()).toEqual([device.toString()]);
  });

  test("the set-aside skips a device another writer holds instead of waiting for it", async () => {
    const held: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-10),
      isPollingEnabled: false,
    });
    const lock: { release: () => Promise<void> } = await holdDevice(held);

    const startedAt: number = Date.now();

    try {
      expect(await claim()).toEqual([]);
    } finally {
      await lock.release();
    }

    expect(Date.now() - startedAt).toBeLessThan(LOCK_TIMEOUT_MS / 2);
    expect((await nextPollAtOf(held)).toISOString()).toBe(
      minutesFromNow(-10).toISOString(),
    );

    expect(await claim()).toEqual([]);
    expectSetAside(await nextPollAtOf(held));
  });

  /*
   * ASKING AGAIN WHILE DEVICES ARE DUE (OneUptime issue #9499).
   *
   * A probe now asks for as many devices as it has room to poll, and again
   * while the batch it is handed is full; several copies of one probe do
   * so at once. These hold the claim to what that needs of it: every due
   * device handed out once an interval however many ask at once, a next
   * poll counted from the nearest whole minute, and the read that says a
   * probe is behind on its devices judged by the claim's own rule.
   */
  function setNow(now: Date): void {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
  }

  function secondsFromNow(seconds: number): Date {
    return new Date(NOW.getTime() + seconds * 1000);
  }

  // One copy of the probe: asks for `limit` until a batch is not full.
  async function askWhileFull(
    limit: number,
    probeId: ObjectID = PROBE_ID,
  ): Promise<Array<string>> {
    const handedOut: Array<string> = [];

    for (;;) {
      const batch: Array<string> = await claim(limit, probeId);
      handedOut.push(...batch);

      if (batch.length < limit) {
        return handedOut;
      }
    }
  }

  test("eight copies of a probe asking again while their batches are full hand out every due device once, interval after interval", async () => {
    const ids: Array<ObjectID> = [];

    for (let index: number = 0; index < 300; index++) {
      ids.push(
        await insertDevice({
          nextPollAt: minutesFromNow(-1 - (index % 20)),
          pollingIntervalInMinutes: 1,
        }),
      );
    }

    for (const minute of [0, 1, 2]) {
      setNow(minutesFromNow(minute));

      const copies: Array<Array<string>> = await Promise.all(
        Array.from({ length: 8 }, () => {
          return askWhileFull(25);
        }),
      );
      // A copy that lost a race stops early; what it left is still due.
      const handedOut: Array<string> = [
        ...copies.flat(),
        ...(await claim(1000)),
      ];

      expect(new Set<string>(handedOut).size).toBe(handedOut.length);
      expect([...handedOut].sort()).toEqual(sorted(ids));

      // Nothing more in this interval, however often a copy asks.
      expect(await claim(25)).toEqual([]);
    }
  });

  test("another probe's copies asking at the same moment take none of this probe's devices", async () => {
    const ours: Array<ObjectID> = [];
    const theirs: Array<ObjectID> = [];

    for (let index: number = 0; index < 60; index++) {
      ours.push(await insertDevice({ nextPollAt: minutesFromNow(-2) }));
      theirs.push(
        await insertDevice({
          nextPollAt: minutesFromNow(-2),
          probeId: OTHER_PROBE_ID,
        }),
      );
    }

    const [first, second, third, fourth] = await Promise.all([
      askWhileFull(10),
      askWhileFull(10),
      askWhileFull(10, OTHER_PROBE_ID),
      askWhileFull(10, OTHER_PROBE_ID),
    ]);

    const oursHandedOut: Array<string> = [
      ...first!,
      ...second!,
      ...(await claim(1000)),
    ];
    const theirsHandedOut: Array<string> = [
      ...third!,
      ...fourth!,
      ...(await claim(1000, OTHER_PROBE_ID)),
    ];

    expect([...oursHandedOut].sort()).toEqual(sorted(ours));
    expect([...theirsHandedOut].sort()).toEqual(sorted(theirs));
  });

  test("a probe that restarts after a claim is handed none of what it lost again in that interval", async () => {
    const ids: Array<ObjectID> = [];

    for (let index: number = 0; index < 40; index++) {
      ids.push(await insertDevice({ nextPollAt: minutesFromNow(-3) }));
    }

    // The first process is handed 25 and stops before it polls them.
    const lost: Array<string> = await claim(25);
    expect(lost).toHaveLength(25);

    // Started again, it asks for everything it may poll.
    const afterRestart: Array<string> = await askWhileFull(25);

    expect(afterRestart).toHaveLength(15);
    for (const id of afterRestart) {
      expect(lost).not.toContain(id);
    }
    expect([...lost, ...afterRestart].sort()).toEqual(sorted(ids));
  });

  test("a device that comes due in the middle of a run is handed out once, at the ask after its time", async () => {
    const soon: ObjectID = await insertDevice({
      nextPollAt: secondsFromNow(30),
    });

    expect(await claim()).toEqual([]);

    setNow(secondsFromNow(31));
    expect(await claim()).toEqual([soon.toString()]);
    expect(await claim()).toEqual([]);
  });

  /*
   * The probe asks at the top of each minute, its request taking a few
   * hundred milliseconds. A next poll counted from the claim's millisecond
   * came due a moment after the probe's next ask about as often as before
   * it, and that poll waited a whole minute more: a 5-minute device was
   * polled after 6 minutes about every other time.
   */
  test("a device's next poll is counted from the whole minute nearest the claim, so the probe's ask that many minutes on finds it due", async () => {
    const device: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-1),
      pollingIntervalInMinutes: 5,
    });

    // This ask reached the database 400 ms into the minute...
    setNow(new Date(NOW.getTime() + 400));
    expect(await claim()).toEqual([device.toString()]);
    expect((await nextPollAtOf(device)).toISOString()).toBe(
      minutesFromNow(5).toISOString(),
    );

    // ...and the one five minutes on only 150 ms in: the device is due.
    setNow(new Date(minutesFromNow(5).getTime() + 150));
    expect(await claim()).toEqual([device.toString()]);
    expect((await nextPollAtOf(device)).toISOString()).toBe(
      minutesFromNow(10).toISOString(),
    );
  });

  test("a claim in the second half of a minute counts from the next one, never polling a device sooner than half a minute short of its interval", async () => {
    const lateInTheMinute: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-1),
      pollingIntervalInMinutes: 1,
    });

    setNow(secondsFromNow(40));
    expect(await claim()).toEqual([lateInTheMinute.toString()]);
    // 10:00:40 counts from 10:01:00: next at 10:02:00, 80 s on.
    expect((await nextPollAtOf(lateInTheMinute)).toISOString()).toBe(
      minutesFromNow(2).toISOString(),
    );

    const earlyInTheMinute: ObjectID = await insertDevice({
      nextPollAt: minutesFromNow(-1),
      pollingIntervalInMinutes: 1,
    });

    setNow(secondsFromNow(20));
    expect(await claim()).toEqual([earlyInTheMinute.toString()]);
    // 10:00:20 counts from 10:00:00: next at 10:01:00, 40 s on.
    expect((await nextPollAtOf(earlyInTheMinute)).toISOString()).toBe(
      minutesFromNow(1).toISOString(),
    );
  });

  /*
   * What Probe:UpdateBehind reads once a minute to say a probe is behind on
   * its network devices: by the claim's own rule, so a device nothing may
   * poll never makes a probe look behind, and one the claim would hand out
   * always counts.
   */
  test("reads when each probe's longest-waiting poll was due, by the claim's own rule", async () => {
    await insertDevice({ nextPollAt: minutesFromNow(-3) });
    await insertDevice({ nextPollAt: minutesFromNow(-7) });
    // Older, but nothing may poll them: they never count.
    await insertDevice({
      nextPollAt: minutesFromNow(-30),
      isPollingEnabled: false,
    });
    await insertDevice({
      nextPollAt: minutesFromNow(-20),
      monitoringMethod: "Monitor",
    });
    await insertDevice({
      nextPollAt: minutesFromNow(-25),
      projectId: OTHER_PROJECT_ID,
    });
    // Another probe's: due only later.
    await insertDevice({
      nextPollAt: minutesFromNow(4),
      probeId: OTHER_PROBE_ID,
    });

    const noDevices: ObjectID = ObjectID.generate();

    const oldest: Map<string, Date | null> =
      await NetworkDeviceService.getOldestWaitingPollDueAt({
        probeIds: [PROBE_ID, OTHER_PROBE_ID, noDevices],
        dueAt: NOW,
      });

    expect(oldest.get(PROBE_ID.toString())?.toISOString()).toBe(
      minutesFromNow(-7).toISOString(),
    );
    expect(oldest.get(OTHER_PROBE_ID.toString())).toBeNull();
    expect(oldest.get(noDevices.toString())).toBeNull();

    // Once the claim has handed them out, nothing waits.
    expect(await claim()).toHaveLength(2);
    expect(
      (
        await NetworkDeviceService.getOldestWaitingPollDueAt({
          probeIds: [PROBE_ID],
          dueAt: NOW,
        })
      ).get(PROBE_ID.toString()),
    ).toBeNull();
  });

  test("reads 1,100 probes in three statements, and every probe it was asked about is answered", async () => {
    await insertDevice({ nextPollAt: minutesFromNow(-2) });

    const probeIds: Array<ObjectID> = [PROBE_ID];

    for (let index: number = 0; index < 1099; index++) {
      probeIds.push(ObjectID.generate());
    }

    const statements: Array<string> = [];
    const manager: { query: (sql: string, parameters?: unknown) => unknown } =
      database.manager as unknown as {
        query: (sql: string, parameters?: unknown) => unknown;
      };
    const query: (sql: string, parameters?: unknown) => unknown =
      manager.query.bind(manager);

    jest
      .spyOn(manager, "query")
      .mockImplementation((sql: string, parameters?: unknown) => {
        statements.push(sql);
        return query(sql, parameters);
      });

    const oldest: Map<string, Date | null> =
      await NetworkDeviceService.getOldestWaitingPollDueAt({
        probeIds: probeIds,
        dueAt: NOW,
      });

    expect(statements).toHaveLength(3);
    expect(oldest.size).toBe(1100);
    expect(oldest.get(PROBE_ID.toString())?.toISOString()).toBe(
      minutesFromNow(-2).toISOString(),
    );
  });
});
