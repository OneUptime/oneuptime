import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The job that investigates the incidents and alerts a project's own daily
 * AI limit skipped, once the limit no longer stops OneUptime AI, is
 * SCHEDULED AT ALL. RunCron registers purely as a module side effect, so
 * the import line in App/FeatureSet/Workers/Index.ts is load-bearing:
 * delete it and every service suite stays green while no skipped record is
 * ever investigated after the reset - the bug this job fixes. The REAL
 * RunCron and JobDictionary run here; only the queue under them and the
 * catch-up they delegate to are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockCatchUp: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/AI/SRE/InvestigationLimitCatchUp", () => {
  return {
    __esModule: true,
    default: {
      run: mockCatchUp,
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
 * Imported AFTER the mocks; the job import comes last - its side effects
 * are what this file is about.
 */
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/AIChat/InvestigateAfterDailyLimitReset";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

/*
 * The name is the queue's job id, so it is a contract with the scheduled
 * job already in Redis: a rename schedules a second copy.
 */
const JOB_NAME: string = "AIChat:InvestigateAfterDailyLimitReset";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");
const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");
const JOB_FILE: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "AIChat",
  "InvestigateAfterDailyLimitReset.ts",
);

function sideEffectImport(specifier: string): RegExp {
  const escaped: string = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`^\\s*import\\s+["']${escaped}["']\\s*;?\\s*$`, "m");
}

beforeEach(() => {
  mockCatchUp.mockReset();
  mockCatchUp.mockResolvedValue([] as never);
});

describe("investigations after the daily AI limit resets - wired into the worker at all", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect, beside the queue poller", () => {
    expect(fs.existsSync(JOB_FILE)).toBe(true);

    const indexSource: string = fs.readFileSync(WORKERS_INDEX_PATH, {
      encoding: "utf-8",
    });

    expect(indexSource).toMatch(
      sideEffectImport("./Jobs/AIChat/InvestigateAfterDailyLimitReset"),
    );
    // The queue it feeds is drained by its sibling.
    expect(indexSource).toMatch(
      sideEffectImport("./Jobs/AIChat/ProcessQueuedInvestigations"),
    );
  });
});

describe("investigations after the daily AI limit resets - registration", () => {
  test("registering logged no error", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("puts a runnable function in JobDictionary under its exact name", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(true);
    expect(typeof JobDictionary.getJobFunction(JOB_NAME)).toBe("function");
  });

  test("is scheduled exactly once, every five minutes on the Worker queue, with no run on startup", () => {
    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(registrationAddJobCalls).toHaveLength(1);

    const [queueName, jobId, jobName, , options] = registrationAddJobCalls[0]!;

    expect(queueName).toBe("Worker");
    expect(jobId).toBe(JOB_NAME);
    expect(jobName).toBe(JOB_NAME);
    expect(options).toEqual({ scheduleAt: EVERY_FIVE_MINUTE });
  });
});

describe("investigations after the daily AI limit resets - what the registered function does", () => {
  test("runs the catch-up once per tick, and awaits it", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    let finished: boolean = false;
    mockCatchUp.mockImplementation(async () => {
      await Promise.resolve();
      finished = true;
      return [];
    });

    await jobFunction();

    expect(mockCatchUp).toHaveBeenCalledTimes(1);
    expect(finished).toBe(true);
  });
});
