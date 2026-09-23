import RemediationCommandToolkit, {
  INLINE_COMMAND_STEP_ID_PREFIX,
  RemediationCommandNeedingApproval,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import { MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR } from "../../../../Server/Services/AutoRemediationRuleEngineService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_PLAN_COMMANDS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what an unattended (FullAuto) run checks right
 * before EACH inline kubectl change, beyond the policy tier:
 *
 * - the cluster's AI page is re-read LIVE for every command. A cluster
 *   whose remediation was turned off, lost readiness (project switches
 *   included), was re-bound to another Runner or credential, or cannot be
 *   read at all refuses the command — nothing is enqueued, nothing is
 *   recorded — and stays off-limits for the rest of the run. A cluster
 *   moved to "ask for approval", or from Bypass approval to Automatic, or
 *   whose allowlist shrank, is judged under its CURRENT mode and
 *   allowlist; what it refuses only for want of a human's click is kept
 *   for the round's proposal;
 * - a kubectl READ sent through the execute tool is refused and pointed at
 *   run_kubectl: it would otherwise count as an executed fix;
 * - the run's FIRST change on a cluster takes one of the cluster's hourly
 *   unattended slots under a per-cluster lock held until the job is
 *   enqueued. Three other runs already in the window refuse it; a lock or
 *   a count that cannot be had refuses it too; the run's later changes on
 *   the same cluster hold the slot already. Two runs racing at 2 of 3: the
 *   lock lets exactly one through;
 * - on an Automatic cluster a rollback must be a safe change: `set image`
 *   back is refused, `rollout undo` is accepted — which is exactly what the
 *   persona recommends.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_SUGGESTION_ID: ObjectID = new ObjectID(
  "79797979-7979-4979-8979-797979797979",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);
const CREDENTIAL_ID: string = "55555555-5555-4555-8555-555555555555";
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const SAFE_WRITE: string = "kubectl rollout restart deployment/web -n web";
const SAFE_UNDO: string = "kubectl rollout undo deployment/web -n web";
const RISKY_WRITE: string = "kubectl set image deployment/web web=img:2 -n web";
const RISKY_UNDO: string = "kubectl set image deployment/web web=img:1 -n web";

function cluster(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildToolkit(
  overrides: Partial<RemediationCommandToolkitOptions> = {},
): RemediationCommandToolkit {
  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [cluster()],
    ...overrides,
  });
}

function execute(
  toolkit: RemediationCommandToolkit,
  args: JSONObject,
): Promise<ToolCallOutcome> {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === "execute_remediation_command";
    });
  if (!tool) {
    throw new Error("execute_remediation_command is not offered.");
  }
  return tool.execute(args);
}

function listTargets(
  toolkit: RemediationCommandToolkit,
): Promise<ToolCallOutcome> {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === "list_command_targets";
    });
  return tool!.execute({});
}

function kubectlArgs(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID.toString(),
    command: SAFE_WRITE,
    rationale: "web pods are crash-looping after a config change",
    expectedEffect: "fresh pods come up Running",
    rollbackCommand: SAFE_UNDO,
    ...overrides,
  } as JSONObject;
}

function fakeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "deployment.apps/web restarted",
    payload: { displayCommand: SAFE_WRITE },
    ...overrides,
  } as unknown as RunnerJob;
}

// An inline kubectl job row, as the breaker reads it, for another run.
function inlineJobOf(suggestionId: ObjectID): RunnerJob {
  return {
    id: ObjectID.generate(),
    _id: ObjectID.generate().toString(),
    autoRemediationSuggestionId: suggestionId,
  } as unknown as RunnerJob;
}

let enqueueKubectl: jest.SpyInstance;
let persist: jest.SpyInstance;
let liveStatus: jest.SpyInstance;
let lock: jest.SpyInstance;
let release: jest.SpyInstance;
let jobFindBy: jest.SpyInstance;

function mockHappyPath(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  persist = jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue(fakeJob({ status: RunnerJobStatus.Pending }));
  jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(fakeJob());
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  // Nothing changed on the cluster's AI page since the run started.
  liveStatus = jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue(cluster());
  lock = jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "cluster-lock" } as unknown as SemaphoreMutex);
  release = jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  // An empty breaker window.
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jobFindBy = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
}

function expectNothingRanOrRecorded(
  toolkit: RemediationCommandToolkit,
  outcome: ToolCallOutcome,
): void {
  expect(outcome.success).toBe(false);
  expect(enqueueKubectl).not.toHaveBeenCalled();
  // No Pending audit record: the retry/sweeper paths would read it as "ran".
  expect(persist).not.toHaveBeenCalled();
  expect(toolkit.getExecutedCommands()).toHaveLength(0);
}

