import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import KubernetesAiAgentService, {
  KUBERNETES_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS,
  KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
  KubernetesAiAgentRegistrationRefusedException,
  KubernetesAiAgentRegistrationResult,
  MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH,
  MAX_KUBERNETES_AI_AGENTS_PER_PROJECT,
  MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR,
  Service as KubernetesAiAgentServiceClass,
} from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import { JSONObject } from "../../../Types/JSON";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KubernetesAgentPosture,
  KubernetesAiAgentRegistrationRefusalReason,
  KubernetesAiRemediationMode,
  isTransientKubernetesAiAgentRegistrationRefusal,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * KubernetesAiAgentService.register — how the Kubernetes AI agent gets its
 * identity with nothing but the project's telemetry ingestion key and its
 * cluster's name (DESIGN §5.2):
 *
 *  1. an empty or over-long cluster name is refused (cluster_name_invalid);
 *  2. while the cluster's previous in-cluster Runner is online the agent is
 *     asked to wait (legacy_runner_online, transient, 20s) — an ingestion
 *     key alone never takes a cluster from a live Runner;
 *  3. an existing agent row is re-keyed on proof of continuity, or when it
 *     is reset / signed off / offline; a live one is refused
 *     (previous_instance_online, transient, 20s) and the refusal recorded;
 *  4. a new row is bounded per project (250) and per hour (30);
 *  5. only the key's hash is stored, and the posture is stored with
 *     inCluster and the cluster's identifier forced;
 *  6. a cluster nobody configured gets the first-connection defaults
 *     (investigation on; Ask for approval when the chart allows writes),
 *     never aiAccessConfiguredAt;
 *  7. nothing is deleted or unbound, and one feed item marks the first
 *     connection.
 *
 * Everything below the service boundary is stubbed: no database.
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
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LEGACY_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const INGESTION_KEY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const CURRENT_KEY: string = "ab".repeat(32);
const ALIVE_WINDOW_MS: number =
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000;

function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
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

// An existing agent row as the registration lookup reads it (with its hash).
function makeAgent(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesAiAgent {
  const agent: KubernetesAiAgent = new KubernetesAiAgent();
  agent.id = AGENT_ID;
  agent.projectId = PROJECT_ID;
  agent.kubernetesClusterId = CLUSTER_ID;
  agent.keyHash = KubernetesAiAgentServiceClass.hashKey(CURRENT_KEY);
  agent.connectionStatus = "connected";
  agent.lastAliveAt = msAgo(20 * 1000);
  agent.lastRegisteredAt = msAgo(60 * 60 * 1000);
  agent.agentVersion = "14.1.0";
  agent.posture = {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: false,
  };
  Object.assign(agent, overrides);
  return agent;
}

function makeLegacyRunner(): Runner {
  const runner: Runner = new Runner();
  runner.id = LEGACY_RUNNER_ID;
  runner.name = "kubernetes-agent/prod-us";
  runner.lastAlive = msAgo(10 * 1000);
  runner.connectionStatus = RunnerConnectionStatus.Connected;
  return runner;
}

interface Harness {
  findOrCreateCluster: SpyCalls;
  clusterFindOneBy: SpyCalls;
  clusterUpdateOneBy: SpyCalls;
  clusterUpdateOneById: SpyCalls;
  feed: SpyCalls;
  legacyLookup: SpyCalls;
  legacyOnline: SpyCalls;
  agentFindOneBy: SpyCalls;
  agentCountBy: SpyCalls;
  agentCreate: SpyCalls;
  agentUpdateOneById: SpyCalls;
  agentUpdateColumns: SpyCalls;
  runnerDeletes: Array<SpyCalls>;
}

interface HarnessOptions {
  cluster?: KubernetesCluster;
  existing?: KubernetesAiAgent | null;
  legacyRunner?: Runner | null;
  legacyOnline?: boolean;
  totalAgents?: number;
  agentsInLastHour?: number;
  clusterUpdateCount?: number;
}

function setUp(options: HarnessOptions = {}): Harness {
  const cluster: KubernetesCluster = options.cluster || makeCluster();

  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  const findOrCreateCluster: SpyCalls = jest
    .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
    .mockResolvedValue(cluster) as unknown as SpyCalls;

  const clusterFindOneBy: SpyCalls = jest
    .spyOn(KubernetesClusterService, "findOneBy")
    .mockResolvedValue(cluster) as unknown as SpyCalls;

  const clusterUpdateOneBy: SpyCalls = jest
    .spyOn(KubernetesClusterService, "updateOneBy")
    .mockResolvedValue(options.clusterUpdateCount ?? 1) as unknown as SpyCalls;

  const clusterUpdateOneById: SpyCalls = jest
    .spyOn(KubernetesClusterService, "updateOneById")
    .mockResolvedValue(1) as unknown as SpyCalls;

  const feed: SpyCalls = jest
    .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
    .mockResolvedValue(undefined) as unknown as SpyCalls;

  const legacyLookup: SpyCalls = jest
    .spyOn(KubernetesClusterAiAccessService, "getLegacyAgentRunnerForCluster")
    .mockResolvedValue(
      options.legacyRunner === undefined ? null : options.legacyRunner,
    ) as unknown as SpyCalls;

  const legacyOnline: SpyCalls = jest
    .spyOn(KubernetesClusterAiAccessService, "isRunnerOnline")
    .mockReturnValue(options.legacyOnline === true) as unknown as SpyCalls;

  const agentFindOneBy: SpyCalls = jest
    .spyOn(KubernetesAiAgentService, "findOneBy")
    .mockResolvedValue(
      options.existing === undefined ? null : options.existing,
    ) as unknown as SpyCalls;

  const agentCountBy: SpyCalls = jest
    .spyOn(KubernetesAiAgentService, "countBy")
    .mockImplementation(async (countBy: { query: Record<string, unknown> }) => {
      return new PositiveNumber(
        countBy.query["createdAt"] !== undefined
          ? options.agentsInLastHour || 0
          : options.totalAgents || 0,
      );
    }) as unknown as SpyCalls;

  const agentCreate: SpyCalls = jest
    .spyOn(KubernetesAiAgentService, "create")
    .mockImplementation(async (createBy: { data: KubernetesAiAgent }) => {
      const created: KubernetesAiAgent = createBy.data;
      created.id = AGENT_ID;
      return created;
    }) as unknown as SpyCalls;

  const agentUpdateOneById: SpyCalls = jest
    .spyOn(KubernetesAiAgentService, "updateOneById")
    .mockResolvedValue(1) as unknown as SpyCalls;

  const agentUpdateColumns: SpyCalls = jest
    .spyOn(KubernetesAiAgentService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined) as unknown as SpyCalls;

  const runnerDeletes: Array<SpyCalls> = (
    ["deleteBy", "deleteOneBy", "deleteOneById", "hardDeleteBy"] as const
  ).map(
    (method: "deleteBy" | "deleteOneBy" | "deleteOneById" | "hardDeleteBy") => {
      return jest
        .spyOn(RunnerService, method)
        .mockResolvedValue(0) as unknown as SpyCalls;
    },
  );

  return {
    findOrCreateCluster,
    clusterFindOneBy,
    clusterUpdateOneBy,
    clusterUpdateOneById,
    feed,
    legacyLookup,
    legacyOnline,
    agentFindOneBy,
    agentCountBy,
    agentCreate,
    agentUpdateOneById,
    agentUpdateColumns,
    runnerDeletes,
  };
}

function register(
  overrides: Partial<{
    clusterName: unknown;
    agentVersion: string;
    previousAgentKey: string;
    posture: unknown;
    ingestionKeyId: ObjectID;
  }> = {},
): Promise<KubernetesAiAgentRegistrationResult> {
  return KubernetesAiAgentService.register({
    projectId: PROJECT_ID,
    clusterName: "prod-us",
    agentVersion: "14.1.0",
    posture: {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
      allowNodeOperations: false,
      writeNamespaces: [],
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.33.1",
      agentChartVersion: "14.1.0",
    },
    ingestionKeyId: INGESTION_KEY_ID,
    ...overrides,
  });
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<KubernetesAiAgentRegistrationRefusedException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KubernetesAiAgentRegistrationRefusedException) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the registration to be refused");
}

