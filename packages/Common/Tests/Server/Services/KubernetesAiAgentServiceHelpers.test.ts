import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesAiAgentService, {
  KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
  Service as KubernetesAiAgentServiceClass,
} from "../../../Server/Services/KubernetesAiAgentService";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KubernetesAiAgentConnectionStatus,
  KubernetesAiAgentSummary,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import { FindOperator } from "typeorm";

/*
 * The shared helpers of the Kubernetes AI agent's identity:
 *
 *  - an agent key is 256 random bits, and only its sha256 is stored;
 *    matching a presented key against the stored hash is timing-safe and
 *    never matches a reset row (null hash) or garbage;
 *  - ONE online rule: connected AND heard from within the alive window;
 *  - the summary the dashboard sees never carries the key hash, and its
 *    posture is re-validated on the way out;
 *  - the reads the status builder uses are scoped to the project and the
 *    cluster(s), run as root, and never select the key hash.
 *
 * Nothing below the service boundary runs: no database.
 */

/*
 * Spy handles are held through this rather than a SpiedFunction/SpyInstance
 * type (see UserProjectSsoConsentService.test.ts for why).
 */
interface SpyCalls {
  mock: { calls: Array<Array<unknown>> };
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_A: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222221",
);
const CLUSTER_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const NOW: Date = new Date("2026-09-28T10:00:00.000Z");
const WINDOW_MS: number =
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000;

function msBeforeNow(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function agentRow(
  overrides: Partial<KubernetesAiAgent> = {},
): KubernetesAiAgent {
  const row: KubernetesAiAgent = new KubernetesAiAgent();
  row.id = AGENT_ID;
  row.projectId = PROJECT_ID;
  row.kubernetesClusterId = CLUSTER_A;
  row.connectionStatus = "connected";
  row.lastAliveAt = msBeforeNow(30 * 1000);
  row.agentVersion = "14.1.0";
  row.lastRegisteredAt = msBeforeNow(60 * 60 * 1000);
  row.posture = {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: false,
    kubectlVersion: "v1.33.1",
    agentChartVersion: "14.1.0",
    writeNamespaces: [],
    podNamespace: "oneuptime-agent",
  };

  Object.assign(row, overrides);

  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KubernetesAiAgentService.hashKey", () => {
  test("is the sha256 hex of the key", () => {
    // FIPS 180-2 test vector.
    expect(KubernetesAiAgentServiceClass.hashKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("is deterministic, lowercase hex of 64 characters, and differs per key", () => {
    const key: string = "a-key";

    expect(KubernetesAiAgentServiceClass.hashKey(key)).toBe(
      KubernetesAiAgentServiceClass.hashKey(key),
    );
    expect(KubernetesAiAgentServiceClass.hashKey(key)).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(KubernetesAiAgentServiceClass.hashKey(key)).not.toBe(
      KubernetesAiAgentServiceClass.hashKey("b-key"),
    );
    expect(KubernetesAiAgentServiceClass.hashKey(key)).not.toContain(key);
  });

  test("the default export's instance form gives the same answer", () => {
    expect(KubernetesAiAgentService.hashKey("abc")).toBe(
      KubernetesAiAgentServiceClass.hashKey("abc"),
    );
  });
});

describe("KubernetesAiAgentService.generateKey", () => {
  test("is 32 random bytes, hex encoded", () => {
    const key: string = KubernetesAiAgentServiceClass.generateKey();

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(KubernetesAiAgentService.generateKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("draws from the cryptographic random source", () => {
    const randomBytes: SpyCalls = jest.spyOn(
      crypto,
      "randomBytes",
    ) as unknown as SpyCalls;

    KubernetesAiAgentServiceClass.generateKey();

    expect(randomBytes.mock.calls[0]?.[0]).toBe(32);
  });

  test("never repeats", () => {
    const keys: Set<string> = new Set<string>();

    for (let i: number = 0; i < 200; i++) {
      keys.add(KubernetesAiAgentServiceClass.generateKey());
    }

    expect(keys.size).toBe(200);
  });
});

describe("KubernetesAiAgentService.doesKeyMatchHash", () => {
  const KEY: string = "0f".repeat(32);
  const HASH: string = KubernetesAiAgentServiceClass.hashKey(KEY);

  test("matches the key the hash was made from", () => {
    expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, HASH)).toBe(
      true,
    );
    expect(KubernetesAiAgentService.doesKeyMatchHash(KEY, HASH)).toBe(true);
  });

  test("accepts a stored hash in upper case", () => {
    expect(
      KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, HASH.toUpperCase()),
    ).toBe(true);
  });

  test("does not match another key, or the hash itself presented as the key", () => {
    expect(
      KubernetesAiAgentServiceClass.doesKeyMatchHash("1f".repeat(32), HASH),
    ).toBe(false);
    expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(HASH, HASH)).toBe(
      false,
    );
  });

  // An admin reset nulls the hash: nothing may match it.
  test("never matches a reset row (no hash)", () => {
    expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, null)).toBe(
      false,
    );
    expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, undefined)).toBe(
      false,
    );
    expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, "")).toBe(false);
  });

  test("returns false, never throws, for a missing key or a malformed hash", () => {
    for (const key of [undefined, null, "", 42, {}, ["k"]]) {
      expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(key, HASH)).toBe(
        false,
      );
    }

    for (const hash of [
      HASH.slice(0, 63),
      `${HASH}0`,
      `${HASH.slice(0, 63)}g`,
      42,
      { hash: HASH },
    ]) {
      expect(() => {
        return KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, hash);
      }).not.toThrow();
      expect(KubernetesAiAgentServiceClass.doesKeyMatchHash(KEY, hash)).toBe(
        false,
      );
    }
  });

  test("compares in constant time", () => {
    const timingSafeEqual: SpyCalls = jest.spyOn(
      crypto,
      "timingSafeEqual",
    ) as unknown as SpyCalls;

    KubernetesAiAgentServiceClass.doesKeyMatchHash("1f".repeat(32), HASH);

    expect(timingSafeEqual.mock.calls).toHaveLength(1);
  });
});

