import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { JSONObject } from "../../../../Types/JSON";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  KubernetesComplianceFramework,
  getKubernetesComplianceControls,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
  KubernetesComplianceSetting,
  MAX_FINDINGS_PER_CONTROL,
  scoreKubernetesFramework,
  scoreKubernetesFrameworks,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import { PodSecurityControl } from "../../../../Types/Kubernetes/Compliance/PodSecurityStandards";
import { describe, expect, test } from "@jest/globals";

/*
 * A cluster scored against the Pod Security Standards and the CIS
 * Kubernetes Benchmark (#9627): what fails, by workload; what is turned off
 * for the cluster or for a namespace; what cannot be evaluated yet, and why.
 */

const BASELINE: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssBaseline;
const RESTRICTED: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssRestricted;
const CIS: KubernetesComplianceFramework =
  KubernetesComplianceFramework.CisKubernetes;

const HARDENED_SPEC: JSONObject = {
  securityContext: {
    runAsNonRoot: true,
    seccompProfile: { type: "RuntimeDefault" },
  },
  automountServiceAccountToken: false,
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

const PRIVILEGED_SPEC: JSONObject = {
  hostNetwork: true,
  containers: [{ name: "proxy", securityContext: { privileged: true } }],
  volumes: [{ name: "modules", hostPath: { path: "/lib/modules" } }],
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

// A cluster running a hardened API, two kube-proxy pods and an nginx.
function cluster(
  overrides: Partial<KubernetesComplianceSnapshot> = {},
): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 31 },
    provider: null,
    pods: [
      pod(
        "payments",
        "api-7d9f8-abcde",
        { kind: "Deployment", name: "api" },
        HARDENED_SPEC,
      ),
      pod(
        "payments",
        "api-7d9f8-fghij",
        { kind: "Deployment", name: "api" },
        HARDENED_SPEC,
      ),
      pod(
        "kube-system",
        "kube-proxy-x1",
        { kind: "DaemonSet", name: "kube-proxy" },
        PRIVILEGED_SPEC,
      ),
      pod(
        "kube-system",
        "kube-proxy-x2",
        { kind: "DaemonSet", name: "kube-proxy" },
        PRIVILEGED_SPEC,
      ),
      pod(
        "web",
        "nginx",
        { kind: "Pod", name: "nginx" },
        {
          containers: [{ name: "nginx", image: "nginx:1.27" }],
        },
      ),
    ],
    namespaces: [
      {
        name: "payments",
        labels: { "pod-security.kubernetes.io/enforce": "restricted" },
      },
      { name: "kube-system", labels: {} },
      { name: "web", labels: {} },
    ],
    roles: [],
    bindings: [],
    serviceAccounts: [],
    networkPolicies: [],
    hasPolicyObjects: true,
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

function off(
  framework: KubernetesComplianceFramework,
  requirement: string = "",
  namespace: string = "",
): KubernetesComplianceSetting {
  return { framework, requirement, namespace, isEnabled: false };
}

describe("scoring Pod Security Standards: Baseline", () => {
  test("fails a control by the workload that runs the pods, counting its pods once each", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), []);
    const privileged: KubernetesComplianceRequirementResult = requirementOf(
      result,
      PodSecurityControl.PrivilegedContainers,
    );

    expect(privileged.status).toBe(ComplianceRequirementStatus.Failing);
    expect(privileged.failingCount).toBe(1);
    expect(privileged.findings).toEqual([
      {
        object: {
          kind: "DaemonSet",
          namespace: "kube-system",
          name: "kube-proxy",
        },
        details: [
          {
            container: "proxy",
            field: "securityContext.privileged",
            value: "true",
          },
        ],
        podCount: 2,
      },
    ]);
  });

  test("scores the share of controls that pass, and counts workloads that meet the level", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), []);

    // Host Namespaces, Privileged Containers and HostPath Volumes fail; 1.31 has no Host Probes control.
    expect(result.requirements).toHaveLength(11);
    expect(
      result.requirements
        .filter((each: KubernetesComplianceRequirementResult): boolean => {
          return each.status === ComplianceRequirementStatus.Failing;
        })
        .map((each: KubernetesComplianceRequirementResult): string => {
          return each.requirement;
        }),
    ).toEqual([
      PodSecurityControl.HostNamespaces,
      PodSecurityControl.PrivilegedContainers,
      PodSecurityControl.HostPathVolumes,
    ]);
    expect(result.score).toBe(Math.round((8 / 11) * 100));
    expect(result.workloadsEvaluated).toBe(3);
    expect(result.workloadsPassing).toBe(2);
    expect(result.failingByNamespace).toEqual({ "kube-system": 1 });
    expect(result.fullName).toBe("Pod Security Standards: Baseline");
  });

  test("scores against the standard of the cluster's version: 1.34 adds Host Probes / Lifecycle Hooks", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({ version: { major: 1, minor: 34 } }),
        [],
      );

    expect(result.requirements).toHaveLength(12);
    expect(requirementOf(result, PodSecurityControl.HostProbes).status).toBe(
      ComplianceRequirementStatus.Passing,
    );
  });
});

