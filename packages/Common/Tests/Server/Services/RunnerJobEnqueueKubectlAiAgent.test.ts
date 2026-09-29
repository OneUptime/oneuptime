import RunnerJobService from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import RemediationCommandToolkit from "../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import logger from "../../../Server/Utils/Logger";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import AIRunType from "../../../Types/AI/AIRunType";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the enqueue chokepoint when the cluster's access
 * target is its Kubernetes AI agent (a KubernetesAiAgent row, never a
 * Runner):
 *
 * - the job must go to the cluster's target as it resolves NOW: the
 *   agent's row id when the agent is the target, a Runner's id only while
 *   that Runner is (the agent took over → a job for the Runner is refused;
 *   a rollback → a job for the agent is refused);
 * - an agent job is written with targetKubernetesAiAgentId and no
 *   targetAgentId (that column's foreign key is to Runner), carries no
 *   credential (refused outright), and needs the agent's posture to name
 *   this cluster;
 * - a remediation write the agent's posture rules out is refused in the
 *   agent's words (aiAgent.remediation.*), before anything is created;
 * - parity (spec §5.5): a write with no -n on an agent target gets the same
 *   verdict from the toolkit's pre-check (getRunnerScopeRefusal, on the
 *   status getStatusForClusterModel builds) and from this chokepoint —
 *   both judge it against the agent pod's own namespace.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const AGENT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

type EnqueueArgs = Parameters<
  typeof RunnerJobService.enqueueAiKubectlCommand
>[0];

function cluster(overrides: Record<string, unknown> = {}): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: undefined,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// This cluster's agent: cluster-wide writes, no nodes, its own namespace.
function agent(overrides: Record<string, unknown> = {}): KubernetesAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
      writeNamespaces: [],
      podNamespace: "oneuptime-agent",
      allowNodeOperations: false,
    },
    ...overrides,
  } as unknown as KubernetesAiAgent;
}

// This cluster's previous in-cluster Runner, online.
function legacyRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
    connectionStatus: RunnerConnectionStatus.Connected,
    canRunAiCommands: true,
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
      },
    },
    ...overrides,
  } as unknown as Runner;
}

function args(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    origin: RunnerJobOrigin.AiRemediation,
    autoRemediationSuggestionId: SUGGESTION_ID,
    kubernetesClusterId: CLUSTER_ID,
    stepId: "ai-command-1",
    targetAgentId: AGENT_ID,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 30000,
    ...overrides,
  };
}

