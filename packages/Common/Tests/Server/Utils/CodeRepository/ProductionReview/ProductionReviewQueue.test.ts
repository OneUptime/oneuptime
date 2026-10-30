import ProductionReviewQueue, {
  CodeHostProductionReviewRequest,
  PRODUCTION_REVIEW_CLAIMS_PER_TICK,
  PRODUCTION_REVIEW_DEBOUNCE_SECONDS,
  PRODUCTION_REVIEW_RETRY_SECONDS,
  ProductionReviewRequest,
  getDueAt,
  isCodeHostReviewRequest,
  toTaskTitle,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskContext, {
  ProductionReviewTaskContext,
} from "../../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { CodeTaskOutcome } from "../../../../../Types/AI/CodeTask";
import GitHubCommandType from "../../../../../Types/CodeRepository/GitHubCommand";
import {
  ProductionReviewPosting,
  ProductionReviewTrigger,
} from "../../../../../Types/CodeRepository/ProductionReview";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * One production review task per pull request, reviewed again in place:
 * every push, command or Review again asks again (requestNumber); a burst of
 * pushes is reviewed once, a minute after the last; a review is claimed by
 * one worker; and one that finishes while it was asked again is queued
 * again, so the latest push is never left unreviewed. A failure is tried
 * again a little later, a few times.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "90a1b2c3-1111-4222-8333-444455556666",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "90a1b2c3-2222-4222-8333-444455556666",
);
const RUN_ID: ObjectID = new ObjectID("90a1b2c3-3333-4222-8333-444455556666");
const USER_ID: ObjectID = new ObjectID("90a1b2c3-4444-4222-8333-444455556666");

function request(
  change: Partial<ProductionReviewRequest> = {},
): ProductionReviewRequest {
  return {
    projectId: PROJECT_ID,
    codeRepositoryId: REPOSITORY_ID,
    installationId: "4242",
    organizationName: "acme",
    repositoryName: "checkout",
    pullRequestNumber: 42,
    pullRequestTitle: "fix: guard the card",
    headSha: "abc1234def",
    isFromFork: false,
    trigger: ProductionReviewTrigger.PullRequestChanged,
    isAuthorTrusted: true,
    requestedByLogin: "octo-dev",
    ...change,
  };
}

function reviewContext(
  change: Partial<ProductionReviewTaskContext> = {},
): CodeFixTaskContext {
  return {
    github: {
      codeRepositoryId: REPOSITORY_ID.toString(),
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      commandType: GitHubCommandType.ProductionReview,
      instruction: "",
      pullRequestNumber: 42,
      acknowledgementCommentId: 777,
    },
    productionReview: {
      requestNumber: 3,
      requestedAt: "2026-10-22T09:00:00.000Z",
      headSha: "old0000",
      trigger: ProductionReviewTrigger.PullRequestChanged,
      isAuthorTrusted: true,
      commentId: 5150,
      failedAttempts: 1,
      ...change,
    },
  };
}

function task(
  status: AIRunStatus,
  context: CodeFixTaskContext = reviewContext(),
): AIRun {
  const run: AIRun = new AIRun();
  run.id = RUN_ID;
  run.projectId = PROJECT_ID;
  run.codeRepositoryId = REPOSITORY_ID;
  run.status = status;
  run.attemptCount = 2;
  run.taskContext = context;
  return run;
}

