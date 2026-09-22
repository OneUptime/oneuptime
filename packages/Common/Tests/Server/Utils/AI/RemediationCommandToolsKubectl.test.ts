import RemediationCommandToolkit, {
  INLINE_COMMAND_STEP_ID_PREFIX,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import KubectlJobRunner, {
  KUBECTL_CLAIM_TIMEOUT_MS,
  KUBECTL_OUTPUT_TRUNCATED_SUFFIX,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import logger from "../../../../Server/Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Runner from "../../../../Models/DatabaseModels/Runner";
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
  MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
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
 * - FullAuto executes SafeWrite kubectl inline, refuses RiskyWrite
 *   unless the cluster allowlist names it, refuses Denied always, and
 *   refuses everything on a cluster that asks for approval (a kubectl read
 *   is refused too: it belongs to run_kubectl, and sent through the execute
 *   tool it would count as an executed fix — see
 *   RemediationCommandToolsLiveCluster.test.ts, which also pins the live
 *   per-command re-check of the cluster and the write-time breaker slot);
 * - on a BypassApproval cluster FullAuto executes RiskyWrite inline too
 *   (no allowlist needed) and accepts a RiskyWrite rollback; Denied stays
 *   refused whatever the mode or allowlist says;
 * - a rollback must itself be safe (Read/SafeWrite): it runs unattended;
 * - Suggest records kubectl commands on the plan with their tier, in the
 *   canonical rendered form, every one marked RequiresApproval: the plan
 *   needs a human's click whatever the cluster's mode would auto-approve
 *   (a breaker-tripped BypassApproval round proposes the very plan it would
 *   otherwise have run, and the card must not call any of it auto-approved);
 * - every executed command is persisted BEFORE the job is enqueued, again
 *   WITH its job id before the wait, and runs as an AiRemediation-origin
 *   kubectl job with the suggestion id;
 * - what a command printed goes through ONE redaction chain (structural
 *   Secret/credential masking, then the generic rules, then the cap)
 *   before it is persisted on the suggestion or shown to the model — for
 *   the kubectl lane AND for a Bash step that happens to run kubectl;
 * - list_command_targets tells a FullAuto round the truth about an
 *   Automatic cluster: a riskier change never runs inline — a rule-driven
 *   run leaves it in the written recommendations for a human, a cluster
 *   round submits it anyway so it is proposed for one-click approval when
 *   the round ends.
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

/*
 * The cluster AI pages as they stand "now". The toolkit re-reads a
 * cluster's page before every inline kubectl change; by default the page
 * says exactly what the toolkit was built with (nothing changed mid-run).
 */
const liveClusterStatuses: Map<string, KubernetesClusterAiAccessStatus> =
  new Map<string, KubernetesClusterAiAccessStatus>();

function buildToolkit(
  overrides: Partial<RemediationCommandToolkitOptions> = {},
): RemediationCommandToolkit {
  const options: RemediationCommandToolkitOptions = {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [cluster()],
    ...overrides,
  };

  for (const target of options.clusterTargets || []) {
    liveClusterStatuses.set(target.clusterId, target);
  }

  return new RemediationCommandToolkit(options);
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
  liveClusterStatuses.clear();
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockImplementation(
      async (data: {
        clusterId: ObjectID;
      }): Promise<KubernetesClusterAiAccessStatus | null> => {
        return liveClusterStatuses.get(data.clusterId.toString()) || null;
      },
    );
  // The write-time circuit-breaker slot: a lock, and a cluster with headroom.
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({} as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
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

  it("tells a rule-driven FullAuto run that an Automatic cluster never runs a RiskyWrite inline, and sends it to the written recommendations", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    /*
     * A rule-driven run never proposes what it refused (only a cluster
     * round does), so the text sends the model to its written
     * recommendations — while still saying that an allowlisted shape runs.
     */
    expect(outcome.textForLlm).toContain("never runs inline");
    expect(outcome.textForLlm).toContain("written recommendations for a human");
    expect(outcome.textForLlm).toContain("unless the cluster allowlist names");
    expect(outcome.textForLlm).not.toContain("proposed for one-click approval");
  });

  it("tells a cluster round that a refused RiskyWrite is recorded and proposed for one-click approval — the Automatic promise", async () => {
    /*
     * Changed with the "Automatic proposes the riskier fix" fix: this text
     * used to say "neither run nor proposed", which is no longer true for
     * a cluster round that executes nothing.
     */
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit({ proposesRefusedCommands: true }),
      "list_command_targets",
    ).execute({});

    expect(outcome.textForLlm).toContain("never runs inline");
    expect(outcome.textForLlm).toContain("submit it anyway");
    expect(outcome.textForLlm).toContain("proposed for one-click approval");
    expect(outcome.textForLlm).toContain("if no other change ran");
    expect(outcome.textForLlm).not.toContain("neither run nor proposed");
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

  it("does not execute anything in Suggest mode on a Bypass cluster (breaker-tripped run) and records RiskyWrite as requiring approval — the plan needs a click", async () => {
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
    /*
     * Honest to the human: this plan WILL need their click. The cluster's
     * bypass would have run it unattended — but this round did not, so
     * "auto-approved" would describe a run that never happens.
     */
    expect(plan!.commands[0]!.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(plan!.commands[0]!.wasAutoExecuted).toBeFalsy();
    expect(persistedPlans).toHaveLength(0);
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
    // A safe change on a plan awaiting approval still needs the click.
    expect(restart.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
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

describe("RemediationCommandToolkit Suggest-mode kubectl verdicts are honest about the click", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    KubernetesAiRemediationMode.RequireApproval,
    KubernetesAiRemediationMode.Automatic,
    KubernetesAiRemediationMode.BypassApproval,
  ])(
    "records every kubectl command as RequiresApproval on a %s cluster, whatever its tier or allowlist",
    async (remediationMode: KubernetesAiRemediationMode) => {
      const toolkit: RemediationCommandToolkit = buildToolkit({
        mode: "Suggest",
        clusterTargets: [
          cluster({
            remediationMode,
            kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
          }),
        ],
      });

      const outcome: ToolCallOutcome = await getTool(
        toolkit,
        "propose_remediation_commands",
      ).execute({
        commands: [
          // Read, SafeWrite, and an allowlisted RiskyWrite.
          kubectlArgs({
            command: "kubectl get pods -n web",
            rollbackCommand: undefined,
          }),
          kubectlArgs(),
          kubectlArgs({
            command: "kubectl set image deployment/web web=nginx:1.27 -n web",
            rollbackCommand: undefined,
          }),
        ],
      });

      expect(outcome.success).toBe(true);
      expect(enqueueKubectl).not.toHaveBeenCalled();

      const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
      expect(plan?.commands).toHaveLength(3);
      expect(
        plan!.commands.map((command: AiRemediationCommand) => {
          return command.kubectlTier;
        }),
      ).toEqual([
        KubectlCommandTier.Read,
        KubectlCommandTier.SafeWrite,
        KubectlCommandTier.RiskyWrite,
      ]);
      for (const command of plan!.commands) {
        expect(command.policyVerdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
        expect(command.wasAutoExecuted).toBeFalsy();
      }
    },
  );

  it("still refuses Denied commands in Suggest mode on a Bypass cluster with a permissive allowlist", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
          kubectlAllowlist: ["*"],
        }),
      ],
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        kubectlArgs(),
        kubectlArgs({
          command: "kubectl delete namespace web",
          rollbackCommand: undefined,
        }),
      ],
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Command 2");
    expect(outcome.textForLlm).toContain(
      "Denied by the kubectl command policy",
    );
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("keeps the RiskyWrite rollback rule at planning time: only a Bypass cluster may propose one", async () => {
    const riskyRollback: JSONObject = kubectlArgs({
      command: "kubectl set image deployment/web web=nginx:1.27 -n web",
      rollbackCommand: "kubectl set image deployment/web web=nginx:1.26 -n web",
    });

    const refused: ToolCallOutcome = await getTool(
      buildToolkit({
        mode: "Suggest",
        clusterTargets: [
          cluster({ remediationMode: KubernetesAiRemediationMode.Automatic }),
        ],
      }),
      "propose_remediation_commands",
    ).execute({ commands: [riskyRollback] });
    expect(refused.success).toBe(false);
    expect(refused.textForLlm).toContain("rollbacks run unattended");

    const bypassToolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });
    const accepted: ToolCallOutcome = await getTool(
      bypassToolkit,
      "propose_remediation_commands",
    ).execute({ commands: [riskyRollback] });
    expect(accepted.success).toBe(true);
    expect(bypassToolkit.getProposedPlan()!.commands[0]!.rollbackCommand).toBe(
      "kubectl set image deployment/web web=nginx:1.26 -n web",
    );
  });
});

describe("RemediationCommandToolkit kubectl execution persists the job id before waiting", () => {
  beforeEach(mockHappyPath);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function commandsOf(plan: JSONObject): Array<AiRemediationCommand> {
    return plan["commands"] as unknown as Array<AiRemediationCommand>;
  }

  it("records runnerJobId on the Pending command BEFORE polling the job, and never goes through KubectlJobRunner.run", async () => {
    const runSpy: jest.SpyInstance = jest.spyOn(KubectlJobRunner, "run");
    const persist: jest.SpyInstance =
      AutoRemediationSuggestionService.updateOneById as unknown as jest.SpyInstance;
    const poll: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "pollUntilTerminal",
    );

    let plansWhenPollStarted: number = -1;
    let recordAtPollStart: AiRemediationCommand | undefined = undefined;
    poll.mockImplementation(async (): Promise<RunnerJob> => {
      plansWhenPollStarted = persistedPlans.length;
      recordAtPollStart = commandsOf(
        persistedPlans[persistedPlans.length - 1]!,
      )[0];
      return fakeJob();
    });

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("SUCCEEDED");
    expect(runSpy).not.toHaveBeenCalled();

    /*
     * Three persists: the audit record before the enqueue (no job id yet —
     * there is none), the job id right after the enqueue and BEFORE the
     * wait, and the outcome afterwards.
     */
    expect(persistedPlans).toHaveLength(3);
    expect(commandsOf(persistedPlans[0]!)[0]!.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Pending,
      }),
    );
    expect(
      commandsOf(persistedPlans[0]!)[0]!.execution?.runnerJobId,
    ).toBeUndefined();

    expect(plansWhenPollStarted).toBe(2);
    expect(recordAtPollStart!.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Pending,
        runnerJobId: JOB_ID.toString(),
      }),
    );

    // Strict order: persist(audit) < enqueue < persist(job id) < poll < persist(outcome).
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueKubectl.mock.invocationCallOrder[0]!,
    );
    expect(enqueueKubectl.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[1]!,
    );
    expect(persist.mock.invocationCallOrder[1]).toBeLessThan(
      poll.mock.invocationCallOrder[0]!,
    );
    expect(poll.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[2]!,
    );

    expect(commandsOf(persistedPlans[2]!)[0]!.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Succeeded,
        runnerJobId: JOB_ID.toString(),
        exitCode: 0,
      }),
    );
  });

  it("enqueues with the shared kubectl claim timeout and the inline step id, and records the outcome on the cluster", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(true);
    const enqueueArgs: Record<string, unknown> = enqueueKubectl.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueueArgs["claimTimeoutInMs"]).toBe(KUBECTL_CLAIM_TIMEOUT_MS);
    expect(enqueueArgs["stepId"]).toBe(`${INLINE_COMMAND_STEP_ID_PREFIX}1`);
    expect((enqueueArgs["aiRunId"] as ObjectID).toString()).toBe(
      RUN_ID.toString(),
    );

    const pollArgs: Record<string, unknown> = (
      RunnerJobService.pollUntilTerminal as unknown as jest.SpyInstance
    ).mock.calls[0]![0] as Record<string, unknown>;
    expect(pollArgs["claimTimeoutInMs"]).toBe(KUBECTL_CLAIM_TIMEOUT_MS);

    expect(
      KubernetesClusterAiAccessService.recordCommandOutcome,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: true, errorMessage: undefined }),
    );
    expect(
      (
        (
          KubernetesClusterAiAccessService.recordCommandOutcome as unknown as jest.SpyInstance
        ).mock.calls[0]![0] as { clusterId: ObjectID }
      ).clusterId.toString(),
    ).toBe(CLUSTER_ID.toString());
  });

  it("keeps the job id on a command whose wait throws and records it Failed", async () => {
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockRejectedValue(new Error("RunnerJob disappeared while waiting."));

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    // The tool call itself resolves: the model is told the command failed.
    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED before completion");

    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    expect(executed.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Failed,
        runnerJobId: JOB_ID.toString(),
        errorMessage: "RunnerJob disappeared while waiting.",
      }),
    );
    const last: AiRemediationCommand = commandsOf(
      persistedPlans[persistedPlans.length - 1]!,
    )[0]!;
    expect(last.execution?.runnerJobId).toBe(JOB_ID.toString());
    expect(last.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Failed,
    );
  });

  it("reports a failed kubectl job with its error and records the failure on the cluster", async () => {
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "",
        errorMessage: "deployments.apps is forbidden",
      }),
    );

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED (exit code: 1");
    expect(outcome.textForLlm).toContain("deployments.apps is forbidden");
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_cluster_output">',
    );
    expect(toolkit.getExecutedCommands()[0]!.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Failed,
        exitCode: 1,
        errorMessage: "deployments.apps is forbidden",
        runnerJobId: JOB_ID.toString(),
      }),
    );
    expect(
      KubernetesClusterAiAccessService.recordCommandOutcome,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        succeeded: false,
        errorMessage: "deployments.apps is forbidden",
      }),
    );
  });

  it("caps and redacts kubectl output at the shared kubectl limit, through the shared chain", async () => {
    // Ordinary `kubectl get pods` rows: nothing here reads as base64.
    const row: string =
      "web-7c9d4f8b6-abcde   1/1     Running   0          5m\n";
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        output: `token: Bearer abcdefghijklmnopqrstuvwxyz\n${row.repeat(
          Math.ceil((MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM + 500) / row.length),
        )}`,
      }),
    );
    const shared: jest.SpyInstance = jest.spyOn(
      KubectlJobRunner,
      "redactAndCap",
    );

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(shared).toHaveBeenCalled();
    const stored: string = toolkit.getExecutedCommands()[0]!.execution!
      .output as string;
    expect(stored.endsWith(KUBECTL_OUTPUT_TRUNCATED_SUFFIX)).toBe(true);
    expect(stored.length).toBeLessThanOrEqual(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM + KUBECTL_OUTPUT_TRUNCATED_SUFFIX.length,
    );
    expect(stored).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stored).toContain("web-7c9d4f8b6-abcde");
    expect(outcome.textForLlm).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("masks Secret data and credential-looking error text before storing or showing it — the structural kubectl redaction, not only the generic one", async () => {
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output:
          "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\ndata:\n  password: cGFzc3dvcmQxMjM=\n",
        errorMessage: "error: unable to use password=hunter2-for-db here",
      }),
    );

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs());

    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    // Stored on the plan (the card shows it): values masked, keys kept.
    expect(executed.execution?.output).not.toContain("cGFzc3dvcmQxMjM=");
    expect(executed.execution?.output).toContain("password:");
    expect(executed.execution?.errorMessage).not.toContain("hunter2-for-db");
    expect(executed.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Failed,
    );

    // Shown to the model.
    expect(outcome.textForLlm).not.toContain("cGFzc3dvcmQxMjM=");
    expect(outcome.textForLlm).not.toContain("hunter2-for-db");

    // Recorded on the cluster's AI page.
    expect(
      (
        (
          KubernetesClusterAiAccessService.recordCommandOutcome as unknown as jest.SpyInstance
        ).mock.calls[0]![0] as { errorMessage?: string }
      ).errorMessage,
    ).not.toContain("hunter2-for-db");
  });
});

