import { getTurnedOffEntries } from "../ResourceDataSecurity/ResourceComplianceModel";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceTurnedOff,
  DataSecurityRecordOfProcessingRow,
  ImpactAssessmentStatus,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { ComplianceRequirementResult } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DeclaredStoreReaders,
  SECURITY_EVENTS_SCANS_ONLY_TEXT,
} from "Common/Types/DataSecurity/DeclaredDataStore";
import {
  RECORD_FIELD_TITLES,
  RECORD_TRANSFERS_UNKNOWN_TEXTS,
  RecordFieldView,
  RecordRecipient,
  RecordTransfer,
  describeRecordRecipient,
  describeRecordTransfer,
  isRecordFieldToReview,
} from "Common/Types/DataSecurity/RecordOfProcessing";
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
  /*
   * The rest of what Article 30 asks (#10375), after the columns a
   * spreadsheet already reads by position: the legal basis and the people,
   * as a person wrote or confirmed them; who receives the data and where it
   * goes, worked out from the store's flows and regions; whether it needs
   * an impact assessment; and the fields whose drafts wait for a person -
   * a draft is never in the record until someone confirms it.
   */
  "Legal Basis",
  "People It Is About",
  "Recipients",
  "Transfers",
  "Impact Assessment",
  "Waiting for Review",
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
        row.legalBasis || "",
        (row.dataSubjects || []).join(LIST_SEPARATOR),
        (row.recipients || [])
          .map((recipient: RecordRecipient): string => {
            return describeRecordRecipient(recipient);
          })
          .join(LIST_SEPARATOR),
        getRecordTransfersText(row),
        row.impactAssessment
          ? IMPACT_ASSESSMENT_STATUS_ENGLISH[row.impactAssessment.status] || ""
          : "",
        getFieldsWaitingForReview(row).join(LIST_SEPARATOR),
      ];
    }),
  ]);
}

// Whether a store needs an impact assessment, and how far it is, as an auditor reads it.
export const IMPACT_ASSESSMENT_STATUS_ENGLISH: Readonly<
  Record<ImpactAssessmentStatus, string>
> = {
  [ImpactAssessmentStatus.NotNeeded]: "Not needed",
  [ImpactAssessmentStatus.Needed]: "Needed",
  [ImpactAssessmentStatus.Drafted]: "Drafted",
  [ImpactAssessmentStatus.Edited]: "Edited",
};

// Where a store's data goes, in English: each transfer, or why it is not known.
export function getRecordTransfersText(
  row: DataSecurityRecordOfProcessingRow,
): string {
  if ((row.transfers || []).length > 0) {
    return (row.transfers || [])
      .map((transfer: RecordTransfer): string => {
        return describeRecordTransfer(transfer);
      })
      .join(LIST_SEPARATOR);
  }

  return row.transfersUnknownBecause
    ? RECORD_TRANSFERS_UNKNOWN_TEXTS[row.transfersUnknownBecause]
    : "";
}

// The fields of a store's record whose draft or proposed change waits for a person.
export function getFieldsWaitingForReview(
  row: DataSecurityRecordOfProcessingRow,
): Array<string> {
  return (row.fields || [])
    .filter((view: RecordFieldView): boolean => {
      return isRecordFieldToReview(view.status);
    })
    .map((view: RecordFieldView): string => {
      return RECORD_FIELD_TITLES[view.field];
    });
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

// A row of the record's JSON: its drafts left out, the fields they wait in named.
export type ExportedRecordRow = Omit<
  DataSecurityRecordOfProcessingRow,
  "fields" | "facts"
> & { waitingForReview?: Array<string> | undefined };

/*
 * The record as JSON: every row as the server wrote it - a declared
 * store's with what OneUptime declares of it, who can read it among it -
 * and when it was exported. OneUptime AI's drafts are not in the record
 * until a person confirms them (#10375), so each row's fields and the
 * facts they rest on stay out; its Waiting for Review says which wait.
 */
export function getRecordOfProcessingJson(
  rows: Array<DataSecurityRecordOfProcessingRow>,
  exportedAt: Date = new Date(),
): string {
  return JSON.stringify(
    {
      exportedAt: exportedAt.toISOString(),
      rows: rows.map(
        (row: DataSecurityRecordOfProcessingRow): ExportedRecordRow => {
          const recorded: ExportedRecordRow = { ...row };
          const waiting: Array<string> = getFieldsWaitingForReview(row);

          delete (recorded as Partial<DataSecurityRecordOfProcessingRow>)
            .fields;
          delete (recorded as Partial<DataSecurityRecordOfProcessingRow>).facts;

          if (waiting.length > 0) {
            recorded.waitingForReview = waiting;
          }

          return recorded;
        },
      ),
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
