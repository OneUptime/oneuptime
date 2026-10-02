import KubernetesClusterAiAccessService, {
  AI_AGENT_INSTALL_COMMAND,
  AI_AGENT_NOT_CONNECTED_NEXT_STEP,
  AI_BALANCE_INSUFFICIENT_NEXT_STEP,
  CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  KubernetesAgentRegistrationRefusedException,
  KubernetesClusterAiAccessProjectGates,
  MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT,
  MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
  MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR,
  RegisterKubernetesAgentRunnerResult,
  REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  getKubernetesAgentRunnerNameForCluster,
  getPreviousInstanceRetryAfterSeconds,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import AIService from "../../../Server/Services/AIService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
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
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  getKubernetesAgentRunnerName,
  isTransientKubernetesAgentRegistrationRefusal,
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
 * - "in-cluster" access is only ever the in-cluster Runner OF THIS CLUSTER:
 *   a bound Runner that runs inside a different cluster (or never said
 *   which) is a gap, never credential-less access to the wrong cluster;
 * - investigation and remediation readiness are independent: a gap that
 *   only blocks remediation never reads as "AI cannot investigate";
 * - registration with the ingestion key creates the agent Runner row with
 *   exactly the kubectl capability (never runbooks or code fixes), binds a
 *   never-configured cluster with investigation on and remediation
 *   "ask for approval" when the chart granted writes (keeping a mode an
 *   operator chose beforehand), rotates the key on a restart WITHOUT
 *   touching the operator's switches, never steals a
 *   cluster an operator bound to a different Runner, never re-binds a
 *   cluster an operator cleared, only reuses a Runner that is THIS
 *   cluster's agent, refuses to re-key a Runner that is online unless the
 *   caller proves it holds the current key, bounds how many agent Runner
 *   rows an ingestion key can mint, and records every bind and rotation on
 *   the cluster's feed.
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
    /*
     * What registration gives an agent row. Readiness now reads these for
     * an offline agent row (they would block its re-registration), so the
     * fixture carries the agent defaults rather than leaving them unset
     * (which reads as "Runs Runbooks" on).
     */
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

const AGENT_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

// This cluster's Kubernetes AI agent row, online and able to write.
function fakeAgent(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    lastRegisteredAt: OneUptimeDate.getSomeMinutesAgo(60),
    agentVersion: "14.1.0",
    posture: {
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.36.4",
    },
    ...overrides,
  } as unknown as KubernetesAiAgent;
}

function gapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map((gap: KubernetesAiAccessGap) => {
    return gap.code;
  });
}

