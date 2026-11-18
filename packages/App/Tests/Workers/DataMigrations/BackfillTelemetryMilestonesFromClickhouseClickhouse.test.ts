import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import { JSONObject } from "Common/Types/JSON";
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

/*
 * ------------------------------------------------------------------
 * BackfillTelemetryMilestonesFromClickhouse against a real ClickHouse
 * (#9454).
 *
 * The unit suite (Common's TelemetryMilestoneBackfill.test.ts) pins the
 * walk and the statements, and Common's ProjectMilestonePostgres suite runs
 * the writes on a real Postgres. This one runs the migration's reads on the
 * telemetry tables an install has - built from the models' own columns and
 * keys, under the names the app reads them by - with Postgres stood in for
 * by the projects and marks it would hold:
 *
 *   - a project with old logs and no mark gets first_logs_received, at its
 *     first log's time, to the millisecond;
 *   - a project that has the mark keeps it, and is not read for it;
 *   - a project with no rows gets nothing;
 *   - each kind from its own table, and a profile from whichever of its two
 *     tables holds the earlier row;
 *   - a batch with more rows than one statement may read is read a project
 *     at a time, and that read takes the first granule of each part, not
 *     the project's rows;
 *   - a table the install never had is skipped, and with none at all
 *     nothing is read;
 *   - run again, it keeps nothing.
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/BackfillTelemetryMilestonesFromClickhouseClickhouse.test.ts
 * ------------------------------------------------------------------
 */

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

import MetricService from "Common/Server/Services/MetricService";
import ProjectMilestoneService from "Common/Server/Services/ProjectMilestoneService";
import TelemetryMilestoneBackfill, {
  BATCH_READ_SETTINGS,
  ClickhouseReadFunction,
  TELEMETRY_MILESTONE_BACKFILL_TABLES,
  TelemetryMilestoneBackfillResult,
  TelemetryMilestoneBackfillTable,
} from "Common/Server/Utils/Activation/TelemetryMilestoneBackfill";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import BackfillTelemetryMilestonesFromClickhouse from "../../../FeatureSet/Workers/DataMigrations/BackfillTelemetryMilestonesFromClickhouse";

// The settings a read is sent with (ClickHouse's own type, through Common).
type ClickHouseSettings = Parameters<ClickhouseReadFunction>[1];

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `telemetry_milestone_backfill_test_${process.pid}_${Date.now()}`;

// Small granules, so a few hundred rows a part span several of them.
const GRANULE_ROWS: number = 64;

type ModelType = { new (): AnalyticsBaseModel };

const MODELS: Array<ModelType> = [
  Log,
  Span,
  Metric,
  ExceptionInstance,
  Profile,
  ProfileSample,
];

// Projects in primary key order, as Postgres walks them.
const OLD_LOGS: string = "10000000-0000-4000-8000-000000000001";
const MARKED_LOGS: string = "10000000-0000-4000-8000-000000000002";
const NOTHING: string = "10000000-0000-4000-8000-000000000003";
const EVERY_KIND: string = "10000000-0000-4000-8000-000000000004";
const BUSY_LOGS: string = "10000000-0000-4000-8000-000000000005";
const PROJECTS: Array<string> = [
  OLD_LOGS,
  MARKED_LOGS,
  NOTHING,
  EVERY_KIND,
  BUSY_LOGS,
];

const PROJECT_CREATED_AT: Date = new Date("2026-01-01T00:00:00.000Z");
const MARKED_AT: Date = new Date("2026-11-12T10:00:00.000Z");

// The rows written: [project, table, times].
const FIRST_LOG: string = "2026-09-18 08:15:30.123";
const FIRST_SPAN: string = "2026-09-20 11:00:00.250";
const FIRST_METRIC: string = "2026-09-19 07:30:00.500";
const FIRST_EXCEPTION: string = "2026-09-21 23:59:59.999";
const FIRST_PROFILE: string = "2026-09-22 06:00:00.000";
const FIRST_PROFILE_SAMPLE: string = "2026-09-21 05:00:00.010";

// A ClickHouse time, read as UTC.
function utc(time: string): Date {
  return new Date(`${time.replace(" ", "T")}Z`);
}

interface Mark {
  reachedAt: Date;
  wasBackfilled: boolean;
}

