/*
 * ---------------------------------------------------------------------------
 * What the server makes of the kubectl write limits a Runner reports.
 *
 * WS4-3: a Runner that is not the Kubernetes agent's refuses, in its
 * executor, writes outside ONEUPTIME_KUBECTL_WRITE_NAMESPACES and node
 * operations while ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS is off, and
 * reports those limits on every heartbeat. Such a Runner ran OneUptime AI's
 * kubectl with a Kubernetes runbook credential bound to the cluster beside
 * it, so the server's pre-checks refused up front what it would refuse.
 * Runbook credentials were removed: OneUptime AI reaches a cluster through
 * its Kubernetes AI agent, or its previous in-cluster Runner, and a cluster
 * still bound to an ordinary Runner reads as having no way in.
 *
 * This suite feeds the heartbeat — through JSON, as the server stores it —
 * to the real server code, and pins:
 *
 * - an ordinary Runner's limits never read as a cluster's agent: not to the
 *   agent-row rule, not to the in-cluster rule;
 * - bound to a cluster, an ordinary Runner is no way in, whatever it
 *   reports — online or not, writes on or off, in a pod or not: the
 *   cluster's AI agent is not connected, and the status says the Runner is
 *   not the cluster's in-cluster Runner, with no gap asking for a
 *   credential;
 * - the cluster's own previous in-cluster Runner is its way in, the status
 *   carries the limits it reported, and the toolkit and the enqueue
 *   chokepoint refuse what they refuse (negative control for the above:
 *   the checks can tell the two apart);
 * - server-remediation-1, the agent's side: its registration carries the
 *   write scope, so the posture the server stores from it refuses what the
 *   heartbeat's posture refuses.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import { getHostInfo } from "../../Jobs/Heartbeat";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import KubernetesPosture from "../../Utils/KubernetesPosture";
import { Service as RunnerJobServiceClass } from "Common/Server/Services/RunnerJobService";
import RemediationCommandToolkit from "Common/Server/Utils/AI/Remediation/RemediationCommandTools";
import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
} from "Common/Server/Services/KubernetesClusterAiAccessService";
import RunnerService, {
  Service as RunnerServiceClass,
  getKubernetesAgentRunnerNameForCluster,
} from "Common/Server/Services/RunnerService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Runner from "Common/Models/DatabaseModels/Runner";
import KubectlPolicy from "Common/Utils/AiRemediation/KubectlPolicy";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  isInClusterPostureForCluster,
  isKubernetesAgentRunnerPosture,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLUSTER_IDENTIFIER: string = "prod-us";
const ORDINARY_RUNNER_NAME: string = "payments-runner";

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
};

type Answer = "A" | "R";

// An ordinary Runner's kubectl configuration, as its executor reads it.
interface OrdinaryRunnerConfig {
  allowWrites: boolean;
  allowNodeOperations: boolean;
  writeNamespaces: Array<string>;
  podNamespace: string | null;
}

// Scoped to prod, nodes off: the limits WS4-3 made a Runner report.
const SCOPED: OrdinaryRunnerConfig = {
  allowWrites: true,
  allowNodeOperations: false,
  writeNamespaces: ["prod"],
  podNamespace: null,
};

// The Runner this config describes, as its executor and heartbeat see it.
function configure(config: OrdinaryRunnerConfig): void {
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(false);
  jest
    .spyOn(KubernetesPosture, "allowsWrites")
    .mockReturnValue(config.allowWrites);
  jest
    .spyOn(KubernetesPosture, "getAllowWritesSetting")
    .mockReturnValue(config.allowWrites ? "true" : "false");
  jest
    .spyOn(KubernetesPosture, "allowsNodeOperations")
    .mockReturnValue(config.allowNodeOperations);
  jest
    .spyOn(KubernetesPosture, "getAllowNodeOperationsSetting")
    .mockReturnValue(config.allowNodeOperations ? "true" : "false");
  jest
    .spyOn(KubernetesPosture, "getWriteNamespaces")
    .mockReturnValue([...config.writeNamespaces]);
  jest
    .spyOn(KubernetesPosture, "getPodNamespace")
    .mockReturnValue(config.podNamespace);
}

// The heartbeat's hostInfo exactly as the server stores it: its JSON.
async function storedHostInfo(): Promise<JSONObject> {
  return JSON.parse(JSON.stringify(await getHostInfo())) as JSONObject;
}

function fakeCluster(): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: CLUSTER_IDENTIFIER,
    clusterIdentifier: CLUSTER_IDENTIFIER,
    aiAccessRunnerId: RUNNER_ID,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
  } as unknown as KubernetesCluster;
}

// The Runner row bound to the cluster: its name, the hostInfo it heartbeated.
function fakeRunner(
  hostInfo: JSONObject,
  overrides: Partial<Record<string, unknown>> = {},
): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: ORDINARY_RUNNER_NAME,
    lastAlive: OneUptimeDate.getCurrentDate(),
    canRunAiCommands: true,
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    hostInfo,
    ...overrides,
  } as unknown as Runner;
}

// The cluster's readiness with that Runner bound, and no AI agent connected.
async function statusFor(data: {
  hostInfo: JSONObject;
  runner?: Partial<Record<string, unknown>>;
}): Promise<KubernetesClusterAiAccessStatus> {
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockResolvedValue(fakeRunner(data.hostInfo, data.runner));

  return KubernetesClusterAiAccessService.getStatusForClusterModel({
    cluster: fakeCluster(),
    gates: READY_GATES,
    aiAgentRow: null,
  });
}

function gapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map((gap: KubernetesAiAccessGap) => {
    return gap.code;
  });
}

// The enqueue chokepoint's answer, for a command on the in-cluster Runner.
function chokepointAnswer(
  command: string,
  posture: KubernetesRunnerPosture | undefined,
): Answer {
  return RunnerJobServiceClass.getRunnerWriteScopeRefusal({
    policy: KubectlPolicy.evaluateCommand(command),
    posture,
  })
    ? "R"
    : "A";
}

// The remediation toolkit's answer, at propose and approve time.
function toolkitAnswer(
  command: string,
  status: KubernetesClusterAiAccessStatus,
): Answer {
  return RemediationCommandToolkit.getRunnerScopeRefusal({
    cluster: status,
    command,
  })
    ? "R"
    : "A";
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an ordinary Runner's write limits never read as a cluster's agent", () => {
  test("the agent-row and in-cluster rules say no", async () => {
    configure(SCOPED);
    // Even in a pod: being in one says nothing about which cluster.
    jest.spyOn(KubernetesPosture, "isInCluster").mockReturnValue(true);

    const hostInfo: JSONObject = await storedHostInfo();
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(hostInfo);

    expect(posture).toBeDefined();
    expect(isKubernetesAgentRunnerPosture(posture)).toBe(false);
    expect(isInClusterPostureForCluster(posture, CLUSTER_IDENTIFIER)).toBe(
      false,
    );
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerRow({
        name: ORDINARY_RUNNER_NAME,
        hostInfo,
      }),
    ).toBe(false);
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        { name: ORDINARY_RUNNER_NAME, hostInfo },
        CLUSTER_IDENTIFIER,
      ),
    ).toBe(false);
  });
});

describe("bound to a cluster, an ordinary Runner is no way in now that runbook credentials are gone", () => {
  test.each([
    ["online, scoped to prod with nodes off", SCOPED, {}, false],
    ["with writes off", { ...SCOPED, allowWrites: false }, {}, false],
    [
      "offline",
      SCOPED,
      { lastAlive: OneUptimeDate.getSomeMinutesAgo(30) },
      false,
    ],
    ["running in a pod", SCOPED, {}, true],
  ] as Array<
    [string, OrdinaryRunnerConfig, Partial<Record<string, unknown>>, boolean]
  >)(
    "%s: the cluster's AI agent is not connected, and the status says the Runner is not its in-cluster Runner",
    async (
      _label: string,
      config: OrdinaryRunnerConfig,
      runner: Partial<Record<string, unknown>>,
      inPod: boolean,
    ) => {
      configure(config);
      jest.spyOn(KubernetesPosture, "isInCluster").mockReturnValue(inPod);

      const status: KubernetesClusterAiAccessStatus = await statusFor({
        hostInfo: await storedHostInfo(),
        runner,
      });

      expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
      expect(status.accessMethod).toBe("none");
      expect(status.runner).toBeNull();
      expect(status.isRemediationReady).toBe(false);
      expect(status.gaps[0]?.description).toContain(
        `Runner "${ORDINARY_RUNNER_NAME}" is still selected for this cluster, but it is not this cluster's in-cluster Runner, so OneUptime AI does not use it.`,
      );

      // Nothing asks for a credential, and no write scope is offered to the model.
      expect(JSON.stringify(status)).not.toMatch(/credential/i);
      expect(
        RemediationCommandToolkit.getRunnerScopeRefusal({
          cluster: status,
          command: "kubectl scale deployment/web --replicas=3 -n staging",
        }),
      ).toBeNull();
    },
  );

  /*
   * Negative control: the checks above can tell. The same row with an
   * agent's posture naming another cluster is that cluster's in-cluster
   * Runner — never this cluster's way in either, and the note names the
   * cluster it reports.
   */
  test("negative control: another cluster's in-cluster Runner is named as that", async () => {
    const agentHostInfo: JSONObject = {
      kubernetes: {
        inCluster: true,
        clusterIdentifier: "staging-eu",
        allowWrites: true,
        writeNamespaces: ["prod"],
      },
    };

    expect(
      RunnerServiceClass.isKubernetesAgentRunnerRow({
        name: ORDINARY_RUNNER_NAME,
        hostInfo: agentHostInfo,
      }),
    ).toBe(true);

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: agentHostInfo,
    });

    expect(gapCodes(status)).toEqual(["ai_agent_not_connected"]);
    expect(status.runner).toBeNull();
    expect(status.gaps[0]?.description).toContain(
      `is not this cluster's in-cluster Runner (it reports cluster "staging-eu")`,
    );
  });
});

