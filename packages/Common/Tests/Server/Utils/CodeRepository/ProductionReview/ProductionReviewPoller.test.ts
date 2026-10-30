import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ProductionReviewPoller, {
  AUTHOR_TRUST_CACHE_SECONDS,
  POLL_FIRST_LOOKBACK_SECONDS,
  POLL_MAX_LOOKBACK_SECONDS,
  POLL_OVERLAP_SECONDS,
  POLLED_HOSTS,
  POLLED_REPOSITORIES_PER_TICK,
  ProductionReviewPollOutcome,
  ProductionReviewPollResult,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewPoller";
import ProductionReviewHosts, {
  AuthorWriteAccess,
  PolledReviewHost,
  UpdatedPullRequests,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewHost";
import ProductionReviewQueue, {
  CodeHostProductionReviewRequest,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import { CodeHostPullRequestDetails } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import { ProductionReviewTrigger } from "../../../../../Types/CodeRepository/ProductionReview";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * GitLab, Forgejo and Gitea send OneUptime no webhooks, so every minute
 * each repository on them with Production Review on is read for the pull
 * requests that changed since its last read - and a review is asked for
 * each whose head is new, under GitHub's rules, cheapest first: open, not a
 * draft, not OneUptime's own, not a bot's, not a fork's (or AGit's), a new
 * head, and an author the host does not say cannot write. Where a
 * repository's read got to is kept in the cache; a cache that is down
 * reads a little back, and never stops the poll.
 */

const NOW: Date = new Date("2026-10-30T10:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "d0110000-0000-4000-8000-000000000001",
);
const SHA: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766";

let kept: Map<string, string>;
let asked: Array<CodeHostProductionReviewRequest>;
let earlierTask: AIRun | null;

function repository(index: number = 1): CodeRepository {
  const made: CodeRepository = new CodeRepository();
  made.id = new ObjectID(
    `d0110000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  made.projectId = PROJECT_ID;
  made.repositoryHostedAt = CodeRepositoryType.GitLab;
  made.isProductionReviewEnabled = true;
  return made;
}

function pullRequest(
  change: Partial<CodeHostPullRequestDetails> = {},
): CodeHostPullRequestDetails {
  return {
    number: 12,
    title: "fix: guard the card",
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
    updatedAt: "2026-10-30T09:59:00.000Z",
    ...change,
  };
}

interface FakeHost extends PolledReviewHost {
  writeAccessAsked: number;
  listedFrom: Array<Date>;
}

function fakeHost(
  change: {
    pullRequests?: Array<CodeHostPullRequestDetails>;
    continueFrom?: Date | null;
    writeAccess?: AuthorWriteAccess | Error;
    isOwn?: boolean;
    listFails?: boolean;
  } = {},
): FakeHost {
  const host: FakeHost = {
    provider: CodeRepositoryType.GitLab,
    pullRequestTerm: "merge request",
    writeAccessAsked: 0,
    listedFrom: [],
    getPullRequest: async (): Promise<CodeHostPullRequestDetails> => {
      return pullRequest();
    },
    listFiles: async () => {
      return { files: [], hasMore: false };
    },
    isRepositoryPublic: async (): Promise<boolean | null> => {
      return false;
    },
    writeComment: async () => {
      return { commentId: 1, htmlUrl: "" };
    },
    getReviewCommand: async (): Promise<string | null> => {
      return null;
    },
    listUpdatedPullRequests: async (
      updatedAfter: Date,
    ): Promise<UpdatedPullRequests> => {
      host.listedFrom.push(updatedAfter);

      if (change.listFails) {
        throw new Error("GitLab answered 502");
      }

      return {
        pullRequests: change.pullRequests || [pullRequest()],
        continueFrom: change.continueFrom || null,
      };
    },
    getAuthorWriteAccess: async (): Promise<AuthorWriteAccess> => {
      host.writeAccessAsked++;

      if (change.writeAccess instanceof Error) {
        throw change.writeAccess;
      }

      return change.writeAccess || AuthorWriteAccess.CanWrite;
    },
    isOwnPullRequest: (): boolean => {
      return Boolean(change.isOwn);
    },
  };

  return host;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });

  kept = new Map();
  asked = [];
  earlierTask = null;

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return kept.get(`${namespace}:${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        kept.set(`${namespace}:${key}`, value);
      },
    );
  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(async (namespace: string, keys: Array<string>) => {
      return keys.map((key: string) => {
        return kept.get(`${namespace}:${key}`) || null;
      });
    });

  jest.spyOn(ProductionReviewQueue, "findTask").mockImplementation(async () => {
    return earlierTask;
  });
  jest.spyOn(ProductionReviewQueue, "request").mockImplementation((async (
    data: CodeHostProductionReviewRequest,
  ) => {
    asked.push(data);
    return new AIRun();
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("ProductionReviewPoller.consider: one pull request the poll read", () => {
  test("an open one, from a branch of the repository, by an author who can write: asked for", async () => {
    const host: FakeHost = fakeHost();

    expect(
      await ProductionReviewPoller.consider({
        repository: repository(),
        host,
        pullRequest: pullRequest(),
      }),
    ).toBe(ProductionReviewPollOutcome.Asked);

    expect(asked).toEqual([
      {
        projectId: PROJECT_ID,
        codeRepositoryId: repository().id,
        provider: CodeRepositoryType.GitLab,
        pullRequestNumber: 12,
        pullRequestTitle: "fix: guard the card",
        pullRequestUrl:
          "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
        headSha: SHA,
        isFromFork: false,
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
        requestedByLogin: "dana",
      },
    ]);
  });

  test.each([
    ["closed", { isOpen: false }, ProductionReviewPollOutcome.NotOpen],
    ["with no head", { headSha: "" }, ProductionReviewPollOutcome.NotOpen],
    ["a draft", { isDraft: true }, ProductionReviewPollOutcome.Draft],
    [
      "a bot's",
      { authorLogin: "renovate-bot" },
      ProductionReviewPollOutcome.Bot,
    ],
    [
      "a GitLab access token's own user's",
      { authorLogin: "project_42_bot_1a2b" },
      ProductionReviewPollOutcome.Bot,
    ],
    [
      "a fork's - or one pushed with AGit",
      { isFromFork: true },
      ProductionReviewPollOutcome.Fork,
    ],
  ] as Array<
    [string, Partial<CodeHostPullRequestDetails>, ProductionReviewPollOutcome]
  >)(
    "%s is not asked for, and costs no read of who may write",
    async (
      _what: string,
      change: Partial<CodeHostPullRequestDetails>,
      outcome: ProductionReviewPollOutcome,
    ) => {
      const host: FakeHost = fakeHost();

      expect(
        await ProductionReviewPoller.consider({
          repository: repository(),
          host,
          pullRequest: pullRequest(change),
        }),
      ).toBe(outcome);
      expect(asked).toHaveLength(0);
      expect(host.writeAccessAsked).toBe(0);
    },
  );

  test("OneUptime's own is not asked for", async () => {
    expect(
      await ProductionReviewPoller.consider({
        repository: repository(),
        host: fakeHost({ isOwn: true }),
        pullRequest: pullRequest(),
      }),
    ).toBe(ProductionReviewPollOutcome.OwnPullRequest);
  });

  test("a head a review was already asked for is not asked again; a new head is", async () => {
    earlierTask = new AIRun();
    earlierTask.taskContext = {
      codeHostPullRequest: {
        codeRepositoryId: repository().id!.toString(),
        provider: CodeRepositoryType.GitLab,
        pullRequestNumber: 12,
      },
      productionReview: {
        requestNumber: 1,
        requestedAt: "2026-10-30T09:00:00.000Z",
        headSha: SHA,
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
      },
    };

    expect(
      await ProductionReviewPoller.consider({
        repository: repository(),
        host: fakeHost(),
        pullRequest: pullRequest(),
      }),
    ).toBe(ProductionReviewPollOutcome.AlreadyAsked);

    expect(
      await ProductionReviewPoller.consider({
        repository: repository(),
        host: fakeHost(),
        pullRequest: pullRequest({ headSha: "1a2b3c4d" }),
      }),
    ).toBe(ProductionReviewPollOutcome.Asked);
  });

  test("an author who cannot write is not asked for; one the host will not say of goes by the branch", async () => {
    expect(
      await ProductionReviewPoller.consider({
        repository: repository(),
        host: fakeHost({ writeAccess: AuthorWriteAccess.CannotWrite }),
        pullRequest: pullRequest(),
      }),
    ).toBe(ProductionReviewPollOutcome.AuthorCannotWrite);

    expect(
      await ProductionReviewPoller.consider({
        repository: repository(2),
        host: fakeHost({ writeAccess: AuthorWriteAccess.NotSaid }),
        pullRequest: pullRequest(),
      }),
    ).toBe(ProductionReviewPollOutcome.Asked);
  });
});

describe("ProductionReviewPoller.getAuthorWriteAccess", () => {
  test("asks the host once, and keeps its answer a few minutes for the repository and author", async () => {
    const host: FakeHost = fakeHost({
      writeAccess: AuthorWriteAccess.NotSaid,
    });

    for (let index: number = 0; index < 3; index++) {
      expect(
        await ProductionReviewPoller.getAuthorWriteAccess({
          repositoryId: repository().id!,
          host,
          pullRequest: pullRequest(),
        }),
      ).toBe(AuthorWriteAccess.NotSaid);
    }

    expect(host.writeAccessAsked).toBe(1);
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "production-review-author-trust",
      `${repository().id!.toString()}:77`,
      "?",
      { expiresInSeconds: AUTHOR_TRUST_CACHE_SECONDS },
    );

    // Another repository asks its own host.
    await ProductionReviewPoller.getAuthorWriteAccess({
      repositoryId: repository(2).id!,
      host,
      pullRequest: pullRequest(),
    });

    expect(host.writeAccessAsked).toBe(2);
  });

  test("an author known by login alone is kept by it, in any case", async () => {
    const host: FakeHost = fakeHost();

    await ProductionReviewPoller.getAuthorWriteAccess({
      repositoryId: repository().id!,
      host,
      pullRequest: pullRequest({ authorId: "", authorLogin: "Dana" }),
    });

    expect(
      kept.get(
        `production-review-author-trust:${repository().id!.toString()}:dana`,
      ),
    ).toBe("1");
  });

  test("a host that could not be read is CannotWrite, never kept: nothing is reviewed on a guess", async () => {
    const host: FakeHost = fakeHost({ writeAccess: new Error("502") });

    expect(
      await ProductionReviewPoller.getAuthorWriteAccess({
        repositoryId: repository().id!,
        host,
        pullRequest: pullRequest(),
      }),
    ).toBe(AuthorWriteAccess.CannotWrite);
    expect(kept.size).toBe(0);
  });

  test("an author with no name or id cannot write; a cache that is down asks the host", async () => {
    const host: FakeHost = fakeHost();

    expect(
      await ProductionReviewPoller.getAuthorWriteAccess({
        repositoryId: repository().id!,
        host,
        pullRequest: pullRequest({ authorId: "", authorLogin: "" }),
      }),
    ).toBe(AuthorWriteAccess.CannotWrite);
    expect(host.writeAccessAsked).toBe(0);

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Valkey is down"));
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Valkey is down"));

    expect(
      await ProductionReviewPoller.getAuthorWriteAccess({
        repositoryId: repository().id!,
        host,
        pullRequest: pullRequest(),
      }),
    ).toBe(AuthorWriteAccess.CanWrite);
  });
});

describe("where a repository's poll starts, and goes on from", () => {
  test("the first time a few minutes back; then a little before where the last one got to; never more than a day back", async () => {
    const id: ObjectID = repository().id!;

    expect((await ProductionReviewPoller.readStart(id, NOW)).getTime()).toBe(
      NOW.getTime() - POLL_FIRST_LOOKBACK_SECONDS * 1000,
    );

    kept.set(
      `production-review-poll:${id.toString()}`,
      "2026-10-30T09:59:00.000Z",
    );

    expect(
      (await ProductionReviewPoller.readStart(id, NOW)).toISOString(),
    ).toBe(
      new Date(
        Date.parse("2026-10-30T09:59:00.000Z") - POLL_OVERLAP_SECONDS * 1000,
      ).toISOString(),
    );

    kept.set(
      `production-review-poll:${id.toString()}`,
      "2026-10-01T00:00:00.000Z",
    );

    expect((await ProductionReviewPoller.readStart(id, NOW)).getTime()).toBe(
      NOW.getTime() - POLL_MAX_LOOKBACK_SECONDS * 1000,
    );

    kept.set(`production-review-poll:${id.toString()}`, "not a time");

    expect((await ProductionReviewPoller.readStart(id, NOW)).getTime()).toBe(
      NOW.getTime() - POLL_FIRST_LOOKBACK_SECONDS * 1000,
    );
  });

  test("the next poll goes on from now - or from the last a full page listed, the overlap taken back", () => {
    const since: Date = new Date("2026-10-30T09:00:00.000Z");

    expect(
      ProductionReviewPoller.getNextCursor({
        since,
        now: NOW,
        continueFrom: null,
      }),
    ).toBe(NOW);

    const continueFrom: Date = new Date("2026-10-30T09:30:00.000Z");

    expect(
      ProductionReviewPoller.getNextCursor({
        since,
        now: NOW,
        continueFrom,
      }).toISOString(),
    ).toBe(
      new Date(
        continueFrom.getTime() + POLL_OVERLAP_SECONDS * 1000,
      ).toISOString(),
    );

    // A page that moved nothing on, or one past now, goes on from now.
    expect(
      ProductionReviewPoller.getNextCursor({
        since,
        now: NOW,
        continueFrom: since,
      }),
    ).toBe(NOW);
    expect(
      ProductionReviewPoller.getNextCursor({
        since,
        now: NOW,
        continueFrom: new Date(NOW.getTime() + 1000),
      }),
    ).toBe(NOW);
  });
});

describe("ProductionReviewPoller.pollRepository", () => {
  test("reads what changed since its last poll, asks for each that needs a review, and moves its cursor on", async () => {
    const host: FakeHost = fakeHost({
      pullRequests: [
        pullRequest(),
        pullRequest({ number: 13, isDraft: true }),
        pullRequest({ number: 14, headSha: "1a2b3c4d" }),
      ],
    });
    jest.spyOn(ProductionReviewHosts, "openPolled").mockResolvedValue(host);

    expect(await ProductionReviewPoller.pollRepository(repository(), NOW)).toBe(
      2,
    );
    expect(
      asked.map((ask: CodeHostProductionReviewRequest) => {
        return ask.pullRequestNumber;
      }),
    ).toEqual([12, 14]);
    expect(host.listedFrom[0]!.getTime()).toBe(
      NOW.getTime() - POLL_FIRST_LOOKBACK_SECONDS * 1000,
    );
    expect(
      kept.get(`production-review-poll:${repository().id!.toString()}`),
    ).toBe(NOW.toISOString());
  });

  test("a repository with Production Review off, or not reached now, is not read", async () => {
    const openPolled: SpyInstance<typeof ProductionReviewHosts.openPolled> =
      jest.spyOn(ProductionReviewHosts, "openPolled").mockResolvedValue(null);
    const off: CodeRepository = repository();
    off.isProductionReviewEnabled = false;

    expect(await ProductionReviewPoller.pollRepository(off, NOW)).toBe(0);
    expect(openPolled).not.toHaveBeenCalled();

    expect(await ProductionReviewPoller.pollRepository(repository(), NOW)).toBe(
      0,
    );
    expect(kept.size).toBe(0);
  });

  test("a host that could not be read throws, and the poll starts from the same place next time", async () => {
    jest
      .spyOn(ProductionReviewHosts, "openPolled")
      .mockResolvedValue(fakeHost({ listFails: true }));

    await expect(
      ProductionReviewPoller.pollRepository(repository(), NOW),
    ).rejects.toThrow("GitLab answered 502");
    expect(kept.size).toBe(0);
  });
});

describe("ProductionReviewPoller.pollAll", () => {
  test("reads every GitLab, Forgejo and Gitea repository with Production Review on; one that fails stops no other", async () => {
    const repositories: Array<CodeRepository> = [
      repository(1),
      repository(2),
      repository(3),
    ];
    const findBy: SpyInstance<typeof CodeRepositoryService.findBy> = jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockResolvedValue(repositories);
    jest
      .spyOn(ProductionReviewHosts, "openPolled")
      .mockImplementation(async (polled: CodeRepository) => {
        return polled.id!.toString() === repository(2).id!.toString()
          ? fakeHost({ listFails: true })
          : fakeHost();
      });

    const result: ProductionReviewPollResult =
      await ProductionReviewPoller.pollAll();

    expect(result).toEqual({ repositories: 3, asked: 2 });

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;

    expect(query["isProductionReviewEnabled"]).toBe(true);
    expect(JSON.stringify(query["repositoryHostedAt"])).toContain("GitLab");
    expect(JSON.stringify(query["repositoryHostedAt"])).toContain("Forgejo");
    expect(POLLED_HOSTS).toEqual([
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
    ]);
  });

  test("past what one tick polls, the repositories polled longest ago go first", async () => {
    const repositories: Array<CodeRepository> = Array.from(
      { length: POLLED_REPOSITORIES_PER_TICK + 1 },
      (_value: unknown, index: number) => {
        return repository(index + 1);
      },
    );

    // Every repository was polled just now, but the last one: never.
    for (const polled of repositories.slice(0, -1)) {
      kept.set(
        `production-review-poll:${polled.id!.toString()}`,
        NOW.toISOString(),
      );
    }

    jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue(repositories);
    const order: Array<string> = [];
    jest
      .spyOn(ProductionReviewHosts, "openPolled")
      .mockImplementation(async (polled: CodeRepository) => {
        order.push(polled.id!.toString());
        return null;
      });

    const result: ProductionReviewPollResult =
      await ProductionReviewPoller.pollAll();

    expect(result.repositories).toBe(POLLED_REPOSITORIES_PER_TICK);
    expect(order[0]).toBe(
      repositories[repositories.length - 1]!.id!.toString(),
    );
  });
});
