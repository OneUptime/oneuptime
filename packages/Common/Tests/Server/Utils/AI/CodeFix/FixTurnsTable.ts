import AIRunService from "../../../../../Server/Services/AIRunService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunCodeFixRecommendation from "../../../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { jest } from "@jest/globals";

/*
 * THE AI RUNS OF A PROJECT'S FIXES, IN MEMORY, BEHIND EVERY WAY A "FIX ON
 * ITS WAY" CHECK HAS READ THEM (#9882).
 *
 * A Code task is its first turn and every run whose codeTaskId is its id.
 * A fix's first turn carries what it is a fix of (its record, its recipe);
 * a fix asked again carries the same; a reply someone sent in Code carries
 * neither. The rows here are such turns, and they answer:
 *
 *   - AIRunService.findOneBy and findBy, as each check queried the runs on
 *     its own before #9882: plain equality, Includes, and the QueryHelper
 *     operators they used (notIn, any, equalToOrNull, isNull, notNull,
 *     jsonContains), each read off its own SQL;
 *   - the statements of the rule every check asks since
 *     (CodeFixOnItsWay.getTurnStatement and getExceptionIdsStatement),
 *     through AIRunService.getRepository().manager.query - worked out here
 *     from the rows: a turn that is queued or running, of a task whose turn
 *     or whose first turn is a fix of the problem the statement names. The
 *     statement is read for the column, the context or the profile's
 *     function it matches, and its recipes; a statement this table does not
 *     know fails the test.
 *
 * So a test written against the rows holds whichever code reads them: it
 * fails where a check never sees a reply, and passes where it does. The
 * opt-in Postgres suite (CodeFixOnItsWayPostgres) runs the same statements
 * on a real table.
 */

export interface FixTurnRow {
  _id: string;
  projectId: string;
  runType: AIRunType;
  codeFixTaskType: CodeFixTaskType | null;
  status: AIRunStatus;
  codeTaskId: string | null;
  userId: string | null;
  triggeredByTelemetryExceptionId: string | null;
  triggeredByIncidentId: string | null;
  triggeredByAlertId: string | null;
  triggeredByAiInsightId: string | null;
  taskContext: JSONObject | null;
  // An investigation's: what it recommends, and when it ended.
  codeFixRecommendation: AIRunCodeFixRecommendation | null;
  completedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

// What a fix's first turn carries: its recipe and its record.
export interface FixTurnFacts {
  codeFixTaskType: CodeFixTaskType | null;
  status: AIRunStatus;
  userId?: ObjectID | undefined;
  telemetryExceptionId?: ObjectID | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  aiInsightId?: ObjectID | undefined;
  taskContext?: JSONObject | undefined;
}

type QueryRows = Array<Record<string, unknown>>;

interface Operator {
  getSql?: (alias: string) => string;
  objectLiteralParameters?: Record<string, unknown>;
}

function isOperator(value: unknown): value is Operator {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Operator).getSql === "function"
  );
}

