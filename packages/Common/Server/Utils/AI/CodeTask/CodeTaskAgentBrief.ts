import AIRunService from "../../../Services/AIRunService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import { DashboardClientUrl } from "../../../EnvironmentConfig";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../Telemetry/ExceptionSanitizer";
import ToolResultSerializer from "../Toolbox/Serializer";
import PromptText from "../../../../Utils/AI/PromptText";
import CodeTaskOrigin, { CodeTaskOriginSubjects } from "./CodeTaskOrigin";
import CodeTaskThread, { CODE_TASK_TURN_SELECT } from "./CodeTaskThread";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskContext, {
  getCodeTaskRequest,
  getGitHubTaskContext,
  getInvestigationCodeFixTaskSnapshot,
  GitHubTaskContext,
  InvestigationCodeFixTaskSnapshot,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskAgentContextItem,
  CodeTaskAgentDetails,
  CodeTaskAgentTurn,
  CodeTaskContextItem,
  CodeTaskContextType,
  CodeTaskOriginJSON,
  CodeTaskOriginType,
  CodeTaskPersonJSON,
  CodeTaskRequest,
} from "../../../../Types/AI/CodeTask";
import ObjectID from "../../../../Types/ObjectID";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import { getAiInsightDashboardPath } from "../../../../Types/AI/TelemetryAi";

/*
 * WHAT A RUNNER IS TOLD WHEN IT TAKES A REQUEST FROM CODE.
 *
 * Everything is derived from the run - never from what the Runner sends -
 * the way the GitHub recipes are: the repository is the run's own, the
 * branch to work on is the one the task's open pull request already has
 * (or a new one, named here), and the conversation is the task's earlier
 * turns, oldest first.
 *
 * Every text a person, a record or the AI wrote is redacted the way the AI
 * toolbox redacts what it gives a model, before it leaves the server: a
 * request's own words, its notes, the AI's earlier replies, an exception's
 * message and stack. Record snapshots were redacted when they were taken.
 * The conversation is capped, newest kept, so a long task cannot crowd the
 * code out of the prompt.
 */

export const MAX_CONVERSATION_LENGTH: number = 40000;
export const MAX_EARLIER_REPLY_LENGTH: number = 6000;
const MAX_ORIGIN_DETAIL_LENGTH: number = 6000;
// An insight's title, as the pull request names the finding.
const MAX_FINDING_LENGTH: number = 300;
const STACK_TRACE_LINES: number = 40;

