import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
} from "../../../Server/Services/ResourceAiAccessService";
import AIService from "../../../Server/Services/AIService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — Enable AI is the project's only AI switch, as the
 * AI access statuses (a cluster's and every infrastructure resource's AI
 * agent page, and the investigation panel) see it.
 *
 * It replaced two project switches: "Enable auto-remediation", which held
 * back every fix (project_auto_remediation_disabled on a cluster,
 * auto_remediation_disabled_for_project on a resource), and "Enable AI
 * command execution", which held back fixes on a cluster reached through a
 * Runner an operator bound with a Kubernetes credential
 * (project_ai_command_execution_disabled). Those gaps are retired:
 *
 * - with Enable AI on, no access target — that advanced Runner, the
 *   cluster's Kubernetes AI agent, the chart's previous in-cluster Runner —
 *   and no kind of resource has a project switch gap, and every Fixes mode
 *   but Off is remediation-ready;
 * - with Enable AI off, the one project switch gap is project_ai_disabled
 *   (ai_disabled_for_project on a resource), and it blocks both;
 * - end to end, from the project row to the status: a row that still
 *   carries the retired columns, both false, changes nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);
const AGENT_ID: ObjectID = new ObjectID("56565656-5656-4656-8656-565656565656");
const RESOURCE_ID: ObjectID = new ObjectID(
  "67676767-6767-4767-8767-676767676767",
);

// The project switch gaps a cluster status has ever had: one live, two retired.
const CLUSTER_PROJECT_SWITCH_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
  "project_ai_disabled",
  "project_auto_remediation_disabled",
  "project_ai_command_execution_disabled",
];

// The same for a resource status.
const RESOURCE_PROJECT_SWITCH_GAP_CODES: Array<ResourceAiAccessGapCode> = [
  "ai_disabled_for_project",
  "auto_remediation_disabled_for_project",
];

const AI_ON: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

const AI_OFF: KubernetesClusterAiAccessProjectGates = {
  ...AI_ON,
  isAiEnabled: false,
};

// Every Fixes mode that proposes or applies a fix.
const FIXING_CLUSTER_MODES: Array<KubernetesAiRemediationMode> = [
  KubernetesAiRemediationMode.RequireApproval,
  KubernetesAiRemediationMode.Automatic,
  KubernetesAiRemediationMode.BypassApproval,
];

const FIXING_RESOURCE_MODES: Array<ResourceAiRemediationMode> = [
  ResourceAiRemediationMode.RequireApproval,
  ResourceAiRemediationMode.Automatic,
  ResourceAiRemediationMode.BypassApproval,
];

type ClusterTargetType = "advanced_runner" | "ai_agent" | "legacy_runner";

const CONNECTED_TARGET_TYPES: Array<ClusterTargetType> = [
  "advanced_runner",
  "ai_agent",
  "legacy_runner",
];

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
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// This cluster's Kubernetes AI agent, online and able to write.
function agent(): KubernetesAiAgent {
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
      podNamespace: "oneuptime-agent",
    },
  } as unknown as KubernetesAiAgent;
}

// This cluster's previous in-cluster Runner (the chart's kubernetes-agent row).
function legacyRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
    connectionStatus: RunnerConnectionStatus.Connected,
    canRunAiCommands: true,
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
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

// A Runner an operator created in the dashboard: it reaches with a credential.
function advancedRunner(): Runner {
  return legacyRunner({ name: "platform-ops-runner", hostInfo: {} });
}

function kubernetesCredential(): RunbookCredential {
  return {
    id: CREDENTIAL_ID,
    _id: CREDENTIAL_ID.toString(),
    name: "prod kubeconfig",
    credentialType: "Kubernetes",
    runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
  } as unknown as RunbookCredential;
}

function clusterGapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map(
    (gap: KubernetesAiAccessGap): KubernetesAiAccessGapCode => {
      return gap.code;
    },
  );
}

