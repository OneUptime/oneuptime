import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CodeHostWriters, {
  CodeHostWriter,
  CodeHostWriterGap,
  CodeHostWriterResult,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostWriter";
import { CodeHostHttpErrorKind } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import {
  CodeHostCommitMade,
  CodeHostOpenedPullRequest,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import OneUptimeDate from "../../../../../Types/Date";
import {
  CONNECTED_PROJECT_ID,
  CONNECTED_REPOSITORY_ID,
  CONNECTED_TOKEN,
  ConnectedRepository,
  connectRepository,
  disconnectRepository,
} from "./ConnectedRepository";
import { FakeRoute } from "./FakeCodeHost";

/*
 * Where chat's code writes go: a GitHub repository through the App's
 * installation its project is bound to, a GitLab or Forgejo one through
 * its connection - its row and its connection read the real way, the
 * host's API answering as it does - and a Git server, or a repository no
 * longer reached, through nothing, with why.
 */

const SHA: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";

afterEach(() => {
  disconnectRepository();
});

async function openConnected(): Promise<CodeHostWriter> {
  const opened: CodeHostWriterResult = await CodeHostWriters.openForRepository({
    projectId: CONNECTED_PROJECT_ID,
    repositoryId: CONNECTED_REPOSITORY_ID,
  });

  expect(opened.gap).toBeNull();

  return opened.writer!;
}

describe("a GitLab project's writer", () => {
  const routes: Array<FakeRoute> = [
    {
      method: "GET",
      path: "/projects/4217",
      answer: () => {
        return {
          json: {
            id: 4217,
            path: "checkout",
            path_with_namespace: "acme/checkout",
            default_branch: "trunk",
          },
        };
      },
    },
    {
      method: "GET",
      path: "/projects/4217/repository/branches/release",
      answer: () => {
        return {
          json: { name: "release", protected: true, commit: { id: SHA } },
        };
      },
    },
    {
      method: "GET",
      path: "/projects/4217/repository/branches/oneuptime-ai%2Fx",
      answer: () => {
        return { status: 404, json: { message: "404 Branch Not Found" } };
      },
    },
    {
      method: "POST",
      path: "/projects/4217/repository/branches",
      answer: () => {
        return { status: 201, json: { name: "oneuptime-ai/x" } };
      },
    },
    {
      method: "GET",
      path: "/projects/4217/repository/files/a.ts",
      answer: () => {
        return { status: 404, json: { message: "404 File Not Found" } };
      },
    },
    {
      method: "POST",
      path: "/projects/4217/repository/commits",
      answer: () => {
        return {
          status: 201,
          json: {
            id: SHA,
            web_url: `https://gitlab.example.com/acme/checkout/-/commit/${SHA}`,
          },
        };
      },
    },
    {
      method: "POST",
      path: "/projects/4217/merge_requests",
      answer: () => {
        // A GitLab that says no page for it: the writer builds it.
        return { status: 201, json: { id: 90231, iid: 12, state: "opened" } };
      },
    },
  ];

  test("reads the default branch and a branch's protection from GitLab, with the connection's token", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes,
    });
    const writer: CodeHostWriter = await openConnected();

    expect(writer.provider).toBe(CodeRepositoryType.GitLab);
    expect(writer.pullRequestTerm).toBe("merge request");
    expect(await writer.getDefaultBranchName()).toBe("trunk");
    expect(await writer.getBranch("release")).toEqual({
      name: "release",
      headSha: SHA,
      isProtected: true,
    });
    expect(connected.host.requests[0]!.headers["PRIVATE-TOKEN"]).toBe(
      CONNECTED_TOKEN,
    );
    // Every answer clears a refusal the connection had.
    expect(connected.accepted()).toBe(2);
  });

  test("makes the branch, the commit and the merge request - its page built when GitLab says none", async () => {
    connectRepository({ provider: CodeRepositoryType.GitLab, routes });
    const writer: CodeHostWriter = await openConnected();

    expect(
      await writer.createBranch({
        branchName: "oneuptime-ai/x",
        fromBranchName: "trunk",
      }),
    ).toBe(true);

    const made: CodeHostCommitMade = await writer.commitFiles({
      branchName: "oneuptime-ai/x",
      commitMessage: "fix",
      files: [{ filePath: "a.ts", content: "x" }],
    });

    expect(made.commitSha).toBe(SHA);

    const opened: CodeHostOpenedPullRequest = await writer.openPullRequest({
      baseBranchName: "trunk",
      headBranchName: "oneuptime-ai/x",
      title: "Fix",
      body: "Why.",
    });

    expect(opened).toEqual({
      id: 90231,
      number: 12,
      htmlUrl: "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
      state: PullRequestState.Open,
    });
  });

  test("a token GitLab refuses marks the connection refused, and the write fails", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [
        {
          method: "GET",
          path: "/projects/4217",
          answer: () => {
            return { status: 401, json: { message: "401 Unauthorized" } };
          },
        },
      ],
    });
    const writer: CodeHostWriter = await openConnected();

    await expect(writer.getDefaultBranchName()).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.Unauthorized,
    });
    expect(connected.refused()).toBe(1);
  });
});

