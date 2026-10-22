import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIRunType from "Common/Types/AI/AIRunType";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import ObjectID from "Common/Types/ObjectID";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A STALE PRODUCTION REVIEW. A pull request's production review is a
 * code-fix run the server runs itself, and it only reads: a worker that
 * died mid-review left nothing half done, so the stuck-run sweeper queues
 * it again for the next worker - unlike a code-fix run a Runner works on,
 * which may have pushed a partial branch and is only ever failed. The REAL
 * RunCron and JobDictionary run here; the queues under them and the AI run
 * reads are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockFindRuns: jest.Mock = jest.fn();
const mockMarkStaleRunAsError: jest.Mock = jest.fn();
const mockRequeueStale: jest.Mock = jest.fn();
const mockUpdateRun: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: mockAddJob,
    },
  };
});

jest.mock("Common/Server/Services/AIRunService", () => {
  return {
    __esModule: true,
    default: {
      findBy: mockFindRuns,
      updateOneById: mockUpdateRun,
    },
  };
});

jest.mock("Common/Server/Services/AIConversationMessageService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(() => {
        return Promise.resolve([]);
      }),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/AI/SRE/InvestigationQueue", () => {
  return {
    __esModule: true,
    default: {
      requeueOrMarkStale: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/AI/CodeFix/CodeFixRunQueue", () => {
  return {
    __esModule: true,
    default: {
      markStaleRunAsError: mockMarkStaleRunAsError,
    },
  };
});

jest.mock(
  "Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue",
  () => {
    return {
      __esModule: true,
      default: {
        requeueStale: mockRequeueStale,
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * Imported AFTER the mocks; the job import comes last - its side effects
 * are what this file is about.
 */
import AIRun from "Common/Models/DatabaseModels/AIRun";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns";

const JOB_NAME: string = "AIChat:TimeoutStuckRuns";

function staleCodeFixRun(recipe: CodeFixTaskType | undefined): AIRun {
  const run: AIRun = new AIRun();
  run._id = ObjectID.generate().toString();
  run.runType = AIRunType.CodeFix;
  if (recipe) {
    run.codeFixTaskType = recipe;
  }
  run.status = AIRunStatus.Running;
  run.attemptCount = 1;
  run.projectId = ObjectID.generate();
  run.lastHeartbeatAt = new Date("2026-10-22T10:00:00.000Z");
  return run;
}

beforeEach(() => {
  mockFindRuns.mockReset();
  mockMarkStaleRunAsError.mockReset();
  mockRequeueStale.mockReset();
  mockUpdateRun.mockReset();
  mockRequeueStale.mockResolvedValue(1 as never);
  mockMarkStaleRunAsError.mockResolvedValue(undefined as never);
});

describe("the stuck-run sweeper and a pull request's production review", () => {
  test("reads which recipe every stale run is", async () => {
    mockFindRuns.mockResolvedValue([] as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    const read: { select: Record<string, unknown> } = mockFindRuns.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(read.select["codeFixTaskType"]).toBe(true);
    expect(read.select["runType"]).toBe(true);
  });

  test("queues a stale production review again: it only reads, so the next worker reviews it", async () => {
    const review: AIRun = staleCodeFixRun(
      CodeFixTaskType.GitHubPullRequestProductionReview,
    );
    mockFindRuns.mockResolvedValue([review] as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    expect(mockRequeueStale).toHaveBeenCalledTimes(1);
    expect(
      (mockRequeueStale.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(review.id!.toString());
    expect(mockMarkStaleRunAsError).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  test("a code-fix run a Runner worked on is still only failed, never queued again", async () => {
    for (const recipe of [
      CodeFixTaskType.CodeRequest,
      CodeFixTaskType.FixException,
      CodeFixTaskType.GitHubPullRequestReview,
      undefined,
    ]) {
      mockFindRuns.mockResolvedValueOnce([staleCodeFixRun(recipe)] as never);

      await JobDictionary.getJobFunction(JOB_NAME)();
    }

    expect(mockMarkStaleRunAsError).toHaveBeenCalledTimes(4);
    expect(mockRequeueStale).not.toHaveBeenCalled();
  });

  test("one review that cannot be queued again does not stop the sweep", async () => {
    const first: AIRun = staleCodeFixRun(
      CodeFixTaskType.GitHubPullRequestProductionReview,
    );
    const second: AIRun = staleCodeFixRun(CodeFixTaskType.CodeRequest);
    mockFindRuns.mockResolvedValue([first, second] as never);
    mockRequeueStale.mockRejectedValueOnce(new Error("database down") as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    expect(mockRequeueStale).toHaveBeenCalledTimes(1);
    expect(mockMarkStaleRunAsError).toHaveBeenCalledTimes(1);
  });
});
