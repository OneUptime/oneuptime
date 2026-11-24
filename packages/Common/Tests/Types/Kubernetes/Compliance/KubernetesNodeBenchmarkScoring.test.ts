import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { JSONObject } from "../../../../Types/JSON";
import {
  KubernetesNodeBenchmarkBlock,
  NodeBenchmarkFamily,
  readNodeBenchmarkMessage,
} from "../../../../Types/Kubernetes/KubernetesNodeBenchmark";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import { KubernetesComplianceNodeBenchmark } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  CIS_SCOPE_WITH_NODE_BENCHMARK,
  KUBERNETES_COMPLIANCE_FRAMEWORK_INFO,
  KubernetesComplianceFramework,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { CIS_SCORED_CONTROLS } from "../../../../Types/Kubernetes/Compliance/CisKubernetesBenchmark";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
  scoreKubernetesFramework,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesComplianceNodeBenchmarkRun,
  KubernetesComplianceSnapshot,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import {
  NodeBenchmarkScope,
  getNodeBenchmarkCheckResult,
  getNodeBenchmarkScope,
  summarizeNodeBenchmark,
} from "../../../../Types/Kubernetes/Compliance/KubernetesNodeBenchmarkScoring";
import {
  CONTROL_PLANE_CIS_1_12,
  KUBE_BENCH_COULD_NOT_FINISH,
  WORKER_CIS_1_12,
  WORKER_EKS_1_8_0,
  WORKER_K3S_CIS_1_9,
} from "./KubeBenchFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * THE CIS BENCHMARK'S NODE AND CONTROL PLANE CONTROLS, SCORED (#9873).
 *
 * Each node's newest kube-bench run counts; runs of the newest run's
 * benchmark family are scored together; each check kube-bench scored is a
 * control of the CIS framework, failing by each node that fails it. The
 * runs are the fixtures kube-bench v0.16.0 wrote on a real kind cluster.
 */

const CIS: KubernetesComplianceFramework =
  KubernetesComplianceFramework.CisKubernetes;

function block(
  message: string,
  finishedAt: string,
): KubernetesNodeBenchmarkBlock {
  const read: KubernetesNodeBenchmarkBlock | null = readNodeBenchmarkMessage(
    message,
    finishedAt,
  );

  if (!read) {
    throw new Error("The fixture was refused");
  }

  return read;
}

function run(
  node: string,
  message: string,
  finishedAt: string,
  pod: string = `${node}-kube-bench`,
): KubernetesComplianceNodeBenchmarkRun {
  return {
    node,
    pod: { namespace: "oneuptime-agent", name: pod },
    result: block(message, finishedAt),
  };
}

const HARDENED_SPEC: JSONObject = {
  securityContext: {
    runAsNonRoot: true,
    seccompProfile: { type: "RuntimeDefault" },
  },
  containers: [
    {
      name: "api",
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
      },
    },
  ],
};

// A kind cluster: a control plane node and a worker, each read by kube-bench.
function cluster(
  overrides: Partial<KubernetesComplianceSnapshot> = {},
): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 33 },
    provider: null,
    pods: [
      {
        namespace: "payments",
        name: "api-1",
        workload: { kind: "Deployment", namespace: "payments", name: "api" },
        serviceAccountName: "api",
        security: readPodSecurity(HARDENED_SPEC),
        images: ["ghcr.io/acme/api:1"],
      },
    ],
    namespaces: [
      {
        name: "payments",
        labels: { "pod-security.kubernetes.io/enforce": "restricted" },
      },
    ],
    roles: [],
    bindings: [],
    serviceAccounts: [],
    networkPolicies: [],
    hasPolicyObjects: false,
    nodeBenchmarks: [
      run("kind-control-plane", CONTROL_PLANE_CIS_1_12, "2026-11-19T22:41:07Z"),
      run("kind-worker", WORKER_CIS_1_12, "2026-11-19T22:41:05Z"),
    ],
    ...overrides,
  };
}

function requirementOf(
  result: KubernetesComplianceFrameworkResult,
  requirement: string,
): KubernetesComplianceRequirementResult {
  const found: KubernetesComplianceRequirementResult | undefined =
    result.requirements.find(
      (each: KubernetesComplianceRequirementResult): boolean => {
        return each.requirement === requirement;
      },
    );

  if (!found) {
    throw new Error(`No requirement ${requirement}`);
  }

  return found;
}

