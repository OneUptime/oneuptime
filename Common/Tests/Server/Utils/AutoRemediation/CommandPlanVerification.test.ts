import RemediationVerifier from "../../../../Server/Utils/AutoRemediation/RemediationVerifier";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import RunbookExecutionService from "../../../../Server/Services/RunbookExecutionService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the verifier's command-plan branch. A CommandPlan
 * suggestion has no runbook execution: the plan persisted on the suggestion
 * plays that role. A Failed (or window-overrunning) plan fails verification
 * and — only after WINNING the verification CAS — triggers the rollback
 * arm; a Completed plan is judged by the same subject-resolved /
 * monitors-operational checks as a runbook, including auto-resolve;
 * a missing plan or a subject with no monitors settles Skipped, quietly.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STATE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const FUTURE: Date = new Date(Date.now() + 10 * 60 * 1000);
const PAST: Date = new Date(Date.now() - 10 * 60 * 1000);

function rawPlan(executionStatus: string): Record<string, unknown> {
  return {
    commands: [
      {
        sequence: 1,
        stepType: "Bash",
        runnerId: RUNNER_ID.toString(),
        runnerNameSnapshot: "prod-runner-1",
        command: "systemctl restart nginx",
        timeoutInMs: 5000,
        rationale: "The service crashed.",
        expectedEffect: "The service restarts.",
        policyVerdict: "RequiresApproval",
        rollbackCommand: "systemctl stop nginx",
        execution: { status: "Succeeded", exitCode: 0 },
      },
    ],
    executionStatus: executionStatus,
  };
}

function fakePending(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: rawPlan("Completed"),
    verificationDeadlineAt: FUTURE,
    autoResolveOnRecovery: false,
    ruleNameSnapshot: "Restart nginx",
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function mockPendingList(suggestion: AutoRemediationSuggestion): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue([suggestion]);
}

function mockIncident(overrides: Partial<Record<string, unknown>> = {}): void {
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    currentIncidentStateId: STATE_ID,
    monitors: [{ id: MONITOR_ID }],
    ...overrides,
  } as unknown as Incident);
}

function mockIncidentState(isResolved: boolean): void {
  jest.spyOn(IncidentStateService, "findOneById").mockResolvedValue({
    id: STATE_ID,
    isResolvedState: isResolved,
  } as unknown as IncidentState);
}

function mockMonitorOperational(isOperational: boolean): void {
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue({
    id: MONITOR_ID,
    currentMonitorStatusId: STATE_ID,
  } as unknown as Monitor);
  jest.spyOn(MonitorStatusService, "findOneById").mockResolvedValue({
    id: STATE_ID,
    isOperationalState: isOperational,
  } as unknown as MonitorStatus);
}

function mockCas(result: number): jest.SpyInstance {
  return jest
    .spyOn(AutoRemediationSuggestionService, "attemptVerificationTransition")
    .mockResolvedValue(result as never);
}

function mockFeed(): jest.SpyInstance {
  return jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
}

function mockRollback(): jest.SpyInstance {
  return jest
    .spyOn(CommandPlanExecutor, "executeRollback")
    .mockResolvedValue(undefined as never);
}

describe("RemediationVerifier.verifyPendingRemediations — command plans", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips quietly when no command plan was recorded on the suggestion", async () => {
    mockPendingList(fakePending({ commandPlan: undefined }));
    const cas: jest.SpyInstance = mockCas(1);
    const feed: jest.SpyInstance = mockFeed();
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: SUGGESTION_ID,
        fromVerificationStatus: AutoRemediationVerificationStatus.Pending,
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Skipped,
        }),
      }),
    );
    expect(feed).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("fails verification and rolls back when the plan itself failed", async () => {
    mockPendingList(fakePending({ commandPlan: rawPlan("Failed") }));
    const runbookLookup: jest.SpyInstance = jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockResolvedValue(null);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      }),
    );
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion: expect.objectContaining({ id: SUGGESTION_ID }),
      }),
    );
    // Rollback fires only AFTER the verification CAS was won.
    expect(cas.mock.invocationCallOrder[0]).toBeLessThan(
      rollback.mock.invocationCallOrder[0]!,
    );
    // The command-plan branch never consults the runbook execution.
    expect(runbookLookup).not.toHaveBeenCalled();
  });

  it("fails verification and rolls back when a Running plan overran the window", async () => {
    mockPendingList(
      fakePending({
        commandPlan: rawPlan("Running"),
        verificationDeadlineAt: PAST,
      }),
    );
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      }),
    );
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("settles nothing while the plan is still running inside the window", async () => {
    mockPendingList(fakePending({ commandPlan: rawPlan("Running") }));
    const cas: jest.SpyInstance = mockCas(1);
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("verifies, auto-resolves, and never rolls back when the monitors recovered", async () => {
    mockPendingList(fakePending({ autoResolveOnRecovery: true }));
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(true);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();
    const rollback: jest.SpyInstance = mockRollback();
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(STATE_ID);
    const resolveTimeline: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue({} as unknown as IncidentStateTimeline);

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
      }),
    );
    expect(resolveTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: INCIDENT_ID,
          incidentStateId: STATE_ID,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(rollback).not.toHaveBeenCalled();
  });

  it("verifies without auto-resolve when the subject was already resolved", async () => {
    mockPendingList(fakePending({ autoResolveOnRecovery: true }));
    mockIncident();
    mockIncidentState(true);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();
    const rollback: jest.SpyInstance = mockRollback();
    const resolveTimeline: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue({} as unknown as IncidentStateTimeline);

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
      }),
    );
    expect(resolveTimeline).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("skips quietly when the completed plan's subject has no monitors", async () => {
    mockPendingList(fakePending());
    mockIncident({ monitors: [] });
    mockIncidentState(false);
    const cas: jest.SpyInstance = mockCas(1);
    const feed: jest.SpyInstance = mockFeed();
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Skipped,
        }),
      }),
    );
    expect(feed).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("fails and rolls back when the plan completed but the service never recovered", async () => {
    mockPendingList(fakePending({ verificationDeadlineAt: PAST }));
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(false);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      }),
    );
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("never rolls back and posts no feed item when the CAS loses the race", async () => {
    mockPendingList(fakePending({ commandPlan: rawPlan("Failed") }));
    mockCas(0);
    const feed: jest.SpyInstance = mockFeed();
    const rollback: jest.SpyInstance = mockRollback();

    await RemediationVerifier.verifyPendingRemediations();

    expect(feed).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });
});
