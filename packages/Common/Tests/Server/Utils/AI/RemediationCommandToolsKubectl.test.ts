import RemediationCommandToolkit, {
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the Kubectl lane of the remediation command toolkit:
 *
 * - a cluster is a target only when its AI page made it remediation-ready;
 *   the model names the cluster and the toolkit fills in the Runner and
 *   credential the cluster's page bound — never the model's choice;
 * - FullAuto executes Read/SafeWrite kubectl inline, refuses RiskyWrite
 *   unless the cluster allowlist names it, refuses Denied always, and
 *   refuses everything on a cluster that asks for approval;
 * - on a BypassApproval cluster FullAuto executes RiskyWrite inline too
 *   (no allowlist needed) and accepts a RiskyWrite rollback; Denied stays
 *   refused whatever the mode or allowlist says;
 * - a rollback must itself be safe (Read/SafeWrite): it runs unattended;
 * - Suggest records kubectl commands on the plan with their tier and the
 *   verdict the card shows, in the canonical rendered form;
 * - every executed command is persisted BEFORE the job is enqueued and
 *   runs as an AiRemediation-origin kubectl job with the suggestion id.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

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

function getTool(
  toolkit: RemediationCommandToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!tool) {
    throw new Error(`Tool ${name} not offered by this toolkit.`);
  }
  return tool;
}

function kubectlArgs(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID.toString(),
    command: "kubectl rollout restart deployment/web -n web",
    rationale: "web pods are crash-looping after a config change",
    expectedEffect: "fresh pods come up Running",
    rollbackCommand: "kubectl rollout undo deployment/web -n web",
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
    payload: {
      displayCommand: "kubectl rollout restart deployment/web -n web",
    },
    ...overrides,
  } as unknown as RunnerJob;
}

let persistedPlans: Array<JSONObject>;
let enqueueKubectl: jest.SpyInstance;
let enqueueBash: jest.SpyInstance;

function mockHappyPath(): void {
  persistedPlans = [];
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      persistedPlans.push(
        (args as { data: { commandPlan: JSONObject } }).data.commandPlan,
      );
      return undefined as never;
    });
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue(fakeJob());
  enqueueBash = jest.spyOn(RunnerJobService, "enqueueAiCommand");
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
}

describe("RemediationCommandToolkit list_command_targets with clusters", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists a ready cluster as a Kubectl target and skips host lookups for a cluster-only run", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain("KubernetesCluster");
    expect(outcome.textForLlm).toContain(CLUSTER_ID.toString());
    expect(outcome.textForLlm).toContain("Automatic");
    expect(
      RunnerService.getOnlineAiCommandRunnersForProject,
    ).not.toHaveBeenCalled();
  });

  it("hides a cluster that is not remediation-ready", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit({
        clusterTargets: [cluster({ isRemediationReady: false })],
      }),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(0);
    expect(outcome.textForLlm).toContain("No online Runner");
    expect(outcome.textForLlm).toContain("no linked Kubernetes cluster");
  });
});

