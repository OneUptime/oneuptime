import { describe, expect, test } from "@jest/globals";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceTurnedOff,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { CIS_NOT_SCORED } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { KubernetesComplianceFinding } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  BINDING_COUNT,
  NAMESPACE_COUNT,
  NOT_EVALUATED_REASONS,
  ROLE_COUNT,
  SERVICE_ACCOUNT_COUNT,
  WORKLOAD_COUNT,
  findTurnedOff,
  getFailingControlCount,
  getFailingCountTemplate,
  getKubernetesSwitchKey,
  getNamespaceRows,
  getObjectName,
  isSwitchOn,
  sortControlsForPage,
} from "../../FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesComplianceModel";
import {
  describeDetail,
  describeFinding,
  describeKubernetesTurnedOff,
  getKubernetesFrameworkReport,
  getKubernetesFrameworkReportCsv,
} from "../../FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesComplianceExport";

/*
 * A CLUSTER'S HARDENING, AS ITS PAGE AND ITS REPORTS SAY IT (#9627): the
 * order a framework's controls are listed in, where each switch stands -
 * a framework, a control, a namespace - who turned what off, and the CSV
 * and JSON an auditor files, which say what fails each control and how to
 * fix it, and which of the CIS benchmark's controls are not scored here.
 */

const BASELINE: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssBaseline;
const CIS: KubernetesComplianceFramework =
  KubernetesComplianceFramework.CisKubernetes;

const KUBE_PROXY: KubernetesComplianceFinding = {
  object: { kind: "DaemonSet", namespace: "kube-system", name: "kube-proxy" },
  details: [
    {
      container: "kube-proxy",
      field: "securityContext.privileged",
      value: "true",
    },
    { field: "hostNetwork", value: "true" },
  ],
  podCount: 3,
};

function requirement(
  data: Partial<KubernetesComplianceRequirementResult> & {
    requirement: string;
    status: ComplianceRequirementStatus;
  },
): KubernetesComplianceRequirementResult {
  return {
    title: data.requirement,
    failingCount: 0,
    findings: [],
    turnedOffNamespaces: [],
    ...data,
  };
}

function frameworkOf(
  data: Partial<KubernetesComplianceFrameworkResponse> = {},
): KubernetesComplianceFrameworkResponse {
  return {
    framework: BASELINE,
    fullName: "Pod Security Standards: Baseline",
    scope: "Every workload running on the cluster.",
    score: 50,
    isTurnedOff: false,
    turnedOffRequirements: [],
    turnedOffNamespaces: [],
    workloadsEvaluated: 4,
    workloadsPassing: 3,
    podsNotRead: 0,
    failingByNamespace: { "kube-system": 1 },
    requirements: [
      requirement({
        requirement: "HostProcess",
        status: ComplianceRequirementStatus.Passing,
      }),
      requirement({
        requirement: "Privileged Containers",
        status: ComplianceRequirementStatus.Failing,
        failingCount: 1,
        findings: [KUBE_PROXY],
      }),
      requirement({
        requirement: "Host Ports",
        status: ComplianceRequirementStatus.TurnedOff,
      }),
      requirement({
        requirement: "Sysctls",
        status: ComplianceRequirementStatus.NotEvaluated,
        notEvaluatedReason: KubernetesComplianceNotEvaluatedReason.PodsNotRead,
      }),
      requirement({
        requirement: "Host Namespaces",
        status: ComplianceRequirementStatus.Failing,
        failingCount: 1,
        findings: [KUBE_PROXY],
      }),
    ],
    turnedOff: [],
    ...data,
  };
}

function turnedOffOf(
  data: Partial<KubernetesComplianceTurnedOff>,
): KubernetesComplianceTurnedOff {
  return {
    id: "55555555-0000-4000-8000-000000000005",
    framework: BASELINE,
    resource: {
      kind: DataStoreResourceKind.KubernetesCluster,
      id: "44444444-0000-4000-8000-000000000004",
      name: "prod-eu",
    },
    requirement: null,
    namespace: null,
    note: "",
    turnedOffAt: null,
    turnedOffBy: null,
    ...data,
  };
}

