import Semaphore from "Common/Server/Infrastructure/Semaphore";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import LlmCostBudgetEvaluator from "Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";

/*
 * Llm:EvaluateLlmCostBudgets - the fifteen-minute sweep that stamps each LLM
 * cost budget's spend and publishes the oneuptime.llm.budget.* gauges.
 *
 * Pinned here (issue #8103): RunCron runs one sweep at a time (CronLock), so
 * the job takes no Redis lock of its own any more - two interleaved sweeps
 * were what that lock kept from posting every point twice - and it hands the
 * evaluator the run's deadline, which stops the sweep between budgets at the
 * time limit or once the run's lease is lost. What the evaluator does with it
 * is pinned in LlmCostBudgetEvaluator.test.ts.
 */

type CronHandler = (deadline?: JobDeadline) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCronOptions: Record<string, unknown> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCronOptions[jobName] = options;
      },
    ),
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator", () => {
  return {
    __esModule: true,
    default: {
      evaluateAllBudgets: jest.fn(),
    },
  };
});

// Imported for its side effect: the RunCron mock above records the handler.
import "../../../../FeatureSet/Workers/Jobs/Llm/EvaluateLlmCostBudgets";

const JOB_NAME: string = "Llm:EvaluateLlmCostBudgets";

const evaluator: { evaluateAllBudgets: jest.Mock } =
  LlmCostBudgetEvaluator as unknown as { evaluateAllBudgets: jest.Mock };
const semaphore: { lock: jest.Mock; release: jest.Mock } =
  Semaphore as unknown as { lock: jest.Mock; release: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  evaluator.evaluateAllBudgets.mockResolvedValue(undefined);
});

describe("Llm:EvaluateLlmCostBudgets", () => {
  test("runs every fifteen minutes with a ten-minute time limit", () => {
    expect(typeof mockCapturedJobs[JOB_NAME]).toBe("function");
    expect(mockCronOptions[JOB_NAME]).toMatchObject({
      schedule: EVERY_FIFTEEN_MINUTE,
      runOnStartup: false,
      timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(10),
    });
  });

  test("hands the evaluator the run's deadline", async () => {
    const deadline: JobDeadline = new JobDeadline();

    await mockCapturedJobs[JOB_NAME]!(deadline);

    expect(evaluator.evaluateAllBudgets).toHaveBeenCalledTimes(1);
    expect(evaluator.evaluateAllBudgets).toHaveBeenCalledWith({
      deadline: deadline,
    });
  });

  test("takes no lock of its own: one sweep at a time is the run's lease", async () => {
    await mockCapturedJobs[JOB_NAME]!(new JobDeadline());

    expect(semaphore.lock).not.toHaveBeenCalled();
    expect(semaphore.release).not.toHaveBeenCalled();
  });

  test("run outside the queue, it hands the evaluator a deadline that never passes", async () => {
    await mockCapturedJobs[JOB_NAME]!();

    const handed: { deadline: JobDeadline } = evaluator.evaluateAllBudgets.mock
      .calls[0]![0] as { deadline: JobDeadline };

    expect(handed.deadline).toBeInstanceOf(JobDeadline);
    expect(handed.deadline.hasPassed()).toBe(false);
  });

  test("passes a failed sweep on, so the run is marked failed", async () => {
    evaluator.evaluateAllBudgets.mockRejectedValue(new Error("budget read"));

    await expect(
      mockCapturedJobs[JOB_NAME]!(new JobDeadline()),
    ).rejects.toThrow("budget read");
  });
});
