import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  getGitHubConversationNumber,
  getGitHubTaskContext,
  GitHubTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import GitHubCommandType from "../../../../Types/CodeRepository/GitHubCommand";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../Types/Date";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import FixRunBudget from "../../AI/CodeFix/FixRunBudget";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Turns a GitHub command that has ALREADY been verified — signed webhook,
 * repository bound to the project, commenter holds write access — into a
 * queued CodeFix AIRun the agent worker can claim.
 *
 * The sibling of SubjectCodeFixRun for conversations instead of incidents. It
 * enforces the same two things every enqueue path must: the project's daily
 * fix-run budget, and at most one live run per piece of work. What is
 * different is the dedupe key. An incident dedupes on its subject row; a
 * GitHub command has no row, so the key is (repository, issue-or-pull-request,
 * command) — which is exactly the granularity a user expects: asking for a
 * review while a revision is running is two different requests, asking for the
 * same review twice is one.
 */
export default class GitHubAgentTaskTrigger {
  // Which recipe carries out each command. Conversational commands have none.
  public static getTaskTypeForCommand(
    commandType: GitHubCommandType,
  ): CodeFixTaskType | null {
    switch (commandType) {
      case GitHubCommandType.Implement:
        return CodeFixTaskType.GitHubIssueFix;
      case GitHubCommandType.Revise:
        return CodeFixTaskType.GitHubPullRequestRevision;
      case GitHubCommandType.Review:
        return CodeFixTaskType.GitHubPullRequestReview;
      default:
        return null;
    }
  }

