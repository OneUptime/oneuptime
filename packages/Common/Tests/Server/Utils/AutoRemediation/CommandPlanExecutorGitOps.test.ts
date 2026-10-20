import CommandPlanExecutor, {
  CommandPlanRollbackOutcome,
} from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import GitOpsInspector, {
  GitOpsCommandInspection,
} from "../../../../Server/Utils/AI/Remediation/GitOpsInspector";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { AiRemediationRollbackStatus } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  AiRemediationCommandGitOps,
  AiRemediationRevertWatch,
  GitOpsController,
} from "../../../../Types/AutoRemediation/AiRemediationGitOps";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import KubectlPolicy from "../../../../Utils/AiRemediation/KubectlPolicy";
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
 * GitOps in the approved-plan executor and the rollback arm.
 *
 *   - Before an approved kubectl command runs, its object is read again
 *     (GitOpsInspector.inspectCommandOnCluster): who declares it NOW is
 *     what the record keeps, and the read is the "before" of the revert
 *     watch. After it succeeded, the object is read once more
 *     (captureRevertWatchOnCluster) and what the command did is recorded
 *     for verification to watch. A read never decides whether a command
 *     runs.
 *   - A command verification found put back (revertWatch.putBackAt) is not
 *     undone again: its object is already back, and its undo — a rollout
 *     undo after a rollout undo or a set image — could re-apply the fix.
 *     One put back only in part is left for a human, with what is still
 *     applied.
 */

const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
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
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const UNDO: string = "kubectl rollout undo deployment/web -n web";
const SCALE: string = "kubectl scale deployment/api --replicas=4 -n web";

const ARGO: AiRemediationCommandGitOps = {
  controller: GitOpsController.ArgoCD,
  ownerKind: "Application",
  ownerName: "shop",
  evidence: "annotation argocd.argoproj.io/tracking-id",
  objectKind: "deployment",
  objectName: "web",
  objectNamespace: "web",
  putsBack: true,
  reconcilesOnItsOwn: true,
  summary: 'Argo CD Application "shop" declares deployment/web ...',
};

const WATCH: AiRemediationRevertWatch = {
  kind: "deployment",
  name: "web",
  namespace: "web",
  fields: [
    {
      path: "spec.template.spec.containers[app].image",
      before: '"web:2"',
      after: '"web:1"',
    },
  ],
  capturedAt: "2026-10-20T10:00:05.000Z",
};

function kubectlCommand(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    sequence: 1,
    stepType: "Kubectl",
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "kubernetes-agent/prod-us",
    kubernetesClusterId: CLUSTER_ID.toString(),
    kubernetesClusterNameSnapshot: "prod-us",
    kubectlTier: "SafeWrite",
    command: UNDO,
    rollbackCommand: UNDO,
    timeoutInMs: 5000,
    rationale: "The last deploy broke checkout.",
    expectedEffect: "The previous version runs again.",
    policyVerdict: "RequiresApproval",
    ...overrides,
  };
}

function clusterStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

function suggestion(
  commands: Array<Record<string, unknown>>,
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    kubernetesClusterId: CLUSTER_ID,
    status: AutoRemediationSuggestionStatus.Approved,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    verificationStatus: AutoRemediationVerificationStatus.Pending,
    verificationDeadlineAt: new Date(Date.now() + 15 * 60 * 1000),
    ruleNameSnapshot: "AI remediation",
    commandPlan: { commands },
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function job(status: RunnerJobStatus): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status,
    exitCode: status === RunnerJobStatus.Succeeded ? 0 : 1,
    output: "deployment.apps/web rolled back",
  } as unknown as RunnerJob;
}

let update: SpyInstance<typeof AutoRemediationSuggestionService.updateOneById>;
let enqueue: SpyInstance<typeof RunnerJobService.enqueueAiKubectlCommand>;
let poll: SpyInstance<typeof RunnerJobService.pollUntilTerminal>;
let inspect: SpyInstance<typeof GitOpsInspector.inspectCommandOnCluster>;
let capture: SpyInstance<typeof GitOpsInspector.captureRevertWatchOnCluster>;
let feed: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem>;

function lastPlan(): Record<string, unknown> {
  const call: Record<string, unknown> = update.mock.calls[
    update.mock.calls.length - 1
  ]![0] as unknown as Record<string, unknown>;
  return (call["data"] as Record<string, unknown>)["commandPlan"] as Record<
    string,
    unknown
  >;
}

