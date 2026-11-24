import { holdRecordDraftToFacts } from "../../../../Server/Utils/AI/DataSecurity/RecordOfProcessingPrompt";
import {
  buildEvidenceIssueHistory,
  buildRequirementEvidence,
  median,
} from "../../../../Server/Utils/DataSecurity/AuditEvidenceReader";
import {
  buildRecordRow,
  countRecordRows,
  getImpactAssessmentStatus,
} from "../../../../Server/Utils/DataSecurity/RecordOfProcessingReader";
import {
  AiEvidenceRequirement,
  AiStoreRecord,
} from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import {
  ComplianceFact,
  ComplianceFactKind,
  TelemetryRetentionSignal,
  getFactsHash,
} from "../../../../Types/DataSecurity/ComplianceFacts";
import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityDeclaredStore,
  DataSecurityEvidenceIssue,
  DataSecurityRecordOfProcessingRow,
  ImpactAssessmentStatus,
  RecordRowState,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
} from "../../../../Types/DataSecurity/DeclaredDataStore";
import {
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
} from "../../../../Types/DataSecurity/ImpactAssessment";
import {
  RecordField,
  RecordFieldDraft,
  RecordFieldStatus,
  RecordFieldView,
  RecordLegalBasis,
  RecordPeople,
  RecordRecipientKind,
  StoreRecordDrafts,
  emptyStoreRecordDrafts,
  getRecordValueHash,
  toStoreRecordDraftsJson,
} from "../../../../Types/DataSecurity/RecordOfProcessing";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE COMPLIANCE PAPERWORK'S ROWS, BY PLAIN CODE (#10375): a store's row of
 * the record - each field's standing, what plain code fills in, recipients,
 * transfers and whether it needs an impact assessment - what OneUptime AI's
 * record draft keeps of its answer, and a requirement's evidence: every
 * number counted here, never by a model.
 */

const NOW: Date = new Date("2026-11-23T10:00:00.000Z");
const STORE_ID: ObjectID = new ObjectID("10375000-0000-4000-8000-00000000c001");
const COPY_ID: string = "10375000-0000-4000-8000-00000000c002";
const SERVICE_ID: string = "10375000-0000-4000-8000-00000000d001";

const HOLDS: ComplianceFact = {
  id: "F1",
  key: "store:holds",
  kind: ComplianceFactKind.StoreHolds,
  dataTypes: ["Email address"],
  categories: [DataCategory.ContactAndIdentity],
  sensitivity: "Confidential",
  records: 12000,
};
const CHECKOUT: ComplianceFact = {
  id: "F2",
  key: `service:${SERVICE_ID}`,
  kind: ComplianceFactKind.ServiceUse,
  service: "checkout",
  description: "Takes customers' orders",
};
const RETENTION: ComplianceFact = {
  id: "F3",
  key: "store:retention",
  kind: ComplianceFactKind.TelemetryRetention,
  signal: TelemetryRetentionSignal.Logs,
  days: 15,
};
const FACTS: Array<ComplianceFact> = [HOLDS, CHECKOUT];

function draftOf(
  value: RecordFieldDraft["value"],
  keys: Array<string>,
): RecordFieldDraft {
  return {
    value,
    reason: "Customers' orders are a contract with them.",
    factKeys: keys,
    factsHash: getFactsHash({ facts: FACTS, keys }),
    draftedAt: "2026-11-22T08:00:00.000Z",
    language: "en",
  };
}

function storeOf(
  data: Partial<DataStore> & { drafts?: StoreRecordDrafts },
): DataStore {
  const store: DataStore = new DataStore();

  store.id = STORE_ID;
  store.name = "orders-db";
  store.kind = DataStoreKind.AwsRdsInstance;
  store.provider = "aws";
  store.region = "us-east-1";
  store.environment = DataStoreEnvironment.Production;
  store.dataCategories = [DataCategory.ContactAndIdentity];
  store.dataTypeIds = [];
  store.subjectCountries = ["DE"];
  Object.assign(store, data);

  if (data.drafts) {
    store.recordDrafts = toStoreRecordDraftsJson(data.drafts) as JSONObject;
  }

  return store;
}