function nodesOf(row: KubernetesComplianceRequirementResult): Array<string> {
  return row.findings.map((finding: { object: { name: string } }): string => {
    return finding.object.name;
  });
}

describe("which runs are scored", () => {
  test("each node's newest, of the newest run's benchmark family", () => {
    const scope: NodeBenchmarkScope | null = getNodeBenchmarkScope([
      run("worker-1", WORKER_CIS_1_12, "2026-11-19T10:00:00Z", "old"),
      run("worker-1", WORKER_CIS_1_12, "2026-11-19T16:00:00Z", "new"),
      run("worker-2", WORKER_CIS_1_12, "2026-11-19T16:00:01Z"),
    ]);

    expect(scope?.family).toBe(NodeBenchmarkFamily.Cis);
    expect(scope?.benchmark).toBe("cis-1.12");
    expect(
      scope?.runs.map((each: KubernetesComplianceNodeBenchmarkRun) => {
        return [each.node, each.pod.name];
      }),
    ).toEqual([
      ["worker-1", "new"],
      ["worker-2", "worker-2-kube-bench"],
    ]);
    expect(scope?.checks).toHaveLength(12);
    expect(scope?.manual).toHaveLength(13);
  });

  test("a cluster moved to its platform's benchmark is scored by that one, and the generic one's old pods fall away", () => {
    const scope: NodeBenchmarkScope | null = getNodeBenchmarkScope([
      run("ip-10-0-1-5", WORKER_CIS_1_12, "2026-11-19T10:00:00Z"),
      run("ip-10-0-1-5", WORKER_EKS_1_8_0, "2026-11-19T16:00:00Z"),
    ]);

    expect(scope?.family).toBe(NodeBenchmarkFamily.Eks);
    expect(scope?.runs).toHaveLength(1);
    expect(scope?.checks).toEqual([
      "3.1.1",
      "3.1.2",
      "3.1.3",
      "3.1.4",
      "3.2.1",
      "3.2.2",
      "3.2.3",
      "3.2.4",
      "3.2.5",
      "3.2.6",
      "3.2.7",
      "3.2.8",
      "3.2.9",
    ]);
  });

  test("a run that failed after a node's results is said, and its results still scored", () => {
    const scope: NodeBenchmarkScope | null = getNodeBenchmarkScope([
      run("worker-1", WORKER_CIS_1_12, "2026-11-19T10:00:00Z"),
      run("worker-1", KUBE_BENCH_COULD_NOT_FINISH, "2026-11-19T16:00:00Z"),
      run("worker-2", KUBE_BENCH_COULD_NOT_FINISH, "2026-11-19T09:00:00Z"),
      run("worker-2", WORKER_CIS_1_12, "2026-11-19T15:00:00Z"),
    ]);

    expect(
      scope?.runs.map((each: KubernetesComplianceNodeBenchmarkRun) => {
        return each.node;
      }),
    ).toEqual(["worker-1", "worker-2"]);
    // worker-2's failure came before its results: nothing to say of it.
    expect(
      scope?.failedRuns.map((each: KubernetesComplianceNodeBenchmarkRun) => {
        return each.node;
      }),
    ).toEqual(["worker-1"]);
  });

  test("runs of a benchmark the page does not score, or on no node, are none", () => {
    expect(getNodeBenchmarkScope([])).toBeNull();
    expect(getNodeBenchmarkScope(undefined)).toBeNull();
    expect(
      getNodeBenchmarkScope([
        run("worker-1", WORKER_K3S_CIS_1_9, "2026-11-19T10:00:00Z"),
        { ...run("", WORKER_CIS_1_12, "2026-11-19T10:00:00Z") },
      ]),
    ).toBeNull();
  });

  test("a check no setting could name is never scored: the API's section 5, or a group's number", () => {
    const scope: NodeBenchmarkScope | null = getNodeBenchmarkScope([
      run(
        "worker-1",
        JSON.stringify({
          oneuptimeNodeBenchmark: 1,
          benchmark: "cis-1.12",
          targets: "node policies",
          pass: "4.1.2 5.1.1",
          fail: "4.1 5.2.2",
          warn: "",
          manual: "4.2.4 5.7.4",
        }),
        "2026-11-19T10:00:00Z",
      ),
    ]);

    expect(scope?.checks).toEqual(["4.1.2"]);
    expect(scope?.manual).toEqual(["4.2.4"]);
  });

  test("only failing runs: their family, nothing scored, and why each failed", () => {
    const scope: NodeBenchmarkScope | null = getNodeBenchmarkScope([
      run("worker-1", KUBE_BENCH_COULD_NOT_FINISH, "2026-11-19T10:00:00Z"),
    ]);

    expect(scope?.family).toBe(NodeBenchmarkFamily.Cis);
    expect(scope?.runs).toEqual([]);
    expect(scope?.checks).toEqual([]);
    expect(scope?.failedRuns).toHaveLength(1);
  });

  test("a check's standing over the nodes", () => {
    const scope: NodeBenchmarkScope = getNodeBenchmarkScope(
      cluster().nodeBenchmarks,
    )!;

    expect(getNodeBenchmarkCheckResult(scope, "4.1.1")).toEqual({
      failing: ["kind-control-plane", "kind-worker"],
      passing: [],
    });
    expect(getNodeBenchmarkCheckResult(scope, "1.2.16")).toEqual({
      failing: ["kind-control-plane"],
      passing: [],
    });
    expect(getNodeBenchmarkCheckResult(scope, "4.2.1")).toEqual({
      failing: [],
      passing: ["kind-control-plane", "kind-worker"],
    });
  });
});

