import ObjectID from "Common/Types/ObjectID";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI, {
  RecordPullRequestOptions,
  RepositoryToken,
} from "../Utils/BackendAPI";
import { CodeTaskChanges, CodeTaskOutcomeReport } from "Common/Types/AI/CodeTask";
import PullRequestOpener from "../Utils/PullRequestOpener";
import { PullRequestResult } from "../Utils/PullRequestCreator";
import PushedBranches, { PushedBranch } from "../Utils/PushedBranches";
import RepositoryManager from "../Utils/RepositoryManager";
import { VerificationOutcome } from "../Utils/BuildVerification";

// Base interface for task result data
export interface TaskResultData {
  // Pull requests created (for Fix Exception tasks)
  pullRequests?: Array<string>;
  // Errors encountered during processing
  errors?: Array<string>;
  /*
   * True when the task could not finish — the run is reported as Error.
   * A task that ran fine but produced no pull request sets noFixFound
   * instead; see createNoFixResult.
   */
  isError?: boolean;
  /*
   * The task completed but had no fix to propose. Not a failure — the run is
   * reported as NoFixFound rather than Error.
   */
  noFixFound?: boolean;
  // Additional data fields
  [key: string]: unknown;
}

// Context provided to task handlers
export interface TaskContext {
  // Task identification (the id of the AIRun row on the server)
  taskId: ObjectID;
  projectId: ObjectID;
  /*
   * The wire discriminator from get-pending-task (e.g. "FixException",
   * "WriteRegressionTest"). Plain string — see Common/Types/AI/
   * CodeFixTaskType for the wire values.
   */
  taskType: string;

  /*
   * The exception this run should fix — present only for exception-based
   * recipes. ImproveInstrumentation / FixFromIncident runs have an
   * incident/alert subject instead and fetch their context by run id
   * (get-instrumentation-task-details).
   */
  exceptionId?: string | undefined;

  // Utilities
  logger: TaskLogger;
  backendAPI: BackendAPI;

  // Task timestamps
  startedAt: Date;

  /*
   * The records of pull requests the task opened but could not record
   * (recordOpenedPullRequest). They go with the task's Completed status, and
   * the server records them then.
   */
  unrecordedPullRequests?: Array<RecordPullRequestOptions> | undefined;

  /*
   * The branches the task pushed to repositories with no pull requests of
   * OneUptime's (a Git repository): reported as the run's outcome, so the
   * person learns where the change is and opens the pull request.
   */
  pushedBranches?: Array<PushedBranch> | undefined;
}

// Result returned by task handlers
export interface TaskResult {
  // Whether the task completed successfully
  success: boolean;

  // Human-readable message describing the result
  message: string;

  // Additional data about the result (optional)
  data?: TaskResultData;

  // Number of PRs created (for Fix Exception tasks)
  pullRequestsCreated?: number;

  // List of PR URLs created
  pullRequestUrls?: Array<string>;

  /*
   * What a request from Code ended with - the AI's reply, the files it
   * changed and their diff, where they went, and whether it asked a
   * question. Reported with the Completed status, for the conversation.
   */
  outcome?: CodeTaskOutcomeReport;
}

// Interface that all task handlers must implement
export interface TaskHandler {
  // The task-type string this handler processes (registry key)
  readonly taskType: string;

  // Human-readable name for the handler
  readonly name: string;

  // Execute the task and return a result
  execute(context: TaskContext): Promise<TaskResult>;

  // Check if this handler can process a given task
  canHandle(taskType: string): boolean;

  // Optional: Get a description of what this handler does
  getDescription?(): string;
}

// Abstract base class that provides common functionality for task handlers
export abstract class BaseTaskHandler implements TaskHandler {
  public abstract readonly taskType: string;
  public abstract readonly name: string;

  public abstract execute(context: TaskContext): Promise<TaskResult>;

  public canHandle(taskType: string): boolean {
    return taskType === this.taskType;
  }

  // Create a success result
  protected createSuccessResult(
    message: string,
    data?: TaskResultData,
  ): TaskResult {
    const result: TaskResult = {
      success: true,
      message,
    };

    if (data) {
      result.data = data;
    }

    return result;
  }

  // Create a failure result
  protected createFailureResult(
    message: string,
    data?: TaskResultData,
  ): TaskResult {
    const result: TaskResult = {
      success: false,
      message,
    };

    if (data) {
      result.data = data;
    }

    return result;
  }

  /*
   * Create a result for a task that ran to completion but had no fix to
   * propose. success is false because no pull request came out of it, but
   * isError is not set — the caller reports NoFixFound, not Error.
   */
  protected createNoFixResult(message: string): TaskResult {
    return {
      success: false,
      message,
      pullRequestsCreated: 0,
      data: {
        noFixFound: true,
      },
    };
  }

