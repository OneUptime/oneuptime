import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
  TaskMetadata,
  TaskResultData,
} from "./TaskHandlerInterface";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import {
  LLMConfig,
  ExceptionDetails,
  CodeRepositoryInfo,
  RepositoryToken,
} from "../Utils/BackendAPI";
import RepositoryManager, {
  RepositoryConfig,
  CloneResult,
} from "../Utils/RepositoryManager";
import PullRequestCreator, { PullRequestResult } from "../Utils/PullRequestCreator";
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

// Metadata structure for Fix Exception tasks
export interface FixExceptionMetadata extends TaskMetadata {
  exceptionId: string;
  telemetryServiceId?: string;
  stackTrace?: string;
  errorMessage?: string;
}

export default class FixExceptionTaskHandler extends BaseTaskHandler<FixExceptionMetadata> {
  public readonly taskType: AIAgentTaskType = AIAgentTaskType.FixException;
  public readonly name: string = "Fix Exception Handler";

  // Default timeout for code agent execution (30 minutes)
  private static readonly CODE_AGENT_TIMEOUT_MS: number = 30 * 60 * 1000;

  public async execute(
    context: TaskContext<FixExceptionMetadata>,
  ): Promise<TaskResult> {
    const metadata: FixExceptionMetadata = context.metadata;

    await this.log(context, `Starting Fix Exception task for exception: ${metadata.exceptionId} (taskId: ${context.taskId.toString()})`);

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

      // Step 2: Get exception details
      await this.log(context, "Fetching exception details...");
      const exceptionDetails: ExceptionDetails =
        await context.backendAPI.getExceptionDetails(metadata.exceptionId);

      if (!exceptionDetails.telemetryService) {
        await this.log(
          context,
          "No telemetry service linked to this exception",
          "warning",
        );
        return this.createNoActionResult(
          "No telemetry service linked to this exception",
        );
      }

      await this.log(
        context,
        `Exception: ${exceptionDetails.exception.message.substring(0, 100)}...`,
      );
      await this.log(
        context,
        `Service: ${exceptionDetails.telemetryService.name}`,
      );

      // Step 3: Get linked code repositories
      await this.log(context, "Finding linked code repositories...");
      const repositories: Array<CodeRepositoryInfo> =
        await context.backendAPI.getCodeRepositories(
          exceptionDetails.telemetryService.id,
        );

      if (repositories.length === 0) {
        await this.log(
          context,
          "No code repositories linked to this service",
          "warning",
        );
        return this.createNoActionResult(
          "No code repositories linked to this service via Service Catalog",
        );
      }

      await this.log(
        context,
        `Found ${repositories.length} linked code repository(ies)`,
      );

      // Step 4: Create workspace for the task
      workspace = await WorkspaceManager.createWorkspace(context.taskId.toString());
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

      // No PRs created but no fatal errors either
      await this.log(
        context,
        "No fixes could be applied to any repository",
        "warning",
      );
      return this.createNoActionResult(
        errors.length > 0
          ? `No fixes could be applied. Errors: ${errors.join("; ")}`
          : "No fixes could be applied to any repository",
      );
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
    context: TaskContext<FixExceptionMetadata>,
    repo: CodeRepositoryInfo,
    exceptionDetails: ExceptionDetails,
    llmConfig: LLMConfig,
    workspace: WorkspaceInfo,
  ): Promise<string | null> {
    // Get access token for the repository
    await this.log(
      context,
      `Getting access token for ${repo.organizationName}/${repo.repositoryName}...`,
    );

    const tokenData: RepositoryToken = await context.backendAPI.getRepositoryToken(
      repo.id,
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
    };

    const repoManager: RepositoryManager = new RepositoryManager(context.logger);
    const cloneResult: CloneResult = await repoManager.cloneRepository(
      repoConfig,
      workspace.workspacePath,
    );

    // Create a fix branch
    const branchName: string = `oneuptime-fix-exception-${context.taskId.toString().substring(0, 8)}`;
    await this.log(context, `Creating branch: ${branchName}`);
    await repoManager.createBranch(cloneResult.repositoryPath, branchName);

    // Build the prompt for the code agent
    const prompt: string = this.buildFixPrompt(
      exceptionDetails,
      repo.servicePathInRepository,
    );

    // Initialize code agent
    await this.log(context, "Initializing code agent...");
    const agent: CodeAgent = CodeAgentFactory.createAgent(CodeAgentType.OpenCode);
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
    await this.log(context, "Running code agent to fix exception...");
    const codeAgentTask: CodeAgentTask = {
      workingDirectory: cloneResult.repositoryPath,
      prompt,
      timeoutMs: FixExceptionTaskHandler.CODE_AGENT_TIMEOUT_MS,
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

    const commitMessage: string = this.buildCommitMessage(exceptionDetails);
    await repoManager.commitChanges(cloneResult.repositoryPath, commitMessage);

    // Push the branch
    await this.log(context, `Pushing branch ${branchName}...`);
    await repoManager.pushBranch(cloneResult.repositoryPath, branchName, repoConfig);

    // Create pull request
    await this.log(context, "Creating pull request...");
    const prCreator: PullRequestCreator = new PullRequestCreator(context.logger);

    const prTitle: string = PullRequestCreator.generatePRTitle(
      exceptionDetails.exception.message,
    );

    const prBody: string = PullRequestCreator.generatePRBody({
      exceptionMessage: exceptionDetails.exception.message,
      exceptionType: exceptionDetails.exception.exceptionType,
      stackTrace: exceptionDetails.exception.stackTrace,
      serviceName: exceptionDetails.telemetryService?.name || "Unknown Service",
      summary: agentResult.summary,
    });

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
  private buildFixPrompt(
    exceptionDetails: ExceptionDetails,
    servicePathInRepository: string | null,
  ): string {
    let prompt: string = `You are a software engineer fixing a bug in a codebase.

## Exception Information

**Exception Type:** ${exceptionDetails.exception.exceptionType}

**Error Message:**
${exceptionDetails.exception.message}

**Stack Trace:**
\`\`\`
${exceptionDetails.exception.stackTrace}
\`\`\`

## Task

Please analyze the stack trace and fix the exception. Here are the steps to follow:

1. Identify the root cause of the exception from the stack trace
2. Find the relevant source files in the codebase
3. Implement a fix for the issue
4. Make sure your fix handles edge cases appropriately
5. The fix should be minimal and focused - only change what's necessary

## Guidelines

- Do NOT add excessive error handling or logging unless necessary
- Do NOT refactor unrelated code
- Keep the fix simple and targeted
- Preserve existing code style and patterns
- If you cannot determine how to fix the issue, explain why

Please proceed with analyzing and fixing this exception.`;

    if (servicePathInRepository) {
      prompt = `The service code is located in the \`${servicePathInRepository}\` directory.\n\n${prompt}`;
    }

    return prompt;
  }

  // Build commit message for the fix
  private buildCommitMessage(exceptionDetails: ExceptionDetails): string {
    const shortMessage: string = exceptionDetails.exception.message
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 50);

    return `fix: ${shortMessage}

This commit fixes an exception detected by OneUptime.

Exception Type: ${exceptionDetails.exception.exceptionType}
Exception ID: ${exceptionDetails.exception.id}

Automatically generated by OneUptime AI Agent.`;
  }

  // Validate metadata
  public validateMetadata(metadata: FixExceptionMetadata): boolean {
    return Boolean(metadata.exceptionId);
  }

  // Get handler description
  public getDescription(): string {
    return "Analyzes exceptions detected by OneUptime and attempts to fix them by modifying the source code and creating a pull request.";
  }
}
