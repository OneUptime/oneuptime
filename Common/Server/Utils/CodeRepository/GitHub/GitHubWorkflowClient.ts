import GitHubUtil, { GitHubInstallationToken } from "./GitHub";
import GitHubInstallationBinding from "./GitHubInstallationBinding";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import Query from "../../../Types/Database/Query";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import API, { RequestOptions } from "../../../../Utils/API";

const REPOSITORY_PART_PATTERN: RegExp = /^[A-Za-z0-9_.-]+$/;
const INSTALLATION_ID_PATTERN: RegExp = /^\d+$/;
const GITHUB_USERNAME_PATTERN: RegExp = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,38})$/;

export type GitHubWorkflowPermissions = {
  metadata: "read";
  issues?: "read" | "write";
  pull_requests?: "read" | "write";
};

export interface GitHubWorkflowRequest {
  projectId: ObjectID;
  repository: string;
  method: HTTPMethod;
  path: Array<string>;
  permissions: GitHubWorkflowPermissions;
  body?: JSONObject | undefined;
  getRemainingExecutionTimeInMs?: (() => number) | undefined;
}

export interface GitHubWorkflowResponse {
  statusCode: number;
  data: JSONObject | JSONArray;
}

/** Contains only locally authored messages, never GitHub bodies or credentials. */
export class GitHubWorkflowError extends BadDataException {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number = 0) {
    super(message);
    this.statusCode = statusCode;
  }
}

export default class GitHubWorkflowClient {
  private static getRequestOptions(
    getRemainingExecutionTimeInMs?: () => number,
  ): RequestOptions {
    const remaining: number = getRemainingExecutionTimeInMs?.() ?? 30_500;
    const timeout: number = Math.min(30_000, Math.floor(remaining - 500));

    if (!Number.isFinite(timeout) || timeout < 100) {
      throw new GitHubWorkflowError(
        "Not enough workflow execution time remains for a GitHub request.",
      );
    }

    return {
      timeout,
      totalTimeoutInMs: timeout,
      retries: 0,
      doNotFollowRedirects: true,
      maxContentLength: 2_000_000,
      maxBodyLength: 1_000_000,
    };
  }

  private static validRepositoryPart(value: string): boolean {
    return (
      REPOSITORY_PART_PATTERN.test(value) && value !== "." && value !== ".."
    );
  }

  public static async resolveRepository(data: {
    projectId: ObjectID;
    repository: string;
  }): Promise<CodeRepository> {
    if (typeof data.repository !== "string" || !data.repository.trim()) {
      throw new GitHubWorkflowError("Repository is required.");
    }

    const reference: string = data.repository.trim();
    const query: Query<CodeRepository> = {
      projectId: data.projectId,
      repositoryHostedAt: CodeRepositoryType.GitHub,
    };

    if (ObjectID.isValidUUID(reference)) {
      query._id = reference;
    } else {
      const parts: Array<string> = reference.split("/");
      if (
        parts.length !== 2 ||
        !parts.every(GitHubWorkflowClient.validRepositoryPart)
      ) {
        throw new GitHubWorkflowError(
          "Repository must be owner/repository or a connected Code Repository ID.",
        );
      }
      /*
       * GitHub names are case-insensitive. Validation above excludes glob
       * characters, so this produces an exact ILIKE match (including literal
       * underscores), rather than a substring search across repositories.
       */
      query.organizationName = new Wildcard(parts[0]!);
      query.repositoryName = new Wildcard(parts[1]!);
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query,
        select: {
          _id: true,
          projectId: true,
          repositoryHostedAt: true,
          gitHubAppInstallationId: true,
          organizationName: true,
          repositoryName: true,
        },
        props: { isRoot: true },
      });

    /*
     * Recheck the returned row too: stale bindings from before the installation
     * ownership fix must never become a capability to mint another tenant's token.
     */
    if (
      !repository ||
      repository.projectId?.toString() !== data.projectId.toString() ||
      repository.repositoryHostedAt !== CodeRepositoryType.GitHub ||
      !repository.gitHubAppInstallationId ||
      !INSTALLATION_ID_PATTERN.test(repository.gitHubAppInstallationId) ||
      !repository.organizationName ||
      !repository.repositoryName ||
      !GitHubWorkflowClient.validRepositoryPart(repository.organizationName) ||
      !GitHubWorkflowClient.validRepositoryPart(repository.repositoryName) ||
      !(await GitHubInstallationBinding.isRepositoryInstallationBound(
        repository,
      ))
    ) {
      throw new GitHubWorkflowError(
        "This GitHub repository is not connected to this project. Reconnect it in Code Repositories.",
      );
    }

