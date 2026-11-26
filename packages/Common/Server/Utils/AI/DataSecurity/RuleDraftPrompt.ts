import { ALL_DATA_CATEGORIES } from "../../../../Types/DataSecurity/DataCategory";
import {
  ALL_DATA_SECURITY_RULE_KINDS,
  DataSecurityRuleDraft,
  MAX_RULE_DESCRIPTION_LENGTH,
  MAX_RULE_LIST_ITEMS,
  MAX_RULE_NAME_LENGTH,
  MAX_RULE_PATTERN_LENGTH,
  MAX_RULE_REGIONS,
  readDataSecurityRuleDraft,
} from "../../../../Types/DataSecurity/DataSecurityRuleDraft";
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
 * WHAT ONEUPTIME AI IS ASKED TO DRAFT A RULE FROM, AND HOW ITS ANSWER IS
 * READ (#10378).
 *
 * A person tells Ask AI - or an agent tells the MCP server - a rule in their
 * own words. OneUptime AI is sent the sentence, the kinds of personal data
 * and the cloud regions a rule can name, and the project's labels and teams
 * by name (buildRuleFromSentencePrompt), and answers one JSON object: the
 * rule, of the kind the sentence asks for, or null for none. It is read
 * strictly (StrictAnswer), then held to what a saved rule is held to
 * (getDataSecurityRuleDraftProblem, and its patterns where they run): a
 * draft that is no rule is asked for once more, told why.
 */

const CATEGORY_WORDS: string = ALL_DATA_CATEGORIES.map(
  (category: string): string => {
    return `"${category}"`;
  },
).join(", ");

const KIND_WORDS: string = ALL_DATA_SECURITY_RULE_KINDS.map(
  (kind: string): string => {
    return `"${kind}"`;
  },
).join(", ");

export const RULE_FROM_SENTENCE_SYSTEM_PROMPT: string = [
  "You draft one Data Security rule for OneUptime from a person's sentence. A rule is one of three kinds:",
  "- residency: which kinds of personal data, about people of which countries, may be kept only in which cloud regions. A data store that holds such data in any other region breaks it.",
  "- owner: who owns every data store whose name, description, cloud tags or labels match. Owners are emailed each new issue on their stores.",
  "- label: which labels every data store whose name, description, cloud tags or labels match gets.",
  "",
  "The user message is one JSON value of data: the person's sentence; dataCategories, the kinds of data a residency rule can name; cloudRegions, the regions OneUptime knows, each with its cloud and the country it keeps its data in (EEA marks the European Economic Area); and the project's labels and teams, by name. It never holds a data store, anything found in one, or a person.",
  "",
  "Draft the rule the sentence asks for, of the kind it asks for. A rule has these fields:",
  `- kind: one of ${KIND_WORDS}.`,
  `- name: a short name, at most ${MAX_RULE_NAME_LENGTH} characters, such as "EU personal data stays in the EU".`,
  "- description: one sentence of what the rule does.",
  `- residency only: dataCategories, from ${CATEGORY_WORDS}, or [] for every kind of personal data; subjectCountries, the ISO 3166-1 alpha-2 codes of the countries of the people the data is about, or [] for anyone; allowedRegions, every region the data may be kept in, as cloudRegions names them - a * matches any characters, such as eu-* for every AWS region in the EU and europe-* for every Google Cloud region in Europe. "In the EU" or "in Europe" names every EEA region of every cloud, Azure's by name.`,
  "- owner and label only: what a store must match, each optional and all of them must hold - nameRegexPattern and descriptionRegexPattern, a regular expression matched against the store's name or description, ignoring case; cloudTagPattern, a regular expression matched against each of the store's cloud tags, written key=value; matchLabels, labels the store has, by name from labels. Leave them all out only when the sentence means every store. A regular expression uses no backreference and no lookaround.",
  "- owner only: owners, each member by the name or email address the sentence gives, and each team by its name from teams.",
  "- label only: labelsToAdd, labels by name from labels.",
  "",
  "Answer with JSON only, no other text, in this form:",
  '{"rule":{"kind":"residency","name":"...","description":"...","dataCategories":[],"subjectCountries":[],"allowedRegions":["..."]},"reason":"one sentence of at most 30 words"}',
  "or, when the sentence asks for no rule of these kinds, or for one that names nothing a rule can hold:",
  '{"rule":null,"reason":"one sentence of at most 30 words"}',
  "",
  "previousDraft, when present, says what was wrong with your last answer: write one without that problem.",
].join("\n");

// The longest reason the answer gives.
export const MAX_RULE_DRAFT_REASON_LENGTH: number = 300;

const NAME_LIST: StrictOptional<StrictNullable<StrictList<StrictText>>> =
  StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.list(
        StrictAnswer.text({ maxLength: 200, isOneLine: true }),
        {
          maxItems: MAX_RULE_LIST_ITEMS,
        },
      ),
    ),
  );

