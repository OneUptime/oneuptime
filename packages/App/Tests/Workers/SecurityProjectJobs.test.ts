import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the ThreatIntelJobs pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The detection rules, the "Your logs" scan and the SIEM forwarding each
 * run as a cron that queues one turn per project, and a queue job that does
 * that turn (SecurityProjectWork). This file loads the three cron modules
 * with the REAL RunCron and JobDictionary, and pins both halves: what each
 * cron schedules and calls, and that each project job runs its engine for
 * the project its payload names, under the project's lease.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockEnqueueProjectsWithDueRules: jest.Mock = jest.fn();
const mockEvaluateDueRulesForProject: jest.Mock = jest.fn();
const mockEnqueueProjectsWithEnabledSources: jest.Mock = jest.fn();
const mockScanProject: jest.Mock = jest.fn();
const mockEnqueueProjectsWithEnabledDestinations: jest.Mock = jest.fn();
const mockForwardProject: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator", () => {
  return {
    __esModule: true,
    DETECTION_RULES_PROJECT_WORK: {
      jobName: "DetectionRules:EvaluateProject",
      key: "detection-rules",
      maxConcurrentProjects: 16,
    },
    default: {
      enqueueProjectsWithDueRules: mockEnqueueProjectsWithDueRules,
      evaluateDueRulesForProject: mockEvaluateDueRulesForProject,
    },
  };
});

jest.mock(
  "Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner",
  () => {
    return {
      __esModule: true,
      SECURITY_LOG_SCAN_PROJECT_WORK: {
        jobName: "SecurityEvents:ScanProjectLogs",
        key: "security-log-scan",
        maxConcurrentProjects: 8,
      },
      default: {
        enqueueProjectsWithEnabledSources:
          mockEnqueueProjectsWithEnabledSources,
        scanProject: mockScanProject,
      },
    };
  },
);

jest.mock(
  "Common/Server/Utils/SecurityEvent/Destinations/SecurityEventForwarder",
  () => {
    return {
      __esModule: true,
      SECURITY_EVENT_FORWARD_PROJECT_WORK: {
        jobName: "SecurityEvents:ForwardProject",
        key: "security-event-forward",
        maxConcurrentProjects: 8,
      },
      default: {
        enqueueProjectsWithEnabledDestinations:
          mockEnqueueProjectsWithEnabledDestinations,
        forwardProject: mockForwardProject,
      },
    };
  },
);

jest.mock("Common/Server/Utils/SecurityEvent/SecurityProjectWork", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/SecurityEvent/SecurityProjectWork",
  );
  const actualDefault: { projectIdOfJob: unknown } = actual["default"] as {
    projectIdOfJob: unknown;
  };

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

