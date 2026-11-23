import { COMPLIANCE_FRAMEWORK_INFO } from "../../../../../Types/DataSecurity/ComplianceFramework";
import {
  AuditEvidenceAnswerParagraph,
  AuditEvidenceParagraph,
  holdAuditEvidenceToFacts,
} from "../../../../../Types/DataSecurity/AuditEvidence";
import {
  holdImpactAssessmentToFacts,
  IMPACT_ASSESSMENT_PARTS,
  ImpactAssessmentAnswer,
  ImpactAssessmentPart,
  ImpactAssessmentSection,
} from "../../../../../Types/DataSecurity/ImpactAssessment";
import {
  RecordField,
  RecordFieldDraft,
  RecordPeople,
} from "../../../../../Types/DataSecurity/RecordOfProcessing";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import { LLMMessage } from "../../../LLM/LLMService";
import {
  AUDIT_EVIDENCE_MAX_TOKENS,
  AUDIT_EVIDENCE_TEMPERATURE,
  buildFrameworkEvidencePrompt,
  readAuditEvidenceAnswer,
} from "../../DataSecurity/AuditEvidencePrompt";
import DataSecurityAiInput, {
  AiComplianceFacts,
} from "../../DataSecurity/DataSecurityAiInput";
import {
  buildStoreImpactAssessmentPrompt,
  IMPACT_ASSESSMENT_MAX_TOKENS,
  IMPACT_ASSESSMENT_TEMPERATURE,
  readImpactAssessmentAnswer,
} from "../../DataSecurity/ImpactAssessmentPrompt";
import {
  buildRecordDraftPrompt,
  holdRecordDraftToFacts,
  readRecordDraftAnswer,
  RECORD_DRAFT_MAX_TOKENS,
  RECORD_DRAFT_TEMPERATURE,
  RecordDraftAnswer,
} from "../../DataSecurity/RecordOfProcessingPrompt";
import {
  AuditEvidenceEvalCase,
  ImpactAssessmentEvalCase,
  RecordDraftEvalCase,
  RecordTextEvalExpectation,
} from "./DataSecurityEvalCase";

/*
 * THE PAPERWORK'S CASES, ASKED AND SCORED AS THE PRODUCT ASKS AND HOLDS
 * THEM (#10375).
 *
 * Each case's input is the one the product builds from its dossier - the
 * same facts, the same words (DataSecurityAiInput, the Prompt files) - and
 * its answer is read and held to its facts exactly as the product holds it
 * before anyone sees it: a draft the product would drop counts as no
 * draft. Then each kept draft is read against the case's words:
 *
 *   - a record's field is drafted and says what the case names, or is
 *     left empty where the case says no fact supports it; its legal basis
 *     is one the case allows, its people include the ones it names and
 *     none it excludes; no draft says what it never should;
 *   - an assessment's parts say the words the case names;
 *   - a framework's evidence has a paragraph the product keeps for every
 *     requirement the case names, saying its words.
 */

export interface PaperworkEvalCall {
  messages: Array<LLMMessage>;
  maxTokens: number;
  temperature: number;
}

export interface PaperworkEvalScore {
  passed: boolean;
  notes: Array<string>;
}

function lower(text: string): string {
  return text.toLowerCase();
}

// Each group's words: one of them, in the text.
function missingWords(
  text: string,
  groups: ReadonlyArray<ReadonlyArray<string>>,
): Array<string> {
  const said: string = lower(text);

  return groups
    .filter((group: ReadonlyArray<string>): boolean => {
      return !group.some((word: string): boolean => {
        return said.includes(lower(word));
      });
    })
    .map((group: ReadonlyArray<string>): string => {
      return group.join(" or ");
    });
}

function neverSaid(text: string, never: ReadonlyArray<string>): Array<string> {
  const said: string = lower(text);

  return never.filter((word: string): boolean => {
    return said.includes(lower(word));
  });
}

// The facts of a record case, as the product builds them.
export function getRecordEvalFacts(
  testCase: RecordDraftEvalCase,
): AiComplianceFacts {
  return DataSecurityAiInput.recordFacts({
    dossier: testCase.dossier,
    dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
  });
}