describe("RemediationCommandToolkit re-reads the cluster's AI page before every inline kubectl change", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("executes when the live page still matches the run's snapshot, with the snapshot's Runner, credential and step id — one live read per command", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({ accessMethod: "credential", credentialId: CREDENTIAL_ID }),
      ],
    });
    liveStatus.mockResolvedValue(
      cluster({ accessMethod: "credential", credentialId: CREDENTIAL_ID }),
    );

    const first: ToolCallOutcome = await execute(toolkit, kubectlArgs());
    const second: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({
        command: "kubectl scale deployment/web --replicas=4 -n web",
        rollbackCommand: "kubectl scale deployment/web --replicas=2 -n web",
      }),
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(liveStatus).toHaveBeenCalledTimes(2);
    for (const call of liveStatus.mock.calls) {
      const args: { clusterId: ObjectID; projectId: ObjectID } = call[0] as {
        clusterId: ObjectID;
        projectId: ObjectID;
      };
      expect(args.clusterId.toString()).toBe(CLUSTER_ID.toString());
      expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    }

    expect(enqueueKubectl).toHaveBeenCalledTimes(2);
    const enqueueArgs: Record<string, unknown> = enqueueKubectl.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(
      RUNNER_ID.toString(),
    );
    expect(enqueueArgs["credentialId"]).toBe(CREDENTIAL_ID);
    expect(enqueueArgs["stepId"]).toBe(`${INLINE_COMMAND_STEP_ID_PREFIX}1`);
  });

  it("refuses the next command once the operator turned remediation Off mid-run — one change landed, the second never does", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const first: ToolCallOutcome = await execute(toolkit, kubectlArgs());
    expect(first.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);

    liveStatus.mockResolvedValue(
      cluster({
        remediationMode: KubernetesAiRemediationMode.Disabled,
        isRemediationReady: false,
        gaps: [
          {
            code: "remediation_disabled",
            title: "AI remediation is turned off for this cluster",
            description: "",
            nextStep: "",
            blocks: "remediation",
          },
        ],
      }),
    );

    const second: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: "kubectl rollout restart deployment/api -n web" }),
    );

    expect(second.success).toBe(false);
    expect(second.textForLlm).toContain("no longer allows AI remediation");
    expect(second.textForLlm).toContain(
      "AI remediation is turned off for this cluster",
    );
    expect(second.textForLlm).toContain("Do NOT run any further command");
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()).toHaveLength(1);
    // Not something a click could now allow — nothing is kept for a proposal.
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);

    // The cluster is off-limits for the rest of the run.
    const listed: ToolCallOutcome = await listTargets(toolkit);
    expect(listed.result?.rowCount).toBe(0);
    const third: ToolCallOutcome = await execute(toolkit, kubectlArgs());
    expect(third.success).toBe(false);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("refuses when the project's AI switches went off (the status folds them into readiness)", async () => {
    liveStatus.mockResolvedValue(
      cluster({
        isRemediationReady: false,
        gaps: [
          {
            code: "project_ai_command_execution_disabled",
            title: "AI command execution is off for this project",
            description: "",
            nextStep: "",
            blocks: "remediation",
          },
        ],
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain(
      "AI command execution is off for this project",
    );
  });

  it("refuses — and keeps the change for a proposal — once the cluster was moved to Ask for approval mid-run", async () => {
    liveStatus.mockResolvedValue(
      cluster({ remediationMode: KubernetesAiRemediationMode.RequireApproval }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain(
      "was changed to ask for approval during this run",
    );
    expect(outcome.textForLlm).toContain("proposes it for one-click approval");

    const kept: Array<RemediationCommandNeedingApproval> =
      toolkit.getCommandsNeedingApproval();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.command.command).toBe(SAFE_WRITE);
    expect(kept[0]!.command.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(kept[0]!.command.wasAutoExecuted).toBe(false);
    expect(kept[0]!.command.execution).toBeUndefined();
    expect(kept[0]!.reason).toContain("changed to ask for approval");

    // A second change on it is refused (and kept) the same way.
    const again: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: "kubectl rollout restart deployment/api -n web" }),
    );
    expect(again.success).toBe(false);
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(2);
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("refuses when the cluster was re-bound to another Runner mid-run, and never enqueues on either Runner", async () => {
    liveStatus.mockResolvedValue(
      cluster({
        runner: {
          id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-us-v2",
          isOnline: true,
          canRunAiCommands: true,
        },
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain(
      "re-bound to a different Runner or credential",
    );

    // Nor does the run pick the new binding up on its own afterwards.
    const again: ToolCallOutcome = await execute(toolkit, kubectlArgs());
    expect(again.success).toBe(false);
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("refuses when the cluster's credential changed mid-run — in either direction", async () => {
    liveStatus.mockResolvedValue(
      cluster({ accessMethod: "credential", credentialId: CREDENTIAL_ID }),
    );
    const inCluster: RemediationCommandToolkit = buildToolkit();
    const first: ToolCallOutcome = await execute(inCluster, kubectlArgs());
    expectNothingRanOrRecorded(inCluster, first);

    liveStatus.mockResolvedValue(cluster());
    const credentialed: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({ accessMethod: "credential", credentialId: CREDENTIAL_ID }),
      ],
    });
    const second: ToolCallOutcome = await execute(credentialed, kubectlArgs());
    expect(second.success).toBe(false);
    expect(second.textForLlm).toContain("re-bound");
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the live page cannot be read", async () => {
    liveStatus.mockRejectedValue(new Error("db down"));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain(
      'Could not confirm that cluster "prod-us" still allows AI remediation',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("db down"),
    );
  });

  it("refuses when the cluster was deleted mid-run", async () => {
    liveStatus.mockResolvedValue(null);
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("no longer exists in this project");
  });

  it("judges a RiskyWrite under the LIVE mode: Bypass approval downgraded to Automatic mid-run refuses it (and keeps it for a proposal)", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
      proposesRefusedCommands: true,
    });
    liveStatus.mockResolvedValue(
      cluster({ remediationMode: KubernetesAiRemediationMode.Automatic }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: undefined }),
    );

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("Requires human approval");
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(1);
    expect(toolkit.getCommandsNeedingApproval()[0]!.command.kubectlTier).toBe(
      KubectlCommandTier.RiskyWrite,
    );
  });

  it("refuses a RiskyWrite rollback accepted under Bypass approval once the cluster became Automatic mid-run", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });
    liveStatus.mockResolvedValue(
      cluster({ remediationMode: KubernetesAiRemediationMode.Automatic }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: SAFE_WRITE, rollbackCommand: RISKY_UNDO }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "rollbackCommand does not qualify for automatic execution",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("negative control: the same rollback still runs when the Automatic cluster's allowlist names its shape", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });
    liveStatus.mockResolvedValue(
      cluster({
        remediationMode: KubernetesAiRemediationMode.Automatic,
        kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
      }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: SAFE_WRITE, rollbackCommand: RISKY_UNDO }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("uses the LIVE allowlist: a shape the operator removed mid-run no longer runs", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({
          kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
        }),
      ],
    });
    liveStatus.mockResolvedValue(cluster({ kubectlAllowlist: [] }));

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: undefined }),
    );

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("Requires human approval");
  });

  it("negative control: the snapshot's allowlist still names the shape live — the RiskyWrite runs", async () => {
    const allowlisted: KubernetesClusterAiAccessStatus = cluster({
      kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
    });
    liveStatus.mockResolvedValue(allowlisted);

    const outcome: ToolCallOutcome = await execute(
      buildToolkit({ clusterTargets: [allowlisted] }),
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("never reads the cluster page for a Bash command", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      id: OTHER_RUNNER_ID,
      _id: OTHER_RUNNER_ID.toString(),
      name: "ops-bastion",
    } as never);
    const bash: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueueAiCommand")
      .mockResolvedValue(fakeJob());

    const outcome: ToolCallOutcome = await execute(
      buildToolkit({
        allowlistPatterns: ["systemctl restart *"],
        allowedRunnerIds: [OTHER_RUNNER_ID.toString()],
        clusterTargets: [],
      }),
      {
        stepType: "Bash",
        runnerId: OTHER_RUNNER_ID.toString(),
        command: "systemctl restart nginx",
        rationale: "nginx is wedged",
        expectedEffect: "nginx serves again",
      } as JSONObject,
    );

    expect(outcome.success).toBe(true);
    expect(bash).toHaveBeenCalledTimes(1);
    expect(liveStatus).not.toHaveBeenCalled();
    // Bash never takes a cluster breaker slot either.
    expect(lock).not.toHaveBeenCalled();
  });
});