export default class CodeTaskAgentBrief {
  @CaptureSpan()
  public static async build(data: {
    run: AIRun;
    repository: CodeRepository;
  }): Promise<CodeTaskAgentDetails> {
    const run: AIRun = data.run;
    const projectId: ObjectID = run.projectId!;

    const request: CodeTaskRequest | null = getCodeTaskRequest(run.taskContext);

    if (!request) {
      throw new Error("This task has no request.");
    }

    /*
     * The task is its first turn, and the conversation starts with it:
     * read with what the turns below are read with - what was asked
     * (taskContext) and what AI answered (taskOutcome) - or a reply's
     * brief would tell the AI that OneUptime started the task on its own,
     * and lose the branch the person picked.
     */
    const task: AIRun | null = await CodeTaskThread.findTask({
      projectId,
      taskId: run.codeTaskId || run.id!,
      select: {
        ...CODE_TASK_TURN_SELECT,
        taskContext: true,
        taskOutcome: true,
      },
    });

    if (!task) {
      throw new Error("This task no longer exists.");
    }

    const allTurns: Array<AIRun> = await CodeTaskThread.getTurns({
      projectId,
      task,
      select: {
        _id: true,
        codeFixTaskType: true,
        codeTaskId: true,
        createdAt: true,
        status: true,
        userId: true,
        errorMessage: true,
        taskContext: true,
        taskOutcome: true,
        triggeredByTelemetryExceptionId: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAiInsightId: true,
      },
    });

    // The turns before this one.
    const runIndex: number = allTurns.findIndex((turn: AIRun): boolean => {
      return turn.id!.toString() === run.id!.toString();
    });

    const earlierTurns: Array<AIRun> =
      runIndex >= 0 ? allTurns.slice(0, runIndex) : allTurns;

    const [pullRequests, people, subjects]: [
      Array<AIAgentTaskPullRequest>,
      Map<string, CodeTaskPersonJSON>,
      CodeTaskOriginSubjects,
    ] = await Promise.all([
      CodeTaskThread.getPullRequests({
        projectId,
        runIds: allTurns.map((turn: AIRun): ObjectID => {
          return turn.id!;
        }),
      }),
      CodeTaskThread.getPeople(
        allTurns
          .filter((turn: AIRun): boolean => {
            return Boolean(turn.userId);
          })
          .map((turn: AIRun): ObjectID => {
            return turn.userId!;
          }),
      ),
      // The Runner works for the task: what started it is named in full.
      CodeTaskOrigin.loadSubjects({
        projectId,
        runs: [task],
        props: { isRoot: true },
      }),
    ]);

    const workingPullRequest: AIAgentTaskPullRequest | null =
      CodeTaskThread.getWorkingPullRequest({
        pullRequests,
        codeRepositoryId: data.repository.id || undefined,
      });

    const conversation: Array<CodeTaskAgentTurn> = [];

    for (const turn of earlierTurns) {
      conversation.push(
        ...(await CodeTaskAgentBrief.describeTurn({
          turn,
          isFirst: turn.id!.toString() === task.id!.toString(),
          people,
          subjects,
          pullRequests,
        })),
      );
    }

    const capped: { turns: Array<CodeTaskAgentTurn>; omitted: number } =
      CodeTaskAgentBrief.capConversation(conversation);

    const taskIdShort: string = task.id!.toString().substring(0, 8);
    const turnIdShort: string = run.id!.toString().substring(0, 8);

    /*
     * The branch the task starts from: the one the person picked when they
     * asked, kept on its first turn, or the repository's main branch. It is
     * handed over as the main branch too, which every Runner clones and
     * branches from - one older than the pick works from it all the same.
     */
    const baseBranch: string | null =
      getCodeTaskRequest(task.taskContext)?.baseBranch || null;

    return {
      taskType: CodeFixTaskType.CodeRequest,
      taskId: task.id!.toString(),
      ...(task.taskNumber ? { taskNumber: task.taskNumber } : {}),
      taskTitle: await CodeTaskAgentBrief.getTaskTitle(task, subjects),
      taskUrl: `${DashboardClientUrl.toString()}/${projectId.toString()}/code/tasks/${task.id!.toString()}`,
      ...(run.userId && people.get(run.userId.toString())
        ? { requestedBy: people.get(run.userId.toString())!.name }
        : {}),
      ...CodeTaskAgentBrief.getStartedBy({ projectId, task, subjects }),
      repository: {
        id: data.repository.id!.toString(),
        name: data.repository.name || "",
        organizationName: data.repository.organizationName || "",
        repositoryName: data.repository.repositoryName || "",
        mainBranchName: baseBranch || data.repository.mainBranchName || "",
        setupCommand: data.repository.setupCommand || null,
        buildCommand: data.repository.buildCommand || null,
        testCommand: data.repository.testCommand || null,
      },
      workingBranch: workingPullRequest?.headRefName || null,
      pullRequest: workingPullRequest
        ? {
            number: workingPullRequest.pullRequestNumber || null,
            url: workingPullRequest.pullRequestUrl?.toString() || null,
            title: workingPullRequest.title || null,
            baseRefName: workingPullRequest.baseRefName || null,
          }
        : null,
      newBranchName: `oneuptime-task-${task.taskNumber || taskIdShort}-${turnIdShort}`,
      baseBranch,
      request: {
        message: CodeTaskAgentBrief.redact(request.message),
        context: request.context.map(
          (item: CodeTaskContextItem): CodeTaskAgentContextItem => {
            return CodeTaskAgentBrief.toAgentContextItem(item, true);
          },
        ),
      },
      conversation: capped.turns,
      omittedTurns: capped.omitted,
    };
  }

