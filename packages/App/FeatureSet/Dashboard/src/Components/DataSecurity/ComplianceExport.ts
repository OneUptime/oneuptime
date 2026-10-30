import {
  DataSecurityComplianceFramework,
  DataSecurityRecordOfProcessingRow,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { ComplianceRequirementResult } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";

/*
 * THE FILES DATA SECURITY HANDS AN AUDITOR.
 *
 * The GDPR record of processing (Article 30) - every store, the data it
 * holds, who owns it, why and for how long - and one framework's report:
 * each requirement, where it stands and the checks and open issues behind
 * it. Built in the page from what the server worked out, as CSV a
 * spreadsheet opens (every field escaped, and a value that would run as a
 * formula made text: TableColumnsToCsv) or as JSON. The headers are the
 * English an auditor files them under.
 */

export type CsvRow = Array<string>;

// RFC 4180, with formula injection neutralised, rows ending CRLF.
export function toCsv(rows: Array<CsvRow>): string {
  return rows
    .map((row: CsvRow): string => {
      return row
        .map((value: string): string => {
          return TableColumnsToCsv.escapeCsvValue(
            TableColumnsToCsv.sanitizeForCsvInjection(value || ""),
          );
        })
        .join(",");
    })
    .join("\r\n");
}

const RECORD_OF_PROCESSING_HEADER: CsvRow = [
  "Data Store",
  "Kind",
  "Provider",
  "Region",
  "Environment",
  "Sensitivity",
  "Data Categories",
  "Data Types",
  "Owners",
  "Purpose",
  "Retention",
  "Frameworks",
];

const LIST_SEPARATOR: string = "; ";

export function getRecordOfProcessingCsv(
  rows: Array<DataSecurityRecordOfProcessingRow>,
): string {
  return toCsv([
    RECORD_OF_PROCESSING_HEADER,
    ...rows.map((row: DataSecurityRecordOfProcessingRow): CsvRow => {
      return [
        row.name || "",
        row.kind || "",
        row.provider || "",
        row.region || "",
        row.environment || "",
        row.sensitivity || "",
        (row.dataCategories || []).join(LIST_SEPARATOR),
        (row.dataTypeNames || []).join(LIST_SEPARATOR),
        (row.owners || []).join(LIST_SEPARATOR),
        row.purpose || "",
        row.retention || "",
        (row.frameworks || []).join(LIST_SEPARATOR),
      ];
    }),
  ]);
}

export function downloadRecordOfProcessing(
  rows: Array<DataSecurityRecordOfProcessingRow>,
): void {
  TableColumnsToCsv.downloadCsv({
    csv: getRecordOfProcessingCsv(rows),
    filename: TableColumnsToCsv.getExportFilename("record-of-processing"),
  });
}

const FRAMEWORK_REPORT_HEADER: CsvRow = [
  "Framework",
  "Requirement",
  "Title",
  "Status",
  "Checks",
  "Open Issues",
];

export function getFrameworkReportCsv(
  framework: DataSecurityComplianceFramework,
): string {
  return toCsv([
    FRAMEWORK_REPORT_HEADER,
    ...framework.requirements.map(
      (requirement: ComplianceRequirementResult): CsvRow => {
        return [
          framework.framework,
          requirement.requirement,
          requirement.title,
          requirement.status,
          requirement.checkIds.join(LIST_SEPARATOR),
          String(requirement.failingIssueCount),
        ];
      },
    ),
  ]);
}

// The framework's name, for its files: "PCI DSS" -> "pci-dss-report".
function frameworkFileLabel(
  framework: DataSecurityComplianceFramework,
): string {
  return `${framework.framework} report`;
}

export function downloadFrameworkReportCsv(
  framework: DataSecurityComplianceFramework,
): void {
  TableColumnsToCsv.downloadCsv({
    csv: getFrameworkReportCsv(framework),
    filename: TableColumnsToCsv.getExportFilename(
      frameworkFileLabel(framework),
    ),
  });
}

export function downloadFrameworkReportJson(
  framework: DataSecurityComplianceFramework,
  exportedAt: Date = new Date(),
): void {
  downloadFile({
    content: JSON.stringify(
      {
        exportedAt: exportedAt.toISOString(),
        framework: framework.framework,
        fullName: framework.fullName,
        scope: framework.scope,
        score: framework.score,
        storesInScope: framework.storesInScope,
        requirements: framework.requirements,
      },
      null,
      2,
    ),
    filename: getExportFilename({
      label: frameworkFileLabel(framework),
      extension: "json",
      exportedAt: exportedAt,
    }),
    mimeType: "application/json;charset=utf-8;",
  });
}