describe("RemediationCommandToolkit refuses kubectl reads on the execute tool", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    "kubectl rollout status deployment/web -n web",
    "kubectl get pods -n web",
    "kubectl describe pod web-1 -n web",
  ])(
    "refuses %s on an Automatic cluster and points at run_kubectl — nothing enqueued or recorded",
    async (command: string) => {
      const toolkit: RemediationCommandToolkit = buildToolkit({
        proposesRefusedCommands: true,
      });

      const outcome: ToolCallOutcome = await execute(
        toolkit,
        kubectlArgs({ command, rollbackCommand: undefined }),
      );

      expectNothingRanOrRecorded(toolkit, outcome);
      expect(outcome.textForLlm).toContain("run_kubectl");
      expect(outcome.textForLlm).toContain("read-only");
      // A read is never proposed for approval either.
      expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);
      // Refused before the cluster page or the breaker is even consulted.
      expect(liveStatus).not.toHaveBeenCalled();
      expect(lock).not.toHaveBeenCalled();
    },
  );

  it("refuses a read on a Bypass-approval cluster with a permissive allowlist too", async () => {
    const bypass: KubernetesClusterAiAccessStatus = cluster({
      remediationMode: KubernetesAiRemediationMode.BypassApproval,
      kubectlAllowlist: ["kubectl *"],
    });
    liveStatus.mockResolvedValue(bypass);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [bypass],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({
        command: "kubectl get pods -n web",
        rollbackCommand: undefined,
      }),
    );

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("run_kubectl");
  });

  it("negative control: a SafeWrite still executes and is recorded as before", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()).toHaveLength(1);
    expect(toolkit.getExecutedCommands()[0]!.kubectlTier).toBe(
      KubectlCommandTier.SafeWrite,
    );
  });

  it("tells the model in the tool description that reads go through run_kubectl", () => {
    const description: string =
      buildToolkit()
        .buildTools()
        .find((tool: ObservabilityAssistantExtraTool) => {
          return tool.definition.name === "execute_remediation_command";
        })?.definition.description || "";

    expect(description).toContain("read-only kubectl");
    expect(description).toContain("run_kubectl");
    expect(description).toContain("for CHANGES only");
  });
});

