import { AuditEvidenceParagraph } from "Common/Types/DataSecurity/AuditEvidence";
import {
  ComplianceFact,
  describeComplianceFact,
} from "Common/Types/DataSecurity/ComplianceFacts";
import {
  DataSecurityAuditEvidenceRequirement,
  DataSecurityAuditEvidenceResponse,
  DataSecurityEvidenceIssue,
  DataSecurityImpactAssessmentResponse,
  DataSecurityRecordOfProcessingRow,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  IMPACT_ASSESSMENT_PART_ARTICLES,
  IMPACT_ASSESSMENT_PART_TITLES,
  IMPACT_ASSESSMENT_PARTS,
  ImpactAssessmentPart,
  ImpactAssessmentSection,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
  ImpactAssessmentTriggerView,
} from "Common/Types/DataSecurity/ImpactAssessment";
import {
  describeRecordRecipient,
  describeRecordTransfer,
  RecordRecipient,
  RecordTransfer,
} from "Common/Types/DataSecurity/RecordOfProcessing";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";

/*
 * THE COMPLIANCE PAPERWORK AS FILES (#10375): a store's impact assessment
 * and a framework's audit evidence, as Markdown and as PDF.
 *
 * Each is one Markdown document, read like the page it comes from: a
 * title, what it covers, "not legal advice" said once, then its parts or
 * its requirements, each with the facts it rests on. The evidence carries
 * its two appendices - the record of processing of the stores in scope and
 * the issue history it cites - as tables. Like the record's CSV and the
 * framework's report, the document's own words are the English an auditor
 * files them under; what a person or OneUptime AI wrote stays as written.
 * The PDF draws that same Markdown with the AI chat's export engine,
 * loaded only when someone exports (CompliancePaperworkPdf).
 */

export const NOT_LEGAL_ADVICE_ENGLISH: string =
  "OneUptime AI drafts these from what the scans found. They are a starting point, not legal advice: have them checked by whoever answers for your compliance.";

export interface PaperworkExportNames {
  // The PDF's title.
  pdfTitle: string;
  // What its files are named for (getExportFilename).
  fileLabel: string;
}

// A store's assessment, as its files are titled and named.
export function getImpactAssessmentExportNames(
  storeName: string,
): PaperworkExportNames {
  return {
    pdfTitle: `Data Protection Impact Assessment: ${storeName}`,
    fileLabel: `${storeName} impact assessment`,
  };
}

// A framework's evidence, as its files are titled and named.
export function getAuditEvidenceExportNames(
  framework: string,
): PaperworkExportNames {
  return {
    pdfTitle: `Audit Evidence: ${framework}`,
    fileLabel: `${framework} audit evidence`,
  };
}

// A date as the document writes it: YYYY-MM-DD.
function day(value: string | Date | undefined): string {
  if (!value) {
    return "";
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

// A cell of a Markdown table: one line, its pipes and backslashes kept as text.
function cell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/[\\|]/g, "\\$&").trim() || " ";
}

