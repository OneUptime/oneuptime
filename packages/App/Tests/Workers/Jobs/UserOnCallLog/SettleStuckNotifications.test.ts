import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SettleStuckNotifications - settles the on-call notifications still
 * Sending 15 minutes after their page wrote them: their request to the
 * Notification service got no answer, and nothing wrote how it went
 * (issue #6873). Real RunCron and JobDictionary, a stubbed queue and check,
 * as the other job suites (CheckExpoPushReceipts).
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module - RunCron
 *      registers by module side effect, so a job nothing imports never runs;
 *   2. it is ONE job, on EVERY_FIVE_MINUTE, never on startup, with the
 *      default timeout - never a job per notification;
 *   3. the job runs settleStuckNotifications and awaits it, so a failed run
 *      is a failed job.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined as never);
const mockSettleStuckNotifications: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/OnCall/OnCallStuckNotifications", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/OnCall/OnCallStuckNotifications",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    settleStuckNotifications: mockSettleStuckNotifications,
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

import { STUCK_NOTIFICATION_CHECK_JOB_NAME } from "Common/Server/Utils/OnCall/OnCallStuckNotifications";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/SettleStuckNotifications";

const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const WORKERS_DIR: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers",
);
const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");
const JOB_FILE_PATH: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "UserOnCallLog",
  "SettleStuckNotifications.ts",
);

// The import line as Prettier writes it: a side effect import, on a line of its own.
const SIDE_EFFECT_IMPORT: RegExp =
  /^import "\.\/Jobs\/UserOnCallLog\/SettleStuckNotifications";$/m;

// Every job without a timeout of its own gets JobDictionary's: five minutes.
const DEFAULT_JOB_TIMEOUT_MS: number = 5 * 60 * 1000;

beforeEach(() => {
  mockSettleStuckNotifications.mockReset();
  mockSettleStuckNotifications.mockResolvedValue({
    found: 0,
    settled: 0,
    movedOn: 0,
    failed: 0,
  } as never);
});

describe("SettleStuckNotifications - wiring", () => {
  test("App/FeatureSet/Workers/Index.ts imports the job module", () => {
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);
    expect(fs.readFileSync(WORKERS_INDEX_PATH, "utf8")).toMatch(
      SIDE_EFFECT_IMPORT,
    );
  });

  test("registering the job logged no error", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("SettleStuckNotifications - registration", () => {
  test("puts a runnable function in JobDictionary under the check's name, with the default timeout", () => {
    expect(STUCK_NOTIFICATION_CHECK_JOB_NAME).toBe(
      "UserOnCallLogTimeline:SettleStuckNotifications",
    );

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      STUCK_NOTIFICATION_CHECK_JOB_NAME,
    );

    expect(typeof jobFunction).toBe("function");
    expect(
      JobDictionary.getTimeoutInMs(STUCK_NOTIFICATION_CHECK_JOB_NAME),
    ).toBe(DEFAULT_JOB_TIMEOUT_MS);
  });

  test("one job, every five minutes, never on startup", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    expect(call[0]).toBe("Worker");
    expect(call[1]).toBe(STUCK_NOTIFICATION_CHECK_JOB_NAME);
    expect(call[2]).toBe(STUCK_NOTIFICATION_CHECK_JOB_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_FIVE_MINUTE });
    expect(EVERY_FIVE_MINUTE).toBe("*/5 * * * *");
  });
});

describe("SettleStuckNotifications - what the registered function does", () => {
  test("settles the notifications that are due, once a run, as of now", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      STUCK_NOTIFICATION_CHECK_JOB_NAME,
    );

    await jobFunction();

    expect(mockSettleStuckNotifications).toHaveBeenCalledTimes(1);
    // No clock of its own: the check reads the time it runs at.
    expect(mockSettleStuckNotifications.mock.calls[0]).toEqual([]);
  });

  test("awaits the check, so a failed run is a failed job", async () => {
    const failure: Error = new Error("connection terminated");

    mockSettleStuckNotifications.mockRejectedValue(failure as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      STUCK_NOTIFICATION_CHECK_JOB_NAME,
    );

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
