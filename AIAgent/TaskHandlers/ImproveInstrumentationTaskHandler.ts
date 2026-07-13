import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
  TaskResultData,
} from "./TaskHandlerInterface";
import {
  LLMConfig,
  InstrumentationTaskDetails,
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
  CodeAgentType,
  CodeAgentTask,
  CodeAgentResult,
  CodeAgentProgressEvent,
  CodeAgentLLMConfig,
} from "../CodeAgents/Index";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";

// Default timeout for code agent execution (30 minutes)
const CODE_AGENT_TIMEOUT_MS: number = 30 * 60 * 1000;

// Single-line subject-title length caps for commit subjects / PR titles.
const COMMIT_SUBJECT_TITLE_LENGTH: number = 50;
const PR_TITLE_SUBJECT_LENGTH: number = 70;

// The embedded analysis in PR bodies is truncated to keep the PR readable.
const PR_BODY_ANALYSIS_LENGTH: number = 6000;

/*
 * ImproveInstrumentation: an inconclusive Sentinel investigation (root cause
 * undeterminable — insufficient telemetry) becomes a pull request that adds
 * the missing observability, so the NEXT investigation of a similar signal
 * can reach a conclusion.
 *
 * Unlike the exception-driven recipes, this task has no telemetry exception:
 * its subject is the investigated incident/alert, and its context (the
 * inconclusive analysis + the repository resolved without a stack trace)
 * comes from /ai-agent-data/get-instrumentation-task-details keyed by the
 * run id.
 */
export default class ImproveInstrumentationTaskHandler extends BaseTaskHandler {
  public readonly taskType: string = CodeFixTaskType.ImproveInstrumentation;
  public readonly name: string = "Improve Instrumentation Handler";