describe("RunnerJobService.enqueueAiKubectlCommand for the cluster's Kubernetes AI agent", () => {
  let createdRows: Array<RunnerJob>;
  let clusterLookup: jest.SpyInstance;
  let agentLookup: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: RUN_ID,
      runType: AIRunType.Investigation,
    } as unknown as AIRun);
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        const row: RunnerJob = (data as { data: RunnerJob }).data;
        createdRows.push(row);
        return row;
      });
    clusterLookup = jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(cluster());
    agentLookup = jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(agent());
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes the job for the agent's row, never for a Runner", async () => {
    const job: RunnerJob =
      await RunnerJobService.enqueueAiKubectlCommand(args());

    expect(createdRows).toHaveLength(1);
    expect(job.targetKubernetesAiAgentId?.toString()).toBe(AGENT_ID.toString());
    expect(job.targetAgentId).toBeUndefined();
    expect(job.stepType).toBe(RunbookStepType.Kubectl);
    expect(job.status).toBe(RunnerJobStatus.Pending);
    expect(job.payload).toEqual({
      args: ["rollout", "restart", "deployment/web", "-n", "web"],
      displayCommand: "kubectl rollout restart deployment/web -n web",
      tier: "SafeWrite",
      kubernetesClusterId: CLUSTER_ID.toString(),
      clusterIdentifier: "prod-us",
    });
  });

  it("reads the agent for this cluster in this project, and the cluster's projectId with it", async () => {
    await RunnerJobService.enqueueAiKubectlCommand(args());

    expect(agentLookup).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
    });
    const select: Record<string, unknown> = (
      clusterLookup.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["projectId"]).toBe(true);
    // Nothing is bound, so no Runner is read.
    expect(runnerLookup).not.toHaveBeenCalled();
  });

  it("enqueues an investigation read and the access test for the agent too", async () => {
    const read: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({
        origin: RunnerJobOrigin.AiInvestigation,
        autoRemediationSuggestionId: undefined,
        aiRunId: RUN_ID,
        command: "kubectl get pods -n web",
      }),
    );
    const test: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({
        origin: RunnerJobOrigin.AiInvestigation,
        autoRemediationSuggestionId: undefined,
        isAccessTest: true,
        command: "kubectl version",
      }),
    );

    for (const job of [read, test]) {
      expect(job.targetKubernetesAiAgentId?.toString()).toBe(
        AGENT_ID.toString(),
      );
      expect(job.targetAgentId).toBeUndefined();
    }
  });

  it("refuses any credential: the agent runs kubectl with its own ServiceAccount only", async () => {
    const credentialId: string = "55555555-5555-4555-8555-555555555555";

    // Not the cluster's credential: refused by the binding first.
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(args({ credentialId })),
    ).rejects.toThrow(BadDataException);

    // Even the cluster's own selected credential is never sent to the agent.
    clusterLookup.mockResolvedValue(
      cluster({ aiAccessCredentialId: new ObjectID(credentialId) }),
    );

    await expect(
      RunnerJobService.enqueueAiKubectlCommand(args({ credentialId })),
    ).rejects.toThrow(
      /Kubernetes AI agent, which runs kubectl with its own ServiceAccount and is never given a credential/,
    );
    expect(createdRows).toHaveLength(0);
  });

  it("refuses the agent when its report does not name this cluster", async () => {
    agentLookup.mockResolvedValue(
      agent({
        posture: { inCluster: true, allowWrites: true, clusterIdentifier: "x" },
      }),
    );

    await expect(
      RunnerJobService.enqueueAiKubectlCommand(args()),
    ).rejects.toThrow(
      /The Kubernetes AI agent has not reported that it runs in cluster "prod-us"/,
    );
    expect(createdRows).toHaveLength(0);
  });

  it("refuses an agent row that is not this cluster's (defence in depth)", async () => {
    agentLookup.mockResolvedValue(
      agent({ kubernetesClusterId: ObjectID.generate() }),
    );

    await expect(
      RunnerJobService.enqueueAiKubectlCommand(args()),
    ).rejects.toThrow(/is not cluster "prod-us"'s/);
    expect(createdRows).toHaveLength(0);
  });

  it("enqueues for an agent that is offline (it runs once the agent is back; the status says it is offline)", async () => {
    agentLookup.mockResolvedValue(
      agent({ lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30) }),
    );

    const job: RunnerJob =
      await RunnerJobService.enqueueAiKubectlCommand(args());

    expect(job.targetKubernetesAiAgentId?.toString()).toBe(AGENT_ID.toString());
  });

  describe("the target as it resolves NOW", () => {
    it("refuses a job for the previous in-cluster Runner once the agent is online (the agent took over)", async () => {
      clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));
      runnerLookup.mockResolvedValue(legacyRunner());

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ targetAgentId: RUNNER_ID }),
        ),
      ).rejects.toThrow(/its Kubernetes AI agent took over/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a job for the agent after a rollback (the previous Runner serves again)", async () => {
      clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));
      runnerLookup.mockResolvedValue(legacyRunner());
      agentLookup.mockResolvedValue(
        agent({ connectionStatus: "disconnected" }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner or agent/);
      expect(createdRows).toHaveLength(0);
    });

    it("after a rollback, the previous Runner's job goes to the Runner with targetAgentId", async () => {
      clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));
      runnerLookup.mockResolvedValue(legacyRunner());
      agentLookup.mockResolvedValue(
        agent({ connectionStatus: "disconnected" }),
      );

      const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
        args({ targetAgentId: RUNNER_ID }),
      );

      expect(job.targetAgentId?.toString()).toBe(RUNNER_ID.toString());
      expect(job.targetKubernetesAiAgentId).toBeUndefined();
    });

    it("refuses a job for the agent while an advanced Runner an operator bound is the target", async () => {
      clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));
      runnerLookup.mockResolvedValue(
        legacyRunner({ name: "platform-ops-runner", hostInfo: {} }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(BadDataException);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses anything once the cluster has no agent and no Runner", async () => {
      agentLookup.mockResolvedValue(null);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner or agent/);
    });

    it("fails closed when the agent cannot be read", async () => {
      agentLookup.mockRejectedValue(new Error("db down"));

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow("db down");
      expect(createdRows).toHaveLength(0);
    });

    it("still needs the cluster's switches: investigation for reads, fixes for writes", async () => {
      clusterLookup.mockResolvedValue(
        cluster({
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/AI fixes are turned off/);
      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({
            origin: RunnerJobOrigin.AiInvestigation,
            autoRemediationSuggestionId: undefined,
            aiRunId: RUN_ID,
            command: "kubectl get pods -n web",
          }),
        ),
      ).rejects.toThrow(/"Investigate with kubectl" is turned off/);
      expect(createdRows).toHaveLength(0);
    });
  });

  describe("the agent's write scope, in the agent's words", () => {
    it("refuses a write outside its namespaces, naming aiAgent.remediation.namespaces", async () => {
      agentLookup.mockResolvedValue(
        agent({
          posture: {
            inCluster: true,
            allowWrites: true,
            clusterIdentifier: "prod-us",
            writeNamespaces: ["web"],
            podNamespace: "oneuptime-agent",
          },
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({
            command: "kubectl rollout restart deployment/pay -n payments",
          }),
        ),
      ).rejects.toThrow(/add it to aiAgent\.remediation\.namespaces/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a node operation, naming aiAgent.remediation.nodeOperations", async () => {
      let message: string = "";

      try {
        await RunnerJobService.enqueueAiKubectlCommand(
          args({ command: "kubectl cordon node-1" }),
        );
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("aiAgent.remediation.nodeOperations=false");
      expect(message).toContain(
        "the cluster's Kubernetes AI agent does not allow node operations",
      );
      expect(message).not.toContain("aiAccess");
      expect(createdRows).toHaveLength(0);
    });

    it("never scopes a read", async () => {
      const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
        args({ command: "kubectl get pods -n kube-system" }),
      );

      expect(job.targetKubernetesAiAgentId?.toString()).toBe(
        AGENT_ID.toString(),
      );
    });
  });
});