describe("a Forgejo or Gitea repository's writer", () => {
  test("writes through its API, building the pull request's page when the server says none", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Forgejo,
      routes: [
        {
          method: "GET",
          path: "/repos/acme/checkout",
          answer: () => {
            return {
              json: {
                id: 5,
                name: "checkout",
                full_name: "acme/checkout",
                owner: { login: "acme" },
                default_branch: "main",
                permissions: { push: true },
              },
            };
          },
        },
        {
          method: "GET",
          path: "/repos/acme/checkout/branches/feature",
          answer: () => {
            return {
              json: { name: "feature", protected: false, commit: { id: SHA } },
            };
          },
        },
        {
          method: "POST",
          path: "/repos/acme/checkout/branches",
          answer: () => {
            return { status: 409, json: { message: "exists" } };
          },
        },
        {
          method: "GET",
          path: "/repos/acme/checkout/contents/a.ts",
          answer: () => {
            return { json: { type: "file", sha: "abc" } };
          },
        },
        {
          method: "POST",
          path: "/repos/acme/checkout/contents",
          answer: () => {
            return { status: 201, json: { commit: { sha: SHA } } };
          },
        },
        {
          method: "POST",
          path: "/repos/acme/checkout/pulls",
          answer: () => {
            return { status: 201, json: { id: 4, number: 7, state: "open" } };
          },
        },
      ],
    });
    const writer: CodeHostWriter = await openConnected();

    expect(writer.provider).toBe(CodeRepositoryType.Forgejo);
    expect(writer.pullRequestTerm).toBe("pull request");
    expect(await writer.getDefaultBranchName()).toBe("main");
    expect((await writer.getBranch("feature"))?.isProtected).toBe(false);
    expect(
      await writer.createBranch({
        branchName: "feature",
        fromBranchName: "main",
      }),
    ).toBe(false);
    expect(
      (
        await writer.commitFiles({
          branchName: "feature",
          commitMessage: "m",
          files: [{ filePath: "a.ts", content: "y" }],
        })
      ).commitSha,
    ).toBe(SHA);
    expect(
      (
        await writer.openPullRequest({
          baseBranchName: "main",
          headBranchName: "feature",
          title: "t",
          body: "b",
        })
      ).htmlUrl,
    ).toBe("https://git.example.com/acme/checkout/pulls/7");
    expect(connected.host.requests[0]!.headers["Authorization"]).toBe(
      `token ${CONNECTED_TOKEN}`,
    );
  });
});