function createdRow(harness: Harness): KubernetesAiAgent {
  expect(harness.agentCreate.mock.calls).toHaveLength(1);
  return (harness.agentCreate.mock.calls[0]![0] as { data: KubernetesAiAgent })
    .data;
}

function reKeyWrite(harness: Harness): {
  id: ObjectID;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
} {
  expect(harness.agentUpdateOneById.mock.calls).toHaveLength(1);
  return harness.agentUpdateOneById.mock.calls[0]![0] as {
    id: ObjectID;
    data: Record<string, unknown>;
    props: Record<string, unknown>;
  };
}

function nothingWrittenToTheAgentTable(harness: Harness): void {
  expect(harness.agentCreate.mock.calls).toHaveLength(0);
  expect(harness.agentUpdateOneById.mock.calls).toHaveLength(0);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("register: a cluster's first agent", () => {
  test("creates the row and returns the key, storing only the key's sha256", async () => {
    const harness: Harness = setUp();

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("created");
    expect(result.agentId.toString()).toBe(AGENT_ID.toString());
    expect(result.clusterId.toString()).toBe(CLUSTER_ID.toString());
    expect(result.agentKey).toMatch(/^[0-9a-f]{64}$/);

    const row: KubernetesAiAgent = createdRow(harness);
    expect(row.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(row.kubernetesClusterId!.toString()).toBe(CLUSTER_ID.toString());
    expect(row.keyHash).toBe(
      KubernetesAiAgentServiceClass.hashKey(result.agentKey),
    );
    expect(row.keyHash).not.toBe(result.agentKey);
    expect(Object.values(row)).not.toContain(result.agentKey);

    const createBy: { props: Record<string, unknown> } = harness.agentCreate
      .mock.calls[0]![0] as { props: Record<string, unknown> };
    expect(createBy.props["isRoot"]).toBe(true);
  });

  test("the new row is connected, alive and registered now, with the agent's version and the ingestion key that minted it", async () => {
    const harness: Harness = setUp();
    const before: number = Date.now();

    await register();

    const row: KubernetesAiAgent = createdRow(harness);
    expect(row.connectionStatus).toBe("connected");
    expect(row.lastAliveAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.lastRegisteredAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.agentVersion).toBe("14.1.0");
    expect(row.registeredWithIngestionKeyId!.toString()).toBe(
      INGESTION_KEY_ID.toString(),
    );
  });

  test("a registration without an ingestion key id or version leaves them unset", async () => {
    const harness: Harness = setUp();

    await KubernetesAiAgentService.register({
      projectId: PROJECT_ID,
      clusterName: "prod-us",
    });

    const row: KubernetesAiAgent = createdRow(harness);
    expect(row.registeredWithIngestionKeyId).toBeUndefined();
    expect(row.agentVersion).toBeUndefined();
  });

  test("every registration mints a different key", async () => {
    setUp();

    const first: KubernetesAiAgentRegistrationResult = await register();
    const second: KubernetesAiAgentRegistrationResult = await register();

    expect(first.agentKey).not.toBe(second.agentKey);
  });

  test("finds or creates the cluster by the trimmed name, in the registering project, and re-reads its AI columns as root", async () => {
    const harness: Harness = setUp();

    await register({ clusterName: "  prod-us  " });

    expect(harness.findOrCreateCluster.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      clusterIdentifier: "prod-us",
    });

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
    expect(read.select["isAiInvestigationEnabled"]).toBe(true);
    expect(read.select["aiRemediationMode"]).toBe(true);
    expect(read.select["clusterIdentifier"]).toBe(true);
    expect(read.props["isRoot"]).toBe(true);
  });

  test("looks the agent row up by project and cluster, as root, selecting the key hash", async () => {
    const harness: Harness = setUp();

    await register();

    const lookup: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    } = harness.agentFindOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    };

    expect(lookup.query["projectId"]).toBe(PROJECT_ID);
    expect(String(lookup.query["kubernetesClusterId"])).toBe(
      CLUSTER_ID.toString(),
    );
    expect(lookup.select).toEqual({
      ...KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
      keyHash: true,
    });
    expect(lookup.props["isRoot"]).toBe(true);
  });

  test("the version is trimmed and bounded to its column", async () => {
    const harness: Harness = setUp();

    await register({ agentVersion: `  ${"9".repeat(300)}  ` });

    expect(createdRow(harness).agentVersion).toBe(
      "9".repeat(ColumnLength.ShortText),
    );
  });
});