function rowOf(
  store: DataStore,
  extra: {
    declared?: DataSecurityDeclaredStore | null;
    withFacts?: boolean;
    telemetry?: boolean;
  } = {},
): DataSecurityRecordOfProcessingRow {
  return buildRecordRow({
    store,
    owners: ["Jane Doe"],
    dataTypeNames: ["Email address"],
    declared: extra.declared || null,
    flows: [
      {
        kind: "Uses",
        sourceDataStoreId: STORE_ID.toString(),
        serviceId: SERVICE_ID,
      },
      {
        kind: "External Host",
        serviceId: SERVICE_ID,
        destination: "api.stripe.com",
      },
      {
        kind: "Copy",
        sourceDataStoreId: STORE_ID.toString(),
        destinationDataStoreId: COPY_ID,
      },
    ],
    storeNames: new Map([
      [STORE_ID.toString().toLowerCase(), "orders-db"],
      [COPY_ID, "orders-analytics"],
    ]),
    storeRegions: new Map([[COPY_ID, "eu-west-1"]]),
    serviceNames: new Map([[SERVICE_ID, "checkout"]]),
    telemetryRetention: extra.telemetry
      ? { signal: TelemetryRetentionSignal.Logs, days: 15, maxDays: 90 }
      : null,
    withFacts: extra.withFacts,
  });
}

function statusOf(
  row: DataSecurityRecordOfProcessingRow,
  field: RecordField,
): RecordFieldStatus | undefined {
  return (row.fields || []).find((view: RecordFieldView): boolean => {
    return view.field === field;
  })?.status;
}