describe("RemediationCommandToolkit takes a cluster's hourly unattended slot before its first inline change", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses the change when three other runs already changed the cluster this hour — nothing enqueued, lock released, kept for a proposal", async () => {
    jobFindBy.mockResolvedValue([
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
    ]);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("hourly circuit breaker");
    expect(outcome.textForLlm).toContain(
      `already had ${MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR} unattended AI fix(es)`,
    );
    expect(lock).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(1);
    expect(toolkit.getCommandsNeedingApproval()[0]!.reason).toContain(
      "hourly circuit breaker",
    );
  });

  it("counts an unattended cluster round still in flight — created before this run — as a slot taken", async () => {
    jobFindBy.mockResolvedValue([
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
    ]);
    const createdAt: Date = new Date(Date.now() - 60 * 1000);
    jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
      {
        id: OTHER_SUGGESTION_ID,
        _id: OTHER_SUGGESTION_ID.toString(),
        createdAt: new Date(createdAt.getTime() - 1000),
      } as unknown as AutoRemediationSuggestion,
    ]);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      suggestionCreatedAt: createdAt,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("hourly circuit breaker");

    // The in-flight read is scoped to unattended Planning rounds on this cluster.
    const query: Record<string, unknown> = (
      (AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance)
        .mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["status"]).toBe(AutoRemediationSuggestionStatus.Planning);
    expect(query["executionMode"]).toBe(AutoRemediationExecutionMode.FullAuto);
    expect((query["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
  });

  it("negative control: an in-flight round created AFTER this run does not count against it", async () => {
    jobFindBy.mockResolvedValue([
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
    ]);
    const createdAt: Date = new Date(Date.now() - 60 * 1000);
    jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
      {
        id: OTHER_SUGGESTION_ID,
        _id: OTHER_SUGGESTION_ID.toString(),
        createdAt: new Date(createdAt.getTime() + 1000),
      } as unknown as AutoRemediationSuggestion,
    ]);

    const outcome: ToolCallOutcome = await execute(
      buildToolkit({ suggestionCreatedAt: createdAt }),
      kubectlArgs(),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("negative control: two other runs in the window leave headroom — the change runs, and the lock is released right after the enqueue, before the wait", async () => {
    jobFindBy.mockResolvedValue([
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
    ]);
    const poll: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    const outcome: ToolCallOutcome = await execute(
      buildToolkit(),
      kubectlArgs(),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: CLUSTER_ID.toString(),
        namespace: "AutoRemediationClusterBreaker",
      }),
    );
    // lock < enqueue < release < wait: the job row IS the reservation.
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueKubectl.mock.invocationCallOrder[0]!,
    );
    expect(enqueueKubectl.mock.invocationCallOrder[0]).toBeLessThan(
      release.mock.invocationCallOrder[0]!,
    );
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(
      poll.mock.invocationCallOrder[0]!,
    );
  });

  it("negative control: this run's own jobs never count against it, and its later changes on the same cluster hold the slot already", async () => {
    jobFindBy.mockResolvedValue([
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(SUGGESTION_ID),
    ]);
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const first: ToolCallOutcome = await execute(toolkit, kubectlArgs());
    expect(first.success).toBe(true);

    // Even with the window now full, the run keeps changing "its" cluster.
    jobFindBy.mockResolvedValue([
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(SUGGESTION_ID),
    ]);
    const second: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: "kubectl rollout restart deployment/api -n web" }),
    );

    expect(second.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("fails CLOSED when the breaker lock cannot be taken", async () => {
    lock.mockRejectedValue(new Error("Redis client is not connected"));
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("Could not check the hourly limit");
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(1);
  });

  it("fails CLOSED when the breaker count cannot be read, and still releases the lock", async () => {
    jobFindBy.mockRejectedValue(new Error("db down"));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expectNothingRanOrRecorded(toolkit, outcome);
    expect(outcome.textForLlm).toContain("Could not check the hourly limit");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when the enqueue itself throws", async () => {
    enqueueKubectl.mockRejectedValue(new Error("enqueue exploded"));

    const outcome: ToolCallOutcome = await execute(
      buildToolkit(),
      kubectlArgs(),
    );

    /*
     * The tool call resolves. Changed in the round-three review: an
     * enqueue that throws wrote no job, so the command certainly never ran
     * — a failed tool call off the record (KubectlJobRunner's NotRun), no
     * longer an executed command that "FAILED before completion".
     */
    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("did NOT run on cluster");
    expect(outcome.textForLlm).toContain("enqueue exploded");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("RemediationCommandToolkit serializes concurrent runs on one cluster's breaker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A shared cluster at 2 of 3: two runs of two different rounds try their
   * first change at the same moment. The fake job store is what the breaker
   * counts; an enqueue appends to it.
   */
  async function raceTwoRuns(serializing: boolean): Promise<{
    successes: number;
    runs: Array<RemediationCommandToolkit>;
    outcomes: Array<ToolCallOutcome>;
  }> {
    mockHappyPath();

    const jobs: Array<RunnerJob> = [
      inlineJobOf(ObjectID.generate()),
      inlineJobOf(ObjectID.generate()),
    ];
    jobFindBy.mockImplementation(async (): Promise<Array<RunnerJob>> => {
      /*
       * A read sees the rows as they were when it was issued, and takes a
       * moment to come back — long enough for a race to interleave.
       */
      const seen: Array<RunnerJob> = [...jobs];
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
      return seen;
    });
    enqueueKubectl.mockImplementation(
      async (args: {
        autoRemediationSuggestionId: ObjectID;
      }): Promise<RunnerJob> => {
        jobs.push(inlineJobOf(args.autoRemediationSuggestionId));
        return fakeJob({ status: RunnerJobStatus.Pending });
      },
    );

    let tail: Promise<void> = Promise.resolve();
    lock.mockImplementation(async (): Promise<SemaphoreMutex> => {
      if (!serializing) {
        return { id: "no-op" } as unknown as SemaphoreMutex;
      }
      let releaseThis: () => void = (): void => {
        return undefined;
      };
      const previous: Promise<void> = tail;
      tail = new Promise<void>((resolve: () => void) => {
        releaseThis = resolve;
      });
      await previous;
      return { release: releaseThis } as unknown as SemaphoreMutex;
    });
    release.mockImplementation(async (mutex: unknown): Promise<void> => {
      const releaseFn: (() => void) | undefined = (
        mutex as { release?: () => void }
      ).release;
      if (releaseFn) {
        releaseFn();
      }
    });

    const runA: RemediationCommandToolkit = buildToolkit({
      suggestionId: SUGGESTION_ID,
    });
    const runB: RemediationCommandToolkit = buildToolkit({
      suggestionId: OTHER_SUGGESTION_ID,
    });

    const outcomes: Array<ToolCallOutcome> = await Promise.all([
      execute(runA, kubectlArgs()),
      execute(runB, kubectlArgs()),
    ]);

    return {
      successes: outcomes.filter((outcome: ToolCallOutcome) => {
        return outcome.success;
      }).length,
      runs: [runA, runB],
      outcomes,
    };
  }

  it("lets exactly one of two racing runs take the last slot", async () => {
    expect((await raceTwoRuns(true)).successes).toBe(1);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("the run that lost the race was refused by the breaker it read AFTER the winner's job landed, and keeps its change for a proposal", async () => {
    const race: {
      successes: number;
      runs: Array<RemediationCommandToolkit>;
      outcomes: Array<ToolCallOutcome>;
    } = await raceTwoRuns(true);

    const loser: number = race.outcomes.findIndex(
      (outcome: ToolCallOutcome) => {
        return !outcome.success;
      },
    );
    expect(loser).toBeGreaterThanOrEqual(0);
    expect(race.outcomes[loser]!.textForLlm).toContain(
      "hourly circuit breaker",
    );
    const kept: Array<RemediationCommandNeedingApproval> =
      race.runs[loser]!.getCommandsNeedingApproval();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.reason).toContain("circuit breaker");
    expect(race.runs[1 - loser]!.getCommandsNeedingApproval()).toHaveLength(0);
  });

  it("negative control: without a lock that serializes, both runs read 2 of 3 and both run — the lock is what holds the limit", async () => {
    expect((await raceTwoRuns(false)).successes).toBe(2);
  });
});

describe("RemediationCommandToolkit keeps what a human's click would allow — and nothing else", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a refused RiskyWrite on an Automatic cluster once, with its reason, and tells a cluster round it will be proposed", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );
    // The model retries the very same command: kept once.
    await execute(
      toolkit,
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Requires human approval");
    expect(outcome.textForLlm).toContain("proposes it for one-click approval");
    expect(outcome.textForLlm).toContain(
      "Do NOT hunt for a worse safe substitute",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();

    const kept: Array<RemediationCommandNeedingApproval> =
      toolkit.getCommandsNeedingApproval();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.command.command).toBe(RISKY_WRITE);
    expect(kept[0]!.command.rollbackCommand).toBe(SAFE_UNDO);
    expect(kept[0]!.command.kubernetesClusterId).toBe(CLUSTER_ID.toString());
    expect(kept[0]!.reason).toContain("riskier change");
  });

  it("tells a rule-driven run (no proposal) to put the refused change in its recommendations instead", async () => {
    const outcome: ToolCallOutcome = await execute(
      buildToolkit(),
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: undefined }),
    );

    expect(outcome.textForLlm).toContain("final recommendations for a human");
    expect(outcome.textForLlm).not.toContain("one-click approval");
  });

  it("never keeps a Denied command, a refused rollback, or a read", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    await execute(
      toolkit,
      kubectlArgs({
        command: "kubectl delete namespace web",
        rollbackCommand: undefined,
      }),
    );
    await execute(toolkit, kubectlArgs({ rollbackCommand: RISKY_UNDO }));
    await execute(
      toolkit,
      kubectlArgs({
        command: "kubectl get pods -n web",
        rollbackCommand: undefined,
      }),
    );

    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it(`keeps at most a plan's worth (${MAX_PLAN_COMMANDS})`, async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    for (let i: number = 0; i < MAX_PLAN_COMMANDS + 2; i++) {
      await execute(
        toolkit,
        kubectlArgs({
          command: `kubectl set image deployment/web${i} web=img:2 -n web`,
          rollbackCommand: undefined,
        }),
      );
    }

    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(
      MAX_PLAN_COMMANDS,
    );
  });
});

