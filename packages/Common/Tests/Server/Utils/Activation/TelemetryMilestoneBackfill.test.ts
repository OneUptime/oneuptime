import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../Models/AnalyticsModels/Log";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Profile from "../../../../Models/AnalyticsModels/Profile";
import ProfileSample from "../../../../Models/AnalyticsModels/ProfileSample";
import Span from "../../../../Models/AnalyticsModels/Span";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TelemetryMilestoneBackfill, {
  BATCH_READ_SETTINGS,
  KEEP_MARKS_SQL,
  PROJECT_READ_SETTINGS,
  TELEMETRY_MILESTONE_BACKFILL_BATCH_SIZE,
  TELEMETRY_MILESTONE_BACKFILL_TABLES,
  TELEMETRY_MILESTONE_BACKFILL_TIME_BUDGET_IN_MS,
  TelemetryMilestoneBackfillResult,
  TelemetryMilestoneBackfillTable,
} from "../../../../Server/Utils/Activation/TelemetryMilestoneBackfill";
import TelemetryMilestones, {
  TELEMETRY_KIND_OF_TABLE,
} from "../../../../Server/Utils/Activation/TelemetryMilestones";
import ActivationMilestone from "../../../../Types/Analytics/ActivationMilestone";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import type { ClickHouseSettings } from "@clickhouse/client";

/*
 * The first-data marks of telemetry sent before the marks were kept, from
 * ClickHouse (issue #9454), with Postgres and ClickHouse answered by
 * stand-ins: how it walks the projects, what it reads and does not read,
 * how a batch too big for one statement is read, and that nothing it meets
 * - a failed read, a failed write, the end of its time budget, a table the
 * install never had - stops it or throws. The reads run on a real
 * ClickHouse in App's BackfillTelemetryMilestonesFromClickhouseClickhouse
 * suite, and the writes on a real Postgres in ProjectMilestonePostgres.
 */

const PROJECTS_SQL_START: string = `SELECT "_id"::text AS "_id" FROM "Project"`;
const MARKS_SQL_START: string = `SELECT "projectId"::text AS "projectId", "milestone" FROM "ProjectMilestone"`;

const MODELS: Record<string, { new (): AnalyticsBaseModel }> = {
  [AnalyticsTableName.Log]: Log,
  [AnalyticsTableName.Span]: Span,
  [AnalyticsTableName.Metric]: Metric,
  [AnalyticsTableName.ExceptionInstance]: ExceptionInstance,
  [AnalyticsTableName.Profile]: Profile,
  [AnalyticsTableName.ProfileSample]: ProfileSample,
};

// A project's id, as a project's own statement is handed it.
const PROJECT_ID_PATTERN: RegExp = /^[0-9a-f-]{36}$/;

interface PostgresCall {
  sql: string;
  parameters: Array<unknown>;
}

interface ClickhouseRead {
  table: string;
  // The projects a batch's statement asked for, or the one a project's did.
  projectIds: Array<string>;
  isBatch: boolean;
  settings: ClickHouseSettings;
}

const projectIds: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  const ids: Array<string> = [];

  for (let i: number = 0; i < count; i++) {
    ids.push(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  }

  return ids;
};

const at: (day: number) => number = (day: number): number => {
  return Date.UTC(2026, 8, day, 12, 0, 0, 123);
};

// The table a statement reads, from its identifiers.
const tableOf: (statement: Statement) => string = (
  statement: Statement,
): string => {
  const tables: Array<string> = Object.values(statement.query_params).filter(
    (value: unknown): value is string => {
      return (
        typeof value === "string" &&
        Object.values(AnalyticsTableName).includes(value as AnalyticsTableName)
      );
    },
  );

  return tables[0]!;
};

const idsOf: (statement: Statement) => Array<string> = (
  statement: Statement,
): Array<string> => {
  for (const value of Object.values(statement.query_params)) {
    if (Array.isArray(value)) {
      return value as Array<string>;
    }
  }

  const id: unknown = Object.values(statement.query_params).find(
    (value: unknown): boolean => {
      return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
    },
  );

  return id ? [String(id)] : [];
};

interface Run {
  result: TelemetryMilestoneBackfillResult;
  postgres: Array<PostgresCall>;
  reads: Array<ClickhouseRead>;
  // The marks written, by milestone: [projectId, ISO time].
  written: Record<string, Array<[string, string]>>;
}

