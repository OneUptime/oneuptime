import { describe, expect, test } from "@jest/globals";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import {
  KubernetesComplianceAcceptanceEntry,
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceNodeBenchmark,
  KubernetesComplianceTurnedOff,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { CIS_NOT_SCORED } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { NSA_CISA_NOT_SCORED } from "Common/Types/Kubernetes/Compliance/NsaCisaHardening";
import { KubernetesComplianceFinding } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  ACCEPTANCE_EXPIRY_OPTIONS,
  BINDING_COUNT,
  KubernetesAcceptanceExpiry,
  MARKED_MANUAL_REASON,
  NAMESPACE_COUNT,
  NOT_EVALUATED_REASONS,
  ROLE_COUNT,
  SERVICE_ACCOUNT_COUNT,
  WORKLOAD_COUNT,
  findAcceptanceEntry,
  findTurnedOff,
  getAcceptanceExpiryDate,
  getAcceptanceExpiryLine,
  getAcceptedLine,
  getFailingControlCount,
  getFailingCountTemplate,
  getKubernetesAcceptanceKey,
  getKubernetesSwitchKey,
  getNamespaceRows,
  getObjectName,
  isAcceptanceRow,
  isSwitchOn,
  sortAcceptancesForPage,
  sortControlsForPage,
} from "../../FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesComplianceModel";
import {
  describeAcceptance,
  describeDetail,
  describeFinding,
  describeKubernetesTurnedOff,
  getFixText,
  getKubernetesFrameworkReport,
  getKubernetesFrameworkReportCsv,
} from "../../FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesComplianceExport";
import { createTranslator } from "Common/Types/Translator";

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
const NSA: KubernetesComplianceFramework =
  KubernetesComplianceFramework.NsaCisaHardening;

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
      // A sentence may open with kube-bench, which writes its name in lowercase.
      expect(NOT_EVALUATED_REASONS[reason]).toMatch(
        /^([A-Z]|kube-bench ).*\.$/,
      );
    }
    // Without kube-bench, the value that turns it on (#9873).
    expect(
      NOT_EVALUATED_REASONS[
        KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotRun
      ],
    ).toContain("compliance.nodeBenchmark.enabled");
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
      "Framework,Control,Title,Status,Note,Failing,What Fails,How to Fix,Turned Off,Accepted,Accepted Findings",
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

/*
 * #9874 and #9880, as the page and the reports say them: a finding accepted
 * for one object, by whom, why and until when, in both exports; and a
 * workload read from its pod template, as it runs no pod.
 */
function acceptanceOf(
  data: Partial<KubernetesComplianceAcceptanceEntry> = {},
): KubernetesComplianceAcceptanceEntry {
  return {
    id: "accept-1",
    framework: BASELINE,
    requirement: "Privileged Containers",
    object: { kind: "DaemonSet", namespace: "kube-system", name: "cilium" },
    note: "Cilium's agent programs the node's network.",
    acceptedAt: "2026-11-12T09:00:00.000Z",
    acceptedBy: "Jane Doe",
    expiresAt: "2027-02-12T09:00:00.000Z",
    isExpired: false,
    isOnCluster: true,
    ...data,
  };
}

