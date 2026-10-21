import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner from "../../../Models/DatabaseModels/Runner";
import KubernetesAiAgentService, {
  KUBERNETES_AI_AGENT_SETTINGS_CHECK_INTERVAL_MS,
  KubernetesAiAgentRegistrationResult,
  KubernetesAiAgentSettingsApplied,
  Service as KubernetesAiAgentServiceClass,
} from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import { AgentAiSettings } from "../../../Types/AI/AgentAiSettings";
import OneUptimeDate from "../../../Types/Date";
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

/*
 * "These options should depend on the agent itself. If I say
 * investigation = true, the agent should be turned on automatically here.
 * The same with the fixes."
 *
 * The Kubernetes AI agent reports what its chart lets OneUptime AI do
 * (aiAgent.investigation, aiAgent.fixes) in its posture's aiSettings, on
 * registration and on every heartbeat. KubernetesAiAgentService writes
 * them to the cluster's isAiInvestigationEnabled and aiRemediationMode —
 * the columns every enforcement point reads — so OneUptime never allows
 * more than the agent's configuration does:
 *
 *  - a configuration that names the settings decides, even over what an
 *    operator chose on the AI agent page before;
 *  - the agent's defaults (its configuration names neither) decide only on
 *    a cluster nobody configured, in one conditional statement;
 *  - a cluster bound to a Runner an operator chose keeps OneUptime's
 *    settings (AI does not reach it through the agent);
 *  - an agent too old to report settings changes nothing here: the
 *    first-connection defaults behave as before;
 *  - every change is a root write that never marks the cluster configured,
 *    is said on the cluster's feed (from what, to what, set where), and
 *    never fails the registration or heartbeat that carried it.
 *
 * Everything below the service boundary is stubbed: no database.
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
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const CURRENT_KEY: string = "cd".repeat(32);

const CONFIGURED_READ_ONLY: AgentAiSettings = {
  investigation: false,
  fixes: "Disabled",
  isConfigured: true,
};

const CONFIGURED_AUTOMATIC: AgentAiSettings = {
  investigation: true,
  fixes: "Automatic",
  isConfigured: true,
};

const DEFAULTS_ASK_FOR_APPROVAL: AgentAiSettings = {
  investigation: true,
  fixes: "RequireApproval",
  isConfigured: false,
};

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

/*
 * An agent row. Each test gets its own id: the heartbeat's periodic check
 * is remembered per agent id for the life of the process.
 */
