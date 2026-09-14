import logger from "../../Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import Headers from "../../../../Types/API/Headers";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import { GitHubAppName } from "../../../EnvironmentConfig";
import GitHubUtil, { GitHubInstallationToken } from "./GitHub";

/*
 * The GitHub REST surface the interactive app needs: issue and pull request
 * conversations, reactions, reviews, labels and collaborator permissions.
 *
 * Kept apart from GitHub.ts on purpose. That file is the CODE path — clone,
 * read files, commit, open pull requests — and its callers are the fix
 * pipeline. This one is the CONVERSATION path, reached from the webhook
 * handler and the run-reply helper, and every method here writes something a
 * human will read in a repository we do not own. The split keeps "what the
 * agent may change" and "what the app may say" reviewable independently.
 */

// One reaction GitHub accepts on an issue, comment or review comment.
export enum GitHubReaction {
  // Acknowledgement: "seen, working on it".
  Eyes = "eyes",
  // Success.
  Rocket = "rocket",
  // Refusal / failure.
  Confused = "confused",
}

export interface GitHubIssueComment {
  commentId: number;
  htmlUrl: string;
  body: string;
  authorLogin: string;
  // GitHub App comments have type "Bot"; the app's own replies must not loop.
  isBot: boolean;
  createdAt: string;
}

export interface GitHubIssueDetails {
  issueNumber: number;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  authorLogin: string;
  labels: Array<string>;
  /*
   * GitHub models pull requests as issues, so /issues/{n} answers for both.
   * The `pull_request` key is the only reliable discriminator on that route.
   */
  isPullRequest: boolean;
}

export interface GitHubPullRequestDetails {
  pullRequestNumber: number;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  authorLogin: string;
  headRefName: string;
  headSha: string;
  baseRefName: string;
  /*
   * "owner/repo" of the branch this pull request is FROM. Equal to the base
   * repository for an ordinary branch pull request; different for one opened
   * from a fork — and a fork's branch does not exist in the repository this
   * installation can write to, so anything that pushes must check this first.
   */
  headRepositoryFullName: string | null;
  isDraft: boolean;
  isMerged: boolean;
  changedFilesCount: number;
  additions: number;
  deletions: number;
}

export interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  // Absent for binary files and for files whose diff GitHub declined to send.
  patch: string | null;
}

// One inline review comment, anchored to a line of the pull request's diff.
export interface GitHubReviewComment {
  path: string;
  // Line number in the file AFTER the change (GitHub's RIGHT side).
  line: number;
  body: string;
}

/*
 * What a GitHub user may do in a repository, as reported by the collaborator
 * permission API. Ordered least to most privileged.
 */
export enum GitHubRepositoryPermission {
  None = "none",
  Read = "read",
  Triage = "triage",
  Write = "write",
  Maintain = "maintain",
  Admin = "admin",
}

// Retire a cached installation token this long before GitHub expires it.
const TOKEN_EXPIRY_SAFETY_MARGIN_MS: number = 60 * 1000;

const APP_SLUG_CACHE_NAMESPACE: string = "github-app";
const APP_SLUG_CACHE_KEY: string = "slug";
const APP_SLUG_CACHE_SECONDS: number = 60 * 60 * 24;

interface CachedInstallationToken {
  token: string;
  expiresAtMilliseconds: number;
}

export default class GitHubConversation {
  private static tokenCache: Map<string, CachedInstallationToken> = new Map<
    string,
    CachedInstallationToken
  >();

  /*
   * Whether this pull request's branch lives in a DIFFERENT repository.
   *
   * This decides whether a revision is possible at all. An installation token
   * is scoped to the repositories the app is installed on, and a fork is not
   * one of them — so pushing a "revision" of a fork pull request would either
   * be refused or, worse, create a same-named branch in the BASE repository
   * that the pull request does not point at. Neither is what anyone asked for.
   *
   * A null head repository (GitHub reports one for a deleted fork) counts as a
   * fork: it is certainly not a branch we can push to.
   */
  public static isFromFork(pullRequest: {
    headRepositoryFullName: string | null;
    organizationName: string;
    repositoryName: string;
  }): boolean {
    if (!pullRequest.headRepositoryFullName) {
      return true;
    }

    return (
      pullRequest.headRepositoryFullName.toLowerCase() !==
      `${pullRequest.organizationName}/${pullRequest.repositoryName}`.toLowerCase()
    );
  }

