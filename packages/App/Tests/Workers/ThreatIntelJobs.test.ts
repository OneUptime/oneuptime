import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls, or tsc sees two
 * incompatible Mock shapes (the PollSecurityEventConnectionsJob pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The two threat-intel crons are SCHEDULED AT ALL, and scheduled the way
 * the feature needs — the PollSecurityEventConnectionsJob discipline
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

const mockEnqueueProjectsWithDueFeeds: jest.Mock = jest.fn();
const mockPollDueFeedsForProject: jest.Mock = jest.fn();
const mockEnqueueProjectsWithEnabledFeeds: jest.Mock = jest.fn();
const mockEvaluateFeedsForProject: jest.Mock = jest.fn();

/*
 * A project's turn runs under SecurityProjectWork's lease and permit, which
 * need Valkey; here it runs the turn straight away with a lease of its own,
 * so the job's delegation is what is observed.
 */
const TEST_LEASE: { keep: jest.Mock; hasTimeLeft: jest.Mock } = {
  keep: jest.fn(),
  hasTimeLeft: jest.fn(),
};
const mockRunForProject: jest.Mock = jest.fn();

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
      THREAT_INTEL_POLL_PROJECT_WORK: {
        jobName: "ThreatIntel:PollProjectFeeds",
        key: "threat-intel-poll",
        maxConcurrentProjects: 8,
      },
      default: {
        enqueueProjectsWithDueFeeds: mockEnqueueProjectsWithDueFeeds,
        pollDueFeedsForProject: mockPollDueFeedsForProject,
      },
    };
  },
);

jest.mock(
  "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher",
  () => {
    return {
      __esModule: true,
      THREAT_INTEL_MATCH_PROJECT_WORK: {
        jobName: "ThreatIntel:MatchProjectIndicators",
        key: "threat-intel-match",
        maxConcurrentProjects: 8,
      },
      default: {
        enqueueProjectsWithEnabledFeeds: mockEnqueueProjectsWithEnabledFeeds,
        evaluateFeedsForProject: mockEvaluateFeedsForProject,
      },
    };
  },
);

