import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { JSONObject } from "../../../../Types/JSON";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  KubernetesComplianceAcceptedFinding,
  KubernetesComplianceFinding,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import {
  isKubernetesAcceptanceInForce,
  isKubernetesComplianceObjectKind,
  isKubernetesObjectName,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceAcceptance,
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceRequirementResult,
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
 * ONE OBJECT'S FINDING, ACCEPTED (#9874).
 *
 * A CNI DaemonSet runs privileged on the host's network on purpose, beside
 * workloads in kube-system that should still be scored. Turning the control
 * off for kube-system hid the next workload that broke it there; accepting
 * the DaemonSet's finding lists it under the control as accepted and counts
 * it as passing, and nothing else.
 */

const BASELINE: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssBaseline;
const RESTRICTED: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssRestricted;
const CIS: KubernetesComplianceFramework =
  KubernetesComplianceFramework.CisKubernetes;

const PRIVILEGED_SPEC: JSONObject = {
  hostNetwork: true,
  containers: [{ name: "agent", securityContext: { privileged: true } }],
};

const HOST_PATH_SPEC: JSONObject = {
  containers: [{ name: "exporter" }],
  volumes: [{ name: "proc", hostPath: { path: "/proc" } }],
};

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

function pod(
  namespace: string,
  name: string,
  workload: { kind: string; name: string },
  spec: JSONObject,
): KubernetesCompliancePod {
  return {
    namespace,
    name,
    workload: { kind: workload.kind, namespace, name: workload.name },
    serviceAccountName: "default",
    security: readPodSecurity(spec),
    images: ["ghcr.io/acme/app:1"],
  };
}

const CILIUM: { kind: string; namespace: string; name: string } = {
  kind: "DaemonSet",
  namespace: "kube-system",
  name: "cilium",
};

// A cluster with a CNI agent, a node exporter and a privileged debug pod in kube-system.
function cluster(
  overrides: Partial<KubernetesComplianceSnapshot> = {},
): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 31 },
    provider: null,
    pods: [
      pod(
        "kube-system",
        "cilium-a",
        { kind: "DaemonSet", name: "cilium" },
        PRIVILEGED_SPEC,
      ),
      pod(
        "kube-system",
        "cilium-b",
        { kind: "DaemonSet", name: "cilium" },
        PRIVILEGED_SPEC,
      ),
      pod(
        "kube-system",
        "debug-shell",
        { kind: "Pod", name: "debug-shell" },
        PRIVILEGED_SPEC,
      ),
      pod(
        "monitoring",
        "node-exporter-a",
        { kind: "DaemonSet", name: "node-exporter" },
        HOST_PATH_SPEC,
      ),
      pod(
        "payments",
        "api-a",
        { kind: "Deployment", name: "api" },
        HARDENED_SPEC,
      ),
    ],
    namespaces: [
      { name: "kube-system", labels: {} },
      { name: "monitoring", labels: {} },
      { name: "payments", labels: {} },
    ],
    roles: [],
    bindings: [],
    serviceAccounts: [],
    networkPolicies: [],
    hasPolicyObjects: true,
    ...overrides,
  };
}

function acceptance(
  data: Partial<KubernetesComplianceAcceptance> & {
    object: KubernetesComplianceAcceptance["object"];
  },
): KubernetesComplianceAcceptance {
  return {
    id: "accept-1",
    framework: BASELINE,
    requirement: PodSecurityControl.PrivilegedContainers,
    ...data,
  };
}

function requirementOf(
  result: KubernetesComplianceFrameworkResult,
  requirement: string,
): KubernetesComplianceRequirementResult {
  return result.requirements.find(
    (each: KubernetesComplianceRequirementResult): boolean => {
      return each.requirement === requirement;
    },
  )!;
}

function names(
  findings: Array<KubernetesComplianceFinding> | undefined,
): Array<string> {
  return (findings || []).map(
    (finding: KubernetesComplianceFinding): string => {
      return `${finding.object.kind} ${finding.object.namespace}/${finding.object.name}`;
    },
  );
}