function table(headers: Array<string>, rows: Array<Array<string>>): string {
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers
      .map((): string => {
        return "---";
      })
      .join(" | ")} |`,
    ...rows.map((row: Array<string>): string => {
      return `| ${row.map(cell).join(" | ")} |`;
    }),
  ].join("\n");
}

// Why a store needs an assessment, in English.
export function describeTriggerInEnglish(
  trigger: ImpactAssessmentTriggerView,
): string {
  switch (trigger.trigger) {
    case ImpactAssessmentTrigger.SpecialCategory:
      return `It holds special category data: ${(trigger.categories || []).join(", ")}.`;
    case ImpactAssessmentTrigger.LargeScale:
      return `It holds data about many people: about ${trigger.records} records.`;
    case ImpactAssessmentTrigger.LeavesCountries:
      return `Its data leaves its people's countries: ${(
        trigger.transfers || []
      )
        .map((transfer: RecordTransfer): string => {
          return describeRecordTransfer(transfer);
        })
        .join("; ")}.`;
    default:
      return "";
  }
}

function factLines(facts: ReadonlyArray<ComplianceFact>): Array<string> {
  return facts.map((fact: ComplianceFact): string => {
    return `- **${fact.id}.** ${describeComplianceFact(fact)}`;
  });
}

// The assessment as one Markdown document.
export function getImpactAssessmentMarkdown(data: {
  assessment: DataSecurityImpactAssessmentResponse;
  exportedAt: Date;
}): string {
  const answer: DataSecurityImpactAssessmentResponse = data.assessment;
  const lines: Array<string> = [
    `# ${getImpactAssessmentExportNames(answer.storeName).pdfTitle}`,
    "",
    `${[answer.storeKind, answer.region].filter(Boolean).join(", ")}. Exported from OneUptime on ${day(data.exportedAt)}.`,
    "",
    `> ${NOT_LEGAL_ADVICE_ENGLISH}`,
    "",
  ];

  if (answer.triggers.length > 0) {
    lines.push("## Why this store needs one", "");

    for (const trigger of answer.triggers) {
      lines.push(`- ${describeTriggerInEnglish(trigger)}`);
    }

    lines.push("");
  }

  IMPACT_ASSESSMENT_PARTS.forEach(
    (part: ImpactAssessmentPart, index: number): void => {
      const section: ImpactAssessmentSection | undefined =
        answer.assessment?.sections[part];

      lines.push(
        `## ${index + 1}. ${IMPACT_ASSESSMENT_PART_TITLES[part]} (${IMPACT_ASSESSMENT_PART_ARTICLES[part]})`,
        "",
      );

      if (!section) {
        lines.push("_Not written yet._", "");
        return;
      }

      const by: string =
        section.source === ImpactAssessmentSectionSource.Edited
          ? `_Edited${
              section.editedByUserId && answer.editors[section.editedByUserId]
                ? ` by ${answer.editors[section.editedByUserId]}`
                : ""
            } on ${day(section.editedAt)}._`
          : `_Drafted by OneUptime AI on ${day(section.draftedAt)}._`;

      lines.push(by);

      if (answer.staleParts.includes(part)) {
        lines.push("", "_The facts it rests on changed since it was written._");
      }

      lines.push("", section.markdown, "");

      const cited: Array<string> = (answer.assessment?.facts || [])
        .filter((fact: ComplianceFact): boolean => {
          return section.factKeys.includes(fact.key);
        })
        .map((fact: ComplianceFact): string => {
          return fact.id;
        });

      if (cited.length > 0) {
        lines.push(`Rests on: ${cited.join(", ")}.`, "");
      }
    },
  );

  const facts: ReadonlyArray<ComplianceFact> = answer.assessment?.facts || [];

  if (facts.length > 0) {
    lines.push("## Facts", "", ...factLines(facts), "");
  }

  return lines.join("\n");
}

function evidenceStatus(
  requirement: DataSecurityAuditEvidenceRequirement,
): string {
  return requirement.status;
}

// One requirement's evidence: its paragraph - or its facts in words - then its facts.
function requirementMarkdown(
  requirement: DataSecurityAuditEvidenceRequirement,
  editors: Record<string, string>,
): Array<string> {
  const paragraph: AuditEvidenceParagraph | null = requirement.paragraph;
  const lines: Array<string> = [
    `## ${requirement.requirement} · ${requirement.title} (${evidenceStatus(requirement)})`,
    "",
  ];

  if (paragraph) {
    lines.push(
      paragraph.source === "Edited"
        ? `_Edited${
            paragraph.editedByUserId && editors[paragraph.editedByUserId]
              ? ` by ${editors[paragraph.editedByUserId]}`
              : ""
          } on ${day(paragraph.editedAt)}._`
        : `_Drafted by OneUptime AI on ${day(paragraph.draftedAt)}._`,
      "",
    );

    if (requirement.isParagraphStale) {
      lines.push("_The facts it rests on changed since it was written._", "");
    }

    lines.push(paragraph.text, "");
  } else if (requirement.summary) {
    lines.push(requirement.summary, "");
  }

  if (requirement.facts.length > 0) {
    lines.push("Evidence:", "", ...factLines(requirement.facts), "");
  }

  return lines;
}