describe("KubernetesClusterAiAccessService.getStatusForClusterModel", () => {
  /*
   * What an offline agent Runner of this cluster holds beyond the agent
   * defaults (readiness asks, because holdings stop it re-registering).
   * Nothing, unless a test says otherwise.
   */
  let credentialCountSpy: jest.SpyInstance;
  let secretCountSpy: jest.SpyInstance;
  let boundClusterCountSpy: jest.SpyInstance;
  let agentLookup: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    credentialCountSpy = jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    secretCountSpy = jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    boundClusterCountSpy = jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // No Kubernetes AI agent unless a test says otherwise.
    agentLookup = jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(null);
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

  /*
   * The Runner's write scope reaches the status (and so the AI page and
   * the planner) as the Runner reported it: the namespaces it lets AI
   * change, its own namespace, and whether node operations are allowed.
   */
  it("reports the bound Runner's write scope in its posture", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: true,
            clusterIdentifier: "prod-us",
            writeNamespaces: ["web", "api"],
            podNamespace: "oneuptime-agent",
            allowNodeOperations: false,
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(status.runner?.posture?.writeNamespaces).toEqual(["web", "api"]);
    expect(status.runner?.posture?.podNamespace).toBe("oneuptime-agent");
    expect(status.runner?.posture?.allowNodeOperations).toBe(false);
  });

  it("reports ai_agent_not_connected with the install command and blocks both when nothing can reach the cluster", async () => {
    /*
     * No binding and no agent row: nothing to read but the agent. The
     * status no longer looks for an unbound previous in-cluster Runner —
     * the chart upgrade that installs the agent is the one step.
     */
    const findOneBy: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessRunnerId: undefined }),
        gates: READY_GATES,
      });

    expect(findOneBy).not.toHaveBeenCalled();
    expect(agentLookup).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
    });
    expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
    expect(status.gaps[0]?.blocks).toBe("both");
    expect(status.gaps[0]?.title).toBe(
      "The Kubernetes AI agent is not connected",
    );
    expect(status.gaps[0]?.nextStep).toBe(AI_AGENT_NOT_CONNECTED_NEXT_STEP);
    expect(status.gaps[0]?.nextStep).toContain(AI_AGENT_INSTALL_COMMAND);
    expect(status.gaps[0]?.nextStep).not.toContain("aiAccess");
    // Nothing selected, so nothing said about an ignored Runner.
    expect(status.gaps[0]?.description).toBe(
      "OneUptime AI runs kubectl on this cluster through the Kubernetes AI agent, and no agent has connected for this cluster yet.",
    );
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
    expect(status.runner).toBeNull();
    expect(status.aiAgent).toBeNull();
    expect(status.accessMethod).toBe("none");
  });

  it("never produces no_runner_bound any more", async () => {
    for (const aiAccessRunnerId of [undefined, RUNNER_ID]) {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).not.toContain("no_runner_bound");
    }
  });

  /*
   * The FK on aiAccessRunnerId is ON DELETE SET NULL, so deleting the bound
   * Runner clears the binding in the same statement: the only way to see a
   * bound id with no Runner row is the race between reading the cluster and
   * reading its Runner while a delete lands.
   */
  it("reports runner_missing only for the race with a Runner delete, and says so", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["runner_missing"]);
    expect(status.gaps[0]?.title).toBe("The bound Runner was just deleted");
    /*
     * Gap next steps are shown verbatim on incident pages too, where "this
     * page" would be the incident. They name the cluster's AI agent page.
     */
    expect(status.gaps[0]?.nextStep).toBe(
      "Reload the cluster's AI agent page (AI → Agent).",
    );
    expect(status.gaps[0]?.nextStep).not.toContain("this page");
    expect(status.isInvestigationReady).toBe(false);
  });

  it("negative control: a bound Runner that vanished while the cluster has an agent reads as the agent", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);
    agentLookup.mockResolvedValue(fakeAgent());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual([]);
    expect(status.runner?.kind).toBe("ai_agent");
  });

  /*
   * A previous in-cluster Runner that is registered but not bound (its
   * binding was cleared, or it was deleted and registered again) is not an
   * access target: only a bound Runner is. The cluster uses its AI agent.
   */
  describe("an unbound previous in-cluster Runner", () => {
    it("is not looked up or used: the install step is the next step", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(fakeRunner());

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(findOneBy).not.toHaveBeenCalled();
      expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
      expect(status.runner).toBeNull();
    });

    it("never throws: a failed agent lookup reads as no agent", async () => {
      agentLookup.mockRejectedValue(new Error("db down"));

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
      expect(status.aiAgent).toBeNull();
    });

    it("never throws: with a failed agent lookup a bound, online previous Runner still serves", async () => {
      agentLookup.mockRejectedValue(new Error("db down"));
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual([]);
      expect(status.runner?.kind).toBe("runner");
    });
  });

  /*
   * A Runner that signs off (/runner-ingest/disconnect — what a helm
   * upgrade or uninstall does to the previous in-cluster Runner's pod) is
   * offline at once, not "Connected" until its last heartbeat ages out.
   */
  describe("a Runner that signed off", () => {
    it("the previous in-cluster Runner: offline, blocks both, and the step is the chart upgrade to the AI agent", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          fakeRunner({
            lastAlive: OneUptimeDate.getCurrentDate(),
            connectionStatus: RunnerConnectionStatus.Disconnected,
          }),
        );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.runner?.isOnline).toBe(false);
      expect(status.runner?.kind).toBe("runner");
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
      expect(gapCodes(status)).toEqual(["runner_offline"]);
      expect(status.gaps[0]?.title).toBe(
        "The previous in-cluster Runner signed off",
      );
      expect(status.gaps[0]?.nextStep).toContain(
        "Upgrade the Kubernetes agent chart: the Kubernetes AI agent replaces this Runner",
      );
      expect(status.gaps[0]?.nextStep).toContain(AI_AGENT_INSTALL_COMMAND);
      expect(status.gaps[0]?.nextStep).not.toContain("aiAccess.enabled=true");
      expect(status.gaps[0]?.nextStep).not.toContain("component=ai-runner");

      // The sign-off is read, not guessed.
      const select: Record<string, unknown> = (
        findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;
      expect(select["connectionStatus"]).toBe(true);
    });

    it("uses plain copy for a dashboard Runner that signed off", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "office-runner",
          hostInfo: { hostname: "x" },
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.code).toBe("runner_offline");
      expect(status.gaps[0]?.title).toBe("The Runner signed off");
      expect(status.gaps[0]?.nextStep).toContain("Start the Runner container");
      expect(status.gaps[0]?.nextStep).toContain(
        "clear the Runner on the cluster's AI agent page (AI → Agent) to use the Kubernetes AI agent",
      );
    });

    it("negative control: the same Runner Connected is online and ready", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: OneUptimeDate.getCurrentDate(),
          connectionStatus: RunnerConnectionStatus.Connected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.runner?.isOnline).toBe(true);
      expect(status.gaps).toEqual([]);
      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(true);
    });

    it("negative control: a row that never heartbeated is 'never connected', not 'signed off'", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "office-runner",
          hostInfo: {},
          lastAlive: undefined,
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.title).toBe("The Runner has never connected");
    });

    it("negative control: a previous in-cluster Runner that never heartbeated is offline, not 'signed off'", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: undefined,
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.title).toBe(
        "The previous in-cluster Runner is offline",
      );
    });

    /*
     * An offline previous in-cluster Runner that holds more than the agent
     * defaults could not re-register — but it no longer has to: the chart
     * upgrade installs the AI agent, which needs none of it. So the status
     * no longer counts what the row holds.
     */
    it("never counts what an offline previous in-cluster Runner holds: the step is the chart upgrade", async () => {
      credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          connectionStatus: RunnerConnectionStatus.Disconnected,
          canRunRunbooks: true,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["runner_offline"]);
      expect(status.gaps[0]?.nextStep).toContain(AI_AGENT_INSTALL_COMMAND);
      expect(credentialCountSpy).not.toHaveBeenCalled();
      expect(secretCountSpy).not.toHaveBeenCalled();
      expect(boundClusterCountSpy).not.toHaveBeenCalled();
    });

    it("still reports the sign-off once the last heartbeat has also aged out", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      // Signed off AND stale: the sign-off is the more precise explanation.
      expect(status.gaps[0]?.title).toBe(
        "The previous in-cluster Runner signed off",
      );
      expect(status.runner?.isOnline).toBe(false);
    });
  });

  it("reports runner_offline (never connected vs stale) and keeps the Runner summary", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        name: "office-runner",
        hostInfo: {},
        lastAlive: undefined,
      }),
    );

    const never: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(never)).toContain("runner_offline");
    expect(never.gaps[0]?.title).toContain("never connected");
    expect(never.runner?.isOnline).toBe(false);

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
    expect(stale.gaps[0]?.title).toBe(
      "The previous in-cluster Runner is offline",
    );
    expect(stale.gaps[0]?.description).toContain("last reported in at");
    expect(stale.runner?.name).toBe("kubernetes-agent/prod-us");
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

  /*
   * The cross-cluster hole: the dashboard lets an operator bind ANY Runner,
   * and a Runner that is in-cluster in cluster B would run every command
   * for cluster A against B's ServiceAccount. In-cluster access therefore
   * exists only for the Runner whose posture names THIS cluster.
   */
  describe("in-cluster access is only the in-cluster Runner of this cluster", () => {
    /*
     * A kubernetes-agent Runner of ANOTHER cluster bound here (the binding
     * guard refuses it for new writes; older rows may still hold one) is
     * never an access target: its ServiceAccount reaches only its own
     * cluster, and it is neither the advanced Runner an operator chose nor
     * this cluster's previous in-cluster Runner.
     */
    it("never uses the in-cluster Runner of a different cluster: without an agent nothing reaches this one", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
      expect(status.gaps[0]?.blocks).toBe("both");
      expect(status.accessMethod).toBe("none");
      expect(status.credentialId).toBeUndefined();
      expect(status.runner).toBeNull();
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
    });

    it("with this cluster's AI agent, the other cluster's bound Runner is ignored and the agent serves", async () => {
      agentLookup.mockResolvedValue(fakeAgent());
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.gaps).toEqual([]);
      expect(status.runner?.kind).toBe("ai_agent");
      expect(status.runner?.id).toBe(AGENT_ID.toString());
    });

    it("refuses a pod Runner that never said which cluster it runs in", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: { kubernetes: { inCluster: true, allowWrites: true } },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["runner_cluster_mismatch"]);
      expect(status.gaps[0]?.title).toBe(
        "The bound Runner did not report which cluster it runs in",
      );
      expect(status.gaps[0]?.description).toBe(
        'Runner "pod-runner" reports that it runs inside a Kubernetes cluster but not which one, so OneUptime AI cannot tell whether that is this cluster.',
      );
      expect(status.accessMethod).toBe("none");
      expect(status.isInvestigationReady).toBe(false);
    });

    it("never treats a blank cluster identifier on the cluster row as a match", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ clusterIdentifier: "" }),
          gates: READY_GATES,
        });

      // A cluster without an identifier has no previous in-cluster Runner.
      expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
      expect(status.accessMethod).toBe("none");
    });

    it("matches the cluster identifier case-insensitively and with surrounding whitespace", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "  PROD-us ",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ clusterIdentifier: "prod-us" }),
          gates: READY_GATES,
        });

      expect(status.gaps).toEqual([]);
      expect(status.accessMethod).toBe("in_cluster");
      expect(status.isInvestigationReady).toBe(true);
    });

    /*
     * A kubernetes-agent Runner is minted and re-keyed with the telemetry
     * ingestion key, so it is never handed credential material. Such a row
     * of another cluster — by its name marker, its posture, or a case
     * variant of the marker — is not an access target at all now, so the
     * credential selected with it is never even read, let alone used.
     */
    it.each([
      [
        "another cluster's agent row",
        {
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        },
        ' (it reports cluster "prod-eu")',
      ],
      [
        "an agent row whose heartbeat dropped its posture (the server-owned NAME)",
        { name: "kubernetes-agent/prod-eu", hostInfo: {} },
        "",
      ],
      [
        "a row with another cluster's agent posture but no marker (name OR posture)",
        {
          name: "prod-eu in-cluster runner",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        },
        ' (it reports cluster "prod-eu")',
      ],
      [
        "a case variant of the marker",
        { name: "Kubernetes-Agent/prod-eu", hostInfo: {} },
        "",
      ],
    ])(
      "never uses a credential with %s: it is no access target",
      async (
        _label: string,
        runner: Record<string, unknown>,
        reported: string,
      ) => {
        jest
          .spyOn(RunnerService, "findOneBy")
          .mockResolvedValue(fakeRunner(runner));
        const credentialLookup: jest.SpyInstance = jest
          .spyOn(RunbookCredentialService, "findOneBy")
          .mockResolvedValue({
            id: CREDENTIAL_ID,
            _id: CREDENTIAL_ID.toString(),
            name: "prod-us kubeconfig",
            credentialType: "Kubernetes",
            runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
          } as unknown as RunbookCredential);

        const status: KubernetesClusterAiAccessStatus =
          await KubernetesClusterAiAccessService.getStatusForClusterModel({
            cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
            gates: READY_GATES,
          });

        expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
        expect(gapCodes(status)).not.toContain("credential_on_agent_runner");
        /*
         * The status still says a Runner is selected and why it is not
         * used, rather than reading as if nothing were bound.
         */
        expect(status.gaps[0]?.description).toContain(
          `Runner "${String(runner["name"])}" is still selected for this cluster, but it is not this cluster's in-cluster Runner${reported}, so OneUptime AI does not use it.`,
        );
        expect(status.gaps[0]?.nextStep).toBe(AI_AGENT_NOT_CONNECTED_NEXT_STEP);
        expect(status.runner).toBeNull();
        expect(status.accessMethod).toBe("none");
        expect(status.credentialId).toBeUndefined();
        expect(status.isInvestigationReady).toBe(false);
        expect(credentialLookup).not.toHaveBeenCalled();
      },
    );

    /*
     * Before round two this fixture reported a cluster identity too (an
     * agent posture). An ordinary Runner in a pod never does — only the
     * kubernetes-agent binary reports one — and such a posture now marks
     * the row as an agent (the case above).
     */
    it("negative control: a dashboard Runner that happens to live in a pod still uses an assigned credential", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
            },
          },
        }),
      );
      jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
        id: CREDENTIAL_ID,
        _id: CREDENTIAL_ID.toString(),
        name: "prod-us kubeconfig",
        credentialType: "Kubernetes",
        runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
      } as unknown as RunbookCredential);

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      // The credential names the API server, so the pod's cluster is moot.
      expect(status.gaps).toEqual([]);
      expect(status.accessMethod).toBe("credential");
      expect(status.credentialId).toBe(CREDENTIAL_ID.toString());
    });

    it("negative control: THIS cluster's agent with a credential also selected stays in-cluster (the credential is ignored)", async () => {
      const credentialLookup: jest.SpyInstance = jest.spyOn(
        RunbookCredentialService,
        "findOneBy",
      );
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      expect(status.gaps).toEqual([]);
      expect(status.accessMethod).toBe("in_cluster");
      expect(status.credentialId).toBeUndefined();
      expect(credentialLookup).not.toHaveBeenCalled();
    });

    it("still reports the credential gap, not a mismatch, when the bound credential is unusable", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          /*
           * A dashboard Runner living in a pod: an agent row here would be
           * the credential_on_agent_runner case above. Before round two
           * this fixture also named a cluster — an agent posture, which
           * only the kubernetes-agent binary reports and which now marks
           * the row as an agent on its own.
           */
          name: "pod-runner",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
            },
          },
        }),
      );
      jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(null);

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["credential_missing"]);
      expect(status.accessMethod).toBe("none");
    });

    it("a row named for this cluster whose posture names another is not this cluster's previous Runner", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: false,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
    });
  });

  it("blocks only remediation when the previous in-cluster Runner is read-only, and says to upgrade to the AI agent", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-us",
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_write_access_missing"]);
    expect(status.gaps[0]?.blocks).toBe("remediation");
    expect(status.gaps[0]?.title).toBe(
      "The previous in-cluster Runner is read-only",
    );
    expect(status.gaps[0]?.nextStep).toBe(
      LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
    );
    expect(status.gaps[0]?.nextStep).toContain(
      "--set aiAgent.remediation.enabled=true",
    );
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("an in-cluster pod Runner outside the chart that cannot write is told to use its own environment", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        name: "pod-runner",
        hostInfo: { kubernetes: { inCluster: true, allowWrites: false } },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    const gap: KubernetesAiAccessGap | undefined = status.gaps.find(
      (candidate: KubernetesAiAccessGap) => {
        return candidate.code === "remediation_write_access_missing";
      },
    );

    expect(gap?.title).toBe("The Runner is read-only");
    expect(gap?.nextStep).toBe(
      CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
    );
  });

  /*
   * The read-only gap names the value that grants writes and the two that
   * bound where the write role reaches; the complete command lives on the
   * cluster's AI agent page, which it names (never "this page").
   */
  it("points the read-only gap at the AI agent page and the aiAgent values that scope it", () => {
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "--set aiAgent.remediation.enabled=true",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "the cluster's AI agent page (AI → Agent)",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "aiAgent.remediation.namespaces",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "aiAgent.remediation.nodeOperations=false",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain("cluster-wide");
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain("this page");
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain("aiAccess");
  });

  it("does not raise the read-only gap when remediation is off", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-us",
          },
        },
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
          hasLlmProvider: false,
          aiBalanceBlocker: "This project's AI credit balance is used up.",
        },
      });

    /*
     * Enable AI is the project's only AI switch: the auto-remediation and
     * command-execution switches it replaced have no gaps any more.
     */
    expect(gapCodes(status)).toEqual([
      "project_ai_disabled",
      "llm_provider_missing",
      "ai_balance_insufficient",
    ]);
    expect(gapCodes(status)).not.toContain("project_auto_remediation_disabled");
    expect(gapCodes(status)).not.toContain(
      "project_ai_command_execution_disabled",
    );
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
  });

  it("ai_balance_insufficient carries the reason, blocks both and says where credits are added", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: {
          ...READY_GATES,
          aiBalanceBlocker: "This project's AI credit balance is used up.",
        },
      });

    expect(gapCodes(status)).toEqual(["ai_balance_insufficient"]);
    expect(status.gaps[0]).toEqual({
      code: "ai_balance_insufficient",
      title: "The project is out of AI credits",
      description: "This project's AI credit balance is used up.",
      nextStep:
        "Add AI credits under Project Settings → AI Credits (or enable auto-recharge).",
      blocks: "both",
    });
    expect(status.gaps[0]?.nextStep).toBe(AI_BALANCE_INSUFFICIENT_NEXT_STEP);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
  });

  it("negative control: no blocker (null or absent) is no balance gap", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    for (const aiBalanceBlocker of [null, undefined, ""]) {
      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: { ...READY_GATES, aiBalanceBlocker },
        });

      expect(gapCodes(status)).toEqual([]);
    }
  });

  /*
   * Enable AI is the project's only AI switch. "Enable AI command
   * execution" used to hold back a cluster reached through an advanced
   * Runner (project_ai_command_execution_disabled) and "Enable
   * auto-remediation" every fix (project_auto_remediation_disabled). Both
   * were folded into Enable AI, so no access target needs another project
   * switch, and with AI off the one project gap is project_ai_disabled.
   */
  describe("Enable AI is the only project switch an access target needs", () => {
    const AI_OFF: KubernetesClusterAiAccessProjectGates = {
      ...READY_GATES,
      isAiEnabled: false,
    };

    function bindAdvancedRunnerWithCredential(): void {
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
    }

    it("an advanced Runner with a credential: no command-execution gap, remediation ready", async () => {
      bindAdvancedRunnerWithCredential();

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      expect(status.accessMethod).toBe("credential");
      expect(gapCodes(status)).toEqual([]);
      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(true);
    });

    it("an advanced Runner with Enable AI off: project_ai_disabled blocks both, with the AI Features step", async () => {
      bindAdvancedRunnerWithCredential();

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: AI_OFF,
        });

      expect(gapCodes(status)).toEqual(["project_ai_disabled"]);
      expect(status.gaps[0]?.blocks).toBe("both");
      expect(status.gaps[0]?.nextStep).toBe(
        "Enable AI under Project Settings → AI Features.",
      );
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
    });

    it("the Kubernetes AI agent: remediation ready, and project_ai_disabled alone when AI is off", async () => {
      agentLookup.mockResolvedValue(fakeAgent());

      const ready: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(gapCodes(ready)).toEqual([]);
      expect(ready.isRemediationReady).toBe(true);

      const off: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: AI_OFF,
        });

      expect(gapCodes(off)).toEqual(["project_ai_disabled"]);
    });

    it("the previous in-cluster Runner: remediation ready, and project_ai_disabled alone when AI is off", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

      const ready: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(ready)).toEqual([]);
      expect(ready.isRemediationReady).toBe(true);

      const off: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: AI_OFF,
        });

      expect(gapCodes(off)).toEqual(["project_ai_disabled"]);
    });

    it("nothing connected: the connection gap says it all, and AI off adds only project_ai_disabled", async () => {
      const ready: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(gapCodes(ready)).toEqual(["ai_agent_not_connected"]);

      const off: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: AI_OFF,
        });

      expect(gapCodes(off)).toEqual([
        "ai_agent_not_connected",
        "project_ai_disabled",
      ]);
    });
  });

  it("is remediation-ready in BypassApproval mode with a write-capable Runner and reports the mode verbatim", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        gates: READY_GATES,
      });

    expect(status.gaps).toEqual([]);
    expect(status.remediationMode).toBe(
      KubernetesAiRemediationMode.BypassApproval,
    );
    expect(status.isRemediationReady).toBe(true);
    expect(status.isInvestigationReady).toBe(true);
  });

  it("raises the read-only gap for a BypassApproval cluster whose Runner cannot write", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-us",
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_write_access_missing"]);
    expect(status.remediationMode).toBe(
      KubernetesAiRemediationMode.BypassApproval,
    );
    expect(status.isRemediationReady).toBe(false);
    expect(status.isInvestigationReady).toBe(true);
  });

  it("names every enabling mode in the remediation_disabled next step", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
        gates: READY_GATES,
      });

    expect(status.gaps[0]?.code).toBe("remediation_disabled");
    expect(status.gaps[0]?.nextStep).toContain("Ask for approval");
    expect(status.gaps[0]?.nextStep).toContain("Automatic");
    expect(status.gaps[0]?.nextStep).toContain("Bypass approval");
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

