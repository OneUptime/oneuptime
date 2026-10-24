import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
} from "./TaskHandlerInterface";
import {
  SubjectTaskDetails,
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
 * Shared pipeline for the incident/alert-subject recipes that end in a pull
 * request (ImproveInstrumentation, FixFromIncident) — the sibling of
 * ExceptionPullRequestTaskHandler for recipes with NO telemetry exception:
 * subject task details (by run id) -> server-resolved repo (no stack
 * trace: name-match / only-repository fallbacks) -> clone -> code agent ->
 * commit -> push -> PR. Subclasses only supply the code-agent prompt and
 * the branch / commit / PR wording.
 */
export default abstract class SubjectPullRequestTaskHandler extends BaseTaskHandler {
  // Default timeout for code agent execution (30 minutes)
  protected static readonly CODE_AGENT_TIMEOUT_MS: number = 30 * 60 * 1000;

  // Single-line subject-title length caps for commit subjects / PR titles.
  protected static readonly COMMIT_SUBJECT_TITLE_LENGTH: number = 50;
  protected static readonly PR_TITLE_SUBJECT_LENGTH: number = 70;

  // The embedded analysis in PR bodies is truncated to keep the PR readable.
  protected static readonly PR_BODY_ANALYSIS_LENGTH: number = 6000;

  // Branch names are `<branchPrefix><first 8 chars of the task id>`.
  protected abstract readonly branchPrefix: string;

  // Failure message when no repository yielded a pull request.
  protected abstract readonly noActionMessage: string;

  /*
   * Whether the code agent may query the repository's production telemetry
   * while it works (CodeAgentTask.productionTelemetry). FixPerformance and
   * FixFromIncident do; the server offers the tools to the fixes of an
   * exception, a slow trace and an incident only.
   */
  protected readonly usesProductionTelemetry: boolean = false;

  /*
   * Failure message when the server resolved no repository AND sent no
   * resolutionError guidance of its own.
   */
  protected abstract readonly noRepositoryMessage: string;

  // Build the prompt for the code agent.
  protected abstract buildPrompt(
    details: SubjectTaskDetails,
    servicePathInRepository: string | null,
  ): string;

  // Build the commit message for the change.
  protected abstract buildCommitMessage(details: SubjectTaskDetails): string;

  // Build the pull request title.
  protected abstract buildPullRequestTitle(details: SubjectTaskDetails): string;

  // Build the pull request body.
  protected abstract buildPullRequestBody(
    details: SubjectTaskDetails,
    agentSummary: string,
  ): string;

  public async execute(context: TaskContext): Promise<TaskResult> {
    await this.log(
      context,
      `Starting ${this.name} (taskId: ${context.taskId.toString()})`,
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

      // Step 2: Get the task context (keyed by the run id).
      await this.log(context, "Fetching task context...");
      const details: SubjectTaskDetails =
        await context.backendAPI.getSubjectTaskDetails(
          context.taskId.toString(),
        );

      await this.log(
        context,
        `Subject: ${details.subjectType} "${details.subjectTitle}"${details.serviceName ? ` (service: ${details.serviceName})` : ""}`,
      );

      /*
       * Step 3: The repository was resolved server-side WITHOUT a stack
       * trace (name-match / only-repository fallbacks). Nothing resolved
       * means the task cannot proceed — fail with the server's guidance.
       */
      if (details.repositories.length === 0) {
        const message: string =
          details.resolutionError || this.noRepositoryMessage;
        await this.log(context, message, "error");
        return this.createFailureResult(message, { isError: true });
      }

      await this.log(
        context,
        `Found ${details.repositories.length} resolved code repository(ies)`,
      );

      // Step 4: Create workspace for the task
      workspace = await WorkspaceManager.createWorkspace(
        context.taskId.toString(),
      );
      await this.log(context, `Created workspace: ${workspace.workspacePath}`);

      // Step 5: Process each repository
      const pullRequestUrls: Array<string> = [];
      const errors: Array<string> = [];

      for (const repo of details.repositories) {
        try {
          await this.log(
            context,
            `Processing repository: ${repo.organizationName}/${repo.repositoryName}`,
          );

          const prUrl: string | null = await this.processRepository(
            context,
            repo,
            details,
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
       * No PRs created. Repositories that actually blew up are an error;
       * a clean run that found nothing worth changing is a negative result,
       * not a failure. Only the former is an Error.
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

  // Clone one repository, run the code agent, and open the PR.
  private async processRepository(
    context: TaskContext,
    repo: CodeRepositoryInfo,
    details: SubjectTaskDetails,
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
     * The base is what git actually checked out, not the stored column — a
     * stale mainBranchName would otherwise target a branch that no longer
     * exists, or produce a diff of every commit between the two branches
     * instead of the fix.
     */
    const baseBranch: string = cloneResult.baseBranch;

    // Create a working branch
    const branchName: string = `${this.branchPrefix}${context.taskId
      .toString()
      .substring(0, 8)}`;
    await this.log(
      context,
      `Creating branch: ${branchName} (from ${baseBranch})`,
    );
    await repoManager.createBranch(cloneResult.repositoryPath, branchName);

    // Build the prompt for the code agent
    const prompt: string = this.buildPrompt(
      details,
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
      timeoutMs: SubjectPullRequestTaskHandler.CODE_AGENT_TIMEOUT_MS,
    };

    if (repo.servicePathInRepository) {
      codeAgentTask.servicePath = repo.servicePathInRepository;
    }

    if (this.usesProductionTelemetry) {
      codeAgentTask.productionTelemetry = true;
    }

    const agentResult: CodeAgentResult = await agent.executeTask(codeAgentTask);

    /*
     * A code agent that FAILED and a code agent that ran fine but found
     * nothing to change are opposite outcomes. The agent only reports
     * success:false on a hard failure — server unreachable, LLM budget
     * exhausted, timed out, aborted — and reporting that as "no fix found"
     * presents an outage as a considered verdict. Throw so the caller
     * reports Error; return null only for a clean, empty run.
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
     */
    const verification: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo,
        repositoryPath: cloneResult.repositoryPath,
        agent,
        originalPrompt: prompt,
        servicePath: repo.servicePathInRepository || undefined,
        log: async (message: string): Promise<void> => {
          await this.log(context, message);
        },
      });

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

    const commitMessage: string = this.buildCommitMessage(details);
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
    const prTitle: string = this.buildPullRequestTitle(details);
    const prBody: string =
      this.buildPullRequestBody(details, agentResult.summary) +
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

  /*
   * Clean a subject title into a single line suitable for commit subjects
   * and PR titles.
   */
  protected cleanSubjectTitle(title: string, maxLength: number): string {
    const cleaned: string = title
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    return `${cleaned.substring(0, maxLength - 3)}...`;
  }
}
