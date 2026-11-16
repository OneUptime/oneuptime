import Entities from "Common/Models/DatabaseModels/Index";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ObjectID from "Common/Types/ObjectID";
import OwnerNotificationBacklog, {
  OwnerNotificationGroup,
  OwnerNotificationGroupResult,
  OwnerNotificationGroupTable,
  OwnerNotificationPage,
} from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";
import PreviousTimelineEntries, {
  TimelineOf,
} from "../../../FeatureSet/Workers/Utils/PreviousTimelineEntries";
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
 * THE OWNER NOTIFICATION JOBS' READS AND TAKES, COUNTED ON A REAL POSTGRES
 * (issues #8862, #8863).
 *
 * Against copies of the migrated IncidentOwnerTeam, IncidentOwnerUser and
 * MonitorStatusTimeline tables, through the real services, with every
 * statement counted off the DataSource's logger:
 *
 *   - #8862: the owner rows of an incident - team rows and user rows - are
 *     told of together: one page read per table, one read per table for
 *     every group of the page, one statement per take. The old mark,
 *     updateOneById, is measured beside the take it became. Two runs at
 *     once, on connections of their own, take each row once, and a run
 *     stopped at its deadline never splits an incident's rows.
 *   - #8863: the entries before a page's 20 status changes of 4 monitors
 *     are read in 8 statements, not 20, and each is what a read of its own
 *     found.
 *
 * Opt in with RUN_POSTGRES_OWNER_NOTIFICATION_JOB_TESTS=true and a migrated
 * database (OWNER_NOTIFICATION_JOB_TEST_DATABASE_HOST, _PORT, _NAME;
 * DATABASE_USERNAME, DATABASE_PASSWORD). Every write is to a schema of its
 * own; only the tables' structure is copied, never their rows.
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
      // DatabaseService's update asks it, to decide what to log.
      getLogLevel: jest.fn(),
    },
  };
});

const SELECT_STATEMENT: RegExp = /^\s*SELECT/i;

