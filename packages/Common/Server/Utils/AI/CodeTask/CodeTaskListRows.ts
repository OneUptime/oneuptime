import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { CodeTaskListStatement } from "./CodeTaskListQuery";
import { CODE_TASK_PULL_REQUEST_SELECT } from "./CodeTaskThread";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../../Types/AI/AIRunType";
import { CodeTaskChangeStatsJSON } from "../../../../Types/AI/CodeTask";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A TASK LIST'S ROWS SAY OF EACH TASK, READ PER TASK BY POSTGRES.
 *
 * A row says how its task stands now - from its newest turn - when anything
 * last happened in it, how many turns it has, its pull request, what its
 * turns changed and what AI last said (CodeTaskPresenter.summarize); a
 * fix's declared code changes say how each of their tasks stands
 * (DeclaredCodeChanges.list). A task kept open as a working thread for
 * months can have tens of thousands of turns, and a page lists up to 50
 * tasks. So nothing here reads a task's turns one by one, and no read of a
 * page's older turns can stop before a task's newest (issue #7131).
 * Postgres counts, adds up and picks the newest per task, and sends back
 * one row each:
 *
 *  - replies (getRepliesStatement): how many, when one was last asked or
 *    ended, and the newest - then read whole, by its id;
 *  - outcomes (getOutcomesStatement): the files every turn changed, each
 *    counted once, the lines each turn added and took out, and the newest
 *    reply AI wrote that says anything;
 *  - pull requests (getPullRequestStatement): the one a row shows - the
 *    newest open one any turn opened, else the newest - then read whole,
 *    by its id.
 *
 * Turns are ordered as a conversation orders them (CodeTaskThread.getTurns):
 * by when they were asked, a tie by id. As root, pinned to the project and
 * to code-fix runs, never a deleted row: the caller decided beforehand who
 * may read the tasks (CodeTaskAccess). Every value is a bound parameter.
 */

/*
 * What a row reads of a task's newest reply: how it stands, why it failed,
 * its attempts and its times.
 */
export const CODE_TASK_NEWEST_REPLY_SELECT: Select<AIRun> = {
  _id: true,
  codeTaskId: true,
  status: true,
  needsUserInput: true,
  userId: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
  autoRetryCount: true,
  nextAttemptAt: true,
  retryReason: true,
};

/*
 * What JavaScript's String.prototype.trim takes off the ends of a string -
 * every white space and line end - for Postgres's btrim: a reply of only
 * these says nothing, as a conversation reads it. Written as code points,
 * so no editor turns one into a plain space.
 */
export const TRIMMED_CHARACTERS: string = String.fromCharCode(
  0x09,
  0x0a,
  0x0b,
  0x0c,
  0x0d,
  0x20,
  0xa0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
);

// A task's replies, as a row reads them.
export interface CodeTaskRepliesRead {
  // How many: the task's turns are one more.
  count: number;
  // The newest, read with CODE_TASK_NEWEST_REPLY_SELECT.
  newest?: AIRun | undefined;
  // When a reply was last asked, or last ended.
  lastActivityAt?: Date | undefined;
}

// What a task's turns ended with, as a row reads it.
export interface CodeTaskOutcomesRead {
  /*
   * What they changed, added up as CodeTaskChangeStats.fromOutcomes adds
   * them: each file once, every turn's lines. Null when no turn changed a
   * file.
   */
  changes: CodeTaskChangeStatsJSON | null;
  // What AI last said: the newest turn's reply that says anything, whole.
  lastReply?: string | undefined;
}

type QueryRows = Array<Record<string, unknown>>;

export default class CodeTaskListRows {
  // A task's or a run's id as the reads key it.
  public static key(id: ObjectID | string): string {
    return id.toString().toLowerCase();
  }

  @CaptureSpan()
  public static async readReplies(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): Promise<Map<string, CodeTaskRepliesRead>> {
    if (data.taskIds.length === 0) {
      return new Map<string, CodeTaskRepliesRead>();
    }

    const rows: QueryRows = await CodeTaskListRows.query(
      CodeTaskListRows.getRepliesStatement(data),
    );

    const read: Map<string, CodeTaskRepliesRead> = new Map<
      string,
      CodeTaskRepliesRead
    >();
    const newestIds: Map<string, string> = new Map<string, string>();

    for (const row of rows) {
      const taskId: string = CodeTaskListRows.readId(row["taskId"]);

      if (!taskId) {
        continue;
      }

      const lastActivityAt: Date | null = CodeTaskListRows.readDate(
        row["lastActivityAt"],
      );

      read.set(taskId, {
        count: CodeTaskListRows.toCount(row["replyCount"]),
        ...(lastActivityAt ? { lastActivityAt } : {}),
      });

      const newestReplyId: string = CodeTaskListRows.readId(
        row["newestReplyId"],
      );

      if (newestReplyId) {
        newestIds.set(taskId, newestReplyId);
      }
    }

    if (newestIds.size === 0) {
      return read;
    }

    const replies: Array<AIRun> = await AIRunService.findBy({
      query: {
        _id: QueryHelper.any(Array.from(newestIds.values())),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
      },
      select: CODE_TASK_NEWEST_REPLY_SELECT,
      limit: newestIds.size,
      skip: 0,
      props: { isRoot: true },
    });

    for (const reply of replies) {
      if (!reply.id || !reply.codeTaskId) {
        continue;
      }

      const taskId: string = CodeTaskListRows.key(reply.codeTaskId);
      const entry: CodeTaskRepliesRead | undefined = read.get(taskId);

      if (entry && newestIds.get(taskId) === CodeTaskListRows.key(reply.id)) {
        entry.newest = reply;
      }
    }

    return read;
  }

  @CaptureSpan()
  public static async readOutcomes(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): Promise<Map<string, CodeTaskOutcomesRead>> {
    if (data.taskIds.length === 0) {
      return new Map<string, CodeTaskOutcomesRead>();
    }

    return CodeTaskListRows.toOutcomes(
      await CodeTaskListRows.query(CodeTaskListRows.getOutcomesStatement(data)),
    );
  }

  // The pull request each task's row shows, by task id.
  @CaptureSpan()
  public static async readPullRequests(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): Promise<Map<string, AIAgentTaskPullRequest>> {
    const shown: Map<string, AIAgentTaskPullRequest> = new Map<
      string,
      AIAgentTaskPullRequest
    >();

    if (data.taskIds.length === 0) {
      return shown;
    }

    const idsByTask: Map<string, string> = CodeTaskListRows.toPullRequestIds(
      await CodeTaskListRows.query(
        CodeTaskListRows.getPullRequestStatement(data),
      ),
    );

    if (idsByTask.size === 0) {
      return shown;
    }

    const pullRequests: Array<AIAgentTaskPullRequest> =
      await AIAgentTaskPullRequestService.findBy({
        query: {
          _id: QueryHelper.any(Array.from(idsByTask.values())),
          projectId: data.projectId,
        },
        select: CODE_TASK_PULL_REQUEST_SELECT,
        limit: idsByTask.size,
        skip: 0,
        props: { isRoot: true },
      });

    const byId: Map<string, AIAgentTaskPullRequest> = new Map<
      string,
      AIAgentTaskPullRequest
    >();

    for (const pullRequest of pullRequests) {
      if (pullRequest.id) {
        byId.set(CodeTaskListRows.key(pullRequest.id), pullRequest);
      }
    }

    for (const [taskId, pullRequestId] of idsByTask) {
      const pullRequest: AIAgentTaskPullRequest | undefined =
        byId.get(pullRequestId);

      if (pullRequest) {
        shown.set(taskId, pullRequest);
      }
    }

    return shown;
  }

  /*
   * Each task's replies: how many ("replyCount"), when one was last asked
   * or ended ("lastActivityAt"), and the newest ("newestReplyId"). A task
   * nobody replied to has no row.
   */
  public static getRepliesStatement(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): CodeTaskListStatement {
    return {
      sql: `WITH "reply" AS (
  SELECT "_id", "codeTaskId", "createdAt", "completedAt"
  FROM "AIRun"
  WHERE "projectId" = $1 AND "runType" = $2 AND "deletedAt" IS NULL
    AND "codeTaskId" = ANY($3::uuid[])
), "counted" AS (
  SELECT "codeTaskId", COUNT(*)::int AS "replyCount",
    MAX(GREATEST("createdAt", COALESCE("completedAt", "createdAt"))) AS "lastActivityAt"
  FROM "reply"
  GROUP BY "codeTaskId"
), "newest" AS (
  SELECT DISTINCT ON ("codeTaskId") "codeTaskId", "_id"
  FROM "reply"
  ORDER BY "codeTaskId", "createdAt" DESC, "_id" ASC
)
SELECT "counted"."codeTaskId" AS "taskId", "newest"."_id" AS "newestReplyId",
  "counted"."replyCount", "counted"."lastActivityAt"
FROM "counted" JOIN "newest" ON "newest"."codeTaskId" = "counted"."codeTaskId"`,
      parameters: CodeTaskListRows.getTaskParameters(data),
    };
  }

  /*
   * What each task's turns - its first run and every reply - ended with:
   * the files they changed, each path once ("files"), the lines added and
   * taken out ("additions", "deletions"), and what AI last said ("reply").
   * A file without a path, or a count that is not a number above nothing,
   * counts as CodeTaskChangeStats.fromOutcomes counts it. A reply that says
   * nothing is passed by, as a conversation passes it: a turn still working
   * has said nothing yet, and the one before it is what AI said. A task
   * whose turns changed nothing and said nothing has no row.
   */
  public static getOutcomesStatement(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): CodeTaskListStatement {
    const parameters: Array<unknown> = CodeTaskListRows.getTaskParameters(data);
    const trimmed: string = `$${parameters.push(TRIMMED_CHARACTERS)}`;

    return {
      sql: `WITH "turn" AS (
  SELECT COALESCE("codeTaskId", "_id") AS "taskId", "_id", "createdAt",
    "codeTaskId" IS NULL AS "isFirst",
    CASE WHEN jsonb_typeof("taskOutcome" -> 'filesChanged') = 'array'
      THEN "taskOutcome" -> 'filesChanged' END AS "filesChanged",
    CASE WHEN jsonb_typeof("taskOutcome" -> 'summary') = 'string'
      THEN "taskOutcome" ->> 'summary' END AS "reply"
  FROM "AIRun"
  WHERE "projectId" = $1 AND "runType" = $2 AND "deletedAt" IS NULL
    AND "taskOutcome" IS NOT NULL
    AND (("codeTaskId" IS NULL AND "_id" = ANY($3::uuid[])) OR "codeTaskId" = ANY($3::uuid[]))
), "fileChange" AS (
  SELECT "turn"."taskId", "changed"."value" AS "entry"
  FROM "turn" CROSS JOIN LATERAL jsonb_array_elements("turn"."filesChanged") AS "changed"
  WHERE jsonb_typeof("changed"."value" -> 'path') = 'string'
), "changes" AS (
  SELECT "taskId",
    COUNT(DISTINCT "entry" ->> 'path')::int AS "files",
    SUM(CASE WHEN jsonb_typeof("entry" -> 'additions') = 'number'
      THEN GREATEST(floor(("entry" ->> 'additions')::numeric), 0) ELSE 0 END) AS "additions",
    SUM(CASE WHEN jsonb_typeof("entry" -> 'deletions') = 'number'
      THEN GREATEST(floor(("entry" ->> 'deletions')::numeric), 0) ELSE 0 END) AS "deletions"
  FROM "fileChange"
  GROUP BY "taskId"
), "said" AS (
  SELECT DISTINCT ON ("taskId") "taskId", "reply"
  FROM "turn"
  WHERE btrim("reply", ${trimmed}) <> ''
  ORDER BY "taskId", "isFirst" ASC, "createdAt" DESC, "_id" ASC
)
SELECT COALESCE("changes"."taskId", "said"."taskId") AS "taskId",
  "changes"."files", "changes"."additions", "changes"."deletions", "said"."reply"
FROM "changes" FULL OUTER JOIN "said" ON "said"."taskId" = "changes"."taskId"`,
      parameters,
    };
  }

  /*
   * The pull request each task's row shows ("pullRequestId"): of every one
   * its turns opened, the newest open one - one recorded without a state is
   * open, as the conversation reads it - else the newest. A task with none
   * has no row.
   */
  public static getPullRequestStatement(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): CodeTaskListStatement {
    const parameters: Array<unknown> = CodeTaskListRows.getTaskParameters(data);
    const open: string = `$${parameters.push(PullRequestState.Open)}`;

    return {
      sql: `SELECT DISTINCT ON ("taskId") "taskId", "pullRequestId"
FROM (
  SELECT COALESCE("turn"."codeTaskId", "turn"."_id") AS "taskId",
    "pullRequest"."_id" AS "pullRequestId",
    COALESCE(NULLIF("pullRequest"."pullRequestState", ''), ${open}) = ${open} AS "isOpen",
    "pullRequest"."createdAt"
  FROM "AIAgentTaskPullRequest" AS "pullRequest"
  JOIN "AIRun" AS "turn" ON "turn"."_id" = "pullRequest"."aiRunId"
  WHERE "pullRequest"."projectId" = $1 AND "pullRequest"."deletedAt" IS NULL
    AND "turn"."projectId" = $1 AND "turn"."runType" = $2 AND "turn"."deletedAt" IS NULL
    AND (("turn"."codeTaskId" IS NULL AND "turn"."_id" = ANY($3::uuid[]))
      OR "turn"."codeTaskId" = ANY($3::uuid[]))
) AS "candidate"
ORDER BY "taskId", "isOpen" DESC, "createdAt" DESC, "pullRequestId" ASC`,
      parameters,
    };
  }

  // The rows of getOutcomesStatement, by task id.
  public static toOutcomes(rows: QueryRows): Map<string, CodeTaskOutcomesRead> {
    const read: Map<string, CodeTaskOutcomesRead> = new Map<
      string,
      CodeTaskOutcomesRead
    >();

    for (const row of rows) {
      const taskId: string = CodeTaskListRows.readId(row["taskId"]);

      if (!taskId) {
        continue;
      }

      const files: number = CodeTaskListRows.toCount(row["files"]);
      const reply: unknown = row["reply"];

      read.set(taskId, {
        changes:
          files > 0
            ? {
                files,
                additions: CodeTaskListRows.toCount(row["additions"]),
                deletions: CodeTaskListRows.toCount(row["deletions"]),
              }
            : null,
        ...(typeof reply === "string" && reply.trim()
          ? { lastReply: reply }
          : {}),
      });
    }

    return read;
  }

  // The rows of getPullRequestStatement: each task's pull request id.
  public static toPullRequestIds(rows: QueryRows): Map<string, string> {
    const ids: Map<string, string> = new Map<string, string>();

    for (const row of rows) {
      const taskId: string = CodeTaskListRows.readId(row["taskId"]);
      const pullRequestId: string = CodeTaskListRows.readId(
        row["pullRequestId"],
      );

      if (taskId && pullRequestId) {
        ids.set(taskId, pullRequestId);
      }
    }

    return ids;
  }

  // $1 the project, $2 code-fix runs, $3 the tasks.
  private static getTaskParameters(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): Array<unknown> {
    return [
      data.projectId.toString(),
      AIRunType.CodeFix,
      data.taskIds.map((taskId: ObjectID): string => {
        return taskId.toString();
      }),
    ];
  }

  private static async query(
    statement: CodeTaskListStatement,
  ): Promise<QueryRows> {
    return (await AIRunService.getRepository().manager.query(
      statement.sql,
      statement.parameters,
    )) as QueryRows;
  }

  private static readId(value: unknown): string {
    return typeof value === "string" && value.length > 0
      ? CodeTaskListRows.key(value)
      : "";
  }

  private static readDate(value: unknown): Date | null {
    if (!(value instanceof Date) && typeof value !== "string") {
      return null;
    }

    const date: Date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  // A count Postgres sent: an int, or a numeric sum as text.
  private static toCount(value: unknown): number {
    const count: number = Number(value);

    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
}
