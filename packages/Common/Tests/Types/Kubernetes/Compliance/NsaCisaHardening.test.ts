import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { JSONObject } from "../../../../Types/JSON";
import {
  KubernetesNodeBenchmarkBlock,
  NodeBenchmarkFamily,
  readNodeBenchmarkMessage,
} from "../../../../Types/Kubernetes/KubernetesNodeBenchmark";
import {
  PodSecurity,
  readPodSecurity,
} from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  KubernetesComplianceControlInfo,
  KubernetesComplianceFramework,
  getKubernetesComplianceControls,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { KubernetesComplianceFinding } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { getNamedNodeBenchmarkChecks } from "../../../../Types/Kubernetes/Compliance/KubernetesNodeBenchmarkCatalog";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
  scoreKubernetesFramework,
  scoreKubernetesFrameworks,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesComplianceNodeBenchmarkRun,
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import {
  KubernetesComplianceFailingControl,
  KubernetesComplianceFrameworkSummary,
  summarizeKubernetesFramework,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import {
  NSA_CISA_CONTROLS,
  NSA_CISA_NOT_SCORED,
  NSA_CISA_NOT_SCORED_REASON_WORDS,
  NSA_CISA_SECTION_WORDS,
  NsaCisaControl,
  NsaCisaNotScored,
  NsaCisaSource,
  getAnonymousBindingFindings,
  getDefaultDenyFindings,
  getMissingLimitDetails,
  getWritableRootFilesystemDetails,
} from "../../../../Types/Kubernetes/Compliance/NsaCisaHardening";
import {
  CONTROL_PLANE_CIS_1_12,
  WORKER_CIS_1_12,
  WORKER_EKS_1_8_0,
  WORKER_GKE_1_9_0,
} from "./KubeBenchFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * THE NSA/CISA KUBERNETES HARDENING GUIDE, AS WHAT ONEUPTIME CAN READ (#9875).
 *
 * Each of the guide's controls is answered from the pods, the RBAC and
 * NetworkPolicies the agent sends, or kube-bench's node checks (#9873); what
 * none answers is listed as not scored, never passed. A control whose source
 * the cluster has not told is not evaluated and counts neither way.
 */

const NSA: KubernetesComplianceFramework =
  KubernetesComplianceFramework.NsaCisaHardening;

// What the guide asks of a pod, all of it.
const HARDENED_SPEC: JSONObject = {
  automountServiceAccountToken: false,
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 10001,
    seccompProfile: { type: "RuntimeDefault" },
  },
  containers: [
    {
      name: "api",
      image: "ghcr.io/acme/api:1",
      securityContext: {
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ["ALL"] },
      },
      resources: { limits: { cpu: "500m", memory: "256Mi" } },
    },
  ],
};

// A node agent: privileged on the host, mounting /var/log, as root.
const PRIVILEGED_SPEC: JSONObject = {
  hostPID: true,
  hostNetwork: true,
  containers: [
    {
      name: "agent",
      securityContext: { privileged: true, runAsUser: 0 },
    },
  ],
  volumes: [{ name: "logs", hostPath: { path: "/var/log" } }],
};

function pod(
  namespace: string,
  name: string,
  workload: { kind: string; name: string },
  spec: JSONObject | null,
): KubernetesCompliancePod {
  return {
    namespace,
    name,
    workload: { kind: workload.kind, namespace, name: workload.name },
    serviceAccountName: "default",
    security: spec ? readPodSecurity(spec) : null,
    images: ["ghcr.io/acme/app:1"],
  };
}

function nodeRun(
  node: string,
  message: string,
): KubernetesComplianceNodeBenchmarkRun {
  const result: KubernetesNodeBenchmarkBlock | null = readNodeBenchmarkMessage(
    message,
    "2026-11-19T22:41:07Z",
  );

  if (!result) {
    throw new Error("The fixture was refused");
  }

  return { node, pod: { namespace: "oneuptime-agent", name: node }, result };
}

const DEFAULT_DENY: Array<
  KubernetesComplianceSnapshot["networkPolicies"][number]
> = [
  {
    namespace: "payments",
    name: "default-deny",
    spec: {
      selectsAllPods: true,
      policyTypes: ["Ingress", "Egress"],
      ingressRuleCount: 0,
      egressRuleCount: 0,
    },
  },
  {
    namespace: "payments",
    name: "allow-web",
    spec: {
      selectsAllPods: false,
      policyTypes: ["Ingress"],
      ingressRuleCount: 1,
      egressRuleCount: 0,
    },
  },
];