describe("the page's controls", () => {
  test("failing first, then not evaluated, passing and turned off, each in the standard's order", () => {
    expect(
      sortControlsForPage(frameworkOf().requirements).map(
        (each: KubernetesComplianceRequirementResult): string => {
          return each.requirement;
        },
      ),
    ).toEqual([
      "Privileged Containers",
      "Host Namespaces",
      "Sysctls",
      "HostProcess",
      "Host Ports",
    ]);
    expect(getFailingControlCount(frameworkOf())).toBe(2);
  });

  test("every reason a control is not evaluated says what to do, in a sentence", () => {
    for (const reason of Object.values(
      KubernetesComplianceNotEvaluatedReason,
    )) {
      expect(NOT_EVALUATED_REASONS[reason]).toMatch(/^[A-Z].*\.$/);
    }
    expect(
      NOT_EVALUATED_REASONS[
        KubernetesComplianceNotEvaluatedReason.PolicyObjectsNotRead
      ],
    ).toContain("resourceSpecs.compliance");
  });

  test("the objects a control fails on are counted by what they are", () => {
    function templateFor(kind: string): unknown {
      return getFailingCountTemplate([
        { object: { kind, namespace: "web", name: "x" }, details: [] },
      ]);
    }

    expect(templateFor("Deployment")).toBe(WORKLOAD_COUNT);
    expect(templateFor("Pod")).toBe(WORKLOAD_COUNT);
    expect(templateFor("Namespace")).toBe(NAMESPACE_COUNT);
    expect(templateFor("ClusterRole")).toBe(ROLE_COUNT);
    expect(templateFor("RoleBinding")).toBe(BINDING_COUNT);
    expect(templateFor("ServiceAccount")).toBe(SERVICE_ACCOUNT_COUNT);
  });

  test("an object is named with its namespace, a cluster-wide one and a namespace by its name", () => {
    expect(getObjectName(KUBE_PROXY)).toBe("kube-system/kube-proxy");
    expect(
      getObjectName({
        object: { kind: "ClusterRoleBinding", namespace: "", name: "ci" },
        details: [],
      }),
    ).toBe("ci");
    expect(
      getObjectName({
        object: { kind: "Namespace", namespace: "web", name: "web" },
        details: [],
      }),
    ).toBe("web");
  });
});

describe("the switches", () => {
  test("one per framework, control and namespace", () => {
    expect(getKubernetesSwitchKey({ framework: BASELINE })).toBe(
      "PSS Baseline||",
    );
    expect(
      getKubernetesSwitchKey({
        framework: BASELINE,
        requirement: " Host Ports ",
        namespace: "kube-system",
      }),
    ).toBe("PSS Baseline|Host Ports|kube-system");
  });

  test("each is on until turned off: the framework, a control, a namespace, a control in a namespace", () => {
    const framework: KubernetesComplianceFrameworkResponse = frameworkOf({
      turnedOffRequirements: ["Host Ports"],
      turnedOffNamespaces: ["kube-system"],
      requirements: [
        requirement({
          requirement: "Sysctls",
          status: ComplianceRequirementStatus.Passing,
          turnedOffNamespaces: ["monitoring"],
        }),
      ],
    });

    expect(isSwitchOn(framework, {})).toBe(true);
    expect(isSwitchOn({ ...framework, isTurnedOff: true }, {})).toBe(false);
    expect(isSwitchOn(framework, { requirement: "Host Ports" })).toBe(false);
    expect(isSwitchOn(framework, { requirement: "Sysctls" })).toBe(true);
    expect(isSwitchOn(framework, { namespace: "kube-system" })).toBe(false);
    expect(isSwitchOn(framework, { namespace: "web" })).toBe(true);
    expect(
      isSwitchOn(framework, {
        requirement: "Sysctls",
        namespace: "monitoring",
      }),
    ).toBe(false);
  });

  test("a switch's who and why is the entry of its control and namespace", () => {
    const framework: KubernetesComplianceFrameworkResponse = frameworkOf({
      turnedOff: [
        turnedOffOf({ id: "a", namespace: "kube-system" }),
        turnedOffOf({ id: "b", requirement: "Host Ports" }),
        turnedOffOf({ id: "c" }),
      ],
    });

    expect(findTurnedOff(framework, { namespace: "kube-system" })?.id).toBe(
      "a",
    );
    expect(findTurnedOff(framework, { requirement: "Host Ports" })?.id).toBe(
      "b",
    );
    expect(findTurnedOff(framework, {})?.id).toBe("c");
    expect(findTurnedOff(framework, { namespace: "web" })).toBeUndefined();
  });

  test("a namespace turned off that runs no pods now is still listed, to turn it on again", () => {
    expect(
      getNamespaceRows(
        {
          namespaces: [
            {
              name: "web",
              podCount: 2,
              enforce: null,
              audit: null,
              warn: null,
            },
          ],
        },
        { turnedOffNamespaces: ["legacy", "web"] },
      ).map((namespace: { name: string }): string => {
        return namespace.name;
      }),
    ).toEqual(["web", "legacy"]);
  });
});