describe("a store's row of the record", () => {
  test("a draft waits beside an empty field and is not in the record; the person's words are", () => {
    const drafts: StoreRecordDrafts = {
      ...emptyStoreRecordDrafts(),
      facts: FACTS,
      fields: {
        [RecordField.LegalBasis]: {
          draft: draftOf(RecordLegalBasis.Contract, [CHECKOUT.key]),
        },
        [RecordField.People]: {
          draft: draftOf([RecordPeople.Customers], [HOLDS.key]),
        },
      },
    };
    const row: DataSecurityRecordOfProcessingRow = rowOf(
      storeOf({
        purpose: "Orders, for fulfilment",
        retention: "Two years",
        drafts,
      }),
      { withFacts: true },
    );

    expect(statusOf(row, RecordField.Purpose)).toBe(RecordFieldStatus.Written);
    expect(statusOf(row, RecordField.Retention)).toBe(
      RecordFieldStatus.Written,
    );
    expect(statusOf(row, RecordField.LegalBasis)).toBe(
      RecordFieldStatus.Drafted,
    );
    expect(statusOf(row, RecordField.People)).toBe(RecordFieldStatus.Drafted);
    // The record says only what a person wrote.
    expect(row.legalBasis).toBe("");
    expect(row.dataSubjects).toEqual([]);
    expect(row.purpose).toBe("Orders, for fulfilment");
    expect(row.state).toBe(RecordRowState.ToReview);
    expect(row.facts).toEqual(FACTS);
  });

  test("the whole record leaves the facts out; one store's row carries them", () => {
    expect(rowOf(storeOf({})).facts).toBeUndefined();
  });

  test("a confirmed field whose facts changed shows the change proposed, and what changed", () => {
    const confirmedFacts: Array<ComplianceFact> = [
      HOLDS,
      { ...CHECKOUT, description: "Old words" },
    ];
    const drafts: StoreRecordDrafts = {
      ...emptyStoreRecordDrafts(),
      facts: FACTS,
      fields: {
        [RecordField.Purpose]: {
          confirmed: {
            valueHash: getRecordValueHash("Orders"),
            factKeys: [CHECKOUT.key],
            factsHash: getFactsHash({
              facts: confirmedFacts,
              keys: [CHECKOUT.key],
            }),
            facts: [confirmedFacts[1]!],
            confirmedAt: "2026-11-01T08:00:00.000Z",
          },
          proposed: draftOf("Customer orders and their payments", [
            CHECKOUT.key,
          ]),
        },
      },
    };
    const row: DataSecurityRecordOfProcessingRow = rowOf(
      storeOf({ purpose: "Orders", drafts }),
    );
    const purpose: RecordFieldView | undefined = (row.fields || []).find(
      (view: RecordFieldView): boolean => {
        return view.field === RecordField.Purpose;
      },
    );

    expect(purpose?.status).toBe(RecordFieldStatus.ChangeProposed);
    expect(purpose?.value).toBe("Orders");
    expect(purpose?.changedFactKeys).toEqual([CHECKOUT.key]);
    expect(row.purpose).toBe("Orders");
  });

  test("a telemetry store's retention is filled in from the project's settings, never drafted", () => {
    const row: DataSecurityRecordOfProcessingRow = rowOf(
      storeOf({ kind: DataStoreKind.TelemetryLogs }),
      { telemetry: true },
    );

    expect(statusOf(row, RecordField.Retention)).toBe(
      RecordFieldStatus.FilledIn,
    );
    expect(row.retention).toBe("15 days, some records up to 90 days");
    expect(row.telemetryRetention).toEqual({
      signal: TelemetryRetentionSignal.Logs,
      days: 15,
      maxDays: 90,
    });
  });

  test("recipients and transfers are worked out from its flows and regions", () => {
    const row: DataSecurityRecordOfProcessingRow = rowOf(storeOf({}));

    expect(
      (row.recipients || []).map(
        (recipient: { kind: RecordRecipientKind; name: string }) => {
          return [recipient.kind, recipient.name];
        },
      ),
    ).toEqual([
      [RecordRecipientKind.ExternalHost, "api.stripe.com"],
      [RecordRecipientKind.Copy, "orders-analytics"],
    ]);
    // Germans' data in the United States leaves the EEA; its Irish copy does not.
    expect(row.transfers).toEqual([
      {
        route: "Store",
        fromCountries: ["DE"],
        toCountry: "US",
        toRegion: "us-east-1",
        leavesEea: true,
      },
    ]);
    expect(row.impactAssessment).toEqual({
      status: ImpactAssessmentStatus.Needed,
      triggers: [
        {
          trigger: ImpactAssessmentTrigger.LeavesCountries,
          transfers: row.transfers,
        },
      ],
    });
  });

  test("a store OneUptime declares is on legitimate interests until the team picks a basis, and counts as none", () => {
    const declared: DataSecurityDeclaredStore = {
      kind: DataStoreKind.SecurityEvents,
      purpose: "Network and information security (GDPR Recital 49)",
      retentionInDays: 15,
      retentionBasis: DeclaredStoreRetentionBasis.SecurityEvents,
      retentionText: "15 days",
      isPurposeTheTeams: false,
      isRetentionTheTeams: false,
      readers: DeclaredStoreReaders.Roles,
      readPermissions: [],
      readerNames: [],
      dataTypeNames: [],
      fields: [],
    };
    const row: DataSecurityRecordOfProcessingRow = rowOf(
      storeOf({ kind: DataStoreKind.SecurityEvents, subjectCountries: [] }),
      { declared },
    );

    expect(row.legalBasis).toBe(RecordLegalBasis.LegitimateInterests);
    expect(statusOf(row, RecordField.LegalBasis)).toBe(
      RecordFieldStatus.FilledIn,
    );
    expect(row.state).toBe(RecordRowState.Declared);
    expect(row.impactAssessment?.status).toBe(ImpactAssessmentStatus.NotNeeded);
    expect(countRecordRows([row])).toEqual({
      toReview: 0,
      complete: 0,
      incomplete: 0,
    });
  });

  test("counts the stores waiting for a person, the complete and the incomplete", () => {
    const complete: DataSecurityRecordOfProcessingRow = rowOf(
      storeOf({
        purpose: "Orders",
        retention: "Two years",
        legalBasis: RecordLegalBasis.Contract,
        dataSubjects: [RecordPeople.Customers],
      }),
    );
    const incomplete: DataSecurityRecordOfProcessingRow = rowOf(
      storeOf({ purpose: "Orders" }),
    );

    expect(complete.state).toBe(RecordRowState.Complete);
    expect(incomplete.state).toBe(RecordRowState.Incomplete);
    expect(countRecordRows([complete, incomplete, incomplete])).toEqual({
      toReview: 0,
      complete: 1,
      incomplete: 2,
    });
  });

  test("an assessment is Drafted until a person edits a part of it", () => {
    expect(getImpactAssessmentStatus({ triggers: [], assessment: null })).toBe(
      ImpactAssessmentStatus.NotNeeded,
    );
    const assessment: Parameters<
      typeof getImpactAssessmentStatus
    >[0]["assessment"] = {
      version: 1,
      language: "en",
      facts: [],
      triggers: [],
      sections: {
        processing: {
          part: "processing" as never,
          markdown: "Words",
          source: ImpactAssessmentSectionSource.Drafted,
          factKeys: [],
        },
      },
    };

    expect(getImpactAssessmentStatus({ triggers: [], assessment })).toBe(
      ImpactAssessmentStatus.Drafted,
    );
    assessment!.sections.processing!.source =
      ImpactAssessmentSectionSource.Edited;
    expect(getImpactAssessmentStatus({ triggers: [], assessment })).toBe(
      ImpactAssessmentStatus.Edited,
    );
  });
});

