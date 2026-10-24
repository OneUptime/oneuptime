import PullRequestOpener from "../../Utils/PullRequestOpener";
import PushedBranches, { PushedBranch } from "../../Utils/PushedBranches";
import BackendAPI, { RepositoryToken } from "../../Utils/BackendAPI";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpRequest,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeTaskOutcomeReport } from "Common/Types/AI/CodeTask";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { CodeHostRunnerInfo } from "Common/Types/CodeRepository/CodeHost";

/*
 * Where a run's change goes, by the repository's host: a pull request on
 * GitHub, Forgejo and Gitea, a merge request on GitLab - opened with the
 * token in a header, never in an address - and, for a plain Git
 * repository, a pushed branch the run's outcome points to.
 */

function tokenFor(codeHost?: CodeHostRunnerInfo): RepositoryToken {
  return {
    token: "glpat-secret-token-0001",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    repositoryUrl: "https://git.example.com/acme/app.git",
    organizationName: "acme",
    repositoryName: "app",
    ...(codeHost ? { codeHost } : {}),
  };
}

const GITLAB: CodeHostRunnerInfo = {
  type: CodeRepositoryType.GitLab,
  hostUrl: "https://gitlab.example.com",
  apiUrl: "https://gitlab.example.com/api/v4",
  webUrl: "https://gitlab.example.com/acme/app",
  username: "alice",
  projectId: "4217",
  hasPullRequests: true,
};

const FORGEJO: CodeHostRunnerInfo = {
  type: CodeRepositoryType.Forgejo,
  hostUrl: "https://codeberg.org",
  apiUrl: "https://codeberg.org/api/v1",
  webUrl: "https://codeberg.org/acme/app",
  username: "alice",
  projectId: null,
  hasPullRequests: true,
};

const GIT: CodeHostRunnerInfo = {
  type: CodeRepositoryType.Git,
  hostUrl: "https://bitbucket.org",
  apiUrl: null,
  webUrl: "https://bitbucket.org/acme/app",
  username: "alice",
  projectId: null,
  hasPullRequests: false,
};

function answering(
  response: Partial<CodeHostHttpResponse>,
  seen: Array<CodeHostHttpRequest>,
): CodeHostTransport {
  return async (
    request: CodeHostHttpRequest,
  ): Promise<CodeHostHttpResponse> => {
    seen.push(request);

    return {
      statusCode: 201,
      bodyText: "",
      bodyJson: {},
      headers: {},
      ...response,
    };
  };
}

