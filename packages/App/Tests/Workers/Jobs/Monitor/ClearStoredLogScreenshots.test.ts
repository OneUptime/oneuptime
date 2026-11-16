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
 * The job that clears the Synthetic monitor screenshots incidents, alerts
 * and monitor status changes kept before they stopped keeping them (issues
 * #6903, #6942): Monitor:ClearStoredLogScreenshots, hourly, running
 * StoredLogScreenshots. The REAL RunCron and JobDictionary run here; the
 * queue, the clean-up itself and the logger are replaced.
 *
 * Pinned: it is scheduled at all (RunCron registers as a side effect of the
 * import in Workers/Index.ts), hourly, never on startup, with room past the
 * run's own budget for its last write; it hands the clean-up the run's
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

jest.mock("Common/Server/Utils/Retention/StoredLogScreenshots", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Retention/StoredLogScreenshots",
  );

  return {
    __esModule: true,
    CLEAR_TIME_BUDGET_MS: mockBudgetMs,
    formatStoredBytes: actual["formatStoredBytes"],
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
import "../../../../FeatureSet/Workers/Jobs/Monitor/ClearStoredLogScreenshots";

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

const JOB_NAME: string = "Monitor:ClearStoredLogScreenshots";
const JOB_FILE: string = "Jobs/Monitor/ClearStoredLogScreenshots";

function summary(
  overrides: Partial<{
    rowsRead: number;
    rowsCleared: number;
    storedBytesCleared: number;
    failedRows: number;
    failedTables: number;
    finishedTables: Array<string>;
    isCutShort: boolean;
    isEveryTableDone: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    rowsRead: 0,
    rowsCleared: 0,
    storedBytesCleared: 0,
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

describe("Monitor:ClearStoredLogScreenshots - wired into the worker", () => {
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

  test("registers once, hourly on the Worker queue, not on startup, with room past its budget for the last write", () => {
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

describe("Monitor:ClearStoredLogScreenshots - what it runs", () => {
  test("runs the clean-up once, with the run's deadline and the module's own budget", async () => {
    await runJob();

    expect(mockRun).toHaveBeenCalledTimes(1);

    const args: { deadline?: unknown } = mockRun.mock.calls[0]![0] as {
      deadline?: unknown;
    };

    expect(Object.keys(args)).toEqual(["deadline"]);
    expect(args.deadline).toBeInstanceOf(JobDeadline);
  });

  test("a run that cleared nothing says nothing - nor does every run once every table is done", async () => {
    mockRun.mockResolvedValue(summary({ rowsRead: 12 }) as never);
    await runJob();

    mockRun.mockResolvedValue(summary({ isEveryTableDone: true }) as never);
    await runJob();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a run that cleared something says how much, which tables are done, and where the rest went", async () => {
    mockRun.mockResolvedValue(
      summary({
        rowsRead: 400,
        rowsCleared: 340,
        storedBytesCleared: 2.5 * 1024 * 1024 * 1024,
        failedRows: 2,
        failedTables: 1,
        finishedTables: ["IncidentStateTimeline", "AlertStateTimeline"],
        isCutShort: true,
      }) as never,
    );

    await runJob();

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);

    const line: string = String(mockedLogger.info.mock.calls[0]![0]);

    // The size kept with its unit by a no-break space.
    expect(line).toContain(
      `cleared the Synthetic monitor screenshots kept in 340 stored logs (2.5${NO_BREAK_SPACE}GB as stored)`,
    );
    expect(line).toContain(
      "IncidentStateTimeline, AlertStateTimeline are done and not read again",
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

  test("one log cleared is one log, in the singular", async () => {
    mockRun.mockResolvedValue(
      summary({ rowsCleared: 1, storedBytesCleared: 300 * 1024 }) as never,
    );

    await runJob();

    expect(String(mockedLogger.info.mock.calls[0]![0])).toBe(
      `Stored log screenshots: cleared the Synthetic monitor screenshots kept in 1 stored log (300${NO_BREAK_SPACE}KB as stored).`,
    );
  });

  test("a failure is logged, and the job does not fail: the next hour tries again", async () => {
    mockRun.mockRejectedValue(new Error("database is restarting") as never);

    await expect(runJob()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
    expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
      "clearing the screenshots kept in stored logs failed",
    );
  });
});
