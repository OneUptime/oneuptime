import KubernetesClusterAiAccessService, {
  KubernetesAiAccessTarget,
  KubernetesClusterAiAccessProjectGates,
  LoadedKubernetesAiAccessTarget,
  REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  getKubernetesAiAccessTargetId,
  resolveKubernetesAiAccessTarget,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — ONE access target per cluster, resolved from
 * liveness (resolveKubernetesAiAccessTarget), and the status built from it:
 *
 * 1. the cluster's Kubernetes AI agent, when online;
 * 2. the bound previous in-cluster Runner of THIS cluster, when online —
 *    the rollback case: a helm rollback stops the agent and the old Runner
 *    serves again with no dashboard step;
 * 3. the agent, offline (ai_agent_offline);
 * 4. the bound previous in-cluster Runner, offline;
 * 5. nothing (ai_agent_not_connected).
 *
 * A bound Runner outside the cluster - an advanced Runner an operator chose,
 * which reached the cluster with a Kubernetes runbook credential and won
 * over everything the chart installed - is none of these: runbook
 * credentials were removed, and it is ignored. No status names a
 * credential.
 *
 * The status always carries aiAgent (the agent row whether or not it is the
 * target) and automaticInvestigation, and names the target's kind so the
 * agent and the previous in-cluster Runner — both accessMethod
 * "in_cluster" — are told apart.
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

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
  automaticInvestigation: { incidents: true, alerts: false },
};

function cluster(overrides: Record<string, unknown> = {}): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function agent(overrides: Record<string, unknown> = {}): KubernetesAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    lastRegisteredAt: OneUptimeDate.getSomeMinutesAgo(90),
    agentVersion: "14.1.0",
    posture: {
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
      podNamespace: "oneuptime-agent",
      writeNamespaces: ["web"],
      allowNodeOperations: false,
      kubectlVersion: "v1.36.4",
    },
    ...overrides,
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

/*
 * A Runner an operator created in the dashboard: it runs outside every
 * cluster, and reached one only with a runbook credential (gone).
 */
function outsideRunner(overrides: Record<string, unknown> = {}): Runner {
  return legacyRunner({
    name: "platform-ops-runner",
    hostInfo: {},
    ...overrides,
  });
}

function gapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map((gap: KubernetesAiAccessGap) => {
    return gap.code;
  });
}

function resolve(data: {
  bound?: Runner | null;
  boundOnline?: boolean;
  aiAgent?: KubernetesAiAgent | null;
  agentOnline?: boolean;
  aiAccessRunnerId?: ObjectID | null;
  clusterIdentifier?: string;
}): KubernetesAiAccessTarget {
  const bound: Runner | null = data.bound === undefined ? null : data.bound;

  return resolveKubernetesAiAccessTarget({
    clusterIdentifier:
      data.clusterIdentifier === undefined ? "prod-us" : data.clusterIdentifier,
    aiAccessRunnerId:
      data.aiAccessRunnerId === undefined
        ? bound
          ? RUNNER_ID
          : null
        : data.aiAccessRunnerId,
    boundRunner: bound,
    isBoundRunnerOnline: data.boundOnline === true,
    agent: data.aiAgent === undefined ? null : data.aiAgent,
    isAgentOnline: data.agentOnline === true,
  });
}