describe("opening the change's pull or merge request", () => {
  test("GitLab: a merge request on the project, by its id, the token in PRIVATE-TOKEN", async () => {
    const seen: Array<CodeHostHttpRequest> = [];
    const opener: PullRequestOpener = new PullRequestOpener(
      undefined,
      answering(
        {
          bodyJson: {
            id: 900001,
            iid: 12,
            web_url: "https://gitlab.example.com/acme/app/-/merge_requests/12",
            state: "opened",
            title: "Fix the checkout",
          },
        },
        seen,
      ),
    );

    const result: { number: number; htmlUrl: string; id: number } =
      await opener.open({
        token: tokenFor(GITLAB),
        baseBranch: "main",
        headBranch: "oneuptime/fix-12",
        title: "Fix the checkout",
        body: "What changed and why.",
      });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/4217/merge_requests",
    );
    expect(seen[0]!.headers["PRIVATE-TOKEN"]).toBe("glpat-secret-token-0001");
    expect(seen[0]!.url).not.toContain("glpat-secret-token-0001");
    expect(JSON.parse(seen[0]!.body as string)).toEqual({
      source_branch: "oneuptime/fix-12",
      target_branch: "main",
      title: "Fix the checkout",
      description: "What changed and why.",
      remove_source_branch: false,
    });

    // GitLab's number is its iid, what its pages show.
    expect(result.number).toBe(12);
    expect(result.id).toBe(900001);
    expect(result.htmlUrl).toBe(
      "https://gitlab.example.com/acme/app/-/merge_requests/12",
    );
  });

  test("GitLab without a project id addresses the project by its path", async () => {
    const seen: Array<CodeHostHttpRequest> = [];

    await new PullRequestOpener(
      undefined,
      answering({ bodyJson: { iid: 3 } }, seen),
    ).open({
      token: tokenFor({ ...GITLAB, projectId: null }),
      baseBranch: "main",
      headBranch: "fix",
      title: "t",
      body: "b",
    });

    expect(seen[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/acme%2Fapp/merge_requests",
    );
  });

  test("Forgejo and Gitea: a pull request, the token in Authorization", async () => {
    const seen: Array<CodeHostHttpRequest> = [];

    const result: { number: number; htmlUrl: string } =
      await new PullRequestOpener(
        undefined,
        answering(
          {
            bodyJson: {
              id: 77,
              number: 5,
              html_url: "https://codeberg.org/acme/app/pulls/5",
            },
          },
          seen,
        ),
      ).open({
        token: tokenFor(FORGEJO),
        baseBranch: "main",
        headBranch: "oneuptime/fix-5",
        title: "Fix",
        body: "Body",
      });

    expect(seen[0]!.url).toBe(
      "https://codeberg.org/api/v1/repos/acme/app/pulls",
    );
    expect(seen[0]!.headers["Authorization"]).toBe(
      "token glpat-secret-token-0001",
    );
    expect(JSON.parse(seen[0]!.body as string)).toEqual({
      head: "oneuptime/fix-5",
      base: "main",
      title: "Fix",
      body: "Body",
    });
    expect(result.number).toBe(5);
    expect(result.htmlUrl).toBe("https://codeberg.org/acme/app/pulls/5");
  });

  test("one already open for the branch says so, and a refusal never says the token", async () => {
    const conflict: CodeHostTransport =
      async (): Promise<CodeHostHttpResponse> => {
        return {
          statusCode: 409,
          bodyText: '{"message":"pull request already exists"}',
          bodyJson: { message: "pull request already exists" },
          headers: {},
        };
      };

    await expect(
      new PullRequestOpener(undefined, conflict).open({
        token: tokenFor(FORGEJO),
        baseBranch: "main",
        headBranch: "oneuptime/fix-5",
        title: "Fix",
        body: "Body",
      }),
    ).rejects.toThrow("one is already open for oneuptime/fix-5");

    const refused: CodeHostTransport =
      async (): Promise<CodeHostHttpResponse> => {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.Unauthorized,
          message: "refused glpat-secret-token-0001",
        });
      };

    let caught: Error | null = null;

    try {
      await new PullRequestOpener(undefined, refused).open({
        token: tokenFor(GITLAB),
        baseBranch: "main",
        headBranch: "fix",
        title: "t",
        body: "b",
      });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught?.message).toContain("Failed to open the merge request");
    expect(caught?.message).not.toContain("glpat-secret-token-0001");
  });

  test("a Git repository has no pull request API: nothing is called", async () => {
    const seen: Array<CodeHostHttpRequest> = [];

    expect(PullRequestOpener.hasPullRequests(tokenFor(GIT))).toBe(false);
    expect(PullRequestOpener.hasPullRequests(tokenFor(GITLAB))).toBe(true);
    // A GitHub token comes with no codeHost.
    expect(PullRequestOpener.hasPullRequests(tokenFor())).toBe(true);
    expect(PullRequestOpener.getPullRequestTerm(tokenFor(GITLAB))).toBe(
      "merge request",
    );
    expect(PullRequestOpener.getPullRequestTerm(tokenFor())).toBe(
      "pull request",
    );

    await expect(
      new PullRequestOpener(undefined, answering({}, seen)).open({
        token: tokenFor(GIT),
        baseBranch: "main",
        headBranch: "fix",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow("get a pushed branch, not a pull request");
    expect(seen).toHaveLength(0);
  });

  test("an answer with no number is not a pull request", () => {
    expect(() => {
      return PullRequestOpener.readResult({
        type: CodeRepositoryType.Forgejo,
        json: { html_url: "x" },
        webUrl: null,
        title: "t",
      });
    }).toThrow("said no number");

    // No page address in the answer: built from the repository's page.
    expect(
      PullRequestOpener.readResult({
        type: CodeRepositoryType.GitLab,
        json: { iid: 9 },
        webUrl: "https://gitlab.com/acme/app/",
        title: "t",
      }).htmlUrl,
    ).toBe("https://gitlab.com/acme/app/-/merge_requests/9");
  });
});

describe("a pushed branch, for a repository with no pull requests", () => {
  const branch: (codeHost: CodeHostRunnerInfo) => PushedBranch = (
    codeHost: CodeHostRunnerInfo,
  ): PushedBranch => {
    return PushedBranches.create({
      repositoryId: "repo-1",
      token: tokenFor(codeHost),
      branchName: "oneuptime/fix-7",
      baseBranchName: "main",
      summary: "Fixed the null check in the checkout.",
      changes: {
        isTruncated: false,
        files: [
          {
            path: "src/checkout.ts",
            status: "Modified" as never,
            additions: 2,
            deletions: 1,
            patch: "@@ -1 +1,2 @@",
          },
        ],
      },
    });
  };

  test("says where the branch is and links to where its pull request opens, on a known service", () => {
    const pushed: PushedBranch = branch(GIT);

    expect(pushed.repositoryName).toBe("acme/app");
    expect(pushed.branchUrl).toBe(
      "https://bitbucket.org/acme/app/branch/oneuptime/fix-7",
    );
    expect(pushed.newPullRequestUrl).toBe(
      "https://bitbucket.org/acme/app/pull-requests/new?source=oneuptime%2Ffix-7&dest=main",
    );
    expect(PushedBranches.describe(pushed)).toBe(
      "Pushed the branch `oneuptime/fix-7` to acme/app. [Open a pull request](https://bitbucket.org/acme/app/pull-requests/new?source=oneuptime%2Ffix-7&dest=main) from it into `main`.",
    );
  });

  test("on a server OneUptime does not know, says to open it there", () => {
    const pushed: PushedBranch = branch({ ...GIT, webUrl: null });

    expect(pushed.newPullRequestUrl).toBeNull();
    expect(PushedBranches.describe(pushed)).toContain(
      "Open a pull request from it into `main` on your Git server.",
    );
  });

  test("becomes the run's outcome: the agent's words, where each branch went, and the first one's diff", () => {
    const outcome: CodeTaskOutcomeReport | null = PushedBranches.toOutcome([
      branch(GIT),
      { ...branch(GIT), repositoryName: "acme/other", changes: null },
    ]);

    expect(outcome).not.toBeNull();
    expect(outcome!.needsInput).toBe(false);
    expect(outcome!.branchName).toBe("oneuptime/fix-7");
    expect(outcome!.pullRequestNumber).toBeUndefined();
    expect(outcome!.summary).toContain("Fixed the null check in the checkout.");
    expect(outcome!.summary).toContain("to acme/app.");
    expect(outcome!.summary).toContain("to acme/other.");
    expect(outcome!.filesChanged).toEqual([
      {
        path: "src/checkout.ts",
        status: "Modified",
        additions: 2,
        deletions: 1,
      },
    ]);
    expect(outcome!.changes?.files).toHaveLength(1);
    expect(PushedBranches.toOutcome([])).toBeNull();
  });
});

describe("what a token for a repository off GitHub comes with", () => {
  test("is read field by field, and a GitHub or unknown host reads as none", () => {
    expect(
      BackendAPI.readCodeHost({
        type: "Forgejo",
        hostUrl: "https://codeberg.org",
        apiUrl: "https://codeberg.org/api/v1",
        webUrl: "https://codeberg.org/acme/app",
        username: "alice",
        projectId: 5,
        hasPullRequests: true,
        isPrivateNetworkAllowed: true,
      }),
    ).toEqual({
      type: CodeRepositoryType.Forgejo,
      hostUrl: "https://codeberg.org",
      apiUrl: "https://codeberg.org/api/v1",
      webUrl: "https://codeberg.org/acme/app",
      username: "alice",
      // A number is not a project id the Runner trusts.
      projectId: null,
      hasPullRequests: true,
      isPrivateNetworkAllowed: true,
    });

    expect(
      BackendAPI.readCodeHost({ type: "GitHub", hostUrl: "x" }),
    ).toBeNull();
    expect(BackendAPI.readCodeHost({ type: "Svn", hostUrl: "x" })).toBeNull();
    expect(BackendAPI.readCodeHost({ type: "GitLab" })).toBeNull();
    expect(BackendAPI.readCodeHost(null)).toBeNull();
    expect(BackendAPI.readCodeHost(["GitLab"])).toBeNull();
  });

  test("only a server that says so lets a global Runner reach a private network, and Git signs in as oauth2 by default", () => {
    const read: CodeHostRunnerInfo | null = BackendAPI.readCodeHost({
      type: "GitLab",
      hostUrl: "https://gitlab.example.com",
      isPrivateNetworkAllowed: "true",
    });

    expect(read?.isPrivateNetworkAllowed).toBe(false);
    expect(read?.username).toBe("oauth2");
    expect(read?.hasPullRequests).toBe(false);
  });
});