describe("ProductionReviewQueue", () => {
  let lock: jest.SpyInstance;
  let release: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-22T10:00:00.000Z") });
    lock = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "mutex" } as never);
    release = jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("findTask", () => {
    test("is the pull request's first run of the recipe in its repository, named in its context", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(null);

      await ProductionReviewQueue.findTask({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        pullRequestNumber: 42,
      });

      const query: JSONObject = (
        findOneBy.mock.calls[0]![0] as { query: JSONObject }
      ).query;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["runType"]).toBe(AIRunType.CodeFix);
      expect(query["codeFixTaskType"]).toBe(
        CodeFixTaskType.GitHubPullRequestProductionReview,
      );
      expect(query["codeRepositoryId"]).toBe(REPOSITORY_ID);
      expect(query["codeTaskId"]).toBeDefined();
      expect(JSON.stringify(query["taskContext"])).toContain(
        JSON.stringify({ github: { pullRequestNumber: 42 } }).replace(
          /"/g,
          '\\"',
        ),
      );
    });
  });

  describe("request", () => {
    test("a pull request with no review yet gets its task, Queued, a minute's wait away", async () => {
      jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
      const create: jest.SpyInstance = jest
        .spyOn(AIRunService, "create")
        .mockImplementation(async (data: { data: AIRun }) => {
          return data.data;
        });

      await ProductionReviewQueue.request(
        request({ pullRequestTitle: `fix:\n${"x".repeat(300)}` }),
      );

      const run: AIRun = (create.mock.calls[0]![0] as { data: AIRun }).data;

      expect(run.projectId).toBe(PROJECT_ID);
      expect(run.runType).toBe(AIRunType.CodeFix);
      expect(run.codeFixTaskType).toBe(
        CodeFixTaskType.GitHubPullRequestProductionReview,
      );
      expect(run.status).toBe(AIRunStatus.Queued);
      expect(run.codeRepositoryId).toBe(REPOSITORY_ID);
      expect(run.title!.length).toBe(120);
      expect(run.title!.includes("\n")).toBe(false);
      expect(run.userId).toBeUndefined();
      expect(run.taskContext).toEqual({
        github: {
          codeRepositoryId: REPOSITORY_ID.toString(),
          installationId: "4242",
          organizationName: "acme",
          repositoryName: "checkout",
          commandType: GitHubCommandType.ProductionReview,
          instruction: "",
          pullRequestNumber: 42,
          isPullRequestFromFork: false,
          triggeredByLogin: "octo-dev",
        },
        productionReview: {
          requestNumber: 1,
          requestedAt: "2026-10-22T10:00:00.000Z",
          headSha: "abc1234def",
          trigger: ProductionReviewTrigger.PullRequestChanged,
          isAuthorTrusted: true,
          requestedByLogin: "octo-dev",
        },
      });
      expect(lock).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    });

    test("someone who asked, and waits, is due at once - and is who asked", async () => {
      jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
      const create: jest.SpyInstance = jest
        .spyOn(AIRunService, "create")
        .mockImplementation(async (data: { data: AIRun }) => {
          return data.data;
        });

      await ProductionReviewQueue.request(
        request({
          isImmediate: true,
          trigger: ProductionReviewTrigger.OneUptime,
          requestedByUserId: USER_ID,
          requestedByLogin: undefined,
        }),
      );

      const run: AIRun = (create.mock.calls[0]![0] as { data: AIRun }).data;
      const review: ProductionReviewTaskContext =
        run.taskContext!.productionReview!;

      expect(run.userId).toBe(USER_ID);
      expect(getDueAt(review).getTime()).toBeLessThanOrEqual(Date.now());
      expect(review.requestedByLogin).toBeUndefined();
    });

    test("a Queued review is asked again in place: the newest push, the wait from now", async () => {
      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(task(AIRunStatus.Queued));
      const transition: jest.SpyInstance = jest.spyOn(
        AIRunService,
        "attemptStatusTransition",
      );
      const update: jest.SpyInstance = jest
        .spyOn(AIRunService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await ProductionReviewQueue.request(request({ headSha: "new1111" }));

      expect(transition).not.toHaveBeenCalled();

      const data: { taskContext: CodeFixTaskContext; title: string } = (
        update.mock.calls[0]![0] as {
          data: { taskContext: CodeFixTaskContext; title: string };
        }
      ).data;

      expect(data.title).toBe("fix: guard the card");
      expect(data.taskContext.productionReview).toMatchObject({
        requestNumber: 4,
        requestedAt: "2026-10-22T10:00:00.000Z",
        headSha: "new1111",
        commentId: 5150,
        failedAttempts: 0,
      });
      // What GitHub's earlier asks left on the task is kept.
      expect(data.taskContext.github?.acknowledgementCommentId).toBe(777);
    });

    test("a Running review is asked again without being moved: it is queued again when it finishes", async () => {
      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(task(AIRunStatus.Running));
      const transition: jest.SpyInstance = jest.spyOn(
        AIRunService,
        "attemptStatusTransition",
      );
      const update: jest.SpyInstance = jest
        .spyOn(AIRunService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await ProductionReviewQueue.request(request());

      expect(transition).not.toHaveBeenCalled();
      expect(
        (
          update.mock.calls[0]![0] as {
            data: { taskContext: CodeFixTaskContext };
          }
        ).data.taskContext.productionReview?.requestNumber,
      ).toBe(4);
    });

    test("a finished review is queued again, its last error cleared", async () => {
      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(task(AIRunStatus.Completed));
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);
      const update: jest.SpyInstance = jest
        .spyOn(AIRunService, "updateOneById")
        .mockResolvedValue(undefined as never);

      const run: AIRun = await ProductionReviewQueue.request(request());

      expect(run.status).toBe(AIRunStatus.Queued);

      const set: {
        status: AIRunStatus;
        errorMessage: string;
        taskContext: CodeFixTaskContext;
      } = (
        transition.mock.calls[0]![0] as {
          set: {
            status: AIRunStatus;
            errorMessage: string;
            taskContext: CodeFixTaskContext;
          };
        }
      ).set;

      expect(
        (transition.mock.calls[0]![0] as { fromStatus: AIRunStatus })
          .fromStatus,
      ).toBe(AIRunStatus.Completed);
      expect(set.status).toBe(AIRunStatus.Queued);
      expect(set.errorMessage).toBe("");
      expect(set.taskContext.productionReview?.requestNumber).toBe(4);

      // Only the title is written beside the transition.
      expect((update.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
        title: "fix: guard the card",
      });
    });

    test("a finished review that moved meanwhile still gets the ask", async () => {
      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(task(AIRunStatus.Error));
      jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);
      const update: jest.SpyInstance = jest
        .spyOn(AIRunService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await ProductionReviewQueue.request(request());

      expect(
        (
          update.mock.calls[0]![0] as {
            data: { taskContext: CodeFixTaskContext };
          }
        ).data.taskContext.productionReview?.requestNumber,
      ).toBe(4);
    });

    test("a lock that cannot be had does not lose the ask", async () => {
      lock.mockRejectedValue(new Error("Valkey is down"));
      jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
      const create: jest.SpyInstance = jest
        .spyOn(AIRunService, "create")
        .mockImplementation(async (data: { data: AIRun }) => {
          return data.data;
        });

      await ProductionReviewQueue.request(request());

      expect(create).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
    });
  });

  describe("claimDue", () => {
    function queued(
      id: string,
      requestedAt: string,
      context?: CodeFixTaskContext,
    ): AIRun {
      const run: AIRun = task(
        AIRunStatus.Queued,
        context || reviewContext({ requestedAt }),
      );
      run.id = new ObjectID(id);
      return run;
    }

    test("claims the reviews past their wait, each by one conditional update; passes over the rest", async () => {
      jest
        .spyOn(AIRunService, "findBy")
        .mockResolvedValue([
          queued(
            "90a1b2c3-0001-4222-8333-444455556666",
            "2026-10-22T09:58:00.000Z",
          ),
          queued(
            "90a1b2c3-0002-4222-8333-444455556666",
            "2026-10-22T09:59:30.000Z",
          ),
          queued(
            "90a1b2c3-0003-4222-8333-444455556666",
            "2026-10-22T09:58:00.000Z",
          ),
        ]);

      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      const claimed: Array<AIRun> = await ProductionReviewQueue.claimDue();

      expect(
        claimed.map((run: AIRun) => {
          return run.id!.toString();
        }),
      ).toEqual(["90a1b2c3-0001-4222-8333-444455556666"]);
      expect(claimed[0]!.status).toBe(AIRunStatus.Running);
      expect(claimed[0]!.attemptCount).toBe(3);

      // Two due (one lost to another worker); the one asked 30s ago waits.
      expect(transition).toHaveBeenCalledTimes(2);
      expect(transition.mock.calls[0]![0]).toMatchObject({
        fromStatus: AIRunStatus.Queued,
        expectedAttemptCount: 2,
        set: { status: AIRunStatus.Running, attemptCount: 3 },
      });
    });

    test("only Queued production reviews are read", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(AIRunService, "findBy")
        .mockResolvedValue([]);

      await ProductionReviewQueue.claimDue();

      expect((findBy.mock.calls[0]![0] as { query: JSONObject }).query).toEqual(
        {
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.GitHubPullRequestProductionReview,
          status: AIRunStatus.Queued,
        },
      );
    });

    test("a review that does not say what to review ends with why", async () => {
      jest.spyOn(AIRunService, "findBy").mockResolvedValue([
        queued("90a1b2c3-0001-4222-8333-444455556666", "", {
          github: reviewContext().github,
        }),
      ]);
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      expect(await ProductionReviewQueue.claimDue()).toEqual([]);
      expect(transition.mock.calls[0]![0]).toMatchObject({
        fromStatus: AIRunStatus.Queued,
        set: {
          status: AIRunStatus.Error,
          errorMessage:
            "This production review does not say which pull request to review.",
        },
      });
    });

    test("claims a bounded number per tick", async () => {
      jest.spyOn(AIRunService, "findBy").mockResolvedValue(
        Array.from({ length: 30 }, (_value: unknown, index: number) => {
          return queued(
            `90a1b2c3-${String(index).padStart(4, "0")}-4222-8333-444455556666`,
            "2026-10-22T09:00:00.000Z",
          );
        }),
      );
      jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

      expect(await ProductionReviewQueue.claimDue()).toHaveLength(
        PRODUCTION_REVIEW_CLAIMS_PER_TICK,
      );
    });
  });

  describe("finish", () => {
    const outcome: CodeTaskOutcome = {
      summary: "Production review: 1 exception in or around the changed code.",
      filesChanged: [],
    };

    test("a review that answered the latest ask is Completed, with what it found and kept", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(task(AIRunStatus.Running));
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      expect(
        await ProductionReviewQueue.finish({
          run: task(AIRunStatus.Running),
          requestNumber: 3,
          outcome,
          update: {
            commentId: 6000,
            commentUrl: "https://github.com/acme/checkout/pull/42#c",
            commentPosting: ProductionReviewPosting.Review,
            reviewedHeadSha: "new1111",
            aiInputHash: undefined,
          },
        }),
      ).toBe("Completed");

      const set: JSONObject = (
        transition.mock.calls[0]![0] as { set: JSONObject }
      ).set;

      expect(set["status"]).toBe(AIRunStatus.Completed);
      expect(set["taskOutcome"]).toEqual(outcome);
      expect(set["completedAt"]).toEqual(new Date("2026-10-22T10:00:00.000Z"));
      expect(set["errorMessage"]).toBe("");
      expect(
        (set["taskContext"] as CodeFixTaskContext).productionReview,
      ).toEqual({
        ...reviewContext().productionReview,
        commentId: 6000,
        commentUrl: "https://github.com/acme/checkout/pull/42#c",
        commentPosting: ProductionReviewPosting.Review,
        reviewedHeadSha: "new1111",
        failedAttempts: 0,
      });
    });

    test("a review asked again while it ran is queued again, its findings kept", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(
          task(AIRunStatus.Running, reviewContext({ requestNumber: 5 })),
        );
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      expect(
        await ProductionReviewQueue.finish({
          run: task(AIRunStatus.Running),
          requestNumber: 3,
          outcome,
          update: {},
        }),
      ).toBe("QueuedAgain");

      const set: JSONObject = (
        transition.mock.calls[0]![0] as { set: JSONObject }
      ).set;

      expect(set["status"]).toBe(AIRunStatus.Queued);
      expect(set["completedAt"]).toBeUndefined();
      expect(set["taskOutcome"]).toEqual(outcome);
    });

    test("a review stopped while it ran is left as it is", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(task(AIRunStatus.Cancelled));
      const transition: jest.SpyInstance = jest.spyOn(
        AIRunService,
        "attemptStatusTransition",
      );

      expect(
        await ProductionReviewQueue.finish({
          run: task(AIRunStatus.Running),
          requestNumber: 3,
          outcome,
          update: {},
        }),
      ).toBe("Gone");
      expect(transition).not.toHaveBeenCalled();
    });

    test("a review that ends without reviewing keeps the last outcome, and says why", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(task(AIRunStatus.Running));
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      await ProductionReviewQueue.finish({
        run: task(AIRunStatus.Running),
        requestNumber: 3,
        outcome: null,
        update: {},
        errorMessage: "The pull request is closed, so it was not reviewed.",
      });

      const set: JSONObject = (
        transition.mock.calls[0]![0] as { set: JSONObject }
      ).set;

      expect(set["taskOutcome"]).toBeUndefined();
      expect(set["errorMessage"]).toBe(
        "The pull request is closed, so it was not reviewed.",
      );
    });
  });

  describe("fail", () => {
    test("a failure worth trying again is queued again, due a little later", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(
          task(AIRunStatus.Running, reviewContext({ failedAttempts: 0 })),
        );
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      await ProductionReviewQueue.fail({
        run: task(AIRunStatus.Running),
        requestNumber: 3,
        errorMessage: "GitHub answered 502.",
        isRetryable: true,
      });

      const set: { status: AIRunStatus; taskContext: CodeFixTaskContext } = (
        transition.mock.calls[0]![0] as {
          set: { status: AIRunStatus; taskContext: CodeFixTaskContext };
        }
      ).set;

      expect(set.status).toBe(AIRunStatus.Queued);
      expect(set.taskContext.productionReview?.failedAttempts).toBe(1);
      expect(getDueAt(set.taskContext.productionReview!).toISOString()).toBe(
        new Date(
          Date.now() + PRODUCTION_REVIEW_RETRY_SECONDS * 1000,
        ).toISOString(),
      );
    });

    test("after the last try, or a failure no retry fixes, it ends with why", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(
          task(AIRunStatus.Running, reviewContext({ failedAttempts: 1 })),
        );
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      await ProductionReviewQueue.fail({
        run: task(AIRunStatus.Running),
        requestNumber: 3,
        errorMessage: "GitHub answered 502.",
        isRetryable: true,
      });

      expect(
        (transition.mock.calls[0]![0] as { set: JSONObject }).set,
      ).toMatchObject({
        status: AIRunStatus.Error,
        errorMessage: "GitHub answered 502.",
      });

      transition.mockClear();

      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(
          task(AIRunStatus.Running, reviewContext({ failedAttempts: 0 })),
        );

      await ProductionReviewQueue.fail({
        run: task(AIRunStatus.Running),
        requestNumber: 3,
        errorMessage: "Not retryable.",
        isRetryable: false,
      });

      expect(
        (transition.mock.calls[0]![0] as { set: JSONObject }).set["status"],
      ).toBe(AIRunStatus.Error);
    });

    test("a review asked again while it failed is queued again for the new ask", async () => {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(
          task(
            AIRunStatus.Running,
            reviewContext({ requestNumber: 4, failedAttempts: 1 }),
          ),
        );
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      await ProductionReviewQueue.fail({
        run: task(AIRunStatus.Running),
        requestNumber: 3,
        errorMessage: "x",
        isRetryable: false,
      });

      const set: { status: AIRunStatus; taskContext: CodeFixTaskContext } = (
        transition.mock.calls[0]![0] as {
          set: { status: AIRunStatus; taskContext: CodeFixTaskContext };
        }
      ).set;

      expect(set.status).toBe(AIRunStatus.Queued);
      expect(set.taskContext.productionReview?.failedAttempts).toBe(0);
      expect(set.taskContext.productionReview?.requestedAt).toBe(
        "2026-10-22T09:00:00.000Z",
      );
    });
  });

  test("requeueStale: a review whose worker died is queued again", async () => {
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    expect(await ProductionReviewQueue.requeueStale({ id: RUN_ID })).toBe(1);
    expect(transition).toHaveBeenCalledWith({
      aiRunId: RUN_ID,
      fromStatus: AIRunStatus.Running,
      set: { status: AIRunStatus.Queued },
    });
  });
});

