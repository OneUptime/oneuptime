import { JSONArray, JSONObject } from "../../../../Types/JSON";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import {
  FixPullRequestCiCheckRunCounts,
  FixPullRequestCiStatusHelper,
} from "../../../../Types/AI/FixPullRequestCiStatus";
import {
  CODE_HOST_API_PATHS,
  CodeHostUrl,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import CodeHostApiClient, { CodeHostApiAnswer } from "./CodeHostApiClient";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostTransport,
} from "./CodeHostHttp";
import {
  CodeHostAccount,
  CodeHostBranch,
  CodeHostBranchNames,
  CodeHostCiSummary,
  CodeHostFileContent,
  CodeHostPullRequestState,
  CodeHostRepository,
  CodeHostRepositoryPage,
} from "./CodeHostTypes";
import CodeHostText from "./CodeHostText";

/*
 * A GITLAB SERVER - GitLab.com or a self-managed one - THROUGH ITS API (v4).
 *
 * Who the token is, the projects it can push to (Developer or more), a
 * project's branches and files, and a merge request's state and the
 * pipeline on its head. Merge requests are opened by the Runner, which
 * holds the token for the run (Runner/Utils/PullRequests/GitLabMergeRequests).
 *
 * A project is read by its id, which stays the same when it is renamed or
 * moved to another group; its path ("group/subgroup/project") is the
 * fallback. The token goes in the PRIVATE-TOKEN header, never in an
 * address. What it needs: the api and write_repository scopes - a personal,
 * group or project access token, with at least the Developer role.
 */

export const GITLAB_TOKEN_SCOPE_HINT: string =
  "The token needs the api and write_repository scopes, and at least the Developer role in the project.";

// GitLab's largest page.
export const GITLAB_PAGE_SIZE: number = 100;

// The least role a token's account needs to push a branch: Developer.
const DEVELOPER_ACCESS_LEVEL: number = 30;

// At most this many pages of a tree: 10,000 paths.
const MAX_TREE_PAGES: number = 100;

// A pipeline in one of these has not finished.
const PENDING_PIPELINE_STATUSES: Array<string> = [
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "scheduled",
  "manual",
];

// A pipeline that ended in one of these did not pass.
const FAILED_PIPELINE_STATUSES: Array<string> = ["failed", "canceled"];

export default class GitLabApi {
  private client: CodeHostApiClient;
  private hostUrl: string;

  public constructor(data: {
    hostUrl: string;
    token: string;
    transport: CodeHostTransport;
    backOff?: ((retry: number) => Promise<void>) | undefined;
  }) {
    this.hostUrl = data.hostUrl;
    this.client = new CodeHostApiClient({
      providerName: "GitLab",
      apiBaseUrl: `${data.hostUrl}${CODE_HOST_API_PATHS[CodeRepositoryType.GitLab]}`,
      headers: { "PRIVATE-TOKEN": data.token },
      secrets: [data.token],
      transport: data.transport,
      scopeHint: GITLAB_TOKEN_SCOPE_HINT,
      backOff: data.backOff,
    });
  }

  public getClient(): CodeHostApiClient {
    return this.client;
  }

  // Who the token acts as - and that GitLab takes it at all.
  public async getAccount(): Promise<CodeHostAccount & { id: string }> {
    const answer: CodeHostApiAnswer = await this.client.getJson("/user");
    const user: JSONObject = GitLabApi.asObject(answer.json, "/user");
    const login: string = CodeHostText.readString(user["username"]);

    if (!login) {
      throw GitLabApi.badAnswer("who the access token is");
    }

    return {
      id: CodeHostText.readId(user["id"]),
      login,
      name: CodeHostText.readString(user["name"]) || login,
    };
  }

  /*
   * The projects the token's account can push to (Developer or more), most
   * recently active first - or those whose names or groups hold `search`.
   */
  public async listRepositories(data: {
    search?: string | undefined;
    page: number;
  }): Promise<CodeHostRepositoryPage> {
    const page: number = Math.max(1, Math.floor(data.page));
    const answer: CodeHostApiAnswer = await this.client.getJson("/projects", {
      membership: true,
      min_access_level: DEVELOPER_ACCESS_LEVEL,
      archived: false,
      order_by: "last_activity_at",
      sort: "desc",
      per_page: GITLAB_PAGE_SIZE,
      page,
      ...(data.search ? { search: data.search, search_namespaces: true } : {}),
    });

    const entries: JSONArray = Array.isArray(answer.json)
      ? (answer.json as JSONArray)
      : [];

    const repositories: Array<CodeHostRepository> = [];

    for (const entry of entries) {
      const repository: CodeHostRepository | null =
        this.readRepository(entry);

      if (repository) {
        repositories.push(repository);
      }
    }

    const nextPage: string = (answer.headers["x-next-page"] || "").trim();

    return {
      repositories,
      hasMore: nextPage
        ? Number(nextPage) > page
        : entries.length === GITLAB_PAGE_SIZE &&
          !("x-next-page" in answer.headers),
    };
  }