describe("the cluster's own previous in-cluster Runner is its way in, within the limits it reported", () => {
  // As the chart's in-cluster Runner reports itself: this cluster, scoped to prod, nodes off.
  const IN_CLUSTER_HOST_INFO: JSONObject = {
    kubernetes: {
      inCluster: true,
      clusterIdentifier: CLUSTER_IDENTIFIER,
      allowWrites: true,
      allowNodeOperations: false,
      writeNamespaces: ["prod"],
      podNamespace: "oneuptime-agent",
    },
  };

  test("the status reaches the cluster through it, and carries its limits for the model", async () => {
    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: IN_CLUSTER_HOST_INFO,
      runner: {
        name: getKubernetesAgentRunnerNameForCluster(CLUSTER_IDENTIFIER),
      },
    });

    expect(gapCodes(status)).not.toContain("ai_agent_not_connected");
    expect(status.accessMethod).toBe("in_cluster");
    expect(status.runner?.posture).toEqual(
      expect.objectContaining({
        inCluster: true,
        clusterIdentifier: CLUSTER_IDENTIFIER,
        allowNodeOperations: false,
        writeNamespaces: ["prod"],
      }),
    );

    // What the model is told about this Runner's scope.
    expect(
      RemediationCommandToolkit.describeRunnerNamespaceScope(status),
    ).toContain('writes only in namespaces "prod"');
    expect(RemediationCommandToolkit.getChangeSummaryOptions(status)).toEqual({
      allowNodeOperations: false,
    });
  });

  test("the toolkit and the enqueue chokepoint refuse a staging write, a cordon and a write into its own namespace up front, and let a prod write through", async () => {
    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: IN_CLUSTER_HOST_INFO,
      runner: {
        name: getKubernetesAgentRunnerNameForCluster(CLUSTER_IDENTIFIER),
      },
    });
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(IN_CLUSTER_HOST_INFO);

    const expected: Array<[string, Answer]> = [
      ["kubectl scale deployment/web --replicas=3 -n staging", "R"],
      ["kubectl cordon node-1", "R"],
      ["kubectl delete pod oneuptime-runner-abc -n oneuptime-agent", "R"],
      ["kubectl rollout restart deployment/web -n prod", "A"],
      ["kubectl get pods -n staging", "A"],
    ];

    for (const [command, answer] of expected) {
      expect(`${command}: ${toolkitAnswer(command, status)}`).toBe(
        `${command}: ${answer}`,
      );
      expect(`${command}: ${chokepointAnswer(command, posture)}`).toBe(
        `${command}: ${answer}`,
      );
    }

    // The refusal names the scope the Runner reported, so the approver learns why.
    expect(
      RunnerJobServiceClass.getRunnerWriteScopeRefusal({
        policy: KubectlPolicy.evaluateCommand(expected[0]![0]),
        posture,
      }),
    ).toContain('"prod"');
  });
});

