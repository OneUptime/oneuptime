import ProductionReviewRunner, {
  PRODUCTION_REVIEW_FAILED_MESSAGE,
  PRODUCTION_REVIEW_OFF_MESSAGE,
  PULL_REQUEST_CLOSED_MESSAGE,
  PULL_REQUEST_DRAFT_MESSAGE,
  REPOSITORY_NOT_CONNECTED_MESSAGE,
  getProductionReviewCheckName,
  getProductionReviewFailedMessage,
  getPullRequestClosedMessage,
  getPullRequestDraftMessage,
  getRepositoryNotConnectedMessage,
  getUtcDay,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner";
import GitHubCheckRuns, {
  GitHubCheckConclusion,
  GitHubCheckRunContent,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCheckRuns";
import CodeHostAccess from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CONNECTED_PROJECT_ID,
  CONNECTED_REPOSITORY_ID,
  ConnectedRepository,
  connectRepository,
} from "../CodeHost/ConnectedRepository";
import { FakeRoute } from "../CodeHost/FakeCodeHost";
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
  let writeCheck: jest.SpyInstance;

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

    writeCheck = jest.spyOn(GitHubCheckRuns, "write").mockResolvedValue({
      checkRunId: 7700,
      htmlUrl: "https://github.com/acme/checkout/runs/7700",
    });
  });

  afterEach(() => {
    CodeHostAccess.setTransportForTests(null);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function checkContent(): GitHubCheckRunContent {
    return (writeCheck.mock.calls[0]![0] as { content: GitHubCheckRunContent })
      .content;
  }

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

    test("a review OneUptime started posts no comment and asks the AI nothing - its check says nothing runs through it", async () => {
      await ProductionReviewRunner.review(claimedRun());

      expect(createComment).not.toHaveBeenCalled();
      expect(updateComment).not.toHaveBeenCalled();
      expect(aiRead).not.toHaveBeenCalled();
      expect(finished().outcome!.productionReview!.posting).toBe(
        ProductionReviewPosting.None,
      );
      expect(finished().outcome!.summary).toBe(
        "Nothing in production runs through this pull request's changes.",
      );

      // A check is no comment in the thread: GitHub's quiet review has one.
      expect(writeCheck).toHaveBeenCalledTimes(1);
      expect(checkContent()).toMatchObject({
        conclusion: GitHubCheckConclusion.Success,
        title: "Nothing in production runs through these changes",
      });
      // Whether it may say so is read: a public repository's says the link.
      expect(isPublic).toHaveBeenCalledTimes(1);
      expect(finished().update).toMatchObject({
        checkRunId: 7700,
        checkRunHeadSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      });
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

/*
 * A GitHub pull request's review is a check run on its head too, beside
 * its comment: neutral when something is worth a look, success when
 * production has nothing to say - never a failure - its Details the
 * review in OneUptime. Edited in place while the head is the same. An App
 * that may not write checks, or GitHub failing to take one, leaves the
 * review as it is: commented, and kept in Code.
 */
describe("ProductionReviewRunner: the review's GitHub check run", () => {
  const RUN_PROJECT: ObjectID = new ObjectID(
    "a1b2c3d4-1111-4222-8333-444455556666",
  );
  let finish: jest.SpyInstance;
  let writeCheck: jest.SpyInstance;
  let createComment: jest.SpyInstance;
  let isPublic: jest.SpyInstance;

  function run(
    change: Partial<NonNullable<CodeFixTaskContext["productionReview"]>> = {},
  ): AIRun {
    const made: AIRun = new AIRun();
    made.id = new ObjectID("a1b2c3d4-3333-4222-8333-444455556666");
    made.projectId = RUN_PROJECT;
    made.codeRepositoryId = new ObjectID(
      "a1b2c3d4-2222-4222-8333-444455556666",
    );
    made.status = AIRunStatus.Running;
    made.taskContext = {
      github: {
        codeRepositoryId: "a1b2c3d4-2222-4222-8333-444455556666",
        installationId: "4242",
        organizationName: "acme",
        repositoryName: "checkout",
        commandType: GitHubCommandType.ProductionReview,
        instruction: "",
        pullRequestNumber: 42,
      },
      productionReview: {
        requestNumber: 1,
        requestedAt: "2026-10-22T09:58:00.000Z",
        headSha: "0f1e2d3c4b5a",
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
        ...change,
      },
    };
    return made;
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-22T10:00:00.000Z") });

    const repository: CodeRepository = new CodeRepository();
    repository.id = new ObjectID("a1b2c3d4-2222-4222-8333-444455556666");
    repository.organizationName = "acme";
    repository.repositoryName = "checkout";
    repository.gitHubAppInstallationId = "4242";
    repository.isProductionReviewEnabled = true;

    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockResolvedValue(repository);
    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(true);
    jest.spyOn(GitHubConversation, "getPullRequestDetails").mockResolvedValue({
      pullRequestNumber: 42,
      title: "fix: guard the card",
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
      changedFilesCount: 1,
      additions: 1,
      deletions: 0,
    });
    jest.spyOn(GitHubConversation, "listPullRequestFiles").mockResolvedValue([
      {
        filename: "src/billing/charge.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1 +1,2 @@\n+  if (!card) return;",
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
        htmlUrl: "https://github.com/acme/checkout/pull/42#issuecomment-6000",
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
    jest
      .spyOn(ProductionReviewFindings, "find")
      .mockResolvedValue(findingsOf(fullReport()));
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);
    jest.spyOn(GlobalCache, "incrementIfBelow").mockResolvedValue(1);
    finish = jest
      .spyOn(ProductionReviewQueue, "finish")
      .mockResolvedValue("Completed");
    writeCheck = jest.spyOn(GitHubCheckRuns, "write").mockResolvedValue({
      checkRunId: 7700,
      htmlUrl: "https://github.com/acme/checkout/runs/7700",
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function finished(): {
    outcome: CodeTaskOutcome | null;
    update: Record<string, unknown>;
  } {
    return finish.mock.calls[0]![0] as {
      outcome: CodeTaskOutcome | null;
      update: Record<string, unknown>;
    };
  }

  function written(): {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    checkRunId: number | undefined;
    checkRunHeadSha: string | undefined;
    content: GitHubCheckRunContent;
  } {
    return writeCheck.mock.calls[0]![0] as never;
  }

  test("a review with something to say: neutral, its summary the review, its Details the review in OneUptime", async () => {
    await ProductionReviewRunner.review(run());

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(written()).toMatchObject({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      checkRunId: undefined,
      checkRunHeadSha: undefined,
    });
    expect(written().content).toMatchObject({
      name: "OneUptime production review",
      headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      conclusion: GitHubCheckConclusion.Neutral,
      title: "Something in production is worth a look",
      externalId: "a1b2c3d4-3333-4222-8333-444455556666",
    });
    expect(written().content.detailsUrl).toContain(
      "/code/tasks/a1b2c3d4-3333-4222-8333-444455556666",
    );
    expect(written().content.summary).toContain("TypeError");
    expect(written().content.summary).not.toContain(
      PRODUCTION_REVIEW_COMMENT_MARKER,
    );
    expect(finished().update).toMatchObject({
      commentId: 6000,
      checkRunId: 7700,
      checkRunHeadSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
    });
  });

  test("the same head reviewed again edits its check: the review names the check it wrote", async () => {
    await ProductionReviewRunner.review(
      run({
        commentId: 6000,
        checkRunId: 7700,
        checkRunHeadSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      }),
    );

    expect(written()).toMatchObject({
      checkRunId: 7700,
      checkRunHeadSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
    });
  });

  test("a public repository's check holds the link alone", async () => {
    isPublic.mockResolvedValue(true);

    await ProductionReviewRunner.review(run());

    expect(written().content.summary).toContain("Open the production review");
    expect(written().content.summary).not.toContain("TypeError");
    expect(written().content.summary).not.toContain("checkout-api");
  });

  test("an App that may not write checks writes none, and the review stands", async () => {
    writeCheck.mockResolvedValue(null);

    await ProductionReviewRunner.review(run());

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(finished().outcome!.productionReview).toBeDefined();
    expect(finished().update["checkRunId"]).toBeUndefined();
    expect(finished().update["commentId"]).toBe(6000);
  });

  test("GitHub failing to take the check never fails the review", async () => {
    writeCheck.mockRejectedValue(new Error("GitHub answered 502"));

    await ProductionReviewRunner.review(run());

    expect(finished().outcome!.productionReview!.posting).toBe(
      ProductionReviewPosting.Review,
    );
    expect(finished().update["checkRunId"]).toBeUndefined();
  });

  test("a renamed product names the check as it is renamed", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Observe");

    await ProductionReviewRunner.review(run());

    expect(getProductionReviewCheckName()).toBe(
      "Acme Observe production review",
    );
    expect(written().content.name).toBe("Acme Observe production review");
  });
});

/*
 * A merge request on GitLab, and a pull request on Forgejo or Gitea,
 * reviewed the whole real way: the repository's row and its connection,
 * the host's API answering as it does (ConnectedRepository) - and the
 * comment said in the host's words, with no check run (GitHub's alone).
 */
describe("ProductionReviewRunner: a merge request on GitLab, a pull request on Forgejo or Gitea", () => {
  const SHA: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766";
  let finish: jest.SpyInstance;
  let writeCheck: jest.SpyInstance;

  function hostRun(
    provider: CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo,
    change: Partial<NonNullable<CodeFixTaskContext["productionReview"]>> = {},
  ): AIRun {
    const made: AIRun = new AIRun();
    made.id = new ObjectID("a1b2c3d4-4444-4222-8333-444455556666");
    made.projectId = CONNECTED_PROJECT_ID;
    made.codeRepositoryId = CONNECTED_REPOSITORY_ID;
    made.status = AIRunStatus.Running;
    made.taskContext = {
      codeHostPullRequest: {
        codeRepositoryId: CONNECTED_REPOSITORY_ID.toString(),
        provider,
        pullRequestNumber: 12,
        pullRequestUrl: "https://host.example.com/x",
      },
      productionReview: {
        requestNumber: 1,
        requestedAt: "2026-10-22T09:58:00.000Z",
        headSha: SHA,
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
        ...change,
      },
    };
    return made;
  }

  function gitLabRoutes(
    change: {
      mergeRequest?: Record<string, unknown>;
      noteStatus?: number;
      visibility?: string;
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
              changes_count: "1",
              ...(change.mergeRequest || {}),
            },
          };
        },
      },
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12/diffs",
        answer: () => {
          return {
            json: [
              {
                old_path: "src/billing/charge.ts",
                new_path: "src/billing/charge.ts",
                diff: "@@ -1 +1,2 @@\n+  if (!card) return;\n",
              },
            ],
          };
        },
      },
      {
        method: "GET",
        path: "/projects/4217",
        answer: () => {
          return {
            json: { id: 4217, visibility: change.visibility || "private" },
          };
        },
      },
      {
        method: "POST",
        path: "/projects/4217/merge_requests/12/notes",
        answer: () => {
          return change.noteStatus
            ? { status: change.noteStatus, json: { message: "403 Forbidden" } }
            : { status: 201, json: { id: 5150 } };
        },
      },
    ];
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-22T10:00:00.000Z") });

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
    jest
      .spyOn(ProductionReviewFindings, "find")
      .mockResolvedValue(findingsOf(fullReport()));
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);
    finish = jest
      .spyOn(ProductionReviewQueue, "finish")
      .mockResolvedValue("Completed");
    writeCheck = jest.spyOn(GitHubCheckRuns, "write");
  });

  afterEach(() => {
    CodeHostAccess.setTransportForTests(null);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function finished(): {
    outcome: CodeTaskOutcome | null;
    update: Record<string, unknown>;
    errorMessage?: string;
  } {
    return finish.mock.calls[0]![0] as never;
  }

  test("a GitLab merge request: read through the connection, its note posted in GitLab's words", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes(),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.GitLab));

    const note: Record<string, unknown> = JSON.parse(
      connected.host.requests.find((request: { method: string }) => {
        return request.method === "POST";
      })!.body!,
    ) as Record<string, unknown>;

    expect(note["body"]).toContain(
      "This merge request changes code that runs in production",
    );
    expect(note["body"]).toContain("Updated when the merge request changes.");
    expect(note["body"]).not.toContain("pull request");

    expect(finished().outcome!.summary).toContain("Production review:");
    expect(finished().outcome!.productionReview).toMatchObject({
      posting: ProductionReviewPosting.Review,
      isPublicRepository: false,
      commentUrl:
        "https://gitlab.example.com/acme/checkout/-/merge_requests/12#note_5150",
      pullRequest: {
        number: 12,
        url: "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
        authorLogin: "dana",
        isFromFork: false,
      },
    });
    expect(finished().update).toMatchObject({ commentId: 5150 });
    // GitLab has no check run of OneUptime's.
    expect(writeCheck).not.toHaveBeenCalled();
  });

  test("a merge request not followed on its own says to press Review again in OneUptime, never a command", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes(),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(
      hostRun(CodeRepositoryType.GitLab, {
        trigger: ProductionReviewTrigger.OneUptime,
        isAuthorTrusted: false,
      }),
    );

    const note: string = (
      JSON.parse(
        connected.host.requests.find((request: { method: string }) => {
          return request.method === "POST";
        })!.body!,
      ) as Record<string, string>
    )["body"]!;

    expect(note).toContain("Not updated on its own: press [Review again](");
    expect(note).not.toContain("@");
  });

  test("a host that refuses the token's comment (403) keeps the review in Code, never fails it", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes({ noteStatus: 403 }),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.GitLab));

    expect(finished().outcome!.productionReview).toMatchObject({
      posting: ProductionReviewPosting.None,
      isCommentRefused: true,
    });
    expect(finished().update["commentId"]).toBeUndefined();
  });

  test("a closed merge request, or a draft nobody asked about, is not reviewed - said in GitLab's words", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes({ mergeRequest: { state: "closed" } }),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.GitLab));

    expect(finished().errorMessage).toBe(
      "The merge request is closed, so it was not reviewed.",
    );
    expect(finished().errorMessage).toBe(
      getPullRequestClosedMessage("merge request"),
    );

    finish.mockClear();
    CodeHostAccess.setTransportForTests(null);
    jest.restoreAllMocks();
    finish = jest
      .spyOn(ProductionReviewQueue, "finish")
      .mockResolvedValue("Completed");
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes({ mergeRequest: { draft: true } }),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.GitLab));

    expect(finished().errorMessage).toBe(
      getPullRequestDraftMessage("merge request"),
    );
  });

  test("a connection that no longer works is not reviewed, and says which host", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes(),
      repository: { isProductionReviewEnabled: true },
      connection: { credentials: "" },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.GitLab));

    expect(finished().errorMessage).toBe(
      getRepositoryNotConnectedMessage(CodeRepositoryType.GitLab),
    );
    expect(finished().errorMessage).toBe(
      "This repository's connection to GitLab no longer works - its access token was refused, or the connection is gone - so it was not reviewed.",
    );
  });

  test("a review asked on another host than the repository is on now is not reviewed", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes(),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.Forgejo));

    expect(finished().errorMessage).toBe(
      getRepositoryNotConnectedMessage(CodeRepositoryType.Forgejo),
    );
  });

  test("nothing to say about a merge request OneUptime found: nothing posted, and its visibility not even asked", async () => {
    jest
      .spyOn(ProductionReviewFindings, "find")
      .mockResolvedValue(findingsOf(emptyReport()));
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: gitLabRoutes(),
      repository: { isProductionReviewEnabled: true },
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.GitLab));

    expect(finished().outcome!.productionReview!.posting).toBe(
      ProductionReviewPosting.None,
    );
    expect(finished().outcome!.summary).toBe(
      "Nothing in production runs through this merge request's changes.",
    );
    expect(connected.host.urlsTo("/projects/4217")).toHaveLength(0);
    expect(
      connected.host.requests.filter((request: { method: string }) => {
        return request.method === "POST";
      }),
    ).toHaveLength(0);
  });

  test("a Forgejo pull request whose token cannot write issues keeps its review in Code", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Forgejo,
      repository: { isProductionReviewEnabled: true },
      routes: [
        {
          method: "GET",
          path: "/repos/acme/checkout/pulls/12",
          answer: () => {
            return {
              json: {
                number: 12,
                title: "fix: guard the card",
                state: "open",
                html_url: "https://git.example.com/acme/checkout/pulls/12",
                user: { id: 77, login: "dana" },
                head: { ref: "fix/card", sha: SHA, repo: { id: 5 } },
                base: { ref: "main", repo: { id: 5 } },
                changed_files: 1,
                additions: 1,
                deletions: 0,
              },
            };
          },
        },
        {
          method: "GET",
          path: "/repos/acme/checkout/pulls/12.diff",
          answer: () => {
            return {
              text: "diff --git a/src/billing/charge.ts b/src/billing/charge.ts\n--- a/src/billing/charge.ts\n+++ b/src/billing/charge.ts\n@@ -1 +1,2 @@\n+  if (!card) return;\n",
            };
          },
        },
        {
          method: "GET",
          path: "/repos/acme/checkout",
          answer: () => {
            return { json: { id: 5, private: true } };
          },
        },
        {
          method: "POST",
          path: "/repos/acme/checkout/issues/12/comments",
          answer: () => {
            return {
              status: 403,
              json: { message: "token does not have scope write:issue" },
            };
          },
        },
      ],
    });

    await ProductionReviewRunner.review(hostRun(CodeRepositoryType.Forgejo));

    expect(finished().outcome!.productionReview).toMatchObject({
      posting: ProductionReviewPosting.None,
      isCommentRefused: true,
      pullRequest: { number: 12, isFromFork: false },
    });
    // The pull request was read, its diff split file by file.
    expect(finished().outcome!.productionReview!.changedFileCount).toBe(1);
    expect(connected.refused()).toBe(0);
  });

  test("the failure kept after a retry says the host's word", () => {
    expect(getProductionReviewFailedMessage("merge request")).toBe(
      "OneUptime could not finish this production review, even after trying again. A push to the merge request, or Review again, starts a new one.",
    );
  });
});
