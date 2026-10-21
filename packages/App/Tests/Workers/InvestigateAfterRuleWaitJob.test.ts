import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The job that ends the waits investigation rules set (issue #5074) is
 * SCHEDULED AT ALL. RunCron registers purely as a module side effect, so the
 * import line in App/FeatureSet/Workers/Index.ts is load-bearing: delete it
 * and every service suite stays green while an incident a rule makes
 * OneUptime AI wait for is never investigated - it waits forever, its AI
 * card saying it will be investigated at a time long past. The REAL RunCron
 * and JobDictionary run here; only the queue under them and the rule wait
 * they delegate to are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockRun: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/AI/SRE/InvestigationRuleWait", () => {
  return {
    __esModule: true,
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
 * Imported AFTER the mocks; the job import comes last - its side effects
 * are what this file is about.
 */
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/AIChat/InvestigateAfterRuleWait";

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
const JOB_NAME: string = "AIChat:InvestigateAfterRuleWait";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");
const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");
const JOB_FILE: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "AIChat",
  "InvestigateAfterRuleWait.ts",
);

function sideEffectImport(specifier: string): RegExp {
  const escaped: string = escapeRegExp(specifier);

  return new RegExp(`^\\s*import\\s+["']${escaped}["']\\s*;?\\s*$`, "m");
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(undefined as never);
});

describe("investigations after an investigation rule's wait - wired into the worker at all", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect, beside the queue poller", () => {
    expect(fs.existsSync(JOB_FILE)).toBe(true);

    const indexSource: string = fs.readFileSync(WORKERS_INDEX_PATH, {
      encoding: "utf-8",
    });

    expect(indexSource).toMatch(
      sideEffectImport("./Jobs/AIChat/InvestigateAfterRuleWait"),
    );
    // The runs it queues are drained by its sibling.
    expect(indexSource).toMatch(
      sideEffectImport("./Jobs/AIChat/ProcessQueuedInvestigations"),
    );
  });
});

describe("investigations after an investigation rule's wait - registration", () => {
  test("registering logged no error", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("puts a runnable function in JobDictionary under its exact name", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(true);
    expect(typeof JobDictionary.getJobFunction(JOB_NAME)).toBe("function");
  });

  test("is scheduled exactly once, every minute on the Worker queue, with no run on startup", () => {
    /*
     * Every minute: a wait is set in minutes, and the AI card says the
     * minute it ends. Queue.addJob(queueName, jobId, jobName, data, options)
     */
    expect(registrationAddJobCalls).toHaveLength(1);

    const [queueName, jobId, jobName, , options] = registrationAddJobCalls[0]!;

    expect(queueName).toBe("Worker");
    expect(jobId).toBe(JOB_NAME);
    expect(jobName).toBe(JOB_NAME);
    expect(options).toEqual({ scheduleAt: EVERY_MINUTE });
  });
});

describe("investigations after an investigation rule's wait - what the registered function does", () => {
  test("ends the waits once per tick, and awaits it", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    let finished: boolean = false;
    mockRun.mockImplementation(async () => {
      await Promise.resolve();
      finished = true;
    });

    await jobFunction();

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(finished).toBe(true);
  });
});
