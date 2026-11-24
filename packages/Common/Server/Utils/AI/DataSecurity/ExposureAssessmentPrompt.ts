import { BreachLawId } from "../../../../Types/DataSecurity/BreachLaws";
import {
  EXPOSURE_DRAFT_PARTS,
  ExposureDraftAnswer,
  ExposureDraftPart,
  MAX_EXPOSURE_DRAFT_LENGTH,
  MAX_EXPOSURE_EXPLANATION_LENGTH,
} from "../../../../Types/DataSecurity/ExposureAssessment";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  AiComplianceFacts,
  buildExposureAssessmentPrompt as buildPrompt,
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
 * WHAT ONEUPTIME AI IS ASKED TO WRITE OF AN EXPOSURE'S ASSESSMENT (#10377).
 *
 * Plain code worked the assessment out: the window, who could read the
 * data and whether reads were logged, whose data it was, the secrets to
 * rotate, and which breach laws may apply with their deadlines
 * (Types/DataSecurity/ExposureAssessment). OneUptime AI only explains and
 * drafts from those facts: what it means, a notice to the regulator, a
 * notice to the people affected and an internal summary. It is told the
 * facts as DataSecurityAiInput builds them, writes each part from them
 * alone, citing them, and writes a placeholder for what only the team
 * knows; its answer is held to the facts before it is kept - a number or a
 * law none of them holds drops the part (holdExposureDraftsToFacts).
 * Nothing it writes is sent: a person edits and copies it.
 *
 * This file holds what it is asked, in OneUptime's own words, and the
 * answer's shape; every fact is the builder's.
 */

export function getExposureAssessmentInstructions(language: string): string {
  return [
    "You are OneUptime AI, writing up the assessment of a data exposure: a data store that was open to people who should not have read it. A person, usually with counsel, reviews and edits what you write before anything is sent. It is a draft, not legal advice, and nothing you write is sent by OneUptime.",
    "The user message lists the parts to write and what each asks (write), the id of the notice that is due first when one is known (dueFirst), and the facts OneUptime's plain code worked out, each with an id (F1, F2...): the store and what it holds, its exposure issues, when the exposure started and ended (in UTC), whether reads were logged and who could read it, the secrets found in it by type and place, where the people live, and each breach law of OneUptime's table with whether it may apply, who must be told, its deadline and what a person still checks.",
    "Write each part from the facts alone. Never invent a date, a time, a number, a count of people, a law, a regulator, a recipient or a measure the team took. Where a part needs something the facts do not say - who the team is, a contact, a measure, the date people were told - write a placeholder in square brackets, such as [contact details of your data protection officer]. Name only the laws the facts name, by the names the facts give them. Write every number and date exactly as a fact gives it: a date as its day, month and year in UTC, a deadline in the units the fact gives (hours, calendar days, business days). When reads were not logged, say the data should be treated as read; never say nobody read it.",
    "Plain words for a reader who is not a lawyer or an engineer. Say what is known and what is not. A notice to the regulator follows what the notice due first asks: the nature of the breach, the categories and approximate numbers of people and records, its likely consequences and the measures taken. A notice to the people tells them what happened, what kinds of their data, what was done and what they can do.",
    "Cite in facts the ids of every fact a part rests on. A part the facts say nothing for is null.",
    `Write in the language whose code is "${language}". Markdown paragraphs and lists only: no headings, no tables, no links, no ids in the words.`,
    `Answer with one JSON object and nothing else: {"explanation": {"markdown": "...", "facts": ["F1"]}, "regulatorNotice": {...}, "peopleNotice": {...}, "internalSummary": {...}}, one key per part asked. The explanation is at most ${MAX_EXPOSURE_EXPLANATION_LENGTH} characters, each notice at most ${MAX_EXPOSURE_DRAFT_LENGTH}.`,
  ].join("\n\n");
}

// Room for four parts, and as little sampling as a model takes.
export const EXPOSURE_ASSESSMENT_MAX_TOKENS: number = 4000;
export const EXPOSURE_ASSESSMENT_TEMPERATURE: number = 0;

type PartShape = StrictOptional<
  StrictNullable<
    StrictObject<{ markdown: StrictText; facts: StrictList<StrictText> }>
  >
>;

function partShape(maxLength: number): PartShape {
  return StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.object({
        markdown: StrictAnswer.text({ maxLength: maxLength * 2 }),
        facts: StrictAnswer.list(
          StrictAnswer.text({
            maxLength: 10,
            isOneLine: true,
            whenTooLong: "refuse",
          }),
          { maxItems: 120 },
        ),
      }),
    ),
  );
}

export const EXPOSURE_ASSESSMENT_ANSWER_SHAPE: StrictObject<
  Record<ExposureDraftPart, PartShape>
> = StrictAnswer.object({
  [ExposureDraftPart.Explanation]: partShape(MAX_EXPOSURE_EXPLANATION_LENGTH),
  [ExposureDraftPart.RegulatorNotice]: partShape(MAX_EXPOSURE_DRAFT_LENGTH),
  [ExposureDraftPart.PeopleNotice]: partShape(MAX_EXPOSURE_DRAFT_LENGTH),
  [ExposureDraftPart.InternalSummary]: partShape(MAX_EXPOSURE_DRAFT_LENGTH),
} as Record<ExposureDraftPart, PartShape>);

type ReadAnswer = StrictValue<typeof EXPOSURE_ASSESSMENT_ANSWER_SHAPE>;

// The answer, read strictly, as the parts it wrote: null when it is not one.
export function readExposureAssessmentAnswer(
  content: string | null | undefined,
): ExposureDraftAnswer | null {
  const read: ReadAnswer | null = readStrictAnswer(
    content,
    EXPOSURE_ASSESSMENT_ANSWER_SHAPE,
  );

  if (!read) {
    return null;
  }

  const answer: ExposureDraftAnswer = {};

  for (const part of EXPOSURE_DRAFT_PARTS) {
    const value: { markdown: string; facts: Array<string> } | null | undefined =
      read[part];

    if (value) {
      answer[part] = value;
    }
  }

  return answer;
}

// The prompt for one exposure, built by the one input builder.
export function buildCaseExposurePrompt(data: {
  feature:
    | DataSecurityAiFeature.DraftExposureAssessment
    | DataSecurityAiFeature.DraftExposureAssessmentOnRequest;
  built: AiComplianceFacts;
  parts: ReadonlyArray<ExposureDraftPart>;
  dueFirst?: BreachLawId | undefined;
  language: string;
}): DataSecurityAiPrompt {
  return buildPrompt({
    feature: data.feature,
    instructions: getExposureAssessmentInstructions(data.language),
    built: data.built,
    parts: data.parts,
    dueFirst: data.dueFirst,
  });
}