/*
 * server-remediation-1: the server stores the agent's registration posture
 * over its last heartbeat's. The registration used to leave the write scope
 * out, so until the next heartbeat the stored posture had none — and the
 * chokepoint let through a write outside the chart's namespaces, or into
 * the agent's own namespace, that the Runner then refused.
 */
describe("the kubernetes-agent Runner's registration", () => {
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.resetModules();
  });

  test("the posture stored from its registration refuses what its heartbeat's posture refuses", async () => {
    jest.resetModules();
    delete process.env["ONEUPTIME_RUNNER_ID"];
    delete process.env["ONEUPTIME_RUNNER_KEY"];
    process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
    process.env["ONEUPTIME_INGESTION_KEY"] = "ingest-key-123";
    process.env["ONEUPTIME_KUBERNETES_CLUSTER_NAME"] = CLUSTER_IDENTIFIER;
    process.env["ONEUPTIME_KUBECTL_ALLOW_WRITES"] = "true";
    process.env["ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS"] = "false";
    process.env["ONEUPTIME_KUBECTL_WRITE_NAMESPACES"] = "web";
    process.env["ONEUPTIME_RUNNER_POD_NAMESPACE"] = "oneuptime-agent";

    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const agentPosture: {
      detectKubectlVersion: () => Promise<string | null>;
      isInCluster: () => boolean;
    } = require("../../Utils/KubernetesPosture").default;
    const agentMode: { isActive: () => boolean } =
      require("../../Utils/KubernetesAgentMode").default;
    const api: { post: (...args: Array<unknown>) => Promise<unknown> } =
      require("Common/Utils/API").default;
    const HTTPResponse: new (
      statusCode: number,
      data: JSONObject,
      headers: JSONObject,
    ) => unknown = require("Common/Types/API/HTTPResponse").default;
    const register: { registerRunner: () => Promise<void> } =
      require("../../Services/RegisterRunner").default;
    const heartbeat: {
      getHostInfo: () => Promise<JSONObject>;
    } = require("../../Jobs/Heartbeat");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    // The loader really switched to agent mode, or this proves nothing.
    expect(agentMode.isActive()).toBe(true);

    jest
      .spyOn(agentPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.36.4");
    jest.spyOn(agentPosture, "isInCluster").mockReturnValue(true);
    const post: jest.SpyInstance = jest.spyOn(api, "post").mockResolvedValue(
      new HTTPResponse(
        200,
        {
          runnerId: RUNNER_ID.toString(),
          runnerKey: "issued-key-abc",
          isBoundToCluster: true,
          capabilities: { canRunAiCommands: true },
        },
        {},
      ),
    );

    await register.registerRunner();

    const body: JSONObject = JSON.parse(
      JSON.stringify((post.mock.calls[0]![0] as JSONObject)["data"]),
    ) as JSONObject;

    /*
     * As the server stores it: the reported posture read with the one
     * parser (RunnerIngressAPI.parseRegistrationPosture), plus which
     * cluster and in-cluster, which registerKubernetesAgentRunner sets.
     */
    const fromRegistration: KubernetesRunnerPosture = {
      ...parseKubernetesRunnerPosture({ kubernetes: body }),
      clusterIdentifier: CLUSTER_IDENTIFIER,
      inCluster: true,
    };
    const fromHeartbeat: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(
        JSON.parse(JSON.stringify(await heartbeat.getHostInfo())),
      );

    expect(
      isInClusterPostureForCluster(fromHeartbeat, CLUSTER_IDENTIFIER),
    ).toBe(true);

    const expected: Array<[string, Answer]> = [
      // Outside the chart's namespaces.
      ["kubectl rollout restart deployment/api -n payments", "R"],
      // The agent's own namespace.
      ["kubectl delete pod oneuptime-runner-abc -n oneuptime-agent", "R"],
      // No -n in-cluster lands in the agent's own namespace.
      ["kubectl rollout restart deployment/web", "R"],
      // Nodes off.
      ["kubectl cordon node-1", "R"],
      // Inside the scope.
      ["kubectl rollout restart deployment/web -n web", "A"],
    ];

    for (const [command, answer] of expected) {
      expect(`${command}: ${chokepointAnswer(command, fromHeartbeat)}`).toBe(
        `${command}: ${answer}`,
      );
      expect(`${command}: ${chokepointAnswer(command, fromRegistration)}`).toBe(
        `${command}: ${answer}`,
      );
    }
  });
});
