import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
  TaskResultData,
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
import PullRequestCreator, {
  PullRequestResult,
} from "../Utils/PullRequestCreator";
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

      await this.log(context, this.noActionMessage, "error");
      return this.createFailureResult(
        errors.length > 0
          ? `${this.noActionMessage}. Errors: ${errors.join("; ")}`
          : this.noActionMessage,
        { isError: true },
      );
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
    const branchName: string = `${this.branchPrefix}${context.taskId
      .toString()
      .substring(0, 8)}`;
    await this.log(context, `Creating branch: ${branchName}`);
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

    // Add all changes and commit
    await this.log(context, "Committing changes...");
    await repoManager.addAllChanges(cloneResult.repositoryPath);

    const commitMessage: string = this.buildCommitMessage(details);
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

    const prTitle: string = this.buildPullRequestTitle(details);
    const prBody: string = this.buildPullRequestBody(
      details,
      agentResult.summary,
    );

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
    });

    // Cleanup agent
    await agent.cleanup();

    return prResult.htmlUrl;
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
