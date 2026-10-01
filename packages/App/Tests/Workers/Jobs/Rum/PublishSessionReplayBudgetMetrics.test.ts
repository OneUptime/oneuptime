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
 *   3. one sweep at a time, through the Redis lock, and a contended lock
 *      skips the tick (quietly) while a broken Redis says so (loudly);
 *   4. the sweep gets the daily limit the ingest gate enforces, a deadline
 *      inside the job timeout, and the mutex's isAcquired to check between
 *      pages - kept current by a 30-second lock refresh, with a lost lock
 *      handled rather than thrown from the refresh timer;
 *   5. the lock is released however the sweep ends, and the handler never
 *      throws.
 *
 * The Cron util is mocked to capture the handler, the same recorder the
 * other App/Tests/Workers/Jobs suites use; the sweep, the Semaphore and the
 * Telemetry Config are replaced with factories so no database, Redis or
 * BullMQ loads.
 */

type CronHandler = () => Promise<void>;

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

import Semaphore, {
  SemaphoreLockTimeoutError,
} from "Common/Server/Infrastructure/Semaphore";
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

interface MockMutex {
  identifier: string;
  isAcquired: boolean;
}

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

let mutex: MockMutex;

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(
      `Cron handler ${JOB_NAME} was not registered - the RunCron mock never saw it.`,
    );
  }

  await handler();
}

function sweepOptions(): SessionReplayBudgetSweepOptions {
  expect(publishAllMock).toHaveBeenCalledTimes(1);
  return publishAllMock.mock.calls[0]![0] as SessionReplayBudgetSweepOptions;
}

beforeEach(() => {
  jest.resetAllMocks();

  mutex = { identifier: "budget-sweep-mutex", isAcquired: true };
  lockMock.mockResolvedValue(mutex);
  releaseMock.mockResolvedValue(undefined);
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
  test("takes the sweep lock under the job's name, without queueing behind a sweep in flight", async () => {
    await runTick();

    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(lockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: JOB_NAME,
        namespace: "Workers.Cron",
        lockTimeout: FOUR_MINUTES_MS,
        acquireAttemptsLimit: 1,
      }),
    );
  });

  /*
   * isAcquired only turns false when a refresh finds the lock gone, so the
   * check between pages is only as fresh as the refresh interval.
   * redis-semaphore's default (80% of the four-minute lock) would leave it
   * blind for 192 seconds of a 210-second sweep.
   */
  test("refreshes the lock every 30 seconds, so a lost lock is noticed between pages", async () => {
    await runTick();

    const options: { refreshInterval?: number } = lockMock.mock
      .calls[0]![0] as { refreshInterval?: number };

    expect(options.refreshInterval).toBe(30 * 1000);
    expect(options.refreshInterval!).toBeLessThan(FOUR_MINUTES_MS / 4);
  });

  /*
   * Without a handler redis-semaphore throws from its refresh timer: an
   * unhandled rejection the process logs as an error, instead of the sweep
   * stopping quietly at its next page.
   */
  test("handles a lost lock itself: a warning, never a throw from the refresh timer", async () => {
    await runTick();

    const onLockLost: ((err: Error) => void) | undefined = (
      lockMock.mock.calls[0]![0] as { onLockLost?: (err: Error) => void }
    ).onLockLost;

    expect(onLockLost).toBeInstanceOf(Function);

    const lost: Error = new Error("Lost mutex for key");

    expect(() => {
      onLockLost!(lost);
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("lost the sweep lock"),
    );
    expect(logger.warn).toHaveBeenCalledWith(lost);
  });

  test("a sweep already running skips the tick, quietly", async () => {
    lockMock.mockRejectedValue(new SemaphoreLockTimeoutError("busy"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(publishAllMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a lock that fails for any other reason skips the tick and says so", async () => {
    lockMock.mockRejectedValue(new Error("Redis connection refused"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(publishAllMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not take the sweep lock"),
    );
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
   * What this pins is the wiring: between pages the sweep reads the mutex's
   * own isAcquired. How soon a real mutex reports a loss there is set by the
   * lock's refresh interval (the 30-second test above) - redis-semaphore only
   * turns isAcquired false when a refresh finds the lock gone.
   */
  test("reads the mutex's isAcquired between pages", async () => {
    await runTick();

    const shouldContinue: (() => boolean) | undefined =
      sweepOptions().shouldContinue;

    expect(shouldContinue).toBeDefined();
    expect(shouldContinue!()).toBe(true);

    mutex.isAcquired = false;

    expect(shouldContinue!()).toBe(false);
  });

  test("releases the lock it took once the sweep is done", async () => {
    await runTick();

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(mutex);
  });
});

describe("the handler never throws", () => {
  test("a sweep that throws is logged, and the lock is still released", async () => {
    publishAllMock.mockRejectedValue(new Error("unexpected"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the sweep failed"),
    );
    expect(releaseMock).toHaveBeenCalledWith(mutex);
  });

  test("a release that fails is logged and swallowed - the lock expires on its own", async () => {
    releaseMock.mockRejectedValue(new Error("Redis went away"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not release the sweep lock"),
    );
  });
});