  /*
   * After a change is pushed: its pull request, opened where the repository's
   * host takes them (GitHub, GitLab, Forgejo, Gitea - PullRequestOpener) and
   * recorded; or - for a repository with none, a Git repository - the
   * pushed branch, kept on the context for the run's outcome. The address
   * of the pull request, or null for a pushed branch.
   */
  protected async finishPushedChange(
    context: TaskContext,
    data: {
      repositoryId: string;
      token: RepositoryToken;
      repositoryManager: RepositoryManager;
      repositoryPath: string;
      baseBranch: string;
      headBranch: string;
      title: string;
      body: string;
      summary: string;
      verification: VerificationOutcome;
    },
  ): Promise<string | null> {
    if (!PullRequestOpener.hasPullRequests(data.token)) {
      const changes: CodeTaskChanges =
        await data.repositoryManager.getLastCommitChanges(data.repositoryPath);

      const pushed: PushedBranch = PushedBranches.create({
        repositoryId: data.repositoryId,
        token: data.token,
        branchName: data.headBranch,
        baseBranchName: data.baseBranch,
        summary: data.summary,
        changes,
      });

      if (!context.pushedBranches) {
        context.pushedBranches = [];
      }

      context.pushedBranches.push(pushed);

      await this.log(context, PushedBranches.describe(pushed));

      return null;
    }

    await this.log(
      context,
      `Opening the ${PullRequestOpener.getPullRequestTerm(data.token)}...`,
    );

    const prResult: PullRequestResult = await new PullRequestOpener(
      context.logger,
    ).open({
      token: data.token,
      baseBranch: data.baseBranch,
      headBranch: data.headBranch,
      title: data.title,
      body: data.body,
    });

    await this.log(context, `Pull request created: ${prResult.htmlUrl}`);

    await this.recordOpenedPullRequest(context, {
      taskId: context.taskId.toString(),
      codeRepositoryId: data.repositoryId,
      pullRequestUrl: prResult.htmlUrl,
      pullRequestNumber: prResult.number,
      pullRequestId: prResult.id,
      title: prResult.title,
      description: data.body.substring(0, 1000),
      headRefName: data.headBranch,
      baseRefName: data.baseBranch,
      runnerVerificationStatus: data.verification.status,
      runnerVerificationSummary: data.verification.summary,
    });

    return prResult.htmlUrl;
  }

  /*
   * The result of a task that changed code: the pull requests it opened,
   * and the branches it pushed where there were none to open - with the
   * outcome that says where those are. Failures alongside are kept.
   */
  protected createChangedResult(data: {
    pullRequestUrls: Array<string>;
    pushedBranches: Array<PushedBranch>;
    errors: Array<string>;
  }): TaskResult {
    const resultData: TaskResultData = {
      pullRequests: data.pullRequestUrls,
    };

    if (data.pushedBranches.length > 0) {
      resultData["pushedBranches"] = data.pushedBranches.map(
        (branch: PushedBranch): string => {
          return `${branch.repositoryName}:${branch.branchName}`;
        },
      );
    }

    if (data.errors.length > 0) {
      resultData.errors = data.errors;
    }

    const messages: Array<string> = [];

    if (data.pullRequestUrls.length > 0) {
      messages.push(`Created ${data.pullRequestUrls.length} pull request(s)`);
    }

    if (data.pushedBranches.length > 0) {
      messages.push(
        `Pushed ${data.pushedBranches.length} branch(es) for a pull request to be opened on the Git server`,
      );
    }

    const result: TaskResult = {
      success: true,
      message: messages.join("; "),
      pullRequestsCreated: data.pullRequestUrls.length,
      pullRequestUrls: data.pullRequestUrls,
      data: resultData,
    };

    /*
     * A run that opened no pull request says where its pushed branches are,
     * as its outcome; one that opened some is read from them, as always.
     */
    if (data.pullRequestUrls.length === 0) {
      const outcome: CodeTaskOutcomeReport | null = PushedBranches.toOutcome(
        data.pushedBranches,
      );

      if (outcome) {
        result.outcome = outcome;
      }
    }

    return result;
  }

  /*
   * Record a pull request the task has ALREADY opened.
   *
   * A failure is logged, never thrown. The pull request exists on GitHub by
   * now, and failing the task over the bookkeeping told the person who asked
   * that the run had failed while its pull request sat open.
   *
   * The record is kept on the context instead, and goes with the task's
   * Completed status for the server to record then. Without a record the
   * open-PR cap never counts the pull request, the PR state sync never
   * tracks it, and the run's pages never list it.
   */
  protected async recordOpenedPullRequest(
    context: TaskContext,
    options: RecordPullRequestOptions,
  ): Promise<void> {
    try {
      await context.backendAPI.recordPullRequest(options);
    } catch (error) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);

      if (!context.unrecordedPullRequests) {
        context.unrecordedPullRequests = [];
      }

      context.unrecordedPullRequests.push(options);

      await this.log(
        context,
        `Opened ${options.pullRequestUrl} but could not record it: ${errorMessage} — keeping it for the run's Completed report`,
        "error",
      );
    }
  }

  // Log to the task logger
  protected async log(
    context: TaskContext,
    message: string,
    level: "info" | "debug" | "warning" | "error" = "info",
  ): Promise<void> {
    switch (level) {
      case "debug":
        await context.logger.debug(message);
        break;
      case "warning":
        await context.logger.warning(message);
        break;
      case "error":
        await context.logger.error(message);
        break;
      case "info":
      default:
        await context.logger.info(message);
        break;
    }
  }
}
