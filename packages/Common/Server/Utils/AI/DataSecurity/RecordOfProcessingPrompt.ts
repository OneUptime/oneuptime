import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  ComplianceFact,
  getFactsHash,
  HeldText,
  holdTextToFacts,
  getFactKeys,
  getUnfoundedNumbers,
} from "../../../../Types/DataSecurity/ComplianceFacts";
import {
  isRecordLegalBasis,
  isRecordPeople,
  RECORD_PEOPLE,
  RECORD_PURPOSE_MAX_LENGTH,
  RECORD_RETENTION_MAX_LENGTH,
  RecordField,
  RecordFieldDraft,
  RecordPeople,
} from "../../../../Types/DataSecurity/RecordOfProcessing";
import {
  AiComplianceFacts,
  buildRecordDraftPrompt as buildPrompt,
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
 * WHAT ONEUPTIME AI IS ASKED ABOUT A STORE'S RECORD OF PROCESSING (#10375).
 *
 * It is told the store's facts, as DataSecurityAiInput builds them (names,
 * counts, kinds and configuration, never a value, a sample or a record),
 * the fields to draft, and what each legal basis and category of people
 * means. It drafts each field from those facts and nothing else, citing
 * the ones it rests on, and leaves a field empty where they do not say -
 * a record that guesses is worse than one that asks.
 *
 * Its answer is read strictly and held to the facts before anyone sees it
 * (holdRecordDraftToFacts): a field that cites no fact, says a number no
 * fact it cites holds, or picks a basis or a category that is not one of
 * the list, is dropped. Even then it is a draft: a person confirms it.
 *
 * This file holds what it is asked, in OneUptime's own words, and the
 * answer's shape; every fact is the builder's. The eval asks the same
 * (Eval/DataSecurity), so a score measures what ships.
 */

export function getRecordDraftInstructions(language: string): string {
  return [
    "You are OneUptime AI, drafting one data store's entry in an organization's GDPR record of processing (Article 30), for a person on its privacy or security team to confirm or correct. Your draft is a starting point, not legal advice.",
    "The user message holds the fields to draft (draft), what each lawful basis and each category of people means, and the facts OneUptime's scans know about the store, each with an id (F1, F2...). Draft only the fields in draft, and draft each from the facts alone.",
    "purpose: why the organization holds this data, in one or two plain sentences a regulator reads - what it is used for and by which service or product, from the store's name, description and tags and the services that use it. Never describe the data types alone.",
    "retention: how long the data is kept, in a short phrase, only where a fact says how long: a backup retention, the retention set for telemetry, a tag. Say the days as the fact says them. Where no fact says how long records are kept, leave retention empty.",
    "legalBasis: the one lawful basis from legalBases that fits the purpose best - Contract for what a customer's order or account needs, Legal obligation where a law requires keeping it, Legitimate interests for security, fraud prevention and running the service, Consent for marketing and optional tracking - with a reason in one sentence.",
    "people: the categories of people the data is about, from people, by what the data types, the store and its services say - customers for orders and accounts, employees for HR, patients for health records - with a reason in one sentence. Name only the categories the facts point to.",
    "Cite in facts the ids of every fact a field rests on. A field the facts do not support is null, never a guess. Never name a person.",
    `Write purpose, retention and every reason in the language whose code is "${language}". Plain text: no Markdown, no ids in the words.`,
    `Answer with one JSON object and nothing else: {"purpose": {"text": "...", "facts": ["F1"]} or null, "retention": {"text": "...", "facts": ["F4"]} or null, "legalBasis": {"value": "Contract", "reason": "...", "facts": ["F2"]} or null, "people": {"value": ["Customers"], "reason": "...", "facts": ["F2"]} or null}. Leave out, or set to null, every field not in draft.`,
  ].join("\n\n");
}

/*
 * How the drafts are asked: a short answer, and as little sampling as a
 * model takes, so the same facts are answered the same way.
 */