/*
 * The Postgres the backfill writes to, as its statements would leave it:
 * the projects in primary key order, their marks (one per project and
 * milestone, a kept one never overwritten), a mark's time never before its
 * project or after now, and none for a project that is gone.
 */
class StandInPostgres {
  public marks: Map<string, Mark> = new Map<string, Mark>();
  public statements: Array<{ sql: string; parameters: Array<unknown> }> = [];

  public constructor(
    public projects: Array<string>,
    marks: Array<[string, ActivationMilestone, Date]> = [],
  ) {
    for (const [projectId, milestone, reachedAt] of marks) {
      this.marks.set(`${projectId}|${milestone}`, {
        reachedAt,
        wasBackfilled: false,
      });
    }
  }

  public markOf(
    projectId: string,
    milestone: ActivationMilestone,
  ): Mark | undefined {
    return this.marks.get(`${projectId}|${milestone}`);
  }

  public async query(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<unknown> {
    this.statements.push({ sql, parameters });

    if (sql.startsWith(`SELECT "_id"::text AS "_id" FROM "Project"`)) {
      const limit: number = parameters[0] as number;
      const after: string | null = parameters[1] as string | null;

      return this.projects
        .filter((id: string): boolean => {
          return after === null || id > after;
        })
        .slice(0, limit)
        .map((id: string) => {
          return { _id: id };
        });
    }

    if (sql.startsWith(`SELECT "projectId"::text AS "projectId"`)) {
      const projectIds: Array<string> = parameters[0] as Array<string>;
      const milestones: Array<string> = parameters[1] as Array<string>;

      return Array.from(this.marks.keys())
        .map((key: string) => {
          const [projectId, milestone] = key.split("|") as [string, string];
          return { projectId, milestone };
        })
        .filter((row: { projectId: string; milestone: string }): boolean => {
          return (
            projectIds.includes(row.projectId) &&
            milestones.includes(row.milestone)
          );
        });
    }

    if (sql.startsWith(`INSERT INTO "ProjectMilestone"`)) {
      const projectIds: Array<string> = parameters[0] as Array<string>;
      const times: Array<string> = parameters[1] as Array<string>;
      const milestone: string = parameters[2] as string;
      const kept: Array<{ _id: string }> = [];

      projectIds.forEach((projectId: string, index: number): void => {
        const key: string = `${projectId}|${milestone}`;

        if (!this.projects.includes(projectId) || this.marks.has(key)) {
          return;
        }

        const reachedAt: number = Math.max(
          Math.min(new Date(times[index]!).getTime(), Date.now()),
          PROJECT_CREATED_AT.getTime(),
        );

        this.marks.set(key, {
          reachedAt: new Date(reachedAt),
          wasBackfilled: true,
        });
        kept.push({ _id: key });
      });

      return kept;
    }

    throw new Error(`A statement the stand-in does not know: ${sql}`);
  }
}

integration(
  "BackfillTelemetryMilestonesFromClickhouse against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: Record<string, unknown> | undefined;
    let postgres: StandInPostgres;

    async function rows<T>(
      query: string,
      queryParams: Record<string, unknown> = {},
    ): Promise<Array<T>> {
      const result: { json: () => Promise<unknown> } = await client.query({
        query: query,
        query_params: queryParams,
        format: "JSONEachRow",
      });

      return (await result.json()) as Array<T>;
    }

    // The table the app reads, from the model's own columns and keys.
    async function createTable(modelType: ModelType): Promise<void> {
      const model: AnalyticsBaseModel = new modelType();
      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator<AnalyticsBaseModel>({
          modelType: modelType,
          database: clickhouse,
        });
      const columns: Statement = generator.toColumnsCreateStatement(
        model.tableColumns,
      );

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS index_granularity = ${GRANULE_ROWS}, index_granularity_bytes = 0`,
        query_params: columns.query_params,
      });
    }

    function tableOf(modelType: ModelType): TelemetryMilestoneBackfillTable {
      const tableName: string = new modelType().tableName;

      return TELEMETRY_MILESTONE_BACKFILL_TABLES.find(
        (table: TelemetryMilestoneBackfillTable): boolean => {
          return table.tableName === tableName;
        },
      )!;
    }

    // Rows of a project in a table, at these times: one INSERT, one part.
    async function write(
      modelType: ModelType,
      projectId: string,
      times: Array<string>,
    ): Promise<void> {
      const table: TelemetryMilestoneBackfillTable = tableOf(modelType);

      await client.command({
        query: `INSERT INTO ${database}.${table.tableName} (projectId, primaryEntityId, ${table.timeColumn}) SELECT {projectId:String}, {projectId:String}, toDateTime64(arrayJoin({times:Array(String)}), 9, 'UTC')`,
        query_params: { projectId, times },
      });
    }

    // A busy day of a project: `count` rows a millisecond apart, one part.
    async function writeMany(
      modelType: ModelType,
      projectId: string,
      from: string,
      count: number,
    ): Promise<void> {
      const table: TelemetryMilestoneBackfillTable = tableOf(modelType);

      await client.command({
        query: `INSERT INTO ${database}.${table.tableName} (projectId, primaryEntityId, ${table.timeColumn}) SELECT {projectId:String}, {projectId:String}, toDateTime64({from:String}, 9, 'UTC') + toIntervalMillisecond(number) FROM numbers({count:UInt32})`,
        query_params: { projectId, from, count },
      });
    }

    async function createAndFill(): Promise<void> {
      for (const modelType of MODELS) {
        await client.command({
          query: `DROP TABLE IF EXISTS ${database}.${new modelType().tableName} SYNC`,
        });
        await createTable(modelType);
      }

      // Two days of old logs, each its own part, the later one written first.
      await write(Log, OLD_LOGS, ["2026-09-19 10:00:00.000"]);
      await write(Log, OLD_LOGS, [FIRST_LOG, "2026-09-18 09:00:00.000"]);

      await write(Log, MARKED_LOGS, ["2026-09-01 00:00:00.000"]);

      await write(Span, EVERY_KIND, ["2026-09-25 00:00:00.000", FIRST_SPAN]);
      await write(Metric, EVERY_KIND, [
        FIRST_METRIC,
        "2026-09-23 00:00:00.000",
      ]);
      await write(ExceptionInstance, EVERY_KIND, [FIRST_EXCEPTION]);
      // A profile's samples can be earlier than its profile row.
      await write(Profile, EVERY_KIND, [FIRST_PROFILE]);
      await write(ProfileSample, EVERY_KIND, [
        "2026-09-23 05:00:00.000",
        FIRST_PROFILE_SAMPLE,
      ]);

      // Many parts of many rows: a busy project that has not sent since.
      for (let day: number = 1; day <= 6; day++) {
        await writeMany(Log, BUSY_LOGS, `2026-10-0${day} 00:00:00.000`, 2000);
      }
    }

    async function runMigration(): Promise<void> {
      await new BackfillTelemetryMilestonesFromClickhouse().migrate();
    }

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 60000,
      };

      // connect() creates the database it is pointed at.
      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
        migrationDatabase: MetricService.migrationDatabase,
        migrationDatabaseClient: MetricService.migrationDatabaseClient,
      };

      MetricService.database = clickhouse;
      MetricService.databaseClient = client;
      MetricService.migrationDatabase = clickhouse;
      MetricService.migrationDatabaseClient = client;

      await createAndFill();
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(MetricService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    beforeEach(() => {
      postgres = new StandInPostgres(PROJECTS, [
        [MARKED_LOGS, ActivationMilestone.FirstLogsReceived, MARKED_AT],
      ]);

      jest.spyOn(ProjectMilestoneService, "getRepository").mockReturnValue({
        manager: {
          query: (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            return postgres.query(sql, parameters);
          },
        },
      } as unknown as ReturnType<typeof ProjectMilestoneService.getRepository>);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("the migration", () => {
      test("gives a project with old logs and no mark its first logs, at its first log's time, to the millisecond", async () => {
        await runMigration();

        expect(
          postgres.markOf(OLD_LOGS, ActivationMilestone.FirstLogsReceived),
        ).toEqual({ reachedAt: utc(FIRST_LOG), wasBackfilled: true });
        // Its logs are its only telemetry.
        expect(
          Array.from(postgres.marks.keys()).filter((key: string): boolean => {
            return key.startsWith(`${OLD_LOGS}|`);
          }),
        ).toEqual([`${OLD_LOGS}|${ActivationMilestone.FirstLogsReceived}`]);
      });

      test("a project with the mark keeps it as it was", async () => {
        await runMigration();

        expect(
          postgres.markOf(MARKED_LOGS, ActivationMilestone.FirstLogsReceived),
        ).toEqual({ reachedAt: MARKED_AT, wasBackfilled: false });
      });

      test("a project with no rows gets no mark", async () => {
        await runMigration();

        expect(
          Array.from(postgres.marks.keys()).filter((key: string): boolean => {
            return key.startsWith(`${NOTHING}|`);
          }),
        ).toEqual([]);
      });

      test("each kind comes from its own table, and a profile from whichever of its two holds the earlier row", async () => {
        await runMigration();

        const marksOf: (milestone: ActivationMilestone) => Date | undefined = (
          milestone: ActivationMilestone,
        ): Date | undefined => {
          return postgres.markOf(EVERY_KIND, milestone)?.reachedAt;
        };

        expect({
          traces: marksOf(ActivationMilestone.FirstTracesReceived),
          metrics: marksOf(ActivationMilestone.FirstMetricsReceived),
          exceptions: marksOf(ActivationMilestone.FirstExceptionsReceived),
          profiles: marksOf(ActivationMilestone.FirstProfilesReceived),
          logs: marksOf(ActivationMilestone.FirstLogsReceived),
        }).toEqual({
          traces: utc(FIRST_SPAN),
          metrics: utc(FIRST_METRIC),
          exceptions: utc(FIRST_EXCEPTION),
          profiles: utc(FIRST_PROFILE_SAMPLE),
          logs: undefined,
        });
      });

      test("a busy project that went quiet gets its first log too", async () => {
        await runMigration();

        expect(
          postgres.markOf(BUSY_LOGS, ActivationMilestone.FirstLogsReceived),
        ).toEqual({
          reachedAt: utc("2026-10-01 00:00:00.000"),
          wasBackfilled: true,
        });
      });

      test("run again, it keeps nothing and changes nothing", async () => {
        await runMigration();

        const marks: Array<[string, Mark]> = Array.from(postgres.marks);
        const writes: number = postgres.statements.filter(
          (statement: { sql: string }): boolean => {
            return statement.sql.startsWith(`INSERT INTO "ProjectMilestone"`);
          },
        ).length;

        await runMigration();

        expect(Array.from(postgres.marks)).toEqual(marks);
        // Every project has the marks its rows give it: nothing left to write.
        expect(
          postgres.statements.filter((statement: { sql: string }): boolean => {
            return statement.sql.startsWith(`INSERT INTO "ProjectMilestone"`);
          }).length,
        ).toBe(writes);
      });
    });

    describe("its statements", () => {
      test("one statement reads a batch's first rows, and says nothing of a project without any", async () => {
        const found: Array<JSONObject> = await rows<JSONObject>(
          TelemetryMilestoneBackfill.getFirstRowsStatement({
            table: tableOf(Log),
            projectIds: [OLD_LOGS, NOTHING, BUSY_LOGS],
          }).query,
          TelemetryMilestoneBackfill.getFirstRowsStatement({
            table: tableOf(Log),
            projectIds: [OLD_LOGS, NOTHING, BUSY_LOGS],
          }).query_params,
        );

        expect(
          found
            .map((row: JSONObject) => {
              return {
                projectId: row["projectId"],
                firstRowAt: new Date(Number(row["firstRowAt"])),
              };
            })
            .sort((a: { projectId: unknown }, b: { projectId: unknown }) => {
              return String(a.projectId).localeCompare(String(b.projectId));
            }),
        ).toEqual([
          { projectId: OLD_LOGS, firstRowAt: utc(FIRST_LOG) },
          { projectId: BUSY_LOGS, firstRowAt: utc("2026-10-01 00:00:00.000") },
        ]);
      });

      test("a project's own read takes the first granule of each part, not the project's rows", async () => {
        const statement: Statement =
          TelemetryMilestoneBackfill.getFirstRowOfProjectStatement({
            table: tableOf(Log),
            projectId: BUSY_LOGS,
          });
        const queryId: string = `first-row-of-project-${Date.now()}`;

        const result: { json: () => Promise<unknown> } = await client.query({
          query: statement.query,
          query_params: statement.query_params,
          format: "JSONEachRow",
          query_id: queryId,
          clickhouse_settings: { use_query_condition_cache: 0 },
        });

        expect(
          ((await result.json()) as Array<JSONObject>).map(
            (row: JSONObject) => {
              return new Date(Number(row["firstRowAt"]));
            },
          ),
        ).toEqual([utc("2026-10-01 00:00:00.000")]);

        await client.command({ query: "SYSTEM FLUSH LOGS" });

        const read: Array<{ read_rows: string }> = await rows<{
          read_rows: string;
        }>(
          "SELECT read_rows FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish'",
          { queryId },
        );
        const parts: Array<{ parts: string }> = await rows<{ parts: string }>(
          "SELECT count() AS parts FROM system.parts WHERE database = {database:String} AND table = {table:String} AND active",
          { database, table: new Log().tableName },
        );

        // Six days of 2,000 rows each: 12,000 rows, in 188 granules.
        expect(Number(read[0]!.read_rows)).toBeGreaterThan(0);
        expect(Number(read[0]!.read_rows)).toBeLessThanOrEqual(
          Number(parts[0]!.parts) * GRANULE_ROWS * 2,
        );
        expect(Number(read[0]!.read_rows)).toBeLessThan(12000 / 4);
      });

      test("a batch over its rows bound is read a project at a time, with the same marks", async () => {
        const reads: Array<{
          statement: Statement;
          settings: ClickHouseSettings;
        }> = [];

        const result: TelemetryMilestoneBackfillResult =
          await TelemetryMilestoneBackfill.backfill({
            tableExists: async (tableName: string): Promise<boolean> => {
              return await ClickHouseMigrationUtil.tableExists(tableName);
            },
            query: (sql: string, parameters: Array<unknown>) => {
              return postgres.query(sql, parameters);
            },
            readClickhouse: async (
              statement: Statement,
              settings: ClickHouseSettings,
            ): Promise<Array<JSONObject>> => {
              reads.push({ statement, settings });

              // A bound no batch fits in, so ClickHouse itself refuses it.
              const bounded: ClickHouseSettings =
                settings === BATCH_READ_SETTINGS
                  ? { ...settings, max_rows_to_read: "1" }
                  : settings;
              const answer: { json: () => Promise<unknown> } =
                await MetricService.executeQuery(statement, {
                  clickhouseSettings: bounded,
                });

              return (
                ((await answer.json()) as { data?: Array<JSONObject> }).data ||
                []
              );
            },
          });

        // ClickHouse refused the batch (TOO_MANY_ROWS), and no project's read failed.
        expect(result.failedReads).toBe(0);
        expect(result.lastError).toContain("Limit for rows");
        expect(
          reads.some((read: { statement: Statement }): boolean => {
            return read.statement.query.includes("LIMIT 1");
          }),
        ).toBe(true);
        expect(
          postgres.markOf(OLD_LOGS, ActivationMilestone.FirstLogsReceived),
        ).toEqual({ reachedAt: utc(FIRST_LOG), wasBackfilled: true });
        expect(
          postgres.markOf(EVERY_KIND, ActivationMilestone.FirstProfilesReceived)
            ?.reachedAt,
        ).toEqual(utc(FIRST_PROFILE_SAMPLE));
        expect(
          postgres.markOf(BUSY_LOGS, ActivationMilestone.FirstLogsReceived)
            ?.reachedAt,
        ).toEqual(utc("2026-10-01 00:00:00.000"));
      });
    });

    describe("an install without the tables", () => {
      afterAll(async (): Promise<void> => {
        await createAndFill();
      });

      test("skips a table it never had and reads the others", async () => {
        await client.command({
          query: `DROP TABLE IF EXISTS ${database}.${new ProfileSample().tableName} SYNC`,
        });

        await runMigration();

        // From the profile row alone, the only profile table there is.
        expect(
          postgres.markOf(EVERY_KIND, ActivationMilestone.FirstProfilesReceived)
            ?.reachedAt,
        ).toEqual(utc(FIRST_PROFILE));
        expect(
          postgres.markOf(OLD_LOGS, ActivationMilestone.FirstLogsReceived)
            ?.reachedAt,
        ).toEqual(utc(FIRST_LOG));
      });

      test("with none of them reads nothing at all", async () => {
        for (const modelType of MODELS) {
          await client.command({
            query: `DROP TABLE IF EXISTS ${database}.${new modelType().tableName} SYNC`,
          });
        }

        await runMigration();

        expect(postgres.statements).toEqual([]);
        expect(postgres.marks.size).toBe(1);
      });
    });
  },
);

describe("BackfillTelemetryMilestonesFromClickhouse ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
