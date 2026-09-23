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
 * ---------------------------------------------------------------------------
 */

import type { EventEmitter as NodeEventEmitter } from "events";

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
import KubernetesPosture from "../../Utils/KubernetesPosture";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import KubectlWriteScope from "Common/Utils/AiRemediation/KubectlWriteScope";
import { JSONObject } from "Common/Types/JSON";
import {
  KubectlWriteScopeParityCase,
  KubectlWriteScopeParityRunner,
  PARITY_CASES,
  PARITY_CLUSTER_IDENTIFIER,
  PARITY_RUNNERS,
} from "Common/Tests/Utils/AiRemediation/KubectlWriteScopeParityCases";

// Every refusal the executor gives before spawning starts this way.
const REFUSED_BY_THE_RUNNER: RegExp = /^Refused by the Runner: /;

const CREDENTIAL: JSONObject = {
  credentialType: "Kubernetes",
  apiServerUrl: "https://k8s.example.com:6443",
  token: "sa-token-abc",
};

// The Runner this row describes, as the executor sees its configuration.
function configure(runner: KubectlWriteScopeParityRunner): void {
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

async function run(
  entry: KubectlWriteScopeParityCase,
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
    jest
      .spyOn(KubernetesPosture, "canUseOwnServiceAccount")
      .mockReturnValue(true);
    jest.spyOn(KubernetesPosture, "allowsWrites").mockReturnValue(true);
    jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
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
