import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CodeFixPullRequestOpener, {
  FixPullRequestRequest,
  MAX_PULL_REQUEST_BODY_LENGTH,
  MAX_PULL_REQUEST_TITLE_LENGTH,
  OpenedFixPullRequest,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixPullRequestOpener";
import CodeHostAccess from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import { CodeHostHttpRequest } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryConnectionService, {
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../../../Server/Services/CodeRepositoryConnectionService";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../../Models/DatabaseModels/CodeRepositoryConnection";
import FixVerificationStatus from "../../../../../Types/AI/FixVerificationStatus";
import URL from "../../../../../Types/API/URL";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  FakeCodeHost,
  fakeCodeHost,
} from "../../CodeRepository/CodeHost/FakeCodeHost";
import {
  FakeGitLab,
  fakeGitLab,
} from "../../CodeRepository/CodeHost/FakeGitLab";

/*
 * A CODE FIX'S PULL REQUEST, OPENED BY ONEUPTIME (issue #8916).
 *
 * The server opens it with what the repository is connected with: GitLab's
 * merge request with the connection's token - as its account, so the bot
 * user of the token the branch was pushed with writes none - Forgejo's and
 * Gitea's pull request the same way, and GitHub's through the App's
 * installation the project is bound to. Asked again, it answers with the
 * one open for the branch. What it reads off a worker's request is held to
 * what Git and every host take.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e1b2c3d4-0000-4000-8000-000000000001",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "e1b2c3d4-0000-4000-8000-000000000002",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "e1b2c3d4-0000-4000-8000-000000000003",
);
const RUN_ID: ObjectID = new ObjectID("e1b2c3d4-0000-4000-8000-000000000004");
const CONNECTION_TOKEN: string = "glpat-the-connections-own-0003";
const BRANCH: string = "oneuptime-fix-exception-e1b2c3d4";

let connection: CodeRepositoryConnection | undefined;

function makeConnection(
  overrides: Partial<CodeRepositoryConnection> = {},
): CodeRepositoryConnection {
  const made: CodeRepositoryConnection = new CodeRepositoryConnection();
  made._id = CONNECTION_ID.toString();
  made.projectId = PROJECT_ID;
  made.provider = CodeRepositoryType.GitLab;
  made.hostUrl = "https://gitlab.example.com";
  made.accountLogin = "alice";
  made.credentials = CodeRepositoryConnectionServiceClass.writeCredentials({
    token: CONNECTION_TOKEN,
    username: "alice",
  });
  made.isReachableFromServer = true;
  Object.assign(made, overrides);
  return made;
}

function makeRepository(
  // A column may be left out with undefined.
  overrides: {
    [Column in keyof CodeRepository]?: CodeRepository[Column] | undefined;
  } = {},
): CodeRepository {
  const made: CodeRepository = new CodeRepository();
  made._id = REPOSITORY_ID.toString();
  made.projectId = PROJECT_ID;
  made.repositoryHostedAt = CodeRepositoryType.GitLab;
  made.organizationName = "acme/backend";
  made.repositoryName = "checkout";
  made.repositoryUrl = URL.fromString(
    "https://gitlab.example.com/acme/backend/checkout",
  );
  made.gitLabProjectId = "4217";
  made.codeRepositoryConnectionId = CONNECTION_ID;
  Object.assign(made, overrides);
  return made;
}

function request(
  overrides: Partial<FixPullRequestRequest> = {},
): FixPullRequestRequest {
  return {
    codeRepositoryId: REPOSITORY_ID,
    headRefName: BRANCH,
    baseRefName: "main",
    title: "fix: resolve TypeError in checkout",
    body: "## Exception Fix",
    ...overrides,
  };
}

beforeEach(() => {
  connection = makeConnection();

  jest
    .spyOn(CodeHostAccess, "readConnections")
    .mockImplementation((async (): Promise<
      Map<string, CodeRepositoryConnection>
    > => {
      return connection
        ? new Map([[CONNECTION_ID.toString(), connection]])
        : new Map();
    }) as never);
  jest
    .spyOn(CodeRepositoryConnectionService, "markAccepted")
    .mockResolvedValue(undefined);
  jest
    .spyOn(CodeRepositoryConnectionService, "markRefused")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  CodeHostAccess.setTransportForTests(null);
  jest.restoreAllMocks();
});

describe("reading what a worker asks to be opened", () => {
  test("the repository, both branches and the title, with the description bounded", () => {
    const read: FixPullRequestRequest = CodeFixPullRequestOpener.readRequest({
      codeRepositoryId: REPOSITORY_ID.toString(),
      headRefName: BRANCH,
      baseRefName: "release/2026.11",
      title: `  ${"t".repeat(400)}  `,
      body: "b".repeat(MAX_PULL_REQUEST_BODY_LENGTH + 10),
      runnerVerificationStatus: FixVerificationStatus.Failed,
      runnerVerificationSummary: "2 tests failed.",
    });

    expect(read.codeRepositoryId.toString()).toBe(REPOSITORY_ID.toString());
    expect(read.headRefName).toBe(BRANCH);
    expect(read.baseRefName).toBe("release/2026.11");
    expect(read.title).toHaveLength(MAX_PULL_REQUEST_TITLE_LENGTH);
    expect(read.body).toHaveLength(MAX_PULL_REQUEST_BODY_LENGTH);
    expect(read.body).toContain("This description was truncated");
    expect(read.runnerVerificationStatus).toBe(FixVerificationStatus.Failed);
    expect(read.runnerVerificationSummary).toBe("2 tests failed.");
  });

  test("a verification status this server does not know is dropped; a missing description is empty", () => {
    const read: FixPullRequestRequest = CodeFixPullRequestOpener.readRequest({
      codeRepositoryId: REPOSITORY_ID.toString(),
      headRefName: BRANCH,
      baseRefName: "main",
      title: "fix",
      runnerVerificationStatus: "Maybe",
    });

    expect(read.runnerVerificationStatus).toBeUndefined();
    expect(read.body).toBe("");
  });

  test.each([
    "-flag",
    "/rooted",
    "trailing/",
    "dot.",
    "x.lock",
    "a..b",
    "a//b",
    "a@{1}",
    "back\\slash",
    "@",
    "tilde~1",
    "caret^",
    "colon:x",
    "question?",
    "star*",
    "bracket[",
    "space here",
    "tab\there",
    "nul\u0000",
    "del\u007f",
    "b".repeat(256),
  ])("refuses a branch Git takes no name like: %j", (branch: string) => {
    expect(() => {
      return CodeFixPullRequestOpener.readRequest({
        codeRepositoryId: REPOSITORY_ID.toString(),
        headRefName: branch,
        baseRefName: "main",
        title: "fix",
      });
    }).toThrow(
      new BadDataException("headRefName is not a branch name Git takes"),
    );
  });

  test("takes the branch names Git and every host take", () => {
    for (const branch of [
      "main",
      "release/2026.11",
      "feature/login-v2",
      "oneuptime-task-12-1a2b3c4d",
      "users/alice/fix_it",
    ]) {
      expect(
        CodeFixPullRequestOpener.readRequest({
          codeRepositoryId: REPOSITORY_ID.toString(),
          headRefName: branch,
          baseRefName: branch,
          title: "fix",
        }).headRefName,
      ).toBe(branch);
    }
  });
});

describe("whose branch a pull request may be opened from", () => {
  test("the one the run made: it ends with the first eight characters of the run's id", () => {
    const short: string = RUN_ID.toString().substring(0, 8);

    for (const branch of [
      `oneuptime-fix-exception-${short}`,
      `oneuptime-regression-test-${short}`,
      `oneuptime-issue-42-${short}`,
      `oneuptime-task-12-${short}`,
      `oneuptime-task-12-${short.toUpperCase()}`,
    ]) {
      expect(
        CodeFixPullRequestOpener.isBranchOfRun({
          branchName: branch,
          runId: RUN_ID,
        }),
      ).toBe(true);
    }

    for (const branch of [
      "main",
      "feature/login",
      `${short}-then-more`,
      "oneuptime-fix-exception-00000000",
    ]) {
      expect(
        CodeFixPullRequestOpener.isBranchOfRun({
          branchName: branch,
          runId: RUN_ID,
        }),
      ).toBe(false);
    }
  });
});

describe("a GitLab merge request", () => {
  test("is opened with the connection's token, as its account - never as the bot of the token the branch was pushed with", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      connectionToken: CONNECTION_TOKEN,
      projects: [
        {
          id: "4217",
          path: "acme/backend/checkout",
          branches: ["main", BRANCH],
        },
      ],
    });
    CodeHostAccess.setTransportForTests(gitLab.transport);

    const opened: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
      repository: makeRepository(),
      request: request(),
    });

    expect(opened).toEqual({
      id: gitLab.mergeRequests[0]!.id,
      number: 1,
      htmlUrl:
        "https://gitlab.example.com/acme/backend/checkout/-/merge_requests/1",
      title: "fix: resolve TypeError in checkout",
      isNew: true,
    });
    expect(gitLab.mergeRequests[0]!.authorUserId).toBe(gitLab.connectionUserId);
    expect(gitLab.mergeRequests[0]!.sourceBranch).toBe(BRANCH);
    expect(gitLab.mergeRequests[0]!.targetBranch).toBe("main");

    const create: CodeHostHttpRequest | undefined = gitLab.requests.find(
      (sent: CodeHostHttpRequest): boolean => {
        return sent.method === "POST";
      },
    );

    expect(create!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/4217/merge_requests",
    );
    expect(create!.headers["PRIVATE-TOKEN"]).toBe(CONNECTION_TOKEN);
  });

  test("asked again, it is the one open for the branch (409), and no second one", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      connectionToken: CONNECTION_TOKEN,
      projects: [
        {
          id: "4217",
          path: "acme/backend/checkout",
          branches: ["main", BRANCH],
        },
      ],
    });
    CodeHostAccess.setTransportForTests(gitLab.transport);

    const first: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
      repository: makeRepository(),
      request: request(),
    });
    const second: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
      repository: makeRepository(),
      request: request(),
    });

    expect(gitLab.mergeRequests).toHaveLength(1);
    expect(second.number).toBe(first.number);
    expect(second.htmlUrl).toBe(first.htmlUrl);
    expect(second.isNew).toBe(false);
  });

  test("a branch GitLab does not have is refused in GitLab's words", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      connectionToken: CONNECTION_TOKEN,
    });
    CodeHostAccess.setTransportForTests(gitLab.transport);

    await expect(
      CodeFixPullRequestOpener.open({
        repository: makeRepository(),
        request: request(),
      }),
    ).rejects.toThrow("Source branch does not exist");
    expect(gitLab.mergeRequests).toHaveLength(0);
  });

  test("a repository whose server OneUptime does not reach, or whose connection is gone, is said so", async () => {
    connection = makeConnection({ isReachableFromServer: false });

    await expect(
      CodeFixPullRequestOpener.open({
        repository: makeRepository(),
        request: request(),
      }),
    ).rejects.toThrow("cannot reach this repository's GitLab server");

    connection = undefined;

    await expect(
      CodeFixPullRequestOpener.open({
        repository: makeRepository(),
        request: request(),
      }),
    ).rejects.toThrow("cannot reach this repository's GitLab server");
  });
});

describe("a Forgejo or Gitea pull request", () => {
  function forgejo(data: { conflict: boolean }): FakeCodeHost {
    return fakeCodeHost({
      apiBaseUrl: "https://codeberg.org/api/v1",
      routes: [
        {
          method: "GET",
          path: "/user",
          answer: () => {
            return { json: { id: 1, login: "alice" } };
          },
        },
        {
          method: "POST",
          path: "/repos/acme/checkout/pulls",
          answer: () => {
            return data.conflict
              ? {
                  status: 409,
                  json: {
                    message: "pull request already exists for these targets",
                  },
                }
              : {
                  status: 201,
                  json: {
                    id: 777,
                    number: 5,
                    state: "open",
                    html_url: "https://codeberg.org/acme/checkout/pulls/5",
                  },
                };
          },
        },
        {
          method: "GET",
          path: "/repos/acme/checkout/pulls",
          answer: () => {
            return {
              json: [
                {
                  id: 776,
                  number: 4,
                  state: "open",
                  html_url: "https://codeberg.org/acme/checkout/pulls/4",
                  head: { ref: "another", repo: { id: 9 } },
                  base: { ref: "main", repo: { id: 9 } },
                },
                {
                  id: 778,
                  number: 6,
                  state: "open",
                  html_url: "https://codeberg.org/acme/checkout/pulls/6",
                  head: { ref: BRANCH, repo: { id: 9 } },
                  base: { ref: "main", repo: { id: 9 } },
                },
              ],
            };
          },
        },
      ],
    });
  }

  function forgejoRepository(): CodeRepository {
    return makeRepository({
      repositoryHostedAt: CodeRepositoryType.Forgejo,
      organizationName: "acme",
      repositoryName: "checkout",
      repositoryUrl: URL.fromString("https://codeberg.org/acme/checkout"),
      gitLabProjectId: undefined,
    });
  }

  beforeEach(() => {
    connection = makeConnection({
      provider: CodeRepositoryType.Forgejo,
      hostUrl: "https://codeberg.org",
    });
  });

  test("is opened with the connection's token", async () => {
    const host: FakeCodeHost = forgejo({ conflict: false });
    CodeHostAccess.setTransportForTests(host.transport);

    const opened: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
      repository: forgejoRepository(),
      request: request(),
    });

    expect(opened).toEqual({
      id: 777,
      number: 5,
      htmlUrl: "https://codeberg.org/acme/checkout/pulls/5",
      title: "fix: resolve TypeError in checkout",
      isNew: true,
    });

    const create: CodeHostHttpRequest = host.requests.find(
      (sent: CodeHostHttpRequest): boolean => {
        return sent.method === "POST";
      },
    )!;

    expect(create.headers["Authorization"]).toBe(`token ${CONNECTION_TOKEN}`);
    expect(JSON.parse(create.body || "{}")).toEqual({
      head: BRANCH,
      base: "main",
      title: "fix: resolve TypeError in checkout",
      body: "## Exception Fix",
    });
  });

  test("asked again (409), it is the one open from the branch into the base", async () => {
    const host: FakeCodeHost = forgejo({ conflict: true });
    CodeHostAccess.setTransportForTests(host.transport);

    const opened: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
      repository: forgejoRepository(),
      request: request(),
    });

    expect(opened.number).toBe(6);
    expect(opened.isNew).toBe(false);
  });
});

describe("a GitHub pull request", () => {
  test("is opened through the installation the project is bound to", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("12345");
    const openOnGitHub: jest.SpiedFunction<
      typeof GitHubUtil.openFixPullRequest
    > = jest.spyOn(GitHubUtil, "openFixPullRequest").mockResolvedValue({
      id: 31,
      number: 77,
      htmlUrl: "https://github.com/acme/checkout/pull/77",
      title: "fix: resolve TypeError in checkout",
      isNew: true,
    });

    const opened: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
      repository: makeRepository({
        repositoryHostedAt: CodeRepositoryType.GitHub,
        organizationName: "acme",
        repositoryName: "checkout",
        gitHubAppInstallationId: "12345",
      }),
      request: request(),
    });

    expect(opened.number).toBe(77);
    expect(openOnGitHub).toHaveBeenCalledWith({
      installationId: "12345",
      organizationName: "acme",
      repositoryName: "checkout",
      baseBranchName: "main",
      headBranchName: BRANCH,
      title: "fix: resolve TypeError in checkout",
      body: "## Exception Fix",
    });
  });

  test("never through an installation the project is not bound to", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("99999");
    const openOnGitHub: jest.SpiedFunction<
      typeof GitHubUtil.openFixPullRequest
    > = jest.spyOn(GitHubUtil, "openFixPullRequest");

    await expect(
      CodeFixPullRequestOpener.open({
        repository: makeRepository({
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: "acme",
          repositoryName: "checkout",
          gitHubAppInstallationId: "12345",
        }),
        request: request(),
      }),
    ).rejects.toThrow("not connected to its project");
    expect(openOnGitHub).not.toHaveBeenCalled();
  });
});

describe("a Git repository", () => {
  test("has no pull request to open: its branch is pushed, and the person opens one", async () => {
    await expect(
      CodeFixPullRequestOpener.open({
        repository: makeRepository({
          repositoryHostedAt: CodeRepositoryType.Git,
        }),
        request: request(),
      }),
    ).rejects.toThrow("gets a pushed branch, not a pull request");
  });
});
