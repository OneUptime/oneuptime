import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeTaskOrigin, { CodeTaskOriginSubjects } from "./CodeTaskOrigin";
import CodeTaskSteps from "./CodeTaskSteps";
import CodeTaskThread, { CODE_TASK_TURN_SELECT } from "./CodeTaskThread";
import FixProductionReportUtil from "../CodeFix/FixProductionReportUtil";
import FixProductionReport from "../../../../Types/AI/FixProductionReport";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { getCodeTaskRequest } from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskChangeStats,
  CodeTaskChangeStatsJSON,
  CodeTaskContextItem,
  CodeTaskContextItemJSON,
  CodeTaskOriginJSON,
  CodeTaskOriginType,
  CodeTaskOutcome,
  CodeTaskPersonJSON,
  CodeTaskPullRequestJSON,
  CodeTaskRequest,
  CodeTaskState,
  CodeTaskStateUtil,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
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
 * much it changed and when anything last happened. A conversation (getConversation): every turn, with
 * what was asked and the context added (never the snapshots the AI read),
 * the steps the AI took in plain words, its reply, the files it changed, the
 * diff for people who may change the code, the pull requests, and why a turn
 * failed.
 *
 * Everything is read as root; the Code API decides beforehand who may read
 * the task and who may see its diff (CodeTaskAccess).
 */

