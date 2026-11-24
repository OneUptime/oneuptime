import fs from "fs";
import path from "path";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES } from "Common/Utils/Telemetry/TelemetryUsageMetricType";
import { TELEMETRY_USAGE_BUCKET_MINUTES } from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionCounter";

/*
 * TelemetryUsage:PublishTelemetryUsageMetrics is the thin cron around
 * TelemetryUsageMetrics.publishAll (issue #6355; the sweep's logic is pinned
 * in Common's TelemetryUsageMetrics tests). What is pinned here is the
 * wiring a unit test of the sweep cannot see, as
 * PublishTelemetryIngestionBudgetMetrics.test.ts pins its twin's:
 *
 *   1. the job registers under its permanent name and cadence, and the
 *      worker Index imports it;
 *   2. the cadence is the five minutes each point covers, the counters'
 *      bucket;
 *   3. the sweep gets a deadline inside the job timeout, and the run's
 *      deadline to check between pages;
 *   4. the handler never throws.
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

jest.mock("Common/Server/Utils/Telemetry/TelemetryUsageMetrics", () => {
  return {
    __esModule: true,
    default: {
      publishAll: jest.fn(),
    },
  };
});

import JobDeadline from "Common/Server/Utils/JobDeadline";
import TelemetryUsageMetrics, {
  TelemetryUsageSweepOptions,
  TelemetryUsageSweepSummary,
} from "Common/Server/Utils/Telemetry/TelemetryUsageMetrics";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import { PUBLISH_TELEMETRY_USAGE_METRICS_JOB_NAME } from "../../../../FeatureSet/Workers/Jobs/TelemetryUsage/PublishTelemetryUsageMetrics";

const JOB_NAME: string = "TelemetryUsage:PublishTelemetryUsageMetrics";
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");
const FOUR_MINUTES_MS: number = 4 * 60 * 1000;

const publishAllMock: jest.Mock =
  TelemetryUsageMetrics.publishAll as unknown as jest.Mock;

const DONE: TelemetryUsageSweepSummary = {
  stopReason: "done",
  bucketsRead: 1,
  projectsScanned: 3,
  pagesFailed: 0,
  rowsWritten: 9,
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

function sweepOptions(): TelemetryUsageSweepOptions {
  expect(publishAllMock).toHaveBeenCalledTimes(1);
  return publishAllMock.mock.calls[0]![0] as TelemetryUsageSweepOptions;
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
    expect(PUBLISH_TELEMETRY_USAGE_METRICS_JOB_NAME).toBe(JOB_NAME);
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
      timeoutInMS: FOUR_MINUTES_MS,
    });
  });

  test("at the interval each point covers, the usage counters' bucket", () => {
    expect(TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES).toBe(
      TELEMETRY_USAGE_BUCKET_MINUTES,
    );
    expect(mockCapturedOptions[JOB_NAME]?.schedule).toBe(
      `*/${TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES} * * * *`,
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
      'import "./Jobs/TelemetryUsage/PublishTelemetryUsageMetrics";',
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

  test("checks the run's deadline between pages", async () => {
    const deadline: JobDeadline = new JobDeadline();

    await runTick(deadline);

    const shouldContinue: (() => boolean) | undefined =
      sweepOptions().shouldContinue;

    expect(shouldContinue!()).toBe(true);

    deadline.end(new Error("its lock lapsed"));

    expect(shouldContinue!()).toBe(false);
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