  /*
   * The problem OneUptime found that a task is about - the insight, whether
   * OneUptime started the task on its own or a person started it from the
   * insight - for the pull request's body to say, and the prompt, with a
   * link to where the Dashboard shows it (its lane's product for slow code).
   * Nothing for a task that is about no insight.
   */
  public static getStartedBy(data: {
    projectId: ObjectID;
    task: AIRun;
    subjects: CodeTaskOriginSubjects;
  }): Pick<CodeTaskAgentDetails, "startedBy"> {
    if (!CodeTaskOrigin.isAboutInsight(data.task)) {
      return {};
    }

    const insightId: string = data.task.triggeredByAiInsightId!.toString();
    const insight: AIInsight | undefined =
      data.subjects.insights?.get(insightId);

    return {
      startedBy: {
        finding: CodeTaskAgentBrief.cut(
          CodeTaskAgentBrief.redact(insight?.title || ""),
          MAX_FINDING_LENGTH,
        ),
        findingUrl: `${DashboardClientUrl.toString()}${getAiInsightDashboardPath(
          {
            projectId: data.projectId.toString(),
            insightId,
            insightType: insight?.insightType,
          },
        )}`,
      },
    };
  }

  // One earlier turn, as what the person said and what the AI answered.
  private static async describeTurn(data: {
    turn: AIRun;
    isFirst: boolean;
    people: Map<string, CodeTaskPersonJSON>;
    subjects: CodeTaskOriginSubjects;
    pullRequests: Array<AIAgentTaskPullRequest>;
  }): Promise<Array<CodeTaskAgentTurn>> {
    const turn: AIRun = data.turn;
    const turns: Array<CodeTaskAgentTurn> = [];
    const author: string | undefined = turn.userId
      ? data.people.get(turn.userId.toString())?.name
      : undefined;

    const request: CodeTaskRequest | null = CodeFixTaskTypeHelper.isCodeRequest(
      turn.codeFixTaskType,
    )
      ? getCodeTaskRequest(turn.taskContext)
      : null;

    if (request) {
      turns.push({
        role: "person",
        ...(author
          ? { author }
          : CodeTaskOrigin.isStartedByOneUptime(turn)
            ? { author: "OneUptime" }
            : {}),
        text: CodeTaskAgentBrief.redact(request.message),
        context: request.context.map(
          (item: CodeTaskContextItem): CodeTaskAgentContextItem => {
            // Earlier turns' records are named; this turn's are read in full.
            return CodeTaskAgentBrief.toAgentContextItem(item, false);
          },
        ),
      });
    } else if (data.isFirst) {
      turns.push({
        role: "person",
        text: await CodeTaskAgentBrief.describeOrigin({
          turn,
          subjects: data.subjects,
        }),
      });
    }

    turns.push({
      role: "ai",
      text: CodeTaskAgentBrief.describeReply({
        turn,
        pullRequests: data.pullRequests.filter(
          (pullRequest: AIAgentTaskPullRequest): boolean => {
            return pullRequest.aiRunId?.toString() === turn.id!.toString();
          },
        ),
      }),
    });

    return turns;
  }

