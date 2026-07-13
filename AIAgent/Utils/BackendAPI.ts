import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "./AIAgentAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
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
interface LLMConfigResponse {
  llmType: LlmType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  message?: string;
}

interface ExceptionResponse {
  id: string;
  message: string;
  stackTrace: string;
  exceptionType: string;
  fingerprint: string;
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
  servicePathInRepository: string | null;
  gitHubAppInstallationId: string | null;
}

interface CodeRepositoriesResponse {
  repositories: Array<CodeRepositoryResponse>;
  message?: string;
}

interface SubjectTaskDetailsResponse {
  subjectType: "incident" | "alert" | "trace";
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
export interface LLMConfig {
  llmType: LlmType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
}

export interface ExceptionDetails {
  exception: {
    id: string;
    message: string;
    stackTrace: string;
    exceptionType: string;
    fingerprint: string;
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
  subjectType: "incident" | "alert" | "trace";
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

export default class BackendAPI {
  private baseUrl: URL;

  public constructor() {
    this.baseUrl = URL.fromString(ONEUPTIME_URL.toString());
  }

  /*
   * DEPRECATED (B4 Tier 0, Internal/Roadmap/CodeFixSandboxDesign.md): only
   * the legacy OpenCode fallback (CODE_AGENT_TYPE=OpenCode) calls this —
   * it fetches the RAW provider apiKey for unmetered direct LLM calls.
   * The default in-house agent uses llmCompletion() instead and never
   * receives a provider secret. Remove together with OpenCodeAgent.
   *
   * Get LLM configuration for a project.
   */
  public async getLLMConfig(projectId: string): Promise<LLMConfig> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-llm-config",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        projectId: projectId,
      },
    });

    if (!response.isSuccess()) {
      const data: LLMConfigResponse =
        response.data as unknown as LLMConfigResponse;
      const errorMessage: string = data?.message || "Failed to get LLM config";
      throw new Error(errorMessage);
    }

    const data: LLMConfigResponse =
      response.data as unknown as LLMConfigResponse;

    logger.debug(`Got LLM config for project ${projectId}: ${data.llmType}`);

    const llmConfig: LLMConfig = {
      llmType: data.llmType,
    };

    if (data.apiKey) {
      llmConfig.apiKey = data.apiKey;
    }

    if (data.baseUrl) {
      llmConfig.baseUrl = data.baseUrl;
    }

    if (data.modelName) {
      llmConfig.modelName = data.modelName;
    }

    return llmConfig;
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
        ...AIAgentAPIRequest.getDefaultRequestBody(),
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
        ...AIAgentAPIRequest.getDefaultRequestBody(),
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
        ...AIAgentAPIRequest.getDefaultRequestBody(),
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
  ): Promise<RepositoryToken> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-repository-token",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        codeRepositoryId: codeRepositoryId,
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
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        taskId: options.taskId,
        codeRepositoryId: options.codeRepositoryId,
        pullRequestUrl: options.pullRequestUrl,
        pullRequestNumber: options.pullRequestNumber,
        pullRequestId: options.pullRequestId,
        title: options.title,
        description: options.description,
        headRefName: options.headRefName,
        baseRefName: options.baseRefName,
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
        ...AIAgentAPIRequest.getDefaultRequestBody(),
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
        ...AIAgentAPIRequest.getDefaultRequestBody(),
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
}
