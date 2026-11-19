import AIRunService from "../../../Services/AIRunService";
import CreateLimit from "../../../Types/Database/CreateLimit";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { CodeTaskListStatement } from "../CodeTask/CodeTaskListQuery";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import { CodeTaskContextType } from "../../../../Types/AI/CodeTask";
import { CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE } from "../../../../Types/AI/CodeTaskTryAgain";
import { getTelemetryAiFixTaskTypes } from "../../../../Types/AI/TelemetryAi";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * ONE FIX AT A TIME OF THE SAME PROBLEM (#9882).
 *
 * A fix OneUptime starts - Fix with AI on an exception, an investigation's
 * fix pull request for an incident or alert, a trace's performance fix, a
 * service's logging or tracing, an AI insight's fix, a profile's slow
 * function - is a Code task. Its first turn carries what it is a fix of:
 * the record (triggeredByTelemetryExceptionId, triggeredByIncidentId,
 * triggeredByAlertId, triggeredByAiInsightId, the trace or the service in
 * its taskContext) and the recipe. Its later turns are either the fix asked
 * again (Try again, CodeTaskFixRetry), which carries the same, or a reply
 * someone sent in Code (CodeTaskRuns.reply), which carries none of it: it
 * only names its task (codeTaskId). The task is on its way while any of its
 * turns is queued or running - a task takes one turn at a time.
 *
 * Every check that refuses a second fix of the same problem, or skips
 * starting one, asks this one rule: a turn that is queued or running, of a
 * task that is a fix of the problem - the turn carries the problem itself,
 * or its task's first turn does. So a reply working in Code holds the
 * problem as the first turn did. One statement, worked out by Postgres,
 * with no limit on how many tasks the problem had.
 *
 * And it is decided with the INSERT: every fix's run is held to it as it
 * is written (getCreateLimit, which AIRunService hands DatabaseService), in
 * the transaction that writes it, under the project's lock
 * (ProjectLimitLock). Two fixes of the same problem asked at the same
 * moment - two clicks, a click and Try again, OneUptime's own lane and a
 * person - cannot both pass: the second is decided once the first's run is
 * written, and sees it. A reply is never refused here: it is a person
 * continuing their own task.
 */

// What a fix is of: the problem one fix at a time is held to.
export enum CodeFixProblemKind {
  Exception = "Exception",
  Incident = "Incident",
  Alert = "Alert",
  Insight = "Insight",
  Trace = "Trace",
  Service = "Service",
  ProfileFunction = "ProfileFunction",
}

// A function of a service's profile, as a Code request's context names it.
export interface CodeFixProfileFunction {
  serviceId: string;
  functionName: string;
  // "" for a frame without one.
  fileName: string;
}

export interface CodeFixProblem {
  projectId: ObjectID;
  kind: CodeFixProblemKind;
  /*
   * The record a fix of it carries: the exception's, the incident's, the
   * alert's or the insight's id; the trace's id, or the service's id, as
   * its fix's context names it. Unused for a profile's function.
   */
  recordId: string;
  // The recipes a fix of it is. A null recipe is an exception fix.
  taskTypes: Array<CodeFixTaskType>;
  // A profile's function (CodeFixProblemKind.ProfileFunction).
  profileFunction?: CodeFixProfileFunction | undefined;
}

// What a fix's run carries that says what it is a fix of.
export interface CodeFixRunFacts {
  projectId?: ObjectID | undefined;
  runType?: AIRunType | undefined;
  codeFixTaskType?: CodeFixTaskType | undefined;
  triggeredByTelemetryExceptionId?: ObjectID | undefined;
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByAiInsightId?: ObjectID | undefined;
  taskContext?: CodeFixTaskContext | undefined;
}

// The name of the lock every fix's INSERT takes in its project.
export const CODE_FIX_ON_ITS_WAY_LIMIT_NAME: string = "code-fix-on-its-way";

type QueryRows = Array<Record<string, unknown>>;

export default class CodeFixOnItsWay {
  /*
   * A turn's task's first turn, beside it: none for a first turn. Pinned as
   * the turn is - the project, code-fix runs, never a deleted row - and to
   * a first turn, as a later turn's codeTaskId always names one.
   */
  private static readonly TASK_JOIN: string = `LEFT JOIN "AIRun" AS "task" ON "task"."_id" = "turn"."codeTaskId"
  AND "task"."projectId" = $1 AND "task"."runType" = $2
  AND "task"."codeTaskId" IS NULL AND "task"."deletedAt" IS NULL`;

  // A turn of the project's code tasks, queued or running.
  private static readonly TURN_ON_ITS_WAY: string = `"turn"."projectId" = $1 AND "turn"."runType" = $2
  AND "turn"."deletedAt" IS NULL AND "turn"."status" <> ALL($3::text[])`;

  // An exception's fix, of these recipes.
  public static ofException(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
    taskTypes: Array<CodeFixTaskType>;
  }): CodeFixProblem {
    return {
      projectId: data.projectId,
      kind: CodeFixProblemKind.Exception,
      recordId: data.telemetryExceptionId.toString(),
      taskTypes: data.taskTypes,
    };
  }

  /*
   * An incident's or an alert's fix of the recipe: an investigation's fix
   * pull request, or the instrumentation one asked for. Exactly one of the
   * two.
   */
  public static ofSubject(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): CodeFixProblem {
    if (Boolean(data.incidentId) === Boolean(data.alertId)) {
      throw new BadDataException(
        "Exactly one incident or alert subject is required to find an existing fix task.",
      );
    }

    return {
      projectId: data.projectId,
      kind: data.incidentId
        ? CodeFixProblemKind.Incident
        : CodeFixProblemKind.Alert,
      recordId: (data.incidentId || data.alertId)!.toString(),
      taskTypes: [data.taskType],
    };
  }

  /*
   * An AI insight's fix: a Code task about it, of any lane's recipe - a
   * request in Code, or an exception's own AI task.
   */
  public static ofInsight(data: {
    projectId: ObjectID;
    insightId: ObjectID;
  }): CodeFixProblem {
    return {
      projectId: data.projectId,
      kind: CodeFixProblemKind.Insight,
      recordId: data.insightId.toString(),
      taskTypes: getTelemetryAiFixTaskTypes(),
    };
  }

  // A trace's performance fix.
  public static ofTrace(data: {
    projectId: ObjectID;
    traceId: string;
  }): CodeFixProblem {
    return {
      projectId: data.projectId,
      kind: CodeFixProblemKind.Trace,
      recordId: data.traceId,
      taskTypes: [CodeFixTaskType.FixPerformance],
    };
  }

  // A service's logging or tracing, by the recipe.
  public static ofService(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    telemetryServiceId: string;
  }): CodeFixProblem {
    return {
      projectId: data.projectId,
      kind: CodeFixProblemKind.Service,
      recordId: data.telemetryServiceId,
      taskTypes: [data.taskType],
    };
  }

  /*
   * A slow function of a service's profile: a request in Code whose context
   * names the function (ProfileFixTaskTrigger) - the service by its id in
   * any case, the file as written ("" for none).
   */
  public static ofProfileFunction(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    functionName: string;
    fileName: string;
  }): CodeFixProblem {
    return {
      projectId: data.projectId,
      kind: CodeFixProblemKind.ProfileFunction,
      recordId: data.serviceId.toString().toLowerCase(),
      taskTypes: [CodeFixTaskType.CodeRequest],
      profileFunction: {
        serviceId: data.serviceId.toString().toLowerCase(),
        functionName: data.functionName,
        fileName: data.fileName || "",
      },
    };
  }

  /*
   * The problems a fix's run is a fix of, read off what it carries: its
   * record and its recipe. A task's first turn and a fix asked again carry
   * them; a reply, a request typed in Code, a GitHub task and a production
   * review carry none, and are held to nothing here. A fix of an exception
   * OneUptime opened for an insight is a fix of both.
   */
  public static problemsOf(run: CodeFixRunFacts): Array<CodeFixProblem> {
    if (!run.projectId || run.runType !== AIRunType.CodeFix) {
      return [];
    }

    const projectId: ObjectID = run.projectId;
    const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      run.codeFixTaskType,
    );
    const contextKind: CodeFixContextKind =
      CodeFixTaskTypeHelper.getContextKind(taskType);
    const problems: Array<CodeFixProblem> = [];

    if (
      contextKind === CodeFixContextKind.TelemetryException &&
      run.triggeredByTelemetryExceptionId
    ) {
      problems.push(
        CodeFixOnItsWay.ofException({
          projectId,
          telemetryExceptionId: run.triggeredByTelemetryExceptionId,
          taskTypes: [taskType],
        }),
      );
    }

    if (
      contextKind === CodeFixContextKind.IncidentOrAlertSubject &&
      Boolean(run.triggeredByIncidentId) !== Boolean(run.triggeredByAlertId)
    ) {
      problems.push(
        CodeFixOnItsWay.ofSubject({
          projectId,
          taskType,
          incidentId: run.triggeredByIncidentId || undefined,
          alertId: run.triggeredByAlertId || undefined,
        }),
      );
    }

    if (
      run.triggeredByAiInsightId &&
      getTelemetryAiFixTaskTypes().includes(taskType)
    ) {
      problems.push(
        CodeFixOnItsWay.ofInsight({
          projectId,
          insightId: run.triggeredByAiInsightId,
        }),
      );
    }

    const traceId: unknown = run.taskContext?.traceId;

    if (
      taskType === CodeFixTaskType.FixPerformance &&
      typeof traceId === "string" &&
      traceId
    ) {
      problems.push(CodeFixOnItsWay.ofTrace({ projectId, traceId }));
    }

    const telemetryServiceId: unknown = run.taskContext?.telemetryServiceId;

    if (
      (taskType === CodeFixTaskType.ImproveLogging ||
        taskType === CodeFixTaskType.ImproveTracing) &&
      typeof telemetryServiceId === "string" &&
      telemetryServiceId
    ) {
      problems.push(
        CodeFixOnItsWay.ofService({
          projectId,
          taskType,
          telemetryServiceId,
        }),
      );
    }

    return problems;
  }

  /*
   * The newest turn queued or running of a fix of the problem - the turn
   * itself carries the problem, or its task's first turn does, a reply in
   * Code included - or null. Read with its id, its task (codeTaskId, for a
   * later turn), who asked it and how it stands. Through `manager` when the
   * check is part of a transaction (getCreateLimit).
   */
  @CaptureSpan()
  public static async findTurn(
    problem: CodeFixProblem,
    manager?: EntityManager | undefined,
  ): Promise<AIRun | null> {
    const statement: CodeTaskListStatement =
      CodeFixOnItsWay.getTurnStatement(problem);

    const rows: QueryRows = (await (
      manager || AIRunService.getRepository().manager
    ).query(statement.sql, statement.parameters)) as QueryRows;

    return CodeFixOnItsWay.toTurn(rows[0]);
  }

  // The task of the fix of the problem on its way: its first turn's id.
  @CaptureSpan()
  public static async findTaskId(
    problem: CodeFixProblem,
  ): Promise<string | null> {
    return (
      CodeFixOnItsWay.taskIdOf(await CodeFixOnItsWay.findTurn(problem)) || null
    );
  }

  // A turn's task: its own id for a first turn, its task's for a later one.
  public static taskIdOf(
    turn: Pick<AIRun, "id" | "codeTaskId"> | null | undefined,
  ): string | null {
    if (!turn) {
      return null;
    }

    return (turn.codeTaskId || turn.id)?.toString() || null;
  }

  /*
   * The exceptions with a fix of one of the recipes on its way, its reply in
   * Code included: what the guard against fixing one root cause twice, across
   * exceptions whose messages differ only in their values, compares with
   * (TelemetryExceptionService). At most `limit`.
   */
  @CaptureSpan()
  public static async findExceptionIds(data: {
    projectId: ObjectID;
    taskTypes: Array<CodeFixTaskType>;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const statement: CodeTaskListStatement =
      CodeFixOnItsWay.getExceptionIdsStatement(data);

    const rows: QueryRows = (await AIRunService.getRepository().manager.query(
      statement.sql,
      statement.parameters,
    )) as QueryRows;

    const ids: Array<ObjectID> = [];

    for (const row of rows) {
      const id: unknown = row["telemetryExceptionId"];

      if (typeof id === "string" && id) {
        ids.push(new ObjectID(id));
      }
    }

    return ids;
  }

  /*
   * The newest turn queued or running ("turnId", its task "codeTaskId", who
   * asked it "userId", how it stands "status") of a task that is a fix of
   * the problem: the turn is one itself - a first turn, or a fix asked
   * again - or its task's first turn is, as for a reply someone sent in
   * Code. As root, pinned to the project and to code-fix runs, never a
   * deleted row. Every value is a bound parameter.
   */
  public static getTurnStatement(
    problem: CodeFixProblem,
  ): CodeTaskListStatement {
    const parameters: Array<unknown> = CodeFixOnItsWay.getParameters(
      problem.projectId,
    );
    const isFixOf: (alias: string) => string = CodeFixOnItsWay.getIsFixOfSql(
      problem,
      parameters,
    );

    return {
      sql: `SELECT "turn"."_id" AS "turnId", "turn"."codeTaskId" AS "codeTaskId",
  "turn"."userId" AS "userId", "turn"."status" AS "status"
FROM "AIRun" AS "turn"
${CodeFixOnItsWay.TASK_JOIN}
WHERE ${CodeFixOnItsWay.TURN_ON_ITS_WAY}
  AND (${isFixOf("turn")} OR ${isFixOf("task")})
ORDER BY "turn"."createdAt" DESC, "turn"."_id" ASC
LIMIT 1`,
      parameters,
    };
  }

  /*
   * Each exception with a fix of the recipes on its way
   * ("telemetryExceptionId"): the exception of the turn queued or running
   * when the turn is a fix of it, else its task's first turn's.
   */
  public static getExceptionIdsStatement(data: {
    projectId: ObjectID;
    taskTypes: Array<CodeFixTaskType>;
    limit: number;
  }): CodeTaskListStatement {
    const parameters: Array<unknown> = CodeFixOnItsWay.getParameters(
      data.projectId,
    );
    const recipes: string = CodeFixOnItsWay.bindRecipes(
      data.taskTypes,
      parameters,
    );
    const isFixOf: (alias: string) => string = (alias: string): string => {
      return `("${alias}"."triggeredByTelemetryExceptionId" IS NOT NULL AND ${CodeFixOnItsWay.getRecipeSql(
        { alias, taskTypes: data.taskTypes, recipes },
      )})`;
    };
    const turnIsFix: string = isFixOf("turn");
    const taskIsFix: string = isFixOf("task");
    const limit: string = `$${parameters.push(Math.max(1, Math.floor(data.limit)))}`;

    return {
      sql: `SELECT DISTINCT CASE WHEN ${turnIsFix}
    THEN "turn"."triggeredByTelemetryExceptionId"
    ELSE "task"."triggeredByTelemetryExceptionId" END AS "telemetryExceptionId"
FROM "AIRun" AS "turn"
${CodeFixOnItsWay.TASK_JOIN}
WHERE ${CodeFixOnItsWay.TURN_ON_ITS_WAY}
  AND (${turnIsFix} OR ${taskIsFix})
LIMIT ${limit}`,
      parameters,
    };
  }

  /*
   * What a fix's run is held to as it is written (AIRunService's
   * getCreateLimit): no fix of any problem it is a fix of may be on its way.
   * Decided in the transaction that writes it, under the project's lock, so
   * of two asked at once the second sees the first. Null for a run that is a
   * fix of nothing (a reply, a request, a GitHub task, a review, a chat or
   * an investigation).
   */
  public static getCreateLimit(run: AIRun): CreateLimit | null {
    const problems: Array<CodeFixProblem> = CodeFixOnItsWay.problemsOf(run);

    if (problems.length === 0 || !run.projectId) {
      return null;
    }

    const isAskedAgain: boolean = Boolean(run.codeTaskId);

    return {
      limitName: CODE_FIX_ON_ITS_WAY_LIMIT_NAME,
      projectId: run.projectId,
      check: async (manager: EntityManager): Promise<void> => {
        for (const problem of problems) {
          if (await CodeFixOnItsWay.findTurn(problem, manager)) {
            throw new BadDataException(
              isAskedAgain
                ? CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE
                : CodeFixOnItsWay.getRefusal(problem),
            );
          }
        }
      },
    };
  }

  /*
   * What a second fix of the problem is told: what OneUptime AI is already
   * doing, and where to follow it.
   */
  public static getRefusal(problem: CodeFixProblem): string {
    const taskType: CodeFixTaskType | undefined = problem.taskTypes[0];

    switch (problem.kind) {
      case CodeFixProblemKind.Exception:
        if (taskType === CodeFixTaskType.WriteRegressionTest) {
          return "OneUptime AI is already writing a regression test for this exception. Follow it in Code.";
        }

        if (taskType === CodeFixTaskType.ImproveExceptionHandling) {
          return "OneUptime AI is already improving how this exception is handled. Follow it in Code.";
        }

        return "OneUptime AI is already fixing this exception. Follow it in Code.";
      case CodeFixProblemKind.Incident:
      case CodeFixProblemKind.Alert: {
        const record: string =
          problem.kind === CodeFixProblemKind.Incident ? "incident" : "alert";

        return taskType === CodeFixTaskType.ImproveInstrumentation
          ? `OneUptime AI is already improving the instrumentation this ${record} needs. Follow it in Code.`
          : `OneUptime AI is already writing a fix pull request for this ${record}. Follow it in Code.`;
      }
      case CodeFixProblemKind.Insight:
        return "OneUptime AI is already working on this finding. Follow it in Code.";
      case CodeFixProblemKind.Trace:
        return "OneUptime AI is already writing a performance fix for this trace. Follow it in Code.";
      case CodeFixProblemKind.Service:
        return taskType === CodeFixTaskType.ImproveTracing
          ? "OneUptime AI is already improving this service's tracing. Follow it in Code."
          : "OneUptime AI is already improving this service's logging. Follow it in Code.";
      case CodeFixProblemKind.ProfileFunction:
      default:
        return "OneUptime AI is already working on this function. Follow it in Code.";
    }
  }

  // $1 the project, $2 code-fix runs, $3 the statuses a run ends in.
  private static getParameters(projectId: ObjectID): Array<unknown> {
    return [
      projectId.toString(),
      AIRunType.CodeFix,
      AIRunStatusHelper.terminalStatuses(),
    ];
  }

  // The recipes, bound once for a statement.
  private static bindRecipes(
    taskTypes: Array<CodeFixTaskType>,
    parameters: Array<unknown>,
  ): string {
    return `$${parameters.push([...taskTypes])}::text[]`;
  }

  /*
   * A run of one of the recipes, as `recipes` binds them: a null recipe is
   * an exception fix.
   */
  private static getRecipeSql(data: {
    alias: string;
    taskTypes: Array<CodeFixTaskType>;
    recipes: string;
  }): string {
    const matches: string = `"${data.alias}"."codeFixTaskType" = ANY(${data.recipes})`;

    return data.taskTypes.includes(CodeFixTaskType.FixException)
      ? `(${matches} OR "${data.alias}"."codeFixTaskType" IS NULL)`
      : matches;
  }

  /*
   * Whether the run under `alias` is a fix of the problem: of one of its
   * recipes, carrying its record.
   */
  private static getIsFixOfSql(
    problem: CodeFixProblem,
    parameters: Array<unknown>,
  ): (alias: string) => string {
    const recipes: string = CodeFixOnItsWay.bindRecipes(
      problem.taskTypes,
      parameters,
    );
    const recipe: (alias: string) => string = (alias: string): string => {
      return CodeFixOnItsWay.getRecipeSql({
        alias,
        taskTypes: problem.taskTypes,
        recipes,
      });
    };

    const recordColumn: string | null = CodeFixOnItsWay.getRecordColumn(
      problem.kind,
    );

    if (recordColumn) {
      const record: string = `$${parameters.push(problem.recordId)}::uuid`;

      return (alias: string): string => {
        return `("${alias}"."${recordColumn}" = ${record} AND ${recipe(alias)})`;
      };
    }

    if (problem.kind === CodeFixProblemKind.ProfileFunction) {
      const profile: CodeFixProfileFunction = problem.profileFunction || {
        serviceId: problem.recordId,
        functionName: "",
        fileName: "",
      };
      const type: string = `$${parameters.push(CodeTaskContextType.Profile)}`;
      const serviceId: string = `$${parameters.push(profile.serviceId.toLowerCase())}`;
      const functionName: string = `$${parameters.push(profile.functionName)}`;
      const fileName: string = `$${parameters.push(profile.fileName || "")}`;

      return (alias: string): string => {
        const context: string = `"${alias}"."taskContext" -> 'request' -> 'context'`;

        return `(${recipe(alias)} AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${context}) = 'array'
      THEN ${context} ELSE '[]'::jsonb END) AS "item"
    WHERE "item" ->> 'type' = ${type}
      AND lower(COALESCE("item" ->> 'serviceId', '')) = ${serviceId}
      AND "item" ->> 'functionName' = ${functionName}
      AND COALESCE("item" ->> 'fileName', '') = ${fileName}))`;
      };
    }

    // A trace's or a service's: its id in the fix's context.
    const context: string = `$${parameters.push(
      JSON.stringify(
        problem.kind === CodeFixProblemKind.Trace
          ? { traceId: problem.recordId }
          : { telemetryServiceId: problem.recordId },
      ),
    )}::jsonb`;

    return (alias: string): string => {
      return `("${alias}"."taskContext" @> ${context} AND ${recipe(alias)})`;
    };
  }

  // The column a fix carries its record in; null for one in its context.
  private static getRecordColumn(kind: CodeFixProblemKind): string | null {
    switch (kind) {
      case CodeFixProblemKind.Exception:
        return "triggeredByTelemetryExceptionId";
      case CodeFixProblemKind.Incident:
        return "triggeredByIncidentId";
      case CodeFixProblemKind.Alert:
        return "triggeredByAlertId";
      case CodeFixProblemKind.Insight:
        return "triggeredByAiInsightId";
      default:
        return null;
    }
  }

  // A row of getTurnStatement as a run: its id, task, person and state.
  private static toTurn(
    row: Record<string, unknown> | undefined,
  ): AIRun | null {
    const turnId: unknown = row?.["turnId"];

    if (!row || typeof turnId !== "string" || !turnId) {
      return null;
    }

    const turn: AIRun = new AIRun();
    turn.id = new ObjectID(turnId);

    const codeTaskId: unknown = row["codeTaskId"];

    if (typeof codeTaskId === "string" && codeTaskId) {
      turn.codeTaskId = new ObjectID(codeTaskId);
    }

    const userId: unknown = row["userId"];

    if (typeof userId === "string" && userId) {
      turn.userId = new ObjectID(userId);
    }

    const status: unknown = row["status"];

    if (typeof status === "string" && status) {
      turn.status = status as AIRunStatus;
    }

    return turn;
  }
}
