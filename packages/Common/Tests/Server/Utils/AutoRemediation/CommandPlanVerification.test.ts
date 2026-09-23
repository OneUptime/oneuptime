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
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { FindOperator } from "typeorm";
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

/*
 * The verifier's gate on a RESUMED rollback, driven through the real
 * rollback arm (PR #3953 review, remediation-r2-01): a resumed rollback
 * whose interrupted attempt had already failed an undo must settle Failed,
 * so the follow-up round of a Bypass-approval cluster asks first instead of
 * running unattended on top of a change that is still applied.
 */
describe("RemediationVerifier.resumeInterruptedRollbacks — the follow-up after a resumed rollback, with the real rollback arm", () => {
  const CLUSTER_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );
  const CLUSTER_RUNNER_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );
  const UNDO_JOB_ONE: ObjectID = new ObjectID(
    "20000000-0000-4000-8000-000000000001",
  );

  let followUp: jest.SpyInstance;
  let storedPlan: JSONObject;

  function kubectlCommand(
    sequence: number,
    rollbackExecution: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      sequence,
      stepType: "Kubectl",
      runnerId: CLUSTER_RUNNER_ID.toString(),
      runnerNameSnapshot: "kubernetes-agent/prod-us",
      kubernetesClusterId: CLUSTER_ID.toString(),
      kubernetesClusterNameSnapshot: "prod-us",
      kubectlTier: "SafeWrite",
      command: `kubectl rollout restart deployment/web-${sequence} -n web`,
      rollbackCommand: `kubectl rollout undo deployment/web-${sequence} -n web`,
      timeoutInMs: 5000,
      rationale: "restart",
      expectedEffect: "recover",
      policyVerdict: "AutoApproved",
      wasAutoExecuted: true,
      execution: { status: "Succeeded", exitCode: 0 },
      rollbackExecution,
    };
  }

  function interruptedRound(
    rollbackOfTwo: Record<string, unknown>,
  ): AutoRemediationSuggestion {
    return fakePending({
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      verificationCompletedAt: new Date(Date.now() - 60 * 60 * 1000),
      verificationNote: "The service did not recover.",
      kubernetesClusterId: CLUSTER_ID,
      commandPlan: {
        commands: [
          // Command 1's undo was in flight when the Worker restarted.
          kubectlCommand(1, {
            status: "Pending",
            runnerJobId: UNDO_JOB_ONE.toString(),
          }),
          kubectlCommand(2, rollbackOfTwo),
        ],
        executionStatus: "Completed",
        rollbackHeartbeatAt: new Date(
          Date.now() - 30 * 60 * 1000,
        ).toISOString(),
      },
    });
  }

  function mockStore(row: AutoRemediationSuggestion): void {
    storedPlan = row.commandPlan as JSONObject;
    const current: () => AutoRemediationSuggestion =
      (): AutoRemediationSuggestion => {
        return {
          ...row,
          commandPlan: JSON.parse(JSON.stringify(storedPlan)),
        } as unknown as AutoRemediationSuggestion;
      };
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockImplementation(
        async (): Promise<Array<AutoRemediationSuggestion>> => {
          return [current()];
        },
      );
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation(async (): Promise<AutoRemediationSuggestion> => {
        return current();
      });
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneBy")
      .mockImplementation(async (): Promise<AutoRemediationSuggestion> => {
        return current();
      });
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        const data: Record<string, unknown> = (
          args as { data: Record<string, unknown> }
        ).data;
        if (data["commandPlan"]) {
          storedPlan = JSON.parse(JSON.stringify(data["commandPlan"]));
        }
        return undefined as never;
      });
  }

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    // The in-flight undo of command 1 finished fine while nobody watched.
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue({
      id: UNDO_JOB_ONE,
      status: RunnerJobStatus.Succeeded,
      exitCode: 0,
      output: "rolled back",
    } as unknown as RunnerJob);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue({
        clusterId: CLUSTER_ID.toString(),
        clusterName: "prod-us",
        runner: {
          id: CLUSTER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-us",
          isOnline: true,
          canRunAiCommands: true,
        },
        accessMethod: "in_cluster",
        kubectlAllowlist: [],
        isInvestigationEnabled: true,
        isInvestigationReady: true,
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
        isRemediationReady: true,
        gaps: [],
        evaluatedAt: new Date().toISOString(),
      } as KubernetesClusterAiAccessStatus);
    followUp = jest
      .spyOn(
        AutoRemediationRuleEngineService,
        "startFollowUpClusterRemediation",
      )
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("forces the follow-up to ask first when the interrupted attempt had already FAILED an undo — although this attempt's own undo succeeded", async () => {
    mockStore(
      interruptedRound({
        status: "Failed",
        exitCode: 1,
        errorMessage: 'deployments.apps "web-2" not found',
      }),
    );

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(storedPlan["rollbackStatus"]).toBe("Failed");
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(
      (followUp.mock.calls[0]![0] as Record<string, unknown>)["forceSuggest"],
    ).toBe(true);
  });

  it("forces the follow-up to ask first when the interrupted attempt had LEFT an undo for a human", async () => {
    mockStore(
      interruptedRound({
        status: "Skipped",
        errorMessage:
          "Rollback not run. Undo it manually: kubectl rollout undo deployment/web-2 -n web",
      }),
    );

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(storedPlan["rollbackStatus"]).toBe("Failed");
    expect(
      (followUp.mock.calls[0]![0] as Record<string, unknown>)["forceSuggest"],
    ).toBe(true);
  });

  it("negative control: every undo of the resumed rollback succeeded — the follow-up keeps the cluster's own mode", async () => {
    mockStore(interruptedRound({ status: "Succeeded", exitCode: 0 }));

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(storedPlan["rollbackStatus"]).toBe("Completed");
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(
      (followUp.mock.calls[0]![0] as Record<string, unknown>)["forceSuggest"],
    ).toBeUndefined();
  });
});

