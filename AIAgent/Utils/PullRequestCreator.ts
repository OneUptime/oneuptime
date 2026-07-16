import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONArray, JSONValue } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import Headers from "Common/Types/API/Headers";
import TaskLogger from "./TaskLogger";

export interface PullRequestOptions {
  token: string;
  organizationName: string;
  repositoryName: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  /*
   * AI-authored fix PRs open as DRAFTS by default (G11 posture: a human
   * reviews and marks them ready — nothing lands review-ready
   * automatically). Pass false explicitly to opt out. Repositories where
   * GitHub rejects drafts (private repos on plans without the feature)
   * fall back to a non-draft PR automatically.
   */
  draft?: boolean;
}

export interface PullRequestResult {
  id: number;
  number: number;
  url: string;
  htmlUrl: string;
  state: string;
  title: string;
}

export default class PullRequestCreator {
  private static readonly GITHUB_API_BASE: string = "https://api.github.com";
  private static readonly GITHUB_API_VERSION: string = "2022-11-28";

  private logger: TaskLogger | null = null;

  public constructor(taskLogger?: TaskLogger) {
    if (taskLogger) {
      this.logger = taskLogger;
    }
  }

  /*
   * Create a pull request on GitHub — as a DRAFT by default, with a
   * graceful non-draft fallback when the repository does not support
   * drafts (GitHub answers 422 on private repos without the feature).
   */
  public async createPullRequest(
    options: PullRequestOptions,
  ): Promise<PullRequestResult> {
    const asDraft: boolean = options.draft !== false;

    await this.log(
      `Creating ${asDraft ? "draft " : ""}pull request: ${options.title} (${options.headBranch} -> ${options.baseBranch})`,
    );

    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${options.organizationName}/${options.repositoryName}/pulls`,
    );

    const headers: Headers = this.getHeaders(options.token);

    const requestBody: (draft: boolean) => JSONObject = (
      draft: boolean,
    ): JSONObject => {
      return {
        title: options.title,
        body: options.body,
        head: options.headBranch,
        base: options.baseBranch,
        draft,
      };
    };

    let response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
      {
        url,
        data: requestBody(asDraft),
        headers,
      },
    );

    /*
     * Draft rejected by this repository (422 naming drafts): retry once as
     * a regular PR. Human review stays mandatory either way — the draft
     * state is a review-pressure signal, not the safety boundary.
     */
    if (
      response instanceof HTTPErrorResponse &&
      asDraft &&
      this.isDraftNotSupportedError(response)
    ) {
      const rejectionMessage: string =
        response.message || "draft pull request rejected";

      logger.warn(
        `GitHub rejected the draft pull request for ${options.organizationName}/${options.repositoryName} (${rejectionMessage}); retrying as a non-draft pull request.`,
      );
      await this.log(
        `This repository does not support draft pull requests — opening a regular pull request instead. Please treat it as unreviewed.`,
      );

      response = await API.post({
        url,
        data: requestBody(false),
        headers,
      });
    }

    if (response instanceof HTTPErrorResponse) {
      const errorMessage: string =
        PullRequestCreator.describeGitHubError(response);
      logger.error(`GitHub API error: ${errorMessage}`);
      throw new Error(`Failed to create pull request: ${errorMessage}`);
    }

    const data: JSONObject = response.data as JSONObject;

    const result: PullRequestResult = {
      id: data["id"] as number,
      number: data["number"] as number,
      url: data["url"] as string,
      htmlUrl: data["html_url"] as string,
      state: data["state"] as string,
      title: data["title"] as string,
    };

    await this.log(`Pull request created: ${result.htmlUrl}`);

    return result;
  }

  /*
   * True when a failed create-PR response is GitHub refusing the DRAFT
   * state specifically (HTTP 422 whose message/errors mention drafts) —
   * e.g. "Draft pull requests are not supported in this repository."
   * Anything else (bad branch, permissions, validation) must NOT trigger
   * the non-draft retry.
   */
  private isDraftNotSupportedError(response: HTTPErrorResponse): boolean {
    if (response.statusCode !== 422) {
      return false;
    }

    const errorData: JSONObject = (response.data as JSONObject) || {};

    const textParts: Array<string> = [
      (errorData["message"] as string) || "",
      JSON.stringify(errorData["errors"] || ""),
    ];

    return textParts.join(" ").toLowerCase().includes("draft");
  }

  /*
   * GitHub's top-level `message` on a 422 is only ever "Validation Failed" —
   * the actionable part ("A pull request already exists for...", an invalid
   * `head`) lives in the `errors` array, so fold both into one line.
   */
  private static describeGitHubError(response: HTTPErrorResponse): string {
    const parts: Array<string> = [];

    if (response.message) {
      parts.push(response.message);
    }

    const errors: JSONValue | undefined = (response.data as JSONObject)?.[
      "errors"
    ];

    if (Array.isArray(errors) && errors.length > 0) {
      const details: string = errors
        .map((error: JSONValue) => {
          if (typeof error === "string") {
            return error;
          }

          const errorObject: JSONObject = error as JSONObject;

          return (
            (errorObject["message"] as string) ||
            [errorObject["field"], errorObject["code"]]
              .filter(Boolean)
              .join(" ") ||
            JSON.stringify(error)
          );
        })
        .filter(Boolean)
        .join("; ");

      if (details) {
        parts.push(`(${details})`);
      }
    }

    return parts.join(" ") || `GitHub returned HTTP ${response.statusCode}`;
  }

  // Get an existing pull request by number
  public async getPullRequest(
    token: string,
    organizationName: string,
    repositoryName: string,
    pullNumber: number,
  ): Promise<PullRequestResult | null> {
    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${organizationName}/${repositoryName}/pulls/${pullNumber}`,
    );

