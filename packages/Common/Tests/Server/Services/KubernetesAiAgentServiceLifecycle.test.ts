import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import KubernetesAiAgentService, {
  KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
  LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS,
  LEGACY_RUNNER_RETIREMENT_CHECK_INTERVAL_MS,
  LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS,
  LegacyRunnerRetirementOutcome,
  Service as KubernetesAiAgentServiceClass,
} from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerService from "../../../Server/Services/RunnerService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
/*
 * The Kubernetes AI agent after registration (DESIGN §5.1, §5.2):
 *
 *  - authenticate: every later request carries the agent id and key; the
 *    key's sha256 must match the row (timing-safe). Wrong key, reset row
 *    (null hash), unknown id and malformed input are all null, and the row
 *    handed back never carries the hash;
 *  - heartbeat: alive + connected, the posture stored with inCluster and
 *    the cluster's identifier forced, and — only on a cluster nobody
 *    configured whose fixes are Off — "Ask for approval" once the agent's
 *    write access appears;
 *  - markDisconnected: the sign-off, which admits a replacement at once;
 *  - resetAgent: the admin's reset — no key works any more, the row reads
 *    disconnected, and the feed says so;
 *  - retireLegacyRunnerIfUnused: the previous in-cluster Runner is deleted
 *    only when it is certainly unused.
 *
 * No database: everything below the service boundary is stubbed.
 */

interface SpyCalls {
  mock: { calls: Array<Array<unknown>> };
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LEGACY_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const AGENT_KEY: string = "ab".repeat(32);
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

function msAgo(ms: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - ms);
}

function makeAgent(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesAiAgent {
  const agent: KubernetesAiAgent = new KubernetesAiAgent();
  agent.id = AGENT_ID;
  agent.projectId = PROJECT_ID;
  agent.kubernetesClusterId = CLUSTER_ID;
  agent.keyHash = KubernetesAiAgentServiceClass.hashKey(AGENT_KEY);
  agent.connectionStatus = "connected";
  agent.lastAliveAt = msAgo(20 * 1000);
  agent.createdAt = msAgo(3 * DAY_MS);
  agent.posture = {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: false,
  };
  Object.assign(agent, overrides);
  return agent;
}

function makeCluster(
  overrides: Partial<KubernetesCluster> = {},
): KubernetesCluster {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.id = CLUSTER_ID;
  cluster.projectId = PROJECT_ID;
  cluster.clusterIdentifier = "prod-us";
  cluster.isAiInvestigationEnabled = true;
  cluster.aiRemediationMode = KubernetesAiRemediationMode.Disabled;
  Object.assign(cluster, overrides);
  return cluster;
}

function silenceLogger(): void {
  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }
}

beforeEach(() => {
  silenceLogger();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("authenticate", () => {
  let findOneBy: SpyCalls;

  function stubRow(row: KubernetesAiAgent | null): void {
    findOneBy = jest
      .spyOn(KubernetesAiAgentService, "findOneBy")
      .mockResolvedValue(row) as unknown as SpyCalls;
  }

  test("the right key returns the row, read by id as root with the hash selected, and hands it back without the hash", async () => {
    stubRow(makeAgent());

    const agent: KubernetesAiAgent | null =
      await KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      });

    expect(agent).not.toBeNull();
    expect(agent!.id!.toString()).toBe(AGENT_ID.toString());
    expect(agent!.keyHash).toBeUndefined();
    expect(Object.keys(agent!)).not.toContain("keyHash");

    const read: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    } = findOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    };

    expect(read.query).toEqual({ _id: AGENT_ID.toString() });
    expect(read.select).toEqual({
      ...KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
      keyHash: true,
    });
    expect(read.props["isRoot"]).toBe(true);
  });

  test("accepts the id as an ObjectID too", async () => {
    stubRow(makeAgent());

    await expect(
      KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID,
        agentKey: AGENT_KEY,
      }),
    ).resolves.not.toBeNull();
  });

  test("a wrong key is null", async () => {
    stubRow(makeAgent());

    await expect(
      KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: "cd".repeat(32),
      }),
    ).resolves.toBeNull();
  });

  test("the stored hash presented as the key is null", async () => {
    stubRow(makeAgent());

    await expect(
      KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: KubernetesAiAgentServiceClass.hashKey(AGENT_KEY),
      }),
    ).resolves.toBeNull();
  });

  // After an admin reset no key works — the pod has to register again.
  test("a reset row (no hash) is null, even for the key it used to have", async () => {
    stubRow(makeAgent({ keyHash: null }));

    await expect(
      KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      }),
    ).resolves.toBeNull();
  });

  test("an unknown id is null, and costs the same hash comparison as a wrong key", async () => {
    stubRow(null);
    const compare: SpyCalls = jest.spyOn(
      KubernetesAiAgentServiceClass,
      "doesKeyMatchHash",
    ) as unknown as SpyCalls;

    await expect(
      KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      }),
    ).resolves.toBeNull();

    expect(compare.mock.calls).toHaveLength(1);
    expect(compare.mock.calls[0]![0]).toBe(AGENT_KEY);
    expect(String(compare.mock.calls[0]![1])).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ["an empty id", "", AGENT_KEY],
    ["an id that is not a UUID", "agent-1", AGENT_KEY],
    ["a SQL-ish id", "' OR 1=1 --", AGENT_KEY],
    ["an empty key", AGENT_ID.toString(), ""],
    ["a non-string key", AGENT_ID.toString(), 42],
  ])(
    "%s is null without touching the database",
    async (_label: string, agentId: string, agentKey: unknown) => {
      stubRow(makeAgent());

      await expect(
        KubernetesAiAgentService.authenticate({
          agentId,
          agentKey: agentKey as string,
        }),
      ).resolves.toBeNull();

      expect(findOneBy.mock.calls).toHaveLength(0);
    },
  );
});