describe("what OneUptime AI's record draft keeps of its answer", () => {
  const facts: Array<ComplianceFact> = [HOLDS, CHECKOUT, RETENTION];

  test("each field it was asked, held to the facts it cites", () => {
    const drafts: Partial<Record<RecordField, RecordFieldDraft>> =
      holdRecordDraftToFacts({
        answer: {
          purpose: {
            text: "Customers' orders, for fulfilment (F2).",
            facts: ["F2"],
          },
          retention: { text: "15 days", facts: ["F3"] },
          legalBasis: {
            value: RecordLegalBasis.Contract,
            reason: "Orders are taken to fulfil a contract with the customer.",
            facts: ["F2"],
          },
          people: {
            value: [RecordPeople.Customers, "Aliens"],
            reason: "The store holds customers' email addresses.",
            facts: ["F1"],
          },
        },
        fields: [
          RecordField.Purpose,
          RecordField.LegalBasis,
          RecordField.People,
        ],
        facts,
        language: "en",
        now: NOW,
      });

    expect(Object.keys(drafts).sort()).toEqual(
      [RecordField.LegalBasis, RecordField.People, RecordField.Purpose].sort(),
    );
    expect(drafts[RecordField.Purpose]?.value).toBe(
      "Customers' orders, for fulfilment.",
    );
    expect(drafts[RecordField.People]?.value).toEqual([RecordPeople.Customers]);
    expect(drafts[RecordField.LegalBasis]).toMatchObject({
      value: RecordLegalBasis.Contract,
      factKeys: [CHECKOUT.key],
      draftedAt: NOW.toISOString(),
    });
  });

  test("drops a basis that is not Article 6's, a field resting on nothing, and a number no fact holds", () => {
    expect(
      holdRecordDraftToFacts({
        answer: {
          purpose: { text: "Orders, kept for 7 years by law.", facts: ["F2"] },
          retention: { text: "Two years", facts: [] },
          legalBasis: {
            value: "Because we can",
            reason: "It is useful to us.",
            facts: ["F2"],
          },
          people: {
            value: [RecordPeople.Customers],
            reason: "About 99 customers.",
            facts: ["F1"],
          },
        },
        fields: [
          RecordField.Purpose,
          RecordField.Retention,
          RecordField.LegalBasis,
          RecordField.People,
        ],
        facts,
        language: "en",
        now: NOW,
      }),
    ).toEqual({});
  });
});