describe("accepted findings and templates in the reports", () => {
  test("a workload read from its pod template says so", () => {
    expect(
      describeFinding({
        object: { kind: "CronJob", namespace: "ops", name: "backup" },
        details: [{ field: "hostNetwork", value: "true" }],
        isFromTemplate: true,
      }),
    ).toBe(
      "CronJob ops/backup (from its pod template, no pod running): hostNetwork=true",
    );
  });

  test("an acceptance: its object, whether for every control, by whom, when, until when and why", () => {
    expect(describeAcceptance(acceptanceOf())).toBe(
      "DaemonSet kube-system/cilium, accepted by Jane Doe on 2026-11-12, until 2027-02-12: Cilium's agent programs the node's network.",
    );
    expect(
      describeAcceptance(
        acceptanceOf({
          requirement: null,
          acceptedBy: null,
          expiresAt: "2026-11-01T00:00:00.000Z",
          isExpired: true,
          isOnCluster: false,
          note: "",
        }),
      ),
    ).toBe(
      "DaemonSet kube-system/cilium, every control, accepted on 2026-11-12, expired 2026-11-01, not on the cluster now",
    );
  });

  test("the CSV lists a control's accepted findings, and how many, beside what fails it", () => {
    const csv: string = getKubernetesFrameworkReportCsv(
      frameworkOf({
        acceptances: [acceptanceOf()],
        requirements: [
          requirement({
            requirement: "Privileged Containers",
            status: ComplianceRequirementStatus.Failing,
            failingCount: 1,
            findings: [KUBE_PROXY],
            acceptedCount: 1,
            accepted: [
              {
                object: {
                  kind: "DaemonSet",
                  namespace: "kube-system",
                  name: "cilium",
                },
                details: [],
                podCount: 2,
                acceptanceId: "accept-1",
              },
            ],
          }),
        ],
      }),
    );
    const line: string = csv.split("\r\n")[1]!;

    expect(line).toContain(
      "1,\"DaemonSet kube-system/cilium, accepted by Jane Doe on 2026-11-12, until 2027-02-12: Cilium's agent programs the node's network.\"",
    );
  });

  test("the JSON keeps every acceptance - expired and gone ones too - and what the framework read from templates", () => {
    const report: Record<string, unknown> = getKubernetesFrameworkReport(
      {
        clusterId: "c",
        kubernetesVersion: "1.31",
        standardVersion: "1.31",
        provider: null,
      },
      frameworkOf({
        workloadsFromTemplates: 2,
        acceptedCount: 1,
        acceptances: [
          acceptanceOf(),
          acceptanceOf({ id: "accept-2", isExpired: true }),
        ],
      }),
      new Date("2026-11-19T10:00:00.000Z"),
    );

    expect(report["workloadsFromTemplates"]).toBe(2);
    expect(report["acceptedCount"]).toBe(1);
    expect(
      (report["acceptances"] as Array<Record<string, unknown>>).map(
        (entry: Record<string, unknown>) => {
          return [entry["id"], entry["isExpired"]];
        },
      ),
    ).toEqual([
      ["accept-1", false],
      ["accept-2", true],
    ]);
  });
});

