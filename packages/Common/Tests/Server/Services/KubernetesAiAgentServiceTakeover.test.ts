import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import {
  KUBERNETES_AI_AGENT_TAKEOVER_AFTER_SILENT_MS,
  KubernetesAiAgentRegistrationRefusedException,
  KubernetesAiAgentRegistrationResult,
  Service as KubernetesAiAgentServiceClass,
} from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import logger from "../../../Server/Utils/Logger";
import OneUptimeDate from "../../../Types/Date";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KUBERNETES_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getRefusedRegistrationWarning } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * KubernetesAiAgentService — an agent pod replaced without signing off: OOM
 * killed and restarted, deleted with --force, or lost with its node. Its
 * row still counts as online, so the new pod is refused
 * (previous_instance_online), and the refusal asks the row's agent to show
 * it is running: every request it authenticates answers it. One that sends
 * nothing for KUBERNETES_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS has stopped,
 * and the next registration takes its place; a live one answers within
 * seconds and keeps it. The cluster's AI agent page warns only about two
 * pods running at once.
 *
 * The agent row lives in an in-memory table and the clock is the test's.
 */

type AnyObject = Record<string, any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const START: Date = new Date("2026-10-25T09:00:00.000Z");
const TAKEOVER_SECONDS: number =
  KUBERNETES_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS;
const ALIVE_WINDOW_SECONDS: number =
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60;

const CLAIM_EVERY_SECONDS: number = 3;
const HEARTBEAT_EVERY_SECONDS: number = 30;

interface AgentCredentials {
  agentId: string;
  agentKey: string;
}

type Attempt =
  | { admitted: KubernetesAiAgentRegistrationResult; refused: null }
  | { admitted: null; refused: KubernetesAiAgentRegistrationRefusedException };

interface Story {
  service: KubernetesAiAgentServiceClass;
  at: (seconds: number) => void;
  attempt: (data?: {
    agentVersion?: string | undefined;
    previousAgentKey?: string | undefined;
  }) => Promise<Attempt>;
  registerAgent: () => Promise<AgentCredentials>;
  request: (agent: AgentCredentials) => Promise<boolean>;
  heartbeat: (agent: AgentCredentials, agentVersion?: string) => Promise<void>;
  signOff: (agent: AgentCredentials) => Promise<void>;
  row: () => KubernetesAiAgent;
  summary: () => KubernetesAiAgentSummary;
  warning: () => string | null;
  columnWrites: Array<AnyObject>;
}

function copyOf(row: KubernetesAiAgent): KubernetesAiAgent {
  const copy: KubernetesAiAgent = new KubernetesAiAgent();
  Object.assign(copy, row);
  copy.id = row.id;
  return copy;
}

function seconds(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}

function posture(agentVersion: string): AnyObject {
  return {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: false,
    allowNodeOperations: false,
    writeNamespaces: [],
    podNamespace: "oneuptime-agent",
    kubectlVersion: "v1.33.1",
    agentChartVersion: agentVersion,
  };
}