export function recordDraftCall(
  testCase: RecordDraftEvalCase,
): PaperworkEvalCall {
  return {
    messages: buildRecordDraftPrompt({
      feature: testCase.feature,
      built: getRecordEvalFacts(testCase),
      fields: testCase.fields,
      language: testCase.language || "en",
    }).messages,
    maxTokens: RECORD_DRAFT_MAX_TOKENS,
    temperature: RECORD_DRAFT_TEMPERATURE,
  };
}

function scoreRecordText(data: {
  field: RecordField;
  expected: RecordTextEvalExpectation | null | undefined;
  draft: RecordFieldDraft | undefined;
  notes: Array<string>;
}): void {
  if (data.expected === undefined) {
    return;
  }

  if (data.expected === null) {
    if (data.draft) {
      data.notes.push(`${data.field}: drafted what no fact says`);
    }

    return;
  }

  if (!data.draft) {
    if (!data.expected.mayBeLeftEmpty) {
      data.notes.push(`${data.field}: no draft the product would keep`);
    }

    return;
  }

  for (const missing of missingWords(
    String(data.draft.value),
    data.expected.says,
  )) {
    data.notes.push(`${data.field}: missing ${missing}`);
  }
}

// A record case's answer, held to its facts as the product holds it, then read.
export function scoreRecordDraft(
  testCase: RecordDraftEvalCase,
  answer: string,
): PaperworkEvalScore {
  const read: RecordDraftAnswer | null = readRecordDraftAnswer(answer);

  if (!read) {
    return { passed: false, notes: ["not the answer asked for"] };
  }

  const built: AiComplianceFacts = getRecordEvalFacts(testCase);
  const held: Partial<Record<RecordField, RecordFieldDraft>> =
    holdRecordDraftToFacts({
      answer: read,
      fields: testCase.fields,
      facts: built.facts,
      language: testCase.language || "en",
      now: new Date(),
    });
  const notes: Array<string> = [];

  scoreRecordText({
    field: RecordField.Purpose,
    expected: testCase.expect.purpose,
    draft: held[RecordField.Purpose],
    notes,
  });
  scoreRecordText({
    field: RecordField.Retention,
    expected: testCase.expect.retention,
    draft: held[RecordField.Retention],
    notes,
  });

  const basis: RecordFieldDraft | undefined = held[RecordField.LegalBasis];

  if (testCase.expect.legalBasis === null && basis) {
    notes.push("legal basis: drafted what no fact says");
  } else if (testCase.expect.legalBasis) {
    if (!basis) {
      notes.push("legal basis: no draft the product would keep");
    } else if (
      !testCase.expect.legalBasis.oneOf.includes(String(basis.value) as never)
    ) {
      notes.push(`legal basis: ${String(basis.value)} is not a right one`);
    }
  }

  const people: RecordFieldDraft | undefined = held[RecordField.People];

  if (testCase.expect.people === null && people) {
    notes.push("people: drafted what no fact says");
  } else if (testCase.expect.people) {
    const named: Array<string> = Array.isArray(people?.value)
      ? (people!.value as Array<string>)
      : [];

    if (!people) {
      notes.push("people: no draft the product would keep");
    }

    for (const category of testCase.expect.people.includes) {
      if (!named.includes(category)) {
        notes.push(`people: missing ${category}`);
      }
    }

    for (const category of testCase.expect.people.excludes || []) {
      if (named.includes(category as RecordPeople)) {
        notes.push(`people: names ${category}, which no fact points to`);
      }
    }
  }

  const everything: string = Object.values(held)
    .map((draft: RecordFieldDraft | undefined): string => {
      return draft ? `${String(draft.value)} ${draft.reason}` : "";
    })
    .join(" ");

  for (const word of neverSaid(everything, testCase.expect.never)) {
    notes.push(`said what it never should: ${word}`);
  }

  return { passed: notes.length === 0, notes };
}

export function getImpactAssessmentEvalFacts(
  testCase: ImpactAssessmentEvalCase,
): AiComplianceFacts {
  return DataSecurityAiInput.impactAssessmentFacts({
    dossier: testCase.dossier,
    dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
  });
}

