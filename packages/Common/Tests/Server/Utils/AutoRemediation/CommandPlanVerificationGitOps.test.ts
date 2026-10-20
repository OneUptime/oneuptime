import RemediationVerifier from "../../../../Server/Utils/AutoRemediation/RemediationVerifier";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import GitOpsInspector from "../../../../Server/Utils/AI/Remediation/GitOpsInspector";
import AutoRemediationRuleEngineService from "../../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommandGitOps,
  AiRemediationRevertWatch,
  GitOpsController,
} from "../../../../Types/AutoRemediation/AiRemediationGitOps";
import { AiRemediationRollbackStatus } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Revert-aware verification. A kubectl fix's object is read again while
 * its verification window is open (GitOpsInspector.checkRevertWatchOnCluster):
 *
 *   - a fix back at its values from before is never verified: verification
 *     fails at once, naming who put it back (the GitOps owner OneUptime
 *     read, or "something on the cluster") and where the lasting change
 *     goes;
 *   - a fix of an object Argo CD or Flux declares is judged at the END of
 *     its window, however soon the monitors recovered: they put changes
 *     back within seconds or at their next reconciliation;
 *   - any other watched fix verifies as before, after one last read;
 *   - reads are spaced while the window is open, never before a
 *     conclusion, and a read that fails leaves the monitors to decide.
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
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
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
const COMMAND: string = "kubectl scale deployment/web --replicas=3 -n shop";

const ARGO: AiRemediationCommandGitOps = {
  controller: GitOpsController.ArgoCD,
  ownerKind: "Application",
  ownerName: "shop",
  evidence: "annotation argocd.argoproj.io/tracking-id",
  objectKind: "deployment",
  objectName: "web",
  objectNamespace: "shop",
  putsBack: true,
  reconcilesOnItsOwn: true,
  summary: 'Argo CD Application "shop" declares deployment/web ...',
};

function watch(
  overrides: Partial<AiRemediationRevertWatch> = {},
): AiRemediationRevertWatch {
  return {
    kind: "deployment",
    name: "web",
    namespace: "shop",
    fields: [{ path: "spec.replicas", before: "1", after: "3" }],
    capturedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function plan(data: {
  gitOps?: AiRemediationCommandGitOps | undefined;
  revertWatch?: AiRemediationRevertWatch | undefined;
}): Record<string, unknown> {
  return {
    commands: [
      {
        sequence: 1,
        stepType: "Kubectl",
        runnerId: RUNNER_ID.toString(),
        runnerNameSnapshot: "kubernetes-agent/prod",
        kubernetesClusterId: CLUSTER_ID.toString(),
        kubernetesClusterNameSnapshot: "prod",
        kubectlTier: "SafeWrite",
        command: COMMAND,
        timeoutInMs: 60000,
        rationale: "Not enough replicas for the load.",
        expectedEffect: "Latency recovers.",
        policyVerdict: "RequiresApproval",
        rollbackCommand: "kubectl scale deployment/web --replicas=1 -n shop",
        ...(data.gitOps ? { gitOps: data.gitOps } : {}),
        ...(data.revertWatch ? { revertWatch: data.revertWatch } : {}),
        execution: { status: "Succeeded", exitCode: 0 },
      },
    ],
    executionStatus: "Completed",
  };
}

function pending(data: {
  gitOps?: AiRemediationCommandGitOps | undefined;
  revertWatch?: AiRemediationRevertWatch | undefined;
  deadline?: Date | undefined;
}): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    kubernetesClusterId: CLUSTER_ID,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: plan(data),
    verificationDeadlineAt: data.deadline || FUTURE,
    autoResolveOnRecovery: false,
    ruleNameSnapshot: "AI remediation",
  } as unknown as AutoRemediationSuggestion;
}

let cas: SpyInstance<
  typeof AutoRemediationSuggestionService.attemptVerificationTransition
>;
let check: SpyInstance<typeof GitOpsInspector.checkRevertWatchOnCluster>;
let recordChecks: SpyInstance<typeof CommandPlanExecutor.recordRevertChecks>;
let rollback: SpyInstance<typeof CommandPlanExecutor.executeRollback>;

