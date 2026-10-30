import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProductionReviewHosts, {
  AuthorWriteAccess,
  ONEUPTIME_BRANCH_PREFIX,
  PolledReviewHost,
  ProductionReviewHost,
  UpdatedPullRequests,
  fromGitHubPullRequest,
  isBotLogin,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewHost";
import {
  CodeHostComment,
  CodeHostPullRequestDetails,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import GitHubConversation from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import GitHubCommandType from "../../../../../Types/CodeRepository/GitHubCommand";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CONNECTED_PROJECT_ID,
  ConnectedRepository,
  connectRepository,
  disconnectRepository,
} from "../CodeHost/ConnectedRepository";
import { FakeRoute } from "../CodeHost/FakeCodeHost";

/*
 * Where a production review reads its pull request and keeps its comment:
 * GitHub through the App's installation the project is bound to (never an
 * installation id on a row alone), GitLab and Forgejo through the
 * repository's connection. The poll's half (GitLab, Forgejo) also asks
 * who may write, lists what changed lately, and knows OneUptime's own pull
 * requests. Bots are known by their logins.
 */

const SHA: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766";

afterEach(() => {
  disconnectRepository();
});

function details(
  change: Partial<CodeHostPullRequestDetails> = {},
): CodeHostPullRequestDetails {
  return {
    number: 12,
    title: "fix",
    isOpen: true,
    isMerged: false,
    isDraft: false,
    htmlUrl: "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
    authorLogin: "dana",
    authorId: "77",
    headSha: SHA,
    headRefName: "fix/card",
    baseRefName: "main",
    isFromFork: false,
    changedFilesCount: 1,
    changedLineCount: 2,
    updatedAt: "2026-10-30T09:00:00.000Z",
    ...change,
  };
}

describe("isBotLogin", () => {
  test.each([
    ["dependabot[bot]", true],
    ["renovate-bot", true],
    ["deploy_bot", true],
    ["project_42_bot_1a2b3c", true],
    ["group_7_bot_ffee", true],
    ["Project_42_Bot_x", true],
    ["dana", false],
    ["botanist", false],
    ["project_x_bot_1", false],
    ["project_42_human", false],
    ["robot", false],
    ["", false],
    [null, false],
  ] as Array<[string | null, boolean]>)(
    "%s is a bot: %s",
    (login: string | null, isBot: boolean) => {
      expect(isBotLogin(login)).toBe(isBot);
    },
  );
});

describe("fromGitHubPullRequest", () => {
  test("a GitHub pull request, as every host gives one: a fork when its head is another repository's", () => {
    const pullRequest: CodeHostPullRequestDetails = fromGitHubPullRequest({
      pullRequest: {
        pullRequestNumber: 42,
        title: "fix",
        body: "",
        state: "open",
        htmlUrl: "https://github.com/acme/checkout/pull/42",
        authorLogin: "octo",
        headRefName: "fix",
        headSha: SHA,
        baseRefName: "main",
        headRepositoryFullName: "someone/checkout",
        isDraft: true,
        isMerged: false,
        changedFilesCount: 3,
        additions: 10,
        deletions: 4,
      },
      organizationName: "acme",
      repositoryName: "checkout",
    });

    expect(pullRequest).toEqual({
      number: 42,
      title: "fix",
      isOpen: true,
      isMerged: false,
      isDraft: true,
      htmlUrl: "https://github.com/acme/checkout/pull/42",
      authorLogin: "octo",
      authorId: "",
      headSha: SHA,
      headRefName: "fix",
      baseRefName: "main",
      isFromFork: true,
      changedFilesCount: 3,
      changedLineCount: 14,
      updatedAt: "",
    });
  });
});

describe("ProductionReviewHosts.open", () => {
  const GITHUB_CONTEXT: {
    codeRepositoryId: string;
    installationId: string;
    organizationName: string;
    repositoryName: string;
    commandType: GitHubCommandType;
    instruction: string;
    pullRequestNumber: number;
  } = {
    codeRepositoryId: "c0de0000-0000-4000-8000-000000000002",
    installationId: "4242",
    organizationName: "acme",
    repositoryName: "checkout",
    commandType: GitHubCommandType.ProductionReview,
    instruction: "",
    pullRequestNumber: 42,
  };

  function gitHubRepository(installationId: string): CodeRepository {
    const repository: CodeRepository = new CodeRepository();
    repository.id = new ObjectID("c0de0000-0000-4000-8000-000000000002");
    repository.projectId = CONNECTED_PROJECT_ID;
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.gitHubAppInstallationId = installationId;
    return repository;
  }

  test("GitHub: through the installation the review was asked on, while the project is bound to it", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(true);

    const host: ProductionReviewHost | null = await ProductionReviewHosts.open({
      projectId: CONNECTED_PROJECT_ID,
      repository: gitHubRepository("4242"),
      provider: CodeRepositoryType.GitHub,
      github: GITHUB_CONTEXT,
    });

    expect(host?.provider).toBe(CodeRepositoryType.GitHub);
    expect(host?.writeCheckRun).toBeDefined();

    // Another installation's row, or one the project is no longer bound to.
    expect(
      await ProductionReviewHosts.open({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository("9999"),
        provider: CodeRepositoryType.GitHub,
        github: GITHUB_CONTEXT,
      }),
    ).toBeNull();

    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(false);

    expect(
      await ProductionReviewHosts.open({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository("4242"),
        provider: CodeRepositoryType.GitHub,
        github: GITHUB_CONTEXT,
      }),
    ).toBeNull();

    expect(
      await ProductionReviewHosts.open({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository("4242"),
        provider: CodeRepositoryType.GitHub,
        github: null,
      }),
    ).toBeNull();
  });

  test("a review asked on another host than the repository is on now has none", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [],
    });

    expect(
      await ProductionReviewHosts.open({
        projectId: CONNECTED_PROJECT_ID,
        repository: connected.repository,
        provider: CodeRepositoryType.Forgejo,
        github: null,
      }),
    ).toBeNull();

    expect(
      (
        await ProductionReviewHosts.open({
          projectId: CONNECTED_PROJECT_ID,
          repository: connected.repository,
          provider: CodeRepositoryType.GitLab,
          github: null,
        })
      )?.provider,
    ).toBe(CodeRepositoryType.GitLab);
  });

  test("the GitHub host's command is the App's own, and GitLab's and Forgejo's are none", async () => {
    jest.spyOn(GitHubConversation, "getAppSlug").mockResolvedValue("oneuptime");

    expect(
      await ProductionReviewHosts.gitHub(GITHUB_CONTEXT).getReviewCommand(),
    ).toBe("@oneuptime production review");

    jest.spyOn(GitHubConversation, "getAppSlug").mockResolvedValue(null);

    expect(
      await ProductionReviewHosts.gitHub(GITHUB_CONTEXT).getReviewCommand(),
    ).toBeNull();

    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [],
    });
    const gitLab: PolledReviewHost | null =
      await ProductionReviewHosts.openPolled(connected.repository);

    expect(await gitLab!.getReviewCommand()).toBeNull();
    expect(gitLab!.writeCheckRun).toBeUndefined();
  });
});