  /*
   * The live run, if any, for this exact piece of work.
   *
   * The conversation number lives inside the JSON taskContext, which the query
   * layer cannot filter on — so this reads the project's non-terminal GitHub
   * runs (bounded and short-lived: they exist only between a comment and its
   * pull request) and matches in memory. The same honest trade
   * SubjectCodeFixRun makes for its per-trace and per-service guards.
   */
  @CaptureSpan()
  public static async findNonTerminalRunForConversation(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    conversationNumber: number;
    taskType: CodeFixTaskType;
  }): Promise<AIRun | null> {
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: data.taskType,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, taskContext: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return (
      activeRuns.find((run: AIRun): boolean => {
        const github: GitHubTaskContext | null = getGitHubTaskContext(
          run.taskContext,
        );

        if (!github) {
          return false;
        }

        return (
          github.codeRepositoryId === data.codeRepositoryId.toString() &&
          getGitHubConversationNumber(github) === data.conversationNumber
        );
      }) || null
    );
  }

  /*
   * Every live run for one conversation, whatever the recipe — what "@oneuptime
   * cancel" acts on. A user cancelling a thread means "stop whatever you are
   * doing here", not "stop the one recipe I happen to name".
   */
  @CaptureSpan()
  public static async findNonTerminalRunsForConversation(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    conversationNumber: number;
  }): Promise<Array<AIRun>> {
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: QueryHelper.any(
          CodeFixTaskTypeHelper.getGitHubTaskTypes(),
        ),
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, taskContext: true, status: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return activeRuns.filter((run: AIRun): boolean => {
      const github: GitHubTaskContext | null = getGitHubTaskContext(
        run.taskContext,
      );

      if (!github) {
        return false;
      }

      return (
        github.codeRepositoryId === data.codeRepositoryId.toString() &&
        getGitHubConversationNumber(github) === data.conversationNumber
      );
    });
  }

  /*
   * Record the durable intent as a Queued CodeFix AIRun.
   *
   * Created as root: AIRun rows are server-written only (empty create ACL).
   * The caller must already have established that this command is allowed —
   * that the webhook signature verified, that the installation is bound to
   * the project, and that the commenter can write to the repository.
   *
   * Throws BadDataException when a run for this work is already live or when
   * the project is over its daily fix-run budget. The webhook handler turns
   * both into a plain-English reply in the thread rather than a silent drop:
   * a command that produces no visible response reads as a broken integration.
   */
  @CaptureSpan()
  public static async enqueueGitHubCodeFixRun(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    github: GitHubTaskContext;
  }): Promise<AIRun> {
    if (!CodeFixTaskTypeHelper.isGitHubTaskType(data.taskType)) {
      throw new BadDataException(
        `${data.taskType} is not a GitHub-triggered task type.`,
      );
    }

    const github: GitHubTaskContext | null = getGitHubTaskContext({
      github: data.github,
    } as CodeFixTaskContext);

    if (!github) {
      throw new BadDataException(
        "A GitHub run needs a repository and exactly one issue or pull request.",
      );
    }

    GitHubAgentTaskTrigger.assertTaskTypeMatchesContext(data.taskType, github);

    const conversationNumber: number = getGitHubConversationNumber(github);

    const existingRun: AIRun | null =
      await GitHubAgentTaskTrigger.findNonTerminalRunForConversation({
        projectId: data.projectId,
        codeRepositoryId: new ObjectID(github.codeRepositoryId),
        conversationNumber: conversationNumber,
        taskType: data.taskType,
      });

    if (existingRun) {
      throw new BadDataException(
        "I am already working on this — I will comment here when I am done.",
      );
    }

    await FixRunBudget.assertWithinBudget(data.projectId, {});

    const run: AIRun = new AIRun();
    run.projectId = data.projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = data.taskType;
    run.status = AIRunStatus.Queued;
    run.taskContext = { github: github };

    return AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }

  /*
   * A queued run must be EXECUTABLE by the recipe it names.
   *
   * getGitHubTaskContext proves the context is well formed; it does not prove
   * it matches the recipe. A revision with an issue-only context, or one with
   * no head branch pinned, passes every other check and is then claimed by a
   * worker that has nothing to push to — a run that was accepted, told the
   * user "on it", and could never have succeeded. Catch it at the boundary,
   * where the message can still be honest about what went wrong.
   */
  private static assertTaskTypeMatchesContext(
    taskType: CodeFixTaskType,
    github: GitHubTaskContext,
  ): void {
    if (taskType === CodeFixTaskType.GitHubIssueFix) {
      if (github.issueNumber === undefined) {
        throw new BadDataException(
          "A GitHub issue task needs an issue to work on.",
        );
      }

      return;
    }

    if (github.pullRequestNumber === undefined) {
      throw new BadDataException(
        "A GitHub pull request task needs a pull request to work on.",
      );
    }

    /*
     * Only a revision needs a branch. A review of a pull request from a fork
     * deliberately has none — it works from the base branch plus the diff.
     */
    if (
      taskType === CodeFixTaskType.GitHubPullRequestRevision &&
      !github.pullRequestHeadRefName
    ) {
      throw new BadDataException(
        "I cannot revise this pull request because its branch is not in this repository — it may come from a fork.",
      );
    }
  }

  /*
   * Record the app's acknowledgement comment on the run, so a later status
   * change edits that comment instead of posting another one.
   *
   * Written after the INSERT rather than as part of it because the comment
   * cannot exist before the run does — the comment links to the run's page.
   * A failure here is not worth failing the run over: the worst case is one
   * extra comment when the run finishes.
   *
   * The stored context is re-read and merged rather than overwritten from the
   * caller's in-memory copy. TypeORM replaces a jsonb column wholesale, so
   * writing the caller's object would clobber anything another writer put
   * there in between — a narrow window, but a lost update on a column the
   * outcome sweeper also touches.
   */
  @CaptureSpan()
  public static async recordAcknowledgementComment(data: {
    aiRunId: ObjectID;
    github: GitHubTaskContext;
    acknowledgementCommentId: number;
  }): Promise<void> {
    const run: AIRun | null = await AIRunService.findOneById({
      id: data.aiRunId,
      select: { _id: true, taskContext: true },
      props: { isRoot: true },
    });

    const storedContext: CodeFixTaskContext = run?.taskContext || {};

    await AIRunService.updateOneById({
      id: data.aiRunId,
      data: {
        taskContext: {
          ...storedContext,
          github: {
            ...data.github,
            ...(storedContext.github || {}),
            acknowledgementCommentId: data.acknowledgementCommentId,
          },
        },
      } as never,
      props: { isRoot: true },
    });
  }

  /*
   * Cancel every live run for a conversation.
   *
   * A Queued run is cancelled outright — no worker holds it. A Running one is
   * also marked Cancelled: the worker cannot be reached mid-run, but the CAS
   * transitions on the reporting endpoints mean its late Completed/Error
   * report simply loses the race and does not resurrect the run. The user gets
   * the honest answer either way, which is why the count is returned.
   */
  @CaptureSpan()
  public static async cancelRunsForConversation(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    conversationNumber: number;
  }): Promise<number> {
    const runs: Array<AIRun> =
      await GitHubAgentTaskTrigger.findNonTerminalRunsForConversation(data);

    let cancelledCount: number = 0;

    for (const run of runs) {
      if (!run.id || !run.status) {
        continue;
      }

      const transitioned: number = await AIRunService.attemptStatusTransition({
        aiRunId: run.id,
        fromStatus: run.status,
        set: {
          status: AIRunStatus.Cancelled,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: "Cancelled from GitHub.",
        },
      });

      cancelledCount += transitioned;
    }

    return cancelledCount;
  }
}
