import CodeHostApiClient, {
  CodeHostApiAnswer,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostApiClient";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostTransport,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { GITLAB_TOKEN_SCOPE_HINT } from "Common/Server/Utils/CodeRepository/CodeHost/GitLabApi";
import { FORGEJO_TOKEN_SCOPE_HINT } from "Common/Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import {
  CodeHost,
  CodeHostRunnerInfo,
  CodeHostUrl,
} from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import { RepositoryToken } from "./BackendAPI";
import GitHostGuard from "./GitHostGuard";
import PullRequestCreator, { PullRequestResult } from "./PullRequestCreator";
import TaskLogger from "./TaskLogger";

/*
 * OPENS THE PULL (OR MERGE) REQUEST OF A RUN'S CHANGE, WHEREVER THE
 * REPOSITORY IS HOSTED.
 *
 *   - GitHub: the GitHub App's token, through PullRequestCreator (drafts,
 *     its 422s, as it always did);
 *   - Forgejo and Gitea: POST /repos/{owner}/{repo}/pulls;
 *   - GitLab: POST /projects/{id}/merge_requests - a merge request, which
 *     Code shows as the task's pull request;
 *   - a Git repository has no pull request API OneUptime knows: the branch
 *     is pushed, and the person opens one on their Git server
 *     (hasPullRequests is false, and nothing here is called).
 *
 * Forgejo's and GitLab's APIs are called through GitHostGuard's transport -
 * the egress guard, pinned addresses, no redirects - with the token in a
 * header. A description is held to what every host takes, with a note when
 * it is cut (PullRequestCreator.truncateBody).
 */

export interface OpenPullRequestOptions {
  token: RepositoryToken;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}

export default class PullRequestOpener {
  private logger: TaskLogger | null;
  private transport: CodeHostTransport | null;

  public constructor(
    taskLogger?: TaskLogger | undefined,
    // Test seam: how the Forgejo and GitLab APIs are called.
    transport?: CodeHostTransport | undefined,
  ) {
    this.logger = taskLogger || null;
    this.transport = transport || null;
  }

  /*
   * Whether the repository's host takes pull requests from OneUptime: every
   * one but a plain Git repository.
   */
  public static hasPullRequests(token: RepositoryToken): boolean {
    return !token.codeHost || token.codeHost.hasPullRequests;
  }

  // The host's name for a pull request: GitLab's is a merge request.
  public static getPullRequestTerm(token: RepositoryToken): string {
    return CodeHost.getFacts(token.codeHost?.type || CodeRepositoryType.GitHub)
      .pullRequestTerm;
  }

  public async open(
    options: OpenPullRequestOptions,
  ): Promise<PullRequestResult> {
    const codeHost: CodeHostRunnerInfo | undefined = options.token.codeHost;

    if (!codeHost || codeHost.type === CodeRepositoryType.GitHub) {
      return await new PullRequestCreator(
        this.logger || undefined,
      ).createPullRequest({
        token: options.token.token,
        organizationName: options.token.organizationName,
        repositoryName: options.token.repositoryName,
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        title: options.title,
        body: options.body,
      });
    }

    if (!codeHost.hasPullRequests || !codeHost.apiUrl) {
      throw new Error(
        `${CodeHost.getFacts(codeHost.type).name} repositories get a pushed branch, not a pull request.`,
      );
    }

    await this.log(
      `Opening a ${CodeHost.getFacts(codeHost.type).pullRequestTerm}: ${options.title} (${options.headBranch} -> ${options.baseBranch})`,
    );

    const client: CodeHostApiClient = new CodeHostApiClient({
      providerName: CodeHost.getFacts(codeHost.type).name,
      apiBaseUrl: codeHost.apiUrl,
      headers:
        codeHost.type === CodeRepositoryType.GitLab
          ? { "PRIVATE-TOKEN": options.token.token }
          : { Authorization: `token ${options.token.token}` },
      secrets: [options.token.token],
      transport: this.transport || GitHostGuard.getTransport(codeHost),
      scopeHint:
        codeHost.type === CodeRepositoryType.GitLab
          ? GITLAB_TOKEN_SCOPE_HINT
          : FORGEJO_TOKEN_SCOPE_HINT,
    });

    const body: string = PullRequestCreator.truncateBody(options.body);
    let answer: CodeHostApiAnswer;

    try {
      answer =
        codeHost.type === CodeRepositoryType.GitLab
          ? await client.postJson(
              `/projects/${encodeURIComponent(
                codeHost.projectId ||
                  `${options.token.organizationName}/${options.token.repositoryName}`,
              )}/merge_requests`,
              {
                source_branch: options.headBranch,
                target_branch: options.baseBranch,
                title: options.title,
                description: body,
                remove_source_branch: false,
              },
            )
          : await client.postJson(
              `/repos/${encodeURIComponent(
                options.token.organizationName,
              )}/${encodeURIComponent(options.token.repositoryName)}/pulls`,
              {
                head: options.headBranch,
                base: options.baseBranch,
                title: options.title,
                body,
              },
            );
    } catch (error) {
      const message: string =
        error instanceof CodeHostHttpError
          ? error.kind === CodeHostHttpErrorKind.Conflict
            ? `one is already open for ${options.headBranch}`
            : error.message
          : String(error);

      logger.error(`Could not open the pull request: ${message}`);

      throw new Error(
        `Failed to open the ${CodeHost.getFacts(codeHost.type).pullRequestTerm}: ${message}`,
      );
    }

    const result: PullRequestResult = PullRequestOpener.readResult({
      type: codeHost.type,
      json: answer.json,
      webUrl: codeHost.webUrl,
      title: options.title,
    });

    await this.log(`Opened: ${result.htmlUrl}`);

    return result;
  }

  /*
   * What the host answered, as a run records a pull request: GitLab's
   * merge request number is its iid (what its pages show), Forgejo's its
   * number.
   */
  public static readResult(data: {
    type: CodeRepositoryType;
    json: unknown;
    webUrl: string | null;
    title: string;
  }): PullRequestResult {
    const value: JSONObject =
      data.json && typeof data.json === "object" && !Array.isArray(data.json)
        ? (data.json as JSONObject)
        : {};

    const number: number = Number(
      data.type === CodeRepositoryType.GitLab ? value["iid"] : value["number"],
    );

    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(
        "The server opened something that is not a pull request: it said no number for it.",
      );
    }

    const htmlUrl: string =
      typeof value["web_url"] === "string"
        ? (value["web_url"] as string)
        : typeof value["html_url"] === "string"
          ? (value["html_url"] as string)
          : data.webUrl
            ? `${CodeHostUrl.trimTrailingSlashes(data.webUrl)}/${
                data.type === CodeRepositoryType.GitLab
                  ? "-/merge_requests"
                  : "pulls"
              }/${number}`
            : "";

    const id: number = Number(value["id"]);

    return {
      id: Number.isSafeInteger(id) ? id : number,
      number,
      url:
        typeof value["url"] === "string" ? (value["url"] as string) : htmlUrl,
      htmlUrl,
      state:
        typeof value["state"] === "string"
          ? (value["state"] as string)
          : "open",
      title:
        typeof value["title"] === "string"
          ? (value["title"] as string)
          : data.title,
    };
  }

  private async log(message: string): Promise<void> {
    if (this.logger) {
      await this.logger.info(message);
    } else {
      logger.debug(message);
    }
  }
}