describe("what is turned off", () => {
  test("a control turned off for the cluster reads Turned off and counts neither way", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), [
        off(BASELINE, PodSecurityControl.PrivilegedContainers),
      ]);

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers),
    ).toEqual({
      requirement: PodSecurityControl.PrivilegedContainers,
      title: "Privileged Containers",
      status: ComplianceRequirementStatus.TurnedOff,
      failingCount: 0,
      findings: [],
      turnedOffNamespaces: [],
    });
    expect(result.turnedOffRequirements).toEqual([
      PodSecurityControl.PrivilegedContainers,
    ]);
    expect(result.score).toBe(Math.round((8 / 10) * 100));
  });

  test("a framework turned off for a namespace leaves everything of that namespace out, as Pod Security Admission exempts one", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), [
        off(BASELINE, "", "kube-system"),
      ]);

    expect(result.turnedOffNamespaces).toEqual(["kube-system"]);
    expect(result.score).toBe(100);
    expect(result.workloadsEvaluated).toBe(2);
    expect(result.failingByNamespace).toEqual({});
  });

  test("a control turned off for a namespace leaves that namespace out of it alone", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), [
        off(BASELINE, PodSecurityControl.PrivilegedContainers, "kube-system"),
      ]);

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers),
    ).toMatchObject({
      status: ComplianceRequirementStatus.Passing,
      turnedOffNamespaces: ["kube-system"],
    });
    expect(
      requirementOf(result, PodSecurityControl.HostNamespaces).status,
    ).toBe(ComplianceRequirementStatus.Failing);
  });

  test("a framework turned off for the cluster says so, and another framework is not touched", () => {
    const results: Array<KubernetesComplianceFrameworkResult> =
      scoreKubernetesFrameworks(cluster(), [off(RESTRICTED)]);

    expect(
      results.map((result: KubernetesComplianceFrameworkResult) => {
        return [result.framework, result.isTurnedOff];
      }),
    ).toEqual([
      [BASELINE, false],
      [RESTRICTED, true],
      [CIS, false],
    ]);
  });

  test("the last setting for a thing wins: turned off, then on again", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), [
        off(BASELINE, PodSecurityControl.PrivilegedContainers),
        {
          framework: BASELINE,
          requirement: PodSecurityControl.PrivilegedContainers,
          namespace: "",
          isEnabled: true,
        },
      ]);

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers).status,
    ).toBe(ComplianceRequirementStatus.Failing);
    expect(result.turnedOffRequirements).toEqual([]);
  });

  test("a setting of another framework changes nothing here", () => {
    expect(
      scoreKubernetesFramework(BASELINE, cluster(), [off(CIS, "5.2.2")]),
    ).toEqual(scoreKubernetesFramework(BASELINE, cluster(), []));
  });
});

