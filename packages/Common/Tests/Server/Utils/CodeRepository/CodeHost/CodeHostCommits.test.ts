import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CodeHostCommits, {
  CodeHostCommitReader,
  RepositoryAddress,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostCommits";
import {
  CodeHostCommitRange,
  CodeHostPullRequestSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubCommits from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommits";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CONNECTED_PROJECT_ID,
  CONNECTED_REPOSITORY_ID,
  connectRepository,
  disconnectRepository,
} from "./ConnectedRepository";

/*
 * Where a deploy's commits are read from, and which repository a deploy's
 * address names: GitHub through the App's installation (one token for the
 * change's reads), GitLab and Forgejo through the repository's connection,
 * and a Git server - which has no API for commits - through nothing.
 */

const BASE: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const HEAD: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";

afterEach(() => {
  disconnectRepository();
});

describe("CodeHostCommits.parseRepositoryAddress", () => {
  test.each([
    ["https://github.com/acme/checkout", "github.com", "acme/checkout"],
    ["https://www.github.com/acme/checkout.git", "github.com", "acme/checkout"],
    ["git@github.com:acme/checkout.git", "github.com", "acme/checkout"],
    ["ssh://git@github.com/acme/checkout", "github.com", "acme/checkout"],
    ["acme/checkout", null, "acme/checkout"],
    [
      "https://gitlab.example.com/acme/backend/checkout",
      "gitlab.example.com",
      "acme/backend/checkout",
    ],
    [
      "https://gitlab.example.com/acme/backend/checkout.git/",
      "gitlab.example.com",
      "acme/backend/checkout",
    ],
    [
      "git@gitlab.example.com:acme/backend/checkout.git",
      "gitlab.example.com",
      "acme/backend/checkout",
    ],
    [
      "ssh://git@codeberg.org:2222/acme/checkout.git",
      "codeberg.org",
      "acme/checkout",
    ],
    ["  https://CODEBERG.org/Acme/Checkout  ", "codeberg.org", "Acme/Checkout"],
  ] as Array<[string, string | null, string]>)(
    "%j is %s %s",
    (value: string, host: string | null, path: string) => {
      expect(CodeHostCommits.parseRepositoryAddress(value)).toEqual({
        host,
        path,
      });
    },
  );

  test.each([
    [""],
    [null],
    ["checkout"],
    ["https://gitlab.example.com/checkout"],
    ["https://gitlab.example.com/"],
    ["not a url at all"],
    ["git@gitlab.example.com"],
    ["@:x/y"],
    ["https://gitlab.example.com/acme/.git"],
    [`https://gitlab.example.com/${"a".repeat(2000)}/x`],
  ] as Array<[string | null]>)(
    "%j names no repository",
    (value: string | null) => {
      expect(CodeHostCommits.parseRepositoryAddress(value)).toBeNull();
    },
  );
});

describe("CodeHostCommits: the same repository, wherever an address is written", () => {
  function address(value: string): RepositoryAddress {
    return CodeHostCommits.parseRepositoryAddress(value)!;
  }

  test("the same path in any case, on the same server when both say", () => {
    expect(
      CodeHostCommits.isSameRepository(
        address("https://gitlab.example.com/acme/x.git"),
        address("git@gitlab.example.com:ACME/X.git"),
      ),
    ).toBe(true);
    expect(
      CodeHostCommits.isSameRepository(
        address("https://gitlab.example.com/acme/x"),
        address("https://gitlab.example.com/acme/y"),
      ),
    ).toBe(false);
    expect(
      CodeHostCommits.isSameRepository(
        address("https://gitlab.example.com/acme/x"),
        address("https://codeberg.org/acme/x"),
      ),
    ).toBe(false);
    expect(
      CodeHostCommits.isSameRepository(
        address("acme/x"),
        address("https://codeberg.org/acme/x"),
      ),
    ).toBe(true);
  });

  function repository(
    type: CodeRepositoryType,
    organizationName: string = "acme",
  ): CodeRepository {
    const made: CodeRepository = new CodeRepository();
    made.repositoryHostedAt = type;
    made.organizationName = organizationName;
    made.repositoryName = "checkout";
    return made;
  }

  test("a github.com address is a GitHub repository's only; any other host's is any other's", () => {
    const gitHub: CodeRepository = repository(CodeRepositoryType.GitHub);
    const gitLab: CodeRepository = repository(
      CodeRepositoryType.GitLab,
      "acme/backend",
    );
    const forgejo: CodeRepository = repository(CodeRepositoryType.Forgejo);

    expect(
      CodeHostCommits.isRepositoryAt(
        gitHub,
        address("https://github.com/acme/checkout"),
      ),
    ).toBe(true);
    expect(
      CodeHostCommits.isRepositoryAt(
        forgejo,
        address("https://github.com/acme/checkout"),
      ),
    ).toBe(false);
    expect(
      CodeHostCommits.isRepositoryAt(
        gitHub,
        address("https://codeberg.org/acme/checkout"),
      ),
    ).toBe(false);
    expect(
      CodeHostCommits.isRepositoryAt(
        forgejo,
        address("https://codeberg.org/acme/checkout"),
      ),
    ).toBe(true);
    expect(
      CodeHostCommits.isRepositoryAt(
        gitLab,
        address("git@gitlab.example.com:acme/backend/checkout.git"),
      ),
    ).toBe(true);
    expect(
      CodeHostCommits.isRepositoryAt(
        gitLab,
        address("https://gitlab.example.com/acme/checkout"),
      ),
    ).toBe(false);
    // A bare owner/name says no server: any host's repository of that path.
    expect(
      CodeHostCommits.isRepositoryAt(forgejo, address("acme/checkout")),
    ).toBe(true);
    expect(
      CodeHostCommits.isRepositoryAt(gitHub, address("ACME/Checkout")),
    ).toBe(true);
  });
});

describe("CodeHostCommits: a GitHub repository's commits", () => {
  test("one installation token, minted at the first read, reads every commit of the change", async () => {
    const mint: SpyInstance<typeof GitHubUtil.getInstallationAccessToken> = jest
      .spyOn(GitHubUtil, "getInstallationAccessToken")
      .mockResolvedValue({ token: "tok", expiresAt: new Date() });
    const compare: SpyInstance<typeof GitHubCommits.compare> = jest
      .spyOn(GitHubCommits, "compare")
      .mockResolvedValue({
        status: "ahead",
        totalCommits: 0,
        commits: [],
        files: [],
        isTruncated: false,
      });
    jest
      .spyOn(GitHubCommits, "listPullRequestsForCommit")
      .mockResolvedValue([]);

    const reader: CodeHostCommitReader = CodeHostCommits.gitHub({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
    });

    expect(mint).not.toHaveBeenCalled();

    await reader.compare({ base: BASE, head: HEAD });
    await reader.listPullRequestsForCommit(HEAD);

    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith("4242", {
      permissions: {
        contents: "read",
        pull_requests: "read",
        metadata: "read",
      },
    });
    expect(compare).toHaveBeenCalledWith({
      token: "tok",
      owner: "acme",
      repository: "checkout",
      base: BASE,
      head: HEAD,
    });
    expect(reader.pullRequestTerm).toBe("pull request");
  });
});

describe("CodeHostCommits: a GitLab or Forgejo repository's commits, through its connection", () => {
  test("GitLab: the compare, and the merge requests of a commit", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [
        {
          method: "GET",
          path: "/projects/4217/repository/compare",
          answer: () => {
            return {
              json: {
                commits: [
                  {
                    id: HEAD,
                    message: "fix\n\nSee merge request acme/checkout!12",
                    author_name: "Dana",
                  },
                ],
                diffs: [],
              },
            };
          },
        },
        {
          method: "GET",
          path: `/projects/4217/repository/commits/${HEAD}/merge_requests`,
          answer: () => {
            return { json: [{ iid: 12, title: "Fix", web_url: "u" }] };
          },
        },
      ],
    });

    const reader: CodeHostCommitReader | null =
      await CodeHostCommits.openForRepository({
        projectId: CONNECTED_PROJECT_ID,
        repositoryId: CONNECTED_REPOSITORY_ID,
      });

    expect(reader?.provider).toBe(CodeRepositoryType.GitLab);
    expect(reader?.pullRequestTerm).toBe("merge request");

    const range: CodeHostCommitRange = await reader!.compare({
      base: BASE,
      head: HEAD,
    });

    expect(range.commits[0]!.pullRequestNumbers).toEqual([12]);

    const mergeRequests: Array<CodeHostPullRequestSummary> =
      await reader!.listPullRequestsForCommit(HEAD);

    expect(mergeRequests).toEqual([{ number: 12, title: "Fix", url: "u" }]);
  });

  test("Forgejo: one commit, and the pull request a merge commit came from", async () => {
    connectRepository({
      provider: CodeRepositoryType.Forgejo,
      routes: [
        {
          method: "GET",
          path: `/repos/acme/checkout/git/commits/${HEAD}`,
          answer: () => {
            return {
              json: {
                sha: HEAD,
                commit: { message: "Merge pull request 'x' (#7)", author: {} },
                files: [{ filename: "a.ts", status: "added" }],
              },
            };
          },
        },
        {
          method: "GET",
          path: `/repos/acme/checkout/commits/${HEAD}/pull`,
          answer: () => {
            return { status: 404, json: { message: "not found" } };
          },
        },
      ],
    });

    const reader: CodeHostCommitReader | null =
      await CodeHostCommits.openForRepository({
        projectId: CONNECTED_PROJECT_ID,
        repositoryId: CONNECTED_REPOSITORY_ID,
      });

    const read: Awaited<ReturnType<CodeHostCommitReader["getCommit"]>> =
      await reader!.getCommit(HEAD);

    expect(read.commit.pullRequestNumbers).toEqual([7]);
    expect(read.files).toEqual([{ path: "a.ts", status: "added" }]);
    expect(await reader!.listPullRequestsForCommit(HEAD)).toEqual([]);
  });

  test("a repository whose connection does not work, or on GitHub or a Git server, has no reader here", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [],
      connection: { credentials: "" },
    });

    expect(
      await CodeHostCommits.openForRepository({
        projectId: CONNECTED_PROJECT_ID,
        repositoryId: CONNECTED_REPOSITORY_ID,
      }),
    ).toBeNull();

    disconnectRepository();

    for (const type of [CodeRepositoryType.GitHub, CodeRepositoryType.Git]) {
      connectRepository({
        provider: CodeRepositoryType.GitLab,
        routes: [],
        repository: { repositoryHostedAt: type },
      });

      expect(
        await CodeHostCommits.openForRepository({
          projectId: CONNECTED_PROJECT_ID,
          repositoryId: CONNECTED_REPOSITORY_ID,
        }),
      ).toBeNull();

      disconnectRepository();
    }
  });
});
