import { ClickHouseSettings } from "@clickhouse/client";
import MetricService from "../../Services/MetricService";
import ProjectMilestoneService from "../../Services/ProjectMilestoneService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { TELEMETRY_KIND_OF_TABLE } from "./TelemetryMilestones";
import ActivationMilestone, {
  ACTIVATION_MILESTONE_OF_TELEMETRY_KIND,
  ActivationTelemetryKind,
} from "../../../Types/Analytics/ActivationMilestone";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE FIRST-DATA MARKS OF THE TELEMETRY A PROJECT HAS, FROM CLICKHOUSE
 * (issue #9454).
 *
 * The Logs, Traces, Metrics, Exceptions, Profiles and Topology pages explain
 * themselves until their signal's first-data mark exists (#6534, #6897):
 * FirstLogsReceived, FirstTracesReceived ... - and the products menu says
 * "Not set up" by the same marks. The fan-in writer keeps a mark with the
 * project's first rows of a kind (TelemetryMilestones), since the release
 * that brought the marks. The first backfill (ProjectMilestoneBackfill)
 * filled the older projects' marks from TelemetryUsageBilling, which only
 * holds what was metered:
 *
 *   - on a self-hosted server, nothing: its metering began days before the
 *     marks did, a week at most, and the backfill ran before it had staged
 *     anything;
 *   - on OneUptime Cloud, the days billed to a paying project, never a
 *     project that does not pay or the days before its billing started, and
 *     no exceptions before they were counted apart (2026-11-10).
 *
 * So a project that sent telemetry before the upgrade and nothing since had
 * no mark: its Logs page explained itself over its own logs, and its menu
 * said "Logs - Not set up". Here each such project gets the mark from what
 * its explorer shows - the project's earliest row of the kind ClickHouse
 * still holds - on every install.
 *
 * What it reads, a batch of projects at a time, in primary key order:
 *
 *   - which marks of the batch's projects are kept already (Postgres); a
 *     kind a project has is never read again;
 *   - for each telemetry table and the batch's projects without its mark,
 *     their earliest row: one statement, `projectId IN (...) GROUP BY
 *     projectId`. Every table's sort key starts with projectId, and a batch
 *     is a run of neighbouring ids, so the statement reads the rows of the
 *     projects that have some and a granule or so a part for the rest.
 *     Bounded by time and by rows (max_rows_to_read refuses before reading,
 *     from the index's estimate);
 *   - for a batch that holds more rows than that, each project on its own:
 *     `ORDER BY <time> LIMIT 1`, which the sort key answers from the first
 *     granule of each part (a metric, sorted by its name before its time,
 *     reads its project's times), bounded by time.
 *
 * Each mark goes in as the first backfill's do: INSERT ... ON CONFLICT
 * ("projectId", "milestone") DO NOTHING, wasBackfilled, and no analytics
 * event - so a mark kept live meanwhile, with its event, is never
 * overwritten, and two runs at once keep one row. Its time is the earliest
 * row's, never before the project was created (a client's clock, a backdated
 * import) nor after now.
 *
 * Never holds up the upgrade: every statement is bounded, the run stops
 * starting new reads once its time budget is spent, and a read that fails is
 * counted and skipped - such a project gets its mark with its next data, as
 * every project does. A table that does not exist (an install that never had
 * it) is skipped, and with none at all nothing is read; so is one ClickHouse
 * cannot say it has, and the run says which.
 */

export interface TelemetryMilestoneBackfillTable {
  tableName: AnalyticsTableName;
  /*
   * The row's own time: the column the table's days are partitioned by,
   * second in its sort key after projectId (but for a metric's, after its
   * name and entity).
   */
  timeColumn: string;
  milestone: ActivationMilestone;
}

const backfillTable: (
  tableName: AnalyticsTableName,
  timeColumn: string,
) => TelemetryMilestoneBackfillTable = (
  tableName: AnalyticsTableName,
  timeColumn: string,
): TelemetryMilestoneBackfillTable => {
  const kind: ActivationTelemetryKind = TELEMETRY_KIND_OF_TABLE[tableName]!;

  return {
    tableName: tableName,
    timeColumn: timeColumn,
    milestone: ACTIVATION_MILESTONE_OF_TELEMETRY_KIND[kind],
  };
};

// Every table the fan-in writer keeps a mark for (TELEMETRY_KIND_OF_TABLE).
export const TELEMETRY_MILESTONE_BACKFILL_TABLES: ReadonlyArray<TelemetryMilestoneBackfillTable> =
  [
    backfillTable(AnalyticsTableName.Log, "time"),
    backfillTable(AnalyticsTableName.Span, "startTime"),
    backfillTable(AnalyticsTableName.Metric, "time"),
    backfillTable(AnalyticsTableName.ExceptionInstance, "time"),
    // A profile is stored as its profile row and its samples.
    backfillTable(AnalyticsTableName.Profile, "startTime"),
    backfillTable(AnalyticsTableName.ProfileSample, "time"),
  ];

export const TELEMETRY_MILESTONE_BACKFILL_BATCH_SIZE: number = 200;

// The run stops starting new reads after this long.
export const TELEMETRY_MILESTONE_BACKFILL_TIME_BUDGET_IN_MS: number =
  15 * 60 * 1000;

/*
 * A batch's statement: half a minute, and no more rows than a few seconds'
 * read, by the index's estimate.
 */
export const BATCH_READ_SETTINGS: ClickHouseSettings = {
  max_execution_time: 30,
  max_rows_to_read: "100000000",
  read_overflow_mode: "throw",
};

// One project's statement, when its batch held too many rows.
export const PROJECT_READ_SETTINGS: ClickHouseSettings = {
  max_execution_time: 10,
};

/*
 * What ClickHouse says when a read would be, or was, too big for its bounds:
 * TOO_MANY_ROWS (158), TIMEOUT_EXCEEDED (159), TOO_SLOW (160),
 * MEMORY_LIMIT_EXCEEDED (241), TOO_MANY_BYTES (307).
 */
const READ_TOO_LARGE_ERROR_CODES: ReadonlyArray<string> = [
  "158",
  "159",
  "160",
  "241",
  "307",
];

const MARKS_SQL: string = `SELECT "projectId"::text AS "projectId", "milestone" FROM "ProjectMilestone" WHERE "projectId" = ANY($1::uuid[]) AND "milestone" = ANY($2::varchar[])`;

const PROJECTS_SQL: string = `SELECT "_id"::text AS "_id" FROM "Project" WHERE ($2::uuid IS NULL OR "_id" > $2::uuid) ORDER BY "_id" ASC LIMIT $1`;

/*
 * The marks of one milestone for a batch's projects ($1) at their earliest
 * rows' times ($2), only for projects that still exist, and never over a
 * mark kept already.
 */
export const KEEP_MARKS_SQL: string = `INSERT INTO "ProjectMilestone" ("projectId", "milestone", "reachedAt", "wasBackfilled", "version") SELECT "project"."_id", $3::varchar, GREATEST(LEAST("reached"."reachedAt", now()), "project"."createdAt"), true, 1 FROM unnest($1::uuid[], $2::timestamptz[]) AS "reached"("projectId", "reachedAt") JOIN "Project" AS "project" ON "project"."_id" = "reached"."projectId" ON CONFLICT ("projectId", "milestone") DO NOTHING RETURNING "_id"`;

export type PostgresQueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

export type ClickhouseReadFunction = (
  statement: Statement,
  settings: ClickHouseSettings,
) => Promise<Array<JSONObject>>;

export interface TelemetryMilestoneBackfillOptions {
  // Whether a ClickHouse table exists (ClickHouseMigrationUtil.tableExists).
  tableExists: (tableName: string) => Promise<boolean>;
  batchSize?: number | undefined;
  timeBudgetInMs?: number | undefined;
  query?: PostgresQueryFunction | undefined;
  readClickhouse?: ClickhouseReadFunction | undefined;
  now?: (() => number) | undefined;
}

export interface TelemetryMilestoneBackfillResult {
  projects: number;
  keptByMilestone: Partial<Record<ActivationMilestone, number>>;
  // The tables this install does not have, which were not read.
  missingTables: Array<string>;
  // The tables ClickHouse could not say it has, which were not read either.
  uncheckedTables: Array<string>;
  /*
   * A project's read of one table that failed, or that the time budget left
   * unmade: such a project keeps no mark from it.
   */
  failedReads: number;
  // Marks a write failed for.
  unkeptMarks: number;
  // The run stopped at its time budget, before the last project.
  isStoppedByTimeBudget: boolean;
  // The last failure, to say why.
  lastError: string | null;
}

const readRows: (result: unknown) => Array<Record<string, unknown>> = (
  result: unknown,
): Array<Record<string, unknown>> => {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : [];
};

const describeError: (error: unknown) => string = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export default class TelemetryMilestoneBackfill {
  // The earliest row of each of these projects in this table.
  public static getFirstRowsStatement(data: {
    table: TelemetryMilestoneBackfillTable;
    projectIds: Array<string>;
  }): Statement {
    return SQL`SELECT projectId, toUnixTimestamp64Milli(min(${data.table.timeColumn})) AS firstRowAt FROM ${data.table.tableName} WHERE projectId IN ${{
      type: TableColumnType.ArrayText,
      value: data.projectIds,
    }} GROUP BY projectId`;
  }

  // The earliest row of one project in this table, in the sort key's order.
  public static getFirstRowOfProjectStatement(data: {
    table: TelemetryMilestoneBackfillTable;
    projectId: string;
  }): Statement {
    return SQL`SELECT toUnixTimestamp64Milli(${data.table.timeColumn}) AS firstRowAt FROM ${data.table.tableName} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: new ObjectID(data.projectId),
    }} ORDER BY ${data.table.timeColumn} ASC LIMIT 1`;
  }

  // Whether a read failed for being too big for its bounds.
  public static isReadTooLarge(error: unknown): boolean {
    if (error instanceof QueryTimeoutException) {
      return true;
    }

    const code: unknown = (error as { code?: unknown } | null)?.code;

    return READ_TOO_LARGE_ERROR_CODES.includes(String(code));
  }

  // A row's time in milliseconds, or null when it is not one.
  public static readTime(value: unknown): number | null {
    const time: number = Number(value);

    return Number.isFinite(time) && time > 0 ? time : null;
  }

  public static async backfill(
    options: TelemetryMilestoneBackfillOptions,
  ): Promise<TelemetryMilestoneBackfillResult> {
    const batchSize: number = Math.max(
      1,
      Math.floor(options.batchSize || TELEMETRY_MILESTONE_BACKFILL_BATCH_SIZE),
    );
    const now: () => number = options.now || Date.now;
    const deadline: number =
      now() +
      (options.timeBudgetInMs ??
        TELEMETRY_MILESTONE_BACKFILL_TIME_BUDGET_IN_MS);

    const query: PostgresQueryFunction =
      options.query ||
      (async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        return await ProjectMilestoneService.getRepository().manager.query(
          sql,
          parameters,
        );
      });

    const readClickhouse: ClickhouseReadFunction =
      options.readClickhouse ||
      (async (
        statement: Statement,
        settings: ClickHouseSettings,
      ): Promise<Array<JSONObject>> => {
        const result: { json: () => Promise<unknown> } =
          await MetricService.executeQuery(statement, {
            clickhouseSettings: settings,
          });
        const json: { data?: Array<JSONObject> } = (await result.json()) as {
          data?: Array<JSONObject>;
        };

        return json.data || [];
      });

    const result: TelemetryMilestoneBackfillResult = {
      projects: 0,
      keptByMilestone: {},
      missingTables: [],
      uncheckedTables: [],
      failedReads: 0,
      unkeptMarks: 0,
      isStoppedByTimeBudget: false,
      lastError: null,
    };

    // The tables this install has: one it never had has nothing to read.
    const tables: Array<TelemetryMilestoneBackfillTable> = [];

    for (const table of TELEMETRY_MILESTONE_BACKFILL_TABLES) {
      let exists: boolean;

      try {
        exists = await options.tableExists(table.tableName);
      } catch (error) {
        // ClickHouse did not say: the table is not read, and the run says so.
        result.uncheckedTables.push(table.tableName);
        result.lastError = describeError(error);
        continue;
      }

      if (exists) {
        tables.push(table);
      } else {
        result.missingTables.push(table.tableName);
      }
    }

    if (tables.length === 0) {
      return result;
    }

    const milestones: Array<ActivationMilestone> = [];

    for (const table of tables) {
      if (!milestones.includes(table.milestone)) {
        milestones.push(table.milestone);
      }
    }

    let lastProjectId: string | null = null;

    for (;;) {
      if (now() >= deadline) {
        result.isStoppedByTimeBudget = true;
        break;
      }

      const projectIds: Array<string> = readRows(
        await query(PROJECTS_SQL, [batchSize, lastProjectId]),
      ).map((row: Record<string, unknown>): string => {
        return String(row["_id"]);
      });

      if (projectIds.length === 0) {
        break;
      }

      result.projects += projectIds.length;

      // The marks the batch's projects have: a kind they have is not read.
      const marked: Set<string> = new Set<string>(
        readRows(await query(MARKS_SQL, [projectIds, milestones])).map(
          (row: Record<string, unknown>): string => {
            return `${String(row["projectId"])}|${String(row["milestone"])}`;
          },
        ),
      );

      // Each table's read, at once: a few statements, each bounded.
      const firstRowsOfTables: Array<Map<string, number>> = await Promise.all(
        tables.map(
          async (
            table: TelemetryMilestoneBackfillTable,
          ): Promise<Map<string, number>> => {
            const unmarked: Array<string> = projectIds.filter(
              (projectId: string): boolean => {
                return !marked.has(`${projectId}|${table.milestone}`);
              },
            );

            if (unmarked.length === 0) {
              return new Map<string, number>();
            }

            return await TelemetryMilestoneBackfill.readFirstRows({
              table: table,
              projectIds: unmarked,
              readClickhouse: readClickhouse,
              now: now,
              deadline: deadline,
              result: result,
            });
          },
        ),
      );

      for (const milestone of milestones) {
        // The earliest row of the kind, across its tables.
        const firstRows: Map<string, number> = new Map<string, number>();

        tables.forEach(
          (table: TelemetryMilestoneBackfillTable, index: number): void => {
            if (table.milestone !== milestone) {
              return;
            }

            for (const [projectId, firstRowAt] of firstRowsOfTables[index]!) {
              const earliest: number | undefined = firstRows.get(projectId);

              if (earliest === undefined || firstRowAt < earliest) {
                firstRows.set(projectId, firstRowAt);
              }
            }
          },
        );

        if (firstRows.size === 0) {
          continue;
        }

        const reached: Array<[string, number]> = Array.from(firstRows);

        try {
          const kept: number = readRows(
            await query(KEEP_MARKS_SQL, [
              reached.map((entry: [string, number]): string => {
                return entry[0];
              }),
              reached.map((entry: [string, number]): string => {
                return new Date(entry[1]).toISOString();
              }),
              milestone,
            ]),
          ).length;

          result.keptByMilestone[milestone] =
            (result.keptByMilestone[milestone] || 0) + kept;
        } catch (error) {
          // A project deleted meanwhile, say: the next batch goes on.
          result.unkeptMarks += reached.length;
          result.lastError = describeError(error);
        }
      }

      lastProjectId = projectIds[projectIds.length - 1]!;

      if (projectIds.length < batchSize) {
        break;
      }
    }

    return result;
  }

  /*
   * The earliest row in one table of each of these projects that has one:
   * the batch at once, else each project on its own.
   */
  private static async readFirstRows(data: {
    table: TelemetryMilestoneBackfillTable;
    projectIds: Array<string>;
    readClickhouse: ClickhouseReadFunction;
    now: () => number;
    deadline: number;
    result: TelemetryMilestoneBackfillResult;
  }): Promise<Map<string, number>> {
    const asked: Set<string> = new Set<string>(data.projectIds);
    const firstRows: Map<string, number> = new Map<string, number>();

    try {
      const rows: Array<JSONObject> = await data.readClickhouse(
        TelemetryMilestoneBackfill.getFirstRowsStatement({
          table: data.table,
          projectIds: data.projectIds,
        }),
        BATCH_READ_SETTINGS,
      );

      for (const row of rows) {
        const projectId: string = String(row["projectId"]);
        const firstRowAt: number | null = TelemetryMilestoneBackfill.readTime(
          row["firstRowAt"],
        );

        if (asked.has(projectId) && firstRowAt !== null) {
          firstRows.set(projectId, firstRowAt);
        }
      }

      return firstRows;
    } catch (error) {
      data.result.lastError = describeError(error);

      if (!TelemetryMilestoneBackfill.isReadTooLarge(error)) {
        data.result.failedReads += data.projectIds.length;
        return firstRows;
      }
    }

    // More rows than one statement reads: each project on its own.
    for (let index: number = 0; index < data.projectIds.length; index++) {
      if (data.now() >= data.deadline) {
        data.result.failedReads += data.projectIds.length - index;
        data.result.isStoppedByTimeBudget = true;
        break;
      }

      const projectId: string = data.projectIds[index]!;

      try {
        const rows: Array<JSONObject> = await data.readClickhouse(
          TelemetryMilestoneBackfill.getFirstRowOfProjectStatement({
            table: data.table,
            projectId: projectId,
          }),
          PROJECT_READ_SETTINGS,
        );
        const firstRowAt: number | null = TelemetryMilestoneBackfill.readTime(
          rows[0]?.["firstRowAt"],
        );

        if (firstRowAt !== null) {
          firstRows.set(projectId, firstRowAt);
        }
      } catch (error) {
        data.result.failedReads++;
        data.result.lastError = describeError(error);
      }
    }

    return firstRows;
  }
}