function makeAgent(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesAiAgent {
  const agent: KubernetesAiAgent = new KubernetesAiAgent();
  agent.id = ObjectID.generate();
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

function storedPosture(
  aiSettings: AgentAiSettings | undefined,
  allowWrites: boolean = false,
): JSONObject {
  return {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites,
    ...(aiSettings ? { aiSettings: { ...aiSettings } } : {}),
  } as unknown as JSONObject;
}

function advancedRunner(): Runner {
  const runner: Runner = new Runner();
  runner.id = RUNNER_ID;
  runner.name = "ops-runner";
  runner.hostInfo = {} as JSONObject;
  return runner;
}

function kubernetesAgentRunner(): Runner {
  const runner: Runner = new Runner();
  runner.id = RUNNER_ID;
  runner.name = "kubernetes-agent/prod-us";
  runner.hostInfo = {
    kubernetes: {
      inCluster: true,
      allowWrites: false,
      clusterIdentifier: "prod-us",
    },
  } as unknown as JSONObject;
  return runner;
}

interface Harness {
  clusterFindOneBy: SpyCalls;
  clusterUpdateOneBy: SpyCalls;
  feed: SpyCalls;
  runnerFindOneBy: SpyCalls;
  agentUpdateColumns: SpyCalls;
}

interface HarnessOptions {
  cluster?: KubernetesCluster | null;
  existing?: KubernetesAiAgent | null;
  boundRunner?: Runner | null;
  clusterUpdateCount?: number;
  clusterUpdateError?: Error;
}

function setUp(options: HarnessOptions = {}): Harness {
  const cluster: KubernetesCluster | null =
    options.cluster === undefined ? makeCluster() : options.cluster;

  jest
    .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
    .mockResolvedValue(cluster || makeCluster());

  const clusterFindOneBy: SpyCalls = jest
    .spyOn(KubernetesClusterService, "findOneBy")
    .mockResolvedValue(cluster) as unknown as SpyCalls;

  const clusterUpdateOneBy: SpyCalls = (options.clusterUpdateError
    ? jest
        .spyOn(KubernetesClusterService, "updateOneBy")
        .mockRejectedValue(options.clusterUpdateError)
    : jest
        .spyOn(KubernetesClusterService, "updateOneBy")
        .mockResolvedValue(
          options.clusterUpdateCount ?? 1,
        )) as unknown as SpyCalls;

  const feed: SpyCalls = jest
    .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
    .mockResolvedValue(undefined) as unknown as SpyCalls;

  jest
    .spyOn(KubernetesClusterAiAccessService, "getLegacyAgentRunnerForCluster")
    .mockResolvedValue(null);
  jest
    .spyOn(KubernetesClusterAiAccessService, "isRunnerOnline")
    .mockReturnValue(false);

  jest
    .spyOn(KubernetesAiAgentService, "findOneBy")
    .mockResolvedValue(
      options.existing === undefined ? null : options.existing,
    );
  jest
    .spyOn(KubernetesAiAgentService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(KubernetesAiAgentService, "create")
    .mockImplementation(async (createBy: { data: KubernetesAiAgent }) => {
      const created: KubernetesAiAgent = createBy.data;
      created.id = ObjectID.generate();
      return created;
    });
  jest.spyOn(KubernetesAiAgentService, "updateOneById").mockResolvedValue(1);

  const agentUpdateColumns: SpyCalls = jest
    .spyOn(KubernetesAiAgentService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined) as unknown as SpyCalls;

  jest
    .spyOn(KubernetesAiAgentService, "retireLegacyRunnerIfUnused")
    .mockResolvedValue("not_due" as never);

  const runnerFindOneBy: SpyCalls = jest
    .spyOn(RunnerService, "findOneBy")
    .mockResolvedValue(
      options.boundRunner === undefined ? null : options.boundRunner,
    ) as unknown as SpyCalls;

  return {
    clusterFindOneBy,
    clusterUpdateOneBy,
    feed,
    runnerFindOneBy,
    agentUpdateColumns,
  };
}

function register(
  aiSettings: unknown,
  overrides: Partial<{ allowWrites: boolean; previousAgentKey: string }> = {},
): Promise<KubernetesAiAgentRegistrationResult> {
  return KubernetesAiAgentService.register({
    projectId: PROJECT_ID,
    clusterName: "prod-us",
    agentVersion: "14.2.0",
    ...(overrides.previousAgentKey
      ? { previousAgentKey: overrides.previousAgentKey }
      : {}),
    posture: {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: overrides.allowWrites === true,
      writeNamespaces: [],
      ...(aiSettings === undefined ? {} : { aiSettings }),
    },
  });
}

interface ClusterWrite {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

function clusterWrites(harness: Harness): Array<ClusterWrite> {
  return harness.clusterUpdateOneBy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ClusterWrite;
  });
}

function feedTexts(harness: Harness): Array<string> {
  return harness.feed.mock.calls.map((call: Array<unknown>) => {
    const item: Record<string, unknown> = call[0] as Record<string, unknown>;
    return `${String(item["feedInfoInMarkdown"])}\n${String(
      item["moreInformationInMarkdown"] || "",
    )}`;
  });
}

function loggedErrors(): string {
  return JSON.stringify(
    (logger.error as unknown as SpyCalls).mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    ),
  );
}

beforeEach(() => {
  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("register: the agent's configuration decides what AI may do", () => {
  test("writes the configured investigation and fixes to the cluster, as root", async () => {
    const harness: Harness = setUp();

    await register(CONFIGURED_AUTOMATIC);

    const writes: Array<ClusterWrite> = clusterWrites(harness);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    });
    expect(writes[0]!.query["_id"]).toBe(CLUSTER_ID.toString());
    expect(writes[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(writes[0]!.props["isRoot"]).toBe(true);
  });

  test("turns investigation off when the configuration says so", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    });

    await register(CONFIGURED_READ_ONLY);

    expect(clusterWrites(harness)[0]!.data).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });
  });

  test("replaces what an operator chose on the AI agent page — the configuration is where it is set now", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessConfiguredAt: msAgo(24 * 60 * 60 * 1000),
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    });

    await register(CONFIGURED_AUTOMATIC);

    const write: ClusterWrite = clusterWrites(harness)[0]!;
    expect(write.data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    });
    // Unconditional: a configuration replaces a choice.
    expect(write.query).not.toHaveProperty("aiAccessConfiguredAt");
  });

  test("never marks the cluster configured: nobody chose these on the AI agent page", async () => {
    const harness: Harness = setUp();

    await register(CONFIGURED_AUTOMATIC);

    for (const write of clusterWrites(harness)) {
      expect(write.data).not.toHaveProperty("aiAccessConfiguredAt");
    }
  });

  test("the first-connection defaults never run after the agent decided", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    // Writes allowed, but the configuration turns both off.
    await register(CONFIGURED_READ_ONLY, { allowWrites: true });

    // Nothing to change (already off); and no "Ask for approval" default.
    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("settings the cluster already has write nothing", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      }),
    });

    await register(CONFIGURED_AUTOMATIC);

    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("the first connection's feed item says what the configuration set, and where it is changed", async () => {
    const harness: Harness = setUp();

    await register(CONFIGURED_AUTOMATIC);

    const texts: Array<string> = feedTexts(harness);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(
      "What AI may do here follows the agent's configuration: investigation on, fixes Automatic.",
    );
    expect(texts[0]).toContain("aiAgent.investigation and aiAgent.fixes");
  });

  test("a re-registration that changes the settings says what moved, from and to, once", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      cluster: makeCluster({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    });

    await register(
      { investigation: false, fixes: "BypassApproval", isConfigured: true },
      { previousAgentKey: CURRENT_KEY },
    );

    const texts: Array<string> = feedTexts(harness);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(
      "configuration changed what AI may do on this cluster: investigation on → off; fixes Off → Bypass approval.",
    );
    expect(texts[0]).toContain("**aiAgent.investigation**");
  });

  test("a re-registration that changes nothing writes no feed item", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      cluster: makeCluster({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      }),
    });

    await register(CONFIGURED_AUTOMATIC, { previousAgentKey: CURRENT_KEY });

    expect(feedTexts(harness)).toHaveLength(0);
  });

  test("a report it cannot read fails closed: investigation and fixes off", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    });

    await register("everything");

    expect(clusterWrites(harness)[0]!.data).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });
  });

  test("an unknown fixes value is read as Off, never as more", async () => {
    const harness: Harness = setUp();

    await register({
      investigation: true,
      fixes: "Everything",
      isConfigured: true,
    });

    // Off already: nothing to write, and certainly nothing above Off.
    expect(clusterWrites(harness)).toHaveLength(0);
  });
});

