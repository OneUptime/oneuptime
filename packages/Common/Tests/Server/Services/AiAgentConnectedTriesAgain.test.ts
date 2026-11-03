import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import AutoRemediationRuleEngineService, {
  RemediationFixesTarget,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import {
  KubernetesAiAgentRegistrationResult,
  Service as KubernetesAiAgentServiceClass,
} from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import {
  ResourceAiAgentRegistrationResult,
  Service as ResourceAiAgentServiceClass,
} from "../../../Server/Services/ResourceAiAgentService";
import logger from "../../../Server/Utils/Logger";
import { AutoRemediationDecisionLane } from "../../../Types/AutoRemediation/AutoRemediationDecision";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KubernetesAiRemediationMode,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * AN AI AGENT THAT CONNECTS HANDS ITS TARGET TO ONEUPTIME AI (#5367's
 * follow-up).
 *
 * The open incidents and alerts whose fixes OneUptime AI found waiting for
 * a resource's or a cluster's AI agent are decided again when that agent
 * connects (AutoRemediationRuleEngineService.onAgentConnected, held by its
 * own suite). These tests hold where "connects" is: every registration of
 * a resource AI agent (a Cloud AI agent, a Docker host's...) and of a
 * Kubernetes AI agent, and a heartbeat from an agent coming back - it had
 * signed off or gone quiet past the alive window - never an ordinary
 * heartbeat of an agent that is online. The request never waits for it,
 * and nothing it does fails the request.
 *
 * Each story plays through the service with an in-memory agent row and the
 * test's clock.
 */

type AnyObject = Record<string, any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const START: Date = new Date("2026-11-03T09:00:00.000Z");
const RESOURCE_ALIVE_SECONDS: number =
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60;
const CLUSTER_ALIVE_SECONDS: number =
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60;

interface AgentCredentials {
  agentId: string;
  agentKey: string;
}

interface Story {
  at: (seconds: number) => void;
  register: () => Promise<AgentCredentials>;
  heartbeat: (agent: AgentCredentials) => Promise<void>;
  signOff: (agent: AgentCredentials) => Promise<void>;
  // Every target handed to onAgentConnected, in order.
  connected: Array<{ projectId: string; target: RemediationFixesTarget }>;
  onAgentConnected: SpyInstance<
    typeof AutoRemediationRuleEngineService.onAgentConnected
  >;
}

function useClock(): { at: (seconds: number) => void } {
  let now: Date = START;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });

  return {
    at: (offsetSeconds: number): void => {
      now = new Date(START.getTime() + offsetSeconds * 1000);
    },
  };
}

function quietLogs(): void {
  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }
}

function watchConnections(): Pick<Story, "connected" | "onAgentConnected"> {
  const connected: Story["connected"] = [];
  const onAgentConnected: Story["onAgentConnected"] = jest
    .spyOn(AutoRemediationRuleEngineService, "onAgentConnected")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      target: RemediationFixesTarget;
    }) => {
      connected.push({
        projectId: data.projectId.toString(),
        target: { ...data.target },
      });
      return 0;
    }) as never);

  return { connected, onAgentConnected };
}