describe("register: the stored posture", () => {
  test("keeps what the agent reported and forces in-cluster and the cluster", async () => {
    const harness: Harness = setUp();

    await register({
      posture: {
        clusterIdentifier: "prod-us",
        inCluster: true,
        allowWrites: true,
        allowNodeOperations: false,
        writeNamespaces: ["web", "api"],
        podNamespace: "oneuptime-agent",
        kubectlVersion: "v1.33.1",
        agentChartVersion: "14.1.0",
      },
    });

    expect(createdRow(harness).posture).toEqual({
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: true,
      allowNodeOperations: false,
      writeNamespaces: ["web", "api"],
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.33.1",
      agentChartVersion: "14.1.0",
    });
  });

  /*
   * A body can never make the agent the in-cluster executor of another
   * cluster: the cluster is the one it registered for, whatever the posture
   * claims.
   */
  test("a posture that names another cluster, or says it is not in a cluster, is overridden", async () => {
    const harness: Harness = setUp();

    await register({
      posture: { clusterIdentifier: "someone-else", inCluster: false },
    });

    const posture: JSONObject = createdRow(harness).posture!;
    expect(posture["clusterIdentifier"]).toBe("prod-us");
    expect(posture["inCluster"]).toBe(true);
  });

  test("the cluster is named the way the cluster row spells it", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ clusterIdentifier: "Prod-US" }),
    });

    await register({ clusterName: "prod-us" });

    expect(createdRow(harness).posture!["clusterIdentifier"]).toBe("Prod-US");
  });

  test("malformed fields are dropped, never trusted — writes stay off", async () => {
    const harness: Harness = setUp();

    await register({
      posture: {
        allowWrites: "true",
        writeNamespaces: ["web", "", 42, null],
        podNamespace: 7,
        allowNodeOperations: "false",
        kubectlVersion: { v: 1 },
      },
    });

    const posture: JSONObject = createdRow(harness).posture!;
    expect(posture["allowWrites"]).toBe(false);
    expect(posture["writeNamespaces"]).toEqual(["web"]);
    expect(posture).not.toHaveProperty("podNamespace");
    expect(posture).not.toHaveProperty("allowNodeOperations");
    expect(posture).not.toHaveProperty("kubectlVersion");
  });

  test("no posture at all is a read-only in-cluster agent of this cluster", async () => {
    const harness: Harness = setUp();

    await register({ posture: undefined });

    expect(createdRow(harness).posture).toEqual({
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
    });
  });
});

describe("register: cluster_name_invalid", () => {
  test.each([
    ["an empty name", ""],
    ["a blank name", "   "],
    ["no name", undefined],
    ["a number", 42],
    ["an object", { name: "prod-us" }],
  ])(
    "%s is refused before anything is read or written",
    async (_label: string, clusterName: unknown) => {
      const harness: Harness = setUp();

      const refusal: KubernetesAiAgentRegistrationRefusedException =
        await refusalOf(register({ clusterName }));

      expect(refusal.reason).toBe("cluster_name_invalid");
      expect(refusal.retryAfterSeconds).toBeUndefined();
      expect(refusal.message).toContain("clusterName");
      expect(harness.findOrCreateCluster.mock.calls).toHaveLength(0);
      nothingWrittenToTheAgentTable(harness);
    },
  );

  test("a name longer than the cluster identifier column is refused, saying the limit", async () => {
    const harness: Harness = setUp();
    const tooLong: string = "c".repeat(
      MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH + 1,
    );

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register({ clusterName: tooLong }));

    expect(refusal.reason).toBe("cluster_name_invalid");
    expect(refusal.message).toContain(
      String(MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH),
    );
    expect(harness.findOrCreateCluster.mock.calls).toHaveLength(0);
  });

  test("a name exactly at the limit is accepted", async () => {
    const harness: Harness = setUp();

    await register({
      clusterName: "c".repeat(MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH),
    });

    expect(harness.agentCreate.mock.calls).toHaveLength(1);
  });

  test("the limit is the cluster identifier column's", () => {
    expect(MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH).toBe(
      ColumnLength.ShortText,
    );
  });

  test("is a 403 refusal that needs an operator", async () => {
    setUp();

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register({ clusterName: "" }));

    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect(
      isTransientKubernetesAiAgentRegistrationRefusal(refusal.reason),
    ).toBe(false);
  });
});

