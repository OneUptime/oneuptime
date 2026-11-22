import { getTurnedOffEntries } from "../ResourceDataSecurity/ResourceComplianceModel";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceTurnedOff,
  DataSecurityRecordOfProcessingRow,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { ComplianceRequirementResult } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DeclaredStoreReaders,
  SECURITY_EVENTS_SCANS_ONLY_TEXT,
} from "Common/Types/DataSecurity/DeclaredDataStore";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";

/*
 * THE FILES DATA SECURITY HANDS AN AUDITOR.
 *
 * The GDPR record of processing (Article 30) - every store, the data it
 * holds, who owns it, why and for how long, and for the stores OneUptime
 * keeps for the project's security who can read them (#10398) - as CSV or
 * JSON, and one framework's report:
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
  "Who Can Read",
  "Frameworks",
  "Declared By",
];

const LIST_SEPARATOR: string = "; ";

// Who declares a store the record lists that no scan found.
const DECLARED_BY_ONEUPTIME: string = "OneUptime";

const RECORD_OF_PROCESSING_FILE_LABEL: string = "record-of-processing";

/*
 * Who can read a store OneUptime declares (#10398), as the record writes
 * it: its readers' roles, or that only Security Events' scans read it - the
 * address vault. Empty for a store Data Security found, whose access is
 * its cloud's and listed on its Who Can Reach It.
 */
export function getRecordWhoCanRead(
  row: DataSecurityRecordOfProcessingRow,
): string {
  if (!row.declared) {
    return "";
  }

  if (row.declared.readers === DeclaredStoreReaders.SecurityEventsScansOnly) {
    return SECURITY_EVENTS_SCANS_ONLY_TEXT;
  }

  return (row.declared.readerNames || []).join(LIST_SEPARATOR);
}

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
        getRecordWhoCanRead(row),
        (row.frameworks || []).join(LIST_SEPARATOR),
        row.declared ? DECLARED_BY_ONEUPTIME : "",
      ];
    }),
  ]);
}

export function downloadRecordOfProcessing(
  rows: Array<DataSecurityRecordOfProcessingRow>,
): void {
  TableColumnsToCsv.downloadCsv({
    csv: getRecordOfProcessingCsv(rows),
    filename: TableColumnsToCsv.getExportFilename(
      RECORD_OF_PROCESSING_FILE_LABEL,
    ),
  });
}

/*
 * The record as JSON: every row as the server wrote it - a declared
 * store's with what OneUptime declares of it, who can read it among it -
 * and when it was exported.
 */
export function getRecordOfProcessingJson(
  rows: Array<DataSecurityRecordOfProcessingRow>,
  exportedAt: Date = new Date(),
): string {
  return JSON.stringify(
    {
      exportedAt: exportedAt.toISOString(),
      rows: rows,
    },
    null,
    2,
  );
}

export function downloadRecordOfProcessingJson(
  rows: Array<DataSecurityRecordOfProcessingRow>,
  exportedAt: Date = new Date(),
): void {
  downloadFile({
    content: getRecordOfProcessingJson(rows, exportedAt),
    filename: getExportFilename({
      label: RECORD_OF_PROCESSING_FILE_LABEL,
      extension: "json",
      exportedAt: exportedAt,
    }),
    mimeType: "application/json;charset=utf-8;",
  });
}

const FRAMEWORK_REPORT_HEADER: CsvRow = [
  "Framework",
  "Requirement",
  "Title",
  "Status",
  "Checks",
  "Open Issues",
  "Turned Off On",
];

/*
 * Where a requirement does not apply, and why (#9629): each resource that
 * turned it off, or its whole framework, with who turned it off, when and
 * the reason written for it - "prod-eu (KubernetesCluster), whole
 * framework, turned off by Jane Doe on 2026-11-12: No card data here".
 */
export function describeTurnedOff(
  framework: DataSecurityComplianceFramework,
  requirement: string,
): string {
  return [
    ...getTurnedOffEntries(framework, requirement),
    ...getTurnedOffEntries(framework, null),
  ]
    .map((entry: DataSecurityComplianceTurnedOff): string => {
      const resource: string = `${entry.resource.name || entry.resource.id} (${entry.resource.kind})`;
      const whole: string = entry.requirement ? "" : ", whole framework";
      const who: string = entry.turnedOffBy ? ` by ${entry.turnedOffBy}` : "";
      const when: string = entry.turnedOffAt
        ? ` on ${entry.turnedOffAt.slice(0, 10)}`
        : "";
      const why: string = entry.note ? `: ${entry.note}` : "";

      return `${resource}${whole}, turned off${who}${when}${why}`;
    })
    .join(LIST_SEPARATOR);
}

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
          describeTurnedOff(framework, requirement.requirement),
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
        // What resources turned off of it, with who, when and why (#9629).
        turnedOff: framework.turnedOff || [],
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