  // How a task OneUptime started began, in words the AI can work from.
  private static async describeOrigin(data: {
    turn: AIRun;
    subjects: CodeTaskOriginSubjects;
  }): Promise<string> {
    const turn: AIRun = data.turn;
    const taskContext: CodeFixTaskContext | undefined = turn.taskContext;
    const origin: CodeTaskOriginJSON = CodeTaskOrigin.describe({
      run: turn,
      subjects: data.subjects,
      taskContext,
    });

    const lines: Array<string> = [
      `OneUptime started this task on its own (${CodeTaskAgentBrief.describeRecipe(
        turn.codeFixTaskType,
      )}).`,
    ];

    if (
      origin.type === CodeTaskOriginType.Exception &&
      turn.triggeredByTelemetryExceptionId
    ) {
      const exception: TelemetryException | null =
        await TelemetryExceptionService.findOneById({
          id: turn.triggeredByTelemetryExceptionId,
          select: { message: true, exceptionType: true, stackTrace: true },
          props: { isRoot: true },
        });

      if (exception) {
        lines.push(
          `The exception: ${exception.exceptionType || "Exception"}: ${sanitizeExceptionMessage(exception.message || "")}`,
        );

        const stackTrace: string = sanitizeStackTrace(
          exception.stackTrace || "",
        )
          .split("\n")
          .slice(0, STACK_TRACE_LINES)
          .join("\n");

        if (stackTrace.trim()) {
          lines.push(`Stack trace:\n${stackTrace}`);
        }
      }
    } else if (
      origin.type === CodeTaskOriginType.Incident ||
      origin.type === CodeTaskOriginType.Alert
    ) {
      lines.push(`It came from ${origin.type.toLowerCase()} ${origin.label}.`);

      const snapshot: InvestigationCodeFixTaskSnapshot | null =
        getInvestigationCodeFixTaskSnapshot(taskContext);

      if (snapshot) {
        lines.push(
          `The investigation's analysis:\n${CodeTaskAgentBrief.cut(
            snapshot.investigationAnalysisMarkdown,
            MAX_ORIGIN_DETAIL_LENGTH,
          )}`,
        );
      }
    } else if (origin.type === CodeTaskOriginType.Trace) {
      const findings: Array<string> = (
        taskContext?.performanceFindings || []
      ).map((finding: { headline: string }): string => {
        return `- ${finding.headline}`;
      });

      lines.push(
        `It came from a slow trace${taskContext?.serviceName ? ` in ${taskContext.serviceName}` : ""}.`,
      );

      if (findings.length > 0) {
        lines.push(`What was found:\n${findings.join("\n")}`);
      }
    } else if (origin.type === CodeTaskOriginType.Service) {
      lines.push(`It is about the service ${origin.label}.`);
    } else if (
      origin.type === CodeTaskOriginType.GitHubIssue ||
      origin.type === CodeTaskOriginType.GitHubPullRequest
    ) {
      const github: GitHubTaskContext | null =
        getGitHubTaskContext(taskContext);

      lines.push(
        `It came from GitHub ${origin.type === CodeTaskOriginType.GitHubIssue ? "issue" : "pull request"} ${origin.label}.`,
      );

      if (github?.instruction) {
        lines.push(`What was asked there: ${github.instruction}`);
      }
    }

    return CodeTaskAgentBrief.redact(
      CodeTaskAgentBrief.cut(lines.join("\n\n"), MAX_ORIGIN_DETAIL_LENGTH * 2),
    );
  }

  // What the AI answered in an earlier turn - or why it did not.
  private static describeReply(data: {
    turn: AIRun;
    pullRequests: Array<AIAgentTaskPullRequest>;
  }): string {
    const turn: AIRun = data.turn;
    const parts: Array<string> = [];

    if (turn.taskOutcome?.summary) {
      parts.push(
        CodeTaskAgentBrief.cut(
          turn.taskOutcome.summary,
          MAX_EARLIER_REPLY_LENGTH,
        ),
      );
    }

    for (const pullRequest of data.pullRequests) {
      parts.push(
        `Opened pull request #${pullRequest.pullRequestNumber || "?"}: ${pullRequest.title || ""}${
          pullRequest.description && !turn.taskOutcome?.summary
            ? `\n${PromptText.field(pullRequest.description, {
                maxLength: MAX_EARLIER_REPLY_LENGTH,
              })}`
            : ""
        }`,
      );
    }

    if (turn.taskOutcome?.filesChanged?.length) {
      parts.push(
        `Changed: ${turn.taskOutcome.filesChanged
          .slice(0, 30)
          .map((file: { path: string }): string => {
            return file.path;
          })
          .join(", ")}`,
      );
    }

    switch (turn.status) {
      case AIRunStatus.Error:
      case AIRunStatus.Stale:
        parts.push(
          `This turn failed${turn.errorMessage ? `: ${turn.errorMessage}` : "."}`,
        );
        break;
      case AIRunStatus.Cancelled:
        parts.push("This turn was stopped before it finished.");
        break;
      case AIRunStatus.NoFixFound:
        parts.push(
          turn.errorMessage
            ? `No change was made: ${turn.errorMessage}`
            : "No change was made.",
        );
        break;
      default:
        break;
    }

    if (parts.length === 0) {
      parts.push("(No reply was recorded for this turn.)");
    }

    return CodeTaskAgentBrief.redact(parts.join("\n\n"));
  }

  private static toAgentContextItem(
    item: CodeTaskContextItem,
    withContent: boolean,
  ): CodeTaskAgentContextItem {
    const agentItem: CodeTaskAgentContextItem = {
      type: item.type,
      label: CodeTaskAgentBrief.redact(item.label),
    };

    if (item.path) {
      agentItem.path = item.path;
    }

    if (item.url) {
      agentItem.url = item.url;
    }

    if (withContent) {
      if (item.type === CodeTaskContextType.Note && item.text) {
        agentItem.content = CodeTaskAgentBrief.redact(item.text);
      } else if (item.snapshot) {
        // Redacted when it was taken (CodeTaskContextBuilder).
        agentItem.content = item.snapshot;
      }
    }

    return agentItem;
  }