describe("KubernetesAiAgentService.isOnline", () => {
  test("is online when connected and heard from within the alive window", () => {
    expect(
      KubernetesAiAgentService.isOnline(
        { connectionStatus: "connected", lastAliveAt: msBeforeNow(1000) },
        NOW,
      ),
    ).toBe(true);
  });

  test("the window is inclusive at exactly five minutes and closed one millisecond later", () => {
    expect(KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES).toBe(5);
    expect(
      KubernetesAiAgentService.isOnline(
        { connectionStatus: "connected", lastAliveAt: msBeforeNow(WINDOW_MS) },
        NOW,
      ),
    ).toBe(true);
    expect(
      KubernetesAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: msBeforeNow(WINDOW_MS + 1),
        },
        NOW,
      ),
    ).toBe(false);
  });

  // A signed-off or reset agent is offline at once, however recent.
  test("is offline when disconnected, whatever lastAliveAt says", () => {
    expect(
      KubernetesAiAgentService.isOnline(
        { connectionStatus: "disconnected", lastAliveAt: NOW },
        NOW,
      ),
    ).toBe(false);
  });

  test("is offline for an unknown or missing status", () => {
    for (const status of [undefined, null, "", "Connected", "online"]) {
      expect(
        KubernetesAiAgentService.isOnline(
          { connectionStatus: status, lastAliveAt: NOW },
          NOW,
        ),
      ).toBe(false);
    }
  });

  test("is offline when it was never heard from, or the timestamp is not a date", () => {
    for (const lastAliveAt of [undefined, null, "", "yesterday"]) {
      expect(
        KubernetesAiAgentService.isOnline(
          { connectionStatus: "connected", lastAliveAt },
          NOW,
        ),
      ).toBe(false);
    }
  });

  test("accepts an ISO string as well as a Date", () => {
    expect(
      KubernetesAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: msBeforeNow(2000).toISOString(),
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      KubernetesAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: msBeforeNow(WINDOW_MS + 60 * 1000).toISOString(),
        },
        NOW,
      ),
    ).toBe(false);
  });

  // Another server's clock may be a little ahead.
  test("a heartbeat stamped slightly in the future still counts as recent", () => {
    expect(
      KubernetesAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: new Date(NOW.getTime() + 2000),
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("defaults to the current time", () => {
    expect(
      KubernetesAiAgentService.isOnline({
        connectionStatus: "connected",
        lastAliveAt: new Date(),
      }),
    ).toBe(true);
    expect(
      KubernetesAiAgentService.isOnline({
        connectionStatus: "connected",
        lastAliveAt: new Date(Date.now() - WINDOW_MS - 60 * 1000),
      }),
    ).toBe(false);
  });
});

describe("KubernetesAiAgentService.toSummary", () => {
  test("summarises a connected agent", () => {
    const row: KubernetesAiAgent = agentRow();

    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(row, NOW);

    expect(summary).toEqual({
      id: AGENT_ID.toString(),
      isOnline: true,
      connectionStatus: "connected",
      lastAliveAt: row.lastAliveAt!.toISOString(),
      lastRegisteredAt: row.lastRegisteredAt!.toISOString(),
      agentVersion: "14.1.0",
      posture: {
        clusterIdentifier: "prod-us",
        inCluster: true,
        allowWrites: false,
        kubectlVersion: "v1.33.1",
        agentChartVersion: "14.1.0",
        writeNamespaces: [],
        podNamespace: "oneuptime-agent",
      },
      lastRefusedRegistrationAt: undefined,
      lastRefusedRegistrationReason: undefined,
    });
  });

  test("never carries the key hash, even when the row was loaded with it", () => {
    const row: KubernetesAiAgent = agentRow({
      keyHash: KubernetesAiAgentServiceClass.hashKey("secret"),
    });

    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(row, NOW);

    expect(JSON.stringify(summary)).not.toContain(row.keyHash);
    expect(Object.keys(summary)).not.toContain("keyHash");
  });

  test("reports an agent whose heartbeat aged out as connected-but-offline", () => {
    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(
        agentRow({ lastAliveAt: msBeforeNow(WINDOW_MS + 1) }),
        NOW,
      );

    expect(summary.connectionStatus).toBe("connected");
    expect(summary.isOnline).toBe(false);
  });

  test("normalises any status other than connected to disconnected", () => {
    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(
        agentRow({
          connectionStatus:
            "weird" as unknown as KubernetesAiAgentConnectionStatus,
        }),
        NOW,
      );

    expect(summary.connectionStatus).toBe("disconnected");
    expect(summary.isOnline).toBe(false);
  });

  test("re-validates the stored posture and drops fields of the wrong type", () => {
    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(
        agentRow({
          posture: {
            clusterIdentifier: 7,
            inCluster: "true",
            allowWrites: "yes",
            writeNamespaces: ["web", 3, ""],
            allowNodeOperations: "true",
          },
        }),
        NOW,
      );

    expect(summary.posture?.clusterIdentifier).toBeUndefined();
    expect(summary.posture?.inCluster).toBe(false);
    expect(summary.posture?.allowWrites).toBe(false);
    expect(summary.posture?.writeNamespaces).toEqual(["web"]);
    expect(summary.posture?.allowNodeOperations).toBeUndefined();
  });

  test("has no posture when none was ever stored", () => {
    const row: KubernetesAiAgent = agentRow();
    delete (row as unknown as Record<string, unknown>)["posture"];

    expect(
      KubernetesAiAgentService.toSummary(row, NOW).posture,
    ).toBeUndefined();
  });

  test("carries the last refused registration, for the dashboard's warning", () => {
    const refusedAt: Date = msBeforeNow(10 * 1000);

    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(
        agentRow({
          lastRefusedRegistrationAt: refusedAt,
          lastRefusedRegistrationReason: "previous_instance_online",
        }),
        NOW,
      );

    expect(summary.lastRefusedRegistrationAt).toBe(refusedAt.toISOString());
    expect(summary.lastRefusedRegistrationReason).toBe(
      "previous_instance_online",
    );
  });

  test("leaves never-set values out rather than inventing them", () => {
    const row: KubernetesAiAgent = new KubernetesAiAgent();
    row.id = AGENT_ID;

    const summary: KubernetesAiAgentSummary =
      KubernetesAiAgentService.toSummary(row, NOW);

    expect(summary.id).toBe(AGENT_ID.toString());
    expect(summary.isOnline).toBe(false);
    expect(summary.connectionStatus).toBe("disconnected");
    expect(summary.lastAliveAt).toBeUndefined();
    expect(summary.lastRegisteredAt).toBeUndefined();
    expect(summary.agentVersion).toBeUndefined();
    expect(summary.posture).toBeUndefined();
  });
});

describe("KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY", () => {
  test("selects every column of the row except the key hash", () => {
    const columns: Array<string> = new KubernetesAiAgent()
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return !new KubernetesAiAgent().isEntityColumn(column);
      });

    const selected: Array<string> = Object.keys(
      KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
    );

    expect(selected).not.toContain("keyHash");

    for (const column of columns) {
      if (
        column === "keyHash" ||
        ["deletedAt", "version", "createdByUserId", "deletedByUserId"].includes(
          column,
        )
      ) {
        continue;
      }

      expect(selected).toContain(column);
    }
  });
});

