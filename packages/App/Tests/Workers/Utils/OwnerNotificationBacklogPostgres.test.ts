import Entities from "Common/Models/DatabaseModels/Index";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ObjectID from "Common/Types/ObjectID";
import OwnerNotificationBacklog, {
  OWNER_NOTIFICATION_PAGE_SIZE,
  OwnerNotificationBacklogResult,
  OwnerNotificationPage,
} from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger, QueryRunner } from "Common/node_modules/typeorm";

/*
 * AN OWNER NOTIFICATION BACKLOG ON A REAL POSTGRES (issue #7974).
 *
 * The state change jobs read every status change not yet told, every run,
 * and marked each through updateOneById and its every hook. Now a run reads
 * a page at a time, oldest first, and takes each with one hook-free
 * compare-and-set (OwnerNotificationBacklog). This runs the real
 * MonitorStatusTimelineService's statements against a copy of the migrated
 * MonitorStatusTimeline table, counted off the DataSource's logger:
 *
 *   - a run over 250 status changes is 3 page reads and 250 takes - one
 *     statement each, where updateOneById was several and its hooks more;
 *   - status changes already told are never read;
 *   - two runs at once, on connections of their own, take each once;
 *   - a run stopped at its deadline leaves the rest as they were, and the
 *     next run takes exactly those.
 *
 * Opt in with RUN_POSTGRES_OWNER_NOTIFICATION_JOB_TESTS=true and a migrated
 * database (OWNER_NOTIFICATION_JOB_TEST_DATABASE_HOST, _PORT, _NAME;
 * DATABASE_USERNAME, DATABASE_PASSWORD). Every write is to a schema of its
 * own; only the table's structure is copied, never its rows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OWNER_NOTIFICATION_JOB_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * Transaction control is not a statement of its own for this count.
 * A read: what a page of the backlog is.
 */
const SELECT_STATEMENT: RegExp = /^\s*SELECT/i;

const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i;

// Every statement the DataSource runs while counting is on.
class StatementLog implements Logger {
  public statements: Array<string> = [];
  public isCounting: boolean = false;

  public logQuery(
    query: string,
    _parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isCounting && !TRANSACTION_CONTROL.test(query)) {
      this.statements.push(query);
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();
const STATUS_ID: ObjectID = ObjectID.generate();

describePostgres("an owner notification backlog, against Postgres", () => {
  const schema: string = `owner_backlog_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const statementLog: StatementLog = new StatementLog();
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["query"],
      logger: statementLog,
      // Two runs at once run their statements on connections of their own.
      extra: { options: `-c search_path=${schema}`, max: 6 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."MonitorStatusTimeline" (LIKE public."MonitorStatusTimeline" INCLUDING ALL)`,
    );

    // A row names only what the backlog reads; keys stay NOT NULL.
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'MonitorStatusTimeline'
         AND is_nullable = 'NO' AND column_name <> '_id'`,
      [schema],
    );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."MonitorStatusTimeline" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    statementLog.isCounting = false;
    statementLog.statements = [];
    await database.query(`DELETE FROM "${schema}"."MonitorStatusTimeline"`);
  });

  // `count` status changes a second apart, the oldest first; their ids.
  async function seed(
    count: number,
    data?: { isOwnerNotified?: boolean | undefined },
  ): Promise<Array<string>> {
    const ids: Array<string> = [];
    const start: number = Date.now() - 24 * 60 * 60 * 1000;

    for (let index: number = 0; index < count; index++) {
      const id: string = ObjectID.generate().toString();
      ids.push(id);

      await database.query(
        `INSERT INTO "${schema}"."MonitorStatusTimeline" ("_id", "projectId", "monitorId", "monitorStatusId", "isOwnerNotified", "startsAt", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 1)`,
        [
          id,
          PROJECT_ID.toString(),
          MONITOR_ID.toString(),
          STATUS_ID.toString(),
          data?.isOwnerNotified ?? false,
          new Date(start + index * 1000),
        ],
      );
    }

    return ids;
  }

  async function stillToTell(): Promise<Array<string>> {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."MonitorStatusTimeline" WHERE "isOwnerNotified" = false ORDER BY "createdAt" ASC`,
    );

    return rows.map((row: { _id: string }): string => {
      return row._id;
    });
  }

