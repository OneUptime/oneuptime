import { jest } from "@jest/globals";
import crypto from "crypto";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import GitHubUtil, {
  GitHubBranchInfo,
  GitHubCommitResult,
  GitHubFileBlob,
  GitHubFileContent,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryModel from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";
import { FakeAnswer, FakeRoute } from "../CodeRepository/CodeHost/FakeCodeHost";
import {
  ConnectedRepository,
  connectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";

/*
 * A REPOSITORY ON A CODE HOST, IN MEMORY (issue #6313): branches of files,
 * each file's blob as git hashes it, the commits chat makes and the pull
 * requests it opens - and teammates who push while Ask AI works.
 *
 * Served to the code tools the whole real way as far as it goes: as a
 * GitHub repository through GitHubUtil (each call answered from here), or
 * as a GitLab or Forgejo one through its connection's API, faked at the
 * transport (ConnectedRepository), its routes answering from here.
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

export interface FakeGitRepository {
  repositoryId: ObjectID;
  defaultBranch: string;
  // What OneUptime's row says the main branch is: a copy that can drift.
  storedMainBranch: string;
  protectedBranches: Set<string>;
  branches: Map<string, Map<string, string>>;
  commits: Array<FakeCommit>;
  pullRequests: Array<FakePullRequest>;
  // Paths whose version cannot be read on any branch, and why.
  unreadable: Map<string, string>;
  // Every read of versions, as asked: a branch, and its paths.
  blobReads: Array<{ branchName: string; filePaths: Array<string> }>;
  // Every read of a file's text for the model.
  contentReads: Array<{ branchName: string; filePath: string }>;
  // Called before each read of versions: a push that lands while OneUptime reads.
  beforeBlobRead?: (() => void) | undefined;
  // The host fails every read of versions.
  isDown: boolean;
}

// The blob git writes for a file's text: "blob <size>\0" and its bytes, SHA-1.
export const blobOf: (content: string) => string = (content: string): string => {
  const bytes: Buffer = Buffer.from(content, "utf8");

  return crypto
    .createHash("sha1")
    .update(`blob ${bytes.length}\u0000`)
    .update(bytes as unknown as Uint8Array)
    .digest("hex");
};

let commitCount: number = 0;

const nextCommitSha: () => string = (): string => {
  commitCount++;
  return crypto.createHash("sha1").update(`commit ${commitCount}`).digest("hex");
};

export function makeRepository(data: {
  files: Record<string, Record<string, string>>;
  defaultBranch?: string | undefined;
  storedMainBranch?: string | undefined;
  protectedBranches?: Array<string> | undefined;
  repositoryId?: ObjectID | undefined;
}): FakeGitRepository {
  const branches: Map<string, Map<string, string>> = new Map();

  for (const branchName of Object.keys(data.files)) {
    branches.set(
      branchName,
      new Map(Object.entries(data.files[branchName] || {})),
    );
  }

  const defaultBranch: string = data.defaultBranch || "main";

  return {
    repositoryId: data.repositoryId || ObjectID.generate(),
    defaultBranch,
    storedMainBranch: data.storedMainBranch || defaultBranch,
    protectedBranches: new Set(data.protectedBranches || []),
    branches,
    commits: [],
    pullRequests: [],
    unreadable: new Map(),
    blobReads: [],
    contentReads: [],
    isDown: false,
  };
}

// A teammate pushes a file's new text to a branch.
export function push(
  repository: FakeGitRepository,
  branchName: string,
  filePath: string,
  content: string,
): void {
  repository.branches.get(branchName)!.set(filePath, content);
}

// A teammate deletes a file on a branch.
export function deleteFile(
  repository: FakeGitRepository,
  branchName: string,
  filePath: string,
): void {
  repository.branches.get(branchName)!.delete(filePath);
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
}

function headOf(repository: FakeGitRepository, branchName: string): string {
  const files: Map<string, string> | undefined =
    repository.branches.get(branchName);

  return crypto
    .createHash("sha1")
    .update(JSON.stringify(files ? Array.from(files.entries()).sort() : []))
    .digest("hex");
}

function applyCommit(
  repository: FakeGitRepository,
  branchName: string,
  message: string,
  files: Array<{ filePath: string; content: string }>,
): string {
  const branch: Map<string, string> | undefined =
    repository.branches.get(branchName);

  if (!branch) {
    throw new Error(`No branch ${branchName}`);
  }

  for (const file of files) {
    branch.set(file.filePath, file.content);
  }

  const sha: string = nextCommitSha();
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

  if (repository.isDown) {
    throw new Error("The host is down.");
  }

  const branch: Map<string, string> | undefined =
    repository.branches.get(branchName);

  return filePaths.map((filePath: string): GitHubFileBlob => {
    const failure: string | undefined = repository.unreadable.get(filePath);

    if (failure) {
      return { filePath, failure };
    }

    const content: string | undefined = branch?.get(filePath);

    return { filePath, blobSha: content === undefined ? null : blobOf(content) };
  });
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

// The repository as a GitHub one, through the App's installation: every GitHubUtil call answered here.
export function serveOnGitHub(repository: FakeGitRepository): CodeRepositoryModel {
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
      async (data: { branchName: string }): Promise<GitHubBranchInfo | null> => {
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
          totalLines: content === "" ? 0 : content.replace(/\n$/, "").split("\n").length,
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

  jest
    .spyOn(GitHubUtil, "commitFilesToBranch")
    .mockImplementation(
      async (data: {
        branchName: string;
        commitMessage: string;
        changes: Array<{ filePath: string; content: string }>;
      }): Promise<GitHubCommitResult> => {
        const sha: string = applyCommit(
          repository,
          data.branchName,
          data.commitMessage,
          data.changes,
        );

        return {
          commitSha: sha,
          branchName: data.branchName,
          htmlUrl: `https://github.com/acme/checkout/commit/${sha}`,
        };
      },
    );

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

        repository.branches.set(
          data.newBranchName,
          new Map(repository.branches.get(data.fromBranchName)!),
        );

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

const NOT_FOUND: FakeAnswer = { status: 404, json: { message: "404 Not Found" } };

const bodyOf: (request: { body?: string | undefined }) => Record<string, unknown> =
  (request: { body?: string | undefined }): Record<string, unknown> => {
    return JSON.parse(request.body || "{}") as Record<string, unknown>;
  };

const decoded: (base64: unknown) => string = (base64: unknown): string => {
  return Buffer.from(String(base64), "base64").toString("utf8");
};

// The repository as a GitLab project, through its connection: GitLab's API answered here.
export function serveOnGitLab(repository: FakeGitRepository): ConnectedRepository {
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
        repository.branches.set(
          String(body["branch"]),
          new Map(repository.branches.get(String(body["ref"]))!),
        );
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

        if (repository.isDown) {
          return { status: 403, json: { message: "403 Forbidden" } };
        }

        const content: string | undefined = repository.branches
          .get(branchName)
          ?.get(filePath);

        if (content === undefined) {
          return NOT_FOUND;
        }

        return json({
          file_path: filePath,
          size: Buffer.byteLength(content, "utf8"),
          encoding: "base64",
          content: Buffer.from(content, "utf8").toString("base64"),
          blob_id: blobOf(content),
          last_commit_id: headOf(repository, branchName),
        });
      },
    },
    {
      method: "POST",
      path: "/projects/4217/repository/commits",
      answer: (request: { body?: string | undefined }) => {
        const body: Record<string, unknown> = bodyOf(request);
        const sha: string = applyCommit(
          repository,
          String(body["branch"]),
          String(body["commit_message"]),
          (body["actions"] as Array<Record<string, unknown>>).map(
            (action: Record<string, unknown>) => {
              return {
                filePath: String(action["file_path"]),
                content: decoded(action["content"]),
              };
            },
          ),
        );

        return json(
          { id: sha, web_url: `https://gitlab.example.com/acme/checkout/-/commit/${sha}` },
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
export function serveOnForgejo(repository: FakeGitRepository): ConnectedRepository {
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
        repository.branches.set(
          String(body["new_branch_name"]),
          new Map(repository.branches.get(String(body["old_ref_name"]))!),
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
        const content: string | undefined = repository.branches
          .get(branchName)
          ?.get(filePath);

        if (content === undefined) {
          return NOT_FOUND;
        }

        return json({
          type: "file",
          path: filePath,
          sha: blobOf(content),
          size: Buffer.byteLength(content, "utf8"),
          content: Buffer.from(content, "utf8").toString("base64"),
          html_url: `https://git.example.com/acme/checkout/src/branch/${branchName}/${filePath}`,
        });
      },
    },
    {
      method: "POST",
      path: "/repos/acme/checkout/contents",
      answer: (request: { body?: string | undefined }) => {
        const body: Record<string, unknown> = bodyOf(request);
        const sha: string = applyCommit(
          repository,
          String(body["branch"]),
          String(body["message"]),
          (body["files"] as Array<Record<string, unknown>>).map(
            (file: Record<string, unknown>) => {
              return {
                filePath: String(file["path"]),
                content: decoded(file["content"]),
              };
            },
          ),
        );

        return json(
          { commit: { sha, html_url: `https://git.example.com/acme/checkout/commit/${sha}` } },
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
