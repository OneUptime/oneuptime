import Execute from "../../Execute";
import logger from "../../Logger";
import HostedCodeRepository from "../HostedCodeRepository/HostedCodeRepository";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import PullRequest from "../../../../Types/CodeRepository/PullRequest";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import FixPullRequestCiStatus, {
  FixPullRequestCiCheckRunCounts,
  FixPullRequestCiStatusHelper,
} from "../../../../Types/AI/FixPullRequestCiStatus";
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
import GlobalCache from "../../../Infrastructure/GlobalCache";
import * as crypto from "crypto";

/**
 * Error thrown when a GitHub App installation is no longer valid (e.g., uninstalled from GitHub)
 */
export class GitHubInstallationNotFoundError extends BadDataException {
  public constructor() {
    super(
      "GitHub App installation not found. The app may have been uninstalled from GitHub. Please reconnect with GitHub to reinstall the app.",
    );
  }
}

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

// Check-run counts for one ref plus the rolled-up conclusion.
export interface GitHubCheckRunsSummary extends FixPullRequestCiCheckRunCounts {
  conclusion: FixPullRequestCiStatus;
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
        /*
         * Check-run READ access for the Tier 1 CI verification sweep. The
         * GitHub App must have the "Checks: Read-only" permission configured
         * or requesting this scope fails with 422 — callers that can degrade
         * (the PR sync sweep) retry without it.
         */
        checks?: "read";
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

      // Check if the installation is not found (404) - this means the app was uninstalled from GitHub
      if (result.statusCode === 404) {
        logger.error(
          `GitHub App installation not found (ID: ${installationId}). ` +
            `The app may have been uninstalled from GitHub. User needs to reinstall the app.`,
        );
        throw new GitHubInstallationNotFoundError();
      }

      if (
        errorMessage.includes("permissions") ||
        result.statusCode === 403 ||
        result.statusCode === 422
      ) {
        logger.error(
          `GitHub App permission error: ${errorMessage}. ` +
            `Please ensure the GitHub App is configured with the required permissions ` +
            `(contents: write, pull_requests: write, metadata: read; checks: read for CI verification) in the GitHub App settings.`,
        );
      }