describe("resolveKubernetesAiAccessTarget — the five rules", () => {
  /*
   * An advanced Runner an operator bound won over everything, the online
   * agent included: it reached the cluster with a Kubernetes runbook
   * credential. Runbook credentials were removed, and it is no target,
   * online or not - the agent serves, or nothing does.
   */
  it.each([
    ["online", true],
    ["offline", false],
  ])(
    "a Runner outside the cluster, %s, is never a target: the agent serves, or nothing does",
    (_label: string, boundOnline: boolean) => {
      expect(
        resolve({
          bound: outsideRunner(),
          boundOnline,
          aiAgent: agent(),
          agentOnline: true,
        }),
      ).toMatchObject({ type: "ai_agent", isOnline: true });
      expect(
        resolve({
          bound: outsideRunner(),
          boundOnline,
          aiAgent: agent(),
          agentOnline: false,
        }),
      ).toMatchObject({ type: "ai_agent", isOnline: false });
      expect(resolve({ bound: outsideRunner(), boundOnline })).toEqual({
        type: "none",
      });
    },
  );

  it("rule 1: the online agent wins over the online previous in-cluster Runner (the upgrade window)", () => {
    const target: KubernetesAiAccessTarget = resolve({
      bound: legacyRunner(),
      boundOnline: true,
      aiAgent: agent(),
      agentOnline: true,
    });

    expect(target).toMatchObject({ type: "ai_agent", isOnline: true });
    expect(getKubernetesAiAccessTargetId(target)).toBe(AGENT_ID.toString());
  });

  it("rule 1: an online agent with nothing bound", () => {
    expect(resolve({ aiAgent: agent(), agentOnline: true })).toMatchObject({
      type: "ai_agent",
      isOnline: true,
    });
  });

  it("rule 2 (rollback): the agent offline and the previous in-cluster Runner online → the previous Runner", () => {
    const target: KubernetesAiAccessTarget = resolve({
      bound: legacyRunner(),
      boundOnline: true,
      aiAgent: agent(),
      agentOnline: false,
    });

    expect(target).toMatchObject({ type: "legacy_runner", isOnline: true });
    expect(getKubernetesAiAccessTargetId(target)).toBe(RUNNER_ID.toString());
  });

  it("rule 2: the previous in-cluster Runner online and no agent at all", () => {
    expect(resolve({ bound: legacyRunner(), boundOnline: true })).toMatchObject(
      { type: "legacy_runner", isOnline: true },
    );
  });

  it("rule 3: the agent offline beats the previous Runner offline", () => {
    expect(
      resolve({
        bound: legacyRunner(),
        boundOnline: false,
        aiAgent: agent(),
        agentOnline: false,
      }),
    ).toMatchObject({ type: "ai_agent", isOnline: false });
  });

  it("rule 3: the agent offline with nothing bound", () => {
    expect(resolve({ aiAgent: agent(), agentOnline: false })).toMatchObject({
      type: "ai_agent",
      isOnline: false,
    });
  });

  it("rule 4: the previous in-cluster Runner offline and no agent", () => {
    expect(
      resolve({ bound: legacyRunner(), boundOnline: false }),
    ).toMatchObject({ type: "legacy_runner", isOnline: false });
  });

  it("rule 5: nothing", () => {
    const target: KubernetesAiAccessTarget = resolve({});

    expect(target).toEqual({ type: "none" });
    expect(getKubernetesAiAccessTargetId(target)).toBeNull();
  });

  it("a kubernetes-agent Runner of ANOTHER cluster is never a target", () => {
    const otherClusters: Runner = legacyRunner({
      name: "kubernetes-agent/prod-eu",
      hostInfo: {
        kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
      },
    });

    expect(resolve({ bound: otherClusters, boundOnline: true })).toEqual({
      type: "none",
    });
    expect(
      resolve({
        bound: otherClusters,
        boundOnline: true,
        aiAgent: agent(),
        agentOnline: false,
      }),
    ).toMatchObject({ type: "ai_agent", isOnline: false });
  });

  it("a Runner that is this cluster's agent by posture only is the previous in-cluster Runner", () => {
    expect(
      resolve({
        bound: legacyRunner({ name: "renamed-in-cluster-runner" }),
        boundOnline: true,
      }),
    ).toMatchObject({ type: "legacy_runner" });
  });

  it("a bound id whose Runner row is gone reads as unbound", () => {
    expect(resolve({ bound: null, aiAccessRunnerId: RUNNER_ID })).toEqual({
      type: "none",
    });
    expect(
      resolve({
        bound: null,
        aiAccessRunnerId: RUNNER_ID,
        aiAgent: agent(),
        agentOnline: true,
      }),
    ).toMatchObject({ type: "ai_agent" });
  });

  it("a Runner row handed in without a binding on the cluster is ignored", () => {
    expect(
      resolve({
        bound: outsideRunner(),
        boundOnline: true,
        aiAccessRunnerId: null,
      }),
    ).toEqual({ type: "none" });
  });

  it("a cluster without an identifier has no previous in-cluster Runner", () => {
    expect(
      resolve({
        bound: legacyRunner(),
        boundOnline: true,
        clusterIdentifier: "",
      }),
    ).toEqual({ type: "none" });
  });

  it("getKubernetesAiAccessTargetId names the agent row or the Runner row", () => {
    expect(
      getKubernetesAiAccessTargetId({
        type: "ai_agent",
        agent: agent(),
        isOnline: true,
      }),
    ).toBe(AGENT_ID.toString());
    expect(
      getKubernetesAiAccessTargetId({
        type: "legacy_runner",
        runner: legacyRunner(),
        isOnline: false,
      }),
    ).toBe(RUNNER_ID.toString());
    expect(getKubernetesAiAccessTargetId({ type: "none" })).toBeNull();
  });
});

