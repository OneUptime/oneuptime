import { ONEUPTIME_BASE_URL } from "../Config";
import RunnerAPIRequest from "./RunnerAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import {
  ImplicatedSpan,
  PerformanceFinding,
} from "Common/Types/AI/CodeFixTaskContext";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import logger from "Common/Server/Utils/Logger";

// API Response types
interface ExceptionResponse {
  id: string;
  message: string;
  stackTrace: string;
  exceptionType: string;
  fingerprint: string;
  aiClassification?: string | null;
}

interface ServiceResponse {
  id: string;
  name: string;
  description: string;
}

interface ExceptionDetailsResponse {
  exception: ExceptionResponse;
  service: ServiceResponse | null;
  message?: string;
}

interface CodeRepositoryResponse {
  id: string;
  name: string;
  repositoryHostedAt: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  setupCommand?: string | null;
  buildCommand?: string | null;
  testCommand?: string | null;
  servicePathInRepository: string | null;
  gitHubAppInstallationId: string | null;
}

interface CodeRepositoriesResponse {
  repositories: Array<CodeRepositoryResponse>;
  message?: string;
}

interface SubjectTaskDetailsResponse {
  subjectType: "incident" | "alert" | "trace" | "service";
  subjectTitle: string;
  analysisMarkdown: string;
  serviceName: string | null;
  projectId: string;
  repositories: Array<CodeRepositoryResponse>;
  resolutionError?: string;
  message?: string;
  // Trace-evidence recipes (FixPerformance) only.
  traceId?: string;
  findings?: Array<PerformanceFinding>;
  spanSummaries?: Array<ImplicatedSpan>;
}

interface RepositoryTokenResponse {
  token: string;
  expiresAt: string;
  repositoryUrl: string;
  organizationName: string;
  repositoryName: string;
  message?: string;
}

interface RecordPullRequestResponse {
  success: boolean;
  pullRequestId: string;
  message?: string;
}

interface UpdateTaskStatusResponse {
  success?: boolean;
  message?: string;
}

// Exported types
export interface ExceptionDetails {
  exception: {
    id: string;
    message: string;
    stackTrace: string;
    exceptionType: string;
    fingerprint: string;
    /*
     * AI triage verdict for the exception's group (code-fault, user-error,
     * expected-denial, infrastructure, unknown) — null when the group has
     * not been triaged. Recipes use it to tune their prompt.
     */
    aiClassification?: string | null;
  };
  service: {
    id: string;
    name: string;
    description: string;
  } | null;
}

export interface CodeRepositoryInfo {
  id: string;
  name: string;
  repositoryHostedAt: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  /*
   * Operator-configured verification commands (run at the repository root
   * by the build/test verification loop before a fix PR opens). Null when
   * not configured — verification is skipped.
   */
  setupCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
  servicePathInRepository: string | null;
  gitHubAppInstallationId: string | null;
}

/*
 * Context for a non-exception task, keyed by the run id. For the
 * incident/alert-subject recipes (ImproveInstrumentation, FixFromIncident)
 * analysisMarkdown is the investigation's posted analysis; for the
 * trace-evidence recipe (FixPerformance, subjectType "trace") it is the
 * server-rendered deterministic span-tree evidence, with the structured
 * findings alongside. Either way the server resolved the repository
 * (FixPerformance additionally tries span code.* attributes as a synthetic
 * stack trace before the name-match / only-repository fallbacks).
 */
export interface SubjectTaskDetails {
  subjectType: "incident" | "alert" | "trace" | "service";
  subjectTitle: string;
  analysisMarkdown: string;
  serviceName: string | null;
  repositories: Array<CodeRepositoryInfo>;
  // Set when repositories is empty: why nothing resolved + what to do.
  resolutionError: string | null;
  // Trace-evidence recipes (FixPerformance) only.
  traceId: string | null;
  performanceFindings: Array<PerformanceFinding>;
  spanSummaries: Array<ImplicatedSpan>;
}

