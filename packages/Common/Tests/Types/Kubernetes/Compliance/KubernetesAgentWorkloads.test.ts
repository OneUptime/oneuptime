import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { JSONObject } from "../../../../Types/JSON";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  ONEUPTIME_AGENT_COMPONENT_WORDS,
  OneUptimeAgentComponent,
  OneUptimeAgentComponentWords,
  getOneUptimeAgentComponent,
  hasOneUptimeAgentReason,
} from "../../../../Types/Kubernetes/Compliance/KubernetesAgentWorkloads";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  KubernetesComplianceAcceptedFinding,
  KubernetesComplianceFinding,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceRequirementResult,
  scoreKubernetesFramework,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import { PodSecurityControl } from "../../../../Types/Kubernetes/Compliance/PodSecurityStandards";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ONEUPTIME AGENT'S OWN WORKLOADS (#9929).
 *
 * The agent's chart labels everything it makes with its chart, OneUptime and
 * a component of its own. The labels and pod specs here are the ones the
 * chart's default install made on a kind cluster, with kube-bench (#9873)
 * turned on: a finding on one of them says which of the agent's components it
 * is, so the page can say why it needs what the control fails.
 */

function chartLabels(component: string): Record<string, string> {
  return {
    "app.kubernetes.io/instance": "kb-agent",
    "app.kubernetes.io/managed-by": "Helm",
    "app.kubernetes.io/name": "kubernetes-agent",
    "app.kubernetes.io/part-of": "oneuptime",
    "app.kubernetes.io/version": "1.0.0",
    "helm.sh/chart": "kubernetes-agent-0.7.3",
    component,
  };
}

// The pod specs of the agent's default install, as kind ran them.
const NODE_COLLECTOR_SPEC: JSONObject = {
  containers: [{ name: "otel-collector" }],
  volumes: [
    { name: "varlogpods", hostPath: { path: "/var/log/pods" } },
    { name: "host-proc", hostPath: { path: "/proc" } },
    { name: "host-sys", hostPath: { path: "/sys" } },
    { name: "host-root", hostPath: { path: "/" } },
  ],
};

const EBPF_SPEC: JSONObject = {
  hostPID: true,
  containers: [
    {
      name: "ebpf-instrument",
      securityContext: {
        privileged: true,
        readOnlyRootFilesystem: true,
        runAsUser: 0,
      },
    },
  ],
  volumes: [
    { name: "bpffs", hostPath: { path: "/sys/fs/bpf" } },
    { name: "tracing", hostPath: { path: "/sys/kernel/tracing" } },
  ],
};

const KUBE_BENCH_SPEC: JSONObject = {
  hostPID: true,
  automountServiceAccountToken: false,
  securityContext: { seccompProfile: { type: "RuntimeDefault" } },
  containers: [
    {
      name: "kube-bench",
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { add: ["DAC_OVERRIDE"], drop: ["ALL"] },
        privileged: false,
        readOnlyRootFilesystem: true,
        runAsUser: 0,
      },
    },
  ],
  volumes: [
    { name: "etc-kubernetes", hostPath: { path: "/etc/kubernetes" } },
    { name: "var-lib-kubelet", hostPath: { path: "/var/lib/kubelet" } },
  ],
};

const METRICS_COLLECTOR_SPEC: JSONObject = {
  containers: [{ name: "otel-collector" }],
};

