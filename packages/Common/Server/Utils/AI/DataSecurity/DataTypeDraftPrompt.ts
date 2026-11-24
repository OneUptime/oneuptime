import { ALL_DATA_CATEGORIES } from "../../../../Types/DataSecurity/DataCategory";
import { ALL_DATA_SENSITIVITIES } from "../../../../Types/DataSecurity/DataSensitivity";
import { ALL_CUSTOM_DATA_TYPE_VALIDATORS } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import {
  DataTypeDraft,
  DataTypeDraftProblem,
  MAX_DRAFT_DESCRIPTION_LENGTH,
  MAX_DRAFT_NAME_LENGTH,
  MAX_DRAFT_PATTERN_LENGTH,
  MAX_DRAFT_REASON_LENGTH,
  MAX_DRAFT_WORDS,
  readDataTypeDraft,
} from "../../../../Utils/DataSecurity/DataTypeProposal";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictFlag,
  StrictList,
  StrictNullable,
  StrictObject,
  StrictOptional,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED TO DRAFT A DATA TYPE FROM, AND HOW ITS ANSWER
 * IS READ (#10371).
 *
 * Two features ask it, each through its own builder (DataSecurityAiInput):
 *
 *   - DraftDataTypes: a group of fields scans could not place - the same
 *     unknown shape under the same kind of name in several stores - by
 *     each field's location, the names beside it, its store's kind and the
 *     shapes of its values with their shares. Never a value.
 *   - DescribeDataType: a sentence a person wrote on the data type form,
 *     and the shapes of their examples. Never an example: the browser
 *     tests those (Test It).
 *
 * Both are told the data types OneUptime knows, by name, so a group that
 * holds one of them is not drafted again. Both answer one JSON object -
 * the draft, or null for no data type of the company's own - read strictly
 * (StrictAnswer), then held to what a saved type is held to
 * (readDataTypeDraft, checkDataTypeDraft). A draft whose pattern cannot be
 * used is asked for once more, told why.
 */

// The most data types the prompt names: the built-in catalog and the project's own.
export const MAX_KNOWN_DATA_TYPES: number = 400;

// The most example shapes a sentence's draft is told.
export const MAX_EXAMPLE_SHAPES: number = 10;

// The longest sentence a person's description may be.
export const MAX_DESCRIBE_SENTENCE_LENGTH: number = 1_000;

const CATEGORY_WORDS: string = ALL_DATA_CATEGORIES.map(
  (category: string): string => {
    return `"${category}"`;
  },
).join(", ");

const SENSITIVITY_WORDS: string = ALL_DATA_SENSITIVITIES.map(
  (sensitivity: string): string => {
    return `"${sensitivity}"`;
  },
).join(", ");

const VALIDATOR_WORDS: string = ALL_CUSTOM_DATA_TYPE_VALIDATORS.map(
  (validator: string): string => {
    return `"${validator}"`;
  },
).join(", ");

// How a draft is written, whichever feature asks.
const HOW_TO_DRAFT: string = [
  "A draft has these fields:",
  `- name: what the company would call it, in English, at most 60 characters, such as "Insurance policy number".`,
  "- description: one sentence of what it is and what it looks like, its example written as a shape, such as AA-9999999.",
  `- category: one of ${CATEGORY_WORDS}.`,
  `- sensitivity: one of ${SENSITIVITY_WORDS}. Restricted where a leak harms people (health, government and financial account identifiers); Confidential for an identifier of a person, a customer or their contract; Internal for the business's own.`,
  "- pattern: a JavaScript regular expression for one value, without slashes or flags. A shape's A is [A-Z], its a is [a-z], its 9 is \\d, any other character is itself; a separator only some shapes write is optional; a count is exact where the shapes agree and a range where they differ. Begin and end with \\b where the value begins and ends with a letter or a digit. It must never match empty text, use no backreference and no lookaround, and match no plain word, date or amount.",
  "- ignoreCase: true only when the case of its letters does not matter.",
  `- keywords: at most 5 lower-case words that, near a value, say it is this data, such as "policy".`,
  `- nameHints: at most 8 field names that hold it, in lower-case words with spaces between them, such as "policy no" for policy_no.`,
  `- validator: one of ${VALIDATOR_WORDS}; not "None" only when a check digit of that kind is all but certain.`,
  "",
  "Answer with JSON only, no other text, in this form:",
  '{"dataType":{"name":"...","description":"...","category":"...","sensitivity":"...","pattern":"...","ignoreCase":false,"keywords":["..."],"nameHints":["..."],"validator":"None"},"reason":"one sentence of at most 30 words"}',
  "or, when there is no data type of the company's own to draft:",
  '{"dataType":null,"reason":"one sentence of at most 30 words"}',
  "The reason says what in the names and the shapes points to your answer.",
  "",
  "previousDraft, when present, is your last answer's pattern and why it could not be used: write a pattern without that problem.",
].join("\n");

export const DRAFT_DATA_TYPE_SYSTEM_PROMPT: string = [
  "You draft data types for OneUptime Data Security: the kinds of sensitive data a company has of its own - a customer number, a policy number, a patient reference, an employee ID - that no built-in detector knows.",
  "",
  "The user message is one JSON value of data: a group of fields, in several of the company's data stores, that no detector could place and that look like one kind of value. For each field it gives the kind of store it is in, its location, the names of the fields beside it, and the shapes of its values - every letter written as a (lower case) or A (upper case), every digit as 9, every other character as it is - with the share of the values that has each shape. It never holds a value. knownDataTypes lists the data types OneUptime already knows, by name.",
  "",
  "Decide whether the group holds one kind of sensitive data of the company's own: an identifier of a person, a customer, a patient, an employee, a contract or an account, or a secret. Answer dataType null when it holds one of the knownDataTypes, or nothing anyone protects: a product code, an order or tracking number, a version, a measurement, a status.",
  "",
  "Otherwise draft it from the field names and the shapes.",
  "",
  HOW_TO_DRAFT,
].join("\n");

export const DESCRIBE_DATA_TYPE_SYSTEM_PROMPT: string = [
  "You draft one data type for OneUptime Data Security from a person's description: a kind of sensitive data their company has of its own, such as an employee ID or a policy number.",
  "",
  "The user message is one JSON value of data: the person's description in their own words, and the shapes of their examples, if they gave any - every letter written as a (lower case) or A (upper case), every digit as 9, every other character as it is. The examples themselves are never sent. knownDataTypes lists the data types OneUptime already knows, by name.",
  "",
  "Draft the data type the description asks for. Take the literal parts from the description, such as a prefix it names (EMP-), and the rest from the shapes: lengths, letters, digits, a separator only some examples write. The pattern must find every example the shapes stand for. Answer dataType null only when the description names no kind of data, or names one of the knownDataTypes exactly.",
  "",
  HOW_TO_DRAFT,
].join("\n");

// What a pattern's problem is called, when the draft is asked for once more.
export const DRAFT_PROBLEM_WORDS: Readonly<
  Record<DataTypeDraftProblem, string>
> = {
  [DataTypeDraftProblem.PatternUnusable]:
    "it does not compile, cannot run in linear time, uses a backreference or a lookaround, or matches empty text",
  [DataTypeDraftProblem.FindsPlainWords]:
    "it matches plain words, so it would match words everywhere",
  [DataTypeDraftProblem.MissesItsShapes]:
    "it matches none of the shapes of the values it was written for",
};

type DraftShape = StrictObject<{
  name: StrictText;
  description: StrictOptional<StrictNullable<StrictText>>;
  category: StrictText;
  sensitivity: StrictText;
  pattern: StrictText;
  ignoreCase: StrictOptional<StrictNullable<StrictFlag>>;
  keywords: StrictOptional<StrictNullable<StrictList<StrictText>>>;
  nameHints: StrictOptional<StrictNullable<StrictList<StrictText>>>;
  validator: StrictOptional<StrictNullable<StrictText>>;
}>;

// The answer asked for: a draft or null, and why.
export const DATA_TYPE_DRAFT_ANSWER: StrictObject<{
  dataType: StrictNullable<DraftShape>;
  reason: StrictOptional<StrictNullable<StrictText>>;
}> = StrictAnswer.object({
  dataType: StrictAnswer.nullable(
    StrictAnswer.object({
      name: StrictAnswer.text({
        maxLength: MAX_DRAFT_NAME_LENGTH,
        isOneLine: true,
      }),
      description: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.text({
            maxLength: MAX_DRAFT_DESCRIPTION_LENGTH,
            isOneLine: true,
          }),
        ),
      ),
      category: StrictAnswer.text({ maxLength: 100 }),
      sensitivity: StrictAnswer.text({ maxLength: 50 }),
      // A longer pattern is refused, never cut: a cut pattern is another one.
      pattern: StrictAnswer.text({
        maxLength: MAX_DRAFT_PATTERN_LENGTH,
        whenTooLong: "refuse",
      }),
      ignoreCase: StrictAnswer.optional(
        StrictAnswer.nullable(StrictAnswer.flag()),
      ),
      keywords: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.list(
            StrictAnswer.text({ maxLength: 100, isOneLine: true }),
            { maxItems: MAX_DRAFT_WORDS },
          ),
        ),
      ),
      nameHints: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.list(
            StrictAnswer.text({ maxLength: 100, isOneLine: true }),
            { maxItems: MAX_DRAFT_WORDS },
          ),
        ),
      ),
      validator: StrictAnswer.optional(
        StrictAnswer.nullable(StrictAnswer.text({ maxLength: 20 })),
      ),
    }),
  ),
  reason: StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.text({
        maxLength: MAX_DRAFT_REASON_LENGTH,
        isOneLine: true,
      }),
    ),
  ),
});

