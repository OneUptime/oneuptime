import fs from "fs";
import path from "path";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_DAY } from "Common/Utils/CronTime";

/*
 * The two telemetry usage jobs every install runs (issue #5916):
 *
 *   - TelemetryUsage:MeterTelemetryUsage counts every project's usage where
 *     billing is off (TelemetryUsageMeter, pinned in Common's
 *     Tests/Server/Utils/TelemetryUsage); where billing is on, billing
 *     stages usage and this job does nothing.
 *   - TelemetryUsage:DeleteOldTelemetryUsage deletes the days past the
 *     instance's usage retention, with billing on or off.
 *
 * What is pinned here is the wiring a unit test of the loop cannot see: the
 * permanent names and the daily cadence, the worker Index importing both,
 * one run at a time through the Redis lock, a deadline inside the job's
 * timeout, and a handler that never throws.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number | undefined;
}

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CronOptions> = {};
let mockIsBillingEnabled: boolean = false;

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

jest.mock("Common/Server/EnvironmentConfig", () => {
  const mocked: Record<string, unknown> = { __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });
  // Production: the dev stack runs the job every five minutes instead.
  mocked["IsDevelopment"] = false;

  return mocked;
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

jest.mock("Common/Server/Utils/TelemetryUsage/TelemetryUsageMeter", () => {
  return {
    __esModule: true,
    default: {
      meterAllProjects: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TelemetryUsageBillingService", () => {
  return {
    __esModule: true,
    default: {
      deleteUsageOlderThanRetention: jest.fn(),
    },
  };
});

import Semaphore, {
  SemaphoreLockTimeoutError,
} from "Common/Server/Infrastructure/Semaphore";
import TelemetryUsageBillingService from "Common/Server/Services/TelemetryUsageBillingService";
import TelemetryUsageMeter from "Common/Server/Utils/TelemetryUsage/TelemetryUsageMeter";
import logger from "Common/Server/Utils/Logger";

// Imported for their side effect: RunCron (mocked above) records the handlers.
import {
  METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES,
  METER_TELEMETRY_USAGE_JOB_NAME,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryUsage/MeterTelemetryUsage";
import { DELETE_OLD_TELEMETRY_USAGE_JOB_NAME } from "../../../../FeatureSet/Workers/Jobs/TelemetryUsage/DeleteOldTelemetryUsage";

const METER_JOB: string = "TelemetryUsage:MeterTelemetryUsage";
const DELETE_JOB: string = "TelemetryUsage:DeleteOldTelemetryUsage";
const NOW: Date = new Date("2026-10-23T08:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

interface MockMutex {
  identifier: string;
  isAcquired: boolean;
}

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const releaseMock: jest.Mock = Semaphore.release as unknown as jest.Mock;
const meterMock: jest.Mock =
  TelemetryUsageMeter.meterAllProjects as unknown as jest.Mock;
const deleteMock: jest.Mock =
  TelemetryUsageBillingService.deleteUsageOlderThanRetention as unknown as jest.Mock;

let mutex: MockMutex;

async function run(jobName: string): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[jobName];

  if (!handler) {
    throw new Error(`Cron handler ${jobName} was not registered.`);
  }

  await handler();
}

function meterOptions(): {
  deadline: Date;
  shouldContinue: () => boolean;
} {
  expect(meterMock).toHaveBeenCalledTimes(1);
  return meterMock.mock.calls[0]![0];
}

beforeEach(() => {
  jest.resetAllMocks();
  mockIsBillingEnabled = false;

  mutex = { identifier: "usage-run-mutex", isAcquired: true };
  lockMock.mockResolvedValue(mutex);
  releaseMock.mockResolvedValue(undefined);
  meterMock.mockResolvedValue({
    stopReason: "done",
    projectsMetered: 3,
    failures: 0,
  });
  deleteMock.mockResolvedValue({
    deleted: 4,
    cutoff: new Date("2026-06-25T08:00:00.000Z"),
    retentionInDays: 120,
  });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the jobs register themselves", () => {
  test("metering, under its permanent name, daily, not on startup, with a timeout past its deadline", () => {
    expect(METER_TELEMETRY_USAGE_JOB_NAME).toBe(METER_JOB);
    expect(mockCapturedOptions[METER_JOB]).toEqual({
      schedule: EVERY_DAY,
      runOnStartup: false,
      timeoutInMS: (METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES + 15) * MINUTE_MS,
    });
  });

  test("metering runs when OneUptime Cloud's billing run stages the same usage", () => {
    const billingJob: string = path.join(
      __dirname,
      "../../../../../../ee/Server/Billing/Jobs/ReportTelemetryMeteredPlan.ts",
    );

    if (fs.existsSync(billingJob)) {
      expect(fs.readFileSync(billingJob, "utf8")).toContain(
        "schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,",
      );
    }

    expect(EVERY_DAY).toBe("0 8 * * *");
  });

  test("the cleanup, under its permanent name, daily, not on startup", () => {
    expect(DELETE_OLD_TELEMETRY_USAGE_JOB_NAME).toBe(DELETE_JOB);
    expect(mockCapturedOptions[DELETE_JOB]).toEqual({
      schedule: EVERY_DAY,
      runOnStartup: false,
    });
  });

  test("both are imported by the worker Index - an unimported job never registers", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(source).toContain(
      'import "./Jobs/TelemetryUsage/MeterTelemetryUsage";',
    );
    expect(source).toContain(
      'import "./Jobs/TelemetryUsage/DeleteOldTelemetryUsage";',
    );
  });
});

describe("metering", () => {
  test("does nothing where billing is on, not even take its lock", async () => {
    mockIsBillingEnabled = true;

    await run(METER_JOB);

    expect(lockMock).not.toHaveBeenCalled();
    expect(meterMock).not.toHaveBeenCalled();
  });

  test("takes the run's lock under the job's name, without queueing behind a run in flight", async () => {
    await run(METER_JOB);

    expect(lockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: METER_JOB,
        namespace: "Workers.Cron",
        lockTimeout: (METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES + 15) * MINUTE_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: 30 * 1000,
      }),
    );
  });

  test("handles a lost lock itself: a warning, never a throw from the refresh timer", async () => {
    await run(METER_JOB);

    const onLockLost: (err: Error) => void = lockMock.mock.calls[0]![0]
      .onLockLost as (err: Error) => void;

    expect(() => {
      onLockLost(new Error("Lost mutex"));
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("lost the run's lock"),
    );
  });

  test("a run already in flight skips this one, quietly", async () => {
    lockMock.mockRejectedValue(new SemaphoreLockTimeoutError("busy"));

    await expect(run(METER_JOB)).resolves.toBeUndefined();

    expect(meterMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a lock that fails for another reason skips the run and says so", async () => {
    lockMock.mockRejectedValue(new Error("Redis connection refused"));

    await expect(run(METER_JOB)).resolves.toBeUndefined();

    expect(meterMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not take the run's lock"),
    );
  });

  test("gives the loop a two-hour deadline, inside the job's timeout", async () => {
    await run(METER_JOB);

    const deadline: Date = meterOptions().deadline;

    expect(METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES).toBe(120);
    expect(deadline.toISOString()).toBe(
      new Date(NOW.getTime() + 120 * MINUTE_MS).toISOString(),
    );
    expect(deadline.getTime() - NOW.getTime()).toBeLessThan(
      mockCapturedOptions[METER_JOB]!.timeoutInMS!,
    );
  });

  test("lets the loop stop once the lock is lost", async () => {
    await run(METER_JOB);

    const shouldContinue: () => boolean = meterOptions().shouldContinue;

    expect(shouldContinue()).toBe(true);
    mutex.isAcquired = false;
    expect(shouldContinue()).toBe(false);
  });

  test("releases its lock once the run is done", async () => {
    await run(METER_JOB);

    expect(releaseMock).toHaveBeenCalledWith(mutex);
  });

  test("never throws: a failed run is logged, and the lock still released", async () => {
    meterMock.mockRejectedValue(new Error("unexpected"));

    await expect(run(METER_JOB)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the run failed"),
    );
    expect(releaseMock).toHaveBeenCalledWith(mutex);
  });

  test("a release that fails is logged and swallowed - the lock expires on its own", async () => {
    releaseMock.mockRejectedValue(new Error("Redis went away"));

    await expect(run(METER_JOB)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not release the run's lock"),
    );
  });
});

describe("the cleanup", () => {
  test("deletes the days past the usage retention where billing is off", async () => {
    await run(DELETE_JOB);

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test("and where billing is on, the same way", async () => {
    mockIsBillingEnabled = true;

    await run(DELETE_JOB);

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
