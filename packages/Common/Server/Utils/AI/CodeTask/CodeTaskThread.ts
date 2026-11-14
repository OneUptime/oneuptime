import { FIX_PRODUCTION_REPORT_SELECT } from "../CodeFix/FixProductionReportUtil";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Services/AIRunService";
import UserService from "../../../Services/UserService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { CodeTaskListStatement } from "./CodeTaskListQuery";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import User from "../../../../Models/DatabaseModels/User";
import AIRunType from "../../../../Types/AI/AIRunType";
import { CodeTaskPersonJSON } from "../../../../Types/AI/CodeTask";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";

/*
 * READS A CODE TASK: ITS TURNS, THEIR PULL REQUESTS AND WHO ASKED.
 *
 * A task is its first code-fix run, and each reply is a later run whose
 * codeTaskId names that first run (see Types/AI/CodeTask). Everything here
 * reads as root, pinned to the project and to code-fix runs: the Code API
 * has already decided the caller may read the task (CodeTaskAccess), and a
 * task id of another project, or of a chat run, reads as no task at all.
 */

// What a turn needs to be shown, in a list or a conversation.
export const CODE_TASK_TURN_SELECT: Select<AIRun> = {
  _id: true,
  projectId: true,
  codeFixTaskType: true,
  codeRepositoryId: true,
  codeTaskId: true,
  taskNumber: true,
  title: true,
  status: true,
  needsUserInput: true,
  userId: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
  // How the turn stands with its attempts (CodeFixAutoRetry).
  autoRetryCount: true,
  nextAttemptAt: true,
  retryReason: true,
  triggeredByTelemetryExceptionId: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAiInsightId: true,
};

/*
 * A task's conversation reads at most this many turns: its first turn, and
 * its newest replies. A task kept open as a working thread for weeks can
 * have more; the ones between are left out, and counted.
 */
export const MAX_TURNS_PER_TASK: number = 200;

/*
 * A task's turns as read for its conversation (getTurns): its first turn,
 * then its newest replies, oldest first - and how many replies older than
 * those were left out, between the first turn and the ones read.
 */
export interface CodeTaskTurnsRead {
  turns: Array<AIRun>;
  olderTurnsLeftOut: number;
}

// One of a task's replies, with its place in the task: the first turn is 1.
export interface CodeTaskNumberedTurn {
  turn: AIRun;
  number: number;
}

// What a task's pull request is shown with, wherever Code shows one.
export const CODE_TASK_PULL_REQUEST_SELECT: Select<AIAgentTaskPullRequest> = {
  _id: true,
  aiRunId: true,
  codeRepositoryId: true,
  title: true,
  description: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  pullRequestState: true,
  headRefName: true,
  baseRefName: true,
  createdAt: true,
  // What production showed once the fix merged.
  ...FIX_PRODUCTION_REPORT_SELECT,
};