// A Docker host's AI agent, registering and reporting as the agent does.
function resourceAgentStory(): Story {
  const service: ResourceAiAgentServiceClass =
    new ResourceAiAgentServiceClass();
  const clock: { at: (seconds: number) => void } = useClock();
  let table: ResourceAiAgent | null = null;
  let key: string | undefined = undefined;

  quietLogs();

  const found: AnyObject = { _id: RESOURCE_ID.toString() };
  Object.defineProperty(found, "id", { value: RESOURCE_ID });

  const host: DockerHost = new DockerHost();
  host._id = RESOURCE_ID.toString();
  host.projectId = PROJECT_ID;
  host.name = "test01";
  host.isAiInvestigationEnabled = true;
  host.aiRemediationMode = ResourceAiRemediationMode.RequireApproval;
  host.aiAccessConfiguredAt = START;

  jest
    .spyOn(DockerHostService, "findOrCreateByHostIdentifier")
    .mockResolvedValue(found as never);
  jest.spyOn(DockerHostService, "findOneBy").mockResolvedValue(host as never);
  jest.spyOn(DockerHostService, "updateOneBy").mockResolvedValue(0 as never);
  jest
    .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
    .mockResolvedValue(undefined as never);

  const copyOf: (row: ResourceAiAgent) => ResourceAiAgent = (
    row: ResourceAiAgent,
  ): ResourceAiAgent => {
    const copy: ResourceAiAgent = new ResourceAiAgent();
    Object.assign(copy, row);
    copy.id = row.id;
    return copy;
  };

  jest
    .spyOn(service, "findOneBy")
    .mockImplementation(async (findBy: AnyObject): Promise<never> => {
      const query: AnyObject = findBy["query"] || {};

      if (!table || (query["_id"] && query["_id"] !== table.id!.toString())) {
        return null as never;
      }

      return copyOf(table) as never;
    });
  jest
    .spyOn(service, "create")
    .mockImplementation(async (createBy: AnyObject): Promise<never> => {
      const row: ResourceAiAgent = createBy["data"] as ResourceAiAgent;
      row.id = AGENT_ID;
      table = copyOf(row);
      return row as never;
    });
  jest
    .spyOn(service, "updateOneById")
    .mockImplementation(async (updateBy: AnyObject): Promise<never> => {
      Object.assign(table!, updateBy["data"]);
      return undefined as never;
    });
  jest
    .spyOn(service, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (updateBy: AnyObject): Promise<void> => {
      Object.assign(table!, updateBy["data"]);
    });
  jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  const posture: JSONObject = {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "test01",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: ["oneuptime-docker-ai-agent"],
    reachable: true,
  };

  const authenticate: (
    agent: AgentCredentials,
  ) => Promise<ResourceAiAgent> = async (
    agent: AgentCredentials,
  ): Promise<ResourceAiAgent> => {
    const row: ResourceAiAgent | null = await service.authenticate(agent);

    expect(row).not.toBeNull();

    return row!;
  };

  return {
    at: clock.at,
    register: async (): Promise<AgentCredentials> => {
      const admitted: ResourceAiAgentRegistrationResult =
        await service.register({
          projectId: PROJECT_ID,
          resourceType: "docker",
          resourceIdentifier: "test01",
          agentVersion: "14.0.104",
          // A restarted agent proves it is the same one with its last key.
          previousAgentKey: key,
          posture,
        });

      key = admitted.agentKey;

      return {
        agentId: admitted.agentId.toString(),
        agentKey: admitted.agentKey,
      };
    },
    heartbeat: async (agent: AgentCredentials): Promise<void> => {
      await service.heartbeat({
        agent: await authenticate(agent),
        agentVersion: "14.0.104",
        posture,
      });
    },
    signOff: async (agent: AgentCredentials): Promise<void> => {
      await service.markDisconnected({
        resourceAiAgentId: (await authenticate(agent)).id!,
      });
    },
    ...watchConnections(),
  };
}

