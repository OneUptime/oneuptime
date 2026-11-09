import fs from "fs";
import path from "path";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES } from "Common/Utils/Telemetry/TelemetryIngestionBudgetMetricType";

/*
 * TelemetryIngestionBudget:PublishTelemetryIngestionBudgetMetrics is the
 * thin cron around TelemetryIngestionBudgetMetrics.publishAll (issue #5917;
 * the sweep's logic is pinned in Common's TelemetryIngestionBudgetMetrics
 * tests). What is pinned here is the wiring a unit test of the sweep cannot
 * see, as PublishSessionReplayBudgetMetrics.test.ts pins its twin's:
 *
 *   1. the job registers under its permanent name and cadence, and the
 *      worker Index imports it;
 *   2. the cadence is the interval the metric descriptions and the docs'
 *      15-minute monitor window are built on;
 *   3. one sweep at a time, through the Redis lock, refreshed every 30
 *      seconds; a contended lock skips the tick quietly, a broken Redis
 *      says so;
 *   4. the sweep gets a deadline inside the job timeout and the mutex's
 *      isAcquired to check between pages;
 *   5. the lock is released however the sweep ends, and the handler never
 *      throws.
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
  "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetMetrics",
  () => {
    return {
      __esModule: true,
      default: {
        publishAll: jest.fn(),
      },
    };
  },
);

import Semaphore, {
  SemaphoreLockTimeoutError,
} from "Common/Server/Infrastructure/Semaphore";
import TelemetryIngestionBudgetMetrics, {
  TelemetryIngestionBudgetSweepOptions,
  TelemetryIngestionBudgetSweepSummary,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetMetrics";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import { PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME } from "../../../../FeatureSet/Workers/Jobs/TelemetryIngestionBudget/PublishTelemetryIngestionBudgetMetrics";

const JOB_NAME: string =
  "TelemetryIngestionBudget:PublishTelemetryIngestionBudgetMetrics";
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");
const FOUR_MINUTES_MS: number = 4 * 60 * 1000;

interface MockMutex {
  identifier: string;
  isAcquired: boolean;
}

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const releaseMock: jest.Mock = Semaphore.release as unknown as jest.Mock;
const publishAllMock: jest.Mock =
  TelemetryIngestionBudgetMetrics.publishAll as unknown as jest.Mock;

const DONE: TelemetryIngestionBudgetSweepSummary = {
  stopReason: "done",
  dayId: "20261109T0000Z",
  scopesScanned: 3,
  pagesFailed: 0,
  rowsWritten: 9,
  noticesSent: 1,
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

function sweepOptions(): TelemetryIngestionBudgetSweepOptions {
  expect(publishAllMock).toHaveBeenCalledTimes(1);
  return publishAllMock.mock
    .calls[0]![0] as TelemetryIngestionBudgetSweepOptions;
}

beforeEach(() => {
  jest.resetAllMocks();

  mutex = { identifier: "ingestion-budget-sweep-mutex", isAcquired: true };
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
    expect(PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME).toBe(JOB_NAME);
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
      timeoutInMS: FOUR_MINUTES_MS,
    });
  });

  test("at the interval the metric descriptions and the docs' monitor window are built on", () => {
    expect(mockCapturedOptions[JOB_NAME]?.schedule).toBe(
      `*/${TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES} * * * *`,
    );
  });

  test("is imported by the worker Index - an unimported job never registers", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "FeatureSet",
        "Workers",
        "Index.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import "./Jobs/TelemetryIngestionBudget/PublishTelemetryIngestionBudgetMetrics";',
    );
  });
});

describe("one sweep at a time", () => {
  test("takes the sweep lock under the job's name, refreshed every 30 seconds, without queueing", async () => {
    await runTick();

    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(lockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: JOB_NAME,
        namespace: "Workers.Cron",
        lockTimeout: FOUR_MINUTES_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: 30 * 1000,
      }),
    );
  });

  test("handles a lost lock itself: a warning, never a throw from the refresh timer", async () => {
    await runTick();

    const onLockLost: ((err: Error) => void) | undefined = (
      lockMock.mock.calls[0]![0] as { onLockLost?: (err: Error) => void }
    ).onLockLost;
    const lost: Error = new Error("Lost mutex for key");

    expect(() => {
      onLockLost!(lost);
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("lost the sweep lock"),
    );
  });

  test("a sweep already running skips the tick, quietly", async () => {
    lockMock.mockRejectedValue(new SemaphoreLockTimeoutError("busy"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(publishAllMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
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
  test("gets a deadline three and a half minutes out, inside the job timeout", async () => {
    await runTick();

    const deadline: Date | undefined = sweepOptions().deadline;

    expect(deadline?.toISOString()).toBe(
      new Date(NOW.getTime() + 210 * 1000).toISOString(),
    );
    expect(deadline!.getTime() - NOW.getTime()).toBeLessThan(FOUR_MINUTES_MS);
  });

  test("reads the mutex's isAcquired between pages", async () => {
    await runTick();

    const shouldContinue: (() => boolean) | undefined =
      sweepOptions().shouldContinue;

    expect(shouldContinue!()).toBe(true);
    mutex.isAcquired = false;
    expect(shouldContinue!()).toBe(false);
  });

  test("releases the lock when the sweep ends, and when it throws", async () => {
    await runTick();
    expect(releaseMock).toHaveBeenCalledWith(mutex);

    releaseMock.mockClear();
    publishAllMock.mockRejectedValue(new Error("ClickHouse is down"));

    await expect(runTick()).resolves.toBeUndefined();
    expect(releaseMock).toHaveBeenCalledWith(mutex);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the sweep failed"),
    );
  });

  test("a release that fails is logged, never thrown", async () => {
    releaseMock.mockRejectedValue(new Error("Redis went away"));

    await expect(runTick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not release the sweep lock"),
    );
  });
});
