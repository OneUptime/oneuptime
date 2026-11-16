import Entities from "Common/Models/DatabaseModels/Index";
import Incident from "Common/Models/DatabaseModels/Incident";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import IncidentService from "Common/Server/Services/IncidentService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ObjectID from "Common/Types/ObjectID";
import { OwnerNotificationBacklogResult } from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";
import OwnerReminderBacklog, {
  DueReminder,
} from "../../../FeatureSet/Workers/Utils/OwnerReminderBacklog";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { DataSource, Logger, QueryRunner } from "Common/node_modules/typeorm";

/*
 * THE REMINDER JOBS' READS AND MOVES, COUNTED ON A REAL POSTGRES (issue
 * #9019).
 *
 * Against a copy of the migrated Incident table, through the real
 * IncidentService, with every statement counted off the DataSource's
 * logger. A reminder job read every incident with a reminder due in one
 * statement, with no deadline, and moved each on with updateOneById - a
 * read, the write, a realtime event and a workflow trigger. Now:
 *
 *   - 46 due incidents, 20 to a page: 3 page reads, and one statement to
 *     move each reminder on - 49 statements - and the longest due first;
 *   - a reminder whose next time Postgres wrote to the microsecond is moved
 *     on all the same: the move compares the time to the millisecond, as
 *     the run read it;
 *   - two runs at once, on connections of their own: each reminder moved,
 *     and told of, once between them;
 *   - a run stopped at its deadline leaves the rest due, and the next run
 *     moves them on, each once.
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
      getLogLevel: jest.fn(),
    },
  };
});

const SELECT_STATEMENT: RegExp = /^\s*SELECT/i;

// A move: one compare-and-set of an incident (compareAndSetColumnsByIdWithoutHooks).
const MOVE_STATEMENT: RegExp = /^\s*WITH "updated" AS \(UPDATE "Incident"/;

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
const MINUTE: number = 60 * 1000;

describePostgres(
  "the reminder jobs' reads and moves, against Postgres",
  () => {
    const schema: string = `owner_reminders_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const statementLog: StatementLog = new StatementLog();
    let database: DataSource;
    let workflowTriggers: SpyInstance<
      typeof IncidentService.onTriggerWorkflow
    >;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_HOST"] ||
          "localhost",
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
        `CREATE TABLE "${schema}"."Incident" (LIKE public."Incident" INCLUDING ALL)`,
      );

      // A row names only what the job reads; keys stay NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'Incident'
           AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."Incident" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // What a move posts, held: no workflow service here.
      workflowTriggers = jest
        .spyOn(IncidentService, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
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
      workflowTriggers.mockClear();
      await database.query(`DELETE FROM "${schema}"."Incident"`);
    });

    /*
     * Incidents whose reminder came due a minute apart, the first the
     * longest ago, each reminded twice before: their ids in that order.
     */
    async function seedDue(count: number): Promise<Array<string>> {
      const ids: Array<string> = [];
      const now: number = Date.now();

      for (let index: number = 0; index < count; index++) {
        const id: string = ObjectID.generate().toString();
        ids.push(id);

        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "title", "nextReminderNotificationAt", "reminderNotificationSentCount", "createdAt", "updatedAt", "version")
           VALUES ($1, $2, $3, $4, 2, $5, $5, 1)`,
          [
            id,
            PROJECT_ID.toString(),
            `Incident ${index}`,
            new Date(now - (count - index + 5) * MINUTE),
            new Date(now - 24 * 60 * MINUTE),
          ],
        );
      }

      return ids;
    }

    function run(data: {
      sent: Array<string>;
      deadline?: JobDeadline | undefined;
      pageSize?: number | undefined;
      afterSend?: (() => void) | undefined;
    }): Promise<OwnerNotificationBacklogResult> {
      return OwnerReminderBacklog.forEachDue<Incident>({
        jobName: "IncidentOwner:SendUnresolvedReminderNotification",
        service: IncidentService,
        select: { title: true },
        deadline: data.deadline,
        pageSize: data.pageSize,
        remind: async (input: {
          record: Incident;
          reminder: DueReminder<Incident>;
        }): Promise<void> => {
          if (await input.reminder.send(30)) {
            data.sent.push(input.record.id!.toString());
            data.afterSend?.();
          }
        },
      });
    }

    async function stillDue(): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${schema}"."Incident" WHERE "nextReminderNotificationAt" < now()`,
      );

      return Number(rows[0]!.count);
    }

    async function sentCounts(): Promise<Array<number>> {
      const rows: Array<{ reminderNotificationSentCount: number }> =
        await database.query(
          `SELECT "reminderNotificationSentCount" FROM "${schema}"."Incident"`,
        );

      return rows.map((row: { reminderNotificationSentCount: number }) => {
        return Number(row.reminderNotificationSentCount);
      });
    }

    test("46 due incidents, 20 to a page: 3 page reads and one statement for each reminder, the longest due first", async () => {
      const ids: Array<string> = await seedDue(46);
      const sent: Array<string> = [];

      statementLog.isCounting = true;
      const result: OwnerNotificationBacklogResult = await run({
        sent: sent,
        pageSize: 20,
      });
      statementLog.isCounting = false;

      expect(result).toEqual({
        pages: 3,
        read: 46,
        taken: 46,
        takenElsewhere: 0,
        failed: 0,
        stoppedAtDeadline: false,
      });
      expect(sent).toEqual(ids);
      expect(await stillDue()).toBe(0);
      expect(await sentCounts()).toEqual(new Array(46).fill(3));

      const reads: Array<string> = statementLog.statements.filter(
        (statement: string): boolean => {
          return SELECT_STATEMENT.test(statement);
        },
      );
      const moves: Array<string> = statementLog.statements.filter(
        (statement: string): boolean => {
          return MOVE_STATEMENT.test(statement);
        },
      );

      expect(reads).toHaveLength(3);
      expect(moves).toHaveLength(46);
      expect(statementLog.statements).toHaveLength(49);

      // Each move started only the workflows that watch the reminder.
      expect(workflowTriggers).toHaveBeenCalledTimes(46);

      // eslint-disable-next-line no-console
      console.log(
        `#9019: 46 due reminders, 20 to a page: ${reads.length} page reads and ${moves.length} one-statement moves (${statementLog.statements.length} statements in all).`,
      );
    });

    test("a next reminder Postgres wrote to the microsecond is moved on, from what the run read to the millisecond", async () => {
      const [id] = await seedDue(1);

      // Stamped by Postgres: microseconds the read drops.
      await database.query(
        `UPDATE "${schema}"."Incident" SET "nextReminderNotificationAt" = now() - interval '90 seconds' WHERE "_id" = $1`,
        [id],
      );

      const sent: Array<string> = [];
      await run({ sent: sent });

      expect(sent).toEqual([id]);
      expect(await sentCounts()).toEqual([3]);
    });

    test("two runs at once, on connections of their own: each reminder moved and told of once between them", async () => {
      const ids: Array<string> = await seedDue(30);
      const sent: Array<string> = [];

      const results: Array<OwnerNotificationBacklogResult> = await Promise.all(
        [
          run({ sent: sent, pageSize: 10 }),
          run({ sent: sent, pageSize: 10 }),
        ],
      );

      expect([...sent].sort()).toEqual([...ids].sort());
      expect(
        results[0]!.taken + results[1]!.taken,
      ).toBe(30);
      expect(await sentCounts()).toEqual(new Array(30).fill(3));
    });

    test("a run stopped at its deadline leaves the rest due; the next run sends them, each once", async () => {
      const ids: Array<string> = await seedDue(25);
      const sent: Array<string> = [];
      const deadline: JobDeadline = new JobDeadline();

      const first: OwnerNotificationBacklogResult = await run({
        sent: sent,
        pageSize: 10,
        deadline: deadline,
        afterSend: (): void => {
          if (sent.length === 7) {
            deadline.end();
          }
        },
      });

      expect(first.stoppedAtDeadline).toBe(true);
      expect(sent).toEqual(ids.slice(0, 7));
      expect(await stillDue()).toBe(18);

      await run({ sent: sent, pageSize: 10 });

      expect(sent).toEqual(ids);
      expect(await stillDue()).toBe(0);
      expect(await sentCounts()).toEqual(new Array(25).fill(3));
    });
  },
);
