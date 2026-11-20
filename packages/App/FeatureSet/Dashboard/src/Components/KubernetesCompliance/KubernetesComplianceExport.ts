import { CsvRow, toCsv } from "../DataSecurity/ComplianceExport";
import {
  NOT_EVALUATED_REASONS,
  NotScoredGroup,
  NotScoredLine,
  getNotScoredGroups,
} from "./KubernetesComplianceModel";
import {
  KubernetesComplianceAcceptanceEntry,
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
  KubernetesComplianceTurnedOff,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  KubernetesComplianceControlInfo,
  findKubernetesComplianceControl,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  KubernetesComplianceAcceptedFinding,
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
  KubernetesComplianceObject,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import { KubernetesComplianceRequirementResult } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import { withMeaningKeyAsItsWord } from "Common/Types/MeaningKeys";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";

/*
 * A CLUSTER'S FRAMEWORK REPORT, FOR AN AUDITOR (#9627): each control of the
 * Pod Security Standards' policy or the CIS Kubernetes Benchmark with where
 * it stands, what fails it - each workload, binding or namespace and why,
 * by Kubernetes' own field names - how to fix it, what is turned off of it,
 * by whom and why, and the findings accepted for one object (#9874), by
 * whom, why and until when. A workload read from its pod template, as it
 * runs no pod, says so (#9880). The CIS report also lists the benchmark's
 * controls not scored here, and why - as kube-bench leaves them, when it
 * reads the nodes (#9873) - and the NSA/CISA guide's (#9875) its
 * recommendations no source answers. CSV a spreadsheet opens (TableColumnsToCsv
 * escapes every field and makes a formula text) or JSON; the headers and
 * sentences are the English an auditor files them under.
 */

const LIST_SEPARATOR: string = "; ";

const REPORT_HEADER: CsvRow = [
  "Framework",
  "Control",
  "Title",
  "Status",
  "Note",
  "Failing",
  "What Fails",
  "How to Fix",
  "Turned Off",
  "Accepted",
  "Accepted Findings",
];

// "api: securityContext.privileged=true", "logs: hostPath=/var/log", "runAsNonRoot not set".
export function describeDetail(detail: KubernetesComplianceDetail): string {
  const part: string = detail.container || detail.volume || "";
  const prefix: string = part ? `${part}: ` : "";

  if (detail.isNotSet) {
    return `${prefix}${detail.field} not set`;
  }

  return detail.value
    ? `${prefix}${detail.field}=${detail.value}`
    : `${prefix}${detail.field}`;
}

// "DaemonSet kube-system/cilium", a namespace by its name alone.
export function describeObject(object: KubernetesComplianceObject): string {
  const name: string =
    object.namespace && object.kind !== "Namespace"
      ? `${object.namespace}/${object.name}`
      : object.name;

  return `${object.kind} ${name}`;
}

/*
 * "DaemonSet kube-system/kube-proxy (2 pods): proxy: securityContext.privileged=true",
 * or for a workload that runs no pod "CronJob ops/backup (from its pod
 * template, no pod running): ..." (#9880).
 */
export function describeFinding(finding: KubernetesComplianceFinding): string {
  const pods: string =
    finding.podCount && finding.podCount > 0
      ? ` (${finding.podCount} ${finding.podCount === 1 ? "pod" : "pods"})`
      : finding.isFromTemplate
        ? " (from its pod template, no pod running)"
        : "";
  const details: string = finding.details.map(describeDetail).join(", ");

  return `${describeObject(finding.object)}${pods}${details ? `: ${details}` : ""}`;
}

/*
 * An acceptance (#9874): "DaemonSet kube-system/cilium, every control,
 * accepted by Jane Doe on 2026-11-12, until 2027-02-12: CNI runs privileged".
 */
export function describeAcceptance(
  entry: KubernetesComplianceAcceptanceEntry,
): string {
  const scope: string = entry.requirement ? "" : ", every control";
  const who: string = entry.acceptedBy ? ` by ${entry.acceptedBy}` : "";
  const when: string = entry.acceptedAt
    ? ` on ${entry.acceptedAt.slice(0, 10)}`
    : "";
  const until: string = entry.expiresAt
    ? entry.isExpired
      ? `, expired ${entry.expiresAt.slice(0, 10)}`
      : `, until ${entry.expiresAt.slice(0, 10)}`
    : "";
  const gone: string = entry.isOnCluster ? "" : ", not on the cluster now";
  const why: string = entry.note ? `: ${entry.note}` : "";

  return `${describeObject(entry.object)}${scope}, accepted${who}${when}${until}${gone}${why}`;
}

// The accepted findings of a control, each with its acceptance.
function describeAccepted(
  framework: KubernetesComplianceFrameworkResponse,
  requirement: KubernetesComplianceRequirementResult,
): string {
  return (requirement.accepted || [])
    .map((finding: KubernetesComplianceAcceptedFinding): string => {
      const entry: KubernetesComplianceAcceptanceEntry | undefined = (
        framework.acceptances || []
      ).find((each: KubernetesComplianceAcceptanceEntry): boolean => {
        return each.id === finding.acceptanceId;
      });

      return entry ? describeAcceptance(entry) : describeFinding(finding);
    })
    .join(LIST_SEPARATOR);
}

/*
 * Where a control does not apply, and why: the control or its whole
 * framework turned off for the cluster or a namespace - "kube-system, whole
 * framework, turned off by Jane Doe on 2026-11-12: System pods".
 */
export function describeKubernetesTurnedOff(
  framework: KubernetesComplianceFrameworkResponse,
  requirement: string,
): string {
  return (framework.turnedOff || [])
    .filter((entry: KubernetesComplianceTurnedOff): boolean => {
      const own: string = (entry.requirement || "").trim();
      return !own || own === requirement;
    })
    .map((entry: KubernetesComplianceTurnedOff): string => {
      const where: string = entry.namespace || "whole cluster";
      const whole: string = entry.requirement ? "" : ", whole framework";
      const who: string = entry.turnedOffBy ? ` by ${entry.turnedOffBy}` : "";
      const when: string = entry.turnedOffAt
        ? ` on ${entry.turnedOffAt.slice(0, 10)}`
        : "";
      const why: string = entry.note ? `: ${entry.note}` : "";

      return `${where}${whole}, turned off${who}${when}${why}`;
    })
    .join(LIST_SEPARATOR);
}

/*
 * A control's fix as English writes it, with what it says to set or run in
 * it: "Set --profiling=false in the API server's manifest on each control
 * plane node." (#9873).
 */
export function getFixText(
  info: Pick<KubernetesComplianceControlInfo, "fix" | "fixSlots"> | undefined,
): string {
  if (!info) {
    return "";
  }

  const slots: Record<string, string> = info.fixSlots || {};

  return info.fix.replace(
    /\{\{(\w+)\}\}/g,
    (match: string, name: string): string => {
      return slots[name] ?? match;
    },
  );
}

function controlRow(
  framework: KubernetesComplianceFrameworkResponse,
  requirement: KubernetesComplianceRequirementResult,
): CsvRow {
  const info: KubernetesComplianceControlInfo | undefined =
    findKubernetesComplianceControl(
      framework.framework,
      requirement.requirement,
    );
  const isTruncated: boolean =
    requirement.failingCount > requirement.findings.length;

  return [
    framework.framework,
    requirement.requirement,
    // As English writes it: "Capabilities", not its key's meaning.
    withMeaningKeyAsItsWord(info?.title || requirement.title),
    requirement.status,
    requirement.notEvaluatedReason
      ? NOT_EVALUATED_REASONS[requirement.notEvaluatedReason] || ""
      : "",
    String(requirement.failingCount),
    [
      ...requirement.findings.map(describeFinding),
      ...(isTruncated
        ? [`and ${requirement.failingCount - requirement.findings.length} more`]
        : []),
    ].join(LIST_SEPARATOR),
    requirement.failingCount > 0 ? getFixText(info) : "",
    describeKubernetesTurnedOff(framework, requirement.requirement),
    String(requirement.acceptedCount || 0),
    describeAccepted(framework, requirement),
  ];
}

// What the framework does not score, as rows that say why.
function notScoredRows(
  framework: KubernetesComplianceFramework,
  compliance: Pick<KubernetesComplianceResponse, "nodeBenchmark">,
): Array<CsvRow> {
  const empty: Array<string> = ["", "", "", "", "", ""];

  return getNotScoredGroups(framework, compliance).flatMap(
    (group: NotScoredGroup): Array<CsvRow> => {
      return [
        ...group.lines.map((line: NotScoredLine): CsvRow => {
          return [
            framework,
            line.id,
            line.controlCount > 1
              ? `${line.title} (${line.controlCount} controls)`
              : line.title,
            "Not scored here",
            line.why || group.reason,
            ...empty,
          ];
        }),
        ...(group.manualChecks || []).map((check: string): CsvRow => {
          return [
            framework,
            check,
            "",
            "Not scored here",
            group.reason,
            ...empty,
          ];
        }),
      ];
    },
  );
}

/*
 * The report as CSV. The cluster's answer says what kube-bench read
 * (#9873); without it, the CIS benchmark's node controls read as not run.
 */
export function getKubernetesFrameworkReportCsv(
  framework: KubernetesComplianceFrameworkResponse,
  compliance: Pick<KubernetesComplianceResponse, "nodeBenchmark"> = {},
): string {
  return toCsv([
    REPORT_HEADER,
    ...framework.requirements.map(
      (requirement: KubernetesComplianceRequirementResult): CsvRow => {
        return controlRow(framework, requirement);
      },
    ),
    ...notScoredRows(framework.framework, compliance),
  ]);
}

// What a framework's JSON report holds.
export function getKubernetesFrameworkReport(
  compliance: Pick<
    KubernetesComplianceResponse,
    "clusterId" | "kubernetesVersion" | "standardVersion" | "provider"
  > &
    Partial<Pick<KubernetesComplianceResponse, "nodeBenchmark">>,
  framework: KubernetesComplianceFrameworkResponse,
  exportedAt: Date,
): Record<string, unknown> {
  return {
    exportedAt: exportedAt.toISOString(),
    clusterId: compliance.clusterId,
    kubernetesVersion: compliance.kubernetesVersion,
    standardVersion: compliance.standardVersion,
    provider: compliance.provider,
    framework: framework.framework,
    fullName: framework.fullName,
    scope: framework.scope,
    score: framework.score,
    workloadsEvaluated: framework.workloadsEvaluated,
    workloadsPassing: framework.workloadsPassing,
    // Of those, the ones read from their pod template, running no pod (#9880).
    workloadsFromTemplates: framework.workloadsFromTemplates || 0,
    acceptedCount: framework.acceptedCount || 0,
    requirements: framework.requirements.map(
      (requirement: KubernetesComplianceRequirementResult) => {
        const info: KubernetesComplianceControlInfo | undefined =
          findKubernetesComplianceControl(
            framework.framework,
            requirement.requirement,
          );

        return {
          ...requirement,
          description: info?.description || "",
          fix: getFixText(info),
          ...(info?.section ? { section: info.section } : {}),
        };
      },
    ),
    // What kube-bench read of the nodes (#9873), for the CIS benchmark.
    ...(framework.framework === KubernetesComplianceFramework.CisKubernetes
      ? { nodeBenchmark: compliance.nodeBenchmark || null }
      : {}),
    notScored: getNotScoredGroups(framework.framework, compliance).flatMap(
      (group: NotScoredGroup) => {
        return [
          ...group.lines.map((line: NotScoredLine) => {
            return {
              id: line.id,
              title: line.title,
              controlCount: line.controlCount,
              reason: group.key,
              why: line.why || group.reason,
              ...(line.section ? { section: line.section } : {}),
            };
          }),
          ...(group.manualChecks || []).map((check: string) => {
            return {
              id: check,
              title: "",
              controlCount: 1,
              reason: group.key,
              why: group.reason,
            };
          }),
        ];
      },
    ),
    // What is turned off of it, for the cluster or a namespace, with who, when and why.
    turnedOff: framework.turnedOff || [],
    /*
     * The findings accepted for one object (#9874), with who, when, why and
     * until when - expired ones too, and ones whose object is gone.
     */
    acceptances: framework.acceptances || [],
  };
}

// "PSS Baseline" -> "pss-baseline-report".
function fileLabel(framework: KubernetesComplianceFrameworkResponse): string {
  return `${framework.framework} report`;
}

export function downloadKubernetesFrameworkReportCsv(
  framework: KubernetesComplianceFrameworkResponse,
  compliance: Pick<KubernetesComplianceResponse, "nodeBenchmark"> = {},
): void {
  TableColumnsToCsv.downloadCsv({
    csv: getKubernetesFrameworkReportCsv(framework, compliance),
    filename: TableColumnsToCsv.getExportFilename(fileLabel(framework)),
  });
}

export function downloadKubernetesFrameworkReportJson(
  compliance: KubernetesComplianceResponse,
  framework: KubernetesComplianceFrameworkResponse,
  exportedAt: Date = new Date(),
): void {
  downloadFile({
    content: JSON.stringify(
      getKubernetesFrameworkReport(compliance, framework, exportedAt),
      null,
      2,
    ),
    filename: getExportFilename({
      label: fileLabel(framework),
      extension: "json",
      exportedAt,
    }),
    mimeType: "application/json;charset=utf-8;",
  });
}