describe("KubernetesClusterAiAccessService.normalizeRemediationMode", () => {
  it("accepts every declared mode verbatim", () => {
    for (const mode of Object.values(KubernetesAiRemediationMode)) {
      expect(
        KubernetesClusterAiAccessService.normalizeRemediationMode(mode),
      ).toBe(mode);
    }
  });

  it("fails closed to Disabled for anything else, including case variants", () => {
    for (const value of [
      undefined,
      null,
      "",
      "automatic",
      "bypassapproval",
      "Bypass",
      "BYPASSAPPROVAL",
      " BypassApproval",
      42,
      true,
      {},
      ["BypassApproval"],
    ]) {
      expect(
        KubernetesClusterAiAccessService.normalizeRemediationMode(value),
      ).toBe(KubernetesAiRemediationMode.Disabled);
    }
  });
});

describe("KubernetesClusterAiAccessService.getFirstBindRemediationMode", () => {
  it("fills in the chart's intent only when the mode is still at its default", () => {
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: KubernetesAiRemediationMode.Disabled,
        allowWrites: true,
      }),
    ).toBe(KubernetesAiRemediationMode.RequireApproval);
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: KubernetesAiRemediationMode.Disabled,
        allowWrites: false,
      }),
    ).toBe(KubernetesAiRemediationMode.Disabled);
    // A missing or unrecognised value is the default too.
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: undefined,
        allowWrites: true,
      }),
    ).toBe(KubernetesAiRemediationMode.RequireApproval);
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: "bypassapproval",
        allowWrites: true,
      }),
    ).toBe(KubernetesAiRemediationMode.RequireApproval);
  });

  it("keeps every mode an operator chose, whatever the chart granted", () => {
    for (const chosen of [
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.Automatic,
      KubernetesAiRemediationMode.BypassApproval,
    ]) {
      for (const allowWrites of [true, false]) {
        expect(
          KubernetesClusterAiAccessService.getFirstBindRemediationMode({
            currentMode: chosen,
            allowWrites,
          }),
        ).toBe(chosen);
      }
    }
  });
});

