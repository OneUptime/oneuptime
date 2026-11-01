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
} from "./CodeHostTypes";
import CodeHostText from "./CodeHostText";

/*
 * A GITLAB SERVER - GitLab.com or a self-managed one - THROUGH ITS API (v4).
 *
 * Who the token is, the projects it can push to (Developer or more), a
 * project's branches and files, a merge request's state and the pipeline
 * on its head - and, for a production review, a merge request, its diff,
 * the project's visibility, its members' roles, its recently changed merge
 * requests and the note the review keeps on one. A run's merge request is
 * opened by the Runner, which holds the token for the run
 * (Runner/Utils/PullRequestOpener); chat's code writes make a branch, a
 * commit and a merge request here (CodeHostWriter), and a deploy's list of
 * commits is read here too (CodeHostCommits).
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
      const repository: CodeHostRepository | null = this.readRepository(entry);

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
   * Whether `containing` already holds `commit` - the deploy a fix shipped
   * in: GitLab's compare from `containing` to `commit` lists the commits
   * `commit` has since their merge base, and none means `containing`
   * descends from it (or is it). A commit the project does not have is a
   * NotFound error.
   */
  public async containsCommit(data: {
    project: string;
    commit: string;
    containing: string;
  }): Promise<boolean> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/repository/compare`,
      { from: data.containing, to: data.commit },
    );

    const compare: JSONObject = GitLabApi.asObject(
      answer.json,
      "how the two commits compare",
    );

    if (!Array.isArray(compare["commits"])) {
      throw GitLabApi.badAnswer("how the two commits compare");
    }

    return (compare["commits"] as JSONArray).length === 0;
  }

  /*
   * A merge request, as a production review reads it: its title, state,
   * whether it is a draft or from a fork, its head, where it goes, who
   * opened it and how many files it changes.
   */
  public async getMergeRequest(data: {
    project: string;
    iid: number;
  }): Promise<CodeHostPullRequestDetails> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/merge_requests/${Math.floor(data.iid)}`,
    );

    const details: CodeHostPullRequestDetails | null =
      GitLabApi.readMergeRequest(answer.json);

    if (!details) {
      throw GitLabApi.badAnswer("the merge request");
    }

    return details;
  }

  /*
   * The files a merge request changes, each with its diff: GitLab's
   * /diffs, a page at a time, as far as `maxFiles` - or, on a GitLab older
   * than 15.7 that has no /diffs, its /changes. A file whose diff GitLab
   * left out (too large, collapsed) has no patch.
   */
  public async listMergeRequestFiles(data: {
    project: string;
    iid: number;
    maxFiles: number;
  }): Promise<CodeHostChangedFiles> {
    const path: string = `${GitLabApi.projectPath(data.project)}/merge_requests/${Math.floor(data.iid)}`;
    const maxFiles: number = Math.max(0, Math.floor(data.maxFiles));
    const files: Array<CodeHostChangedFile> = [];

    for (let page: number = 1; files.length < maxFiles; page++) {
      let answer: CodeHostApiAnswer;

      try {
        answer = await this.client.getJson(`${path}/diffs`, {
          page,
          per_page: GITLAB_PAGE_SIZE,
        });
      } catch (error) {
        if (
          page === 1 &&
          error instanceof CodeHostHttpError &&
          error.kind === CodeHostHttpErrorKind.NotFound
        ) {
          return await this.listMergeRequestChanges({ path, maxFiles });
        }

        throw error;
      }

      const entries: JSONArray = Array.isArray(answer.json)
        ? (answer.json as JSONArray)
        : [];

      for (const entry of entries) {
        const file: CodeHostChangedFile | null = GitLabApi.readDiff(entry);

        if (file) {
          files.push(file);
        }
      }

      const nextPage: string = (answer.headers["x-next-page"] || "").trim();

      if (!nextPage || entries.length === 0) {
        return {
          files: files.slice(0, maxFiles),
          hasMore: files.length > maxFiles,
        };
      }
    }

    return { files: files.slice(0, maxFiles), hasMore: true };
  }

  // GitLab before 15.7: every file at once, under `changes`.
  private async listMergeRequestChanges(data: {
    path: string;
    maxFiles: number;
  }): Promise<CodeHostChangedFiles> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${data.path}/changes`,
    );

    const body: JSONObject = GitLabApi.asObject(
      answer.json,
      "the merge request's changes",
    );
    const entries: JSONArray = Array.isArray(body["changes"])
      ? (body["changes"] as JSONArray)
      : [];
    const files: Array<CodeHostChangedFile> = [];

    for (const entry of entries) {
      const file: CodeHostChangedFile | null = GitLabApi.readDiff(entry);

      if (file) {
        files.push(file);
      }
    }

    return {
      files: files.slice(0, data.maxFiles),
      hasMore: files.length > data.maxFiles || body["overflow"] === true,
    };
  }

  /*
   * Whether anyone on the internet can read the project: true for a public
   * one, false for a private or an internal one (internal: the signed-in
   * users of this GitLab only), null when GitLab could not say - which a
   * caller deciding what to post reads as public. Asked every time it
   * matters, never kept.
   */
  public async isProjectPublic(project: string): Promise<boolean | null> {
    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(GitLabApi.projectPath(project));
    } catch {
      return null;
    }

    const visibility: string = CodeHostText.readString(
      (answer.json as JSONObject | null)?.["visibility"],
    ).toLowerCase();

    if (visibility === "public") {
      return true;
    }

    if (visibility === "private" || visibility === "internal") {
      return false;
    }

    return null;
  }

  /*
   * The project's open merge requests that changed after a time, the
   * least recently changed first, as many as `limit` (a page): what the
   * production review poll reads every minute.
   */
  public async listUpdatedMergeRequests(data: {
    project: string;
    updatedAfter: Date;
    limit: number;
  }): Promise<Array<CodeHostPullRequestDetails>> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/merge_requests`,
      {
        state: "opened",
        updated_after: data.updatedAfter.toISOString(),
        order_by: "updated_at",
        sort: "asc",
        per_page: Math.max(
          1,
          Math.min(GITLAB_PAGE_SIZE, Math.floor(data.limit)),
        ),
        page: 1,
      },
    );

    const entries: JSONArray = Array.isArray(answer.json)
      ? (answer.json as JSONArray)
      : [];
    const mergeRequests: Array<CodeHostPullRequestDetails> = [];

    for (const entry of entries) {
      const details: CodeHostPullRequestDetails | null =
        GitLabApi.readMergeRequest(entry);

      if (details) {
        mergeRequests.push(details);
      }
    }

    return mergeRequests;
  }

  /*
   * A user's role in the project - their own or one a group gives them
   * (members/all) - as GitLab's access level: 30 is Developer, who pushes.
   * -1 when they are not a member.
   */
  public async getMemberAccessLevel(data: {
    project: string;
    userId: string;
  }): Promise<number> {
    const userId: number = Number(data.userId);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return -1;
    }

    let answer: CodeHostApiAnswer;

    try {
      answer = await this.client.getJson(
        `${GitLabApi.projectPath(data.project)}/members/all/${userId}`,
      );
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return -1;
      }

      throw error;
    }

    const member: JSONObject | null =
      answer.json && typeof answer.json === "object"
        ? (answer.json as JSONObject)
        : null;
    const level: number = Number(member?.["access_level"]);

    // A blocked or not yet accepted membership gives no role.
    if (
      CodeHostText.readString(member?.["state"]) &&
      CodeHostText.readString(member?.["state"]) !== "active"
    ) {
      return -1;
    }

    return Number.isFinite(level) ? level : -1;
  }

  // Whether a role may push to the project: Developer or more.
  public static canPush(accessLevel: number): boolean {
    return accessLevel >= DEVELOPER_ACCESS_LEVEL;
  }

  // A note (comment) on a merge request, written as the token's account.
  public async createMergeRequestNote(data: {
    project: string;
    iid: number;
    body: string;
    mergeRequestUrl: string;
  }): Promise<CodeHostComment> {
    const answer: CodeHostApiAnswer = await this.client.postJson(
      `${GitLabApi.projectPath(data.project)}/merge_requests/${Math.floor(data.iid)}/notes`,
      { body: data.body },
    );

    return GitLabApi.readNote(answer.json, data.mergeRequestUrl);
  }

  // A note OneUptime wrote, edited in place.
  public async updateMergeRequestNote(data: {
    project: string;
    iid: number;
    noteId: number;
    body: string;
    mergeRequestUrl: string;
  }): Promise<CodeHostComment> {
    const answer: CodeHostApiAnswer = await this.client.request({
      method: "PUT",
      path: `${GitLabApi.projectPath(data.project)}/merge_requests/${Math.floor(data.iid)}/notes/${Math.floor(data.noteId)}`,
      body: { body: data.body },
    });

    return GitLabApi.readNote(answer.json, data.mergeRequestUrl);
  }

  /*
   * A branch made from another, as chat's code writes start one: true when
   * it was made, false when a branch of that name is there already.
   */
  public async createBranch(data: {
    project: string;
    branchName: string;
    fromBranchName: string;
  }): Promise<boolean> {
    if (await this.getBranch(data.project, data.branchName)) {
      return false;
    }

    try {
      await this.client.postJson(
        `${GitLabApi.projectPath(data.project)}/repository/branches`,
        { branch: data.branchName, ref: data.fromBranchName },
      );
    } catch (error) {
      // GitLab answers 400 for a branch made since it was looked for.
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.Rejected &&
        (await this.getBranch(data.project, data.branchName))
      ) {
        return false;
      }

      throw error;
    }

    return true;
  }

  /*
   * One commit on a branch that writes each file whole: GitLab's commits
   * API, which takes several files at once. Each file is created, or
   * updated where it is there already - which GitLab needs said - and sent
   * in base64, so no text is changed on its way.
   */
  public async commitFiles(data: {
    project: string;
    branchName: string;
    commitMessage: string;
    files: Array<CodeHostFileWrite>;
  }): Promise<CodeHostCommitMade> {
    const actions: Array<JSONObject> = [];

    for (const file of data.files) {
      const isThere: boolean = await this.isFileThere({
        project: data.project,
        ref: data.branchName,
        filePath: file.filePath,
      });

      actions.push({
        action: isThere ? "update" : "create",
        file_path: file.filePath,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        encoding: "base64",
      });
    }

    const answer: CodeHostApiAnswer = await this.client.postJson(
      `${GitLabApi.projectPath(data.project)}/repository/commits`,
      {
        branch: data.branchName,
        commit_message: data.commitMessage,
        actions,
      },
    );

    const commit: JSONObject = GitLabApi.asObject(
      answer.json,
      "the commit it made",
    );
    const commitSha: string = CodeHostText.readString(commit["id"]);

    if (!CodeHostText.isCommitSha(commitSha)) {
      throw GitLabApi.badAnswer("the commit it made");
    }

    return {
      commitSha,
      htmlUrl: CodeHostText.readString(commit["web_url"]),
    };
  }

  /*
   * A merge request from one branch into another, ready for review. Its
   * branch is kept when it merges, as the Runner's merge requests keep
   * theirs.
   */
  public async createMergeRequest(data: {
    project: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
  }): Promise<CodeHostOpenedPullRequest> {
    const answer: CodeHostApiAnswer = await this.client.postJson(
      `${GitLabApi.projectPath(data.project)}/merge_requests`,
      {
        source_branch: data.sourceBranch,
        target_branch: data.targetBranch,
        title: data.title,
        description: data.description,
        remove_source_branch: false,
      },
    );

    const mergeRequest: JSONObject = GitLabApi.asObject(
      answer.json,
      "the merge request it opened",
    );
    const number: number = Number(mergeRequest["iid"]);
    const id: number = Number(mergeRequest["id"]);

    if (!Number.isSafeInteger(number) || number <= 0) {
      throw GitLabApi.badAnswer("the merge request it opened");
    }

    return {
      id: Number.isSafeInteger(id) && id > 0 ? id : number,
      number,
      htmlUrl: CodeHostText.readString(mergeRequest["web_url"]),
      state:
        CodeHostText.readString(mergeRequest["state"]) === "merged"
          ? PullRequestState.Merged
          : CodeHostText.readString(mergeRequest["state"]) === "closed"
            ? PullRequestState.Closed
            : PullRequestState.Open,
    };
  }

  /*
   * What a deploy shipped since the one before it: the commits from `base`
   * to `head` and the files they changed (GitLab's compare, from their
   * merge base). None from base to head is either the same commit or an
   * older one - a rollback - which the compare the other way tells apart.
   */
  public async compareCommits(data: {
    project: string;
    base: string;
    head: string;
  }): Promise<CodeHostCommitRange> {
    const forward: JSONObject = await this.readCompare({
      project: data.project,
      from: data.base,
      to: data.head,
    });
    const commits: Array<CodeHostCommitSummary> = GitLabApi.readCommits(
      forward["commits"],
    );

    if (commits.length === 0) {
      const backward: JSONObject = await this.readCompare({
        project: data.project,
        from: data.head,
        to: data.base,
      });
      const isBehind: boolean =
        GitLabApi.readCommits(backward["commits"]).length > 0;

      return {
        status: isBehind ? "behind" : "identical",
        totalCommits: 0,
        commits: [],
        files: [],
        isTruncated: false,
      };
    }

    const files: Array<CodeHostCommitFile> = GitLabApi.readDiffFiles(
      forward["diffs"],
    );

    return {
      status: "ahead",
      totalCommits: commits.length,
      commits: commits.slice(0, CODE_HOST_MAX_COMMITS),
      files: files.slice(0, CODE_HOST_MAX_FILES),
      isTruncated:
        commits.length > CODE_HOST_MAX_COMMITS ||
        files.length > CODE_HOST_MAX_FILES ||
        forward["compare_timeout"] === true,
    };
  }

  // One commit, and the files it changed with their lines counted.
  public async getCommit(data: { project: string; sha: string }): Promise<{
    commit: CodeHostCommitSummary;
    files: Array<CodeHostCommitFile>;
  }> {
    const path: string = `${GitLabApi.projectPath(data.project)}/repository/commits/${encodeURIComponent(data.sha)}`;
    const answer: CodeHostApiAnswer = await this.client.getJson(path);
    const commit: CodeHostCommitSummary | null = GitLabApi.readCommit(
      answer.json,
    );

    if (!commit) {
      throw GitLabApi.badAnswer("the commit");
    }

    const diff: CodeHostApiAnswer = await this.client.getJson(`${path}/diff`, {
      per_page: GITLAB_PAGE_SIZE,
      page: 1,
    });

    return {
      commit,
      files: GitLabApi.readDiffFiles(diff.json).slice(0, CODE_HOST_MAX_FILES),
    };
  }

  // The merge requests a commit is in, as GitLab lists them.
  public async listMergeRequestsOfCommit(data: {
    project: string;
    sha: string;
  }): Promise<Array<CodeHostPullRequestSummary>> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/repository/commits/${encodeURIComponent(data.sha)}/merge_requests`,
    );

    const entries: JSONArray = Array.isArray(answer.json)
      ? (answer.json as JSONArray)
      : [];
    const mergeRequests: Array<CodeHostPullRequestSummary> = [];

    for (const entry of entries) {
      const mergeRequest: JSONObject | null =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as JSONObject)
          : null;
      const number: number = Number(mergeRequest?.["iid"]);

      if (!mergeRequest || !Number.isSafeInteger(number) || number <= 0) {
        continue;
      }

      const login: string = CodeHostText.readString(
        ((mergeRequest["author"] as JSONObject | null) || {})["username"],
      );
      const mergedAt: string = CodeHostText.readString(
        mergeRequest["merged_at"],
      );

      mergeRequests.push({
        number,
        title: CodeHostText.readString(mergeRequest["title"]),
        ...(login ? { authorLogin: login } : {}),
        ...(mergedAt ? { mergedAt } : {}),
        url: CodeHostText.readString(mergeRequest["web_url"]),
      });
    }

    return mergeRequests;
  }

  // GitLab's compare of two commits, as it answers it.
  private async readCompare(data: {
    project: string;
    from: string;
    to: string;
  }): Promise<JSONObject> {
    const answer: CodeHostApiAnswer = await this.client.getJson(
      `${GitLabApi.projectPath(data.project)}/repository/compare`,
      { from: data.from, to: data.to },
    );

    return GitLabApi.asObject(answer.json, "how the two commits compare");
  }

  // Whether a file is at a path on a branch: a folder or nothing is not.
  private async isFileThere(data: {
    project: string;
    ref: string;
    filePath: string;
  }): Promise<boolean> {
    try {
      await this.client.getJson(
        `${GitLabApi.projectPath(data.project)}/repository/files/${encodeURIComponent(data.filePath)}`,
        { ref: data.ref },
      );

      return true;
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * Commits as GitLab's compare lists them - oldest first - newest first,
   * as a deploy's list says them.
   */
  public static readCommits(raw: unknown): Array<CodeHostCommitSummary> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const commits: Array<CodeHostCommitSummary> = [];

    for (const entry of raw as JSONArray) {
      const commit: CodeHostCommitSummary | null = GitLabApi.readCommit(entry);

      if (commit) {
        commits.push(commit);
      }
    }

    return commits.reverse();
  }

  // One commit as GitLab answers it, or null for one that is not.
  public static readCommit(raw: unknown): CodeHostCommitSummary | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const commit: JSONObject = raw as JSONObject;
    const sha: string = CodeHostText.readString(commit["id"]);

    if (!CodeHostText.isCommitSha(sha)) {
      return null;
    }

    const message: string =
      CodeHostText.readString(commit["message"]) ||
      CodeHostText.readString(commit["title"]);
    const date: string =
      CodeHostText.readString(commit["authored_date"]) ||
      CodeHostText.readString(commit["committed_date"]);

    return {
      sha,
      message: (message.split("\n")[0] || "").trim(),
      authorName: CodeHostText.readString(commit["author_name"]) || "unknown",
      ...(date ? { date } : {}),
      pullRequestNumbers: GitLabApi.readMergeRequestNumbers(message),
    };
  }

  // The files of a diff GitLab lists (a compare's, a commit's), counted.
  public static readDiffFiles(raw: unknown): Array<CodeHostCommitFile> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const files: Array<CodeHostCommitFile> = [];

    for (const entry of raw as JSONArray) {
      const file: CodeHostChangedFile | null = GitLabApi.readDiff(entry);

      if (file) {
        files.push({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        });
      }
    }

    return files;
  }

  /*
   * The merge requests a commit's message names, as GitLab writes a merge
   * commit's: "See merge request acme/checkout!482". Read line by line with
   * indexOf: the message is whoever committed's text.
   */
  public static readMergeRequestNumbers(message: string): Array<number> {
    const numbers: Array<number> = [];
    const marker: string = "merge request ";

    for (const line of (message || "").split("\n")) {
      const at: number = line.toLowerCase().indexOf(marker);

      if (at < 0) {
        continue;
      }

      // The reference: the text after the marker, up to the next space.
      const rest: string = line.substring(at + marker.length).trim();
      const space: number = rest.indexOf(" ");
      const reference: string = space >= 0 ? rest.substring(0, space) : rest;
      const bang: number = reference.lastIndexOf("!");

      if (bang < 0) {
        continue;
      }

      const digits: string = reference.substring(bang + 1);

      if (
        digits.length === 0 ||
        digits.length > 9 ||
        !Array.from(digits).every((character: string): boolean => {
          return character >= "0" && character <= "9";
        })
      ) {
        continue;
      }

      const number: number = Number(digits);

      if (number > 0 && !numbers.includes(number)) {
        numbers.push(number);
      }
    }

    return numbers;
  }

  // A merge request as the API answers it, or null for one that is not.
  public static readMergeRequest(
    raw: unknown,
  ): CodeHostPullRequestDetails | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const mergeRequest: JSONObject = raw as JSONObject;
    const iid: number = Number(mergeRequest["iid"]);

    if (!Number.isSafeInteger(iid) || iid <= 0) {
      return null;
    }

    const author: JSONObject = (mergeRequest["author"] as JSONObject) || {};
    const state: string = CodeHostText.readString(mergeRequest["state"]);
    const sourceProjectId: string = CodeHostText.readId(
      mergeRequest["source_project_id"],
    );
    const targetProjectId: string = CodeHostText.readId(
      mergeRequest["target_project_id"],
    );

    return {
      number: iid,
      title: CodeHostText.readString(mergeRequest["title"]),
      isOpen: state === "opened" || state === "locked",
      isMerged: state === "merged",
      isDraft:
        mergeRequest["draft"] === true ||
        mergeRequest["work_in_progress"] === true,
      htmlUrl: CodeHostText.readString(mergeRequest["web_url"]),
      authorLogin: CodeHostText.readString(author["username"]),
      authorId: CodeHostText.readId(author["id"]),
      headSha: CodeHostText.readString(mergeRequest["sha"]),
      headRefName: CodeHostText.readString(mergeRequest["source_branch"]),
      baseRefName: CodeHostText.readString(mergeRequest["target_branch"]),
      isFromFork:
        !sourceProjectId ||
        !targetProjectId ||
        sourceProjectId !== targetProjectId,
      changedFilesCount: GitLabApi.readChangesCount(
        mergeRequest["changes_count"],
      ),
      changedLineCount: 0,
      updatedAt: CodeHostText.readString(mergeRequest["updated_at"]),
    };
  }

  /*
   * GitLab's count of a merge request's files: a text ("12"), or "1000+"
   * past what it counts - read as that many. 0 when it says nothing.
   */
  public static readChangesCount(raw: unknown): number {
    const text: string =
      typeof raw === "number" ? raw.toString() : CodeHostText.readString(raw);
    const digits: string = text.endsWith("+")
      ? text.substring(0, text.length - 1)
      : text;
    const count: number = Number(digits);

    return Number.isSafeInteger(count) && count > 0 ? count : 0;
  }

  // One file of a merge request's diff, as /diffs and /changes list it.
  public static readDiff(raw: unknown): CodeHostChangedFile | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const entry: JSONObject = raw as JSONObject;
    const oldPath: string = CodeHostText.readString(entry["old_path"]);
    const newPath: string = CodeHostText.readString(entry["new_path"]);
    const isDeleted: boolean = entry["deleted_file"] === true;
    const isNew: boolean = entry["new_file"] === true;
    const isRenamed: boolean =
      entry["renamed_file"] === true && !isNew && !isDeleted;
    const filename: string = isDeleted
      ? oldPath || newPath
      : newPath || oldPath;

    if (!filename) {
      return null;
    }

    const diff: string = CodeHostText.readString(entry["diff"]);
    let additions: number = 0;
    let deletions: number = 0;

    for (const line of diff.split("\n")) {
      if (line.startsWith("+")) {
        additions++;
      } else if (line.startsWith("-")) {
        deletions++;
      }
    }

    const trimmed: string = diff.endsWith("\n")
      ? diff.substring(0, diff.length - 1)
      : diff;

    return {
      filename,
      previousFilename: isRenamed && oldPath !== newPath ? oldPath : null,
      status: isNew
        ? "added"
        : isDeleted
          ? "removed"
          : isRenamed
            ? "renamed"
            : "modified",
      additions,
      deletions,
      patch: trimmed && entry["too_large"] !== true ? trimmed : null,
    };
  }

  /*
   * A note as GitLab answers it, with its address: GitLab gives none, and
   * its page is the merge request's, at #note_<id>.
   */
  public static readNote(
    raw: unknown,
    mergeRequestUrl: string,
  ): CodeHostComment {
    const id: number = Number(
      raw && typeof raw === "object" ? (raw as JSONObject)["id"] : undefined,
    );

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw GitLabApi.badAnswer("the note it wrote");
    }

    return {
      commentId: id,
      htmlUrl: mergeRequestUrl
        ? `${CodeHostUrl.trimTrailingSlashes(mergeRequestUrl)}#note_${id}`
        : "",
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
      isPrivate: CodeHostText.readString(project["visibility"]) !== "public",
      /*
       * A Developer or more pushes to an unprotected branch. The project's
       * own permissions say which role the token has; a project they say
       * nothing of (the role comes from elsewhere) is taken as one it may
       * push to, and a push it may not make fails on the Runner, saying so.
       */
      canPush:
        project["archived"] !== true &&
        (GitLabApi.readAccessLevel(project["permissions"]) < 0 ||
          GitLabApi.readAccessLevel(project["permissions"]) >=
            DEVELOPER_ACCESS_LEVEL),
    };
  }

  /*
   * The token's role in a project, from its permissions: the higher of its
   * own and its group's - or -1 when they name neither.
   */
  public static readAccessLevel(raw: unknown): number {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return -1;
    }

    const permissions: JSONObject = raw as JSONObject;
    let level: number = -1;

    for (const key of ["project_access", "group_access"]) {
      const access: unknown = permissions[key];

      if (access && typeof access === "object" && !Array.isArray(access)) {
        const value: number = Number((access as JSONObject)["access_level"]);

        if (Number.isFinite(value) && value > level) {
          level = value;
        }
      }
    }

    return level;
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