describe("the CIS framework, with what kube-bench read", () => {
  test("adds the node and control plane controls after the API's, in the benchmark's order", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster(), []);
    const requirements: Array<string> = result.requirements.map(
      (row: KubernetesComplianceRequirementResult): string => {
        return row.requirement;
      },
    );

    expect(requirements.slice(0, 27)).toEqual(Object.keys(CIS_SCORED_CONTROLS));
    expect(requirements).toHaveLength(27 + 65);
    expect(requirements.slice(27, 31)).toEqual([
      "1.1.1",
      "1.1.2",
      "1.1.3",
      "1.1.4",
    ]);
    expect(requirements[requirements.length - 1]).toBe("4.3.1");
    // kube-bench marks these manual: never scored.
    expect(requirements).not.toContain("1.2.1");
    expect(requirements).not.toContain("3.2.1");
    expect(result.scope).toBe(CIS_SCOPE_WITH_NODE_BENCHMARK);
  });

  test("a control fails by each node that fails it, by the node's own page", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster(), []);
    const kubeletService: KubernetesComplianceRequirementResult = requirementOf(
      result,
      "4.1.1",
    );
    const auditLog: KubernetesComplianceRequirementResult = requirementOf(
      result,
      "1.2.16",
    );

    expect(kubeletService.status).toBe(ComplianceRequirementStatus.Failing);
    expect(kubeletService.title).toBe(
      "Kubelet service file: permissions 600 or stricter",
    );
    expect(kubeletService.findings).toEqual([
      {
        object: { kind: "Node", namespace: "", name: "kind-control-plane" },
        details: [],
      },
      {
        object: { kind: "Node", namespace: "", name: "kind-worker" },
        details: [],
      },
    ]);
    expect(nodesOf(auditLog)).toEqual(["kind-control-plane"]);
    expect(requirementOf(result, "4.2.1").status).toBe(
      ComplianceRequirementStatus.Passing,
    );
  });

  test("scores the share of every evaluated control that passes, the API's and the nodes'", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster(), []);
    const scored: Array<KubernetesComplianceRequirementResult> =
      result.requirements.filter(
        (row: KubernetesComplianceRequirementResult): boolean => {
          return (
            row.status === ComplianceRequirementStatus.Passing ||
            row.status === ComplianceRequirementStatus.Failing
          );
        },
      );
    const passing: number = scored.filter(
      (row: KubernetesComplianceRequirementResult): boolean => {
        return row.status === ComplianceRequirementStatus.Passing;
      },
    ).length;

    // The RBAC controls are not evaluated here: the agent sent no RBAC.
    expect(requirementOf(result, "5.1.1").notEvaluatedReason).toBe(
      KubernetesComplianceNotEvaluatedReason.PolicyObjectsNotRead,
    );
    // 53 node controls pass and 12 fail on kind.
    expect(
      result.requirements
        .slice(27)
        .filter((row: KubernetesComplianceRequirementResult): boolean => {
          return row.status === ComplianceRequirementStatus.Failing;
        }),
    ).toHaveLength(12);
    expect(result.score).toBe(Math.round((passing / scored.length) * 100));
    // A node is no workload: the workload figures stay the pods'.
    expect(result.workloadsEvaluated).toBe(1);
    expect(result.failingByNamespace).toEqual({});
  });

  test("a node's finding accepted for its control counts as passing, and nothing else", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        CIS,
        cluster(),
        [],
        [
          {
            id: "acceptance-1",
            framework: CIS,
            requirement: "4.1.1",
            object: { kind: "Node", namespace: "", name: "kind-worker" },
          },
        ],
      );
    const row: KubernetesComplianceRequirementResult = requirementOf(
      result,
      "4.1.1",
    );

    expect(nodesOf(row)).toEqual(["kind-control-plane"]);
    expect(row.acceptedCount).toBe(1);
    expect(row.accepted?.[0]?.acceptanceId).toBe("acceptance-1");
    // The same node still fails the controls it is not accepted for.
    expect(nodesOf(requirementOf(result, "4.1.9"))).toEqual([
      "kind-control-plane",
      "kind-worker",
    ]);
  });

  test("a node accepted for the whole framework passes every control it fails", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        CIS,
        cluster(),
        [],
        [
          {
            id: "acceptance-2",
            framework: CIS,
            requirement: "",
            object: { kind: "Node", namespace: "", name: "kind-control-plane" },
          },
        ],
      );

    expect(requirementOf(result, "1.2.16").status).toBe(
      ComplianceRequirementStatus.Passing,
    );
    expect(nodesOf(requirementOf(result, "4.1.1"))).toEqual(["kind-worker"]);
  });

  test("a node control turned off reads Turned off; turning a namespace off never leaves a node out", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster(), [
        {
          framework: CIS,
          requirement: "1.2.16",
          namespace: "",
          isEnabled: false,
        },
        {
          framework: CIS,
          requirement: "",
          namespace: "kube-system",
          isEnabled: false,
        },
      ]);

    expect(requirementOf(result, "1.2.16").status).toBe(
      ComplianceRequirementStatus.TurnedOff,
    );
    expect(nodesOf(requirementOf(result, "4.1.1"))).toHaveLength(2);
  });

  test("a check kube-bench could not check on any node is not evaluated, and says so", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        CIS,
        cluster({
          nodeBenchmarks: [
            run(
              "worker-1",
              JSON.stringify({
                oneuptimeNodeBenchmark: 1,
                benchmark: "cis-1.12",
                targets: "node",
                pass: "4.2.1",
                fail: "",
                warn: "4.2.6",
                manual: "",
              }),
              "2026-11-19T10:00:00Z",
            ),
          ],
        }),
        [],
      );

    expect(requirementOf(result, "4.2.6")).toMatchObject({
      status: ComplianceRequirementStatus.NotEvaluated,
      notEvaluatedReason:
        KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotChecked,
    });
  });

  test("without kube-bench, the framework is the API's alone, as before", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster({ nodeBenchmarks: [] }), []);

    expect(result.requirements).toHaveLength(27);
    expect(result.scope).toBe(KUBERNETES_COMPLIANCE_FRAMEWORK_INFO[CIS].scope);
  });

  test("a managed platform's checks are scored under its own numbers", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        CIS,
        cluster({
          provider: "EKS",
          nodeBenchmarks: [
            run("ip-10-0-1-5", WORKER_EKS_1_8_0, "2026-11-19T10:00:00Z"),
          ],
        }),
        [],
      );

    expect(
      result.requirements
        .slice(27)
        .map((row: KubernetesComplianceRequirementResult) => {
          return [row.requirement, row.status];
        }),
    ).toEqual([
      ["EKS 3.1.1", ComplianceRequirementStatus.Passing],
      ["EKS 3.1.2", ComplianceRequirementStatus.Passing],
      ["EKS 3.1.3", ComplianceRequirementStatus.Passing],
      ["EKS 3.1.4", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.1", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.2", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.3", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.4", ComplianceRequirementStatus.Failing],
      ["EKS 3.2.5", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.6", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.7", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.8", ComplianceRequirementStatus.Passing],
      ["EKS 3.2.9", ComplianceRequirementStatus.Failing],
    ]);
  });

  test("leaves every other framework as it was", () => {
    for (const framework of [
      KubernetesComplianceFramework.PssBaseline,
      KubernetesComplianceFramework.PssRestricted,
    ]) {
      const withRuns: KubernetesComplianceFrameworkResult =
        scoreKubernetesFramework(framework, cluster(), []);
      const without: KubernetesComplianceFrameworkResult =
        scoreKubernetesFramework(
          framework,
          cluster({ nodeBenchmarks: [] }),
          [],
        );

      expect(withRuns).toEqual(without);
    }
  });
});