function clusterProjectSwitchGaps(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGap> {
  return status.gaps.filter((gap: KubernetesAiAccessGap): boolean => {
    return CLUSTER_PROJECT_SWITCH_GAP_CODES.includes(gap.code);
  });
}

describe("a cluster's AI access status: Enable AI is the only project switch", () => {
  let runnerLookup: jest.SpyInstance;
  let agentLookup: jest.SpyInstance;
  let credentialLookup: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    runnerLookup = jest.spyOn(RunnerService, "findOneBy");
    agentLookup = jest.spyOn(KubernetesAiAgentService, "findForCluster");
    credentialLookup = jest.spyOn(RunbookCredentialService, "findOneBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The rows behind each access target, as the status reads them.
  function reachThrough(
    target: ClusterTargetType | "none",
  ): Record<string, unknown> {
    switch (target) {
      case "advanced_runner":
        runnerLookup.mockResolvedValue(advancedRunner());
        agentLookup.mockResolvedValue(null);
        credentialLookup.mockResolvedValue(kubernetesCredential());
        return {
          aiAccessRunnerId: RUNNER_ID,
          aiAccessCredentialId: CREDENTIAL_ID,
        };
      case "ai_agent":
        runnerLookup.mockResolvedValue(null);
        agentLookup.mockResolvedValue(agent());
        credentialLookup.mockResolvedValue(null);
        return { aiAccessRunnerId: undefined };
      case "legacy_runner":
        runnerLookup.mockResolvedValue(legacyRunner());
        agentLookup.mockResolvedValue(null);
        credentialLookup.mockResolvedValue(null);
        return { aiAccessRunnerId: RUNNER_ID };
      default:
        runnerLookup.mockResolvedValue(null);
        agentLookup.mockResolvedValue(null);
        credentialLookup.mockResolvedValue(null);
        return { aiAccessRunnerId: undefined };
    }
  }

  async function statusOf(data: {
    target: ClusterTargetType | "none";
    mode: KubernetesAiRemediationMode;
    gates: KubernetesClusterAiAccessProjectGates;
  }): Promise<KubernetesClusterAiAccessStatus> {
    const overrides: Record<string, unknown> = reachThrough(data.target);

    return KubernetesClusterAiAccessService.getStatusForClusterModel({
      cluster: cluster({ ...overrides, aiRemediationMode: data.mode }),
      gates: data.gates,
    });
  }

  it("resolves each fixture to the access target it is named for", async () => {
    const accessMethods: Record<string, string> = {};

    for (const target of [...CONNECTED_TARGET_TYPES, "none" as const]) {
      const status: KubernetesClusterAiAccessStatus = await statusOf({
        target,
        mode: KubernetesAiRemediationMode.RequireApproval,
        gates: AI_ON,
      });

      accessMethods[target] = `${status.accessMethod}/${
        status.runner?.kind || "none"
      }`;
    }

    expect(accessMethods).toEqual({
      advanced_runner: "credential/runner",
      ai_agent: "in_cluster/ai_agent",
      legacy_runner: "in_cluster/runner",
      none: "none/none",
    });
  });

  /*
   * The advanced Runner is the target "Enable AI command execution" used
   * to hold back: every fixing mode is ready on it now with Enable AI alone.
   */
  it("an advanced Runner with a credential is remediation-ready in every fixing mode with Enable AI on", async () => {
    for (const mode of FIXING_CLUSTER_MODES) {
      const status: KubernetesClusterAiAccessStatus = await statusOf({
        target: "advanced_runner",
        mode,
        gates: AI_ON,
      });

      expect({ mode, gaps: clusterGapCodes(status) }).toEqual({
        mode,
        gaps: [],
      });
      expect(status.remediationMode).toBe(mode);
      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(true);
    }
  });

  it("every connected target is ready for both in every fixing mode with Enable AI on", async () => {
    for (const target of CONNECTED_TARGET_TYPES) {
      for (const mode of FIXING_CLUSTER_MODES) {
        const status: KubernetesClusterAiAccessStatus = await statusOf({
          target,
          mode,
          gates: AI_ON,
        });

        expect({ target, mode, gaps: clusterGapCodes(status) }).toEqual({
          target,
          mode,
          gaps: [],
        });
        expect(status.isInvestigationReady).toBe(true);
        expect(status.isRemediationReady).toBe(true);
      }
    }
  });

  it("with Enable AI on, Fixes off is the cluster's own choice — never a project switch gap", async () => {
    for (const target of CONNECTED_TARGET_TYPES) {
      const status: KubernetesClusterAiAccessStatus = await statusOf({
        target,
        mode: KubernetesAiRemediationMode.Disabled,
        gates: AI_ON,
      });

      expect({ target, gaps: clusterGapCodes(status) }).toEqual({
        target,
        gaps: ["remediation_disabled"],
      });
      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(false);
    }
  });

  it("with Enable AI off, every target and every mode has exactly one project switch gap: project_ai_disabled, blocking both", async () => {
    for (const target of [...CONNECTED_TARGET_TYPES, "none" as const]) {
      for (const mode of [
        ...FIXING_CLUSTER_MODES,
        KubernetesAiRemediationMode.Disabled,
      ]) {
        const status: KubernetesClusterAiAccessStatus = await statusOf({
          target,
          mode,
          gates: AI_OFF,
        });
        const projectGaps: Array<KubernetesAiAccessGap> =
          clusterProjectSwitchGaps(status);

        expect({
          target,
          mode,
          projectGaps: projectGaps.map((gap: KubernetesAiAccessGap): string => {
            return `${gap.code}/${gap.blocks}`;
          }),
        }).toEqual({
          target,
          mode,
          projectGaps: ["project_ai_disabled/both"],
        });
        expect(projectGaps[0]?.nextStep).toBe(
          "Enable AI under Project Settings → AI Features.",
        );
        expect(status.isInvestigationReady).toBe(false);
        expect(status.isRemediationReady).toBe(false);
      }
    }
  });

  it("with Enable AI off, a connected target's only gap is project_ai_disabled", async () => {
    for (const target of CONNECTED_TARGET_TYPES) {
      const status: KubernetesClusterAiAccessStatus = await statusOf({
        target,
        mode: KubernetesAiRemediationMode.BypassApproval,
        gates: AI_OFF,
      });

      expect({ target, gaps: clusterGapCodes(status) }).toEqual({
        target,
        gaps: ["project_ai_disabled"],
      });
    }
  });

  it("never produces a retired project switch gap, whatever the gates say", async () => {
    for (const target of [...CONNECTED_TARGET_TYPES, "none" as const]) {
      for (const gates of [
        AI_ON,
        AI_OFF,
        { isAiEnabled: false, hasLlmProvider: false, aiBalanceBlocker: "x" },
      ]) {
        const codes: Array<KubernetesAiAccessGapCode> = clusterGapCodes(
          await statusOf({
            target,
            mode: KubernetesAiRemediationMode.Automatic,
            gates,
          }),
        );

        expect(codes).not.toContain("project_auto_remediation_disabled");
        expect(codes).not.toContain("project_ai_command_execution_disabled");
      }
    }
  });

  /*
   * End to end: getStatusForCluster reads the project row itself
   * (getProjectGates). A row that still carries the columns Enable AI
   * replaced — both false, which used to block every fix on this cluster —
   * changes nothing; Enable AI alone decides.
   */
  describe("from the project row", () => {
    function mockRows(project: Record<string, unknown>): void {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        cluster({
          aiAccessRunnerId: RUNNER_ID,
          aiAccessCredentialId: CREDENTIAL_ID,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      );
      runnerLookup.mockResolvedValue(advancedRunner());
      agentLookup.mockResolvedValue(null);
      credentialLookup.mockResolvedValue(kubernetesCredential());
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(project as unknown as Project);
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue({
          id: ObjectID.generate(),
        } as unknown as LlmProvider);
      jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
    }

    it("Enable AI on, the retired switches off: remediation-ready through the advanced Runner", async () => {
      mockRows({
        enableAi: true,
        enableAutoRemediation: false,
        enableAiCommandExecution: false,
      });

      const status: KubernetesClusterAiAccessStatus | null =
        await KubernetesClusterAiAccessService.getStatusForCluster({
          clusterId: CLUSTER_ID,
          projectId: PROJECT_ID,
        });

      expect(status?.accessMethod).toBe("credential");
      expect(status?.gaps).toEqual([]);
      expect(status?.isInvestigationReady).toBe(true);
      expect(status?.isRemediationReady).toBe(true);
    });

    it("Enable AI off, the retired switches on: project_ai_disabled alone blocks both", async () => {
      mockRows({
        enableAi: false,
        enableAutoRemediation: true,
        enableAiCommandExecution: true,
      });

      const status: KubernetesClusterAiAccessStatus | null =
        await KubernetesClusterAiAccessService.getStatusForCluster({
          clusterId: CLUSTER_ID,
          projectId: PROJECT_ID,
        });

      expect(status ? clusterGapCodes(status) : null).toEqual([
        "project_ai_disabled",
      ]);
      expect(status?.isInvestigationReady).toBe(false);
      expect(status?.isRemediationReady).toBe(false);
    });
  });
});

function resourceRow(
  resourceType: AiResourceType,
  aiRemediationMode: ResourceAiRemediationMode,
): ResourceAiAccessRow {
  return {
    resourceType,
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    name: "prod-1",
    identifier: "prod-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode,
    aiCommandAllowlist: [],
    isArchived: false,
  };
}

// The resource's AI agent: online, reaching the resource, writes allowed.
function resourceAgent(resourceType: AiResourceType): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType,
    resourceId: RESOURCE_ID,
    resourceIdentifier: "prod-1",
    agentVersion: "1.2.3",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType,
      resourceIdentifier: "prod-1",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
    },
  } as unknown as ResourceAiAgent;
}