// Imported AFTER the mocks; the job imports come last - their side effects are the subject.
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import { SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/DetectionRules/EvaluateDetectionRules";
import "../../FeatureSet/Workers/Jobs/SecurityEvents/ScanLogsForSecurityEvents";
import "../../FeatureSet/Workers/Jobs/SecurityEvents/ForwardSecurityEvents";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";

interface PipelineCase {
  cronJobName: string;
  projectJobName: string;
  dispatch: jest.Mock;
  turn: jest.Mock;
}

const PIPELINES: Array<PipelineCase> = [
  {
    cronJobName: "DetectionRules:EvaluateDetectionRules",
    projectJobName: "DetectionRules:EvaluateProject",
    dispatch: mockEnqueueProjectsWithDueRules,
    turn: mockEvaluateDueRulesForProject,
  },
  {
    cronJobName: "SecurityEvents:ScanLogsForSecurityEvents",
    projectJobName: "SecurityEvents:ScanProjectLogs",
    dispatch: mockEnqueueProjectsWithEnabledSources,
    turn: mockScanProject,
  },
  {
    cronJobName: "SecurityEvents:ForwardSecurityEvents",
    projectJobName: "SecurityEvents:ForwardProject",
    dispatch: mockEnqueueProjectsWithEnabledDestinations,
    turn: mockForwardProject,
  },
];

beforeEach(() => {
  for (const pipeline of PIPELINES) {
    pipeline.dispatch.mockReset();
    pipeline.dispatch.mockResolvedValue(0 as never);
    pipeline.turn.mockReset();
    pipeline.turn.mockResolvedValue(undefined as never);
  }

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

describe("security project jobs — the crons", () => {
  test("each cron schedules exactly once, every minute, with no run-on-startup call", () => {
    expect(registrationAddJobCalls).toHaveLength(PIPELINES.length);

    for (const pipeline of PIPELINES) {
      const call: Array<unknown> | undefined = registrationAddJobCalls.find(
        (candidate: Array<unknown>) => {
          return candidate[2] === pipeline.cronJobName;
        },
      );

      expect(call).toBeDefined();
      expect(call![0]).toBe("Worker");
      expect(call![4]).toEqual({ scheduleAt: EVERY_MINUTE });
    }
  });

  test("each cron only queues projects: it never does a project's work itself", async () => {
    for (const pipeline of PIPELINES) {
      const cron: PromiseVoidFunction = JobDictionary.getJobFunction(
        pipeline.cronJobName,
      );

      await cron();

      expect(pipeline.dispatch).toHaveBeenCalledTimes(1);
      expect(pipeline.turn).not.toHaveBeenCalled();
      expect(mockRunForProject).not.toHaveBeenCalled();
    }
  });

  test("a cron that cannot queue its projects fails, so the failure is seen", async () => {
    const pipeline: PipelineCase = PIPELINES[0]!;
    const failure: Error = new Error("Postgres went away");
    pipeline.dispatch.mockRejectedValue(failure as never);

    await expect(
      JobDictionary.getJobFunction(pipeline.cronJobName)(),
    ).rejects.toThrow(failure);
  });
});

describe("security project jobs — a project's turn", () => {
  test("each project job is registered with the project-work timeout", () => {
    for (const pipeline of PIPELINES) {
      expect(typeof JobDictionary.getJobFunction(pipeline.projectJobName)).toBe(
        "function",
      );
      expect(JobDictionary.getTimeoutInMs(pipeline.projectJobName)).toBe(
        SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS,
      );
    }
  });

  test("each runs its engine for the project in the payload, under that project's lease", async () => {
    for (const pipeline of PIPELINES) {
      mockRunForProject.mockClear();

      await JobDictionary.getJobFunction(pipeline.projectJobName)({
        data: { projectId: PROJECT_ID },
      } as unknown as QueueJob);

      expect(mockRunForProject).toHaveBeenCalledTimes(1);
      expect(mockRunForProject.mock.calls[0]?.[0]).toMatchObject({
        jobName: pipeline.projectJobName,
      });
      expect(String(mockRunForProject.mock.calls[0]?.[1])).toBe(PROJECT_ID);
      expect(pipeline.turn).toHaveBeenCalledTimes(1);
      expect(String(pipeline.turn.mock.calls[0]?.[0])).toBe(PROJECT_ID);
      expect(pipeline.turn.mock.calls[0]?.[1]).toBe(TEST_LEASE);
    }
  });

  test("a project whose lease is held elsewhere is left alone this minute", async () => {
    mockRunForProject.mockResolvedValue("Busy" as never);

    for (const pipeline of PIPELINES) {
      await expect(
        JobDictionary.getJobFunction(pipeline.projectJobName)({
          data: { projectId: PROJECT_ID },
        } as unknown as QueueJob),
      ).resolves.toBeUndefined();
      expect(pipeline.turn).not.toHaveBeenCalled();
    }
  });

  test("a payload without a valid project id is refused before any lease is taken", async () => {
    for (const pipeline of PIPELINES) {
      await expect(
        JobDictionary.getJobFunction(pipeline.projectJobName)({
          data: {},
        } as unknown as QueueJob),
      ).rejects.toThrow("A valid project ID is required.");
    }

    expect(mockRunForProject).not.toHaveBeenCalled();
  });
});