describe("telling the agent's own workloads", () => {
  test("each component by its chart's labels and its kind", () => {
    expect(
      [
        ["DaemonSet", "log-collector"],
        ["Deployment", "log-collector"],
        ["DaemonSet", "ebpf-instrument"],
        ["DaemonSet", "profiling"],
        ["CronJob", "node-benchmark"],
        ["Deployment", "metrics-collector"],
        ["Deployment", "ai-agent"],
        ["Deployment", "cost-prometheus"],
      ].map(([kind, component]: Array<string>) => {
        return getOneUptimeAgentComponent({
          kind: kind!,
          labels: chartLabels(component!),
        });
      }),
    ).toEqual([
      OneUptimeAgentComponent.NodeCollector,
      // The API-mode log tailer reads no node file.
      OneUptimeAgentComponent.Other,
      OneUptimeAgentComponent.Ebpf,
      OneUptimeAgentComponent.Profiler,
      OneUptimeAgentComponent.NodeBenchmark,
      OneUptimeAgentComponent.Other,
      OneUptimeAgentComponent.Other,
      OneUptimeAgentComponent.Other,
    ]);
  });

  test("a workload another chart made is not the agent's, whatever it calls its component", () => {
    for (const labels of [
      { component: "log-collector" },
      { ...chartLabels("log-collector"), "helm.sh/chart": "fluent-bit-0.47.0" },
      {
        ...chartLabels("ebpf-instrument"),
        "app.kubernetes.io/part-of": "acme",
      },
      {},
    ]) {
      expect(
        getOneUptimeAgentComponent({ kind: "DaemonSet", labels }),
      ).toBeNull();
    }
    expect(
      getOneUptimeAgentComponent({ kind: "DaemonSet", labels: null }),
    ).toBeNull();
  });

  test("says why of the components that need what a control fails, and of no other", () => {
    expect(
      Object.values(OneUptimeAgentComponent).filter(hasOneUptimeAgentReason),
    ).toEqual([
      OneUptimeAgentComponent.NodeCollector,
      OneUptimeAgentComponent.Ebpf,
      OneUptimeAgentComponent.Profiler,
      OneUptimeAgentComponent.NodeBenchmark,
    ]);
    expect(hasOneUptimeAgentReason(null)).toBe(false);

    for (const words of Object.values(ONEUPTIME_AGENT_COMPONENT_WORDS)) {
      expect(words!.why).toMatch(/^The OneUptime Kubernetes agent's .*\.$/);
      expect(words!.turnOff).toContain("{{setting}}");
      expect(words!.setting).toMatch(/^--set [a-zA-Z.]+=[a-z]+$/);
    }
  });

  test("each says the value that removes it, as the chart reads it", () => {
    expect(
      Object.fromEntries(
        Object.entries(ONEUPTIME_AGENT_COMPONENT_WORDS).map(
          ([component, words]: [
            string,
            OneUptimeAgentComponentWords | undefined,
          ]) => {
            return [
              component,
              [words!.setting, words!.secondSetting].filter(Boolean),
            ];
          },
        ),
      ),
    ).toEqual({
      [OneUptimeAgentComponent.NodeCollector]: [
        "--set logs.mode=api",
        "--set hostMetrics.enabled=false",
      ],
      [OneUptimeAgentComponent.Ebpf]: ["--set ebpf.enabled=false"],
      [OneUptimeAgentComponent.Profiler]: ["--set profiling.enabled=false"],
      [OneUptimeAgentComponent.NodeBenchmark]: [
        "--set compliance.nodeBenchmark.enabled=false",
      ],
    });
  });
});

function agentPod(
  name: string,
  workload: { kind: string; name: string },
  spec: JSONObject,
  agentComponent?: OneUptimeAgentComponent,
): KubernetesCompliancePod {
  return {
    namespace: "oneuptime-agent",
    name,
    workload: { ...workload, namespace: "oneuptime-agent" },
    serviceAccountName: "kb-agent-kubernetes-agent",
    security: readPodSecurity(spec),
    images: ["otel/opentelemetry-collector-contrib:0.165.0"],
    ...(agentComponent ? { agentComponent } : {}),
  };
}

function agentCluster(): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 33 },
    provider: null,
    pods: [
      agentPod(
        "kb-agent-kubernetes-agent-logs-x1",
        { kind: "DaemonSet", name: "kb-agent-kubernetes-agent-logs" },
        NODE_COLLECTOR_SPEC,
        OneUptimeAgentComponent.NodeCollector,
      ),
      agentPod(
        "kb-agent-kubernetes-agent-ebpf-x1",
        { kind: "DaemonSet", name: "kb-agent-kubernetes-agent-ebpf" },
        EBPF_SPEC,
        OneUptimeAgentComponent.Ebpf,
      ),
      agentPod(
        "kb-agent-kubernetes-agent-7d9f8-abcde",
        { kind: "Deployment", name: "kb-agent-kubernetes-agent" },
        METRICS_COLLECTOR_SPEC,
        OneUptimeAgentComponent.Other,
      ),
      // A workload of the cluster's own, beside the agent's.
      {
        ...agentPod(
          "fluent-bit-x1",
          { kind: "DaemonSet", name: "fluent-bit" },
          NODE_COLLECTOR_SPEC,
        ),
        namespace: "logging",
        workload: {
          kind: "DaemonSet",
          namespace: "logging",
          name: "fluent-bit",
        },
      },
    ],
    templates: [
      {
        workload: {
          kind: "CronJob",
          namespace: "oneuptime-agent",
          name: "kb-agent-kubernetes-agent-kube-bench-workers",
        },
        security: readPodSecurity(KUBE_BENCH_SPEC),
        agentComponent: OneUptimeAgentComponent.NodeBenchmark,
      },
    ],
    namespaces: [],
    roles: [],
    bindings: [],
    serviceAccounts: [],
    networkPolicies: [],
    hasPolicyObjects: false,
  };
}

function findingsOf(
  result: KubernetesComplianceFrameworkResult,
  requirement: string,
): Array<KubernetesComplianceFinding> {
  const row: KubernetesComplianceRequirementResult | undefined =
    result.requirements.find(
      (each: KubernetesComplianceRequirementResult): boolean => {
        return each.requirement === requirement;
      },
    );

  return row?.findings || [];
}

function componentsOf(
  findings: Array<KubernetesComplianceFinding>,
): Array<[string, OneUptimeAgentComponent | undefined]> {
  return findings.map(
    (
      finding: KubernetesComplianceFinding,
    ): [string, OneUptimeAgentComponent | undefined] => {
      return [finding.object.name, finding.oneUptimeAgent?.component];
    },
  );
}