const PATTERN: StrictOptional<StrictNullable<StrictText>> =
  StrictAnswer.optional(
    StrictAnswer.nullable(
      // A longer pattern is refused, never cut: a cut pattern is another one.
      StrictAnswer.text({
        maxLength: MAX_RULE_PATTERN_LENGTH,
        whenTooLong: "refuse",
        isOneLine: true,
      }),
    ),
  );

export const RULE_DRAFT_ANSWER: StrictObject<{
  rule: StrictNullable<
    StrictObject<{
      kind: StrictText;
      name: StrictText;
      description: StrictOptional<StrictNullable<StrictText>>;
      dataCategories: typeof NAME_LIST;
      subjectCountries: typeof NAME_LIST;
      allowedRegions: StrictOptional<StrictNullable<StrictList<StrictText>>>;
      nameRegexPattern: typeof PATTERN;
      descriptionRegexPattern: typeof PATTERN;
      cloudTagPattern: typeof PATTERN;
      matchLabels: typeof NAME_LIST;
      owners: typeof NAME_LIST;
      labelsToAdd: typeof NAME_LIST;
    }>
  >;
  reason: StrictOptional<StrictNullable<StrictText>>;
}> = StrictAnswer.object({
  rule: StrictAnswer.nullable(
    StrictAnswer.object({
      kind: StrictAnswer.text({
        maxLength: 20,
        oneOf: ALL_DATA_SECURITY_RULE_KINDS,
      }),
      name: StrictAnswer.text({
        maxLength: MAX_RULE_NAME_LENGTH,
        isOneLine: true,
      }),
      description: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.text({
            maxLength: MAX_RULE_DESCRIPTION_LENGTH,
            isOneLine: true,
          }),
        ),
      ),
      dataCategories: NAME_LIST,
      subjectCountries: NAME_LIST,
      allowedRegions: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.list(
            StrictAnswer.text({ maxLength: 64, isOneLine: true }),
            {
              maxItems: MAX_RULE_REGIONS,
            },
          ),
        ),
      ),
      nameRegexPattern: PATTERN,
      descriptionRegexPattern: PATTERN,
      cloudTagPattern: PATTERN,
      matchLabels: NAME_LIST,
      owners: NAME_LIST,
      labelsToAdd: NAME_LIST,
    }),
  ),
  reason: StrictAnswer.optional(
    StrictAnswer.nullable(
      StrictAnswer.text({
        maxLength: MAX_RULE_DRAFT_REASON_LENGTH,
        isOneLine: true,
      }),
    ),
  ),
});

type RuleDraftAnswerValue = StrictValue<typeof RULE_DRAFT_ANSWER>;

export type RuleDraftAnswer =
  // A draft, and why.
  | { kind: "draft"; draft: DataSecurityRuleDraft; reason: string }
  // No rule of these kinds in the sentence, and why.
  | { kind: "none"; reason: string };

/*
 * The answer, read: a draft, or no rule. Null when it is not the JSON
 * object asked for.
 */
export function readRuleDraftAnswer(
  content: string | null | undefined,
): RuleDraftAnswer | null {
  const answer: RuleDraftAnswerValue | null = readStrictAnswer(
    content,
    RULE_DRAFT_ANSWER,
  );

  if (!answer) {
    return null;
  }

  const reason: string = (answer.reason || "").slice(
    0,
    MAX_RULE_DRAFT_REASON_LENGTH,
  );

  if (answer.rule === null) {
    return { kind: "none", reason };
  }

  const draft: DataSecurityRuleDraft | null = readDataSecurityRuleDraft(
    answer.rule,
  );

  return draft ? { kind: "draft", draft, reason } : null;
}