export const RECORD_DRAFT_MAX_TOKENS: number = 900;
export const RECORD_DRAFT_TEMPERATURE: number = 0;

// The longest reason a drafted basis or set of people keeps.
export const MAX_RECORD_DRAFT_REASON_LENGTH: number = 300;

function idsShape(): StrictList<StrictText> {
  return StrictAnswer.list(
    StrictAnswer.text({ maxLength: 10, isOneLine: true, whenTooLong: "refuse" }),
    { maxItems: 30 },
  );
}

function textFieldShape(maxLength: number): StrictOptional<
  StrictNullable<
    StrictObject<{ text: StrictText; facts: StrictList<StrictText> }>
  >
> {
  return StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.object({
        text: StrictAnswer.text({ maxLength: maxLength * 2, isOneLine: true }),
        facts: idsShape(),
      }),
    ),
  );
}

export const RECORD_DRAFT_ANSWER_SHAPE: StrictObject<{
  purpose: ReturnType<typeof textFieldShape>;
  retention: ReturnType<typeof textFieldShape>;
  legalBasis: StrictOptional<
    StrictNullable<
      StrictObject<{
        value: StrictText;
        reason: StrictText;
        facts: StrictList<StrictText>;
      }>
    >
  >;
  people: StrictOptional<
    StrictNullable<
      StrictObject<{
        value: StrictList<StrictText>;
        reason: StrictText;
        facts: StrictList<StrictText>;
      }>
    >
  >;
}> = StrictAnswer.object({
  purpose: textFieldShape(RECORD_PURPOSE_MAX_LENGTH),
  retention: textFieldShape(RECORD_RETENTION_MAX_LENGTH),
  legalBasis: StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.object({
        value: StrictAnswer.text({ maxLength: 40, isOneLine: true }),
        reason: StrictAnswer.text({
          maxLength: MAX_RECORD_DRAFT_REASON_LENGTH * 2,
          isOneLine: true,
        }),
        facts: idsShape(),
      }),
    ),
  ),
  people: StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.object({
        value: StrictAnswer.list(
          StrictAnswer.text({ maxLength: 40, isOneLine: true }),
          { maxItems: RECORD_PEOPLE.length },
        ),
        reason: StrictAnswer.text({
          maxLength: MAX_RECORD_DRAFT_REASON_LENGTH * 2,
          isOneLine: true,
        }),
        facts: idsShape(),
      }),
    ),
  ),
});

export type RecordDraftAnswer = StrictValue<typeof RECORD_DRAFT_ANSWER_SHAPE>;

export function readRecordDraftAnswer(
  content: string | null | undefined,
): RecordDraftAnswer | null {
  return readStrictAnswer(content, RECORD_DRAFT_ANSWER_SHAPE);
}

// The prompt for one store, built by the one input builder.
export function buildRecordDraftPrompt(data: {
  feature:
    | DataSecurityAiFeature.DraftRecord
    | DataSecurityAiFeature.DraftRecordOnRequest;
  built: AiComplianceFacts;
  fields: ReadonlyArray<RecordField>;
  language: string;
}): DataSecurityAiPrompt {
  return buildPrompt({
    feature: data.feature,
    instructions: getRecordDraftInstructions(data.language),
    built: data.built,
    fields: data.fields,
  });
}

// A reason held to the facts its draft cites: one line, its numbers theirs, else none.
function holdReason(
  reason: string,
  facts: ReadonlyArray<ComplianceFact>,
  factKeys: ReadonlyArray<string>,
): string | null {
  const text: string = reason.replace(/\s+/g, " ").trim();
  const characters: Array<string> = Array.from(text);
  const cut: string =
    characters.length > MAX_RECORD_DRAFT_REASON_LENGTH
      ? `${characters.slice(0, MAX_RECORD_DRAFT_REASON_LENGTH - 1).join("")}…`
      : text;

  if (Array.from(cut).length < 8) {
    return null;
  }

  const cited: Array<ComplianceFact> = facts.filter(
    (fact: ComplianceFact): boolean => {
      return factKeys.includes(fact.key);
    },
  );

  return getUnfoundedNumbers({ text: cut, facts: cited }).length === 0
    ? cut
    : null;
}