describe("a repository no writer reaches", () => {
  test("a Git server has no API to write through", async () => {
    const repository: CodeRepository = new CodeRepository();
    repository._id = CONNECTED_REPOSITORY_ID.toString();
    repository.projectId = CONNECTED_PROJECT_ID;
    repository.repositoryHostedAt = CodeRepositoryType.Git;

    expect(await CodeHostWriters.open(repository)).toEqual({
      writer: null,
      gap: CodeHostWriterGap.NoApi,
    });
  });

  test("a connection whose token was refused, one of another project, or none, is not reached", async () => {
    for (const connection of [
      { refusedAt: OneUptimeDate.getCurrentDate() },
      { projectId: CONNECTED_REPOSITORY_ID },
      { credentials: "" },
      { provider: CodeRepositoryType.Forgejo },
    ]) {
      connectRepository({
        provider: CodeRepositoryType.GitLab,
        routes: [],
        connection,
      });

      expect(
        await CodeHostWriters.openForRepository({
          projectId: CONNECTED_PROJECT_ID,
          repositoryId: CONNECTED_REPOSITORY_ID,
        }),
      ).toEqual({ writer: null, gap: CodeHostWriterGap.NotReached });

      disconnectRepository();
    }
  });

  test("a repository not in the project is not reached", async () => {
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue(null);

    expect(
      await CodeHostWriters.openForRepository({
        projectId: CONNECTED_PROJECT_ID,
        repositoryId: CONNECTED_REPOSITORY_ID,
      }),
    ).toEqual({ writer: null, gap: CodeHostWriterGap.NotReached });
  });
});

describe("a GitHub repository's writer", () => {
  function gitHubRepository(installationId: string): CodeRepository {
    const repository: CodeRepository = new CodeRepository();
    repository._id = CONNECTED_REPOSITORY_ID.toString();
    repository.projectId = CONNECTED_PROJECT_ID;
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.organizationName = "acme";
    repository.repositoryName = "checkout";
    repository.gitHubAppInstallationId = installationId;
    return repository;
  }

  test("only through the installation the project is bound to", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("4242");

    expect((await CodeHostWriters.open(gitHubRepository("9999"))).gap).toBe(
      CodeHostWriterGap.NotReached,
    );
    expect(
      (await CodeHostWriters.open(gitHubRepository("4242"))).writer?.provider,
    ).toBe(CodeRepositoryType.GitHub);
  });

  test("writes through the GitHub App, as chat always did", async () => {
    const writer: CodeHostWriter = CodeHostWriters.gitHub({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
    });
    const commit: jest.SpiedFunction<typeof GitHubUtil.commitFilesToBranch> =
      jest.spyOn(GitHubUtil, "commitFilesToBranch").mockResolvedValue({
        commitSha: SHA,
        branchName: "feature",
        htmlUrl: `https://github.com/acme/checkout/commit/${SHA}`,
      });
    const open: jest.SpiedFunction<
      typeof GitHubUtil.createPullRequestWithToken
    > = jest.spyOn(GitHubUtil, "createPullRequestWithToken").mockResolvedValue({
      pullRequestId: 900,
      pullRequestNumber: 42,
      state: PullRequestState.Open,
    } as never);
    const branch: jest.SpiedFunction<typeof GitHubUtil.createBranch> = jest
      .spyOn(GitHubUtil, "createBranch")
      .mockResolvedValue(true);

    expect(
      await writer.createBranch({ branchName: "f", fromBranchName: "main" }),
    ).toBe(true);
    expect(branch).toHaveBeenCalledWith({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      newBranchName: "f",
      fromBranchName: "main",
    });

    expect(
      await writer.commitFiles({
        branchName: "feature",
        commitMessage: "m",
        files: [{ filePath: "a.ts", content: "x" }],
      }),
    ).toEqual({
      commitSha: SHA,
      htmlUrl: `https://github.com/acme/checkout/commit/${SHA}`,
    });
    expect(commit.mock.calls[0]![0].changes).toEqual([
      { filePath: "a.ts", content: "x" },
    ]);

    expect(
      await writer.openPullRequest({
        baseBranchName: "main",
        headBranchName: "feature",
        title: "t",
        body: "b",
      }),
    ).toEqual({
      id: 900,
      number: 42,
      htmlUrl: "https://github.com/acme/checkout/pull/42",
      state: PullRequestState.Open,
    });
    // Ready for review, never a draft.
    expect(open.mock.calls[0]![0].isDraft).toBe(false);
  });
});
