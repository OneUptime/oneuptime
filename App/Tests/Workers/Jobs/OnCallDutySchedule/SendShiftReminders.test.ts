import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SendShiftReminders — the five-minute cron behind "your on-call shift on
 * <Schedule> starts in 1 hour" — is SCHEDULED AT ALL, and scheduled the way
 * the reminder runner needs. Modelled on PollGoogleSecOpsConnectionsJob.test.ts:
 * the real RunCron and the real JobDictionary run here, only the queue and
 * the runner underneath them are replaced.
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module (a load-bearing
 *      side-effect import, matched as text — a reminder cron nobody imports
 *      is a reminder that never sends);
 *   2. the job is registered under the runner's own job name (the same name
 *      the sweep lock is keyed on) on the EVERY_FIVE_MINUTE constant;
 *   3. runOnStartup is false — reminders are user-facing side effects and
 *      the watermark makes a boot catch-up unnecessary;
 *   4. the registered timeout is the runner's 10-minute constant: longer than
 *      one tick, shorter than the 12-minute sweep lock (runJobWithTimeout
 *      races the body, it does not cancel it, so the lock must outlive it);
 *   5. the job function delegates to OnCallShiftReminderRunner.runSweepUnderLock
 *      and awaits it, so a failed tick is a failed job rather than a silent one.
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

/*
 * The runner's constants are the real ones (requireActual) — the job name,
 * the timeout and the lock timeout are what this file is about — while the
 * two entry points the jobs call are observable stubs.
 */
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

// Imported AFTER the mocks; the job import is last of all.
import {
  SHIFT_REMINDER_JOB_NAME,
  SHIFT_REMINDER_JOB_TIMEOUT_MS,
  SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutySchedule/SendShiftReminders";

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
  "SendShiftReminders.ts",
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

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, { encoding: "utf-8" });
}

const TICK_INTERVAL_IN_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(5);

const UNREGISTERED_JOB_NAME: string =
  "OnCallDutySchedule:SendShiftReminders:NotARealJob";

const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  UNREGISTERED_JOB_NAME,
);

beforeEach(() => {
  mockRunSweepUnderLock.mockReset();
  mockRunSweepUnderLock.mockResolvedValue(null as never);
});

describe("SendShiftReminders - the job is wired into the worker at all", () => {
  test("App/FeatureSet/Workers/Index.ts imports the job module, without which it never runs", () => {
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);

    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);

    expect(specifier).toBe("./Jobs/OnCallDutySchedule/SendShiftReminders");

    const sideEffectImport: RegExp = new RegExp(
      `^\\s*import\\s+["']${escapeForRegExp(specifier)}["']\\s*;?\\s*$`,
      "m",
    );

    expect(readSource(WORKERS_INDEX_PATH)).toMatch(sideEffectImport);
  });

  test("the import is unconditional, above the DISABLE_QUEUE_WORKERS gate", () => {
    const indexSource: string = readSource(WORKERS_INDEX_PATH);
    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);
    const importIndex: number = indexSource.indexOf(`import "${specifier}"`);

    expect(importIndex).toBeGreaterThan(-1);

    const gate: RegExpMatchArray | null = indexSource.match(
      /if\s*\(\s*DisableQueueWorkers\s*\)/,
    );

    expect(gate).not.toBeNull();
    expect(importIndex).toBeLessThan(gate!.index as number);
  });

  test("sits next to the other on-call schedule job (RefreshHandoffTime)", () => {
    const indexSource: string = readSource(WORKERS_INDEX_PATH);

    expect(indexSource).toContain(
      'import "./Jobs/OnCallDutySchedule/RefreshHandoffTime"',
    );
    expect(
      indexSource.indexOf("./Jobs/OnCallDutySchedule/SendShiftReminders"),
    ).toBeGreaterThan(
      indexSource.indexOf("./Jobs/OnCallDutySchedule/RefreshHandoffTime"),
    );
  });
});

describe("SendShiftReminders - registration", () => {
  test("registering the job logged no error, so nothing was silently swallowed", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("puts a runnable function in JobDictionary under the runner's job name", () => {
    expect(SHIFT_REMINDER_JOB_NAME).toBe(
      "OnCallDutySchedule:SendShiftReminders",
    );

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    expect(typeof jobFunction).toBe("function");
  });

  test("schedules the job once, on EVERY_FIVE_MINUTE, under that same name", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(call[0]).toBe("Worker");
    expect(call[1]).toBe(SHIFT_REMINDER_JOB_NAME);
    expect(call[2]).toBe(SHIFT_REMINDER_JOB_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_FIVE_MINUTE });

    // Five fields, minute granularity: licenses TICK_INTERVAL_IN_MS.
    const fields: Array<string> = EVERY_FIVE_MINUTE.trim().split(/\s+/);

    expect(fields).toHaveLength(5);
    expect(fields[0]).toBe("*/5");
  });

  test("never runs on startup - one addJob call, and it carries a schedule", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const options: { scheduleAt?: string } = registrationAddJobCalls[0]![4] as {
      scheduleAt?: string;
    };

    expect(options.scheduleAt).toBe(EVERY_FIVE_MINUTE);
  });

  test("registers the runner's 10-minute timeout: longer than a tick, shorter than the sweep lock", () => {
    const timeoutInMs: number = JobDictionary.getTimeoutInMs(
      SHIFT_REMINDER_JOB_NAME,
    );

    expect(timeoutInMs).toBe(SHIFT_REMINDER_JOB_TIMEOUT_MS);
    expect(timeoutInMs).toBe(OneUptimeDate.convertMinutesToMilliseconds(10));

    // Registered, not defaulted.
    expect(timeoutInMs).not.toBe(DEFAULT_JOB_TIMEOUT_IN_MS);

    // Outlasts a tick (a sweep materializes every reminded schedule)...
    expect(timeoutInMs).toBeGreaterThan(TICK_INTERVAL_IN_MS);

    /*
     * ...and the cross-replica lock outlasts the timeout, because
     * QueueWorker.runJobWithTimeout races the body without cancelling it.
     */
    expect(SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS).toBeGreaterThan(timeoutInMs);
  });
});

describe("SendShiftReminders - what the registered function does", () => {
  test("delegates to OnCallShiftReminderRunner.runSweepUnderLock with no arguments", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    await jobFunction();

    expect(mockRunSweepUnderLock).toHaveBeenCalledTimes(1);
    // The runner picks `now` itself; the job passes nothing.
    expect(mockRunSweepUnderLock.mock.calls[0]).toEqual([]);
    expect(mockDeleteOldLogs).not.toHaveBeenCalled();
  });

  test("awaits the sweep, so a failed tick is a failed job rather than a silent one", async () => {
    const failure: Error = new Error("sweep failed");

    mockRunSweepUnderLock.mockRejectedValue(failure as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    await expect(jobFunction()).rejects.toThrow(failure);
  });

  test("a skipped tick (lock held, runner returns null) is a successful job", async () => {
    mockRunSweepUnderLock.mockResolvedValue(null as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    await expect(jobFunction()).resolves.toBeUndefined();
  });
});