function commandAt(index: number): Record<string, unknown> {
  return (lastPlan()["commands"] as Array<Record<string, unknown>>)[index]!;
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "plan-lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  // No stored plan to merge into: each write is the writer's own copy.
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockResolvedValue(null);
  update = jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  enqueue = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue(job(RunnerJobStatus.Pending));
  poll = jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(job(RunnerJobStatus.Succeeded));
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue(clusterStatus());
  jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  feed = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  inspect = jest
    .spyOn(GitOpsInspector, "inspectCommandOnCluster")
    .mockImplementation(
      async (data: { command: string }): Promise<GitOpsCommandInspection> => {
        return {
          watchTarget: {
            target: KubectlPolicy.getNamedObject(
              KubectlPolicy.evaluateCommand(data.command).args,
            )!,
            namespace: "web",
          },
          before: { found: true, object: { spec: {} } },
          gitOps: ARGO,
        };
      },
    );
  capture = jest
    .spyOn(GitOpsInspector, "captureRevertWatchOnCluster")
    .mockResolvedValue(WATCH);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CommandPlanExecutor.executeApprovedPlan — a kubectl command's object", () => {
  it("is read before the command runs and after it succeeded: who declares it now, and what it did", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(suggestion([kubectlCommand()]));

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(inspect).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      aiRunId: AI_RUN_ID,
      kubernetesClusterId: CLUSTER_ID.toString(),
      command: UNDO,
      stepIdPrefix: "ai-gitops-approved-1",
    });
    expect(inspect.mock.invocationCallOrder[0]).toBeLessThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        aiRunId: AI_RUN_ID,
        kubernetesClusterId: CLUSTER_ID.toString(),
        stepId: "ai-gitops-approved-1-after",
      }),
    );
    expect(capture.mock.invocationCallOrder[0]).toBeGreaterThan(
      poll.mock.invocationCallOrder[0]!,
    );

    expect(lastPlan()["executionStatus"]).toBe("Completed");
    expect(commandAt(0)["gitOps"]).toEqual(ARGO);
    expect(commandAt(0)["revertWatch"]).toEqual(WATCH);
  });

  it("records no watch for a command that failed", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(suggestion([kubectlCommand()]));
    poll.mockResolvedValue(job(RunnerJobStatus.Failed));

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(capture).not.toHaveBeenCalled();
    expect(commandAt(0)["revertWatch"]).toBeUndefined();
  });

  it("runs the command when its object cannot be read: a read never decides", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(suggestion([kubectlCommand()]));
    inspect.mockRejectedValue(new Error("the read failed"));

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
    expect(lastPlan()["executionStatus"]).toBe("Completed");
  });
});

describe("CommandPlanExecutor.executeRollback — what the cluster already put back", () => {
  function executed(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return kubectlCommand({
      wasAutoExecuted: true,
      policyVerdict: "AutoApproved",
      gitOps: ARGO,
      execution: {
        status: "Succeeded",
        runnerJobId: JOB_ID.toString(),
        exitCode: 0,
      },
      ...overrides,
    });
  }

  function failedVerification(
    commands: Array<Record<string, unknown>>,
  ): AutoRemediationSuggestion {
    return suggestion(commands, {
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      commandPlan: { commands, executionStatus: "Completed" },
    });
  }

  it("does not undo a change that was put back: the undo could re-apply the fix", async () => {
    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: failedVerification([
          executed({
            revertWatch: {
              ...WATCH,
              putBackAt: "2026-10-20T10:01:00.000Z",
              putBackFields: ["spec.template.spec.containers[app].image"],
            },
          }),
        ]),
      });

    expect(enqueue).not.toHaveBeenCalled();
    expect(commandAt(0)["rollbackExecution"]).toBeUndefined();
    expect(lastPlan()["rollbackStatus"]).toBe("NotApplicable");
    expect(outcome.rollbackStatus).toBe(
      AiRemediationRollbackStatus.NotApplicable,
    );
    expect(outcome.summary).toBe(
      "Nothing was rolled back: 1 command(s) were not undone: the cluster had already put back what they changed.",
    );
    expect(feed).not.toHaveBeenCalled();
  });

  it("still undoes the plan's other changes", async () => {
    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: failedVerification([
          executed({
            revertWatch: {
              ...WATCH,
              putBackAt: "2026-10-20T10:01:00.000Z",
              putBackFields: ["spec.template.spec.containers[app].image"],
            },
          }),
          executed({
            sequence: 2,
            command: SCALE,
            rollbackCommand: "kubectl scale deployment/api --replicas=2 -n web",
            kubectlTier: "SafeWrite",
            gitOps: undefined,
          }),
        ]),
      });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "kubectl scale deployment/api --replicas=2 -n web",
      }),
    );
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Completed);
    expect(outcome.summary).toBe(
      "Rollback completed: 1 command(s) undone. 1 command(s) were not undone: the cluster had already put back what they changed.",
    );
  });

  it("leaves a change put back only in part for a human, naming what is still applied", async () => {
    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: failedVerification([
          executed({
            command: "kubectl set env deployment/web MODE=b FIX_FLAG=1 -n web",
            kubectlTier: "RiskyWrite",
            revertWatch: {
              ...WATCH,
              fields: [
                {
                  path: "spec.template.spec.containers[app].env[MODE].value",
                  before: '"a"',
                  after: '"b"',
                },
                {
                  path: "spec.template.spec.containers[app].env[FIX_FLAG].value",
                  after: '"1"',
                },
              ],
              putBackAt: "2026-10-20T10:01:00.000Z",
              putBackFields: [
                "spec.template.spec.containers[app].env[MODE].value",
              ],
            },
          }),
        ]),
      });

    expect(enqueue).not.toHaveBeenCalled();
    const rollbackExecution: Record<string, unknown> = commandAt(0)[
      "rollbackExecution"
    ] as Record<string, unknown>;
    expect(rollbackExecution["status"]).toBe("Skipped");
    expect(rollbackExecution["errorMessage"]).toBe(
      `Rollback not run: Argo CD Application "shop" put back part of this change, so its undo would now change more than the change did. Still applied: spec.template.spec.containers[app].env[FIX_FLAG].value. If that should go too, undo it manually: ${UNDO}`,
    );
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
    expect(outcome.leftForHuman).toBe(1);
  });
});