describe("a finding on the agent's own workload says whose it is", () => {
  test("Baseline's HostPath Volumes: the node collector and the eBPF instrumentation are the agent's, fluent-bit is not", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        KubernetesComplianceFramework.PssBaseline,
        agentCluster(),
        [],
      );

    expect(
      componentsOf(findingsOf(result, PodSecurityControl.HostPathVolumes)),
    ).toEqual([
      ["fluent-bit", undefined],
      // By namespace, then kind: the CronJob before the DaemonSets.
      [
        "kb-agent-kubernetes-agent-kube-bench-workers",
        OneUptimeAgentComponent.NodeBenchmark,
      ],
      ["kb-agent-kubernetes-agent-ebpf", OneUptimeAgentComponent.Ebpf],
      ["kb-agent-kubernetes-agent-logs", OneUptimeAgentComponent.NodeCollector],
    ]);
    expect(
      componentsOf(findingsOf(result, PodSecurityControl.PrivilegedContainers)),
    ).toEqual([
      ["kb-agent-kubernetes-agent-ebpf", OneUptimeAgentComponent.Ebpf],
    ]);
  });

  test("a workload of the agent's read from its template says so too", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        KubernetesComplianceFramework.PssBaseline,
        agentCluster(),
        [],
      );
    const kubeBench: KubernetesComplianceFinding | undefined = findingsOf(
      result,
      PodSecurityControl.HostNamespaces,
    ).find((finding: KubernetesComplianceFinding): boolean => {
      return finding.object.kind === "CronJob";
    });

    expect(kubeBench?.isFromTemplate).toBe(true);
    expect(kubeBench?.oneUptimeAgent).toEqual({
      nodesProxyReasons: [],
      component: OneUptimeAgentComponent.NodeBenchmark,
    });
  });

  test("the agent's workloads that need nothing say they are its own, with no reason", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        KubernetesComplianceFramework.PssRestricted,
        agentCluster(),
        [],
      );
    const metrics: KubernetesComplianceFinding | undefined = findingsOf(
      result,
      PodSecurityControl.RunningAsNonRoot,
    ).find((finding: KubernetesComplianceFinding): boolean => {
      return finding.object.name === "kb-agent-kubernetes-agent";
    });

    expect(metrics?.oneUptimeAgent?.component).toBe(
      OneUptimeAgentComponent.Other,
    );
    expect(hasOneUptimeAgentReason(metrics?.oneUptimeAgent?.component)).toBe(
      false,
    );
  });

  test("the CIS benchmark's and the NSA/CISA guide's pod controls say so as well", () => {
    for (const [framework, requirement] of [
      [KubernetesComplianceFramework.CisKubernetes, "5.2.2"],
      [
        KubernetesComplianceFramework.NsaCisaHardening,
        "No privileged containers",
      ],
    ] as Array<[KubernetesComplianceFramework, string]>) {
      const result: KubernetesComplianceFrameworkResult =
        scoreKubernetesFramework(framework, agentCluster(), []);

      expect([
        framework,
        componentsOf(findingsOf(result, requirement)),
      ]).toEqual([
        framework,
        [["kb-agent-kubernetes-agent-ebpf", OneUptimeAgentComponent.Ebpf]],
      ]);
    }
  });

  test("accepted for the framework with its reason, the agent's workload passes, and fluent-bit still fails", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        KubernetesComplianceFramework.PssBaseline,
        agentCluster(),
        [],
        [
          {
            id: "agent-node-collector",
            framework: KubernetesComplianceFramework.PssBaseline,
            requirement: "",
            object: {
              kind: "DaemonSet",
              namespace: "oneuptime-agent",
              name: "kb-agent-kubernetes-agent-logs",
            },
          },
        ],
      );
    const hostPath: KubernetesComplianceRequirementResult | undefined =
      result.requirements.find((row: KubernetesComplianceRequirementResult) => {
        return row.requirement === PodSecurityControl.HostPathVolumes;
      });

    expect(hostPath?.status).toBe(ComplianceRequirementStatus.Failing);
    expect(
      hostPath?.findings.map((finding: KubernetesComplianceFinding) => {
        return finding.object.name;
      }),
    ).not.toContain("kb-agent-kubernetes-agent-logs");
    expect(
      hostPath?.accepted?.map(
        (finding: KubernetesComplianceAcceptedFinding) => {
          return [finding.object.name, finding.oneUptimeAgent?.component];
        },
      ),
    ).toEqual([
      ["kb-agent-kubernetes-agent-logs", OneUptimeAgentComponent.NodeCollector],
    ]);
    expect(
      hostPath?.findings.map((finding: KubernetesComplianceFinding) => {
        return finding.object.name;
      }),
    ).toContain("fluent-bit");
  });
});