export interface RepositoryToken {
  token: string;
  expiresAt: Date;
  repositoryUrl: string;
  organizationName: string;
  repositoryName: string;
}

export interface RecordPullRequestOptions {
  taskId: string;
  codeRepositoryId: string;
  pullRequestUrl: string;
  pullRequestNumber?: number;
  pullRequestId?: number;
  title: string;
  description?: string;
  headRefName?: string;
  baseRefName?: string;
  // Outcome of the pre-PR build/test verification loop (Passed/Failed/Skipped).
  runnerVerificationStatus?: string;
  runnerVerificationSummary?: string;
}

export interface RecordPullRequestResult {
  success: boolean;
  pullRequestId: string;
}

/*
 * Server-mediated LLM completion (B4 Tier 0): the in-house code agent's
 * tool loop calls POST /api/ai-agent-data/llm-completion per turn. The
 * server validates the run (claimed, Running, owned by this agent),
 * resolves the provider, meters the call, and enforces the per-run loop
 * budgets — the worker never holds a provider secret.
 */
export interface LlmCompletionBudget {
  completionCallsUsed: number;
  maxCompletionCalls: number;
  outputTokensUsed: number;
  maxOutputTokens: number;
}

export interface LlmCompletionResult {
  content: string;
  toolCalls: Array<LLMToolCall>;
  stopReason: "stop" | "tool_use";
  budget: LlmCompletionBudget;
}

/*
 * Success bodies carry `message` as the assistant-message OBJECT; error
 * bodies carry `message` as the error STRING — the union below captures
 * both, and llmCompletion() discriminates on response.isSuccess().
 */
interface LlmCompletionResponse {
  message?:
    | {
        role: string;
        content: string;
        toolCalls?: Array<LLMToolCall>;
      }
    | string;
  stopReason?: "stop" | "tool_use";
  budget?: LlmCompletionBudget;
}

/*
 * ---------------------------------------------------------------------------
 * GitHub-triggered runs.
 *
 * The worker never names the repository, installation or issue it is acting
 * on: every request below carries only `taskId`, and the server derives the
 * rest from the run's own stored context. Keep it that way — a worker that
 * could name a GitHub object could post into any repository the installation
 * can reach.
 * ---------------------------------------------------------------------------
 */

export interface GitHubTaskRepository {
  id: string;
  name: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  setupCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
}

export interface GitHubTaskIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  labels: Array<string>;
  authorLogin: string;
}

export interface GitHubTaskPullRequest {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  /*
   * The branch pinned at trigger time, or null when there is none to work on
   * locally — a fork's branch is not in the repository this installation can
   * reach, so a fork review runs against the BASE branch plus the diff.
   */
  headRefName: string | null;
  isFromFork: boolean;
  headSha: string;
  baseRefName: string;
  authorLogin: string;
  changedFilesCount: number;
  additions: number;
  deletions: number;
}

export interface GitHubTaskFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GitHubTaskComment {
  authorLogin: string;
  isBot: boolean;
  body: string;
  createdAt: string;
}

export interface GitHubTaskDetails {
  taskType: string;
  commandType: string;
  /*
   * UNTRUSTED. Written by a GitHub user, and quoted into an agent prompt as a
   * request — never as instructions that widen what the run may do.
   */
  instruction: string;
  triggeredByLogin: string | null;
  repository: GitHubTaskRepository;
  issue: GitHubTaskIssue | null;
  pullRequest: GitHubTaskPullRequest | null;
  files: Array<GitHubTaskFile>;
  filesTruncated: boolean;
  comments: Array<GitHubTaskComment>;
}

export interface GitHubReviewCommentInput {
  path: string;
  line: number;
  body: string;
}

export interface PostGitHubReviewResult {
  reviewUrl: string;
  inlineCommentsRequested: number;
}

