import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { JSONObject } from "../../../../Types/JSON";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { KubernetesComplianceFinding } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
  scoreKubernetesFramework,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
  KubernetesComplianceTemplate,
  getTemplatesToScore,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import { PodSecurityControl } from "../../../../Types/Kubernetes/Compliance/PodSecurityStandards";
import { describe, expect, test } from "@jest/globals";

/*
 * WORKLOADS THAT RUN NO POD, SCORED FROM THEIR POD TEMPLATES (#9880).
 *
 * A Deployment or StatefulSet scaled to zero, a CronJob between runs, a
 * DaemonSet matching no node: each is scored from its template, and its
 * finding says so. A workload that runs pods is scored from them alone -
 * they are what was admitted, and a rollout or a mutating webhook makes
 * them differ from the template.
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
  volumes: [{ name: "varlog", hostPath: { path: "/var/log" } }],
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

function template(
  kind: string,
  namespace: string,
  name: string,
  spec: JSONObject | null,
): KubernetesComplianceTemplate {
  return {
    workload: { kind, namespace, name },
    security: spec ? readPodSecurity(spec) : null,
  };
}

function cluster(
  overrides: Partial<KubernetesComplianceSnapshot> = {},
): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 31 },
    provider: null,
    pods: [
      pod(
        "payments",
        "api-1",
        { kind: "Deployment", name: "api" },
        HARDENED_SPEC,
      ),
    ],
    templates: [template("Deployment", "payments", "api", HARDENED_SPEC)],
    namespaces: [{ name: "payments", labels: {} }],
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
  return result.requirements.find(
    (each: KubernetesComplianceRequirementResult): boolean => {
      return each.requirement === requirement;
    },
  )!;
}

function failingObjects(
  result: KubernetesComplianceFrameworkResult,
  requirement: string,
): Array<string> {
  return requirementOf(result, requirement).findings.map(
    (finding: KubernetesComplianceFinding): string => {
      return `${finding.object.kind} ${finding.object.namespace}/${finding.object.name}${finding.isFromTemplate ? " (template)" : ""}`;
    },
  );
}

describe("a workload that runs no pod is scored from its pod template", () => {
  test.each([
    ["a Deployment scaled to zero", "Deployment", "log-shipper"],
    ["a StatefulSet scaled to zero", "StatefulSet", "ledger"],
    [
      "a DaemonSet whose node selector matches no node",
      "DaemonSet",
      "gpu-driver",
    ],
    ["a CronJob between runs", "CronJob", "nightly-backup"],
    ["a Job nothing runs", "Job", "migrate"],
    ["a ReplicaSet nothing owns", "ReplicaSet", "legacy-web"],
    [
      "an OpenShift DeploymentConfig scaled to zero",
      "DeploymentConfig",
      "frontend",
    ],
  ])(
    "%s fails what its template fails, said to be from its template",
    (_: string, kind: string, name: string) => {
      const result: KubernetesComplianceFrameworkResult =
        scoreKubernetesFramework(
          BASELINE,
          cluster({
            templates: [
              template("Deployment", "payments", "api", HARDENED_SPEC),
              template(kind, "ops", name, PRIVILEGED_SPEC),
            ],
          }),
          [],
        );
      const privileged: KubernetesComplianceRequirementResult = requirementOf(
        result,
        PodSecurityControl.PrivilegedContainers,
      );

      expect(privileged.status).toBe(ComplianceRequirementStatus.Failing);
      expect(privileged.findings).toEqual([
        {
          object: { kind, namespace: "ops", name },
          details: [
            {
              container: "agent",
              field: "securityContext.privileged",
              value: "true",
            },
          ],
          isFromTemplate: true,
        },
      ]);
      // No pod of it runs, so none is counted.
      expect(privileged.findings[0]!.podCount).toBeUndefined();
      expect(failingObjects(result, PodSecurityControl.HostNamespaces)).toEqual(
        [`${kind} ops/${name} (template)`],
      );
      expect(
        failingObjects(result, PodSecurityControl.HostPathVolumes),
      ).toEqual([`${kind} ops/${name} (template)`]);
      // Evaluated beside the Deployment its pod was read for, and failing.
      expect(result.workloadsEvaluated).toBe(2);
      expect(result.workloadsPassing).toBe(1);
      expect(result.workloadsFromTemplates).toBe(1);
      expect(result.failingByNamespace).toEqual({ ops: 1 });
    },
  );

  test("a privileged CronJob that runs at night fails by day", () => {
    const night: KubernetesComplianceSnapshot = cluster({
      pods: [
        pod(
          "ops",
          "nightly-backup-29000000-x7k2p",
          { kind: "CronJob", name: "nightly-backup" },
          PRIVILEGED_SPEC,
        ),
      ],
      templates: [
        template("CronJob", "ops", "nightly-backup", PRIVILEGED_SPEC),
      ],
    });
    const day: KubernetesComplianceSnapshot = cluster({
      pods: [],
      templates: [
        template("CronJob", "ops", "nightly-backup", PRIVILEGED_SPEC),
      ],
    });

    // At night its run's pod is read, and counted.
    expect(
      requirementOf(
        scoreKubernetesFramework(BASELINE, night, []),
        PodSecurityControl.PrivilegedContainers,
      ).findings[0],
    ).toMatchObject({
      object: { kind: "CronJob", name: "nightly-backup" },
      podCount: 1,
    });
    // By day, its template: the same failure, from the template.
    expect(
      requirementOf(
        scoreKubernetesFramework(BASELINE, day, []),
        PodSecurityControl.PrivilegedContainers,
      ).findings[0],
    ).toMatchObject({
      object: { kind: "CronJob", name: "nightly-backup" },
      isFromTemplate: true,
    });
  });

  test("a CIS pod control reads the template too", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        CIS,
        cluster({
          templates: [
            template("CronJob", "ops", "nightly-backup", PRIVILEGED_SPEC),
          ],
        }),
        [],
      );

    expect(failingObjects(result, "5.2.2")).toEqual([
      "CronJob ops/nightly-backup (template)",
    ]);
    expect(failingObjects(result, "5.2.5")).toEqual([
      "CronJob ops/nightly-backup (template)",
    ]);
  });

  test("a hardened template passes, and counts as a workload evaluated", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        RESTRICTED,
        cluster({
          pods: [],
          templates: [template("Deployment", "payments", "api", HARDENED_SPEC)],
        }),
        [],
      );

    expect(result.score).toBe(100);
    expect(result.workloadsEvaluated).toBe(1);
    expect(result.workloadsPassing).toBe(1);
    expect(result.workloadsFromTemplates).toBe(1);
  });
});

describe("running pods count first", () => {
  test("a workload with pods is scored from them, however its template differs", () => {
    /*
     * Its template asks for privileged containers its pods do not run: a
     * rollout under way, or a mutating webhook that changed them. What runs
     * is what was admitted.
     */
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          pods: [
            pod(
              "payments",
              "api-1",
              { kind: "Deployment", name: "api" },
              HARDENED_SPEC,
            ),
          ],
          templates: [
            template("Deployment", "payments", "api", PRIVILEGED_SPEC),
          ],
        }),
        [],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers).status,
    ).toBe(ComplianceRequirementStatus.Passing);
    expect(result.workloadsFromTemplates).toBe(0);
  });

  test("pods that fail are read as they are, though the template was fixed", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          pods: [
            pod(
              "payments",
              "api-1",
              { kind: "Deployment", name: "api" },
              PRIVILEGED_SPEC,
            ),
            pod(
              "payments",
              "api-2",
              { kind: "Deployment", name: "api" },
              PRIVILEGED_SPEC,
            ),
          ],
          templates: [template("Deployment", "payments", "api", HARDENED_SPEC)],
        }),
        [],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers).findings,
    ).toEqual([
      expect.objectContaining({
        object: { kind: "Deployment", namespace: "payments", name: "api" },
        podCount: 2,
      }),
    ]);
    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers)
        .findings[0]!.isFromTemplate,
    ).toBeUndefined();
  });

  test("a workload whose pods are not read yet waits for them, not for its template", () => {
    const snapshot: KubernetesComplianceSnapshot = cluster({
      pods: [
        pod(
          "payments",
          "api-1",
          { kind: "Deployment", name: "api" },
          HARDENED_SPEC,
        ),
        pod("ops", "agent-1", { kind: "DaemonSet", name: "agent" }, null),
      ],
      templates: [template("DaemonSet", "ops", "agent", PRIVILEGED_SPEC)],
    });

    expect(getTemplatesToScore(snapshot)).toEqual([]);
    expect(scoreKubernetesFramework(BASELINE, snapshot, []).podsNotRead).toBe(
      1,
    );
  });

  test("the templates scored are those no pod belongs to, each once", () => {
    const snapshot: KubernetesComplianceSnapshot = cluster({
      templates: [
        template("Deployment", "payments", "api", HARDENED_SPEC),
        template("CronJob", "ops", "backup", PRIVILEGED_SPEC),
        template("CronJob", "ops", "backup", PRIVILEGED_SPEC),
        // Same name, another kind and another namespace: other workloads.
        template("Deployment", "ops", "backup", PRIVILEGED_SPEC),
        template("Deployment", "staging", "api", PRIVILEGED_SPEC),
      ],
    });

    expect(
      getTemplatesToScore(snapshot).map(
        (each: KubernetesComplianceTemplate): string => {
          return `${each.workload.kind} ${each.workload.namespace}/${each.workload.name}`;
        },
      ),
    ).toEqual([
      "CronJob ops/backup",
      "Deployment ops/backup",
      "Deployment staging/api",
    ]);
  });
});

