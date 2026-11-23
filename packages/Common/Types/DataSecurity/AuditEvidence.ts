import { JSONObject } from "../JSON";
import { translationKey } from "../Translator";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
} from "./ComplianceFramework";
import {
  ComplianceFact,
  ComplianceFactKind,
  getFactsHash,
  holdTextToFacts,
  HeldText,
  readComplianceFacts,
} from "./ComplianceFacts";
import { isRequirementOf } from "./ComplianceRequirementCatalog";

/*
 * EVIDENCE AN AUDITOR CAN READ, FOR EACH FRAMEWORK REQUIREMENT (#10375).
 *
 * A framework's score says whether a requirement passes; an auditor asks
 * how anyone knows. Each requirement's evidence is worked out by plain
 * code from Data Security's own records, for a period the person picks:
 *
 *   - which stores are in its scope;
 *   - which checks are evidence for it, and whether they pass;
 *   - the issues of those checks opened and fixed in the period, and how
 *     fast they were fixed;
 *   - the risks accepted under it, with their reasons and expiry, and the
 *     resources that turned it off, with theirs.
 *
 * OneUptime AI drafts, on request, the paragraph an auditor reads under
 * each requirement, from those facts and nothing else: a paragraph that
 * cites none of its requirement's facts, or says a number none of them
 * holds, is dropped, and the requirement reads its facts alone. A person
 * edits a paragraph as they would a document's; an edited one is never
 * drafted again. The framework's evidence exports with the record of
 * processing and the issue history it cites.
 *
 * Pure, for the server and the Dashboard alike.
 */

// The periods evidence is read over, in days: the last month, quarter, half year or year.
export const AUDIT_EVIDENCE_PERIODS: ReadonlyArray<number> = [30, 90, 180, 365];

export const DEFAULT_AUDIT_EVIDENCE_PERIOD: number = 90;

export function readAuditEvidencePeriod(value: unknown): number {
  return typeof value === "number" && AUDIT_EVIDENCE_PERIODS.includes(value)
    ? value
    : DEFAULT_AUDIT_EVIDENCE_PERIOD;
}

export enum AuditEvidenceParagraphSource {
  // OneUptime AI's draft: Draft Again may write it again.
  Drafted = "Drafted",
  // A person edited it: never drafted again.
  Edited = "Edited",
}

export interface AuditEvidenceParagraph {
  requirement: string;
  text: string;
  source: AuditEvidenceParagraphSource;
  // The keys of the facts a drafted paragraph rests on.
  factKeys: Array<string>;
  /*
   * What its requirement's facts said when it was written
   * (getRequirementFactsHash): a paragraph whose facts changed since says
   * so, and its export reads the facts as they are.
   */
  factsHash?: string | undefined;
  draftedAt?: string | undefined;
  editedAt?: string | undefined;
  editedByUserId?: string | undefined;
}

// What a requirement's facts say, in sixty-four hex digits, whatever their ids.
export function getRequirementFactsHash(
  facts: ReadonlyArray<ComplianceFact>,
  requirement: string,
): string {
  const own: Array<ComplianceFact> = getRequirementFacts(facts, requirement);

  return getFactsHash({
    facts: own,
    keys: own.map((fact: ComplianceFact): string => {
      return fact.key;
    }),
  });
}

// Whether a paragraph was written over facts that say something else now.
export function isEvidenceParagraphStale(data: {
  paragraph: AuditEvidenceParagraph;
  facts: ReadonlyArray<ComplianceFact>;
}): boolean {
  return (
    Boolean(data.paragraph.factsHash) &&
    data.paragraph.factsHash !==
      getRequirementFactsHash(data.facts, data.paragraph.requirement)
  );
}

// One framework's paragraphs for one period, as the project keeps them.
export interface FrameworkAuditEvidence {
  framework: ComplianceFramework;
  periodInDays: number;
  // The language its drafted paragraphs are in.
  language: string;
  // By requirement, as the catalog names it ("Art. 32").
  paragraphs: Record<string, AuditEvidenceParagraph>;
  // The facts its drafted paragraphs were written from.
  facts: Array<ComplianceFact>;
  draftedAt?: string | undefined;
}