function cluster(
  overrides: Partial<KubernetesComplianceSnapshot> = {},
): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 33 },
    provider: null,
    pods: [
      pod(
        "payments",
        "api-1",
        { kind: "Deployment", name: "api" },
        HARDENED_SPEC,
      ),
    ],
    namespaces: [
      {
        name: "payments",
        labels: { "pod-security.kubernetes.io/enforce": "restricted" },
      },
    ],
    roles: [
      {
        kind: "ClusterRole",
        namespace: "",
        name: "view",
        labels: { "kubernetes.io/bootstrapping": "rbac-defaults" },
        spec: { rules: [] },
      },
    ],
    bindings: [],
    serviceAccounts: [
      {
        namespace: "payments",
        name: "default",
        spec: { automountServiceAccountToken: false },
      },
    ],
    networkPolicies: DEFAULT_DENY,
    hasPolicyObjects: true,
    nodeBenchmarks: [
      nodeRun("kind-control-plane", CONTROL_PLANE_CIS_1_12),
      nodeRun("kind-worker", WORKER_CIS_1_12),
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

function statusOf(
  result: KubernetesComplianceFrameworkResult,
  requirement: string,
): [
  ComplianceRequirementStatus,
  KubernetesComplianceNotEvaluatedReason | undefined,
] {
  const row: KubernetesComplianceRequirementResult = requirementOf(
    result,
    requirement,
  );

  return [row.status, row.notEvaluatedReason];
}

describe("the guide's controls, mapped to what OneUptime reads", () => {
  test("each control names the guide's section and the one source that answers it", () => {
    expect(NSA_CISA_CONTROLS).toHaveLength(24);

    for (const control of NSA_CISA_CONTROLS) {
      expect(NSA_CISA_SECTION_WORDS[control.section]).toBeTruthy();
      expect(control.requirement).toBe(
        control.requirement.trim() || "an English title",
      );

      switch (control.source) {
        case NsaCisaSource.Pods:
          expect([control.requirement, Boolean(control.checkPod)]).toEqual([
            control.requirement,
            true,
          ]);
          break;
        case NsaCisaSource.Nodes:
          expect([
            control.requirement,
            (control.nodeChecks?.[NodeBenchmarkFamily.Cis] || []).length > 0,
          ]).toEqual([control.requirement, true]);
          break;
        default:
          expect([control.requirement, Boolean(control.evaluate)]).toEqual([
            control.requirement,
            true,
          ]);
      }
    }
  });

  test("every kube-bench check a control names is one the benchmark scores or marks manual", () => {
    const manualInGeneric: Array<string> = ["1.2.1", "4.2.4"];

    for (const control of NSA_CISA_CONTROLS) {
      for (const [family, checks] of Object.entries(control.nodeChecks || {})) {
        const named: Array<string> = getNamedNodeBenchmarkChecks(
          family as NodeBenchmarkFamily,
        );

        for (const checkId of checks || []) {
          expect([
            control.requirement,
            family,
            checkId,
            named.includes(checkId) || manualInGeneric.includes(checkId),
          ]).toEqual([control.requirement, family, checkId, true]);
        }
      }
    }
  });

  test("the catalog holds them in the guide's order, keyed by their English titles", () => {
    expect(
      getKubernetesComplianceControls(NSA).map(
        (control: KubernetesComplianceControlInfo): string => {
          return control.requirement;
        },
      ),
    ).toEqual(
      NSA_CISA_CONTROLS.map((control: NsaCisaControl): string => {
        return control.requirement;
      }),
    );
  });

  test("what no source answers is listed with why, never passed", () => {
    expect(NSA_CISA_NOT_SCORED.length).toBeGreaterThanOrEqual(10);

    for (const item of NSA_CISA_NOT_SCORED) {
      expect(NSA_CISA_SECTION_WORDS[item.section]).toBeTruthy();
      expect(NSA_CISA_NOT_SCORED_REASON_WORDS[item.reason]).toMatch(/\.$/);
    }

    const titles: Array<string> = NSA_CISA_NOT_SCORED.map(
      (item: NsaCisaNotScored): string => {
        return item.title;
      },
    );

    expect(titles).toContain("Secrets encrypted at rest");
    expect(titles).toContain("Container images scanned for vulnerabilities");
    expect(titles).toContain(
      "LimitRanges and ResourceQuotas in every namespace",
    );
  });
});

describe("the guide's own checks", () => {
  test("immutable container file systems: every container's root file system read only", () => {
    const security: PodSecurity = readPodSecurity({
      initContainers: [{ name: "migrate" }],
      containers: [
        { name: "api", securityContext: { readOnlyRootFilesystem: true } },
        { name: "worker", securityContext: { readOnlyRootFilesystem: false } },
      ],
    });

    // The block lists a pod's containers, then its init containers.
    expect(getWritableRootFilesystemDetails(security)).toEqual([
      {
        container: "worker",
        field: "securityContext.readOnlyRootFilesystem",
        value: "false",
      },
      {
        container: "migrate",
        field: "securityContext.readOnlyRootFilesystem",
        isNotSet: true,
      },
    ]);
    // Windows containers have no such setting.
    expect(
      getWritableRootFilesystemDetails(
        readPodSecurity({
          os: { name: "windows" },
          containers: [{ name: "iis" }],
        }),
      ),
    ).toEqual([]);
  });

  test("resource limits: CPU and memory capped on every container, a LimitRange's defaults included", () => {
    const security: PodSecurity = readPodSecurity({
      containers: [
        { name: "api", resources: { limits: { cpu: "1", memory: "1Gi" } } },
        { name: "cache", resources: { limits: { memory: "512Mi" } } },
        { name: "sidecar", resources: { requests: { cpu: "10m" } } },
      ],
    });

    expect(security.resourcesRead).toBe(true);
    expect(getMissingLimitDetails(security)).toEqual([
      { container: "cache", field: "resources.limits.cpu", isNotSet: true },
      { container: "sidecar", field: "resources.limits.cpu", isNotSet: true },
      {
        container: "sidecar",
        field: "resources.limits.memory",
        isNotSet: true,
      },
    ]);
  });

  test("default-deny NetworkPolicies, both ways, in every namespace that runs pods", () => {
    const snapshot: Pick<
      KubernetesComplianceSnapshot,
      "pods" | "networkPolicies"
    > = {
      pods: [
        pod(
          "payments",
          "api-1",
          { kind: "Deployment", name: "api" },
          HARDENED_SPEC,
        ),
        pod(
          "web",
          "nginx-1",
          { kind: "Deployment", name: "nginx" },
          HARDENED_SPEC,
        ),
        pod(
          "jobs",
          "worker-1",
          { kind: "Deployment", name: "worker" },
          HARDENED_SPEC,
        ),
        pod(
          "batch",
          "etl-1",
          { kind: "Deployment", name: "etl" },
          HARDENED_SPEC,
        ),
      ],
      networkPolicies: [
        ...DEFAULT_DENY,
        // Ingress only: Egress is still open.
        {
          namespace: "web",
          name: "deny-ingress",
          spec: {
            selectsAllPods: true,
            policyTypes: ["Ingress"],
            ingressRuleCount: 0,
            egressRuleCount: 0,
          },
        },
        // Names no types, so Kubernetes reads it as Ingress: it denies traffic in.
        {
          namespace: "jobs",
          name: "deny-all",
          spec: {
            selectsAllPods: true,
            policyTypes: [],
            ingressRuleCount: 0,
            egressRuleCount: 0,
          },
        },
        // Selects every pod but allows traffic in: no default deny.
        {
          namespace: "batch",
          name: "allow-everything",
          spec: {
            selectsAllPods: true,
            policyTypes: ["Ingress", "Egress"],
            ingressRuleCount: 1,
            egressRuleCount: 1,
          },
        },
      ],
    };

    expect(getDefaultDenyFindings(snapshot)).toEqual([
      {
        object: { kind: "Namespace", namespace: "batch", name: "batch" },
        details: [
          {
            field: "NetworkPolicy podSelector: {} policyTypes: [Ingress]",
            isNotSet: true,
          },
          {
            field: "NetworkPolicy podSelector: {} policyTypes: [Egress]",
            isNotSet: true,
          },
        ],
      },
      {
        object: { kind: "Namespace", namespace: "jobs", name: "jobs" },
        details: [
          {
            field: "NetworkPolicy podSelector: {} policyTypes: [Egress]",
            isNotSet: true,
          },
        ],
      },
      {
        object: { kind: "Namespace", namespace: "web", name: "web" },
        details: [
          {
            field: "NetworkPolicy podSelector: {} policyTypes: [Egress]",
            isNotSet: true,
          },
        ],
      },
    ]);
  });

  test("nothing granted to anonymous users, Kubernetes' own discovery bindings aside", () => {
    const findings: Array<KubernetesComplianceFinding> =
      getAnonymousBindingFindings(
        cluster({
          bindings: [
            {
              kind: "ClusterRoleBinding",
              namespace: "",
              name: "public-dashboards",
              labels: {},
              spec: {
                roleRef: {
                  kind: "ClusterRole",
                  name: "view",
                },
                subjects: [{ kind: "Group", name: "system:unauthenticated" }],
              },
            },
            {
              kind: "ClusterRoleBinding",
              namespace: "",
              name: "system:public-info-viewer",
              labels: { "kubernetes.io/bootstrapping": "rbac-defaults" },
              spec: {
                roleRef: {
                  kind: "ClusterRole",
                  name: "system:public-info-viewer",
                },
                subjects: [{ kind: "Group", name: "system:unauthenticated" }],
              },
            },
            {
              kind: "RoleBinding",
              namespace: "payments",
              name: "deployers",
              labels: {},
              spec: {
                roleRef: {
                  kind: "Role",
                  name: "deployer",
                },
                subjects: [{ kind: "User", name: "jane@example.com" }],
              },
            },
          ],
        }),
      );

    expect(findings).toEqual([
      {
        object: {
          kind: "ClusterRoleBinding",
          namespace: "",
          name: "public-dashboards",
        },
        details: [
          { field: "roleRef", value: "ClusterRole view" },
          { field: "subjects", value: "Group system:unauthenticated" },
        ],
      },
    ]);
  });
});

describe("scoring the guide", () => {
  test("a hardened workload, default-deny policies and a kube-bench run: each control answered from its source", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(NSA, cluster(), []);

    expect(result.framework).toBe(NSA);
    expect(result.fullName).toBe("NSA/CISA Kubernetes Hardening Guide v1.2");
    expect(result.requirements).toHaveLength(24);
    for (const requirement of [
      "Non-root containers",
      "Immutable container file systems",
      "No privileged containers",
      "No host namespaces",
      "Resource limits on every container",
      "Default-deny network policies",
      "Pod security enforced",
      "Nothing granted to anonymous users",
      "etcd over TLS, with client certificates",
      "No static token authentication",
      "RBAC and Node authorization",
      "Anonymous requests refused",
    ]) {
      expect([requirement, statusOf(result, requirement)]).toEqual([
        requirement,
        [ComplianceRequirementStatus.Passing, undefined],
      ]);
    }
  });

  test("a node check fails a guide control by the node, said by the CIS control's number", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(NSA, cluster(), []);
    const audit: KubernetesComplianceRequirementResult = requirementOf(
      result,
      "API server audit logging",
    );
    const tls: KubernetesComplianceRequirementResult = requirementOf(
      result,
      "Control plane traffic over TLS",
    );

    expect(audit.status).toBe(ComplianceRequirementStatus.Failing);
    expect(audit.findings).toEqual([
      {
        object: { kind: "Node", namespace: "", name: "kind-control-plane" },
        details: [
          { field: "CIS 1.2.16" },
          { field: "CIS 1.2.17" },
          { field: "CIS 1.2.18" },
          { field: "CIS 1.2.19" },
        ],
      },
    ]);
    expect(tls.findings[0]?.details).toEqual([{ field: "CIS 1.2.5" }]);
    expect(
      requirementOf(result, "Kubeconfig and credential files protected").status,
    ).toBe(ComplianceRequirementStatus.Passing);
  });

  test("a privileged node agent fails the pod controls by its workload, once each", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({
          pods: [
            pod(
              "payments",
              "api-1",
              { kind: "Deployment", name: "api" },
              HARDENED_SPEC,
            ),
            pod(
              "kube-system",
              "agent-a",
              { kind: "DaemonSet", name: "agent" },
              PRIVILEGED_SPEC,
            ),
            pod(
              "kube-system",
              "agent-b",
              { kind: "DaemonSet", name: "agent" },
              PRIVILEGED_SPEC,
            ),
          ],
        }),
        [],
      );

    for (const requirement of [
      "Non-root containers",
      "No privileged containers",
      "No host namespaces",
      "No HostPath volumes",
      "Immutable container file systems",
      "Resource limits on every container",
    ]) {
      const row: KubernetesComplianceRequirementResult = requirementOf(
        result,
        requirement,
      );

      expect([
        requirement,
        row.status,
        row.failingCount,
        row.findings[0]?.podCount,
      ]).toEqual([requirement, ComplianceRequirementStatus.Failing, 1, 2]);
    }
    expect(result.workloadsEvaluated).toBe(2);
    expect(result.workloadsPassing).toBe(1);
  });

  test("its score is the share of the evaluated controls that pass", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(NSA, cluster(), []);
    const evaluated: Array<KubernetesComplianceRequirementResult> =
      result.requirements.filter(
        (row: KubernetesComplianceRequirementResult) => {
          return (
            row.status === ComplianceRequirementStatus.Passing ||
            row.status === ComplianceRequirementStatus.Failing
          );
        },
      );
    const passing: number = evaluated.filter(
      (row: KubernetesComplianceRequirementResult): boolean => {
        return row.status === ComplianceRequirementStatus.Passing;
      },
    ).length;

    expect(evaluated.length).toBeGreaterThan(0);
    expect(result.score).toBe(Math.round((passing / evaluated.length) * 100));
  });
});

