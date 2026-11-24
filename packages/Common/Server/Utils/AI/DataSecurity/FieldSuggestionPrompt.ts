import { UnplacedField } from "../../../../Utils/DataSecurity/UnplacedFields";
import DataSecurityAiInput, {
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import { getAnalysisLanguageName } from "./DataSecurityIssuePrompt";
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
 * WHAT ONEUPTIME AI IS ASKED ABOUT THE FIELDS NO DETECTOR PLACED, AND HOW
 * ITS ANSWER IS READ.
 *
 * The prompt is one JSON value of data under a system message that holds
 * every instruction (DataSecurityAiInput, #10365): the kind of store, the
 * data types the answer may name (the built-in catalog and the project's
 * own types, by id and name), and the fields - each by a reference (F1,
 * F2...), with its location, the names beside it, the shapes of its values
 * and their shares, how many values were read and how long they are on
 * average (Utils/DataSecurity/UnplacedFields). Never a value: the scan
 * keeps none, and a shape says only what a value looks like.
 *
 * The answer is read strictly (StrictAnswer): a JSON object of fields by
 * reference, each with one of the listed ids or null, and a sentence of
 * why - in the project's language (#6105), which the store's What's Inside
 * draws across the suggestion's row for everyone in the project to read. An answer that is not that object - words around it included - is
 * no answer; a field that is not of its shape, a reference that was not
 * asked, or a second answer for one, is left out; an id that is not listed
 * is no type.
 */

// The most fields asked about in one call.
export const MAX_FIELDS_PER_SUGGESTION_REQUEST: number = 40;

// The longest reason kept from an answer.
export const MAX_SUGGESTION_REASON_LENGTH: number = 300;

// The longest data type id an answer can name: the catalog's and a project's own.
const MAX_DATA_TYPE_ID_LENGTH: number = 100;

// The prefix of a field's reference: F1, F2...
const FIELD_REFERENCE_PREFIX: string = "F";

/*
 * What OneUptime AI is asked, in OneUptime's words, with the reasons it
 * writes in the language given: the project's (ProjectLanguage).
 */
export function getFieldSuggestionInstructions(language: string): string {
  return [
    "You classify the fields of a customer's data store for OneUptime Data Security.",
    "",
    "The user message is one JSON value of data. For each field it gives the field's location, the names of the fields beside it, and the shapes of its values: every letter written as a (lower case) or A (upper case), every digit as 9, every other character as it is, with the share of the values that has each shape. It never holds a value.",
    "",
    "For each field, name the data type it holds from the dataTypes list, by its id, or null when it holds none of them or you cannot tell. Suggest a type only when the field's name, the names beside it and its shapes together make it likely: a person will confirm or reject each suggestion. Names can be in any language, abbreviated or in a company's own words.",
    "",
    "Answer with JSON only, no other text, in this form:",
    '{"fields":[{"ref":"F1","dataTypeId":"an id from dataTypes, or null","reason":"one sentence of at most 25 words"}]}',
    "",
    `Answer for every field, by its ref. Use only ids from dataTypes. The reason says what in the name or the shapes points to the type, written in ${getAnalysisLanguageName(language)}: the people who confirm the suggestion read it.`,
  ].join("\n");
}

// The instructions with the reasons in English: a project with no language of its own.
export const FIELD_SUGGESTION_SYSTEM_PROMPT: string =
  getFieldSuggestionInstructions("en");

export interface FieldSuggestionDataType {
  id: string;
  name: string;
}

export interface FieldSuggestionAnswer {
  // One of the listed ids, or null for none of them.
  dataTypeId: string | null;
  reason: string;
}

// A field's reference in a request: F1 for the first field.
export function getFieldReference(index: number): string {
  return `${FIELD_REFERENCE_PREFIX}${index + 1}`;
}

/*
 * The prompt: the store's kind, the data types an answer may name, and at
 * most MAX_FIELDS_PER_SUGGESTION_REQUEST fields, each by its reference -
 * with the reasons asked for in the project's language, English when none
 * is given.
 */
export function buildFieldSuggestionPrompt(data: {
  storeKind: string;
  dataTypes: ReadonlyArray<FieldSuggestionDataType>;
  fields: ReadonlyArray<UnplacedField>;
  language?: string | undefined;
}): DataSecurityAiPrompt {
  return DataSecurityAiInput.buildSuggestFieldTypesPrompt({
    instructions: getFieldSuggestionInstructions(data.language || "en"),
    storeKind: data.storeKind,
    dataTypes: data.dataTypes,
    fields: data.fields.slice(0, MAX_FIELDS_PER_SUGGESTION_REQUEST),
    getReference: getFieldReference,
  });
}

// One field's answer: its reference, a listed id or null, and why.
type FieldAnswerShape = StrictObject<{
  ref: StrictText;
  dataTypeId: StrictNullable<StrictText>;
  reason: StrictOptional<StrictNullable<StrictText>>;
}>;

// The answer asked for: every field's.
export const FIELD_SUGGESTION_ANSWER: StrictObject<{
  fields: StrictList<FieldAnswerShape>;
}> = StrictAnswer.object({
  fields: StrictAnswer.list(
    StrictAnswer.object({
      ref: StrictAnswer.text({ maxLength: 20, whenTooLong: "refuse" }),
      // A longer id is cut, and names no listed type.
      dataTypeId: StrictAnswer.nullable(
        StrictAnswer.text({ maxLength: MAX_DATA_TYPE_ID_LENGTH + 1 }),
      ),
      reason: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.text({
            maxLength: MAX_SUGGESTION_REASON_LENGTH,
            isOneLine: true,
          }),
        ),
      ),
    }),
    /*
     * A model may answer a field twice; what it says past twice the fields
     * asked is never read.
     */
    { maxItems: MAX_FIELDS_PER_SUGGESTION_REQUEST * 2 },
  ),
});

type FieldSuggestionAnswerValue = StrictValue<typeof FIELD_SUGGESTION_ANSWER>;

/*
 * The answer, by reference: only the references asked about, each naming a
 * listed id or null. Null when the answer is not the JSON object asked
 * for. A reference asked about and not answered is not in the map.
 */
export function parseFieldSuggestionResponse(data: {
  content: string;
  references: ReadonlySet<string>;
  isKnownDataType: (dataTypeId: string) => boolean;
}): Map<string, FieldSuggestionAnswer> | null {
  const answer: FieldSuggestionAnswerValue | null = readStrictAnswer(
    data.content,
    FIELD_SUGGESTION_ANSWER,
  );

  if (!answer) {
    return null;
  }

  const answers: Map<string, FieldSuggestionAnswer> = new Map();

  for (const field of answer.fields) {
    if (!data.references.has(field.ref) || answers.has(field.ref)) {
      continue;
    }

    const dataTypeId: string | null = field.dataTypeId;
    const isNamed: boolean =
      typeof dataTypeId === "string" &&
      dataTypeId.length > 0 &&
      dataTypeId.length <= MAX_DATA_TYPE_ID_LENGTH &&
      data.isKnownDataType(dataTypeId);

    answers.set(field.ref, {
      dataTypeId: isNamed ? dataTypeId : null,
      reason: isNamed ? field.reason || "" : "",
    });
  }

  return answers;
}
