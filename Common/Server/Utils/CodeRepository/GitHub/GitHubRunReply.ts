import logger from "../../Logger";
import ObjectID from "../../../../Types/ObjectID";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import GitHubCommandType from "../../../../Types/CodeRepository/GitHubCommand";
import CodeFixTaskContext, {
  getGitHubConversationNumber,
  getGitHubTaskContext,
  GitHubTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import { DashboardClientUrl } from "../../../EnvironmentConfig";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRunService from "../../../Services/AIRunService";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import GitHubConversation, { GitHubReaction } from "./GitHubConversation";
import GitHubReplyComposer from "./GitHubReplyComposer";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";

/*
 * How a GitHub-triggered run talks back to the thread it came from.
 *
 * One command produces exactly ONE comment from this app, posted when the run
 * is accepted and EDITED as it finishes. That constraint is the whole design:
 * a long-running agent that appends a comment per state change turns a pull
 * request into a status log, and a reviewer stops reading it.
 *
 * The outcome is delivered by a sweeper rather than by whoever happened to
 * finalize the run. There are five places a run can reach a terminal
 * state — the worker reporting in, the stale-heartbeat sweeper, the orphaned-
 * queue sweeper, the claim-time executability guard, and an explicit cancel —
 * and a comment posted from only some of them is worse than none: the user
 * sees "on it" forever precisely in the cases where something went wrong.
 * `reportedToGitHubAt` on the run's own context makes the sweep idempotent,
 * so a GitHub outage costs a minute rather than the reply.
 */
export default class GitHubRunReply {
  public static buildRunUrl(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
  }): string {
    return `${DashboardClientUrl.toString()}/${data.projectId.toString()}/ai/agents/${data.aiRunId.toString()}`;
  }

  public static buildProjectRunsUrl(projectId: ObjectID): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/ai/agents`;
  }

  /*
   * Acknowledge a command in the thread: a reaction on the comment that asked
   * (instant, and unmistakably from this app) and one comment carrying the
   * link to the run.
   *
   * Best-effort by design. The run is already queued and will do its work
   * whether or not GitHub accepted the acknowledgement, and failing the
   * command because a comment did not post would be strictly worse for the
   * user than a quiet start.
   */
  @CaptureSpan()
  public static async acknowledge(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    projectName: string | undefined;
    github: GitHubTaskContext;
  }): Promise<number | null> {
    const conversationNumber: number = getGitHubConversationNumber(data.github);

    if (data.github.triggerCommentId) {
      await GitHubConversation.addReactionToComment({
        installationId: data.github.installationId,
        organizationName: data.github.organizationName,
        repositoryName: data.github.repositoryName,
        commentId: data.github.triggerCommentId,
        reaction: GitHubReaction.Eyes,
      });
    } else {
      await GitHubConversation.addReactionToIssue({
        installationId: data.github.installationId,
        organizationName: data.github.organizationName,
        repositoryName: data.github.repositoryName,
        issueNumber: conversationNumber,
        reaction: GitHubReaction.Eyes,
      });
    }

    try {
      const comment: { commentId: number } =
        await GitHubConversation.createIssueComment({
          installationId: data.github.installationId,
          organizationName: data.github.organizationName,
          repositoryName: data.github.repositoryName,
          issueNumber: conversationNumber,
          body: GitHubReplyComposer.acknowledgement({
            commandType: data.github.commandType,
            runUrl: GitHubRunReply.buildRunUrl({
              projectId: data.projectId,
              aiRunId: data.aiRunId,
            }),
            instruction: data.github.instruction,
            projectName: data.projectName,
          }),
        });

      return comment.commentId;
    } catch (error) {
      logger.error(
        `Could not post the GitHub acknowledgement for run ${data.aiRunId.toString()}: ${error}`,
      );
      return null;
    }
  }

  /*
   * Post the run's outcome, editing the acknowledgement when there is one.
   *
   * Returns true when GitHub accepted the write, so the caller can mark the
   * run reported. A false answer leaves the marker unset and the next sweep
   * tries again — which is what makes a GitHub outage recoverable instead of
   * silently losing the reply.
   */
  @CaptureSpan()
  public static async reportOutcome(data: {
    run: AIRun;
    github: GitHubTaskContext;
  }): Promise<boolean> {
    const aiRunId: ObjectID | null = data.run.id;
    const projectId: ObjectID | undefined = data.run.projectId;

    if (!aiRunId || !projectId) {
      return false;
    }

    const runUrl: string = GitHubRunReply.buildRunUrl({
      projectId: projectId,
      aiRunId: aiRunId,
    });

    const body: string = await GitHubRunReply.composeOutcomeBody({
      run: data.run,
      github: data.github,
      runUrl: runUrl,
    });

    const postFresh: () => Promise<void> = async (): Promise<void> => {
      await GitHubConversation.createIssueComment({
        installationId: data.github.installationId,
        organizationName: data.github.organizationName,
        repositoryName: data.github.repositoryName,
        issueNumber: getGitHubConversationNumber(data.github),
        body: body,
      });
    };

    try {
      if (data.github.acknowledgementCommentId) {
        try {
          await GitHubConversation.updateIssueComment({
            installationId: data.github.installationId,
            organizationName: data.github.organizationName,
            repositoryName: data.github.repositoryName,
            commentId: data.github.acknowledgementCommentId,
            body: body,
          });
        } catch (updateError) {
          /*
           * The acknowledgement is gone — someone deleted it, which is an
           * ordinary thing to do to a bot comment. Without this fallback the
           * edit 404s forever: the outcome is never delivered, the run is
           * never marked reported, and the sweep retries the same doomed write
           * every minute until it ages out. A second comment is a far better
           * outcome than silence.
           */
          logger.info(
            `Could not edit the acknowledgement comment for run ${aiRunId.toString()} (${updateError}); posting the outcome as a new comment.`,
          );

          await postFresh();
        }
      } else {
        await postFresh();
      }
    } catch (error) {
      logger.warn(
        `Could not post the GitHub outcome for run ${aiRunId.toString()}: ${error}`,
      );
      return false;
    }

    /*
     * The reaction is a nicety and must never decide whether we reported —
     * the comment has already landed by this point, and re-posting it on the
     * next sweep because a reaction failed would be a duplicate. Wrapped as
     * well as swallowed inside addReactionToComment, so this stays true even
     * if that contract ever changes.
     */
    if (data.github.triggerCommentId) {
      try {
        await GitHubConversation.addReactionToComment({
          installationId: data.github.installationId,
          organizationName: data.github.organizationName,
          repositoryName: data.github.repositoryName,
          commentId: data.github.triggerCommentId,
          reaction:
            data.run.status === AIRunStatus.Completed
              ? GitHubReaction.Rocket
              : GitHubReaction.Confused,
        });
      } catch (reactionError) {
        logger.debug(`Could not add the outcome reaction: ${reactionError}`);
      }
    }

    return true;
  }

  private static async composeOutcomeBody(data: {
    run: AIRun;
    github: GitHubTaskContext;
    runUrl: string;
  }): Promise<string> {
    if (data.run.status === AIRunStatus.Cancelled) {
      /*
       * Not GitHubReplyComposer.cancelled — that one answers the person who
       * typed "cancel" and counts what it stopped across the thread. THIS
       * comment is one run's own acknowledgement being closed out, and three
       * cancelled runs must not each announce "cancelled 1 run on this
       * thread". It also carries the run link, which is the one outcome where
       * a reader most wants to see how far it got.
       */
      return GitHubReplyComposer.cancelledRun({ runUrl: data.runUrl });
    }

    if (data.run.status === AIRunStatus.NoFixFound) {
      return GitHubReplyComposer.noChangeProposed({
        reason: data.run.errorMessage,
        runUrl: data.runUrl,
      });
    }

    if (data.run.status !== AIRunStatus.Completed) {
      return GitHubReplyComposer.failed({
        reason: data.run.errorMessage,
        runUrl: data.runUrl,
      });
    }

    return GitHubReplyComposer.completed({
      commandType: data.github.commandType,
      runUrl: data.runUrl,
      resultLines: await GitHubRunReply.buildResultLines(data),
    });
  }

  /*
   * What the run actually produced, in the reader's terms.
   *
   * A revision and a review deliberately do NOT list pull request links: the
   * revision pushed to the pull request the comment is already on, and the
   * review is right there in the thread. Linking a reader to the page they
   * are reading is noise.
   */
  private static async buildResultLines(data: {
    run: AIRun;
    github: GitHubTaskContext;
  }): Promise<Array<string>> {
    if (data.github.commandType === GitHubCommandType.Revise) {
      return [
        "I pushed my changes to this pull request's branch. Please re-review the new commits.",
      ];
    }

    if (data.github.commandType === GitHubCommandType.Review) {
      return ["My review is posted on this pull request."];
    }

    const pullRequests: Array<AIAgentTaskPullRequest> =
      await AIAgentTaskPullRequestService.findBy({
        query: { aiRunId: data.run.id! },
        select: { pullRequestUrl: true, pullRequestNumber: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    if (pullRequests.length === 0) {
      return ["The run finished, but it did not record a pull request."];
    }

    return pullRequests.map((pullRequest: AIAgentTaskPullRequest) => {
      const url: string = pullRequest.pullRequestUrl?.toString() || "";

      return pullRequest.pullRequestNumber
        ? `Opened #${pullRequest.pullRequestNumber} — ${url}`
        : `Opened a pull request — ${url}`;
    });
  }

  /*
   * Mark a run as having reported to GitHub.
   *
   * Written back into the run's own taskContext rather than a new column: the
   * marker is meaningless without the conversation it belongs to, and a column
   * would need a migration to say something the JSON already can.
   *
   * The whole taskContext is spread back in. TypeORM writes a jsonb column by
   * REPLACING it, so writing `{ github: ... }` alone would silently drop every
   * sibling key — traceId, serviceName, telemetryServiceId, the pinned
   * investigation snapshot. A GitHub run happens to carry none of those today,
   * which is exactly why this would go unnoticed until the first recipe that
   * does.
   */
  @CaptureSpan()
  public static async markReported(data: {
    aiRunId: ObjectID;
    taskContext: CodeFixTaskContext | undefined;
    github: GitHubTaskContext;
  }): Promise<void> {
    await AIRunService.updateOneById({
      id: data.aiRunId,
      data: {
        taskContext: {
          ...(data.taskContext || {}),
          github: {
            ...data.github,
            reportedToGitHubAt: new Date().toISOString(),
          },
        },
      } as never,
      props: { isRoot: true },
    });
  }

  /*
   * Mark a run whose GitHub context is unusable, so the sweep stops
   * re-selecting it.
   *
   * These exist: the claim guard fails a run with an incomplete context, which
   * makes it terminal with the same incomplete context still on it. Without a
   * marker, the sweep picks it up, finds nothing it can report, and does that
   * again every minute for twenty-four hours. Nothing reads a malformed
   * context for anything else, so stamping the marker onto whatever is there
   * is safe — and it is the only way to say "considered, cannot be reported".
   */
  @CaptureSpan()
  public static async markUnreportable(data: {
    aiRunId: ObjectID;
    taskContext: CodeFixTaskContext | undefined;
  }): Promise<void> {
    await AIRunService.updateOneById({
      id: data.aiRunId,
      data: {
        taskContext: {
          ...(data.taskContext || {}),
          github: {
            ...((data.taskContext?.github || {}) as Partial<GitHubTaskContext>),
            reportedToGitHubAt: new Date().toISOString(),
          },
        },
      } as never,
      props: { isRoot: true },
    });
  }

  /*
   * Whether a run's GitHub context is present but already reported. Separates
   * "nothing to do" from "cannot be done", which the sweep has to treat
   * differently — see markUnreportable.
   */
  public static hasReportableContext(run: AIRun): boolean {
    return Boolean(getGitHubTaskContext(run.taskContext as CodeFixTaskContext));
  }

  // A run whose conversation is still waiting to hear how it went.
  public static needsOutcomeReport(run: AIRun): GitHubTaskContext | null {
    const github: GitHubTaskContext | null = getGitHubTaskContext(
      run.taskContext as CodeFixTaskContext,
    );

    if (!github || github.reportedToGitHubAt) {
      return null;
    }

    return github;
  }

  /*
   * A one-line description of a live run, for "@mention status".
   *
   * Deliberately terse and free of internal vocabulary: someone reading a pull
   * request wants "revising this pull request (started 4 minutes ago)", not a
   * run id and an enum.
   */
  public static describeLiveRun(run: AIRun): string {
    const github: GitHubTaskContext | null = getGitHubTaskContext(
      run.taskContext as CodeFixTaskContext,
    );

    const what: string = github
      ? GitHubRunReply.describeCommandForStatus(github.commandType)
      : "working";

    return run.status === AIRunStatus.Queued
      ? `${what} — queued, waiting for an agent`
      : `${what} — in progress`;
  }

  private static describeCommandForStatus(
    commandType: GitHubCommandType,
  ): string {
    switch (commandType) {
      case GitHubCommandType.Review:
        return "Reviewing this pull request";
      case GitHubCommandType.Revise:
        return "Revising this pull request";
      case GitHubCommandType.Implement:
        return "Working on this issue";
      default:
        return "Working";
    }
  }
}
