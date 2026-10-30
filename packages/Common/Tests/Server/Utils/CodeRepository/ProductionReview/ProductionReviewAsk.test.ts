import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProductionReviewAsk, {
  PRODUCTION_REVIEW_NO_PULL_REQUESTS_MESSAGE,
  getPullRequestLabel,
  getPullRequestNotFoundMessage,
  getPullRequestNumberRefusedMessage,
  isPullRequestNotFound,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewAsk";
import ProductionReviewQueue, {
  ProductionReviewRequest,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import ProductionReviewGitHubTrigger from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewGitHubTrigger";
import {
  REPOSITORY_NOT_CONNECTED_MESSAGE,
  getRepositoryNotConnectedMessage,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import GitHubConversation, {
  GitHubPullRequestDetails,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import { ProductionReviewTrigger } from "../../../../../Types/CodeRepository/ProductionReview";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CONNECTED_PROJECT_ID,
  CONNECTED_REPOSITORY_ID,
  ConnectedRepository,
  connectRepository,
  disconnectRepository,
} from "../CodeHost/ConnectedRepository";
import { FakeRoute } from "../CodeHost/FakeCodeHost";

/*
 * Review a pull request, asked in Code by its number: any of a
 * repository's open pull (merge) requests - one from a fork, a bot or
 * anyone else too - on the host it is on, read from it now. One that is
 * not there, or closed, is said plainly in the host's words; a repository
 * no longer reached says so. Its next pushes are reviewed on their own
 * only when its author is trusted the way the host's own reviews trust one.
 */

const USER_ID: ObjectID = new ObjectID("a5c00000-0000-4000-8000-000000000009");
const SHA: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766";

let asked: Array<ProductionReviewRequest>;

beforeEach(() => {
  asked = [];
  jest.spyOn(ProductionReviewQueue, "request").mockImplementation((async (
    data: ProductionReviewRequest,
  ) => {
    asked.push(data);
    const run: AIRun = new AIRun();
    run.id = new ObjectID("a5c00000-0000-4000-8000-000000000001");
    return run;
  }) as never);
  jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
});

afterEach(() => {
  disconnectRepository();
});

describe("asking for a review of a GitHub pull request", () => {
  function gitHubRepository(): CodeRepository {
    const repository: CodeRepository = new CodeRepository();
    repository.id = CONNECTED_REPOSITORY_ID;
    repository.projectId = CONNECTED_PROJECT_ID;
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.organizationName = "acme";
    repository.repositoryName = "checkout";
    repository.gitHubAppInstallationId = "4242";
    return repository;
  }

  function details(
    change: Partial<GitHubPullRequestDetails> = {},
  ): GitHubPullRequestDetails {
    return {
      pullRequestNumber: 42,
      title: "fix: guard the card",
      body: "",
      state: "open",
      htmlUrl: "https://github.com/acme/checkout/pull/42",
      authorLogin: "outsider",
      headRefName: "patch-1",
      headSha: SHA,
      baseRefName: "main",
      headRepositoryFullName: "outsider/checkout",
      isDraft: false,
      isMerged: false,
      changedFilesCount: 1,
      additions: 1,
      deletions: 0,
      ...change,
    };
  }

  beforeEach(() => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("4242");
  });

  test("a fork's pull request is asked for now, as the person who asked - its pushes not reviewed on their own", async () => {
    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockResolvedValue(details());
    jest
      .spyOn(ProductionReviewGitHubTrigger, "canWrite")
      .mockResolvedValue(false);

    await ProductionReviewAsk.ask({
      projectId: CONNECTED_PROJECT_ID,
      repository: gitHubRepository(),
      pullRequestNumber: 42,
      requestedByUserId: USER_ID,
    });

    expect(asked).toEqual([
      {
        projectId: CONNECTED_PROJECT_ID,
        codeRepositoryId: CONNECTED_REPOSITORY_ID,
        installationId: "4242",
        organizationName: "acme",
        repositoryName: "checkout",
        pullRequestNumber: 42,
        pullRequestTitle: "fix: guard the card",
        headSha: SHA,
        isFromFork: true,
        trigger: ProductionReviewTrigger.OneUptime,
        isAuthorTrusted: false,
        requestedByUserId: USER_ID,
        isImmediate: true,
      },
    ]);
  });

  test("an author who can write is trusted; a bot never is, and GitHub is not asked", async () => {
    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockResolvedValue(details({ authorLogin: "dana" }));
    const canWrite: jest.SpiedFunction<
      typeof ProductionReviewGitHubTrigger.canWrite
    > = jest
      .spyOn(ProductionReviewGitHubTrigger, "canWrite")
      .mockResolvedValue(true);

    await ProductionReviewAsk.ask({
      projectId: CONNECTED_PROJECT_ID,
      repository: gitHubRepository(),
      pullRequestNumber: 42,
    });

    expect(asked[0]!.isAuthorTrusted).toBe(true);

    canWrite.mockClear();
    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockResolvedValue(details({ authorLogin: "dependabot[bot]" }));

    await ProductionReviewAsk.ask({
      projectId: CONNECTED_PROJECT_ID,
      repository: gitHubRepository(),
      pullRequestNumber: 42,
    });

    expect(asked[1]!.isAuthorTrusted).toBe(false);
    expect(canWrite).not.toHaveBeenCalled();
  });

  test("GitHub failing to say whether the author can write trusts nobody", async () => {
    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockResolvedValue(details({ authorLogin: "dana" }));
    jest
      .spyOn(ProductionReviewGitHubTrigger, "canWrite")
      .mockRejectedValue(new Error("GitHub answered 502"));

    await ProductionReviewAsk.ask({
      projectId: CONNECTED_PROJECT_ID,
      repository: gitHubRepository(),
      pullRequestNumber: 42,
    });

    expect(asked[0]!.isAuthorTrusted).toBe(false);
  });

  test("a pull request GitHub does not know, or a closed one, is said plainly - and nothing is asked", async () => {
    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockRejectedValue(new HTTPErrorResponse(404, { message: "x" }, {}));

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository(),
        pullRequestNumber: 404,
      }),
    ).rejects.toThrow("There is no pull request #404 in this repository.");

    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockResolvedValue(details({ state: "closed" }));

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository(),
        pullRequestNumber: 42,
      }),
    ).rejects.toThrow("The pull request is closed, so it was not reviewed.");
    expect(asked).toHaveLength(0);
  });

  test("a repository the project's installation no longer reaches is refused", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("9999");
    const read: jest.SpiedFunction<
      typeof GitHubConversation.getPullRequestDetails
    > = jest.spyOn(GitHubConversation, "getPullRequestDetails");

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository(),
        pullRequestNumber: 42,
      }),
    ).rejects.toThrow(REPOSITORY_NOT_CONNECTED_MESSAGE);
    expect(read).not.toHaveBeenCalled();
  });

  test("GitHub failing otherwise is thrown as it is", async () => {
    jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockRejectedValue(new HTTPErrorResponse(502, { message: "x" }, {}));

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: gitHubRepository(),
        pullRequestNumber: 42,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("asking for a review of a GitLab merge request, or a Forgejo pull request", () => {
  function gitLabRoutes(
    change: {
      mergeRequest?: Record<string, unknown>;
      accessLevel?: number;
    } = {},
  ): Array<FakeRoute> {
    return [
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12",
        answer: () => {
          return {
            json: {
              iid: 12,
              title: "fix: guard the card",
              state: "opened",
              web_url:
                "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
              author: { id: 77, username: "dana" },
              sha: SHA,
              source_branch: "fix/card",
              target_branch: "main",
              source_project_id: 4217,
              target_project_id: 4217,
              ...(change.mergeRequest || {}),
            },
          };
        },
      },
      {
        method: "GET",
        path: "/projects/4217/members/all/77",
        answer: () => {
          return {
            json: { access_level: change.accessLevel ?? 30, state: "active" },
          };
        },
      },
    ];
  }

  test("a merge request is read from GitLab now and asked for, its page and host named", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes(),
    });

    const run: AIRun = await ProductionReviewAsk.ask({
      projectId: CONNECTED_PROJECT_ID,
      repository: connected.repository,
      pullRequestNumber: 12,
      requestedByUserId: USER_ID,
    });

    expect(run.id?.toString()).toBe("a5c00000-0000-4000-8000-000000000001");
    expect(asked).toEqual([
      {
        projectId: CONNECTED_PROJECT_ID,
        codeRepositoryId: CONNECTED_REPOSITORY_ID,
        provider: CodeRepositoryType.GitLab,
        pullRequestNumber: 12,
        pullRequestTitle: "fix: guard the card",
        pullRequestUrl:
          "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
        headSha: SHA,
        isFromFork: false,
        trigger: ProductionReviewTrigger.OneUptime,
        isAuthorTrusted: true,
        requestedByUserId: USER_ID,
        isImmediate: true,
      },
    ]);
  });

  test.each([
    ["from a fork", { mergeRequest: { source_project_id: 99 } }],
    [
      "by a bot",
      { mergeRequest: { author: { id: 77, username: "renovate-bot" } } },
    ],
    ["by someone who cannot push", { accessLevel: 20 }],
  ] as Array<
    [string, { mergeRequest?: Record<string, unknown>; accessLevel?: number }]
  >)(
    "a merge request %s is reviewed when asked, its pushes not on their own",
    async (
      _what: string,
      change: { mergeRequest?: Record<string, unknown>; accessLevel?: number },
    ) => {
      const connected: ConnectedRepository = connectRepository({
        provider: CodeRepositoryType.GitLab,
        routes: gitLabRoutes(change),
      });

      await ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: connected.repository,
        pullRequestNumber: 12,
      });

      expect(asked[0]!.isAuthorTrusted).toBe(false);
    },
  );

  test("a merge request GitLab does not know, or a closed one, is said in GitLab's words", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes({ mergeRequest: { state: "merged" } }),
    });

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: connected.repository,
        pullRequestNumber: 404,
      }),
    ).rejects.toThrow("There is no merge request !404 in this repository.");

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: connected.repository,
        pullRequestNumber: 12,
      }),
    ).rejects.toThrow("The merge request is closed, so it was not reviewed.");
    expect(asked).toHaveLength(0);
  });

  test("a connection that does not work is refused, naming its host", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Forgejo,
      routes: [],
      connection: { credentials: "" },
    });

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository: connected.repository,
        pullRequestNumber: 12,
      }),
    ).rejects.toThrow(
      getRepositoryNotConnectedMessage(CodeRepositoryType.Forgejo),
    );
  });

  test("a Git server has no pull requests to review", async () => {
    const repository: CodeRepository = new CodeRepository();
    repository.id = CONNECTED_REPOSITORY_ID;
    repository.repositoryHostedAt = CodeRepositoryType.Git;

    await expect(
      ProductionReviewAsk.ask({
        projectId: CONNECTED_PROJECT_ID,
        repository,
        pullRequestNumber: 12,
      }),
    ).rejects.toThrow(PRODUCTION_REVIEW_NO_PULL_REQUESTS_MESSAGE);
  });
});