describe("register: the previous in-cluster Runner is online (legacy_runner_online)", () => {
  test("the agent is asked to wait 20 seconds, and nothing is written", async () => {
    const harness: Harness = setUp({
      legacyRunner: makeLegacyRunner(),
      legacyOnline: true,
    });

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("legacy_runner_online");
    expect(refusal.retryAfterSeconds).toBe(20);
    expect(KUBERNETES_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS).toBe(20);
    expect(
      isTransientKubernetesAiAgentRegistrationRefusal(refusal.reason),
    ).toBe(true);
    expect(refusal.message).toContain('"prod-us"');
    expect(refusal.message).toContain("helm upgrade");

    nothingWrittenToTheAgentTable(harness);
    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("looks the Runner up for this project, cluster and identifier, and asks the one presence rule", async () => {
    const legacy: Runner = makeLegacyRunner();
    const harness: Harness = setUp({
      legacyRunner: legacy,
      legacyOnline: true,
    });

    await refusalOf(register());

    expect(harness.legacyLookup.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      clusterIdentifier: "prod-us",
    });
    expect(harness.legacyOnline.mock.calls[0]![0]).toBe(legacy);
  });

  // An ingestion key alone can never evict a live Runner, even with a key.
  test("refuses even an agent that proves continuity with its current key", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      legacyRunner: makeLegacyRunner(),
      legacyOnline: true,
    });

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register({ previousAgentKey: CURRENT_KEY }));

    expect(refusal.reason).toBe("legacy_runner_online");
    nothingWrittenToTheAgentTable(harness);
  });

  test("it is not recorded as another agent's attempt on the row", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      legacyRunner: makeLegacyRunner(),
      legacyOnline: true,
    });

    await refusalOf(register());

    expect(harness.agentUpdateColumns.mock.calls).toHaveLength(0);
  });

  test("an offline previous Runner does not hold the cluster", async () => {
    const harness: Harness = setUp({
      legacyRunner: makeLegacyRunner(),
      legacyOnline: false,
    });

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("created");
    expect(harness.agentCreate.mock.calls).toHaveLength(1);
  });

  test("a cluster that never had a Runner registers straight away", async () => {
    const harness: Harness = setUp({ legacyRunner: null });

    await register();

    expect(harness.legacyOnline.mock.calls).toHaveLength(0);
    expect(harness.agentCreate.mock.calls).toHaveLength(1);
  });

  // The agent replaces the Runner without ever touching it.
  test("never deletes, re-keys or unbinds the previous Runner", async () => {
    const harness: Harness = setUp({
      legacyRunner: makeLegacyRunner(),
      legacyOnline: false,
    });

    await register();

    for (const spy of harness.runnerDeletes) {
      expect(spy.mock.calls).toHaveLength(0);
    }
    expect(harness.clusterUpdateOneById.mock.calls).toHaveLength(0);
  });
});

describe("register: re-registering an existing agent", () => {
  test("continuity: the current key re-keys even a live agent", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });

    const result: KubernetesAiAgentRegistrationResult = await register({
      previousAgentKey: CURRENT_KEY,
    });

    expect(result.admission).toBe("continuity");
    expect(result.agentId.toString()).toBe(AGENT_ID.toString());
    expect(result.agentKey).not.toBe(CURRENT_KEY);

    const write: { id: ObjectID; data: Record<string, unknown> } =
      reKeyWrite(harness);
    expect(write.id.toString()).toBe(AGENT_ID.toString());
    expect(write.data["keyHash"]).toBe(
      KubernetesAiAgentServiceClass.hashKey(result.agentKey),
    );
    expect(harness.agentCreate.mock.calls).toHaveLength(0);
  });

  test("the re-key writes the new hash, connected, alive and registered now, the posture and the minting key", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({
        connectionStatus: "disconnected",
        lastAliveAt: msAgo(ALIVE_WINDOW_MS * 3),
      }),
    });
    const before: number = Date.now();

    await register({ agentVersion: "14.2.0" });

    const write: {
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    } = reKeyWrite(harness);

    expect(write.props["isRoot"]).toBe(true);
    expect(write.data["connectionStatus"]).toBe("connected");
    expect(
      (write.data["lastAliveAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(
      (write.data["lastRegisteredAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(write.data["agentVersion"]).toBe("14.2.0");
    expect(String(write.data["registeredWithIngestionKeyId"])).toBe(
      INGESTION_KEY_ID.toString(),
    );
    expect((write.data["posture"] as JSONObject)["clusterIdentifier"]).toBe(
      "prod-us",
    );
    expect((write.data["posture"] as JSONObject)["inCluster"]).toBe(true);
  });

  test("a re-key without an ingestion key id clears the previous one, and keeps the stored version when none is sent", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });

    await KubernetesAiAgentService.register({
      projectId: PROJECT_ID,
      clusterName: "prod-us",
    });

    const write: { data: Record<string, unknown> } = reKeyWrite(harness);
    expect(write.data["registeredWithIngestionKeyId"]).toBeNull();
    expect(write.data).not.toHaveProperty("agentVersion");
  });

  test("offline: an agent that stopped heartbeating is replaced without its key", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ lastAliveAt: msAgo(ALIVE_WINDOW_MS + 60 * 1000) }),
    });

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("offline");
    expect(harness.agentUpdateOneById.mock.calls).toHaveLength(1);
  });

  test("signed off: an agent that said goodbye is replaced at once", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({
        connectionStatus: "disconnected",
        lastAliveAt: msAgo(5 * 1000),
      }),
    });

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("signed_off");
    expect(harness.agentUpdateOneById.mock.calls).toHaveLength(1);
  });

  test("reset: a row an admin reset admits the next registration, even if it still reads as connected", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({
        keyHash: null,
        connectionStatus: "connected",
        lastAliveAt: msAgo(5 * 1000),
      }),
    });

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("reset");
    expect(reKeyWrite(harness).data["keyHash"]).toBe(
      KubernetesAiAgentServiceClass.hashKey(result.agentKey),
    );
  });

  test("the caps are not consulted for an existing row", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      totalAgents: MAX_KUBERNETES_AI_AGENTS_PER_PROJECT,
      agentsInLastHour: MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR,
    });

    await register();

    expect(harness.agentCountBy.mock.calls).toHaveLength(0);
  });

  test("no connected feed item for a re-key that changed no setting", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });

    await register();

    expect(harness.feed.mock.calls).toHaveLength(0);
  });
});

