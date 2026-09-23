/*
 * ---------------------------------------------------------------------------
 * What the server makes of the kubectl write limits a Runner reports.
 *
 * WS4-3: a Runner that is not the Kubernetes agent's refuses, in its
 * executor, writes outside ONEUPTIME_KUBECTL_WRITE_NAMESPACES and node
 * operations while ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS is off. It used
 * to report nothing, so the server's two pre-checks — the enqueue
 * chokepoint (RunnerJobService.getRunnerWriteScopeRefusal) and the
 * remediation toolkit (RemediationCommandToolkit.getRunnerScopeRefusal) —
 * let every such write through, to be approved, enqueued and counted by
 * the cluster's circuit breaker only to be refused here. It now reports its
 * write limits on every heartbeat.
 *
 * This suite feeds that heartbeat — through JSON, as the server stores it —
 * to the real server code, and pins:
 *
 * - the limits never read as a cluster's agent: not to the agent-row rule,
 *   not to the in-cluster rule, and not to the cluster's readiness (no
 *   in-cluster access, no runner_cluster_mismatch, no
 *   credential_on_agent_runner, no "in-cluster Runner is read-only" gap);
 * - for a credential job on such a Runner, the executor, the chokepoint
 *   and the toolkit give the same answer for every write;
 * - what stays Runner-only, as the Runner README lists it: the write switch
 *   for a write that is not a node operation, ONEUPTIME_RUNNER_POD_NAMESPACE,
 *   and every limit of a Runner that reports none.
 *
 * server-remediation-1, the agent's side: its registration now carries the
 * write scope, so the posture the server stores from it refuses what the
 * heartbeat's posture refuses.
 * ---------------------------------------------------------------------------
 */

import childProcess from "child_process";
import { EventEmitter } from "events";

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
import KubectlExecutor, {
  KubectlExecResult,
} from "../../Services/KubectlExecutor";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import KubernetesPosture from "../../Utils/KubernetesPosture";
import { Service as RunnerJobServiceClass } from "Common/Server/Services/RunnerJobService";
import RemediationCommandToolkit from "Common/Server/Utils/AI/Remediation/RemediationCommandTools";
import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
} from "Common/Server/Services/KubernetesClusterAiAccessService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "Common/Server/Services/RunnerService";
import RunbookCredentialService from "Common/Server/Services/RunbookCredentialService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import {
  KubectlWriteScopeParityCase,
  PARITY_CASES,
} from "Common/Tests/Utils/AiRemediation/KubectlWriteScopeParityCases";
import {
  KubectlCommandTier,
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  isInClusterPostureForCluster,
  isKubernetesAgentRunnerPosture,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
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
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CLUSTER_IDENTIFIER: string = "prod-us";

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
};

// What a Kubernetes credential job carries to the Runner.
const CREDENTIAL: JSONObject = {
  credentialType: "Kubernetes",
  apiServerUrl: "https://k8s.example.com:6443",
  token: "sa-token-abc",
};

/*
 * The gaps that would mean the server read an ordinary Runner as some
 * cluster's in-cluster agent.
 */
const AGENT_ONLY_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
  "runner_cluster_mismatch",
  "credential_on_agent_runner",
  "remediation_write_access_missing",
];

type Answer = "A" | "R";

// An ordinary Runner's kubectl configuration, as its executor reads it.
interface OrdinaryRunnerConfig {
  label: string;
  allowWrites: boolean;
  allowNodeOperations: boolean;
  writeNamespaces: Array<string>;
  podNamespace: string | null;
}

/*
 * Configurations where every limit the executor applies is one the Runner
 * reports: writes on, no pod namespace.
 */
const REPORTED_CONFIGS: Array<OrdinaryRunnerConfig> = [
  {
    label: "unconfigured: cluster-wide, nodes on",
    allowWrites: true,
    allowNodeOperations: true,
    writeNamespaces: [],
    podNamespace: null,
  },
  {
    label: "scoped to prod",
    allowWrites: true,
    allowNodeOperations: true,
    writeNamespaces: ["prod"],
    podNamespace: null,
  },
  {
    label: "scoped to prod, nodes off",
    allowWrites: true,
    allowNodeOperations: false,
    writeNamespaces: ["prod"],
    podNamespace: null,
  },
  {
    label: "cluster-wide, nodes off",
    allowWrites: true,
    allowNodeOperations: false,
    writeNamespaces: [],
    podNamespace: null,
  },
  {
    label: "scoped to web and api",
    allowWrites: true,
    allowNodeOperations: true,
    writeNamespaces: ["web", "api"],
    podNamespace: null,
  },
  // A write with no -n lands in "default" through a credential's kubeconfig.
  {
    label: "scoped to default and prod",
    allowWrites: true,
    allowNodeOperations: true,
    writeNamespaces: ["default", "prod"],
    podNamespace: null,
  },
];

