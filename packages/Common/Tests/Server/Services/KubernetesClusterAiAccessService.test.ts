import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
  RegisterKubernetesAgentRunnerResult,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  getKubernetesAgentRunnerName,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the readiness computation behind a cluster's AI
 * page and the in-cluster Runner's self-registration:
 *
 * - every reason OneUptime AI cannot reach or change a cluster becomes a
 *   gap with a next step, and readiness is derived ONLY from gaps: no
 *   Runner, an offline Runner, a Runner without the AI-commands capability,
 *   an external Runner without a Kubernetes credential, a read-only
 *   in-cluster Runner asked to remediate, and every project gate;
 * - investigation and remediation readiness are independent: a gap that
 *   only blocks remediation never reads as "AI cannot investigate";
 * - registration with the ingestion key creates the agent Runner row with
 *   exactly the kubectl capability (never runbooks or code fixes), binds a
 *   never-configured cluster with investigation on and remediation
 *   "ask for approval" when the chart granted writes, rotates the key on a
 *   restart WITHOUT touching the operator's switches, and never steals a
 *   cluster an operator bound to a different Runner.
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
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
};

function fakeCluster(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function fakeRunner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
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

function gapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map((gap: KubernetesAiAccessGap) => {
    return gap.code;
  });
}

describe("KubernetesClusterAiAccessService.getStatusForClusterModel", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is ready for both when an online in-cluster Runner with writes is bound and every gate passes", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(status.gaps).toEqual([]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(true);
    expect(status.accessMethod).toBe("in_cluster");
    expect(status.runner?.isOnline).toBe(true);
    expect(status.runner?.posture?.allowWrites).toBe(true);
    expect(status.kubectlAllowlist).toEqual([]);
  });

  it("reports no_runner_bound and blocks both when the cluster has no Runner", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(RunnerService, "findOneBy");

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessRunnerId: undefined }),
        gates: READY_GATES,
      });

    expect(findOneBy).not.toHaveBeenCalled();
    expect(gapCodes(status)).toEqual(["no_runner_bound"]);
    expect(status.gaps[0]?.blocks).toBe("both");
    expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
    expect(status.runner).toBeNull();
    expect(status.accessMethod).toBe("none");
  });

  it("reports runner_missing when the bound Runner was deleted", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["runner_missing"]);
    expect(status.isInvestigationReady).toBe(false);
  });

  it("reports runner_offline (never connected vs stale) and keeps the Runner summary", async () => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner({ lastAlive: undefined }));

    const never: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(never)).toEqual(["runner_offline"]);
    expect(never.gaps[0]?.title).toContain("never connected");
    expect(never.runner?.isOnline).toBe(false);

    jest.restoreAllMocks();
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(
        fakeRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
      );

    const stale: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(stale)).toEqual(["runner_offline"]);
    expect(stale.gaps[0]?.title).toBe("The Runner is offline");
    expect(stale.gaps[0]?.nextStep).toContain("component=ai-runner");
  });

  it("reports runner_ai_commands_disabled when the capability is off", async () => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner({ canRunAiCommands: false }));

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["runner_ai_commands_disabled"]);
    expect(status.runner?.canRunAiCommands).toBe(false);
  });

  it("requires a Kubernetes credential assigned to an external Runner", async () => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );

    const noCredential: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(noCredential)).toEqual(["credential_missing"]);
    expect(noCredential.accessMethod).toBe("none");

    // Credential exists but is not assigned to this Runner.
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
      id: CREDENTIAL_ID,
      _id: CREDENTIAL_ID.toString(),
      name: "prod kubeconfig",
      credentialType: "Kubernetes",
      runners: [],
    } as unknown as RunbookCredential);

    const unassigned: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
        gates: READY_GATES,
      });

    expect(gapCodes(unassigned)).toEqual(["credential_missing"]);
    expect(unassigned.gaps[0]?.description).toContain("not assigned");

    // Assigned Kubernetes credential: ready, and the id travels on the status.
    jest.restoreAllMocks();
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
      id: CREDENTIAL_ID,
      _id: CREDENTIAL_ID.toString(),
      name: "prod kubeconfig",
      credentialType: "Kubernetes",
      runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
    } as unknown as RunbookCredential);

    const assigned: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
        gates: READY_GATES,
      });

    expect(assigned.gaps).toEqual([]);
    expect(assigned.accessMethod).toBe("credential");
    expect(assigned.credentialId).toBe(CREDENTIAL_ID.toString());
    expect(assigned.credentialName).toBe("prod kubeconfig");
  });

  it("blocks only remediation when the in-cluster Runner is read-only", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: { kubernetes: { inCluster: true, allowWrites: false } },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_write_access_missing"]);
    expect(status.gaps[0]?.blocks).toBe("remediation");
    expect(status.gaps[0]?.nextStep).toContain(
      "aiAccess.remediation.enabled=true",
    );
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("does not raise the read-only gap when remediation is off", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: { kubernetes: { inCluster: true, allowWrites: false } },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_disabled"]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("keeps remediation ready when only investigation is switched off", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ isAiInvestigationEnabled: false }),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["investigation_disabled"]);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(true);
  });

  it("turns every failed project gate into its own gap", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: {
          isAiEnabled: false,
          isAutoRemediationEnabled: false,
          isAiCommandExecutionEnabled: false,
          hasLlmProvider: false,
        },
      });

    expect(gapCodes(status)).toEqual([
      "project_ai_disabled",
      "llm_provider_missing",
      "project_auto_remediation_disabled",
      "project_ai_command_execution_disabled",
    ]);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
  });

  it("normalizes a JSON-string allowlist and an unknown mode fails closed to Disabled", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: "Yolo",
          aiKubectlCommandAllowlist: '["kubectl set image *", "  "]',
        }),
        gates: READY_GATES,
      });

    expect(status.remediationMode).toBe(KubernetesAiRemediationMode.Disabled);
    expect(status.kubectlAllowlist).toEqual(["kubectl set image *"]);
  });
});