describe("KubernetesClusterAiAccessService.getProjectGates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The keys getProjectGates returns: Enable AI's and nothing it replaced.
  const PROJECT_GATE_KEYS: Array<string> = [
    "aiBalanceBlocker",
    "automaticInvestigation",
    "hasLlmProvider",
    "isAiEnabled",
  ];

  function mockProviderAndBalance(): void {
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as LlmProvider);
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
  }

  it("reads Enable AI as on unless it is exactly false (the kill switch idiom)", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: undefined,
    } as unknown as Project);
    mockProviderAndBalance();

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates).toEqual({
      isAiEnabled: true,
      hasLlmProvider: true,
      aiBalanceBlocker: null,
      // Absent reads as off: the investigation opt-ins count only when true.
      automaticInvestigation: { incidents: false, alerts: false },
    });
  });

  /*
   * The project row is read for Enable AI and the two investigation
   * opt-ins, and for nothing else: Enable AI is the project's only AI
   * switch, so the columns it replaced are never selected.
   */
  it("selects Enable AI and the investigation opt-ins, and never a retired switch", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ enableAi: true } as unknown as Project);
    mockProviderAndBalance();

    await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: {
        enableAi: true,
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticAlertInvestigation: true,
      },
      props: { isRoot: true },
    });

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(Object.keys(select)).not.toContain("enableAutoRemediation");
    expect(Object.keys(select)).not.toContain("enableAiCommandExecution");
  });

  it.each<[string, Project | null, boolean]>([
    ["Enable AI on", { enableAi: true } as unknown as Project, true],
    ["Enable AI off", { enableAi: false } as unknown as Project, false],
    ["Enable AI not selected", {} as unknown as Project, true],
    // A missing row reads like one that never set the column.
    ["no project row", null, true],
  ])(
    "returns only the project's gates: %s",
    async (_label: string, project: Project | null, isAiEnabled: boolean) => {
      jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
      mockProviderAndBalance();

      const gates: KubernetesClusterAiAccessProjectGates =
        await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

      expect(Object.keys(gates).sort()).toEqual(PROJECT_GATE_KEYS);
      expect(gates.isAiEnabled).toBe(isAiEnabled);
      expect(gates).not.toHaveProperty("isAutoRemediationEnabled");
      expect(gates).not.toHaveProperty("isAiCommandExecutionEnabled");
    },
  );

  /*
   * A row that still carries the columns Enable AI replaced (a replica of
   * the previous build reading it mid-rollout, or a fixture) cannot switch
   * anything off: only Enable AI is read.
   */
  it("ignores the retired switches on a row that still carries them", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      enableAutoRemediation: false,
      enableAiCommandExecution: false,
    } as unknown as Project);
    mockProviderAndBalance();

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates).toEqual({
      isAiEnabled: true,
      hasLlmProvider: true,
      aiBalanceBlocker: null,
      automaticInvestigation: { incidents: false, alerts: false },
    });
  });

  it("treats a provider lookup failure as no provider, and does not check the balance without one", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockRejectedValue(new Error("boom"));
    const blocker: jest.SpyInstance = jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue("out of credits");

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates.hasLlmProvider).toBe(false);
    expect(gates.isAiEnabled).toBe(true);
    // Unknown, so unsaid: not a second (failing) provider lookup.
    expect(blocker).not.toHaveBeenCalled();
    expect(gates.aiBalanceBlocker).toBeNull();
  });

  it("reads the project's automatic-investigation opt-ins (exactly true) for the AI agent page", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: false,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(null);
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates.automaticInvestigation).toEqual({
      incidents: true,
      alerts: false,
    });
  });

  it("asks AIService for the AI balance blocker with the provider it already resolved, and carries its reason", async () => {
    const provider: LlmProvider = {
      id: ObjectID.generate(),
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: 100,
    } as unknown as LlmProvider;
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({} as unknown as Project);
    const providerLookup: jest.SpyInstance = jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(provider);
    const blocker: jest.SpyInstance = jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue("out of credits");

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(blocker).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      llmProvider: provider,
    });
    expect(gates.aiBalanceBlocker).toBe("out of credits");
    expect(providerLookup).toHaveBeenCalledTimes(1);
  });

  it("treats a balance check that fails as no blocker (the AI call still refuses on its own)", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({} as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as LlmProvider);
    jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockRejectedValue(new Error("db down"));

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates.aiBalanceBlocker).toBeNull();
    expect(gates.hasLlmProvider).toBe(true);
  });
});