jest.mock("Common/Server/Utils/SecurityEvent/SecurityProjectWork", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/SecurityEvent/SecurityProjectWork",
  );
  const actualDefault: { projectIdOfJob: unknown } = actual[
    "default"
  ] as { projectIdOfJob: unknown };

  return {
    ...actual,
    __esModule: true,
    default: {
      projectIdOfJob: actualDefault.projectIdOfJob,
      runForProject: mockRunForProject,
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
 * Imported AFTER the mocks and the bindings their factories close over;
 * the job imports come last — their side effects are what this file is
 * about.
 */
import ThreatIntelFeedPoller from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import { SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
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

const poller: {
  enqueueProjectsWithDueFeeds: jest.Mock;
  pollDueFeedsForProject: jest.Mock;
} = ThreatIntelFeedPoller as unknown as {
  enqueueProjectsWithDueFeeds: jest.Mock;
  pollDueFeedsForProject: jest.Mock;
};
const matcher: {
  enqueueProjectsWithEnabledFeeds: jest.Mock;
  evaluateFeedsForProject: jest.Mock;
} = ThreatIntelMatcher as unknown as {
  enqueueProjectsWithEnabledFeeds: jest.Mock;
  evaluateFeedsForProject: jest.Mock;
};

const POLL_JOB_NAME: string = "ThreatIntel:PollThreatIntelFeeds";
const MATCH_JOB_NAME: string = "ThreatIntel:MatchThreatIntelIndicators";
const POLL_PROJECT_JOB_NAME: string = "ThreatIntel:PollProjectFeeds";
const MATCH_PROJECT_JOB_NAME: string = "ThreatIntel:MatchProjectIndicators";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";

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

const UNREGISTERED_JOB_NAME: string = "ThreatIntel:NotARealJob";
const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  UNREGISTERED_JOB_NAME,
);

beforeEach(() => {
  poller.enqueueProjectsWithDueFeeds.mockReset();
  poller.enqueueProjectsWithDueFeeds.mockResolvedValue(0 as never);
  poller.pollDueFeedsForProject.mockReset();
  poller.pollDueFeedsForProject.mockResolvedValue(undefined as never);
  matcher.enqueueProjectsWithEnabledFeeds.mockReset();
  matcher.enqueueProjectsWithEnabledFeeds.mockResolvedValue(0 as never);
  matcher.evaluateFeedsForProject.mockReset();
  matcher.evaluateFeedsForProject.mockResolvedValue(undefined as never);
  mockRunForProject.mockReset();
  mockRunForProject.mockImplementation(
    async (
      _work: unknown,
      _projectId: unknown,
      turn: (lease: unknown) => Promise<void>,
    ): Promise<string> => {
      await turn(TEST_LEASE);
      return "Done";
    },
  );
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
        `^\\s*import\\s+["']${escapeRegExp(specifier)}["']\\s*;?\\s*$`,
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

  test("each registers the job that does one project's turn, with the project-work timeout", () => {
    for (const jobName of [POLL_PROJECT_JOB_NAME, MATCH_PROJECT_JOB_NAME]) {
      expect(typeof JobDictionary.getJobFunction(jobName)).toBe("function");
      expect(JobDictionary.getTimeoutInMs(jobName)).toBe(
        SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS,
      );
    }
  });
});

describe("threat-intel jobs — what the registered functions do", () => {
  test("the poll cron queues the projects with a feed due, and awaits it", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(POLL_JOB_NAME);

    await jobFunction();
    expect(poller.enqueueProjectsWithDueFeeds).toHaveBeenCalledTimes(1);
    expect(poller.pollDueFeedsForProject).not.toHaveBeenCalled();

    const failure: Error = new Error("poll failed");
    poller.enqueueProjectsWithDueFeeds.mockRejectedValue(failure as never);

    await expect(jobFunction()).rejects.toThrow(failure);
  });

  test("the match cron queues the projects with an enabled feed, and awaits it", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(MATCH_JOB_NAME);

    await jobFunction();
    expect(matcher.enqueueProjectsWithEnabledFeeds).toHaveBeenCalledTimes(1);
    expect(matcher.evaluateFeedsForProject).not.toHaveBeenCalled();

    const failure: Error = new Error("match failed");
    matcher.enqueueProjectsWithEnabledFeeds.mockRejectedValue(failure as never);

    await expect(jobFunction()).rejects.toThrow(failure);
  });

  test("a project's poll turn polls that project's due feeds under its lease", async () => {
    const jobFunction: (job?: QueueJob) => Promise<void> =
      JobDictionary.getJobFunction(POLL_PROJECT_JOB_NAME);

    await jobFunction({ data: { projectId: PROJECT_ID } } as unknown as QueueJob);

    expect(mockRunForProject).toHaveBeenCalledTimes(1);
    expect(mockRunForProject.mock.calls[0]?.[0]).toMatchObject({
      jobName: POLL_PROJECT_JOB_NAME,
    });
    expect(String(mockRunForProject.mock.calls[0]?.[1])).toBe(PROJECT_ID);
    expect(poller.pollDueFeedsForProject).toHaveBeenCalledTimes(1);
    expect(String(poller.pollDueFeedsForProject.mock.calls[0]?.[0])).toBe(
      PROJECT_ID,
    );
    expect(poller.pollDueFeedsForProject.mock.calls[0]?.[1]).toBe(TEST_LEASE);
  });

  test("a project's match turn checks that project's feeds under its lease", async () => {
    const jobFunction: (job?: QueueJob) => Promise<void> =
      JobDictionary.getJobFunction(MATCH_PROJECT_JOB_NAME);

    await jobFunction({ data: { projectId: PROJECT_ID } } as unknown as QueueJob);

    expect(mockRunForProject.mock.calls[0]?.[0]).toMatchObject({
      jobName: MATCH_PROJECT_JOB_NAME,
    });
    expect(String(matcher.evaluateFeedsForProject.mock.calls[0]?.[0])).toBe(
      PROJECT_ID,
    );
    expect(matcher.evaluateFeedsForProject.mock.calls[0]?.[1]).toBe(TEST_LEASE);
  });

  test("a turn without a valid project id is refused, and nothing runs", async () => {
    const jobFunction: (job?: QueueJob) => Promise<void> =
      JobDictionary.getJobFunction(POLL_PROJECT_JOB_NAME);

    await expect(
      jobFunction({ data: { projectId: "not-an-id" } } as unknown as QueueJob),
    ).rejects.toThrow("A valid project ID is required.");
    expect(mockRunForProject).not.toHaveBeenCalled();
    expect(poller.pollDueFeedsForProject).not.toHaveBeenCalled();
  });
});
