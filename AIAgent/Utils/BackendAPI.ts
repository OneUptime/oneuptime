import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "./AIAgentAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import logger from "Common/Server/Utils/Logger";

// Response types
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        projectId: projectId,
      },
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get LLM config";
      throw new Error(errorMessage);
    }

    const data: JSONObject = response.data as JSONObject;

    logger.debug(`Got LLM config for project ${projectId}: ${data["llmType"]}`);

    const llmConfig: LLMConfig = {
      llmType: data["llmType"] as LlmType,
    };

    if (data["apiKey"]) {
      llmConfig.apiKey = data["apiKey"] as string;
    }

    if (data["baseUrl"]) {
      llmConfig.baseUrl = data["baseUrl"] as string;
    }

    if (data["modelName"]) {
      llmConfig.modelName = data["modelName"] as string;
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        exceptionId: exceptionId,
      },
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get exception details";
      throw new Error(errorMessage);
    }

    const data: JSONObject = response.data as JSONObject;
    const exception: JSONObject = data["exception"] as JSONObject;
    const telemetryService: JSONObject | null = data[
      "telemetryService"
    ] as JSONObject | null;

    logger.debug(
      `Got exception details for ${exceptionId}: ${exception["message"]?.toString().substring(0, 100)}`,
    );

    return {
      exception: {
        id: exception["id"] as string,
        message: exception["message"] as string,
        stackTrace: exception["stackTrace"] as string,
        exceptionType: exception["exceptionType"] as string,
        fingerprint: exception["fingerprint"] as string,
      },
      telemetryService: telemetryService
        ? {
            id: telemetryService["id"] as string,
            name: telemetryService["name"] as string,
            description: telemetryService["description"] as string,
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        telemetryServiceId: telemetryServiceId,
      },
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get code repositories";
      throw new Error(errorMessage);
    }

    const data: JSONObject = response.data as JSONObject;
    const repositories: Array<JSONObject> = data[
      "repositories"
    ] as Array<JSONObject>;

    logger.debug(
      `Got ${repositories.length} code repositories for telemetry service ${telemetryServiceId}`,
    );

    return repositories.map((repo: JSONObject) => {
      return {
        id: repo["id"] as string,
        name: repo["name"] as string,
        repositoryHostedAt: repo["repositoryHostedAt"] as string,
        organizationName: repo["organizationName"] as string,
        repositoryName: repo["repositoryName"] as string,
        mainBranchName: repo["mainBranchName"] as string,
        servicePathInRepository:
          (repo["servicePathInRepository"] as string) || null,
        gitHubAppInstallationId:
          (repo["gitHubAppInstallationId"] as string) || null,
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...AIAgentAPIRequest.getDefaultRequestBody(),
        codeRepositoryId: codeRepositoryId,
      },
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get repository token";
      throw new Error(errorMessage);
    }

    const data: JSONObject = response.data as JSONObject;

    logger.debug(
      `Got access token for repository ${data["organizationName"]}/${data["repositoryName"]}`,
    );

    return {
      token: data["token"] as string,
      expiresAt: new Date(data["expiresAt"] as string),
      repositoryUrl: data["repositoryUrl"] as string,
      organizationName: data["organizationName"] as string,
      repositoryName: data["repositoryName"] as string,
    };
  }

  // Record a pull request created by the AI Agent
  public async recordPullRequest(
    options: RecordPullRequestOptions,
  ): Promise<RecordPullRequestResult> {
    const url: URL = this.baseUrl.addRoute(
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
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to record pull request";
      throw new Error(errorMessage);
    }

    const data: JSONObject = response.data as JSONObject;

    logger.debug(`Recorded pull request: ${options.pullRequestUrl}`);

    return {
      success: data["success"] as boolean,
      pullRequestId: data["pullRequestId"] as string,
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
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to update task status";
      throw new Error(errorMessage);
    }

    logger.debug(`Updated task ${taskId} status to ${status}`);
  }
}
