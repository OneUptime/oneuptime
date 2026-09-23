/*
 * ---------------------------------------------------------------------------
 * One write-scope rule, three callers, one answer.
 *
 * The finding this pins (PR #3953 review, round 3): "would the bound Runner
 * refuse this write?" was implemented three times — the Runner's
 * KubectlWriteScope (authoritative), the enqueue chokepoint
 * (RunnerJobService.getRunnerWriteScopeRefusal) and the toolkit's
 * propose/approve pre-check (RemediationCommandToolkit.getRunnerScopeRefusal)
 * — and they disagreed: the server copies let `label namespace staging ...
 * -n web` and `patch pv ... -n web` through on a meaningless -n (the Runner
 * refuses both), the toolkit refused `label namespace web` as a write into
 * the Runner's own namespace (the Runner runs it), the chokepoint let a
 * write with no -n through when the Runner reported no pod namespace (the
 * Runner refuses it), and the toolkit left `label --save-config node n1`
 * to the Runner with node operations off (the Runner refuses it). Each
 * disagreement is an approval that fails on the Runner, or a refusal of
 * something the Runner would have run.
 *
 * Now both server functions build the Runner's inputs from its posture and
 * ask KubectlWriteScope.getRefusal. For every command × Runner in
 * KubectlWriteScopeParityCases, the Runner's own question (asked with the
 * configuration it was started with, the way KubectlExecutor asks it), the
 * chokepoint and the toolkit must give the pinned answer. The Runner's
 * KubectlWriteScopeExecutorParity test runs the same table through the
 * executor itself.
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope, {
  KubectlWriteScopeRefusal,
} from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { Service as RunnerJobServiceClass } from "../../../Server/Services/RunnerJobService";
import RemediationCommandToolkit from "../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KubectlWriteScopeParityCase,
  KubectlWriteScopeParityRunner,
  PARITY_CASES,
  PARITY_CLUSTER_IDENTIFIER,
  PARITY_RUNNERS,
  postureOf,
} from "./KubectlWriteScopeParityCases";
import { describe, expect, test } from "@jest/globals";

type Answer = "A" | "R";

// One answer per Runner: "A" lets the write through, "R" refuses it.
const EXPECTED_ANSWERS: RegExp = /^[AR]+$/;

function answerOf(refusal: unknown): Answer {
  return refusal ? "R" : "A";
}

/*
 * The Runner's own question: the argv it receives, re-evaluated by the
 * shared policy, with the configuration it was started with.
 */
function askRunner(
  policy: KubectlPolicyResult,
  runner: KubectlWriteScopeParityRunner,
): KubectlWriteScopeRefusal | null {
  return KubectlWriteScope.getRefusal({
    command: KubectlPolicy.evaluateArgs(policy.args),
    writeNamespaces: runner.writeNamespaces,
    podNamespace: runner.podNamespace,
    allowNodeOperations: runner.allowNodeOperations,
    usesCredential: runner.usesCredential,
  });
}

// The enqueue chokepoint, with the posture the Runner reported.
function askChokepoint(
  policy: KubectlPolicyResult,
  runner: KubectlWriteScopeParityRunner,
): string | null {
  return RunnerJobServiceClass.getRunnerWriteScopeRefusal({
    policy,
    posture: postureOf(runner),
    usesCredential: runner.usesCredential,
  });
}

