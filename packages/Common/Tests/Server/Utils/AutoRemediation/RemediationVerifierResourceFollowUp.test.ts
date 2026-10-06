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
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { AiRemediationRollbackStatus } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the verifier's follow-up for a RESOURCE round, the
 * resource sibling of the cluster round's (CommandPlanVerification):
 *
 * - a failed resource plan is rolled back FIRST, and only then does the
 *   follow-up round start — for that resource (type and id) and signal;
 * - a rollback that did not complete makes the follow-up ask first, with
 *   the reason; a rollback that did not settle starts no follow-up (the
 *   recovery sweep does, once it has);
 * - the sweeps select the resource columns, so a resource round is never
 *   mistaken for a rule round (which gets no follow-up);
 * - a cluster round still gets the cluster follow-up, never a resource one;
 * - a resumed rollback follows up on the resource the same way.
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
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "34343434-3434-4343-8343-343434343434",
);
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";
const STATE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

function rawPlan(executionStatus: string): Record<string, unknown> {
  return {
    commands: [
      {
        sequence: 1,
        stepType: "ResourceCommand",
        runnerId: AGENT_ID,
        runnerNameSnapshot: "Host AI agent",
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID.toString(),
        resourceNameSnapshot: "web-2",
        command: "systemctl restart nginx",
        rollbackCommand: "systemctl start nginx",
        timeoutInMs: 5000,
        rationale: "nginx is wedged",
        expectedEffect: "nginx serves again",
        policyVerdict: "AutoApproved",
        execution: { status: "Succeeded", exitCode: 0 },
      },
    ],
    executionStatus,
  };
}

function resourceRound(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: rawPlan("Failed"),
    verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
    autoResolveOnRecovery: true,
    ruleNameSnapshot: 'AI remediation for host "web-2"',
    resourceType: AiResourceType.Host,
    resourceId: RESOURCE_ID,
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

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

let resourceFollowUp: jest.SpyInstance;
let clusterFollowUp: jest.SpyInstance;
let suggestionFindBy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  resourceFollowUp = jest
    .spyOn(AutoRemediationRuleEngineService, "startFollowUpResourceRemediation")
    .mockResolvedValue(true);
  clusterFollowUp = jest
    .spyOn(AutoRemediationRuleEngineService, "startFollowUpClusterRemediation")
    .mockResolvedValue(true);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "attemptVerificationTransition")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockPending(row: AutoRemediationSuggestion): void {
  suggestionFindBy = jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValueOnce([row])
    // The recovery sweep's read: nothing interrupted.
    .mockResolvedValue([]);
}

function mockRollback(result: CommandPlanRollbackOutcome): jest.SpyInstance {
  return jest
    .spyOn(CommandPlanExecutor, "executeRollback")
    .mockResolvedValue(result);
}

