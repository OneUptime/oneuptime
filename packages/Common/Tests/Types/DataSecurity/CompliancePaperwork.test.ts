import {
  AuditEvidenceParagraph,
  AuditEvidenceParagraphSource,
  EVIDENCE_REQUIREMENT_UNKNOWN_MESSAGE,
  FrameworkAuditEvidence,
  editAuditEvidenceParagraph,
  holdAuditEvidenceToFacts,
  isEvidenceParagraphStale,
  mergeAuditEvidenceDraft,
  readAuditEvidencePeriod,
  summarizeRequirementFacts,
} from "../../../Types/DataSecurity/AuditEvidence";
import { getCloudRegionLocation } from "../../../Types/DataSecurity/CloudRegionCountry";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceFact,
  ComplianceFactKind,
  HeldText,
  describeComplianceFact,
  getFactsHash,
  getUnfoundedNumbers,
  holdTextToFacts,
  readComplianceFacts,
} from "../../../Types/DataSecurity/ComplianceFacts";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  ImpactAssessmentPart,
  ImpactAssessmentSection,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
  LARGE_SCALE_RECORDS,
  SECTION_TOO_LONG_MESSAGE,
  StoreImpactAssessment,
  cleanSectionMarkdown,
  editImpactAssessmentSection,
  getImpactAssessmentTriggers,
  getStaleImpactAssessmentParts,
  holdImpactAssessmentToFacts,
  mergeImpactAssessmentDraft,
} from "../../../Types/DataSecurity/ImpactAssessment";
import {
  RecordTransfer,
  RecordTransferRoute,
} from "../../../Types/DataSecurity/RecordOfProcessing";
import { describe, expect, test } from "@jest/globals";

/*
 * THE REST OF THE COMPLIANCE PAPERWORK (#10375): the facts every draft is
 * held to - a draft cites them, says no number they do not hold, and
 * changes when they do - which stores need an impact assessment, how its
 * parts are drafted, merged and edited, and how a framework's audit
 * evidence is: a person's words are never drafted over.
 */

const NOW: Date = new Date("2026-11-23T10:00:00.000Z");

const HOLDS: ComplianceFact = {
  id: "F1",
  key: "store:holds",
  kind: ComplianceFactKind.StoreHolds,
  dataTypes: ["Diagnosis code", "Email address"],
  categories: [DataCategory.Health, DataCategory.ContactAndIdentity],
  sensitivity: "Restricted",
  records: 250000,
};

const LOCATION: ComplianceFact = {
  id: "F2",
  key: "store:location",
  kind: ComplianceFactKind.Location,
  region: "us-east-1",
  country: "US",
  isInEea: false,
  replicationRegions: [],
  subjectCountries: ["DE"],
};

const ENCRYPTION: ComplianceFact = {
  id: "F3",
  key: "store:encryption",
  kind: ComplianceFactKind.Encryption,
  encryptedAtRest: true,
  customerManagedKey: false,
};

const FACTS: Array<ComplianceFact> = [HOLDS, LOCATION, ENCRYPTION];

const TO_US: RecordTransfer = {
  route: RecordTransferRoute.Store,
  fromCountries: ["DE"],
  toCountry: "US",
  toRegion: "us-east-1",
  leavesEea: true,
};

describe("the facts a draft is held to", () => {
  test("keeps a text that cites a fact it was given, with the ids out of its words", () => {
    const held: HeldText | null = holdTextToFacts({
      text: "Patient records for clinical care (F1).",
      cited: ["F1", "F99"],
      facts: FACTS,
      maxLength: 200,
    });

    expect(held).toEqual({
      text: "Patient records for clinical care.",
      factKeys: ["store:holds"],
    });
  });

  test("drops a text that cites nothing it was given, or says a number no fact it cites holds", () => {
    expect(
      holdTextToFacts({
        text: "Patient records for clinical care.",
        cited: ["F42"],
        facts: FACTS,
        maxLength: 200,
      }),
    ).toBeNull();
    expect(
      holdTextToFacts({
        text: "Kept for 7 years after the last visit.",
        cited: ["F1"],
        facts: FACTS,
        maxLength: 200,
      }),
    ).toBeNull();
    // A number a cited fact holds is founded; the law's own references are not claims.
    expect(
      getUnfoundedNumbers({
        text: "About 250,000 records, under Art. 9(2)(h) and Article 6(1)(c).",
        facts: [HOLDS],
      }),
    ).toEqual([]);
  });

  test("the same facts under other ids hash the same; a changed or vanished one does not", () => {
    const keys: Array<string> = ["store:holds", "store:location"];
    const before: string = getFactsHash({ facts: FACTS, keys });

    expect(
      getFactsHash({
        facts: [
          { ...LOCATION, id: "F7" },
          { ...HOLDS, id: "F8" },
        ],
        keys: [...keys].reverse(),
      }),
    ).toBe(before);
    expect(
      getFactsHash({
        facts: [{ ...HOLDS, records: 260000 }, LOCATION],
        keys,
      }),
    ).not.toBe(before);
    expect(getFactsHash({ facts: [HOLDS], keys })).not.toBe(before);
  });

  test("reads back only well-formed facts, and says each in English for an export", () => {
    expect(
      readComplianceFacts([HOLDS, { id: "F9", key: "x", kind: "Nonsense" }]),
    ).toEqual([HOLDS]);
    expect(describeComplianceFact(LOCATION)).toContain("us-east-1");
  });
});

