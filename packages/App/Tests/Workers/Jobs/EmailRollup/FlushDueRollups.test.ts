import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * FlushDueRollups is the scheduling half of the owner-email burst rollup, and
 * it is four lines long - which is exactly why it needs a test. What breaks in
 * production if any of the behaviour below regresses:
 *
 *   1. A CRON NOBODY IMPORTS IS NEVER SCHEDULED. RunCron registers purely as
 *      an import side effect, so App/FeatureSet/Workers/Index.ts is the only
 *      thing that makes this job exist. No test that imports the job module
 *      directly can see the omission - the import here would register it - so
 *      Index.ts is read as TEXT. Without that line every deferred notification
 *      sits in the queue table forever and is silently never delivered, and
 *      nothing anywhere fails.
 *
 *   2. runOnStartup MUST STAY FALSE. Notification/Utils/Handlebars fires
 *      loadPartials() unawaited at import time, so a render during boot can
 *      throw "the partial X could not be found" - and the rollup template is
 *      built entirely from partials.
 *
 *   3. THE TIMEOUT MUST BE EXPLICIT AND CORRECTLY ORDERED. It has to sit above
 *      the sweep's own wall-clock budget (so a healthy tick is never stopped
 *      part way through its buckets) and below JobDictionary's five-minute
 *      default (so it is a decision rather than an inheritance).
 *
 *   4. THE TICK MUST AWAIT THE SWEEP, AND HAND IT THE RUN'S DEADLINE. A tick
 *      that fires and forgets turns a failed sweep into a successful job, and
 *      BullMQ then records nothing at all when rollups stop going out. The
 *      deadline is what stops the sweep between buckets at the time limit or
 *      once the run's lease is lost; RunCron runs one sweep at a time, so the
 *      runner takes no lock of its own (issue #8103).
 *
 * The Cron util is mocked to CAPTURE the registration rather than enqueue it,
 * which is the recorder the other App/Tests/Workers/Jobs suites use.
 */

type CronHandler = (deadline?: JobDeadline) => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number | undefined;
  queueName?: string | undefined;
}

interface CapturedJob {
  jobName: string;
  options: CronOptions;
  runFunction: CronHandler;
}

/*
 * Declared before the hoisted jest.mock below: the factory may only close over
 * names prefixed with "mock", and it is invoked when the job module is
 * required - which is the last import in this file, by which point these have
 * been initialised.
 */
const mockCapturedJobs: Array<CapturedJob> = [];
const mockRunSweep: jest.Mock = jest.fn();

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs.push({
          jobName: jobName,
          options: options,
          runFunction: runFunction,
        });
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

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY - an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

/*
 * The runner is the observable stub; its CONSTANTS are the real ones, and they
 * live in their own module so nothing needs requireActual here.
 */
jest.mock("Common/Server/Utils/EmailRollup/EmailRollupFlushRunner", () => {
  return {
    __esModule: true,
    default: {
      runSweep: mockRunSweep,
    },
  };
});

// Imported AFTER the mocks; the job import is last of all.
import {
  ROLLUP_JOB_NAME,
  ROLLUP_JOB_TIMEOUT_MS,
  ROLLUP_SWEEP_BUDGET_MS,
} from "Common/Server/Utils/EmailRollup/EmailRollupConstants";
import * as EmailRollupConstants from "Common/Server/Utils/EmailRollup/EmailRollupConstants";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import "../../../../FeatureSet/Workers/Jobs/EmailRollup/FlushDueRollups";

const WORKERS_DIR: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers",
);
const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");
const JOB_FILE_PATH: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "EmailRollup",
  "FlushDueRollups.ts",
);

// JobDictionary's default when a job registers no timeout of its own.
const DEFAULT_JOB_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, { encoding: "utf-8" });
}

function capturedJob(): CapturedJob {
  const job: CapturedJob | undefined = mockCapturedJobs.find(
    (candidate: CapturedJob): boolean => {
      return candidate.jobName === ROLLUP_JOB_NAME;
    },
  );

  if (!job) {
    throw new Error(
      `FlushDueRollups registered no job named ${ROLLUP_JOB_NAME}`,
    );
  }

  return job;
}

beforeEach(() => {
  mockRunSweep.mockReset();
  mockRunSweep.mockResolvedValue({} as never);
});