// The shared table's commands, and the finding's own.
const COMMANDS: Array<string> = [
  ...PARITY_CASES.map((entry: KubectlWriteScopeParityCase) => {
    return entry.command;
  }),
  "kubectl scale deployment/web --replicas=3 -n staging",
  "kubectl rollout restart deployment/web -n prod",
  "kubectl delete pod web-abc -n prod",
  "kubectl cordon node-1",
  "kubectl uncordon node-1",
  "kubectl get pods -n staging",
];

let spawnSpy: jest.SpyInstance;

// A kubectl that "runs" and succeeds; the tests count the spawns.
function fakeKubectl(): childProcess.ChildProcess {
  const child: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  } = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });

  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("ok"));
    child.emit("close", 0, null);
  });

  return child as unknown as childProcess.ChildProcess;
}

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

function fakeCluster(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: CLUSTER_IDENTIFIER,
    clusterIdentifier: CLUSTER_IDENTIFIER,
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: CREDENTIAL_ID,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// An ordinary Runner row: a dashboard name, the hostInfo it heartbeated.
function fakeRunner(
  hostInfo: JSONObject,
  overrides: Partial<Record<string, unknown>> = {},
): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "payments-runner",
    lastAlive: OneUptimeDate.getCurrentDate(),
    canRunAiCommands: true,
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    hostInfo,
    ...overrides,
  } as unknown as Runner;
}

// The cluster's readiness, with that Runner bound (and its credential).
async function statusFor(data: {
  hostInfo: JSONObject;
  cluster?: Partial<Record<string, unknown>>;
  runner?: Partial<Record<string, unknown>>;
}): Promise<KubernetesClusterAiAccessStatus> {
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockResolvedValue(fakeRunner(data.hostInfo, data.runner));
  jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
    id: CREDENTIAL_ID,
    _id: CREDENTIAL_ID.toString(),
    name: "prod kubeconfig",
    credentialType: RunbookCredentialType.Kubernetes,
    runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
  } as unknown as RunbookCredential);

  return KubernetesClusterAiAccessService.getStatusForClusterModel({
    cluster: fakeCluster(data.cluster),
    gates: READY_GATES,
  });
}

function gapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map((gap: KubernetesAiAccessGap) => {
    return gap.code;
  });
}

// The Runner's own answer: does its executor start kubectl for this job?
async function runnerAnswer(command: string): Promise<Answer> {
  const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

  spawnSpy.mockClear();

  const result: KubectlExecResult = await KubectlExecutor.execute({
    payload: {
      args: policy.args,
      displayCommand: policy.displayCommand,
      tier: policy.tier,
      clusterIdentifier: CLUSTER_IDENTIFIER,
    },
    credential: CREDENTIAL,
    timeoutInMs: 30000,
    origin: "AiRemediation",
  });

  if (spawnSpy.mock.calls.length > 0) {
    expect(result.success).toBe(true);
    return "A";
  }

  expect(result.success).toBe(false);
  return "R";
}