      throw result;
    }

    return {
      token: result.data["token"] as string,
      expiresAt: OneUptimeDate.fromString(result.data["expires_at"] as string),
    };
  }

  /*
   * Maps GitHub's pull-request JSON to our PullRequestState. GitHub reports
   * merged PRs as state "closed" with merged_at set — merged must be checked
   * first or every merge counts as a plain close.
   */
  public static mapGitHubPullRequestToState(
    pullRequest: JSONObject,
  ): PullRequestState {
    if (pullRequest["merged_at"] || pullRequest["merged"] === true) {
      return PullRequestState.Merged;
    }

    if (pullRequest["state"] === "closed") {
      return PullRequestState.Closed;
    }

    return PullRequestState.Open;
  }

  // Fetches the current state of one pull request via the GitHub App installation.
  @CaptureSpan()
  public static async getPullRequestState(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    pullRequestNumber: number;
  }): Promise<PullRequestState> {
    const tokenData: GitHubInstallationToken =
      await GitHubUtil.getInstallationAccessToken(data.installationId, {
        permissions: {
          pull_requests: "read",
          metadata: "read",
        },
      });

    return GitHubUtil.getPullRequestStateWithToken({
      token: tokenData.token,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
      pullRequestNumber: data.pullRequestNumber,
    });
  }

  /*
   * Same as getPullRequestState but with a pre-minted installation token, so
   * callers syncing many PRs in one repository can reuse a single token.
   */
  @CaptureSpan()
  public static async getPullRequestStateWithToken(data: {
    token: string;
    organizationName: string;
    repositoryName: string;
    pullRequestNumber: number;
  }): Promise<PullRequestState> {
    const url: URL = URL.fromString(
      `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls/${data.pullRequestNumber}`,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get({
      url: url,
      headers: {
        Authorization: `Bearer ${data.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return GitHubUtil.mapGitHubPullRequestToState(result.data);
  }

  /*
   * Check-run conclusions that count as PASSING when the run completes.
   * "success" is obvious; "neutral" and "skipped" are conventionally passing
   * (GitHub itself treats both as success for required checks). EVERYTHING
   * else — failure, timed_out, cancelled, action_required, stale,
   * startup_failure, or any future conclusion we have never seen — counts as
   * FAILED: per gate G9 an unknown conclusion must read as unverified, never
   * verified.
   */
  private static readonly passingCheckRunConclusions: Array<string> = [
    "success",
    "neutral",
    "skipped",
  ];

  /*
   * Counts a ref's check runs and rolls them into one conclusion
   * (Tier 1 CI verification: we READ the customer's CI, we never re-run or
   * gate it). A check run is pending until its status is "completed";
   * roll-up order (no runs -> NoCiConfigured, any pending -> Pending, any
   * failed -> Red, else Green) lives in FixPullRequestCiStatusHelper.
   */
  public static summarizeCheckRuns(
    checkRuns: JSONArray,
  ): GitHubCheckRunsSummary {
    let completed: number = 0;
    let failed: number = 0;
    let pending: number = 0;

    for (const checkRun of checkRuns) {
      const run: JSONObject = checkRun as JSONObject;

      if (run["status"] !== "completed") {
        pending++;
        continue;
      }

      completed++;

      if (
        !GitHubUtil.passingCheckRunConclusions.includes(
          String(run["conclusion"]),
        )
      ) {
        failed++;
      }
    }

    const counts: FixPullRequestCiCheckRunCounts = {
      total: checkRuns.length,
      completed: completed,
      failed: failed,
      pending: pending,
    };

    return {
      ...counts,
      conclusion: FixPullRequestCiStatusHelper.rollUpConclusion(counts),
    };
  }

  /*
   * Fetches the check runs for a ref (the PR's head branch) via the GitHub
   * App and rolls them up into one conclusion. Requires the App to have
   * "Checks: Read-only" — the token is minted with checks: read.
   */
  @CaptureSpan()
  public static async getCheckRunsConclusion(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    headRefName: string;
  }): Promise<GitHubCheckRunsSummary> {
    const tokenData: GitHubInstallationToken =
      await GitHubUtil.getInstallationAccessToken(data.installationId, {
        permissions: {
          checks: "read",
          metadata: "read",
        },
      });

    return GitHubUtil.getCheckRunsConclusionWithToken({
      token: tokenData.token,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
      headRefName: data.headRefName,
    });
  }

  /*
   * Same as getCheckRunsConclusion but with a pre-minted installation token
   * (which must carry checks: read), so callers sweeping many PRs can reuse
   * a single token per installation — the SyncPullRequestStates idiom.
   */
  @CaptureSpan()
  public static async getCheckRunsConclusionWithToken(data: {
    token: string;
    organizationName: string;
    repositoryName: string;
    headRefName: string;
  }): Promise<GitHubCheckRunsSummary> {
    const allCheckRuns: JSONArray = [];
    let page: number = 1;
    let hasMore: boolean = true;

    while (hasMore) {
      /*
       * GET commits/{ref}/check-runs resolves a branch name to its latest
       * commit and returns the latest check run per check name
       * (filter=latest is the API default) — exactly the conclusion a
       * reviewer sees on the PR.
       */
      const url: URL = URL.fromString(
        `https://api.github.com/repos/${data.organizationName}/${
          data.repositoryName
        }/commits/${encodeURIComponent(
          data.headRefName,
        )}/check-runs?per_page=100&page=${page}`,
      );

      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: url,
          headers: {
            Authorization: `Bearer ${data.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const checkRuns: JSONArray =
        (result.data["check_runs"] as JSONArray) || [];
      allCheckRuns.push(...checkRuns);

      hasMore = checkRuns.length === 100;
      page++;
    }

    return GitHubUtil.summarizeCheckRuns(allCheckRuns);
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
   * Lists every file (blob) path in a repository's tree at the given branch.
   * Results are cached in GlobalCache for an hour because callers (e.g. the
   * stack-trace repository resolver) may probe several repositories per
   * exception and re-run often.
   * @returns Array of repository-relative file paths
   */
  @CaptureSpan()
  public static async getRepositoryTreePaths(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    branchName: string;
  }): Promise<Array<string>> {
    const cacheNamespace: string = "github-repo-tree";
    const cacheKey: string = `${data.organizationName}/${data.repositoryName}@${data.branchName}`;

    try {
      const cachedPaths: Array<string> | null =
        await GlobalCache.getStringArray(cacheNamespace, cacheKey);

      if (cachedPaths !== null) {
        return cachedPaths;
      }
    } catch (err) {
      // Cache being unavailable must not block the tree fetch.
      logger.debug(err);
    }

    const tokenData: GitHubInstallationToken =
      await GitHubUtil.getInstallationAccessToken(data.installationId, {
        permissions: {
          contents: "read",
          metadata: "read",
        },
      });

    const url: URL = URL.fromString(
      `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/git/trees/${data.branchName}?recursive=1`,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get({
      url: url,
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    if (result.data["truncated"] === true) {
      logger.warn(
        `GitHub tree for ${data.organizationName}/${data.repositoryName}@${data.branchName} is truncated - the repository is very large, so path matching may be incomplete.`,
      );
    }

    const tree: JSONArray = (result.data["tree"] as JSONArray) || [];
    const paths: Array<string> = [];

    for (const entry of tree) {
      const entryData: JSONObject = entry as JSONObject;

      if (entryData["type"] === "blob" && entryData["path"]) {
        paths.push(entryData["path"] as string);
      }
    }

    try {
      await GlobalCache.setStringArray(cacheNamespace, cacheKey, paths, {
        expiresInSeconds: 60 * 60, // 1 hour
      });
    } catch (err) {
      logger.debug(err);
    }

    return paths;
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