export function impactAssessmentCall(
  testCase: ImpactAssessmentEvalCase,
): PaperworkEvalCall {
  return {
    messages: buildStoreImpactAssessmentPrompt({
      built: getImpactAssessmentEvalFacts(testCase),
      triggers: testCase.triggers,
      parts: [...IMPACT_ASSESSMENT_PARTS],
      language: testCase.language || "en",
    }).messages,
    maxTokens: IMPACT_ASSESSMENT_MAX_TOKENS,
    temperature: IMPACT_ASSESSMENT_TEMPERATURE,
  };
}

export function scoreImpactAssessment(
  testCase: ImpactAssessmentEvalCase,
  answer: string,
): PaperworkEvalScore {
  const read: ImpactAssessmentAnswer | null = readImpactAssessmentAnswer(answer);

  if (!read) {
    return { passed: false, notes: ["not the answer asked for"] };
  }

  const held: Partial<Record<ImpactAssessmentPart, ImpactAssessmentSection>> =
    holdImpactAssessmentToFacts({
      answer: read,
      facts: getImpactAssessmentEvalFacts(testCase).facts,
      now: new Date(),
    });
  const notes: Array<string> = [];

  for (const [part, words] of Object.entries(testCase.expect.parts) as Array<
    [ImpactAssessmentPart, Array<Array<string>>]
  >) {
    const section: ImpactAssessmentSection | undefined = held[part];

    if (!section) {
      notes.push(`${part}: no part the product would keep`);
      continue;
    }

    for (const missing of missingWords(section.markdown, words)) {
      notes.push(`${part}: missing ${missing}`);
    }
  }

  const everything: string = Object.values(held)
    .map((section: ImpactAssessmentSection | undefined): string => {
      return section?.markdown || "";
    })
    .join(" ");

  for (const word of neverSaid(everything, testCase.expect.never)) {
    notes.push(`said what it never should: ${word}`);
  }

  return { passed: notes.length === 0, notes };
}

export function getAuditEvidenceEvalFacts(
  testCase: AuditEvidenceEvalCase,
): AiComplianceFacts {
  return DataSecurityAiInput.auditEvidenceFacts({
    framework: testCase.framework,
    periodInDays: testCase.periodInDays,
    requirements: testCase.requirements,
  });
}

export function auditEvidenceCall(
  testCase: AuditEvidenceEvalCase,
): PaperworkEvalCall {
  return {
    messages: buildFrameworkEvidencePrompt({
      built: getAuditEvidenceEvalFacts(testCase),
      framework: testCase.framework,
      frameworkName: COMPLIANCE_FRAMEWORK_INFO[testCase.framework].fullName,
      periodInDays: testCase.periodInDays,
      requirements: testCase.requirements.map(
        (requirement: { requirement: string; title: string; status: string }) => {
          return {
            requirement: requirement.requirement,
            title: requirement.title,
            status: requirement.status,
          };
        },
      ),
      language: testCase.language || "en",
    }).messages,
    maxTokens: AUDIT_EVIDENCE_MAX_TOKENS,
    temperature: AUDIT_EVIDENCE_TEMPERATURE,
  };
}

export function scoreAuditEvidence(
  testCase: AuditEvidenceEvalCase,
  answer: string,
): PaperworkEvalScore {
  const read: Array<AuditEvidenceAnswerParagraph> | null =
    readAuditEvidenceAnswer(answer);

  if (!read) {
    return { passed: false, notes: ["not the answer asked for"] };
  }

  const held: Record<string, AuditEvidenceParagraph> = holdAuditEvidenceToFacts(
    {
      framework: testCase.framework,
      answer: read,
      facts: getAuditEvidenceEvalFacts(testCase).facts,
      now: new Date(),
    },
  );
  const notes: Array<string> = [];

  for (const [requirement, words] of Object.entries(
    testCase.expect.paragraphs,
  )) {
    const paragraph: AuditEvidenceParagraph | undefined = held[requirement];

    if (!paragraph) {
      notes.push(`${requirement}: no paragraph the product would keep`);
      continue;
    }

    for (const missing of missingWords(paragraph.text, words)) {
      notes.push(`${requirement}: missing ${missing}`);
    }
  }

  const everything: string = Object.values(held)
    .map((paragraph: AuditEvidenceParagraph): string => {
      return paragraph.text;
    })
    .join(" ");

  for (const word of neverSaid(everything, testCase.expect.never)) {
    notes.push(`said what it never should: ${word}`);
  }

  return { passed: notes.length === 0, notes };
}