describe("RemediationCommandToolkit Bash-lane output goes through the shared kubectl redaction chain", () => {
  const HOST_RUNNER_ID: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );
  const SECRET_YAML: string =
    "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\n  namespace: web\ndata:\n  password: cGFzc3dvcmQxMjM=\n  username: YWRtaW4=\n";

  beforeEach(() => {
    mockHappyPath();
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      id: HOST_RUNNER_ID,
      _id: HOST_RUNNER_ID.toString(),
      name: "ops-bastion",
      description: "bastion host with kubectl",
    } as unknown as Runner);
    enqueueBash.mockResolvedValue(fakeJob());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function bashKubectlArgs(): JSONObject {
    return {
      runnerId: HOST_RUNNER_ID.toString(),
      stepType: "Bash",
      command: "kubectl get secret db -n web -o yaml",
      rationale: "check the db credentials the pods mount",
      expectedEffect: "the Secret is printed",
    } as JSONObject;
  }

  function bashToolkit(): RemediationCommandToolkit {
    return buildToolkit({
      allowlistPatterns: ["kubectl get *"],
      allowedRunnerIds: [HOST_RUNNER_ID.toString()],
      clusterTargets: [],
    });
  }

  it("masks a Secret data block a Bash step printed before persisting it on the suggestion and before the model sees it", async () => {
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob({ output: SECRET_YAML }));
    const shared: jest.SpyInstance = jest.spyOn(
      KubectlJobRunner,
      "redactAndCap",
    );

    const toolkit: RemediationCommandToolkit = bashToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashKubectlArgs());

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(enqueueBash).toHaveBeenCalledTimes(1);
    expect(shared).toHaveBeenCalledWith(SECRET_YAML, expect.any(Number));

    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    expect(executed.stepType).toBe(RunbookStepType.Bash);
    expect(executed.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Succeeded,
    );

    // Persisted on the plan (the card shows it): values masked, keys kept.
    const stored: string = executed.execution!.output as string;
    expect(stored).not.toContain("cGFzc3dvcmQxMjM=");
    expect(stored).not.toContain("YWRtaW4=");
    expect(stored).toContain("password:");
    expect(stored).toContain("username:");
    expect(stored).toContain("kind: Secret");

    // The last persisted plan carries the masked output, not the raw one.
    const lastPersisted: AiRemediationCommand = (
      persistedPlans[persistedPlans.length - 1]![
        "commands"
      ] as unknown as Array<AiRemediationCommand>
    )[0]!;
    expect(lastPersisted.execution?.output).toBe(stored);
    expect(JSON.stringify(persistedPlans)).not.toContain("cGFzc3dvcmQxMjM=");

    // Shown to the model, and the evidence trail says something was masked.
    expect(outcome.textForLlm).not.toContain("cGFzc3dvcmQxMjM=");
    expect(outcome.textForLlm).toContain("password:");
    expect(outcome.result?.redactionCount).toBeGreaterThan(0);
    expect(outcome.result?.isTruncated).toBe(false);
  });

  it("reports the kubectl lane's own redaction count on the tool result instead of zero", async () => {
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob({ output: SECRET_YAML }));

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(kubectlArgs());

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(outcome.textForLlm).not.toContain("cGFzc3dvcmQxMjM=");
    expect(outcome.result?.redactionCount).toBeGreaterThan(0);
  });

  it("leaves ordinary Bash output alone and reports no redaction", async () => {
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(
        fakeJob({ output: "NAME   READY   STATUS\nweb-1  1/1     Running\n" }),
      );

    const toolkit: RemediationCommandToolkit = bashToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashKubectlArgs());

    expect(outcome.success).toBe(true);
    expect(toolkit.getExecutedCommands()[0]!.execution?.output).toContain(
      "web-1  1/1     Running",
    );
    expect(outcome.result?.redactionCount).toBe(0);
    expect(outcome.result?.isTruncated).toBe(false);
  });
});