describe("register: another agent is online (previous_instance_online)", () => {
  test.each([
    ["no key", undefined],
    ["a wrong key", "cd".repeat(32)],
    [
      "the key's hash instead of the key",
      KubernetesAiAgentServiceClass.hashKey(CURRENT_KEY),
    ],
  ])(
    "%s: refused, transient, 20 seconds — and the key is not changed",
    async (_label: string, previousAgentKey: string | undefined) => {
      const harness: Harness = setUp({ existing: makeAgent() });

      const refusal: KubernetesAiAgentRegistrationRefusedException =
        await refusalOf(register(previousAgentKey ? { previousAgentKey } : {}));

      expect(refusal.reason).toBe("previous_instance_online");
      expect(refusal.retryAfterSeconds).toBe(20);
      expect(
        isTransientKubernetesAiAgentRegistrationRefusal(refusal.reason),
      ).toBe(true);
      expect(refusal.message).toContain('"prod-us"');
      nothingWrittenToTheAgentTable(harness);
      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
      expect(harness.feed.mock.calls).toHaveLength(0);
    },
  );

  test("the refusal is recorded on the row: when, and why", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });
    const before: number = Date.now();

    await refusalOf(register());

    expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);

    const record: { id: ObjectID; data: Record<string, unknown> } = harness
      .agentUpdateColumns.mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(record.id.toString()).toBe(AGENT_ID.toString());
    expect(record.data["lastRefusedRegistrationReason"]).toBe(
      "previous_instance_online",
    );
    expect(
      (record.data["lastRefusedRegistrationAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(Object.keys(record.data).sort()).toEqual([
      "lastRefusedRegistrationAt",
      "lastRefusedRegistrationReason",
    ]);
  });

  test("a failure to record it never turns the refusal into a server error", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });
    (
      harness.agentUpdateColumns as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("previous_instance_online");
  });

  test("an agent heard from just inside the alive window is still online", async () => {
    setUp({
      existing: makeAgent({ lastAliveAt: msAgo(ALIVE_WINDOW_MS - 10 * 1000) }),
    });

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("previous_instance_online");
  });
});

describe("register: agent_cap_reached", () => {
  test(`a project with ${MAX_KUBERNETES_AI_AGENTS_PER_PROJECT} agents gets no new one`, async () => {
    const harness: Harness = setUp({
      totalAgents: MAX_KUBERNETES_AI_AGENTS_PER_PROJECT,
    });

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("agent_cap_reached");
    expect(refusal.retryAfterSeconds).toBeUndefined();
    expect(
      isTransientKubernetesAiAgentRegistrationRefusal(refusal.reason),
    ).toBe(false);
    expect(refusal.message).toContain(
      String(MAX_KUBERNETES_AI_AGENTS_PER_PROJECT),
    );
    nothingWrittenToTheAgentTable(harness);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test(`${MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR} new agents in the last hour is the hourly brake`, async () => {
    const harness: Harness = setUp({
      totalAgents: 40,
      agentsInLastHour: MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR,
    });

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("agent_cap_reached");
    expect(refusal.message).toContain(
      String(MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR),
    );
    nothingWrittenToTheAgentTable(harness);
  });

  test("one under either limit is admitted", async () => {
    const harness: Harness = setUp({
      totalAgents: MAX_KUBERNETES_AI_AGENTS_PER_PROJECT - 1,
      agentsInLastHour: MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR - 1,
    });

    await register();

    expect(harness.agentCreate.mock.calls).toHaveLength(1);
  });

  test("both counts are scoped to the project, as root; the brake counts only the last hour's rows", async () => {
    const harness: Harness = setUp();

    await register();

    expect(harness.agentCountBy.mock.calls).toHaveLength(2);

    const [total, lastHour] = harness.agentCountBy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          props: Record<string, unknown>;
        };
      },
    ) as [
      { query: Record<string, unknown>; props: Record<string, unknown> },
      { query: Record<string, unknown>; props: Record<string, unknown> },
    ];

    expect(total.query).toEqual({ projectId: PROJECT_ID });
    expect(total.props["isRoot"]).toBe(true);
    expect(lastHour.query["projectId"]).toBe(PROJECT_ID);
    expect(lastHour.query["createdAt"]).toBeDefined();
    expect(lastHour.props["isRoot"]).toBe(true);
  });

  test("the caps match the in-cluster Runner's", () => {
    expect(MAX_KUBERNETES_AI_AGENTS_PER_PROJECT).toBe(250);
    expect(MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR).toBe(30);
  });
});