    const headers: Headers = this.getHeaders(token);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get({
        url,
        headers,
      });

    if (response instanceof HTTPErrorResponse) {
      return null;
    }

    const data: JSONObject = response.data as JSONObject;

    return {
      id: data["id"] as number,
      number: data["number"] as number,
      url: data["url"] as string,
      htmlUrl: data["html_url"] as string,
      state: data["state"] as string,
      title: data["title"] as string,
    };
  }

  // Check if a pull request already exists for a branch
  public async findExistingPullRequest(
    token: string,
    organizationName: string,
    repositoryName: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<PullRequestResult | null> {
    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${organizationName}/${repositoryName}/pulls`,
    );

    const headers: Headers = this.getHeaders(token);

    const response: HTTPResponse<JSONArray> | HTTPErrorResponse = await API.get(
      {
        url,
        headers,
        params: {
          head: `${organizationName}:${headBranch}`,
          base: baseBranch,
          state: "open",
        },
      },
    );

    if (response instanceof HTTPErrorResponse) {
      return null;
    }

    const pulls: JSONArray = response.data as JSONArray;

    if (pulls.length > 0) {
      const data: JSONObject = pulls[0] as JSONObject;
      return {
        id: data["id"] as number,
        number: data["number"] as number,
        url: data["url"] as string,
        htmlUrl: data["html_url"] as string,
        state: data["state"] as string,
        title: data["title"] as string,
      };
    }

    return null;
  }

  // Update an existing pull request
  public async updatePullRequest(
    token: string,
    organizationName: string,
    repositoryName: string,
    pullNumber: number,
    updates: { title?: string; body?: string; state?: "open" | "closed" },
  ): Promise<PullRequestResult> {
    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${organizationName}/${repositoryName}/pulls/${pullNumber}`,
    );

    const headers: Headers = this.getHeaders(token);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.patch({
        url,
        data: updates,
        headers,
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(
        `Failed to update pull request: ${PullRequestCreator.describeGitHubError(response)}`,
      );
    }

    const data: JSONObject = response.data as JSONObject;

    return {
      id: data["id"] as number,
      number: data["number"] as number,
      url: data["url"] as string,
      htmlUrl: data["html_url"] as string,
      state: data["state"] as string,
      title: data["title"] as string,
    };
  }

  // Add labels to a pull request
  public async addLabels(
    token: string,
    organizationName: string,
    repositoryName: string,
    issueNumber: number,
    labels: Array<string>,
  ): Promise<void> {
    await this.log(`Adding labels to PR #${issueNumber}: ${labels.join(", ")}`);

    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${organizationName}/${repositoryName}/issues/${issueNumber}/labels`,
    );

    const headers: Headers = this.getHeaders(token);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url,
        data: { labels },
        headers,
      });

    if (response instanceof HTTPErrorResponse) {
      logger.warn(
        `Failed to add labels to PR #${issueNumber}: ${PullRequestCreator.describeGitHubError(response)}`,
      );
    }
  }

  // Add reviewers to a pull request
  public async requestReviewers(
    token: string,
    organizationName: string,
    repositoryName: string,
    pullNumber: number,
    reviewers: Array<string>,
    teamReviewers?: Array<string>,
  ): Promise<void> {
    await this.log(`Requesting reviewers for PR #${pullNumber}`);

    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${organizationName}/${repositoryName}/pulls/${pullNumber}/requested_reviewers`,
    );

    const headers: Headers = this.getHeaders(token);

    const data: JSONObject = {
      reviewers,
    };

    if (teamReviewers && teamReviewers.length > 0) {
      data["team_reviewers"] = teamReviewers;
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url,
        data,
        headers,
      });

    if (response instanceof HTTPErrorResponse) {
      logger.warn(
        `Failed to request reviewers for PR #${pullNumber}: ${PullRequestCreator.describeGitHubError(response)}`,
      );
    }
  }

  // Add a comment to a pull request
  public async addComment(
    token: string,
    organizationName: string,
    repositoryName: string,
    issueNumber: number,
    comment: string,
  ): Promise<void> {
    await this.log(`Adding comment to PR #${issueNumber}`);

    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${organizationName}/${repositoryName}/issues/${issueNumber}/comments`,
    );

    const headers: Headers = this.getHeaders(token);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url,
        data: { body: comment },
        headers,
      });

    if (response instanceof HTTPErrorResponse) {
      logger.warn(
        `Failed to add comment to PR #${issueNumber}: ${PullRequestCreator.describeGitHubError(response)}`,
      );
    }
  }

  // Generate PR body from exception details
  public static generatePRBody(data: {
    exceptionMessage: string;
    exceptionType: string;
    stackTrace: string;
    serviceName: string;
    summary: string;
  }): string {
    return `## Exception Fix

This pull request was automatically generated by OneUptime AI Agent to fix an exception.

### Exception Details

**Service:** ${data.serviceName}
**Type:** ${data.exceptionType}
**Message:** ${data.exceptionMessage}

### Stack Trace

\`\`\`
${data.stackTrace.substring(0, 2000)}${data.stackTrace.length > 2000 ? "\n...(truncated)" : ""}
\`\`\`

### Summary of Changes

${data.summary}

---

> **Opened as a draft — review before merging.** The fix is AI-authored: verify it actually addresses the exception, then mark the pull request ready for review. Nothing is merged automatically.

*This PR was automatically generated by [OneUptime AI Agent](https://oneuptime.com)*`;
  }

  // Generate PR title from exception
  public static generatePRTitle(exceptionMessage: string): string {
    // Truncate and clean the message for use as a title
    const cleanMessage: string = exceptionMessage
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const maxLength: number = 70;
    if (cleanMessage.length <= maxLength) {
      return `fix: ${cleanMessage}`;
    }

    return `fix: ${cleanMessage.substring(0, maxLength - 3)}...`;
  }

  // Helper method to get GitHub API headers
  private getHeaders(token: string): Headers {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": PullRequestCreator.GITHUB_API_VERSION,
      "Content-Type": "application/json",
    };
  }

  // Helper method for logging
  private async log(message: string): Promise<void> {
    if (this.logger) {
      await this.logger.info(message);
    } else {
      logger.debug(message);
    }
  }
}