// A cluster's Kubernetes AI agent, registering and reporting as its pod does.
function clusterAgentStory(): Story {
  const service: KubernetesAiAgentServiceClass =
    new KubernetesAiAgentServiceClass();
  const clock: { at: (seconds: number) => void } = useClock();
  let table: KubernetesAiAgent | null = null;
  let key: string | undefined = undefined;

  quietLogs();

  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.id = CLUSTER_ID;
  cluster.projectId = PROJECT_ID;
  cluster.clusterIdentifier = "prod-us";
  cluster.isAiInvestigationEnabled = true;
  cluster.aiRemediationMode = KubernetesAiRemediationMode.RequireApproval;
  cluster.aiAccessConfiguredAt = START;

  jest
    .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
    .mockResolvedValue(cluster);
  jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(cluster);
  jest.spyOn(KubernetesClusterService, "updateOneBy").mockResolvedValue(0);
  jest
    .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "getLegacyAgentRunnerForCluster")
    .mockResolvedValue(null);
  jest
    .spyOn(service, "retireLegacyRunnerIfUnused")
    .mockResolvedValue("not_due" as never);

  const copyOf: (row: KubernetesAiAgent) => KubernetesAiAgent = (
    row: KubernetesAiAgent,
  ): KubernetesAiAgent => {
    const copy: KubernetesAiAgent = new KubernetesAiAgent();
    Object.assign(copy, row);
    copy.id = row.id;
    return copy;
  };

  jest
    .spyOn(service, "findOneBy")
    .mockImplementation(async (findBy: AnyObject): Promise<never> => {
      const query: AnyObject = findBy["query"] || {};

      if (!table || (query["_id"] && query["_id"] !== table.id!.toString())) {
        return null as never;
      }

      return copyOf(table) as never;
    });
  jest
    .spyOn(service, "create")
    .mockImplementation(async (createBy: AnyObject): Promise<never> => {
      const row: KubernetesAiAgent = createBy["data"] as KubernetesAiAgent;
      row.id = AGENT_ID;
      table = copyOf(row);
      return row as never;
    });
  jest
    .spyOn(service, "updateOneById")
    .mockImplementation(async (updateBy: AnyObject): Promise<never> => {
      Object.assign(table!, updateBy["data"]);
      return undefined as never;
    });
  jest
    .spyOn(service, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (updateBy: AnyObject): Promise<void> => {
      Object.assign(table!, updateBy["data"]);
    });
  jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  const posture: AnyObject = {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: true,
    allowNodeOperations: false,
    writeNamespaces: [],
    podNamespace: "oneuptime-agent",
    kubectlVersion: "v1.33.1",
    agentChartVersion: "14.0.104",
  };

  const authenticate: (
    agent: AgentCredentials,
  ) => Promise<KubernetesAiAgent> = async (
    agent: AgentCredentials,
  ): Promise<KubernetesAiAgent> => {
    const row: KubernetesAiAgent | null = await service.authenticate(agent);

    expect(row).not.toBeNull();

    return row!;
  };

  return {
    at: clock.at,
    register: async (): Promise<AgentCredentials> => {
      const admitted: KubernetesAiAgentRegistrationResult =
        await service.register({
          projectId: PROJECT_ID,
          clusterName: "prod-us",
          agentVersion: "14.0.104",
          previousAgentKey: key,
          posture,
        });

      key = admitted.agentKey;

      return {
        agentId: admitted.agentId.toString(),
        agentKey: admitted.agentKey,
      };
    },
    heartbeat: async (agent: AgentCredentials): Promise<void> => {
      await service.heartbeat({
        agent: await authenticate(agent),
        agentVersion: "14.0.104",
        posture,
      });
    },
    signOff: async (agent: AgentCredentials): Promise<void> => {
      await service.markDisconnected({
        kubernetesAiAgentId: (await authenticate(agent)).id!,
      });
    },
    ...watchConnections(),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

const RESOURCE_TARGET: RemediationFixesTarget = {
  lane: AutoRemediationDecisionLane.Resource,
  id: RESOURCE_ID.toString(),
};
const CLUSTER_TARGET: RemediationFixesTarget = {
  lane: AutoRemediationDecisionLane.KubernetesCluster,
  id: CLUSTER_ID.toString(),
};

describe.each([
  [
    "a resource AI agent (a Cloud AI agent, a Docker host's, ...)",
    resourceAgentStory,
    RESOURCE_TARGET,
    RESOURCE_ALIVE_SECONDS,
  ],
  [
    "a Kubernetes AI agent",
    clusterAgentStory,
    CLUSTER_TARGET,
    CLUSTER_ALIVE_SECONDS,
  ],
])(
  "%s",
  (
    _name: string,
    story: () => Story,
    target: RemediationFixesTarget,
    aliveSeconds: number,
  ) => {
    test("its first registration hands its target over, in its project", async () => {
      const s: Story = story();

      await s.register();

      expect(s.connected).toEqual([
        { projectId: PROJECT_ID.toString(), target },
      ]);
    });

    test("an ordinary heartbeat of an agent that is online hands nothing over", async () => {
      const s: Story = story();
      const agent: AgentCredentials = await s.register();

      for (let second: number = 30; second <= 300; second += 30) {
        s.at(second);
        await s.heartbeat(agent);
      }

      // The registration's, and no other.
      expect(s.connected).toHaveLength(1);
    });

    test("an agent coming back after it went quiet past the alive window hands its target over once", async () => {
      const s: Story = story();
      const agent: AgentCredentials = await s.register();

      // Quiet for longer than the alive window: offline on its pages.
      s.at(aliveSeconds + 60);
      await s.heartbeat(agent);

      expect(s.connected).toHaveLength(2);
      expect(s.connected[1]).toEqual({
        projectId: PROJECT_ID.toString(),
        target,
      });

      // Online again: its next heartbeats are ordinary ones.
      s.at(aliveSeconds + 90);
      await s.heartbeat(agent);
      s.at(aliveSeconds + 120);
      await s.heartbeat(agent);

      expect(s.connected).toHaveLength(2);
    });

    test("a heartbeat just inside the alive window is no coming back", async () => {
      const s: Story = story();
      const agent: AgentCredentials = await s.register();

      s.at(aliveSeconds - 5);
      await s.heartbeat(agent);

      expect(s.connected).toHaveLength(1);
    });

    test("an agent that signed off and reports again hands its target over", async () => {
      const s: Story = story();
      const agent: AgentCredentials = await s.register();

      s.at(30);
      await s.signOff(agent);
      s.at(40);
      await s.heartbeat(agent);

      expect(s.connected).toHaveLength(2);
    });

    test("a restarted agent registering again hands its target over again", async () => {
      const s: Story = story();

      await s.register();
      s.at(120);
      await s.register();

      expect(s.connected).toEqual([
        { projectId: PROJECT_ID.toString(), target },
        { projectId: PROJECT_ID.toString(), target },
      ]);
    });

    test("the request never waits for it: a decision that never ends does not hold the registration or the heartbeat", async () => {
      const s: Story = story();

      s.onAgentConnected.mockImplementation((() => {
        return new Promise<number>(() => {
          // Never settles.
        });
      }) as never);

      const agent: AgentCredentials = await s.register();

      s.at(aliveSeconds + 60);
      await s.heartbeat(agent);

      expect(s.onAgentConnected).toHaveBeenCalledTimes(2);
    });

    test("nothing it does fails the request: a decision that fails is logged", async () => {
      const s: Story = story();

      s.onAgentConnected.mockRejectedValue(
        new Error("Postgres is down") as never,
      );

      const agent: AgentCredentials = await s.register();

      s.at(aliveSeconds + 60);
      await expect(s.heartbeat(agent)).resolves.toBeUndefined();

      // Settled after the request answered.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      const errors: Array<string> = (
        logger.error as unknown as { mock: { calls: Array<Array<unknown>> } }
      ).mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      });

      expect(
        errors.some((message: string): boolean => {
          return (
            message.includes("could not decide again") &&
            message.includes("Postgres is down")
          );
        }),
      ).toBe(true);
    });
  },
);