describe("register: the agent's defaults", () => {
  test("decide on a cluster nobody configured, in one statement conditional on it staying unconfigured", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register(DEFAULTS_ASK_FOR_APPROVAL, { allowWrites: true });

    const writes: Array<ClusterWrite> = clusterWrites(harness);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
    expect(writes[0]!.query).toHaveProperty("aiAccessConfiguredAt");
    expect(feedTexts(harness)[0]).toContain(
      "follows the agent's defaults: investigation on, fixes Ask for approval.",
    );
  });

  test("never replace what an operator chose on the AI agent page", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessConfiguredAt: msAgo(60 * 60 * 1000),
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    });

    await register(DEFAULTS_ASK_FOR_APPROVAL, { allowWrites: true });

    // Neither the agent's defaults nor the first-connection defaults.
    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("when an operator configured the cluster a moment earlier, the conditional write lands nowhere and nothing is claimed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
      clusterUpdateCount: 0,
    });

    await register(DEFAULTS_ASK_FOR_APPROVAL, {
      allowWrites: true,
      previousAgentKey: CURRENT_KEY,
    });

    expect(feedTexts(harness)).toHaveLength(0);
  });
});

describe("register: where the agent does not decide", () => {
  test("a cluster bound to a Runner an operator chose keeps OneUptime's settings", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessRunnerId: RUNNER_ID,
        aiAccessConfiguredAt: msAgo(60 * 60 * 1000),
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
      boundRunner: advancedRunner(),
    });

    await register(CONFIGURED_READ_ONLY);

    expect(clusterWrites(harness)).toHaveLength(0);

    // The bound Runner is read in the cluster's project, as root.
    expect(harness.runnerFindOneBy.mock.calls).toHaveLength(1);
    const read: { query: Record<string, unknown>; props: JSONObject } = harness
      .runnerFindOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: JSONObject;
    };
    expect(read.query["_id"]).toBe(RUNNER_ID.toString());
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.props["isRoot"]).toBe(true);
  });

  test("a cluster bound to the chart's own previous Runner still follows the agent", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessRunnerId: RUNNER_ID,
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
      boundRunner: kubernetesAgentRunner(),
    });

    await register(CONFIGURED_READ_ONLY);

    expect(clusterWrites(harness)[0]!.data).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });
  });

  test("a binding whose Runner is gone is no binding: the agent decides", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiAccessRunnerId: RUNNER_ID,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      }),
      boundRunner: null,
    });

    await register(CONFIGURED_READ_ONLY);

    expect(clusterWrites(harness)[0]!.data["aiRemediationMode"]).toBe(
      KubernetesAiRemediationMode.Disabled,
    );
  });

  test("an agent too old to report settings gets the first-connection defaults, as before", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({ isAiInvestigationEnabled: false }),
    });

    await register(undefined, { allowWrites: true });

    const writes: Array<ClusterWrite> = clusterWrites(harness);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
    // No Runner lookup: there are no reported settings to weigh.
    expect(harness.runnerFindOneBy.mock.calls).toHaveLength(0);
    expect(feedTexts(harness)[0]).not.toContain("follows the agent's");
  });
});