  // A project, by its id or its path ("group/subgroup/project").
  public async getRepository(project: string): Promise<CodeHostRepository> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      GitLabApi.projectPath(project),
    );

    const repository: CodeHostRepository | null = this.readRepository(
      answer.json,
    );

    if (!repository) {
      throw GitLabApi.badAnswer("the project");
    }

    return repository;
  }

  public async getDefaultBranchName(project: string): Promise<string> {
    return (await this.getRepository(project)).defaultBranch;
  }

  /*
   * A project's branch names: the first page GitLab lists, or the branches
   * whose names start with what a person typed (GitLab's "^term" search).
   */
  public async listBranchNames(data: {
    project: string;
    search?: string | undefined;
    limit: number;
  }): Promise<CodeHostBranchNames> {
    const search: string = (data.search || "").trim();
    const limit: number = Math.max(1, Math.min(100, Math.floor(data.limit)));

    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/repository/branches`,
      {
        per_page: limit,
        page: 1,
        ...(search ? { search: `^${search}` } : {}),
      },
    );

    const entries: JSONArray = Array.isArray(answer.json)
      ? (answer.json as JSONArray)
      : [];
    const names: Array<string> = [];

    for (const entry of entries) {
      const name: string = CodeHostText.readString(
        (entry as JSONObject | null)?.["name"],
      );

      // GitLab's search matches inside names too, on older versions.
      if (
        name &&
        (!search || name.startsWith(search)) &&
        !names.includes(name)
      ) {
        names.push(name);
      }
    }

    const nextPage: string = (answer.headers["x-next-page"] || "").trim();

    return {
      names,
      isComplete: !nextPage && entries.length < limit,
    };
  }

  // One branch's head and protection, or null when it is not there.
  public async getBranch(
    project: string,
    branchName: string,
  ): Promise<CodeHostBranch | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${GitLabApi.projectPath(project)}/repository/branches/${encodeURIComponent(branchName)}`,
      );
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return null;
      }

      throw error;
    }

    const branch: JSONObject = GitLabApi.asObject(answer.json, "the branch");
    const commit: JSONObject = (branch["commit"] as JSONObject) || {};

    return {
      name: CodeHostText.readString(branch["name"]) || branchName,
      headSha: CodeHostText.readString(commit["id"]),
      isProtected: branch["protected"] === true,
    };
  }

  /*
   * Every file path in a project's tree at a branch, read a page at a time
   * (keyset pagination: each page names the next). Cut at MAX_TREE_PAGES.
   */
  public async getTreePaths(data: {
    project: string;
    ref: string;
  }): Promise<Array<string>> {
    const paths: Array<string> = [];
    let pageToken: string | null = null;

    for (let page: number = 1; page <= MAX_TREE_PAGES; page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${GitLabApi.projectPath(data.project)}/repository/tree`,
        {
          ref: data.ref,
          recursive: true,
          per_page: GITLAB_PAGE_SIZE,
          pagination: "keyset",
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      );

      const entries: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of entries) {
        const item: JSONObject | null = entry as JSONObject | null;

        if (
          item &&
          item["type"] === "blob" &&
          typeof item["path"] === "string"
        ) {
          paths.push(item["path"] as string);
        }
      }

      pageToken = GitLabApi.readNextPageToken(answer.headers["link"] || "");

      if (!pageToken || entries.length === 0) {
        break;
      }
    }

    return paths;
  }

  /*
   * One file's text at a branch, or null when there is no such file or it
   * is binary.
   */
  public async getFileContent(data: {
    project: string;
    webUrl: string;
    ref: string;
    filePath: string;
  }): Promise<CodeHostFileContent | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${GitLabApi.projectPath(data.project)}/repository/files/${encodeURIComponent(data.filePath)}`,
        { ref: data.ref },
      );
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return null;
      }

      throw error;
    }

    const file: JSONObject = GitLabApi.asObject(answer.json, "the file");
    const encoded: string = CodeHostText.readString(file["content"]);
    const encoding: string = CodeHostText.readString(file["encoding"]);

    if (encoding && encoding !== "base64") {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.BadResponse,
        message: `${data.filePath} came back in an encoding OneUptime does not read ("${encoding}").`,
      });
    }

    const content: string | null = CodeHostText.decodeBase64Text(encoded);

    if (content === null) {
      return null;
    }

    return {
      content,
      filePath: data.filePath,
      sizeInBytes: Number(file["size"]) || 0,
      totalLines: CodeHostText.countLines(content),
      htmlUrl: `${CodeHostUrl.trimTrailingSlashes(data.webUrl)}/-/blob/${CodeHostUrl.encodePath(data.ref)}/${CodeHostUrl.encodePath(data.filePath)}`,
    };
  }

  /*
   * A merge request's state, with the commit it landed as once merged: its
   * merge commit, its squash commit, or - for a fast-forward merge, which
   * makes neither - its head.
   */
  public async getMergeRequestState(data: {
    project: string;
    iid: number;
  }): Promise<CodeHostPullRequestState & { ci: CodeHostCiSummary }> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/merge_requests/${Math.floor(data.iid)}`,
    );

    const mergeRequest: JSONObject = GitLabApi.asObject(
      answer.json,
      "the merge request",
    );

    const ci: CodeHostCiSummary = GitLabApi.summarizePipeline(
      mergeRequest["head_pipeline"],
    );
    const state: string = CodeHostText.readString(mergeRequest["state"]);

    if (state === "merged") {
      const mergedAt: string = CodeHostText.readString(
        mergeRequest["merged_at"],
      );
      const candidates: Array<string> = [
        CodeHostText.readString(mergeRequest["merge_commit_sha"]),
        CodeHostText.readString(mergeRequest["squash_commit_sha"]),
        CodeHostText.readString(mergeRequest["sha"]),
      ];
      const mergeCommitSha: string | undefined = candidates.find(
        (sha: string): boolean => {
          return CodeHostText.isCommitSha(sha);
        },
      );

      return {
        state: PullRequestState.Merged,
        ...(mergeCommitSha ? { mergeCommitSha } : {}),
        ...(mergedAt && !isNaN(Date.parse(mergedAt))
          ? { mergedAt: new Date(mergedAt) }
          : {}),
        ci,
      };
    }

    return {
      state:
        state === "opened" || state === "locked"
          ? PullRequestState.Open
          : PullRequestState.Closed,
      ci,
    };
  }

  /*
   * A merge request's head pipeline, rolled up the way GitHub's check runs
   * are: none (or one that was skipped) -> NoCiConfigured, still going ->
   * Pending, failed or canceled -> Red, passed -> Green.
   */
  public static summarizePipeline(raw: unknown): CodeHostCiSummary {
    const status: string =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? CodeHostText.readString((raw as JSONObject)["status"]).toLowerCase()
        : "";

    const counts: FixPullRequestCiCheckRunCounts =
      !status || status === "skipped"
        ? { total: 0, completed: 0, failed: 0, pending: 0 }
        : PENDING_PIPELINE_STATUSES.includes(status)
          ? { total: 1, completed: 0, failed: 0, pending: 1 }
          : {
              total: 1,
              completed: 1,
              failed: FAILED_PIPELINE_STATUSES.includes(status) ? 1 : 0,
              pending: 0,
            };

    return {
      ...counts,
      conclusion: FixPullRequestCiStatusHelper.rollUpConclusion(counts),
    };
  }

  // A project as the API lists it, or null for an entry that is not one.
  public readRepository(raw: unknown): CodeHostRepository | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const project: JSONObject = raw as JSONObject;
    const namespace: JSONObject = (project["namespace"] as JSONObject) || {};
    const pathWithNamespace: string = CodeHostText.readString(
      project["path_with_namespace"],
    );
    const lastSlash: number = pathWithNamespace.lastIndexOf("/");
    const name: string =
      CodeHostText.readString(project["path"]) ||
      (lastSlash >= 0
        ? pathWithNamespace.substring(lastSlash + 1)
        : pathWithNamespace);
    const ownerPath: string =
      CodeHostText.readString(namespace["full_path"]) ||
      (lastSlash > 0 ? pathWithNamespace.substring(0, lastSlash) : "");

    if (!name || !ownerPath) {
      return null;
    }

    const webUrl: string =
      CodeHostText.readString(project["web_url"]) ||
      `${this.hostUrl}/${CodeHostUrl.encodePath(`${ownerPath}/${name}`)}`;

    return {
      id: CodeHostText.readId(project["id"]),
      name,
      ownerPath,
      fullName: pathWithNamespace || `${ownerPath}/${name}`,
      description: CodeHostText.readString(project["description"]) || null,
      defaultBranch:
        CodeHostText.readString(project["default_branch"]) || "main",
      webUrl,
      cloneUrl:
        CodeHostText.readString(project["http_url_to_repo"]) || `${webUrl}.git`,
      isPrivate:
        CodeHostText.readString(project["visibility"]) !== "public",
      // Listed for a Developer or more: they push to an unprotected branch.
      canPush: project["archived"] !== true,
    };
  }

  // A project's API path, by id or by its URL-encoded path.
  public static projectPath(project: string): string {
    return `/projects/${encodeURIComponent(project)}`;
  }

  /*
   * The page_token of the Link header's next page, or null on the last
   * page. Read with indexOf: the header is the server's text.
   */
  public static readNextPageToken(linkHeader: string): string | null {
    for (const part of linkHeader.split(",")) {
      if (!part.includes('rel="next"')) {
        continue;
      }

      const start: number = part.indexOf("<");
      const end: number = part.indexOf(">", start + 1);

      if (start < 0 || end < 0) {
        return null;
      }

      try {
        return (
          new URL(part.substring(start + 1, end)).searchParams.get(
            "page_token",
          ) || null
        );
      } catch {
        return null;
      }
    }

    return null;
  }

  private static asObject(raw: unknown, what: string): JSONObject {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw GitLabApi.badAnswer(what);
    }

    return raw as JSONObject;
  }

  private static badAnswer(what: string): CodeHostHttpError {
    return new CodeHostHttpError({
      kind: CodeHostHttpErrorKind.BadResponse,
      message: `The server did not say ${what} as GitLab's API does. Check the server's address.`,
    });
  }
}
