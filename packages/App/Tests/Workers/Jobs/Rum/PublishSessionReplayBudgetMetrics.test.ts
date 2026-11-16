import fs from "fs";
import path from "path";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES } from "Common/Utils/SessionReplay/SessionReplayBudgetMetricType";

/*
 * Rum:PublishSessionReplayBudgetMetrics is the thin cron around
 * SessionReplayBudgetMetrics.publishAll (whose logic is pinned in
 * Common/Tests/Server/Utils/SessionReplay/SessionReplayBudgetMetrics.test.ts).
 * What is pinned here is the wiring a unit test of the sweep cannot see:
 *
 *   1. the job registers under its permanent name and cadence (renaming it
 *      or changing the schedule orphans a repeatable in Redis), and the
 *      worker Index imports it - an unimported job never registers;
 *   2. the cadence is the interval the metric descriptions and the alert
 *      templates' 15-minute window are built on;
 *   3. one sweep at a time is RunCron's (CronLock, issue #8103): the job takes
 *      no Redis lock of its own any more;
 *   4. the sweep gets the daily limit the ingest gate enforces, a deadline
 *      inside the job timeout, and the run's deadline to check between pages
 *      - it passes at the time limit and as soon as the run's lease is lost;
 *   5. the handler never throws.
 *
 * The Cron util is mocked to capture the handler, the same recorder the
 * other App/Tests/Workers/Jobs suites use; the sweep, the Semaphore and the
 * Telemetry Config are replaced with factories so no database, Redis or
 * BullMQ loads.
 */

type CronHandler = (deadline?: JobDeadline) => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number | undefined;
}

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CronOptions> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
      },
    ),
  };
});

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

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  class MockSemaphoreLockTimeoutError extends Error {}

  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
    SemaphoreLockTimeoutError: MockSemaphoreLockTimeoutError,
  };
});

jest.mock(
  "Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics",
  () => {
    return {
      __esModule: true,
      default: {
        publishAll: jest.fn(),
      },
    };
  },
);

/*
 * A limit no default could produce, so the assertion below proves the value
 * came from the Telemetry Config the ingest gate reads, not from anywhere
 * else.
 */
const MOCK_DAILY_LIMIT: number = 123456789;

jest.mock("../../../../FeatureSet/Telemetry/Config", () => {
  return {
    __esModule: true,
    SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY: 123456789,
  };
});

import Semaphore from "Common/Server/Infrastructure/Semaphore";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import SessionReplayBudgetMetrics, {
  SessionReplayBudgetSweepOptions,
  SessionReplayBudgetSweepSummary,
} from "Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import { PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME } from "../../../../FeatureSet/Workers/Jobs/Rum/PublishSessionReplayBudgetMetrics";

const JOB_NAME: string = "Rum:PublishSessionReplayBudgetMetrics";
const NOW: Date = new Date("2026-09-29T12:00:00.000Z");
const FOUR_MINUTES_MS: number = 4 * 60 * 1000;

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const releaseMock: jest.Mock = Semaphore.release as unknown as jest.Mock;
const publishAllMock: jest.Mock =
  SessionReplayBudgetMetrics.publishAll as unknown as jest.Mock;

const DONE: SessionReplayBudgetSweepSummary = {
  stopReason: "done",
  dailyByteLimit: MOCK_DAILY_LIMIT,
  pagesScanned: 1,
  pagesFailed: 0,
  applicationsScanned: 3,
  rowsWritten: 6,
  dailyLimitMismatchSuspected: false,
};

async function runTick(deadline?: JobDeadline): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(
      `Cron handler ${JOB_NAME} was not registered - the RunCron mock never saw it.`,
    );
  }

  await handler(deadline);
}

function sweepOptions(): SessionReplayBudgetSweepOptions {
  expect(publishAllMock).toHaveBeenCalledTimes(1);
  return publishAllMock.mock.calls[0]![0] as SessionReplayBudgetSweepOptions;
}

beforeEach(() => {
  jest.resetAllMocks();

  publishAllMock.mockResolvedValue(DONE);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the cron registers itself", () => {
  test("under its permanent name, every five minutes, not on startup, with a four-minute timeout", () => {
    expect(PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME).toBe(JOB_NAME);
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
      timeoutInMS: FOUR_MINUTES_MS,
    });
  });

  test("at the interval the metric descriptions and the alert templates' window are built on", () => {
    expect(mockCapturedOptions[JOB_NAME]?.schedule).toBe(
      `*/${SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES} * * * *`,
    );
  });

  test("is imported by the worker Index - an unimported job never registers", () => {
    const indexPath: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "FeatureSet",
      "Workers",
      "Index.ts",
    );
    const source: string = fs.readFileSync(indexPath, "utf8");

    expect(source).toContain(
      'import "./Jobs/Rum/PublishSessionReplayBudgetMetrics";',
    );
  });
});

describe("one sweep at a time", () => {
  /*
   * RunCron runs one sweep at a time across every replica (CronLock), so the
   * job's own Redis lock - from when RunCron had no overlap guard - is gone.
   */
  test("takes no lock of its own: the run's lease covers it", async () => {
    await runTick(new JobDeadline());

    expect(publishAllMock).toHaveBeenCalledTimes(1);
    expect(lockMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe("the sweep", () => {
  test("gets the daily limit the ingest gate enforces", async () => {
    await runTick();

    expect(sweepOptions().dailyByteLimit).toBe(MOCK_DAILY_LIMIT);
  });

  test("gets a deadline three and a half minutes out - inside the job timeout, before the next tick", async () => {
    await runTick();

    const deadline: Date | undefined = sweepOptions().deadline;

    expect(deadline?.toISOString()).toBe(
      new Date(NOW.getTime() + 210 * 1000).toISOString(),
    );
    expect(deadline!.getTime() - NOW.getTime()).toBeLessThan(FOUR_MINUTES_MS);
  });

  /*
   * What this pins is the wiring: between pages the sweep asks whether the
   * run's deadline has passed - its time limit, or its lease lost (CronLock
   * ends it then, as another run may hold the lock).
   */
  test("checks the run's deadline between pages", async () => {
    const deadline: JobDeadline = new JobDeadline();

    await runTick(deadline);

    const shouldContinue: (() => boolean) | undefined =
      sweepOptions().shouldContinue;

    expect(shouldContinue).toBeDefined();
    expect(shouldContinue!()).toBe(true);

    deadline.end(new Error("its lock lapsed"));

    expect(shouldContinue!()).toBe(false);
  });

  test("run outside the queue, it keeps going until its own sweep deadline", async () => {
    await runTick();

    expect(sweepOptions().shouldContinue!()).toBe(true);
  });
});

describe("the handler never throws", () => {
  test("a sweep that throws is logged", async () => {
    publishAllMock.mockRejectedValue(new Error("unexpected"));

    await expect(runTick(new JobDeadline())).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the sweep failed"),
    );
  });
});