describe("RemediationCommandToolkit execute_remediation_command (Kubectl, FullAuto)", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("executes a SafeWrite inline as an AiRemediation kubectl job, persisting the record first", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("SUCCEEDED");
    expect(outcome.result?.citationLabel).toContain('cluster "prod-us"');

    expect(enqueueBash).not.toHaveBeenCalled();
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    const enqueueArgs: Record<string, unknown> = enqueueKubectl.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueueArgs["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(
      (enqueueArgs["autoRemediationSuggestionId"] as ObjectID).toString(),
    ).toBe(SUGGESTION_ID.toString());
    expect((enqueueArgs["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(
      RUNNER_ID.toString(),
    );
    expect(enqueueArgs["command"]).toBe(
      "kubectl rollout restart deployment/web -n web",
    );

    // Persisted before AND after the job.
    expect(persistedPlans.length).toBeGreaterThanOrEqual(2);
    const first: AiRemediationCommand = (
      persistedPlans[0]!["commands"] as unknown as Array<AiRemediationCommand>
    )[0]!;
    expect(first.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Pending,
    );

    const executed: Array<AiRemediationCommand> = toolkit.getExecutedCommands();
    expect(executed).toHaveLength(1);
    expect(executed[0]!.stepType).toBe(RunbookStepType.Kubectl);
    expect(executed[0]!.kubernetesClusterId).toBe(CLUSTER_ID.toString());
    expect(executed[0]!.kubernetesClusterNameSnapshot).toBe("prod-us");
    expect(executed[0]!.kubectlTier).toBe(KubectlCommandTier.SafeWrite);
    expect(executed[0]!.runnerId).toBe(RUNNER_ID.toString());
    expect(executed[0]!.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(executed[0]!.wasAutoExecuted).toBe(true);
    expect(executed[0]!.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Succeeded,
    );
    expect(executed[0]!.execution?.runnerJobId).toBe(JOB_ID.toString());
  });

  it("refuses a RiskyWrite unless the cluster allowlist names it", async () => {
    const refused: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        command: "kubectl set image deployment/web web=nginx:1.27 -n web",
        rollbackCommand: undefined,
      }),
    );

    expect(refused.success).toBe(false);
    expect(refused.textForLlm).toContain("Requires human approval");
    expect(refused.textForLlm).toContain("NOT executed");
    expect(enqueueKubectl).not.toHaveBeenCalled();

    const allowed: ToolCallOutcome = await getTool(
      buildToolkit({
        clusterTargets: [
          cluster({
            kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
          }),
        ],
      }),
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        command: "kubectl set image deployment/web web=nginx:1.27 -n web",
        rollbackCommand: undefined,
      }),
    );

    expect(allowed.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("refuses a Denied command even on an Automatic cluster with a permissive allowlist", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit({
        clusterTargets: [cluster({ kubectlAllowlist: ["*"] })],
      }),
      "execute_remediation_command",
    ).execute(kubectlArgs({ command: "kubectl delete namespace web" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "Denied by the kubectl command policy",
    );
    expect(outcome.textForLlm).toContain("can never run");
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(persistedPlans).toHaveLength(0);
  });

  it("refuses inline execution on a cluster that asks for approval", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit({
        clusterTargets: [
          cluster({
            remediationMode: KubernetesAiRemediationMode.RequireApproval,
          }),
        ],
      }),
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("requires human approval");
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("requires the rollback to be a safe change because it runs unattended", async () => {
    const risky: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        rollbackCommand: "kubectl patch deployment web -n web -p '{}'",
      }),
    );
    expect(risky.success).toBe(false);
    expect(risky.textForLlm).toContain("rollbacks run unattended");

    const denied: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(kubectlArgs({ rollbackCommand: "kubectl delete ns web" }));
    expect(denied.success).toBe(false);
    expect(denied.textForLlm).toContain("rollbackCommand is denied");

    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("refuses a cluster the run was not given", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        kubernetesClusterId: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("kubernetesClusterId is required");
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });
});