function setUp(): Story {
  const service: KubernetesAiAgentServiceClass =
    new KubernetesAiAgentServiceClass();
  let now: Date = START;
  let table: KubernetesAiAgent | null = null;
  const columnWrites: Array<AnyObject> = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });

  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  // A cluster someone configured, so no defaults apply.
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.id = CLUSTER_ID;
  cluster.projectId = PROJECT_ID;
  cluster.clusterIdentifier = "prod-us";
  cluster.isAiInvestigationEnabled = true;
  cluster.aiRemediationMode = KubernetesAiRemediationMode.Disabled;
  cluster.aiAccessConfiguredAt = START;

  jest
    .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
    .mockResolvedValue(cluster);
  jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(cluster);
  jest.spyOn(KubernetesClusterService, "updateOneBy").mockResolvedValue(0);
  jest
    .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
    .mockResolvedValue(undefined as never);
  // The chart's previous in-cluster Runner is long gone.
  jest
    .spyOn(KubernetesClusterAiAccessService, "getLegacyAgentRunnerForCluster")
    .mockResolvedValue(null);
  jest
    .spyOn(service, "retireLegacyRunnerIfUnused")
    .mockResolvedValue("not_due" as never);

  jest
    .spyOn(service, "findOneBy")
    .mockImplementation(async (findBy: AnyObject): Promise<never> => {
      const query: AnyObject = findBy["query"] || {};

      if (!table) {
        return null as never;
      }

      if (query["_id"] && query["_id"] !== table.id!.toString()) {
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
      columnWrites.push({ ...updateBy["data"] });
      Object.assign(table!, updateBy["data"]);
    });

  jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  const attempt: Story["attempt"] = async (
    data: {
      agentVersion?: string | undefined;
      previousAgentKey?: string | undefined;
    } = {},
  ): Promise<Attempt> => {
    const version: string = data.agentVersion || "14.0.88";

    try {
      const admitted: KubernetesAiAgentRegistrationResult =
        await service.register({
          projectId: PROJECT_ID,
          clusterName: "prod-us",
          agentVersion: version,
          previousAgentKey: data.previousAgentKey,
          posture: posture(version),
        });

      return { admitted, refused: null };
    } catch (error) {
      if (error instanceof KubernetesAiAgentRegistrationRefusedException) {
        return { admitted: null, refused: error };
      }

      throw error;
    }
  };

  const authenticate: (
    agent: AgentCredentials,
  ) => Promise<KubernetesAiAgent | null> = (
    agent: AgentCredentials,
  ): Promise<KubernetesAiAgent | null> => {
    return service.authenticate({
      agentId: agent.agentId,
      agentKey: agent.agentKey,
    });
  };

  return {
    service,
    at: (offsetSeconds: number): void => {
      now = new Date(START.getTime() + offsetSeconds * 1000);
    },
    attempt,
    registerAgent: async (): Promise<AgentCredentials> => {
      const result: Attempt = await attempt();

      expect(result.refused).toBeNull();

      return {
        agentId: result.admitted!.agentId.toString(),
        agentKey: result.admitted!.agentKey,
      };
    },
    request: async (agent: AgentCredentials): Promise<boolean> => {
      return Boolean(await authenticate(agent));
    },
    heartbeat: async (
      agent: AgentCredentials,
      agentVersion?: string,
    ): Promise<void> => {
      const row: KubernetesAiAgent | null = await authenticate(agent);

      expect(row).not.toBeNull();

      await service.heartbeat({
        agent: row!,
        agentVersion,
        posture: posture(agentVersion || "14.0.88"),
      });
    },
    signOff: async (agent: AgentCredentials): Promise<void> => {
      const row: KubernetesAiAgent | null = await authenticate(agent);

      expect(row).not.toBeNull();

      await service.markDisconnected({ kubernetesAiAgentId: row!.id! });
    },
    row: (): KubernetesAiAgent => {
      return table!;
    },
    summary: (): KubernetesAiAgentSummary => {
      return service.toSummary(table!, now);
    },
    warning: (): string | null => {
      return getRefusedRegistrationWarning(service.toSummary(table!, now), now);
    },
    columnWrites,
  };
}

async function runAgent(
  story: Story,
  agent: AgentCredentials,
  fromSeconds: number,
  toSeconds: number,
): Promise<void> {
  for (
    let second: number = fromSeconds;
    second <= toSeconds;
    second += CLAIM_EVERY_SECONDS
  ) {
    story.at(second);

    if ((second - fromSeconds) % HEARTBEAT_EVERY_SECONDS === 0) {
      await story.heartbeat(agent, "14.0.88");
    } else {
      expect(await story.request(agent)).toBe(true);
    }
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an agent pod replaced without signing off", () => {
  test("the new pod takes over once the old one has sent nothing for the takeover window, and the page shows it, without a warning", async () => {
    const story: Story = setUp();

    story.at(0);
    const old: AgentCredentials = await story.registerAgent();
    await runAgent(story, old, 0, 1800);

    // The pod is OOM-killed; the kubelet starts it again, without its key.
    story.at(1805);
    const first: Attempt = await story.attempt({ agentVersion: "14.0.89" });

    expect(first.refused?.reason).toBe("previous_instance_online");
    expect(first.refused?.retryAfterSeconds).toBe(TAKEOVER_SECONDS + 1);
    expect(story.summary().isOnline).toBe(true);
    expect(story.warning()).toBeNull();

    story.at(1805 + first.refused!.retryAfterSeconds!);
    const second: Attempt = await story.attempt({ agentVersion: "14.0.89" });

    expect(second.admitted?.admission).toBe("unresponsive");
    expect(story.summary().agentVersion).toBe("14.0.89");
    expect(story.summary().isOnline).toBe(true);
    expect(story.warning()).toBeNull();
    expect(await story.request(old)).toBe(false);
  });

  test("retries cannot push the takeover back", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();

    let admittedAt: number | null = null;

    for (let second: number = 10; second <= 120; second += 5) {
      story.at(second);

      if ((await story.attempt()).admitted) {
        admittedAt = second;
        break;
      }

      expect(
        seconds(START, story.row().lastRefusedRegistrationAt as Date),
      ).toBe(10);
    }

    expect(admittedAt).toBe(10 + TAKEOVER_SECONDS);
  });

  test("a clean shutdown signs off: the new pod is admitted at once, with nothing recorded", async () => {
    const story: Story = setUp();

    story.at(0);
    const old: AgentCredentials = await story.registerAgent();
    await runAgent(story, old, 0, 60);

    story.at(61);
    await story.signOff(old);

    story.at(62);
    expect((await story.attempt()).admitted?.admission).toBe("signed_off");
    expect(story.row().lastRefusedRegistrationAt).toBeFalsy();
    expect(story.warning()).toBeNull();
  });
});

