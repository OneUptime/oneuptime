import { describe, expect, test } from "@jest/globals";
import { AuditEvidenceParagraphSource } from "Common/Types/DataSecurity/AuditEvidence";
import ComplianceFramework from "Common/Types/DataSecurity/ComplianceFramework";
import {
  ComplianceFact,
  ComplianceFactKind,
} from "Common/Types/DataSecurity/ComplianceFacts";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import {
  DataSecurityAuditEvidenceResponse,
  DataSecurityImpactAssessmentResponse,
  DataSecurityRecordOfProcessingRow,
  ImpactAssessmentStatus,
  RecordRowState,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  ImpactAssessmentPart,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
} from "Common/Types/DataSecurity/ImpactAssessment";
import {
  RecordField,
  RecordFieldStatus,
  RecordLegalBasis,
  RecordPeople,
  RecordRecipientKind,
  RecordTransferRoute,
  RecordTransfersUnknownReason,
} from "Common/Types/DataSecurity/RecordOfProcessing";
import {
  ExportedRecordRow,
  getFieldsWaitingForReview,
  getRecordOfProcessingCsv,
  getRecordOfProcessingJson,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/ComplianceExport";
import {
  NOT_LEGAL_ADVICE_ENGLISH,
  getAuditEvidenceMarkdown,
  getImpactAssessmentMarkdown,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/CompliancePaperworkExport";
import { NOT_LEGAL_ADVICE } from "../../FeatureSet/Dashboard/src/Components/DataSecurity/ComplianceDraftsCopy";

/*
 * THE COMPLIANCE PAPERWORK AS FILES (#10375): a store's impact assessment
 * and a framework's audit evidence as one Markdown document each - what
 * the PDF draws too - and the record's CSV and JSON with what Article 30
 * asks besides purpose and retention. "Not legal advice" is said once in
 * each document; a draft nobody confirmed is never in the record's files.
 */

const EXPORTED_AT: Date = new Date("2026-11-23T12:00:00.000Z");
const STORE_ID: string = "10375000-0000-4000-8000-00000000e001";

const HOLDS: ComplianceFact = {
  id: "F1",
  key: "store:holds",
  kind: ComplianceFactKind.StoreHolds,
  dataTypes: ["Diagnosis code"],
  categories: [DataCategory.Health],
  sensitivity: "Restricted",
  records: 250000,
};

function rowOf(
  overrides: Partial<DataSecurityRecordOfProcessingRow> = {},
): DataSecurityRecordOfProcessingRow {
  return {
    dataStoreId: STORE_ID,
    name: "patients-db",
    kind: DataStoreKind.AwsRdsInstance,
    provider: "aws",
    region: "us-east-1",
    environment: "Production",
    sensitivity: DataSensitivity.Restricted,
    dataCategories: [DataCategory.Health],
    dataTypeNames: ["Diagnosis code"],
    owners: ["Jane Doe"],
    purpose: "Clinical care",
    retention: "Ten years after the last visit",
    frameworks: [ComplianceFramework.GDPR, ComplianceFramework.HIPAA],
    legalBasis: RecordLegalBasis.LegalObligation,
    dataSubjects: [RecordPeople.Patients],
    recipients: [
      {
        kind: RecordRecipientKind.ExternalHost,
        name: "api.labs.example",
        via: ["results"],
      },
    ],
    transfers: [
      {
        route: RecordTransferRoute.Store,
        fromCountries: ["DE"],
        toCountry: "US",
        toRegion: "us-east-1",
        leavesEea: true,
      },
    ],
    transfersUnknownBecause: null,
    impactAssessment: {
      status: ImpactAssessmentStatus.Drafted,
      triggers: [],
    },
    state: RecordRowState.ToReview,
    fields: [
      {
        field: RecordField.Purpose,
        status: RecordFieldStatus.Written,
        value: "Clinical care",
      },
      {
        field: RecordField.People,
        status: RecordFieldStatus.Drafted,
        value: [],
        draft: {
          value: [RecordPeople.Patients, RecordPeople.Children],
          reason: "A pediatric clinic.",
          factKeys: [HOLDS.key],
          factsHash: "hash",
          draftedAt: "2026-11-22T08:00:00.000Z",
          language: "en",
        },
      },
    ],
    facts: [HOLDS],
    ...overrides,
  };
}

function assessmentOf(): DataSecurityImpactAssessmentResponse {
  return {
    dataStoreId: STORE_ID,
    storeName: "patients-db",
    storeKind: DataStoreKind.AwsRdsInstance,
    region: "us-east-1",
    status: ImpactAssessmentStatus.Edited,
    triggers: [
      {
        trigger: ImpactAssessmentTrigger.SpecialCategory,
        categories: [DataCategory.Health],
      },
      { trigger: ImpactAssessmentTrigger.LargeScale, records: 250000 },
    ],
    assessment: {
      version: 1,
      language: "en",
      facts: [HOLDS],
      triggers: [ImpactAssessmentTrigger.SpecialCategory],
      draftedAt: "2026-11-22T08:00:00.000Z",
      sections: {
        [ImpactAssessmentPart.Processing]: {
          part: ImpactAssessmentPart.Processing,
          markdown: "Diagnosis codes of about 250,000 patients, for care.",
          source: ImpactAssessmentSectionSource.Drafted,
          factKeys: [HOLDS.key],
          draftedAt: "2026-11-22T08:00:00.000Z",
        },
        [ImpactAssessmentPart.Risks]: {
          part: ImpactAssessmentPart.Risks,
          markdown: "- Our own words about the risks.",
          source: ImpactAssessmentSectionSource.Edited,
          factKeys: [],
          editedAt: "2026-11-23T09:00:00.000Z",
          editedByUserId: "user-1",
        },
      },
    },
    facts: [HOLDS],
    staleParts: [ImpactAssessmentPart.Processing],
    editors: { "user-1": "Jane Doe" },
    isAiEnabled: true,
    canEdit: true,
    canDraft: true,
  };
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("an impact assessment, exported", () => {
  const markdown: string = getImpactAssessmentMarkdown({
    assessment: assessmentOf(),
    exportedAt: EXPORTED_AT,
  });

  test("says what it is, why the store needs one, and that it is not legal advice - once", () => {
    expect(markdown).toContain(
      "# Data Protection Impact Assessment: patients-db",
    );
    expect(markdown).toContain("Exported from OneUptime on 2026-11-23.");
    expect(markdown).toContain("- It holds special category data: Health.");
    expect(markdown).toContain(
      "- It holds data about many people: about 250000 records.",
    );
    expect(count(markdown, NOT_LEGAL_ADVICE_ENGLISH)).toBe(1);
    // The page says the same words, in the reader's language.
    expect(NOT_LEGAL_ADVICE_ENGLISH).toBe(NOT_LEGAL_ADVICE);
  });

  test("has Article 35(7)'s four parts in order: who wrote each, its words and the facts a draft rests on", () => {
    const headings: Array<string> = markdown
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ");
      });

    expect(headings).toEqual([
      "## Why this store needs one",
      "## 1. The Processing and Its Purposes (Art. 35(7)(a))",
      "## 2. Necessity and Proportionality (Art. 35(7)(b))",
      "## 3. Risks to the People It Is About (Art. 35(7)(c))",
      "## 4. Measures That Address the Risks (Art. 35(7)(d))",
      "## Facts",
    ]);
    expect(markdown).toContain("_Drafted by OneUptime AI on 2026-11-22._");
    expect(markdown).toContain(
      "_The facts it rests on changed since it was written._",
    );
    expect(markdown).toContain("Rests on: F1.");
    expect(markdown).toContain("_Edited by Jane Doe on 2026-11-23._");
    expect(markdown).toContain("- Our own words about the risks.");
    expect(count(markdown, "_Not written yet._")).toBe(2);
    expect(markdown).toContain("- **F1.** ");
  });
});

describe("a framework's audit evidence, exported", () => {
  const evidence: DataSecurityAuditEvidenceResponse = {
    framework: ComplianceFramework.SOC2,
    fullName: "SOC 2 Trust Services Criteria",
    scope: "Every data store.",
    score: 50,
    storesInScope: 2,
    periodInDays: 90,
    requirements: [
      {
        requirement: "A1.2",
        title: "Backup and recovery",
        status: ComplianceRequirementStatus.Passing,
        facts: [
          {
            id: "E1",
            key: "A1.2:scope",
            kind: ComplianceFactKind.RequirementScope,
            stores: 2,
            storeNames: ["patients-db", "orders-db"],
            framework: ComplianceFramework.SOC2,
            requirement: "A1.2",
          },
        ],
        paragraph: {
          requirement: "A1.2",
          text: "Both stores in scope are backed up.",
          source: AuditEvidenceParagraphSource.Drafted,
          factKeys: ["A1.2:scope"],
          draftedAt: "2026-11-22T08:00:00.000Z",
        },
        isParagraphStale: false,
        summary: "2 stores are in its scope.",
      },
      {
        requirement: "CC6.1",
        title: "Logical access security",
        status: ComplianceRequirementStatus.Failing,
        facts: [],
        paragraph: null,
        isParagraphStale: false,
        summary: "16 checks; 1 fails on 1 store, with 1 open issue.",
      },
    ],
    record: [rowOf({ purpose: "Clinical | research" })],
    issueHistory: [
      {
        issueId: "i1",
        title: "Public read access",
        storeName: "orders-db",
        checkId: "public-read",
        severity: "Critical",
        status: "Resolved",
        openedAt: "2026-10-01T00:00:00.000Z",
        resolvedAt: "2026-10-02T06:00:00.000Z",
        hoursToFix: 30,
      },
    ],
    editors: {},
    isAiEnabled: true,
    canEdit: true,
    canDraft: true,
  };
  const markdown: string = getAuditEvidenceMarkdown({
    evidence,
    exportedAt: EXPORTED_AT,
  });

  test("a paragraph under each requirement, or its facts in words, with the evidence it rests on", () => {
    expect(markdown).toContain(
      "# Audit Evidence: SOC 2, SOC 2 Trust Services Criteria",
    );
    expect(markdown).toContain("Period: the last 90 days, to 2026-11-23.");
    expect(markdown).toContain("## A1.2 · Backup and recovery (Passing)");
    expect(markdown).toContain("Both stores in scope are backed up.");
    expect(markdown).toContain("- **E1.** ");
    expect(markdown).toContain("## CC6.1 · Logical access security (Failing)");
    expect(markdown).toContain(
      "16 checks; 1 fails on 1 store, with 1 open issue.",
    );
    expect(count(markdown, NOT_LEGAL_ADVICE_ENGLISH)).toBe(1);
  });

  test("its two appendices: the record of the stores in scope and the issue history, as tables", () => {
    expect(markdown).toContain("## Appendix A: Record of Processing");
    expect(markdown).toContain(
      "| Data Store | Purpose | Legal Basis | People | Retention | Recipients | Transfers |",
    );
    // A pipe in a team's words stays text, not a new cell.
    expect(markdown).toContain(
      "| patients-db | Clinical \\| research | Legal obligation | Patients | Ten years after the last visit | api.labs.example (outside host, via results) | Germany to United States (us-east-1) |",
    );
    expect(markdown).toContain("## Appendix B: Issue History");
    expect(markdown).toContain(
      "| Public read access | orders-db | public-read | Critical | Resolved | 2026-10-01 | 2026-10-02 | 30 |",
    );
  });
});

describe("the record of processing's files", () => {
  test("the CSV adds what Article 30 asks after the columns a spreadsheet already reads", () => {
    const lines: Array<string> = getRecordOfProcessingCsv([rowOf()]).split(
      "\r\n",
    );

    expect(lines[0]).toBe(
      "Data Store,Kind,Provider,Region,Environment,Sensitivity,Data Categories,Data Types,Owners,Purpose,Retention,Who Can Read,Frameworks,Declared By,Legal Basis,People It Is About,Recipients,Transfers,Impact Assessment,Waiting for Review",
    );
    expect(lines[1]).toContain(
      ',Legal obligation,Patients,"api.labs.example (outside host, via results)",Germany to United States (us-east-1),Drafted,People It Is About',
    );
  });

  test("a store whose transfers are not known says why", () => {
    const line: string = getRecordOfProcessingCsv([
      rowOf({
        transfers: [],
        transfersUnknownBecause:
          RecordTransfersUnknownReason.NoSubjectCountries,
      }),
    ]).split("\r\n")[1]!;

    expect(line).toContain(
      "Not known: no data type it holds says which country its people are in.",
    );
  });

  test("the JSON leaves out the drafts and the facts they rest on, and names the fields waiting for a person", () => {
    const json: { rows: Array<ExportedRecordRow> } = JSON.parse(
      getRecordOfProcessingJson([rowOf()], EXPORTED_AT),
    );
    const row: ExportedRecordRow = json.rows[0]!;

    expect(row).not.toHaveProperty("fields");
    expect(row).not.toHaveProperty("facts");
    expect(row.waitingForReview).toEqual(["People It Is About"]);
    expect(row.dataSubjects).toEqual([RecordPeople.Patients]);
    expect(JSON.stringify(json)).not.toContain(RecordPeople.Children);
    expect(getFieldsWaitingForReview(rowOf({ fields: [] }))).toEqual([]);
  });
});