describe("KubernetesClusterAiAccessService.registerKubernetesAgentRunner", () => {
  const OTHER_RUNNER_ID: ObjectID = new ObjectID(
    "66666666-6666-4666-8666-666666666666",
  );
  // Hex letters on purpose: the case-variant near-miss below must differ.
  const CURRENT_KEY: string = "9a9b9c9d-9e9f-4a9b-8c9d-9e9f9a9b9c9d";

  let clusterUpdates: Array<Record<string, unknown>>;
  let runnerUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  let createdRunner: Runner | null;
  let feedItems: Array<Record<string, unknown>>;
  let countBySpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  // What an unproven re-key checks the row holds beyond the agent defaults.
  let credentialCountSpy: jest.SpyInstance;
  let secretCountSpy: jest.SpyInstance;
  let boundClusterCountSpy: jest.SpyInstance;

  /*
   * An agent Runner row as the last heartbeat left it, OFFLINE: the pod it
   * belonged to stopped half an hour ago, which is the restart case that
   * must always be admitted. It holds exactly what registration gave it:
   * kubectl only, no runbooks, no code fixes.
   */
  function offlineAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return fakeRunner({
      key: CURRENT_KEY,
      lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
      connectionStatus: RunnerConnectionStatus.Connected,
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      ...overrides,
    });
  }

  // The same row while its pod is still heartbeating.
  function onlineAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return fakeRunner({
      key: CURRENT_KEY,
      lastAlive: OneUptimeDate.getCurrentDate(),
      connectionStatus: RunnerConnectionStatus.Connected,
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      ...overrides,
    });
  }

  // The row after its pod signed off on a clean shutdown (a helm upgrade).
  function signedOffAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return onlineAgentRunner({
      connectionStatus: RunnerConnectionStatus.Disconnected,
      ...overrides,
    });
  }

  /*
   * Answers the two Runner lookups registration makes — by agent name, and
   * by bound id — separately, so a test can put a different row behind
   * each. Registration finds the row it re-keys by NAME only, so without an
   * explicit `byName` the name lookup answers with the bound row exactly
   * when that row carries the name being looked up (compared the way
   * findWithSameText compares), as Postgres would.
   */
  function mockRunnerLookups(data: {
    bound?: Runner | null | undefined;
    byName?: Runner | null | undefined;
  }): jest.SpyInstance {
    return jest
      .spyOn(RunnerService, "findOneBy")
      .mockImplementation(async (args: unknown): Promise<Runner | null> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["_id"]) {
          return data.bound ?? null;
        }

        if (data.byName !== undefined) {
          return data.byName;
        }

        const nameFilter: {
          objectLiteralParameters?: Record<string, unknown>;
        } = query["name"] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
        const lookedUp: unknown = Object.values(
          nameFilter?.objectLiteralParameters || {},
        )[0];

        return data.bound &&
          typeof lookedUp === "string" &&
          (data.bound.name || "").trim().toLowerCase() === lookedUp
          ? data.bound
          : null;
      });
  }

  beforeEach(() => {
    clusterUpdates = [];
    runnerUpdates = [];
    createdRunner = null;
    feedItems = [];

    warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

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
        const call: { id: ObjectID; data: Record<string, unknown> } = args as {
          id: ObjectID;
          data: Record<string, unknown>;
        };
        runnerUpdates.push({ id: call.id.toString(), data: call.data });
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
    countBySpy = jest
      .spyOn(RunnerService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    credentialCountSpy = jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    secretCountSpy = jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    boundClusterCountSpy = jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockImplementation(async (args: unknown): Promise<void> => {
        feedItems.push(args as Record<string, unknown>);
      });
    // No Kubernetes AI agent unless a test says otherwise.
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(null);
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

  describe("first bind of a never-configured cluster", () => {
    // A cluster row as ingest creates it: every AI switch at its default.
    function neverConfiguredCluster(
      overrides: Partial<Record<string, unknown>> = {},
    ): KubernetesCluster {
      return fakeCluster({
        aiAccessRunnerId: undefined,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        ...overrides,
      });
    }

    /*
     * The write scope the Runner reports at registration is stored at once,
     * so the enqueue chokepoint (and the AI page) know it before the first
     * heartbeat — and the service, not the body, says which cluster and that
     * it is in-cluster.
     */
    it("stores the Runner's reported write scope with the posture, the cluster identity its own", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(neverConfiguredCluster());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: {
          allowWrites: true,
          writeNamespaces: ["web"],
          podNamespace: "oneuptime-agent",
          allowNodeOperations: false,
          clusterIdentifier: "someone-else",
          inCluster: false,
        },
      });

      expect(
        (createdRunner!.hostInfo as { kubernetes: Record<string, unknown> })
          .kubernetes,
      ).toEqual({
        allowWrites: true,
        writeNamespaces: ["web"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: false,
        clusterIdentifier: "prod-us",
        inCluster: true,
      });
    });

    it("creates a kubectl-only Runner, binds the cluster, turns investigation on and remediation to ask-for-approval", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(neverConfiguredCluster());
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          agentVersion: "9.1.0",
          posture: { allowWrites: true, kubectlVersion: "v1.31.4" },
        });

      expect(result.isFirstBind).toBe(true);
      expect(result.isBoundToCluster).toBe(true);
      expect(result.bindingState).toBe("first_bind");
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
      /*
       * The first bind stamps the never-cleared "configured" marker, so a
       * later Runner delete (the FK nulls the binding) can never make this
       * cluster look never-configured and first-bind it again.
       */
      expect(clusterUpdates[0]!["aiAccessConfiguredAt"]).toBeInstanceOf(Date);

      // Recorded on the cluster feed so an operator can see it happened.
      expect(feedItems).toHaveLength(1);
      expect(feedItems[0]!["kubernetesClusterId"]).toBe(CLUSTER_ID);
      expect(feedItems[0]!["projectId"]).toBe(PROJECT_ID);
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "was bound as this cluster's AI access Runner",
      );
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        'AI remediation is "Ask for approval"',
      );
    });

    it("without write RBAC leaves remediation Disabled", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(neverConfiguredCluster());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: false },
      });

      expect(clusterUpdates[0]).toMatchObject({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      });
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "AI remediation is Disabled",
      );
    });

    /*
     * The dashboard is the control plane even before a Runner exists: an
     * operator may set the mode on the AI page and install the chart
     * afterwards. The chart's intent only fills in a switch still at its
     * default; it never downgrades a chosen mode to "ask for approval",
     * and never lifts one either.
     */
    it("keeps a remediation mode the operator chose before the Runner registered", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        neverConfiguredCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates).toHaveLength(1);
      expect(clusterUpdates[0]).toMatchObject({
        aiAccessRunnerId: RUNNER_ID,
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      });
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        'AI remediation is "Automatic"',
      );
    });

    it("keeps a chosen write mode on a read-only chart too (the readiness gap handles it, not a silent downgrade)", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        neverConfiguredCluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      );
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: false },
      });

      expect(clusterUpdates[0]).toMatchObject({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      });
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        'AI remediation is "Bypass approval"',
      );
    });

    it("treats an unknown stored mode as the default and applies the chart's intent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(
          neverConfiguredCluster({ aiRemediationMode: "Yolo" }),
        );
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      expect(clusterUpdates[0]).toMatchObject({
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });
    });

    it("looks the agent Runner row up by name case-insensitively", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      const findOneBy: jest.SpyInstance = mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "Prod-US",
        posture: { allowWrites: true },
      });

      const nameQuery: Record<string, unknown> = (
        findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;

      expect(nameQuery["projectId"]).toBe(PROJECT_ID);
      /*
       * A findWithSameText operator, not the raw string: a chart that
       * registers "Prod-US" must find the row a "prod-us" registration made
       * instead of tripping the unique-name guard on a second create.
       */
      expect(typeof nameQuery["name"]).not.toBe("string");
      expect(nameQuery["name"]).toBeDefined();
    });
  });

  describe("re-registration of this cluster's agent (a pod restart)", () => {
    it("rotates the key and posture of the OFFLINE bound agent Runner but never touches the operator's switches", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: offlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: false },
        });

      expect(result.isFirstBind).toBe(false);
      expect(result.isBoundToCluster).toBe(true);
      expect(result.bindingState).toBe("already_bound");
      expect(createdRunner).toBeNull();
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.id).toBe(RUNNER_ID.toString());
      expect(runnerUpdates[0]!.data["key"]).toBe(result.runnerKey);
      expect(result.runnerKey).not.toBe(CURRENT_KEY);
      expect(
        (
          runnerUpdates[0]!.data["hostInfo"] as {
            kubernetes: { allowWrites: boolean; clusterIdentifier: string };
          }
        ).kubernetes,
      ).toMatchObject({ allowWrites: false, clusterIdentifier: "prod-us" });
      // No cluster write at all: the dashboard is the control plane.
      expect(clusterUpdates).toHaveLength(0);
      // Creation brakes are for new rows only.
      expect(countBySpy).not.toHaveBeenCalled();
      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain("key was rotated");
      // Said plainly: no key was presented, and why it was admitted anyway.
      expect(feed).toContain("WITHOUT proof of continuity");
      expect(feed).toContain("had stopped heartbeating");
    });

    /*
     * Round three (follow-up e): the write scope a restarted pod reports is
     * stored on the re-keyed row at once, replacing what the previous pod
     * reported, so a scope changed by a helm upgrade is known before the
     * first heartbeat. The service, not the body, still says which cluster.
     */
    it("stores the restarted Runner's reported write scope on the re-keyed row", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: offlineAgentRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-us",
              writeNamespaces: ["legacy"],
              allowNodeOperations: true,
            },
          },
        }),
      });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: {
          allowWrites: true,
          writeNamespaces: ["web", "api"],
          podNamespace: "oneuptime-agent",
          allowNodeOperations: false,
          clusterIdentifier: "someone-else",
          inCluster: false,
        },
      });

      expect(runnerUpdates).toHaveLength(1);
      expect(
        (
          runnerUpdates[0]!.data["hostInfo"] as {
            kubernetes: Record<string, unknown>;
          }
        ).kubernetes,
      ).toEqual({
        allowWrites: true,
        writeNamespaces: ["web", "api"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: false,
        clusterIdentifier: "prod-us",
        inCluster: true,
      });
    });

    /*
     * Round four, defence in depth: an agent image older than the write
     * scope's registration fields registers with neither writeNamespaces
     * nor podNamespace (only its heartbeat sends them). Storing that body
     * as it is emptied the scope the row held, so until the first
     * heartbeat every server-side check read the Runner as cluster-wide
     * with no namespace of its own. A field the body leaves out keeps what
     * the row last reported; a field it sends wins.
     */
    describe("a registration body that leaves out the write scope (an older agent image)", () => {
      const STORED_SCOPE: Record<string, unknown> = {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
        writeNamespaces: ["web", "api"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: true,
      };

      async function storedAfterRegistering(
        posture: KubernetesRunnerPosture,
      ): Promise<Record<string, unknown>> {
        jest
          .spyOn(KubernetesClusterService, "findOneBy")
          .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
        mockRunnerLookups({
          bound: offlineAgentRunner({
            hostInfo: { kubernetes: { ...STORED_SCOPE } },
          }),
        });

        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture,
        });

        expect(runnerUpdates).toHaveLength(1);

        return (
          runnerUpdates[0]!.data["hostInfo"] as {
            kubernetes: Record<string, unknown>;
          }
        ).kubernetes;
      }

      it("keeps the write namespaces and the pod namespace the row holds", async () => {
        const stored: Record<string, unknown> = await storedAfterRegistering({
          allowWrites: true,
          allowNodeOperations: false,
          writeNamespaces: undefined,
          podNamespace: undefined,
        });

        expect(stored["writeNamespaces"]).toEqual(["web", "api"]);
        expect(stored["podNamespace"]).toBe("oneuptime-agent");
        // What the body did send still replaces what the row held.
        expect(stored["allowNodeOperations"]).toBe(false);
        expect(stored["clusterIdentifier"]).toBe("prod-us");
        expect(stored["inCluster"]).toBe(true);
      });

      it("keeps each field it leaves out on its own", async () => {
        const stored: Record<string, unknown> = await storedAfterRegistering({
          allowWrites: true,
          writeNamespaces: ["payments"],
        });

        expect(stored["writeNamespaces"]).toEqual(["payments"]);
        expect(stored["podNamespace"]).toBe("oneuptime-agent");
      });

      // Negative control: an explicit empty list is the chart's cluster-wide scope.
      it("negative control: a body that sends an empty list stores cluster-wide", async () => {
        const stored: Record<string, unknown> = await storedAfterRegistering({
          allowWrites: true,
          writeNamespaces: [],
          podNamespace: "oneuptime-agent",
        });

        expect(stored["writeNamespaces"]).toEqual([]);
        expect(stored["podNamespace"]).toBe("oneuptime-agent");
      });

      it("negative control: a first registration has nothing to keep", async () => {
        jest
          .spyOn(KubernetesClusterService, "findOneBy")
          .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
        mockRunnerLookups({});

        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

        const stored: Record<string, unknown> = (
          createdRunner!.hostInfo as { kubernetes: Record<string, unknown> }
        ).kubernetes;

        expect(stored["writeNamespaces"]).toBeUndefined();
        expect(stored["podNamespace"]).toBeUndefined();
      });

      it("keepStoredWriteScope leaves a posture alone when the row reported none", () => {
        const reported: KubernetesRunnerPosture = {
          allowWrites: true,
          inCluster: true,
        };

        expect(
          KubernetesClusterAiAccessService.keepStoredWriteScope({
            reported,
            stored: undefined,
          }),
        ).toEqual(reported);
        expect(
          KubernetesClusterAiAccessService.keepStoredWriteScope({
            reported,
            stored: { inCluster: true, podNamespace: undefined },
          }),
        ).toEqual(reported);
      });
    });

    it("also admits a Runner that signed off (Disconnected) even though its last heartbeat is recent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: signedOffAgentRunner(),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.data["connectionStatus"]).toBe(
        RunnerConnectionStatus.Connected,
      );
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "the previous instance had signed off",
      );
    });

    it("says a rotation WITH the current key was proven, and without the takeover warning", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: offlineAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
        previousRunnerKey: CURRENT_KEY,
      });

      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain("It presented its current key");
      expect(feed).not.toContain("WITHOUT proof");
      expect(feed).not.toContain("telemetry ingestion key");
    });

    it("warns about a possible takeover on a rotation WITHOUT proof, in a different color", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: offlineAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      const unproven: Record<string, unknown> = feedItems[0]!;
      expect(String(unproven["feedInfoInMarkdown"])).toContain(
        "telemetry ingestion key",
      );

      feedItems.length = 0;
      mockRunnerLookups({ bound: offlineAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
        previousRunnerKey: CURRENT_KEY,
      });

      expect(feedItems[0]!["displayColor"]).not.toEqual(
        unproven["displayColor"],
      );
    });

    it("admits a Runner that never heartbeated at all", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: offlineAgentRunner({ lastAlive: undefined }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
    });
  });

  /*
   * The ingestion key is held by every collector and CI job in the project.
   * With it alone, nobody may evict the live pod and take its identity —
   * the identity every kubectl job for that cluster is targeted at.
   */
  describe("re-keying a Runner that is ONLINE needs proof of continuity", () => {
    it("refuses with 403, rotates nothing, writes nothing and never discloses the current key", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      let thrown: unknown = null;

      try {
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ForbiddenException);
      const message: string = (thrown as Error).message;
      expect(message).toContain("is online");
      expect(message).toContain("previousRunnerKey");
      expect(message).not.toContain(CURRENT_KEY);

      expect(runnerUpdates).toHaveLength(0);
      expect(clusterUpdates).toHaveLength(0);
      expect(createdRunner).toBeNull();
      expect(feedItems).toHaveLength(0);

      // Logged for the operator, without the key.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]![0])).toContain("refused to re-key");
      expect(String(warnSpy.mock.calls[0]![0])).not.toContain(CURRENT_KEY);
    });

    it("admits a registration that presents the Runner's current key", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
          previousRunnerKey: CURRENT_KEY,
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.data["key"]).toBe(result.runnerKey);
      expect(result.runnerKey).not.toBe(CURRENT_KEY);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("refuses a wrong, a near-miss and an empty previousRunnerKey alike", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      for (const presented of [
        "00000000-0000-4000-8000-000000000000",
        CURRENT_KEY.slice(0, -1),
        `${CURRENT_KEY}x`,
        CURRENT_KEY.toUpperCase(),
        "",
      ]) {
        await expect(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
            previousRunnerKey: presented,
          }),
        ).rejects.toThrow(ForbiddenException);
      }

      expect(runnerUpdates).toHaveLength(0);
    });

    it("applies the same rule to the by-name agent row of an unbound cluster", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({ byName: onlineAgentRunner() });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(runnerUpdates).toHaveLength(0);
      expect(clusterUpdates).toHaveLength(0);
    });
  });

  describe("bounds on what an ingestion key can mint", () => {
    it("refuses a new agent Runner once the project holds the maximum, with 429", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({});
      countBySpy.mockResolvedValue(
        new PositiveNumber(MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT),
      );

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(TooManyRequestsException);

      expect(createdRunner).toBeNull();
      expect(clusterUpdates).toHaveLength(0);
      expect(feedItems).toHaveLength(0);

      // Counted on this project's agent rows only.
      const query: Record<string, unknown> = (
        countBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["name"]).toBeDefined();
    });

    it("refuses a new agent Runner once the hourly creation brake is reached", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({});
      countBySpy
        .mockResolvedValueOnce(new PositiveNumber(3))
        .mockResolvedValueOnce(
          new PositiveNumber(
            MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR,
          ),
        );

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(/in the last hour/);

      expect(createdRunner).toBeNull();

      const hourlyQuery: Record<string, unknown> = (
        countBySpy.mock.calls[1]![0] as { query: Record<string, unknown> }
      ).query;
      expect(hourlyQuery["createdAt"]).toBeDefined();
    });

    it("admits one below each brake", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({});
      countBySpy
        .mockResolvedValueOnce(
          new PositiveNumber(MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT - 1),
        )
        .mockResolvedValueOnce(
          new PositiveNumber(
            MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR - 1,
          ),
        );

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(createdRunner).not.toBeNull();
    });
  });

  /*
   * The ping-pong finding: cluster A is bound (via the dashboard) to the
   * in-cluster Runner of cluster B. A's pod registering must not re-key B's
   * pod and overwrite its posture; it gets its own row and A stays as the
   * operator left it.
   */
  describe("a bound Runner that is another cluster's agent is never reused", () => {
    it("creates this cluster's own agent row and leaves the other cluster's Runner and the binding alone", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.isBoundToCluster).toBe(false);
      expect(result.isFirstBind).toBe(false);
      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());

      // prod-eu's live pod keeps its key and its posture.
      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe(getKubernetesAgentRunnerName("prod-us"));
      expect(
        (createdRunner!.hostInfo as { kubernetes: Record<string, unknown> })
          .kubernetes["clusterIdentifier"],
      ).toBe("prod-us");
      expect(clusterUpdates).toHaveLength(0);
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "bound to a different Runner",
      );
    });

    it("re-keys this cluster's existing by-name row instead of the other cluster's bound Runner", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
        byName: offlineAgentRunner(),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.id).toBe(RUNNER_ID.toString());
      expect(runnerUpdates[0]!.id).not.toBe(OTHER_RUNNER_ID.toString());
      expect(createdRunner).toBeNull();
      expect(clusterUpdates).toHaveLength(0);
    });

    it("treats a bound pod Runner with no cluster identity as not this cluster's agent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "pod-runner",
          hostInfo: { kubernetes: { inCluster: true } },
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).not.toBeNull();
    });

    /*
     * Round one re-keyed the BOUND row whenever its posture named this
     * cluster. A posture is whatever the Runner last heartbeated, so a row
     * renamed out of the agent marker (its name guards gone) was still
     * handed the ingestion-key identity. The row is found by NAME only.
     */
    it("never re-keys a bound row that only CLAIMS to be this cluster's agent by its posture", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      const lookups: jest.SpyInstance = mockRunnerLookups({
        bound: offlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "prod-us in-cluster runner",
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(result.isBoundToCluster).toBe(false);
      // The bound row keeps its key; this cluster's agent row is minted.
      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe("kubernetes-agent/prod-us");
      expect(clusterUpdates).toHaveLength(0);

      // The row to re-key was looked up by name, first.
      const firstQuery: Record<string, unknown> = (
        lookups.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(firstQuery["_id"]).toBeUndefined();
      expect(firstQuery["name"]).toBeDefined();
    });

    it("does reuse the bound agent when its posture names this cluster in a different case", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "PROD-US" },
          },
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.id).toBe(RUNNER_ID.toString());
      expect(createdRunner).toBeNull();
    });
  });

  it("does not steal a cluster an operator bound to an external Runner", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
    mockRunnerLookups({
      // The bound Runner: an operator's external Runner, no posture.
      bound: onlineAgentRunner({ name: "office-runner", hostInfo: {} }),
      // The agent Runner row for this cluster, previously registered.
      byName: offlineAgentRunner({
        id: OTHER_RUNNER_ID,
        _id: OTHER_RUNNER_ID.toString(),
      }),
    });

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isBoundToCluster).toBe(false);
    expect(result.bindingState).toBe("bound_to_other_runner");
    expect(result.runnerId.toString()).toBe(OTHER_RUNNER_ID.toString());
    expect(clusterUpdates).toHaveLength(0);
    expect(runnerUpdates).toHaveLength(1);
    expect(runnerUpdates[0]!.id).toBe(OTHER_RUNNER_ID.toString());
  });

  /*
   * Rewritten: this used to mock a bound id pointing at a missing Runner
   * and expect a take-over. The binding's FK is ON DELETE SET NULL, so that
   * state only exists in the race between reading the cluster and reading
   * its Runner while a delete lands — and a Runner delete is how an
   * operator revokes or resets it, so even then nothing is re-bound.
   */
  it("race only: a bound id whose Runner row vanished mid-registration is never re-bound and no switch moves", async () => {
    jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
      fakeCluster({
        aiAccessRunnerId: RUNNER_ID,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    );
    mockRunnerLookups({});

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isFirstBind).toBe(false);
    expect(result.isBoundToCluster).toBe(false);
    expect(result.bindingState).toBe("left_unbound_by_operator");
    expect(createdRunner).not.toBeNull();
    expect(clusterUpdates).toHaveLength(0);
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).not.toContain(
      "took over",
    );
  });

  /*
   * What Postgres actually leaves after an operator deletes the bound agent
   * Runner: the FK (ON DELETE SET NULL) has already cleared
   * aiAccessRunnerId, and the row is gone, so there is no agent row by name
   * either. The never-cleared aiAccessRunnerBoundAt marker remembers that a
   * Runner WAS bound (round one keyed this on aiAccessConfiguredAt, which
   * also left an operator who configured the cluster before installing the
   * chart unbound — known follow-up 12).
   */
  describe("re-registration after the bound agent Runner was deleted (the FK ON DELETE SET NULL state)", () => {
    function clusterAfterRunnerDelete(
      overrides: Partial<Record<string, unknown>> = {},
    ): KubernetesCluster {
      return fakeCluster({
        aiAccessRunnerId: undefined,
        aiAccessCredentialId: undefined,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        aiAccessLastVerifiedAt: undefined,
        aiAccessLastError: undefined,
        aiAccessConfiguredAt: OneUptimeDate.getSomeMinutesAgo(60 * 24),
        aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(60 * 24),
        ...overrides,
      });
    }

    it("does not re-enable switches an operator turned off before any command ran", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(clusterAfterRunnerDelete());
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(result.isBoundToCluster).toBe(false);
      expect(result.isFirstBind).toBe(false);
      // A fresh Runner row for the pod, but the cluster is not touched.
      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe("kubernetes-agent/prod-us");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("says honestly what may have happened: cleared by an operator, OR its Runner was deleted", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(clusterAfterRunnerDelete());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain(
        "the binding was cleared by an operator, or the Runner it was bound to was deleted",
      );
      expect(feed).toContain("no AI switch was changed");
      // The way back is the AI agent, not selecting this Runner.
      expect(feed).toContain(
        "Upgrade the Kubernetes agent chart to use the Kubernetes AI agent instead.",
      );
      expect(feed).not.toContain("Select **kubernetes-agent/prod-us**");
    });

    it("keeps an operator's enabled switches exactly as they are, too", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        clusterAfterRunnerDelete({
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
          aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(90),
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: false },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("afterwards, the cluster's status points at installing the AI agent, not at selecting the Runner", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(clusterAfterRunnerDelete());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      // The row registration just created exists, but nothing binds it.
      mockRunnerLookups({ byName: createdRunner });

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: clusterAfterRunnerDelete(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toContain("ai_agent_not_connected");
      expect(gapCodes(status)).not.toContain("no_runner_bound");
      const gap: KubernetesAiAccessGap = status.gaps.find(
        (candidate: KubernetesAiAccessGap) => {
          return candidate.code === "ai_agent_not_connected";
        },
      )!;
      expect(gap.nextStep).toContain(AI_AGENT_INSTALL_COMMAND);
      expect(gap.nextStep).not.toContain("Select the kubernetes-agent Runner");
    });

    it("negative control: without either marker (and no other history) the same cluster still first-binds", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        clusterAfterRunnerDelete({
          aiAccessConfiguredAt: undefined,
          aiAccessRunnerBoundAt: undefined,
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates[0]).toMatchObject({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });
    });

    /*
     * The marker that decides it is "a Runner was bound", not "configured":
     * with only aiAccessConfiguredAt left, the cluster is the pre-configured
     * case below and is bound, switches untouched.
     */
    it("negative control: with only the configured marker it binds, keeping the operator's switches", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(
          clusterAfterRunnerDelete({ aiAccessRunnerBoundAt: undefined }),
        );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
    });
  });

  /*
   * Known follow-up 12: an operator who opens the AI page and picks a
   * remediation mode (or flips a switch) BEFORE installing the chart stamps
   * aiAccessConfiguredAt. That must not strand the cluster unbound: no
   * Runner was ever bound, so the agent Runner is bound — and not one of the
   * operator's settings moves.
   */
  describe("a cluster configured on the AI page before the chart was installed", () => {
    function preConfiguredCluster(
      overrides: Partial<Record<string, unknown>> = {},
    ): KubernetesCluster {
      return fakeCluster({
        aiAccessRunnerId: undefined,
        aiAccessCredentialId: undefined,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        aiAccessLastVerifiedAt: undefined,
        aiAccessLastError: undefined,
        aiAccessConfiguredAt: OneUptimeDate.getSomeMinutesAgo(10),
        aiAccessRunnerBoundAt: undefined,
        ...overrides,
      });
    }

    it("binds the agent Runner and changes no switch", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(preConfiguredCluster());
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
      expect(result.isBoundToCluster).toBe(true);
      expect(result.isFirstBind).toBe(false);
      expect(createdRunner).not.toBeNull();

      expect(clusterUpdates).toHaveLength(1);
      // Only the binding and its marker: no switch, no credential, no mode.
      expect(Object.keys(clusterUpdates[0]!).sort()).toEqual(
        ["aiAccessRunnerBoundAt", "aiAccessRunnerId"].sort(),
      );
      expect(String(clusterUpdates[0]!["aiAccessRunnerId"])).toBe(
        RUNNER_ID.toString(),
      );
      expect(clusterUpdates[0]!["aiAccessRunnerBoundAt"]).toBeInstanceOf(Date);
    });

    it("says so honestly on the feed: bound, and the operator's settings kept", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(preConfiguredCluster());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain("was bound as this cluster's AI access Runner");
      expect(feed).toContain("no AI setting was changed");
      expect(feed).toContain("AI investigation with kubectl is off");
      expect(feed).toContain('AI remediation is "Automatic"');
      expect(feed).not.toContain("left unbound");
    });

    it("keeps an investigation switch the operator turned on, too", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        preConfiguredCluster({
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      // Disabled stays Disabled: the chart's intent never overrides a choice.
      expect(clusterUpdates[0]).not.toHaveProperty("aiRemediationMode");
      expect(clusterUpdates[0]).not.toHaveProperty("isAiInvestigationEnabled");
    });

    it("also re-keys and binds this cluster's agent row that already existed", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(preConfiguredCluster());
      mockRunnerLookups({ byName: offlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
      expect(runnerUpdates).toHaveLength(1);
      expect(clusterUpdates[0]!["aiAccessRunnerId"]).toBe(RUNNER_ID);
    });

    it("negative control: once a Runner was bound, the same cluster is left unbound", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        preConfiguredCluster({
          aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(5),
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("negative control: a recorded command outcome also leaves it unbound", async () => {
      for (const history of [
        { aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(5) },
        { aiAccessLastError: "Forbidden" },
      ]) {
        clusterUpdates.length = 0;
        jest
          .spyOn(KubernetesClusterService, "findOneBy")
          .mockResolvedValue(preConfiguredCluster(history));
        mockRunnerLookups({});

        const result: RegisterKubernetesAgentRunnerResult =
          await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          });

        expect(result.bindingState).toBe("left_unbound_by_operator");
        expect(clusterUpdates).toHaveLength(0);
      }
    });

    it("a first bind stamps the bound marker too", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        preConfiguredCluster({
          aiAccessConfiguredAt: undefined,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates[0]!["aiAccessRunnerBoundAt"]).toBeInstanceOf(Date);
      expect(clusterUpdates[0]!["aiAccessConfiguredAt"]).toBeInstanceOf(Date);
    });
  });

  /*
   * The credential-exfiltration finding: an offline (or signed-off) agent
   * row may be re-keyed by anyone holding the ingestion key, and the offline
   * window is predictable (every helm upgrade opens one). So a row an
   * operator entrusted with more than the agent defaults is never handed to
   * a registration that cannot present its current key.
   */
  describe("an unproven re-key of a row that holds more than the agent defaults is refused", () => {
    type Holding = {
      name: string;
      arrange: () => Partial<Record<string, unknown>>;
      expectInMessage: string;
    };

    const holdings: Array<Holding> = [
      {
        name: "a Runner credential assigned to it",
        arrange: (): Partial<Record<string, unknown>> => {
          credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
          return {};
        },
        expectInMessage: "1 Runner credential(s) assigned",
      },
      {
        name: "a runbook secret assigned to it",
        arrange: (): Partial<Record<string, unknown>> => {
          secretCountSpy.mockResolvedValue(new PositiveNumber(2));
          return {};
        },
        expectInMessage: "2 runbook secret(s) assigned",
      },
      {
        name: "another cluster bound to it",
        arrange: (): Partial<Record<string, unknown>> => {
          boundClusterCountSpy.mockResolvedValue(new PositiveNumber(1));
          return {};
        },
        expectInMessage: "the AI access Runner of 1 other cluster(s)",
      },
      {
        name: '"Runs Runbooks" turned on',
        arrange: (): Partial<Record<string, unknown>> => {
          return { canRunRunbooks: true };
        },
        expectInMessage: '"Runs Runbooks" is on',
      },
      {
        name: '"Runs AI Code Fixes" turned on',
        arrange: (): Partial<Record<string, unknown>> => {
          return { canRunCodeFixTasks: true };
        },
        expectInMessage: '"Runs AI Code Fixes" is on',
      },
    ];

    function itRefusesTheUnprovenReKey(holding: Holding, state: string): void {
      it(`refuses a ${state} row with ${holding.name}: 403, nothing written, no key handed out`, async () => {
        const overrides: Partial<Record<string, unknown>> = holding.arrange();
        jest
          .spyOn(KubernetesClusterService, "findOneBy")
          .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
        mockRunnerLookups({
          bound:
            state === "signed off"
              ? signedOffAgentRunner(overrides)
              : offlineAgentRunner(overrides),
        });

        let thrown: unknown = null;

        try {
          await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          });
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(ForbiddenException);
        const message: string = (thrown as Error).message;
        expect(message).toContain(holding.expectInMessage);
        // The chart upgrade to the AI agent comes first: it needs no Runner.
        expect(message).toContain(
          "Upgrade the Kubernetes agent chart: its Kubernetes AI agent replaces this in-cluster Runner.",
        );
        expect(message).not.toContain("select it on the cluster's AI page");
        expect(message).not.toContain(CURRENT_KEY);

        expect(runnerUpdates).toHaveLength(0);
        expect(clusterUpdates).toHaveLength(0);
        expect(createdRunner).toBeNull();
        expect(feedItems).toHaveLength(0);
        expect(String(warnSpy.mock.calls[0]![0])).toContain(
          "without proof of continuity",
        );
      });
    }

    for (const holding of holdings) {
      for (const state of ["signed off", "offline"]) {
        itRefusesTheUnprovenReKey(holding, state);
      }
    }

    it("counts credentials and secrets assigned to THIS row in this project, and other clusters bound to it", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: signedOffAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      for (const spy of [credentialCountSpy, secretCountSpy]) {
        const query: Record<string, unknown> = (
          spy.mock.calls[0]![0] as { query: Record<string, unknown> }
        ).query;
        expect(query["projectId"]).toBe(PROJECT_ID);
        expect(
          (query["runners"] as Array<ObjectID>).map((id: ObjectID) => {
            return id.toString();
          }),
        ).toEqual([RUNNER_ID.toString()]);
      }

      const clusterQuery: Record<string, unknown> = (
        boundClusterCountSpy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(clusterQuery["projectId"]).toBe(PROJECT_ID);
      expect(String(clusterQuery["aiAccessRunnerId"])).toBe(
        RUNNER_ID.toString(),
      );
      // "Other than this cluster": this cluster's own binding is expected.
      expect(clusterQuery["_id"]).toBeDefined();
      expect(typeof clusterQuery["_id"]).not.toBe("string");
    });

    it("the same refusal applies to the by-name row of an unbound cluster", async () => {
      credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({ byName: signedOffAgentRunner() });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).toBeNull();
    });

    it("admits the row when the registration proves continuity with its current key, whatever it holds", async () => {
      credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: signedOffAgentRunner({ canRunRunbooks: true }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
          previousRunnerKey: CURRENT_KEY,
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      // The proof short-circuits: nothing is counted.
      expect(credentialCountSpy).not.toHaveBeenCalled();
    });

    it("negative control: a signed-off row with nothing beyond the defaults is still re-keyed without a key", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: signedOffAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(credentialCountSpy).toHaveBeenCalledTimes(1);
      expect(secretCountSpy).toHaveBeenCalledTimes(1);
      expect(boundClusterCountSpy).toHaveBeenCalledTimes(1);
    });

    it("an online row is refused for being online before anything is counted", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(/is online/);

      expect(credentialCountSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * The agent Runner is named "kubernetes-agent/<cluster>", and Runner.name
   * is a 100-character column. Every cluster name the cluster row itself
   * accepts must still get a Runner row.
   */
  describe("long cluster names", () => {
    const LONG_84: string = `arn:aws:eks:us-east-1:123456789012:cluster/${"p".repeat(84 - 43)}`;
    const LONG_100: string = "c".repeat(100);

    it("keeps the exact name for an 83-character identifier (existing rows keep matching)", () => {
      const id: string = "a".repeat(83);

      expect(getKubernetesAgentRunnerNameForCluster(id)).toBe(
        `kubernetes-agent/${id}`,
      );
      expect(getKubernetesAgentRunnerNameForCluster("prod-us")).toBe(
        getKubernetesAgentRunnerName("prod-us"),
      );
    });

    it("bounds 84- and 100-character identifiers to the Runner name column, deterministically", () => {
      for (const id of [LONG_84, LONG_100]) {
        const name: string = getKubernetesAgentRunnerNameForCluster(id);

        expect(LONG_84).toHaveLength(84);
        expect(name.length).toBeLessThanOrEqual(
          MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
        );
        expect(name.startsWith("kubernetes-agent/")).toBe(true);
        expect(name).toBe(getKubernetesAgentRunnerNameForCluster(id));
      }
    });

    it("maps case variants of one long identifier to the same row, and different long identifiers to different rows", () => {
      const lower: string = `${"x".repeat(90)}-prod`;
      const upper: string = lower.toUpperCase();
      const sibling: string = `${"x".repeat(90)}-test`;

      expect(getKubernetesAgentRunnerNameForCluster(upper).toLowerCase()).toBe(
        getKubernetesAgentRunnerNameForCluster(lower).toLowerCase(),
      );
      expect(getKubernetesAgentRunnerNameForCluster(sibling)).not.toBe(
        getKubernetesAgentRunnerNameForCluster(lower),
      );
    });

    it("registers a 100-character cluster name with a Runner name that fits, then finds that row again", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          clusterIdentifier: LONG_100,
        }),
      );
      const lookups: jest.SpyInstance = mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: LONG_100,
        posture: { allowWrites: true },
      });

      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name!.length).toBeLessThanOrEqual(
        MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
      );
      expect(createdRunner!.name).toBe(
        getKubernetesAgentRunnerNameForCluster(LONG_100),
      );

      // The lookup asked for exactly that name (case-insensitively).
      const nameFilter: { objectLiteralParameters?: Record<string, unknown> } =
        (lookups.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
          "name"
        ] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
      expect(Object.values(nameFilter.objectLiteralParameters || {})).toEqual([
        createdRunner!.name!.toLowerCase(),
      ]);

      // A later restart re-finds that row instead of creating another.
      const created: Runner = createdRunner!;
      createdRunner = null;
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: RUNNER_ID,
          clusterIdentifier: LONG_100,
        }),
      );
      mockRunnerLookups({
        bound: offlineAgentRunner({
          name: created.name,
          hostInfo: created.hostInfo,
        }),
      });

      const again: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: LONG_100,
          posture: { allowWrites: true },
        });

      expect(again.bindingState).toBe("already_bound");
      expect(createdRunner).toBeNull();
      expect(runnerUpdates).toHaveLength(1);
    });

    it("refuses a name longer than the cluster column with a clear 400, before any cluster row is created", async () => {
      const findOrCreate: jest.SpyInstance =
        KubernetesClusterService.findOrCreateByClusterIdentifier as unknown as jest.SpyInstance;

      let thrown: unknown = null;

      try {
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "d".repeat(101),
          posture: { allowWrites: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain("101 characters");
      expect((thrown as Error).message).toContain("up to 100 characters");
      expect(findOrCreate).not.toHaveBeenCalled();
      expect(createdRunner).toBeNull();
    });

    it("refuses to reuse a row by this name that reports it belongs to a different cluster", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({
        byName: offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(
        /reports that it is the in-cluster Runner of a different cluster/,
      );

      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).toBeNull();
      expect(clusterUpdates).toHaveLength(0);
    });
  });

  /*
   * The silent re-enable finding: an operator who cleared the Runner (and
   * turned the switches off) must not have AI turned back on by the next
   * pod restart. An unbound cluster WITH an AI-access history was cleared
   * on purpose; only a cluster with no history at all is "never
   * configured".
   */
  describe("a cluster an operator unbound stays unbound", () => {
    /*
     * Round one read "an agent row already existed" as the history that
     * meant "cleared on purpose"; the record of that is now the
     * never-cleared aiAccessRunnerBoundAt marker every bind stamps.
     */
    it("re-keys the existing agent row but neither re-binds nor flips a switch", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(60),
        }),
      );
      mockRunnerLookups({ byName: offlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.isFirstBind).toBe(false);
      expect(result.isBoundToCluster).toBe(false);
      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
      expect(clusterUpdates).toHaveLength(0);
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.data["key"]).toBe(result.runnerKey);
      expect(createdRunner).toBeNull();
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "cleared by an operator",
      );
    });

    it("also holds when the Runner row is gone but the cluster has a recorded access check", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(60 * 24 * 7),
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(result.isBoundToCluster).toBe(false);
      expect(createdRunner).not.toBeNull();
      expect(clusterUpdates).toHaveLength(0);
    });

    it("also holds when the only trace is a recorded access error", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          aiAccessLastError: "kubectl: connection refused",
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("still first-binds a cluster with switches at their defaults and no history", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiAccessLastVerifiedAt: undefined,
          aiAccessLastError: undefined,
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates).toHaveLength(1);
    });
  });

  /*
   * Every 403 says WHICH refusal it is, so the Runner can tell a wait that
   * clears on its own from one that needs an operator (and retry the first
   * when it says). Round one read every 403 as "the previous instance is
   * still online".
   */
  describe("registration refusals carry a machine-readable reason", () => {
    async function refusalOf(
      promise: Promise<unknown>,
    ): Promise<KubernetesAgentRegistrationRefusedException> {
      try {
        await promise;
      } catch (error) {
        expect(error).toBeInstanceOf(
          KubernetesAgentRegistrationRefusedException,
        );
        // Still a 403 for anything that reads it as a ForbiddenException.
        expect(error).toBeInstanceOf(ForbiddenException);
        return error as KubernetesAgentRegistrationRefusedException;
      }

      throw new Error("expected the registration to be refused");
    }

    it("previous_instance_online, with when to try again", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          lastAlive: OneUptimeDate.getSomeMinutesAgo(2),
        }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          }),
        );

      expect(refusal.reason).toBe("previous_instance_online");
      expect(
        isTransientKubernetesAgentRegistrationRefusal(refusal.reason),
      ).toBe(true);
      // Admitted once the last heartbeat is 5 minutes old: ~3 minutes away.
      expect(refusal.retryAfterSeconds).toBeGreaterThanOrEqual(170);
      expect(refusal.retryAfterSeconds).toBeLessThanOrEqual(181);
    });

    it("runner_holds_more_than_defaults, with the instruction first and no retry hint", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: signedOffAgentRunner({ canRunRunbooks: true }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          }),
        );

      expect(refusal.reason).toBe("runner_holds_more_than_defaults");
      expect(
        isTransientKubernetesAgentRegistrationRefusal(refusal.reason),
      ).toBe(false);
      expect(refusal.retryAfterSeconds).toBeUndefined();
      // The chart upgrade to the AI agent leads: it needs no Runner at all.
      expect(
        refusal.message.startsWith(
          "Upgrade the Kubernetes agent chart: its Kubernetes AI agent replaces this in-cluster Runner.",
        ),
      ).toBe(true);
      expect(refusal.message).toContain(
        'Or, under Runbooks → Runners, on Runner "kubernetes-agent/prod-us": turn off "Runs Runbooks"',
      );
      // Only what it actually holds is asked for.
      expect(refusal.message).not.toContain('turn off "Runs AI Code Fixes"');
      expect(refusal.message).not.toContain("unassign");
    });

    /*
     * The Runner logs only the first 500 characters of the server's reason.
     * The whole instruction must fit in them even for a long cluster name
     * and every kind of holding at once.
     */
    it("keeps the full instruction within the first 500 characters for a 100-character cluster name", async () => {
      const longName: string = "x".repeat(100);
      credentialCountSpy.mockResolvedValue(new PositiveNumber(3));
      secretCountSpy.mockResolvedValue(new PositiveNumber(2));
      boundClusterCountSpy.mockResolvedValue(new PositiveNumber(4));
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: RUNNER_ID,
          clusterIdentifier: longName,
        }),
      );
      mockRunnerLookups({
        bound: signedOffAgentRunner({
          name: getKubernetesAgentRunnerNameForCluster(longName),
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: longName },
          },
        }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: longName,
            posture: { allowWrites: true },
          }),
        );

      const head: string = refusal.message.slice(0, 500);
      expect(head).toContain("Upgrade the Kubernetes agent chart");
      expect(head).toContain('"Runs Runbooks"');
      expect(head).toContain('"Runs AI Code Fixes"');
      expect(head).toContain("3 Runner credential(s)");
      expect(head).toContain("2 runbook secret(s)");
      expect(head).toContain("4 other cluster(s)");
    });

    it("runner_belongs_to_another_cluster, with no retry hint", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({
        byName: offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          }),
        );

      expect(refusal.reason).toBe("runner_belongs_to_another_cluster");
      expect(refusal.retryAfterSeconds).toBeUndefined();
      /*
       * The step that works is the chart upgrade: the Kubernetes AI agent
       * replaces the in-cluster Runner and does not use the Runner name.
       */
      expect(
        refusal.message.startsWith(
          'Upgrade the Kubernetes agent chart of cluster "prod-us"',
        ),
      ).toBe(true);
      expect(refusal.message).toContain(
        'does not need Runner "kubernetes-agent/prod-us"',
      );
      expect(refusal.message).not.toContain("AI page");
    });

    it("getPreviousInstanceRetryAfterSeconds counts down to the end of the alive window, never below 1s", () => {
      const now: Date = new Date("2026-09-22T12:00:00.000Z");

      expect(
        getPreviousInstanceRetryAfterSeconds({
          lastAlive: new Date("2026-09-22T11:59:00.000Z"),
          now,
        }),
      ).toBe(240);
      expect(
        getPreviousInstanceRetryAfterSeconds({
          lastAlive: new Date("2026-09-22T11:55:00.500Z"),
          now,
        }),
      ).toBe(1);
      expect(
        getPreviousInstanceRetryAfterSeconds({
          lastAlive: new Date("2026-09-22T11:00:00.000Z"),
          now,
        }),
      ).toBe(1);
      expect(
        getPreviousInstanceRetryAfterSeconds({ lastAlive: undefined, now }),
      ).toBe(1);
    });
  });

  it("survives a feed write failure: the registration still succeeds", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
    mockRunnerLookups({});
    (
      KubernetesClusterFeedService.createKubernetesClusterFeedItem as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("feed is down"));

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.bindingState).toBe("first_bind");
    expect(clusterUpdates).toHaveLength(1);
  });
});
