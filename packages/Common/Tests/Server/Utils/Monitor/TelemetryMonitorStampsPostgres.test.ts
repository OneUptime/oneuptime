import Entities from "../../../../Models/DatabaseModels/Index";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../../Server/Services/MonitorService";
import TelemetryMonitorSchedule from "../../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import {
  TelemetryMonitorStamp,
  returnTelemetryMonitorsNotQueued,
  stampTelemetryMonitorsScheduled,
} from "../../../../Server/Utils/Monitor/TelemetryMonitorStamps";
import ObjectID from "../../../../Types/ObjectID";
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
import { DataSource, Repository } from "typeorm";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE TELEMETRY SCHEDULER'S STAMPS, AGAINST POSTGRES (issue #11060).
 *
 * The scheduler queues a telemetry monitor's evaluation at the monitor's
 * own moment, and stamps it with its next due time as it does: one
 * statement per step, each row its own next due time (unnest), and only a
 * row still due by the time it was read as due at - so two runs that read
 * the same monitor queue it once. These hold, on a real Postgres:
 *
 *   - every row still due is stamped - never scheduled, due exactly then,
 *     overdue - with both columns and its own next due time, updatedAt
 *     refreshed, and its id handed back; a row due later, or deleted, is
 *     left as it was and not handed back;
 *   - a due time stored finer than JavaScript's milliseconds, which reads
 *     back a fraction early, is still stamped;
 *   - two schedulers stamping the same monitors at once stamp each once;
 *   - a monitor whose job the queue refused is made due again, unless it
 *     was rescheduled since;
 *   - the stamp is a HOT update: it writes no index entry;
 *   - an interval edit moves the next due time onto the new interval
 *     (MonitorService.rescheduleTelemetryMonitor), held to the time read.
 *
 * Opt in with RUN_POSTGRES_TELEMETRY_STAMP_TESTS=true against a disposable
 * Postgres: TELEMETRY_STAMP_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400), DATABASE_USERNAME / DATABASE_PASSWORD / DATABASE_NAME.
 * A "Monitor" table with the columns the statements touch is made in a
 * schema of its own, dropped afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TELEMETRY_STAMP_TESTS"] === "true"
    ? describe
    : describe.skip;

const NOW: Date = new Date("2026-11-26T10:00:07.250Z");
const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

interface Row {
  id: string;
  lastMonitorAt: Date | null;
  nextMonitorAt: Date | null;
  updatedAt: Date;
}

