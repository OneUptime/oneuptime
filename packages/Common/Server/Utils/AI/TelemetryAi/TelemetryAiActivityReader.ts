import AIInsightService from "../../../Services/AIInsightService";
import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import SourceLocator, {
  LocatableRepository,
} from "../../CodeRepository/SourceLocator";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRunOutputReadFilter from "../AIRunOutputReadFilter";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../CodeTask/CodeTaskListRows";
import CodeTaskThread from "../CodeTask/CodeTaskThread";
import ProfileInsightFix from "./ProfileInsightFix";
import TelemetryAiRules, {
  TELEMETRY_AI_PROJECT_SELECT,
} from "./TelemetryAiRules";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
  CodeTaskPersonJSON,
} from "../../../../Types/AI/CodeTask";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "../../../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_LOGS_MAX_PROBLEMS,
  TelemetryAiLogEntryJSON,
  TelemetryAiLogKind,
  TelemetryAiLogState,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
} from "../../../../Types/AI/TelemetryAiActivity";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A TELEMETRY PRODUCT'S AI SECTION SHOWS (Types/AI/TelemetryAi):
 *
 *   - its readiness, for the Settings page: whether OneUptime AI can open a
 *     pull request for the lane's problems now, and if not, the first thing
 *     to do - connect a repository in Code, or what Code's
 *     own gate says (the plan, AI credits, a Runner online). Enable AI and
 *     the lane's switch are drawn by the page itself. A fact about the
 *     project, read as OneUptime: it is OneUptime that opens the pull
 *     requests;
 *   - its logs: everything OneUptime AI did with the lane's problems,
 *     newest first - each investigation (an insight's triage) and each pull
 *     request it was asked to open (a Code task, on its own or by a person
 *     from the insight), with how it stands.
 *
 * A Code task is one row, listed by its first turn, and stands as Code says
 * it does: by its newest turn - a fix asked again from Code (Try again,
 * #6509) or a reply someone sent there - with the pull request any of its
 * turns opened, read per task as Code's own lists read them
 * (CodeTaskListRows, #9812). A fix that failed and was asked again is
 * working here, then done with its pull request, as it is in Code.
 *
 * Who sees what in the logs: the problems are read as the reader, so
 * someone who may read only some services' insights hears only about
 * those. The runs for them are read as OneUptime, by those problems' ids -
 * an insight's triage is a system run no reader owns - and only their
 * kind, state and date leave. A Code task a reply carried a private
 * incident or alert into, which the reader does not see, is left out, as
 * Code's own lists leave it out (AIRunOutputReadFilter, #9165): its state
 * is its newest turn's now, and that turn is the reply's. A pull request's
 * repository and its link leave only for a repository the reader may read
 * in Code; the task's own page checks again.
 */
export default class TelemetryAiActivityReader {
  @CaptureSpan()
  public static async readReadiness(data: {
    projectId: ObjectID;
    lane: TelemetryAiLane;
  }): Promise<TelemetryAiReadinessJSON> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: TELEMETRY_AI_PROJECT_SELECT,
      props: { isRoot: true },
    });

    const repositories: Array<LocatableRepository> =
      await SourceLocator.getLocatableRepositories({
        projectId: data.projectId,
        props: { isRoot: true },
      });

    let blocker: CodeTaskBlocker | null = null;

    if (repositories[0]) {
      const plan: CurrentPlan = await ProjectService.getCurrentPlan(
        data.projectId,
      );
      const repository: CodeRepository = new CodeRepository();
      repository.id = new ObjectID(repositories[0].id);

      blocker = await CodeTaskGate.getBlocker({
        props: {
          isRoot: true,
          ...(plan.plan ? { currentPlan: plan.plan } : {}),
          isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
        },
        projectId: data.projectId,
        repository,
        canAsk: true,
      });

      // Enable AI is the page's own notice: not said twice.
      if (blocker?.type === CodeTaskBlockerType.AiDisabled) {
        blocker = null;
      }
    }

    return {
      lane: data.lane,
      // Strictly `=== false`, as every enableAi read: unset means on.
      isAiEnabled: Boolean(project) && project?.enableAi !== false,
      isLaneOn: project ? TelemetryAiRules.isLaneOn(project, data.lane) : false,
      connectedRepositoryCount: repositories.length,
      blocker:
        blocker && repositories[0]
          ? {
              type: blocker.type,
              message: blocker.message,
              repositoryId: repositories[0].id,
              ...(blocker.runnerName ? { runnerName: blocker.runnerName } : {}),
            }
          : null,
      automaticFixesToday: await ProfileInsightFix.countStartedToday(
        data.projectId,
      ),
      maxAutomaticFixesPerDay: TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
    };
  }

  @CaptureSpan()
  public static async readLogs(data: {
    projectId: ObjectID;
    lane: TelemetryAiLane;
    // The reader's, tenant-pinned: the problems they may read.
    props: DatabaseCommonInteractionProps;
    skip: number;
    limit: number;
  }): Promise<TelemetryAiLogsJSON> {
    const problems: Array<AIInsight> = await AIInsightService.findBy({
      query: {
        projectId: data.projectId,
        insightType: QueryHelper.any([
          ...TELEMETRY_AI_LANES[data.lane].insightTypes,
        ]),
      },
      select: {
        _id: true,
        title: true,
        serviceName: true,
        classification: true,
        insightType: true,
      },
      sort: { lastSeenAt: SortOrder.Descending },
      limit: TELEMETRY_AI_LOGS_MAX_PROBLEMS,
      skip: 0,
      props: data.props,
    });

    const problemsById: Map<string, AIInsight> = new Map<string, AIInsight>();

    for (const problem of problems) {
      if (problem.id) {
        problemsById.set(problem.id.toString(), problem);
      }
    }

    if (problemsById.size === 0) {
      return { entries: [], totalCount: 0 };
    }

    /*
     * Read as OneUptime, held to the reader's rule (#9165): no Code task
     * about, or carrying, a private incident or alert they do not see - the
     * page and its count alike.
     */
    const query: Record<string, unknown> = AIRunOutputReadFilter.applyToRunRow(
      {
        projectId: data.projectId,
        triggeredByAiInsightId: QueryHelper.any(
          Array.from(problemsById.keys()),
        ),
        runType: QueryHelper.any([AIRunType.Investigation, AIRunType.CodeFix]),
        /*
         * A Code task is one row, its first turn: its later turns - a fix
         * asked again, a reply - say how it stands (below), never rows of
         * their own.
         */
        codeTaskId: QueryHelper.isNull(),
      } as Record<string, unknown>,
      data.props,
    );

    const [runs, totalCount]: [Array<AIRun>, number] = await Promise.all([
      AIRunService.findBy({
        query,
        select: {
          _id: true,
          runType: true,
          status: true,
          needsUserInput: true,
          createdAt: true,
          userId: true,
          codeRepositoryId: true,
          triggeredByAiInsightId: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: data.limit,
        skip: data.skip,
        props: { isRoot: true },
      }),
      AIRunService.countBy({ query, props: { isRoot: true } }).then(
        (count: { toNumber: () => number }): number => {
          return count.toNumber();
        },
      ),
    ]);

    const tasks: Array<AIRun> = runs.filter((run: AIRun): boolean => {
      return run.runType === AIRunType.CodeFix && Boolean(run.id);
    });
    const taskIds: Array<ObjectID> = tasks.map((run: AIRun): ObjectID => {
      return run.id!;
    });

    /*
     * Each task as it stands now - its newest turn, and the pull request any
     * of its turns opened - read per task by Postgres, however many turns.
     */
    const [replies, pullRequests, repositories, people]: [
      Map<string, CodeTaskRepliesRead>,
      Map<string, AIAgentTaskPullRequest>,
      Array<CodeRepository>,
      Map<string, CodeTaskPersonJSON>,
    ] = await Promise.all([
      CodeTaskListRows.readReplies({ projectId: data.projectId, taskIds }),
      CodeTaskListRows.readPullRequests({
        projectId: data.projectId,
        taskIds,
      }),
      TelemetryAiActivityReader.readRepositories({
        projectId: data.projectId,
        runs: tasks,
        props: data.props,
      }),
      CodeTaskThread.getPeople(
        runs
          .filter((run: AIRun): boolean => {
            return Boolean(run.userId);
          })
          .map((run: AIRun): ObjectID => {
            return run.userId!;
          }),
      ),
    ]);

    const entries: Array<TelemetryAiLogEntryJSON> = [];

    for (const run of runs) {
      const problem: AIInsight | undefined = run.triggeredByAiInsightId
        ? problemsById.get(run.triggeredByAiInsightId.toString())
        : undefined;

      if (!problem || !run.id) {
        continue;
      }

      // A repository the reader may not read in Code is not named.
      const repository: CodeRepository | undefined = repositories.find(
        (item: CodeRepository): boolean => {
          return (
            Boolean(run.codeRepositoryId) &&
            item.id?.toString() === run.codeRepositoryId?.toString()
          );
        },
      );

      const key: string = CodeTaskListRows.key(run.id);

      entries.push(
        TelemetryAiActivityReader.toEntry({
          run,
          latestTurn:
            run.runType === AIRunType.CodeFix
              ? replies.get(key)?.newest
              : undefined,
          problem,
          repository,
          pullRequest: repository ? pullRequests.get(key) : undefined,
          requestedBy: run.userId
            ? people.get(run.userId.toString())?.name
            : undefined,
        }),
      );
    }

    return { entries, totalCount };
  }

  /*
   * How a run stands, in the words a log row says. Pure. A run that waits
   * in the queue is Waiting; Code says Working for it, as Code's state is
   * whether a reply may be sent.
   */
  public static getState(run: {
    runType?: AIRunType | undefined;
    status?: AIRunStatus | undefined;
    needsUserInput?: boolean | undefined;
  }): TelemetryAiLogState {
    switch (run.status) {
      case AIRunStatus.Running:
      case AIRunStatus.WaitingForApproval:
        return TelemetryAiLogState.Working;
      case AIRunStatus.Completed:
        return run.runType === AIRunType.CodeFix && run.needsUserInput
          ? TelemetryAiLogState.WaitingForYou
          : TelemetryAiLogState.Done;
      case AIRunStatus.NoFixFound:
        return TelemetryAiLogState.NothingToChange;
      case AIRunStatus.Cancelled:
        return TelemetryAiLogState.Stopped;
      case AIRunStatus.Error:
      case AIRunStatus.Stale:
        return TelemetryAiLogState.Failed;
      case AIRunStatus.Queued:
      default:
        return TelemetryAiLogState.Waiting;
    }
  }

  /*
   * One entry. Pure. A Code task (`run`, its first turn) stands as its
   * newest later turn, `latestTurn`, when it has one: a fix asked again
   * from Code, or a reply. When it was asked, and by whom, stay its first
   * turn's.
   */
  public static toEntry(data: {
    run: AIRun;
    // A Code task's newest later turn; none for a task of one turn.
    latestTurn?: AIRun | undefined;
    problem: AIInsight;
    // Only a repository the reader may read, and its pull request.
    repository?: CodeRepository | undefined;
    // A task's: the newest open one any of its turns opened, else the newest.
    pullRequest?: AIAgentTaskPullRequest | undefined;
    requestedBy?: string | undefined;
  }): TelemetryAiLogEntryJSON {
    const run: AIRun = data.run;
    const isPullRequest: boolean = run.runType === AIRunType.CodeFix;
    const latestTurn: AIRun | undefined = isPullRequest
      ? data.latestTurn
      : undefined;

    const entry: TelemetryAiLogEntryJSON = {
      runId: run.id!.toString(),
      kind: isPullRequest
        ? TelemetryAiLogKind.PullRequest
        : TelemetryAiLogKind.Investigation,
      at: new Date(run.createdAt || Date.now()).toISOString(),
      // A later turn is a turn of the same task: a code-fix run too.
      state: TelemetryAiActivityReader.getState(
        latestTurn
          ? {
              runType: run.runType,
              status: latestTurn.status,
              needsUserInput: latestTurn.needsUserInput,
            }
          : run,
      ),
      insight: {
        id: data.problem.id!.toString(),
        title: data.problem.title || "",
        ...(data.problem.serviceName
          ? { serviceName: data.problem.serviceName }
          : {}),
        // Its kind: the words its investigation's verdict is said in.
        ...(data.problem.insightType
          ? { type: data.problem.insightType.toString() }
          : {}),
      },
    };

    if (data.requestedBy) {
      entry.requestedBy = data.requestedBy;
    }

    if (isPullRequest) {
      entry.taskId = run.id!.toString();

      if (data.repository?.name) {
        entry.repositoryName = data.repository.name;
      }

      if (data.repository) {
        entry.repositoryHostedAt = CodeHost.readType(
          data.repository.repositoryHostedAt,
        );
      }

      // One recorded without a state is open, as Code reads it.
      if (data.repository && data.pullRequest) {
        entry.pullRequest = {
          state: data.pullRequest.pullRequestState || PullRequestState.Open,
          ...(data.pullRequest.pullRequestNumber
            ? { number: data.pullRequest.pullRequestNumber }
            : {}),
          ...(data.pullRequest.pullRequestUrl
            ? { url: data.pullRequest.pullRequestUrl.toString() }
            : {}),
        };
      }
    } else if (
      run.status === AIRunStatus.Completed &&
      data.problem.classification
    ) {
      entry.classification = data.problem.classification;
    }

    return entry;
  }

  // The repositories the tasks worked in that the reader may read in Code.
  private static async readRepositories(data: {
    projectId: ObjectID;
    runs: Array<AIRun>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<CodeRepository>> {
    const ids: Array<string> = Array.from(
      new Set(
        data.runs
          .map((run: AIRun): string => {
            return run.codeRepositoryId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );

    if (ids.length === 0) {
      return [];
    }

    try {
      return await CodeRepositoryService.findBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(ids) },
        select: { _id: true, name: true, repositoryHostedAt: true },
        limit: ids.length,
        skip: 0,
        props: data.props,
      });
    } catch {
      // A reader who may not read repositories sees the tasks unnamed.
      return [];
    }
  }
}
