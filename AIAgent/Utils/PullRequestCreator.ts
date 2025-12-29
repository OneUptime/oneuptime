import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONArray } from "Common/Types/JSON";
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

  // Create a pull request on GitHub
  public async createPullRequest(
    options: PullRequestOptions,
  ): Promise<PullRequestResult> {
    await this.log(
      `Creating pull request: ${options.title} (${options.headBranch} -> ${options.baseBranch})`,
    );

    const url: URL = URL.fromString(
      `${PullRequestCreator.GITHUB_API_BASE}/repos/${options.organizationName}/${options.repositoryName}/pulls`,
    );

    const headers: Headers = this.getHeaders(options.token);

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        title: options.title,
        body: options.body,
        head: options.headBranch,
        base: options.baseBranch,
        draft: options.draft || false,
      },
      headers,
    });

    if (!response.isSuccess()) {
      const errorData: JSONObject = response.data as JSONObject;
      const errorMessage: string =
        (errorData["message"] as string) || "Failed to create pull request";
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

    const response: HTTPResponse<JSONObject> = await API.get({
      url,
      headers,
    });

    if (!response.isSuccess()) {
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

    const response: HTTPResponse<JSONArray> | HTTPErrorResponse = await API.get({
      url,
      headers,
      params: {
        head: `${organizationName}:${headBranch}`,
        base: baseBranch,
        state: "open",
      },
    });

    if (!response.isSuccess()) {
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

    const response: HTTPResponse<JSONObject> = await API.patch({
      url,
      data: updates,
      headers,
    });

    if (!response.isSuccess()) {
      const errorData: JSONObject = response.data as JSONObject;
      const errorMessage: string =
        (errorData["message"] as string) || "Failed to update pull request";
      throw new Error(`Failed to update pull request: ${errorMessage}`);
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: { labels },
      headers,
    });

    if (!response.isSuccess()) {
      logger.warn(`Failed to add labels to PR #${issueNumber}`);
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data,
      headers,
    });

    if (!response.isSuccess()) {
      logger.warn(`Failed to request reviewers for PR #${pullNumber}`);
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

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: { body: comment },
      headers,
    });

    if (!response.isSuccess()) {
      logger.warn(`Failed to add comment to PR #${issueNumber}`);
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