  private static buildHeaders(token: string): Headers {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /*
   * Every conversation write needs issues:write (GitHub routes pull request
   * conversation comments through the issues API) and pull_requests:write for
   * reviews. metadata:read is mandatory on every installation token.
   *
   * Cached IN PROCESS, never in Redis. Answering one mention touches GitHub
   * five or six times — permission check, issue read, pull request read,
   * reaction, comment — and minting a fresh `ghs_` token for each is both
   * pointless latency and a real slice of the installation's rate limit. But
   * an installation token is a live write credential for someone else's
   * repositories, so it does not leave this process: a module-level Map dies
   * with the pod, whereas a shared cache turns one Redis exposure into
   * cross-tenant repository access.
   *
   * Retired a minute before GitHub expires it, so a token cannot go stale
   * between the check and the request that uses it.
   */
  private static async getConversationToken(
    installationId: string,
  ): Promise<string> {
    const cached: CachedInstallationToken | undefined =
      GitHubConversation.tokenCache.get(installationId);

    if (cached && cached.expiresAtMilliseconds > Date.now()) {
      return cached.token;
    }

    const tokenData: GitHubInstallationToken =
      await GitHubUtil.getInstallationAccessToken(installationId, {
        permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "read",
          metadata: "read",
        },
      });

    GitHubConversation.tokenCache.set(installationId, {
      token: tokenData.token,
      expiresAtMilliseconds:
        tokenData.expiresAt.getTime() - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
    });

    return tokenData.token;
  }

  // Drops every cached token. Exists so tests never share one across cases.
  public static clearTokenCache(): void {
    GitHubConversation.tokenCache.clear();
  }

  private static repoApiUrl(data: {
    organizationName: string;
    repositoryName: string;
  }): string {
    return `https://api.github.com/repos/${encodeURIComponent(
      data.organizationName,
    )}/${encodeURIComponent(data.repositoryName)}`;
  }

