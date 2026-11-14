import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeTaskListRows, {
  CodeTaskOutcomesRead,
  CodeTaskRepliesRead,
} from "./CodeTaskListRows";
import CodeTaskOrigin, { CodeTaskOriginSubjects } from "./CodeTaskOrigin";
import CodeTaskSteps from "./CodeTaskSteps";
import CodeTaskThread, {
  CODE_TASK_TURN_SELECT,
  CodeTaskNumberedTurn,
  CodeTaskTurnsRead,
} from "./CodeTaskThread";
import FixProductionReportUtil from "../CodeFix/FixProductionReportUtil";
import FixProductionReport from "../../../../Types/AI/FixProductionReport";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { getCodeTaskRequest } from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import CodeTaskRetry, {
  CodeTaskRetryJSON,
} from "../../../../Types/AI/CodeTaskRetry";
import TransientAIFailure from "../../../../Types/AI/TransientAIFailure";
import {
  MAX_CODE_TASK_SUMMARY_REPLY_LENGTH,
  CodeTaskChangeStats,
  CodeTaskChangeStatsJSON,
  CodeTaskContextItem,
  CodeTaskContextItemJSON,
  CodeTaskConversationJSON,
  CodeTaskLinkedTurnJSON,
  CodeTaskOriginJSON,
  CodeTaskOriginType,
  CodeTaskOutcome,
  CodeTaskPersonJSON,
  CodeTaskPullRequestJSON,
  CodeTaskRequest,
  CodeTaskState,
  CodeTaskStateUtil,
  CodeTaskStepJSON,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
  CodeTaskTurnProgressJSON,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import {
  ProductionReviewReport,
  ProductionReviewUtil,
} from "../../../../Types/CodeRepository/ProductionReview";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT THE CODE PAGES ARE SENT OF A TASK.
 *
 * A list row (summarize): the task's title, its state - read from its latest
 * turn - its number, who asked or what started it, its pull request, how
 * much it changed and when anything last happened, each read per task by
 * Postgres however many turns the task has (CodeTaskListRows). A
 * conversation (getConversation): every turn - or, for a task of more turns
 * than are read, its first and its newest, with how many between them are
 * not shown - with what was asked and the context added (never the
 * snapshots the AI read), the steps the AI took in plain words, its reply,
 * the files it changed, the diff for people who may change the code, the
 * pull requests, and why a turn failed.
 *
 * Everything is read as root; the Code API decides beforehand who may read
 * the task and who may see its diff (CodeTaskAccess).
 */

// Steps read for one turn. The Log page has the whole trail.
export const MAX_STEPS_PER_TURN: number = 400;

/*
 * What a turn a long task's conversation does not show is read with: what
 * the task at the top adds up over every turn (the files it changed, what
 * AI last said, its pull requests) and how long AI worked on it - never its
 * request, steps or diff.
 */
export const TURN_NOT_SHOWN_SELECT: Select<AIRun> = {
  _id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  taskOutcome: true,
};

// What a step is read from: never a tool's arguments or output.
export const CODE_TASK_STEP_EVENT_SELECT: Select<AIRunEvent> = {
  _id: true,
  aiRunId: true,
  sequence: true,
  eventType: true,
  toolName: true,
  resultSummary: true,
  createdAt: true,
};

/*
 * What a task's summary is made of. A list reads these per task in SQL
 * (CodeTaskListRows); a conversation adds them up from the turns it read
 * (getTurnFacts).
 */
export interface CodeTaskSummaryFacts {
  // The newest turn - the task itself when nobody replied: how it stands.
  latest: AIRun;
  turnCount: number;
  // When anything last happened: a turn asked, or ended.
  lastActivityAt: Date;
  // The pull request it shows: the newest open one, else the newest.
  pullRequest?: AIAgentTaskPullRequest | undefined;
  // What its turns changed, added up; null for nothing.
  changes: CodeTaskChangeStatsJSON | null;
  // What AI last said, whole: cut to MAX_CODE_TASK_SUMMARY_REPLY_LENGTH.
  lastReply?: string | undefined;
}

export default class CodeTaskPresenter {
  @CaptureSpan()
  public static async summarize(data: {
    projectId: ObjectID;
    tasks: Array<AIRun>;
    // The reader's: the records tasks started from are named as they may.
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<CodeTaskSummaryJSON>> {
    if (data.tasks.length === 0) {
      return [];
    }

    const taskIds: Array<ObjectID> = data.tasks.map((task: AIRun): ObjectID => {
      return task.id!;
    });

    const [
      replies,
      outcomes,
      pullRequests,
      subjects,
      contexts,
      people,
      reviews,
    ]: [
      Map<string, CodeTaskRepliesRead>,
      Map<string, CodeTaskOutcomesRead>,
      Map<string, AIAgentTaskPullRequest>,
      CodeTaskOriginSubjects,
      Map<string, AIRun>,
      Map<string, CodeTaskPersonJSON>,
      Map<string, CodeTaskOutcome>,
    ] = await Promise.all([
      CodeTaskListRows.readReplies({ projectId: data.projectId, taskIds }),
      CodeTaskListRows.readOutcomes({ projectId: data.projectId, taskIds }),
      CodeTaskListRows.readPullRequests({ projectId: data.projectId, taskIds }),
      CodeTaskOrigin.loadSubjects({
        projectId: data.projectId,
        runs: data.tasks,
        props: data.props,
      }),
      CodeTaskPresenter.loadOriginContexts(data.tasks),
      CodeTaskThread.getPeople(
        data.tasks
          .filter((task: AIRun): boolean => {
            return Boolean(task.userId);
          })
          .map((task: AIRun): ObjectID => {
            return task.userId!;
          }),
      ),
      // A production review's row says what its latest review found.
      CodeTaskPresenter.loadOutcomes(
        data.tasks
          .filter((task: AIRun): boolean => {
            return CodeFixTaskTypeHelper.isProductionReview(
              task.codeFixTaskType,
            );
          })
          .map((task: AIRun): ObjectID => {
            return task.id!;
          }),
      ),
    ]);

    return data.tasks.map((task: AIRun): CodeTaskSummaryJSON => {
      const key: string = CodeTaskListRows.key(task.id!);
      const taskReplies: CodeTaskRepliesRead | undefined = replies.get(key);
      const taskOutcomes: CodeTaskOutcomesRead | undefined = outcomes.get(key);

      return CodeTaskPresenter.toSummary({
        task,
        latest: taskReplies?.newest || task,
        turnCount: 1 + (taskReplies?.count || 0),
        lastActivityAt: CodeTaskPresenter.getLastActivity(task, [
          task.createdAt,
          task.completedAt,
          taskReplies?.lastActivityAt,
        ]),
        pullRequest: pullRequests.get(key),
        changes: taskOutcomes?.changes || null,
        lastReply: taskOutcomes?.lastReply,
        reviewOutcome: reviews.get(task.id!.toString()),
        origin: CodeTaskOrigin.describe({
          run: task,
          subjects,
          taskContext: contexts.get(task.id!.toString())?.taskContext,
          requesterName: task.userId
            ? people.get(task.userId.toString())?.name
            : undefined,
        }),
        requestedBy: task.userId
          ? people.get(task.userId.toString())
          : undefined,
      });
    });
  }

  /*
   * A task's conversation: its first turn and its newest - at most
   * MAX_TURNS_PER_TASK - and, for a task with more, how many turns between
   * them are not shown and how long AI worked on those. The task at the top
   * is every turn's: what it changed, its pull request and how many turns
   * it has count the ones not shown too.
   *
   * `linkedTurnId`, the turn a link names (the Log page's `?turn=`), comes
   * back as `linkedTurn` with its place in the task when it is one of the
   * task's turns the conversation does not show - never a run of another
   * task, or of anything else.
   */
  @CaptureSpan()
  public static async getConversation(data: {
    projectId: ObjectID;
    task: AIRun;
    canSeeChanges: boolean;
    props: DatabaseCommonInteractionProps;
    linkedTurnId?: ObjectID | undefined;
  }): Promise<CodeTaskConversationJSON> {
    const select: Select<AIRun> = {
      ...CODE_TASK_TURN_SELECT,
      taskContext: true,
      taskOutcome: true,
      ...(data.canSeeChanges ? { codeChanges: true } : {}),
    };

    const task: AIRun | null = await AIRunService.findOneById({
      id: data.task.id!,
      select,
      props: { isRoot: true },
    });

    const read: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
      projectId: data.projectId,
      task: task || data.task,
      select,
    });

    const turns: Array<AIRun> = read.turns;

    const [turnsNotShown, linked]: [Array<AIRun>, CodeTaskNumberedTurn | null] =
      await Promise.all([
        // None for a task the conversation shows whole: nothing more is read.
        CodeTaskThread.getTurnsLeftOut({
          projectId: data.projectId,
          task: turns[0]!,
          read,
          select: TURN_NOT_SHOWN_SELECT,
        }),
        CodeTaskPresenter.findLinkedTurn({
          projectId: data.projectId,
          task: turns[0]!,
          turns,
          linkedTurnId: data.linkedTurnId,
          select,
        }),
      ]);

    // The turns sent whole: the ones shown, and the one a link names.
    const sentTurns: Array<AIRun> = linked ? [...turns, linked.turn] : turns;

    const sentTurnIds: Array<ObjectID> = sentTurns.map(
      (turn: AIRun): ObjectID => {
        return turn.id!;
      },
    );

    const [pullRequests, subjects, people, eventsByRun]: [
      Array<AIAgentTaskPullRequest>,
      CodeTaskOriginSubjects,
      Map<string, CodeTaskPersonJSON>,
      Map<string, Array<AIRunEvent>>,
    ] = await Promise.all([
      // Every turn's: the task's pull request may be one a turn not shown opened.
      CodeTaskThread.getPullRequests({
        projectId: data.projectId,
        runIds: CodeTaskPresenter.uniqueIds([
          ...sentTurnIds,
          ...turnsNotShown.map((turn: AIRun): ObjectID => {
            return turn.id!;
          }),
        ]),
      }),
      CodeTaskOrigin.loadSubjects({
        projectId: data.projectId,
        runs: [turns[0]!],
        props: data.props,
      }),
      CodeTaskThread.getPeople(
        sentTurns
          .filter((turn: AIRun): boolean => {
            return Boolean(turn.userId);
          })
          .map((turn: AIRun): ObjectID => {
            return turn.userId!;
          }),
      ),
      CodeTaskPresenter.loadEvents(sentTurnIds),
    ]);

    const first: AIRun = turns[0]!;

    const origin: CodeTaskOriginJSON = CodeTaskOrigin.describe({
      run: first,
      subjects,
      taskContext: first.taskContext,
      requesterName: first.userId
        ? people.get(first.userId.toString())?.name
        : undefined,
    });

    const summary: CodeTaskSummaryJSON = CodeTaskPresenter.toSummary({
      task: first,
      // Every turn, in order: the ones not shown changed files too.
      ...CodeTaskPresenter.getTurnFacts({
        task: first,
        turns: [first, ...turnsNotShown, ...turns.slice(1)],
        pullRequests,
      }),
      // As counted: more turns than one read takes are not read, but are the task's.
      turnCount: turns.length + read.olderTurnsLeftOut,
      reviewOutcome: first.taskOutcome,
      origin,
      requestedBy: first.userId
        ? people.get(first.userId.toString())
        : undefined,
    });

    const toTurn: (turn: AIRun, isFirst: boolean) => CodeTaskTurnJSON = (
      turn: AIRun,
      isFirst: boolean,
    ): CodeTaskTurnJSON => {
      return CodeTaskPresenter.toTurn({
        turn,
        isFirst,
        origin,
        people,
        pullRequests: pullRequests.filter(
          (pullRequest: AIAgentTaskPullRequest): boolean => {
            return pullRequest.aiRunId?.toString() === turn.id!.toString();
          },
        ),
        events: eventsByRun.get(turn.id!.toString()) || [],
        canSeeChanges: data.canSeeChanges,
      });
    };

    const conversation: CodeTaskConversationJSON = {
      task: summary,
      turns: turns.map((turn: AIRun, index: number): CodeTaskTurnJSON => {
        return toTurn(turn, index === 0);
      }),
    };

    if (read.olderTurnsLeftOut > 0) {
      conversation.turnsNotShown = {
        count: read.olderTurnsLeftOut,
        workMilliseconds: CodeTaskPresenter.getWorkMilliseconds(turnsNotShown),
      };
    }

    if (linked) {
      const linkedTurn: CodeTaskLinkedTurnJSON = {
        number: linked.number,
        turn: toTurn(linked.turn, false),
      };

      conversation.linkedTurn = linkedTurn;
    }

    return conversation;
  }

  /*
   * The turn a link names, when the conversation does not show it: one of
   * the task's replies, read as the turns shown are, with its place in the
   * task. Null for no link, a turn shown (the first always is), and a run
   * that is not one of the task's replies.
   */
  private static async findLinkedTurn(data: {
    projectId: ObjectID;
    task: AIRun;
    turns: Array<AIRun>;
    linkedTurnId?: ObjectID | undefined;
    select: Select<AIRun>;
  }): Promise<CodeTaskNumberedTurn | null> {
    if (!data.linkedTurnId) {
      return null;
    }

    const linkedKey: string = CodeTaskListRows.key(data.linkedTurnId);

    if (
      data.turns.some((turn: AIRun): boolean => {
        return CodeTaskListRows.key(turn.id!) === linkedKey;
      })
    ) {
      return null;
    }

    return await CodeTaskThread.findReply({
      projectId: data.projectId,
      task: data.task,
      runId: data.linkedTurnId,
      select: data.select,
    });
  }

  // Each id once, in the order first given.
  private static uniqueIds(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();

    return ids.filter((id: ObjectID): boolean => {
      const key: string = CodeTaskListRows.key(id);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  /*
   * How long AI worked on turns, in all: each from when it started to when
   * it ended. A turn that never started, or has no end, adds nothing - the
   * turns this adds up are done.
   */
  public static getWorkMilliseconds(turns: Array<AIRun>): number {
    let total: number = 0;

    for (const turn of turns) {
      if (!turn.startedAt || !turn.completedAt) {
        continue;
      }

      const took: number =
        new Date(turn.completedAt).getTime() -
        new Date(turn.startedAt).getTime();

      if (Number.isFinite(took) && took > 0) {
        total += took;
      }
    }

    return total;
  }

  /*
   * How one turn of the task stands now, with the steps it took after the
   * step the page has (`afterSequence`; -1 for none yet) - what a
   * conversation reads each time its working turn reports a step. Null when
   * the run is not a turn of this task.
   *
   * The step the page has is read again with the new ones: a step's plain
   * copy (CodeTaskSteps.fromEvents) is told from a new note only beside
   * the tool line it copies.
   */
  @CaptureSpan()
  public static async getTurnProgress(data: {
    projectId: ObjectID;
    task: AIRun;
    runId: ObjectID;
    afterSequence: number;
  }): Promise<CodeTaskTurnProgressJSON | null> {
    const isFirstTurn: boolean =
      data.runId.toString().toLowerCase() ===
      data.task.id!.toString().toLowerCase();

    const turn: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.runId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        ...(isFirstTurn ? {} : { codeTaskId: data.task.id! }),
      },
      select: {
        _id: true,
        status: true,
        needsUserInput: true,
        startedAt: true,
        autoRetryCount: true,
        nextAttemptAt: true,
        retryReason: true,
      },
      props: { isRoot: true },
    });

    if (!turn) {
      return null;
    }

    const afterSequence: number = Math.max(-1, Math.floor(data.afterSequence));

    const events: Array<AIRunEvent> = await AIRunEventService.findBy({
      query: {
        aiRunId: data.runId,
        sequence: QueryHelper.greaterThanEqualTo(Math.max(0, afterSequence)),
      },
      select: CODE_TASK_STEP_EVENT_SELECT,
      sort: { sequence: SortOrder.Ascending },
      // One more than a read sends: that one says there are more.
      limit: MAX_STEPS_PER_TURN + 1,
      skip: 0,
      props: { isRoot: true },
    });

    const hasMore: boolean = events.length > MAX_STEPS_PER_TURN;

    const steps: Array<CodeTaskStepJSON> = CodeTaskSteps.fromEvents(
      hasMore ? events.slice(0, MAX_STEPS_PER_TURN) : events,
    ).filter((step: CodeTaskStepJSON): boolean => {
      return step.sequence > afterSequence;
    });

    const status: AIRunStatus = turn.status || AIRunStatus.Queued;

    const progress: CodeTaskTurnProgressJSON = {
      runId: turn.id!.toString(),
      status,
      state: CodeTaskStateUtil.fromRun(turn),
      isQueued: status === AIRunStatus.Queued,
      steps,
      hasMore,
    };

    if (turn.startedAt) {
      progress.startedAt = new Date(turn.startedAt).toISOString();
    }

    const retry: CodeTaskRetryJSON | undefined =
      CodeTaskPresenter.getRetry(turn);

    if (retry) {
      progress.retry = retry;
    }

    return progress;
  }

  /*
   * How a turn stands with its attempts, when it was tried again by itself
   * or waits to be (CodeFixAutoRetry): its attempt, when the next starts,
   * and why the one before failed.
   */
  public static getRetry(turn: AIRun): CodeTaskRetryJSON | undefined {
    return CodeTaskRetry.describe({
      retriesDone: turn.autoRetryCount,
      nextAttemptAt: turn.nextAttemptAt,
      isQueued: turn.status === AIRunStatus.Queued,
      reason: turn.retryReason,
      kind: TransientAIFailure.classify(turn.retryReason),
    });
  }

  /*
   * A summary's facts from turns read whole, oldest first - a
   * conversation's: its newest turn, when anything last happened, the pull
   * request it shows (of `pullRequests`, newest first), what the turns
   * changed, and what AI last said - the newest reply that says anything:
   * a turn still working has none yet, and the one before it is what AI
   * said.
   */
  public static getTurnFacts(data: {
    task: AIRun;
    turns: Array<AIRun>;
    pullRequests: Array<AIAgentTaskPullRequest>;
  }): Omit<CodeTaskSummaryFacts, "turnCount"> {
    const moments: Array<Date | undefined> = [];

    for (const turn of data.turns) {
      moments.push(turn.createdAt, turn.completedAt);
    }

    let lastReply: string | undefined = undefined;

    for (let index: number = data.turns.length - 1; index >= 0; index--) {
      const reply: unknown = data.turns[index]?.taskOutcome?.summary;

      if (typeof reply === "string" && reply.trim()) {
        lastReply = reply;
        break;
      }
    }

    const facts: Omit<CodeTaskSummaryFacts, "turnCount"> = {
      latest: data.turns[data.turns.length - 1] || data.task,
      lastActivityAt: CodeTaskPresenter.getLastActivity(data.task, moments),
      changes: CodeTaskChangeStats.fromOutcomes(
        data.turns.map((turn: AIRun): CodeTaskOutcome | undefined => {
          return turn.taskOutcome;
        }),
      ),
    };

    const pullRequest: AIAgentTaskPullRequest | undefined =
      data.pullRequests.find((candidate: AIAgentTaskPullRequest): boolean => {
        return (
          (candidate.pullRequestState || PullRequestState.Open) ===
          PullRequestState.Open
        );
      }) || data.pullRequests[0];

    if (pullRequest) {
      facts.pullRequest = pullRequest;
    }

    if (lastReply) {
      facts.lastReply = lastReply;
    }

    return facts;
  }

  // The latest of these moments - never before the task was asked.
  public static getLastActivity(
    task: AIRun,
    moments: Array<Date | string | null | undefined>,
  ): Date {
    let lastActivity: Date = new Date(task.createdAt || Date.now());

    for (const moment of moments) {
      if (moment && new Date(moment) > lastActivity) {
        lastActivity = new Date(moment);
      }
    }

    return lastActivity;
  }

  public static toSummary(
    data: CodeTaskSummaryFacts & {
      task: AIRun;
      origin: CodeTaskOriginJSON;
      requestedBy?: CodeTaskPersonJSON | undefined;
      // A production review's own outcome: it is reviewed again in place.
      reviewOutcome?: CodeTaskOutcome | null | undefined;
    },
  ): CodeTaskSummaryJSON {
    const latest: AIRun = data.latest;
    const state: CodeTaskState = CodeTaskStateUtil.fromRun(latest);

    const summary: CodeTaskSummaryJSON = {
      id: data.task.id!.toString(),
      title: data.task.title || data.origin.label || "",
      recipe: CodeFixTaskTypeHelper.fromDatabaseValue(
        data.task.codeFixTaskType,
      ),
      state,
      isQueued: latest.status === AIRunStatus.Queued,
      createdAt: new Date(data.task.createdAt || Date.now()).toISOString(),
      lastActivityAt: data.lastActivityAt.toISOString(),
      origin: data.origin,
      turnCount: data.turnCount,
    };

    if (data.task.taskNumber) {
      summary.taskNumber = data.task.taskNumber;
    }

    if (data.requestedBy) {
      summary.requestedBy = data.requestedBy;
    }

    if (data.pullRequest) {
      summary.pullRequest = CodeTaskPresenter.toPullRequest(data.pullRequest);
    }

    if (data.task.codeRepositoryId) {
      summary.codeRepositoryId = data.task.codeRepositoryId.toString();
    }

    if (data.changes) {
      summary.changes = data.changes;
    }

    // A production review: what its latest review found, at a glance.
    const review: ProductionReviewReport | undefined =
      CodeFixTaskTypeHelper.isProductionReview(data.task.codeFixTaskType)
        ? data.reviewOutcome?.productionReview
        : undefined;

    if (review) {
      summary.productionReview = ProductionReviewUtil.summarize(review);
    }

    const retry: CodeTaskRetryJSON | undefined =
      CodeTaskPresenter.getRetry(latest);

    if (retry) {
      summary.retry = retry;
    }

    if (
      latest.errorMessage &&
      (state === CodeTaskState.Failed || state === CodeTaskState.Stopped)
    ) {
      summary.errorMessage = latest.errorMessage;
    }

    if (latest.startedAt) {
      summary.startedAt = new Date(latest.startedAt).toISOString();
    }

    if (latest.completedAt) {
      summary.completedAt = new Date(latest.completedAt).toISOString();
    }

    // What AI last said, at a glance.
    const reply: string = (data.lastReply || "").trim();

    if (reply) {
      summary.latestReply =
        reply.length > MAX_CODE_TASK_SUMMARY_REPLY_LENGTH
          ? `${reply.substring(0, MAX_CODE_TASK_SUMMARY_REPLY_LENGTH - 1)}…`
          : reply;
    }

    return summary;
  }

  private static toTurn(data: {
    turn: AIRun;
    isFirst: boolean;
    origin: CodeTaskOriginJSON;
    people: Map<string, CodeTaskPersonJSON>;
    pullRequests: Array<AIAgentTaskPullRequest>;
    events: Array<AIRunEvent>;
    canSeeChanges: boolean;
  }): CodeTaskTurnJSON {
    const turn: AIRun = data.turn;
    const recipe: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      turn.codeFixTaskType,
    );

    const json: CodeTaskTurnJSON = {
      runId: turn.id!.toString(),
      recipe,
      status: turn.status || AIRunStatus.Queued,
      state: CodeTaskStateUtil.fromRun(turn),
      createdAt: new Date(turn.createdAt || Date.now()).toISOString(),
      steps: CodeTaskSteps.fromEvents(data.events),
      pullRequests: data.pullRequests.map(CodeTaskPresenter.toPullRequest),
      needsInput: Boolean(
        turn.needsUserInput && turn.status === AIRunStatus.Completed,
      ),
    };

    if (turn.startedAt) {
      json.startedAt = new Date(turn.startedAt).toISOString();
    }

    if (turn.completedAt) {
      json.completedAt = new Date(turn.completedAt).toISOString();
    }

    if (turn.userId && data.people.has(turn.userId.toString())) {
      json.requestedBy = data.people.get(turn.userId.toString());
    }

    const request: CodeTaskRequest | null = CodeFixTaskTypeHelper.isCodeRequest(
      recipe,
    )
      ? getCodeTaskRequest(turn.taskContext)
      : null;

    if (request) {
      json.request = {
        message: request.message,
        context: request.context.map(CodeTaskPresenter.toContextItem),
      };

      // The branch the person picked for the task to start from.
      if (data.isFirst && request.baseBranch) {
        json.request.baseBranch = request.baseBranch;
      }

      /*
       * A request OneUptime wrote itself: what started it - the insight -
       * above what it asked.
       */
      if (data.isFirst && data.origin.type !== CodeTaskOriginType.Request) {
        json.origin = data.origin;
      }
    } else if (data.isFirst) {
      json.origin = data.origin;
    }

    if (turn.taskOutcome) {
      json.outcome = turn.taskOutcome;
    }

    if (data.canSeeChanges && turn.codeChanges) {
      json.changes = turn.codeChanges;
    }

    if (turn.errorMessage) {
      json.errorMessage = turn.errorMessage;
    }

    const retry: CodeTaskRetryJSON | undefined =
      CodeTaskPresenter.getRetry(turn);

    if (retry) {
      json.retry = retry;
    }

    return json;
  }

  // What the conversation shows of a context item: never its snapshot.
  public static toContextItem(
    item: CodeTaskContextItem,
  ): CodeTaskContextItemJSON {
    const json: CodeTaskContextItemJSON = {
      type: item.type,
      label: item.label,
    };

    for (const key of [
      "recordId",
      "url",
      "path",
      "text",
      "traceId",
      "search",
      "serviceId",
      // A profile's function and window: its chip opens the Profiler there.
      "functionName",
      "fileName",
      "profileType",
      "startTime",
      "endTime",
      "beforeStartTime",
      "beforeEndTime",
    ] as const) {
      if (item[key]) {
        json[key] = item[key];
      }
    }

    if (item.hours) {
      json.hours = item.hours;
    }

    return json;
  }

  public static toPullRequest(
    pullRequest: AIAgentTaskPullRequest,
  ): CodeTaskPullRequestJSON {
    const json: CodeTaskPullRequestJSON = {
      state: pullRequest.pullRequestState || PullRequestState.Open,
    };

    if (pullRequest.pullRequestNumber) {
      json.number = pullRequest.pullRequestNumber;
    }

    if (pullRequest.pullRequestUrl) {
      json.url = pullRequest.pullRequestUrl.toString();
    }

    if (pullRequest.title) {
      json.title = pullRequest.title;
    }

    if (pullRequest.headRefName) {
      json.branch = pullRequest.headRefName;
    }

    const production: FixProductionReport | undefined =
      FixProductionReportUtil.fromPullRequest(pullRequest);

    if (production) {
      json.production = production;
    }

    return json;
  }

  /*
   * The task contexts a list needs to name its origins: only those of tasks
   * that name their subject there (GitHub, trace and service recipes), and
   * never a request's (its snapshots can be large).
   */
  private static async loadOriginContexts(
    tasks: Array<AIRun>,
  ): Promise<Map<string, AIRun>> {
    const ids: Array<ObjectID> = tasks
      .filter((task: AIRun): boolean => {
        return CodeTaskOrigin.needsTaskContext(task);
      })
      .map((task: AIRun): ObjectID => {
        return task.id!;
      });

    const contexts: Map<string, AIRun> = new Map<string, AIRun>();

    if (ids.length === 0) {
      return contexts;
    }

    const runs: Array<AIRun> = await AIRunService.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: { _id: true, taskContext: true },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const run of runs) {
      contexts.set(run.id!.toString(), run);
    }

    return contexts;
  }

  /*
   * What each run ended with, by run id: a list's runs are read without
   * it, and a production review's row says what its latest review found.
   */
  private static async loadOutcomes(
    runIds: Array<ObjectID>,
  ): Promise<Map<string, CodeTaskOutcome>> {
    const outcomes: Map<string, CodeTaskOutcome> = new Map<
      string,
      CodeTaskOutcome
    >();

    if (runIds.length === 0) {
      return outcomes;
    }

    const runs: Array<AIRun> = await AIRunService.findBy({
      query: { _id: QueryHelper.any(runIds) },
      select: { _id: true, taskOutcome: true },
      limit: runIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const run of runs) {
      if (run.id && run.taskOutcome) {
        outcomes.set(run.id.toString(), run.taskOutcome);
      }
    }

    return outcomes;
  }

  private static async loadEvents(
    runIds: Array<ObjectID>,
  ): Promise<Map<string, Array<AIRunEvent>>> {
    const eventsByRun: Map<string, Array<AIRunEvent>> = new Map<
      string,
      Array<AIRunEvent>
    >();

    /*
     * The newest events of each turn, oldest first: a turn still working
     * shows its latest steps however long it has run.
     */
    const lists: Array<Array<AIRunEvent>> = await Promise.all(
      runIds.map(async (runId: ObjectID): Promise<Array<AIRunEvent>> => {
        const newestFirst: Array<AIRunEvent> = await AIRunEventService.findBy({
          query: { aiRunId: runId },
          select: CODE_TASK_STEP_EVENT_SELECT,
          sort: { sequence: SortOrder.Descending },
          limit: MAX_STEPS_PER_TURN,
          skip: 0,
          props: { isRoot: true },
        });

        return [...newestFirst].reverse();
      }),
    );

    runIds.forEach((runId: ObjectID, index: number): void => {
      eventsByRun.set(runId.toString(), lists[index] || []);
    });

    return eventsByRun;
  }
}