describe("where a cloud region keeps its data", () => {
  test("each cloud's regions, and the multi-region areas", () => {
    expect(getCloudRegionLocation("eu-west-1")).toEqual({
      region: "eu-west-1",
      country: "IE",
      isInEea: true,
    });
    expect(getCloudRegionLocation("West Europe")?.country).toBe("NL");
    expect(getCloudRegionLocation("europe-west3")?.country).toBe("DE");
    expect(getCloudRegionLocation("eu")).toEqual({
      region: "eu",
      country: null,
      isInEea: true,
    });
    expect(getCloudRegionLocation("us")?.country).toBe("US");
    expect(getCloudRegionLocation("mars-north-1")).toBeNull();
    expect(getCloudRegionLocation("")).toBeNull();
  });
});

describe("which stores need an impact assessment", () => {
  test("special category data, data about many people, and data that leaves its people's countries are each a reason", () => {
    expect(
      getImpactAssessmentTriggers({
        dataCategories: [DataCategory.Health],
        estimatedRecords: LARGE_SCALE_RECORDS,
        transfers: [TO_US],
      }),
    ).toEqual([
      {
        trigger: ImpactAssessmentTrigger.SpecialCategory,
        categories: [DataCategory.Health],
      },
      {
        trigger: ImpactAssessmentTrigger.LargeScale,
        records: LARGE_SCALE_RECORDS,
      },
      { trigger: ImpactAssessmentTrigger.LeavesCountries, transfers: [TO_US] },
    ]);
  });

  test("a small store of contact details kept where its people are needs none, nor does a store OneUptime declares", () => {
    expect(
      getImpactAssessmentTriggers({
        dataCategories: [DataCategory.ContactAndIdentity],
        estimatedRecords: LARGE_SCALE_RECORDS - 1,
        transfers: [],
      }),
    ).toEqual([]);
    expect(
      getImpactAssessmentTriggers({
        dataCategories: [DataCategory.Health],
        estimatedRecords: LARGE_SCALE_RECORDS * 10,
        transfers: [TO_US],
        isDeclared: true,
      }),
    ).toEqual([]);
  });
});