describe("a GitLab project, as the poll and its reviews read it", () => {
  async function gitLab(routes: Array<FakeRoute>): Promise<{
    host: PolledReviewHost;
    connected: ConnectedRepository;
  }> {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes,
    });

    return {
      host: (await ProductionReviewHosts.openPolled(connected.repository))!,
      connected,
    };
  }

  test("who may write: Developer or more, as GitLab says now", async () => {
    let level: number = 30;
    const { host } = await gitLab([
      {
        method: "GET",
        path: "/projects/4217/members/all/77",
        answer: () => {
          return { json: { access_level: level, state: "active" } };
        },
      },
    ]);

    expect(await host.getAuthorWriteAccess(details())).toBe(
      AuthorWriteAccess.CanWrite,
    );

    level = 20;

    expect(await host.getAuthorWriteAccess(details())).toBe(
      AuthorWriteAccess.CannotWrite,
    );
  });

  test("lists what changed lately, oldest first - a full page goes on from its last", async () => {
    const page: Array<unknown> = Array.from(
      { length: 100 },
      (_value: unknown, index: number) => {
        return {
          iid: index + 1,
          state: "opened",
          sha: SHA,
          source_branch: "b",
          target_branch: "main",
          source_project_id: 4217,
          target_project_id: 4217,
          author: { id: 1, username: "dana" },
          updated_at: `2026-10-30T09:${String(Math.floor(index / 2)).padStart(2, "0")}:00.000Z`,
        };
      },
    );
    const { host } = await gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return { json: page };
        },
      },
    ]);

    const full: UpdatedPullRequests = await host.listUpdatedPullRequests(
      new Date("2026-10-30T08:00:00.000Z"),
    );

    expect(full.pullRequests).toHaveLength(100);
    expect(full.continueFrom?.toISOString()).toBe("2026-10-30T09:49:00.000Z");

    page.length = 3;

    expect(
      (await host.listUpdatedPullRequests(new Date())).continueFrom,
    ).toBeNull();
  });

  test("its own merge requests: by its connection's account, on a branch AI pushes", async () => {
    const { host } = await gitLab([]);

    expect(
      host.isOwnPullRequest(
        details({
          authorLogin: "OneUptime-Bot",
          headRefName: `${ONEUPTIME_BRANCH_PREFIX}ai/fix-1a2b`,
        }),
      ),
    ).toBe(true);
    // The person who connected keeps their own merge requests reviewed.
    expect(
      host.isOwnPullRequest(
        details({ authorLogin: "oneuptime-bot", headRefName: "fix/card" }),
      ),
    ).toBe(false);
    expect(
      host.isOwnPullRequest(
        details({
          authorLogin: "dana",
          headRefName: `${ONEUPTIME_BRANCH_PREFIX}ai/x`,
        }),
      ),
    ).toBe(false);
  });

  test("its note is edited in place - and written anew when the one there is gone", async () => {
    let editStatus: number = 200;
    const { host, connected } = await gitLab([
      {
        method: "PUT",
        path: "/projects/4217/merge_requests/12/notes/5150",
        answer: () => {
          return editStatus === 200
            ? { json: { id: 5150 } }
            : { status: editStatus, json: { message: "404 Not found" } };
        },
      },
      {
        method: "POST",
        path: "/projects/4217/merge_requests/12/notes",
        answer: () => {
          return { status: 201, json: { id: 5151 } };
        },
      },
    ]);
    const pullRequest: { number: number; htmlUrl: string } = {
      number: 12,
      htmlUrl: "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
    };

    const edited: CodeHostComment = await host.writeComment({
      pullRequest,
      commentId: 5150,
      body: "Again",
    });

    expect(edited.commentId).toBe(5150);

    editStatus = 404;

    const rewritten: CodeHostComment = await host.writeComment({
      pullRequest,
      commentId: 5150,
      body: "Again",
    });

    expect(rewritten).toEqual({
      commentId: 5151,
      htmlUrl:
        "https://gitlab.example.com/acme/checkout/-/merge_requests/12#note_5151",
    });

    await host.writeComment({ pullRequest, commentId: undefined, body: "New" });

    expect(
      connected.host.requests.filter((request: { method: string }) => {
        return request.method === "POST";
      }),
    ).toHaveLength(2);
  });

  test("a merge request it cannot read lists its files no further than GitLab says", async () => {
    const { host } = await gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12/diffs",
        answer: () => {
          return {
            json: [
              {
                old_path: "a.ts",
                new_path: "a.ts",
                diff: "@@ -1 +1 @@\n-a\n+b\n",
              },
            ],
          };
        },
      },
    ]);

    // GitLab counted more files than its diffs gave: there are more.
    expect(
      (
        await host.listFiles({
          pullRequest: details({ changedFilesCount: 5 }),
          maxFiles: 300,
        })
      ).hasMore,
    ).toBe(true);
    expect(
      (
        await host.listFiles({
          pullRequest: details({ changedFilesCount: 1 }),
          maxFiles: 300,
        })
      ).hasMore,
    ).toBe(false);
  });
});

