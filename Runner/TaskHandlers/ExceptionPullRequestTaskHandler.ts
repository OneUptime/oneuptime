import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
  TaskResultData,
} from "./TaskHandlerInterface";
import {
  ExceptionDetails,
  CodeRepositoryInfo,
  RepositoryToken,
} from "../Utils/BackendAPI";
import RepositoryManager, {
  RepositoryConfig,
  CloneResult,
} from "../Utils/RepositoryManager";
import PullRequestCreator, {
  PullRequestResult,
} from "../Utils/PullRequestCreator";
import BuildVerification, {
  VerificationOutcome,
} from "../Utils/BuildVerification";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import WorkspaceManager, { WorkspaceInfo } from "../Utils/WorkspaceManager";
import {
  CodeAgentFactory,
  CodeAgent,
  CodeAgentTask,
  CodeAgentResult,
  CodeAgentProgressEvent,
  CodeAgentLLMConfig,
} from "../CodeAgents/Index";

/*
 * Shared pipeline for exception-driven tasks that end in a pull request:
 * exception details -> resolve repo -> clone -> code agent -> commit ->
 * push -> PR. Subclasses (FixException, WriteRegressionTest) only supply
 * the code-agent prompt and the branch / commit / PR wording.
 */
export default abstract class ExceptionPullRequestTaskHandler extends BaseTaskHandler {
  // Default timeout for code agent execution (30 minutes)
  protected static readonly CODE_AGENT_TIMEOUT_MS: number = 30 * 60 * 1000;

  // Branch names are `<branchPrefix><first 8 chars of the task id>`.
  protected abstract readonly branchPrefix: string;

  /*
   * Whether this recipe's output should be handed to the build/test
   * verification loop. Default true.
   *
   * WriteRegressionTest overrides it to false: that recipe deliberately
   * writes a test that MUST FAIL on current code (it proves the bug), so
   * verification would see a red suite and hand the agent a repair prompt
   * telling it to make the tests pass — destroying the recipe's entire
   * output, then labeling the PR as failed anyway.
   */
  protected readonly runsVerification: boolean = true;

  /*
   * What the pull request says about verification when this recipe opts
   * out. Subclasses that set runsVerification=false should explain why.
   */
  protected readonly verificationSkippedMessage: string =
    "Not verified — this task type is excluded from the build and test verification loop.";

  // Failure message when no repository yielded a pull request.
  protected abstract readonly noActionMessage: string;

  // Build the prompt for the code agent.
  protected abstract buildPrompt(
    exceptionDetails: ExceptionDetails,
    servicePathInRepository: string | null,
  ): string;

  // Build the commit message for the change.
  protected abstract buildCommitMessage(
    exceptionDetails: ExceptionDetails,
  ): string;

  // Build the pull request title.
  protected abstract buildPullRequestTitle(
    exceptionDetails: ExceptionDetails,
  ): string;

  // Build the pull request body.
  protected abstract buildPullRequestBody(
    exceptionDetails: ExceptionDetails,
    agentSummary: string,
  ): string;

