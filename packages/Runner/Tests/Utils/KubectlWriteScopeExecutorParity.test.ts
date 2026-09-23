/*
 * ---------------------------------------------------------------------------
 * The cross-caller write-scope table, end to end through the executor.
 *
 * The server's enqueue chokepoint and the remediation toolkit refuse up
 * front what they expect this Runner to refuse, by asking the shared rule
 * (Common KubectlWriteScope.getRefusal) with the posture this Runner
 * reports. That only holds if the executor asks the same rule with the same
 * inputs: its write namespaces, its pod's namespace, its node switch, and
 * whether the job came with a credential. Common's
 * KubectlWriteScopeCallerParity pins the two server callers to the table;
 * this pins KubectlExecutor.execute to it — a refused cell must never reach
 * kubectl, an allowed one must.
 *
 * Each row runs as the Runner it describes: an in-cluster row as the
 * Kubernetes agent's Runner, a credential row as an ordinary Runner (not
 * in agent mode, no ServiceAccount of its own) handed the credential — and
 * the posture each reports on its heartbeat is the one the server callers
 * are asked with.
 * ---------------------------------------------------------------------------
 */

import type { EventEmitter as NodeEventEmitter } from "events";

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: { heartbeat: jest.fn(), disconnect: jest.fn() },
  };
});

jest.mock("../../Services/RegisterRunner", () => {
  return {
    __esModule: true,
    default: { registerRunner: jest.fn(), tryRegisterRunner: jest.fn() },
  };
});

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

jest.mock("Common/Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: { registerHandler: jest.fn() },
    ShutdownPriority: { Workers: 20 },
  };
});

jest.mock("child_process", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  // Every spawn "runs" kubectl successfully; the tests count the spawns.
  const spawn: jest.Mock = jest.fn(() => {
    const child: NodeEventEmitter & {
      stdout: NodeEventEmitter;
      stderr: NodeEventEmitter;
    } = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from("ok"));
      child.emit("close", 0, null);
    });
    return child;
  });

  return { __esModule: true, spawn };
});

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const childProcessMock: { spawn: jest.Mock } = require("child_process");
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import KubectlExecutor, {
  KubectlExecResult,
} from "../../Services/KubectlExecutor";
import { getHostInfo } from "../../Jobs/Heartbeat";
import KubernetesPosture from "../../Utils/KubernetesPosture";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import KubectlWriteScope from "Common/Utils/AiRemediation/KubectlWriteScope";
import { JSONObject } from "Common/Types/JSON";
import {
  KubectlWriteScopeObjectReplacingCase,
  KubectlWriteScopeParityCase,
  KubectlWriteScopeParityRunner,
  KubectlWriteScopePolicyDeniedCase,
  NAME_EACH_NAMESPACE_OBJECT,
  OBJECT_REPLACING_SCOPE_CASES,
  PARITY_CASES,
  PARITY_CLUSTER_IDENTIFIER,
  PARITY_RUNNERS,
  POLICY_DENIED_SCOPE_CASES,
  postureOf,
} from "Common/Tests/Utils/AiRemediation/KubectlWriteScopeParityCases";
import {
  KubectlCommandTier,
  KubernetesRunnerPosture,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";

// Every refusal the executor gives before spawning starts this way.
const REFUSED_BY_THE_RUNNER: RegExp = /^Refused by the Runner: /;
// A refusal by the Runner's own evaluation of the shared policy.
const REFUSED_BY_THE_RUNNER_POLICY: RegExp =
  /^Refused by the Runner's kubectl policy: /;

const CREDENTIAL: JSONObject = {
  credentialType: "Kubernetes",
  apiServerUrl: "https://k8s.example.com:6443",
  token: "sa-token-abc",
};

/*
 * The Runner this row describes, as the executor sees its configuration:
 * the Kubernetes agent's Runner for an in-cluster row, an ordinary Runner
 * (no agent mode, no ServiceAccount of its own) for a credential row.
 */
function configure(runner: KubectlWriteScopeParityRunner): void {
  jest
    .spyOn(KubernetesAgentMode, "isActive")
    .mockReturnValue(!runner.usesCredential);
  jest
    .spyOn(KubernetesPosture, "canUseOwnServiceAccount")
    .mockReturnValue(!runner.usesCredential);
  jest
    .spyOn(KubernetesPosture, "getWriteNamespaces")
    .mockReturnValue([...runner.writeNamespaces]);
  jest
    .spyOn(KubernetesPosture, "getPodNamespace")
    .mockReturnValue(runner.podNamespace);
  jest
    .spyOn(KubernetesPosture, "allowsNodeOperations")
    .mockReturnValue(runner.allowNodeOperations);
  jest
    .spyOn(KubernetesPosture, "getAllowNodeOperationsSetting")
    .mockReturnValue(runner.allowNodeOperations ? "true" : "false");
}

/*
 * The fields of a posture the write scope reads (and, for a Runner that
 * must never look like an agent, its cluster identity), for comparing.
 */
function scopeOf(
  posture: KubernetesRunnerPosture | undefined,
  withIdentity: boolean,
): JSONObject | null {
  if (!posture) {
    return null;
  }

  return {
    inCluster: posture.inCluster ?? null,
    allowWrites: posture.allowWrites ?? null,
    allowNodeOperations: posture.allowNodeOperations ?? null,
    writeNamespaces: posture.writeNamespaces ?? null,
    podNamespace: posture.podNamespace ?? null,
    ...(withIdentity
      ? { clusterIdentifier: posture.clusterIdentifier ?? null }
      : {}),
  };
}

async function run(
  entry: { command: string },
  runner: KubectlWriteScopeParityRunner,
): Promise<KubectlExecResult> {
  const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
    entry.command,
  );

  configure(runner);
  childProcessMock.spawn.mockClear();

  return KubectlExecutor.execute({
    payload: {
      args: policy.args,
      displayCommand: policy.displayCommand,
      tier: policy.tier,
      clusterIdentifier: PARITY_CLUSTER_IDENTIFIER,
    },
    credential: runner.usesCredential ? CREDENTIAL : undefined,
    timeoutInMs: 30000,
    origin: "AiRemediation",
  });
}