    return repository;
  }

  private static responseError(statusCode: number): GitHubWorkflowError {
    let message: string = "GitHub could not complete this request.";
    if (statusCode === 401 || statusCode === 403) {
      message =
        "GitHub denied this request. Check the app permissions and installation approval, or retry after its rate limit resets.";
    } else if (statusCode === 404) {
      message =
        "GitHub could not find this repository, issue, pull request, or user.";
    } else if (statusCode === 422) {
      message =
        "GitHub rejected the supplied fields. Check the item number, labels, assignees, and reviewers.";
    } else if (statusCode === 429) {
      message = "GitHub rate limit reached. Retry after the limit resets.";
    } else if (statusCode >= 500) {
      message = "GitHub is temporarily unavailable. Retry this workflow later.";
    }
    return new GitHubWorkflowError(message, statusCode);
  }

  public static async request(
    data: GitHubWorkflowRequest,
  ): Promise<GitHubWorkflowResponse> {
    // A local deadline also bounds callers without the workflow runner callback.
    const deadline: number = Date.now() + 30_500;
    const remainingTime: () => number = (): number => {
      return Math.min(
        deadline - Date.now(),
        data.getRemainingExecutionTimeInMs?.() ?? 30_500,
      );
    };
    const repository: CodeRepository =
      await GitHubWorkflowClient.resolveRepository(data);
    let token: GitHubInstallationToken;

    try {
      token = await GitHubUtil.getInstallationAccessToken(
        repository.gitHubAppInstallationId!,
        {
          permissions: data.permissions,
          repositories: [repository.repositoryName!],
          requestOptions: GitHubWorkflowClient.getRequestOptions(remainingTime),
          sanitizeErrors: true,
        },
      );
    } catch (error) {
      if (error instanceof GitHubWorkflowError) {
        throw error;
      }
      throw new GitHubWorkflowError(
        "Unable to authorize GitHub. Check the app configuration, repository access, and required permissions.",
      );
    }

    if (typeof token.token !== "string" || !token.token) {
      throw new GitHubWorkflowError(
        "GitHub returned an invalid installation token.",
      );
    }

    const path: string = [
      "repos",
      repository.organizationName!,
      repository.repositoryName!,
      ...data.path,
    ]
      .map((part: string): string => {
        return encodeURIComponent(part);
      })
      .join("/");

    let response: HTTPResponse<JSONObject | JSONArray> | HTTPErrorResponse;
    try {
      response = await API.fetch<JSONObject | JSONArray>({
        method: data.method,
        url: URL.fromString(`https://api.github.com/${path}`),
        headers: {
          Authorization: `Bearer ${token.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(data.body ? { data: data.body } : {}),
        options: GitHubWorkflowClient.getRequestOptions(remainingTime),
      });
    } catch (error) {
      if (error instanceof GitHubWorkflowError) {
        throw error;
      }
      /*
       * Transport errors can contain request config, authorization headers, or
       * arbitrary upstream bodies. None are suitable for a workflow log.
       */
      throw new GitHubWorkflowError(
        "GitHub request failed or timed out. Check GitHub before retrying an action that creates content.",
      );
    }

    if (
      response instanceof HTTPErrorResponse ||
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      throw GitHubWorkflowClient.responseError(response.statusCode);
    }

    if (!response.data || typeof response.data !== "object") {
      throw new GitHubWorkflowError("GitHub returned an invalid response.");
    }

    /*
     * Defensive last boundary: even a proxy that echoes the request token must
     * not put it into workflow return values. No response headers are exposed.
     */
    const cleanResponse: string = JSON.stringify(response.data)
      .split(token.token)
      .join("[redacted]");
    return {
      statusCode: response.statusCode,
      data: JSON.parse(cleanResponse) as JSONObject | JSONArray,
    };
  }

  public static async hasWriteAccess(data: {
    projectId: ObjectID;
    repository: string;
    username: string;
  }): Promise<boolean> {
    if (
      typeof data.username !== "string" ||
      !GITHUB_USERNAME_PATTERN.test(data.username)
    ) {
      return false;
    }
    try {
      const response: GitHubWorkflowResponse =
        await GitHubWorkflowClient.request({
          ...data,
          method: HTTPMethod.GET,
          path: ["collaborators", data.username, "permission"],
          permissions: { metadata: "read" },
        });
      const permission: unknown = (response.data as JSONObject)["permission"];
      return permission === "write" || permission === "admin";
    } catch (error) {
      if (error instanceof GitHubWorkflowError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}