describePostgres("the telemetry scheduler's stamps against Postgres", () => {
  const schema: string = `telemetry_stamps_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  // A second connection, for a second scheduler.
  let otherDatabase: DataSource;
  let repositories: Array<Repository<Monitor>> = [];

  const connect: () => Promise<DataSource> = async (): Promise<DataSource> => {
    const dataSource: DataSource = new DataSource({
      type: "postgres",
      host: process.env["TELEMETRY_STAMP_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["TELEMETRY_STAMP_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      synchronize: false,
      // One connection: a statement's counts are flushed before they are read.
      extra: { max: 1, options: `-c search_path=${schema},public` },
    });

    await dataSource.initialize();
    return dataSource;
  };

  // A monitor, as the scheduler left it.
  const insert: (data: {
    nextMonitorAt: Date | null;
    deletedAt?: Date | null;
    // SQL for the next due time, in place of a value: microseconds, say.
    nextMonitorAtSql?: string;
  }) => Promise<string> = async (data: {
    nextMonitorAt: Date | null;
    deletedAt?: Date | null;
    nextMonitorAtSql?: string;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."Monitor" ("_id", "monitorType", "telemetryMonitorNextMonitorAt", "deletedAt", "updatedAt") VALUES ($1, 'Metrics', ${data.nextMonitorAtSql || "$3::timestamptz"}, $2::timestamptz, '2026-01-01T00:00:00Z')`,
      data.nextMonitorAtSql
        ? [id, data.deletedAt || null]
        : [id, data.deletedAt || null, data.nextMonitorAt],
    );

    return id;
  };

  const read: (id: string) => Promise<Row> = async (
    id: string,
  ): Promise<Row> => {
    const rows: Array<Row> = await database.query(
      `SELECT "_id" AS id, "telemetryMonitorLastMonitorAt" AS "lastMonitorAt", "telemetryMonitorNextMonitorAt" AS "nextMonitorAt", "updatedAt" FROM "${schema}"."Monitor" WHERE "_id" = $1`,
      [id],
    );

    return rows[0]!;
  };

  const stampOf: (data: {
    id: string;
    dueAt: Date;
    nextMonitorAt: Date;
  }) => TelemetryMonitorStamp = (data: {
    id: string;
    dueAt: Date;
    nextMonitorAt: Date;
  }): TelemetryMonitorStamp => {
    return {
      id: new ObjectID(data.id),
      dueAt: data.dueAt,
      nextMonitorAt: data.nextMonitorAt,
    };
  };

  beforeAll(async () => {
    database = await connect();
    await database.query(`CREATE SCHEMA "${schema}"`);
    /*
     * The columns the statements read and write, and indexes on columns
     * they do not move, as the real table has: a HOT update needs both
     * room on the page (fillfactor 90, SetMonitorFillfactor) and no
     * indexed column changed.
     */
    await database.query(`CREATE TABLE "${schema}"."Monitor" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid,
      "monitorType" varchar,
      "telemetryMonitorLastMonitorAt" timestamptz,
      "telemetryMonitorNextMonitorAt" timestamptz,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz
    ) WITH (fillfactor = 90)`);
    await database.query(
      `CREATE INDEX ON "${schema}"."Monitor" ("monitorType", "_id")`,
    );
    await database.query(`CREATE INDEX ON "${schema}"."Monitor" ("projectId")`);

    otherDatabase = await connect();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }

    if (otherDatabase?.isInitialized) {
      await otherDatabase.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`TRUNCATE "${schema}"."Monitor"`);

    repositories = [database.getRepository(Monitor)];

    // Each call hands out the next connection: one, or two schedulers.
    let call: number = 0;
    jest.spyOn(MonitorService, "getRepository").mockImplementation(() => {
      const repository: Repository<Monitor> =
        repositories[call % repositories.length]!;
      call++;
      return repository as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stamps every monitor still due - never scheduled, due then, overdue - and hands back exactly those", async () => {
    const neverScheduled: string = await insert({ nextMonitorAt: null });
    const dueThen: string = await insert({ nextMonitorAt: NOW });
    const overdue: string = await insert({
      nextMonitorAt: new Date(NOW.getTime() - 7 * MINUTE_MS),
    });
    // Stamped by another run since it was read: due a minute on.
    const dueLater: string = await insert({
      nextMonitorAt: new Date(NOW.getTime() + MINUTE_MS),
    });
    const deleted: string = await insert({
      nextMonitorAt: NOW,
      deletedAt: NOW,
    });

    const nexts: Record<string, Date> = {};
    const ids: Array<string> = [
      neverScheduled,
      dueThen,
      overdue,
      dueLater,
      deleted,
    ];

    ids.forEach((id: string, index: number) => {
      nexts[id] = new Date(NOW.getTime() + MINUTE_MS + index * 1234);
    });

    const stamped: Set<string> = await stampTelemetryMonitorsScheduled({
      lastMonitorAt: NOW,
      monitors: ids.map((id: string): TelemetryMonitorStamp => {
        return stampOf({ id, dueAt: NOW, nextMonitorAt: nexts[id]! });
      }),
    });

    expect(Array.from(stamped).sort()).toEqual(
      [neverScheduled, dueThen, overdue].sort(),
    );

    for (const id of [neverScheduled, dueThen, overdue]) {
      const row: Row = await read(id);

      expect(row.lastMonitorAt!.toISOString()).toBe(NOW.toISOString());
      // Each its own next due time, from the one statement.
      expect(row.nextMonitorAt!.toISOString()).toBe(nexts[id]!.toISOString());
      expect(row.updatedAt.getTime()).toBeGreaterThan(
        Date.parse("2026-01-01T00:00:00Z"),
      );
    }

    // Left as they were.
    expect((await read(dueLater)).nextMonitorAt!.toISOString()).toBe(
      new Date(NOW.getTime() + MINUTE_MS).toISOString(),
    );
    expect((await read(dueLater)).lastMonitorAt).toBeNull();
    expect((await read(deleted)).lastMonitorAt).toBeNull();
    expect((await read(deleted)).nextMonitorAt!.toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  test("a due time stored in microseconds, which reads back a fraction early, is still stamped", async () => {
    const id: string = await insert({
      nextMonitorAt: null,
      nextMonitorAtSql: `'2026-11-26T10:00:07.250999Z'::timestamptz`,
    });

    // As the driver hands it to JavaScript: to the millisecond.
    const readBack: Date = (await read(id)).nextMonitorAt!;

    expect(readBack.toISOString()).toBe("2026-11-26T10:00:07.250Z");

    const stamped: Set<string> = await stampTelemetryMonitorsScheduled({
      lastMonitorAt: NOW,
      monitors: [
        stampOf({
          id,
          dueAt: readBack,
          nextMonitorAt: new Date(NOW.getTime() + MINUTE_MS),
        }),
      ],
    });

    expect(Array.from(stamped)).toEqual([id]);
  });

  test("stamps a page of monitors, each its own next due time, in one statement", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 500; index++) {
      ids.push(await insert({ nextMonitorAt: NOW }));
    }

    const queries: Array<string> = [];
    const repository: Repository<Monitor> = database.getRepository(Monitor);
    const query: (sql: string, params?: Array<unknown>) => Promise<unknown> =
      repository.manager.query.bind(repository.manager);

    jest.spyOn(repository.manager, "query").mockImplementation(((
      sql: string,
      params?: Array<unknown>,
    ) => {
      queries.push(sql);
      return query(sql, params);
    }) as never);
    repositories = [repository];

    const stamped: Set<string> = await stampTelemetryMonitorsScheduled({
      lastMonitorAt: NOW,
      monitors: ids.map((id: string, index: number): TelemetryMonitorStamp => {
        return stampOf({
          id,
          dueAt: NOW,
          nextMonitorAt: new Date(NOW.getTime() + index * 113),
        });
      }),
    });

    expect(queries).toHaveLength(1);
    expect(stamped.size).toBe(500);

    const rows: Array<{ nextMonitorAt: Date }> = await database.query(
      `SELECT "telemetryMonitorNextMonitorAt" AS "nextMonitorAt" FROM "${schema}"."Monitor"`,
    );

    expect(
      new Set(
        rows.map((row: { nextMonitorAt: Date }): number => {
          return row.nextMonitorAt.getTime();
        }),
      ).size,
    ).toBe(500);
  });

  test("two schedulers stamping the same monitors at once stamp each exactly once", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 200; index++) {
      ids.push(await insert({ nextMonitorAt: index % 2 === 0 ? null : NOW }));
    }

    repositories = [
      database.getRepository(Monitor),
      otherDatabase.getRepository(Monitor),
    ];

    const stampsFor: (nextOffsetMs: number) => Array<TelemetryMonitorStamp> = (
      nextOffsetMs: number,
    ): Array<TelemetryMonitorStamp> => {
      return ids.map((id: string): TelemetryMonitorStamp => {
        return stampOf({
          id,
          dueAt: NOW,
          nextMonitorAt: new Date(NOW.getTime() + MINUTE_MS + nextOffsetMs),
        });
      });
    };

    const [first, second]: [Set<string>, Set<string>] = await Promise.all([
      stampTelemetryMonitorsScheduled({
        lastMonitorAt: NOW,
        monitors: stampsFor(0),
      }),
      stampTelemetryMonitorsScheduled({
        lastMonitorAt: NOW,
        monitors: stampsFor(1),
      }),
    ]);

    // Every monitor stamped, none by both.
    expect(first.size + second.size).toBe(ids.length);
    expect(
      Array.from(first).filter((id: string): boolean => {
        return second.has(id);
      }),
    ).toEqual([]);
  });

  test("a monitor whose job the queue refused is made due again - unless it was rescheduled since", async () => {
    const refused: string = await insert({ nextMonitorAt: NOW });
    const rescheduledSince: string = await insert({ nextMonitorAt: NOW });
    const next: Date = new Date(NOW.getTime() + MINUTE_MS);

    await stampTelemetryMonitorsScheduled({
      lastMonitorAt: NOW,
      monitors: [refused, rescheduledSince].map(
        (id: string): TelemetryMonitorStamp => {
          return stampOf({ id, dueAt: NOW, nextMonitorAt: next });
        },
      ),
    });

    // An interval edit moved the second since it was stamped.
    const editedTo: Date = new Date(NOW.getTime() + 3 * MINUTE_MS);
    await database.query(
      `UPDATE "${schema}"."Monitor" SET "telemetryMonitorNextMonitorAt" = $1 WHERE "_id" = $2`,
      [editedTo, rescheduledSince],
    );

    await returnTelemetryMonitorsNotQueued(
      [refused, rescheduledSince].map((id: string): TelemetryMonitorStamp => {
        return stampOf({ id, dueAt: NOW, nextMonitorAt: next });
      }),
    );

    expect((await read(refused)).nextMonitorAt!.toISOString()).toBe(
      NOW.toISOString(),
    );
    expect((await read(rescheduledSince)).nextMonitorAt!.toISOString()).toBe(
      editedTo.toISOString(),
    );

    // Due again: the next run stamps it.
    expect(
      await stampTelemetryMonitorsScheduled({
        lastMonitorAt: new Date(NOW.getTime() + 10 * SECOND_MS),
        monitors: [stampOf({ id: refused, dueAt: NOW, nextMonitorAt: next })],
      }),
    ).toEqual(new Set([refused]));
  });

  test("nothing to stamp or make due again sends no statement", async () => {
    const query: jest.Mock = jest.fn();

    repositories = [{ manager: { query } } as unknown as Repository<Monitor>];

    await expect(
      stampTelemetryMonitorsScheduled({ lastMonitorAt: NOW, monitors: [] }),
    ).resolves.toEqual(new Set());
    await returnTelemetryMonitorsNotQueued([]);

    expect(query).not.toHaveBeenCalled();
  });

  test("the stamp is a HOT update: it writes no index entry", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 20; index++) {
      ids.push(await insert({ nextMonitorAt: NOW }));
    }

    const counts: () => Promise<{
      updates: number;
      hot: number;
    }> = async (): Promise<{ updates: number; hot: number }> => {
      await database.query("SELECT pg_stat_force_next_flush()");
      await database.query("SELECT pg_stat_clear_snapshot()");
      const rows: Array<{ updates: number; hot: number }> =
        await database.query(
          `SELECT n_tup_upd::int AS updates, n_tup_hot_upd::int AS hot FROM pg_stat_user_tables WHERE relid = $1::regclass`,
          [`"${schema}"."Monitor"`],
        );
      return rows[0]!;
    };

    const before: { updates: number; hot: number } = await counts();

    await stampTelemetryMonitorsScheduled({
      lastMonitorAt: NOW,
      monitors: ids.map((id: string, index: number): TelemetryMonitorStamp => {
        return stampOf({
          id,
          dueAt: NOW,
          nextMonitorAt: new Date(NOW.getTime() + MINUTE_MS + index),
        });
      }),
    });

    const after: { updates: number; hot: number } = await counts();

    expect(after.updates - before.updates).toBe(20);
    expect(after.hot - before.hot).toBe(20);
  });

  describe("an interval edit (MonitorService.rescheduleTelemetryMonitor)", () => {
    test("moves the next due time onto the new interval, at the monitor's own moment", async () => {
      const stamped: Date = new Date(NOW.getTime() + 23 * 60 * MINUTE_MS);
      const id: string = await insert({ nextMonitorAt: stamped });

      const moved: Date | null =
        await MonitorService.rescheduleTelemetryMonitor({
          monitorId: new ObjectID(id),
          monitoringInterval: "*/5 * * * *",
          nextMonitorAt: (await read(id)).nextMonitorAt,
          now: NOW,
        });

      expect(moved!.toISOString()).toBe(
        TelemetryMonitorSchedule.getNextRunAt({
          monitorId: id,
          monitoringInterval: "*/5 * * * *",
          after: NOW,
        }).toISOString(),
      );
      expect((await read(id)).nextMonitorAt!.toISOString()).toBe(
        moved!.toISOString(),
      );
      // Bookkeeping: updatedAt is not moved.
      expect((await read(id)).updatedAt.toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );
    });

    test("keeps a stamp the scheduler wrote after it was read", async () => {
      const id: string = await insert({ nextMonitorAt: NOW });
      const readAt: Date = (await read(id)).nextMonitorAt!;

      // The scheduler queued it meanwhile.
      const byTheScheduler: Date = new Date(NOW.getTime() + 37 * SECOND_MS);
      await stampTelemetryMonitorsScheduled({
        lastMonitorAt: NOW,
        monitors: [stampOf({ id, dueAt: NOW, nextMonitorAt: byTheScheduler })],
      });

      await MonitorService.rescheduleTelemetryMonitor({
        monitorId: new ObjectID(id),
        monitoringInterval: "0 * * * *",
        nextMonitorAt: readAt,
        now: NOW,
      });

      expect((await read(id)).nextMonitorAt!.toISOString()).toBe(
        byTheScheduler.toISOString(),
      );
    });

    test("leaves a monitor never scheduled due now", async () => {
      const id: string = await insert({ nextMonitorAt: null });

      await expect(
        MonitorService.rescheduleTelemetryMonitor({
          monitorId: new ObjectID(id),
          monitoringInterval: "0 0 * * *",
          nextMonitorAt: null,
          now: NOW,
        }),
      ).resolves.toBeNull();

      expect((await read(id)).nextMonitorAt).toBeNull();
    });
  });
});