describe("what the guide cannot be scored on yet, and says so", () => {
  test("without kube-bench, its node controls wait for it, and count neither way", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(NSA, cluster({ nodeBenchmarks: [] }), []);

    for (const requirement of [
      "etcd over TLS, with client certificates",
      "API server audit logging",
      "Anonymous requests refused",
    ]) {
      expect([requirement, statusOf(result, requirement)]).toEqual([
        requirement,
        [
          ComplianceRequirementStatus.NotEvaluated,
          KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotRun,
        ],
      ]);
    }
    // The pod and policy controls are scored all the same.
    expect(statusOf(result, "Default-deny network policies")[0]).toBe(
      ComplianceRequirementStatus.Passing,
    );
  });

  test("on EKS, what only the control plane answers is the provider's, with or without kube-bench", () => {
    for (const nodeBenchmarks of [
      [],
      [nodeRun("ip-10-0-1-5", WORKER_EKS_1_8_0)],
    ]) {
      const result: KubernetesComplianceFrameworkResult =
        scoreKubernetesFramework(
          NSA,
          cluster({ provider: "EKS", nodeBenchmarks }),
          [],
        );

      expect(
        statusOf(result, "etcd over TLS, with client certificates"),
      ).toEqual([
        ComplianceRequirementStatus.NotEvaluated,
        KubernetesComplianceNotEvaluatedReason.ManagedControlPlane,
      ]);
      expect(statusOf(result, "API server audit logging")[1]).toBe(
        KubernetesComplianceNotEvaluatedReason.ManagedControlPlane,
      );
    }
  });

  test("on EKS with kube-bench, the kubelet's controls are scored from EKS's own benchmark", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({
          provider: "EKS",
          nodeBenchmarks: [nodeRun("ip-10-0-1-5", WORKER_EKS_1_8_0)],
        }),
        [],
      );
    const anonymous: KubernetesComplianceRequirementResult = requirementOf(
      result,
      "Anonymous requests refused",
    );

    // EKS 3.2.4: the read-only port is open on kind's kubelet.
    expect(anonymous.status).toBe(ComplianceRequirementStatus.Failing);
    expect(anonymous.findings[0]?.details).toEqual([{ field: "EKS 3.2.4" }]);
    expect(statusOf(result, "RBAC and Node authorization")[0]).toBe(
      ComplianceRequirementStatus.Passing,
    );
  });

  test("on GKE, whose benchmark reads only the kubelet's files, the kubelet's settings are the provider's", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({
          provider: "GKE",
          nodeBenchmarks: [nodeRun("gke-node-1", WORKER_GKE_1_9_0)],
        }),
        [],
      );

    expect(statusOf(result, "Anonymous requests refused")[1]).toBe(
      KubernetesComplianceNotEvaluatedReason.ManagedControlPlane,
    );
    expect(
      statusOf(result, "Kubeconfig and credential files protected")[0],
    ).toBe(ComplianceRequirementStatus.Failing);
  });

  test("a self-managed cluster kube-bench read no control plane node of: its control plane controls wait", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({ nodeBenchmarks: [nodeRun("kind-worker", WORKER_CIS_1_12)] }),
        [],
      );

    expect(statusOf(result, "API server audit logging")).toEqual([
      ComplianceRequirementStatus.NotEvaluated,
      KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotChecked,
    ]);
    // The kubelet's are read on the worker.
    expect(statusOf(result, "Anonymous requests refused")[0]).toBe(
      ComplianceRequirementStatus.Passing,
    );
  });

  test("a control only checks its benchmark marks manual answer waits for a person", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({
          nodeBenchmarks: [
            nodeRun(
              "kind-worker",
              JSON.stringify({
                oneuptimeNodeBenchmark: 1,
                benchmark: "cis-1.12",
                targets: "node",
                pass: "4.2.2",
                fail: "",
                warn: "",
                manual: "4.2.1 4.2.4",
              }),
            ),
          ],
        }),
        [],
      );

    expect(statusOf(result, "Anonymous requests refused")[1]).toBe(
      KubernetesComplianceNotEvaluatedReason.NodeBenchmarkManual,
    );
  });

  test("an agent that sends no RBAC: the RBAC and NetworkPolicy controls wait for it", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({ hasPolicyObjects: false, roles: [] }),
        [],
      );

    for (const requirement of [
      "cluster-admin bound only where needed",
      "No wildcards in roles",
      "Least access to Secrets",
      "Nothing granted to anonymous users",
      "Default-deny network policies",
      "Service account tokens mounted only where needed",
    ]) {
      expect([requirement, statusOf(result, requirement)[1]]).toEqual([
        requirement,
        KubernetesComplianceNotEvaluatedReason.PolicyObjectsNotRead,
      ]);
    }
  });

  test("pods stored before their limits were read are not counted as having none", () => {
    const oldBlock: PodSecurity = readPodSecurity(HARDENED_SPEC);
    delete oldBlock.resourcesRead;
    for (const container of oldBlock.containers) {
      delete container.limits;
    }

    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        NSA,
        cluster({
          pods: [
            {
              ...pod(
                "payments",
                "api-1",
                { kind: "Deployment", name: "api" },
                null,
              ),
              security: oldBlock,
            },
          ],
        }),
        [],
      );

    expect(statusOf(result, "Resource limits on every container")).toEqual([
      ComplianceRequirementStatus.NotEvaluated,
      KubernetesComplianceNotEvaluatedReason.PodsNotRead,
    ]);
    // Every other pod control reads the old block as it always has.
    expect(statusOf(result, "No privileged containers")[0]).toBe(
      ComplianceRequirementStatus.Passing,
    );
  });
});