describe("KubernetesClusterAiAccessService liveness", () => {
  it("isRunnerOnline: heartbeated recently and not signed off", () => {
    expect(
      KubernetesClusterAiAccessService.isRunnerOnline(legacyRunner()),
    ).toBe(true);
    expect(
      KubernetesClusterAiAccessService.isRunnerOnline(
        legacyRunner({ connectionStatus: RunnerConnectionStatus.Disconnected }),
      ),
    ).toBe(false);
    expect(
      KubernetesClusterAiAccessService.isRunnerOnline(
        legacyRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
      ),
    ).toBe(false);
    expect(
      KubernetesClusterAiAccessService.isRunnerOnline(
        legacyRunner({ lastAlive: undefined }),
      ),
    ).toBe(false);
  });

  it("resolveAccessTarget reads each row's liveness the module's way (rollback regression)", () => {
    // The agent signed off (helm rollback); the previous Runner is back.
    const rolledBack: KubernetesAiAccessTarget =
      KubernetesClusterAiAccessService.resolveAccessTarget(
        { aiAccessRunnerId: RUNNER_ID, clusterIdentifier: "prod-us" },
        {
          boundRunner: legacyRunner(),
          agentRow: agent({ connectionStatus: "disconnected" }),
        },
      );

    expect(rolledBack).toMatchObject({
      type: "legacy_runner",
      isOnline: true,
    });

    // The agent's heartbeat aged out: the same.
    expect(
      KubernetesClusterAiAccessService.resolveAccessTarget(
        { aiAccessRunnerId: RUNNER_ID, clusterIdentifier: "prod-us" },
        {
          boundRunner: legacyRunner(),
          agentRow: agent({ lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30) }),
        },
      ),
    ).toMatchObject({ type: "legacy_runner" });

    // The agent is back: it takes over again.
    expect(
      KubernetesClusterAiAccessService.resolveAccessTarget(
        { aiAccessRunnerId: RUNNER_ID, clusterIdentifier: "prod-us" },
        { boundRunner: legacyRunner(), agentRow: agent() },
      ),
    ).toMatchObject({ type: "ai_agent", isOnline: true });
  });
});

describe("KubernetesClusterAiAccessService.loadAccessTarget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the agent row by (project, cluster) and the bound Runner in this project", async () => {
    const agentLookup: jest.SpyInstance = jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(agent());
    const runnerLookup: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(legacyRunner());

    const loaded: LoadedKubernetesAiAccessTarget =
      await KubernetesClusterAiAccessService.loadAccessTarget({
        cluster: cluster({ aiAccessRunnerId: RUNNER_ID }),
      });

    expect(agentLookup).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
    });
    const call: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = runnerLookup.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(call.query).toEqual({
      _id: RUNNER_ID.toString(),
      projectId: PROJECT_ID,
    });
    // What liveness and the "is an agent row" rule read.
    expect(call.select).toMatchObject({
      name: true,
      lastAlive: true,
      connectionStatus: true,
      hostInfo: true,
    });
    expect(loaded.target.type).toBe("ai_agent");
    expect(loaded.boundRunner?.id).toBe(RUNNER_ID);
    expect(loaded.agent?.id).toBe(AGENT_ID);
  });

  it("does not read the agent again when the caller already has it (null included)", async () => {
    const agentLookup: jest.SpyInstance = jest.spyOn(
      KubernetesAiAgentService,
      "findForCluster",
    );

    const loaded: LoadedKubernetesAiAccessTarget =
      await KubernetesClusterAiAccessService.loadAccessTarget({
        cluster: cluster(),
        agentRow: null,
      });

    expect(agentLookup).not.toHaveBeenCalled();
    expect(loaded.target).toEqual({ type: "none" });
  });

  it("reads no Runner for a cluster with nothing bound", async () => {
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(null);
    const runnerLookup: jest.SpyInstance = jest.spyOn(
      RunnerService,
      "findOneBy",
    );

    await KubernetesClusterAiAccessService.loadAccessTarget({
      cluster: cluster(),
    });

    expect(runnerLookup).not.toHaveBeenCalled();
  });

  it("fails closed: a failed lookup propagates (the enqueue chokepoint must not guess)", async () => {
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockRejectedValue(new Error("db down"));

    await expect(
      KubernetesClusterAiAccessService.loadAccessTarget({
        cluster: cluster(),
      }),
    ).rejects.toThrow("db down");
  });

  it("refuses a cluster row without its id or project", async () => {
    await expect(
      KubernetesClusterAiAccessService.loadAccessTarget({
        cluster: cluster({ projectId: undefined }),
        agentRow: null,
      }),
    ).rejects.toThrow("resolve its AI access target");
  });
});