describe("KubectlExecutor answers the cross-caller write-scope table", () => {
  beforeEach(() => {
    jest.spyOn(KubernetesPosture, "allowsWrites").mockReturnValue(true);
    jest
      .spyOn(KubectlExecutor, "getOwnClusterIdentifier")
      .mockReturnValue(PARITY_CLUSTER_IDENTIFIER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(
    PARITY_CASES.map((entry: KubectlWriteScopeParityCase) => {
      return [entry.label, entry] as [string, KubectlWriteScopeParityCase];
    }),
  )("%s", async (_label: string, entry: KubectlWriteScopeParityCase) => {
    const disagreements: Array<string> = [];

    for (let index: number = 0; index < PARITY_RUNNERS.length; index++) {
      const runner: KubectlWriteScopeParityRunner = PARITY_RUNNERS[index]!;
      const expected: string = entry.expected.charAt(index);
      const result: KubectlExecResult = await run(entry, runner);
      const spawned: boolean = childProcessMock.spawn.mock.calls.length > 0;
      const answer: string = spawned ? "A" : "R";

      if (answer !== expected) {
        disagreements.push(
          `${runner.label}: expected ${expected}, the executor ${
            spawned ? "spawned kubectl" : `refused: ${result.errorMessage}`
          }`,
        );
        continue;
      }

      // A refusal is the Runner's, before kubectl ever starts.
      if (!spawned) {
        expect(result.success).toBe(false);
        expect(result.errorMessage).toMatch(REFUSED_BY_THE_RUNNER);
      } else {
        expect(result.success).toBe(true);
      }
    }

    expect(disagreements).toEqual([]);
  });

  /*
   * Not rows of the table: a write to Namespace objects it does not name
   * never reaches the scope. The executor evaluates the argv with the
   * shared policy first, which denies it (it could include kube-system's
   * Namespace object), so on every Runner — even one scoped nowhere — it is
   * refused as the policy's, and kubectl never starts.
   */
  test.each(
    POLICY_DENIED_SCOPE_CASES.map(
      (entry: KubectlWriteScopePolicyDeniedCase) => {
        return [entry.label, entry] as [
          string,
          KubectlWriteScopePolicyDeniedCase,
        ];
      },
    ),
  )(
    "%s: the policy refuses it on every Runner, before the scope",
    async (_label: string, entry: KubectlWriteScopePolicyDeniedCase) => {
      const answers: Array<string> = [];

      for (const runner of PARITY_RUNNERS) {
        const result: KubectlExecResult = await run(entry, runner);
        const spawned: boolean = childProcessMock.spawn.mock.calls.length > 0;
        const message: string = result.errorMessage || "";
        const refusedByPolicy: boolean =
          !result.success &&
          REFUSED_BY_THE_RUNNER_POLICY.test(message) &&
          message.includes(NAME_EACH_NAMESPACE_OBJECT);

        answers.push(
          `${runner.label}: ${
            spawned
              ? "spawned kubectl"
              : refusedByPolicy
                ? "refused by the policy"
                : `refused otherwise: ${message}`
          }`,
        );
      }

      expect(answers).toEqual(
        PARITY_RUNNERS.map((runner: KubectlWriteScopeParityRunner) => {
          return `${runner.label}: refused by the policy`;
        }),
      );
    },
  );

  /*
   * The executor tiers the argv itself: a payload that calls the same argv
   * a RiskyWrite does not carry it past the policy.
   */
  test("the payload's tier does not carry a denied write past the policy", async () => {
    const entry: KubectlWriteScopePolicyDeniedCase =
      POLICY_DENIED_SCOPE_CASES[0]!;
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
      entry.command,
    );

    expect(policy.tier).toBe(KubectlCommandTier.Denied);

    configure(PARITY_RUNNERS[6]!);
    childProcessMock.spawn.mockClear();

    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: {
        args: policy.args,
        displayCommand: policy.displayCommand,
        tier: KubectlCommandTier.RiskyWrite,
        clusterIdentifier: PARITY_CLUSTER_IDENTIFIER,
      },
      credential: CREDENTIAL,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(REFUSED_BY_THE_RUNNER_POLICY);
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  /*
   * --overrides makes kubectl create whatever object its value describes (a
   * cluster-admin ClusterRoleBinding, a privileged Job) while -n names a
   * listed namespace. Refused on every Runner before kubectl starts — by the
   * Runner's own argv guard (since round four; it runs first), the shared
   * policy, or the write scope on its own when both let the flag through.
   */
  test.each(
    OBJECT_REPLACING_SCOPE_CASES.map(
      (entry: KubectlWriteScopeObjectReplacingCase) => {
        return [entry.label, entry] as [
          string,
          KubectlWriteScopeObjectReplacingCase,
        ];
      },
    ),
  )(
    "%s: never reaches kubectl on any Runner",
    async (_label: string, entry: KubectlWriteScopeObjectReplacingCase) => {
      const answers: Array<string> = [];

      for (const runner of PARITY_RUNNERS) {
        const result: KubectlExecResult = await run(entry, runner);
        const spawned: boolean = childProcessMock.spawn.mock.calls.length > 0;
        const message: string = result.errorMessage || "";
        const refusedByPolicy: boolean =
          REFUSED_BY_THE_RUNNER_POLICY.test(message);
        const refusedByScope: boolean =
          REFUSED_BY_THE_RUNNER.test(message) &&
          message.includes(`"${entry.flag}"`);
        const refusedByGuard: boolean =
          REFUSED_BY_THE_RUNNER.test(message) &&
          message.includes(`the ${entry.flag} flag is not allowed`);

        answers.push(
          `${runner.label}: ${
            spawned
              ? "spawned kubectl"
              : refusedByPolicy || refusedByScope || refusedByGuard
                ? "refused before kubectl"
                : `refused otherwise: ${message}`
          }`,
        );
      }

      expect(answers).toEqual(
        PARITY_RUNNERS.map((runner: KubectlWriteScopeParityRunner) => {
          return `${runner.label}: refused before kubectl`;
        }),
      );
    },
  );

  /*
   * The server callers are asked with postureOf(row): it must be what this
   * Runner reports on its heartbeat, field for field where the scope reads
   * it. The agent's cluster identity comes from its chart's environment,
   * so it is the one field not compared for in-cluster rows. A credential
   * Runner reports its write limits since round 4 (an older one reported
   * nothing, which the server callers leave to the Runner).
   */
  test("the posture each Runner reports on its heartbeat is the one the server callers are asked with", async () => {
    jest
      .spyOn(KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.36.4");

    for (const runner of PARITY_RUNNERS) {
      configure(runner);

      const reported: KubernetesRunnerPosture | undefined =
        parseKubernetesRunnerPosture(await getHostInfo());
      const expected: JSONObject | null = scopeOf(
        postureOf(runner),
        runner.usesCredential,
      );
      const actual: JSONObject | null = scopeOf(
        reported,
        runner.usesCredential,
      );

      if (runner.usesCredential && actual === null) {
        continue;
      }

      expect({ runner: runner.label, reported: actual }).toEqual({
        runner: runner.label,
        reported: expected,
      });
    }
  });

  /*
   * The executor's message is the shared rule's own reason (or, for the
   * node switch, its host-specific wording of it): the two cannot drift.
   */
  test("a refusal carries the shared rule's reason", async () => {
    const entry: KubectlWriteScopeParityCase = PARITY_CASES.find(
      (candidate: KubectlWriteScopeParityCase) => {
        return (
          candidate.command === "kubectl label namespace staging team=a -n web"
        );
      },
    )!;
    const runner: KubectlWriteScopeParityRunner = PARITY_RUNNERS[1]!;
    const result: KubectlExecResult = await run(entry, runner);

    expect(result.errorMessage).toBe(
      `Refused by the Runner: ${
        KubectlWriteScope.getRefusal({
          command: KubectlPolicy.evaluateCommand(entry.command),
          writeNamespaces: runner.writeNamespaces,
          podNamespace: runner.podNamespace,
          allowNodeOperations: runner.allowNodeOperations,
          usesCredential: runner.usesCredential,
        })?.reason
      }`,
    );
  });
});