describe("an object's finding accepted for one control", () => {
  test("is listed as accepted, apart from what fails, with the acceptance it is under", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [acceptance({ object: CILIUM })],
      );
    const privileged: KubernetesComplianceRequirementResult = requirementOf(
      result,
      PodSecurityControl.PrivilegedContainers,
    );

    expect(names(privileged.findings)).toEqual(["Pod kube-system/debug-shell"]);
    expect(privileged.failingCount).toBe(1);
    expect(privileged.acceptedCount).toBe(1);
    expect(privileged.accepted).toEqual([
      {
        object: CILIUM,
        details: [
          {
            container: "agent",
            field: "securityContext.privileged",
            value: "true",
          },
        ],
        podCount: 2,
        acceptanceId: "accept-1",
      } as KubernetesComplianceAcceptedFinding,
    ]);
  });

  test("hides nothing else: the next workload to break the control in its namespace still fails it", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [acceptance({ object: CILIUM })],
      );

    // Turning the control off for kube-system would have hidden debug-shell too.
    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers).status,
    ).toBe(ComplianceRequirementStatus.Failing);
    expect(result.failingByNamespace).toEqual({
      "kube-system": 2,
      monitoring: 1,
    });
  });

  test("accepts only that control: the object still fails the others", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [acceptance({ object: CILIUM })],
      );

    expect(
      names(requirementOf(result, PodSecurityControl.HostNamespaces).findings),
    ).toEqual(["DaemonSet kube-system/cilium", "Pod kube-system/debug-shell"]);
    expect(
      requirementOf(result, PodSecurityControl.HostNamespaces).acceptedCount,
    ).toBe(0);
  });

  test("a control whose every failing object is accepted passes", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [
          acceptance({
            id: "accept-exporter",
            requirement: PodSecurityControl.HostPathVolumes,
            object: {
              kind: "DaemonSet",
              namespace: "monitoring",
              name: "node-exporter",
            },
          }),
        ],
      );
    const hostPath: KubernetesComplianceRequirementResult = requirementOf(
      result,
      PodSecurityControl.HostPathVolumes,
    );

    expect(hostPath.status).toBe(ComplianceRequirementStatus.Passing);
    expect(hostPath.failingCount).toBe(0);
    expect(hostPath.findings).toEqual([]);
    expect(names(hostPath.accepted)).toEqual([
      "DaemonSet monitoring/node-exporter",
    ]);
  });
});

describe("the score with accepted findings", () => {
  test("an accepted finding counts as passing: the control passes, and the score rises by its share", () => {
    const snapshot: KubernetesComplianceSnapshot = cluster({
      pods: [
        pod(
          "monitoring",
          "node-exporter-a",
          { kind: "DaemonSet", name: "node-exporter" },
          HOST_PATH_SPEC,
        ),
        pod(
          "payments",
          "api-a",
          { kind: "Deployment", name: "api" },
          HARDENED_SPEC,
        ),
      ],
    });
    const before: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, snapshot, []);
    const after: KubernetesComplianceFrameworkResult = scoreKubernetesFramework(
      BASELINE,
      snapshot,
      [],
      [
        acceptance({
          requirement: PodSecurityControl.HostPathVolumes,
          object: {
            kind: "DaemonSet",
            namespace: "monitoring",
            name: "node-exporter",
          },
        }),
      ],
    );
    const scored: number = before.requirements.filter(
      (each: KubernetesComplianceRequirementResult): boolean => {
        return (
          each.status === ComplianceRequirementStatus.Passing ||
          each.status === ComplianceRequirementStatus.Failing
        );
      },
    ).length;

    // One control of the scored ones failed; accepted, none does.
    expect(before.score).toBe(Math.round(((scored - 1) / scored) * 100));
    expect(after.score).toBe(100);
    expect(after.workloadsPassing).toBe(2);
    expect(before.workloadsPassing).toBe(1);
    expect(after.acceptedCount).toBe(1);
    expect(after.workloadsEvaluated).toBe(before.workloadsEvaluated);
  });

  test("an object that fails another control as well still counts as failing", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [acceptance({ object: CILIUM })],
      );

    // cilium still fails Host Namespaces, so it is not a passing workload.
    expect(result.workloadsEvaluated).toBe(4);
    expect(result.workloadsPassing).toBe(1);
  });
});

describe("an object's finding accepted for the whole framework", () => {
  test("accepts it under every control of the framework, and of no other framework", () => {
    const accepted: Array<KubernetesComplianceAcceptance> = [
      acceptance({ requirement: "", object: CILIUM }),
    ];
    const baseline: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, cluster(), [], accepted);
    const restricted: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(RESTRICTED, cluster(), [], accepted);

    for (const control of [
      PodSecurityControl.PrivilegedContainers,
      PodSecurityControl.HostNamespaces,
    ]) {
      expect(names(requirementOf(baseline, control).accepted)).toEqual([
        "DaemonSet kube-system/cilium",
      ]);
      expect(names(requirementOf(baseline, control).findings)).toEqual([
        "Pod kube-system/debug-shell",
      ]);
    }

    // Accepted for PSS Baseline: Restricted still fails it.
    expect(
      names(
        requirementOf(restricted, PodSecurityControl.PrivilegedContainers)
          .findings,
      ),
    ).toContain("DaemonSet kube-system/cilium");
    expect(restricted.acceptedCount).toBe(0);
    expect(baseline.acceptedCount).toBe(2);
  });

  test("a control's own acceptance is the one a finding is listed under", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [
          acceptance({ id: "whole", requirement: "", object: CILIUM }),
          acceptance({ id: "privileged-only", object: CILIUM }),
        ],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers)
        .accepted![0]!.acceptanceId,
    ).toBe("privileged-only");
    expect(
      requirementOf(result, PodSecurityControl.HostNamespaces).accepted![0]!
        .acceptanceId,
    ).toBe("whole");
  });
});