describe("the status of a cluster reached through its Kubernetes AI agent", () => {
  let agentLookup: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
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

  async function statusOf(
    clusterOverrides: Record<string, unknown> = {},
    gates: KubernetesClusterAiAccessProjectGates = READY_GATES,
  ): Promise<KubernetesClusterAiAccessStatus> {
    return KubernetesClusterAiAccessService.getStatusForClusterModel({
      cluster: cluster(clusterOverrides),
      gates,
    });
  }

  it("is ready for both with an online agent that can write, and names it as the target", async () => {
    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(status.gaps).toEqual([]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(true);
    expect(status.accessMethod).toBe("in_cluster");
    expect(status).not.toHaveProperty("credentialId");
    expect(status.runner).toEqual({
      id: AGENT_ID.toString(),
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline: true,
      lastAliveAt: expect.any(String),
      canRunAiCommands: true,
      posture: expect.objectContaining({
        writeNamespaces: ["web"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: false,
      }),
    });
    // No Runner is read for a cluster with nothing bound.
    expect(runnerLookup).not.toHaveBeenCalled();
  });

  it("always sets aiAgent: the summary of the row, never its key hash", async () => {
    agentLookup.mockResolvedValue(
      agent({ keyHash: "a".repeat(64) } as unknown as Record<string, unknown>),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(status.aiAgent).toMatchObject({
      id: AGENT_ID.toString(),
      isOnline: true,
      connectionStatus: "connected",
      agentVersion: "14.1.0",
    });
    expect(status.aiAgent?.posture?.kubectlVersion).toBe("v1.36.4");
    expect(JSON.stringify(status)).not.toContain("a".repeat(64));
    expect(JSON.stringify(status)).not.toContain("keyHash");
  });

  it("always sets aiAgent to null when the cluster has no agent row", async () => {
    agentLookup.mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(status.aiAgent).toBeNull();
    expect("aiAgent" in status).toBe(true);
  });

  it("always sets automaticInvestigation from the project's two opt-ins", async () => {
    expect((await statusOf()).automaticInvestigation).toEqual({
      incidents: true,
      alerts: false,
    });

    // Gates built without them (older callers) read as both off, not absent.
    const withoutOptIns: KubernetesClusterAiAccessProjectGates = {
      isAiEnabled: true,
      hasLlmProvider: true,
    };

    expect((await statusOf({}, withoutOptIns)).automaticInvestigation).toEqual({
      incidents: false,
      alerts: false,
    });
  });

  /*
   * An advanced Runner an operator bound was the target, over the online
   * agent, with the cluster's Kubernetes runbook credential. Runbook
   * credentials were removed; a cluster still bound to such a Runner (its
   * data migration clears the binding) is reached through its agent.
   */
  it("an outside Runner still bound is no target: the online agent serves, and no credential is named", async () => {
    runnerLookup.mockResolvedValue(outsideRunner());

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiAccessRunnerId: RUNNER_ID,
    });

    expect(status.runner?.kind).toBe("ai_agent");
    expect(status.runner?.id).toBe(AGENT_ID.toString());
    expect(status.accessMethod).toBe("in_cluster");
    expect(status.gaps).toEqual([]);
    expect(status.isRemediationReady).toBe(true);
    expect(status).not.toHaveProperty("credentialId");
    expect(status).not.toHaveProperty("credentialName");
  });

  it("with no agent, an outside Runner still bound leaves the cluster unreached, and the gap says the Runner is not used", async () => {
    agentLookup.mockResolvedValue(null);
    runnerLookup.mockResolvedValue(outsideRunner());

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiAccessRunnerId: RUNNER_ID,
    });

    expect(status.runner).toBeNull();
    expect(status.accessMethod).toBe("none");
    expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
    expect(status.gaps[0]?.description).toContain(
      'Runner "platform-ops-runner" is still selected for this cluster, but it is not this cluster\'s in-cluster Runner, so OneUptime AI does not use it.',
    );
  });

  it("the upgrade window: an online agent is the target while the previous Runner is still bound and online", async () => {
    runnerLookup.mockResolvedValue(legacyRunner());

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiAccessRunnerId: RUNNER_ID,
    });

    expect(status.gaps).toEqual([]);
    expect(status.runner?.kind).toBe("ai_agent");
    expect(status.runner?.id).toBe(AGENT_ID.toString());
  });

  it("the rollback: the agent stopped and the previous Runner is back online — it serves, with no gap", async () => {
    agentLookup.mockResolvedValue(agent({ connectionStatus: "disconnected" }));
    runnerLookup.mockResolvedValue(legacyRunner());

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiAccessRunnerId: RUNNER_ID,
    });

    expect(status.gaps).toEqual([]);
    expect(status.runner?.kind).toBe("runner");
    expect(status.runner?.name).toBe("kubernetes-agent/prod-us");
    expect(status.accessMethod).toBe("in_cluster");
    expect(status.aiAgent?.isOnline).toBe(false);
    expect(status.isInvestigationReady).toBe(true);
  });

  it("ai_agent_offline: blocks both and names the logs command in the agent's own namespace", async () => {
    agentLookup.mockResolvedValue(
      agent({ lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30) }),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(gapCodes(status)).toEqual(["ai_agent_offline"]);
    expect(status.gaps[0]?.blocks).toBe("both");
    expect(status.gaps[0]?.title).toBe("The Kubernetes AI agent is offline");
    expect(status.gaps[0]?.description).toContain("last reported in at");
    expect(status.gaps[0]?.nextStep).toContain(
      "kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100",
    );
    expect(status.runner?.kind).toBe("ai_agent");
    expect(status.runner?.isOnline).toBe(false);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
  });

  it("ai_agent_offline for an agent that signed off says so", async () => {
    agentLookup.mockResolvedValue(agent({ connectionStatus: "disconnected" }));

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(gapCodes(status)).toEqual(["ai_agent_offline"]);
    expect(status.gaps[0]?.description).toContain("signed off");
    expect(status.gaps[0]?.description).toContain("aiAgent.enabled=false");
  });

  it("ai_agent_offline with no reported namespace leaves a placeholder", async () => {
    agentLookup.mockResolvedValue(
      agent({
        lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30),
        posture: { inCluster: true, clusterIdentifier: "prod-us" },
      }),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(status.gaps[0]?.nextStep).toContain(
      "kubectl logs -n <namespace> -l component=ai-agent --tail=100",
    );
  });

  it("a read-only agent blocks only remediation, with the aiAgent write step", async () => {
    agentLookup.mockResolvedValue(
      agent({
        posture: {
          inCluster: true,
          allowWrites: false,
          clusterIdentifier: "prod-us",
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(gapCodes(status)).toEqual(["remediation_write_access_missing"]);
    expect(status.gaps[0]?.title).toBe("The Kubernetes AI agent is read-only");
    expect(status.gaps[0]?.blocks).toBe("remediation");
    expect(status.gaps[0]?.nextStep).toBe(REMEDIATION_WRITE_ACCESS_NEXT_STEP);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("negative control: a read-only agent with fixes off has only the fixes-off gap", async () => {
    agentLookup.mockResolvedValue(
      agent({
        posture: {
          inCluster: true,
          allowWrites: false,
          clusterIdentifier: "prod-us",
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });

    expect(gapCodes(status)).toEqual(["remediation_disabled"]);
    expect(status.gaps[0]?.nextStep).toContain(
      "the cluster's AI agent page (AI → Agent)",
    );
  });

  it("an agent whose report does not name this cluster is not used (the enqueue chokepoint refuses it too)", async () => {
    agentLookup.mockResolvedValue(
      agent({
        posture: { inCluster: true, allowWrites: true, clusterIdentifier: "x" },
      }),
    );

    const status: KubernetesClusterAiAccessStatus = await statusOf();

    expect(gapCodes(status)).toEqual(["runner_cluster_mismatch"]);
    expect(status.gaps[0]?.title).toBe(
      "The Kubernetes AI agent has not reported this cluster",
    );
    expect(status.gaps[0]?.nextStep).toContain(
      "Reset the agent on the cluster's AI agent page (AI → Agent)",
    );
    expect(status.accessMethod).toBe("none");
    expect(status.isInvestigationReady).toBe(false);
  });

  it("a previous in-cluster Runner whose report dropped its posture is not used; the step is the upgrade", async () => {
    agentLookup.mockResolvedValue(null);
    runnerLookup.mockResolvedValue(legacyRunner({ hostInfo: {} }));

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiAccessRunnerId: RUNNER_ID,
    });

    expect(gapCodes(status)).toEqual(["runner_cluster_mismatch"]);
    expect(status.gaps[0]?.title).toBe(
      "The previous in-cluster Runner has not reported this cluster",
    );
    expect(status.gaps[0]?.nextStep).toContain(
      "Upgrade the Kubernetes agent chart",
    );
    expect(status.accessMethod).toBe("none");
    expect(status).not.toHaveProperty("credentialId");
  });

  it("reads no credential column: a cluster row that still carries one changes nothing", async () => {
    const status: KubernetesClusterAiAccessStatus = await statusOf({
      aiAccessCredentialId: "55555555-5555-4555-8555-555555555555",
    });

    expect(status.gaps).toEqual([]);
    expect(JSON.stringify(status)).not.toContain(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(status).not.toHaveProperty("credentialId");
    expect(status).not.toHaveProperty("credentialName");
  });

  it("the agent never gets the runner_ai_commands_disabled gap, and with AI off only project_ai_disabled", async () => {
    const ready: KubernetesClusterAiAccessStatus = await statusOf();

    expect(gapCodes(ready)).not.toContain("runner_ai_commands_disabled");
    expect(ready.runner?.canRunAiCommands).toBe(true);

    const off: KubernetesClusterAiAccessStatus = await statusOf(
      {},
      { ...READY_GATES, isAiEnabled: false },
    );

    expect(gapCodes(off)).toEqual(["project_ai_disabled"]);
    expect(gapCodes(off)).not.toContain(
      "project_ai_command_execution_disabled",
    );
    expect(gapCodes(off)).not.toContain("project_auto_remediation_disabled");
  });
});

describe("KubernetesClusterAiAccessService.getStatusesForSubject reads every cluster's agent in one query", () => {
  const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
    "88888888-8888-4888-8888-888888888888",
  );

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(KubernetesClusterAiAccessService, "getClustersForSubject")
      .mockResolvedValue([
        cluster(),
        cluster({
          id: OTHER_CLUSTER_ID,
          _id: OTHER_CLUSTER_ID.toString(),
          name: "prod-eu",
          clusterIdentifier: "prod-eu",
        }),
      ]);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getProjectGates")
      .mockResolvedValue(READY_GATES);
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses findForClusters once and never findForCluster", async () => {
    const batch: jest.SpyInstance = jest
      .spyOn(KubernetesAiAgentService, "findForClusters")
      .mockResolvedValue(
        new Map<string, KubernetesAiAgent>([[CLUSTER_ID.toString(), agent()]]),
      );
    const single: jest.SpyInstance = jest.spyOn(
      KubernetesAiAgentService,
      "findForCluster",
    );

    const statuses: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesForSubject({
        projectId: PROJECT_ID,
        incidentId: ObjectID.generate(),
      });

    expect(batch).toHaveBeenCalledTimes(1);
    const call: {
      projectId: ObjectID;
      kubernetesClusterIds: Array<ObjectID>;
    } = batch.mock.calls[0]![0] as {
      projectId: ObjectID;
      kubernetesClusterIds: Array<ObjectID>;
    };
    expect(call.projectId).toBe(PROJECT_ID);
    expect(
      call.kubernetesClusterIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([CLUSTER_ID.toString(), OTHER_CLUSTER_ID.toString()]);
    expect(single).not.toHaveBeenCalled();

    expect(statuses[0]?.runner?.kind).toBe("ai_agent");
    expect(statuses[0]?.aiAgent?.id).toBe(AGENT_ID.toString());
    expect(gapCodes(statuses[1]!)).toEqual(["ai_agent_not_connected"]);
    expect(statuses[1]?.aiAgent).toBeNull();
  });

  it("falls back to one read per cluster when the batch read fails", async () => {
    jest
      .spyOn(KubernetesAiAgentService, "findForClusters")
      .mockRejectedValue(new Error("db down"));
    const single: jest.SpyInstance = jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(agent());

    const statuses: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesForSubject({
        projectId: PROJECT_ID,
        alertId: ObjectID.generate(),
      });

    expect(single).toHaveBeenCalledTimes(2);
    expect(statuses).toHaveLength(2);
  });

  it("returns [] without reading anything for a subject with no clusters", async () => {
    (
      KubernetesClusterAiAccessService.getClustersForSubject as unknown as jest.SpyInstance
    ).mockResolvedValue([]);
    const batch: jest.SpyInstance = jest.spyOn(
      KubernetesAiAgentService,
      "findForClusters",
    );

    expect(
      await KubernetesClusterAiAccessService.getStatusesForSubject({
        projectId: PROJECT_ID,
        incidentId: ObjectID.generate(),
      }),
    ).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("KubernetesClusterAiAccessService.getLegacyAgentRunnerForCluster", () => {
  let runnerLookup: jest.SpyInstance;
  let clusterLookup: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    runnerLookup = jest.spyOn(RunnerService, "findOneBy");
    clusterLookup = jest.spyOn(KubernetesClusterService, "findOneBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function find(clusterIdentifier: string | undefined): Promise<Runner | null> {
    return KubernetesClusterAiAccessService.getLegacyAgentRunnerForCluster({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      clusterIdentifier,
    });
  }

  it("finds the row by this cluster's agent name, case-insensitively, in this project", async () => {
    runnerLookup.mockResolvedValue(legacyRunner());

    const runner: Runner | null = await find("prod-us");

    expect(runner?.id).toBe(RUNNER_ID);
    const query: Record<string, unknown> = (
      runnerLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]).toBe(PROJECT_ID);
    // A case-insensitive matcher, not the literal name.
    expect(typeof query["name"]).not.toBe("string");
    expect(query["name"]).toBeDefined();
    expect(clusterLookup).not.toHaveBeenCalled();
  });

  it("refuses the row by that name when its posture names another cluster", async () => {
    runnerLookup.mockResolvedValue(
      legacyRunner({
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
        },
      }),
    );

    expect(await find("prod-us")).toBeNull();
  });

  it("falls back to the cluster's bound Runner when it is this cluster's agent by posture", async () => {
    const byPosture: Runner = legacyRunner({ name: "renamed-runner" });
    runnerLookup.mockResolvedValueOnce(null).mockResolvedValueOnce(byPosture);
    clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));

    expect(await find("prod-us")).toBe(byPosture);
  });

  it("does not return a bound Runner that is not this cluster's agent", async () => {
    runnerLookup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(outsideRunner());
    clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));

    expect(await find("prod-us")).toBeNull();
  });

  it("returns null for a cluster with nothing by that name and nothing bound", async () => {
    runnerLookup.mockResolvedValue(null);
    clusterLookup.mockResolvedValue(cluster());

    expect(await find("prod-us")).toBeNull();
    expect(runnerLookup).toHaveBeenCalledTimes(1);
  });

  it("looks nothing up for a cluster without an identifier", async () => {
    expect(await find(undefined)).toBeNull();
    expect(await find("   ")).toBeNull();
    expect(runnerLookup).not.toHaveBeenCalled();
  });

  /*
   * The AI agent's registration asks this to keep a live Runner's cluster:
   * "could not tell" must not read as "no Runner", or a database hiccup
   * would admit an agent that then outranks a Runner still working.
   */
  it("a failed lookup by name propagates instead of reading as none", async () => {
    runnerLookup.mockRejectedValue(new Error("db down"));

    await expect(find("prod-us")).rejects.toThrow("db down");
  });

  it("a failed read of the cluster's binding propagates", async () => {
    runnerLookup.mockResolvedValue(null);
    clusterLookup.mockRejectedValue(new Error("db down"));

    await expect(find("prod-us")).rejects.toThrow("db down");
  });

  it("a failed read of the bound Runner propagates", async () => {
    runnerLookup
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("db down"));
    clusterLookup.mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));

    await expect(find("prod-us")).rejects.toThrow("db down");
  });
});