describe("heartbeat", () => {
  interface HeartbeatHarness {
    clusterFindOneBy: SpyCalls;
    agentUpdateColumns: SpyCalls;
    agentUpdateOneById: SpyCalls;
    clusterUpdateOneBy: SpyCalls;
    feed: SpyCalls;
    retire: SpyCalls;
  }

  function setUp(
    options: { cluster?: KubernetesCluster | null } = {},
  ): HeartbeatHarness {
    return {
      clusterFindOneBy: jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(
          options.cluster === undefined ? makeCluster() : options.cluster,
        ) as unknown as SpyCalls,
      agentUpdateColumns: jest
        .spyOn(KubernetesAiAgentService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      agentUpdateOneById: jest
        .spyOn(KubernetesAiAgentService, "updateOneById")
        .mockResolvedValue(1) as unknown as SpyCalls,
      clusterUpdateOneBy: jest
        .spyOn(KubernetesClusterService, "updateOneBy")
        .mockResolvedValue(1) as unknown as SpyCalls,
      feed: jest
        .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      retire: jest
        .spyOn(KubernetesAiAgentService, "retireLegacyRunnerIfUnused")
        .mockResolvedValue("not_due") as unknown as SpyCalls,
    };
  }

  function written(harness: HeartbeatHarness): {
    id: ObjectID;
    data: Record<string, unknown>;
  } {
    expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);
    return harness.agentUpdateColumns.mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
    };
  }

  test("marks the agent alive and connected in one hook-free write", async () => {
    const harness: HeartbeatHarness = setUp();
    const before: number = Date.now();

    await KubernetesAiAgentService.heartbeat({ agent: makeAgent() });

    const write: { id: ObjectID; data: Record<string, unknown> } =
      written(harness);
    expect(write.id.toString()).toBe(AGENT_ID.toString());
    expect(write.data["connectionStatus"]).toBe("connected");
    expect(
      (write.data["lastAliveAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(harness.agentUpdateOneById.mock.calls).toHaveLength(0);
  });

  // Every 30 seconds per cluster: the common case must not read anything.
  test.each([
    ["without a posture", undefined],
    ["with an unchanged read-only posture", { allowWrites: false }],
    [
      "with writes it already had",
      { allowWrites: true, writeNamespaces: ["web"] },
    ],
  ])(
    "a normal heartbeat (%s) reads no cluster row",
    async (_label: string, posture: unknown) => {
      const harness: HeartbeatHarness = setUp();
      const agent: KubernetesAiAgent = makeAgent();
      if (posture && (posture as JSONObject)["allowWrites"] === true) {
        agent.posture = {
          clusterIdentifier: "prod-us",
          inCluster: true,
          allowWrites: true,
        };
      }

      await KubernetesAiAgentService.heartbeat({ agent, posture });

      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
      expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);
    },
  );

  test("stores the reported posture with in-cluster and the identifier registration stored forced", async () => {
    const harness: HeartbeatHarness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({
        posture: {
          clusterIdentifier: "Prod-US",
          inCluster: true,
          allowWrites: false,
        },
      }),
      agentVersion: "14.2.0",
      posture: {
        clusterIdentifier: "someone-else",
        inCluster: false,
        allowWrites: false,
        writeNamespaces: ["web"],
        podNamespace: "oneuptime-agent",
        kubectlVersion: "v1.33.2",
      },
    });

    const write: { data: Record<string, unknown> } = written(harness);
    expect(write.data["posture"]).toEqual({
      clusterIdentifier: "Prod-US",
      inCluster: true,
      allowWrites: false,
      writeNamespaces: ["web"],
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.33.2",
    });
    expect(write.data["agentVersion"]).toBe("14.2.0");
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
  });

  test("a stored posture without an identifier: reads the agent's own cluster (in its project, as root) and forces its identifier", async () => {
    const harness: HeartbeatHarness = setUp({
      cluster: makeCluster({ clusterIdentifier: "Prod-US" }),
    });

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: { inCluster: true, allowWrites: false } }),
      posture: { clusterIdentifier: "someone-else", allowWrites: false },
    });

    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
    const read: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = harness.clusterFindOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(read.query["_id"]).toBe(CLUSTER_ID.toString());
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.props["isRoot"]).toBe(true);
    expect(
      (written(harness).data["posture"] as JSONObject)["clusterIdentifier"],
    ).toBe("Prod-US");
  });

  test("a blank stored identifier counts as none", async () => {
    const harness: HeartbeatHarness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({
        posture: { clusterIdentifier: "  ", inCluster: true },
      }),
      posture: { allowWrites: false },
    });

    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
    expect(
      (written(harness).data["posture"] as JSONObject)["clusterIdentifier"],
    ).toBe("prod-us");
  });

  test("with neither a stored identifier nor a cluster row, the reported identifier is still never trusted", async () => {
    const harness: HeartbeatHarness = setUp({ cluster: null });

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: null }),
      posture: { clusterIdentifier: "other", allowWrites: false },
    });

    const posture: JSONObject = written(harness).data["posture"] as JSONObject;
    expect(posture).not.toHaveProperty("clusterIdentifier");
    expect(posture["inCluster"]).toBe(true);
  });

  test("a heartbeat without a posture never needs the cluster row, even when the stored posture has no identifier", async () => {
    const harness: HeartbeatHarness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: null }),
    });

    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
    expect(written(harness).data).not.toHaveProperty("posture");
  });

  test.each([
    ["no posture", undefined],
    ["a string", "allowWrites=true"],
    ["null", null],
  ])(
    "%s keeps the stored posture (only liveness is written)",
    async (_label: string, posture: unknown) => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({ agent: makeAgent(), posture });

      expect(written(harness).data).not.toHaveProperty("posture");
    },
  );

  test("an empty or missing version is not written", async () => {
    const harness: HeartbeatHarness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent(),
      agentVersion: "  ",
    });

    expect(written(harness).data).not.toHaveProperty("agentVersion");
  });

  test("an agent without an id is a programming error", async () => {
    setUp();
    const agent: KubernetesAiAgent = makeAgent();
    agent._id = undefined as unknown as string;

    await expect(
      KubernetesAiAgentService.heartbeat({ agent }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  describe("write access appearing", () => {
    test("on a cluster nobody configured with fixes Off: Ask for approval, and a feed item", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true, writeNamespaces: ["web"] },
      });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(1);
      expect(
        (
          harness.clusterUpdateOneBy.mock.calls[0]![0] as {
            data: Record<string, unknown>;
          }
        ).data,
      ).toEqual({
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });

      expect(harness.feed.mock.calls).toHaveLength(1);
      const text: string = String(
        (harness.feed.mock.calls[0]![0] as Record<string, unknown>)[
          "feedInfoInMarkdown"
        ],
      );
      expect(text).toContain("can now make changes in web");
      expect(text).toContain('"Ask for approval"');
      expect(text).toContain("AI agent page");
    });

    test("never on a cluster someone configured", async () => {
      const harness: HeartbeatHarness = setUp({
        cluster: makeCluster({ aiAccessConfiguredAt: msAgo(HOUR_MS) }),
      });

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
      });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
      expect(harness.feed.mock.calls).toHaveLength(0);
    });

    test.each([
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.Automatic,
      KubernetesAiRemediationMode.BypassApproval,
    ])(
      "never changes a mode that is not Off (%s)",
      async (mode: KubernetesAiRemediationMode) => {
        const harness: HeartbeatHarness = setUp({
          cluster: makeCluster({ aiRemediationMode: mode }),
        });

        await KubernetesAiAgentService.heartbeat({
          agent: makeAgent(),
          posture: { allowWrites: true },
        });

        expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
      },
    );

    test("only when writes APPEAR: an agent that already had them changes nothing", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent({
          posture: {
            clusterIdentifier: "prod-us",
            inCluster: true,
            allowWrites: true,
          },
        }),
        posture: { allowWrites: true },
      });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
    });

    test("an agent that stays read-only changes nothing", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: false },
      });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
    });

    test("a heartbeat without a posture is not writes appearing", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({ agent: makeAgent() });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
    });

    test("a stored posture that was never set counts as read-only before", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent({ posture: null }),
        posture: { allowWrites: true },
      });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(1);
    });

    test("the defaults are conditional on the cluster still being unconfigured; a lost race writes no feed item", async () => {
      const harness: HeartbeatHarness = setUp();
      (
        harness.clusterUpdateOneBy as unknown as {
          mockResolvedValue: (value: number) => void;
        }
      ).mockResolvedValue(0);

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
      });

      const query: Record<string, unknown> = (
        harness.clusterUpdateOneBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(query).toHaveProperty("aiAccessConfiguredAt");
      expect(harness.feed.mock.calls).toHaveLength(0);
    });

    test("reads the agent's own cluster (in its project, as root) for its current AI settings, after the liveness write", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
      });

      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
      const read: {
        query: Record<string, unknown>;
        select: Record<string, boolean>;
        props: Record<string, unknown>;
      } = harness.clusterFindOneBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, boolean>;
        props: Record<string, unknown>;
      };
      expect(read.query["_id"]).toBe(CLUSTER_ID.toString());
      expect(read.query["projectId"]).toBe(PROJECT_ID);
      expect(read.select["aiAccessConfiguredAt"]).toBe(true);
      expect(read.select["aiRemediationMode"]).toBe(true);
      expect(read.props["isRoot"]).toBe(true);
      expect(written(harness).data["posture"]).toBeDefined();
    });

    test("the cluster row is read once, even when the identifier needed it too", async () => {
      const harness: HeartbeatHarness = setUp();

      await KubernetesAiAgentService.heartbeat({
        agent: makeAgent({ posture: null }),
        posture: { allowWrites: true },
      });

      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(1);
    });

    test("a cluster row that is gone changes nothing", async () => {
      const harness: HeartbeatHarness = setUp({ cluster: null });

      await expect(
        KubernetesAiAgentService.heartbeat({
          agent: makeAgent(),
          posture: { allowWrites: true },
        }),
      ).resolves.toBeUndefined();

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
      expect(harness.feed.mock.calls).toHaveLength(0);
    });

    /*
     * The liveness is already written; a heartbeat that failed here would
     * make the agent think its connection broke. The next registration
     * applies the defaults again.
     */
    test("a failure applying the defaults never fails the heartbeat, and no feed item claims a change", async () => {
      const harness: HeartbeatHarness = setUp();
      (
        harness.clusterUpdateOneBy as unknown as {
          mockRejectedValue: (error: Error) => void;
        }
      ).mockRejectedValue(new Error("database is down"));

      await expect(
        KubernetesAiAgentService.heartbeat({
          agent: makeAgent(),
          posture: { allowWrites: true },
        }),
      ).resolves.toBeUndefined();

      expect(
        (written(harness).data["posture"] as JSONObject)["allowWrites"],
      ).toBe(true);
      expect(harness.feed.mock.calls).toHaveLength(0);
      expect(
        JSON.stringify((logger.error as unknown as SpyCalls).mock.calls),
      ).toContain("first-connection defaults");
    });
  });

  test("starts the previous-Runner check without waiting for it", async () => {
    const harness: HeartbeatHarness = setUp();
    let resolveRetirement: (
      value: LegacyRunnerRetirementOutcome,
    ) => void = () => {
      return undefined;
    };
    (
      harness.retire as unknown as {
        mockImplementation: (
          impl: () => Promise<LegacyRunnerRetirementOutcome>,
        ) => void;
      }
    ).mockImplementation(() => {
      return new Promise<LegacyRunnerRetirementOutcome>(
        (resolve: (value: LegacyRunnerRetirementOutcome) => void) => {
          resolveRetirement = resolve;
        },
      );
    });

    // Resolves although the check never finishes.
    await KubernetesAiAgentService.heartbeat({ agent: makeAgent() });

    expect(harness.retire.mock.calls).toHaveLength(1);
    const call: { agent: KubernetesAiAgent; cluster?: KubernetesCluster } =
      harness.retire.mock.calls[0]![0] as {
        agent: KubernetesAiAgent;
        cluster?: KubernetesCluster;
      };
    expect(call.agent.id!.toString()).toBe(AGENT_ID.toString());
    // The hourly check reads the cluster itself, only when it is due.
    expect(call).not.toHaveProperty("cluster");
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);

    resolveRetirement("not_due");
  });

  test("hands the previous-Runner check the cluster row when the heartbeat already read it", async () => {
    const harness: HeartbeatHarness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: null }),
      posture: { allowWrites: false },
    });

    const call: { cluster?: KubernetesCluster } = harness.retire.mock
      .calls[0]![0] as { cluster?: KubernetesCluster };
    expect(call.cluster!.id!.toString()).toBe(CLUSTER_ID.toString());
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
  });

  test("a failing previous-Runner check never fails the heartbeat", async () => {
    const harness: HeartbeatHarness = setUp();
    (
      harness.retire as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("boom"));

    await expect(
      KubernetesAiAgentService.heartbeat({ agent: makeAgent() }),
    ).resolves.toBeUndefined();
  });
});