function mockMonitorsOperational(isOperational: boolean): void {
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    currentIncidentStateId: STATE_ID,
    monitors: [{ id: MONITOR_ID }],
  } as unknown as Incident);
  jest
    .spyOn(IncidentStateService, "isResolvedIncidentState")
    .mockResolvedValue(false);
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue({
    id: MONITOR_ID,
    currentMonitorStatusId: STATE_ID,
  } as unknown as Monitor);
  jest.spyOn(MonitorStatusService, "findOneById").mockResolvedValue({
    id: STATE_ID,
    isOperationalState: isOperational,
  } as unknown as MonitorStatus);
}

function mockPending(suggestion: AutoRemediationSuggestion): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockImplementation(async (args: unknown): Promise<never> => {
      // The sweep's second read looks for interrupted rollbacks: none.
      const query: { verificationStatus?: string } = (
        args as { query: { verificationStatus?: string } }
      ).query;
      return (
        query.verificationStatus === AutoRemediationVerificationStatus.Pending
          ? [suggestion]
          : []
      ) as never;
    });
}

// The note the verification transition wrote, or undefined when none ran.
function writtenVerification(): { status: string; note: string } | undefined {
  const call: unknown = cas.mock.calls[0]?.[0];

  if (!call) {
    return undefined;
  }

  const set: { verificationStatus: string; verificationNote: string } = (
    call as {
      set: { verificationStatus: string; verificationNote: string };
    }
  ).set;

  return { status: set.verificationStatus, note: set.verificationNote };
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  cas = jest
    .spyOn(AutoRemediationSuggestionService, "attemptVerificationTransition")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  check = jest
    .spyOn(GitOpsInspector, "checkRevertWatchOnCluster")
    .mockResolvedValue([]);
  recordChecks = jest
    .spyOn(CommandPlanExecutor, "recordRevertChecks")
    .mockResolvedValue(undefined);
  rollback = jest
    .spyOn(CommandPlanExecutor, "executeRollback")
    .mockResolvedValue({
      rollbackStatus: AiRemediationRollbackStatus.NotApplicable,
      rolledBack: 0,
      failed: 0,
      leftForHuman: 0,
      summary:
        "Nothing was rolled back: 1 command(s) were not undone: the cluster had already put back what they changed.",
    });
  jest
    .spyOn(AutoRemediationRuleEngineService, "startFollowUpClusterRemediation")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a fix put back on the cluster", () => {
  it("fails verification at once, naming who put it back and where the lasting change goes", async () => {
    mockPending(pending({ gitOps: ARGO, revertWatch: watch() }));
    mockMonitorsOperational(true);
    check.mockResolvedValue(["spec.replicas"]);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        aiRunId: AI_RUN_ID,
        kubernetesClusterId: CLUSTER_ID.toString(),
        stepId: "ai-gitops-verify-1",
      }),
    );
    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Failed,
    );
    expect(writtenVerification()?.note).toContain(
      `The fix did not hold: Argo CD Application "shop" declares deployment/web and put back what "${COMMAND}" changed (spec.replicas (3 → back to 1)); verification found it back`,
    );
    expect(writtenVerification()?.note).toContain(
      "A kubectl change of what it declares cannot last there: the lasting fix is the same change in git (the manifest, Helm values or Kustomize overlay it is built from).",
    );

    // What the read found is on the plan, for the rollback arm and the card.
    const recorded: Map<number, AiRemediationRevertWatch> =
      recordChecks.mock.calls[0]![0].watches;
    expect(recorded.get(1)).toMatchObject({
      putBackFields: ["spec.replicas"],
    });
    expect(recorded.get(1)?.putBackAt).toBeDefined();
    expect(recorded.get(1)?.lastCheckedAt).toBeDefined();

    // The rollback arm still runs: it skips what was already put back.
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("says something on the cluster put it back when nobody was read declaring the object", async () => {
    mockPending(pending({ revertWatch: watch() }));
    mockMonitorsOperational(true);
    check.mockResolvedValue(["spec.replicas"]);

    await RemediationVerifier.verifyPendingRemediations();

    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Failed,
    );
    expect(writtenVerification()?.note).toContain(
      `The fix did not hold: something on the cluster put back what "${COMMAND}" changed on deployment/web (spec.replicas (3 → back to 1))`,
    );
    expect(writtenVerification()?.note).toContain(
      "a GitOps controller, a Helm upgrade, an operator or an autoscaler",
    );
  });

  it("fails on a put-back found by an earlier read without reading again", async () => {
    mockPending(
      pending({
        gitOps: ARGO,
        revertWatch: watch({
          putBackAt: new Date().toISOString(),
          putBackFields: ["spec.replicas"],
          lastCheckedAt: new Date().toISOString(),
        }),
      }),
    );
    mockMonitorsOperational(false);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).not.toHaveBeenCalled();
    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Failed,
    );
  });
});

