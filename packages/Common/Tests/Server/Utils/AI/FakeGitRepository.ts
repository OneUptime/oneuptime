import { jest } from "@jest/globals";
import crypto from "crypto";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import GitHubUtil, {
  GitHubBranchInfo,
  GitHubFileBlob,
  GitHubFileContent,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryModel from "../../../../Models/DatabaseModels/CodeRepository";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import API, { APIRequestOptions } from "../../../../Utils/API";
import { FakeAnswer, FakeRoute } from "../CodeRepository/CodeHost/FakeCodeHost";
import {
  ConnectedRepository,
  connectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";

/*
 * A REPOSITORY ON A CODE HOST, IN MEMORY (issues #6313, #6331): branches of
 * files, each file's blob as git hashes it, the commits chat makes and the
 * pull requests it opens - and teammates who push while Ask AI works.
 *
 * Served to the code tools the whole real way as far as it goes:
 *
 *   GitHub          through GitHubUtil - its reads answered here, and a
 *                   commit made by the real commitFilesToBranch through the
 *                   Git Data API (refs, commits, trees, blobs) answered
 *                   here, the branch moved only as a fast-forward;
 *   GitLab, Forgejo through the connection's API, faked at the transport
 *                   (ConnectedRepository), each route answering from here
 *                   as the host does: GitLab refuses an update whose
 *                   last_commit_id is not the file's last commit, Forgejo
 *                   and Gitea one whose sha is not its blob, and both a
 *                   create of a file that is there or an update of one
 *                   that is not.
 *
 * And a push can land at any point: before a read of a file's version, just
 * after one (afterVersionRead), as a commit begins to be made
 * (beforeCommitWrite), and on GitHub before the branch is moved
 * (beforeBranchMove). What every commit replaced is kept (replaced), so a
 * test can say no push was ever written over.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface FakeCommit {
  branchName: string;
  message: string;
  files: Array<{ filePath: string; content: string }>;
  sha: string;
}

export interface FakePullRequest {
  number: number;
  baseBranchName: string;
  headBranchName: string;
  title: string;
  body: string;
}

// What a commit replaced at a path: the content there before it, or nothing.
export interface FakeReplaced {
  branchName: string;
  filePath: string;
  content: string | undefined;
}

export interface FakeGitRepository {
  repositoryId: ObjectID;
  defaultBranch: string;
  // What OneUptime's row says the main branch is: a copy that can drift.
  storedMainBranch: string;
  protectedBranches: Set<string>;
  branches: Map<string, Map<string, string>>;
  // The last commit that changed each file on each branch (GitLab's last_commit_id).
  lastCommits: Map<string, Map<string, string>>;
  // A path's mode in GitHub's trees, on every branch: "100755", "120000"; else a plain file.
  modes: Map<string, string>;
  // Paths GitHub leaves out of a tree it says it cut short (a tree too large to list whole).
  leftOutOfTrees: Set<string>;
  commits: Array<FakeCommit>;
  // What each commit replaced, file by file, in order.
  replaced: Array<FakeReplaced>;
  pullRequests: Array<FakePullRequest>;
  // Paths whose version cannot be read on any branch, and why.
  unreadable: Map<string, string>;
  // Paths whose text cannot be read on any branch (GitHub), and why: the read throws (issue #6364).
  textUnreadable: Map<string, string>;
  // Every read of versions, as asked: a branch, and its paths (GitHub).
  blobReads: Array<{ branchName: string; filePaths: Array<string> }>;
  // Every read of a file's text for the model.
  contentReads: Array<{ branchName: string; filePath: string }>;
  // Every call the host was asked, in order: "GET git/ref", "POST commits" ...
  hostCalls: Array<string>;
  // Called before each read of versions: a push that lands while OneUptime reads.
  beforeBlobRead?: (() => void) | undefined;
  // Called just after each file's version is read: a push that lands right after (issue #6331).
  afterVersionRead?: ((filePath: string) => void) | undefined;
  // Called as a commit begins to be made: a push that lands as it is written.
  beforeCommitWrite?: (() => void) | undefined;
  // GitHub: called before the branch is moved to the commit made.
  beforeBranchMove?: (() => void) | undefined;
  // The host fails every read of versions.
  isDown: boolean;
}

// The blob git writes for a file's text: "blob <size>\0" and its bytes, SHA-1.
export const blobOf: (content: string) => string = (
  content: string,
): string => {
  const bytes: Buffer = Buffer.from(content, "utf8");

  return crypto
    .createHash("sha1")
    .update(`blob ${bytes.length}\u0000`)
    .update(bytes as unknown as Uint8Array)
    .digest("hex");
};

// A file's lines, as the hosts count them: no line after a last newline.
const linesOf: (content: string) => number = (content: string): number => {
  if (content === "") {
    return 0;
  }

  const lines: number = content.split("\n").length;

  return content.endsWith("\n") ? lines - 1 : lines;
};

const sha1: (text: string) => string = (text: string): string => {
  return crypto.createHash("sha1").update(text).digest("hex");
};

let commitCount: number = 0;

const nextCommitSha: () => string = (): string => {
  commitCount++;
  return sha1(`commit ${commitCount}`);
};

export function makeRepository(data: {
  files: Record<string, Record<string, string>>;
  defaultBranch?: string | undefined;
  storedMainBranch?: string | undefined;
  protectedBranches?: Array<string> | undefined;
  repositoryId?: ObjectID | undefined;
}): FakeGitRepository {
  const branches: Map<string, Map<string, string>> = new Map();
  const lastCommits: Map<string, Map<string, string>> = new Map();

  for (const branchName of Object.keys(data.files)) {
    const files: Map<string, string> = new Map(
      Object.entries(data.files[branchName] || {}),
    );
    branches.set(branchName, files);
    lastCommits.set(
      branchName,
      new Map(
        Array.from(files.entries()).map(
          ([filePath, content]: [string, string]) => {
            return [filePath, sha1(`initial ${filePath} ${content}`)];
          },
        ),
      ),
    );
  }

  const defaultBranch: string = data.defaultBranch || "main";

  return {
    repositoryId: data.repositoryId || ObjectID.generate(),
    defaultBranch,
    storedMainBranch: data.storedMainBranch || defaultBranch,
    protectedBranches: new Set(data.protectedBranches || []),
    branches,
    lastCommits,
    modes: new Map(),
    leftOutOfTrees: new Set(),
    commits: [],
    replaced: [],
    pullRequests: [],
    unreadable: new Map(),
    textUnreadable: new Map(),
    blobReads: [],
    contentReads: [],
    hostCalls: [],
    isDown: false,
  };
}

const lastCommitsOf: (
  repository: FakeGitRepository,
  branchName: string,
) => Map<string, string> = (
  repository: FakeGitRepository,
  branchName: string,
): Map<string, string> => {
  if (!repository.lastCommits.has(branchName)) {
    repository.lastCommits.set(branchName, new Map());
  }

  return repository.lastCommits.get(branchName)!;
};

// A teammate pushes a file's new text to a branch: a commit of its own.
export function push(
  repository: FakeGitRepository,
  branchName: string,
  filePath: string,
  content: string,
): void {
  repository.branches.get(branchName)!.set(filePath, content);
  lastCommitsOf(repository, branchName).set(filePath, nextCommitSha());
}

// A teammate deletes a file on a branch.
export function deleteFile(
  repository: FakeGitRepository,
  branchName: string,
  filePath: string,
): void {
  repository.branches.get(branchName)!.delete(filePath);
  lastCommitsOf(repository, branchName).delete(filePath);
}

// A teammate renames a file on a branch.
export function renameFile(
  repository: FakeGitRepository,
  branchName: string,
  from: string,
  to: string,
): void {
  const files: Map<string, string> = repository.branches.get(branchName)!;
  files.set(to, files.get(from)!);
  files.delete(from);
  lastCommitsOf(repository, branchName).delete(from);
  lastCommitsOf(repository, branchName).set(to, nextCommitSha());
}

// A branch's head: its files, as one commit names them.
function headOf(repository: FakeGitRepository, branchName: string): string {
  const files: Map<string, string> | undefined =
    repository.branches.get(branchName);

  return sha1(JSON.stringify(files ? Array.from(files.entries()).sort() : []));
}

// A new branch from another: its files, and the commits that last changed them.
function copyBranch(
  repository: FakeGitRepository,
  branchName: string,
  fromBranchName: string,
): void {
  repository.branches.set(
    branchName,
    new Map(repository.branches.get(fromBranchName)!),
  );
  repository.lastCommits.set(
    branchName,
    new Map(lastCommitsOf(repository, fromBranchName)),
  );
}

function applyCommit(
  repository: FakeGitRepository,
  branchName: string,
  message: string,
  files: Array<{ filePath: string; content: string }>,
  sha: string = nextCommitSha(),
): string {
  const branch: Map<string, string> | undefined =
    repository.branches.get(branchName);

  if (!branch) {
    throw new Error(`No branch ${branchName}`);
  }

  for (const file of files) {
    repository.replaced.push({
      branchName,
      filePath: file.filePath,
      content: branch.get(file.filePath),
    });
    branch.set(file.filePath, file.content);
    lastCommitsOf(repository, branchName).set(file.filePath, sha);
  }

  repository.commits.push({ branchName, message, files, sha });

  return sha;
}

function readBlobs(
  repository: FakeGitRepository,
  branchName: string,
  filePaths: Array<string>,
): Array<GitHubFileBlob> {
  repository.beforeBlobRead?.();
  repository.blobReads.push({ branchName, filePaths: [...filePaths] });
  repository.hostCalls.push(`GET contents ${filePaths.join(",")}`);

  if (repository.isDown) {
    throw new Error("The host is down.");
  }

  const branch: Map<string, string> | undefined =
    repository.branches.get(branchName);

  const blobs: Array<GitHubFileBlob> = filePaths.map(
    (filePath: string): GitHubFileBlob => {
      const failure: string | undefined = repository.unreadable.get(filePath);

      if (failure) {
        return { filePath, failure };
      }

      const content: string | undefined = branch?.get(filePath);

      return {
        filePath,
        blobSha: content === undefined ? null : blobOf(content),
      };
    },
  );

  for (const filePath of filePaths) {
    repository.afterVersionRead?.(filePath);
  }

  return blobs;
}

export function repositoryRow(
  repository: FakeGitRepository,
  type: CodeRepositoryType = CodeRepositoryType.GitHub,
): CodeRepositoryModel {
  const row: CodeRepositoryModel = new CodeRepositoryModel();
  row._id = repository.repositoryId.toString();
  row.name = "checkout";
  row.organizationName = "acme";
  row.repositoryName = "checkout";
  row.mainBranchName = repository.storedMainBranch;
  row.repositoryHostedAt = type;
  row.gitHubAppInstallationId = "12345";
  return row;
}

// The project's one repository, the person may change it, and pull requests are recorded.
function mockTheRows(row: CodeRepositoryModel): void {
  jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue([row] as never);
  jest
    .spyOn(CodeRepositoryService, "findOneUpdatableById")
    .mockResolvedValue(row as never);
  jest.spyOn(AIAgentTaskPullRequestService, "countBy").mockResolvedValue({
    toNumber: () => {
      return 0;
    },
  } as never);
  jest
    .spyOn(AIAgentTaskPullRequestService, "create")
    .mockResolvedValue({} as never);
}

const ok: (data: JSONObject, status?: number) => HTTPResponse<JSONObject> = (
  data: JSONObject,
  status: number = 200,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse(status, data, {});
};

const refusal: (status: number, message: string) => HTTPErrorResponse = (
  status: number,
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(status, { message }, {});
};

/*
 * GitHub's Git Data API for one repository, as commitFilesToBranch uses it:
 * a branch's ref, a commit's tree, a tree's entries, and new blobs, trees
 * and commits - the branch moved only as a fast-forward, unless forced.
 */
function serveGitData(repository: FakeGitRepository): void {
  const base: string = "https://api.github.com/repos/acme/checkout/git/";
  // Each commit and tree seen, by its SHA: the files it holds.
  const snapshots: Map<string, Map<string, string>> = new Map();
  const blobs: Map<string, string> = new Map();
  const made: Map<string, { tree: string; parent: string; message: string }> =
    new Map();
  // The files each new tree writes over its base, by the tree's SHA.
  const written: Map<
    string,
    Array<{ filePath: string; content: string }>
  > = new Map();

  const route: (options: APIRequestOptions) => string = (
    options: APIRequestOptions,
  ): string => {
    const url: string = options.url.toString();

    if (!url.startsWith(base)) {
      throw new Error(`Not a Git Data address of the fake: ${url}`);
    }

    return url.substring(base.length);
  };

  jest.spyOn(GitHubUtil, "getInstallationAccessToken").mockResolvedValue({
    token: "ghs_fake",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  } as never);

  jest.spyOn(API, "get").mockImplementation((async (
    options: APIRequestOptions,
  ) => {
    const path: string = route(options);

    if (path.startsWith("ref/heads/")) {
      repository.beforeCommitWrite?.();
      repository.hostCalls.push("GET git/ref");
      const branchName: string = decodeURIComponent(
        path.substring("ref/heads/".length),
      );

      if (!repository.branches.has(branchName)) {
        return refusal(404, "Not Found");
      }

      const head: string = headOf(repository, branchName);
      snapshots.set(head, new Map(repository.branches.get(branchName)!));

      return ok({ object: { sha: head, type: "commit" } });
    }

    if (path.startsWith("commits/")) {
      repository.hostCalls.push("GET git/commit");
      const sha: string = path.substring("commits/".length);
      const files: Map<string, string> | undefined = snapshots.get(sha);

      if (!files) {
        return refusal(404, "Not Found");
      }

      snapshots.set(`tree-${sha}`, files);

      return ok({ sha, tree: { sha: `tree-${sha}` } });
    }

    if (path.startsWith("trees/")) {
      repository.hostCalls.push("GET git/tree");
      const treeSha: string = path.substring("trees/".length).split("?")[0]!;
      const files: Map<string, string> | undefined = snapshots.get(treeSha);

      if (!files) {
        return refusal(404, "Not Found");
      }

      const entries: Array<JSONObject> = [];

      for (const [filePath, content] of files.entries()) {
        if (!repository.leftOutOfTrees.has(filePath)) {
          entries.push({
            path: filePath,
            mode: repository.modes.get(filePath) || "100644",
            type: "blob",
            sha: blobOf(content),
          });
        }
      }

      return ok({
        sha: treeSha,
        tree: entries,
        truncated: repository.leftOutOfTrees.size > 0,
      });
    }

    return refusal(404, "Not Found");
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (
    options: APIRequestOptions,
  ) => {
    const path: string = route(options);
    const body: JSONObject = (options.data || {}) as JSONObject;

    if (path === "blobs") {
      repository.hostCalls.push("POST git/blob");
      const content: string = Buffer.from(
        String(body["content"]),
        "base64",
      ).toString("utf8");
      const sha: string = blobOf(content);
      blobs.set(sha, content);

      return ok({ sha }, 201);
    }

    if (path === "trees") {
      repository.hostCalls.push("POST git/tree");
      const files: Map<string, string> = new Map(
        snapshots.get(String(body["base_tree"])) || [],
      );
      const changes: Array<{ filePath: string; content: string }> = [];

      for (const entry of body["tree"] as Array<JSONObject>) {
        const content: string = blobs.get(String(entry["sha"]))!;
        files.set(String(entry["path"]), content);
        changes.push({ filePath: String(entry["path"]), content });
      }

      const sha: string = `tree-${sha1(JSON.stringify(Array.from(files.entries()).sort()))}`;
      snapshots.set(sha, files);
      written.set(sha, changes);

      return ok({ sha }, 201);
    }

    if (path === "commits") {
      repository.hostCalls.push("POST git/commit");
      const tree: string = String(body["tree"]);
      const parent: string = String((body["parents"] as Array<string>)[0]);
      const sha: string = sha1(`${String(body["message"])} ${tree} ${parent}`);
      made.set(sha, { tree, parent, message: String(body["message"]) });

      return ok({ sha }, 201);
    }

    return refusal(404, "Not Found");
  }) as never);

  jest.spyOn(API, "patch").mockImplementation((async (
    options: APIRequestOptions,
  ) => {
    const path: string = route(options);
    const body: JSONObject = (options.data || {}) as JSONObject;

    if (!path.startsWith("refs/heads/")) {
      return refusal(404, "Not Found");
    }

    repository.beforeBranchMove?.();
    repository.hostCalls.push("PATCH git/ref");
    const branchName: string = decodeURIComponent(
      path.substring("refs/heads/".length),
    );
    const commit:
      | { tree: string; parent: string; message: string }
      | undefined = made.get(String(body["sha"]));

    if (!commit || !repository.branches.has(branchName)) {
      return refusal(422, "Reference does not exist");
    }

    // Not forced: only a commit built on the branch's head moves it.
    if (
      body["force"] !== true &&
      commit.parent !== headOf(repository, branchName)
    ) {
      return refusal(422, "Update is not a fast forward");
    }

    applyCommit(
      repository,
      branchName,
      commit.message,
      written.get(commit.tree) || [],
      String(body["sha"]),
    );

    return ok({
      ref: `refs/heads/${branchName}`,
      object: { sha: body["sha"] },
    });
  }) as never);
}

// The repository as a GitHub one, through the App's installation: every GitHubUtil call answered here.
export function serveOnGitHub(
  repository: FakeGitRepository,
): CodeRepositoryModel {
  const row: CodeRepositoryModel = repositoryRow(repository);

  mockTheRows(row);
  jest
    .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
    .mockResolvedValue("12345");

  jest
    .spyOn(GitHubUtil, "getDefaultBranchName")
    .mockImplementation(async (): Promise<string> => {
      return repository.defaultBranch;
    });

  jest
    .spyOn(GitHubUtil, "getBranch")
    .mockImplementation(
      async (data: {
        branchName: string;
      }): Promise<GitHubBranchInfo | null> => {
        if (!repository.branches.has(data.branchName)) {
          return null;
        }

        return {
          name: data.branchName,
          headSha: headOf(repository, data.branchName),
          isProtected: repository.protectedBranches.has(data.branchName),
        };
      },
    );

  jest
    .spyOn(GitHubUtil, "getFileContent")
    .mockImplementation(
      async (data: {
        branchName: string;
        filePath: string;
      }): Promise<GitHubFileContent | null> => {
        repository.contentReads.push({
          branchName: data.branchName,
          filePath: data.filePath,
        });

        const failure: string | undefined = repository.textUnreadable.get(
          data.filePath,
        );

        if (failure) {
          throw new Error(failure);
        }

        const content: string | undefined = repository.branches
          .get(data.branchName)
          ?.get(data.filePath);

        if (content === undefined) {
          return null;
        }

        return {
          content,
          filePath: data.filePath,
          sizeInBytes: Buffer.byteLength(content, "utf8"),
          totalLines: linesOf(content),
          htmlUrl: `https://github.com/acme/checkout/blob/${data.branchName}/${data.filePath}`,
          blobSha: blobOf(content),
        };
      },
    );

  jest
    .spyOn(GitHubUtil, "getFileBlobShas")
    .mockImplementation(
      async (data: {
        branchName: string;
        filePaths: Array<string>;
      }): Promise<Array<GitHubFileBlob>> => {
        return readBlobs(repository, data.branchName, data.filePaths);
      },
    );

  // A commit: the real commitFilesToBranch, through the Git Data API answered here.
  serveGitData(repository);

  jest
    .spyOn(GitHubUtil, "createBranch")
    .mockImplementation(
      async (data: {
        newBranchName: string;
        fromBranchName: string;
      }): Promise<boolean> => {
        if (repository.branches.has(data.newBranchName)) {
          return false;
        }

        copyBranch(repository, data.newBranchName, data.fromBranchName);

        return true;
      },
    );

  jest
    .spyOn(GitHubUtil, "createPullRequestWithToken")
    .mockImplementation((async (data: {
      baseBranchName: string;
      headBranchName: string;
      title: string;
      body: string;
    }) => {
      const number: number = repository.pullRequests.length + 1;

      repository.pullRequests.push({
        number,
        baseBranchName: data.baseBranchName,
        headBranchName: data.headBranchName,
        title: data.title,
        body: data.body,
      });

      return {
        pullRequestId: 9000 + number,
        pullRequestNumber: number,
        state: PullRequestState.Open,
      };
    }) as never);

  return row;
}

const json: (value: unknown, status?: number) => FakeAnswer = (
  value: unknown,
  status: number = 200,
): FakeAnswer => {
  return { status, json: value };
};

const NOT_FOUND: FakeAnswer = {
  status: 404,
  json: { message: "404 Not Found" },
};

const bodyOf: (request: {
  body?: string | undefined;
}) => Record<string, unknown> = (request: {
  body?: string | undefined;
}): Record<string, unknown> => {
  return JSON.parse(request.body || "{}") as Record<string, unknown>;
};

const decoded: (base64: unknown) => string = (base64: unknown): string => {
  return Buffer.from(String(base64), "base64").toString("utf8");
};

// The repository as a GitLab project, through its connection: GitLab's API answered here.
export function serveOnGitLab(
  repository: FakeGitRepository,
): ConnectedRepository {
  const filesPath: RegExp = /^\/projects\/4217\/repository\/files\/(.+)$/;

  const routes: Array<FakeRoute> = [
    {
      method: "GET",
      path: "/projects/4217",
      answer: () => {
        return json({
          id: 4217,
          path: "checkout",
          path_with_namespace: "acme/checkout",
          default_branch: repository.defaultBranch,
        });
      },
    },
    {
      method: "GET",
      path: /^\/projects\/4217\/repository\/branches\/.+$/,
      answer: (_request: unknown, url: URL) => {
        const branchName: string = decodeURIComponent(
          url.pathname.replace(/^.*\/repository\/branches\//, ""),
        );

        return repository.branches.has(branchName)
          ? json({
              name: branchName,
              protected: repository.protectedBranches.has(branchName),
              commit: { id: headOf(repository, branchName) },
            })
          : NOT_FOUND;
      },
    },
    {
      method: "POST",
      path: "/projects/4217/repository/branches",
      answer: (request: { body?: string | undefined }) => {
        const body: Record<string, unknown> = bodyOf(request);
        copyBranch(repository, String(body["branch"]), String(body["ref"]));
        return json({ name: body["branch"] }, 201);
      },
    },
    {
      method: "GET",
      path: filesPath,
      answer: (_request: unknown, url: URL) => {
        const filePath: string = decodeURIComponent(
          url.pathname.replace(/^.*\/repository\/files\//, ""),
        );
        const branchName: string = url.searchParams.get("ref") || "";
        repository.hostCalls.push(`GET files ${filePath}`);

        if (repository.isDown) {
          return { status: 403, json: { message: "403 Forbidden" } };
        }

        const content: string | undefined = repository.branches
          .get(branchName)
          ?.get(filePath);
        const lastCommit: string | undefined = lastCommitsOf(
          repository,
          branchName,
        ).get(filePath);

        const answer: FakeAnswer =
          content === undefined
            ? NOT_FOUND
            : json({
                file_path: filePath,
                size: Buffer.byteLength(content, "utf8"),
                encoding: "base64",
                content: Buffer.from(content, "utf8").toString("base64"),
                blob_id: blobOf(content),
                commit_id: headOf(repository, branchName),
                last_commit_id: lastCommit || headOf(repository, branchName),
              });

        repository.afterVersionRead?.(filePath);

        return answer;
      },
    },
    {
      method: "POST",
      path: "/projects/4217/repository/commits",
      answer: (request: { body?: string | undefined }) => {
        repository.beforeCommitWrite?.();
        repository.hostCalls.push("POST commits");
        const body: Record<string, unknown> = bodyOf(request);
        const branchName: string = String(body["branch"]);
        const files: Map<string, string> =
          repository.branches.get(branchName) || new Map();
        const actions: Array<Record<string, unknown>> = body[
          "actions"
        ] as Array<Record<string, unknown>>;

        // As GitLab holds each action, before writing any of them.
        for (const action of actions) {
          const filePath: string = String(action["file_path"]);
          const isThere: boolean = files.has(filePath);

          if (action["action"] === "create" && isThere) {
            return json(
              { message: "A file with this name already exists" },
              400,
            );
          }

          if (action["action"] === "update" && !isThere) {
            return json(
              { message: "A file with this name doesn't exist" },
              400,
            );
          }

          if (
            action["action"] === "update" &&
            action["last_commit_id"] !== undefined &&
            action["last_commit_id"] !==
              lastCommitsOf(repository, branchName).get(filePath)
          ) {
            return json(
              {
                message:
                  "You are attempting to update a file that has changed since you started editing it.",
              },
              400,
            );
          }
        }

        const sha: string = applyCommit(
          repository,
          branchName,
          String(body["commit_message"]),
          actions.map((action: Record<string, unknown>) => {
            return {
              filePath: String(action["file_path"]),
              content: decoded(action["content"]),
            };
          }),
        );

        return json(
          {
            id: sha,
            web_url: `https://gitlab.example.com/acme/checkout/-/commit/${sha}`,
          },
          201,
        );
      },
    },
    {
      method: "POST",
      path: "/projects/4217/merge_requests",
      answer: (request: { body?: string | undefined }) => {
        const body: Record<string, unknown> = bodyOf(request);
        const number: number = repository.pullRequests.length + 1;

        repository.pullRequests.push({
          number,
          baseBranchName: String(body["target_branch"]),
          headBranchName: String(body["source_branch"]),
          title: String(body["title"]),
          body: String(body["description"]),
        });

        return json(
          {
            id: 90000 + number,
            iid: number,
            state: "opened",
            web_url: `https://gitlab.example.com/acme/checkout/-/merge_requests/${number}`,
          },
          201,
        );
      },
    },
  ];

  const connected: ConnectedRepository = connectRepository({
    provider: CodeRepositoryType.GitLab,
    routes,
    repository: { mainBranchName: repository.storedMainBranch },
  });

  mockTheRows(connected.repository);

  return connected;
}

// The repository on a Forgejo or Gitea server, through its connection.
export function serveOnForgejo(
  repository: FakeGitRepository,
): ConnectedRepository {
  const routes: Array<FakeRoute> = [
    {
      method: "GET",
      path: "/repos/acme/checkout",
      answer: () => {
        return json({
          id: 5,
          name: "checkout",
          full_name: "acme/checkout",
          owner: { login: "acme" },
          default_branch: repository.defaultBranch,
          permissions: { push: true },
        });
      },
    },
    {
      method: "GET",
      path: /^\/repos\/acme\/checkout\/branches\/.+$/,
      answer: (_request: unknown, url: URL) => {
        const branchName: string = decodeURIComponent(
          url.pathname.replace(/^.*\/branches\//, ""),
        );

        return repository.branches.has(branchName)
          ? json({
              name: branchName,
              protected: repository.protectedBranches.has(branchName),
              commit: { id: headOf(repository, branchName) },
            })
          : NOT_FOUND;
      },
    },
    {
      method: "POST",
      path: "/repos/acme/checkout/branches",
      answer: (request: { body?: string | undefined }) => {
        const body: Record<string, unknown> = bodyOf(request);
        copyBranch(
          repository,
          String(body["new_branch_name"]),
          String(body["old_ref_name"]),
        );
        return json({ name: body["new_branch_name"] }, 201);
      },
    },
    {
      method: "GET",
      path: /^\/repos\/acme\/checkout\/contents\/.+$/,
      answer: (_request: unknown, url: URL) => {
        const filePath: string = decodeURIComponent(
          url.pathname.replace(/^.*\/contents\//, ""),
        );
        const branchName: string = url.searchParams.get("ref") || "";
        repository.hostCalls.push(`GET contents ${filePath}`);
        const content: string | undefined = repository.branches
          .get(branchName)
          ?.get(filePath);

        const answer: FakeAnswer =
          content === undefined
            ? NOT_FOUND
            : json({
                type: "file",
                path: filePath,
                sha: blobOf(content),
                size: Buffer.byteLength(content, "utf8"),
                content: Buffer.from(content, "utf8").toString("base64"),
                html_url: `https://git.example.com/acme/checkout/src/branch/${branchName}/${filePath}`,
              });

        repository.afterVersionRead?.(filePath);

        return answer;
      },
    },
    {
      method: "POST",
      path: "/repos/acme/checkout/contents",
      answer: (request: { body?: string | undefined }) => {
        repository.beforeCommitWrite?.();
        repository.hostCalls.push("POST contents");
        const body: Record<string, unknown> = bodyOf(request);
        const branchName: string = String(body["branch"]);
        const files: Map<string, string> =
          repository.branches.get(branchName) || new Map();
        const operations: Array<Record<string, unknown>> = body[
          "files"
        ] as Array<Record<string, unknown>>;

        // As Forgejo and Gitea hold each file, before writing any of them.
        for (const operation of operations) {
          const filePath: string = String(operation["path"]);
          const content: string | undefined = files.get(filePath);

          if (operation["operation"] === "create" && content !== undefined) {
            return json(
              { message: `repository file already exists [path: ${filePath}]` },
              422,
            );
          }

          if (operation["operation"] === "update") {
            if (content === undefined) {
              return json(
                {
                  message: `object does not exist [id: , rel_path: ${filePath}]`,
                },
                404,
              );
            }

            if (operation["sha"] !== blobOf(content)) {
              return json(
                {
                  message: `sha does not match [given: ${String(operation["sha"])}, expected: ${blobOf(content)}]`,
                },
                422,
              );
            }
          }
        }

        const sha: string = applyCommit(
          repository,
          branchName,
          String(body["message"]),
          operations.map((file: Record<string, unknown>) => {
            return {
              filePath: String(file["path"]),
              content: decoded(file["content"]),
            };
          }),
        );

        return json(
          {
            commit: {
              sha,
              html_url: `https://git.example.com/acme/checkout/commit/${sha}`,
            },
          },
          201,
        );
      },
    },
    {
      method: "POST",
      path: "/repos/acme/checkout/pulls",
      answer: (request: { body?: string | undefined }) => {
        const body: Record<string, unknown> = bodyOf(request);
        const number: number = repository.pullRequests.length + 1;

        repository.pullRequests.push({
          number,
          baseBranchName: String(body["base"]),
          headBranchName: String(body["head"]),
          title: String(body["title"]),
          body: String(body["body"]),
        });

        return json(
          {
            id: 4000 + number,
            number,
            state: "open",
            html_url: `https://git.example.com/acme/checkout/pulls/${number}`,
          },
          201,
        );
      },
    },
  ];

  const connected: ConnectedRepository = connectRepository({
    provider: CodeRepositoryType.Forgejo,
    routes,
    repository: { mainBranchName: repository.storedMainBranch },
  });

  mockTheRows(connected.repository);

  return connected;
}
