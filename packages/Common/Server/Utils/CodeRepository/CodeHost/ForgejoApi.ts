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
  CodeHostAccount,
  CodeHostBranch,
  CodeHostBranchNames,
  CodeHostCiSummary,
  CodeHostFileContent,
  CodeHostPullRequestState,
  CodeHostRepository,
  CodeHostRepositoryPage,
  CodeHostServerInfo,
} from "./CodeHostTypes";
import CodeHostText from "./CodeHostText";

/*
 * A FORGEJO OR GITEA SERVER, THROUGH ITS API (v1) - Codeberg among them.
 *
 * Forgejo is a fork of Gitea and keeps its API, so one client reads both:
 * who the token is, the repositories it can push to, a repository's
 * branches and files, and a pull request's state and the CI on its head.
 * Pull requests are opened by the Runner, which holds the token for the run
 * (Runner/Utils/PullRequests/ForgejoPullRequests).
 *
 * The token goes in the Authorization header ("token <token>"), never in an
 * address. What the token needs: write access to repositories
 * (write:repository) and read access to the user (read:user).
 */

export const FORGEJO_TOKEN_SCOPE_HINT: string =
  "The token needs read and write access to repositories (write:repository) and read access to the user (read:user).";

// Forgejo's and Gitea's largest page (API.MaxResponseItems).
export const FORGEJO_PAGE_SIZE: number = 50;

// A repository's tree is read a page of this many entries at a time.
const TREE_PAGE_SIZE: number = 1000;

// At most this many pages of a tree: 100,000 paths.
const MAX_TREE_PAGES: number = 100;

// At most this many pages of branches are searched by a prefix.
const MAX_BRANCH_PAGES: number = 6;

// What a commit status's state counts as.
const PENDING_STATES: Array<string> = ["pending"];
const FAILED_STATES: Array<string> = ["error", "failure"];

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
      const repository: CodeHostRepository | null =
        this.readRepository(entry);

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

        if (item && item["type"] === "blob" && typeof item["path"] === "string") {
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
