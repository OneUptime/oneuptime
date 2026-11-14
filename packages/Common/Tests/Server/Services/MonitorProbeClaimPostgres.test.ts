import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import logger from "../../../Server/Utils/Logger";
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
 * MonitorProbeService.claimMonitorProbesForProbing EXECUTED on Postgres
 * (OneUptime issue #7194).
 *
 * The claim used to be a transaction - SELECT ... FOR UPDATE, each row's
 * next run worked out in Node, an UPDATE, COMMIT - that held every claimed
 * MonitorProbe row across those round trips; a probe result being stored
 * for one of those monitors (MonitorResource's lastMonitoringLog write)
 * queued behind it, and past lock_timeout failed its whole job. Now the due
 * rows are read without a lock, their next runs worked out in Node, and one
 * statement claims those still due that nobody else holds - FOR NO KEY
 * UPDATE SKIP LOCKED - and writes their schedule. The unit suites pin its
 * text; only a database shows that it:
 *
 *   - claims the probe's due rows (never-pinged first), up to the limit, and
 *     writes each one's lastPingAt and the next run of its own interval;
 *   - claims nothing the predicate leaves out (not due, disabled, deleted,
 *     another probe's, an archived or paused monitor, a blocked, suspended
 *     or deleted project);
 *   - skips a row another writer holds instead of waiting for it;
 *   - never hands one row to two claims made at the same moment, and loses
 *     none;
 *   - does not hand out a row another instance claimed between this one's
 *     read and its claim.
 *
 * Opt in with RUN_POSTGRES_MONITOR_PROBE_CLAIM_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The MonitorProbe, Monitor and
 * Project tables' STRUCTURE is cloned into a unique schema (search_path
 * holds only that schema) that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * MONITOR_PROBE_CLAIM_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * MONITOR_PROBE_CLAIM_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_PROBE_CLAIM_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["Project", "Monitor", "MonitorProbe"];

// A claim that waits instead of skipping fails within this, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const MINUTE_IN_MS: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_IN_MS);
}

