import ProductionReviewRunner, {
  PRODUCTION_REVIEW_FAILED_MESSAGE,
  PRODUCTION_REVIEW_OFF_MESSAGE,
  PULL_REQUEST_CLOSED_MESSAGE,
  PULL_REQUEST_DRAFT_MESSAGE,
  REPOSITORY_NOT_CONNECTED_MESSAGE,
  getUtcDay,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner";
import ProductionReviewAI from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewAI";
import ProductionReviewFindings, {
  ProductionReviewFindingsResult,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewFindings";
import ProductionReviewQueue from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import ProductionReviewRepositoryProfile from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRepositoryProfile";
import ProductionReviewScope from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewScope";
import GitHubConversation, {
  GitHubPullRequestDetails,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GitHubCommandParser from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandParser";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import AIService from "../../../../../Server/Services/AIService";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../../Server/Utils/AI/LlmProviderChoice";
import {
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../../../Types/AI/LlmProviderChoice";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import CodeFixTaskContext from "../../../../../Types/AI/CodeFixTaskContext";
import { CodeTaskOutcome } from "../../../../../Types/AI/CodeTask";
import GitHubCommandType, {
  GitHubCommandSurface,
} from "../../../../../Types/CodeRepository/GitHubCommand";
import {
  PRODUCTION_REVIEW_COMMENT_MARKER,
  PRODUCTION_REVIEW_LIMITS,
  ProductionReviewAiNoteCode,
  ProductionReviewPosting,
  ProductionReviewPullRequestContent,
  ProductionReviewReport,
  ProductionReviewTrigger,
} from "../../../../../Types/CodeRepository/ProductionReview";
import ObjectID from "../../../../../Types/ObjectID";
import { emptyReport, fullReport } from "./ProductionReviewFixtures";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * One production review, done: the repository still connected and still
 * asking, the pull request open (a draft only when someone asked), its
 * change matched against production, OneUptime AI's read when AI may run
 * and has reads left, and the pull request's ONE comment - the review, a
 * link on a public repository, or nothing when OneUptime started the review
 * and production has nothing to say. GitHub, the database and the reads are
 * stubbed; the decisions are the code under test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "a1b2c3d4-1111-4222-8333-444455556666",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "a1b2c3d4-2222-4222-8333-444455556666",
);
const RUN_ID: ObjectID = new ObjectID("a1b2c3d4-3333-4222-8333-444455556666");
const COMMENT_URL: string =
  "https://github.com/acme/checkout/pull/42#issuecomment-6000";

function context(change: {
  trigger?: ProductionReviewTrigger;
  commentId?: number;
  isAuthorTrusted?: boolean;
  aiInputHash?: string;
  aiReadDay?: string;
  aiReadsToday?: number;
  installationId?: string;
}): CodeFixTaskContext {
  const review: CodeFixTaskContext["productionReview"] = {
    requestNumber: 2,
    requestedAt: "2026-10-22T09:58:00.000Z",
    headSha: "0f1e2d3c4b5a",
    trigger: change.trigger || ProductionReviewTrigger.PullRequestChanged,
    isAuthorTrusted: change.isAuthorTrusted ?? true,
  };

  if (change.commentId) {
    review.commentId = change.commentId;
  }

  if (change.aiInputHash) {
    review.aiInputHash = change.aiInputHash;
  }

  if (change.aiReadDay) {
    review.aiReadDay = change.aiReadDay;
    review.aiReadsToday = change.aiReadsToday || 0;
  }

  return {
    github: {
      codeRepositoryId: REPOSITORY_ID.toString(),
      installationId: change.installationId || "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      commandType: GitHubCommandType.ProductionReview,
      instruction: "",
      pullRequestNumber: 42,
    },
    productionReview: review,
  };
}

function claimedRun(
  change: Parameters<typeof context>[0] = {},
  outcome?: CodeTaskOutcome,
): AIRun {
  const run: AIRun = new AIRun();
  run.id = RUN_ID;
  run.projectId = PROJECT_ID;
  run.codeRepositoryId = REPOSITORY_ID;
  run.status = AIRunStatus.Running;
  run.taskContext = context(change);

  if (outcome) {
    run.taskOutcome = outcome;
  }

  return run;
}

function pullRequest(
  change: Partial<GitHubPullRequestDetails> = {},
): GitHubPullRequestDetails {
  return {
    pullRequestNumber: 42,
    title: "fix: guard the card before charging",
    body: "",
    state: "open",
    htmlUrl: "https://github.com/acme/checkout/pull/42",
    authorLogin: "octo-dev",
    headRefName: "fix/card",
    headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
    baseRefName: "main",
    headRepositoryFullName: "acme/checkout",
    isDraft: false,
    isMerged: false,
    changedFilesCount: 2,
    additions: 4,
    deletions: 1,
    ...change,
  };
}

function findingsOf(
  report: ProductionReviewReport,
): ProductionReviewFindingsResult {
  return {
    services: report.services,
    exceptions: report.exceptions,
    operations: report.operations,
    hotFunctions: report.hotFunctions,
    incidents: report.incidents,
    suspectDeploys: report.suspectDeploys,
    unreadSections: report.unreadSections,
  };
}

describe("ProductionReviewRunner", () => {
  let repository: CodeRepository;
  let createComment: jest.SpyInstance;
  let updateComment: jest.SpyInstance;
  let finish: jest.SpyInstance;
  let aiRead: jest.SpyInstance;
  let isPublic: jest.SpyInstance;
  let find: jest.SpyInstance;
  let pullRequestDetails: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-22T10:00:00.000Z") });

    repository = new CodeRepository();
    repository.id = REPOSITORY_ID;
    repository.organizationName = "acme";
    repository.repositoryName = "checkout";
    repository.gitHubAppInstallationId = "4242";
    repository.isProductionReviewEnabled = true;

    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockImplementation(async () => {
        return repository;
      });
    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(true);
    pullRequestDetails = jest
      .spyOn(GitHubConversation, "getPullRequestDetails")
      .mockResolvedValue(pullRequest());
    jest.spyOn(GitHubConversation, "listPullRequestFiles").mockResolvedValue([
      {
        filename: "src/billing/charge.ts",
        status: "modified",
        additions: 4,
        deletions: 1,
        patch:
          "@@ -40,2 +40,5 @@ export function chargeCard(card) {\n-  const id = card.id;\n+  if (!card) {\n+    throw new Error('no card');\n+  }\n+  const id = card.id;",
      },
    ]);
    isPublic = jest
      .spyOn(GitHubConversation, "isRepositoryPublic")
      .mockResolvedValue(false);
    jest.spyOn(GitHubConversation, "getAppSlug").mockResolvedValue("oneuptime");
    createComment = jest
      .spyOn(GitHubConversation, "createIssueComment")
      .mockResolvedValue({
        commentId: 6000,
        htmlUrl: COMMENT_URL,
        body: "",
        authorLogin: "oneuptime[bot]",
        isBot: true,
        createdAt: "",
      });
    updateComment = jest
      .spyOn(GitHubConversation, "updateIssueComment")
      .mockResolvedValue({
        commentId: 5150,
        htmlUrl: COMMENT_URL,
        body: "",
        authorLogin: "oneuptime[bot]",
        isBot: true,
        createdAt: "",
      });

    jest.spyOn(ProductionReviewScope, "get").mockResolvedValue({
      repository: null,
      services: [
        {
          id: "8b5b7f2e-2c3d-4c6a-9e1f-5a6b7c8d9e01",
          name: "checkout-api",
          method: "stack-trace",
          evidence: "",
          pathInRepository: null,
        },
      ],
      gap: null,
    });
    jest.spyOn(ProductionReviewRepositoryProfile, "get").mockResolvedValue({
      readAt: "2026-10-22T10:00:00.000Z",
      traffic: [],
      operations: [],
      codeLocations: [],
      functions: [],
      suspectDeploys: [],
      unread: [],
    });
    find = jest
      .spyOn(ProductionReviewFindings, "find")
      .mockResolvedValue(findingsOf(fullReport()));

    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    aiRead = jest.spyOn(ProductionReviewAI, "read").mockResolvedValue({
      points: [{ text: "`chargeCard` throws at the line this edits." }],
    });
    jest.spyOn(GlobalCache, "incrementIfBelow").mockResolvedValue(1);

    finish = jest
      .spyOn(ProductionReviewQueue, "finish")
      .mockResolvedValue("Completed");
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function finished(): {
    outcome: CodeTaskOutcome | null;
    update: Record<string, unknown>;
    errorMessage?: string;
    requestNumber: number;
  } {
    return finish.mock.calls[0]![0] as {
      outcome: CodeTaskOutcome | null;
      update: Record<string, unknown>;
      errorMessage?: string;
      requestNumber: number;
    };
  }

  function postedBody(): string {
    return (createComment.mock.calls[0]![0] as { body: string }).body;
  }

  describe("a review with something to say, on a private repository", () => {
    test("posts the review, keeps it on the task and keeps the comment for next time", async () => {
      await ProductionReviewRunner.review(claimedRun());

      expect(createComment).toHaveBeenCalledTimes(1);
      expect(createComment.mock.calls[0]![0]).toMatchObject({
        installationId: "4242",
        organizationName: "acme",
        repositoryName: "checkout",
        issueNumber: 42,
      });

      const body: string = postedBody();

      expect(body.startsWith(PRODUCTION_REVIEW_COMMENT_MARKER)).toBe(true);
      expect(body).toContain("**What to watch**");
      expect(body).toContain("`chargeCard` throws at the line this edits.");
      expect(body).toContain("Updated when the pull request changes.");
      expect(
        GitHubCommandParser.parse({
          body,
          appSlug: "oneuptime",
          surface: GitHubCommandSurface.PullRequest,
        }),
      ).toBeNull();

      const { outcome, update, requestNumber } = finished();

      expect(requestNumber).toBe(2);
      expect(outcome!.filesChanged).toEqual([]);
      expect(outcome!.summary).toContain("Production review:");
      expect(outcome!.productionReview).toMatchObject({
        posting: ProductionReviewPosting.Review,
        isPublicRepository: false,
        commentUrl: COMMENT_URL,
        points: [{ text: "`chargeCard` throws at the line this edits." }],
        pullRequest: {
          number: 42,
          headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
          isFromFork: false,
          // Its pushes are reviewed on their own: its page says so.
          isAuthorTrusted: true,
        },
        changedFileCount: 2,
        codeFileCount: 1,
      });
      expect(update).toMatchObject({
        commentId: 6000,
        commentUrl: COMMENT_URL,
        commentPosting: ProductionReviewPosting.Review,
        reviewedHeadSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
        aiReadDay: "2026-10-22",
        aiReadsToday: 1,
      });
      expect(typeof update["aiInputHash"]).toBe("string");
    });

    test("edits its comment in place on the next review", async () => {
      await ProductionReviewRunner.review(claimedRun({ commentId: 5150 }));

      expect(updateComment).toHaveBeenCalledTimes(1);
      expect(updateComment.mock.calls[0]![0]).toMatchObject({
        commentId: 5150,
      });
      expect(createComment).not.toHaveBeenCalled();
    });

    test("writes a new comment when its old one is gone", async () => {
      updateComment.mockRejectedValue(new Error("404 Not Found"));

      await ProductionReviewRunner.review(claimedRun({ commentId: 5150 }));

      expect(createComment).toHaveBeenCalledTimes(1);
      expect(finished().update["commentId"]).toBe(6000);
    });

    test("a pull request that is not followed on its own says how to ask again", async () => {
      await ProductionReviewRunner.review(
        claimedRun({
          trigger: ProductionReviewTrigger.GitHubCommand,
          isAuthorTrusted: false,
        }),
      );

      expect(postedBody()).toContain(
        "Not updated on its own: ask again with `@oneuptime production review` after new commits.",
      );
      // And the review's page in Code says the same.
      expect(finished().outcome!.productionReview!.pullRequest).toMatchObject({
        isAuthorTrusted: false,
      });
    });
  });

  describe("what the pull request shows", () => {
    test("a public repository gets a link, and no fact of production", async () => {
      isPublic.mockResolvedValue(true);

      await ProductionReviewRunner.review(claimedRun());

      const body: string = postedBody();

      expect(body).toContain("This repository is public");
      expect(body).not.toContain("TypeError");
      expect(body).not.toContain("checkout-api");
      expect(finished().outcome!.productionReview).toMatchObject({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: true,
      });
    });

    test("a repository GitHub could not say the visibility of is treated as public", async () => {
      isPublic.mockResolvedValue(null);

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().outcome!.productionReview!.posting).toBe(
        ProductionReviewPosting.Link,
      );
    });

    test("a public repository that chose to show the review shows it", async () => {
      isPublic.mockResolvedValue(true);
      repository.productionReviewPullRequestContent =
        ProductionReviewPullRequestContent.ReviewEvenIfPublic;

      await ProductionReviewRunner.review(claimedRun());

      expect(postedBody()).toContain("TypeError");
      expect(finished().outcome!.productionReview!.posting).toBe(
        ProductionReviewPosting.Review,
      );
    });

    test("a private repository that chose a link gets a link", async () => {
      repository.productionReviewPullRequestContent =
        ProductionReviewPullRequestContent.Link;

      await ProductionReviewRunner.review(claimedRun());

      expect(postedBody()).not.toContain("TypeError");
      expect(finished().outcome!.productionReview!.posting).toBe(
        ProductionReviewPosting.Link,
      );
    });
  });

  describe("nothing to say", () => {
    beforeEach(() => {
      find.mockResolvedValue(findingsOf(emptyReport()));
    });

    test("a review OneUptime started posts nothing, and asks the AI nothing", async () => {
      await ProductionReviewRunner.review(claimedRun());

      expect(createComment).not.toHaveBeenCalled();
      expect(updateComment).not.toHaveBeenCalled();
      expect(isPublic).not.toHaveBeenCalled();
      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.posting).toBe(
        ProductionReviewPosting.None,
      );
      expect(finished().outcome!.summary).toBe(
        "Nothing in production runs through this pull request's changes.",
      );
    });

    test("its own comment from an earlier push is brought up to date", async () => {
      await ProductionReviewRunner.review(claimedRun({ commentId: 5150 }));

      expect(updateComment).toHaveBeenCalledTimes(1);
      expect(
        (updateComment.mock.calls[0]![0] as { body: string }).body,
      ).toContain(
        "Nothing in production runs through this pull request's changes",
      );
    });

    test("someone who asked always gets an answer", async () => {
      await ProductionReviewRunner.review(
        claimedRun({ trigger: ProductionReviewTrigger.GitHubCommand }),
      );

      expect(createComment).toHaveBeenCalledTimes(1);
    });
  });

  describe("reviews that are not done", () => {
    test("a closed pull request is not reviewed, and the last review is kept", async () => {
      pullRequestDetails.mockResolvedValue(pullRequest({ state: "closed" }));

      await ProductionReviewRunner.review(claimedRun());

      expect(createComment).not.toHaveBeenCalled();
      expect(finished().outcome).toBeNull();
      expect(finished().errorMessage).toBe(PULL_REQUEST_CLOSED_MESSAGE);
    });

    test("a draft waits until it is ready - unless someone asked", async () => {
      pullRequestDetails.mockResolvedValue(pullRequest({ isDraft: true }));

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().errorMessage).toBe(PULL_REQUEST_DRAFT_MESSAGE);

      finish.mockClear();

      await ProductionReviewRunner.review(
        claimedRun({ trigger: ProductionReviewTrigger.OneUptime }),
      );

      expect(finished().outcome?.productionReview).toBeDefined();
    });

    test("a repository that turned production review off is not reviewed on its own - but is when asked", async () => {
      repository.isProductionReviewEnabled = false;

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().errorMessage).toBe(PRODUCTION_REVIEW_OFF_MESSAGE);
      expect(pullRequestDetails).not.toHaveBeenCalled();

      finish.mockClear();

      await ProductionReviewRunner.review(
        claimedRun({ trigger: ProductionReviewTrigger.GitHubCommand }),
      );

      expect(finished().outcome?.productionReview).toBeDefined();
      // Its next push is not reviewed on its own, so it says how to ask again.
      expect(postedBody()).toContain("Not updated on its own");
    });

    test("a repository no longer connected, or on another installation, is not reviewed", async () => {
      jest
        .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
        .mockResolvedValue(false);

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().errorMessage).toBe(REPOSITORY_NOT_CONNECTED_MESSAGE);

      finish.mockClear();
      jest
        .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
        .mockResolvedValue(true);

      await ProductionReviewRunner.review(
        claimedRun({ installationId: "9999" }),
      );

      expect(finished().errorMessage).toBe(REPOSITORY_NOT_CONNECTED_MESSAGE);
      expect(pullRequestDetails).not.toHaveBeenCalled();
    });

    test("a review that does not say what to review ends at once", async () => {
      const run: AIRun = claimedRun();
      run.taskContext = {};

      await ProductionReviewRunner.review(run);

      expect(finished().errorMessage).toBe(
        "This production review does not say what to review.",
      );
    });
  });

  describe("OneUptime AI's read", () => {
    test("is not asked when the project's AI is off, and says why", async () => {
      jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);

      await ProductionReviewRunner.review(claimedRun());

      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.aiNote).toEqual({
        code: ProductionReviewAiNoteCode.AiOff,
      });
      expect(createComment).toHaveBeenCalledTimes(1);
    });

    test("is kept, not asked again, when the facts and the diff are what the last read answered", async () => {
      await ProductionReviewRunner.review(claimedRun());
      const hash: string = finished().update["aiInputHash"] as string;

      aiRead.mockClear();
      finish.mockClear();

      await ProductionReviewRunner.review(
        claimedRun(
          { aiInputHash: hash, commentId: 6000 },
          {
            summary: "",
            filesChanged: [],
            productionReview: fullReport({
              points: [{ text: "Kept from the last read." }],
            }),
          },
        ),
      );

      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.points).toEqual([
        { text: "Kept from the last read." },
      ]);
    });

    test("a pull request that had its reads today gets none, and says so", async () => {
      await ProductionReviewRunner.review(
        claimedRun({
          aiReadDay: getUtcDay(new Date()),
          aiReadsToday: PRODUCTION_REVIEW_LIMITS.maxAiReadsPerPullRequestPerDay,
        }),
      );

      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.aiNote).toEqual({
        code: ProductionReviewAiNoteCode.DailyLimit,
      });
    });

    test("yesterday's reads do not count today", async () => {
      await ProductionReviewRunner.review(
        claimedRun({ aiReadDay: "2026-10-21", aiReadsToday: 99 }),
      );

      expect(aiRead).toHaveBeenCalledTimes(1);
      expect(finished().update["aiReadsToday"]).toBe(1);
    });

    test("a repository that had its reads today gets none", async () => {
      jest.spyOn(GlobalCache, "incrementIfBelow").mockResolvedValue(null);

      await ProductionReviewRunner.review(claimedRun());

      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.aiNote).toEqual({
        code: ProductionReviewAiNoteCode.DailyLimit,
      });
    });

    test("a cache that cannot count does not stop a read", async () => {
      jest
        .spyOn(GlobalCache, "incrementIfBelow")
        .mockRejectedValue(new Error("Valkey is down"));

      await ProductionReviewRunner.review(claimedRun());

      expect(aiRead).toHaveBeenCalledTimes(1);
    });

    test("a read that failed is said, and is not kept as the last answer", async () => {
      aiRead.mockResolvedValue({
        points: [],
        note: {
          code: ProductionReviewAiNoteCode.Failed,
          message: "The answer could not be read.",
        },
      });

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().outcome!.productionReview!.aiNote).toEqual({
        code: ProductionReviewAiNoteCode.Failed,
        message: "The answer could not be read.",
      });
      expect(finished().update["aiInputHash"]).toBeUndefined();
      expect(finished().update["aiReadsToday"]).toBe(1);
    });
  });

  /*
   * The LLM provider the read uses (the follow-up #5273 listed): the one
   * the repository picks for its production reviews, else the project's
   * default provider, else the global one - LlmProviderChoice decides, as
   * it does for the AI rules' work.
   */
  describe("the LLM provider the read uses", () => {
    const PICKED_PROVIDER_ID: ObjectID = new ObjectID(
      "a1b2c3d4-4444-4222-8333-444455556666",
    );

    function choiceOf(
      llmProviderId: ObjectID | undefined,
    ): RuleLlmProviderChoice {
      return {
        provider: llmProviderId
          ? {
              id: llmProviderId.toString(),
              name: "Azure GPT-5",
              isGlobal: false,
            }
          : null,
        source: llmProviderId ? LlmProviderSource.RulePick : null,
        fallbackReason: null,
        pickedProviderId: llmProviderId ? llmProviderId.toString() : "",
        llmProviderId: llmProviderId,
        activity: null,
      };
    }

    test("is read with the repository", async () => {
      await ProductionReviewRunner.review(claimedRun());

      const select: Record<string, unknown> = (
        (CodeRepositoryService.findOneBy as unknown as jest.SpyInstance).mock
          .calls[0]![0] as { select: Record<string, unknown> }
      ).select;

      expect(select["productionReviewLlmProviderId"]).toBe(true);
    });

    test("the repository's pick, when it may be used, is the one the read asks", async () => {
      repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
      const decide: jest.SpyInstance = jest
        .spyOn(LlmProviderChoice, "decideIfPicked")
        .mockResolvedValue(choiceOf(PICKED_PROVIDER_ID));

      await ProductionReviewRunner.review(claimedRun());

      expect(decide).toHaveBeenCalledTimes(1);
      expect(decide.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        pickedProviderId: PICKED_PROVIDER_ID,
      });
      expect(aiRead).toHaveBeenCalledTimes(1);
      expect(
        (aiRead.mock.calls[0]![0] as { llmProviderId?: ObjectID })
          .llmProviderId,
      ).toBe(PICKED_PROVIDER_ID);
    });

    test("a pick that cannot be used falls back: the read resolves the project's provider", async () => {
      repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
      jest
        .spyOn(LlmProviderChoice, "decideIfPicked")
        .mockResolvedValue(choiceOf(undefined));

      await ProductionReviewRunner.review(claimedRun());

      expect(aiRead).toHaveBeenCalledTimes(1);
      expect(
        (aiRead.mock.calls[0]![0] as { llmProviderId?: ObjectID })
          .llmProviderId,
      ).toBeUndefined();
    });

    test("no pick reads no provider: the project's, as every review used before", async () => {
      const findProvider: jest.SpyInstance = jest.spyOn(
        LlmProviderChoice,
        "decide",
      );

      await ProductionReviewRunner.review(claimedRun());

      // decideIfPicked answers a missing pick without a read.
      expect(findProvider).not.toHaveBeenCalled();
      expect(aiRead).toHaveBeenCalledTimes(1);
      expect(
        (aiRead.mock.calls[0]![0] as { llmProviderId?: ObjectID })
          .llmProviderId,
      ).toBeUndefined();
    });

    test("nothing is decided when no read is made", async () => {
      repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
      jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);
      const decide: jest.SpyInstance = jest.spyOn(
        LlmProviderChoice,
        "decideIfPicked",
      );

      await ProductionReviewRunner.review(claimedRun());

      expect(decide).not.toHaveBeenCalled();
      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.llmProvider).toBeUndefined();
    });

    /*
     * The review's page says which provider read it when the repository
     * picks one - and, when the pick could not be used, which provider read
     * it instead and why (the follow-up #5398 left: the page said nothing).
     * The pull request's comment never names a provider.
     */
    test("a pick that was used is kept on the review, never in the comment", async () => {
      repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
      jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
        ...choiceOf(PICKED_PROVIDER_ID),
        activity: {
          source: LlmProviderSource.RulePick,
          providerName: "Azure GPT-5",
        },
      });

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().outcome!.productionReview!.llmProvider).toEqual({
        source: LlmProviderSource.RulePick,
        providerName: "Azure GPT-5",
      });
      expect(postedBody()).not.toContain("Azure GPT-5");
    });

    test.each([
      [
        LlmProviderFallbackReason.Unavailable,
        LlmProviderSource.ProjectDefault,
        "Team OpenAI",
      ],
      [
        LlmProviderFallbackReason.Unavailable,
        LlmProviderSource.Global,
        "OneUptime AI",
      ],
      [
        LlmProviderFallbackReason.CreditsUsedUp,
        LlmProviderSource.ProjectDefault,
        "Team OpenAI",
      ],
      [
        LlmProviderFallbackReason.SpendLimitReached,
        LlmProviderSource.ProjectDefault,
        "Team OpenAI",
      ],
    ] as Array<[LlmProviderFallbackReason, LlmProviderSource, string]>)(
      "a pick that fell back (%s) says which provider read it instead (%s)",
      async (
        fallbackReason: LlmProviderFallbackReason,
        source: LlmProviderSource,
        providerName: string,
      ) => {
        repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
        jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
          ...choiceOf(undefined),
          source,
          fallbackReason,
          pickedProviderId: PICKED_PROVIDER_ID.toString(),
          activity: { source, providerName, fallbackReason },
        });

        await ProductionReviewRunner.review(claimedRun());

        expect(finished().outcome!.productionReview!.llmProvider).toEqual({
          source,
          providerName,
          fallbackReason,
        });
        expect(postedBody()).not.toContain(providerName);
      },
    );

    test("a pick with nothing to fall back to says so, with no provider", async () => {
      repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
      jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
        ...choiceOf(undefined),
        fallbackReason: LlmProviderFallbackReason.Unavailable,
        pickedProviderId: PICKED_PROVIDER_ID.toString(),
        activity: { fallbackReason: LlmProviderFallbackReason.Unavailable },
      });

      await ProductionReviewRunner.review(claimedRun());

      expect(finished().outcome!.productionReview!.llmProvider).toEqual({
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      });
    });

    test("no pick puts no provider on the review", async () => {
      await ProductionReviewRunner.review(claimedRun());

      expect(finished().outcome!.productionReview!.llmProvider).toBeUndefined();
    });

    test("a read that is kept keeps the provider that made it", async () => {
      repository.productionReviewLlmProviderId = PICKED_PROVIDER_ID;
      jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
        ...choiceOf(PICKED_PROVIDER_ID),
        activity: {
          source: LlmProviderSource.RulePick,
          providerName: "Azure GPT-5",
        },
      });

      await ProductionReviewRunner.review(claimedRun());
      const hash: string = finished().update["aiInputHash"] as string;

      aiRead.mockClear();
      finish.mockClear();

      await ProductionReviewRunner.review(
        claimedRun(
          { aiInputHash: hash, commentId: 6000 },
          {
            summary: "",
            filesChanged: [],
            productionReview: fullReport({
              points: [{ text: "Kept from the last read." }],
              llmProvider: {
                source: LlmProviderSource.ProjectDefault,
                providerName: "Team OpenAI",
                fallbackReason: LlmProviderFallbackReason.CreditsUsedUp,
              },
            }),
          },
        ),
      );

      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.llmProvider).toEqual({
        source: LlmProviderSource.ProjectDefault,
        providerName: "Team OpenAI",
        fallbackReason: LlmProviderFallbackReason.CreditsUsedUp,
      });
    });
  });

  describe("runClaimed and runDueReviews", () => {
    test("a review that throws is tried again later, never thrown on", async () => {
      pullRequestDetails.mockRejectedValue(new Error("GitHub answered 502"));
      const fail: jest.SpyInstance = jest
        .spyOn(ProductionReviewQueue, "fail")
        .mockResolvedValue(undefined);

      await ProductionReviewRunner.runClaimed(claimedRun());

      expect(fail).toHaveBeenCalledTimes(1);
      expect(fail.mock.calls[0]![0]).toMatchObject({
        requestNumber: 2,
        isRetryable: true,
        errorMessage: PRODUCTION_REVIEW_FAILED_MESSAGE(),
      });
      /*
       * Kept only once it failed again: said once on the review's page,
       * with what starts a new one - never that it tries again.
       */
      expect(PRODUCTION_REVIEW_FAILED_MESSAGE()).toBe(
        "OneUptime could not finish this production review, even after trying again. A push to the pull request, or Review again, starts a new one.",
      );
    });

    test("runs every review the queue hands it", async () => {
      jest
        .spyOn(ProductionReviewQueue, "claimDue")
        .mockResolvedValue([claimedRun(), claimedRun({ commentId: 1 })]);

      expect(await ProductionReviewRunner.runDueReviews()).toBe(2);
      expect(finish).toHaveBeenCalledTimes(2);
    });
  });
});