  /*
   * The app's own slug — what users type after the "@" and what its bot login
   * (`<slug>[bot]`) is derived from.
   *
   * Read from GET /app rather than trusted from GITHUB_APP_NAME, because that
   * variable holds the app's DISPLAY NAME. GitHub derives the slug from it by
   * lowercasing and replacing spaces with hyphens, so an app named "OneUptime
   * AI" is mentioned as "@oneuptime-ai" and a configuration that assumed
   * otherwise would silently never match a mention. The env var stays as the
   * fallback for instances whose credentials cannot reach GitHub.
   */
  @CaptureSpan()
  public static async getAppSlug(): Promise<string | null> {
    try {
      const cached: string | null = await GlobalCache.getString(
        APP_SLUG_CACHE_NAMESPACE,
        APP_SLUG_CACHE_KEY,
      );

      if (cached) {
        return cached;
      }
    } catch (error) {
      // A cache outage must not stop the app from answering mentions.
      logger.debug(`Could not read the cached GitHub App slug: ${error}`);
    }

    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString("https://api.github.com/app"),
          headers: GitHubConversation.buildHeaders(GitHubUtil.generateAppJWT()),
        });

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const slug: string | undefined = result.data["slug"]?.toString();

      if (slug) {
        await GlobalCache.setString(
          APP_SLUG_CACHE_NAMESPACE,
          APP_SLUG_CACHE_KEY,
          slug,
          { expiresInSeconds: APP_SLUG_CACHE_SECONDS },
        ).catch((error: unknown) => {
          logger.debug(`Could not cache the GitHub App slug: ${error}`);
        });

        return slug;
      }
    } catch (error) {
      logger.debug(
        `Could not resolve the GitHub App slug from GitHub, falling back to GITHUB_APP_NAME: ${error}`,
      );
    }

    return GitHubConversation.slugifyAppName(GitHubAppName);
  }

  /*
   * GitHub's own slug rule, applied to the configured display name: lowercase,
   * every run of non-alphanumerics collapsed to a single hyphen, trimmed.
   */
  public static slugifyAppName(appName: string | null): string | null {
    if (!appName || !appName.trim()) {
      return null;
    }

    const slug: string = appName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return slug || null;
  }

  // The login GitHub attributes this app's own comments to.
  public static toBotLogin(appSlug: string): string {
    return `${appSlug.toLowerCase()}[bot]`;
  }

  /*
   * True when a login belongs to ANY GitHub App, not just this one. The loop
   * guard is deliberately broad: a comment written by any bot is never a human
   * asking for work, and two bots mentioning each other is the failure mode
   * that burns a budget overnight.
   */
  public static isBotLogin(login: string | null | undefined): boolean {
    return Boolean(login && login.toLowerCase().endsWith("[bot]"));
  }

  @CaptureSpan()
  public static async createIssueComment(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    issueNumber: number;
    body: string;
  }): Promise<GitHubIssueComment> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString(
          `${GitHubConversation.repoApiUrl(data)}/issues/${data.issueNumber}/comments`,
        ),
        data: { body: data.body },
        headers: GitHubConversation.buildHeaders(token),
      },
    );

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return GitHubConversation.toIssueComment(result.data);
  }

  /*
   * Editing the app's own acknowledgement in place, rather than appending a
   * second comment, is what keeps a long-running run from turning a thread
   * into a status log. One comment per command, updated as the run moves.
   */
  @CaptureSpan()
  public static async updateIssueComment(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    commentId: number;
    body: string;
  }): Promise<GitHubIssueComment> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.patch({
        url: URL.fromString(
          `${GitHubConversation.repoApiUrl(data)}/issues/comments/${data.commentId}`,
        ),
        data: { body: data.body },
        headers: GitHubConversation.buildHeaders(token),
      });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return GitHubConversation.toIssueComment(result.data);
  }

  /*
   * Reactions are the cheapest possible acknowledgement — they appear
   * instantly, cost the reader nothing, and cannot themselves be mistaken for
   * a mention. A failure to react is never worth failing a command over, so
   * this swallows its errors and reports whether it landed.
   */
  @CaptureSpan()
  public static async addReactionToComment(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    commentId: number;
    reaction: GitHubReaction;
  }): Promise<boolean> {
    try {
      const token: string = await GitHubConversation.getConversationToken(
        data.installationId,
      );

      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(
            `${GitHubConversation.repoApiUrl(data)}/issues/comments/${data.commentId}/reactions`,
          ),
          data: { content: data.reaction },
          headers: GitHubConversation.buildHeaders(token),
        });

      return !(result instanceof HTTPErrorResponse);
    } catch (error) {
      logger.debug(`Could not add a GitHub reaction: ${error}`);
      return false;
    }
  }

  @CaptureSpan()
  public static async addReactionToIssue(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    issueNumber: number;
    reaction: GitHubReaction;
  }): Promise<boolean> {
    try {
      const token: string = await GitHubConversation.getConversationToken(
        data.installationId,
      );

      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(
            `${GitHubConversation.repoApiUrl(data)}/issues/${data.issueNumber}/reactions`,
          ),
          data: { content: data.reaction },
          headers: GitHubConversation.buildHeaders(token),
        });

      return !(result instanceof HTTPErrorResponse);
    } catch (error) {
      logger.debug(`Could not add a GitHub reaction: ${error}`);
      return false;
    }
  }

  @CaptureSpan()
  public static async getIssue(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    issueNumber: number;
  }): Promise<GitHubIssueDetails> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get({
      url: URL.fromString(
        `${GitHubConversation.repoApiUrl(data)}/issues/${data.issueNumber}`,
      ),
      headers: GitHubConversation.buildHeaders(token),
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    const issue: JSONObject = result.data;

    return {
      issueNumber: (issue["number"] as number) || data.issueNumber,
      title: (issue["title"] as string) || "",
      body: (issue["body"] as string) || "",
      state: (issue["state"] as string) || "open",
      htmlUrl: (issue["html_url"] as string) || "",
      authorLogin: ((issue["user"] as JSONObject)?.["login"] as string) || "",
      labels: GitHubConversation.toLabelNames(issue["labels"] as JSONArray),
      isPullRequest: Boolean(issue["pull_request"]),
    };
  }

  @CaptureSpan()
  public static async getPullRequestDetails(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    pullRequestNumber: number;
  }): Promise<GitHubPullRequestDetails> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get({
      url: URL.fromString(
        `${GitHubConversation.repoApiUrl(data)}/pulls/${data.pullRequestNumber}`,
      ),
      headers: GitHubConversation.buildHeaders(token),
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    const pullRequest: JSONObject = result.data;
    const head: JSONObject = (pullRequest["head"] as JSONObject) || {};
    const base: JSONObject = (pullRequest["base"] as JSONObject) || {};

    return {
      pullRequestNumber:
        (pullRequest["number"] as number) || data.pullRequestNumber,
      title: (pullRequest["title"] as string) || "",
      body: (pullRequest["body"] as string) || "",
      state: (pullRequest["state"] as string) || "open",
      htmlUrl: (pullRequest["html_url"] as string) || "",
      authorLogin:
        ((pullRequest["user"] as JSONObject)?.["login"] as string) || "",
      headRefName: (head["ref"] as string) || "",
      headSha: (head["sha"] as string) || "",
      baseRefName: (base["ref"] as string) || "",
      headRepositoryFullName:
        ((head["repo"] as JSONObject)?.["full_name"] as string) || null,
      isDraft: pullRequest["draft"] === true,
      isMerged: Boolean(pullRequest["merged_at"]),
      changedFilesCount: (pullRequest["changed_files"] as number) || 0,
      additions: (pullRequest["additions"] as number) || 0,
      deletions: (pullRequest["deletions"] as number) || 0,
    };
  }

  /*
   * The pull request's diff, file by file. Capped rather than fully paginated:
   * a review prompt that cannot fit the diff is not improved by fetching more
   * of it, and an unbounded loop over a 5,000-file pull request is a way to
   * spend an hour of rate limit on a review nobody can read.
   */
  @CaptureSpan()
  public static async listPullRequestFiles(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    pullRequestNumber: number;
    maxFiles: number;
  }): Promise<Array<GitHubPullRequestFile>> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const files: Array<GitHubPullRequestFile> = [];
    const perPage: number = 100;
    let page: number = 1;

    while (files.length < data.maxFiles) {
      const result: HTTPErrorResponse | HTTPResponse<JSONArray> = await API.get(
        {
          url: URL.fromString(
            `${GitHubConversation.repoApiUrl(data)}/pulls/${data.pullRequestNumber}/files?per_page=${perPage}&page=${page}`,
          ),
          headers: GitHubConversation.buildHeaders(token),
        },
      );

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const pageFiles: JSONArray = result.data || [];

      for (const entry of pageFiles) {
        const file: JSONObject = entry as JSONObject;
        files.push({
          filename: (file["filename"] as string) || "",
          status: (file["status"] as string) || "",
          additions: (file["additions"] as number) || 0,
          deletions: (file["deletions"] as number) || 0,
          patch: (file["patch"] as string) || null,
        });
      }

      if (pageFiles.length < perPage) {
        break;
      }

      page++;
    }

    return files.slice(0, data.maxFiles);
  }

  /*
   * The most RECENT comments on an issue or pull request, returned oldest
   * first so the agent reads them the way a person would.
   *
   * Fetched newest-first and then reversed, rather than taking the first page
   * of GitHub's default oldest-first ordering. On a long thread those are
   * opposite things: the first page of a 200-comment issue is the discussion
   * from six months ago, and the review feedback that prompted this run is on
   * the last page. Asking for the newest is the only way to get the relevant
   * ones without paginating the whole thread.
   *
   * The app's OWN comments are returned too: the caller — not this reader —
   * decides what to do with bot authorship.
   */
  @CaptureSpan()
  public static async listIssueComments(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    issueNumber: number;
    maxComments: number;
  }): Promise<Array<GitHubIssueComment>> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const result: HTTPErrorResponse | HTTPResponse<JSONArray> = await API.get({
      url: URL.fromString(
        `${GitHubConversation.repoApiUrl(data)}/issues/${data.issueNumber}/comments?sort=created&direction=desc&per_page=${Math.min(
          Math.max(data.maxComments, 1),
          100,
        )}`,
      ),
      headers: GitHubConversation.buildHeaders(token),
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return (result.data || [])
      .map((entry: JSONObject) => {
        return GitHubConversation.toIssueComment(entry);
      })
      .slice(0, data.maxComments)
      .reverse();
  }

  /*
   * Post a review on a pull request.
   *
   * ALWAYS submitted as `COMMENT`, never APPROVE or REQUEST_CHANGES. An
   * approval from the app would satisfy a branch protection rule, which would
   * make an automated reviewer into an automated merger — the one thing this
   * integration must never become. Its opinion belongs in the text.
   *
   * Inline comments are best-effort: GitHub answers 422 for any anchor that is
   * not part of the diff (a line the agent misjudged, a file whose patch was
   * elided, a review racing a force-push). Losing the whole review to one bad
   * anchor is far worse than losing the anchors, so a 422 retries with the
   * body alone.
   */
  @CaptureSpan()
  public static async createPullRequestReview(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    pullRequestNumber: number;
    body: string;
    comments: Array<GitHubReviewComment>;
    commitSha?: string | undefined;
  }): Promise<string> {
    const token: string = await GitHubConversation.getConversationToken(
      data.installationId,
    );

    const url: URL = URL.fromString(
      `${GitHubConversation.repoApiUrl(data)}/pulls/${data.pullRequestNumber}/reviews`,
    );

    const headers: Headers = GitHubConversation.buildHeaders(token);

    const basePayload: JSONObject = {
      body: data.body,
      event: "COMMENT",
      ...(data.commitSha ? { commit_id: data.commitSha } : {}),
    };

    let result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post({
      url: url,
      data:
        data.comments.length > 0
          ? {
              ...basePayload,
              comments: data.comments.map((comment: GitHubReviewComment) => {
                return {
                  path: comment.path,
                  line: comment.line,
                  side: "RIGHT",
                  body: comment.body,
                };
              }),
            }
          : basePayload,
      headers: headers,
    });

    if (
      result instanceof HTTPErrorResponse &&
      data.comments.length > 0 &&
      result.statusCode === 422
    ) {
      logger.debug(
        `GitHub rejected the inline comments on the review for ${data.organizationName}/${data.repositoryName}#${data.pullRequestNumber}; posting the review body on its own.`,
      );

      result = await API.post({
        url: url,
        data: basePayload,
        headers: headers,
      });
    }

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return (result.data["html_url"] as string) || "";
  }

  /*
   * What a GitHub user may do in this repository.
   *
   * This is the authorization question for every command: a repository's
   * conversation is open to anyone with a GitHub account, so `author_association`
   * on the webhook payload ("CONTRIBUTOR", "NONE") is a description of past
   * activity, not a permission. Only this endpoint answers the actual one.
   *
   * A failure answers None. Denying a command because GitHub was unreachable
   * is a bad minute; running one because GitHub was unreachable is a breach.
   */
  @CaptureSpan()
  public static async getUserRepositoryPermission(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    username: string;
  }): Promise<GitHubRepositoryPermission> {
    try {
      const token: string = await GitHubConversation.getConversationToken(
        data.installationId,
      );

      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(
            `${GitHubConversation.repoApiUrl(data)}/collaborators/${encodeURIComponent(
              data.username,
            )}/permission`,
          ),
          headers: GitHubConversation.buildHeaders(token),
        });

      if (result instanceof HTTPErrorResponse) {
        /*
         * 404 is GitHub's answer for "not a collaborator" as well as for
         * "no such user" — both mean no permission, and neither is an error
         * worth logging as one.
         */
        if (result.statusCode !== 404) {
          logger.warn(
            `Could not read the GitHub repository permission for ${data.username} on ${data.organizationName}/${data.repositoryName}: ${result.statusCode}`,
          );
        }

        return GitHubRepositoryPermission.None;
      }

      const permission: string = (
        (result.data["permission"] as string) || "none"
      ).toLowerCase();

      /*
       * The top-level `permission` field collapses "maintain" to "write" and
       * "triage" to "read" for backwards compatibility. `role_name` carries
       * the real role, so prefer it when GitHub sends one.
       */
      const roleName: string = (
        (result.data["role_name"] as string) || permission
      ).toLowerCase();

      if (
        Object.values(GitHubRepositoryPermission).includes(
          roleName as GitHubRepositoryPermission,
        )
      ) {
        return roleName as GitHubRepositoryPermission;
      }

      if (
        Object.values(GitHubRepositoryPermission).includes(
          permission as GitHubRepositoryPermission,
        )
      ) {
        return permission as GitHubRepositoryPermission;
      }

      return GitHubRepositoryPermission.None;
    } catch (error) {
      logger.warn(
        `Could not read the GitHub repository permission for ${data.username}: ${error}`,
      );
      return GitHubRepositoryPermission.None;
    }
  }

  // Permission levels that may command the app. Read and Triage may not.
  public static canCommandApp(permission: GitHubRepositoryPermission): boolean {
    return (
      permission === GitHubRepositoryPermission.Write ||
      permission === GitHubRepositoryPermission.Maintain ||
      permission === GitHubRepositoryPermission.Admin
    );
  }

  private static toLabelNames(labels: JSONArray | undefined): Array<string> {
    if (!labels) {
      return [];
    }

    return labels
      .map((label: JSONObject) => {
        return typeof label === "string"
          ? (label as unknown as string)
          : ((label as JSONObject)?.["name"] as string) || "";
      })
      .filter((name: string) => {
        return Boolean(name);
      });
  }

  private static toIssueComment(comment: JSONObject): GitHubIssueComment {
    const authorLogin: string =
      ((comment["user"] as JSONObject)?.["login"] as string) || "";

    return {
      commentId: (comment["id"] as number) || 0,
      htmlUrl: (comment["html_url"] as string) || "",
      body: (comment["body"] as string) || "",
      authorLogin: authorLogin,
      isBot:
        ((comment["user"] as JSONObject)?.["type"] as string) === "Bot" ||
        GitHubConversation.isBotLogin(authorLogin),
      createdAt: (comment["created_at"] as string) || "",
    };
  }
}