describe("register: when applying the settings fails", () => {
  test("the registration still succeeds and hands out its key", async () => {
    setUp({ clusterUpdateError: new Error("database is down") });

    const result: KubernetesAiAgentRegistrationResult =
      await register(CONFIGURED_AUTOMATIC);

    expect(result.agentKey).toMatch(/^[0-9a-f]{64}$/);
    expect(loggedErrors()).toContain(
      "could not apply the Kubernetes AI agent's AI settings",
    );
  });

  test("no feed item claims the settings changed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      clusterUpdateError: new Error("database is down"),
    });

    await register(CONFIGURED_AUTOMATIC, { previousAgentKey: CURRENT_KEY });

    expect(feedTexts(harness)).toHaveLength(0);
  });
});

describe("heartbeat: keeping the cluster in step with the agent", () => {
  test("a report that differs from the stored one is applied at once, with a feed item", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    });

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({
        posture: storedPosture(CONFIGURED_READ_ONLY, true),
      }),
      posture: { allowWrites: true, aiSettings: CONFIGURED_AUTOMATIC },
    });

    expect(clusterWrites(harness)[0]!.data).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    });
    expect(feedTexts(harness)).toHaveLength(1);
    expect(feedTexts(harness)[0]).toContain("fixes Off → Automatic");
  });

  test("the settings are stored on the agent row with the rest of the posture", async () => {
    const harness: Harness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: storedPosture(CONFIGURED_AUTOMATIC) }),
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
    });

    const write: { data: Record<string, unknown> } = harness.agentUpdateColumns
      .mock.calls[0]![0] as { data: Record<string, unknown> };
    expect((write.data["posture"] as JSONObject)["aiSettings"]).toEqual(
      CONFIGURED_AUTOMATIC,
    );
  });

  test("an unchanged report reads the cluster once, then not again until the check interval passes", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      }),
    });
    const agent: KubernetesAiAgent = makeAgent({
      posture: storedPosture(CONFIGURED_AUTOMATIC),
    });
    const start: Date = new Date();
    const clock: { now: Date } = { now: start };
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return clock.now;
    });

    await KubernetesAiAgentService.heartbeat({
      agent,
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
    });
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);

    clock.now = new Date(start.getTime() + 30 * 1000);
    await KubernetesAiAgentService.heartbeat({
      agent,
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
    });
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(1);

    clock.now = new Date(
      start.getTime() + KUBERNETES_AI_AGENT_SETTINGS_CHECK_INTERVAL_MS + 1000,
    );
    await KubernetesAiAgentService.heartbeat({
      agent,
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
    });
    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(2);

    // Every check found the cluster in step: nothing written.
    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("the periodic check puts back a setting something else moved", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    });

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: storedPosture(CONFIGURED_AUTOMATIC) }),
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
    });

    expect(clusterWrites(harness)[0]!.data).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    });
    expect(feedTexts(harness)[0]).toContain(
      "fixes Bypass approval → Automatic",
    );
  });

  test("write access appearing never sets fixes to Ask for approval while the agent decides", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    });

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent({ posture: storedPosture(CONFIGURED_READ_ONLY) }),
      posture: {
        allowWrites: true,
        aiSettings: {
          investigation: true,
          fixes: "Disabled",
          isConfigured: true,
        },
      },
    });

    // The cluster already matches the agent; the defaults never run.
    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("an older agent's heartbeat (no settings) reads no cluster and changes nothing", async () => {
    const harness: Harness = setUp();

    await KubernetesAiAgentService.heartbeat({
      agent: makeAgent(),
      posture: { allowWrites: false },
    });

    expect(harness.clusterFindOneBy.mock.calls).toHaveLength(0);
    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("a failure reading the cluster never fails the heartbeat", async () => {
    setUp();
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { aiSettings: CONFIGURED_AUTOMATIC },
      }),
    ).resolves.toBeUndefined();

    expect(loggedErrors()).toContain("to check its AI settings");
  });

  test("a failure writing the settings never fails the heartbeat, and nothing is claimed", async () => {
    const harness: Harness = setUp({
      clusterUpdateError: new Error("database is down"),
    });

    await expect(
      KubernetesAiAgentService.heartbeat({
        agent: makeAgent(),
        posture: { aiSettings: CONFIGURED_AUTOMATIC },
      }),
    ).resolves.toBeUndefined();

    expect(feedTexts(harness)).toHaveLength(0);
  });
});