describe("the guide on the project's page, with no special case", () => {
  test("every cluster is scored against it with the others, and its summary is the others' shape", () => {
    const results: Array<KubernetesComplianceFrameworkResult> =
      scoreKubernetesFrameworks(cluster(), []);
    const guide: KubernetesComplianceFrameworkResult | undefined = results.find(
      (result: KubernetesComplianceFrameworkResult): boolean => {
        return result.framework === NSA;
      },
    );

    expect(guide).toBeTruthy();

    const summary: KubernetesComplianceFrameworkSummary =
      summarizeKubernetesFramework({
        ...guide!,
        turnedOff: [],
        acceptances: [],
      });

    expect(summary.framework).toBe("NSA/CISA Hardening");
    expect(summary.fullName).toBe("NSA/CISA Kubernetes Hardening Guide v1.2");
    expect(summary.controlsEvaluated).toBeGreaterThan(0);
    expect(
      summary.failingControls.map(
        (control: KubernetesComplianceFailingControl): string => {
          return control.requirement;
        },
      ),
    ).toEqual(["Control plane traffic over TLS", "API server audit logging"]);
  });

  test("turning the guide off for the cluster leaves the other frameworks as they were", () => {
    const results: Array<KubernetesComplianceFrameworkResult> =
      scoreKubernetesFrameworks(cluster(), [
        { framework: NSA, requirement: "", namespace: "", isEnabled: false },
      ]);

    expect(
      results.map((result: KubernetesComplianceFrameworkResult) => {
        return [result.framework, result.isTurnedOff];
      }),
    ).toEqual([
      [KubernetesComplianceFramework.PssBaseline, false],
      [KubernetesComplianceFramework.PssRestricted, false],
      [KubernetesComplianceFramework.CisKubernetes, false],
      [NSA, true],
    ]);
  });
});