  type Notify = (input: {
    record: MonitorStatusTimeline;
    page: OwnerNotificationPage;
    take: () => Promise<boolean>;
  }) => Promise<void>;

  function run(data: {
    notify: Notify;
    deadline?: JobDeadline | undefined;
  }): Promise<OwnerNotificationBacklogResult> {
    return OwnerNotificationBacklog.forEachToNotify<MonitorStatusTimeline>({
      jobName: "MonitorOwner:SendStatusChangeEmail",
      service: MonitorStatusTimelineService,
      notYetNotified: { isOwnerNotified: false },
      notified: { isOwnerNotified: true },
      select: { monitorId: true },
      deadline: data.deadline,
      notify: data.notify,
    });
  }

  // A job that plans, takes, and tells what it took.
  function telling(told: Array<string>): Notify {
    return async (input: {
      record: MonitorStatusTimeline;
      take: () => Promise<boolean>;
    }): Promise<void> => {
      if (await input.take()) {
        told.push(input.record.id!.toString());
      }
    };
  }

  test("a run over 250 status changes is three page reads and one statement per take, oldest first", async () => {
    const ids: Array<string> = await seed(250);
    const told: Array<string> = [];

    statementLog.isCounting = true;
    const result: OwnerNotificationBacklogResult = await run({
      notify: telling(told),
    });
    statementLog.isCounting = false;

    expect(told).toEqual(ids);
    expect(result.taken).toBe(250);
    expect(await stillToTell()).toEqual([]);

    const pageReads: Array<string> = statementLog.statements.filter(
      (statement: string): boolean => {
        return SELECT_STATEMENT.test(statement);
      },
    );
    const takes: Array<string> = statementLog.statements.filter(
      (statement: string): boolean => {
        return statement.includes('UPDATE "MonitorStatusTimeline"');
      },
    );

    // 100, 100 and 50: a page, then the next, then the short one that ends it.
    expect(pageReads).toHaveLength(
      Math.ceil(250 / OWNER_NOTIFICATION_PAGE_SIZE),
    );
    // One statement a take, and nothing else - no hook reads, no audit rows.
    expect(takes).toHaveLength(250);
    expect(statementLog.statements).toHaveLength(
      pageReads.length + takes.length,
    );

    for (const take of takes) {
      expect(take).toContain('"isOwnerNotified" IS NOT DISTINCT FROM');
    }
  });

  test("status changes already told are never read", async () => {
    await seed(5, { isOwnerNotified: true });
    const due: Array<string> = await seed(3);
    const read: Array<string> = [];

    await run({
      notify: async (input: {
        record: MonitorStatusTimeline;
        take: () => Promise<boolean>;
      }) => {
        read.push(input.record.id!.toString());
        await input.take();
      },
    });

    expect(read).toEqual(due);
  });

  test("two runs at once, each on its own connections, take each status change once between them", async () => {
    await seed(250);
    const told: Array<string> = [];

    // Each run plans (a round trip), then takes: the runs read the same pages.
    const planningFirst: Notify = async (input: {
      record: MonitorStatusTimeline;
      page: OwnerNotificationPage;
      take: () => Promise<boolean>;
    }): Promise<void> => {
      await database.query("SELECT 1");
      await telling(told)(input);
    };

    const [first, second] = await Promise.all([
      run({ notify: planningFirst }),
      run({ notify: planningFirst }),
    ]);

    expect(told).toHaveLength(250);
    expect(new Set<string>(told).size).toBe(250);
    expect(first!.taken + second!.taken).toBe(250);
    expect(await stillToTell()).toEqual([]);
  });

  test("a run stopped at its deadline leaves the rest as they were, and the next run takes exactly those", async () => {
    const ids: Array<string> = await seed(30);
    const deadline: JobDeadline = new JobDeadline();
    const told: Array<string> = [];

    const result: OwnerNotificationBacklogResult = await run({
      deadline: deadline,
      notify: async (input: {
        record: MonitorStatusTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }) => {
        await telling(told)(input);

        if (told.length === 10) {
          deadline.end();
        }
      },
    });

    expect(result.stoppedAtDeadline).toBe(true);
    expect(told).toEqual(ids.slice(0, 10));
    expect(await stillToTell()).toEqual(ids.slice(10));

    const next: Array<string> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual(ids.slice(10));
    expect(await stillToTell()).toEqual([]);
  });
});