describe("a pull request's number and name, in the host's words", () => {
  test("GitLab writes !12; GitHub, Forgejo and Gitea #12", () => {
    expect(getPullRequestLabel(CodeRepositoryType.GitLab, 12)).toBe("!12");
    expect(getPullRequestLabel(CodeRepositoryType.GitHub, 12)).toBe("#12");
    expect(getPullRequestLabel(CodeRepositoryType.Forgejo, 12)).toBe("#12");
    expect(getPullRequestLabel(undefined, 3)).toBe("#3");
  });

  test("what a number that is none says", () => {
    expect(getPullRequestNumberRefusedMessage(CodeRepositoryType.GitLab)).toBe(
      "Enter the number of a merge request, such as !12.",
    );
    expect(getPullRequestNumberRefusedMessage(CodeRepositoryType.Forgejo)).toBe(
      "Enter the number of a pull request, such as #12.",
    );
    expect(getPullRequestNotFoundMessage(CodeRepositoryType.GitHub, 9)).toBe(
      "There is no pull request #9 in this repository.",
    );
  });

  test("a host's answer that there is no such pull request, from any host's client", () => {
    expect(
      isPullRequestNotFound(
        new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.NotFound,
          message: "x",
        }),
      ),
    ).toBe(true);
    expect(
      isPullRequestNotFound(
        new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.Forbidden,
          message: "x",
        }),
      ),
    ).toBe(false);
    expect(isPullRequestNotFound(new HTTPErrorResponse(404, {}, {}))).toBe(
      true,
    );
    expect(isPullRequestNotFound(new HTTPErrorResponse(500, {}, {}))).toBe(
      false,
    );
    expect(isPullRequestNotFound(new BadDataException("x"))).toBe(false);
  });
});