describe("FlushDueRollups - the job is wired into the worker at all", () => {
  test("the job file exists where Index.ts must import it from", () => {
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);
  });

  test("App/FeatureSet/Workers/Index.ts carries the side-effect import, without which nothing schedules it", () => {
    const sideEffectImport: RegExp =
      /^\s*import\s+["']\.\/Jobs\/EmailRollup\/FlushDueRollups["']\s*;?\s*$/m;

    expect(readSource(WORKERS_INDEX_PATH)).toMatch(sideEffectImport);
  });

  test("the import is unconditional, above the DisableQueueWorkers gate", () => {
    const indexSource: string = readSource(WORKERS_INDEX_PATH);
    const importIndex: number = indexSource.indexOf(
      'import "./Jobs/EmailRollup/FlushDueRollups"',
    );

    expect(importIndex).toBeGreaterThan(-1);

    const gate: RegExpMatchArray | null = indexSource.match(
      /if\s*\(\s*DisableQueueWorkers\s*\)/,
    );

    expect(gate).not.toBeNull();
    expect(importIndex).toBeLessThan(gate!.index as number);
  });
});

describe("FlushDueRollups - registration", () => {
  test("registers exactly one job, under the runner's own job name", () => {
    expect(ROLLUP_JOB_NAME).toBe("EmailRollup:FlushDueRollups");
    expect(mockCapturedJobs).toHaveLength(1);
    expect(capturedJob().jobName).toBe(ROLLUP_JOB_NAME);
  });

  test("runs every minute", () => {
    expect(capturedJob().options.schedule).toBe(EVERY_MINUTE);
    expect(EVERY_MINUTE).toBe("* * * * *");
  });

  test("never runs on startup, because a boot-time render can outrun loadPartials", () => {
    expect(capturedJob().options.runOnStartup).toBe(false);
  });

  test("registers an explicit timeout that clears the sweep's own budget", () => {
    const timeoutInMS: number | undefined = capturedJob().options.timeoutInMS;

    // Explicit, not inherited from JobDictionary's default.
    expect(timeoutInMS).toBeDefined();
    expect(timeoutInMS).toBe(ROLLUP_JOB_TIMEOUT_MS);
    expect(timeoutInMS).not.toBe(DEFAULT_JOB_TIMEOUT_IN_MS);
    expect(timeoutInMS!).toBeLessThan(DEFAULT_JOB_TIMEOUT_IN_MS);

    // Above the sweep's own wall-clock budget.
    expect(timeoutInMS!).toBeGreaterThan(ROLLUP_SWEEP_BUDGET_MS);
  });

  /*
   * RunCron runs one sweep at a time (CronLock): the runner's own lock, and
   * the constants that sized it, are gone (issue #8103).
   */
  test("leaves one sweep at a time to RunCron: there is no sweep lock to size any more", () => {
    expect(Object.keys(EmailRollupConstants)).not.toContain(
      "ROLLUP_SWEEP_LOCK_TIMEOUT_MS",
    );
    expect(Object.keys(EmailRollupConstants)).not.toContain(
      "ROLLUP_SWEEP_LOCK_NAMESPACE",
    );
    expect(capturedJob().options).not.toHaveProperty("allowOverlap");
  });
});

describe("FlushDueRollups - what one tick does", () => {
  test("delegates to EmailRollupFlushRunner.runSweep exactly once, handing it the run's deadline", async () => {
    const deadline: JobDeadline = new JobDeadline();

    await capturedJob().runFunction(deadline);

    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    // The runner picks `now` itself; the job hands it only its deadline.
    expect(mockRunSweep.mock.calls[0]).toEqual([{ deadline: deadline }]);
  });

  test("run outside the queue, it hands the runner a deadline that never passes", async () => {
    await capturedJob().runFunction();

    const handed: { deadline: JobDeadline } = mockRunSweep.mock
      .calls[0]![0] as { deadline: JobDeadline };

    expect(handed.deadline).toBeInstanceOf(JobDeadline);
    expect(handed.deadline.hasPassed()).toBe(false);
  });

  test("awaits the sweep, so a failed tick is a failed job rather than a silent one", async () => {
    const failure: Error = new Error("sweep failed");

    mockRunSweep.mockRejectedValue(failure as never);

    await expect(capturedJob().runFunction()).rejects.toThrow(failure);
  });

  test("a sweep that stopped at its deadline is a successful job", async () => {
    mockRunSweep.mockResolvedValue({ stoppedAtDeadline: true } as never);

    await expect(capturedJob().runFunction()).resolves.toBeUndefined();
  });
});
