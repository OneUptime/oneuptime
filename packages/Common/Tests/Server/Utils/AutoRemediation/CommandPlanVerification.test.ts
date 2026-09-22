import RemediationVerifier from "../../../../Server/Utils/AutoRemediation/RemediationVerifier";
import CommandPlanExecutor, {
  CommandPlanRollbackOutcome,
} from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationRuleEngineService from "../../../../Server/Services/AutoRemediationRuleEngineService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
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
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { AiRemediationRollbackStatus } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../../Types/JSON";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the verifier's command-plan branch. A CommandPlan
 * suggestion has no runbook execution: the plan persisted on the suggestion
 * plays that role. A Failed (or window-overrunning) plan fails verification
 * and — only after WINNING the verification CAS — triggers the rollback
 * arm; a Completed plan is judged by the same subject-resolved /
 * monitors-operational checks as a runbook, including auto-resolve;
 * a missing plan or a subject with no monitors settles Skipped, quietly.
 * The verification note, written before the rollback runs, never claims
 * anything about it; what the rollback did is appended once it settled,
 * and a cluster round's follow-up waits for that (see below).
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

  it("never claims, before the rollback ran, that commands 'are being rolled back'", async () => {
    for (const pending of [
      fakePending({ commandPlan: rawPlan("Failed") }),
      fakePending({ verificationDeadlineAt: PAST }),
    ]) {
      jest.restoreAllMocks();
      mockPendingList(pending);
      mockIncident();
      mockIncidentState(false);
      mockMonitorOperational(false);
      const cas: jest.SpyInstance = mockCas(1);
      mockFeed();
      mockRollback();

      await RemediationVerifier.verifyPendingRemediations();

      const note: string = (
        cas.mock.calls[0]![0] as { set: { verificationNote: string } }
      ).set.verificationNote;
      expect(note).not.toContain("being rolled back");
    }
  });
});

/*
 * The follow-up round of a cluster-level round, and the rollback it waits
 * for. A failed cluster plan is rolled back first; what the rollback did is
 * written onto the verification note; then — and only then — the cluster
 * gets its follow-up round: as usual when the rollback completed, asking
 * first even on a Bypass-approval cluster when it did not, and not at all
 * (yet) when the rollback never settled.
 */
