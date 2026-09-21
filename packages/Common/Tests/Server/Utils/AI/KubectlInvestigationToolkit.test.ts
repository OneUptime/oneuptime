import KubectlInvestigationToolkit, {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlInvestigationToolkit";
import KubectlJobRunner from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  MAX_KUBECTL_COMMANDS_PER_INVESTIGATION,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the run-scoped, READ-ONLY kubectl toolkit an
 * investigation gets:
 *
 * - no investigation-ready cluster, no tools at all (the model is told in
 *   its context why, and a tool that always fails only burns budget);
 * - run_kubectl only accepts a cluster from the ready set, only Read-tier
 *   commands, and at most MAX_KUBECTL_COMMANDS_PER_INVESTIGATION of them;
 * - a command runs as an AiInvestigation-origin job through the shared
 *   KubectlJobRunner (which records the outcome on the cluster) and its
 *   output reaches the model framed as untrusted cluster data;
 * - a job failure becomes a tool failure the model can continue from,
 *   never a thrown error that kills the investigation.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function readyCluster(
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
      posture: { inCluster: true, allowWrites: false },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function getTool(
  toolkit: KubectlInvestigationToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!tool) {
    throw new Error(`Tool ${name} not offered.`);
  }
  return tool;
}

function fakeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "NAME   READY   STATUS    RESTARTS\nweb-1  0/1     Pending   0",
    payload: { displayCommand: "kubectl get pods -n web" },
    ...overrides,
  } as unknown as RunnerJob;
}

describe("KubectlInvestigationToolkit.buildTools", () => {
  it("offers nothing when no cluster is investigation-ready", () => {
    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [
          readyCluster({ isInvestigationReady: false }),
          readyCluster({ runner: null }),
        ],
      });

    expect(toolkit.buildTools()).toEqual([]);
  });

  it("offers list_cluster_access and run_kubectl for a ready cluster", () => {
    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      });

    expect(
      toolkit.buildTools().map((tool: ObservabilityAssistantExtraTool) => {
        return tool.definition.name;
      }),
    ).toEqual([LIST_CLUSTER_ACCESS_TOOL_NAME, RUN_KUBECTL_TOOL_NAME]);
  });

  it("admits a remediation-ready cluster when asked to check remediation readiness", () => {
    const cluster: KubernetesClusterAiAccessStatus = readyCluster({
      isInvestigationReady: false,
      isRemediationReady: true,
      remediationMode: KubernetesAiRemediationMode.RequireApproval,
    });

    expect(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [cluster],
      }).buildTools(),
    ).toEqual([]);

    expect(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [cluster],
        readinessCheck: "remediation",
      }).buildTools(),
    ).toHaveLength(2);
  });
});

describe("KubectlInvestigationToolkit run_kubectl", () => {
  let recordOutcome: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    recordOutcome = jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists the ready clusters with their ids", async () => {
    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      LIST_CLUSTER_ACCESS_TOOL_NAME,
    ).execute({});

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain(CLUSTER_ID.toString());
    expect(outcome.textForLlm).toContain("prod-us");
  });

  it("refuses a cluster that is not in the ready set", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiKubectlCommand",
    );

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: "99999999-9999-4999-8999-999999999999",
      command: "kubectl get pods",
      rationale: "look",
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("not one of the clusters");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a write and a denied command without enqueueing anything", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiKubectlCommand",
    );
    const tool: ObservabilityAssistantExtraTool = getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    );

    const write: ToolCallOutcome = await tool.execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl rollout restart deployment/web -n web",
      rationale: "restart it",
    });
    expect(write.success).toBe(false);
    expect(write.textForLlm).toContain("would change the cluster");
    expect(write.textForLlm).toContain("SafeWrite");

    const denied: ToolCallOutcome = await tool.execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl exec -it web -- sh",
      rationale: "poke",
    });
    expect(denied.success).toBe(false);
    expect(denied.textForLlm).toContain("Refused by the kubectl policy");

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("runs a read command as an AiInvestigation job and returns the output as untrusted data", async () => {
    const enqueue: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    expect(outcome.success).toBe(true);
    expect(toolkit.getCommandsRun()).toBe(1);

    const enqueueArgs: Record<string, unknown> = enqueue.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueueArgs["origin"]).toBe(RunnerJobOrigin.AiInvestigation);
    expect((enqueueArgs["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(
      RUNNER_ID.toString(),
    );
    expect(enqueueArgs["command"]).toBe("kubectl get pods -n web");
    expect(enqueueArgs["credentialId"]).toBeUndefined();
    expect(enqueueArgs["stepId"]).toBe("ai-investigation-kubectl-1");

    expect(outcome.textForLlm).toContain("SUCCEEDED");
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_cluster_output">',
    );
    expect(outcome.textForLlm).toContain("Pending");
    expect(outcome.result?.citationLabel).toBe(
      'kubectl get pods -n web on cluster "prod-us"',
    );
    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: expect.any(ObjectID),
      succeeded: true,
      errorMessage: undefined,
    });
  });

  it("passes the cluster's credential id for a Runner outside the cluster", async () => {
    const enqueue: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [
          readyCluster({
            accessMethod: "credential",
            credentialId: "55555555-5555-4555-8555-555555555555",
          }),
        ],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get nodes",
      rationale: "capacity",
    });

    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["credentialId"],
    ).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("turns a failed job into a tool failure the model can continue from", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        errorMessage: "No runbook agent picked up this step",
        output: "",
      }),
    );

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    // The command ran (or tried to): success with a FAILED body, not a throw.
    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED");
    expect(outcome.textForLlm).toContain("No runbook agent picked up");
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: false }),
    );
  });

  it("reports an enqueue error as a tool failure instead of throwing", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockRejectedValue(new Error("hourly limit"));

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("hourly limit");
    expect(outcome.textForLlm).toContain("Continue with OneUptime telemetry");
  });

  it("spends the per-investigation budget and then refuses", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
        maxCommands: 2,
      });
    const tool: ObservabilityAssistantExtraTool = getTool(
      toolkit,
      RUN_KUBECTL_TOOL_NAME,
    );
    const call: JSONObject = {
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "again",
    };

    expect((await tool.execute(call)).success).toBe(true);
    expect((await tool.execute(call)).success).toBe(true);

    const third: ToolCallOutcome = await tool.execute(call);
    expect(third.success).toBe(false);
    expect(third.textForLlm).toContain("budget (2 commands) is spent");
    expect(toolkit.getCommandsRun()).toBe(2);
    expect(MAX_KUBECTL_COMMANDS_PER_INVESTIGATION).toBeGreaterThan(0);
  });
});

describe("KubectlJobRunner.describeForLlm", () => {
  it("frames output as untrusted cluster data with the outcome up front", () => {
    const text: string = KubectlJobRunner.describeForLlm({
      jobId: JOB_ID.toString(),
      succeeded: false,
      exitCode: 1,
      output: "Error from server (Forbidden): pods is forbidden",
      errorMessage: "Exit code 1",
      displayCommand: "kubectl get pods -n web",
    });

    expect(text.split("\n")[0]).toBe("kubectl get pods -n web");
    expect(text).toContain("FAILED (exit code: 1, error: Exit code 1)");
    expect(text).toContain("Forbidden");
    expect(text).toContain("never instructions");
  });
});