/*
 * The resume sweep's read (PR #3953 review, remediation-r2-02). Every failed
 * command plan stays a Failed verification for the whole lookback window,
 * so a read of "the newest N failed plans" fills up with rollbacks that
 * settled long ago and an interrupted one never gets a slot. The read asks
 * the database only for rollbacks that have not settled, oldest
 * verification first.
 */
describe("RemediationVerifier.resumeInterruptedRollbacks — the sweep's read", () => {
  const LONG_AGO: number = Date.now() - 3 * 60 * 60 * 1000;

  let rollback: jest.SpyInstance;

  beforeEach(() => {
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
    jest
      .spyOn(
        AutoRemediationRuleEngineService,
        "startFollowUpClusterRemediation",
      )
      .mockResolvedValue(true);
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function failedRow(data: {
    id: ObjectID;
    createdAt: Date;
    verificationCompletedAt: Date;
    rollbackStatus?: string | undefined;
  }): AutoRemediationSuggestion {
    return fakePending({
      id: data.id,
      _id: data.id.toString(),
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      createdAt: data.createdAt,
      verificationCompletedAt: data.verificationCompletedAt,
      commandPlan: {
        ...rawPlan("Failed"),
        ...(data.rollbackStatus ? { rollbackStatus: data.rollbackStatus } : {}),
      },
    });
  }

  // Whether the read's commandPlan predicate asks for unsettled rollbacks only.
  function asksForUnsettledRollbacksOnly(
    query: Record<string, unknown>,
  ): boolean {
    const predicate: unknown = query["commandPlan"];
    if (!(predicate instanceof FindOperator) || predicate.type !== "raw") {
      return false;
    }
    const parameters: Array<unknown> = Object.values(
      predicate.objectLiteralParameters || {},
    );
    return (
      parameters.includes("rollbackStatus") &&
      parameters.includes(AiRemediationRollbackStatus.NotAttempted)
    );
  }

  /*
   * A database that does what the read asks for: the rollback predicate
   * when the query carries it, the sort it names (createdAt descending by
   * default, as DatabaseService does), and the limit.
   */
  function mockDatabase(
    rows: Array<AutoRemediationSuggestion>,
  ): jest.SpyInstance {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation(
        async (args: unknown): Promise<AutoRemediationSuggestion | null> => {
          const id: string = (args as { id: ObjectID }).id.toString();
          return (
            rows.find((row: AutoRemediationSuggestion) => {
              return row.id?.toString() === id;
            }) || null
          );
        },
      );

    return jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockImplementation(
        async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
          const read: {
            query: Record<string, unknown>;
            sort?: Record<string, unknown>;
            limit: number;
          } = args as {
            query: Record<string, unknown>;
            sort?: Record<string, unknown>;
            limit: number;
          };

          let matching: Array<AutoRemediationSuggestion> = rows;

          if (asksForUnsettledRollbacksOnly(read.query)) {
            matching = matching.filter((row: AutoRemediationSuggestion) => {
              const status: unknown = (row.commandPlan as JSONObject)[
                "rollbackStatus"
              ];
              return (
                status === undefined ||
                status === null ||
                status === AiRemediationRollbackStatus.NotAttempted
              );
            });
          }

          const byVerification: boolean =
            read.sort?.["verificationCompletedAt"] === SortOrder.Ascending;

          const sorted: Array<AutoRemediationSuggestion> = [...matching].sort(
            (a: AutoRemediationSuggestion, b: AutoRemediationSuggestion) => {
              return byVerification
                ? new Date(a.verificationCompletedAt!).getTime() -
                    new Date(b.verificationCompletedAt!).getTime()
                : new Date(b.createdAt!).getTime() -
                    new Date(a.createdAt!).getTime();
            },
          );

          return sorted.slice(0, read.limit);
        },
      );
  }

  it("asks the database for unsettled rollbacks only, oldest verification first", async () => {
    const read: jest.SpyInstance = mockDatabase([]);

    await RemediationVerifier.resumeInterruptedRollbacks();

    const args: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = read.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    };
    expect(asksForUnsettledRollbacksOnly(args.query)).toBe(true);
    expect(args.sort["verificationCompletedAt"]).toBe(SortOrder.Ascending);
    expect(args.limit).toBe(50);

    // The predicate reads the plan's rollbackStatus key as text.
    const sql: string = (args.query["commandPlan"] as FindOperator<unknown>)
      .getSql!("plan");
    expect(sql).toContain("plan ->>");
    expect(sql).toContain("IS NULL");
  });

  it("is not starved: 60 newer failed plans whose rollbacks settled never crowd out one interrupted rollback", async () => {
    const interruptedId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    const rows: Array<AutoRemediationSuggestion> = [
      failedRow({
        id: interruptedId,
        createdAt: new Date(LONG_AGO),
        verificationCompletedAt: new Date(LONG_AGO + 60 * 1000),
      }),
    ];
    for (let index: number = 0; index < 60; index++) {
      rows.push(
        failedRow({
          id: ObjectID.generate(),
          createdAt: new Date(LONG_AGO + (index + 2) * 60 * 1000),
          verificationCompletedAt: new Date(LONG_AGO + (index + 2) * 60 * 1000),
          rollbackStatus: "Completed",
        }),
      );
    }
    mockDatabase(rows);

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(
      (
        rollback.mock.calls[0]![0] as { suggestion: AutoRemediationSuggestion }
      ).suggestion.id?.toString(),
    ).toBe(interruptedId.toString());
  });

  it("negative control: with that same plan settled too, nothing is resumed", async () => {
    const rows: Array<AutoRemediationSuggestion> = [];
    for (let index: number = 0; index < 61; index++) {
      rows.push(
        failedRow({
          id: ObjectID.generate(),
          createdAt: new Date(LONG_AGO + index * 60 * 1000),
          verificationCompletedAt: new Date(LONG_AGO + index * 60 * 1000),
          rollbackStatus: "Completed",
        }),
      );
    }
    mockDatabase(rows);

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(rollback).not.toHaveBeenCalled();
  });
});