describe("an impact assessment's parts", () => {
  const PROCESSING: string =
    "The store keeps diagnosis codes and email addresses of about 250,000 patients, for clinical care (F1).";
  const RISKS: string =
    "Data about people in Germany is kept in the United States, outside the EEA (F2).";

  function drafted(): Partial<
    Record<ImpactAssessmentPart, ImpactAssessmentSection>
  > {
    return holdImpactAssessmentToFacts({
      answer: {
        [ImpactAssessmentPart.Processing]: {
          markdown: `## Heading\n\n${PROCESSING}\n\n<b>bold</b> ![x](http://x) [link](http://evil)`,
          facts: ["F1"],
        },
        [ImpactAssessmentPart.Risks]: { markdown: RISKS, facts: ["F2"] },
        // Cites nothing it was given.
        [ImpactAssessmentPart.Necessity]: {
          markdown: "Necessary for treatment and in proportion to it.",
          facts: ["F77"],
        },
        // A number no fact it cites holds.
        [ImpactAssessmentPart.Measures]: {
          markdown: "Backups are kept for 35 days and encrypted at rest (F3).",
          facts: ["F3"],
        },
      },
      facts: FACTS,
      now: NOW,
    });
  }

  test("a drafted part keeps to its facts, as a document's words: no heading, no HTML, no image, no link", () => {
    const sections: Partial<
      Record<ImpactAssessmentPart, ImpactAssessmentSection>
    > = drafted();

    expect(Object.keys(sections).sort()).toEqual([
      ImpactAssessmentPart.Processing,
      ImpactAssessmentPart.Risks,
    ]);
    expect(sections[ImpactAssessmentPart.Processing]).toMatchObject({
      markdown:
        "The store keeps diagnosis codes and email addresses of about 250,000 patients, for clinical care.\n\nbold  link",
      source: ImpactAssessmentSectionSource.Drafted,
      factKeys: ["store:holds"],
    });
    expect(cleanSectionMarkdown("# Title\nWords")).toBe("Words");
  });

  test("Draft Again never drafts over a part a person edited", () => {
    const first: StoreImpactAssessment = mergeImpactAssessmentDraft({
      previous: null,
      drafted: drafted(),
      facts: FACTS,
      triggers: [ImpactAssessmentTrigger.SpecialCategory],
      language: "en",
      now: NOW,
    });
    const edited: { isDone: true; assessment: StoreImpactAssessment } =
      editImpactAssessmentSection({
        assessment: first,
        part: ImpactAssessmentPart.Risks,
        markdown: "Our own words about the risks.",
        facts: FACTS,
        userId: "user-1",
        language: "en",
        now: NOW,
      }) as { isDone: true; assessment: StoreImpactAssessment };
    const again: StoreImpactAssessment = mergeImpactAssessmentDraft({
      previous: edited.assessment,
      drafted: drafted(),
      facts: FACTS,
      triggers: [ImpactAssessmentTrigger.SpecialCategory],
      language: "en",
      now: NOW,
    });

    expect(again.sections[ImpactAssessmentPart.Risks]).toMatchObject({
      markdown: "Our own words about the risks.",
      source: ImpactAssessmentSectionSource.Edited,
      editedByUserId: "user-1",
    });
    expect(again.sections[ImpactAssessmentPart.Processing]?.source).toBe(
      ImpactAssessmentSectionSource.Drafted,
    );
  });

  test("a part whose facts changed since it was written says so, an edited one over every fact the person had", () => {
    const assessment: StoreImpactAssessment = (
      editImpactAssessmentSection({
        assessment: mergeImpactAssessmentDraft({
          previous: null,
          drafted: drafted(),
          facts: FACTS,
          triggers: [],
          language: "en",
          now: NOW,
        }),
        part: ImpactAssessmentPart.Measures,
        markdown: "Encrypted, with backups.",
        facts: FACTS,
        language: "en",
        now: NOW,
      }) as { isDone: true; assessment: StoreImpactAssessment }
    ).assessment;

    expect(getStaleImpactAssessmentParts({ assessment, facts: FACTS })).toEqual(
      [],
    );
    expect(
      getStaleImpactAssessmentParts({
        assessment,
        facts: [{ ...HOLDS, records: 300000 }, LOCATION, ENCRYPTION],
      }),
    ).toEqual([ImpactAssessmentPart.Processing, ImpactAssessmentPart.Measures]);
  });

  test("an emptied part is taken out, for OneUptime AI to draft again; one too long is refused", () => {
    const emptied: { isDone: true; assessment: StoreImpactAssessment } =
      editImpactAssessmentSection({
        assessment: mergeImpactAssessmentDraft({
          previous: null,
          drafted: drafted(),
          facts: FACTS,
          triggers: [],
          language: "en",
          now: NOW,
        }),
        part: ImpactAssessmentPart.Processing,
        markdown: "   ",
        facts: FACTS,
        language: "en",
        now: NOW,
      }) as { isDone: true; assessment: StoreImpactAssessment };

    expect(
      emptied.assessment.sections[ImpactAssessmentPart.Processing],
    ).toBeUndefined();
    expect(
      editImpactAssessmentSection({
        assessment: null,
        part: ImpactAssessmentPart.Processing,
        markdown: "x".repeat(20001),
        facts: FACTS,
        language: "en",
        now: NOW,
      }),
    ).toEqual({ isDone: false, refusal: SECTION_TOO_LONG_MESSAGE });
  });
});