describe("RemediationCommandToolkit's rollback rule on an Automatic cluster — the form the persona recommends", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const allowlisted: () => KubernetesClusterAiAccessStatus =
    (): KubernetesClusterAiAccessStatus => {
      return cluster({
        kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
      });
    };

  it("refuses an allowlisted set image whose rollback is set image back: rollbacks run unattended", async () => {
    liveStatus.mockResolvedValue(allowlisted());

    const outcome: ToolCallOutcome = await execute(
      buildToolkit({ clusterTargets: [allowlisted()] }),
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: RISKY_UNDO }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("rollbacks run unattended");
    expect(outcome.textForLlm).toContain(
      "kubectl rollout undo deployment/<name>",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("runs the same allowlisted set image with rollout undo as its rollback", async () => {
    liveStatus.mockResolvedValue(allowlisted());

    const outcome: ToolCallOutcome = await execute(
      buildToolkit({ clusterTargets: [allowlisted()] }),
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("negative control: an allowlist that does not name set image refuses the forward change — the allowlist is what authorizes it", async () => {
    const scaleOnly: KubernetesClusterAiAccessStatus = cluster({
      kubectlAllowlist: ["kubectl scale *"],
    });
    liveStatus.mockResolvedValue(scaleOnly);

    const outcome: ToolCallOutcome = await execute(
      buildToolkit({ clusterTargets: [scaleOnly] }),
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Requires human approval");
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });
});

/*
 * What a round kept for a proposal is dropped once the run sees the cluster
 * stop allowing AI remediation (PR #3953 review, remediation-r2-03): turned
 * off, re-bound, or deleted mid-run. The operator just withdrew exactly
 * what the card would ask them to approve. Moving the cluster to "ask for
 * approval" is not a withdrawal: that keeps everything (see above).
 */
describe("RemediationCommandToolkit drops what it kept for a cluster the run saw stop allowing AI remediation", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const RISKY_WRITE_2: string =
    "kubectl set image deployment/api api=img:2 -n web";

  it.each([
    [
      "remediation turned off",
      (): KubernetesClusterAiAccessStatus | null => {
        return cluster({
          remediationMode: KubernetesAiRemediationMode.Disabled,
          isRemediationReady: false,
          gaps: [
            {
              code: "remediation_disabled",
              title: "AI remediation is turned off for this cluster",
              description: "",
              nextStep: "",
              blocks: "remediation",
            },
          ],
        });
      },
      "no longer allows AI remediation",
    ],
    [
      "the cluster re-bound to another Runner",
      (): KubernetesClusterAiAccessStatus | null => {
        return cluster({
          runner: {
            id: OTHER_RUNNER_ID.toString(),
            name: "kubernetes-agent/prod-us-v2",
            isOnline: true,
            canRunAiCommands: true,
          },
        });
      },
      "re-bound",
    ],
    [
      "the cluster deleted",
      (): KubernetesClusterAiAccessStatus | null => {
        return null;
      },
      "no longer exists",
    ],
  ])(
    "%s: the riskier change kept earlier is no longer proposed",
    async (
      _label: string,
      revoked: () => KubernetesClusterAiAccessStatus | null,
      refusal: string,
    ) => {
      const toolkit: RemediationCommandToolkit = buildToolkit({
        proposesRefusedCommands: true,
      });

      await execute(
        toolkit,
        kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
      );
      expect(toolkit.getCommandsNeedingApproval()).toHaveLength(1);

      liveStatus.mockResolvedValue(revoked());

      const next: ToolCallOutcome = await execute(toolkit, kubectlArgs());

      expect(next.success).toBe(false);
      expect(next.textForLlm).toContain(refusal);
      expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);
      expect(enqueueKubectl).not.toHaveBeenCalled();
    },
  );

  it("negative control: with the cluster unchanged, a second riskier change is kept alongside the first", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
    });

    await execute(
      toolkit,
      kubectlArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );
    await execute(
      toolkit,
      kubectlArgs({ command: RISKY_WRITE_2, rollbackCommand: undefined }),
    );

    expect(
      toolkit
        .getCommandsNeedingApproval()
        .map((kept: RemediationCommandNeedingApproval) => {
          return kept.command.command;
        }),
    ).toEqual([RISKY_WRITE, RISKY_WRITE_2]);
  });
});

/*
 * The reason a kept change carries onto the approval card names what
 * actually holds it back (PR #3953 review, remediation-r2-05). A write in a
 * protected namespace — and a node drain or taint — needs a human in EVERY
 * mode, so "a riskier change on a cluster that only runs safe changes" would
 * be false on a Bypass cluster, and for a one-object restart in kube-system.
 */
describe("RemediationCommandToolkit says why a kept change needs a human", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const KUBE_SYSTEM_RESTART: string =
    "kubectl rollout restart deployment/coredns -n kube-system";

  async function keptReason(
    mode: KubernetesAiRemediationMode,
    command: string,
  ): Promise<{ reason: string; text: string }> {
    const target: KubernetesClusterAiAccessStatus = cluster({
      remediationMode: mode,
    });
    liveStatus.mockResolvedValue(target);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [target],
      proposesRefusedCommands: true,
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectlArgs({ command, rollbackCommand: undefined }),
    );

    expect(outcome.success).toBe(false);
    expect(enqueueKubectl).not.toHaveBeenCalled();
    const kept: Array<RemediationCommandNeedingApproval> =
      toolkit.getCommandsNeedingApproval();
    expect(kept).toHaveLength(1);
    return { reason: kept[0]!.reason, text: outcome.textForLlm };
  }

  it("on a Bypass cluster, a restart in kube-system names the protected namespace — never 'only runs safe changes'", async () => {
    const kept: { reason: string; text: string } = await keptReason(
      KubernetesAiRemediationMode.BypassApproval,
      KUBE_SYSTEM_RESTART,
    );

    expect(kept.reason).toContain("protected namespace kube-system");
    expect(kept.reason).toContain(
      "writes in kube-system always need a human, in every mode",
    );
    expect(kept.reason).not.toContain("safe changes");
    expect(kept.reason).not.toContain("riskier change");
    expect(kept.text).toContain(
      "writes in kube-system always need a human, in every mode",
    );
  });

  it("on an Automatic cluster, the same SAFE restart in kube-system is not called a riskier change", async () => {
    const kept: { reason: string; text: string } = await keptReason(
      KubernetesAiRemediationMode.Automatic,
      KUBE_SYSTEM_RESTART,
    );

    expect(kept.reason).toContain("protected namespace kube-system");
    expect(kept.reason).not.toContain("riskier change");
  });

  it("a node drain names the drain — it needs a human in every mode", async () => {
    const kept: { reason: string; text: string } = await keptReason(
      KubernetesAiRemediationMode.Automatic,
      "kubectl drain n1 --ignore-daemonsets",
    );

    expect(kept.reason).toContain("a node drain always needs a human");
    expect(kept.reason).not.toContain("riskier change");
  });

  it("negative control: an ordinary riskier change on an Automatic cluster is still a riskier change, and the allowlist is named", async () => {
    const kept: { reason: string; text: string } = await keptReason(
      KubernetesAiRemediationMode.Automatic,
      RISKY_WRITE,
    );

    expect(kept.reason).toContain("riskier change");
    expect(kept.reason).toContain("kubectl allowlist");
    expect(kept.reason).not.toContain("protected namespace");
  });
});