// A take: one compare-and-set of an owner row (compareAndSetColumnsByIdWithoutHooks).
const TAKE_STATEMENT: RegExp =
  /^\s*WITH "updated" AS \(UPDATE "IncidentOwner(Team|User)"/;

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

const TABLES: Array<string> = [
  "IncidentOwnerTeam",
  "IncidentOwnerUser",
  "MonitorStatusTimeline",
];

const PROJECT_ID: ObjectID = ObjectID.generate();

describePostgres(
  "the owner notification jobs' reads and takes, against Postgres",
  () => {
    const schema: string = `owner_groups_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const statementLog: StatementLog = new StatementLog();
    let database: DataSource;

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

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        // A row names only what the jobs read; keys stay NOT NULL.
        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_name <> '_id'`,
          [schema, table],
        );

        for (const column of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
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

      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    let clock: number = Date.now() - 24 * 60 * 60 * 1000;

    // A second after the last row written: the order rows are read in.
    function nextMoment(): Date {
      clock += 1000;
      return new Date(clock);
    }

    async function ownerRow(data: {
      table: "IncidentOwnerTeam" | "IncidentOwnerUser";
      incidentId: ObjectID;
    }): Promise<string> {
      const id: string = ObjectID.generate().toString();
      const at: Date = nextMoment();

      await database.query(
        `INSERT INTO "${schema}"."${data.table}" ("_id", "projectId", "incidentId", "${
          data.table === "IncidentOwnerTeam" ? "teamId" : "userId"
        }", "isOwnerNotified", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, false, $5, $5, 1)`,
        [
          id,
          PROJECT_ID.toString(),
          data.incidentId.toString(),
          ObjectID.generate().toString(),
          at,
        ],
      );

      return id;
    }

    // Each incident's rows, team rows first, as the job's group holds them.
    async function seedIncidents(): Promise<Map<string, Array<string>>> {
      const rowsOf: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();

      // Twenty incidents with a team row and a user row each.
      for (let index: number = 0; index < 20; index++) {
        const incidentId: ObjectID = ObjectID.generate();
        rowsOf.set(incidentId.toString(), [
          await ownerRow({ table: "IncidentOwnerTeam", incidentId }),
          await ownerRow({ table: "IncidentOwnerUser", incidentId }),
        ]);
      }

      // Two with three team rows each.
      for (let index: number = 0; index < 2; index++) {
        const incidentId: ObjectID = ObjectID.generate();
        const rows: Array<string> = [];

        for (let row: number = 0; row < 3; row++) {
          rows.push(await ownerRow({ table: "IncidentOwnerTeam", incidentId }));
        }

        rowsOf.set(incidentId.toString(), rows);
      }

      return rowsOf;
    }

    function tables(): Array<OwnerNotificationGroupTable> {
      return [
        OwnerNotificationBacklog.groupTable({
          service: IncidentOwnerTeamService,
          notYetNotified: { isOwnerNotified: false },
          notified: { isOwnerNotified: true },
          select: { _id: true, teamId: true },
        }),
        OwnerNotificationBacklog.groupTable({
          service: IncidentOwnerUserService,
          notYetNotified: { isOwnerNotified: false },
          notified: { isOwnerNotified: true },
          select: { _id: true, userId: true },
        }),
      ];
    }

    interface Told {
      recordId: string;
      rows: Array<string>;
      taken: Array<string>;
    }

    function run(data: {
      told: Array<Told>;
      deadline?: JobDeadline | undefined;
      beforeTake?: (() => Promise<void>) | undefined;
    }): Promise<OwnerNotificationGroupResult> {
      return OwnerNotificationBacklog.forEachGroupToNotify({
        jobName: "IncidentOwner:SendOwnerAddedEmail",
        recordIdColumn: "incidentId",
        tables: tables(),
        deadline: data.deadline,
        notify: async (input: {
          group: OwnerNotificationGroup;
          page: OwnerNotificationPage;
          take: () => Promise<Array<Array<BaseModel>>>;
        }): Promise<void> => {
          if (data.beforeTake) {
            await data.beforeTake();
          }

          const taken: Array<Array<BaseModel>> = await input.take();

          data.told.push({
            recordId: input.group.recordId.toString(),
            rows: input.group.rows.flat().map((row: BaseModel): string => {
              return row.id!.toString();
            }),
            taken: taken.flat().map((row: BaseModel): string => {
              return row.id!.toString();
            }),
          });
        },
      });
    }

    async function stillToTell(): Promise<number> {
      const [team, user] = await Promise.all([
        database.query(
          `SELECT COUNT(*)::int AS "count" FROM "${schema}"."IncidentOwnerTeam" WHERE "isOwnerNotified" = false`,
        ),
        database.query(
          `SELECT COUNT(*)::int AS "count" FROM "${schema}"."IncidentOwnerUser" WHERE "isOwnerNotified" = false`,
        ),
      ]);

      return Number(team[0].count) + Number(user[0].count);
    }

    describe("an incident's owner rows, told of together (#8862)", () => {
      test("46 rows of 22 incidents: each incident's rows of both tables in one group, read with one page read and one group read per table, and one statement per take", async () => {
        const rowsOf: Map<string, Array<string>> = await seedIncidents();
        const told: Array<Told> = [];

        statementLog.isCounting = true;
        const result: OwnerNotificationGroupResult = await run({ told: told });
        statementLog.isCounting = false;

        expect(result.groups).toBe(22);
        expect(await stillToTell()).toBe(0);

        for (const each of told) {
          expect(each.rows).toEqual(rowsOf.get(each.recordId));
          expect(each.taken).toEqual(each.rows);
        }

        const reads: Array<string> = statementLog.statements.filter(
          (statement: string): boolean => {
            return SELECT_STATEMENT.test(statement);
          },
        );
        const takes: Array<string> = statementLog.statements.filter(
          (statement: string): boolean => {
            return TAKE_STATEMENT.test(statement);
          },
        );

        /*
         * The team rows' page; the page's groups, one read per table; the
         * user rows' page - empty, its rows taken with their incidents'.
         */
        expect(reads).toHaveLength(4);
        expect(takes).toHaveLength(46);
        expect(statementLog.statements).toHaveLength(50);
      });

      test("the old mark - updateOneById, with its hooks - against the take it became", async () => {
        const incidentId: ObjectID = ObjectID.generate();
        const [first, second] = [
          await ownerRow({ table: "IncidentOwnerTeam", incidentId }),
          await ownerRow({ table: "IncidentOwnerTeam", incidentId }),
        ];

        // What the hooks post, held: no workflow service, no realtime here.
        const workflowTriggers: SpyInstance<
          typeof IncidentOwnerTeamService.onTriggerWorkflow
        > = jest
          .spyOn(IncidentOwnerTeamService, "onTriggerWorkflow")
          .mockResolvedValue(undefined);
        const realtime: SpyInstance<
          typeof IncidentOwnerTeamService.onTriggerRealtime
        > = jest
          .spyOn(IncidentOwnerTeamService, "onTriggerRealtime")
          .mockResolvedValue(undefined);

        try {
          statementLog.isCounting = true;
          await IncidentOwnerTeamService.updateOneById({
            id: new ObjectID(first!),
            data: { isOwnerNotified: true },
            props: { isRoot: true },
          });
          statementLog.isCounting = false;
        } finally {
          statementLog.isCounting = false;
        }

        const marked: Array<{ isOwnerNotified: boolean }> =
          await database.query(
            `SELECT "isOwnerNotified" FROM "${schema}"."IncidentOwnerTeam" WHERE "_id" = $1`,
            [first],
          );
        expect(marked[0]!.isOwnerNotified).toBe(true);

        const before: number = statementLog.statements.length;
        const triggersBefore: number = workflowTriggers.mock.calls.length;
        statementLog.statements = [];

        statementLog.isCounting = true;
        const isTaken: boolean = await OwnerNotificationBacklog.take({
          service: IncidentOwnerTeamService as never,
          id: new ObjectID(second!),
          notYetNotified: { isOwnerNotified: false } as never,
          notified: { isOwnerNotified: true } as never,
        });
        statementLog.isCounting = false;

        expect(isTaken).toBe(true);
        // The old mark read the row, wrote it, and posted a workflow trigger.
        expect(before).toBeGreaterThanOrEqual(2);
        expect(triggersBefore).toBe(1);
        // The take: one statement, no workflow trigger.
        expect(statementLog.statements).toHaveLength(1);
        expect(workflowTriggers.mock.calls.length).toBe(triggersBefore);

        // eslint-disable-next-line no-console
        console.info(
          `An owner row's mark: updateOneById was ${before} statement(s) and ${triggersBefore} workflow trigger; the take is ${statementLog.statements.length} statement and none.`,
        );

        workflowTriggers.mockRestore();
        realtime.mockRestore();
      });

      test("two runs at once, on connections of their own, take each row once between them", async () => {
        await seedIncidents();
        const told: Array<Told> = [];

        // Each plans (a round trip), then takes: the runs read the same pages.
        const planning: () => Promise<void> = async (): Promise<void> => {
          await database.query("SELECT 1");
        };

        await Promise.all([
          run({ told: told, beforeTake: planning }),
          run({ told: told, beforeTake: planning }),
        ]);

        const taken: Array<string> = told.flatMap((each: Told) => {
          return each.taken;
        });

        expect(taken).toHaveLength(46);
        expect(new Set<string>(taken).size).toBe(46);
        expect(await stillToTell()).toBe(0);
      });

      test("a run stopped at its deadline leaves whole incidents, and the next run tells of exactly those", async () => {
        const rowsOf: Map<string, Array<string>> = await seedIncidents();
        const deadline: JobDeadline = new JobDeadline();
        const told: Array<Told> = [];

        await run({
          told: told,
          deadline: deadline,
          beforeTake: async (): Promise<void> => {
            if (told.length === 4) {
              deadline.end();
            }
          },
        });

        expect(told).toHaveLength(5);

        const next: Array<Told> = [];
        await run({ told: next });

        expect(told.length + next.length).toBe(22);

        // No incident's rows were split between the two runs.
        for (const each of [...told, ...next]) {
          expect(each.taken).toEqual(rowsOf.get(each.recordId));
        }

        expect(await stillToTell()).toBe(0);
      });
    });

    describe("the entries before a page's status changes (#8863)", () => {
      const TIMELINE: TimelineOf<MonitorStatusTimeline> = {
        service: MonitorStatusTimelineService,
        recordIdColumn: "monitorId",
        select: { monitorStatusId: true, startsAt: true, createdAt: true },
      };

      async function statusChange(data: {
        monitorId: ObjectID;
        minute: number;
        isOwnerNotified: boolean;
      }): Promise<MonitorStatusTimeline> {
        const id: ObjectID = ObjectID.generate();
        const startsAt: Date = new Date(
          Date.UTC(2026, 10, 16, 9, 0, 0) + data.minute * 60 * 1000,
        );

        await database.query(
          `INSERT INTO "${schema}"."MonitorStatusTimeline" ("_id", "projectId", "monitorId", "monitorStatusId", "isOwnerNotified", "startsAt", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 1)`,
          [
            id.toString(),
            PROJECT_ID.toString(),
            data.monitorId.toString(),
            ObjectID.generate().toString(),
            data.isOwnerNotified,
            startsAt,
          ],
        );

        const model: MonitorStatusTimeline = new MonitorStatusTimeline(id);
        model.monitorId = data.monitorId;
        model.startsAt = startsAt;
        return model;
      }

      test("20 status changes of 4 monitors read the entries before them in 8 statements, not 20 - each what a read of its own found", async () => {
        const page: Array<MonitorStatusTimeline> = [];

        for (let monitor: number = 0; monitor < 4; monitor++) {
          const monitorId: ObjectID = ObjectID.generate();

          // Told of already: the entry before the page, and one between its changes.
          await statusChange({ monitorId, minute: -1, isOwnerNotified: true });
          await statusChange({ monitorId, minute: 2.5, isOwnerNotified: true });

          for (let change: number = 0; change < 5; change++) {
            page.push(
              await statusChange({
                monitorId,
                minute: change,
                isOwnerNotified: false,
              }),
            );
          }
        }

        // A read of each one's own, as the jobs made them: 20 statements.
        statementLog.isCounting = true;
        const ownReads: Array<string | null> = [];

        for (const entry of page) {
          const found: MonitorStatusTimeline | null =
            await PreviousTimelineEntries.of<MonitorStatusTimeline>({
              ...TIMELINE,
              entry: entry,
              page: new OwnerNotificationPage(),
            });
          ownReads.push(found?.id?.toString() || null);
        }
        statementLog.isCounting = false;

        const perRow: number = statementLog.statements.length;
        statementLog.statements = [];

        // Read with the page.
        const withPage: OwnerNotificationPage = new OwnerNotificationPage();
        statementLog.isCounting = true;
        await PreviousTimelineEntries.readForPage({
          ...TIMELINE,
          entries: page,
          page: withPage,
        });

        const pageReads: Array<string | null> = [];

        for (const entry of page) {
          const found: MonitorStatusTimeline | null =
            await PreviousTimelineEntries.of<MonitorStatusTimeline>({
              ...TIMELINE,
              entry: entry,
              page: withPage,
            });
          pageReads.push(found?.id?.toString() || null);
        }
        statementLog.isCounting = false;

        expect(perRow).toBe(20);
        expect(statementLog.statements).toHaveLength(8);
        expect(pageReads).toEqual(ownReads);
        // None is missing: each status change has an entry before it.
        expect(pageReads.every(Boolean)).toBe(true);

        // eslint-disable-next-line no-console
        console.info(
          `The entries before 20 status changes of 4 monitors: ${perRow} statements read one by one, ${statementLog.statements.length} with the page.`,
        );
      });
    });
  },
);