describe("an acceptance, as the page says it", () => {
  const translator: ReturnType<typeof createTranslator> = createTranslator(
    (key: string): string => {
      return key;
    },
  );

  test("its key names its framework, its control - or none - and its object", () => {
    expect(
      getKubernetesAcceptanceKey({
        framework: BASELINE,
        requirement: " Privileged Containers ",
        object: { kind: "DaemonSet", namespace: "kube-system", name: "cilium" },
      }),
    ).toBe("PSS Baseline|Privileged Containers|DaemonSet|kube-system|cilium");
    expect(
      getKubernetesAcceptanceKey({
        framework: CIS,
        requirement: null,
        object: { kind: "ClusterRoleBinding", namespace: "", name: "admin" },
      }),
    ).toBe("CIS Kubernetes||ClusterRoleBinding||admin");
  });

  test("a setting's row that names an object is an acceptance, never a switch", () => {
    expect(isAcceptanceRow({ objectName: "cilium" })).toBe(true);
    expect(isAcceptanceRow({ objectName: "  " })).toBe(false);
    expect(isAcceptanceRow({})).toBe(false);
  });

  test("an accepted finding finds the acceptance it is under", () => {
    const framework: KubernetesComplianceFrameworkResponse = frameworkOf({
      acceptances: [acceptanceOf()],
    });

    expect(findAcceptanceEntry(framework, "accept-1")?.note).toBe(
      "Cilium's agent programs the node's network.",
    );
    expect(findAcceptanceEntry(framework, "nope")).toBeUndefined();
    expect(findAcceptanceEntry(frameworkOf(), "accept-1")).toBeUndefined();
  });

  test("who accepted it and when, and until when, in the reader's words", () => {
    expect(getAcceptedLine(acceptanceOf(), translator)).toMatch(
      /^Accepted by Jane Doe on /,
    );
    expect(
      getAcceptedLine(acceptanceOf({ acceptedBy: null }), translator),
    ).toMatch(/^Accepted on /);
    expect(
      getAcceptedLine(acceptanceOf({ acceptedAt: null }), translator),
    ).toBe("Accepted");
    expect(getAcceptanceExpiryLine(acceptanceOf(), translator)).toMatch(
      /^Fails again on /,
    );
    expect(
      getAcceptanceExpiryLine(acceptanceOf({ isExpired: true }), translator),
    ).toMatch(/^Expired on .*: it fails again\.$/);
    expect(
      getAcceptanceExpiryLine(acceptanceOf({ expiresAt: null }), translator),
    ).toBeNull();
  });

  test("the fold lists those in force first, then the expired, then the gone, the latest first", () => {
    expect(
      sortAcceptancesForPage([
        acceptanceOf({ id: "gone", isOnCluster: false }),
        acceptanceOf({ id: "expired", isExpired: true }),
        acceptanceOf({ id: "older", acceptedAt: "2026-10-01T00:00:00.000Z" }),
        acceptanceOf({ id: "newer" }),
      ]).map((entry: KubernetesComplianceAcceptanceEntry): string => {
        return entry.id;
      }),
    ).toEqual(["newer", "older", "expired", "gone"]);
  });

  test("the dialog's expiries, from now", () => {
    const now: Date = new Date("2026-11-19T12:00:00.000Z");

    expect(
      ACCEPTANCE_EXPIRY_OPTIONS.map(
        (option: { value: KubernetesAcceptanceExpiry }) => {
          return option.value;
        },
      ),
    ).toEqual([
      KubernetesAcceptanceExpiry.Never,
      KubernetesAcceptanceExpiry.Month,
      KubernetesAcceptanceExpiry.ThreeMonths,
      KubernetesAcceptanceExpiry.SixMonths,
      KubernetesAcceptanceExpiry.Year,
    ]);
    expect(
      getAcceptanceExpiryDate(KubernetesAcceptanceExpiry.Never, now),
    ).toBeNull();
    expect(
      getAcceptanceExpiryDate(
        KubernetesAcceptanceExpiry.Month,
        now,
      )?.toISOString(),
    ).toBe("2026-12-19T12:00:00.000Z");
    expect(
      getAcceptanceExpiryDate(
        KubernetesAcceptanceExpiry.ThreeMonths,
        now,
      )?.toISOString(),
    ).toBe("2027-02-19T12:00:00.000Z");
    expect(
      getAcceptanceExpiryDate(
        KubernetesAcceptanceExpiry.SixMonths,
        now,
      )?.toISOString(),
    ).toBe("2027-05-19T12:00:00.000Z");
    expect(
      getAcceptanceExpiryDate(
        KubernetesAcceptanceExpiry.Year,
        now,
      )?.toISOString(),
    ).toBe("2027-11-19T12:00:00.000Z");
    expect(getAcceptanceExpiryDate("someday", now)).toBeNull();
  });
});

/*
 * #9873 and #9875 in the reports: the CIS benchmark's node controls, with
 * what kube-bench read and what it marks manual, and the NSA/CISA guide's
 * controls by its sections, with what it asks that OneUptime cannot read.
 */