// Steps read for one turn. The Log page has the whole trail.
export const MAX_STEPS_PER_TURN: number = 400;

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

    const repliesByTask: Map<
      string,
      Array<AIRun>
    > = await CodeTaskThread.getRepliesByTask({
      projectId: data.projectId,
      taskIds,
    });

    const allRunIds: Array<ObjectID> = [...taskIds];

    for (const replies of repliesByTask.values()) {
      for (const reply of replies) {
        allRunIds.push(reply.id!);
      }
    }

    const [pullRequests, subjects, contexts, people, outcomes]: [
      Array<AIAgentTaskPullRequest>,
      CodeTaskOriginSubjects,
      Map<string, AIRun>,
      Map<string, CodeTaskPersonJSON>,
      Map<string, CodeTaskOutcome>,
    ] = await Promise.all([
      CodeTaskThread.getPullRequests({
        projectId: data.projectId,
        runIds: allRunIds,
      }),
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
      CodeTaskPresenter.loadOutcomes(allRunIds),
    ]);

    return data.tasks.map((task: AIRun): CodeTaskSummaryJSON => {
      const turns: Array<AIRun> = [
        task,
        ...(repliesByTask.get(task.id!.toString()) || []),
      ];

      return CodeTaskPresenter.toSummary({
        task,
        turns,
        outcomes: turns.map((turn: AIRun): CodeTaskOutcome | undefined => {
          return outcomes.get(turn.id!.toString());
        }),
        pullRequests: CodeTaskPresenter.pullRequestsOf(pullRequests, turns),
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

  @CaptureSpan()
  public static async getConversation(data: {
    projectId: ObjectID;
    task: AIRun;
    canSeeChanges: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ task: CodeTaskSummaryJSON; turns: Array<CodeTaskTurnJSON> }> {
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

    const turns: Array<AIRun> = await CodeTaskThread.getTurns({
      projectId: data.projectId,
      task: task || data.task,
      select,
    });

    const turnIds: Array<ObjectID> = turns.map((turn: AIRun): ObjectID => {
      return turn.id!;
    });

    const [pullRequests, subjects, people, eventsByRun]: [
      Array<AIAgentTaskPullRequest>,
      CodeTaskOriginSubjects,
      Map<string, CodeTaskPersonJSON>,
      Map<string, Array<AIRunEvent>>,
    ] = await Promise.all([
      CodeTaskThread.getPullRequests({
        projectId: data.projectId,
        runIds: turnIds,
      }),
      CodeTaskOrigin.loadSubjects({
        projectId: data.projectId,
        runs: [turns[0]!],
        props: data.props,
      }),
      CodeTaskThread.getPeople(
        turns
          .filter((turn: AIRun): boolean => {
            return Boolean(turn.userId);
          })
          .map((turn: AIRun): ObjectID => {
            return turn.userId!;
          }),
      ),
      CodeTaskPresenter.loadEvents(turnIds),
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
      turns,
      pullRequests,
      origin,
      requestedBy: first.userId
        ? people.get(first.userId.toString())
        : undefined,
    });

    return {
      task: summary,
      turns: turns.map((turn: AIRun, index: number): CodeTaskTurnJSON => {
        return CodeTaskPresenter.toTurn({
          turn,
          isFirst: index === 0,
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
      }),
    };
  }

  public static toSummary(data: {
    task: AIRun;
    turns: Array<AIRun>;
    pullRequests: Array<AIAgentTaskPullRequest>;
    origin: CodeTaskOriginJSON;
    requestedBy?: CodeTaskPersonJSON | undefined;
    /*
     * What each turn ended with, when the turns were read without it (a
     * list); otherwise each turn's own taskOutcome is read.
     */
    outcomes?: Array<CodeTaskOutcome | null | undefined> | undefined;
  }): CodeTaskSummaryJSON {
    const latest: AIRun = data.turns[data.turns.length - 1] || data.task;
    const state: CodeTaskState = CodeTaskStateUtil.fromRun(latest);

    let lastActivity: Date = new Date(data.task.createdAt || Date.now());

    for (const turn of data.turns) {
      for (const moment of [turn.createdAt, turn.completedAt]) {
        if (moment && new Date(moment) > lastActivity) {
          lastActivity = new Date(moment);
        }
      }
    }

    const pullRequest: AIAgentTaskPullRequest | undefined =
      data.pullRequests.find((candidate: AIAgentTaskPullRequest): boolean => {
        return (
          (candidate.pullRequestState || PullRequestState.Open) ===
          PullRequestState.Open
        );
      }) || data.pullRequests[0];

    const summary: CodeTaskSummaryJSON = {
      id: data.task.id!.toString(),
      title: data.task.title || data.origin.label || "",
      recipe: CodeFixTaskTypeHelper.fromDatabaseValue(
        data.task.codeFixTaskType,
      ),
      state,
      isQueued: latest.status === AIRunStatus.Queued,
      createdAt: new Date(data.task.createdAt || Date.now()).toISOString(),
      lastActivityAt: lastActivity.toISOString(),
      origin: data.origin,
      turnCount: data.turns.length,
    };

    if (data.task.taskNumber) {
      summary.taskNumber = data.task.taskNumber;
    }

    if (data.requestedBy) {
      summary.requestedBy = data.requestedBy;
    }

    if (pullRequest) {
      summary.pullRequest = CodeTaskPresenter.toPullRequest(pullRequest);
    }

    if (data.task.codeRepositoryId) {
      summary.codeRepositoryId = data.task.codeRepositoryId.toString();
    }

    const changes: CodeTaskChangeStatsJSON | null =
      CodeTaskChangeStats.fromOutcomes(
        data.outcomes ||
          data.turns.map((turn: AIRun): CodeTaskOutcome | undefined => {
            return turn.taskOutcome;
          }),
      );

    if (changes) {
      summary.changes = changes;
    }

    /*
     * A production review: what its latest review found, at a glance. Its
     * task is reviewed again in place, so the task's own outcome is it.
     */
    const review: ProductionReviewReport | undefined =
      CodeFixTaskTypeHelper.isProductionReview(data.task.codeFixTaskType)
        ? (data.outcomes?.[0] || data.task.taskOutcome)?.productionReview
        : undefined;

    if (review) {
      summary.productionReview = ProductionReviewUtil.summarize(review);
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

  private static pullRequestsOf(
    pullRequests: Array<AIAgentTaskPullRequest>,
    turns: Array<AIRun>,
  ): Array<AIAgentTaskPullRequest> {
    const turnIds: Set<string> = new Set<string>(
      turns.map((turn: AIRun): string => {
        return turn.id!.toString();
      }),
    );

    return pullRequests.filter(
      (pullRequest: AIAgentTaskPullRequest): boolean => {
        return turnIds.has(pullRequest.aiRunId?.toString() || "");
      },
    );
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
   * What each run ended with, by run id: a list's runs are read without it,
   * and a row adds up the lines its turns changed (CodeTaskChangeStats).
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
          select: {
            _id: true,
            aiRunId: true,
            sequence: true,
            eventType: true,
            toolName: true,
            resultSummary: true,
            createdAt: true,
          },
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