describePostgres("claiming monitor probes to check, on Postgres", () => {
  const schema: string = `monitor_probe_claim_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const PROJECT_ID: ObjectID = ObjectID.generate();
  const PROBE_ID: ObjectID = ObjectID.generate();
  const OTHER_PROBE_ID: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_PROBE_CLAIM_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MONITOR_PROBE_CLAIM_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_PROBE_CLAIM_TEST_DATABASE_NAME"] ||
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
           AND column_name NOT IN ('_id', 'isEnabled')`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

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
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProject(PROJECT_ID, {});
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

  /*
   * A monitor and its row for a probe. Every column the claim reads is
   * given, the rest left to the cloned defaults.
   */
  async function insertMonitorProbe(data: {
    nextPingAt: Date | null;
    monitoringInterval?: string | null;
    probeId?: ObjectID;
    projectId?: ObjectID;
    isEnabled?: boolean;
    deletedAt?: Date;
    monitor?: {
      isArchived?: boolean;
      disableActiveMonitoring?: boolean;
      disableActiveMonitoringBecauseOfManualIncident?: boolean;
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent?: boolean;
      deletedAt?: Date;
    };
  }): Promise<ObjectID> {
    const monitorId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = data.projectId || PROJECT_ID;

    await database.query(
      `INSERT INTO "${schema}"."Monitor"
         ("_id", "projectId", "name", "monitorType", "monitoringInterval",
          "isArchived", "disableActiveMonitoring",
          "disableActiveMonitoringBecauseOfManualIncident",
          "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent", "deletedAt")
       VALUES ($1, $2, 'Website', 'Website', $3, $4, $5, $6, $7, $8)`,
      [
        monitorId.toString(),
        projectId.toString(),
        data.monitoringInterval === undefined
          ? "*/5 * * * *"
          : data.monitoringInterval,
        data.monitor?.isArchived || false,
        data.monitor?.disableActiveMonitoring || false,
        data.monitor?.disableActiveMonitoringBecauseOfManualIncident || false,
        data.monitor
          ?.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent || false,
        data.monitor?.deletedAt || null,
      ],
    );

    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."MonitorProbe"
         ("_id", "projectId", "probeId", "monitorId", "isEnabled", "nextPingAt",
          "deletedAt", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), 1)`,
      [
        id.toString(),
        projectId.toString(),
        (data.probeId || PROBE_ID).toString(),
        monitorId.toString(),
        data.isEnabled === undefined ? true : data.isEnabled,
        data.nextPingAt,
        data.deletedAt || null,
      ],
    );

    return id;
  }

  async function scheduleOf(
    id: ObjectID,
  ): Promise<{ lastPingAt: Date | null; nextPingAt: Date | null }> {
    const rows: Array<{ lastPingAt: Date | null; nextPingAt: Date | null }> =
      await database.query(
        `SELECT "lastPingAt", "nextPingAt" FROM "${schema}"."MonitorProbe" WHERE "_id" = $1`,
        [id.toString()],
      );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function claim(
    limit: number = 50,
    probeId: ObjectID = PROBE_ID,
  ): Promise<Array<string>> {
    const claimed: Array<ObjectID> =
      await MonitorProbeService.claimMonitorProbesForProbing({
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

  async function holdRow(
    id: ObjectID,
  ): Promise<{ release: () => Promise<void> }> {
    const holder: QueryRunner = database.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(
      `SELECT "_id" FROM "${schema}"."MonitorProbe" WHERE "_id" = $1 FOR UPDATE`,
      [id.toString()],
    );

    return {
      release: async (): Promise<void> => {
        await holder.rollbackTransaction();
        await holder.release();
      },
    };
  }

  test("claims the due rows and writes each one's last ping and the next run of its own interval", async () => {
    const everyFive: ObjectID = await insertMonitorProbe({
      nextPingAt: null,
      monitoringInterval: "*/5 * * * *",
    });
    const alsoEveryFive: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(3),
      monitoringInterval: "*/5 * * * *",
    });
    const everyMinute: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(1),
      monitoringInterval: "* * * * *",
    });
    // Neither cron-parser nor the normaliser reads it: a minute from now.
    const unreadable: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(2),
      monitoringInterval: "banana",
    });

    const before: number = Date.now();

    expect(await claim()).toEqual(
      sorted([everyFive, alsoEveryFive, everyMinute, unreadable]),
    );

    const after: number = Date.now();

    for (const id of [everyFive, alsoEveryFive, everyMinute, unreadable]) {
      const { lastPingAt, nextPingAt } = await scheduleOf(id);

      expect(lastPingAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(lastPingAt!.getTime()).toBeLessThanOrEqual(after + 1000);
      expect(nextPingAt!.getTime()).toBeGreaterThan(lastPingAt!.getTime());
    }

    const fiveA: Date = (await scheduleOf(everyFive)).nextPingAt!;
    const fiveB: Date = (await scheduleOf(alsoEveryFive)).nextPingAt!;
    const one: Date = (await scheduleOf(everyMinute)).nextPingAt!;

    // The next five-minute mark, the same for both.
    expect(fiveA.toISOString()).toBe(fiveB.toISOString());
    expect(fiveA.getUTCMinutes() % 5).toBe(0);
    expect(fiveA.getUTCSeconds()).toBe(0);
    expect(fiveA.getTime() - before).toBeLessThanOrEqual(5 * MINUTE_IN_MS);
    expect(one.getTime() - before).toBeLessThanOrEqual(MINUTE_IN_MS);

    // Moved on: nothing is due any more.
    expect(await claim()).toEqual([]);
  });

  test("a row the predicate leaves out is neither claimed nor moved", async () => {
    const due: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(1),
    });

    const BLOCKED_PROJECT: ObjectID = ObjectID.generate();
    const SUSPENDED_PROJECT: ObjectID = ObjectID.generate();
    const DELETED_PROJECT: ObjectID = ObjectID.generate();
    await insertProject(BLOCKED_PROJECT, { isBlocked: true });
    await insertProject(SUSPENDED_PROJECT, { subscriptionStatus: "unpaid" });
    await insertProject(DELETED_PROJECT, { deletedAt: minutesAgo(60) });

    const leftOut: Array<ObjectID> = [
      // Not due yet.
      await insertMonitorProbe({ nextPingAt: minutesAgo(-2) }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        probeId: OTHER_PROBE_ID,
      }),
      await insertMonitorProbe({ nextPingAt: minutesAgo(1), isEnabled: false }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        deletedAt: minutesAgo(5),
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        monitor: { isArchived: true },
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        monitor: { disableActiveMonitoring: true },
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        monitor: { disableActiveMonitoringBecauseOfManualIncident: true },
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        monitor: {
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        },
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        monitor: { deletedAt: minutesAgo(5) },
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        projectId: BLOCKED_PROJECT,
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        projectId: SUSPENDED_PROJECT,
      }),
      await insertMonitorProbe({
        nextPingAt: minutesAgo(1),
        projectId: DELETED_PROJECT,
      }),
    ];

    const before: Array<string | null> = [];
    for (const id of leftOut) {
      before.push((await scheduleOf(id)).nextPingAt?.toISOString() || null);
    }

    expect(await claim()).toEqual([due.toString()]);

    for (const [index, id] of leftOut.entries()) {
      const { lastPingAt, nextPingAt } = await scheduleOf(id);
      expect(lastPingAt).toBeNull();
      expect(nextPingAt?.toISOString() || null).toBe(before[index]);
    }
  });

  test("never-checked rows first, then the longest-waiting, and never more than the limit", async () => {
    const never: ObjectID = await insertMonitorProbe({ nextPingAt: null });
    const oldest: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(30),
    });
    const newest: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(1),
    });

    expect(await claim(2)).toEqual(sorted([never, oldest]));
    expect(await claim(2)).toEqual([newest.toString()]);
  });

  test("a row another writer holds is skipped at once, and claimed once it is free", async () => {
    const held: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(10),
    });
    const free: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(5),
    });
    const lock: { release: () => Promise<void> } = await holdRow(held);

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
    expect((await scheduleOf(held)).lastPingAt).toBeNull();
    expect(await claim()).toEqual([held.toString()]);
  });

  test("claims made at the same moment never hand out one row twice, and lose none", async () => {
    const ids: Array<ObjectID> = [];

    for (let index: number = 0; index < 40; index++) {
      ids.push(await insertMonitorProbe({ nextPingAt: minutesAgo(index + 1) }));
    }

    const rounds: Array<Array<string>> = await Promise.all([
      claim(15),
      claim(15),
      claim(15),
      claim(15),
    ]);
    const handedOut: Array<string> = rounds.flat();

    expect(new Set<string>(handedOut).size).toBe(handedOut.length);

    for (const round of rounds) {
      expect(round.length).toBeLessThanOrEqual(15);
    }

    // Whatever a racing claim skipped is still due, for the next one.
    const rest: Array<string> = await claim(100);
    expect([...handedOut, ...rest].sort()).toEqual(sorted(ids));
  });

  /*
   * The read of the due rows takes no lock, so another instance can claim
   * one of them before this claim's statement runs. By then that row's
   * nextPingAt is in the future, and the statement re-checks it.
   */
  test("a row another instance claimed between this claim's read and its claim is not handed out again", async () => {
    const taken: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(10),
    });
    const free: ObjectID = await insertMonitorProbe({
      nextPingAt: minutesAgo(5),
    });

    const realQuery: (
      sql: string,
      params?: Array<unknown>,
    ) => Promise<unknown> = database.manager.query.bind(database.manager);
    let statements: number = 0;

    jest.spyOn(MonitorProbeService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          params?: Array<unknown>,
        ): Promise<unknown> => {
          const result: unknown = await realQuery(sql, params);
          statements++;

          if (statements === 1) {
            // The other instance's claim lands now.
            await database.query(
              `UPDATE "${schema}"."MonitorProbe"
               SET "nextPingAt" = now() + interval '5 minutes', "lastPingAt" = now()
               WHERE "_id" = $1`,
              [taken.toString()],
            );
          }

          return result;
        },
      },
    } as never);

    expect(await claim()).toEqual([free.toString()]);
    expect(statements).toBe(2);
  });
});