function key(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

// Every value an operator binds, its arrays spread.
function boundValues(operator: Operator): Array<string> {
  return Object.values(operator.objectLiteralParameters || {}).flatMap(
    (value: unknown): Array<string> => {
      return (Array.isArray(value) ? value : [value]).map(key);
    },
  );
}

// Whether `container` holds every key of `contained` with an equal value.
function jsonContains(container: unknown, contained: unknown): boolean {
  if (
    contained === null ||
    typeof contained !== "object" ||
    Array.isArray(contained)
  ) {
    return container === contained;
  }

  if (!container || typeof container !== "object" || Array.isArray(container)) {
    return false;
  }

  return Object.entries(contained as JSONObject).every(
    ([name, value]: [string, unknown]): boolean => {
      return jsonContains((container as JSONObject)[name], value);
    },
  );
}

// A row's value against what a query asks of its column.
function matchesFilter(value: unknown, filter: unknown): boolean {
  if (filter instanceof Includes) {
    return (filter.values as Array<unknown>).map(key).includes(key(value));
  }

  if (!isOperator(filter)) {
    return key(value) === key(filter);
  }

  const sql: string = filter.getSql!("column");

  if (sql.includes("TRUE = TRUE")) {
    return true;
  }

  if (sql.includes("TRUE = FALSE")) {
    return false;
  }

  if (sql.includes("@>")) {
    const raw: unknown = Object.values(filter.objectLiteralParameters || {})[0];

    return jsonContains(value, JSON.parse(String(raw)));
  }

  if (sql.includes(" NOT IN (")) {
    return (
      value !== null &&
      value !== undefined &&
      !boundValues(filter).includes(key(value))
    );
  }

  if (sql.includes(" IN (")) {
    return (
      value !== null &&
      value !== undefined &&
      boundValues(filter).includes(key(value))
    );
  }

  if (sql.includes(" or column IS NULL")) {
    return (
      value === null ||
      value === undefined ||
      boundValues(filter).includes(key(value))
    );
  }

  if (sql.includes("IS NOT NULL")) {
    return value !== null && value !== undefined;
  }

  if (sql.includes("IS NULL")) {
    return value === null || value === undefined;
  }

  throw new Error(`The fix turns table does not know the operator ${sql}.`);
}

// A row as a service returns it: ids as ObjectIDs, the rest as stored.
function toRun(row: FixTurnRow): AIRun {
  const run: AIRun = new AIRun();
  run.id = new ObjectID(row._id);
  run.projectId = new ObjectID(row.projectId);
  run.runType = row.runType;
  run.status = row.status;
  run.createdAt = row.createdAt;

  if (row.codeFixTaskType) {
    run.codeFixTaskType = row.codeFixTaskType;
  }

  if (row.codeFixRecommendation) {
    run.codeFixRecommendation = row.codeFixRecommendation;
  }

  if (row.completedAt) {
    run.completedAt = row.completedAt;
  }

  for (const column of [
    "codeTaskId",
    "userId",
    "triggeredByTelemetryExceptionId",
    "triggeredByIncidentId",
    "triggeredByAlertId",
    "triggeredByAiInsightId",
  ] as const) {
    const id: string | null = row[column];

    if (id) {
      run[column] = new ObjectID(id);
    }
  }

  if (row.taskContext) {
    run.taskContext = JSON.parse(JSON.stringify(row.taskContext)) as never;
  }

  return run;
}

/*
 * What a statement of the rule asks a run to be a fix of, read off the
 * statement: its recipes, and the column, the context or the profile's
 * function its record is in.
 */
interface StatementProblem {
  recipes: Array<string>;
  includesNullRecipe: boolean;
  matchesRecord: (row: FixTurnRow) => boolean;
}

function parameterAt(parameters: Array<unknown>, placeholder: string): unknown {
  return parameters[Number(placeholder) - 1];
}

function readStatementProblem(
  sql: string,
  parameters: Array<unknown>,
): StatementProblem {
  const recipeMatch: RegExpMatchArray | null = sql.match(
    /"turn"\."codeFixTaskType" = ANY\(\$(\d+)::text\[\]\)/,
  );

  if (!recipeMatch) {
    throw new Error("The rule's statement names no recipes.");
  }

  const recipes: Array<string> = (
    parameterAt(parameters, recipeMatch[1]!) as Array<string>
  ).map(String);
  const includesNullRecipe: boolean = sql.includes(
    `"turn"."codeFixTaskType" IS NULL`,
  );

  const columnMatch: RegExpMatchArray | null = sql.match(
    /"turn"\."(triggeredBy\w+)" = \$(\d+)::uuid/,
  );

  if (columnMatch) {
    const column: keyof FixTurnRow = columnMatch[1] as keyof FixTurnRow;
    const recordId: string = key(parameterAt(parameters, columnMatch[2]!));

    return {
      recipes,
      includesNullRecipe,
      matchesRecord: (row: FixTurnRow): boolean => {
        return Boolean(row[column]) && key(row[column]) === recordId;
      },
    };
  }

  if (sql.includes(`"turn"."triggeredByTelemetryExceptionId" IS NOT NULL`)) {
    return {
      recipes,
      includesNullRecipe,
      matchesRecord: (row: FixTurnRow): boolean => {
        return Boolean(row.triggeredByTelemetryExceptionId);
      },
    };
  }

  const contextMatch: RegExpMatchArray | null = sql.match(
    /"turn"\."taskContext" @> \$(\d+)::jsonb/,
  );

  if (contextMatch) {
    const contained: unknown = JSON.parse(
      String(parameterAt(parameters, contextMatch[1]!)),
    );

    return {
      recipes,
      includesNullRecipe,
      matchesRecord: (row: FixTurnRow): boolean => {
        return jsonContains(row.taskContext, contained);
      },
    };
  }

  const profile: Array<RegExpMatchArray | null> = [
    sql.match(/"item" ->> 'type' = \$(\d+)/),
    sql.match(/lower\(COALESCE\("item" ->> 'serviceId', ''\)\) = \$(\d+)/),
    sql.match(/"item" ->> 'functionName' = \$(\d+)/),
    sql.match(/COALESCE\("item" ->> 'fileName', ''\) = \$(\d+)/),
  ];

  if (
    profile.every((match: RegExpMatchArray | null): boolean => {
      return Boolean(match);
    })
  ) {
    const [type, serviceId, functionName, fileName] = profile.map(
      (match: RegExpMatchArray | null): string => {
        return String(parameterAt(parameters, match![1]!));
      },
    ) as [string, string, string, string];

    return {
      recipes,
      includesNullRecipe,
      matchesRecord: (row: FixTurnRow): boolean => {
        const request: unknown = row.taskContext?.["request"];
        const context: unknown =
          request && typeof request === "object"
            ? (request as JSONObject)["context"]
            : undefined;

        return (
          Array.isArray(context) &&
          context.some((item: unknown): boolean => {
            const entry: JSONObject = (item || {}) as JSONObject;

            return (
              entry["type"] === type &&
              String(entry["serviceId"] || "").toLowerCase() === serviceId &&
              entry["functionName"] === functionName &&
              String(entry["fileName"] || "") === fileName
            );
          })
        );
      },
    };
  }

  throw new Error("The fix turns table does not know this rule's record.");
}

export default class FixTurnsTable {
  public readonly projectId: ObjectID;
  public rows: Array<FixTurnRow> = [];
  // Every statement of the rule the table answered.
  public statements: Array<{ sql: string; parameters: Array<unknown> }> = [];
  private clock: number = Date.parse("2026-11-19T08:00:00.000Z");

  public constructor(projectId: ObjectID) {
    this.projectId = projectId;
  }

  // A fix's first turn: a task of its own.
  public addFirstTurn(facts: FixTurnFacts): FixTurnRow {
    return this.add({
      codeFixTaskType: facts.codeFixTaskType,
      status: facts.status,
      codeTaskId: null,
      userId: facts.userId?.toString() || null,
      triggeredByTelemetryExceptionId:
        facts.telemetryExceptionId?.toString() || null,
      triggeredByIncidentId: facts.incidentId?.toString() || null,
      triggeredByAlertId: facts.alertId?.toString() || null,
      triggeredByAiInsightId: facts.aiInsightId?.toString() || null,
      taskContext: facts.taskContext || null,
      codeFixRecommendation: null,
      completedAt: null,
    });
  }

  /*
   * A reply someone sent in Code (CodeTaskRuns.reply): a request of its
   * own words, naming its task - and nothing it is a fix of.
   */
  public addReply(
    task: FixTurnRow,
    status: AIRunStatus,
    context: Array<JSONObject> = [],
  ): FixTurnRow {
    return this.add({
      codeFixTaskType: CodeFixTaskType.CodeRequest,
      status,
      codeTaskId: task._id,
      userId: ObjectID.generate().toString(),
      triggeredByTelemetryExceptionId: null,
      triggeredByIncidentId: null,
      triggeredByAlertId: null,
      triggeredByAiInsightId: null,
      taskContext: {
        request: { message: "Try the connection pool instead.", context },
      } as JSONObject,
      codeFixRecommendation: null,
      completedAt: null,
    });
  }

  // The fix asked again (CodeTaskFixRetry.newTurn): what its turn carried.
  public addAskedAgain(task: FixTurnRow, status: AIRunStatus): FixTurnRow {
    return this.add({
      codeFixTaskType: task.codeFixTaskType,
      status,
      codeTaskId: task._id,
      userId: ObjectID.generate().toString(),
      triggeredByTelemetryExceptionId: task.triggeredByTelemetryExceptionId,
      triggeredByIncidentId: task.triggeredByIncidentId,
      triggeredByAlertId: task.triggeredByAlertId,
      triggeredByAiInsightId: task.triggeredByAiInsightId,
      taskContext: task.taskContext
        ? (JSON.parse(JSON.stringify(task.taskContext)) as JSONObject)
        : null,
      codeFixRecommendation: null,
      completedAt: null,
    });
  }

  /*
   * An incident's or alert's investigation that ended recommending a change
   * in the code, with the analysis its fix is frozen from.
   */
  public addRecommendingInvestigation(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    analysisMarkdown: string;
    completedAt: Date;
  }): FixTurnRow {
    const row: FixTurnRow = this.add({
      codeFixTaskType: null,
      status: AIRunStatus.Completed,
      codeTaskId: null,
      userId: null,
      triggeredByTelemetryExceptionId: null,
      triggeredByIncidentId: data.incidentId?.toString() || null,
      triggeredByAlertId: data.alertId?.toString() || null,
      triggeredByAiInsightId: null,
      taskContext: null,
      codeFixRecommendation: AIRunCodeFixRecommendation.Recommended,
      completedAt: data.completedAt,
    });

    row.runType = AIRunType.Investigation;
    row.taskContext = {
      sourceInvestigationRunId: row._id,
      sourceInvestigationAnalysisMarkdown: data.analysisMarkdown,
    };

    return row;
  }

  // Answers the services' reads and the rule's statements from the rows.
  public install(): void {
    jest.spyOn(AIRunService, "findOneBy").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }): Promise<AIRun | null> => {
      return this.find(data.query)[0] || null;
    }) as never);

    jest.spyOn(AIRunService, "findOneById").mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<AIRun | null> => {
      return this.find({ _id: data.id.toString() })[0] || null;
    }) as never);

    jest.spyOn(AIRunService, "findBy").mockImplementation((async (data: {
      query: Record<string, unknown>;
      limit?: number;
    }): Promise<Array<AIRun>> => {
      return this.find(data.query).slice(0, data.limit || undefined);
    }) as never);

    jest.spyOn(AIRunService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<QueryRows> => {
          return this.query(sql, parameters);
        },
      },
    } as never);
  }

  // The rows a service query matches, newest first, as runs.
  public find(query: Record<string, unknown>): Array<AIRun> {
    return this.rows
      .filter((row: FixTurnRow): boolean => {
        return (
          !row.deletedAt &&
          Object.keys(query).every((column: string): boolean => {
            return matchesFilter(
              (row as unknown as Record<string, unknown>)[column],
              query[column],
            );
          })
        );
      })
      .sort(FixTurnsTable.newestFirst)
      .map(toRun);
  }

  /*
   * A statement of the rule, worked out from the rows: the turns queued or
   * running of the project's code tasks, each beside its task's first turn,
   * that are - or whose first turn is - a fix of what it names.
   */
  public query(sql: string, parameters: Array<unknown>): QueryRows {
    this.statements.push({ sql, parameters });

    const projectId: string = key(parameters[0]);
    const runType: string = String(parameters[1]);
    const endStatuses: Array<string> = (parameters[2] as Array<string>).map(
      String,
    );
    const problem: StatementProblem = readStatementProblem(sql, parameters);

    const isFixOf: (row: FixTurnRow | undefined) => boolean = (
      row: FixTurnRow | undefined,
    ): boolean => {
      if (!row) {
        return false;
      }

      const isOfRecipe: boolean = row.codeFixTaskType
        ? problem.recipes.includes(row.codeFixTaskType)
        : problem.includesNullRecipe;

      return isOfRecipe && problem.matchesRecord(row);
    };

    const taskOf: (turn: FixTurnRow) => FixTurnRow | undefined = (
      turn: FixTurnRow,
    ): FixTurnRow | undefined => {
      return turn.codeTaskId
        ? this.rows.find((row: FixTurnRow): boolean => {
            return (
              key(row._id) === key(turn.codeTaskId) &&
              key(row.projectId) === projectId &&
              row.runType === runType &&
              !row.codeTaskId &&
              !row.deletedAt
            );
          })
        : undefined;
    };

    const onItsWay: Array<FixTurnRow> = this.rows
      .filter((turn: FixTurnRow): boolean => {
        return (
          key(turn.projectId) === projectId &&
          turn.runType === runType &&
          !turn.deletedAt &&
          !endStatuses.includes(turn.status) &&
          (isFixOf(turn) || isFixOf(taskOf(turn)))
        );
      })
      .sort(FixTurnsTable.newestFirst);

    if (sql.includes(`AS "telemetryExceptionId"`)) {
      const exceptionIds: Set<string> = new Set<string>();

      for (const turn of onItsWay) {
        const fix: FixTurnRow | undefined = isFixOf(turn) ? turn : taskOf(turn);

        if (fix?.triggeredByTelemetryExceptionId) {
          exceptionIds.add(fix.triggeredByTelemetryExceptionId);
        }
      }

      return Array.from(exceptionIds).map(
        (telemetryExceptionId: string): Record<string, unknown> => {
          return { telemetryExceptionId };
        },
      );
    }

    if (!sql.includes(`AS "turnId"`)) {
      throw new Error("The fix turns table does not know this statement.");
    }

    return onItsWay
      .slice(0, 1)
      .map((turn: FixTurnRow): Record<string, unknown> => {
        return {
          turnId: turn._id,
          codeTaskId: turn.codeTaskId,
          userId: turn.userId,
          status: turn.status,
        };
      });
  }

  private add(
    values: Omit<
      FixTurnRow,
      "_id" | "projectId" | "runType" | "createdAt" | "deletedAt"
    >,
  ): FixTurnRow {
    this.clock += 60 * 1000;

    const row: FixTurnRow = {
      ...values,
      _id: ObjectID.generate().toString(),
      projectId: this.projectId.toString(),
      runType: AIRunType.CodeFix,
      createdAt: new Date(this.clock),
      deletedAt: null,
    };

    this.rows.push(row);

    return row;
  }

  private static newestFirst(a: FixTurnRow, b: FixTurnRow): number {
    return b.createdAt.getTime() - a.createdAt.getTime();
  }
}
