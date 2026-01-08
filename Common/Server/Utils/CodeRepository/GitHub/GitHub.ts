import Execute from "../../Execute";
import logger from "../../Logger";
import HostedCodeRepository from "../HostedCodeRepository/HostedCodeRepository";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import PullRequest from "../../../../Types/CodeRepository/PullRequest";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import OneUptimeDate from "../../../../Types/Date";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  GitHubAppId,
  GitHubAppPrivateKey,
  GitHubAppWebhookSecret,
} from "../../../EnvironmentConfig";
import BadDataException from "../../../../Types/Exception/BadDataException";
import * as crypto from "crypto";

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  ownerLogin: string;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: Date;
}

export default class GitHubUtil extends HostedCodeRepository {
  private getPullRequestFromJSONObject(data: {
    pullRequest: JSONObject;
    organizationName: string;
    repositoryName: string;
  }): PullRequest {
    let pullRequestState: PullRequestState =
      data.pullRequest["state"] === "open"
        ? PullRequestState.Open
        : PullRequestState.Closed;

    if (data.pullRequest["merged_at"]) {
      pullRequestState = PullRequestState.Merged;
    }

    return {
      pullRequestId: data.pullRequest["id"] as number,
      pullRequestNumber: data.pullRequest["number"] as number,
      title: data.pullRequest["title"] as string,
      body: data.pullRequest["body"] as string,
      url: URL.fromString(data.pullRequest["url"] as string),
      state: pullRequestState,
      createdAt: OneUptimeDate.fromString(
        data.pullRequest["created_at"] as string,
      ),
      updatedAt: OneUptimeDate.fromString(
        data.pullRequest["updated_at"] as string,
      ),
      repoOrganizationName: data.organizationName,
      repoName: data.repositoryName,
      headRefName:
        data.pullRequest["head"] &&
        (data.pullRequest["head"] as JSONObject)["ref"]
          ? ((data.pullRequest["head"] as JSONObject)["ref"] as string)
          : "",
    };
  }

