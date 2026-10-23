import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
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
import { PushedBranch } from "../Utils/PushedBranches";
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

  /*
   * Whether the code agent may query the repository's production telemetry
   * while it works (CodeAgentTask.productionTelemetry). FixException does;
   * the server offers the tools to the fixes of an exception, a slow trace
   * and an incident only.
   */
  protected readonly usesProductionTelemetry: boolean = false;

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
          "Could not resolve a repository for this exception: its stack-trace files were not found in any connected repository, no repository name matches the service, and the project has more than one repository. Connect the right repository in Code.",
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

      /*
       * Step 6: Return result. A branch pushed to a repository with no pull
       * requests (a Git repository) is a change too: the run says where it
       * is, rather than that it found no fix.
       */
      const pushedBranches: Array<PushedBranch> = context.pushedBranches || [];

      if (pullRequestUrls.length > 0 || pushedBranches.length > 0) {
        await this.log(
          context,
          `Successfully created ${pullRequestUrls.length} pull request(s)${
            pushedBranches.length > 0
              ? ` and pushed ${pushedBranches.length} branch(es)`
              : ""
          }`,
        );

        return this.createChangedResult({
          pullRequestUrls,
          pushedBranches,
          errors,
        });
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

    /*
     * The run's id goes with the token request, so the server links the
     * run to the repository it found (the task then shows on that
     * repository's page in Code) - the open pull request cap still applies.
     */
    const tokenData: RepositoryToken =
      await context.backendAPI.getRepositoryToken(
        repo.id,
        context.taskId.toString(),
      );

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
      baseBranch: repo.mainBranchName || undefined,
      ...(tokenData.codeHost ? { codeHost: tokenData.codeHost } : {}),
    };

    const repoManager: RepositoryManager = new RepositoryManager(
      context.logger,
    );
    const cloneResult: CloneResult = await repoManager.cloneRepository(
      repoConfig,
      workspace.workspacePath,
    );

    /*
     * The base is what git actually checked out, not the stored column.
     * When mainBranchName has gone stale — the repository was renamed from
     * master to main, or the record predates a default-branch change — the
     * clone falls back to the remote's real default, and targeting the
     * stale name would either be rejected by GitHub or produce a pull
     * request whose diff is every commit between the two branches rather
     * than the fix.
     */
    const baseBranch: string = cloneResult.baseBranch;

    // Create a working branch
    const branchName: string = `${this.branchPrefix}${context.taskId.toString().substring(0, 8)}`;
    await this.log(
      context,
      `Creating branch: ${branchName} (from ${baseBranch})`,
    );
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

    if (this.usesProductionTelemetry) {
      codeAgentTask.productionTelemetry = true;
    }

    /*
     * A recipe out of the verification loop is out of the agent's own
     * checks too: a regression test is written to fail, and "fix what
     * fails" would undo it.
     */
    if (!this.runsVerification) {
      codeAgentTask.skipsChangeChecks = true;
    }

    const agentResult: CodeAgentResult = await agent.executeTask(codeAgentTask);

    /*
     * A code agent that FAILED and a code agent that ran fine but found
     * nothing to change are opposite outcomes, and collapsing them tells
     * the user the wrong thing about their own system. The agent only
     * reports success:false on a hard failure — the server was unreachable,
     * the run's LLM budget was exhausted, the task timed out, it was
     * aborted. Reporting that as "no fix found" presents an outage as a
     * considered verdict, and hides it from anyone watching for errors.
     *
     * So: a failure is thrown, which the caller collects into `errors` and
     * reports as Error. Only a clean run with an empty diff returns null,
     * which becomes NoFixFound.
     */
    if (!agentResult.success) {
      await agent.cleanup();
      throw new Error(
        `The code agent could not complete: ${
          agentResult.error || agentResult.summary || "unknown error"
        }`,
      );
    }

    if (agentResult.filesModified.length === 0) {
      await this.log(
        context,
        `Code agent completed without changing any files: ${agentResult.summary}`,
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

    /*
     * Open the pull (or merge) request where the repository's host takes
     * them, and record it; a Git repository's pushed branch is kept for the
     * run's outcome instead.
     */
    const prTitle: string = this.buildPullRequestTitle(exceptionDetails);

    const prBody: string =
      this.buildPullRequestBody(exceptionDetails, agentResult.summary) +
      BuildVerification.buildPullRequestBodySection(verification);

    const prUrl: string | null = await this.finishPushedChange(context, {
      repositoryId: repo.id,
      token: tokenData,
      repositoryManager: repoManager,
      repositoryPath: cloneResult.repositoryPath,
      baseBranch,
      headBranch: branchName,
      title: prTitle,
      body: prBody,
      summary: agentResult.summary,
      verification,
    });

    // Cleanup agent
    await agent.cleanup();

    return prUrl;
  }
}