  public async execute(context: TaskContext): Promise<TaskResult> {
    await this.log(
      context,
      `Starting ${this.name} (taskId: ${context.taskId.toString()})`,
    );

    let workspace: WorkspaceInfo | null = null;

    try {
      // Step 1: Get LLM configuration for the project
      await this.log(context, "Fetching LLM provider configuration...");
      const llmConfig: LLMConfig = await context.backendAPI.getLLMConfig(
        context.projectId.toString(),
      );
      await this.log(
        context,
        `Using LLM provider: ${llmConfig.llmType}${llmConfig.modelName ? ` (${llmConfig.modelName})` : ""}`,
      );

      // Step 2: Get the instrumentation task context (keyed by the run id).
      await this.log(context, "Fetching instrumentation task details...");
      const details: InstrumentationTaskDetails =
        await context.backendAPI.getInstrumentationTaskDetails(
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
          details.resolutionError ||
          "Could not resolve a repository for this instrumentation task. Connect the right repository through the GitHub App.";
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
            llmConfig,
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

      const noActionMessage: string =
        "No instrumentation could be added to any repository";
      await this.log(context, noActionMessage, "error");
      return this.createFailureResult(
        errors.length > 0
          ? `${noActionMessage}. Errors: ${errors.join("; ")}`
          : noActionMessage,
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
    details: InstrumentationTaskDetails,
    llmConfig: LLMConfig,
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
    const branchName: string = `oneuptime-instrumentation-${context.taskId
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
    const agent: CodeAgent = CodeAgentFactory.createAgent(
      CodeAgentType.OpenCode,
    );
    const agentConfig: CodeAgentLLMConfig = {
      llmType: llmConfig.llmType,
    };

    if (llmConfig.apiKey) {
      agentConfig.apiKey = llmConfig.apiKey;
    }

    if (llmConfig.baseUrl) {
      agentConfig.baseUrl = llmConfig.baseUrl;
    }

    if (llmConfig.modelName) {
      agentConfig.modelName = llmConfig.modelName;
    }

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
      timeoutMs: CODE_AGENT_TIMEOUT_MS,
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

  // Build the prompt for the code agent
  private buildPrompt(
    details: InstrumentationTaskDetails,
    servicePathInRepository: string | null,
  ): string {
    let prompt: string = `You are a software engineer improving the observability of a codebase.

OneUptime's autonomous AI SRE ("Sentinel") investigated a production ${details.subjectType} titled "${details.subjectTitle}"${
      details.serviceName
        ? ` affecting the service "${details.serviceName}"`
        : ""
    } and could NOT determine the root cause — the available telemetry was INSUFFICIENT. Its full inconclusive analysis is below: it lists what was checked, what the evidence showed, and what was missing.

## Inconclusive Investigation Analysis

${details.analysisMarkdown}

## Task

Add the missing observability to the code paths the analysis implicates, so the NEXT investigation of a similar signal can reach a conclusion. Steps:

1. Read the analysis carefully: identify which operations, services, or code paths it discusses and — most importantly — which questions it could NOT answer for lack of telemetry
2. Find those code paths in this repository
3. Add structured log statements at the decision points where the analysis lacked visibility, including the relevant identifiers/attributes a future investigation would query by
4. Wrap the operations the analysis discusses in OpenTelemetry spans (or the repository's existing tracing idiom) where they are missing, with span attributes covering the unknowns the analysis calls out
5. Add metric counters or histograms ONLY where the analysis explicitly mentions an unmeasured rate, count, or duration

## Requirements

- Follow the repository's EXISTING telemetry idioms exactly — use the logger, tracer, and metrics libraries already in use; do NOT introduce new dependencies or frameworks
- Do NOT change any business logic, control flow, error handling behavior, or return values — this change is instrumentation only
- Keep the diff small and focused: instrument the code paths the analysis implicates, not the whole codebase
- Never log secrets, credentials, tokens, or full request/response bodies
- If you cannot find the implicated code paths in this repository, explain why and make no changes

Please proceed with adding the missing instrumentation.`;

    if (servicePathInRepository) {
      prompt = `The service code is located in the \`${servicePathInRepository}\` directory.\n\n${prompt}`;
    }

    return prompt;
  }

  // Build commit message for the instrumentation change
  private buildCommitMessage(details: InstrumentationTaskDetails): string {
    const shortTitle: string = this.cleanSubjectTitle(
      details.subjectTitle,
      COMMIT_SUBJECT_TITLE_LENGTH,
    );

    return `chore(observability): add instrumentation for ${shortTitle}

Sentinel's automated investigation of this ${details.subjectType} was
inconclusive because the telemetry was insufficient. This commit adds the
missing logs/spans/metrics to the implicated code paths — no business
logic is changed.

Automatically generated by OneUptime AI Agent.`;
  }

  // Build the pull request title
  private buildPullRequestTitle(details: InstrumentationTaskDetails): string {
    const shortTitle: string = this.cleanSubjectTitle(
      details.subjectTitle,
      PR_TITLE_SUBJECT_LENGTH,
    );

    return `chore(observability): add instrumentation for ${shortTitle}`;
  }

  // Build the pull request body — the inconclusive analysis IS the rationale.
  private buildPullRequestBody(
    details: InstrumentationTaskDetails,
    agentSummary: string,
  ): string {
    const analysis: string = details.analysisMarkdown;

    return `## Observability Improvement

This pull request was automatically generated by OneUptime AI Agent because Sentinel's automated investigation of a production ${details.subjectType} was **inconclusive** — the available telemetry was insufficient to determine a root cause. The changes add the missing instrumentation (structured logs, spans, metrics) to the implicated code paths so the next investigation of a similar signal can reach a conclusion.

**${details.subjectType === "incident" ? "Incident" : "Alert"}:** ${details.subjectTitle}
**Service:** ${details.serviceName || "Unknown"}

### Why: the inconclusive investigation

${analysis.substring(0, PR_BODY_ANALYSIS_LENGTH)}${analysis.length > PR_BODY_ANALYSIS_LENGTH ? "\n...(truncated)" : ""}

### Summary of Changes

${agentSummary}

---

> **Instrumentation only** — this PR must not change business logic. Please review before merging; nothing is merged automatically.

*This PR was automatically generated by [OneUptime AI Agent](https://oneuptime.com)*`;
  }

  /*
   * Clean a subject title into a single line suitable for commit subjects
   * and PR titles.
   */
  private cleanSubjectTitle(title: string, maxLength: number): string {
    const cleaned: string = title
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    return `${cleaned.substring(0, maxLength - 3)}...`;
  }

  // Get handler description
  public getDescription(): string {
    return "Turns an inconclusive Sentinel investigation into a pull request that adds the missing observability (structured logs, OpenTelemetry spans, metrics) to the implicated code paths, without changing business logic.";
  }
}