  @CaptureSpan()
  public async getPullRequestByNumber(data: {
    organizationName: string;
    repositoryName: string;
    pullRequestId: string;
  }): Promise<PullRequest> {
    const gitHubToken: string = this.authToken;

    const url: URL = URL.fromString(
      `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls/${data.pullRequestId}`,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get({
      url: url,
      data: {},
      headers: {
        Authorization: `Bearer ${gitHubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return this.getPullRequestFromJSONObject({
      pullRequest: result.data,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
    });
  }

  private async getPullRequestsByPage(data: {
    organizationName: string;
    repositoryName: string;
    pullRequestState: PullRequestState;
    baseBranchName: string;
    page: number;
  }): Promise<Array<PullRequest>> {
    const gitHubToken: string = this.authToken;

    const url: URL = URL.fromString(
      `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls?base=${data.baseBranchName}&state=${data.pullRequestState}&per_page=100&page=${data.page}`,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONArray> = await API.get({
      url: url,
      data: {},
      headers: {
        Authorization: `Bearer ${gitHubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    const pullRequests: Array<PullRequest> = result.data.map(
      (pullRequest: JSONObject) => {
        return this.getPullRequestFromJSONObject({
          pullRequest: pullRequest,
          organizationName: data.organizationName,
          repositoryName: data.repositoryName,
        });
      },
    );

    return pullRequests;
  }

  @CaptureSpan()
  public override async getPullRequests(data: {
    pullRequestState: PullRequestState;
    baseBranchName: string;
    organizationName: string;
    repositoryName: string;
  }): Promise<Array<PullRequest>> {
    const allPullRequests: Array<PullRequest> = [];

    let page: number = 1;

    let pullRequests: Array<PullRequest> = await this.getPullRequestsByPage({
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
      pullRequestState: data.pullRequestState,
      baseBranchName: data.baseBranchName,
      page: page,
    });

    /*
     * Fetch all pull requests by paginating through the results
     * 100 pull requests per page is the limit of the GitHub API
     */
    while (pullRequests.length === page * 100 || page === 1) {
      pullRequests = await this.getPullRequestsByPage({
        organizationName: data.organizationName,
        repositoryName: data.repositoryName,
        pullRequestState: data.pullRequestState,
        baseBranchName: data.baseBranchName,
        page: page,
      });
      page++;
      allPullRequests.push(...pullRequests);
    }

    return allPullRequests;
  }

  @CaptureSpan()
  public override async addRemote(data: {
    remoteName: string;
    organizationName: string;
    repositoryName: string;
  }): Promise<void> {
    const url: URL = URL.fromString(
      `https://github.com/${data.organizationName}/${data.repositoryName}.git`,
    );

    logger.debug(
      `Adding remote '${data.remoteName}' for ${data.organizationName}/${data.repositoryName}`,
    );

    const result: string = await Execute.executeCommandFile({
      command: "git",
      args: ["remote", "add", data.remoteName, url.toString()],
      cwd: process.cwd(),
    });

    logger.debug(result);
  }

  @CaptureSpan()
  public override async pushChanges(data: {
    branchName: string;
    organizationName: string;
    repositoryName: string;
    repoPath: string;
  }): Promise<void> {
    const branchName: string = data.branchName;

    const username: string = this.username;
    const password: string = this.authToken;

    logger.debug(
      "Pushing changes to remote repository with username: " + username,
    );

    const encodedUsername: string = encodeURIComponent(username);
    const encodedPassword: string = encodeURIComponent(password);
    const remoteUrl: string = `https://${encodedUsername}:${encodedPassword}@github.com/${data.organizationName}/${data.repositoryName}.git`;

    logger.debug(
      `Pushing branch '${branchName}' to ${data.organizationName}/${data.repositoryName}`,
    );

    const result: string = await Execute.executeCommandFile({
      command: "git",
      args: ["push", "-u", remoteUrl, branchName],
      cwd: data.repoPath,
    });

    logger.debug(result);
  }

  @CaptureSpan()
  public override async createPullRequest(data: {
    baseBranchName: string;
    headBranchName: string;
    organizationName: string;
    repositoryName: string;
    title: string;
    body: string;
  }): Promise<PullRequest> {
    const gitHubToken: string = this.authToken;

    const url: URL = URL.fromString(
      `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls`,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: url,
        data: {
          base: data.baseBranchName,
          head: data.headBranchName,
          title: data.title,
          body: data.body,
        },
        headers: {
          Authorization: `Bearer ${gitHubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return this.getPullRequestFromJSONObject({
      pullRequest: result.data,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
    });
  }

  // GitHub App Authentication Methods

  /**
   * Generates a JWT for GitHub App authentication
   * @returns JWT string valid for 10 minutes
   */
  @CaptureSpan()
  public static generateAppJWT(): string {
    if (!GitHubAppId) {
      throw new BadDataException(
        "GITHUB_APP_ID environment variable is not set",
      );
    }

    if (!GitHubAppPrivateKey) {
      throw new BadDataException(
        "GITHUB_APP_PRIVATE_KEY environment variable is not set",
      );
    }

    const now: number = Math.floor(Date.now() / 1000);
    const payload: JSONObject = {
      iat: now - 60, // Issued at time (60 seconds in the past to allow for clock drift)
      exp: now + 600, // Expiration time (10 minutes from now)
      iss: GitHubAppId,
    };

    // Create JWT header
    const header: JSONObject = {
      alg: "RS256",
      typ: "JWT",
    };

    const encodedHeader: string = Buffer.from(JSON.stringify(header)).toString(
      "base64url",
    );
    const encodedPayload: string = Buffer.from(
      JSON.stringify(payload),
    ).toString("base64url");

    const signatureInput: string = `${encodedHeader}.${encodedPayload}`;

    // Sign with private key
    const sign: crypto.Sign = crypto.createSign("RSA-SHA256");
    sign.update(signatureInput);
    const signature: string = sign.sign(GitHubAppPrivateKey, "base64url");

    return `${signatureInput}.${signature}`;
  }

  /**
   * Gets an installation access token for a GitHub App installation
   * @param installationId - The GitHub App installation ID
   * @param options - Optional configuration for the token
   * @param options.permissions - Specific permissions to request for the token
   * @returns Installation token and expiration date
   */
  @CaptureSpan()
  public static async getInstallationAccessToken(
    installationId: string,
    options?: {
      permissions?: {
        contents?: "read" | "write";
        pull_requests?: "read" | "write";
        metadata?: "read";
      };
    },
  ): Promise<GitHubInstallationToken> {
    const jwt: string = GitHubUtil.generateAppJWT();

    const url: URL = URL.fromString(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
    );

    // Build request data with optional permissions
    const requestData: JSONObject = {};

    if (options?.permissions) {
      requestData["permissions"] = options.permissions;
    }

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: url,
        data: requestData,
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (result instanceof HTTPErrorResponse) {
      // Check if this is a permission error and provide helpful message
      const errorMessage: string =
        (result.data as JSONObject)?.["message"]?.toString() || "";

      if (
        errorMessage.includes("permissions") ||
        result.statusCode === 403 ||
        result.statusCode === 422
      ) {
        logger.error(
          `GitHub App permission error: ${errorMessage}. ` +
            `Please ensure the GitHub App is configured with the required permissions ` +
            `(contents: write, pull_requests: write, metadata: read) in the GitHub App settings.`,
        );
      }

      throw result;
    }

    return {
      token: result.data["token"] as string,
      expiresAt: OneUptimeDate.fromString(result.data["expires_at"] as string),
    };
  }

  /**
   * Lists repositories accessible to a GitHub App installation
   * @param installationId - The GitHub App installation ID
   * @returns Array of repositories
   */
  @CaptureSpan()
  public static async listRepositoriesForInstallation(
    installationId: string,
  ): Promise<Array<GitHubRepository>> {
    const tokenData: GitHubInstallationToken =
      await GitHubUtil.getInstallationAccessToken(installationId);

    const allRepositories: Array<GitHubRepository> = [];
    let page: number = 1;
    let hasMore: boolean = true;

    while (hasMore) {
      const url: URL = URL.fromString(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      );

      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: url,
          data: {},
          headers: {
            Authorization: `Bearer ${tokenData.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const repositories: JSONArray =
        (result.data["repositories"] as JSONArray) || [];

      for (const repo of repositories) {
        const repoData: JSONObject = repo as JSONObject;
        const owner: JSONObject = repoData["owner"] as JSONObject;

        allRepositories.push({
          id: repoData["id"] as number,
          name: repoData["name"] as string,
          fullName: repoData["full_name"] as string,
          private: repoData["private"] as boolean,
          htmlUrl: repoData["html_url"] as string,
          description: (repoData["description"] as string) || null,
          defaultBranch: repoData["default_branch"] as string,
          ownerLogin: owner["login"] as string,
        });
      }

      // Check if there are more pages
      if (repositories.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return allRepositories;
  }

  /**
   * Verifies a GitHub webhook signature
   * @param payload - The raw request body
   * @param signature - The X-Hub-Signature-256 header value
   * @returns true if signature is valid
   */
  public static verifyWebhookSignature(
    payload: string,
    signature: string,
  ): boolean {
    if (!GitHubAppWebhookSecret) {
      logger.warn(
        "GITHUB_APP_WEBHOOK_SECRET is not set, skipping verification",
      );
      return true;
    }

    const expectedSignature: string = `sha256=${crypto
      .createHmac("sha256", GitHubAppWebhookSecret)
      .update(payload)
      .digest("hex")}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature) as Uint8Array,
        Buffer.from(expectedSignature) as Uint8Array,
      );
    } catch {
      return false;
    }
  }

  /**
   * Gets the GitHub App installation URL for a project to install the app
   * @returns The installation URL
   */
  public static getAppInstallationUrl(): string {
    if (!GitHubAppId) {
      throw new BadDataException(
        "GITHUB_APP_ID environment variable is not set",
      );
    }

    /*
     * This is the standard GitHub App installation URL format
     * The app slug would typically come from another env var, but we can use the client ID approach
     */
    return `https://github.com/apps`;
  }
}
