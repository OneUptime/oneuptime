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
 *   3. one sweep at a time is RunCron's (CronLock, issue #8103): the job
 *      takes no Redis lock of its own any more;
 *   4. the sweep gets a deadline inside the job timeout, and the run's
 *      deadline to check between pages - it passes at the time limit and as
 *      soon as the run's lease is lost;
 *   5. the handler never throws.
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

import Semaphore from "Common/Server/Infrastructure/Semaphore";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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

async function runTick(deadline?: JobDeadline): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(
      `Cron handler ${JOB_NAME} was not registered - the RunCron mock never saw it.`,
    );
  }

  await handler(deadline);
}

function sweepOptions(): TelemetryIngestionBudgetSweepOptions {
  expect(publishAllMock).toHaveBeenCalledTimes(1);
  return publishAllMock.mock
    .calls[0]![0] as TelemetryIngestionBudgetSweepOptions;
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
  test("gets a deadline three and a half minutes out, inside the job timeout", async () => {
    await runTick();

    const deadline: Date | undefined = sweepOptions().deadline;

    expect(deadline?.toISOString()).toBe(
      new Date(NOW.getTime() + 210 * 1000).toISOString(),
    );
    expect(deadline!.getTime() - NOW.getTime()).toBeLessThan(FOUR_MINUTES_MS);
  });

  /*
   * Between pages the sweep asks whether the run's deadline has passed - its
   * time limit, or its lease lost (CronLock ends it then, as another run may
   * hold the lock).
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
    publishAllMock.mockRejectedValue(new Error("ClickHouse is down"));

    await expect(runTick(new JobDeadline())).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the sweep failed"),
    );
  });
});