describe("the CSV report", () => {
  test("says each failing field by Kubernetes' name, and the workload's pods", () => {
    expect(describeDetail(KUBE_PROXY.details[0]!)).toBe(
      "kube-proxy: securityContext.privileged=true",
    );
    expect(
      describeDetail({
        container: "api",
        field: "securityContext.runAsNonRoot",
        isNotSet: true,
      }),
    ).toBe("api: securityContext.runAsNonRoot not set");
    expect(describeFinding(KUBE_PROXY)).toBe(
      "DaemonSet kube-system/kube-proxy (3 pods): kube-proxy: securityContext.privileged=true, hostNetwork=true",
    );
  });

  test("lists every control in the standard's order, with its status, why it is not evaluated, what fails it and the fix", () => {
    const csv: string = getKubernetesFrameworkReportCsv(frameworkOf());
    const lines: Array<string> = csv.split("\r\n");

    expect(lines[0]).toBe(
      "Framework,Control,Title,Status,Note,Failing,What Fails,How to Fix,Turned Off",
    );
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain("PSS Baseline,HostProcess,HostProcess,Passing");
    expect(lines[2]).toContain("Privileged Containers");
    expect(lines[2]).toContain(
      '"DaemonSet kube-system/kube-proxy (3 pods): kube-proxy: securityContext.privileged=true, hostNetwork=true"',
    );
    expect(lines[2]).toContain("Remove securityContext.privileged");
    expect(lines[4]).toContain(
      "Scored at the agent's next report of the cluster's pods",
    );
  });

  test("says a control listed in part has more, and the CIS report lists what it does not score, and why", () => {
    const csv: string = getKubernetesFrameworkReportCsv(
      frameworkOf({
        framework: CIS,
        requirements: [
          requirement({
            requirement: "5.2.2",
            status: ComplianceRequirementStatus.Failing,
            failingCount: 3,
            findings: [KUBE_PROXY],
          }),
        ],
      }),
    );

    expect(csv).toContain("and 2 more");
    expect(csv).toContain("1.2,API server (30 controls),Not scored here");
    expect(csv).toContain(
      "5.1.7,No use of the system:masters group,Not scored here",
    );
    expect(csv.split("\r\n")).toHaveLength(2 + CIS_NOT_SCORED.length);
  });

  test("says what is turned off of a control, for the cluster or a namespace, by whom, when and why", () => {
    const framework: KubernetesComplianceFrameworkResponse = frameworkOf({
      turnedOff: [
        turnedOffOf({
          namespace: "kube-system",
          turnedOffBy: "Jane Doe",
          turnedOffAt: "2026-11-12T09:00:00.000Z",
          note: "System components run privileged.",
        }),
        turnedOffOf({ requirement: "Host Ports" }),
        turnedOffOf({ requirement: "Sysctls", namespace: "batch" }),
      ],
    });

    expect(describeKubernetesTurnedOff(framework, "Host Ports")).toBe(
      "kube-system, whole framework, turned off by Jane Doe on 2026-11-12: System components run privileged.; whole cluster, turned off",
    );
    expect(describeKubernetesTurnedOff(framework, "Sysctls")).toContain(
      "batch, turned off",
    );
  });

  test("a value that would run as a formula in a spreadsheet is made text", () => {
    const csv: string = getKubernetesFrameworkReportCsv(
      frameworkOf({
        requirements: [
          requirement({
            requirement: "Sysctls",
            status: ComplianceRequirementStatus.Failing,
            failingCount: 1,
            findings: [
              {
                object: { kind: "Pod", namespace: "web", name: "=cmd|calc" },
                details: [],
              },
            ],
          }),
        ],
      }),
    );

    expect(csv).not.toContain(",=cmd");
    expect(csv).not.toMatch(/,"=cmd/);
  });
});

describe("the JSON report", () => {
  test("carries the cluster's version, every control with what fails it and its fix, and what is turned off", () => {
    const report: Record<string, unknown> = getKubernetesFrameworkReport(
      {
        clusterId: "44444444-0000-4000-8000-000000000004",
        kubernetesVersion: "1.31",
        standardVersion: "1.31",
        provider: "EKS",
      },
      frameworkOf({ turnedOff: [turnedOffOf({ namespace: "kube-system" })] }),
      new Date("2026-11-19T10:00:00.000Z"),
    );

    expect(report["exportedAt"]).toBe("2026-11-19T10:00:00.000Z");
    expect(report["standardVersion"]).toBe("1.31");
    expect(report["notScored"]).toEqual([]);
    expect(report["turnedOff"]).toHaveLength(1);

    const privileged: Record<string, unknown> | undefined = (
      report["requirements"] as Array<Record<string, unknown>>
    ).find((each: Record<string, unknown>): boolean => {
      return each["requirement"] === "Privileged Containers";
    });

    expect(privileged?.["findings"]).toEqual([KUBE_PROXY]);
    expect(privileged?.["fix"]).toContain("Remove securityContext.privileged");
  });

  test("the CIS report says which controls it does not score, and why", () => {
    const report: Record<string, unknown> = getKubernetesFrameworkReport(
      {
        clusterId: "c",
        kubernetesVersion: null,
        standardVersion: "1.37",
        provider: null,
      },
      frameworkOf({ framework: CIS, requirements: [] }),
      new Date(),
    );

    expect(report["notScored"]).toHaveLength(CIS_NOT_SCORED.length);
    expect((report["notScored"] as Array<Record<string, unknown>>)[0]).toEqual({
      id: "1.1",
      title: "Control plane node configuration files",
      controlCount: 21,
      reason: "NodeAccess",
      why: "Needs access to the nodes: file permissions and the kubelet's configuration.",
    });
  });
});