// The framework's evidence as one Markdown document, with its two appendices.
export function getAuditEvidenceMarkdown(data: {
  evidence: DataSecurityAuditEvidenceResponse;
  exportedAt: Date;
}): string {
  const evidence: DataSecurityAuditEvidenceResponse = data.evidence;
  const lines: Array<string> = [
    `# Audit Evidence: ${evidence.framework}, ${evidence.fullName}`,
    "",
    `Scope: ${evidence.scope} Period: the last ${evidence.periodInDays} days, to ${day(data.exportedAt)}. Score: ${
      evidence.score === null ? "not evaluated" : `${evidence.score}%`
    }. ${evidence.storesInScope} ${evidence.storesInScope === 1 ? "store" : "stores"} in scope. Exported from OneUptime on ${day(data.exportedAt)}.`,
    "",
    `> ${NOT_LEGAL_ADVICE_ENGLISH}`,
    "",
  ];

  for (const requirement of evidence.requirements) {
    lines.push(...requirementMarkdown(requirement, evidence.editors));
  }

  lines.push("## Appendix A: Record of Processing", "");

  if (evidence.record.length === 0) {
    lines.push("No store in scope holds personal data.", "");
  } else {
    lines.push(
      table(
        [
          "Data Store",
          "Purpose",
          "Legal Basis",
          "People",
          "Retention",
          "Recipients",
          "Transfers",
        ],
        evidence.record.map(
          (row: DataSecurityRecordOfProcessingRow): Array<string> => {
            return [
              row.name,
              row.purpose,
              row.legalBasis || "",
              (row.dataSubjects || []).join(", "),
              row.retention,
              (row.recipients || [])
                .map((recipient: RecordRecipient): string => {
                  return describeRecordRecipient(recipient);
                })
                .join("; "),
              (row.transfers || [])
                .map((transfer: RecordTransfer): string => {
                  return describeRecordTransfer(transfer);
                })
                .join("; "),
            ];
          },
        ),
      ),
      "",
    );
  }

  lines.push("## Appendix B: Issue History", "");

  if (evidence.issueHistory.length === 0) {
    lines.push("No issue of its checks opened or was fixed in the period.", "");
  } else {
    lines.push(
      table(
        [
          "Issue",
          "Data Store",
          "Check",
          "Severity",
          "Status",
          "Opened",
          "Fixed",
          "Hours to Fix",
        ],
        evidence.issueHistory.map(
          (issue: DataSecurityEvidenceIssue): Array<string> => {
            return [
              issue.title,
              issue.storeName,
              issue.checkId,
              issue.severity,
              issue.status,
              day(issue.openedAt),
              day(issue.resolvedAt),
              issue.hoursToFix !== undefined ? String(issue.hoursToFix) : "",
            ];
          },
        ),
      ),
      "",
    );
  }

  return lines.join("\n");
}

// A document's Markdown, downloaded as a file.
export function downloadMarkdown(data: {
  markdown: string;
  label: string;
  exportedAt: Date;
}): void {
  downloadFile({
    content: data.markdown,
    filename: getExportFilename({
      label: data.label,
      extension: "md",
      exportedAt: data.exportedAt,
    }),
    mimeType: "text/markdown;charset=utf-8;",
  });
}

// A document's Markdown as a PDF: the engine is fetched only now, when someone exports.
export async function downloadMarkdownPdf(data: {
  title: string;
  markdown: string;
  label: string;
  exportedAt: Date;
}): Promise<void> {
  const { buildMarkdownPdf } = await import("./CompliancePaperworkPdf");
  const blob: Blob = await buildMarkdownPdf({
    title: data.title,
    markdown: data.markdown,
  });

  downloadFile({
    content: blob,
    filename: getExportFilename({
      label: data.label,
      extension: "pdf",
      exportedAt: data.exportedAt,
    }),
  });
}