describe("register: two pods registering a new cluster at once", () => {
  test("the one whose create loses is told the other agent is online", async () => {
    const harness: Harness = setUp();
    (
      harness.agentCreate as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("duplicate key value"));
    (
      harness.agentFindOneBy as unknown as {
        mockResolvedValueOnce: (value: unknown) => {
          mockResolvedValueOnce: (value: unknown) => void;
        };
      }
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeAgent());

    const refusal: KubernetesAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("previous_instance_online");
    expect(refusal.retryAfterSeconds).toBe(20);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("any other create failure is not dressed up as a refusal", async () => {
    const harness: Harness = setUp();
    (
      harness.agentCreate as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("connection reset"));

    await expect(register()).rejects.toThrow("connection reset");
  });
});

describe("register: first-connection defaults", () => {
  function defaultsWrite(harness: Harness): {
    query: Record<string, unknown>;
    data: Record<string, unknown>;
    props: Record<string, unknown>;
  } {
    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(1);
    return harness.clusterUpdateOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    };
  }

  test("a cluster nobody configured gets investigation on", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register();

    const write: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    } = defaultsWrite(harness);

    expect(write.data).toEqual({ isAiInvestigationEnabled: true });
    expect(write.query["_id"]).toBe(CLUSTER_ID.toString());
    expect(write.query["projectId"]).toBe(PROJECT_ID);
    expect(write.props["isRoot"]).toBe(true);
  });

  // Chart write RBAC is the cluster operator's consent; a human still approves.
  test("and, when the chart granted writes, fixes Ask for approval instead of Off", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register({
      posture: { allowWrites: true, writeNamespaces: ["web"] },
    });

    expect(defaultsWrite(harness).data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
  });

  test("the update only lands while the cluster is still unconfigured", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register();

    const query: Record<string, unknown> = defaultsWrite(harness).query;
    const configuredAt: FindOperator<unknown> = query[
      "aiAccessConfiguredAt"
    ] as FindOperator<unknown>;

    // QueryHelper.isNull: a raw `IS NULL` on the column.
    expect(configuredAt).toBeInstanceOf(FindOperator);
    expect(configuredAt.type).toBe("raw");
    expect((configuredAt.getSql as (alias: string) => string)("column")).toBe(
      "(column IS NULL)",
    );
  });

  test("never marks the cluster configured", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register({ posture: { allowWrites: true } });

    expect(defaultsWrite(harness).data).not.toHaveProperty(
      "aiAccessConfiguredAt",
    );
  });

  test("a read-only agent never turns fixes on", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register({ posture: { allowWrites: false } });

    expect(defaultsWrite(harness).data).not.toHaveProperty("aiRemediationMode");
  });

  test.each([
    KubernetesAiRemediationMode.RequireApproval,
    KubernetesAiRemediationMode.Automatic,
    KubernetesAiRemediationMode.BypassApproval,
  ])(
    "a mode already on the cluster (%s) is never changed",
    async (mode: KubernetesAiRemediationMode) => {
      const harness: Harness = setUp({
        cluster: makeCluster({ aiRemediationMode: mode }),
      });

      await register({ posture: { allowWrites: true } });

      expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
    },
  );

  test("an unknown stored mode reads as Off", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiRemediationMode: "Sometimes" as KubernetesAiRemediationMode,
      }),
    });

    await register({ posture: { allowWrites: true } });

    expect(defaultsWrite(harness).data["aiRemediationMode"]).toBe(
      KubernetesAiRemediationMode.RequireApproval,
    );
  });

  test("nothing is written when nothing needs changing", async () => {
    const harness: Harness = setUp();

    await register();

    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
  });

  test("a cluster someone configured is left exactly as chosen — investigation off and fixes Off included", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessConfiguredAt: msAgo(60 * 1000),
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    });

    await register({ posture: { allowWrites: true } });

    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
    expect(harness.clusterUpdateOneById.mock.calls).toHaveLength(0);
  });

  test("they apply on a re-key too, with a feed item saying what changed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });

    await register({
      posture: { allowWrites: true, writeNamespaces: ["web", "api"] },
    });

    expect(defaultsWrite(harness).data).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
    expect(harness.feed.mock.calls).toHaveLength(1);

    const item: Record<string, unknown> = harness.feed.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(String(item["feedInfoInMarkdown"])).toContain("Ask for approval");
    expect(String(item["feedInfoInMarkdown"])).toContain("in web, api");
  });

  test("when an operator configured the cluster a moment earlier, the conditional update lands nowhere and nothing is claimed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
      clusterUpdateCount: 0,
    });

    await register();

    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(1);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("they never apply to a refused registration", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await refusalOf(register({ posture: { allowWrites: true } }));

    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
  });
});

/*
 * The key's hash is written before the defaults. If a failed defaults write
 * failed the registration, the agent would never receive the key its row
 * now demands, and — the row reading online — every retry would be refused
 * as previous_instance_online (and recorded as another agent's attempt)
 * until the alive window lapsed.
 */
