import {
  IMPACT_ASSESSMENT_PARTS,
  ImpactAssessmentAnswer,
  ImpactAssessmentPart,
  ImpactAssessmentTriggerView,
  MAX_IMPACT_ASSESSMENT_SECTION_LENGTH,
} from "../../../../Types/DataSecurity/ImpactAssessment";
import {
  AiComplianceFacts,
  buildImpactAssessmentPrompt as buildPrompt,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictList,
  StrictNullable,
  StrictObject,
  StrictOptional,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED FOR A STORE'S IMPACT ASSESSMENT (#10375).
 *
 * It is told why the store needs one, the parts of GDPR Article 35(7) to
 * write and what each asks, and the facts - the store's record of
 * processing, what it holds and where, its open issues, how exposed it is,
 * who can reach it, its encryption and backups, and the fixes on its
 * timeline - as DataSecurityAiInput builds them. It writes each part from
 * those facts alone, citing them, and says what they leave open rather
 * than guessing; its answer is held to the facts before it is kept
 * (holdImpactAssessmentToFacts).
 *
 * This file holds what it is asked, in OneUptime's own words, and the
 * answer's shape; every fact is the builder's.
 */

export function getImpactAssessmentInstructions(language: string): string {
  return [
    "You are OneUptime AI, drafting a data protection impact assessment (GDPR Article 35) for one data store, for the organization's privacy team to review, edit and own. Your draft is a starting point, not legal advice.",
    "The user message says why the store needs an assessment (whyItNeedsOne), the parts to write and what each asks (parts), and the facts OneUptime's scans know about the store, each with an id (F1, F2...). Write each part from the facts alone.",
    "Write each part as a few short paragraphs or a list, in plain words for a reader who is not an engineer. Name the store's open issues and say what each risks for the people the data is about. Where the facts do not say something the part asks - why the processing is necessary, a measure that may exist outside what OneUptime sees - say that it is not known from what OneUptime sees and is for the team to complete. Never invent a measure, a number or a recipient.",
    "Cite in facts the ids of every fact a part rests on. A part the facts say nothing for is null.",
    `Write in the language whose code is "${language}". Markdown paragraphs and lists only: no headings, no tables, no links, no ids in the words.`,
    `Answer with one JSON object and nothing else: {"processing": {"markdown": "...", "facts": ["F1"]}, "necessity": {...}, "risks": {...}, "measures": {...}}, one key per part asked, each at most ${MAX_IMPACT_ASSESSMENT_SECTION_LENGTH} characters.`,
  ].join("\n\n");
}

// Room for four parts, and as little sampling as a model takes.
export const IMPACT_ASSESSMENT_MAX_TOKENS: number = 3000;
export const IMPACT_ASSESSMENT_TEMPERATURE: number = 0;

type PartShape = StrictOptional<
  StrictNullable<
    StrictObject<{ markdown: StrictText; facts: StrictList<StrictText> }>
  >
>;

function partShape(): PartShape {
  return StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.object({
        markdown: StrictAnswer.text({
          maxLength: MAX_IMPACT_ASSESSMENT_SECTION_LENGTH * 2,
        }),
        facts: StrictAnswer.list(
          StrictAnswer.text({
            maxLength: 10,
            isOneLine: true,
            whenTooLong: "refuse",
          }),
          { maxItems: 60 },
        ),
      }),
    ),
  );
}

export const IMPACT_ASSESSMENT_ANSWER_SHAPE: StrictObject<
  Record<ImpactAssessmentPart, PartShape>
> = StrictAnswer.object({
  [ImpactAssessmentPart.Processing]: partShape(),
  [ImpactAssessmentPart.Necessity]: partShape(),
  [ImpactAssessmentPart.Risks]: partShape(),
  [ImpactAssessmentPart.Measures]: partShape(),
} as Record<ImpactAssessmentPart, PartShape>);

type ReadAnswer = StrictValue<typeof IMPACT_ASSESSMENT_ANSWER_SHAPE>;

// The answer, read strictly, as the parts it wrote: null when it is not one.
export function readImpactAssessmentAnswer(
  content: string | null | undefined,
): ImpactAssessmentAnswer | null {
  const read: ReadAnswer | null = readStrictAnswer(
    content,
    IMPACT_ASSESSMENT_ANSWER_SHAPE,
  );

  if (!read) {
    return null;
  }

  const answer: ImpactAssessmentAnswer = {};

  for (const part of IMPACT_ASSESSMENT_PARTS) {
    const value: { markdown: string; facts: Array<string> } | null | undefined =
      read[part];

    if (value) {
      answer[part] = value;
    }
  }

  return answer;
}

// The prompt for one store, built by the one input builder.
export function buildStoreImpactAssessmentPrompt(data: {
  built: AiComplianceFacts;
  triggers: ReadonlyArray<ImpactAssessmentTriggerView>;
  parts: ReadonlyArray<ImpactAssessmentPart>;
  language: string;
}): DataSecurityAiPrompt {
  return buildPrompt({
    instructions: getImpactAssessmentInstructions(data.language),
    built: data.built,
    triggers: data.triggers,
    parts: data.parts,
  });
}
