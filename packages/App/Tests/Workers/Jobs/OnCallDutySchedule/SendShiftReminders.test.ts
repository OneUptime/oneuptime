import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * SendShiftReminders — the five-minute cron behind "your on-call shift on
 * <Schedule> starts in 1 hour" — is SCHEDULED AT ALL, and scheduled the way
 * the reminder runner needs. Modelled on PollSecurityEventConnectionsJob.test.ts:
 * the real RunCron and the real JobDictionary run here, only the queue and
 * the runner underneath them are replaced.
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module (a load-bearing
 *      side-effect import, matched as text — a reminder cron nobody imports
 *      is a reminder that never sends);
 *   2. the job is registered under the runner's own job name (the name
 *      RunCron's lease, which runs one sweep at a time, is keyed on) on the
 *      EVERY_FIVE_MINUTE constant;
 *   3. runOnStartup is false — reminders are user-facing side effects and
 *      the watermark makes a boot catch-up unnecessary;
 *   4. the registered timeout is the runner's 10-minute constant, longer than
 *      one tick: the run's deadline passes there, and the sweep stops between
 *      projects (issue #8103);
 *   5. the job function delegates to OnCallShiftReminderRunner.runSweep with
 *      the run's deadline and awaits it, so a failed tick is a failed job
 *      rather than a silent one. The runner takes no lock of its own.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined as never);
const mockRunSweep: jest.Mock = jest.fn();
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
 * The runner's constants are the real ones (requireActual) — the job name
 * and the timeout are what this file is about — while the two entry points
 * the jobs call are observable stubs.
 */
jest.mock("Common/Server/Utils/OnCall/OnCallShiftReminderRunner", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/OnCall/OnCallShiftReminderRunner",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      runSweep: mockRunSweep,
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
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import * as OnCallShiftReminderRunnerModule from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import JobDictionary, {
  WorkerJobFunction,
} from "../../../../FeatureSet/Workers/Utils/JobDictionary";
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
  mockRunSweep.mockReset();
  mockRunSweep.mockResolvedValue({} as never);
});

describe("SendShiftReminders - the job is wired into the worker at all", () => {
  test("App/FeatureSet/Workers/Index.ts imports the job module, without which it never runs", () => {
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);

    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);

    expect(specifier).toBe("./Jobs/OnCallDutySchedule/SendShiftReminders");

    const sideEffectImport: RegExp = new RegExp(
      `^\\s*import\\s+["']${escapeRegExp(specifier)}["']\\s*;?\\s*$`,
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

  test("registers the runner's 10-minute timeout: longer than a tick", () => {
    const timeoutInMs: number = JobDictionary.getTimeoutInMs(
      SHIFT_REMINDER_JOB_NAME,
    );

    expect(timeoutInMs).toBe(SHIFT_REMINDER_JOB_TIMEOUT_MS);
    expect(timeoutInMs).toBe(OneUptimeDate.convertMinutesToMilliseconds(10));

    // Registered, not defaulted.
    expect(timeoutInMs).not.toBe(DEFAULT_JOB_TIMEOUT_IN_MS);

    // Outlasts a tick (a sweep materializes every reminded schedule).
    expect(timeoutInMs).toBeGreaterThan(TICK_INTERVAL_IN_MS);
  });

  /*
   * RunCron runs one sweep at a time (CronLock): the runner's own lock, and
   * the constants that sized it, are gone (issue #8103).
   */
  test("leaves one sweep at a time to RunCron: there is no sweep lock to size any more", () => {
    expect(Object.keys(OnCallShiftReminderRunnerModule)).not.toContain(
      "SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS",
    );
    expect(Object.keys(OnCallShiftReminderRunnerModule)).not.toContain(
      "SHIFT_REMINDER_SWEEP_LOCK_NAMESPACE",
    );
  });
});

describe("SendShiftReminders - what the registered function does", () => {
  test("delegates to OnCallShiftReminderRunner.runSweep with the run's deadline only", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    await jobFunction();

    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    // The runner picks `now` itself; the job hands it only the deadline.
    const handed: Record<string, unknown> = mockRunSweep.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(Object.keys(handed)).toEqual(["deadline"]);
    expect(handed["deadline"]).toBeInstanceOf(JobDeadline);
    expect((handed["deadline"] as JobDeadline).hasPassed()).toBe(false);
    expect(mockDeleteOldLogs).not.toHaveBeenCalled();
  });

  /*
   * Run by the queue, the job hands the sweep a deadline that passes with
   * the queue job's own: its time limit, as QueueWorker counts it.
   */
  test("the deadline it hands the sweep passes when the queue job's deadline does", async () => {
    const jobFunction: WorkerJobFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );
    const queueDeadline: JobDeadline = new JobDeadline();

    await jobFunction(undefined, queueDeadline);

    const handed: JobDeadline = (
      mockRunSweep.mock.calls[0]![0] as { deadline: JobDeadline }
    ).deadline;

    expect(handed.hasPassed()).toBe(false);

    queueDeadline.end();

    expect(handed.hasPassed()).toBe(true);
  });

  test("awaits the sweep, so a failed tick is a failed job rather than a silent one", async () => {
    const failure: Error = new Error("sweep failed");

    mockRunSweep.mockRejectedValue(failure as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    await expect(jobFunction()).rejects.toThrow(failure);
  });

  test("a sweep that stopped at its deadline is a successful job", async () => {
    mockRunSweep.mockResolvedValue({ stoppedAtDeadline: true } as never);

    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      SHIFT_REMINDER_JOB_NAME,
    );

    await expect(jobFunction()).resolves.toBeUndefined();
  });
});
