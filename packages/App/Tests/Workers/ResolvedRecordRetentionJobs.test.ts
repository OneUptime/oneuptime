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
 * The jobs that delete the resolved incidents and alerts a project no
 * longer keeps (issue #6903): Incident:DeleteResolvedIncidents and
 * Alert:DeleteResolvedAlerts, hourly, each running
 * ResolvedRecordRetention for its kind. The REAL RunCron and JobDictionary
 * run here; the queue, the retention itself and the logger are replaced.
 *
 * Pinned: both are scheduled at all (RunCron registers as a side effect of
 * the import in Workers/Index.ts), hourly, never on startup, with room past
 * the run's own budget for its last delete; each runs its own kind, handed
 * the run's deadline; a run that deleted nothing and finished says nothing,
 * one that did says how much, one cut short says so - the next run starts
 * where it stopped (issue #8896) - and a failure is logged without failing
 * the job - the next hour tries again.
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

jest.mock("Common/Server/Utils/Retention/ResolvedRecordRetention", () => {
  return {
    __esModule: true,
    RETENTION_TIME_BUDGET_MS: mockBudgetMs,
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
 * jobs register themselves when they are imported.
 */
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import { ResolvedRecordKind } from "Common/Types/Retention/ResolvedRecordRetention";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/Incident/DeleteResolvedIncidents";
import "../../FeatureSet/Workers/Jobs/Alert/DeleteResolvedAlerts";

// Snapshotted at import time; registration happens exactly once a job.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

interface Job {
  name: string;
  file: string;
  kind: ResolvedRecordKind;
  noun: string;
}

const JOBS: Array<Job> = [
  {
    name: "Incident:DeleteResolvedIncidents",
    file: "Jobs/Incident/DeleteResolvedIncidents",
    kind: ResolvedRecordKind.Incident,
    noun: "incidents",
  },
  {
    name: "Alert:DeleteResolvedAlerts",
    file: "Jobs/Alert/DeleteResolvedAlerts",
    kind: ResolvedRecordKind.Alert,
    noun: "alerts",
  },
];

function summary(
  overrides: Partial<{
    projects: number;
    failedProjects: number;
    records: number;
    episodes: number;
    isCutShort: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    projects: 0,
    failedProjects: 0,
    records: 0,
    episodes: 0,
    isCutShort: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(summary() as never);
  mockedLogger.info.mockClear();
  mockedLogger.error.mockClear();
});

describe.each(JOBS)("$name - wired into the worker", (job: Job) => {
  test("Workers/Index.ts imports the job as a top-level side effect", () => {
    expect(fs.existsSync(path.join(WORKERS_DIR, `${job.file}.ts`))).toBe(true);

    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']\\./${escapeRegExp(job.file)}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("registers once, hourly on the Worker queue, not on startup, with room past its budget for the last delete", () => {
    expect(JobDictionary.has(job.name)).toBe(true);

    const calls: Array<Array<unknown>> = registrationAddJobCalls.filter(
      (call: Array<unknown>) => {
        return call[2] === job.name;
      },
    );

    expect(calls).toHaveLength(1);
    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(calls[0]![0]).toBe("Worker");
    expect(calls[0]![4]).toEqual({ scheduleAt: EVERY_HOUR });
    expect(JobDictionary.getTimeoutInMs(job.name)).toBe(
      mockBudgetMs + 2 * 60 * 1000,
    );
  });
});

describe.each(JOBS)("$name - what it runs", (job: Job) => {
  test("runs the retention for its own kind, with the module's own budget and the run's deadline", async () => {
    const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
      job.name,
    );

    await jobFunction();

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith({
      kind: job.kind,
      deadline: expect.any(JobDeadline),
    });
  });

  /*
   * The deadline RunCron hands the run passes with the queue job's: its
   * time limit, or a lost lock. The retention stops starting projects then,
   * and the next run starts where it stopped.
   */
  test("the deadline it hands the retention passes with the queue job's", async () => {
    const queueDeadline: JobDeadline = new JobDeadline();

    await (
      JobDictionary.getJobFunction(job.name) as unknown as (
        queueJob: unknown,
        deadline: JobDeadline,
      ) => Promise<void>
    )(undefined, queueDeadline);

    const handed: JobDeadline = (
      mockRun.mock.calls[0]![0] as { deadline: JobDeadline }
    ).deadline;

    expect(handed.hasPassed()).toBe(false);

    queueDeadline.end(new Error("The job ran out of time."));

    expect(handed.hasPassed()).toBe(true);
  });

  test("a run that deleted nothing and finished says nothing", async () => {
    mockRun.mockResolvedValue(summary({ projects: 4 }) as never);

    await JobDictionary.getJobFunction(job.name)();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a run that deleted something says how much, and where the rest went", async () => {
    mockRun.mockResolvedValue(
      summary({
        projects: 3,
        records: 250,
        episodes: 4,
        failedProjects: 1,
        isCutShort: true,
      }) as never,
    );

    await JobDictionary.getJobFunction(job.name)();

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);

    const line: string = String(mockedLogger.info.mock.calls[0]![0]);

    expect(line).toContain(`deleted 250 resolved ${job.noun}`);
    expect(line).toContain("4 episodes");
    expect(line).toContain("across 3 projects");
    expect(line).toContain("1 failed and are tried again on their next turn");
    expect(line).toContain(
      "the run was cut short, and the next one starts where it stopped",
    );
  });

  // #8896: a run cut short used to say nothing when it had deleted nothing.
  test("a run cut short says so, though it deleted nothing", async () => {
    mockRun.mockResolvedValue(
      summary({ projects: 2400, isCutShort: true }) as never,
    );

    await JobDictionary.getJobFunction(job.name)();

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    expect(String(mockedLogger.info.mock.calls[0]![0])).toBe(
      `${job.kind} retention: deleted 0 resolved ${job.noun} and 0 episodes kept past their project's retention, across 2400 projects; the run was cut short, and the next one starts where it stopped.`,
    );
  });

  test("a run that finished says nothing of being cut short", async () => {
    mockRun.mockResolvedValue(summary({ projects: 2, records: 5 }) as never);

    await JobDictionary.getJobFunction(job.name)();

    expect(String(mockedLogger.info.mock.calls[0]![0])).toBe(
      `${job.kind} retention: deleted 5 resolved ${job.noun} and 0 episodes kept past their project's retention, across 2 projects.`,
    );
  });

  test("a failure is logged, and the job does not fail: the next hour tries again", async () => {
    mockRun.mockRejectedValue(new Error("database is restarting") as never);

    await expect(
      JobDictionary.getJobFunction(job.name)(),
    ).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
    expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
      `deleting the resolved ${job.noun}`,
    );
  });
});