describe("KubernetesAiAgentService.findForCluster", () => {
  test("reads the cluster's agent in its project, as root, without the key hash", async () => {
    const row: KubernetesAiAgent = agentRow();
    const findOneBy: SpyCalls = jest
      .spyOn(KubernetesAiAgentService, "findOneBy")
      .mockResolvedValue(row) as unknown as SpyCalls;

    await expect(
      KubernetesAiAgentService.findForCluster({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_A,
      }),
    ).resolves.toBe(row);

    expect(findOneBy.mock.calls).toHaveLength(1);

    const call: Record<string, any> = findOneBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["query"]["projectId"].toString()).toBe(PROJECT_ID.toString());
    expect(call["query"]["kubernetesClusterId"].toString()).toBe(
      CLUSTER_A.toString(),
    );
    expect(call["select"]).toBe(KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY);
    expect(call["select"]["keyHash"]).toBeUndefined();
    expect(call["props"]["isRoot"]).toBe(true);
  });

  test("is null when the cluster has no agent", async () => {
    jest.spyOn(KubernetesAiAgentService, "findOneBy").mockResolvedValue(null);

    await expect(
      KubernetesAiAgentService.findForCluster({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_B,
      }),
    ).resolves.toBeNull();
  });
});

describe("KubernetesAiAgentService.findForClusters", () => {
  test("asks nothing of the database for no clusters", async () => {
    const findBy: SpyCalls = jest.spyOn(
      KubernetesAiAgentService,
      "findBy",
    ) as unknown as SpyCalls;

    const result: Map<string, KubernetesAiAgent> =
      await KubernetesAiAgentService.findForClusters({
        projectId: PROJECT_ID,
        kubernetesClusterIds: [],
      });

    expect(result.size).toBe(0);
    expect(findBy.mock.calls).toHaveLength(0);
  });

  test("reads every cluster's agent in one root query scoped to the project, keyed by cluster id", async () => {
    const agentA: KubernetesAiAgent = agentRow();
    const agentB: KubernetesAiAgent = agentRow({
      kubernetesClusterId: CLUSTER_B,
    });

    const findBy: SpyCalls = jest
      .spyOn(KubernetesAiAgentService, "findBy")
      .mockResolvedValue([agentA, agentB]) as unknown as SpyCalls;

    const result: Map<string, KubernetesAiAgent> =
      await KubernetesAiAgentService.findForClusters({
        projectId: PROJECT_ID,
        kubernetesClusterIds: [CLUSTER_A, CLUSTER_B, CLUSTER_A],
      });

    expect(findBy.mock.calls).toHaveLength(1);

    const call: Record<string, any> = findBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["query"]["projectId"].toString()).toBe(PROJECT_ID.toString());

    const clusterFilter: FindOperator<unknown> = call["query"][
      "kubernetesClusterId"
    ] as FindOperator<unknown>;

    // QueryHelper.any: an IN over the ids, each asked for once.
    expect(clusterFilter).toBeInstanceOf(FindOperator);
    expect(clusterFilter.type).toBe("raw");
    expect(Object.values(clusterFilter.objectLiteralParameters || {})).toEqual([
      [CLUSTER_A.toString(), CLUSTER_B.toString()],
    ]);

    expect(call["select"]).toBe(KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY);
    expect(call["limit"]).toBe(LIMIT_MAX);
    expect(call["skip"]).toBe(0);
    expect(call["props"]["isRoot"]).toBe(true);

    expect(result.size).toBe(2);
    expect(result.get(CLUSTER_A.toString())).toBe(agentA);
    expect(result.get(CLUSTER_B.toString())).toBe(agentB);
  });

  test("leaves clusters without an agent out, and ignores rows for clusters it did not ask about", async () => {
    const stray: KubernetesAiAgent = agentRow({
      kubernetesClusterId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    });
    const noCluster: KubernetesAiAgent = agentRow();
    delete (noCluster as unknown as Record<string, unknown>)[
      "kubernetesClusterId"
    ];

    jest
      .spyOn(KubernetesAiAgentService, "findBy")
      .mockResolvedValue([stray, noCluster]);

    const result: Map<string, KubernetesAiAgent> =
      await KubernetesAiAgentService.findForClusters({
        projectId: PROJECT_ID,
        kubernetesClusterIds: [CLUSTER_A, CLUSTER_B],
      });

    expect(result.size).toBe(0);
  });
});