describe("what is turned off applies to templates as it does to pods", () => {
  test("a namespace turned off for the framework leaves its templates out", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          templates: [
            template("CronJob", "ops", "nightly-backup", PRIVILEGED_SPEC),
          ],
        }),
        [
          {
            framework: BASELINE,
            requirement: "",
            namespace: "ops",
            isEnabled: false,
          },
        ],
      );

    expect(
      failingObjects(result, PodSecurityControl.PrivilegedContainers),
    ).toEqual([]);
    expect(result.workloadsEvaluated).toBe(1);
    expect(result.workloadsFromTemplates).toBe(0);
  });

  test("a control turned off for a namespace leaves its templates out of that control alone", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          templates: [
            template("CronJob", "ops", "nightly-backup", PRIVILEGED_SPEC),
          ],
        }),
        [
          {
            framework: BASELINE,
            requirement: PodSecurityControl.PrivilegedContainers,
            namespace: "ops",
            isEnabled: false,
          },
        ],
      );

    expect(
      failingObjects(result, PodSecurityControl.PrivilegedContainers),
    ).toEqual([]);
    expect(failingObjects(result, PodSecurityControl.HostPathVolumes)).toEqual([
      "CronJob ops/nightly-backup (template)",
    ]);
  });
});

describe("what can be evaluated, with templates", () => {
  test("a cluster running no pod, every workload scaled to zero, is scored from its templates", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          pods: [],
          templates: [
            template("Deployment", "payments", "api", PRIVILEGED_SPEC),
          ],
        }),
        [],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers).status,
    ).toBe(ComplianceRequirementStatus.Failing);
    expect(result.score).not.toBeNull();
  });

  test("5.3.2 still reads the namespaces that run pods: none runs, so it is not evaluated", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        CIS,
        cluster({
          pods: [],
          templates: [
            template("Deployment", "payments", "api", PRIVILEGED_SPEC),
          ],
        }),
        [],
      );

    expect(requirementOf(result, "5.3.2")).toMatchObject({
      status: ComplianceRequirementStatus.NotEvaluated,
      notEvaluatedReason: KubernetesComplianceNotEvaluatedReason.NoPods,
    });
    expect(requirementOf(result, "5.2.2").status).toBe(
      ComplianceRequirementStatus.Failing,
    );
  });

  test("templates stored before they were read wait for the agent's next report", () => {
    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(
        BASELINE,
        cluster({
          pods: [],
          templates: [template("Deployment", "payments", "api", null)],
        }),
        [],
      );

    expect(
      requirementOf(result, PodSecurityControl.PrivilegedContainers),
    ).toMatchObject({
      status: ComplianceRequirementStatus.NotEvaluated,
      notEvaluatedReason: KubernetesComplianceNotEvaluatedReason.PodsNotRead,
    });
    expect(result.workloadsEvaluated).toBe(0);
  });

  test("a snapshot read before templates were kept scores its pods as before", () => {
    const withoutTemplates: KubernetesComplianceSnapshot = cluster();
    delete withoutTemplates.templates;

    const result: KubernetesComplianceFrameworkResult =
      scoreKubernetesFramework(BASELINE, withoutTemplates, []);

    expect(result.score).toBe(100);
    expect(result.workloadsEvaluated).toBe(1);
    expect(result.workloadsFromTemplates).toBe(0);
  });
});