describe("what cannot be evaluated yet", () => {
  test("a cluster whose agent reported no pod: every pod control says so, and there is no score", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster({ pods: [] }), []);

    expect(result.score).toBeNull();
    for (const requirement of result.requirements) {
      expect(requirement.status).toBe(ComplianceRequirementStatus.NotEvaluated);
      expect(requirement.notEvaluatedReason).toBe(
        KubernetesComplianceNotEvaluatedReason.NoPods,
      );
    }
  });

  test("pods stored before their security fields were kept are counted, and read at the next pull", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        RESTRICTED,
        cluster({
          pods: [pod("web", "old", { kind: "Pod", name: "old" }, null)],
        }),
        [],
      );

    expect(result.podsNotRead).toBe(1);
    expect(result.score).toBeNull();
    expect(result.requirements[0]!.notEvaluatedReason).toBe(
      KubernetesComplianceNotEvaluatedReason.PodsNotRead,
    );
  });

  test("a cluster partly read scores the pods that were, and says how many were not", () => {
    const base: KubernetesComplianceSnapshot = cluster();
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          pods: [
            ...base.pods,
            pod("web", "old", { kind: "Pod", name: "old" }, null),
          ],
        }),
        [],
      );

    expect(result.podsNotRead).toBe(1);
    expect(result.workloadsEvaluated).toBe(3);
  });

  test("every namespace that runs pods turned off: nothing is in scope", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), [
        off(BASELINE, "", "payments"),
        off(BASELINE, "", "kube-system"),
        off(BASELINE, "", "web"),
      ]);

    expect(result.score).toBeNull();
    expect(result.requirements[0]!.notEvaluatedReason).toBe(
      KubernetesComplianceNotEvaluatedReason.NoPodsInScope,
    );
  });

  test("an agent that sends no RBAC: the CIS controls that read it are not evaluated, its pod controls are", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster({ hasPolicyObjects: false }), []);

    for (const id of ["5.1.1", "5.1.3", "5.1.5", "5.3.2"]) {
      expect(requirementOf(result, id)).toMatchObject({
        status: ComplianceRequirementStatus.NotEvaluated,
        notEvaluatedReason:
          KubernetesComplianceNotEvaluatedReason.PolicyObjectsNotRead,
      });
    }

    expect(requirementOf(result, "5.2.2").status).toBe(
      ComplianceRequirementStatus.Failing,
    );
    // 5.2.1 reads the namespaces' labels, which every agent sends.
    expect(requirementOf(result, "5.2.1").status).toBe(
      ComplianceRequirementStatus.Failing,
    );
    expect(result.score).not.toBeNull();
  });
});

describe("scoring the CIS Kubernetes Benchmark", () => {
  test("is scored on its 27 policy controls the API answers, in the benchmark's order", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, cluster(), []);

    expect(
      result.requirements.map(
        (each: KubernetesComplianceRequirementResult): string => {
          return each.requirement;
        },
      ),
    ).toEqual(
      getKubernetesComplianceControls(CIS).map(
        (control: { requirement: string }): string => {
          return control.requirement;
        },
      ),
    );
    expect(result.requirements).toHaveLength(27);
  });

  test("a namespace's findings leave with the namespace, and the cluster-wide ones stay", () => {
    const withRbac: KubernetesComplianceSnapshot = cluster({
      roles: [
        {
          kind: "ClusterRole",
          namespace: "",
          name: "ops",
          spec: {
            rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["get"] }],
          },
        },
      ],
      serviceAccounts: [{ namespace: "web", name: "default", spec: {} }],
    });
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, withRbac, [off(CIS, "", "web")]);

    expect(requirementOf(result, "5.1.3").failingCount).toBe(1);
    expect(requirementOf(result, "5.1.5").status).toBe(
      ComplianceRequirementStatus.Passing,
    );
    expect(requirementOf(result, "5.3.2").findings).toEqual([
      {
        object: {
          kind: "Namespace",
          namespace: "kube-system",
          name: "kube-system",
        },
        details: [],
      },
      {
        object: { kind: "Namespace", namespace: "payments", name: "payments" },
        details: [],
      },
    ]);
  });
});

describe("a large cluster", () => {
  test("lists at most MAX_FINDINGS_PER_CONTROL workloads of a control, and counts them all", () => {
    const pods: Array<KubernetesCompliancePod> = [];

    for (
      let index: number = 0;
      index < MAX_FINDINGS_PER_CONTROL + 25;
      index++
    ) {
      pods.push(
        pod(
          "batch",
          `job-${index}`,
          { kind: "Job", name: `job-${index}` },
          PRIVILEGED_SPEC,
        ),
      );
    }

    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster({ pods }), []);
    const privileged: KubernetesComplianceRequirementResult = requirementOf(
      result,
      PodSecurityControl.PrivilegedContainers,
    );

    expect(privileged.failingCount).toBe(MAX_FINDINGS_PER_CONTROL + 25);
    expect(privileged.findings).toHaveLength(MAX_FINDINGS_PER_CONTROL);
    expect(result.failingByNamespace).toEqual({
      batch: MAX_FINDINGS_PER_CONTROL + 25,
    });
  });
});
