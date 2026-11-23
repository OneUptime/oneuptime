import {
  AuditEvidenceAnswerParagraph,
  MAX_EVIDENCE_PARAGRAPH_LENGTH,
} from "../../../../Types/DataSecurity/AuditEvidence";
import {
  AiComplianceFacts,
  buildAuditEvidencePrompt as buildPrompt,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictList,
  StrictObject,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED FOR A FRAMEWORK'S AUDIT EVIDENCE (#10375).
 *
 * It is told the framework, the period, each requirement with where it
 * stands and the ids of its own facts, and the facts - the stores in each
 * requirement's scope, its checks and which fail, its issues opened and
 * fixed in the period and how fast, its accepted risks with their reasons
 * and expiry, and what turned it off - as DataSecurityAiInput builds them.
 * It writes, for each requirement, the paragraph an auditor reads, from
 * that requirement's facts alone; a paragraph that cites none of them, or
 * says a number none of them holds, is dropped before it is kept
 * (holdAuditEvidenceToFacts).
 */

export function getAuditEvidenceInstructions(language: string): string {
  return [
    "You are OneUptime AI, writing the evidence an auditor reads under each requirement of a compliance framework, from what OneUptime Data Security's checks and issue history show. It is evidence for an audit, not a certificate and not legal advice.",
    "The user message names the framework and the period in days, and lists its requirements, each with its status and the ids of its own facts (requirements[].facts), then the facts. Write one paragraph per requirement, from that requirement's own facts alone.",
    "Each paragraph says, in this order and only as far as its facts say it: which stores are in scope; which checks are evidence for the requirement and whether they pass; how many of its issues opened and were fixed in the period, and how fast at the median; the risks accepted under it, with their reasons and when they expire; and what turned it off, and why. Use the facts' own numbers, written as digits. Never round, add up or work out a number of your own, never name a person, and never claim more than the facts show.",
    "A requirement whose status is Not evaluated says that no store in its scope has been read yet. One Data Security meets by reading every store says so.",
    "Cite in facts the ids of every fact a paragraph rests on: only that requirement's own.",
    `Write in the language whose code is "${language}", in the plain, factual tone of an audit report. Plain text, one paragraph each: no Markdown, no lists, no ids in the words.`,
    `Answer with one JSON object and nothing else: {"paragraphs": [{"requirement": "Art. 32", "text": "...", "facts": ["E1", "E2"]}]}, one entry per requirement, each text at most ${MAX_EVIDENCE_PARAGRAPH_LENGTH} characters.`,
  ].join("\n\n");
}

// Room for every requirement of the largest framework, and as little sampling as a model takes.
export const AUDIT_EVIDENCE_MAX_TOKENS: number = 4000;
export const AUDIT_EVIDENCE_TEMPERATURE: number = 0;

export const AUDIT_EVIDENCE_ANSWER_SHAPE: StrictObject<{
  paragraphs: StrictList<
    StrictObject<{
      requirement: StrictText;
      text: StrictText;
      facts: StrictList<StrictText>;
    }>
  >;
}> = StrictAnswer.object({
  paragraphs: StrictAnswer.list(
    StrictAnswer.object({
      requirement: StrictAnswer.text({
        maxLength: 40,
        isOneLine: true,
        whenTooLong: "refuse",
      }),
      text: StrictAnswer.text({
        maxLength: MAX_EVIDENCE_PARAGRAPH_LENGTH * 2,
        isOneLine: true,
      }),
      facts: StrictAnswer.list(
        StrictAnswer.text({
          maxLength: 10,
          isOneLine: true,
          whenTooLong: "refuse",
        }),
        { maxItems: 40 },
      ),
    }),
    { maxItems: 20 },
  ),
});

type ReadAnswer = StrictValue<typeof AUDIT_EVIDENCE_ANSWER_SHAPE>;

// The answer's paragraphs, read strictly: null when it is not the object asked for.
export function readAuditEvidenceAnswer(
  content: string | null | undefined,
): Array<AuditEvidenceAnswerParagraph> | null {
  const read: ReadAnswer | null = readStrictAnswer(
    content,
    AUDIT_EVIDENCE_ANSWER_SHAPE,
  );

  return read ? read.paragraphs : null;
}

// The prompt for one framework and period, built by the one input builder.
export function buildFrameworkEvidencePrompt(data: {
  built: AiComplianceFacts;
  framework: string;
  frameworkName: string;
  periodInDays: number;
  requirements: ReadonlyArray<{
    requirement: string;
    title: string;
    status: string;
  }>;
  language: string;
}): DataSecurityAiPrompt {
  return buildPrompt({
    instructions: getAuditEvidenceInstructions(data.language),
    built: data.built,
    framework: data.framework,
    frameworkName: data.frameworkName,
    periodInDays: data.periodInDays,
    requirements: data.requirements,
  });
}