describe("RemediationCommandToolkit execute_remediation_command (Kubectl, BypassApproval)", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function bypassToolkit(
    overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  ): RemediationCommandToolkit {
    return buildToolkit({
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
          ...overrides,
        }),
      ],
    });
  }

  it("lists the cluster as bypassing approvals", async () => {
    const outcome: ToolCallOutcome = await getTool(
      bypassToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain("BypassApproval");
    expect(outcome.textForLlm).toContain("RiskyWrite");
    expect(outcome.textForLlm).not.toContain("needs approval");
  });

  it("executes a RiskyWrite inline with an empty allowlist and records it as auto-approved", async () => {
    const toolkit: RemediationCommandToolkit = bypassToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        command: "kubectl set image deployment/web web=nginx:1.27 -n web",
        rollbackCommand: undefined,
      }),
    );

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("SUCCEEDED");
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(enqueueBash).not.toHaveBeenCalled();

    const enqueueArgs: Record<string, unknown> = enqueueKubectl.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueueArgs["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(enqueueArgs["command"]).toBe(
      "kubectl set image deployment/web web=nginx:1.27 -n web",
    );

    const executed: Array<AiRemediationCommand> = toolkit.getExecutedCommands();
    expect(executed).toHaveLength(1);
    expect(executed[0]!.kubectlTier).toBe(KubectlCommandTier.RiskyWrite);
    expect(executed[0]!.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(executed[0]!.wasAutoExecuted).toBe(true);
    expect(executed[0]!.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Succeeded,
    );
  });

  it("executes a RiskyWrite with a RiskyWrite rollback", async () => {
    const toolkit: RemediationCommandToolkit = bypassToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        command: "kubectl set image deployment/web web=nginx:1.27 -n web",
        rollbackCommand:
          "kubectl set image deployment/web web=nginx:1.26 -n web",
      }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()[0]!.rollbackCommand).toBe(
      "kubectl set image deployment/web web=nginx:1.26 -n web",
    );
  });

  it("still executes SafeWrite exactly as an Automatic cluster would", async () => {
    const toolkit: RemediationCommandToolkit = bypassToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(toolkit.getExecutedCommands()[0]!.kubectlTier).toBe(
      KubectlCommandTier.SafeWrite,
    );
  });

  it("refuses Denied commands and Denied rollbacks even with bypass and a permissive allowlist", async () => {
    const toolkit: RemediationCommandToolkit = bypassToolkit({
      kubectlAllowlist: ["*"],
    });

    for (const command of [
      "kubectl delete namespace web",
      "kubectl delete secret db -n web",
      "kubectl exec web-1 -n web -- sh",
      "kubectl apply -f manifest.yaml",
      "kubectl delete pods --all -n web",
    ]) {
      const outcome: ToolCallOutcome = await getTool(
        toolkit,
        "execute_remediation_command",
      ).execute(kubectlArgs({ command, rollbackCommand: undefined }));

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain(
        "Denied by the kubectl command policy",
      );
    }

    const deniedRollback: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs({ rollbackCommand: "kubectl delete ns web" }));
    expect(deniedRollback.success).toBe(false);
    expect(deniedRollback.textForLlm).toContain("rollbackCommand is denied");

    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(persistedPlans).toHaveLength(0);
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });

  it("keeps the RiskyWrite refusal on an Automatic cluster sitting next to a Bypass one", async () => {
    const automaticId: string = "99999999-9999-4999-8999-999999999999";
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        cluster({
          clusterId: automaticId,
          clusterName: "staging",
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      ],
    });

    const refused: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        kubernetesClusterId: automaticId,
        command: "kubectl set image deployment/web web=nginx:1.27 -n web",
        rollbackCommand: undefined,
      }),
    );
    expect(refused.success).toBe(false);
    expect(refused.textForLlm).toContain("Requires human approval");

    const allowed: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      kubectlArgs({
        command: "kubectl set image deployment/web web=nginx:1.27 -n web",
        rollbackCommand: undefined,
      }),
    );
    expect(allowed.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("does not execute anything in Suggest mode on a Bypass cluster (breaker-tripped run) and records RiskyWrite as auto-approved", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });

    expect(
      toolkit.buildTools().map((tool: ObservabilityAssistantExtraTool) => {
        return tool.definition.name;
      }),
    ).not.toContain("execute_remediation_command");

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        kubectlArgs({
          command: "kubectl set image deployment/web web=nginx:1.27 -n web",
          rollbackCommand:
            "kubectl set image deployment/web web=nginx:1.26 -n web",
        }),
      ],
    });

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).not.toHaveBeenCalled();

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
    expect(plan?.commands).toHaveLength(1);
    expect(plan!.commands[0]!.kubectlTier).toBe(KubectlCommandTier.RiskyWrite);
    expect(plan!.commands[0]!.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(plan!.commands[0]!.wasAutoExecuted).toBeFalsy();
  });
});

describe("RemediationCommandToolkit propose_remediation_commands (Kubectl, Suggest)", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records kubectl commands in canonical form with their tier and verdict", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          accessMethod: "credential",
          credentialId: "55555555-5555-4555-8555-555555555555",
          credentialName: "prod kubeconfig",
        }),
      ],
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        kubectlArgs({
          command: "kubectl   rollout restart   deployment/web -n web",
        }),
        kubectlArgs({
          command: "kubectl set image deployment/web web=nginx:1.27 -n web",
          rollbackCommand: undefined,
        }),
      ],
    });

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).not.toHaveBeenCalled();

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
    expect(plan?.commands).toHaveLength(2);

    const [restart, setImage] = plan!.commands as [
      AiRemediationCommand,
      AiRemediationCommand,
    ];
    expect(restart.command).toBe(
      "kubectl rollout restart deployment/web -n web",
    );
    expect(restart.kubectlTier).toBe(KubectlCommandTier.SafeWrite);
    expect(restart.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(restart.rollbackCommand).toBe(
      "kubectl rollout undo deployment/web -n web",
    );
    expect(restart.credentialId).toBe("55555555-5555-4555-8555-555555555555");
    expect(restart.credentialNameSnapshot).toBe("prod kubeconfig");
    expect(restart.runnerNameSnapshot).toBe("kubernetes-agent/prod-us");

    expect(setImage.kubectlTier).toBe(KubectlCommandTier.RiskyWrite);
    expect(setImage.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
  });

  it("rejects the whole plan when one kubectl command is Denied", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        kubectlArgs(),
        kubectlArgs({
          command: "kubectl exec -it web-1 -n web -- sh",
          rollbackCommand: undefined,
        }),
      ],
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Command 2");
    expect(outcome.textForLlm).toContain("exec");
    expect(toolkit.getProposedPlan()).toBeNull();
  });
});