/*
 * OneUptime AI's answer held to the facts, field by field, for the fields
 * it was asked to draft:
 *
 *   - Purpose and Retention keep their text where it cites a fact it was
 *     given, says enough, and says no number those facts do not hold;
 *   - Legal basis keeps its basis where it is one of Article 6's six and
 *     rests on a fact, with a reason held the same way;
 *   - People keep the categories of the list, where they rest on a fact,
 *     with a reason held the same way.
 *
 * Every other field, and every field it was not asked, is left out.
 */
export function holdRecordDraftToFacts(data: {
  answer: RecordDraftAnswer;
  fields: ReadonlyArray<RecordField>;
  facts: ReadonlyArray<ComplianceFact>;
  language: string;
  now: Date;
}): Partial<Record<RecordField, RecordFieldDraft>> {
  const drafts: Partial<Record<RecordField, RecordFieldDraft>> = {};
  const draftedAt: string = data.now.toISOString();
  const draft: (
    value: RecordFieldDraft["value"],
    reason: string,
    factKeys: Array<string>,
  ) => RecordFieldDraft = (
    value: RecordFieldDraft["value"],
    reason: string,
    factKeys: Array<string>,
  ): RecordFieldDraft => {
    return {
      value,
      reason,
      factKeys,
      factsHash: getFactsHash({ facts: data.facts, keys: factKeys }),
      draftedAt,
      language: data.language,
    };
  };

  for (const field of data.fields) {
    if (field === RecordField.Purpose || field === RecordField.Retention) {
      const raw: { text: string; facts: Array<string> } | null | undefined =
        data.answer[field === RecordField.Purpose ? "purpose" : "retention"];
      const held: HeldText | null = raw
        ? holdTextToFacts({
            text: raw.text,
            cited: raw.facts,
            facts: data.facts,
            maxLength:
              field === RecordField.Purpose
                ? RECORD_PURPOSE_MAX_LENGTH
                : RECORD_RETENTION_MAX_LENGTH,
            minLength: field === RecordField.Purpose ? 12 : 3,
          })
        : null;

      if (held) {
        drafts[field] = draft(held.text, "", held.factKeys);
      }

      continue;
    }

    if (field === RecordField.LegalBasis) {
      const raw:
        | { value: string; reason: string; facts: Array<string> }
        | null
        | undefined = data.answer.legalBasis;

      if (!raw || !isRecordLegalBasis(raw.value)) {
        continue;
      }

      const factKeys: Array<string> = getFactKeys({
        facts: data.facts,
        ids: raw.facts,
      });
      const reason: string | null =
        factKeys.length > 0 ? holdReason(raw.reason, data.facts, factKeys) : null;

      if (reason) {
        drafts[field] = draft(raw.value, reason, factKeys);
      }

      continue;
    }

    const raw:
      | { value: Array<string>; reason: string; facts: Array<string> }
      | null
      | undefined = data.answer.people;

    if (!raw) {
      continue;
    }

    const people: Array<RecordPeople> = RECORD_PEOPLE.filter(
      (category: RecordPeople): boolean => {
        return raw.value.some((value: string): boolean => {
          return isRecordPeople(value) && value === category;
        });
      },
    );
    const factKeys: Array<string> = getFactKeys({
      facts: data.facts,
      ids: raw.facts,
    });
    const reason: string | null =
      people.length > 0 && factKeys.length > 0
        ? holdReason(raw.reason, data.facts, factKeys)
        : null;

    if (reason) {
      drafts[field] = draft(people, reason, factKeys);
    }
  }

  return drafts;
}