export default class BackendAPI {
  private baseUrl: URL;

  public constructor() {
    this.baseUrl = URL.fromString(ONEUPTIME_BASE_URL.toString());
  }

  // Get exception details with telemetry service info
  public async getExceptionDetails(
    exceptionId: string,
  ): Promise<ExceptionDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-exception-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        exceptionId: exceptionId,
      },
    });

    if (!response.isSuccess()) {
      const data: ExceptionDetailsResponse =
        response.data as unknown as ExceptionDetailsResponse;
      const errorMessage: string =
        data?.message || "Failed to get exception details";
      throw new Error(errorMessage);
    }

    const data: ExceptionDetailsResponse =
      response.data as unknown as ExceptionDetailsResponse;

    logger.debug(
      `Got exception details for ${exceptionId}: ${data.exception.message.substring(0, 100)}`,
    );

    return {
      exception: {
        id: data.exception.id,
        message: data.exception.message,
        stackTrace: data.exception.stackTrace,
        exceptionType: data.exception.exceptionType,
        fingerprint: data.exception.fingerprint,
        aiClassification: data.exception.aiClassification || null,
      },
      service: data.service
        ? {
            id: data.service.id,
            name: data.service.name,
            description: data.service.description,
          }
        : null,
    };
  }

  /*
   * Resolve the repository for an exception — the server matches the
   * exception's stack-trace files against the project's connected repos at
   * runtime (with name-match / only-repository fallbacks).
   */
  public async getCodeRepositories(
    exceptionId: string,
  ): Promise<Array<CodeRepositoryInfo>> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-code-repositories",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        exceptionId: exceptionId,
      },
    });

    if (!response.isSuccess()) {
      const data: CodeRepositoriesResponse =
        response.data as unknown as CodeRepositoriesResponse;
      const errorMessage: string =
        data?.message || "Failed to get code repositories";
      throw new Error(errorMessage);
    }

    const data: CodeRepositoriesResponse =
      response.data as unknown as CodeRepositoriesResponse;

    logger.debug(
      `Resolved ${data.repositories.length} code repository(ies) for exception ${exceptionId}`,
    );

    return data.repositories.map((repo: CodeRepositoryResponse) => {
      return {
        id: repo.id,
        name: repo.name,
        repositoryHostedAt: repo.repositoryHostedAt,
        organizationName: repo.organizationName,
        repositoryName: repo.repositoryName,
        mainBranchName: repo.mainBranchName,
        setupCommand: repo.setupCommand || null,
        buildCommand: repo.buildCommand || null,
        testCommand: repo.testCommand || null,
        servicePathInRepository: repo.servicePathInRepository,
        gitHubAppInstallationId: repo.gitHubAppInstallationId,
      };
    });
  }

  /*
   * Context for an incident/alert-subject run (ImproveInstrumentation,
   * FixFromIncident) — `taskId` is the AIRun id from get-pending-task
   * (these runs carry no exceptionId). The wire route predates
   * FixFromIncident and kept its historical name.
   */
  public async getSubjectTaskDetails(
    taskId: string,
  ): Promise<SubjectTaskDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-instrumentation-task-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
      },
    });

    if (!response.isSuccess()) {
      const data: SubjectTaskDetailsResponse =
        response.data as unknown as SubjectTaskDetailsResponse;
      const errorMessage: string =
        data?.message || "Failed to get task details";
      throw new Error(errorMessage);
    }

    const data: SubjectTaskDetailsResponse =
      response.data as unknown as SubjectTaskDetailsResponse;

    logger.debug(
      `Got subject task details for ${taskId}: ${data.subjectType} "${data.subjectTitle}" (${data.repositories.length} repository(ies))`,
    );

    return {
      subjectType: data.subjectType,
      subjectTitle: data.subjectTitle,
      analysisMarkdown: data.analysisMarkdown,
      serviceName: data.serviceName || null,
      repositories: (data.repositories || []).map(
        (repo: CodeRepositoryResponse) => {
          return {
            id: repo.id,
            name: repo.name,
            repositoryHostedAt: repo.repositoryHostedAt,
            organizationName: repo.organizationName,
            repositoryName: repo.repositoryName,
            mainBranchName: repo.mainBranchName,
            setupCommand: repo.setupCommand || null,
            buildCommand: repo.buildCommand || null,
            testCommand: repo.testCommand || null,
            servicePathInRepository: repo.servicePathInRepository,
            gitHubAppInstallationId: repo.gitHubAppInstallationId,
          };
        },
      ),
      resolutionError: data.resolutionError || null,
      traceId: data.traceId || null,
      performanceFindings: data.findings || [],
      spanSummaries: data.spanSummaries || [],
    };
  }

  // Get access token for a code repository
  public async getRepositoryToken(
    codeRepositoryId: string,
    /*
     * The run this token is for. Optional only for compatibility with older
     * callers; pass it. The server uses it to decide whether the
     * per-repository open-PR cap applies — a run that revises or reviews an
     * EXISTING pull request adds nothing to the review queue and so is exempt,
     * and without a task id it is treated as one that does.
     *
     * It is a task id, not a claim: the server re-derives the recipe from the
     * run and ignores anything it cannot verify belongs to this agent.
     */
    taskId?: string | undefined,
  ): Promise<RepositoryToken> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-repository-token",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        codeRepositoryId: codeRepositoryId,
        ...(taskId ? { taskId: taskId } : {}),
      },
    });

    if (!response.isSuccess()) {
      const data: RepositoryTokenResponse =
        response.data as unknown as RepositoryTokenResponse;
      const errorMessage: string =
        data?.message || "Failed to get repository token";
      throw new Error(errorMessage);
    }

    const data: RepositoryTokenResponse =
      response.data as unknown as RepositoryTokenResponse;

    logger.debug(
      `Got access token for repository ${data.organizationName}/${data.repositoryName}`,
    );

    return {
      token: data.token,
      expiresAt: new Date(data.expiresAt),
      repositoryUrl: data.repositoryUrl,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
    };
  }

  // Record a pull request created by the AI Agent
  public async recordPullRequest(
    options: RecordPullRequestOptions,
  ): Promise<RecordPullRequestResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/record-pull-request",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: options.taskId,
        codeRepositoryId: options.codeRepositoryId,
        pullRequestUrl: options.pullRequestUrl,
        pullRequestNumber: options.pullRequestNumber,
        pullRequestId: options.pullRequestId,
        title: options.title,
        description: options.description,
        headRefName: options.headRefName,
        baseRefName: options.baseRefName,
        runnerVerificationStatus: options.runnerVerificationStatus,
        runnerVerificationSummary: options.runnerVerificationSummary,
      },
    });

    if (!response.isSuccess()) {
      const data: RecordPullRequestResponse =
        response.data as unknown as RecordPullRequestResponse;
      const errorMessage: string =
        data?.message || "Failed to record pull request";
      throw new Error(errorMessage);
    }

    const data: RecordPullRequestResponse =
      response.data as unknown as RecordPullRequestResponse;

    logger.debug(`Recorded pull request: ${options.pullRequestUrl}`);

    return {
      success: data.success,
      pullRequestId: data.pullRequestId,
    };
  }

  /*
   * One server-mediated LLM completion for a claimed code-fix run (B4 Tier
   * 0). `taskId` is the AIRun id from get-pending-task. Over-budget and
   * guard failures come back as 4xx with a clear message, thrown here as an
   * Error the tool loop turns into an honest run failure.
   */
  public async llmCompletion(data: {
    taskId: string;
    messages: Array<LLMMessage>;
    tools?: Array<LLMToolDefinition> | undefined;
    maxTokens?: number | undefined;
  }): Promise<LlmCompletionResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/llm-completion",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: data.taskId,
        messages: data.messages as unknown as JSONObject[],
        ...(data.tools ? { tools: data.tools as unknown as JSONObject[] } : {}),
        ...(data.maxTokens ? { maxTokens: data.maxTokens } : {}),
      },
    });

    const responseData: LlmCompletionResponse =
      response.data as unknown as LlmCompletionResponse;

    if (!response.isSuccess()) {
      const errorMessage: string =
        typeof responseData?.message === "string"
          ? responseData.message
          : "LLM completion request failed";
      throw new Error(errorMessage);
    }

    const message: { content: string; toolCalls?: Array<LLMToolCall> } =
      typeof responseData.message === "object" && responseData.message !== null
        ? responseData.message
        : { content: "" };

    const toolCalls: Array<LLMToolCall> = message.toolCalls || [];

    return {
      content: message.content || "",
      toolCalls,
      stopReason:
        responseData.stopReason || (toolCalls.length > 0 ? "tool_use" : "stop"),
      budget: responseData.budget || {
        completionCallsUsed: 0,
        maxCompletionCalls: Number.MAX_SAFE_INTEGER,
        outputTokensUsed: 0,
        maxOutputTokens: Number.MAX_SAFE_INTEGER,
      },
    };
  }

  // Update task status (wrapper around existing endpoint)
  public async updateTaskStatus(
    taskId: string,
    status: AIAgentTaskStatus,
    statusMessage?: string,
  ): Promise<void> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-task/update-task-status",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
        status: status,
        statusMessage: statusMessage,
      },
    });

    if (!response.isSuccess()) {
      const data: UpdateTaskStatusResponse =
        response.data as unknown as UpdateTaskStatusResponse;
      const errorMessage: string =
        data?.message || "Failed to update task status";
      throw new Error(errorMessage);
    }

    logger.debug(`Updated task ${taskId} status to ${status}`);
  }

  /*
   * Everything a GitHub-triggered run needs: the issue or pull request it is
   * about, the thread so far, and (for a pull request) its diff.
   */
  public async getGitHubTaskDetails(
    taskId: string,
  ): Promise<GitHubTaskDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-github-task-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
      },
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get GitHub task details";
      throw new Error(errorMessage);
    }

    const data: GitHubTaskDetails =
      response.data as unknown as GitHubTaskDetails;

    logger.debug(
      `Got GitHub task details for ${taskId}: ${data.commandType} on ${data.repository?.organizationName}/${data.repository?.repositoryName}`,
    );

    return {
      taskType: data.taskType,
      commandType: data.commandType,
      instruction: data.instruction || "",
      triggeredByLogin: data.triggeredByLogin || null,
      repository: data.repository,
      issue: data.issue || null,
      pullRequest: data.pullRequest || null,
      files: data.files || [],
      filesTruncated: Boolean(data.filesTruncated),
      comments: data.comments || [],
    };
  }

  /*
   * Post the agent's review on the run's own pull request. The server decides
   * WHERE it lands; this call only supplies the words.
   */
  public async postGitHubReview(data: {
    taskId: string;
    body: string;
    comments: Array<GitHubReviewCommentInput>;
  }): Promise<PostGitHubReviewResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/post-github-review",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: data.taskId,
        body: data.body,
        /*
         * Widened to plain JSON: the API helper's JSONObject rejects an array
         * of a named interface, and the server validates every anchor field
         * itself before it goes anywhere near GitHub.
         */
        comments: data.comments as unknown as JSONArray,
      },
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to post the GitHub review";
      throw new Error(errorMessage);
    }

    const result: JSONObject = response.data;

    logger.debug(`Posted a GitHub review for task ${data.taskId}`);

    return {
      reviewUrl: (result["reviewUrl"] as string) || "",
      inlineCommentsRequested:
        (result["inlineCommentsRequested"] as number) || 0,
    };
  }
}