const runWith: (data: {
  projects: Array<string>;
  batchSize?: number;
  marks?: Array<[string, ActivationMilestone]>;
  // A table's rows: projectId -> time in milliseconds.
  rows?: Partial<Record<AnalyticsTableName, Record<string, number>>>;
  missingTables?: Array<AnalyticsTableName>;
  uncheckedTables?: Array<AnalyticsTableName>;
  failBatch?: (table: string) => unknown;
  failProject?: (table: string, projectId: string) => unknown;
  failWrite?: (milestone: string) => unknown;
  now?: () => number;
  timeBudgetInMs?: number;
}) => Promise<Run> = async (data: {
  projects: Array<string>;
  batchSize?: number;
  marks?: Array<[string, ActivationMilestone]>;
  rows?: Partial<Record<AnalyticsTableName, Record<string, number>>>;
  missingTables?: Array<AnalyticsTableName>;
  uncheckedTables?: Array<AnalyticsTableName>;
  failBatch?: (table: string) => unknown;
  failProject?: (table: string, projectId: string) => unknown;
  failWrite?: (milestone: string) => unknown;
  now?: () => number;
  timeBudgetInMs?: number;
}): Promise<Run> => {
  const postgres: Array<PostgresCall> = [];
  const reads: Array<ClickhouseRead> = [];
  const written: Record<string, Array<[string, string]>> = {};
  const marks: Set<string> = new Set<string>(
    (data.marks || []).map((mark: [string, ActivationMilestone]): string => {
      return `${mark[0]}|${mark[1]}`;
    }),
  );

  const result: TelemetryMilestoneBackfillResult =
    await TelemetryMilestoneBackfill.backfill({
      batchSize: data.batchSize || 2,
      now: data.now,
      timeBudgetInMs: data.timeBudgetInMs,
      tableExists: async (tableName: string): Promise<boolean> => {
        if (
          (data.uncheckedTables || []).includes(tableName as AnalyticsTableName)
        ) {
          throw new Error("connect ECONNREFUSED 127.0.0.1:8123");
        }

        return !(data.missingTables || []).includes(
          tableName as AnalyticsTableName,
        );
      },
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        postgres.push({ sql, parameters });

        if (sql.startsWith(PROJECTS_SQL_START)) {
          const limit: number = parameters[0] as number;
          const after: string | null = parameters[1] as string | null;

          return data.projects
            .filter((id: string): boolean => {
              return after === null || id > after;
            })
            .slice(0, limit)
            .map((id: string) => {
              return { _id: id };
            });
        }

        if (sql.startsWith(MARKS_SQL_START)) {
          const ids: Array<string> = parameters[0] as Array<string>;
          const milestones: Array<string> = parameters[1] as Array<string>;

          return Array.from(marks)
            .map((mark: string) => {
              const [projectId, milestone] = mark.split("|") as [
                string,
                string,
              ];
              return { projectId, milestone };
            })
            .filter((mark: { projectId: string; milestone: string }) => {
              return (
                ids.includes(mark.projectId) &&
                milestones.includes(mark.milestone)
              );
            });
        }

        if (sql === KEEP_MARKS_SQL) {
          const milestone: string = parameters[2] as string;
          const failure: unknown = data.failWrite?.(milestone);

          if (failure) {
            throw failure;
          }

          const ids: Array<string> = parameters[0] as Array<string>;
          const times: Array<string> = parameters[1] as Array<string>;

          written[milestone] = [
            ...(written[milestone] || []),
            ...ids.map((id: string, index: number): [string, string] => {
              return [id, times[index]!];
            }),
          ];

          return ids.map((id: string) => {
            return { _id: id };
          });
        }

        throw new Error(`An unexpected statement: ${sql}`);
      },
      readClickhouse: async (
        statement: Statement,
        settings: ClickHouseSettings,
      ): Promise<Array<JSONObject>> => {
        const table: string = tableOf(statement);
        const ids: Array<string> = idsOf(statement);
        const isBatch: boolean = statement.query.includes("GROUP BY");

        reads.push({ table, projectIds: ids, isBatch, settings });

        const failure: unknown = isBatch
          ? data.failBatch?.(table)
          : data.failProject?.(table, ids[0]!);

        if (failure) {
          throw failure;
        }

        const tableRows: Record<string, number> =
          data.rows?.[table as AnalyticsTableName] || {};

        return ids
          .filter((id: string): boolean => {
            return tableRows[id] !== undefined;
          })
          .map((id: string): JSONObject => {
            // As ClickHouse writes an Int64 in JSON: a string.
            return isBatch
              ? { projectId: id, firstRowAt: String(tableRows[id]) }
              : { firstRowAt: String(tableRows[id]) };
          });
      },
    });

  return { result, postgres, reads, written };
};

