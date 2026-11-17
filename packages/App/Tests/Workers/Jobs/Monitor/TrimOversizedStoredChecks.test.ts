import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the ThreatIntelJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The job that trims the checks a grouped monitor's alerts, incidents and
 * status changes kept before stored checks were bounded (issues #9189,
 * #9232): Monitor:TrimOversizedStoredChecks, hourly, running
 * OversizedStoredChecks. The REAL RunCron and JobDictionary run here; the
 * queue, the clean-up itself and the logger are replaced.
 *
 * Pinned: it is scheduled at all (RunCron registers as a side effect of the
 * import in Workers/Index.ts), hourly, never on startup, with room past the
 * run's own budget for its last trim; it hands the clean-up the run's
 * deadline, so a run that loses its lock stops; a run that did nothing says
 * nothing - every run, once every table is done - one that did says how
 * much, and a failure is logged without failing the job: the next hour
 * tries again.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockRun: jest.Mock = jest.fn();

const mockBudgetMs: number = 10 * 60 * 1000;

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

jest.mock("Common/Server/Utils/Retention/OversizedStoredChecks", () => {
  return {
    __esModule: true,
    TRIM_TIME_BUDGET_MS: mockBudgetMs,
    default: {
      run: mockRun,
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

/*
 * Imported AFTER the mocks and the bindings their factories close over: the
 * job registers itself when it is imported.
 */
import logger from "Common/Server/Utils/Logger";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import { NO_BREAK_SPACE } from "Common/Types/NoBreakSpaces";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/Monitor/TrimOversizedStoredChecks";

// Snapshotted at import time; registration happens exactly once a job.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

const WORKERS_DIR: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers",
);

const JOB_NAME: string = "Monitor:TrimOversizedStoredChecks";
const JOB_FILE: string = "Jobs/Monitor/TrimOversizedStoredChecks";

function summary(
  overrides: Partial<{
    rowsTrimmed: number;
    rowsReplacedByMarkers: number;
    storedBytesBefore: number;
    storedBytesAfter: number;
    failedRows: number;
    failedTables: number;
    finishedTables: Array<string>;
    isCutShort: boolean;
    isEveryTableDone: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    rowsTrimmed: 0,
    rowsReplacedByMarkers: 0,
    storedBytesBefore: 0,
    storedBytesAfter: 0,
    failedRows: 0,
    failedTables: 0,
    finishedTables: [],
    isCutShort: false,
    isEveryTableDone: false,
    ...overrides,
  };
}

async function runJob(): Promise<void> {
  const jobFunction: PromiseVoidFunction =
    JobDictionary.getJobFunction(JOB_NAME);

  await jobFunction();
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(summary() as never);
  mockedLogger.info.mockClear();
  mockedLogger.error.mockClear();
});

describe("Monitor:TrimOversizedStoredChecks - wired into the worker", () => {
  test("Workers/Index.ts imports the job as a top-level side effect", () => {
    expect(fs.existsSync(path.join(WORKERS_DIR, `${JOB_FILE}.ts`))).toBe(true);

    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']\\./${escapeRegExp(JOB_FILE)}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("registers once, hourly on the Worker queue, not on startup, with room past its budget for the last trim", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(true);

    const calls: Array<Array<unknown>> = registrationAddJobCalls.filter(
      (call: Array<unknown>) => {
        return call[2] === JOB_NAME;
      },
    );

    expect(calls).toHaveLength(1);
    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(calls[0]![0]).toBe("Worker");
    expect(calls[0]![4]).toEqual({ scheduleAt: EVERY_HOUR });
    expect(JobDictionary.getTimeoutInMs(JOB_NAME)).toBe(
      mockBudgetMs + 2 * 60 * 1000,
    );
  });
});

describe("Monitor:TrimOversizedStoredChecks - what it runs", () => {
  test("runs the clean-up once, with the run's deadline and the module's own budget", async () => {
    await runJob();

    expect(mockRun).toHaveBeenCalledTimes(1);

    const args: { deadline?: unknown } = mockRun.mock.calls[0]![0] as {
      deadline?: unknown;
    };

    expect(Object.keys(args)).toEqual(["deadline"]);
    expect(args.deadline).toBeInstanceOf(JobDeadline);
  });

  test("a run that trimmed nothing says nothing - nor does every run once every table is done", async () => {
    await runJob();

    mockRun.mockResolvedValue(summary({ isEveryTableDone: true }) as never);
    await runJob();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a run that trimmed something says how much, before and after, which tables are done, and where the rest went", async () => {
    mockRun.mockResolvedValue(
      summary({
        rowsTrimmed: 27,
        rowsReplacedByMarkers: 2,
        storedBytesBefore: 353 * 1024 * 1024,
        storedBytesAfter: 120 * 1024,
        failedRows: 2,
        failedTables: 1,
        finishedTables: ["AlertStateTimeline", "Alert"],
        isCutShort: true,
      }) as never,
    );

    await runJob();

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);

    const line: string = String(mockedLogger.info.mock.calls[0]![0]);

    // The sizes kept with their unit by a no-break space.
    expect(line).toContain(
      `trimmed 29 oversized stored checks (353.0${NO_BREAK_SPACE}MB as stored before, 120${NO_BREAK_SPACE}KB after)`,
    );
    expect(line).toContain(
      "2 of them could not be trimmed within the database's limits and keep only a note that they were trimmed",
    );
    expect(line).toContain(
      "AlertStateTimeline, Alert are done and not read again",
    );
    expect(line).toContain("2 rows failed and are tried again next run");
    expect(line).toContain("1 table failed and is tried again next run");
    expect(line).toContain("the rest wait for the next run");
  });

  test("a run that only finished a table says so, in the singular", async () => {
    mockRun.mockResolvedValue(
      summary({ finishedTables: ["MonitorStatusTimeline"] }) as never,
    );

    await runJob();

    const line: string = String(mockedLogger.info.mock.calls[0]![0]);

    expect(line).toContain("MonitorStatusTimeline is done and not read again");
    expect(line).not.toContain("failed");
    expect(line).not.toContain("the rest wait");
  });

  test("a run whose rows all failed still says so", async () => {
    mockRun.mockResolvedValue(summary({ failedRows: 1 }) as never);

    await runJob();

    expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
      "1 row failed and is tried again next run",
    );
  });

  test("one check is one check, in the singular", async () => {
    mockRun.mockResolvedValue(
      summary({
        rowsReplacedByMarkers: 1,
        storedBytesBefore: 12 * 1024 * 1024,
        storedBytesAfter: 300,
      }) as never,
    );

    await runJob();

    expect(String(mockedLogger.info.mock.calls[0]![0])).toBe(
      `Oversized stored checks: trimmed 1 oversized stored check (12.0${NO_BREAK_SPACE}MB as stored before, 0${NO_BREAK_SPACE}KB after); 1 of them could not be trimmed within the database's limits and keeps only a note that it was trimmed.`,
    );
  });

  test("a failure is logged, and the job does not fail: the next hour tries again", async () => {
    mockRun.mockRejectedValue(new Error("database is restarting") as never);

    await expect(runJob()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
    expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
      "trimming the oversized checks kept before they were bounded failed",
    );
  });
});
