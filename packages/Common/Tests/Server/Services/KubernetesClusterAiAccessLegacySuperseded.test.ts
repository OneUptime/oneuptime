import KubernetesClusterAiAccessService, {
  KubernetesAgentRegistrationRefusedException,
  RegisterKubernetesAgentRunnerResult,
  SUPERSEDED_BY_AI_AGENT_RETRY_AFTER_SECONDS,
  getSupersededByAiAgentMessage,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiRemediationMode,
  isTransientKubernetesAgentRegistrationRefusal,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the previous in-cluster Runner (older charts) and
 * the Kubernetes AI agent that replaces it:
 *
 * - while the cluster's AI agent is ONLINE, the previous Runner is refused
 *   with superseded_by_ai_agent before anything is written — no Runner row
 *   created or re-keyed, no binding, no feed item — and the refusal is
 *   transient (retryAfterSeconds 60), so the Runner keeps asking slowly;
 * - once the agent is offline, signed off or reset, the previous Runner is
 *   admitted again. A helm rollback keeps working through the Runner the
 *   cluster is still bound to (already_bound). A cluster that never had a
 *   Runner bound and never ran kubectl, but has an agent row, is bound
 *   WITHOUT the chart's first-bind defaults: no switch moves and the
 *   configured marker stays unset (the agent's own first connection
 *   decides those);
 * - once AI has run kubectl on a cluster — through its agent too, whose
 *   commands and connection tests record the same history — a registering
 *   Runner is never bound there (fail closed: that history cannot tell the
 *   agent's commands from a revoked Runner's), and the feed says so
 *   without blaming an operator;
 * - a cluster with no agent row keeps the existing first_bind behaviour.
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
    aiRemediationMode: KubernetesAiRemediationMode.Disabled,
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
    posture: { inCluster: true, clusterIdentifier: "prod-us" },
    ...overrides,
  } as unknown as KubernetesAiAgent;
}

function offlineLegacyRunner(): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    key: "old-key",
    lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
    connectionStatus: RunnerConnectionStatus.Connected,
    canRunAiCommands: true,
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
    hostInfo: {
      kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
    },
  } as unknown as Runner;
}