describe("a Forgejo or Gitea repository, as the poll and its reviews read it", () => {
  async function forgejo(routes: Array<FakeRoute>): Promise<PolledReviewHost> {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Forgejo,
      routes,
    });

    return (await ProductionReviewHosts.openPolled(connected.repository))!;
  }

  test("who may write: write, admin or owner - and nothing said when the token is not told", async () => {
    let answer: { status?: number; json?: unknown } = {
      json: { permission: "write" },
    };
    const host: PolledReviewHost = await forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/collaborators/dana/permission",
        answer: () => {
          return answer;
        },
      },
    ]);

    expect(await host.getAuthorWriteAccess(details())).toBe(
      AuthorWriteAccess.CanWrite,
    );

    answer = { json: { permission: "read" } };

    expect(await host.getAuthorWriteAccess(details())).toBe(
      AuthorWriteAccess.CannotWrite,
    );

    answer = { status: 403, json: { message: "forbidden" } };

    expect(await host.getAuthorWriteAccess(details())).toBe(
      AuthorWriteAccess.NotSaid,
    );
  });

  test("lists what changed lately, newest first, as far as a few pages - never a cursor to go on from", async () => {
    const host: PolledReviewHost = await forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls",
        answer: () => {
          return {
            json: [
              {
                number: 3,
                state: "open",
                head: { ref: "b", sha: SHA, repo: { id: 5 } },
                base: { ref: "main", repo: { id: 5 } },
                user: { login: "dana" },
                updated_at: "2026-10-30T09:00:00Z",
              },
            ],
          };
        },
      },
    ]);

    const updated: UpdatedPullRequests = await host.listUpdatedPullRequests(
      new Date("2026-10-30T08:00:00Z"),
    );

    expect(updated.pullRequests).toHaveLength(1);
    expect(updated.continueFrom).toBeNull();
    expect(host.pullRequestTerm).toBe("pull request");
  });
});
