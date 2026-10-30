import { JSONArray, JSONObject } from "../../../../Types/JSON";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import {
  FixPullRequestCiCheckRunCounts,
  FixPullRequestCiStatusHelper,
} from "../../../../Types/AI/FixPullRequestCiStatus";
import {
  CODE_HOST_API_PATHS,
  CodeHost,
  CodeHostUrl,
  ForgejoServerProduct,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import CodeHostApiClient, { CodeHostApiAnswer } from "./CodeHostApiClient";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostTransport,
} from "./CodeHostHttp";
import {
  CODE_HOST_MAX_COMMITS,
  CODE_HOST_MAX_FILES,
  CodeHostAccount,
  CodeHostBranch,
  CodeHostBranchNames,
  CodeHostChangedFile,
  CodeHostChangedFiles,
  CodeHostCiSummary,
  CodeHostComment,
  CodeHostCommitFile,
  CodeHostCommitMade,
  CodeHostCommitRange,
  CodeHostCommitSummary,
  CodeHostFileContent,
  CodeHostFileWrite,
  CodeHostOpenedPullRequest,
  CodeHostPullRequestDetails,
  CodeHostPullRequestState,
  CodeHostPullRequestSummary,
  CodeHostRepository,
  CodeHostRepositoryPage,
  CodeHostServerInfo,
} from "./CodeHostTypes";
import CodeHostText from "./CodeHostText";
import UnifiedDiff from "./UnifiedDiff";

/*
 * A FORGEJO OR GITEA SERVER, THROUGH ITS API (v1) - Codeberg among them.
 *
 * Forgejo is a fork of Gitea and keeps its API, so one client reads both:
 * who the token is, the repositories it can push to, a repository's
 * branches and files, a pull request's state and the CI on its head - and,
 * for a production review, a pull request, its diff, the repository's
 * visibility, a user's permission, its recently changed pull requests and
 * the comment the review keeps on one.
 * A run's pull request is opened by the Runner, which holds the token for
 * the run (Runner/Utils/PullRequestOpener); chat's code writes make a
 * branch, a commit and a pull request here (CodeHostWriter), and a deploy's
 * list of commits is read here too (CodeHostCommits).
 *
 * The token goes in the Authorization header ("token <token>"), never in an
 * address. What the token needs: write access to repositories
 * (write:repository) and read access to the user (read:user) - and, for
 * the comment a production review keeps on a pull request, write access to
 * issues (write:issue): a pull request's comments are its issue's.
 */

export const FORGEJO_TOKEN_SCOPE_HINT: string =
  "The token needs read and write access to repositories (write:repository) and issues (write:issue), and read access to the user (read:user).";

// Forgejo's and Gitea's largest page (API.MaxResponseItems).
export const FORGEJO_PAGE_SIZE: number = 50;

// A repository's tree is read a page of this many entries at a time.
const TREE_PAGE_SIZE: number = 1000;

// At most this many pages of a tree: 100,000 paths.
const MAX_TREE_PAGES: number = 100;

// At most this many pages of branches are searched by a prefix.
const MAX_BRANCH_PAGES: number = 6;

/*
 * At most this many pages of a commit's history are read to find a fix in
 * it, where the server cannot compare commits: 500 commits.
 */
const MAX_HISTORY_PAGES: number = 10;

// What a commit status's state counts as.
const PENDING_STATES: Array<string> = ["pending"];
const FAILED_STATES: Array<string> = ["error", "failure"];

/*
 * A pull request's diff is read whole only up to this many changed lines;
 * past it, its file list alone - a production review reads 300 files at
 * most, and a diff that large is mostly lines it would not read.
 */
export const MAX_DIFF_LINES_READ: number = 100000;

/*
 * The title prefixes that mark a pull request as a work in progress on a
 * server older than the `draft` field (Gitea's and Forgejo's defaults).
 */
const WORK_IN_PROGRESS_PREFIXES: ReadonlyArray<string> = ["WIP:", "[WIP]"];

export default class ForgejoApi {
  private client: CodeHostApiClient;
  private hostUrl: string;

  public constructor(data: {
    hostUrl: string;
    token: string;
    transport: CodeHostTransport;
    // The name messages use: "Forgejo", "Gitea" or "Codeberg".
    providerName?: string | undefined;
    backOff?: ((retry: number) => Promise<void>) | undefined;
  }) {
    this.hostUrl = data.hostUrl;
    this.client = new CodeHostApiClient({
      providerName: data.providerName || "Forgejo",
      apiBaseUrl: `${data.hostUrl}${CODE_HOST_API_PATHS[CodeRepositoryType.Forgejo]}`,
      headers: { Authorization: `token ${data.token}` },
      secrets: [data.token],
      transport: data.transport,
      scopeHint: FORGEJO_TOKEN_SCOPE_HINT,
      backOff: data.backOff,
    });
  }

  public getClient(): CodeHostApiClient {
    return this.client;
  }

  // Who the token acts as - and that the server takes it at all.
  public async getAccount(): Promise<CodeHostAccount & { id: string }> {
    const answer: CodeHostApiAnswer = await this.client.getJson("/user");
    const user: JSONObject = ForgejoApi.asObject(answer.json, "/user");

    const login: string = CodeHostText.readString(user["login"]);

    if (!login) {
      throw ForgejoApi.badAnswer("who the access token is");
    }

    return {
      id: CodeHostText.readId(user["id"]),
      login,
      name: CodeHostText.readString(user["full_name"]) || login,
    };
  }

  // What the server says it is: Forgejo writes "+gitea-" into its version.
  public async getServerInfo(): Promise<CodeHostServerInfo> {
    try {
      const answer: CodeHostApiAnswer = await this.client.getJson("/version");
      const version: string = CodeHostText.readString(
        (answer.json as JSONObject | null)?.["version"],
      );

      return {
        product: version
          ? CodeHost.readForgejoServerProduct(version)
          : ForgejoServerProduct.Forgejo,
        version: version || null,
      };
    } catch {
      return { product: null, version: null };
    }
  }