describe("the previous in-cluster Runner and the Kubernetes AI agent that replaces it", () => {
  let clusterUpdates: Array<Record<string, unknown>>;
  let runnerUpdates: Array<Record<string, unknown>>;
  let createdRunners: Array<Runner>;
  let feedItems: Array<Record<string, unknown>>;
  let agentLookup: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;
  let findOrCreate: jest.SpyInstance;

  beforeEach(() => {
    clusterUpdates = [];
    runnerUpdates = [];
    createdRunners = [];
    feedItems = [];

    for (const method of ["warn", "info", "error"] as const) {
      jest.spyOn(logger, method).mockImplementation((): void => {
        return undefined;
      });
    }

    findOrCreate = jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockResolvedValue(cluster());
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(cluster());
    jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        clusterUpdates.push((args as { data: Record<string, unknown> }).data);
        return undefined as never;
      });
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(null);
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
        createdRunners.push(data);
        return data;
      });
    jest
      .spyOn(RunnerService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockImplementation(async (args: unknown): Promise<void> => {
        feedItems.push(args as Record<string, unknown>);
      });
    agentLookup = jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function register(
    posture: { allowWrites?: boolean } = { allowWrites: true },
  ): Promise<RegisterKubernetesAgentRunnerResult> {
    return KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
      projectId: PROJECT_ID,
      clusterIdentifier: "prod-us",
      posture,
    });
  }

  async function refusalOf(): Promise<KubernetesAgentRegistrationRefusedException> {
    try {
      await register();
    } catch (error) {
      return error as KubernetesAgentRegistrationRefusedException;
    }

    throw new Error("The registration was not refused.");
  }

  describe("while the cluster's Kubernetes AI agent is online", () => {
    beforeEach(() => {
      agentLookup.mockResolvedValue(agent());
    });

    it("refuses with superseded_by_ai_agent: 403, transient, retry in 60s", async () => {
      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf();

      expect(refusal).toBeInstanceOf(
        KubernetesAgentRegistrationRefusedException,
      );
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal.reason).toBe("superseded_by_ai_agent");
      expect(
        isTransientKubernetesAgentRegistrationRefusal(refusal.reason),
      ).toBe(true);
      expect(refusal.retryAfterSeconds).toBe(60);
      expect(SUPERSEDED_BY_AI_AGENT_RETRY_AFTER_SECONDS).toBe(60);
      expect(refusal.message).toBe(getSupersededByAiAgentMessage("prod-us"));
    });

    it("writes nothing: no Runner created or re-keyed, no binding, no feed item", async () => {
      runnerLookup.mockResolvedValue(offlineLegacyRunner());

      await refusalOf();

      expect(createdRunners).toHaveLength(0);
      expect(runnerUpdates).toHaveLength(0);
      expect(clusterUpdates).toHaveLength(0);
      expect(feedItems).toHaveLength(0);
      // Refused before the Runner row is even looked up.
      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("looks the agent up for THIS cluster in THIS project", async () => {
      await refusalOf();

      expect(agentLookup).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      });
      expect(findOrCreate).toHaveBeenCalledTimes(1);
    });

    it("the message says what happened, that nothing needs doing, and when it clears", () => {
      const message: string = getSupersededByAiAgentMessage("prod-us");

      expect(message).toContain(
        'The Kubernetes AI agent of cluster "prod-us" is online and replaces this in-cluster Runner',
      );
      expect(message).toContain("Nothing needs to be done");
      expect(message).toContain("helm rollback");
      expect(message).not.toContain("AI page");
    });
  });

  describe("once the agent is not online, the previous Runner is admitted again (a rollback)", () => {
    it.each([
      [
        "its heartbeat aged out",
        { lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30) },
      ],
      ["it signed off", { connectionStatus: "disconnected" }],
      [
        "an admin reset it",
        { connectionStatus: "disconnected", keyHash: null },
      ],
    ])(
      "when %s",
      async (_label: string, overrides: Record<string, unknown>) => {
        agentLookup.mockResolvedValue(agent(overrides));

        const result: RegisterKubernetesAgentRunnerResult = await register();

        expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
        expect(result.isBoundToCluster).toBe(true);
        expect(createdRunners).toHaveLength(1);
      },
    );

    it("binds a never-configured cluster that has an agent row, but moves no switch and leaves the configured marker unset", async () => {
      agentLookup.mockResolvedValue(
        agent({ connectionStatus: "disconnected" }),
      );

      const result: RegisterKubernetesAgentRunnerResult = await register({
        allowWrites: true,
      });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
      expect(result.isFirstBind).toBe(false);
      expect(result.isBoundToCluster).toBe(true);
      expect(clusterUpdates).toHaveLength(1);
      expect(Object.keys(clusterUpdates[0]!).sort()).toEqual([
        "aiAccessRunnerBoundAt",
        "aiAccessRunnerId",
      ]);
      expect(String(clusterUpdates[0]!["aiAccessRunnerId"])).toBe(
        RUNNER_ID.toString(),
      );
    });

    it("says so on the feed, in plain words", async () => {
      agentLookup.mockResolvedValue(
        agent({ connectionStatus: "disconnected" }),
      );

      await register();

      expect(feedItems).toHaveLength(1);
      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain(
        "while this cluster's Kubernetes AI agent is offline",
      );
      expect(feed).toContain(
        "no Runner was bound here before and AI had not run kubectl here yet",
      );
      expect(feed).toContain("No AI setting was changed");
      expect(feed).toContain("takes over again as soon as it is back online");
      expect(feed).not.toContain("helm rollback");
    });

    /*
     * The rollback that works: the cluster the previous Runner served
     * before the upgrade is still bound to it, so the Runner is its target
     * again (resolution rule 3) — whatever kubectl the agent ran meanwhile.
     */
    it("a rollback on a cluster still bound to the previous Runner: already bound, nothing rewritten", async () => {
      agentLookup.mockResolvedValue(
        agent({ lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30) }),
      );
      runnerLookup.mockResolvedValue(offlineLegacyRunner());
      (
        KubernetesClusterService.findOneBy as unknown as jest.SpyInstance
      ).mockResolvedValue(
        cluster({
          aiAccessRunnerId: RUNNER_ID,
          aiAccessRunnerBoundAt: OneUptimeDate.getSomeDaysAgo(30),
          aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(45),
        }),
      );

      const result: RegisterKubernetesAgentRunnerResult = await register();

      expect(result.bindingState).toBe("already_bound");
      expect(result.isBoundToCluster).toBe(true);
      expect(clusterUpdates).toHaveLength(0);
    });

    /*
     * Fail closed: the agent records every command and "Test connection" on
     * the cluster (aiAccessLastVerifiedAt / aiAccessLastError), the same
     * history a Runner revoked by an operator leaves behind. A Runner
     * registering on such a cluster is never bound — so a cluster that
     * only ever had the agent is NOT reached through a later Runner.
     */
    it.each([
      [
        "a verified command",
        { aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(45) },
      ],
      ["a recorded error", { aiAccessLastError: "kubectl: forbidden" }],
    ])(
      "a cluster where AI already ran kubectl (%s) and no Runner was ever bound stays unbound",
      async (_label: string, history: Record<string, unknown>) => {
        agentLookup.mockResolvedValue(
          agent({
            lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30),
            posture: {
              inCluster: true,
              clusterIdentifier: "prod-us",
              podNamespace: "observability",
            },
          }),
        );
        (
          KubernetesClusterService.findOneBy as unknown as jest.SpyInstance
        ).mockResolvedValue(cluster(history));

        const result: RegisterKubernetesAgentRunnerResult = await register();

        expect(result.bindingState).toBe("left_unbound_by_operator");
        expect(result.isBoundToCluster).toBe(false);
        // Nothing bound and no switch moved.
        expect(clusterUpdates).toHaveLength(0);

        expect(feedItems).toHaveLength(1);
        const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
        expect(feed).toContain("was left unbound");
        expect(feed).toContain(
          "AI has already run kubectl on this cluster (through its Kubernetes AI agent, or a Runner that is no longer bound)",
        );
        expect(feed).toContain("No AI setting was changed");
        expect(feed).toContain(
          "kubectl logs -n observability -l component=ai-agent --tail=100",
        );
        // Not blamed on an operator or a deleted Runner.
        expect(feed).not.toContain("cleared by an operator");
        expect(feed).not.toContain("was deleted");
      },
    );

    it("negative control: without an agent row the chart's first-bind defaults still apply", async () => {
      const result: RegisterKubernetesAgentRunnerResult = await register({
        allowWrites: true,
      });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates[0]).toMatchObject({
        aiAccessRunnerId: RUNNER_ID,
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });
      expect(clusterUpdates[0]!["aiAccessConfiguredAt"]).toBeDefined();
    });

    it("negative control: a cluster the previous Runner was bound to before stays unbound, agent or not", async () => {
      agentLookup.mockResolvedValue(
        agent({ connectionStatus: "disconnected" }),
      );
      (
        KubernetesClusterService.findOneBy as unknown as jest.SpyInstance
      ).mockResolvedValue(
        cluster({ aiAccessRunnerBoundAt: OneUptimeDate.getSomeDaysAgo(10) }),
      );

      const result: RegisterKubernetesAgentRunnerResult = await register();

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(clusterUpdates).toHaveLength(0);
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "Upgrade the Kubernetes agent chart to use the Kubernetes AI agent instead.",
      );
    });
  });
});