describe("TelemetryMilestoneBackfill", () => {
  describe("what it reads", () => {
    test("every table the fan-in writer keeps a mark for, each for that table's mark", () => {
      expect(
        TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
          (table: TelemetryMilestoneBackfillTable): string => {
            return table.tableName;
          },
        ).sort(),
      ).toEqual(Object.keys(TELEMETRY_KIND_OF_TABLE).sort());

      for (const table of TELEMETRY_MILESTONE_BACKFILL_TABLES) {
        expect({
          table: table.tableName,
          milestone: table.milestone,
        }).toEqual({
          table: table.tableName,
          milestone: TelemetryMilestones.getMilestoneOfTable(table.tableName),
        });
      }
    });

    test("each table by the row's own time: the column its days are partitioned by", () => {
      for (const table of TELEMETRY_MILESTONE_BACKFILL_TABLES) {
        const model: AnalyticsBaseModel = new MODELS[table.tableName]!();
        const column: AnalyticsTableColumn | undefined = model.getTableColumn(
          table.timeColumn,
        );

        expect({ table: table.tableName, type: column?.type }).toEqual({
          table: table.tableName,
          type: TableColumnType.DateTime64,
        });
        expect(model.partitionKey).toBe(`toYYYYMMDD(${table.timeColumn})`);
        // projectId first, so a project's rows are found by the index.
        expect(model.sortKeys[0]).toBe("projectId");
      }
    });

    test("a batch's statement asks for its projects' earliest rows by the index, one row a project", () => {
      const statement: Statement =
        TelemetryMilestoneBackfill.getFirstRowsStatement({
          table: TELEMETRY_MILESTONE_BACKFILL_TABLES[1]!,
          projectIds: ["a", "b"],
        });

      expect(statement.query).toBe(
        "SELECT projectId, toUnixTimestamp64Milli(min({p0:Identifier})) AS firstRowAt FROM {p1:Identifier} WHERE projectId IN {p2:Array(String)} GROUP BY projectId",
      );
      expect(statement.query_params).toEqual({
        p0: "startTime",
        p1: AnalyticsTableName.Span,
        p2: ["a", "b"],
      });
    });

    test("a project's own statement reads it in the sort key's order and stops at its first row", () => {
      const statement: Statement =
        TelemetryMilestoneBackfill.getFirstRowOfProjectStatement({
          table: TELEMETRY_MILESTONE_BACKFILL_TABLES[0]!,
          projectId: "10000000-0000-4000-8000-000000000001",
        });

      expect(statement.query).toBe(
        "SELECT toUnixTimestamp64Milli({p0:Identifier}) AS firstRowAt FROM {p1:Identifier} WHERE projectId = {p2:String} ORDER BY {p3:Identifier} ASC LIMIT 1",
      );
      expect(statement.query_params).toEqual({
        p0: "time",
        p1: AnalyticsTableName.Log,
        p2: "10000000-0000-4000-8000-000000000001",
        p3: "time",
      });
    });

    test("every statement is bounded: a batch's by time and by rows, refused before reading, a project's by time", () => {
      expect(BATCH_READ_SETTINGS).toEqual({
        max_execution_time: 30,
        max_rows_to_read: "100000000",
        read_overflow_mode: "throw",
      });
      expect(PROJECT_READ_SETTINGS).toEqual({ max_execution_time: 10 });
      expect(TELEMETRY_MILESTONE_BACKFILL_BATCH_SIZE).toBe(200);
      expect(TELEMETRY_MILESTONE_BACKFILL_TIME_BUDGET_IN_MS).toBe(
        15 * 60 * 1000,
      );
    });
  });

  describe("how it walks", () => {
    test("in primary key order, a batch at a time, until a short batch", async () => {
      const projects: Array<string> = projectIds(5);
      const run: Run = await runWith({ projects, batchSize: 2 });

      expect(
        run.postgres
          .filter((call: PostgresCall): boolean => {
            return call.sql.startsWith(PROJECTS_SQL_START);
          })
          .map((call: PostgresCall): Array<unknown> => {
            return call.parameters;
          }),
      ).toEqual([
        [2, null],
        [2, projects[1]],
        [2, projects[3]],
      ]);
      expect(run.postgres[0]!.sql).toContain(`ORDER BY "_id" ASC LIMIT $1`);
      expect(run.result.projects).toBe(5);
    });

    test("each batch reads every table once, for the batch's projects at once", async () => {
      const projects: Array<string> = projectIds(4);
      const run: Run = await runWith({ projects, batchSize: 2 });

      expect(
        run.reads.map((read: ClickhouseRead) => {
          return `${read.table} ${read.projectIds.join(",")}`;
        }),
      ).toEqual([
        ...TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
          (table: TelemetryMilestoneBackfillTable): string => {
            return `${table.tableName} ${projects.slice(0, 2).join(",")}`;
          },
        ),
        ...TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
          (table: TelemetryMilestoneBackfillTable): string => {
            return `${table.tableName} ${projects.slice(2, 4).join(",")}`;
          },
        ),
      ]);
      expect(
        run.reads.every((read: ClickhouseRead): boolean => {
          return read.isBatch && read.settings === BATCH_READ_SETTINGS;
        }),
      ).toBe(true);
    });

    test("asks Postgres for the batch's telemetry marks only", async () => {
      const projects: Array<string> = projectIds(2);
      const run: Run = await runWith({ projects });

      const marksRead: PostgresCall = run.postgres.find(
        (call: PostgresCall): boolean => {
          return call.sql.startsWith(MARKS_SQL_START);
        },
      )!;

      expect(marksRead.sql).toContain(`"projectId" = ANY($1::uuid[])`);
      expect(marksRead.sql).toContain(`"milestone" = ANY($2::varchar[])`);
      expect(marksRead.parameters).toEqual([
        projects,
        [
          ActivationMilestone.FirstLogsReceived,
          ActivationMilestone.FirstTracesReceived,
          ActivationMilestone.FirstMetricsReceived,
          ActivationMilestone.FirstExceptionsReceived,
          ActivationMilestone.FirstProfilesReceived,
        ],
      ]);
    });
  });

  describe("what a project's marks spare", () => {
    test("a kind a project has is never read for it", async () => {
      const [withLogs, without] = projectIds(2) as [string, string];
      const run: Run = await runWith({
        projects: [withLogs, without],
        marks: [[withLogs, ActivationMilestone.FirstLogsReceived]],
      });

      const logReads: Array<ClickhouseRead> = run.reads.filter(
        (read: ClickhouseRead): boolean => {
          return read.table === AnalyticsTableName.Log;
        },
      );

      expect(logReads).toHaveLength(1);
      expect(logReads[0]!.projectIds).toEqual([without]);
      // Its other kinds are still read.
      expect(
        run.reads
          .filter((read: ClickhouseRead): boolean => {
            return read.table === AnalyticsTableName.Span;
          })
          .flatMap((read: ClickhouseRead): Array<string> => {
            return read.projectIds;
          }),
      ).toEqual([withLogs, without]);
    });

    test("a batch whose projects have every mark reads nothing from ClickHouse and writes nothing", async () => {
      const projects: Array<string> = projectIds(2);
      const everyMark: Array<[string, ActivationMilestone]> = projects.flatMap(
        (projectId: string): Array<[string, ActivationMilestone]> => {
          return TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
            (
              table: TelemetryMilestoneBackfillTable,
            ): [string, ActivationMilestone] => {
              return [projectId, table.milestone];
            },
          );
        },
      );
      const run: Run = await runWith({ projects, marks: everyMark });

      expect(run.reads).toEqual([]);
      expect(run.written).toEqual({});
    });
  });

  describe("what it writes", () => {
    test("a mark for each project with rows, at its earliest row, backfilled, and never over a kept one", async () => {
      const [logs, nothing, spans] = projectIds(3) as [string, string, string];
      const run: Run = await runWith({
        projects: [logs, nothing, spans],
        batchSize: 3,
        rows: {
          [AnalyticsTableName.Log]: { [logs]: at(18) },
          [AnalyticsTableName.Span]: { [spans]: at(20) },
        },
      });

      expect(run.written).toEqual({
        [ActivationMilestone.FirstLogsReceived]: [
          [logs, new Date(at(18)).toISOString()],
        ],
        [ActivationMilestone.FirstTracesReceived]: [
          [spans, new Date(at(20)).toISOString()],
        ],
      });
      expect(run.result.keptByMilestone).toEqual({
        [ActivationMilestone.FirstLogsReceived]: 1,
        [ActivationMilestone.FirstTracesReceived]: 1,
      });

      // Backfilled, never over a mark kept meanwhile, within the project's life.
      expect(KEEP_MARKS_SQL).toContain(
        `ON CONFLICT ("projectId", "milestone") DO NOTHING`,
      );
      expect(KEEP_MARKS_SQL).toContain(
        `$3::varchar, GREATEST(LEAST("reached"."reachedAt", now()), "project"."createdAt"), true, 1`,
      );
      expect(KEEP_MARKS_SQL).toContain(
        `JOIN "Project" AS "project" ON "project"."_id" = "reached"."projectId"`,
      );
      expect(KEEP_MARKS_SQL).toContain(`unnest($1::uuid[], $2::timestamptz[])`);
    });

    test("a profile's mark is the earlier of its two tables' rows", async () => {
      const [project] = projectIds(1) as [string];
      const run: Run = await runWith({
        projects: [project],
        rows: {
          [AnalyticsTableName.Profile]: { [project]: at(22) },
          [AnalyticsTableName.ProfileSample]: { [project]: at(21) },
        },
      });

      expect(run.written).toEqual({
        [ActivationMilestone.FirstProfilesReceived]: [
          [project, new Date(at(21)).toISOString()],
        ],
      });
    });

    test("a row for a project it did not ask for, or a time that is none, writes nothing", async () => {
      const [asked] = projectIds(1) as [string];
      const run: Run = await runWith({
        projects: [asked],
        rows: {
          [AnalyticsTableName.Log]: { [asked]: 0 },
        },
      });

      expect(run.written).toEqual({});

      expect(TelemetryMilestoneBackfill.readTime("1758196530123")).toBe(
        1758196530123,
      );
      expect(TelemetryMilestoneBackfill.readTime(undefined)).toBeNull();
      expect(TelemetryMilestoneBackfill.readTime("soon")).toBeNull();
      expect(TelemetryMilestoneBackfill.readTime("0")).toBeNull();
    });
  });

  describe("a batch too big for one statement", () => {
    test("is read a project at a time, each by its own bounded statement", async () => {
      const [quiet, busy] = projectIds(2) as [string, string];
      const run: Run = await runWith({
        projects: [quiet, busy],
        rows: { [AnalyticsTableName.Log]: { [busy]: at(1) } },
        failBatch: (table: string): unknown => {
          return table === AnalyticsTableName.Log
            ? Object.assign(new Error("Limit for rows exceeded"), {
                code: "158",
              })
            : null;
        },
      });

      expect(
        run.reads
          .filter((read: ClickhouseRead): boolean => {
            return read.table === AnalyticsTableName.Log;
          })
          .map((read: ClickhouseRead) => {
            return {
              ids: read.projectIds,
              isBatch: read.isBatch,
              settings: read.settings,
            };
          }),
      ).toEqual([
        { ids: [quiet, busy], isBatch: true, settings: BATCH_READ_SETTINGS },
        { ids: [quiet], isBatch: false, settings: PROJECT_READ_SETTINGS },
        { ids: [busy], isBatch: false, settings: PROJECT_READ_SETTINGS },
      ]);
      expect(run.written).toEqual({
        [ActivationMilestone.FirstLogsReceived]: [
          [busy, new Date(at(1)).toISOString()],
        ],
      });
      expect(run.result.failedReads).toBe(0);
    });

    test("so is one stopped at its time limit, or out of memory or bytes", async () => {
      for (const failure of [
        new QueryTimeoutException("took longer than 30 seconds"),
        Object.assign(new Error("Timeout exceeded"), { code: "159" }),
        Object.assign(new Error("Estimated time too long"), { code: "160" }),
        Object.assign(new Error("Memory limit exceeded"), { code: "241" }),
        Object.assign(new Error("Too many bytes"), { code: "307" }),
      ]) {
        expect(TelemetryMilestoneBackfill.isReadTooLarge(failure)).toBe(true);
      }

      for (const failure of [
        new Error("connect ECONNREFUSED 127.0.0.1:8123"),
        Object.assign(new Error("Unknown table"), { code: "60" }),
        null,
        undefined,
      ]) {
        expect(TelemetryMilestoneBackfill.isReadTooLarge(failure)).toBe(false);
      }
    });

    test("a project whose own read fails is counted and the others are read", async () => {
      const [failing, fine] = projectIds(2) as [string, string];
      const run: Run = await runWith({
        projects: [failing, fine],
        rows: { [AnalyticsTableName.Log]: { [failing]: at(1), [fine]: at(2) } },
        failBatch: (table: string): unknown => {
          return table === AnalyticsTableName.Log
            ? Object.assign(new Error("too many rows"), { code: "158" })
            : null;
        },
        failProject: (table: string, projectId: string): unknown => {
          return projectId === failing ? new Error("Timeout") : null;
        },
      });

      expect(run.written).toEqual({
        [ActivationMilestone.FirstLogsReceived]: [
          [fine, new Date(at(2)).toISOString()],
        ],
      });
      expect(run.result.failedReads).toBe(1);
      expect(run.result.lastError).toBe("Timeout");
    });
  });

  describe("what never stops it", () => {
    test("any other failed read: the batch's projects are counted, not read one by one, and the walk goes on", async () => {
      const projects: Array<string> = projectIds(3);
      const run: Run = await runWith({
        projects,
        batchSize: 2,
        rows: {
          [AnalyticsTableName.Span]: { [projects[2]!]: at(3) },
        },
        failBatch: (table: string): unknown => {
          return table === AnalyticsTableName.Log
            ? new Error("connect ECONNREFUSED")
            : null;
        },
      });

      expect(
        run.reads.filter((read: ClickhouseRead): boolean => {
          return !read.isBatch;
        }),
      ).toEqual([]);
      // Both batches' logs: 2 projects, then 1.
      expect(run.result.failedReads).toBe(3);
      expect(run.result.lastError).toBe("connect ECONNREFUSED");
      expect(run.written).toEqual({
        [ActivationMilestone.FirstTracesReceived]: [
          [projects[2]!, new Date(at(3)).toISOString()],
        ],
      });
    });

    test("a failed write: its marks are counted, and the next batch is written", async () => {
      const projects: Array<string> = projectIds(2);
      let writes: number = 0;
      const run: Run = await runWith({
        projects,
        batchSize: 1,
        rows: {
          [AnalyticsTableName.Log]: {
            [projects[0]!]: at(1),
            [projects[1]!]: at(2),
          },
        },
        failWrite: (): unknown => {
          writes++;
          return writes === 1
            ? new Error(`violates foreign key constraint "FK_project"`)
            : null;
        },
      });

      expect(run.result.unkeptMarks).toBe(1);
      expect(run.result.lastError).toContain("foreign key");
      expect(run.written).toEqual({
        [ActivationMilestone.FirstLogsReceived]: [
          [projects[1]!, new Date(at(2)).toISOString()],
        ],
      });
    });

    test("its time budget: no batch is started after it, and a batch read a project at a time stops at it", async () => {
      const projects: Array<string> = projectIds(4);
      let clock: number = 0;
      const run: Run = await runWith({
        projects,
        batchSize: 2,
        timeBudgetInMs: 1000,
        now: (): number => {
          return clock;
        },
        failBatch: (table: string): unknown => {
          // The first batch's logs take the whole budget, then are too many.
          if (table === AnalyticsTableName.Log) {
            clock += 1100;
            return Object.assign(new Error("too many rows"), { code: "158" });
          }

          return null;
        },
      });

      // The budget ran out reading the first batch's logs project by project.
      expect(run.result.isStoppedByTimeBudget).toBe(true);
      expect(run.result.projects).toBe(2);
      expect(
        run.postgres.filter((call: PostgresCall): boolean => {
          return call.sql.startsWith(PROJECTS_SQL_START);
        }),
      ).toHaveLength(1);
      expect(
        run.reads.filter((read: ClickhouseRead): boolean => {
          return !read.isBatch;
        }),
      ).toHaveLength(0);
      expect(run.result.failedReads).toBe(2);
    });

    test("with a budget already spent, nothing is read at all", async () => {
      const run: Run = await runWith({
        projects: projectIds(2),
        timeBudgetInMs: 0,
      });

      expect(run.result.isStoppedByTimeBudget).toBe(true);
      expect(run.postgres).toEqual([]);
      expect(run.reads).toEqual([]);
    });

    test("a table the install never had is not read, and the others are", async () => {
      const [project] = projectIds(1) as [string];
      const run: Run = await runWith({
        projects: [project],
        missingTables: [
          AnalyticsTableName.Profile,
          AnalyticsTableName.ProfileSample,
        ],
        rows: { [AnalyticsTableName.Log]: { [project]: at(5) } },
      });

      expect(run.result.missingTables).toEqual([
        AnalyticsTableName.Profile,
        AnalyticsTableName.ProfileSample,
      ]);
      expect(
        run.reads.map((read: ClickhouseRead): string => {
          return read.table;
        }),
      ).toEqual([
        AnalyticsTableName.Log,
        AnalyticsTableName.Span,
        AnalyticsTableName.Metric,
        AnalyticsTableName.ExceptionInstance,
      ]);
      // Profiles' mark is not even asked for.
      expect(
        run.postgres.find((call: PostgresCall): boolean => {
          return call.sql.startsWith(MARKS_SQL_START);
        })!.parameters[1],
      ).not.toContain(ActivationMilestone.FirstProfilesReceived);
      expect(run.written).toEqual({
        [ActivationMilestone.FirstLogsReceived]: [
          [project, new Date(at(5)).toISOString()],
        ],
      });
    });

    test("an install with none of the tables reads nothing, not even its projects", async () => {
      const run: Run = await runWith({
        projects: projectIds(3),
        missingTables: TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
          (table: TelemetryMilestoneBackfillTable): AnalyticsTableName => {
            return table.tableName;
          },
        ),
      });

      expect(run.postgres).toEqual([]);
      expect(run.reads).toEqual([]);
      expect(run.result).toEqual({
        projects: 0,
        keptByMilestone: {},
        missingTables: TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
          (table: TelemetryMilestoneBackfillTable): string => {
            return table.tableName;
          },
        ),
        uncheckedTables: [],
        failedReads: 0,
        unkeptMarks: 0,
        isStoppedByTimeBudget: false,
        lastError: null,
      });
    });

    test("a table ClickHouse cannot say it has is not read, the run says which, and the others are read", async () => {
      const [project] = projectIds(1) as [string];
      const run: Run = await runWith({
        projects: [project],
        uncheckedTables: [AnalyticsTableName.Span],
        rows: {
          [AnalyticsTableName.Log]: { [project]: at(5) },
          [AnalyticsTableName.Span]: { [project]: at(4) },
        },
      });

      expect(run.result.uncheckedTables).toEqual([AnalyticsTableName.Span]);
      expect(run.result.missingTables).toEqual([]);
      expect(run.result.lastError).toBe("connect ECONNREFUSED 127.0.0.1:8123");
      expect(
        run.reads.map((read: ClickhouseRead): string => {
          return read.table;
        }),
      ).not.toContain(AnalyticsTableName.Span);
      expect(run.written).toEqual({
        [ActivationMilestone.FirstLogsReceived]: [
          [project, new Date(at(5)).toISOString()],
        ],
      });
    });
  });

  test("a failed read of the projects themselves is the runner's to see", async () => {
    await expect(
      TelemetryMilestoneBackfill.backfill({
        tableExists: async (): Promise<boolean> => {
          return true;
        },
        query: async (): Promise<unknown> => {
          throw new Error("Connection terminated");
        },
        readClickhouse: async (): Promise<Array<JSONObject>> => {
          return [];
        },
      }),
    ).rejects.toThrow("Connection terminated");
  });
});