describe("register: when applying the defaults fails", () => {
  function failTheDefaults(harness: Harness): void {
    (
      harness.clusterUpdateOneBy as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));
  }

  test("a new agent still gets its key, and the row stores that key's hash", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });
    failTheDefaults(harness);

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(1);
    expect(result.admission).toBe("created");
    expect(result.agentId.toString()).toBe(AGENT_ID.toString());
    expect(createdRow(harness).keyHash).toBe(
      KubernetesAiAgentServiceClass.hashKey(result.agentKey),
    );
  });

  test("a re-key still hands out its key, and the next registration with it proves continuity while the row reads online", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });
    failTheDefaults(harness);

    const result: KubernetesAiAgentRegistrationResult = await register();

    const storedHash: unknown = reKeyWrite(harness).data["keyHash"];
    expect(storedHash).toBe(
      KubernetesAiAgentServiceClass.hashKey(result.agentKey),
    );

    // The row as the failed request left it: connected, alive just now.
    const rowAfter: KubernetesAiAgent = makeAgent({
      keyHash: storedHash,
      connectionStatus: "connected",
      lastAliveAt: new Date(),
    });
    expect(KubernetesAiAgentService.isOnline(rowAfter)).toBe(true);
    expect(
      KubernetesAiAgentService.getReRegistrationAdmission({
        agent: rowAfter,
        previousAgentKey: result.agentKey,
      }),
    ).toBe("continuity");
  });

  test("the connected feed item says only what is true: investigation stayed off, and fixes were not changed", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });
    failTheDefaults(harness);

    await register({ posture: { allowWrites: true } });

    expect(harness.feed.mock.calls).toHaveLength(1);
    const text: string = String(
      (harness.feed.mock.calls[0]![0] as Record<string, unknown>)[
        "feedInfoInMarkdown"
      ],
    );
    expect(text).toContain("The Kubernetes AI agent connected");
    expect(text).toContain("Investigating with kubectl is off");
    expect(text).not.toContain("Ask for approval");
  });

  test("a re-key writes no defaults feed item", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });
    failTheDefaults(harness);

    await register({ posture: { allowWrites: true } });

    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("the failure is logged, naming the cluster", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });
    failTheDefaults(harness);

    await register();

    const logged: string = JSON.stringify(
      (logger.error as unknown as SpyCalls).mock.calls,
    );
    expect(logged).toContain("first-connection defaults");
    expect(logged).toContain(CLUSTER_ID.toString());
    expect(logged).toContain("database is down");
  });

  test("a failure before the key is stored still fails the registration", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });
    (
      harness.agentUpdateOneById as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await expect(register()).rejects.toThrow("database is down");
    expect(harness.clusterUpdateOneBy.mock.calls).toHaveLength(0);
  });
});

describe("register: the cluster feed", () => {
  function feedItem(harness: Harness): Record<string, unknown> {
    expect(harness.feed.mock.calls).toHaveLength(1);
    return harness.feed.mock.calls[0]![0] as Record<string, unknown>;
  }

  test("one item marks the first connection of a cluster's agent", async () => {
    const harness: Harness = setUp();

    await register();

    const item: Record<string, unknown> = feedItem(harness);
    expect(String(item["kubernetesClusterId"])).toBe(CLUSTER_ID.toString());
    expect(item["projectId"]).toBe(PROJECT_ID);
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "The Kubernetes AI agent connected (read-only).",
    );
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "AI can now use it to investigate this cluster.",
    );
    expect(String(item["moreInformationInMarkdown"])).toContain(
      AGENT_ID.toString(),
    );
    expect(String(item["moreInformationInMarkdown"])).toContain("v1.33.1");
  });

  test("says where a writing agent may change things", async () => {
    const scoped: Harness = setUp();
    await register({
      posture: { allowWrites: true, writeNamespaces: ["web", "api"] },
    });
    expect(String(feedItem(scoped)["feedInfoInMarkdown"])).toContain(
      "(can make changes in web, api)",
    );
    jest.restoreAllMocks();

    const clusterWide: Harness = setUp();
    await register({ posture: { allowWrites: true, writeNamespaces: [] } });
    expect(String(feedItem(clusterWide)["feedInfoInMarkdown"])).toContain(
      "(can make changes anywhere in the cluster)",
    );
  });

  test("says fixes were set to Ask for approval when the defaults did that", async () => {
    const harness: Harness = setUp();

    await register({ posture: { allowWrites: true } });

    expect(String(feedItem(harness)["feedInfoInMarkdown"])).toContain(
      '"Ask for approval"',
    );
  });

  test("on a cluster where an operator turned investigation off, says so rather than promising investigations", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessConfiguredAt: msAgo(60 * 1000),
        isAiInvestigationEnabled: false,
      }),
    });

    await register();

    const text: string = String(feedItem(harness)["feedInfoInMarkdown"]);
    expect(text).toContain("Investigating with kubectl is off");
    expect(text).not.toContain("AI can now use it");
  });

  test("never carries the agent key", async () => {
    const harness: Harness = setUp();

    const result: KubernetesAiAgentRegistrationResult = await register();

    expect(JSON.stringify(harness.feed.mock.calls)).not.toContain(
      result.agentKey,
    );
  });
});

describe("getReRegistrationAdmission", () => {
  const NOW: Date = new Date("2026-09-28T10:00:00.000Z");
  const HASH: string = KubernetesAiAgentServiceClass.hashKey(CURRENT_KEY);

  function admission(
    agent: Record<string, unknown>,
    previousAgentKey?: string,
  ): string | null {
    return KubernetesAiAgentService.getReRegistrationAdmission({
      agent: agent as never,
      previousAgentKey,
      now: NOW,
    });
  }

  const ONLINE: Record<string, unknown> = {
    keyHash: HASH,
    connectionStatus: "connected",
    lastAliveAt: new Date(NOW.getTime() - 30 * 1000),
  };

  test("reset beats everything", () => {
    expect(admission({ ...ONLINE, keyHash: null })).toBe("reset");
    expect(admission({ ...ONLINE, keyHash: "" })).toBe("reset");
    expect(admission({ ...ONLINE, keyHash: undefined })).toBe("reset");
  });

  test("continuity needs the current key itself", () => {
    expect(admission(ONLINE, CURRENT_KEY)).toBe("continuity");
    expect(admission(ONLINE, "cd".repeat(32))).toBeNull();
    expect(admission(ONLINE, HASH)).toBeNull();
    expect(admission(ONLINE, "")).toBeNull();
  });

  test("signed off, then offline, then refused", () => {
    expect(admission({ ...ONLINE, connectionStatus: "disconnected" })).toBe(
      "signed_off",
    );
    expect(
      admission({
        ...ONLINE,
        lastAliveAt: new Date(NOW.getTime() - ALIVE_WINDOW_MS - 1000),
      }),
    ).toBe("offline");
    expect(admission({ ...ONLINE, lastAliveAt: null })).toBe("offline");
    expect(admission(ONLINE)).toBeNull();
  });
});