/*
 * The run's first change on a cluster re-checks, under the breaker lock,
 * that no other AI run holds the cluster (PR #3953 review,
 * remediation-r2-04): a rule-driven run that changed the cluster since this
 * run started is visible only now.
 */
describe("RemediationCommandToolkit checks for another AI run holding the cluster at its first change", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const INCIDENT_ID: ObjectID = new ObjectID(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );

  // Another run's kubectl job on the cluster, as the hold check reads it.
  function kubectlJobOf(suggestionId: ObjectID, stepId: string): RunnerJob {
    return {
      id: ObjectID.generate(),
      _id: ObjectID.generate().toString(),
      autoRemediationSuggestionId: suggestionId,
      stepId,
    } as unknown as RunnerJob;
  }

  function mockOtherRun(row: Record<string, unknown> | null): void {
    jobFindBy.mockResolvedValue(
      row ? [kubectlJobOf(OTHER_SUGGESTION_ID, "ai-command-1")] : [],
    );
    (
      AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance
    ).mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        const query: Record<string, unknown> =
          (args as { query?: Record<string, unknown> }).query || {};
        // Only the read of the runs behind those jobs names ids.
        return (query["_id"] && row
          ? [row]
          : []) as unknown as Array<AutoRemediationSuggestion>;
      },
    );
  }

  function ruleRun(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: OTHER_SUGGESTION_ID,
      _id: OTHER_SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      incidentId: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
      ruleNameSnapshot: "Restart web on 5xx",
      createdAt: new Date(Date.now() + 60 * 1000),
      ...overrides,
    };
  }

  it("refuses the change while a rule-driven run is still changing the cluster — whatever the order — and keeps it for a proposal", async () => {
    mockOtherRun(ruleRun());
    const toolkit: RemediationCommandToolkit = buildToolkit({
      proposesRefusedCommands: true,
      suggestionCreatedAt: new Date(),
      clusterHold: { anyOrder: false },
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      'Another OneUptime AI run on cluster "prod-us" is still changing it',
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    const kept: Array<RemediationCommandNeedingApproval> =
      toolkit.getCommandsNeedingApproval();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.reason).toContain("is still changing it");
  });

  it("refuses the change while a rule-driven run's fix on the cluster is still being verified", async () => {
    mockOtherRun(
      ruleRun({
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        verificationStatus: AutoRemediationVerificationStatus.Pending,
        verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterHold: {
        anyOrder: true,
        subject: { incidentId: INCIDENT_ID },
      },
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("still being verified");
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("negative control: once that fix was verified the change runs", async () => {
    mockOtherRun(
      ruleRun({
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        verificationStatus: AutoRemediationVerificationStatus.Verified,
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterHold: { anyOrder: false },
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("negative control: nothing else on the cluster — the change runs", async () => {
    mockOtherRun(null);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterHold: { anyOrder: false },
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("fails CLOSED when the hold check cannot be read: refused, lock released", async () => {
    mockOtherRun(null);
    (
      AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance
    ).mockImplementation(async (args: unknown): Promise<never> => {
      const query: Record<string, unknown> =
        (args as { query?: Record<string, unknown> }).query || {};
      if (query["executionMode"]) {
        // The breaker's in-flight read works...
        return [] as never;
      }
      // ...the hold check's does not.
      throw new Error("db down");
    });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterHold: { anyOrder: false },
    });

    const outcome: ToolCallOutcome = await execute(toolkit, kubectlArgs());

    expect(outcome.success).toBe(false);
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