describe("what the page says of the runs", () => {
  test("each node's newest run, the control plane's said, and the checks marked manual by requirement", () => {
    const summary: KubernetesComplianceNodeBenchmark | null =
      summarizeNodeBenchmark(
        getNodeBenchmarkScope(cluster().nodeBenchmarks),
        null,
      );

    expect(summary?.benchmark).toBe("cis-1.12");
    expect(summary?.family).toBe("cis");
    expect(summary?.nodes).toEqual([
      {
        node: "kind-control-plane",
        benchmark: "cis-1.12",
        targets: ["master", "etcd", "controlplane", "node"],
        finishedAt: "2026-11-19T22:41:07.000Z",
        isControlPlane: true,
        error: null,
      },
      {
        node: "kind-worker",
        benchmark: "cis-1.12",
        targets: ["node"],
        finishedAt: "2026-11-19T22:41:05.000Z",
        isControlPlane: false,
        error: null,
      },
    ]);
    expect(summary?.manual).toHaveLength(32);
    expect(summary?.manual[0]).toBe("1.1.9");
    expect(summary?.suggestedBenchmark).toBeNull();
  });

  test("a node whose newest run failed says why, and keeps what it read before", () => {
    const summary: KubernetesComplianceNodeBenchmark | null =
      summarizeNodeBenchmark(
        getNodeBenchmarkScope([
          run("kind-worker", WORKER_CIS_1_12, "2026-11-19T10:00:00Z"),
          run(
            "kind-worker",
            KUBE_BENCH_COULD_NOT_FINISH,
            "2026-11-19T16:00:00Z",
          ),
        ]),
        null,
      );

    expect(summary?.nodes).toHaveLength(1);
    expect(summary?.nodes[0]?.error).toMatch(/permission denied/);
    expect(summary?.nodes[0]?.targets).toEqual(["node"]);
    expect(summary?.nodes[0]?.finishedAt).toBe("2026-11-19T16:00:00.000Z");
  });

  test("an EKS cluster that ran the generic benchmark is told its own; one that ran EKS's is not", () => {
    expect(
      summarizeNodeBenchmark(
        getNodeBenchmarkScope([
          run("ip-10-0-1-5", WORKER_CIS_1_12, "2026-11-19T10:00:00Z"),
        ]),
        "EKS",
      )?.suggestedBenchmark,
    ).toBe("eks-1.8.0");
    expect(
      summarizeNodeBenchmark(
        getNodeBenchmarkScope([
          run("aks-pool-1", WORKER_CIS_1_12, "2026-11-19T10:00:00Z"),
        ]),
        "AKS",
      )?.suggestedBenchmark,
    ).toBe("aks-1.8");
    expect(
      summarizeNodeBenchmark(
        getNodeBenchmarkScope([
          run("ip-10-0-1-5", WORKER_EKS_1_8_0, "2026-11-19T10:00:00Z"),
        ]),
        "EKS",
      )?.suggestedBenchmark,
    ).toBeNull();
    expect(
      summarizeNodeBenchmark(
        getNodeBenchmarkScope([
          run("kind-worker", WORKER_CIS_1_12, "2026-11-19T10:00:00Z"),
        ]),
        "OpenShift",
      )?.suggestedBenchmark,
    ).toBeNull();
  });

  test("none when kube-bench does not run", () => {
    expect(summarizeNodeBenchmark(null, "EKS")).toBeNull();
  });
});