// The cluster's readiness status as the toolkit reads it for this Runner.
function statusOf(
  runner: KubectlWriteScopeParityRunner,
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: "33333333-3333-4333-8333-333333333333",
    clusterName: PARITY_CLUSTER_IDENTIFIER,
    clusterIdentifier: PARITY_CLUSTER_IDENTIFIER,
    runner: {
      id: "44444444-4444-4444-8444-444444444444",
      name: `kubernetes-agent/${PARITY_CLUSTER_IDENTIFIER}`,
      isOnline: true,
      canRunAiCommands: true,
      posture: postureOf(runner),
    },
    accessMethod: runner.usesCredential ? "credential" : "in_cluster",
    ...(runner.usesCredential
      ? { credentialId: "55555555-5555-4555-8555-555555555555" }
      : {}),
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

// The toolkit's propose/approve pre-check.
function askToolkit(
  command: string,
  runner: KubectlWriteScopeParityRunner,
): string | null {
  return RemediationCommandToolkit.getRunnerScopeRefusal({
    cluster: statusOf(runner),
    command,
  });
}

describe("the table itself", () => {
  test("every case is a write the policy lets through", () => {
    for (const entry of PARITY_CASES) {
      const tier: KubectlCommandTier = KubectlPolicy.evaluateCommand(
        entry.command,
      ).tier;

      expect({ command: entry.command, tier }).not.toEqual({
        command: entry.command,
        tier: KubectlCommandTier.Denied,
      });
      expect({ command: entry.command, tier }).not.toEqual({
        command: entry.command,
        tier: KubectlCommandTier.Read,
      });
      expect(entry.expected).toMatch(EXPECTED_ANSWERS);
      expect(entry.expected).toHaveLength(PARITY_RUNNERS.length);
    }
  });

  /*
   * A table where a Runner lets everything through (or nothing) could not
   * catch a caller that ignores that Runner's scope.
   */
  test("every Runner both lets writes through and refuses some", () => {
    PARITY_RUNNERS.forEach(
      (runner: KubectlWriteScopeParityRunner, index: number) => {
        const column: string = PARITY_CASES.map(
          (entry: KubectlWriteScopeParityCase) => {
            return entry.expected.charAt(index);
          },
        ).join("");

        expect({ runner: runner.label, allows: column.includes("A") }).toEqual({
          runner: runner.label,
          allows: true,
        });
        expect({
          runner: runner.label,
          refuses: column.includes("R"),
        }).toEqual({ runner: runner.label, refuses: true });
      },
    );
  });
});

describe("the Runner, the enqueue chokepoint and the toolkit give the same answer", () => {
  test.each(
    PARITY_CASES.map((entry: KubectlWriteScopeParityCase) => {
      return [entry.label, entry] as [string, KubectlWriteScopeParityCase];
    }),
  )("%s", (_label: string, entry: KubectlWriteScopeParityCase) => {
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
      entry.command,
    );
    const disagreements: Array<string> = [];

    PARITY_RUNNERS.forEach(
      (runner: KubectlWriteScopeParityRunner, index: number) => {
        const expected: string = entry.expected.charAt(index);
        const answers: { runner: Answer; chokepoint: Answer; toolkit: Answer } =
          {
            runner: answerOf(askRunner(policy, runner)),
            chokepoint: answerOf(askChokepoint(policy, runner)),
            toolkit: answerOf(askToolkit(entry.command, runner)),
          };

        if (
          answers.runner !== expected ||
          answers.chokepoint !== expected ||
          answers.toolkit !== expected
        ) {
          disagreements.push(
            `${runner.label}: expected ${expected}, Runner ${answers.runner}, chokepoint ${answers.chokepoint}, toolkit ${answers.toolkit}`,
          );
        }
      },
    );

    expect(disagreements).toEqual([]);
  });
});

describe("each caller words the same refusal for its own reader", () => {
  test("every refusal the server gives is whole sentences, in the server's voice", () => {
    for (const entry of PARITY_CASES) {
      const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        entry.command,
      );

      for (const runner of PARITY_RUNNERS) {
        const runnerRefusal: KubectlWriteScopeRefusal | null = askRunner(
          policy,
          runner,
        );

        if (!runnerRefusal) {
          continue;
        }

        const chokepoint: string = askChokepoint(policy, runner) || "";
        const toolkit: string = askToolkit(entry.command, runner) || "";

        for (const message of [chokepoint, toolkit]) {
          expect(message.startsWith(" ")).toBe(false);
          // Callers append their own sentence after it.
          expect(message.endsWith(".")).toBe(true);
          // Only the Runner speaks of itself as "this Runner".
          expect(message).not.toContain("this Runner");
          expect(message).toContain(policy.displayCommand);
        }

        expect(chokepoint).toContain("It was not enqueued.");
        // The subject, capitalized when it opens the sentence.
        expect(toolkit.toLowerCase()).toContain(
          `the runner of cluster "${PARITY_CLUSTER_IDENTIFIER}"`,
        );
        expect(runnerRefusal.reason).toContain("this Runner");
      }
    }
  });

  test("a Runner that reported no posture is not second-guessed by either server caller", () => {
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
      "kubectl rollout restart deployment/pay -n payments",
    );
    const status: KubernetesClusterAiAccessStatus = statusOf(
      PARITY_RUNNERS[1]!,
    );

    expect(
      RunnerJobServiceClass.getRunnerWriteScopeRefusal({
        policy,
        posture: undefined,
        usesCredential: false,
      }),
    ).toBeNull();
    expect(
      RemediationCommandToolkit.getRunnerScopeRefusal({
        cluster: {
          ...status,
          runner: { ...status.runner!, posture: undefined },
        },
        command: policy.displayCommand,
      }),
    ).toBeNull();

    // Negative control: the same write with that posture reported.
    expect(askChokepoint(policy, PARITY_RUNNERS[1]!)).not.toBeNull();
  });

  test("an older Runner that never reported its node switch is not second-guessed", () => {
    const runner: KubectlWriteScopeParityRunner = PARITY_RUNNERS[3]!;
    const policy: KubectlPolicyResult =
      KubectlPolicy.evaluateCommand("kubectl cordon n1");

    expect(runner.allowNodeOperations).toBe(false);
    expect(askChokepoint(policy, runner)).not.toBeNull();

    const posture: KubernetesRunnerPosture = {
      ...postureOf(runner),
      allowNodeOperations: undefined,
    };

    expect(
      RunnerJobServiceClass.getRunnerWriteScopeRefusal({
        policy,
        posture,
        usesCredential: false,
      }),
    ).toBeNull();

    const status: KubernetesClusterAiAccessStatus = statusOf(runner);

    expect(
      RemediationCommandToolkit.getRunnerScopeRefusal({
        cluster: { ...status, runner: { ...status.runner!, posture } },
        command: "kubectl cordon n1",
      }),
    ).toBeNull();
  });
});
