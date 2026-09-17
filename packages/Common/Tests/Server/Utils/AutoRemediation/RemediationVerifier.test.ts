import RemediationVerifier from "../../../../Server/Utils/AutoRemediation/RemediationVerifier";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import AlertService from "../../../../Server/Services/AlertService";
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
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the outcome verifier: a remediation is done when
 * the subject's monitors recover within the window, not when the runbook
 * exits. Runbook failure/overrun and non-recovery fail closed; recovery
 * verifies (with optional system auto-resolve); every conclusion goes
 * through the verification CAS; escalation is never touched.
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
const EXECUTION_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STATE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const FUTURE: Date = new Date(Date.now() + 10 * 60 * 1000);
const PAST: Date = new Date(Date.now() - 10 * 60 * 1000);

function fakePending(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    runbookExecutionId: EXECUTION_ID,
    verificationDeadlineAt: FUTURE,
    autoResolveOnRecovery: false,
    ruleNameSnapshot: "Restart API pods",
    runbookNameSnapshot: "Restart pods",
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function mockPendingList(suggestion: AutoRemediationSuggestion): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue([suggestion]);
}

function mockExecution(status: RunbookExecutionStatus): void {
  jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
    id: EXECUTION_ID,
    status,
  } as unknown as RunbookExecution);
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

describe("RemediationVerifier.verifyPendingRemediations", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fails verification when the runbook execution failed", async () => {
    mockPendingList(fakePending());
    mockExecution(RunbookExecutionStatus.Failed);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: SUGGESTION_ID,
        fromVerificationStatus: AutoRemediationVerificationStatus.Pending,
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      }),
    );
  });

  it("verifies when the runbook completed and the monitors recovered", async () => {
    mockPendingList(fakePending());
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(true);
    const cas: jest.SpyInstance = mockCas(1);
    const resolveTimeline: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue({} as unknown as IncidentStateTimeline);
    mockFeed();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
      }),
    );
    // autoResolveOnRecovery is false — no system resolve.
    expect(resolveTimeline).not.toHaveBeenCalled();
  });

  it("system-resolves the incident on verified recovery when the rule opted in", async () => {
    mockPendingList(fakePending({ autoResolveOnRecovery: true }));
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(true);
    mockCas(1);
    mockFeed();
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(STATE_ID);
    const resolveTimeline: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue({} as unknown as IncidentStateTimeline);

    await RemediationVerifier.verifyPendingRemediations();

    expect(resolveTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: INCIDENT_ID,
          incidentStateId: STATE_ID,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  it("fails verification when the window elapsed and the monitors did not recover", async () => {
    mockPendingList(fakePending({ verificationDeadlineAt: PAST }));
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(false);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      }),
    );
  });

  it("keeps waiting while the window is open and the monitors are still unhealthy", async () => {
    mockPendingList(fakePending());
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(false);
    const cas: jest.SpyInstance = mockCas(1);

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).not.toHaveBeenCalled();
  });

  it("fails verification when the runbook overran the window without completing", async () => {
    mockPendingList(fakePending({ verificationDeadlineAt: PAST }));
    mockExecution(RunbookExecutionStatus.Running);
    const cas: jest.SpyInstance = mockCas(1);
    mockFeed();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      }),
    );
  });

  it("verifies without auto-resolve when the subject was already resolved", async () => {
    mockPendingList(fakePending({ autoResolveOnRecovery: true }));
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident();
    mockIncidentState(true);
    const cas: jest.SpyInstance = mockCas(1);
    const resolveTimeline: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue({} as unknown as IncidentStateTimeline);
    mockFeed();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
      }),
    );
    expect(resolveTimeline).not.toHaveBeenCalled();
  });

  it("skips verification for a subject with no monitors, quietly", async () => {
    mockPendingList(fakePending());
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident({ monitors: [] });
    mockIncidentState(false);
    const cas: jest.SpyInstance = mockCas(1);
    const feed: jest.SpyInstance = mockFeed();

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Skipped,
        }),
      }),
    );
    expect(feed).not.toHaveBeenCalled();
  });

  it("posts no feed item and never auto-resolves when the CAS loses the race", async () => {
    mockPendingList(fakePending({ autoResolveOnRecovery: true }));
    mockExecution(RunbookExecutionStatus.Completed);
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(true);
    mockCas(0);
    const feed: jest.SpyInstance = mockFeed();
    const resolveTimeline: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue({} as unknown as IncidentStateTimeline);

    await RemediationVerifier.verifyPendingRemediations();

    expect(feed).not.toHaveBeenCalled();
    expect(resolveTimeline).not.toHaveBeenCalled();
  });

  it("verifies an alert through its single monitor", async () => {
    mockPendingList(
      fakePending({
        incidentId: undefined,
        alertId: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
      }),
    );
    mockExecution(RunbookExecutionStatus.Completed);
    jest.spyOn(AlertService, "findOneById").mockResolvedValue({
      id: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
      currentAlertStateId: undefined,
      monitorId: MONITOR_ID,
    } as unknown as never);
    mockMonitorOperational(true);
    const cas: jest.SpyInstance = mockCas(1);
    jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../../../Server/Services/AlertFeedService").default,
        "createAlertFeedItem",
      )
      .mockResolvedValue(undefined as never);

    await RemediationVerifier.verifyPendingRemediations();

    expect(cas).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
      }),
    );
  });
});
