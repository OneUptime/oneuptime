import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_DAY } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * DeleteOldShiftReminderLogs — retention for the shift-reminder ledger
 * (UserOnCallShiftReminderLog). Same shape as SendShiftReminders.test.ts:
 * real RunCron + real JobDictionary, stubbed queue and runner.
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module;
 *   2. it is registered under the runner's retention job name on EVERY_DAY,
 *      never on startup;
 *   3. the job delegates to OnCallShiftReminderRunner.deleteOldLogs with the
 *      30-day retention constant, and awaits it.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined as never);
const mockRunSweepUnderLock: jest.Mock = jest.fn();
const mockDeleteOldLogs: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/OnCall/OnCallShiftReminderRunner", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/OnCall/OnCallShiftReminderRunner",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      runSweepUnderLock: mockRunSweepUnderLock,
      deleteOldLogs: mockDeleteOldLogs,
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
  SHIFT_REMINDER_LOG_RETENTION_DAYS,
  SHIFT_REMINDER_LOG_RETENTION_JOB_NAME,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutySchedule/DeleteOldShiftReminderLogs";

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
  "OnCallDutySchedule",
  "DeleteOldShiftReminderLogs.ts",
);

function moduleSpecifierFor(fromDir: string, filePath: string): string {
  const relative: string = path
    .relative(fromDir, filePath)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, "");

  return relative.startsWith(".") ? relative : "./" + relative;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

beforeEach(() => {
  mockDeleteOldLogs.mockReset();
  mockDeleteOldLogs.mockResolvedValue({
    deleted: 0,
    cutoff: new Date(),
  } as never);
});

describe("DeleteOldShiftReminderLogs - wiring", () => {
  test("App/FeatureSet/Workers/Index.ts imports the job module", () => {
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);

    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);

    expect(specifier).toBe(
      "./Jobs/OnCallDutySchedule/DeleteOldShiftReminderLogs",
    );

    const sideEffectImport: RegExp = new RegExp(
      `^\\s*import\\s+["']${escapeForRegExp(specifier)}["']\\s*;?\\s*$`,
      "m",
    );

    expect(fs.readFileSync(WORKERS_INDEX_PATH, "utf8")).toMatch(
      sideEffectImport,
    );
  });

  test("registering the job logged no error", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("DeleteOldShiftReminderLogs - registration", () => {
  test("puts a runnable function in JobDictionary under the retention job name", () => {
    expect(SHIFT_REMINDER_LOG_RETENTION_JOB_NAME).toBe(
      "OnCallDutySchedule:DeleteOldShiftReminderLogs",
    );

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_LOG_RETENTION_JOB_NAME,
    );

    expect(typeof jobFunction).toBe("function");
  });

  test("schedules the job once a day, never on startup", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    expect(call[0]).toBe("Worker");
    expect(call[2]).toBe(SHIFT_REMINDER_LOG_RETENTION_JOB_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_DAY });
  });
});

describe("DeleteOldShiftReminderLogs - what the registered function does", () => {
  test("delegates to OnCallShiftReminderRunner.deleteOldLogs with the 30-day retention", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_LOG_RETENTION_JOB_NAME,
    );

    await jobFunction();

    expect(SHIFT_REMINDER_LOG_RETENTION_DAYS).toBe(30);
    expect(mockDeleteOldLogs).toHaveBeenCalledTimes(1);
    expect(mockDeleteOldLogs.mock.calls[0]).toEqual([
      { retentionDays: SHIFT_REMINDER_LOG_RETENTION_DAYS },
    ]);
    expect(mockRunSweepUnderLock).not.toHaveBeenCalled();
  });

  test("awaits the deletion, so a failed run is a failed job", async () => {
    const failure: Error = new Error("delete failed");

    mockDeleteOldLogs.mockRejectedValue(failure as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_LOG_RETENTION_JOB_NAME,
    );

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