// The enqueue chokepoint's answer, for a credential job.
function chokepointAnswer(
  command: string,
  posture: KubernetesRunnerPosture | undefined,
): Answer {
  return RunnerJobServiceClass.getRunnerWriteScopeRefusal({
    policy: KubectlPolicy.evaluateCommand(command),
    posture,
    usesCredential: true,
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

beforeEach(() => {
  spawnSpy = jest
    .spyOn(childProcess, "spawn")
    .mockImplementation(fakeKubectl as unknown as typeof childProcess.spawn);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an ordinary Runner's write limits never read as a cluster's agent", () => {
  const SCOPED: OrdinaryRunnerConfig = REPORTED_CONFIGS[2]!;

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
        name: "payments-runner",
        hostInfo,
      }),
    ).toBe(false);
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        { name: "payments-runner", hostInfo },
        CLUSTER_IDENTIFIER,
      ),
    ).toBe(false);
  });

  test("with its credential, the cluster is ready through that credential, and the status carries the limits", async () => {
    configure(SCOPED);

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: await storedHostInfo(),
    });

    expect(status.gaps).toEqual([]);
    expect(status.accessMethod).toBe("credential");
    expect(status.credentialId).toBe(CREDENTIAL_ID.toString());
    expect(status.isRemediationReady).toBe(true);
    expect(status.runner?.posture).toEqual(
      expect.objectContaining({
        inCluster: false,
        allowWrites: true,
        allowNodeOperations: false,
        writeNamespaces: ["prod"],
      }),
    );
    expect(status.runner?.posture?.clusterIdentifier).toBeUndefined();
    expect(status.runner?.posture?.podNamespace).toBeUndefined();

    // What the model is told about this Runner's scope.
    expect(
      RemediationCommandToolkit.describeRunnerNamespaceScope(status),
    ).toContain('writes only in namespaces "prod"');
    expect(RemediationCommandToolkit.getChangeSummaryOptions(status)).toEqual({
      allowNodeOperations: false,
    });
  });

  test("without a credential, it is a Runner outside the cluster that needs one — not the in-cluster Runner of another cluster", async () => {
    configure(SCOPED);
    jest.spyOn(KubernetesPosture, "isInCluster").mockReturnValue(true);

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: await storedHostInfo(),
      cluster: { aiAccessCredentialId: undefined },
    });

    expect(gapCodes(status)).toEqual(["credential_missing"]);
    expect(status.gaps[0]?.description).toContain("runs outside the cluster");
    expect(status.accessMethod).toBe("none");
  });

  test("with writes off, it is not the read-only in-cluster Runner", async () => {
    configure({ ...SCOPED, allowWrites: false });

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: await storedHostInfo(),
    });

    expect(status.runner?.posture?.allowWrites).toBe(false);
    for (const code of AGENT_ONLY_GAP_CODES) {
      expect(gapCodes(status)).not.toContain(code);
    }
    expect(status.accessMethod).toBe("credential");
  });

  test("offline, it gets the ordinary Runner's next step, not the agent pod's", async () => {
    configure(SCOPED);

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: await storedHostInfo(),
      runner: { lastAlive: OneUptimeDate.getSomeMinutesAgo(30) },
    });

    expect(gapCodes(status)).toEqual(["runner_offline"]);
    expect(status.gaps[0]?.nextStep).toContain("Start the Runner container");
    expect(status.gaps[0]?.nextStep).not.toContain("component=ai-runner");
  });

  /*
   * Negative control: the checks above can tell. The same Runner row with
   * an agent's posture (in-cluster, naming another cluster) is read as that
   * cluster's in-cluster Runner — which the ordinary Runner never reports.
   */
  test("negative control: an agent's posture on the same row is read as another cluster's in-cluster Runner", async () => {
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
        name: "payments-runner",
        hostInfo: agentHostInfo,
      }),
    ).toBe(true);

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: agentHostInfo,
      cluster: { aiAccessCredentialId: undefined },
    });

    expect(gapCodes(status)).toContain("runner_cluster_mismatch");
  });
});

describe("the server refuses up front exactly what the Runner refuses", () => {
  test.each(
    REPORTED_CONFIGS.map((config: OrdinaryRunnerConfig) => {
      return [config.label, config] as [string, OrdinaryRunnerConfig];
    }),
  )(
    "a Runner %s: executor, chokepoint and toolkit agree on every command",
    async (_label: string, config: OrdinaryRunnerConfig) => {
      configure(config);

      const hostInfo: JSONObject = await storedHostInfo();
      const posture: KubernetesRunnerPosture | undefined =
        parseKubernetesRunnerPosture(hostInfo);
      const status: KubernetesClusterAiAccessStatus = await statusFor({
        hostInfo,
      });

      expect(status.accessMethod).toBe("credential");

      const disagreements: Array<string> = [];
      let refusals: number = 0;

      for (const command of COMMANDS) {
        // A command the policy denies never reaches the scope anywhere.
        if (
          KubectlPolicy.evaluateCommand(command).tier ===
          KubectlCommandTier.Denied
        ) {
          continue;
        }

        const runner: Answer = await runnerAnswer(command);
        const chokepoint: Answer = chokepointAnswer(command, posture);
        const toolkit: Answer = toolkitAnswer(command, status);

        if (runner === "R") {
          refusals++;
        }

        if (chokepoint !== runner || toolkit !== runner) {
          disagreements.push(
            `${command}: Runner ${runner}, chokepoint ${chokepoint}, toolkit ${toolkit}`,
          );
        }
      }

      expect(disagreements).toEqual([]);

      // Not vacuous: a scoped Runner, or one without nodes, refuses some.
      if (config.writeNamespaces.length > 0 || !config.allowNodeOperations) {
        expect(refusals).toBeGreaterThan(0);
      }
    },
  );

  // The finding's scenario, cell by cell.
  test("a Runner scoped to prod with nodes off: a staging write and a cordon are refused before approval, a prod write is not", async () => {
    configure(REPORTED_CONFIGS[2]!);

    const hostInfo: JSONObject = await storedHostInfo();
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(hostInfo);
    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo,
    });

    const staging: string =
      "kubectl scale deployment/web --replicas=3 -n staging";
    const cordon: string = "kubectl cordon node-1";
    const prod: string = "kubectl rollout restart deployment/web -n prod";

    expect(await runnerAnswer(staging)).toBe("R");
    expect(chokepointAnswer(staging, posture)).toBe("R");
    expect(toolkitAnswer(staging, status)).toBe("R");

    expect(await runnerAnswer(cordon)).toBe("R");
    expect(chokepointAnswer(cordon, posture)).toBe("R");
    expect(toolkitAnswer(cordon, status)).toBe("R");

    expect(await runnerAnswer(prod)).toBe("A");
    expect(chokepointAnswer(prod, posture)).toBe("A");
    expect(toolkitAnswer(prod, status)).toBe("A");

    /*
     * The refusal names the scope the Runner reported, so the model and
     * the approver learn why.
     */
    expect(
      RunnerJobServiceClass.getRunnerWriteScopeRefusal({
        policy: KubectlPolicy.evaluateCommand(staging),
        posture,
        usesCredential: true,
      }),
    ).toContain('"prod"');
  });
});