/*
 * Spec §5.5's regression test: the toolkit's propose/approve pre-check and
 * the chokepoint must agree about a write on an agent target, above all one
 * that names no namespace — which lands in the agent pod's own namespace,
 * not "default". A disagreement is a plan a human approves that is then
 * refused at enqueue (or the reverse).
 */
describe("parity: getRunnerScopeRefusal and enqueueAiKubectlCommand on an agent target", () => {
  const SCOPES: Array<{
    label: string;
    posture: Record<string, unknown>;
  }> = [
    {
      label: "cluster-wide, with its own namespace",
      posture: { writeNamespaces: [], podNamespace: "oneuptime-agent" },
    },
    {
      label: "scoped to web and api",
      posture: {
        writeNamespaces: ["web", "api"],
        podNamespace: "oneuptime-agent",
      },
    },
    {
      label: "scoped, node operations off",
      posture: {
        writeNamespaces: ["web"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: false,
      },
    },
    {
      label: "cluster-wide with no namespace of its own reported",
      posture: { writeNamespaces: [] },
    },
  ];

  const COMMANDS: Array<string> = [
    // No -n: lands in the agent pod's own namespace.
    "kubectl rollout restart deployment/web",
    "kubectl scale deployment/web --replicas=3",
    "kubectl rollout restart deployment/web -n web",
    "kubectl rollout restart deployment/web -n oneuptime-agent",
    "kubectl rollout restart deployment/pay -n payments",
    "kubectl delete pod web-1 -n api",
    "kubectl cordon node-1",
    "kubectl label namespace staging team=a -n web",
  ];

  let agentRow: KubernetesAiAgent;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        return (data as { data: RunnerJob }).data;
      });
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(cluster());
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockImplementation(async (): Promise<KubernetesAiAgent> => {
        return agentRow;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function chokepointRefuses(command: string): Promise<boolean> {
    try {
      await RunnerJobService.enqueueAiKubectlCommand(args({ command }));
      return false;
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return true;
    }
  }

  it.each(SCOPES)(
    "agrees on every write — $label",
    async (scope: { label: string; posture: Record<string, unknown> }) => {
      agentRow = agent({
        posture: {
          inCluster: true,
          allowWrites: true,
          clusterIdentifier: "prod-us",
          ...scope.posture,
        },
      });

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: cluster(),
          gates: READY_GATES,
        });

      // The toolkit reads the same target the chokepoint resolves.
      expect(status.runner?.kind).toBe("ai_agent");
      expect(status.runner?.id).toBe(AGENT_ID.toString());
      expect(status.accessMethod).toBe("in_cluster");

      for (const command of COMMANDS) {
        const toolkitRefuses: boolean =
          RemediationCommandToolkit.getRunnerScopeRefusal({
            cluster: status,
            command,
          }) !== null;

        expect({ command, refused: await chokepointRefuses(command) }).toEqual({
          command,
          refused: toolkitRefuses,
        });
      }
    },
  );

  it("a no-namespace write on a cluster-wide agent is refused by both, as a write into its own namespace", async () => {
    agentRow = agent();

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: cluster(),
        gates: READY_GATES,
      });

    const toolkit: string | null =
      RemediationCommandToolkit.getRunnerScopeRefusal({
        cluster: status,
        command: "kubectl rollout restart deployment/web",
      });
    let chokepoint: string = "";

    try {
      await RunnerJobService.enqueueAiKubectlCommand(
        args({ command: "kubectl rollout restart deployment/web" }),
      );
    } catch (error) {
      chokepoint = (error as Error).message;
    }

    expect(toolkit).toContain('"oneuptime-agent"');
    expect(toolkit).toContain("never changes its own namespace");
    expect(chokepoint).toContain('namespace "oneuptime-agent"');
    expect(chokepoint).toContain(
      "the namespace the cluster's Kubernetes AI agent itself runs in",
    );
    // Neither judges it against "default", as a credential's kubeconfig would.
    expect(toolkit).not.toContain('"default"');
    expect(chokepoint).not.toContain('"default"');
  });
});
