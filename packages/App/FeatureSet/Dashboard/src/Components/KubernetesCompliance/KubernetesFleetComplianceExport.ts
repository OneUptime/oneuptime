import { CsvRow, toCsv } from "../DataSecurity/ComplianceExport";
import {
  KubernetesFleetComplianceRow,
  KubernetesFleetFramework,
  getFleetFrameworks,
  getFrameworkSummary,
} from "./KubernetesFleetComplianceModel";
import {
  KubernetesComplianceFailingControl,
  KubernetesComplianceFrameworkSummary,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";

/*
 * EVERY CLUSTER'S FAILING CONTROLS, FOR AN AUDITOR (#9876): the project's
 * export of Kubernetes' Compliance page. One CSV row per cluster, framework
 * and failing control - how many objects fail it - so "which clusters fail
 * CIS 5.1.1?" is one filter in a spreadsheet; a framework a cluster passes
 * is one row with no control, and a cluster not scored yet says so. Each
 * cluster's own Compliance page exports what fails each control, object by
 * object. CSV a spreadsheet opens (TableColumnsToCsv escapes every field
 * and makes a formula text) or JSON; the headers and words are the English
 * an auditor files them under.
 */

export const FLEET_REPORT_HEADER: CsvRow = [
  "Cluster",
  "Cluster ID",
  "Framework",
  "Score",
  "Controls Failing",
  "Workloads Evaluated",
  "Workloads Passing",
  "Accepted",
  "Failing Control",
  "Control Title",
  "Failing Objects",
  "Scored At",
  "Agent",
];

function agentOf(row: KubernetesFleetComplianceRow): string {
  return row.isConnected ? "Connected" : "Disconnected";
}

function frameworkRows(
  row: KubernetesFleetComplianceRow,
  summary: KubernetesComplianceFrameworkSummary,
): Array<CsvRow> {
  const shared: (
    control: KubernetesComplianceFailingControl | null,
  ) => CsvRow = (
    control: KubernetesComplianceFailingControl | null,
  ): CsvRow => {
    return [
      row.name,
      row.clusterId,
      summary.framework,
      summary.isTurnedOff
        ? "Turned off"
        : summary.score === null
          ? "Not evaluated"
          : String(summary.score),
      String(summary.failingControls.length),
      String(summary.workloadsEvaluated),
      String(summary.workloadsPassing),
      String(summary.acceptedCount),
      control ? control.requirement : "",
      control ? control.title : "",
      control ? String(control.failingCount) : "",
      row.refreshedAt || "",
      agentOf(row),
    ];
  };

  if (summary.isTurnedOff || summary.failingControls.length === 0) {
    return [shared(null)];
  }

  return summary.failingControls.map(shared);
}

export function getFleetComplianceCsv(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
): string {
  const frameworks: Array<KubernetesFleetFramework> = getFleetFrameworks(rows);
  const lines: Array<CsvRow> = [FLEET_REPORT_HEADER];

  for (const row of rows) {
    if (!row.summary) {
      lines.push([
        row.name,
        row.clusterId,
        "",
        "Not scored yet",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        agentOf(row),
      ]);
      continue;
    }

    for (const framework of frameworks) {
      const summary: KubernetesComplianceFrameworkSummary | undefined =
        getFrameworkSummary(row, framework.framework);

      if (summary) {
        lines.push(...frameworkRows(row, summary));
      }
    }
  }

  return toCsv(lines);
}

// What the project's JSON export holds: each cluster's summary, as it was scored.
export function getFleetComplianceReport(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
  exportedAt: Date,
): Record<string, unknown> {
  return {
    exportedAt: exportedAt.toISOString(),
    frameworks: getFleetFrameworks(rows),
    clusters: rows.map((row: KubernetesFleetComplianceRow) => {
      return {
        clusterId: row.clusterId,
        name: row.name,
        agentConnected: row.isConnected,
        scoredAt: row.refreshedAt,
        lowestScore: row.lowestScore,
        kubernetesVersion: row.summary?.kubernetesVersion || null,
        podCount: row.summary ? row.summary.podCount : null,
        workloadCount: row.workloadCount,
        frameworks: row.summary?.frameworks || [],
      };
    }),
  };
}

const FILE_LABEL: string = "kubernetes compliance";

export function downloadFleetComplianceCsv(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
): void {
  TableColumnsToCsv.downloadCsv({
    csv: getFleetComplianceCsv(rows),
    filename: TableColumnsToCsv.getExportFilename(FILE_LABEL),
  });
}

export function downloadFleetComplianceJson(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
  exportedAt: Date = new Date(),
): void {
  downloadFile({
    content: JSON.stringify(
      getFleetComplianceReport(rows, exportedAt),
      null,
      2,
    ),
    filename: getExportFilename({
      label: FILE_LABEL,
      extension: "json",
      exportedAt,
    }),
    mimeType: "application/json;charset=utf-8;",
  });
}