/*
 * What the Runner does not report, and so refuses on its own — each listed
 * in the Runner README — pinned so a change to either side is deliberate.
 */
describe("what stays Runner-only", () => {
  test("the write switch: a write that is not a node operation is refused only by the Runner; a node operation by all three", async () => {
    configure({
      label: "writes off, node switch on",
      allowWrites: false,
      allowNodeOperations: true,
      writeNamespaces: [],
      podNamespace: null,
    });

    const hostInfo: JSONObject = await storedHostInfo();
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(hostInfo);
    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo,
    });

    // Reported: node operations off, because no write runs at all.
    expect(posture?.allowWrites).toBe(false);
    expect(posture?.allowNodeOperations).toBe(false);

    const write: string = "kubectl rollout restart deployment/web -n prod";
    expect(await runnerAnswer(write)).toBe("R");
    expect(chokepointAnswer(write, posture)).toBe("A");
    expect(toolkitAnswer(write, status)).toBe("A");

    const cordon: string = "kubectl cordon node-1";
    expect(await runnerAnswer(cordon)).toBe("R");
    expect(chokepointAnswer(cordon, posture)).toBe("R");
    expect(toolkitAnswer(cordon, status)).toBe("R");
  });

  test("ONEUPTIME_RUNNER_POD_NAMESPACE: never reported, so a write there is refused only by the Runner", async () => {
    configure({
      label: "cluster-wide, a pod namespace set",
      allowWrites: true,
      allowNodeOperations: true,
      writeNamespaces: [],
      podNamespace: "runners",
    });

    const hostInfo: JSONObject = await storedHostInfo();
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(hostInfo);
    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo,
    });

    expect(posture?.podNamespace).toBeUndefined();

    const write: string = "kubectl rollout restart deployment/web -n runners";
    expect(await runnerAnswer(write)).toBe("R");
    expect(chokepointAnswer(write, posture)).toBe("A");
    expect(toolkitAnswer(write, status)).toBe("A");
  });

  /*
   * A Runner on an older image reports no limits (no kubernetes key at
   * all). The server does not second-guess it — which is exactly where the
   * gap was: its executor still refuses.
   */
  test("a Runner that reports no limits is not second-guessed, and refuses alone", async () => {
    configure(REPORTED_CONFIGS[2]!);

    const status: KubernetesClusterAiAccessStatus = await statusFor({
      hostInfo: { hostname: "old-runner" },
    });

    expect(status.runner?.posture).toBeUndefined();
    expect(status.accessMethod).toBe("credential");

    const staging: string =
      "kubectl scale deployment/web --replicas=3 -n staging";
    expect(await runnerAnswer(staging)).toBe("R");
    expect(chokepointAnswer(staging, undefined)).toBe("A");
    expect(toolkitAnswer(staging, status)).toBe("A");
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

    function inClusterAnswer(
      command: string,
      posture: KubernetesRunnerPosture | undefined,
    ): Answer {
      return RunnerJobServiceClass.getRunnerWriteScopeRefusal({
        policy: KubectlPolicy.evaluateCommand(command),
        posture,
        usesCredential: false,
      })
        ? "R"
        : "A";
    }

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
      expect(`${command}: ${inClusterAnswer(command, fromHeartbeat)}`).toBe(
        `${command}: ${answer}`,
      );
      expect(`${command}: ${inClusterAnswer(command, fromRegistration)}`).toBe(
        `${command}: ${answer}`,
      );
    }
  });
});
