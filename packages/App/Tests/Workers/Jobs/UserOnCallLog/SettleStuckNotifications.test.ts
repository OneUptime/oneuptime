import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SettleStuckNotifications - settles the on-call notifications still
 * Sending 15 minutes after their page wrote them: their request to the
 * Notification service got no answer, and nothing wrote how it went
 * (issue #6873) - however long ago they were written (issue #7290). Real
 * RunCron and JobDictionary, a stubbed queue and run, as the other job
 * suites (CheckExpoPushReceipts).
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module - RunCron
 *      registers by module side effect, so a job nothing imports never runs;
 *   2. it is ONE job, on EVERY_FIVE_MINUTE, never on startup, with the
 *      default timeout - never a job per notification;
 *   3. the job runs the whole check - runStuckNotificationCheck, which
 *      settles those written within the check's day and those written
 *      before it - and awaits it, so a failed run is a failed job; never
 *      one part alone.
 *
 * What one run of the job does to the notifications themselves is pinned
 * in SettleStuckNotificationsRun.test.ts, with the real check.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined as never);
const mockRunStuckNotificationCheck: jest.Mock = jest.fn();
const mockSettleStuckNotifications: jest.Mock = jest.fn();
const mockSettleNotificationsStuckBeforeTheCheck: jest.Mock = jest.fn();

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
    runStuckNotificationCheck: mockRunStuckNotificationCheck,
    settleStuckNotifications: mockSettleStuckNotifications,
    settleNotificationsStuckBeforeTheCheck:
      mockSettleNotificationsStuckBeforeTheCheck,
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
  mockRunStuckNotificationCheck.mockReset();
  mockRunStuckNotificationCheck.mockResolvedValue({
    withinTheLookBack: { found: 0, settled: 0, movedOn: 0, failed: 0 },
    beforeTheLookBack: { found: 0, settled: 0, statements: 1 },
  } as never);
  mockSettleStuckNotifications.mockReset();
  mockSettleNotificationsStuckBeforeTheCheck.mockReset();
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
  test("runs the whole check once a run, as of now", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      STUCK_NOTIFICATION_CHECK_JOB_NAME,
    );

    await jobFunction();

    expect(mockRunStuckNotificationCheck).toHaveBeenCalledTimes(1);
    // No clock of its own: the check reads the time it runs at.
    expect(mockRunStuckNotificationCheck.mock.calls[0]).toEqual([]);
  });

  /*
   * The check alone left a notification written before its day - while the
   * workers were down - Sending for ever (issue #7290): the job runs both
   * parts through the run, never one of them by itself.
   */
  test("never one part of the check by itself", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      STUCK_NOTIFICATION_CHECK_JOB_NAME,
    );

    await jobFunction();

    expect(mockSettleStuckNotifications).not.toHaveBeenCalled();
    expect(mockSettleNotificationsStuckBeforeTheCheck).not.toHaveBeenCalled();
  });

  test("awaits the check, so a failed run is a failed job", async () => {
    const failure: Error = new Error("connection terminated");

    mockRunStuckNotificationCheck.mockRejectedValue(failure as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      STUCK_NOTIFICATION_CHECK_JOB_NAME,
    );

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