export default class CodeTaskThread {
  // The task (its first run) - null when it is not a code task of the project.
  @CaptureSpan()
  public static async findTask(data: {
    projectId: ObjectID;
    taskId: ObjectID;
    select?: Select<AIRun> | undefined;
  }): Promise<AIRun | null> {
    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.taskId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
      },
      select: data.select || CODE_TASK_TURN_SELECT,
      props: { isRoot: true },
    });

    if (!run) {
      return null;
    }

    if (!run.codeTaskId) {
      return run;
    }

    /*
     * A reply's own id leads to its task's first run, so an old link to one
     * (the Tasks page listed every run) still lands on the task. One step
     * only: a first run has no codeTaskId of its own.
     */
    return await AIRunService.findOneBy({
      query: {
        _id: run.codeTaskId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeTaskId: QueryHelper.isNull(),
      },
      select: data.select || CODE_TASK_TURN_SELECT,
      props: { isRoot: true },
    });
  }

  /*
   * The task's turns, oldest first: its first run, then its newest replies -
   * at most MAX_TURNS_PER_TASK in all. A longer task says how many replies
   * older than those were left out, between its first turn and the ones
   * read: a conversation kept open for weeks is shown, and worked from, as
   * it stands now, never as it stood at its two hundredth turn. The first
   * turn stays: it says what the task is about.
   *
   * `createdBefore` reads the turns before that moment instead - a turn's
   * own creation: the conversation as it stood when that turn was asked.
   */
  @CaptureSpan()
  public static async getTurns(data: {
    projectId: ObjectID;
    task: AIRun;
    select?: Select<AIRun> | undefined;
    createdBefore?: Date | undefined;
  }): Promise<CodeTaskTurnsRead> {
    const newestFirst: Array<AIRun> = await AIRunService.findBy({
      query: CodeTaskThread.getRepliesQuery(data),
      select: data.select || CODE_TASK_TURN_SELECT,
      sort: { createdAt: SortOrder.Descending },
      limit: MAX_TURNS_PER_TASK - 1,
      skip: 0,
      props: { isRoot: true },
    });

    const replies: Array<AIRun> = [...newestFirst].reverse();

    return {
      turns: [data.task, ...replies],
      olderTurnsLeftOut: await CodeTaskThread.countRepliesLeftOut({
        ...data,
        repliesRead: replies.length,
      }),
    };
  }

  /*
   * How many of the task's replies a read left out: none when the read was
   * not full - a task under the limit is read in one query, as it always
   * was - else every reply counted, less the ones read.
   */
  private static async countRepliesLeftOut(data: {
    projectId: ObjectID;
    task: AIRun;
    createdBefore?: Date | undefined;
    repliesRead: number;
  }): Promise<number> {
    if (data.repliesRead < MAX_TURNS_PER_TASK - 1) {
      return 0;
    }

    const replies: PositiveNumber = await AIRunService.countBy({
      query: CodeTaskThread.getRepliesQuery(data),
      props: { isRoot: true },
    });

    return Math.max(0, replies.toNumber() - data.repliesRead);
  }

  // The task's replies: pinned to its project and to code-fix runs.
  private static getRepliesQuery(data: {
    projectId: ObjectID;
    task: AIRun;
    createdBefore?: Date | undefined;
  }): Query<AIRun> {
    return {
      projectId: data.projectId,
      runType: AIRunType.CodeFix,
      codeTaskId: data.task.id!,
      ...(data.createdBefore
        ? { createdAt: QueryHelper.lessThan(data.createdBefore) }
        : {}),
    };
  }

  /*
   * The replies a read of the task's newest turns left out
   * (CodeTaskTurnsRead.olderTurnsLeftOut), oldest first: the ones older
   * than every reply it read. What the task's page still adds up over all
   * its turns - the files changed, how long AI worked - read with as little
   * as that needs (`select`). None when nothing was left out.
   *
   * At most LIMIT_PER_PROJECT of them, the newest: a task with more than
   * that between its first turn and its newest has the oldest counted but
   * not added up, and the log says so.
   */
  @CaptureSpan()
  public static async getTurnsLeftOut(data: {
    projectId: ObjectID;
    task: AIRun;
    read: CodeTaskTurnsRead;
    select: Select<AIRun>;
  }): Promise<Array<AIRun>> {
    // The oldest reply read: the turns left out are all older.
    const oldestRead: AIRun | undefined = data.read.turns[1];

    if (data.read.olderTurnsLeftOut === 0 || !oldestRead?.createdAt) {
      return [];
    }

    const newestFirst: Array<AIRun> = await AIRunService.findBy({
      query: {
        ...CodeTaskThread.getRepliesQuery(data),
        createdAt: QueryHelper.lessThanEqualTo(new Date(oldestRead.createdAt)),
        // One created the same moment as the oldest read is not read twice.
        _id: QueryHelper.notIn(
          data.read.turns.slice(1).map((turn: AIRun): ObjectID => {
            return turn.id!;
          }),
        ),
      },
      select: data.select,
      sort: { createdAt: SortOrder.Descending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    CodeTaskThread.logWhenCut({
      projectId: data.projectId,
      taskId: data.task.id,
      read: newestFirst.length,
      what: "turns its conversation does not show",
    });

    return [...newestFirst].reverse();
  }

  /*
   * The ids of every run of the task: its first run, then each reply,
   * newest first - however many, not only the turns a conversation reads.
   * What the task's pull requests are read by: the one a reply pushes to may
   * have been opened by its third turn, or by its two hundred and third.
   */
  @CaptureSpan()
  public static async getRunIds(data: {
    projectId: ObjectID;
    task: AIRun;
  }): Promise<Array<ObjectID>> {
    const replies: Array<AIRun> = await AIRunService.findBy({
      query: CodeTaskThread.getRepliesQuery(data),
      select: { _id: true },
      sort: { createdAt: SortOrder.Descending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    CodeTaskThread.logWhenCut({
      projectId: data.projectId,
      taskId: data.task.id,
      read: replies.length,
      what: "replies, for its pull requests",
    });

    return [
      data.task.id!,
      ...replies.map((reply: AIRun): ObjectID => {
        return reply.id!;
      }),
    ];
  }

  /*
   * Every pull request the task's runs opened, newest first. `read`, a read
   * of the task's newest turns (getTurns, without createdBefore), names the
   * runs when it holds every turn - nothing left out, so nothing is read
   * that was not read before; otherwise every run of the task is.
   */
  @CaptureSpan()
  public static async getTaskPullRequests(data: {
    projectId: ObjectID;
    task: AIRun;
    read?: CodeTaskTurnsRead | undefined;
  }): Promise<Array<AIAgentTaskPullRequest>> {
    const runIds: Array<ObjectID> =
      data.read && data.read.olderTurnsLeftOut === 0
        ? data.read.turns.map((turn: AIRun): ObjectID => {
            return turn.id!;
          })
        : await CodeTaskThread.getRunIds({
            projectId: data.projectId,
            task: data.task,
          });

    return await CodeTaskThread.getPullRequests({
      projectId: data.projectId,
      runIds,
    });
  }

  // The pull requests the runs opened, newest first.
  @CaptureSpan()
  public static async getPullRequests(data: {
    projectId: ObjectID;
    runIds: Array<ObjectID>;
  }): Promise<Array<AIAgentTaskPullRequest>> {
    if (data.runIds.length === 0) {
      return [];
    }

    const pullRequests: Array<AIAgentTaskPullRequest> =
      await AIAgentTaskPullRequestService.findBy({
        query: {
          projectId: data.projectId,
          aiRunId: QueryHelper.any(data.runIds),
        },
        select: CODE_TASK_PULL_REQUEST_SELECT,
        sort: { createdAt: SortOrder.Descending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    CodeTaskThread.logWhenCut({
      projectId: data.projectId,
      read: pullRequests.length,
      what: "pull requests their runs opened",
      details: { runCount: data.runIds.length },
    });

    return pullRequests;
  }

  /*
   * The pull request a reply builds on: the newest one the task's runs
   * opened that is still open, in the task's repository. A task whose pull
   * request was merged or closed starts its next change on a new branch.
   */
  public static getWorkingPullRequest(data: {
    pullRequests: Array<AIAgentTaskPullRequest>;
    codeRepositoryId: ObjectID | undefined;
  }): AIAgentTaskPullRequest | null {
    if (!data.codeRepositoryId) {
      return null;
    }

    return (
      data.pullRequests.find((pullRequest: AIAgentTaskPullRequest): boolean => {
        return (
          (pullRequest.pullRequestState || PullRequestState.Open) ===
            PullRequestState.Open &&
          Boolean(pullRequest.headRefName) &&
          pullRequest.codeRepositoryId?.toString() ===
            data.codeRepositoryId!.toString()
        );
      }) || null
    );
  }

  /*
   * The task's working pull request, in two reads: the ids of every run of
   * the task, then their pull requests - every turn's, however long the
   * task, not only the turns its conversation shows.
   */
  @CaptureSpan()
  public static async findWorkingPullRequest(data: {
    projectId: ObjectID;
    task: AIRun;
  }): Promise<AIAgentTaskPullRequest | null> {
    const pullRequests: Array<AIAgentTaskPullRequest> =
      await CodeTaskThread.getTaskPullRequests({
        projectId: data.projectId,
        task: data.task,
      });

    return CodeTaskThread.getWorkingPullRequest({
      pullRequests,
      codeRepositoryId: data.task.codeRepositoryId,
    });
  }

  /*
   * One of the task's replies, by its run id, with its place in the task:
   * what a link to a turn the conversation does not show opens (the Log
   * page's `?turn=`). Null when the run is not a reply of this task -
   * another task's, another project's, a chat's, or deleted.
   */
  @CaptureSpan()
  public static async findReply(data: {
    projectId: ObjectID;
    task: AIRun;
    runId: ObjectID;
    select?: Select<AIRun> | undefined;
  }): Promise<CodeTaskNumberedTurn | null> {
    const turn: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.runId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeTaskId: data.task.id!,
      },
      select: data.select || CODE_TASK_TURN_SELECT,
      props: { isRoot: true },
    });

    if (!turn?.id) {
      return null;
    }

    const statement: CodeTaskListStatement =
      CodeTaskThread.getRepliesBeforeStatement({
        projectId: data.projectId,
        taskId: data.task.id!,
        replyId: turn.id,
      });

    const rows: Array<Record<string, unknown>> =
      (await AIRunService.getRepository().manager.query(
        statement.sql,
        statement.parameters,
      )) as Array<Record<string, unknown>>;

    // The first turn, the replies before it, then the reply itself.
    return {
      turn,
      number: 2 + CodeTaskThread.toCount(rows[0]?.["before"]),
    };
  }

  /*
   * How many of the task's replies come before one of them, in the order
   * its conversation reads them (getTurns): asked earlier, or asked the
   * same moment with the greater id - getTurns reads the newest first, and
   * a tie by id. Compared with the reply's own row in Postgres, so no
   * moment is rounded on its way: Postgres keeps microseconds, a
   * JavaScript Date milliseconds. One row, "before".
   */
  public static getRepliesBeforeStatement(data: {
    projectId: ObjectID;
    taskId: ObjectID;
    replyId: ObjectID;
  }): CodeTaskListStatement {
    return {
      sql: `SELECT COUNT(*)::int AS "before"
FROM "AIRun" AS "reply"
JOIN "AIRun" AS "turn" ON "turn"."_id" = $4::uuid
WHERE "reply"."projectId" = $1 AND "reply"."runType" = $2 AND "reply"."deletedAt" IS NULL
  AND "reply"."codeTaskId" = $3::uuid
  AND ("reply"."createdAt" < "turn"."createdAt"
    OR ("reply"."createdAt" = "turn"."createdAt" AND "reply"."_id" > "turn"."_id"))`,
      parameters: [
        data.projectId.toString(),
        AIRunType.CodeFix,
        data.taskId.toString(),
        data.replyId.toString(),
      ],
    };
  }

  /*
   * A read that stopped at its limit left the rest unread. Never silently:
   * the log says which task, and what was cut.
   */
  private static logWhenCut(data: {
    projectId: ObjectID;
    taskId?: ObjectID | null | undefined;
    read: number;
    what: string;
    // What else the log says of the read.
    details?: Record<string, number> | undefined;
  }): void {
    if (data.read < LIMIT_PER_PROJECT) {
      return;
    }

    const subject: string = data.taskId
      ? `Code task ${data.taskId.toString()}`
      : "Code tasks";

    logger.warn(
      `${subject}: read the newest ${LIMIT_PER_PROJECT} ${data.what}; the older ones were not read.`,
      {
        projectId: data.projectId.toString(),
        ...(data.taskId ? { codeTaskId: data.taskId.toString() } : {}),
        ...(data.details || {}),
      },
    );
  }

  private static toCount(value: unknown): number {
    const count: number = Number(value);

    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  // The people who asked, by id: their name, or their email without one.
  @CaptureSpan()
  public static async getPeople(
    userIds: Array<ObjectID>,
  ): Promise<Map<string, CodeTaskPersonJSON>> {
    const people: Map<string, CodeTaskPersonJSON> = new Map<
      string,
      CodeTaskPersonJSON
    >();

    const uniqueIds: Array<string> = Array.from(
      new Set(
        userIds.map((userId: ObjectID): string => {
          return userId.toString();
        }),
      ),
    );

    if (uniqueIds.length === 0) {
      return people;
    }

    const users: Array<User> = await UserService.findBy({
      query: { _id: QueryHelper.any(uniqueIds) },
      select: { _id: true, name: true, email: true },
      limit: uniqueIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const user of users) {
      if (!user.id) {
        continue;
      }

      people.set(user.id.toString(), {
        id: user.id.toString(),
        name: user.name?.toString() || user.email?.toString() || "",
      });
    }

    return people;
  }
}
