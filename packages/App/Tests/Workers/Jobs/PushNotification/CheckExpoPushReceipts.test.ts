import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * CheckExpoPushReceipts - reads the receipts of mobile pushes Expo accepted,
 * about 15 minutes after each, so a phone Expo reports as gone only in a
 * receipt stops being paged. Real RunCron and JobDictionary, a stubbed queue
 * and receipt check, as the other job suites (DeleteOldShiftReminderLogs).
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module - RunCron
 *      registers by module side effect, so a job nothing imports never runs;
 *   2. it is ONE job, on EVERY_FIVE_MINUTE, never on startup, with the
 *      service's timeout - never a job per push;
 *   3. the job runs ExpoPushReceiptService.checkDueReceipts and awaits it, so
 *      a failed run is a failed job.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined as never);
const mockCheckDueReceipts: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Services/ExpoPushReceiptService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Services/ExpoPushReceiptService",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      checkDueReceipts: mockCheckDueReceipts,
    },
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

import {
  EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
  EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS,
} from "Common/Server/Services/ExpoPushReceiptService";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/PushNotification/CheckExpoPushReceipts";

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
  "PushNotification",
  "CheckExpoPushReceipts.ts",
);

const SIDE_EFFECT_IMPORT: RegExp =
  /^\s*import\s+["']\.\/Jobs\/PushNotification\/CheckExpoPushReceipts["']\s*;?\s*$/m;

beforeEach(() => {
  mockCheckDueReceipts.mockReset();
  mockCheckDueReceipts.mockResolvedValue({} as never);
});

describe("CheckExpoPushReceipts - wiring", () => {
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

describe("CheckExpoPushReceipts - registration", () => {
  test("puts a runnable function in JobDictionary under the receipt check's name, with its timeout", () => {
    expect(EXPO_PUSH_RECEIPT_CHECK_JOB_NAME).toBe(
      "PushNotification:CheckExpoPushReceipts",
    );

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
    );

    expect(typeof jobFunction).toBe("function");
    expect(JobDictionary.getTimeoutInMs(EXPO_PUSH_RECEIPT_CHECK_JOB_NAME)).toBe(
      EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS,
    );
  });

  test("one job, every five minutes, never on startup", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    expect(call[0]).toBe("Worker");
    expect(call[1]).toBe(EXPO_PUSH_RECEIPT_CHECK_JOB_NAME);
    expect(call[2]).toBe(EXPO_PUSH_RECEIPT_CHECK_JOB_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_FIVE_MINUTE });
    expect(EVERY_FIVE_MINUTE).toBe("*/5 * * * *");
  });
});

describe("CheckExpoPushReceipts - what the registered function does", () => {
  test("reads the receipts that are due, once a run", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
    );

    await jobFunction();

    expect(mockCheckDueReceipts).toHaveBeenCalledTimes(1);
    expect(mockCheckDueReceipts.mock.calls[0]).toEqual([]);
  });

  test("awaits the check, so a failed run is a failed job", async () => {
    const failure: Error = new Error("Redis is down");

    mockCheckDueReceipts.mockRejectedValue(failure as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
    );

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