  /*
   * The repositories the token's account owns or works in (its own, its
   * organizations' and those it collaborates on), most recently updated
   * first - or those whose names hold `search`.
   */
  public async listRepositories(data: {
    accountId: string;
    search?: string | undefined;
    page: number;
  }): Promise<CodeHostRepositoryPage> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      "/repos/search",
      {
        uid: data.accountId,
        q: data.search || undefined,
        limit: FORGEJO_PAGE_SIZE,
        page: Math.max(1, Math.floor(data.page)),
        sort: "updated",
        order: "desc",
      },
    );

    const body: JSONObject = ForgejoApi.asObject(answer.json, "/repos/search");
    const entries: JSONArray = Array.isArray(body["data"])
      ? (body["data"] as JSONArray)
      : [];

    const repositories: Array<CodeHostRepository> = [];

    for (const entry of entries) {
      const repository: CodeHostRepository | null = this.readRepository(entry);

      if (repository) {
        repositories.push(repository);
      }
    }

    const total: number = Number(answer.headers["x-total-count"]);

    return {
      repositories,
      hasMore: Number.isFinite(total)
        ? Math.max(1, Math.floor(data.page)) * FORGEJO_PAGE_SIZE < total
        : entries.length === FORGEJO_PAGE_SIZE,
    };
  }

  public async getRepository(
    owner: string,
    name: string,
  ): Promise<CodeHostRepository> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      ForgejoApi.repositoryPath(owner, name),
    );

    const repository: CodeHostRepository | null = this.readRepository(
      answer.json,
    );

    if (!repository) {
      throw ForgejoApi.badAnswer("the repository");
    }

    return repository;
  }

  // A repository by the server's own id for it.
  public async getRepositoryById(id: string): Promise<CodeHostRepository> {
    const numericId: number = Number(id);

    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.NotFound,
        message: "That is not a repository of this server.",
      });
    }

    const answer: CodeHostApiAnswer = await this.client.getJson(
      `/repositories/${numericId}`,
    );

    const repository: CodeHostRepository | null = this.readRepository(
      answer.json,
    );

    if (!repository) {
      throw ForgejoApi.badAnswer("the repository");
    }

    return repository;
  }

  public async getDefaultBranchName(
    owner: string,
    name: string,
  ): Promise<string> {
    return (await this.getRepository(owner, name)).defaultBranch;
  }

  /*
   * A repository's branch names: the first page the server lists, or -
   * given what a person typed - the branches whose names start with it,
   * searched over the first few pages. `isComplete` says every match is in.
   */
  public async listBranchNames(data: {
    owner: string;
    name: string;
    search?: string | undefined;
    limit: number;
  }): Promise<CodeHostBranchNames> {
    const search: string = (data.search || "").trim();
    const limit: number = Math.max(1, Math.min(100, Math.floor(data.limit)));
    const names: Array<string> = [];
    let isComplete: boolean = true;

    for (let page: number = 1; page <= MAX_BRANCH_PAGES; page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/branches`,
        { page, limit: FORGEJO_PAGE_SIZE },
      );

      const entries: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of entries) {
        const branchName: string = CodeHostText.readString(
          (entry as JSONObject | null)?.["name"],
        );

        if (
          branchName &&
          (!search || branchName.startsWith(search)) &&
          !names.includes(branchName)
        ) {
          names.push(branchName);
        }
      }

      const isLastPage: boolean = entries.length < FORGEJO_PAGE_SIZE;

      if (names.length > limit) {
        isComplete = false;
        break;
      }

      if (isLastPage) {
        break;
      }

      if (!search && names.length >= limit) {
        isComplete = false;
        break;
      }

      if (page === MAX_BRANCH_PAGES) {
        isComplete = false;
      }
    }

    return { names: names.slice(0, limit), isComplete };
  }

  // One branch's head and protection, or null when it is not there.
  public async getBranch(
    owner: string,
    name: string,
    branchName: string,
  ): Promise<CodeHostBranch | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(owner, name)}/branches/${CodeHostUrl.encodePath(branchName)}`,
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

    const branch: JSONObject = ForgejoApi.asObject(answer.json, "the branch");
    const commit: JSONObject = (branch["commit"] as JSONObject) || {};

    return {
      name: CodeHostText.readString(branch["name"]) || branchName,
      headSha: CodeHostText.readString(commit["id"]),
      isProtected: branch["protected"] === true,
    };
  }

  /*
   * Every file path in a repository's tree at a branch, read a page at a
   * time. A tree past MAX_TREE_PAGES pages is cut there.
   */
  public async getTreePaths(data: {
    owner: string;
    name: string;
    ref: string;
  }): Promise<Array<string>> {
    const paths: Array<string> = [];

    for (let page: number = 1; page <= MAX_TREE_PAGES; page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/git/trees/${encodeURIComponent(data.ref)}`,
        { recursive: true, page, per_page: TREE_PAGE_SIZE },
      );

      const body: JSONObject = ForgejoApi.asObject(answer.json, "the tree");
      const tree: JSONArray = Array.isArray(body["tree"])
        ? (body["tree"] as JSONArray)
        : [];

      for (const entry of tree) {
        const item: JSONObject | null = entry as JSONObject | null;

        if (
          item &&
          item["type"] === "blob" &&
          typeof item["path"] === "string"
        ) {
          paths.push(item["path"] as string);
        }
      }

      if (body["truncated"] !== true || tree.length === 0) {
        break;
      }
    }

    return paths;
  }

  /*
   * One file's text at a branch, or null when there is no such file, it is
   * a folder, or it is binary.
   */
  public async getFileContent(data: {
    owner: string;
    name: string;
    ref: string;
    filePath: string;
  }): Promise<CodeHostFileContent | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/contents/${CodeHostUrl.encodePath(data.filePath)}`,
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

    // A folder is a list of its entries.
    if (Array.isArray(answer.json)) {
      return null;
    }

    const file: JSONObject = ForgejoApi.asObject(answer.json, "the file");

    if (file["type"] !== "file") {
      return null;
    }

    const sizeInBytes: number = Number(file["size"]) || 0;
    const encoded: unknown = file["content"];

    if (typeof encoded !== "string") {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.BadResponse,
        message: `${data.filePath} is ${sizeInBytes} bytes, which is more than the server returns at once.`,
      });
    }

    const content: string | null = CodeHostText.decodeBase64Text(encoded);

    if (content === null) {
      return null;
    }

    return {
      content,
      filePath: data.filePath,
      sizeInBytes,
      totalLines: CodeHostText.countLines(content),
      htmlUrl: CodeHostText.readString(file["html_url"]),
    };
  }

  // A pull request's state, with its merge commit once merged.
  public async getPullRequestState(data: {
    owner: string;
    name: string;
    number: number;
  }): Promise<CodeHostPullRequestState> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/pulls/${Math.floor(data.number)}`,
    );

    const pullRequest: JSONObject = ForgejoApi.asObject(
      answer.json,
      "the pull request",
    );

    if (pullRequest["merged"] === true) {
      const mergedAt: string = CodeHostText.readString(
        pullRequest["merged_at"],
      );
      const mergeCommitSha: string = CodeHostText.readString(
        pullRequest["merge_commit_sha"],
      );

      return {
        state: PullRequestState.Merged,
        ...(CodeHostText.isCommitSha(mergeCommitSha)
          ? { mergeCommitSha: mergeCommitSha }
          : {}),
        ...(mergedAt && !isNaN(Date.parse(mergedAt))
          ? { mergedAt: new Date(mergedAt) }
          : {}),
      };
    }

    return {
      state:
        pullRequest["state"] === "open"
          ? PullRequestState.Open
          : PullRequestState.Closed,
    };
  }

  /*
   * Whether `containing` already holds `commit` - the deploy a fix shipped
   * in: the compare of the two lists the commits `commit` has since their
   * merge base, and none means `containing` descends from it (or is it).
   * A commit the repository does not have is a NotFound error.
   */
  public async containsCommit(data: {
    owner: string;
    name: string;
    commit: string;
    containing: string;
  }): Promise<boolean> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/compare/${CodeHostUrl.encodePath(data.containing)}...${CodeHostUrl.encodePath(data.commit)}`,
      );
    } catch (error) {
      /*
       * Gitea before 1.23 compares branches and tags only, and answers a
       * commit with BaseNotExist: walk the containing commit's history
       * instead, as far as a deploy's fix sits in it.
       */
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return await this.historyContains(data);
      }

      throw error;
    }

    const compare: JSONObject = ForgejoApi.asObject(
      answer.json,
      "how the two commits compare",
    );

    if (typeof compare["total_commits"] === "number") {
      return compare["total_commits"] === 0;
    }

    if (Array.isArray(compare["commits"])) {
      return (compare["commits"] as JSONArray).length === 0;
    }

    throw ForgejoApi.badAnswer("how the two commits compare");
  }

  /*
   * Whether `commit` is in the history of `containing`, read a page at a
   * time, newest first, as far as MAX_HISTORY_PAGES pages: a deploy ships
   * a fix merged days before it, near the top. Past them, not contained -
   * a deploy that old is no deploy of the fix. A `containing` commit the
   * repository does not have is a NotFound error.
   */
  private async historyContains(data: {
    owner: string;
    name: string;
    commit: string;
    containing: string;
  }): Promise<boolean> {
    const wanted: string = data.commit.trim().toLowerCase();

    for (let page: number = 1; page <= MAX_HISTORY_PAGES; page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/commits`,
        {
          sha: data.containing,
          page,
          limit: FORGEJO_PAGE_SIZE,
          stat: false,
          verification: false,
          files: false,
        },
      );

      const commits: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of commits) {
        const sha: string = CodeHostText.readString(
          (entry as JSONObject | null)?.["sha"],
        ).toLowerCase();

        if (sha && wanted && (sha === wanted || sha.startsWith(wanted))) {
          return true;
        }
      }

      if (commits.length < FORGEJO_PAGE_SIZE) {
        return false;
      }
    }

    return false;
  }

  /*
   * The CI on a ref, from its commit statuses (what Forgejo Actions, and
   * Woodpecker or Drone, report): none -> NoCiConfigured, any pending ->
   * Pending, any error or failure -> Red, else Green.
   */
  public async getCiSummary(data: {
    owner: string;
    name: string;
    ref: string;
  }): Promise<CodeHostCiSummary> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/commits/${CodeHostUrl.encodePath(data.ref)}/status`,
    );

    const combined: JSONObject = ForgejoApi.asObject(
      answer.json,
      "the commit's status",
    );
    const statuses: JSONArray = Array.isArray(combined["statuses"])
      ? (combined["statuses"] as JSONArray)
      : [];

    return ForgejoApi.summarizeStatuses(statuses);
  }

  public static summarizeStatuses(statuses: JSONArray): CodeHostCiSummary {
    let pending: number = 0;
    let failed: number = 0;

    for (const status of statuses) {
      const state: string = CodeHostText.readString(
        (status as JSONObject | null)?.["status"] ??
          (status as JSONObject | null)?.["state"],
      ).toLowerCase();

      if (PENDING_STATES.includes(state)) {
        pending++;
      } else if (FAILED_STATES.includes(state)) {
        failed++;
      }
    }

    const counts: FixPullRequestCiCheckRunCounts = {
      total: statuses.length,
      completed: statuses.length - pending,
      failed,
      pending,
    };

    return {
      ...counts,
      conclusion: FixPullRequestCiStatusHelper.rollUpConclusion(counts),
    };
  }

  /*
   * A pull request, as a production review reads it: its title, state,
   * whether it is a draft or from a fork, its head, where it goes, who
   * opened it and how much it changes.
   */
  public async getPullRequest(data: {
    owner: string;
    name: string;
    number: number;
  }): Promise<CodeHostPullRequestDetails> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/pulls/${Math.floor(data.number)}`,
    );

    const details: CodeHostPullRequestDetails | null =
      ForgejoApi.readPullRequest(answer.json);

    if (!details) {
      throw ForgejoApi.badAnswer("the pull request");
    }

    return details;
  }

  /*
   * The files a pull request changes, each with its diff, as far as
   * `maxFiles`: the server gives the diff as one text (/pulls/{index}.diff),
   * split here file by file (UnifiedDiff). A diff too large to read - more
   * lines than MAX_DIFF_LINES_READ, or more than the server's answers may
   * hold - is read as its file list alone (/pulls/{index}/files): which
   * files, and none of their lines.
   */
  public async listPullRequestFiles(data: {
    owner: string;
    name: string;
    number: number;
    maxFiles: number;
    // Lines it adds and removes, when known: past MAX_DIFF_LINES_READ, no diff.
    changedLineCount?: number | undefined;
  }): Promise<CodeHostChangedFiles> {
    const path: string = `${ForgejoApi.repositoryPath(data.owner, data.name)}/pulls/${Math.floor(data.number)}`;

    if ((data.changedLineCount || 0) <= MAX_DIFF_LINES_READ) {
      try {
        const answer: CodeHostApiAnswer = await this.client.getText(
          `${path}.diff`,
        );

        return UnifiedDiff.splitFiles(answer.text, data.maxFiles);
      } catch (error) {
        if (error instanceof CodeHostHttpError && error.isCredentialRefusal()) {
          throw error;
        }

        // The file list says which files changed, without their lines.
      }
    }

    return await this.listPullRequestFileNames({
      path,
      maxFiles: data.maxFiles,
    });
  }

  // A pull request's files, by name and status alone: a page at a time.
  private async listPullRequestFileNames(data: {
    path: string;
    maxFiles: number;
  }): Promise<CodeHostChangedFiles> {
    const maxFiles: number = Math.max(0, Math.floor(data.maxFiles));
    const files: Array<CodeHostChangedFile> = [];

    for (let page: number = 1; files.length < maxFiles; page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${data.path}/files`,
        { page, limit: FORGEJO_PAGE_SIZE },
      );

      const entries: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of entries) {
        const file: JSONObject | null =
          entry && typeof entry === "object" ? (entry as JSONObject) : null;
        const filename: string = CodeHostText.readString(file?.["filename"]);

        if (!file || !filename) {
          continue;
        }

        const status: string = CodeHostText.readString(file["status"]);
        const previous: string = CodeHostText.readString(
          file["previous_filename"],
        );

        files.push({
          filename,
          previousFilename: previous && previous !== filename ? previous : null,
          status:
            status === "deleted"
              ? "removed"
              : status === "added" || status === "renamed"
                ? status
                : "modified",
          additions: Number(file["additions"]) || 0,
          deletions: Number(file["deletions"]) || 0,
          patch: null,
        });
      }

      if (entries.length < FORGEJO_PAGE_SIZE) {
        return {
          files: files.slice(0, maxFiles),
          hasMore: files.length > maxFiles,
        };
      }
    }

    return { files: files.slice(0, maxFiles), hasMore: true };
  }

  /*
   * Whether anyone on the internet can read the repository: true for one
   * that is not private, not internal and whose owner is public; false
   * otherwise; null when the server could not say - which a caller
   * deciding what to post reads as public. Asked every time it matters.
   */
  public async isRepositoryPublic(
    owner: string,
    name: string,
  ): Promise<boolean | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        ForgejoApi.repositoryPath(owner, name),
      );
    } catch {
      return null;
    }

    const repository: JSONObject | null =
      answer.json && typeof answer.json === "object"
        ? (answer.json as JSONObject)
        : null;

    if (!repository || typeof repository["private"] !== "boolean") {
      return null;
    }

    if (repository["private"] === true || repository["internal"] === true) {
      return false;
    }

    const ownerVisibility: string = CodeHostText.readString(
      ((repository["owner"] as JSONObject | null) || {})["visibility"],
    ).toLowerCase();

    // An organization only its members, or signed-in users, see.
    if (ownerVisibility === "private" || ownerVisibility === "limited") {
      return false;
    }

    return true;
  }

  /*
   * The repository's open pull requests that changed after a time, the
   * most recently changed first, as far as `maxPages` pages: what the
   * production review poll reads every minute. The server lists them by
   * when they changed but takes no time to start from, so the read stops at
   * the first that changed before it.
   */
  public async listUpdatedPullRequests(data: {
    owner: string;
    name: string;
    updatedAfter: Date;
    maxPages: number;
  }): Promise<Array<CodeHostPullRequestDetails>> {
    const after: number = data.updatedAfter.getTime();
    const pullRequests: Array<CodeHostPullRequestDetails> = [];

    for (let page: number = 1; page <= Math.max(1, data.maxPages); page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/pulls`,
        {
          state: "open",
          sort: "recentupdate",
          page,
          limit: FORGEJO_PAGE_SIZE,
        },
      );

      const entries: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of entries) {
        const details: CodeHostPullRequestDetails | null =
          ForgejoApi.readPullRequest(entry);

        if (!details) {
          continue;
        }

        const updatedAt: number = Date.parse(details.updatedAt);

        if (Number.isFinite(updatedAt) && updatedAt <= after) {
          return pullRequests;
        }

        pullRequests.push(details);
      }

      if (entries.length < FORGEJO_PAGE_SIZE) {
        break;
      }
    }

    return pullRequests;
  }

  /*
   * What a user may do in the repository: "owner", "admin", "write",
   * "read" or "none" - the collaborator permission API's answer, owners
   * and organization teams included; "none" for a user the server does
   * not know, or when it says nothing. Null when the server will not say:
   * Forgejo and Gitea tell another user's permission only to the
   * repository's administrators (and the server's), so a token whose
   * account only writes to the repository is refused (403).
   */
  public async getUserPermission(data: {
    owner: string;
    name: string;
    login: string;
  }): Promise<string | null> {
    if (!data.login) {
      return "none";
    }

    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/collaborators/${encodeURIComponent(data.login)}/permission`,
      );
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return "none";
      }

      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.Forbidden
      ) {
        return null;
      }

      throw error;
    }

    return (
      CodeHostText.readString(
        (answer.json as JSONObject | null)?.["permission"],
      ).toLowerCase() || "none"
    );
  }

  // Whether a permission may push to the repository: write, admin or owner.
  public static canPush(permission: string): boolean {
    return ["write", "admin", "owner"].includes(
      (permission || "").toLowerCase(),
    );
  }

  // A comment on a pull request (its issue), written as the token's account.
  public async createIssueComment(data: {
    owner: string;
    name: string;
    number: number;
    body: string;
  }): Promise<CodeHostComment> {
    const answer: CodeHostApiAnswer = await this.client.postJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/issues/${Math.floor(data.number)}/comments`,
      { body: data.body },
    );

    return ForgejoApi.readComment(answer.json);
  }

  // A comment OneUptime wrote, edited in place.
  public async updateIssueComment(data: {
    owner: string;
    name: string;
    commentId: number;
    body: string;
  }): Promise<CodeHostComment> {
    const answer: CodeHostApiAnswer = await this.client.request({
      method: "PATCH",
      path: `${ForgejoApi.repositoryPath(data.owner, data.name)}/issues/comments/${Math.floor(data.commentId)}`,
      body: { body: data.body },
    });

    return ForgejoApi.readComment(answer.json);
  }

  /*
   * A branch made from another, as chat's code writes start one: true when
   * it was made, false when a branch of that name is there already (409).
   * The branch it is made from is sent under both of the API's names for
   * it: old_ref_name, and the old_branch_name a server older than it reads.
   */
  public async createBranch(data: {
    owner: string;
    name: string;
    branchName: string;
    fromBranchName: string;
  }): Promise<boolean> {
    try {
      await this.client.postJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/branches`,
        {
          new_branch_name: data.branchName,
          old_ref_name: data.fromBranchName,
          old_branch_name: data.fromBranchName,
        },
      );
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.Conflict
      ) {
        return false;
      }

      throw error;
    }

    return true;
  }

  /*
   * One commit on a branch that writes each file whole: the contents API's
   * several files at once (Forgejo and Gitea 1.20 and later). Each file is
   * created, or updated where it is there already - with the SHA of the
   * file it replaces, as the API asks - and sent in base64.
   */
  public async commitFiles(data: {
    owner: string;
    name: string;
    branchName: string;
    commitMessage: string;
    files: Array<CodeHostFileWrite>;
  }): Promise<CodeHostCommitMade> {
    const operations: Array<JSONObject> = [];

    for (const file of data.files) {
      const sha: string | null = await this.getFileSha({
        owner: data.owner,
        name: data.name,
        ref: data.branchName,
        filePath: file.filePath,
      });

      operations.push({
        operation: sha ? "update" : "create",
        path: file.filePath,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      });
    }

    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.postJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/contents`,
        {
          branch: data.branchName,
          message: data.commitMessage,
          files: operations,
        },
      );
    } catch (error) {
      /*
       * The branch was just read, so a server that does not know the
       * route is one older than 1.20, which writes one file at a time.
       */
      if (
        error instanceof CodeHostHttpError &&
        (error.kind === CodeHostHttpErrorKind.NotFound ||
          error.statusCode === 405)
      ) {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.Rejected,
          statusCode: error.statusCode,
          message: `${this.client.getProviderName()} did not take the commit. Writing several files in one commit needs Forgejo or Gitea 1.20 or later.`,
        });
      }

      throw error;
    }

    const body: JSONObject = ForgejoApi.asObject(
      answer.json,
      "the commit it made",
    );
    const commit: JSONObject = ForgejoApi.asObject(
      body["commit"],
      "the commit it made",
    );
    const commitSha: string = CodeHostText.readString(commit["sha"]);

    if (!CodeHostText.isCommitSha(commitSha)) {
      throw ForgejoApi.badAnswer("the commit it made");
    }

    return {
      commitSha,
      htmlUrl: CodeHostText.readString(commit["html_url"]),
    };
  }

  // A pull request from one branch into another, ready for review.
  public async createPullRequest(data: {
    owner: string;
    name: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<CodeHostOpenedPullRequest> {
    const answer: CodeHostApiAnswer = await this.client.postJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/pulls`,
      {
        head: data.headBranch,
        base: data.baseBranch,
        title: data.title,
        body: data.body,
      },
    );

    const pullRequest: JSONObject = ForgejoApi.asObject(
      answer.json,
      "the pull request it opened",
    );
    const number: number = Number(pullRequest["number"]);
    const id: number = Number(pullRequest["id"]);

    if (!Number.isSafeInteger(number) || number <= 0) {
      throw ForgejoApi.badAnswer("the pull request it opened");
    }

    return {
      id: Number.isSafeInteger(id) && id > 0 ? id : number,
      number,
      htmlUrl: CodeHostText.readString(pullRequest["html_url"]),
      state:
        pullRequest["merged"] === true
          ? PullRequestState.Merged
          : CodeHostText.readString(pullRequest["state"]) === "closed"
            ? PullRequestState.Closed
            : PullRequestState.Open,
    };
  }

  /*
   * What a deploy shipped since the one before it: the commits from `base`
   * to `head`, newest first, and the files they changed - which and how,
   * not how many lines (the server does not count them per file). The
   * compare API reads commits on Forgejo and on Gitea 1.23 and later; on an
   * older Gitea, which compares branches only, `head`'s history is read
   * back to `base`. None from base to head is the same commit, or an older
   * one - a rollback - which the compare the other way tells apart.
   */
  public async compareCommits(data: {
    owner: string;
    name: string;
    base: string;
    head: string;
  }): Promise<CodeHostCommitRange> {
    let compare: JSONObject;

    try {
      compare = await this.readCompare({
        owner: data.owner,
        name: data.name,
        from: data.base,
        to: data.head,
      });
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return await this.readRangeFromHistory(data);
      }

      throw error;
    }

    const entries: JSONArray = Array.isArray(compare["commits"])
      ? (compare["commits"] as JSONArray)
      : [];
    const total: number = Number(compare["total_commits"]);
    const totalCommits: number = Number.isSafeInteger(total)
      ? total
      : entries.length;

    if (totalCommits === 0 && entries.length === 0) {
      const backward: JSONObject = await this.readCompare({
        owner: data.owner,
        name: data.name,
        from: data.head,
        to: data.base,
      });
      const backwardTotal: number = Number(backward["total_commits"]);
      const isBehind: boolean = Number.isSafeInteger(backwardTotal)
        ? backwardTotal > 0
        : Array.isArray(backward["commits"]) &&
          (backward["commits"] as JSONArray).length > 0;

      return {
        status: isBehind ? "behind" : "identical",
        totalCommits: 0,
        commits: [],
        files: [],
        isTruncated: false,
      };
    }

    return ForgejoApi.toRange({
      status: "ahead",
      entries,
      totalCommits: Math.max(totalCommits, entries.length),
      isTruncated: false,
    });
  }

  /*
   * One commit, and the files it changed - which and how. The server
   * counts lines for the whole commit only, so a file's are not said.
   */
  public async getCommit(data: {
    owner: string;
    name: string;
    sha: string;
  }): Promise<{
    commit: CodeHostCommitSummary;
    files: Array<CodeHostCommitFile>;
  }> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/git/commits/${encodeURIComponent(data.sha)}`,
      { stat: false, verification: false, files: true },
    );

    const commit: CodeHostCommitSummary | null = ForgejoApi.readCommit(
      answer.json,
    );

    if (!commit) {
      throw ForgejoApi.badAnswer("the commit");
    }

    return {
      commit,
      files: ForgejoApi.combineCommitFiles([answer.json]).slice(
        0,
        CODE_HOST_MAX_FILES,
      ),
    };
  }

  /*
   * The pull request a commit was merged with: the server knows it for a
   * pull request's merge commit (and its squash commit), and for no other.
   * None when it says nothing - a server older than the API answers 404
   * too.
   */
  public async getPullRequestOfCommit(data: {
    owner: string;
    name: string;
    sha: string;
  }): Promise<Array<CodeHostPullRequestSummary>> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/commits/${encodeURIComponent(data.sha)}/pull`,
      );
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return [];
      }

      throw error;
    }

    const pullRequest: JSONObject | null =
      answer.json &&
      typeof answer.json === "object" &&
      !Array.isArray(answer.json)
        ? (answer.json as JSONObject)
        : null;
    const number: number = Number(pullRequest?.["number"]);

    if (!pullRequest || !Number.isSafeInteger(number) || number <= 0) {
      return [];
    }

    const login: string = CodeHostText.readString(
      ((pullRequest["user"] as JSONObject | null) || {})["login"],
    );
    const mergedAt: string = CodeHostText.readString(pullRequest["merged_at"]);

    return [
      {
        number,
        title: CodeHostText.readString(pullRequest["title"]),
        ...(login ? { authorLogin: login } : {}),
        ...(mergedAt ? { mergedAt } : {}),
        url: CodeHostText.readString(pullRequest["html_url"]),
      },
    ];
  }

  /*
   * The SHA of the file at a path on a branch - what an update of it names -
   * or null when there is none. A folder there cannot be written as a file.
   */
  public async getFileSha(data: {
    owner: string;
    name: string;
    ref: string;
    filePath: string;
  }): Promise<string | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/contents/${CodeHostUrl.encodePath(data.filePath)}`,
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

    const entry: JSONObject | null =
      answer.json &&
      typeof answer.json === "object" &&
      !Array.isArray(answer.json)
        ? (answer.json as JSONObject)
        : null;

    if (!entry || entry["type"] !== "file") {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Rejected,
        message: `${data.filePath} is a folder in the repository, not a file.`,
      });
    }

    const sha: string = CodeHostText.readString(entry["sha"]);

    if (!sha) {
      throw ForgejoApi.badAnswer("the file");
    }

    return sha;
  }

  // The compare of two commits, as the server answers it.
  private async readCompare(data: {
    owner: string;
    name: string;
    from: string;
    to: string;
  }): Promise<JSONObject> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${ForgejoApi.repositoryPath(data.owner, data.name)}/compare/${CodeHostUrl.encodePath(data.from)}...${CodeHostUrl.encodePath(data.to)}`,
    );

    return ForgejoApi.asObject(answer.json, "how the two commits compare");
  }

  /*
   * The commits from `base` to `head` on a server that cannot compare
   * commits: `head`'s history, newest first, a page at a time, until
   * `base` - as far as MAX_HISTORY_PAGES pages. A history that ends
   * without it is a rollback when `head` is in `base`'s history, and
   * otherwise one that took another way (diverged); one longer than the
   * pages read is said to have more than was listed.
   */
  private async readRangeFromHistory(data: {
    owner: string;
    name: string;
    base: string;
    head: string;
  }): Promise<CodeHostCommitRange> {
    const wanted: string = data.base.trim().toLowerCase();
    const entries: JSONArray = [];

    for (let page: number = 1; page <= MAX_HISTORY_PAGES; page++) {
      const answer: CodeHostApiAnswer = await this.client.getJson(
        `${ForgejoApi.repositoryPath(data.owner, data.name)}/commits`,
        {
          sha: data.head,
          page,
          limit: FORGEJO_PAGE_SIZE,
          stat: false,
          verification: false,
          files: true,
        },
      );

      const pageEntries: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of pageEntries) {
        const sha: string = CodeHostText.readString(
          (entry as JSONObject | null)?.["sha"],
        ).toLowerCase();

        if (sha && wanted && (sha === wanted || sha.startsWith(wanted))) {
          return entries.length === 0
            ? {
                status: "identical",
                totalCommits: 0,
                commits: [],
                files: [],
                isTruncated: false,
              }
            : ForgejoApi.toRange({
                status: "ahead",
                entries,
                totalCommits: entries.length,
                isTruncated: false,
              });
        }

        entries.push(entry);
      }

      if (pageEntries.length < FORGEJO_PAGE_SIZE) {
        // The whole history, and no `base` in it.
        const isBehind: boolean = await this.historyContains({
          owner: data.owner,
          name: data.name,
          commit: data.head,
          containing: data.base,
        });

        return isBehind
          ? {
              status: "behind",
              totalCommits: 0,
              commits: [],
              files: [],
              isTruncated: false,
            }
          : ForgejoApi.toRange({
              status: "diverged",
              entries,
              totalCommits: entries.length,
              isTruncated: false,
            });
      }
    }

    // More commits than were read: those read, and that there are more.
    return ForgejoApi.toRange({
      status: "ahead",
      entries,
      totalCommits: entries.length,
      isTruncated: true,
    });
  }

  // Commits as the server lists them (newest first), as a deploy's range.
  private static toRange(data: {
    status: string;
    entries: JSONArray;
    totalCommits: number;
    isTruncated: boolean;
  }): CodeHostCommitRange {
    const commits: Array<CodeHostCommitSummary> = [];

    for (const entry of data.entries) {
      const commit: CodeHostCommitSummary | null = ForgejoApi.readCommit(entry);

      if (commit) {
        commits.push(commit);
      }
    }

    const files: Array<CodeHostCommitFile> = ForgejoApi.combineCommitFiles(
      data.entries,
    );

    return {
      status: data.status,
      totalCommits: Math.max(data.totalCommits, commits.length),
      commits: commits.slice(0, CODE_HOST_MAX_COMMITS),
      files: files.slice(0, CODE_HOST_MAX_FILES),
      isTruncated:
        data.isTruncated ||
        commits.length > CODE_HOST_MAX_COMMITS ||
        data.totalCommits > commits.length ||
        files.length > CODE_HOST_MAX_FILES,
    };
  }

  // One commit as the server answers it, or null for one that is not.
  public static readCommit(raw: unknown): CodeHostCommitSummary | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const entry: JSONObject = raw as JSONObject;
    const sha: string = CodeHostText.readString(entry["sha"]);

    if (!CodeHostText.isCommitSha(sha)) {
      return null;
    }

    const commit: JSONObject = (entry["commit"] as JSONObject | null) || {};
    const author: JSONObject = (commit["author"] as JSONObject | null) || {};
    const message: string = CodeHostText.readString(commit["message"]);
    const login: string = CodeHostText.readString(
      ((entry["author"] as JSONObject | null) || {})["login"],
    );
    const date: string = CodeHostText.readString(author["date"]);

    return {
      sha,
      message: (message.split("\n")[0] || "").trim(),
      authorName: CodeHostText.readString(author["name"]) || login || "unknown",
      ...(login ? { authorLogin: login } : {}),
      ...(date ? { date } : {}),
      // "Title (#12)", and "Merge pull request 'Title' (#12) from ...".
      pullRequestNumbers: CodeHostText.readParenthesizedNumbers(message),
    };
  }

  /*
   * The files of commits as the server lists them - newest first, each
   * with the files it changed - as the change they make together: a file
   * added and then changed was added, one added and then removed is left
   * out, and one removed and then added again was changed.
   */
  public static combineCommitFiles(
    entries: Array<unknown>,
  ): Array<CodeHostCommitFile> {
    const statuses: Map<string, string> = new Map();

    for (let index: number = entries.length - 1; index >= 0; index--) {
      const entry: unknown = entries[index];
      const files: unknown =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as JSONObject)["files"]
          : undefined;

      if (!Array.isArray(files)) {
        continue;
      }

      for (const file of files as JSONArray) {
        const path: string = CodeHostText.readString(
          (file as JSONObject | null)?.["filename"],
        );

        if (!path) {
          continue;
        }

        const status: string = ForgejoApi.readFileStatus(
          CodeHostText.readString((file as JSONObject)["status"]),
        );
        const before: string | undefined = statuses.get(path);

        if (before === undefined) {
          statuses.set(path, status);
        } else if (before === "added") {
          if (status === "removed") {
            statuses.delete(path);
          }
        } else if (before === "renamed" && status === "modified") {
          // Renamed, then changed: still the rename it was.
        } else {
          statuses.set(path, status === "added" ? "modified" : status);
        }
      }
    }

    return Array.from(statuses.entries()).map(
      ([path, status]: [string, string]): CodeHostCommitFile => {
        return { path, status };
      },
    );
  }

  // A file's status in the words GitHub's lists use.
  private static readFileStatus(status: string): string {
    switch (status.toLowerCase()) {
      case "added":
        return "added";
      case "removed":
      case "deleted":
        return "removed";
      case "renamed":
        return "renamed";
      default:
        return "modified";
    }
  }

  // A pull request as the API answers it, or null for one that is not.
  public static readPullRequest(
    raw: unknown,
  ): CodeHostPullRequestDetails | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const pullRequest: JSONObject = raw as JSONObject;
    const number: number = Number(pullRequest["number"]);

    if (!Number.isSafeInteger(number) || number <= 0) {
      return null;
    }

    const user: JSONObject = (pullRequest["user"] as JSONObject) || {};
    const head: JSONObject = (pullRequest["head"] as JSONObject) || {};
    const base: JSONObject = (pullRequest["base"] as JSONObject) || {};
    const headRepository: JSONObject | null =
      (head["repo"] as JSONObject | null) || null;
    const baseRepository: JSONObject | null =
      (base["repo"] as JSONObject | null) || null;
    const headRepositoryId: string = CodeHostText.readId(
      headRepository?.["id"],
    );
    const baseRepositoryId: string = CodeHostText.readId(
      baseRepository?.["id"],
    );
    const title: string = CodeHostText.readString(pullRequest["title"]);
    const isMerged: boolean = pullRequest["merged"] === true;
    const headRefName: string = CodeHostText.readString(head["ref"]);

    return {
      number,
      title,
      isOpen: pullRequest["state"] === "open" && !isMerged,
      isMerged,
      isDraft:
        pullRequest["draft"] === true || ForgejoApi.isWorkInProgress(title),
      htmlUrl: CodeHostText.readString(pullRequest["html_url"]),
      authorLogin: CodeHostText.readString(user["login"]),
      authorId: CodeHostText.readId(user["id"]),
      headSha: CodeHostText.readString(head["sha"]),
      headRefName,
      baseRefName: CodeHostText.readString(base["ref"]),
      isFromFork:
        !headRepositoryId ||
        !baseRepositoryId ||
        headRepositoryId !== baseRepositoryId ||
        !ForgejoApi.isBranchHead(headRefName),
      changedFilesCount: Math.max(0, Number(pullRequest["changed_files"]) || 0),
      changedLineCount:
        Math.max(0, Number(pullRequest["additions"]) || 0) +
        Math.max(0, Number(pullRequest["deletions"]) || 0),
      updatedAt: CodeHostText.readString(pullRequest["updated_at"]),
    };
  }

  /*
   * Whether a pull request's head is a branch of a repository. One opened
   * with AGit (git push origin HEAD:refs/for/main) has none: its head is
   * the server's own ref ("refs/pull/12/head") in the base repository,
   * which anyone who may read the repository can push - so, like a fork's,
   * its code need not come from someone who can write.
   */
  public static isBranchHead(headRefName: string): boolean {
    return Boolean(headRefName) && !headRefName.startsWith("refs/");
  }

  /*
   * A title the server's own work-in-progress prefixes mark as a draft
   * ("WIP:", "[WIP]"), as a server older than its `draft` field marks one.
   */
  public static isWorkInProgress(title: string): boolean {
    const start: string = (title || "").trimStart().toUpperCase();

    return WORK_IN_PROGRESS_PREFIXES.some((prefix: string): boolean => {
      return start.startsWith(prefix);
    });
  }

  // A comment as the server answers it, with its address.
  public static readComment(raw: unknown): CodeHostComment {
    const comment: JSONObject | null =
      raw && typeof raw === "object" ? (raw as JSONObject) : null;
    const id: number = Number(comment?.["id"]);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw ForgejoApi.badAnswer("the comment it wrote");
    }

    return {
      commentId: id,
      htmlUrl: CodeHostText.readString(comment?.["html_url"]),
    };
  }

  // A repository as the API lists it, or null for an entry that is not one.
  public readRepository(raw: unknown): CodeHostRepository | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const repository: JSONObject = raw as JSONObject;
    const owner: JSONObject = (repository["owner"] as JSONObject) || {};
    const name: string = CodeHostText.readString(repository["name"]);
    const ownerPath: string = CodeHostText.readString(owner["login"]);

    if (!name || !ownerPath) {
      return null;
    }

    const permissions: JSONObject =
      (repository["permissions"] as JSONObject) || {};

    return {
      id: CodeHostText.readId(repository["id"]),
      name,
      ownerPath,
      fullName:
        CodeHostText.readString(repository["full_name"]) ||
        `${ownerPath}/${name}`,
      description: CodeHostText.readString(repository["description"]) || null,
      defaultBranch:
        CodeHostText.readString(repository["default_branch"]) || "main",
      webUrl:
        CodeHostText.readString(repository["html_url"]) ||
        `${this.hostUrl}/${CodeHostUrl.encodePath(`${ownerPath}/${name}`)}`,
      cloneUrl:
        CodeHostText.readString(repository["clone_url"]) ||
        `${this.hostUrl}/${CodeHostUrl.encodePath(`${ownerPath}/${name}`)}.git`,
      isPrivate: repository["private"] === true,
      canPush:
        permissions["push"] === true &&
        repository["archived"] !== true &&
        repository["mirror"] !== true,
    };
  }

  public static repositoryPath(owner: string, name: string): string {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }

  private static asObject(raw: unknown, what: string): JSONObject {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw ForgejoApi.badAnswer(what);
    }

    return raw as JSONObject;
  }

  private static badAnswer(what: string): CodeHostHttpError {
    return new CodeHostHttpError({
      kind: CodeHostHttpErrorKind.BadResponse,
      message: `The server did not say ${what} as Forgejo's and Gitea's API do. Check the server's address.`,
    });
  }
}