describe("a legacy Runner lookup that fails never lets the AI agent in", () => {
  let agentWrites: Array<jest.SpyInstance>;
  let feed: jest.SpyInstance;
  let runnerDeletes: Array<jest.SpyInstance>;

  beforeEach(() => {
    for (const level of ["info", "warn", "error", "debug"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }

    jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockResolvedValue(cluster());
    // The registration's re-read of the cluster succeeds...
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(cluster({ aiAccessRunnerId: RUNNER_ID }));
    // ...but the Runner table cannot be read.
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockRejectedValue(new Error("db down"));
    jest.spyOn(KubernetesAiAgentService, "findOneBy").mockResolvedValue(null);
    // Nothing else would stop a new agent row: the caps have room.
    jest
      .spyOn(KubernetesAiAgentService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterService, "updateOneBy")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockResolvedValue(undefined as never);

    agentWrites = (
      [
        "create",
        "updateOneById",
        "updateOneBy",
        "updateColumnsByIdWithoutHooks",
      ] as const
    ).map((method: string) => {
      return jest
        .spyOn(KubernetesAiAgentService, method as never)
        .mockResolvedValue(undefined as never);
    });
    runnerDeletes = (
      ["deleteBy", "deleteOneBy", "deleteOneById", "hardDeleteBy"] as const
    ).map((method: string) => {
      return jest
        .spyOn(RunnerService, method as never)
        .mockResolvedValue(0 as never);
    });
    feed = jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("registration fails (the agent retries) and writes no agent row, key or feed item", async () => {
    await expect(
      KubernetesAiAgentService.register({
        projectId: PROJECT_ID,
        clusterName: "prod-us",
        posture: { inCluster: true, allowWrites: true },
      }),
    ).rejects.toThrow("db down");

    for (const write of agentWrites) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(feed).not.toHaveBeenCalled();
  });

  it("negative control: the same registration is admitted once the Runner table reads as empty", async () => {
    (RunnerService.findOneBy as unknown as jest.SpyInstance).mockResolvedValue(
      null,
    );
    (
      KubernetesAiAgentService.create as unknown as jest.SpyInstance
    ).mockImplementation(async (args: unknown): Promise<KubernetesAiAgent> => {
      const row: KubernetesAiAgent = (args as { data: KubernetesAiAgent }).data;
      row.id = AGENT_ID;
      return row;
    });

    const result: { agentId: ObjectID } =
      await KubernetesAiAgentService.register({
        projectId: PROJECT_ID,
        clusterName: "prod-us",
        posture: { inCluster: true, allowWrites: true },
      });

    expect(result.agentId.toString()).toBe(AGENT_ID.toString());
  });

  it("the lazy retirement reads it as a failed check and deletes nothing", async () => {
    const outcome: string =
      await KubernetesAiAgentService.retireLegacyRunnerIfUnused({
        // A fresh id: the check is throttled per agent per process.
        agent: agent({
          id: ObjectID.generate(),
          createdAt: OneUptimeDate.getSomeDaysAgo(3),
        }),
        cluster: cluster(),
      });

    expect(outcome).toBe("failed");
    for (const remove of runnerDeletes) {
      expect(remove).not.toHaveBeenCalled();
    }
    expect(feed).not.toHaveBeenCalled();
  });
});