describe("what an acceptance names", () => {
  test("an object of another kind or namespace, with the same name, is not accepted", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [],
        [
          acceptance({ object: { ...CILIUM, kind: "Deployment" } }),
          acceptance({ object: { ...CILIUM, namespace: "default" } }),
        ],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers)
        .acceptedCount,
    ).toBe(0);
  });

  test("a CIS benchmark binding's finding can be accepted too", () => {
    const snapshot: KubernetesComplianceSnapshot = cluster({
      roles: [
        {
          kind: "ClusterRole",
          namespace: "",
          name: "cluster-admin",
          labels: {},
          spec: {
            rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
          },
        } as never,
      ],
      bindings: [
        {
          kind: "ClusterRoleBinding",
          namespace: "",
          name: "break-glass",
          labels: {},
          spec: {
            roleRef: { kind: "ClusterRole", name: "cluster-admin" },
            subjects: [{ kind: "User", name: "oncall@example.com" }],
          },
        } as never,
      ],
    });
    const before: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(CIS, snapshot, []);
    const after: KubernetesComplianceFrameworkResult = scoreKubernetesFramework(
      CIS,
      snapshot,
      [],
      [
        acceptance({
          framework: CIS,
          requirement: "5.1.1",
          object: {
            kind: "ClusterRoleBinding",
            namespace: "",
            name: "break-glass",
          },
        }),
      ],
    );

    expect(names(requirementOf(before, "5.1.1").findings)).toEqual([
      "ClusterRoleBinding /break-glass",
    ]);
    expect(requirementOf(after, "5.1.1").status).toBe(
      ComplianceRequirementStatus.Passing,
    );
    expect(names(requirementOf(after, "5.1.1").accepted)).toEqual([
      "ClusterRoleBinding /break-glass",
    ]);
  });

  test("a workload read from its pod template keeps saying so once accepted", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          pods: [],
          templates: [
            {
              workload: { kind: "CronJob", namespace: "ops", name: "backup" },
              security: readPodSecurity(PRIVILEGED_SPEC),
            },
          ],
        }),
        [],
        [
          acceptance({
            object: { kind: "CronJob", namespace: "ops", name: "backup" },
          }),
        ],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers)
        .accepted![0]!.isFromTemplate,
    ).toBe(true);
  });

  test("every framework is scored with the same acceptances, each reading its own", () => {
    const results: Array<KubernetesComplianceFrameworkResult> =
      scoreKubernetesFrameworks(
        cluster(),
        [],
        [acceptance({ object: CILIUM })],
      );

    expect(
      results.map((result: KubernetesComplianceFrameworkResult) => {
        return [result.framework, result.acceptedCount];
      }),
    ).toEqual([
      [BASELINE, 1],
      [RESTRICTED, 0],
      [CIS, 0],
    ]);
  });

  test("a control turned off or not evaluated lists nothing accepted", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster(),
        [
          {
            framework: BASELINE,
            requirement: PodSecurityControl.PrivilegedContainers,
            namespace: "",
            isEnabled: false,
          },
        ],
        [acceptance({ object: CILIUM })],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers),
    ).toMatchObject({
      status: ComplianceRequirementStatus.TurnedOff,
      findings: [],
    });
    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers).accepted,
    ).toBeUndefined();
  });
});

describe("the objects a finding names, and an acceptance's expiry", () => {
  test("the kinds a finding names", () => {
    for (const kind of [
      "Deployment",
      "StatefulSet",
      "DaemonSet",
      "ReplicaSet",
      "Job",
      "CronJob",
      "DeploymentConfig",
      "Pod",
      "Role",
      "ClusterRole",
      "RoleBinding",
      "ClusterRoleBinding",
      "ServiceAccount",
      "Namespace",
    ]) {
      expect(isKubernetesComplianceObjectKind(kind)).toBe(true);
    }

    expect(isKubernetesComplianceObjectKind("Secret")).toBe(false);
    expect(isKubernetesComplianceObjectKind("deployment")).toBe(false);
    expect(isKubernetesComplianceObjectKind(undefined)).toBe(false);
  });

  test("a name as Kubernetes allows one, a role's colon included", () => {
    expect(isKubernetesObjectName("cilium")).toBe(true);
    expect(isKubernetesObjectName("system:node-proxier")).toBe(true);
    expect(isKubernetesObjectName("a".repeat(253))).toBe(true);
    expect(isKubernetesObjectName("a".repeat(254))).toBe(false);
    expect(isKubernetesObjectName("")).toBe(false);
    expect(isKubernetesObjectName("kube-system/cilium")).toBe(false);
    expect(isKubernetesObjectName("two words")).toBe(false);
    expect(isKubernetesObjectName("..")).toBe(false);
    expect(isKubernetesObjectName(7)).toBe(false);
  });

  test("an acceptance holds until its expiry, then fails again", () => {
    const now: Date = new Date("2026-11-19T12:00:00.000Z");

    expect(isKubernetesAcceptanceInForce(null, now)).toBe(true);
    expect(isKubernetesAcceptanceInForce(undefined, now)).toBe(true);
    expect(
      isKubernetesAcceptanceInForce(new Date("2026-11-19T12:00:01.000Z"), now),
    ).toBe(true);
    expect(isKubernetesAcceptanceInForce("2026-11-19T12:00:00.000Z", now)).toBe(
      false,
    );
    expect(isKubernetesAcceptanceInForce("2026-01-01T00:00:00.000Z", now)).toBe(
      false,
    );
  });
});