describe("a requirement's evidence, counted", () => {
  const backups: DataSecurityCheckInfo = getDataSecurityCheck("no-backups")!;
  const pitr: DataSecurityCheckInfo = getDataSecurityCheck(
    "no-point-in-time-recovery",
  )!;
  const since: Date = new Date("2026-08-25T00:00:00.000Z");
  const A: string = "10375000-0000-4000-8000-0000000000a1";
  const B: string = "10375000-0000-4000-8000-0000000000b1";
  const HIDDEN: string = "10375000-0000-4000-8000-0000000000c1";

  test("opened and fixed in the period, how fast at the median, what is open, and the risks accepted - on the stores in scope", () => {
    const evidence: AiEvidenceRequirement = buildRequirementEvidence({
      requirement: {
        requirement: "A1.2",
        title: "Backup and recovery",
        status: ComplianceRequirementStatus.Failing,
        checkIds: [backups.id, pitr.id],
        failingIssueCount: 1,
      },
      checks: [backups, pitr],
      stores: [
        { id: A, name: "orders-db" },
        { id: B, name: "payroll" },
        { id: HIDDEN, name: "secret-store" },
      ],
      readable: new Set([A, B]),
      issues: [
        {
          id: "i1",
          title: "No backups",
          checkId: backups.id,
          severity: "High",
          status: DataSecurityIssueStatus.Resolved,
          storeId: A,
          firstDetectedAt: "2026-09-01T00:00:00.000Z",
          resolvedAt: "2026-09-02T00:00:00.000Z",
        },
        {
          id: "i2",
          title: "No point-in-time recovery",
          checkId: pitr.id,
          severity: "Medium",
          status: DataSecurityIssueStatus.Resolved,
          storeId: B,
          firstDetectedAt: "2026-10-01T00:00:00.000Z",
          resolvedAt: "2026-10-04T00:00:00.000Z",
        },
        {
          id: "i3",
          title: "No backups",
          checkId: backups.id,
          severity: "High",
          status: DataSecurityIssueStatus.Open,
          storeId: HIDDEN,
          firstDetectedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "i4",
          title: "No point-in-time recovery",
          checkId: pitr.id,
          severity: "Medium",
          status: DataSecurityIssueStatus.Accepted,
          storeId: B,
          firstDetectedAt: "2026-06-01T00:00:00.000Z",
          acceptedReason: "Rebuilt from the warehouse every night",
          acceptedUntil: "2027-01-31T00:00:00.000Z",
        },
        // Another requirement's check: not this one's evidence.
        {
          id: "i5",
          title: "Public read access",
          checkId: "public-read",
          severity: "Critical",
          status: DataSecurityIssueStatus.Open,
          storeId: A,
          firstDetectedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      turnedOff: [],
      since,
    });

    expect(evidence).toMatchObject({
      requirement: "A1.2",
      checks: 2,
      failingChecks: [backups.title],
      failingStores: 1,
      openIssues: 1,
      opened: 2,
      fixed: 2,
      stillOpen: 1,
      // 24 and 72 hours.
      medianHoursToFix: 48,
    });
    // A store the reader may not read is counted, never named.
    expect(
      evidence.stores.map((store: AiStoreRecord): string | undefined => {
        return store.name;
      }),
    ).toEqual(["orders-db", "payroll"]);
    expect(evidence.acceptedRisks).toHaveLength(1);
    expect(evidence.acceptedRisks[0]!.storeName).toBe("payroll");
  });

  test("the issue history lists what opened or was fixed in the period on readable stores, the latest first", () => {
    const history: Array<DataSecurityEvidenceIssue> = buildEvidenceIssueHistory(
      {
        issues: [
          {
            id: "old-fixed-now",
            title: "No backups",
            checkId: backups.id,
            severity: "High",
            status: DataSecurityIssueStatus.Resolved,
            storeId: A,
            firstDetectedAt: "2026-07-01T00:00:00.000Z",
            resolvedAt: "2026-09-01T06:00:00.000Z",
          },
          {
            id: "new-open",
            title: "No backups",
            checkId: backups.id,
            severity: "High",
            status: DataSecurityIssueStatus.Open,
            storeId: A,
            firstDetectedAt: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "old-open",
            title: "No backups",
            checkId: backups.id,
            severity: "High",
            status: DataSecurityIssueStatus.Open,
            storeId: A,
            firstDetectedAt: "2026-07-01T00:00:00.000Z",
          },
          {
            id: "hidden",
            title: "No backups",
            checkId: backups.id,
            severity: "High",
            status: DataSecurityIssueStatus.Open,
            storeId: HIDDEN,
            firstDetectedAt: "2026-11-01T00:00:00.000Z",
          },
        ],
        storeNames: new Map([[A, "orders-db"]]),
        readable: new Set([A]),
        since,
      },
    );

    expect(
      history.map((issue: DataSecurityEvidenceIssue) => {
        return issue.issueId;
      }),
    ).toEqual(["new-open", "old-fixed-now"]);
    expect(history[1]).toMatchObject({
      storeName: "orders-db",
      openedAt: "2026-07-01T00:00:00.000Z",
      resolvedAt: "2026-09-01T06:00:00.000Z",
      hoursToFix: 1494,
    });
    expect(history[0]!.hoursToFix).toBeUndefined();
  });

  test("the median of nothing is nothing", () => {
    expect(median([])).toBeUndefined();
    expect(median([5])).toBe(5);
    expect(median([1, 9, 3])).toBe(3);
  });
});