describe("applyStoredAiSettingsToCluster: a cluster handed back to its agent", () => {
  test("applies what the agent last reported, with a feed item", async () => {
    const harness: Harness = setUp({
      cluster: makeCluster({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    });
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(
        makeAgent({ posture: storedPosture(CONFIGURED_READ_ONLY) }),
      );

    const applied: KubernetesAiAgentSettingsApplied | null =
      await KubernetesAiAgentService.applyStoredAiSettingsToCluster({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      });

    expect(applied?.source).toBe("agent_configuration");
    expect(clusterWrites(harness)[0]!.data).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });
    expect(feedTexts(harness)).toHaveLength(1);
  });

  test("an agent that reported no settings changes nothing", async () => {
    const harness: Harness = setUp();
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(makeAgent());

    await expect(
      KubernetesAiAgentService.applyStoredAiSettingsToCluster({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      }),
    ).resolves.toBeNull();

    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("no agent: nothing", async () => {
    const harness: Harness = setUp();
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(null);

    await expect(
      KubernetesAiAgentService.applyStoredAiSettingsToCluster({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      }),
    ).resolves.toBeNull();

    expect(clusterWrites(harness)).toHaveLength(0);
  });

  test("never throws", async () => {
    setUp();
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      KubernetesAiAgentService.applyStoredAiSettingsToCluster({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("getAiSettingsSourcesForClusters", () => {
  const CONFIGURED_BOUND: ObjectID = new ObjectID(
    "a1111111-1111-4111-8111-111111111111",
  );
  const CONFIGURED_FREE: ObjectID = new ObjectID(
    "a2222222-2222-4222-8222-222222222222",
  );
  const OLD_AGENT_BOUND: ObjectID = new ObjectID(
    "a3333333-3333-4333-8333-333333333333",
  );
  const NO_AGENT: ObjectID = new ObjectID(
    "a4444444-4444-4444-8444-444444444444",
  );
  const DEFAULTS_CHOSEN: ObjectID = new ObjectID(
    "a5555555-5555-4555-8555-555555555555",
  );
  const DEFAULTS_UNCHOSEN: ObjectID = new ObjectID(
    "a6666666-6666-4666-8666-666666666666",
  );
  const OTHER_RUNNER_ID: ObjectID = new ObjectID(
    "b7777777-7777-4777-8777-777777777777",
  );

  function agentFor(
    clusterId: ObjectID,
    aiSettings: AgentAiSettings | undefined,
  ): KubernetesAiAgent {
    return makeAgent({
      kubernetesClusterId: clusterId,
      posture: storedPosture(aiSettings),
    });
  }

  function clusters(): Array<KubernetesCluster> {
    return [
      makeCluster({ id: CONFIGURED_BOUND, aiAccessRunnerId: RUNNER_ID }),
      makeCluster({ id: CONFIGURED_FREE }),
      makeCluster({ id: OLD_AGENT_BOUND, aiAccessRunnerId: OTHER_RUNNER_ID }),
      makeCluster({ id: NO_AGENT }),
      makeCluster({
        id: DEFAULTS_CHOSEN,
        aiAccessConfiguredAt: msAgo(60 * 1000),
      }),
      makeCluster({ id: DEFAULTS_UNCHOSEN }),
    ];
  }

  function agents(): Map<string, KubernetesAiAgent> {
    return new Map<string, KubernetesAiAgent>([
      [
        CONFIGURED_BOUND.toString(),
        agentFor(CONFIGURED_BOUND, CONFIGURED_AUTOMATIC),
      ],
      [
        CONFIGURED_FREE.toString(),
        agentFor(CONFIGURED_FREE, CONFIGURED_AUTOMATIC),
      ],
      [OLD_AGENT_BOUND.toString(), agentFor(OLD_AGENT_BOUND, undefined)],
      [
        DEFAULTS_CHOSEN.toString(),
        agentFor(DEFAULTS_CHOSEN, DEFAULTS_ASK_FOR_APPROVAL),
      ],
      [
        DEFAULTS_UNCHOSEN.toString(),
        agentFor(DEFAULTS_UNCHOSEN, DEFAULTS_ASK_FOR_APPROVAL),
      ],
    ]);
  }

  test("each cluster's source, from one read of the agents and of the Runners that matter", async () => {
    const agentLookup: SpyCalls = jest
      .spyOn(KubernetesAiAgentService, "findForClusters")
      .mockResolvedValue(agents()) as unknown as SpyCalls;
    const runnerLookup: SpyCalls = jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([advancedRunner()]) as unknown as SpyCalls;

    const sources: Map<string, string> =
      await KubernetesAiAgentService.getAiSettingsSourcesForClusters({
        projectId: PROJECT_ID,
        clusters: clusters(),
      });

    expect(Object.fromEntries(sources)).toEqual({
      [CONFIGURED_BOUND.toString()]: "oneuptime",
      [CONFIGURED_FREE.toString()]: "agent_configuration",
      [OLD_AGENT_BOUND.toString()]: "oneuptime",
      [NO_AGENT.toString()]: "oneuptime",
      [DEFAULTS_CHOSEN.toString()]: "oneuptime",
      [DEFAULTS_UNCHOSEN.toString()]: "agent_defaults",
    });

    expect(agentLookup.mock.calls).toHaveLength(1);
    expect(runnerLookup.mock.calls).toHaveLength(1);

    /*
     * Only the Runner bound to a cluster whose agent reports settings: an
     * older agent's cluster reads "oneuptime" whatever it is bound to.
     */
    const runnerQuery: { query: Record<string, unknown> } = runnerLookup.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(JSON.stringify(runnerQuery.query["_id"])).toContain(
      RUNNER_ID.toString(),
    );
    expect(JSON.stringify(runnerQuery.query["_id"])).not.toContain(
      OTHER_RUNNER_ID.toString(),
    );
    expect(runnerQuery.query["projectId"]).toBe(PROJECT_ID);
  });

  test("a bound Runner that is the chart's own leaves the agent deciding", async () => {
    jest
      .spyOn(KubernetesAiAgentService, "findForClusters")
      .mockResolvedValue(agents());
    jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([kubernetesAgentRunner()]);

    const sources: Map<string, string> =
      await KubernetesAiAgentService.getAiSettingsSourcesForClusters({
        projectId: PROJECT_ID,
        clusters: clusters(),
      });

    expect(sources.get(CONFIGURED_BOUND.toString())).toBe(
      "agent_configuration",
    );
  });

  test("uses the agent rows the caller already read, and reads no Runner when no bound cluster's agent reports settings", async () => {
    const agentLookup: SpyCalls = jest
      .spyOn(KubernetesAiAgentService, "findForClusters")
      .mockResolvedValue(new Map()) as unknown as SpyCalls;
    const runnerLookup: SpyCalls = jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([]) as unknown as SpyCalls;

    const sources: Map<string, string> =
      await KubernetesAiAgentService.getAiSettingsSourcesForClusters({
        projectId: PROJECT_ID,
        clusters: [
          makeCluster({ id: OLD_AGENT_BOUND, aiAccessRunnerId: RUNNER_ID }),
        ],
        agents: new Map<string, KubernetesAiAgent>([
          [OLD_AGENT_BOUND.toString(), agentFor(OLD_AGENT_BOUND, undefined)],
        ]),
      });

    expect(sources.get(OLD_AGENT_BOUND.toString())).toBe("oneuptime");
    expect(agentLookup.mock.calls).toHaveLength(0);
    expect(runnerLookup.mock.calls).toHaveLength(0);
  });
});
