import KubernetesClusterAiAccessService, {
  AGENT_SET_FIXES_NEXT_STEP,
  AGENT_SET_INVESTIGATION_NEXT_STEP,
  KubernetesClusterAiAccessProjectGates,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner from "../../../Models/DatabaseModels/Runner";
import { AgentAiSettings } from "../../../Types/AI/AgentAiSettings";
import OneUptimeDate from "../../../Types/Date";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The AI agent page shows where a cluster's investigation and fixes are set
 * (status.aiSettingsSource): read-only, with the chart command that changes
 * them, while the cluster's Kubernetes AI agent sets them; editable, as
 * before, while they are OneUptime's. The gaps for "investigation off" and
 * "fixes off" point at the same place — the chart, not the page — when the
 * agent sets them.
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
const AGENT_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
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
    aiAccessRunnerId: undefined,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
    aiAccessConfiguredAt: null,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function fakeAgent(aiSettings: AgentAiSettings | undefined): KubernetesAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    lastRegisteredAt: OneUptimeDate.getSomeMinutesAgo(60),
    agentVersion: "14.2.0",
    posture: {
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
      podNamespace: "oneuptime-agent",
      ...(aiSettings ? { aiSettings } : {}),
    },
  } as unknown as KubernetesAiAgent;
}

// An online Runner an operator bound, outside the chart.
function advancedRunner(): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "ops-runner",
    lastAlive: OneUptimeDate.getCurrentDate(),
    canRunAiCommands: true,
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    hostInfo: {
      kubernetes: {
        inCluster: false,
        allowWrites: true,
      },
    },
  } as unknown as Runner;
}

const CONFIGURED: AgentAiSettings = {
  investigation: false,
  fixes: "Disabled",
  isConfigured: true,
};

const DEFAULTS: AgentAiSettings = {
  investigation: true,
  fixes: "Disabled",
  isConfigured: false,
};

let agentLookup: jest.SpyInstance;

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
  agentLookup = jest
    .spyOn(KubernetesAiAgentService, "findForCluster")
    .mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function statusOf(
  cluster: KubernetesCluster,
): Promise<KubernetesClusterAiAccessStatus> {
  return await KubernetesClusterAiAccessService.getStatusForClusterModel({
    cluster,
    gates: READY_GATES,
  });
}

function gap(
  status: KubernetesClusterAiAccessStatus,
  code: string,
): KubernetesAiAccessGap | undefined {
  return status.gaps.find((candidate: KubernetesAiAccessGap) => {
    return candidate.code === code;
  });
}

describe("status.aiSettingsSource", () => {
  it("agent_configuration: the agent's chart names the settings", async () => {
    agentLookup.mockResolvedValue(fakeAgent(CONFIGURED));

    expect((await statusOf(fakeCluster())).aiSettingsSource).toBe(
      "agent_configuration",
    );
  });

  it("agent_configuration even where an operator chose the settings before", async () => {
    agentLookup.mockResolvedValue(fakeAgent(CONFIGURED));

    expect(
      (
        await statusOf(
          fakeCluster({ aiAccessConfiguredAt: new Date("2026-01-01") }),
        )
      ).aiSettingsSource,
    ).toBe("agent_configuration");
  });

  it("agent_defaults: the agent's defaults, on a cluster nobody configured", async () => {
    agentLookup.mockResolvedValue(fakeAgent(DEFAULTS));

    expect((await statusOf(fakeCluster())).aiSettingsSource).toBe(
      "agent_defaults",
    );
  });

  it("oneuptime: the agent's defaults never replace an operator's choice", async () => {
    agentLookup.mockResolvedValue(fakeAgent(DEFAULTS));

    expect(
      (
        await statusOf(
          fakeCluster({ aiAccessConfiguredAt: new Date("2026-01-01") }),
        )
      ).aiSettingsSource,
    ).toBe("oneuptime");
  });

  it("oneuptime: an agent too old to report its settings", async () => {
    agentLookup.mockResolvedValue(fakeAgent(undefined));

    expect((await statusOf(fakeCluster())).aiSettingsSource).toBe("oneuptime");
  });

  it("oneuptime: no agent at all", async () => {
    expect((await statusOf(fakeCluster())).aiSettingsSource).toBe("oneuptime");
  });

  it("oneuptime: AI reaches the cluster through a Runner an operator bound", async () => {
    agentLookup.mockResolvedValue(fakeAgent(CONFIGURED));
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(advancedRunner());

    const status: KubernetesClusterAiAccessStatus = await statusOf(
      fakeCluster({ aiAccessRunnerId: RUNNER_ID }),
    );

    expect(status.accessMethod).not.toBe("in_cluster");
    expect(status.aiSettingsSource).toBe("oneuptime");
  });
});

describe("the off gaps point where the setting lives", () => {
  const OFF: Partial<Record<string, unknown>> = {
    isAiInvestigationEnabled: false,
    aiRemediationMode: KubernetesAiRemediationMode.Disabled,
  };

  it("set by the agent: the chart's aiAgent.investigation and aiAgent.fixes", async () => {
    agentLookup.mockResolvedValue(fakeAgent(CONFIGURED));

    const status: KubernetesClusterAiAccessStatus = await statusOf(
      fakeCluster(OFF),
    );

    expect(gap(status, "investigation_disabled")?.nextStep).toBe(
      AGENT_SET_INVESTIGATION_NEXT_STEP,
    );
    expect(gap(status, "remediation_disabled")?.nextStep).toBe(
      AGENT_SET_FIXES_NEXT_STEP,
    );
    expect(AGENT_SET_INVESTIGATION_NEXT_STEP).toContain(
      "aiAgent.investigation=true",
    );
    expect(AGENT_SET_FIXES_NEXT_STEP).toContain("aiAgent.fixes");
    expect(AGENT_SET_FIXES_NEXT_STEP).toContain("ask-for-approval");
    for (const step of [
      AGENT_SET_INVESTIGATION_NEXT_STEP,
      AGENT_SET_FIXES_NEXT_STEP,
    ]) {
      expect(step).toContain("AI → Agent");
      expect(step).not.toContain("Turn on");
    }
  });

  it("set by the agent's defaults: the same, the chart", async () => {
    agentLookup.mockResolvedValue(
      fakeAgent({
        investigation: false,
        fixes: "Disabled",
        isConfigured: false,
      }),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf(
      fakeCluster(OFF),
    );

    expect(gap(status, "investigation_disabled")?.nextStep).toBe(
      AGENT_SET_INVESTIGATION_NEXT_STEP,
    );
  });

  it("set in OneUptime: the switches on the AI agent page, as before", async () => {
    agentLookup.mockResolvedValue(fakeAgent(undefined));

    const status: KubernetesClusterAiAccessStatus = await statusOf(
      fakeCluster(OFF),
    );

    expect(gap(status, "investigation_disabled")?.nextStep).toBe(
      'Turn on "Investigate with kubectl" on the cluster\'s AI agent page (AI → Agent).',
    );
    expect(gap(status, "remediation_disabled")?.nextStep).toContain(
      'Set "Fixes" to "Ask for approval"',
    );
  });
});