describe("RemediationVerifier — a resource round's follow-up", () => {
  it("rolls a failed resource plan back FIRST, then asks the resource's AI for a new plan for that resource and signal", async () => {
    mockPending(resourceRound());
    const rollback: jest.SpyInstance = mockRollback(
      outcome(
        AiRemediationRollbackStatus.Completed,
        "Rollback completed: 1 command(s) undone.",
      ),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(resourceFollowUp).toHaveBeenCalledTimes(1);
    expect(clusterFollowUp).not.toHaveBeenCalled();
    expect(rollback.mock.invocationCallOrder[0]!).toBeLessThan(
      resourceFollowUp.mock.invocationCallOrder[0]!,
    );
    expect(resourceFollowUp.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.Host,
      resourceId: RESOURCE_ID,
      incidentId: INCIDENT_ID,
      alertId: undefined,
      forceSuggest: undefined,
      forceSuggestReason: undefined,
    });
  });

  it("selects the resource columns in the verification sweep", async () => {
    mockPending(resourceRound());
    mockRollback(outcome(AiRemediationRollbackStatus.Completed, "done"));

    await RemediationVerifier.verifyPendingRemediations();

    expect(
      (
        suggestionFindBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select,
    ).toEqual(
      expect.objectContaining({
        kubernetesClusterId: true,
        resourceType: true,
        resourceId: true,
      }),
    );
  });

  it("makes the follow-up ASK FIRST when the rollback did not complete", async () => {
    mockPending(resourceRound());
    mockRollback(
      outcome(
        AiRemediationRollbackStatus.Failed,
        "Rollback did NOT fully complete.",
      ),
    );

    await RemediationVerifier.verifyPendingRemediations();

    const args: Record<string, unknown> = resourceFollowUp.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(args["forceSuggest"]).toBe(true);
    expect(args["forceSuggestReason"]).toContain("rollback did not complete");
  });

  it("starts NO follow-up while the rollback has not settled", async () => {
    mockPending(resourceRound());
    mockRollback(outcome(undefined, "The rollback did not finish."));

    await RemediationVerifier.verifyPendingRemediations();

    expect(resourceFollowUp).not.toHaveBeenCalled();
  });

  it("negative control: a verified resource plan is never rolled back and gets no follow-up", async () => {
    mockPending(resourceRound({ commandPlan: rawPlan("Completed") }));
    const rollback: jest.SpyInstance = mockRollback(
      outcome(AiRemediationRollbackStatus.Completed, "done"),
    );
    // The subject was resolved: verified.
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
      currentIncidentStateId: STATE_ID,
      monitors: [],
    } as unknown as Incident);
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(true);

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).not.toHaveBeenCalled();
    expect(resourceFollowUp).not.toHaveBeenCalled();
  });

  it("negative control: a cluster round still gets the cluster follow-up, never a resource one", async () => {
    mockPending(
      resourceRound({
        resourceType: undefined,
        resourceId: undefined,
        kubernetesClusterId: CLUSTER_ID,
        ruleNameSnapshot: 'AI remediation for cluster "prod-us"',
      }),
    );
    mockRollback(outcome(AiRemediationRollbackStatus.Completed, "done"));

    await RemediationVerifier.verifyPendingRemediations();

    expect(clusterFollowUp).toHaveBeenCalledTimes(1);
    expect(resourceFollowUp).not.toHaveBeenCalled();
  });

  it("negative control: a failed rule-driven plan is rolled back but gets no follow-up", async () => {
    mockPending(
      resourceRound({
        resourceType: undefined,
        resourceId: undefined,
        ruleNameSnapshot: "Restart nginx",
      }),
    );
    const rollback: jest.SpyInstance = mockRollback(
      outcome(AiRemediationRollbackStatus.Completed, "done"),
    );

    await RemediationVerifier.verifyPendingRemediations();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(resourceFollowUp).not.toHaveBeenCalled();
    expect(clusterFollowUp).not.toHaveBeenCalled();
  });
});

describe("RemediationVerifier.resumeInterruptedRollbacks — a resource round", () => {
  it("resumes the rollback and then follows up on the resource", async () => {
    const row: AutoRemediationSuggestion = resourceRound({
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      verificationCompletedAt: new Date(Date.now() - 60 * 60 * 1000),
      verificationNote: "The AI command plan did not complete.",
    });
    const findBy: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([row]);
    const findOne: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(row);
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "resume-lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    const rollback: jest.SpyInstance = mockRollback(
      outcome(AiRemediationRollbackStatus.Completed, "done"),
    );

    await RemediationVerifier.resumeInterruptedRollbacks();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(resourceFollowUp).toHaveBeenCalledTimes(1);
    expect(resourceFollowUp.mock.calls[0]![0]).toMatchObject({
      resourceType: AiResourceType.Host,
      resourceId: RESOURCE_ID,
    });
    for (const spy of [findBy, findOne]) {
      expect(
        (spy.mock.calls[0]![0] as { select: Record<string, unknown> }).select,
      ).toEqual(
        expect.objectContaining({ resourceType: true, resourceId: true }),
      );
    }
  });
});
