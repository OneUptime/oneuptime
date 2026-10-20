import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIRunType from "Common/Types/AI/AIRunType";
import ObjectID from "Common/Types/ObjectID";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A STALE RUN AN INVESTIGATION RULE MADE WAIT (issue #5074). The stuck-run
 * sweeper hands every stale investigation to the queue, which requeues it
 * or, out of attempts, fails it and - for a run auto remediation waited
 * for - releases the incident to remediation. A run a rule made wait was
 * never waited for (remediation started when the incident was declared), so
 * the sweeper must read the wait off the run and pass it on: otherwise a
 * waited run that died would hand the incident to remediation a second
 * time. The REAL RunCron and JobDictionary run here; the queue under them,
 * the AI run reads and the investigation queue are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockFindRuns: jest.Mock = jest.fn();
const mockRequeueOrMarkStale: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Services/AIRunService", () => {
  return {
    __esModule: true,
    default: {
      findBy: mockFindRuns,
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AIConversationMessageService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(() => {
        return Promise.resolve([]);
      }),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/AI/SRE/InvestigationQueue", () => {
  return {
    __esModule: true,
    default: {
      requeueOrMarkStale: mockRequeueOrMarkStale,
    },
  };
});

jest.mock("Common/Server/Utils/AI/CodeFix/CodeFixRunQueue", () => {
  return {
    __esModule: true,
    default: {
      markStaleRunAsError: jest.fn(),
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
import AIRun from "Common/Models/DatabaseModels/AIRun";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns";

const JOB_NAME: string = "AIChat:TimeoutStuckRuns";
const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

function staleInvestigation(ruleWaitMinutes?: number): AIRun {
  const run: AIRun = new AIRun();
  run._id = ObjectID.generate().toString();
  run.runType = AIRunType.Investigation;
  run.status = AIRunStatus.Running;
  run.attemptCount = 3;
  run.projectId = PROJECT_ID;
  run.triggeredByIncidentId = INCIDENT_ID;
  run.lastHeartbeatAt = new Date("2026-10-20T10:00:00.000Z");

  if (ruleWaitMinutes !== undefined) {
    run.ruleWaitMinutes = ruleWaitMinutes;
  }

  return run;
}

beforeEach(() => {
  mockFindRuns.mockReset();
  mockRequeueOrMarkStale.mockReset();
  mockRequeueOrMarkStale.mockResolvedValue("stale" as never);
});

describe("the stuck-run sweeper and a run an investigation rule made wait", () => {
  test("reads the wait off every stale run", async () => {
    mockFindRuns.mockResolvedValue([] as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    const read: { select: Record<string, unknown> } = mockFindRuns.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(read.select["ruleWaitMinutes"]).toBe(true);
    // Beside what a follow-up check is read for, for the same reason.
    expect(read.select["followUpForAlertId"]).toBe(true);
  });

  test("hands a waited run to the queue with its wait, so it releases no remediation", async () => {
    const run: AIRun = staleInvestigation(10);
    mockFindRuns.mockResolvedValue([run] as never);

    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);
    await jobFunction();

    expect(mockRequeueOrMarkStale).toHaveBeenCalledTimes(1);
    expect(mockRequeueOrMarkStale.mock.calls[0]![0]).toMatchObject({
      id: run.id,
      runType: AIRunType.Investigation,
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      ruleWaitMinutes: 10,
    });
  });

  test("a run that did not wait is handed on without one, as before", async () => {
    mockFindRuns.mockResolvedValue([staleInvestigation()] as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    expect(mockRequeueOrMarkStale).toHaveBeenCalledTimes(1);
    expect(
      (mockRequeueOrMarkStale.mock.calls[0]![0] as Record<string, unknown>)[
        "ruleWaitMinutes"
      ],
    ).toBeUndefined();
  });
});