  public async execute(context: TaskContext): Promise<TaskResult> {
    /*
     * exceptionId is optional on TaskContext (instrumentation runs carry an
     * incident/alert subject instead), but every recipe built on THIS
     * pipeline is exception-driven — fail clearly rather than calling the
     * exception endpoints with undefined.
     */
    const exceptionId: string | undefined = context.exceptionId;

    if (!exceptionId) {
      return this.createFailureResult(
        `${this.name} requires a telemetry exception, but the claimed task carries none.`,
        { isError: true },
      );
    }

    await this.log(
      context,
      `Starting ${this.name} for exception: ${exceptionId} (taskId: ${context.taskId.toString()})`,
    );

    let workspace: WorkspaceInfo | null = null;

    try {
      /*
       * Step 1: LLM access. The agent needs NO provider config on the
       * worker — its completions are server-mediated and metered (B4 Tier
       * 0), so no provider secret ever reaches this process.
       */
      await this.log(
        context,
        "Using server-mediated, metered LLM completions (no provider key on this worker)",
      );

      // Step 2: Get exception details
      await this.log(context, "Fetching exception details...");
      const exceptionDetails: ExceptionDetails =
        await context.backendAPI.getExceptionDetails(exceptionId);

      await this.log(
        context,
        `Exception: ${exceptionDetails.exception.message.substring(0, 100)}...`,
      );

      if (exceptionDetails.service) {
        await this.log(context, `Service: ${exceptionDetails.service.name}`);
      }

      /*
       * Step 3: Resolve the repository — the server matches the exception's
       * stack-trace files against the project's connected repos at runtime.
       * No Service Catalog link is required.
       */
      await this.log(context, "Resolving the repository for this exception...");
      const repositories: Array<CodeRepositoryInfo> =
        await context.backendAPI.getCodeRepositories(exceptionId);

      if (repositories.length === 0) {
        await this.log(
          context,
          "Could not resolve a repository for this exception",
          "error",
        );
        return this.createFailureResult(
          "Could not resolve a repository for this exception: its stack-trace files were not found in any connected repository, no repository name matches the service, and the project has more than one repository. Connect the right repository through the GitHub App.",
          { isError: true },
        );
      }

      await this.log(
        context,
        `Found ${repositories.length} linked code repository(ies)`,
      );

      // Step 4: Create workspace for the task
      workspace = await WorkspaceManager.createWorkspace(
        context.taskId.toString(),
      );
      await this.log(context, `Created workspace: ${workspace.workspacePath}`);

      // Step 5: Process each repository
      const pullRequestUrls: Array<string> = [];
      const errors: Array<string> = [];

      for (const repo of repositories) {
        try {
          await this.log(
            context,
            `Processing repository: ${repo.organizationName}/${repo.repositoryName}`,
          );

          const prUrl: string | null = await this.processRepository(
            context,
            repo,
            exceptionDetails,
            workspace,
          );

          if (prUrl) {
            pullRequestUrls.push(prUrl);
          }
        } catch (error) {
          const errorMessage: string =
            error instanceof Error ? error.message : String(error);
          errors.push(
            `${repo.organizationName}/${repo.repositoryName}: ${errorMessage}`,
          );
          await this.log(
            context,
            `Failed to process repository ${repo.organizationName}/${repo.repositoryName}: ${errorMessage}`,
            "error",
          );
          // Continue with next repository
        }
      }

      // Step 6: Return result
      if (pullRequestUrls.length > 0) {
        await this.log(
          context,
          `Successfully created ${pullRequestUrls.length} pull request(s)`,
        );

        const resultData: TaskResultData = {
          pullRequests: pullRequestUrls,
        };

        if (errors.length > 0) {
          resultData.errors = errors;
        }

        return {
          success: true,
          message: `Created ${pullRequestUrls.length} pull request(s)`,
          pullRequestsCreated: pullRequestUrls.length,
          pullRequestUrls,
          data: resultData,
        };
      }

      /*
       * No PRs created. Two very different outcomes reach here: repositories
       * that actually blew up (an error worth surfacing in red), and a clean
       * run that simply found nothing worth changing (a legitimate negative
       * result). Only the former is an Error.
       */
      if (errors.length > 0) {
        const failureMessage: string = `${this.noActionMessage}. Errors: ${errors.join("; ")}`;
        await this.log(context, failureMessage, "error");
        return this.createFailureResult(failureMessage, {
          isError: true,
          errors,
        });
      }

      await this.log(context, this.noActionMessage, "warning");
      return this.createNoFixResult(this.noActionMessage);
    } catch (error) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);
      await this.log(context, `Task failed: ${errorMessage}`, "error");
      // Mark as an actual error (not just "no action taken") so task gets Error status
      return this.createFailureResult(errorMessage, { isError: true });
    } finally {
      // Cleanup workspace
      if (workspace) {
        await this.log(context, "Cleaning up workspace...");
        await WorkspaceManager.deleteWorkspace(workspace.workspacePath);
      }

      // Flush logs
      await context.logger.flush();
    }
  }

  // Process a single repository
  private async processRepository(
    context: TaskContext,
    repo: CodeRepositoryInfo,
    exceptionDetails: ExceptionDetails,
    workspace: WorkspaceInfo,
  ): Promise<string | null> {
    // Get access token for the repository
    await this.log(
      context,
      `Getting access token for ${repo.organizationName}/${repo.repositoryName}...`,
    );

    const tokenData: RepositoryToken =
      await context.backendAPI.getRepositoryToken(repo.id);

    // Clone the repository
    await this.log(
      context,
      `Cloning repository ${repo.organizationName}/${repo.repositoryName}...`,
    );

    const repoConfig: RepositoryConfig = {
      organizationName: tokenData.organizationName,
      repositoryName: tokenData.repositoryName,
      token: tokenData.token,
      repositoryUrl: tokenData.repositoryUrl,
    };

    const repoManager: RepositoryManager = new RepositoryManager(
      context.logger,
    );
    const cloneResult: CloneResult = await repoManager.cloneRepository(
      repoConfig,
      workspace.workspacePath,
    );

    // Create a working branch
    const branchName: string = `${this.branchPrefix}${context.taskId.toString().substring(0, 8)}`;
    await this.log(context, `Creating branch: ${branchName}`);
    await repoManager.createBranch(cloneResult.repositoryPath, branchName);

    // Build the prompt for the code agent
    const prompt: string = this.buildPrompt(
      exceptionDetails,
      repo.servicePathInRepository,
    );

    // Initialize code agent
    await this.log(context, "Initializing code agent...");
    const agent: CodeAgent = CodeAgentFactory.createDefaultAgent();
    const agentConfig: CodeAgentLLMConfig = {
      // The agent's completions are validated against this run.
      taskId: context.taskId.toString(),
    };

    await agent.initialize(agentConfig, context.logger);

    // Set up progress callback to log agent output
    agent.onProgress((event: CodeAgentProgressEvent) => {
      context.logger.logProcessOutput("CodeAgent", event.message);
    });

    // Execute the code agent
    await this.log(context, "Running code agent...");
    const codeAgentTask: CodeAgentTask = {
      workingDirectory: cloneResult.repositoryPath,
      prompt,
      timeoutMs: ExceptionPullRequestTaskHandler.CODE_AGENT_TIMEOUT_MS,
    };

    if (repo.servicePathInRepository) {
      codeAgentTask.servicePath = repo.servicePathInRepository;
    }

    const agentResult: CodeAgentResult = await agent.executeTask(codeAgentTask);

    // Check if any changes were made
    if (!agentResult.success || agentResult.filesModified.length === 0) {
      await this.log(
        context,
        `Code agent did not make any changes: ${agentResult.error || agentResult.summary}`,
        "warning",
      );
      await agent.cleanup();
      return null;
    }

    await this.log(
      context,
      `Code agent modified ${agentResult.filesModified.length} file(s)`,
    );

    /*
     * Verification loop ("tests green before the PR"): run the
     * repository's configured setup/build/test commands against the
     * agent's changes, feeding failures back to the agent for bounded
     * repair passes. Runs BEFORE commit so repair edits land in the same
     * commit; a fix that still fails opens as a clearly-labeled PR rather
     * than being thrown away.
     *
     * Recipes whose output is SUPPOSED to fail the suite opt out — see
     * runsVerification.
     */
    const verification: VerificationOutcome = this.runsVerification
      ? await BuildVerification.verifyWithRepairs({
          repo,
          repositoryPath: cloneResult.repositoryPath,
          agent,
          originalPrompt: prompt,
          servicePath: repo.servicePathInRepository || undefined,
          log: async (message: string): Promise<void> => {
            await this.log(context, message);
          },
        })
      : {
          status: FixVerificationStatus.Skipped,
          summary: this.verificationSkippedMessage,
          repairAttemptsUsed: 0,
          repairSummaries: [],
          repairPaths: [],
        };

    /*
     * Stage an explicit pathspec, never `git add -A`: the repository's own
     * build/test commands just ran in this workspace, and whatever they
     * emitted (build output, caches, lockfile churn) must not be committed
     * as part of the fix. agentResult.filesModified was captured before any
     * command ran; repairPaths covers what the repair passes added after.
     */
    await this.log(context, "Committing changes...");
    await repoManager.addPaths(cloneResult.repositoryPath, [
      ...agentResult.filesModified,
      ...verification.repairPaths,
    ]);

    const commitMessage: string = this.buildCommitMessage(exceptionDetails);
    await repoManager.commitChanges(cloneResult.repositoryPath, commitMessage);

    // Push the branch
    await this.log(context, `Pushing branch ${branchName}...`);
    await repoManager.pushBranch(
      cloneResult.repositoryPath,
      branchName,
      repoConfig,
    );

    // Create pull request
    await this.log(context, "Creating pull request...");
    const prCreator: PullRequestCreator = new PullRequestCreator(
      context.logger,
    );

    const prTitle: string = this.buildPullRequestTitle(exceptionDetails);

    const prBody: string =
      this.buildPullRequestBody(exceptionDetails, agentResult.summary) +
      BuildVerification.buildPullRequestBodySection(verification);

    const prResult: PullRequestResult = await prCreator.createPullRequest({
      token: tokenData.token,
      organizationName: tokenData.organizationName,
      repositoryName: tokenData.repositoryName,
      baseBranch: repo.mainBranchName || "main",
      headBranch: branchName,
      title: prTitle,
      body: prBody,
    });

    await this.log(context, `Pull request created: ${prResult.htmlUrl}`);

    // Record the PR in the backend
    await context.backendAPI.recordPullRequest({
      taskId: context.taskId.toString(),
      codeRepositoryId: repo.id,
      pullRequestUrl: prResult.htmlUrl,
      pullRequestNumber: prResult.number,
      pullRequestId: prResult.id,
      title: prResult.title,
      description: prBody.substring(0, 1000),
      headRefName: branchName,
      baseRefName: repo.mainBranchName || "main",
      runnerVerificationStatus: verification.status,
      runnerVerificationSummary: verification.summary,
    });

    // Cleanup agent
    await agent.cleanup();

    return prResult.htmlUrl;
  }
}