describe("kube-bench's node controls and the NSA/CISA guide in the reports", () => {
  const KIND_WORKER: KubernetesComplianceFinding = {
    object: { kind: "Node", namespace: "", name: "kind-worker" },
    details: [],
  };
  const NODE_BENCHMARK: KubernetesComplianceNodeBenchmark = {
    benchmark: "cis-1.12",
    family: "cis",
    nodes: [
      {
        node: "kind-worker",
        benchmark: "cis-1.12",
        targets: ["node"],
        finishedAt: "2026-11-19T22:41:05.000Z",
        isControlPlane: false,
        error: null,
      },
    ],
    manual: ["4.2.4", "4.2.5"],
    suggestedBenchmark: null,
  };
  const CLUSTER: {
    clusterId: string;
    kubernetesVersion: string | null;
    standardVersion: string;
    provider: string | null;
  } = {
    clusterId: "c",
    kubernetesVersion: "1.33",
    standardVersion: "1.33",
    provider: null,
  };

  function cisWithNodes(): KubernetesComplianceFrameworkResponse {
    return frameworkOf({
      framework: CIS,
      requirements: [
        requirement({
          requirement: "4.1.1",
          title: "Kubelet service file: permissions 600 or stricter",
          status: ComplianceRequirementStatus.Failing,
          failingCount: 1,
          findings: [KIND_WORKER],
        }),
      ],
    });
  }

  test("a node control's fix is written whole, the command in it", () => {
    expect(
      getFixText({
        fix: "Run {{setting}} on each node.",
        fixSlots: { setting: "chmod 600 /var/lib/kubelet/config.yaml" },
      }),
    ).toBe("Run chmod 600 /var/lib/kubelet/config.yaml on each node.");
    // A slot it is not given stays as written, rather than reading as nothing.
    expect(getFixText({ fix: "Set {{setting}}.", fixSlots: {} })).toBe(
      "Set {{setting}}.",
    );
    expect(getFixText(undefined)).toBe("");
  });

  test("the CSV says each node that fails a control, the fix, and the checks kube-bench marks manual", () => {
    const csv: string = getKubernetesFrameworkReportCsv(cisWithNodes(), {
      nodeBenchmark: NODE_BENCHMARK,
    });

    expect(csv).toContain(
      "CIS Kubernetes,4.1.1,Kubelet service file: permissions 600 or stricter,Failing,,1,Node kind-worker,Run chmod 600 /etc/systemd/system/kubelet.service.d/10-kubeadm.conf on each node.",
    );
    expect(csv).toContain(
      `CIS Kubernetes,4.2.4,,Not scored here,${MARKED_MANUAL_REASON}`,
    );
    // kube-bench read the kubelet: section 4 leaves the list it does not score.
    expect(csv).not.toContain("4.1,Worker node configuration files");
  });

  test("the JSON carries what kube-bench read, and the CIS report alone", () => {
    const report: Record<string, unknown> = getKubernetesFrameworkReport(
      { ...CLUSTER, nodeBenchmark: NODE_BENCHMARK },
      cisWithNodes(),
      new Date(),
    );
    const notScored: Array<Record<string, unknown>> = report[
      "notScored"
    ] as Array<Record<string, unknown>>;

    expect(report["nodeBenchmark"]).toEqual(NODE_BENCHMARK);
    expect(
      (report["requirements"] as Array<Record<string, unknown>>)[0]!["fix"],
    ).toBe(
      "Run chmod 600 /etc/systemd/system/kubelet.service.d/10-kubeadm.conf on each node.",
    );
    expect(
      notScored.filter((row: Record<string, unknown>): boolean => {
        return row["reason"] === "MarkedManual";
      }),
    ).toEqual([
      {
        id: "4.2.4",
        title: "",
        controlCount: 1,
        reason: "MarkedManual",
        why: MARKED_MANUAL_REASON,
      },
      {
        id: "4.2.5",
        title: "",
        controlCount: 1,
        reason: "MarkedManual",
        why: MARKED_MANUAL_REASON,
      },
    ]);
    expect(
      getKubernetesFrameworkReport(
        { ...CLUSTER, nodeBenchmark: NODE_BENCHMARK },
        frameworkOf(),
        new Date(),
      ),
    ).not.toHaveProperty("nodeBenchmark");
  });

  test("the NSA/CISA report names each control's section, and lists what the guide asks that is not scored", () => {
    const guide: KubernetesComplianceFrameworkResponse = frameworkOf({
      framework: NSA,
      fullName: "NSA/CISA Kubernetes Hardening Guide v1.2",
      requirements: [
        requirement({
          requirement: "No privileged containers",
          status: ComplianceRequirementStatus.Failing,
          failingCount: 1,
          findings: [KUBE_PROXY],
        }),
      ],
    });
    const report: Record<string, unknown> = getKubernetesFrameworkReport(
      CLUSTER,
      guide,
      new Date(),
    );
    const notScored: Array<Record<string, unknown>> = report[
      "notScored"
    ] as Array<Record<string, unknown>>;
    const csv: string = getKubernetesFrameworkReportCsv(guide);

    expect(
      (report["requirements"] as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      requirement: "No privileged containers",
      section: "Kubernetes Pod security",
    });
    expect(notScored).toHaveLength(NSA_CISA_NOT_SCORED.length);
    expect(notScored[0]).toMatchObject({
      id: "",
      title: "Container images scanned for vulnerabilities",
      reason: "OutsideKubernetes",
      section: "Kubernetes Pod security",
    });
    expect(csv).toContain(
      "NSA/CISA Hardening,,Container images scanned for vulnerabilities,Not scored here,",
    );
    expect(csv.split("\r\n")).toHaveLength(2 + NSA_CISA_NOT_SCORED.length);
  });
});