describe("RemediationVerifier — the follow-up round waits for the rollback, and hears what it did", () => {
  const CLUSTER_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );

  let followUp: jest.SpyInstance;
  let noteUpdate: jest.SpyInstance;

  function outcome(
    rollbackStatus: AiRemediationRollbackStatus | undefined,
    summary: string,
  ): CommandPlanRollbackOutcome {
    return {
      rollbackStatus,
      rolledBack:
        rollbackStatus === AiRemediationRollbackStatus.Completed ? 1 : 0,
      failed: rollbackStatus === AiRemediationRollbackStatus.Failed ? 1 : 0,
      leftForHuman: 0,
      summary,
    };
  }

  function mockRollbackOutcome(
    result: CommandPlanRollbackOutcome,
  ): jest.SpyInstance {
    return jest
      .spyOn(CommandPlanExecutor, "executeRollback")
      .mockResolvedValue(result);
  }

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    followUp = jest
      .spyOn(
        AutoRemediationRuleEngineService,
        "startFollowUpClusterRemediation",
      )
      .mockResolvedValue(true);
    noteUpdate = jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    mockCas(1);
    mockFeed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rolls a failed cluster plan back FIRST, then starts the follow-up round for that cluster and signal", async () => {
    mockPendingList(
      fakePending({
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
    );
    const rollback: jest.SpyInstance = mockRollbackOutcome(
      outcome(
        AiRemediationRollbackStatus.Completed,
        "Rollback completed: 1 command(s) undone.",
      ),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(rollback.mock.invocationCallOrder[0]).toBeLessThan(
      followUp.mock.invocationCallOrder[0]!,
    );
    const args: Record<string, unknown> = followUp.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect((args["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((args["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((args["incidentId"] as ObjectID).toString()).toBe(
      INCIDENT_ID.toString(),
    );
    // A completed rollback: the follow-up is whatever the cluster's mode says.
    expect(args["forceSuggest"]).toBeUndefined();
  });

  it("records what the rollback did on the verification note once it has settled", async () => {
    mockPendingList(
      fakePending({
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
    );
    mockRollbackOutcome(
      outcome(
        AiRemediationRollbackStatus.Failed,
        "Rollback did NOT fully complete: 0 command(s) undone, 1 rollback(s) failed, 0 left for a human to undo — the change may still be applied.",
      ),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(noteUpdate).toHaveBeenCalledTimes(1);
    const note: string = (
      noteUpdate.mock.calls[0]![0] as { data: { verificationNote: string } }
    ).data.verificationNote;
    expect(note).toContain("The AI command plan did not complete");
    expect(note).toContain("Rollback did NOT fully complete");
    expect(note).not.toContain("being rolled back");
  });

  it("makes the follow-up ASK FIRST when the rollback did not complete — even where approvals are bypassed", async () => {
    mockPendingList(
      fakePending({
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
    );
    mockRollbackOutcome(
      outcome(
        AiRemediationRollbackStatus.Failed,
        "Rollback did NOT fully complete.",
      ),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(followUp).toHaveBeenCalledTimes(1);
    const args: Record<string, unknown> = followUp.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(args["forceSuggest"]).toBe(true);
    expect(args["forceSuggestReason"]).toContain("rollback did not complete");
  });

  it("starts NO follow-up while the rollback has not settled — the recovery sweep starts it once the rollback is done", async () => {
    mockPendingList(
      fakePending({
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
    );
    mockRollbackOutcome(outcome(undefined, "The rollback did not finish."));

    await RemediationVerifier.verifyPendingRemediations();

    expect(followUp).not.toHaveBeenCalled();
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it("negative control: nothing to roll back still gets the usual follow-up", async () => {
    mockPendingList(
      fakePending({
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
    );
    mockRollbackOutcome(
      outcome(
        AiRemediationRollbackStatus.NotApplicable,
        "Nothing was rolled back.",
      ),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(followUp).toHaveBeenCalledTimes(1);
    expect(
      (followUp.mock.calls[0]![0] as Record<string, unknown>)["forceSuggest"],
    ).toBeUndefined();
  });

  it("negative control: a VERIFIED cluster plan is never rolled back and gets no follow-up", async () => {
    mockPendingList(fakePending({ kubernetesClusterId: CLUSTER_ID }));
    mockIncident();
    mockIncidentState(false);
    mockMonitorOperational(true);
    const rollback: jest.SpyInstance = mockRollbackOutcome(
      outcome(AiRemediationRollbackStatus.Completed, ""),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it("negative control: a failed RULE-driven plan (no cluster) is rolled back but gets no cluster follow-up", async () => {
    mockPendingList(fakePending({ commandPlan: rawPlan("Failed") }));
    const rollback: jest.SpyInstance = mockRollbackOutcome(
      outcome(AiRemediationRollbackStatus.Completed, "Rollback completed."),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(followUp).not.toHaveBeenCalled();
  });

  it("a follow-up that throws does not stop the sweep: the next failed plan is still rolled back", async () => {
    const second: ObjectID = new ObjectID(
      "78787878-7878-4878-8878-787878787878",
    );
    jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
      fakePending({
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
      fakePending({
        id: second,
        _id: second.toString(),
        commandPlan: rawPlan("Failed"),
        kubernetesClusterId: CLUSTER_ID,
      }),
    ]);
    const rollback: jest.SpyInstance = mockRollbackOutcome(
      outcome(AiRemediationRollbackStatus.Completed, "Rollback completed."),
    );
    followUp.mockRejectedValueOnce(new Error("queue down"));

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).toHaveBeenCalledTimes(2);
    expect(followUp).toHaveBeenCalledTimes(2);
  });
});

/*
 * Rollbacks a Worker restart cut short. The verifier rolls back inline right
 * after winning the Failed transition; a pod that dies mid-rollback leaves
 * verification Failed and the rollback unsettled, and nothing else ever
 * looks at a Failed verification again — so the sweep resumes it, claimed
 * under a lock and a fresh heartbeat so two replicas never both do.
 */
describe("RemediationVerifier.resumeInterruptedRollbacks", () => {
  const CLUSTER_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );
  const LONG_AGO: Date = new Date(Date.now() - 60 * 60 * 1000);

  let rollback: jest.SpyInstance;
  let followUp: jest.SpyInstance;
  let lock: jest.SpyInstance;
  let writes: Array<JSONObject>;

  function interrupted(
    planOverrides: Record<string, unknown> = {},
    overrides: Partial<Record<string, unknown>> = {},
  ): AutoRemediationSuggestion {
    return fakePending({
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      verificationCompletedAt: LONG_AGO,
      verificationNote:
        "The AI command plan did not complete — a command failed.",
      kubernetesClusterId: CLUSTER_ID,
      commandPlan: { ...rawPlan("Failed"), ...planOverrides },
      ...overrides,
    });
  }

  function mockCandidate(row: AutoRemediationSuggestion): void {
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([row]);
    // The claim re-reads the row under the lock.
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(row);
  }

  beforeEach(() => {
    writes = [];
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    rollback = jest
      .spyOn(CommandPlanExecutor, "executeRollback")
      .mockResolvedValue({
        rollbackStatus: AiRemediationRollbackStatus.Completed,
        rolledBack: 1,
        failed: 0,
        leftForHuman: 0,
        summary: "Rollback completed: 1 command(s) undone.",
      });
    followUp = jest
      .spyOn(
        AutoRemediationRuleEngineService,
        "startFollowUpClusterRemediation",
      )
      .mockResolvedValue(true);
    lock = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "resume-lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        const data: Record<string, unknown> = (
          args as { data: Record<string, unknown> }
        ).data;
        if (data["commandPlan"]) {
          writes.push(data["commandPlan"] as JSONObject);
        }
        return undefined as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resumes a Failed plan whose rollback never settled and went quiet: claims it with a fresh heartbeat, rolls back, then follows up", async () => {
    mockCandidate(
      interrupted({
        rollbackHeartbeatAt: new Date(
          Date.now() - 30 * 60 * 1000,
        ).toISOString(),
      }),
    );
    const startedAt: number = Date.now();

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SUGGESTION_ID.toString(),
        namespace: "AutoRemediationRollbackResume",
      }),
    );
    // The claim: a fresh heartbeat written BEFORE the rollback starts.
    expect(writes).toHaveLength(1);
    expect(
      new Date(writes[0]!["rollbackHeartbeatAt"] as string).getTime(),
    ).toBeGreaterThanOrEqual(startedAt - 5);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(rollback.mock.invocationCallOrder[0]).toBeLessThan(
      followUp.mock.invocationCallOrder[0]!,
    );
  });

  it("resumes one that never beat at all, once its verification is old enough", async () => {
    mockCandidate(interrupted());

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("only looks at Failed CommandPlan verifications of the last day that concluded more than a few minutes ago", async () => {
    mockCandidate(interrupted());

    await RemediationVerifier.resumeInterruptedRollbacks();

    const query: Record<string, unknown> = (
      (AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance)
        .mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["verificationStatus"]).toBe(
      AutoRemediationVerificationStatus.Failed,
    );
    expect(query["suggestionType"]).toBe(
      AutoRemediationSuggestionType.CommandPlan,
    );
    expect(query["verificationCompletedAt"]).toBeDefined();
  });

  it("negative control: a rollback whose heartbeat is fresh is still running — left alone", async () => {
    mockCandidate(
      interrupted({ rollbackHeartbeatAt: new Date().toISOString() }),
    );

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(rollback).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it.each(["Completed", "NotApplicable", "Failed"])(
    "negative control: a rollback already settled %s is never resumed",
    async (rollbackStatus: string) => {
      mockCandidate(interrupted({ rollbackStatus }));

      await RemediationVerifier.resumeInterruptedRollbacks();

      expect(rollback).not.toHaveBeenCalled();
    },
  );

  it("negative control: a replica that loses the claim — the row it re-reads under the lock already beats — does nothing", async () => {
    const stale: AutoRemediationSuggestion = interrupted();
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([stale]);
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(
        interrupted({ rollbackHeartbeatAt: new Date().toISOString() }),
      );

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(writes).toHaveLength(0);
    expect(rollback).not.toHaveBeenCalled();
  });

  it("negative control: without the lock nothing is resumed this tick — two replicas could run an undo twice", async () => {
    mockCandidate(interrupted());
    lock.mockRejectedValue(new Error("Redis client is not connected"));

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(rollback).not.toHaveBeenCalled();
  });

  it("runs from the verification sweep, and a failure there never fails the sweep", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db down"));

    await expect(
      RemediationVerifier.verifyPendingRemediations(),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("interrupted rollbacks"),
    );
  });
});