function resourceGapCodes(
  status: ResourceAiAccessStatus,
): Array<ResourceAiAccessGapCode> {
  return status.gaps.map(
    (gap: ResourceAiAccessGap): ResourceAiAccessGapCode => {
      return gap.code;
    },
  );
}

function resourceStatus(data: {
  resourceType: AiResourceType;
  mode: ResourceAiRemediationMode;
  gates: ResourceAiAccessProjectGates;
  withAgent?: boolean | undefined;
}): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource: resourceRow(data.resourceType, data.mode),
    agentRow:
      data.withAgent === false ? null : resourceAgent(data.resourceType),
    gates: data.gates,
  });
}

describe("a resource's AI access status: Enable AI is the only project switch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("covers every kind of resource", () => {
    expect(ALL_AI_RESOURCE_TYPES.length).toBeGreaterThanOrEqual(8);
  });

  it("every kind of resource is ready for both in every fixing mode with Enable AI on", () => {
    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      for (const mode of FIXING_RESOURCE_MODES) {
        const status: ResourceAiAccessStatus = resourceStatus({
          resourceType,
          mode,
          gates: AI_ON,
        });

        expect({ resourceType, mode, gaps: resourceGapCodes(status) }).toEqual({
          resourceType,
          mode,
          gaps: [],
        });
        expect(status.isInvestigationReady).toBe(true);
        expect(status.isRemediationReady).toBe(true);
      }
    }
  });

  it("with Enable AI on, Fixes off is the resource's own choice — never a project switch gap", () => {
    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      const status: ResourceAiAccessStatus = resourceStatus({
        resourceType,
        mode: ResourceAiRemediationMode.Disabled,
        gates: AI_ON,
      });

      expect({ resourceType, gaps: resourceGapCodes(status) }).toEqual({
        resourceType,
        gaps: ["remediation_disabled"],
      });
    }
  });

  it("with Enable AI off, every kind of resource and every mode has exactly one project switch gap: ai_disabled_for_project, blocking both", () => {
    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      for (const mode of [
        ...FIXING_RESOURCE_MODES,
        ResourceAiRemediationMode.Disabled,
      ]) {
        for (const withAgent of [true, false]) {
          const status: ResourceAiAccessStatus = resourceStatus({
            resourceType,
            mode,
            gates: AI_OFF,
            withAgent,
          });
          const projectGaps: Array<ResourceAiAccessGap> = status.gaps.filter(
            (gap: ResourceAiAccessGap): boolean => {
              return RESOURCE_PROJECT_SWITCH_GAP_CODES.includes(gap.code);
            },
          );

          expect({
            resourceType,
            mode,
            withAgent,
            projectGaps: projectGaps.map((gap: ResourceAiAccessGap): string => {
              return `${gap.code}/${gap.blocksInvestigation}/${gap.blocksRemediation}`;
            }),
          }).toEqual({
            resourceType,
            mode,
            withAgent,
            projectGaps: ["ai_disabled_for_project/true/true"],
          });
          expect(projectGaps[0]?.nextStep).toBe(
            "Enable AI under Project Settings → AI Features.",
          );
          expect(status.isInvestigationReady).toBe(false);
          expect(status.isRemediationReady).toBe(false);
        }
      }
    }
  });

  it("with Enable AI off, a ready resource's only gap is ai_disabled_for_project", () => {
    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      const status: ResourceAiAccessStatus = resourceStatus({
        resourceType,
        mode: ResourceAiRemediationMode.BypassApproval,
        gates: AI_OFF,
      });

      expect({ resourceType, gaps: resourceGapCodes(status) }).toEqual({
        resourceType,
        gaps: ["ai_disabled_for_project"],
      });
    }
  });

  it("keeps auto_remediation_disabled_for_project in the union (retired) and never produces it", () => {
    // Compile-time: still a member of the union.
    const retired: ResourceAiAccessGapCode =
      "auto_remediation_disabled_for_project";

    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      for (const gates of [AI_ON, AI_OFF]) {
        expect(
          resourceGapCodes(
            resourceStatus({
              resourceType,
              mode: ResourceAiRemediationMode.Automatic,
              gates,
            }),
          ),
        ).not.toContain(retired);
      }
    }
  });

  /*
   * End to end: a resource reads the project gates exactly as a cluster
   * does (ResourceAiAccessService.getProjectGates). A project row that
   * still carries the retired columns, both false, changes nothing.
   */
  it("from the project row: the retired switches off change nothing, Enable AI off is the one gap", async () => {
    const findOneById: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as LlmProvider);
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);

    findOneById.mockResolvedValue({
      enableAi: true,
      enableAutoRemediation: false,
      enableAiCommandExecution: false,
    } as unknown as Project);

    const on: ResourceAiAccessProjectGates =
      await ResourceAiAccessService.getProjectGates(PROJECT_ID);

    expect(on).toEqual({
      isAiEnabled: true,
      hasLlmProvider: true,
      aiBalanceBlocker: null,
      automaticInvestigation: { incidents: false, alerts: false },
    });

    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      const status: ResourceAiAccessStatus = resourceStatus({
        resourceType,
        mode: ResourceAiRemediationMode.Automatic,
        gates: on,
      });

      expect({ resourceType, gaps: resourceGapCodes(status) }).toEqual({
        resourceType,
        gaps: [],
      });
      expect(status.isRemediationReady).toBe(true);
    }

    findOneById.mockResolvedValue({
      enableAi: false,
      enableAutoRemediation: true,
      enableAiCommandExecution: true,
    } as unknown as Project);

    const off: ResourceAiAccessProjectGates =
      await ResourceAiAccessService.getProjectGates(PROJECT_ID);

    expect(off.isAiEnabled).toBe(false);
    expect(
      resourceGapCodes(
        resourceStatus({
          resourceType: AiResourceType.Host,
          mode: ResourceAiRemediationMode.Automatic,
          gates: off,
        }),
      ),
    ).toEqual(["ai_disabled_for_project"]);
  });
});