describe("getFirstConnectionDefaults", () => {
  function defaults(
    cluster: Partial<KubernetesCluster>,
    allowWrites: boolean,
  ): Record<string, unknown> {
    return KubernetesAiAgentService.getFirstConnectionDefaults({
      cluster: cluster as KubernetesCluster,
      allowWrites,
    }) as unknown as Record<string, unknown>;
  }

  test("configured clusters get nothing", () => {
    expect(
      defaults(
        {
          aiAccessConfiguredAt: new Date(),
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        },
        true,
      ),
    ).toEqual({ turnedOnInvestigation: false });
  });

  test("unconfigured: investigation on when it is not, fixes Ask for approval only with writes and only from Off", () => {
    expect(defaults({ isAiInvestigationEnabled: false }, false)).toEqual({
      turnedOnInvestigation: true,
    });
    expect(defaults({ isAiInvestigationEnabled: true }, false)).toEqual({
      turnedOnInvestigation: false,
    });
    expect(
      defaults(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        },
        true,
      ),
    ).toEqual({
      turnedOnInvestigation: false,
      remediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
    expect(
      defaults(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        },
        true,
      ),
    ).toEqual({ turnedOnInvestigation: false });
  });

  test("didApplyDefaults is true only when something changes", () => {
    expect(
      KubernetesAiAgentServiceClass.didApplyDefaults({
        turnedOnInvestigation: false,
      }),
    ).toBe(false);
    expect(
      KubernetesAiAgentServiceClass.didApplyDefaults({
        turnedOnInvestigation: true,
      }),
    ).toBe(true);
    expect(
      KubernetesAiAgentServiceClass.didApplyDefaults({
        turnedOnInvestigation: false,
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    ).toBe(true);
  });
});

describe("buildStoredPosture and the wording helpers", () => {
  test("buildStoredPosture drops unknown keys and never stores undefined", () => {
    const posture: KubernetesAgentPosture =
      KubernetesAiAgentService.buildStoredPosture({
        reported: { allowWrites: true, extra: "ignored" },
        clusterIdentifier: " prod-us ",
      });

    expect(posture).toEqual({
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: true,
    });
    expect(Object.values(posture)).not.toContain(undefined);
  });

  test("an empty cluster identifier is left out rather than stored blank", () => {
    expect(
      KubernetesAiAgentService.buildStoredPosture({
        reported: {},
        clusterIdentifier: "",
      }),
    ).toEqual({ inCluster: true, allowWrites: false });
  });

  test("describeWriteAccess", () => {
    expect(
      KubernetesAiAgentServiceClass.describeWriteAccess({ allowWrites: false }),
    ).toBe("read-only");
    expect(KubernetesAiAgentServiceClass.describeWriteAccess({})).toBe(
      "read-only",
    );
    expect(
      KubernetesAiAgentServiceClass.describeWriteAccess({
        allowWrites: true,
        writeNamespaces: ["web"],
      }),
    ).toBe("can make changes in web");
    expect(
      KubernetesAiAgentServiceClass.describeWriteAccess({
        allowWrites: true,
        writeNamespaces: [],
      }),
    ).toBe("can make changes anywhere in the cluster");
    expect(
      KubernetesAiAgentServiceClass.describeWriteAccess({ allowWrites: true }),
    ).toBe("can make changes anywhere in the cluster");
  });

  test("normalizeAgentVersion", () => {
    expect(KubernetesAiAgentServiceClass.normalizeAgentVersion(" 1.2 ")).toBe(
      "1.2",
    );
    expect(
      KubernetesAiAgentServiceClass.normalizeAgentVersion("   "),
    ).toBeUndefined();
    expect(
      KubernetesAiAgentServiceClass.normalizeAgentVersion(12),
    ).toBeUndefined();
    expect(
      KubernetesAiAgentServiceClass.normalizeAgentVersion("x".repeat(101)),
    ).toHaveLength(ColumnLength.ShortText);
  });
});

describe("KubernetesAiAgentRegistrationRefusedException", () => {
  test("is a 403 carrying the reason and, when given, when to retry", () => {
    const reasons: Array<KubernetesAiAgentRegistrationRefusalReason> = [
      "previous_instance_online",
      "legacy_runner_online",
      "cluster_name_invalid",
      "agent_cap_reached",
    ];

    for (const reason of reasons) {
      const refusal: KubernetesAiAgentRegistrationRefusedException =
        new KubernetesAiAgentRegistrationRefusedException({
          reason,
          message: "m",
          ...(isTransientKubernetesAiAgentRegistrationRefusal(reason)
            ? { retryAfterSeconds: 20 }
            : {}),
        });

      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal.code).toBe(403);
      expect(refusal.reason).toBe(reason);
      expect(refusal.message).toBe("m");
      expect(refusal.retryAfterSeconds).toBe(
        isTransientKubernetesAiAgentRegistrationRefusal(reason)
          ? 20
          : undefined,
      );
    }
  });
});