describe("markDisconnected", () => {
  test("writes only the disconnected status — lastAliveAt stays the truth about the last heartbeat", async () => {
    const update: SpyCalls = jest
      .spyOn(KubernetesAiAgentService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined) as unknown as SpyCalls;

    await KubernetesAiAgentService.markDisconnected({
      kubernetesAiAgentId: AGENT_ID,
    });

    expect(update.mock.calls[0]![0]).toEqual({
      id: AGENT_ID,
      data: { connectionStatus: "disconnected" },
    });
  });

  test("requires the agent id", async () => {
    await expect(
      KubernetesAiAgentService.markDisconnected({
        kubernetesAiAgentId: undefined as unknown as ObjectID,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  // The sign-off is what admits a replacement pod at once.
  test("a signed-off agent is offline and admits the next registration", () => {
    const signedOff: KubernetesAiAgent = makeAgent({
      connectionStatus: "disconnected",
      lastAliveAt: msAgo(1000),
    });

    expect(KubernetesAiAgentService.isOnline(signedOff)).toBe(false);
    expect(
      KubernetesAiAgentService.getReRegistrationAdmission({ agent: signedOff }),
    ).toBe("signed_off");
  });
});

describe("resetAgent", () => {
  const USER_MARKDOWN: string = `[Jane Doe](https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/settings/users/${USER_ID.toString()})`;

  interface ResetHarness {
    find: SpyCalls;
    update: SpyCalls;
    feed: SpyCalls;
    userName: SpyCalls;
  }

  function setUp(row: KubernetesAiAgent | null = makeAgent()): ResetHarness {
    return {
      find: jest
        .spyOn(KubernetesAiAgentService, "findForCluster")
        .mockResolvedValue(row) as unknown as SpyCalls,
      update: jest
        .spyOn(KubernetesAiAgentService, "updateOneById")
        .mockResolvedValue(1) as unknown as SpyCalls,
      feed: jest
        .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      userName: jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue(FeedMarkdown.asMarkdown(USER_MARKDOWN)) as unknown as SpyCalls,
    };
  }

  function feedText(harness: ResetHarness): string {
    expect(harness.feed.mock.calls).toHaveLength(1);
    return String(
      (harness.feed.mock.calls[0]![0] as Record<string, unknown>)[
        "feedInfoInMarkdown"
      ],
    );
  }

  test("clears the key hash and marks the agent disconnected, as root", async () => {
    const harness: ResetHarness = setUp();

    await KubernetesAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      userId: USER_ID,
    });

    expect(harness.find.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
    });

    const write: {
      id: ObjectID;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    } = harness.update.mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(write.id.toString()).toBe(AGENT_ID.toString());
    expect(write.data).toEqual({
      keyHash: null,
      connectionStatus: "disconnected",
    });
    expect(write.props["isRoot"]).toBe(true);
  });

  test("writes a feed item, attributed to the user, that says who reset it and that it comes back on its own", async () => {
    const harness: ResetHarness = setUp();

    await KubernetesAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      userId: USER_ID,
    });

    const item: Record<string, unknown> = harness.feed.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(item["kubernetesClusterId"]).toBe(CLUSTER_ID);
    expect(item["projectId"]).toBe(PROJECT_ID);
    expect(item["userId"]).toBe(USER_ID);
    expect(feedText(harness)).toBe(
      `🔄 The Kubernetes AI agent was reset by **${USER_MARKDOWN}**. It reconnects on its own within a few minutes.`,
    );
  });

  test("names the user the way other cluster feed items do: looked up in the cluster's project", async () => {
    const harness: ResetHarness = setUp();

    await KubernetesAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      userId: USER_ID,
    });

    expect(harness.userName.mock.calls).toEqual([
      [{ userId: USER_ID, projectId: PROJECT_ID }],
    ]);
  });

  test("without a user (a master admin), the feed item names nobody and carries no user", async () => {
    const harness: ResetHarness = setUp();

    await KubernetesAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
    });

    expect(harness.feed.mock.calls[0]![0]).not.toHaveProperty("userId");
    expect(harness.userName.mock.calls).toHaveLength(0);
    expect(feedText(harness)).toBe(
      "🔄 The Kubernetes AI agent was reset. It reconnects on its own within a few minutes.",
    );
  });

  test("a user who cannot be named (no such user) gets the plain wording, still attributed", async () => {
    const harness: ResetHarness = setUp();
    (
      harness.userName as unknown as {
        mockResolvedValue: (value: string) => void;
      }
    ).mockResolvedValue("");

    await KubernetesAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      userId: USER_ID,
    });

    expect(feedText(harness)).toBe(
      "🔄 The Kubernetes AI agent was reset. It reconnects on its own within a few minutes.",
    );
    expect(
      (harness.feed.mock.calls[0]![0] as Record<string, unknown>)["userId"],
    ).toBe(USER_ID);
  });

  // The reset is done by then; the wording must not be able to fail it.
  test("a failing name lookup never fails the reset: the key is cleared and the feed item uses the plain wording", async () => {
    const harness: ResetHarness = setUp();
    (
      harness.userName as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await expect(
      KubernetesAiAgentService.resetAgent({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();

    expect(harness.update.mock.calls).toHaveLength(1);
    expect(feedText(harness)).toBe(
      "🔄 The Kubernetes AI agent was reset. It reconnects on its own within a few minutes.",
    );
    expect(
      JSON.stringify((logger.error as unknown as SpyCalls).mock.calls),
    ).toContain(USER_ID.toString());
  });

  test("a cluster without an agent is a plain error, and nothing is written", async () => {
    const harness: ResetHarness = setUp(null);

    await expect(
      KubernetesAiAgentService.resetAgent({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      }),
    ).rejects.toThrow("This cluster has no Kubernetes AI agent to reset.");

    expect(harness.update.mock.calls).toHaveLength(0);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  /*
   * What the reset is for: the old key (whoever holds it) stops working at
   * once, and the real pod's next registration is admitted.
   */
  test("after a reset the old key no longer authenticates, and the next registration is admitted", async () => {
    const reset: KubernetesAiAgent = makeAgent({
      keyHash: null,
      connectionStatus: "disconnected",
    });
    jest.spyOn(KubernetesAiAgentService, "findOneBy").mockResolvedValue(reset);

    await expect(
      KubernetesAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      }),
    ).resolves.toBeNull();

    expect(
      KubernetesAiAgentService.getReRegistrationAdmission({
        agent: reset,
        previousAgentKey: AGENT_KEY,
      }),
    ).toBe("reset");
  });
});

describe("retireLegacyRunnerIfUnused", () => {
  const NOW: Date = new Date("2026-09-28T10:00:00.000Z");

  interface RetireHarness {
    service: KubernetesAiAgentServiceClass;
    lookup: SpyCalls;
    online: SpyCalls;
    holdings: SpyCalls;
    rules: SpyCalls;
    remove: SpyCalls;
    feed: SpyCalls;
    clusterFindOneBy: SpyCalls;
  }

  function legacyRunner(overrides: Partial<Runner> = {}): Runner {
    const runner: Runner = new Runner();
    runner.id = LEGACY_RUNNER_ID;
    runner.name = "kubernetes-agent/prod-us";
    runner.lastAlive = msAgo(
      (LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS + 1) * DAY_MS,
      NOW,
    );
    runner.connectionStatus = RunnerConnectionStatus.Disconnected;
    Object.assign(runner, overrides);
    return runner;
  }

  function setUp(
    options: {
      runner?: Runner | null;
      online?: boolean;
      holdings?: Array<{ description: string; remedy: string }>;
      rules?: number;
      clusterRow?: KubernetesCluster | null;
    } = {},
  ): RetireHarness {
    return {
      // A fresh instance: the hourly throttle is per process (per instance).
      service: new KubernetesAiAgentServiceClass(),
      lookup: jest
        .spyOn(
          KubernetesClusterAiAccessService,
          "getLegacyAgentRunnerForCluster",
        )
        .mockResolvedValue(
          options.runner === undefined ? legacyRunner() : options.runner,
        ) as unknown as SpyCalls,
      online: jest
        .spyOn(KubernetesClusterAiAccessService, "isRunnerOnline")
        .mockReturnValue(options.online === true) as unknown as SpyCalls,
      holdings: jest
        .spyOn(
          KubernetesClusterAiAccessService,
          "getRunnerHoldingsBeyondDefaults",
        )
        .mockResolvedValue(options.holdings || []) as unknown as SpyCalls,
      rules: jest
        .spyOn(AutoRemediationRuleService, "countBy")
        .mockResolvedValue(
          new PositiveNumber(options.rules || 0),
        ) as unknown as SpyCalls,
      remove: jest
        .spyOn(RunnerService, "deleteOneBy")
        .mockResolvedValue(1) as unknown as SpyCalls,
      feed: jest
        .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      clusterFindOneBy: jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(
          options.clusterRow === undefined ? makeCluster() : options.clusterRow,
        ) as unknown as SpyCalls,
    };
  }

  function retire(
    harness: RetireHarness,
    options: {
      agent?: KubernetesAiAgent;
      now?: Date;
      // false: the caller has no cluster row (the heartbeat's usual case).
      withCluster?: boolean;
    } = {},
  ): Promise<LegacyRunnerRetirementOutcome> {
    return harness.service.retireLegacyRunnerIfUnused({
      agent:
        options.agent ||
        makeAgent({
          createdAt: msAgo(
            (LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS + 1) * HOUR_MS,
            NOW,
          ),
        }),
      ...(options.withCluster === false ? {} : { cluster: makeCluster() }),
      now: options.now || NOW,
    });
  }

  describe("without the cluster row", () => {
    test("reads the agent's own cluster (in its project, as root) once the check is due, and checks against it", async () => {
      const harness: RetireHarness = setUp();

      await expect(retire(harness, { withCluster: false })).resolves.toBe(
        "retired",
      );

      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
      const read: {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      } = harness.clusterFindOneBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      };
      expect(read.query["_id"]).toBe(CLUSTER_ID.toString());
      expect(read.query["projectId"]).toBe(PROJECT_ID);
      expect(read.props["isRoot"]).toBe(true);
      expect(harness.lookup.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        clusterIdentifier: "prod-us",
      });
    });

    test("a check that is not due reads nothing", async () => {
      const harness: RetireHarness = setUp({ online: true });

      await retire(harness, { withCluster: false });
      await expect(
        retire(harness, {
          withCluster: false,
          now: new Date(NOW.getTime() + 60 * 1000),
        }),
      ).resolves.toBe("not_due");

      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);
    });

    test("an agent too new to retire anything reads nothing", async () => {
      const harness: RetireHarness = setUp();

      await expect(
        retire(harness, {
          withCluster: false,
          agent: makeAgent({ createdAt: msAgo(HOUR_MS, NOW) }),
        }),
      ).resolves.toBe("agent_too_new");

      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
    });

    test("a cluster row that is gone: nothing to do", async () => {
      const harness: RetireHarness = setUp({ clusterRow: null });

      await expect(retire(harness, { withCluster: false })).resolves.toBe(
        "no_legacy_runner",
      );
      expect(harness.lookup.mock.calls).toHaveLength(0);
      expect(harness.remove.mock.calls).toHaveLength(0);
    });

    test("an agent that names no cluster reads nothing and does nothing", async () => {
      const harness: RetireHarness = setUp();

      await expect(
        retire(harness, {
          withCluster: false,
          agent: makeAgent({
            kubernetesClusterId: undefined,
            createdAt: msAgo(3 * DAY_MS, NOW),
          }),
        }),
      ).resolves.toBe("no_legacy_runner");
      expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
      expect(harness.remove.mock.calls).toHaveLength(0);
    });

    test("a failing cluster read is reported, never thrown", async () => {
      const harness: RetireHarness = setUp();
      (
        harness.clusterFindOneBy as unknown as {
          mockRejectedValue: (error: Error) => void;
        }
      ).mockRejectedValue(new Error("database is down"));

      await expect(retire(harness, { withCluster: false })).resolves.toBe(
        "failed",
      );
      expect(harness.remove.mock.calls).toHaveLength(0);
      expect(
        JSON.stringify((logger.error as unknown as SpyCalls).mock.calls),
      ).toContain(CLUSTER_ID.toString());
    });
  });

  test("a caller that has the cluster row is not made to read it again", async () => {
    const harness: RetireHarness = setUp();

    await expect(retire(harness)).resolves.toBe("retired");
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
  });

  test("a Runner silent for over a week, holding nothing, named by no rule, is deleted (hard, as root) and the feed says so", async () => {
    const harness: RetireHarness = setUp();

    await expect(retire(harness)).resolves.toBe("retired");

    expect(harness.remove.mock.calls).toHaveLength(1);
    expect(harness.remove.mock.calls[0]![0]).toEqual({
      query: { _id: LEGACY_RUNNER_ID.toString(), projectId: PROJECT_ID },
      props: { isRoot: true },
    });

    expect(harness.feed.mock.calls).toHaveLength(1);
    const text: string = String(
      (harness.feed.mock.calls[0]![0] as Record<string, unknown>)[
        "feedInfoInMarkdown"
      ],
    );
    expect(text).toContain("kubernetes-agent/prod-us");
    expect(text).toContain("was removed");
    expect(text).toContain("Kubernetes AI agent replaced it");
  });

  test("asks for this cluster's previous Runner, and for its holdings against this cluster", async () => {
    const harness: RetireHarness = setUp();

    await retire(harness);

    expect(harness.lookup.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      clusterIdentifier: "prod-us",
    });
    const holdingsCall: Record<string, unknown> = harness.holdings.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(String(holdingsCall["clusterId"])).toBe(CLUSTER_ID.toString());
    expect(String(holdingsCall["projectId"])).toBe(PROJECT_ID.toString());
    expect((holdingsCall["runner"] as Runner).id!.toString()).toBe(
      LEGACY_RUNNER_ID.toString(),
    );
  });

  test("the rule check looks for rules in the project that name the Runner, as root", async () => {
    const harness: RetireHarness = setUp();

    await retire(harness);

    const count: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = harness.rules.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };
    expect(count.query["projectId"]).toBe(PROJECT_ID);
    expect(count.query["commandRunners"]).toBeDefined();
    expect(count.props["isRoot"]).toBe(true);
  });

  test("an agent younger than a day keeps the Runner — a rollback may still need it", async () => {
    const harness: RetireHarness = setUp();

    await expect(
      retire(harness, {
        agent: makeAgent({
          createdAt: msAgo(
            (LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS - 1) * HOUR_MS,
            NOW,
          ),
        }),
      }),
    ).resolves.toBe("agent_too_new");

    expect(harness.lookup.mock.calls).toHaveLength(0);
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("an agent whose age is unknown keeps the Runner", async () => {
    const harness: RetireHarness = setUp();
    const agent: KubernetesAiAgent = makeAgent();
    delete (agent as unknown as Record<string, unknown>)["createdAt"];

    await expect(retire(harness, { agent })).resolves.toBe("agent_too_new");
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("no previous Runner: nothing to do", async () => {
    const harness: RetireHarness = setUp({ runner: null });

    await expect(retire(harness)).resolves.toBe("no_legacy_runner");
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("an online Runner is never removed", async () => {
    const harness: RetireHarness = setUp({ online: true });

    await expect(retire(harness)).resolves.toBe(
      "legacy_runner_recently_online",
    );
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("a Runner heard from within the week is kept", async () => {
    const harness: RetireHarness = setUp({
      runner: legacyRunner({
        lastAlive: msAgo(
          (LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS - 1) * DAY_MS,
          NOW,
        ),
      }),
    });

    await expect(retire(harness)).resolves.toBe(
      "legacy_runner_recently_online",
    );
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("a Runner that never heartbeated is kept: its age is unknown", async () => {
    const runner: Runner = legacyRunner();
    delete (runner as unknown as Record<string, unknown>)["lastAlive"];
    const harness: RetireHarness = setUp({ runner });

    await expect(retire(harness)).resolves.toBe(
      "legacy_runner_recently_online",
    );
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("a Runner an operator gave more than its defaults is kept", async () => {
    const harness: RetireHarness = setUp({
      holdings: [
        {
          description: "1 Runner credential(s) assigned",
          remedy: "unassign its 1 Runner credential(s)",
        },
      ],
    });

    await expect(retire(harness)).resolves.toBe("legacy_runner_holds_more");
    expect(harness.rules.mock.calls).toHaveLength(0);
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  // Deleting it would silently widen that rule to "any Runner".
  test("a Runner an auto-remediation rule names is kept", async () => {
    const harness: RetireHarness = setUp({ rules: 1 });

    await expect(retire(harness)).resolves.toBe("legacy_runner_in_rule");
    expect(harness.remove.mock.calls).toHaveLength(0);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("checks at most once an hour per agent", async () => {
    const harness: RetireHarness = setUp({ online: true });

    await expect(retire(harness)).resolves.toBe(
      "legacy_runner_recently_online",
    );
    await expect(
      retire(harness, { now: new Date(NOW.getTime() + HOUR_MS - 1000) }),
    ).resolves.toBe("not_due");
    expect(harness.lookup.mock.calls).toHaveLength(1);

    await expect(
      retire(harness, {
        now: new Date(
          NOW.getTime() + LEGACY_RUNNER_RETIREMENT_CHECK_INTERVAL_MS,
        ),
      }),
    ).resolves.toBe("legacy_runner_recently_online");
    expect(harness.lookup.mock.calls).toHaveLength(2);
  });

  test("the throttle is per agent", async () => {
    const harness: RetireHarness = setUp({ online: true });

    await retire(harness);
    await expect(
      retire(harness, {
        agent: makeAgent({
          _id: "77777777-7777-4777-8777-777777777777",
          createdAt: msAgo(3 * DAY_MS, NOW),
        }),
      }),
    ).resolves.toBe("legacy_runner_recently_online");

    expect(harness.lookup.mock.calls).toHaveLength(2);
  });

  test("never throws: a failing lookup is logged and reported", async () => {
    const harness: RetireHarness = setUp();
    (
      harness.holdings as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await expect(retire(harness)).resolves.toBe("failed");
    expect(harness.remove.mock.calls).toHaveLength(0);
  });

  test("the thresholds", () => {
    expect(LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS).toBe(24);
    expect(LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS).toBe(7);
    expect(LEGACY_RUNNER_RETIREMENT_CHECK_INTERVAL_MS).toBe(HOUR_MS);

    expect(
      KubernetesAiAgentServiceClass.isOldEnoughToRetireLegacyRunner(
        { createdAt: msAgo(24 * HOUR_MS, NOW) },
        NOW,
      ),
    ).toBe(true);
    expect(
      KubernetesAiAgentServiceClass.isOldEnoughToRetireLegacyRunner(
        { createdAt: msAgo(24 * HOUR_MS - 1, NOW) },
        NOW,
      ),
    ).toBe(false);
    expect(
      KubernetesAiAgentServiceClass.hasBeenOfflineLongEnoughToRetire(
        { lastAlive: msAgo(7 * DAY_MS, NOW) },
        NOW,
      ),
    ).toBe(true);
    expect(
      KubernetesAiAgentServiceClass.hasBeenOfflineLongEnoughToRetire(
        { lastAlive: msAgo(7 * DAY_MS - 1, NOW) },
        NOW,
      ),
    ).toBe(false);
  });
});