// What the project keeps (DataSecuritySetting.auditEvidence): each framework's, by period.
export interface ProjectAuditEvidence {
  version: number;
  // "<framework>|<period>" -> its evidence.
  entries: Record<string, FrameworkAuditEvidence>;
}

export const AUDIT_EVIDENCE_VERSION: number = 1;

// The longest paragraph a draft keeps, and the longest a person may write.
export const MAX_EVIDENCE_PARAGRAPH_LENGTH: number = 1500;
export const MAX_EDITED_EVIDENCE_PARAGRAPH_LENGTH: number = 6000;

export function getAuditEvidenceEntryKey(
  framework: ComplianceFramework,
  periodInDays: number,
): string {
  return `${framework}|${periodInDays}`;
}

/*
 * The key prefix of a requirement's facts: each fact of a framework's
 * evidence is about one of its requirements ("Art. 32:checks"), and a
 * paragraph may rest only on its own requirement's.
 */
export function getRequirementFactKeyPrefix(requirement: string): string {
  return `${requirement}:`;
}

export function getRequirementFacts(
  facts: ReadonlyArray<ComplianceFact>,
  requirement: string,
): Array<ComplianceFact> {
  const prefix: string = getRequirementFactKeyPrefix(requirement);

  return facts.filter((fact: ComplianceFact): boolean => {
    return fact.key.startsWith(prefix);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isFramework(value: unknown): value is ComplianceFramework {
  return (
    typeof value === "string" &&
    (ALL_COMPLIANCE_FRAMEWORKS as ReadonlyArray<string>).includes(value)
  );
}

function readParagraph(
  framework: ComplianceFramework,
  requirement: string,
  value: unknown,
): AuditEvidenceParagraph | null {
  if (!isRecord(value) || !isRequirementOf(framework, requirement)) {
    return null;
  }

  const text: string = readText(
    value["text"],
    MAX_EDITED_EVIDENCE_PARAGRAPH_LENGTH,
  ).trim();

  if (!text) {
    return null;
  }

  return {
    requirement,
    text,
    source:
      value["source"] === AuditEvidenceParagraphSource.Edited
        ? AuditEvidenceParagraphSource.Edited
        : AuditEvidenceParagraphSource.Drafted,
    factKeys: Array.isArray(value["factKeys"])
      ? value["factKeys"]
          .filter((key: unknown): key is string => {
            return typeof key === "string";
          })
          .slice(0, 40)
      : [],
    factsHash: readText(value["factsHash"], 64) || undefined,
    draftedAt: readText(value["draftedAt"], 40) || undefined,
    editedAt: readText(value["editedAt"], 40) || undefined,
    editedByUserId: readText(value["editedByUserId"], 40) || undefined,
  };
}

function readFrameworkEvidence(value: unknown): FrameworkAuditEvidence | null {
  if (!isRecord(value) || !isFramework(value["framework"])) {
    return null;
  }

  const framework: ComplianceFramework = value["framework"];
  const paragraphs: Record<string, AuditEvidenceParagraph> = {};
  const kept: unknown = value["paragraphs"];

  if (isRecord(kept)) {
    for (const [requirement, paragraph] of Object.entries(kept)) {
      const read: AuditEvidenceParagraph | null = readParagraph(
        framework,
        requirement,
        paragraph,
      );

      if (read) {
        paragraphs[requirement] = read;
      }
    }
  }

  return {
    framework,
    periodInDays: readAuditEvidencePeriod(value["periodInDays"]),
    language: readText(value["language"], 20) || "en",
    paragraphs,
    facts: readComplianceFacts(value["facts"]),
    draftedAt: readText(value["draftedAt"], 40) || undefined,
  };
}

// What the project keeps, read: what this build cannot read is left out.
export function readProjectAuditEvidence(value: unknown): ProjectAuditEvidence {
  const entries: Record<string, FrameworkAuditEvidence> = {};
  const kept: unknown = isRecord(value) ? value["entries"] : undefined;

  if (isRecord(kept)) {
    for (const entry of Object.values(kept)) {
      const read: FrameworkAuditEvidence | null = readFrameworkEvidence(entry);

      if (read) {
        entries[getAuditEvidenceEntryKey(read.framework, read.periodInDays)] =
          read;
      }
    }
  }

  return { version: AUDIT_EVIDENCE_VERSION, entries };
}

export function toProjectAuditEvidenceJson(
  evidence: ProjectAuditEvidence,
): JSONObject {
  return JSON.parse(JSON.stringify(evidence)) as JSONObject;
}

/*
 * OneUptime AI's answer, as read (StrictAnswer): a paragraph per
 * requirement, with the ids it says it rests on.
 */
export interface AuditEvidenceAnswerParagraph {
  requirement: string;
  text: string;
  facts: Array<string>;
}

/*
 * The answer held to its facts: a paragraph for a requirement of the
 * framework, resting only on that requirement's facts, cut to its length;
 * dropped when it cites none of them, says too little, or says a number
 * none of them holds.
 */
export function holdAuditEvidenceToFacts(data: {
  framework: ComplianceFramework;
  answer: ReadonlyArray<AuditEvidenceAnswerParagraph>;
  facts: ReadonlyArray<ComplianceFact>;
  now: Date;
}): Record<string, AuditEvidenceParagraph> {
  const paragraphs: Record<string, AuditEvidenceParagraph> = {};

  for (const raw of data.answer) {
    if (
      !raw ||
      typeof raw.requirement !== "string" ||
      !isRequirementOf(data.framework, raw.requirement) ||
      paragraphs[raw.requirement]
    ) {
      continue;
    }

    const held: HeldText | null = holdTextToFacts({
      text: raw.text,
      cited: raw.facts,
      facts: getRequirementFacts(data.facts, raw.requirement),
      maxLength: MAX_EVIDENCE_PARAGRAPH_LENGTH,
      minLength: 40,
    });

    if (held) {
      paragraphs[raw.requirement] = {
        requirement: raw.requirement,
        text: held.text,
        source: AuditEvidenceParagraphSource.Drafted,
        factKeys: held.factKeys,
        factsHash: getRequirementFactsHash(data.facts, raw.requirement),
        draftedAt: data.now.toISOString(),
      };
    }
  }

  return paragraphs;
}

/*
 * A new draft merged into what the framework keeps for the period: an
 * edited paragraph stays as its person wrote it; a drafted one is the new
 * draft's where it wrote one, and stays where it did not.
 */
export function mergeAuditEvidenceDraft(data: {
  previous: FrameworkAuditEvidence | null;
  framework: ComplianceFramework;
  periodInDays: number;
  drafted: Record<string, AuditEvidenceParagraph>;
  facts: ReadonlyArray<ComplianceFact>;
  language: string;
  now: Date;
}): FrameworkAuditEvidence {
  const paragraphs: Record<string, AuditEvidenceParagraph> = {
    ...(data.previous?.paragraphs || {}),
  };

  for (const [requirement, paragraph] of Object.entries(data.drafted)) {
    if (
      paragraphs[requirement]?.source === AuditEvidenceParagraphSource.Edited
    ) {
      continue;
    }

    paragraphs[requirement] = paragraph;
  }

  return {
    framework: data.framework,
    periodInDays: data.periodInDays,
    language: data.language,
    paragraphs,
    facts: [...data.facts],
    draftedAt: data.now.toISOString(),
  };
}

export const EVIDENCE_PARAGRAPH_TOO_LONG_MESSAGE: string = translationKey(
  "This paragraph is longer than the evidence keeps. Shorten it, then save it again.",
);

export const EVIDENCE_REQUIREMENT_UNKNOWN_MESSAGE: string = translationKey(
  "This framework has no such requirement, so nothing was saved.",
);

/*
 * A person's paragraph for one requirement: theirs from then on, never
 * drafted again. An empty one is taken out, and the requirement reads its
 * facts alone until a paragraph is drafted or written again.
 */
export function editAuditEvidenceParagraph(data: {
  evidence: FrameworkAuditEvidence | null;
  framework: ComplianceFramework;
  periodInDays: number;
  requirement: string;
  text: string;
  // The requirement's facts as the person read them, so a change after is said.
  facts: ReadonlyArray<ComplianceFact>;
  userId?: string | undefined;
  language: string;
  now: Date;
}):
  | { isDone: true; evidence: FrameworkAuditEvidence }
  | { isDone: false; refusal: string } {
  if (!isRequirementOf(data.framework, data.requirement)) {
    return { isDone: false, refusal: EVIDENCE_REQUIREMENT_UNKNOWN_MESSAGE };
  }

  if (Array.from(data.text).length > MAX_EDITED_EVIDENCE_PARAGRAPH_LENGTH) {
    return { isDone: false, refusal: EVIDENCE_PARAGRAPH_TOO_LONG_MESSAGE };
  }

  const evidence: FrameworkAuditEvidence = data.evidence || {
    framework: data.framework,
    periodInDays: data.periodInDays,
    language: data.language,
    paragraphs: {},
    facts: [],
  };
  const paragraphs: Record<string, AuditEvidenceParagraph> = {
    ...evidence.paragraphs,
  };
  const text: string = data.text.replace(/\r\n?/g, "\n").trim();

  if (text) {
    paragraphs[data.requirement] = {
      requirement: data.requirement,
      text,
      source: AuditEvidenceParagraphSource.Edited,
      factKeys: [],
      factsHash: getRequirementFactsHash(data.facts, data.requirement),
      editedAt: data.now.toISOString(),
      editedByUserId: data.userId,
    };
  } else {
    delete paragraphs[data.requirement];
  }

  return { isDone: true, evidence: { ...evidence, paragraphs } };
}

/*
 * A requirement's evidence in plain English, from its facts alone, for the
 * export of a requirement with no paragraph: what an auditor reads when
 * OneUptime AI wrote none, or is off.
 */
export function summarizeRequirementFacts(
  facts: ReadonlyArray<ComplianceFact>,
): string {
  const sentences: Array<string> = [];

  for (const fact of facts) {
    switch (fact.kind) {
      case ComplianceFactKind.RequirementScope:
        sentences.push(
          fact.stores === 0
            ? "No store is in its scope."
            : `${fact.stores} ${fact.stores === 1 ? "store is" : "stores are"} in its scope.`,
        );
        break;
      case ComplianceFactKind.CheckState:
        sentences.push(
          fact.checks === 0
            ? "Data Security meets it by reading every store in scope."
            : fact.failingChecks.length === 0
              ? `All ${fact.checks} checks that are evidence for it pass on every store in scope.`
              : `${fact.failingChecks.length} of its ${fact.checks} checks fail on ${fact.failingStores} ${
                  fact.failingStores === 1 ? "store" : "stores"
                }, with ${fact.openIssues} open ${fact.openIssues === 1 ? "issue" : "issues"}.`,
        );
        break;
      case ComplianceFactKind.IssueHistory:
        sentences.push(
          `In the last ${fact.periodInDays} days, ${fact.opened} ${
            fact.opened === 1 ? "issue was" : "issues were"
          } opened and ${fact.fixed} fixed${
            fact.medianDaysToFix !== undefined
              ? `, in ${fact.medianDaysToFix} ${fact.medianDaysToFix === 1 ? "day" : "days"} at the median`
              : ""
          }; ${fact.stillOpen} ${fact.stillOpen === 1 ? "is" : "are"} still open.`,
        );
        break;
      case ComplianceFactKind.AcceptedRisk:
        sentences.push(
          `A risk is accepted on ${fact.store} (${fact.issueTitle}): "${fact.reason}"${
            fact.until ? `, until ${fact.until}` : ", with no expiry"
          }.`,
        );
        break;
      case ComplianceFactKind.TurnedOff:
        sentences.push(
          `It is turned off ${
            fact.isWholeFramework ? "with the whole framework " : ""
          }on ${fact.resource}${fact.reason ? `: "${fact.reason}"` : ""}.`,
        );
        break;
      default:
        break;
    }
  }

  return sentences.join(" ");
}