describe("a framework's audit evidence", () => {
  const SCOPE: ComplianceFact = {
    id: "E1",
    key: "A1.2:scope",
    kind: ComplianceFactKind.RequirementScope,
    stores: 3,
    storeNames: ["orders-db", "payroll", "logs"],
    framework: ComplianceFramework.SOC2,
    requirement: "A1.2",
  };
  const CHECKS: ComplianceFact = {
    id: "E2",
    key: "A1.2:checks",
    kind: ComplianceFactKind.CheckState,
    checks: 4,
    failingChecks: [],
    failingStores: 0,
    openIssues: 0,
  };
  const HISTORY: ComplianceFact = {
    id: "E3",
    key: "A1.2:history",
    kind: ComplianceFactKind.IssueHistory,
    periodInDays: 90,
    opened: 2,
    fixed: 2,
    stillOpen: 0,
    medianHoursToFix: 30,
    medianDaysToFix: 1,
  };
  const OTHER: ComplianceFact = {
    id: "E4",
    key: "CC6.1:checks",
    kind: ComplianceFactKind.CheckState,
    checks: 16,
    failingChecks: ["Public read access"],
    failingStores: 1,
    openIssues: 1,
  };
  const EVIDENCE_FACTS: Array<ComplianceFact> = [SCOPE, CHECKS, HISTORY, OTHER];

  test("a paragraph rests only on its own requirement's facts, for a requirement of the framework", () => {
    const paragraphs: Record<string, AuditEvidenceParagraph> =
      holdAuditEvidenceToFacts({
        framework: ComplianceFramework.SOC2,
        answer: [
          {
            requirement: "A1.2",
            text: "All 4 backup checks pass on the 3 stores in scope; the 2 issues opened in the last 90 days were fixed (E1, E2, E3).",
            facts: ["E1", "E2", "E3"],
          },
          // Cites another requirement's fact only.
          {
            requirement: "CC6.2",
            text: "Unused access is removed as soon as it is found on every store.",
            facts: ["E4"],
          },
          // Not a requirement of SOC 2.
          {
            requirement: "Art. 32",
            text: "Security of processing is met on every store in scope.",
            facts: ["E1"],
          },
        ],
        facts: EVIDENCE_FACTS,
        now: NOW,
      });

    expect(Object.keys(paragraphs)).toEqual(["A1.2"]);
    expect(paragraphs["A1.2"]).toMatchObject({
      source: AuditEvidenceParagraphSource.Drafted,
      factKeys: ["A1.2:scope", "A1.2:checks", "A1.2:history"],
    });
    expect(paragraphs["A1.2"]!.text).not.toContain("E1");
  });

  test("Draft Again keeps an edited paragraph, and a paragraph whose facts changed says so", () => {
    const first: FrameworkAuditEvidence = mergeAuditEvidenceDraft({
      previous: null,
      framework: ComplianceFramework.SOC2,
      periodInDays: 90,
      drafted: {},
      facts: EVIDENCE_FACTS,
      language: "en",
      now: NOW,
    });
    const edited: FrameworkAuditEvidence = (
      editAuditEvidenceParagraph({
        evidence: first,
        framework: ComplianceFramework.SOC2,
        periodInDays: 90,
        requirement: "A1.2",
        text: "Backups are tested every quarter by the platform team.",
        facts: EVIDENCE_FACTS,
        language: "en",
        now: NOW,
      }) as { isDone: true; evidence: FrameworkAuditEvidence }
    ).evidence;
    const again: FrameworkAuditEvidence = mergeAuditEvidenceDraft({
      previous: edited,
      framework: ComplianceFramework.SOC2,
      periodInDays: 90,
      drafted: {
        "A1.2": {
          requirement: "A1.2",
          text: "A new draft that must not land.",
          source: AuditEvidenceParagraphSource.Drafted,
          factKeys: ["A1.2:scope"],
        },
      },
      facts: EVIDENCE_FACTS,
      language: "en",
      now: NOW,
    });
    const paragraph: AuditEvidenceParagraph = again.paragraphs["A1.2"]!;

    expect(paragraph.text).toBe(
      "Backups are tested every quarter by the platform team.",
    );
    expect(isEvidenceParagraphStale({ paragraph, facts: EVIDENCE_FACTS })).toBe(
      false,
    );
    // Another requirement's facts changing is nothing to this one.
    expect(
      isEvidenceParagraphStale({
        paragraph,
        facts: [SCOPE, CHECKS, HISTORY, { ...OTHER, openIssues: 3 }],
      }),
    ).toBe(false);
    expect(
      isEvidenceParagraphStale({
        paragraph,
        facts: [SCOPE, CHECKS, { ...HISTORY, opened: 3 }, OTHER],
      }),
    ).toBe(true);
  });

  test("refuses a paragraph for a requirement the framework does not have", () => {
    expect(
      editAuditEvidenceParagraph({
        evidence: null,
        framework: ComplianceFramework.SOC2,
        periodInDays: 90,
        requirement: "Art. 32",
        text: "Words",
        facts: EVIDENCE_FACTS,
        language: "en",
        now: NOW,
      }),
    ).toEqual({ isDone: false, refusal: EVIDENCE_REQUIREMENT_UNKNOWN_MESSAGE });
  });

  test("a requirement with no paragraph reads its facts, in plain English", () => {
    expect(summarizeRequirementFacts([SCOPE, CHECKS, HISTORY])).toBe(
      "3 stores are in its scope. All 4 checks that are evidence for it pass on every store in scope. In the last 90 days, 2 issues were opened and 2 fixed, in 1 day at the median; 0 are still open.",
    );
  });

  test("a period is one of the four, else 90 days", () => {
    expect(readAuditEvidencePeriod(365)).toBe(365);
    expect(readAuditEvidencePeriod(7)).toBe(90);
    expect(readAuditEvidencePeriod("30")).toBe(90);
  });
});