describe("a fix of a workload Argo CD or Flux declares", () => {
  it("is not verified before its window ends, however soon the monitors recovered, when they put the change back", async () => {
    mockPending(pending({ gitOps: ARGO, revertWatch: watch() }));
    mockMonitorsOperational(true);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).toHaveBeenCalledTimes(1);
    expect(cas).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("is verified as soon as the monitors recover when it is a change they do not put back", async () => {
    mockPending(
      pending({
        gitOps: { ...ARGO, putsBack: false, summary: "... so it stays." },
        revertWatch: watch({
          fields: [
            {
              path: "spec.template.metadata.annotations.kubectl.kubernetes.io/restartedAt",
              after: '"2026-10-20T10:00:00Z"',
            },
          ],
        }),
      }),
    );
    mockMonitorsOperational(true);

    await RemediationVerifier.verifyPendingRemediations();

    // Read once before the conclusion all the same.
    expect(check).toHaveBeenCalledTimes(1);
    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Verified,
    );
    expect(writtenVerification()?.note).toBe(
      "The AI command remediation completed and the monitor(s) returned to an operational state within the verification window.",
    );
  });

  it("is verified at the end of its window when it still holds, saying its owner will still put it back", async () => {
    mockPending(
      pending({ gitOps: ARGO, revertWatch: watch(), deadline: PAST }),
    );
    mockMonitorsOperational(true);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).toHaveBeenCalledTimes(1);
    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Verified,
    );
    expect(writtenVerification()?.note).toContain(
      'Argo CD Application "shop" declares deployment/web and had not put the change back by the end of the window, but its next sync or upgrade will',
    );
    expect(rollback).not.toHaveBeenCalled();
  });

  it("is read at most every couple of minutes while the window is open", async () => {
    mockPending(
      pending({
        gitOps: ARGO,
        revertWatch: watch({
          lastCheckedAt: new Date(Date.now() - 30 * 1000).toISOString(),
        }),
      }),
    );
    mockMonitorsOperational(false);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).not.toHaveBeenCalled();
    expect(recordChecks).not.toHaveBeenCalled();
    expect(cas).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    check = jest
      .spyOn(GitOpsInspector, "checkRevertWatchOnCluster")
      .mockResolvedValue([]);
    recordChecks = jest
      .spyOn(CommandPlanExecutor, "recordRevertChecks")
      .mockResolvedValue(undefined);
    cas = jest
      .spyOn(AutoRemediationSuggestionService, "attemptVerificationTransition")
      .mockResolvedValue(1 as never);
    mockPending(
      pending({
        gitOps: ARGO,
        revertWatch: watch({
          lastCheckedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        }),
      }),
    );
    mockMonitorsOperational(false);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).toHaveBeenCalledTimes(1);
    expect(recordChecks).toHaveBeenCalledTimes(1);
    expect(cas).not.toHaveBeenCalled();
  });
});

describe("a watched fix nobody was read declaring", () => {
  it("is verified as soon as the monitors recover, after one read says it still holds", async () => {
    mockPending(
      pending({
        revertWatch: watch({
          // Read seconds ago: a conclusion reads again anyway.
          lastCheckedAt: new Date(Date.now() - 10 * 1000).toISOString(),
        }),
      }),
    );
    mockMonitorsOperational(true);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).toHaveBeenCalledTimes(1);
    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Verified,
    );
    expect(writtenVerification()?.note).toBe(
      "The AI command remediation completed and the monitor(s) returned to an operational state within the verification window.",
    );
  });

  it("leaves the monitors to decide when the read fails", async () => {
    mockPending(pending({ revertWatch: watch() }));
    mockMonitorsOperational(true);
    check.mockResolvedValue(null);

    await RemediationVerifier.verifyPendingRemediations();

    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Verified,
    );
  });
});

describe("a plan with nothing watched", () => {
  it("never reads the cluster", async () => {
    mockPending(pending({}));
    mockMonitorsOperational(true);

    await RemediationVerifier.verifyPendingRemediations();

    expect(check).not.toHaveBeenCalled();
    expect(recordChecks).not.toHaveBeenCalled();
    expect(writtenVerification()?.status).toBe(
      AutoRemediationVerificationStatus.Verified,
    );
  });
});
