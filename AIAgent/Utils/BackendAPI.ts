import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "./AIAgentAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import LlmType from "Common/Types/LLM/LlmType";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
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

interface TelemetryServiceResponse {
  id: string;
  name: string;
  description: string;
}

interface ExceptionDetailsResponse {
  exception: ExceptionResponse;
  telemetryService: TelemetryServiceResponse | null;
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
  telemetryService: {
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

export default class BackendAPI {
  private baseUrl: URL;

  public constructor() {
    this.baseUrl = URL.fromString(ONEUPTIME_URL.toString());
  }

  // Get LLM configuration for a project
  public async getLLMConfig(projectId: string): Promise<LLMConfig> {
    const url: URL = this.baseUrl.addRoute("/api/ai-agent-data/get-llm-config");

    const response = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        projectId: projectId,
      },
    });

    if (!response.isSuccess()) {
      const data = response.data as unknown as LLMConfigResponse;
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
    const url: URL = this.baseUrl.addRoute(
      "/api/ai-agent-data/get-exception-details",
    );

    const response = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        exceptionId: exceptionId,
      },
    });

    if (!response.isSuccess()) {
      const data = response.data as unknown as ExceptionDetailsResponse;
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
      telemetryService: data.telemetryService
        ? {
            id: data.telemetryService.id,
            name: data.telemetryService.name,
            description: data.telemetryService.description,
          }
        : null,
    };
  }

  // Get code repositories linked to a telemetry service
  public async getCodeRepositories(
    telemetryServiceId: string,
  ): Promise<Array<CodeRepositoryInfo>> {
    const url: URL = this.baseUrl.addRoute(
      "/api/ai-agent-data/get-code-repositories",
    );

    const response = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        telemetryServiceId: telemetryServiceId,
      },
    });

    if (!response.isSuccess()) {
      const data = response.data as unknown as CodeRepositoriesResponse;
      const errorMessage: string =
        data?.message || "Failed to get code repositories";
      throw new Error(errorMessage);
    }

    const data: CodeRepositoriesResponse =
      response.data as unknown as CodeRepositoriesResponse;

    logger.debug(
      `Got ${data.repositories.length} code repositories for telemetry service ${telemetryServiceId}`,
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

  // Get access token for a code repository
  public async getRepositoryToken(
    codeRepositoryId: string,
  ): Promise<RepositoryToken> {
    const url: URL = this.baseUrl.addRoute(
      "/api/ai-agent-data/get-repository-token",
    );

    const response = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        codeRepositoryId: codeRepositoryId,
      },
    });

    if (!response.isSuccess()) {
      const data = response.data as unknown as RepositoryTokenResponse;
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
    const url: URL = this.baseUrl.addRoute(
      "/api/ai-agent-data/record-pull-request",
    );

    const response = await API.post({
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
      const data = response.data as unknown as RecordPullRequestResponse;
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

  // Update task status (wrapper around existing endpoint)
  public async updateTaskStatus(
    taskId: string,
    status: AIAgentTaskStatus,
    statusMessage?: string,
  ): Promise<void> {
    const url: URL = this.baseUrl.addRoute(
      "/api/ai-agent-task/update-task-status",
    );

    const response = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
        status: status,
        statusMessage: statusMessage,
      },
    });

    if (!response.isSuccess()) {
      const data = response.data as unknown as UpdateTaskStatusResponse;
      const errorMessage: string =
        data?.message || "Failed to update task status";
      throw new Error(errorMessage);
    }

    logger.debug(`Updated task ${taskId} status to ${status}`);
  }
}