describe("getDueAt and toTaskTitle", () => {
  test("a review is due the debounce after it was asked", () => {
    expect(
      getDueAt({
        requestNumber: 1,
        requestedAt: "2026-10-22T10:00:00.000Z",
        headSha: "",
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
      }).toISOString(),
    ).toBe(
      new Date(
        new Date("2026-10-22T10:00:00.000Z").getTime() +
          PRODUCTION_REVIEW_DEBOUNCE_SECONDS * 1000,
      ).toISOString(),
    );
  });

  test("a task's title is the pull request's, on one line, cut", () => {
    expect(toTaskTitle("fix:\n  guard   the card")).toBe("fix: guard the card");
    expect(toTaskTitle("x".repeat(200)).length).toBe(120);
    expect(toTaskTitle("")).toBe("");
  });
});

/*
 * A merge request on GitLab, or a pull request on Forgejo or Gitea: one
 * review task per pull request too, named in `codeHostPullRequest` - the
 * repository, the host, the number and its page - never in GitHub's
 * `github`, and found again by it.
 */
describe("ProductionReviewQueue: a pull request on GitLab, Forgejo or Gitea", () => {
  function hostRequest(
    change: Partial<CodeHostProductionReviewRequest> = {},
  ): CodeHostProductionReviewRequest {
    return {
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      provider: CodeRepositoryType.GitLab,
      pullRequestNumber: 12,
      pullRequestTitle: "fix: guard the card",
      pullRequestUrl:
        "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
      headSha: "abc1234def",
      isFromFork: false,
      trigger: ProductionReviewTrigger.PullRequestChanged,
      isAuthorTrusted: true,
      requestedByLogin: "dana",
      ...change,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-22T10:00:00.000Z") });
    jest.spyOn(Semaphore, "lock").mockResolvedValue({ id: "mutex" } as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("an ask is GitLab's or Forgejo's by its provider; GitHub's names none", () => {
    expect(isCodeHostReviewRequest(hostRequest())).toBe(true);
    expect(
      isCodeHostReviewRequest(
        hostRequest({ provider: CodeRepositoryType.Forgejo }),
      ),
    ).toBe(true);
    expect(isCodeHostReviewRequest(request())).toBe(false);
  });

  test("its task is found by the pull request named in codeHostPullRequest", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);

    await ProductionReviewQueue.findTask({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      pullRequestNumber: 12,
      provider: CodeRepositoryType.GitLab,
    });

    const context: string = JSON.stringify(
      (findOneBy.mock.calls[0]![0] as { query: JSONObject }).query[
        "taskContext"
      ],
    );

    expect(context).toContain("codeHostPullRequest");
    expect(context).not.toContain('\\"github\\"');
  });

  test("a merge request with no review yet gets its task, naming it in codeHostPullRequest", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockImplementation(async (data: { data: AIRun }) => {
        return data.data;
      });

    await ProductionReviewQueue.request(hostRequest());

    const run: AIRun = (create.mock.calls[0]![0] as { data: AIRun }).data;

    expect(run.codeFixTaskType).toBe(
      CodeFixTaskType.GitHubPullRequestProductionReview,
    );
    expect(run.taskContext).toEqual({
      codeHostPullRequest: {
        codeRepositoryId: REPOSITORY_ID.toString(),
        provider: CodeRepositoryType.GitLab,
        pullRequestNumber: 12,
        isPullRequestFromFork: false,
        pullRequestUrl:
          "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
        triggeredByLogin: "dana",
      },
      productionReview: {
        requestNumber: 1,
        requestedAt: "2026-10-22T10:00:00.000Z",
        headSha: "abc1234def",
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
        requestedByLogin: "dana",
      },
    });
  });

  test("asked again: the newest head, and the page an earlier ask gave when this one says none", async () => {
    const existing: AIRun = task(AIRunStatus.Queued, {
      codeHostPullRequest: {
        codeRepositoryId: REPOSITORY_ID.toString(),
        provider: CodeRepositoryType.Forgejo,
        pullRequestNumber: 12,
        pullRequestUrl: "https://git.example.com/acme/checkout/pulls/12",
      },
      productionReview: {
        requestNumber: 2,
        requestedAt: "2026-10-22T09:00:00.000Z",
        headSha: "old0000",
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
        commentId: 41,
      },
    });
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(existing);
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await ProductionReviewQueue.request(
      hostRequest({
        provider: CodeRepositoryType.Forgejo,
        pullRequestUrl: undefined,
        headSha: "new1111",
        trigger: ProductionReviewTrigger.OneUptime,
        requestedByLogin: undefined,
      }),
    );

    const context: CodeFixTaskContext = (
      update.mock.calls[0]![0] as { data: { taskContext: CodeFixTaskContext } }
    ).data.taskContext;

    expect(context.codeHostPullRequest).toEqual({
      codeRepositoryId: REPOSITORY_ID.toString(),
      provider: CodeRepositoryType.Forgejo,
      pullRequestNumber: 12,
      isPullRequestFromFork: false,
      pullRequestUrl: "https://git.example.com/acme/checkout/pulls/12",
    });
    expect(context.github).toBeUndefined();
    expect(context.productionReview).toMatchObject({
      requestNumber: 3,
      headSha: "new1111",
      commentId: 41,
      trigger: ProductionReviewTrigger.OneUptime,
    });
  });

  test("its finish holds the lock of the pull request it names", async () => {
    const lock: jest.SpyInstance = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "mutex" } as never);
    const running: AIRun = task(AIRunStatus.Running, {
      codeHostPullRequest: {
        codeRepositoryId: REPOSITORY_ID.toString(),
        provider: CodeRepositoryType.GitLab,
        pullRequestNumber: 12,
      },
      productionReview: {
        requestNumber: 1,
        requestedAt: "2026-10-22T09:00:00.000Z",
        headSha: "abc",
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
      },
    });
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(running);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await ProductionReviewQueue.finish({
      run: running,
      requestNumber: 1,
      outcome: null,
      update: { checkRunId: 7700, checkRunHeadSha: "abc" },
    });

    expect((lock.mock.calls[0]![0] as { key: string }).key).toBe(
      `${REPOSITORY_ID.toString()}:12`,
    );
  });
});
