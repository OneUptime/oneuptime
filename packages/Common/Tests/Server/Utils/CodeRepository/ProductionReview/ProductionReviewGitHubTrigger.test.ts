import ProductionReviewGitHubTrigger, {
  ProductionReviewTriggerResult,
  REVIEWED_ACTIONS,
  isBotUser,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewGitHubTrigger";
import ProductionReviewQueue, {
  ProductionReviewRequest,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import GitHubCommandAuthorizer from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandAuthorizer";
import GitHubConversation, {
  GitHubRepositoryPermission,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import { ProductionReviewTrigger } from "../../../../../Types/CodeRepository/ProductionReview";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * When OneUptime reviews a pull request against production on its own: an
 * open, ready pull request that opened or changed, by a person (never a
 * bot), in a connected repository with Production Review on, whose AUTHOR
 * can write to the repository - and whoever pushed or reopened it too.
 * Anyone else's pull request - an outside contributor's, a fork's, someone
 * with read access - is never reviewed unasked, so an outsider can neither
 * spend the project's AI credits nor fish for what production says about
 * code of their choosing. Nothing is said in the thread either way.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "b2c3d4e5-1111-4222-8333-444455556666",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "b2c3d4e5-2222-4222-8333-444455556666",
);

function payload(
  change: {
    action?: string;
    draft?: boolean;
    state?: string;
    author?: JSONObject;
    sender?: JSONObject;
    headRepository?: string | null;
  } = {},
): JSONObject {
  return {
    action: change.action || "opened",
    repository: { full_name: "acme/checkout" },
    installation: { id: 4242 },
    sender: change.sender || { login: "octo-dev", type: "User" },
    pull_request: {
      number: 42,
      title: "fix: guard the card",
      state: change.state || "open",
      draft: change.draft === true,
      user: change.author || { login: "octo-dev", type: "User" },
      head: {
        sha: "0f1e2d3c",
        repo:
          change.headRepository === null
            ? null
            : { full_name: change.headRepository || "acme/checkout" },
      },
    },
  };
}

describe("ProductionReviewGitHubTrigger.onPullRequestChanged", () => {
  let repository: CodeRepository;
  let permissions: Record<string, GitHubRepositoryPermission>;
  let request: jest.SpyInstance;
  let resolve: jest.SpyInstance;
  let permission: jest.SpyInstance;

  beforeEach(() => {
    repository = new CodeRepository();
    repository.id = REPOSITORY_ID;
    repository.projectId = PROJECT_ID;
    repository.isProductionReviewEnabled = true;

    permissions = { "octo-dev": GitHubRepositoryPermission.Write };

    resolve = jest
      .spyOn(GitHubCommandAuthorizer, "resolveConnectedRepository")
      .mockImplementation(async () => {
        return repository;
      });
    permission = jest
      .spyOn(GitHubConversation, "getUserRepositoryPermission")
      .mockImplementation(async (data: { username: string }) => {
        return permissions[data.username] || GitHubRepositoryPermission.None;
      });
    request = jest
      .spyOn(ProductionReviewQueue, "request")
      .mockImplementation(async () => {
        const run: AIRun = new AIRun();
        run.id = new ObjectID("b2c3d4e5-3333-4222-8333-444455556666");
        return run;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(
    REVIEWED_ACTIONS.map((action: string) => {
      return [action];
    }),
  )(
    "a pull request %s by someone who can write is queued for review",
    async (action: string) => {
      const result: ProductionReviewTriggerResult =
        await ProductionReviewGitHubTrigger.onPullRequestChanged(
          payload({ action }),
        );

      expect(result.outcome).toBe("queued");
      expect(result.handled).toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  test("what it queues: the pull request, its head, who did it, OneUptime's own trigger, the author trusted", async () => {
    await ProductionReviewGitHubTrigger.onPullRequestChanged(payload());

    const asked: ProductionReviewRequest = request.mock
      .calls[0]![0] as ProductionReviewRequest;

    expect(asked).toEqual({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      pullRequestNumber: 42,
      pullRequestTitle: "fix: guard the card",
      headSha: "0f1e2d3c",
      isFromFork: false,
      trigger: ProductionReviewTrigger.PullRequestChanged,
      isAuthorTrusted: true,
      requestedByLogin: "octo-dev",
    });
  });

  test.each([
    ["closed"],
    ["edited"],
    ["labeled"],
    ["assigned"],
    ["review_requested"],
    ["converted_to_draft"],
  ])("a pull request %s asks for nothing", async (action: string) => {
    expect(
      (
        await ProductionReviewGitHubTrigger.onPullRequestChanged(
          payload({ action }),
        )
      ).outcome,
    ).toBe("action-not-reviewed");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("a draft waits until it is ready, without asking GitHub or the database", async () => {
    expect(
      (
        await ProductionReviewGitHubTrigger.onPullRequestChanged(
          payload({ draft: true }),
        )
      ).outcome,
    ).toBe("pull-request-draft");
    expect(resolve).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
  });

  test("a closed pull request is not reviewed", async () => {
    expect(
      (
        await ProductionReviewGitHubTrigger.onPullRequestChanged(
          payload({ action: "synchronize", state: "closed" }),
        )
      ).outcome,
    ).toBe("pull-request-not-open");
  });

  test.each([
    [{ login: "dependabot[bot]", type: "Bot" }, undefined],
    [{ login: "renovate", type: "Bot" }, undefined],
    [
      { login: "octo-dev", type: "User" },
      { login: "oneuptime[bot]", type: "Bot" },
    ],
  ])(
    "a bot's pull request, or a bot's push, is never reviewed",
    async (author: JSONObject, sender: JSONObject | undefined) => {
      expect(
        (
          await ProductionReviewGitHubTrigger.onPullRequestChanged(
            payload({ author, ...(sender ? { sender } : {}) }),
          )
        ).outcome,
      ).toBe("bot-or-unknown-author");
      expect(request).not.toHaveBeenCalled();
    },
  );

  test("a repository not connected to a project is not reviewed", async () => {
    resolve.mockResolvedValue(null);

    expect(
      (await ProductionReviewGitHubTrigger.onPullRequestChanged(payload()))
        .outcome,
    ).toBe("repository-not-connected");
  });

  test("a repository with Production Review off - or never set, as every repository connected before it - is not reviewed", async () => {
    repository.isProductionReviewEnabled = false;

    expect(
      (await ProductionReviewGitHubTrigger.onPullRequestChanged(payload()))
        .outcome,
    ).toBe("production-review-off");

    delete (repository as { isProductionReviewEnabled?: boolean })
      .isProductionReviewEnabled;

    expect(
      (await ProductionReviewGitHubTrigger.onPullRequestChanged(payload()))
        .outcome,
    ).toBe("production-review-off");
    expect(permission).not.toHaveBeenCalled();
  });

  test.each([
    [GitHubRepositoryPermission.None],
    [GitHubRepositoryPermission.Read],
    [GitHubRepositoryPermission.Triage],
  ])(
    "an author with %s permission - an outside contributor - is never reviewed unasked",
    async (level: GitHubRepositoryPermission) => {
      permissions = { stranger: level };

      expect(
        (
          await ProductionReviewGitHubTrigger.onPullRequestChanged(
            payload({
              author: { login: "stranger", type: "User" },
              sender: { login: "stranger", type: "User" },
              headRepository: "stranger/checkout",
            }),
          )
        ).outcome,
      ).toBe("author-cannot-write");
      expect(request).not.toHaveBeenCalled();
    },
  );

  test.each([
    [GitHubRepositoryPermission.Write],
    [GitHubRepositoryPermission.Maintain],
    [GitHubRepositoryPermission.Admin],
  ])(
    "an author with %s permission is reviewed",
    async (level: GitHubRepositoryPermission) => {
      permissions = { "octo-dev": level };

      expect(
        (await ProductionReviewGitHubTrigger.onPullRequestChanged(payload()))
          .outcome,
      ).toBe("queued");
    },
  );

  test("a push by someone who cannot write, to a trusted author's fork, is not reviewed", async () => {
    permissions = {
      "octo-dev": GitHubRepositoryPermission.Write,
      "fork-collaborator": GitHubRepositoryPermission.None,
    };

    expect(
      (
        await ProductionReviewGitHubTrigger.onPullRequestChanged(
          payload({
            action: "synchronize",
            sender: { login: "fork-collaborator", type: "User" },
            headRepository: "octo-dev/checkout",
          }),
        )
      ).outcome,
    ).toBe("sender-cannot-write");
  });

  test("a trusted author's pull request from their own fork is reviewed, and said to be from a fork", async () => {
    await ProductionReviewGitHubTrigger.onPullRequestChanged(
      payload({ headRepository: "octo-dev/checkout" }),
    );

    expect(
      (request.mock.calls[0]![0] as ProductionReviewRequest).isFromFork,
    ).toBe(true);
  });

  test("a permission GitHub cannot answer is no permission", async () => {
    permission.mockResolvedValue(GitHubRepositoryPermission.None);

    expect(
      (await ProductionReviewGitHubTrigger.onPullRequestChanged(payload()))
        .outcome,
    ).toBe("author-cannot-write");
  });

  test("a malformed payload asks for nothing", async () => {
    expect(
      (
        await ProductionReviewGitHubTrigger.onPullRequestChanged({
          action: "opened",
        })
      ).outcome,
    ).toBe("no-pull-request");

    expect(
      (
        await ProductionReviewGitHubTrigger.onPullRequestChanged({
          ...payload(),
          repository: { full_name: "no-slash" },
        })
      ).outcome,
    ).toBe("unresolvable-repository");
  });
});

describe("isBotUser", () => {
  test("GitHub's own word, or a [bot] login", () => {
    expect(isBotUser({ login: "x", type: "Bot" })).toBe(true);
    expect(isBotUser({ login: "github-actions[bot]", type: "User" })).toBe(
      true,
    );
    expect(isBotUser({ login: "octo-dev", type: "User" })).toBe(false);
    expect(isBotUser(undefined)).toBe(false);
  });
});
