import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls, or tsc sees two
 * incompatible Mock shapes (the PollGoogleSecOpsConnectionsJob pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The two threat-intel crons are SCHEDULED AT ALL, and scheduled the way
 * the feature needs — the PollGoogleSecOpsConnectionsJob discipline
 * applied to its threat-intel twins. RunCron registers purely as a module
 * side effect, so the single import line in App/FeatureSet/Workers/
 * Index.ts is load-bearing: delete it and every poller/matcher suite
 * stays green while production never polls a feed or evaluates a match.
 * The REAL RunCron and JobDictionary run here; only the queue underneath
 * them (and the pollers, so the delegation is observable) is replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockPollAllDueFeeds: jest.Mock = jest.fn();
const mockEvaluateAllDueFeeds: jest.Mock = jest.fn();

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

jest.mock(
  "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller",
  () => {
    return {
      __esModule: true,
      default: {
        pollAllDueFeeds: mockPollAllDueFeeds,
      },
    };
  },
);

jest.mock(
  "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher",
  () => {
    return {
      __esModule: true,
      default: {
        evaluateAllDueFeeds: mockEvaluateAllDueFeeds,
      },
    };
  },
);

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
 * Imported AFTER the mocks and the bindings their factories close over;
 * the job imports come last — their side effects are what this file is
 * about.
 */
import ThreatIntelFeedPoller from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import ThreatIntelMatcher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/ThreatIntel/PollThreatIntelFeeds";
import "../../FeatureSet/Workers/Jobs/ThreatIntel/MatchThreatIntelIndicators";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const poller: { pollAllDueFeeds: jest.Mock } =
  ThreatIntelFeedPoller as unknown as { pollAllDueFeeds: jest.Mock };
const matcher: { evaluateAllDueFeeds: jest.Mock } =
  ThreatIntelMatcher as unknown as { evaluateAllDueFeeds: jest.Mock };

const POLL_JOB_NAME: string = "ThreatIntel:PollThreatIntelFeeds";
const MATCH_JOB_NAME: string = "ThreatIntel:MatchThreatIntelIndicators";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");
const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");

const JOB_FILES: Array<{ name: string; file: string }> = [
  {
    name: POLL_JOB_NAME,
    file: path.join(
      WORKERS_DIR,
      "Jobs",
      "ThreatIntel",
      "PollThreatIntelFeeds.ts",
    ),
  },
  {
    name: MATCH_JOB_NAME,
    file: path.join(
      WORKERS_DIR,
      "Jobs",
      "ThreatIntel",
      "MatchThreatIntelIndicators.ts",
    ),
  },
];

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

const UNREGISTERED_JOB_NAME: string = "ThreatIntel:NotARealJob";
const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  UNREGISTERED_JOB_NAME,
);

beforeEach(() => {
  poller.pollAllDueFeeds.mockReset();
  poller.pollAllDueFeeds.mockResolvedValue(undefined as never);
  matcher.evaluateAllDueFeeds.mockReset();
  matcher.evaluateAllDueFeeds.mockResolvedValue(undefined as never);
});

describe("threat-intel jobs — wired into the worker at all", () => {
  test("Workers/Index.ts imports both job modules as top-level side effects", () => {
    const indexSource: string = fs.readFileSync(WORKERS_INDEX_PATH, {
      encoding: "utf-8",
    });

    for (const job of JOB_FILES) {
      expect(fs.existsSync(job.file)).toBe(true);

      const specifier: string = moduleSpecifierFor(WORKERS_DIR, job.file);

      const sideEffectImport: RegExp = new RegExp(
        `^\\s*import\\s+["']${escapeForRegExp(specifier)}["']\\s*;?\\s*$`,
        "m",
      );

      expect(indexSource).toMatch(sideEffectImport);
    }
  });
});

describe("threat-intel jobs — registration", () => {
  test("registering logged no error, so nothing was silently swallowed", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("both jobs put runnable functions in JobDictionary under their exact names", () => {
    for (const job of JOB_FILES) {
      const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
        job.name,
      );

      expect(typeof jobFunction).toBe("function");
    }
  });

  test("each schedules exactly once, on EVERY_MINUTE, with no run-on-startup call", () => {
    expect(registrationAddJobCalls).toHaveLength(2);

    const byName: Map<string, Array<unknown>> = new Map<
      string,
      Array<unknown>
    >();

    for (const call of registrationAddJobCalls) {
      // Queue.addJob(queueName, jobId, jobName, data, options)
      byName.set(call[2] as string, call);
    }

    for (const jobName of [POLL_JOB_NAME, MATCH_JOB_NAME]) {
      const call: Array<unknown> | undefined = byName.get(jobName);

      expect(call).toBeDefined();
      expect(call![0]).toBe("Worker");
      expect(call![4]).toEqual({ scheduleAt: EVERY_MINUTE });
    }
  });

  test("both register their own 10-minute timeout, not the dictionary default", () => {
    for (const job of JOB_FILES) {
      const timeoutInMs: number = JobDictionary.getTimeoutInMs(job.name);

      expect(timeoutInMs).toBe(10 * 60 * 1000);
      expect(timeoutInMs).not.toBe(DEFAULT_JOB_TIMEOUT_IN_MS);
    }
  });
});

describe("threat-intel jobs — what the registered functions do", () => {
  test("the poll job delegates to (and awaits) ThreatIntelFeedPoller.pollAllDueFeeds", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(POLL_JOB_NAME);

    await jobFunction();
    expect(poller.pollAllDueFeeds).toHaveBeenCalledTimes(1);

    const failure: Error = new Error("poll failed");
    poller.pollAllDueFeeds.mockRejectedValue(failure as never);

    await expect(jobFunction()).rejects.toThrow(failure);
  });

  test("the match job delegates to (and awaits) ThreatIntelMatcher.evaluateAllDueFeeds", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(MATCH_JOB_NAME);

    await jobFunction();
    expect(matcher.evaluateAllDueFeeds).toHaveBeenCalledTimes(1);

    const failure: Error = new Error("match failed");
    matcher.evaluateAllDueFeeds.mockRejectedValue(failure as never);

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