  /*
   * Keep the newest turns that fit, and say how many older ones were left
   * out. The first turn is always kept: it says what the task is about.
   */
  public static capConversation(turns: Array<CodeTaskAgentTurn>): {
    turns: Array<CodeTaskAgentTurn>;
    omitted: number;
  } {
    const lengthOf: (turn: CodeTaskAgentTurn) => number = (
      turn: CodeTaskAgentTurn,
    ): number => {
      return (
        turn.text.length +
        (turn.context || []).reduce(
          (sum: number, item: CodeTaskAgentContextItem): number => {
            return sum + item.label.length + (item.content?.length || 0);
          },
          0,
        )
      );
    };

    const total: number = turns.reduce(
      (sum: number, turn: CodeTaskAgentTurn) => {
        return sum + lengthOf(turn);
      },
      0,
    );

    if (total <= MAX_CONVERSATION_LENGTH || turns.length <= 2) {
      return { turns, omitted: 0 };
    }

    const first: CodeTaskAgentTurn = turns[0]!;
    let budget: number = MAX_CONVERSATION_LENGTH - lengthOf(first);
    const kept: Array<CodeTaskAgentTurn> = [];

    for (let index: number = turns.length - 1; index >= 1; index--) {
      const turn: CodeTaskAgentTurn = turns[index]!;
      const length: number = lengthOf(turn);

      if (length > budget) {
        break;
      }

      budget -= length;
      kept.unshift(turn);
    }

    return {
      turns: [first, ...kept],
      omitted: turns.length - 1 - kept.length,
    };
  }

  // A task's title: its request's, or what started it.
  private static async getTaskTitle(
    task: AIRun,
    subjects: CodeTaskOriginSubjects,
  ): Promise<string> {
    if (task.title) {
      return CodeTaskAgentBrief.redact(task.title);
    }

    let taskContext: CodeFixTaskContext | undefined = task.taskContext;

    if (taskContext === undefined && CodeTaskOrigin.needsTaskContext(task)) {
      const withContext: AIRun | null = await AIRunService.findOneById({
        id: task.id!,
        select: { _id: true, taskContext: true },
        props: { isRoot: true },
      });

      taskContext = withContext?.taskContext;
    }

    const origin: CodeTaskOriginJSON = CodeTaskOrigin.describe({
      run: task,
      subjects,
      taskContext,
    });

    return CodeTaskAgentBrief.redact(
      origin.label || CodeTaskAgentBrief.describeRecipe(task.codeFixTaskType),
    );
  }

  public static describeRecipe(
    taskType: CodeFixTaskType | string | undefined,
  ): string {
    switch (CodeFixTaskTypeHelper.fromDatabaseValue(taskType)) {
      case CodeFixTaskType.WriteRegressionTest:
        return "write a regression test for an exception";
      case CodeFixTaskType.ImproveExceptionHandling:
        return "improve how an exception is handled";
      case CodeFixTaskType.ImproveInstrumentation:
        return "add the instrumentation an investigation was missing";
      case CodeFixTaskType.ImproveLogging:
        return "improve a service's logging";
      case CodeFixTaskType.ImproveTracing:
        return "improve a service's tracing";
      case CodeFixTaskType.FixPerformance:
        return "fix a slow trace";
      case CodeFixTaskType.FixFromIncident:
        return "fix the cause an investigation found";
      case CodeFixTaskType.GitHubIssueFix:
        return "fix a GitHub issue";
      case CodeFixTaskType.GitHubPullRequestRevision:
        return "revise a GitHub pull request";
      case CodeFixTaskType.GitHubPullRequestReview:
        return "review a GitHub pull request";
      case CodeFixTaskType.CodeRequest:
        return "a request";
      case CodeFixTaskType.FixException:
      default:
        return "fix an exception";
    }
  }

  // Redacted the way the AI toolbox redacts what it gives a model.
  public static redact(text: string): string {
    return ToolResultSerializer.redactAndOmitEmbeddedData(text || "").text;
  }

  private static cut(text: string, max: number): string {
    return text.length > max
      ? `${text.substring(0, max)}\n… [truncated]`
      : text;
  }
}