type DraftAnswerValue = StrictValue<typeof DATA_TYPE_DRAFT_ANSWER>;

export type DataTypeDraftAnswer =
  // A draft a saved type could carry, and why.
  | { kind: "draft"; draft: DataTypeDraft; reason: string }
  // No data type of the company's own, and why.
  | { kind: "none"; reason: string }
  // A draft that is not one: a category or a sensitivity no type carries.
  | { kind: "unusable"; reason: string };

/*
 * The answer, read: a draft, no data type, or a draft no saved type could
 * be. Null when it is not the JSON object asked for.
 */
export function readDataTypeDraftAnswer(
  content: string | null | undefined,
): DataTypeDraftAnswer | null {
  const answer: DraftAnswerValue | null = readStrictAnswer(
    content,
    DATA_TYPE_DRAFT_ANSWER,
  );

  if (!answer) {
    return null;
  }

  const reason: string = (answer.reason || "").slice(
    0,
    MAX_DRAFT_REASON_LENGTH,
  );

  if (answer.dataType === null) {
    return { kind: "none", reason };
  }

  const draft: DataTypeDraft | null = readDataTypeDraft({
    ...answer.dataType,
    description: answer.dataType.description || "",
    ignoreCase: answer.dataType.ignoreCase === true,
    keywords: answer.dataType.keywords || [],
    nameHints: answer.dataType.nameHints || [],
    validator: answer.dataType.validator || "None",
  });

  return draft
    ? { kind: "draft", draft, reason }
    : { kind: "unusable", reason };
}