describe("two pods running with one cluster name", () => {
  test("the second keeps being refused while the first keeps answering, and the page warns", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    let second: number = 30;

    while (second < 600) {
      story.at(second);
      const attempt: Attempt = await story.attempt();

      expect(attempt.refused?.reason).toBe("previous_instance_online");

      await runAgent(story, first, second + 2, second + 32);

      second += attempt.refused!.retryAfterSeconds!;
    }

    expect(await story.request(first)).toBe(true);
    expect(story.warning()).toMatch(
      /^Another agent tried to register for this cluster at .+ while this one was online\./,
    );
  });
});

describe("answering a refusal", () => {
  test("only the first request after an unanswered refusal writes, and only lastAliveAt", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    for (let second: number = 3; second <= 9; second += 3) {
      story.at(second);
      await story.request(first);
    }

    expect(story.columnWrites).toEqual([]);

    story.at(10);
    await story.attempt();
    const afterRefusal: number = story.columnWrites.length;

    for (let second: number = 12; second <= 30; second += 3) {
      story.at(second);
      await story.request(first);
    }

    const answers: Array<AnyObject> = story.columnWrites.slice(afterRefusal);

    expect(answers).toHaveLength(1);
    expect(Object.keys(answers[0]!)).toEqual(["lastAliveAt"]);
  });

  test("an answer stamped by a server whose clock runs behind still answers", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(40);
    await story.attempt();

    story.at(35);
    expect(await story.request(first)).toBe(true);
    expect(seconds(START, story.row().lastAliveAt as Date)).toBe(40);

    story.at(40 + TAKEOVER_SECONDS + 1);
    expect((await story.attempt()).refused?.reason).toBe(
      "previous_instance_online",
    );
  });

  test("a failed answer never fails the agent's request", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(10);
    await story.attempt();

    (
      story.service.updateColumnsByIdWithoutHooks as unknown as {
        mockRejectedValueOnce: (error: Error) => void;
      }
    ).mockRejectedValueOnce(new Error("database is down"));

    story.at(12);
    expect(await story.request(first)).toBe(true);
  });
});

describe("the pieces", () => {
  const service: KubernetesAiAgentServiceClass =
    new KubernetesAiAgentServiceClass();
  const NOW: Date = new Date("2026-10-25T10:00:00.000Z");

  function ago(secondsAgo: number): Date {
    return new Date(NOW.getTime() - secondsAgo * 1000);
  }

  test("getUnansweredRefusalSince: a previous_instance_online refusal the agent was not heard from after", () => {
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(30),
        lastRefusedRegistrationAt: ago(10),
        lastRefusedRegistrationReason: "previous_instance_online",
      }),
    ).toEqual(ago(10));
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(10),
        lastRefusedRegistrationAt: ago(10),
      }),
    ).toBeNull();
    // The upgrade overlap with the previous Runner is no wait to answer.
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(30),
        lastRefusedRegistrationAt: ago(10),
        lastRefusedRegistrationReason: "legacy_runner_online",
      }),
    ).toBeNull();
  });

  test("getReRegistrationAdmission: unresponsive after the whole window, never before, and never over reset, continuity, sign-off or offline", () => {
    const key: string = "ab".repeat(32);
    const pending: AnyObject = {
      keyHash: KubernetesAiAgentServiceClass.hashKey(key),
      connectionStatus: "connected",
      lastAliveAt: ago(TAKEOVER_SECONDS + 30),
      lastRefusedRegistrationAt: ago(TAKEOVER_SECONDS),
      lastRefusedRegistrationReason: "previous_instance_online",
    };

    function admission(agent: AnyObject, previousAgentKey?: string): unknown {
      return service.getReRegistrationAdmission({
        agent: agent as never,
        previousAgentKey,
        now: NOW,
      });
    }

    expect(admission(pending)).toBe("unresponsive");
    expect(
      admission({
        ...pending,
        lastRefusedRegistrationAt: new Date(
          NOW.getTime() - KUBERNETES_AI_AGENT_TAKEOVER_AFTER_SILENT_MS + 1,
        ),
      }),
    ).toBeNull();
    expect(admission({ ...pending, lastAliveAt: ago(1) })).toBeNull();
    expect(admission({ ...pending, keyHash: null })).toBe("reset");
    expect(admission(pending, key)).toBe("continuity");
    expect(admission({ ...pending, connectionStatus: "disconnected" })).toBe(
      "signed_off",
    );
    expect(
      admission({ ...pending, lastAliveAt: ago(ALIVE_WINDOW_SECONDS + 1) }),
    ).toBe("offline");
  });

  test("getTakeoverRetryAfterSeconds: the rest of the window plus a second, between 1 and a whole window", () => {
    function retry(unansweredSecondsAgo: number): number {
      return KubernetesAiAgentServiceClass.getTakeoverRetryAfterSeconds({
        unansweredSince: ago(unansweredSecondsAgo),
        now: NOW,
      });
    }

    expect(retry(0)).toBe(TAKEOVER_SECONDS + 1);
    expect(retry(15)).toBe(TAKEOVER_SECONDS - 15 + 1);
    expect(retry(TAKEOVER_SECONDS)).toBe(1);
    expect(retry(-3600)).toBe(TAKEOVER_SECONDS + 1);
  });
});