describe("KubernetesClusterAiAccessService.getProjectGates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads kill switches as enabled-by-default and command execution as opt-in", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: undefined,
      enableAutoRemediation: undefined,
      enableAiCommandExecution: undefined,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as LlmProvider);

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates).toEqual({
      isAiEnabled: true,
      isAutoRemediationEnabled: true,
      isAiCommandExecutionEnabled: false,
      hasLlmProvider: true,
    });
  });

  it("treats a provider lookup failure as no provider", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAiCommandExecution: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockRejectedValue(new Error("boom"));

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates.hasLlmProvider).toBe(false);
    expect(gates.isAiCommandExecutionEnabled).toBe(true);
  });
});

describe("KubernetesClusterAiAccessService.registerKubernetesAgentRunner", () => {
  let clusterUpdates: Array<Record<string, unknown>>;
  let runnerUpdates: Array<Record<string, unknown>>;
  let createdRunner: Runner | null;

  beforeEach(() => {
    clusterUpdates = [];
    runnerUpdates = [];
    createdRunner = null;

    jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
    jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        clusterUpdates.push((args as { data: Record<string, unknown> }).data);
        return undefined as never;
      });
    jest
      .spyOn(RunnerService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        runnerUpdates.push((args as { data: Record<string, unknown> }).data);
        return undefined as never;
      });
    jest
      .spyOn(RunnerService, "create")
      .mockImplementation(async (args: unknown): Promise<Runner> => {
        const data: Runner = (args as { data: Runner }).data;
        data.id = RUNNER_ID;
        createdRunner = data;
        return data;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects an empty cluster name", async () => {
    await expect(
      KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "   ",
        posture: { allowWrites: true },
      }),
    ).rejects.toThrow("clusterName is required.");
  });

  it("first bind: creates a kubectl-only Runner, binds the cluster, turns investigation on and remediation to ask-for-approval", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        agentVersion: "9.1.0",
        posture: { allowWrites: true, kubectlVersion: "v1.31.4" },
      });

    expect(result.isFirstBind).toBe(true);
    expect(result.isBoundToCluster).toBe(true);
    expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
    expect(result.runnerKey).toHaveLength(36);

    expect(createdRunner).not.toBeNull();
    expect(createdRunner!.name).toBe(getKubernetesAgentRunnerName("prod-us"));
    expect(createdRunner!.canRunAiCommands).toBe(true);
    expect(createdRunner!.canRunRunbooks).toBe(false);
    expect(createdRunner!.canRunCodeFixTasks).toBe(false);
    expect(createdRunner!.key).toBe(result.runnerKey);
    expect(
      (createdRunner!.hostInfo as { kubernetes: Record<string, unknown> })
        .kubernetes,
    ).toMatchObject({
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
      kubectlVersion: "v1.31.4",
    });

    expect(clusterUpdates).toHaveLength(1);
    expect(clusterUpdates[0]).toMatchObject({
      aiAccessRunnerId: RUNNER_ID,
      aiAccessCredentialId: null,
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
  });

  it("first bind without write RBAC leaves remediation Disabled", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
      projectId: PROJECT_ID,
      clusterIdentifier: "prod-us",
      posture: { allowWrites: false },
    });

    expect(clusterUpdates[0]).toMatchObject({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });
  });

  it("re-registration rotates the key and posture but never touches the operator's switches", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
    // The bound Runner is ours (in-cluster posture).
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: false },
      });

    expect(result.isFirstBind).toBe(false);
    expect(result.isBoundToCluster).toBe(true);
    expect(createdRunner).toBeNull();
    expect(runnerUpdates).toHaveLength(1);
    expect(runnerUpdates[0]!["key"]).toBe(result.runnerKey);
    expect(
      (
        runnerUpdates[0]!["hostInfo"] as {
          kubernetes: { allowWrites: boolean };
        }
      ).kubernetes.allowWrites,
    ).toBe(false);
    // No cluster write at all: the dashboard is the control plane.
    expect(clusterUpdates).toHaveLength(0);
  });

  it("does not steal a cluster an operator bound to a different Runner", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));

    const OTHER_RUNNER_ID: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );

    jest
      .spyOn(RunnerService, "findOneBy")
      .mockImplementation(async (args: unknown): Promise<Runner | null> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        // The bound Runner: an operator's external Runner, no posture.
        if (query["_id"] === RUNNER_ID.toString()) {
          return fakeRunner({ name: "office-runner", hostInfo: {} });
        }
        // The agent Runner row for this cluster, previously registered.
        return fakeRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
        });
      });

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isBoundToCluster).toBe(false);
    expect(result.runnerId.toString()).toBe(OTHER_RUNNER_ID.toString());
    expect(clusterUpdates).toHaveLength(0);
    expect(runnerUpdates).toHaveLength(1);
  });

  it("takes over when the bound Runner no longer exists", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isFirstBind).toBe(false);
    expect(result.isBoundToCluster).toBe(true);
    expect(createdRunner).not.toBeNull();
    expect(clusterUpdates).toHaveLength(1);
    // Only the binding moves; the switches stay as the operator left them.
    expect(clusterUpdates[0]).toEqual({
      aiAccessRunnerId: RUNNER_ID,
      aiAccessCredentialId: null,
    });
  });
});
