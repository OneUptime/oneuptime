import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "../../../Types/Filter/FilterConditionUtil";
import RuleCriteria, {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { isRuleCriteriaConditionRequired } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  resolveRuleCriteriaSubject,
  RuleCriteriaSubject,
} from "../../../Types/Rules/RuleCriteriaSubject";
import { isValidRuleCriteria } from "../../../Utils/Rules/RuleCriteriaMatcher";
import {
  composedValue,
  createTranslator,
  PluralTemplate,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import { getClauseSeparator } from "../../Utils/ListSeparator";
import useTranslator from "../../Utils/UseTranslator";
import React, { Fragment, ReactElement, ReactNode } from "react";
import Field from "../Forms/Types/Field";
import IsolatedText from "../IsolatedText/IsolatedText";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import {
  convertLegacyValuesToRuleCriteria,
  findRuleCriteriaField,
  getRuleCriteriaFieldTitle,
  isRuleCriteriaAddressRangeField,
  isRuleCriteriaOwnerField,
  RULE_CRITERIA_ARRAY_OPERATORS,
} from "./RuleCriteriaFields";
import { getRuleCriteriaSubjectCopy } from "./RuleCriteriaSubjectCopy";

export interface RuleCriteriaSummaryData<TEntity> {
  fields: Array<Field<TEntity>>;
  item: TEntity;
  /*
   * The records the rule is for, when its table says (a table of rules
   * about several kinds of record). Otherwise the rule's model says.
   */
  subject?: RuleCriteriaSubject | null | undefined;
}

/*
 * What a rule with no conditions does, which depends on the kind of rule: a
 * rule that needs a condition matches nothing; any other applies to all of
 * its records, and says so as its form's choice does - "All incidents"
 * (RuleCriteriaSubjectCopy), or "Everything" for a rule nothing names.
 */
export const RULE_CRITERIA_SUMMARY_MATCHES_NOTHING: string = translationKey(
  "Matches nothing (no conditions)",
);
export const RULE_CRITERIA_SUMMARY_INVALID: string = translationKey(
  "Invalid match criteria",
);

/*
 * EACH CONDITION, ONE SENTENCE IN THE READER'S LANGUAGE (#7958).
 *
 * The Match Criteria column of every rule table (Network > Settings > Auto
 * Import Rules, site assignment rules, label rules...) and a rule run's
 * details sum a rule's conditions up. The line was glued in English -
 * field title, the operator's label lowercased, the value in quotes - so
 * it read `IP Address is in "10.16.0.0/16"` under a German or a Hindi
 * header, and on a Persian page its quotes jumped to the far side of the
 * line.
 *
 * Each condition is one sentence here, by its operator: the field is the
 * product's word, looked up with the sentence; the value is what a person
 * typed, set apart as written; the quotes are the sentence's, so a
 * language writes its own („…“, «…», 「…」). A list of records is counted
 * in the reader's plural forms. "Match all:" and "Match any:" are
 * sentences of their own around the conditions, which are joined with the
 * semicolon of the language they came out in (getClauseSeparator).
 *
 * In English every sentence reads exactly as the line did, which is also
 * what the table exports (getRuleCriteriaSummaryText with no translator).
 */
export const RULE_CRITERIA_CONDITION_SENTENCES: Partial<
  Record<RuleCriteriaOperator, string>
> = {
  [RuleCriteriaOperator.Equals]: translationKey("{{field}} equals “{{value}}”"),
  [RuleCriteriaOperator.NotEquals]: translationKey(
    "{{field}} does not equal “{{value}}”",
  ),
  [RuleCriteriaOperator.Contains]: translationKey(
    "{{field}} contains “{{value}}”",
  ),
  [RuleCriteriaOperator.DoesNotContain]: translationKey(
    "{{field}} does not contain “{{value}}”",
  ),
  [RuleCriteriaOperator.StartsWith]: translationKey(
    "{{field}} starts with “{{value}}”",
  ),
  [RuleCriteriaOperator.EndsWith]: translationKey(
    "{{field}} ends with “{{value}}”",
  ),
  [RuleCriteriaOperator.MatchesPattern]: translationKey(
    "{{field}} matches pattern “{{value}}”",
  ),
  [RuleCriteriaOperator.DoesNotMatchPattern]: translationKey(
    "{{field}} does not match pattern “{{value}}”",
  ),
  /*
   * A list operator (has any of...) holds the ids of records, whose count
   * is said instead (RULE_CRITERIA_LIST_SENTENCES).
   */
};

// An address range's field (an IP address, a subnet) is in a range, or not.
export const RULE_CRITERIA_ADDRESS_RANGE_SENTENCES: Partial<
  Record<RuleCriteriaOperator, string>
> = {
  [RuleCriteriaOperator.MatchesPattern]: translationKey(
    "{{field}} is in “{{value}}”",
  ),
  [RuleCriteriaOperator.DoesNotMatchPattern]: translationKey(
    "{{field}} is not in “{{value}}”",
  ),
};

// A yes or no, said without quotes: "Enabled equals true".
export const RULE_CRITERIA_YES_OR_NO_SENTENCES: Partial<
  Record<RuleCriteriaOperator, string>
> = {
  [RuleCriteriaOperator.Equals]: translationKey("{{field}} equals {{value}}"),
  [RuleCriteriaOperator.NotEquals]: translationKey(
    "{{field}} does not equal {{value}}",
  ),
};

// A list of records, counted: "Monitor Labels has any of 2 selected values".
export const RULE_CRITERIA_LIST_SENTENCES: Record<
  | RuleCriteriaOperator.HasAnyOf
  | RuleCriteriaOperator.HasAllOf
  | RuleCriteriaOperator.HasNoneOf,
  PluralTemplate
> = {
  [RuleCriteriaOperator.HasAnyOf]: {
    one: "{{field}} has any of {{count}} selected value",
    other: "{{field}} has any of {{count}} selected values",
  },
  [RuleCriteriaOperator.HasAllOf]: {
    one: "{{field}} has all of {{count}} selected value",
    other: "{{field}} has all of {{count}} selected values",
  },
  [RuleCriteriaOperator.HasNoneOf]: {
    one: "{{field}} has none of {{count}} selected value",
    other: "{{field}} has none of {{count}} selected values",
  },
};

/*
 * Who owns the record (#9353), counted: "Alert Owner is any of 2 selected
 * people or teams" - the words the condition's operator reads as.
 */
export const RULE_CRITERIA_OWNER_SENTENCES: Record<
  RuleCriteriaOperator.HasAnyOf | RuleCriteriaOperator.HasNoneOf,
  PluralTemplate
> = {
  [RuleCriteriaOperator.HasAnyOf]: {
    one: "{{field}} is any of {{count}} selected person or team",
    other: "{{field}} is any of {{count}} selected people or teams",
  },
  [RuleCriteriaOperator.HasNoneOf]: {
    one: "{{field}} is none of {{count}} selected person or team",
    other: "{{field}} is none of {{count}} selected people or teams",
  },
};

// Two or more conditions, and how they are combined.
export const RULE_CRITERIA_MATCH_ALL_SENTENCE: string = translationKey(
  "Match all: {{conditions}}",
);
export const RULE_CRITERIA_MATCH_ANY_SENTENCE: string = translationKey(
  "Match any: {{conditions}}",
);

// A yes or no a condition holds, in the reader's words, mid-sentence.
const TRUE_WORD: string = translationKey("True");
const FALSE_WORD: string = translationKey("False");

// The sentences in English, as the table exports them.
const ENGLISH: Translator = createTranslator(undefined, "en");

// One condition, read: its sentence and what fills it.
export interface RuleCriteriaConditionReading {
  template: string | PluralTemplate;
  // The field's name: the form's title, a key of the locale files.
  field: string;
  // The value as typed, quoted by the sentence; none for a list or a yes or no.
  value?: string | undefined;
  // The number of records a list holds.
  count?: number | undefined;
  booleanValue?: boolean | undefined;
}

function isListOperator(
  operator: RuleCriteriaOperator,
): operator is keyof typeof RULE_CRITERIA_LIST_SENTENCES {
  return RULE_CRITERIA_ARRAY_OPERATORS.includes(operator);
}

export function readRuleCriteriaCondition<TEntity>(
  fields: Array<Field<TEntity>>,
  filter: RuleCriteriaFilter,
): RuleCriteriaConditionReading {
  const field: Field<TEntity> | undefined = findRuleCriteriaField(
    fields,
    filter.field,
  );
  const fieldTitle: string = getRuleCriteriaFieldTitle(field, filter.field);

  // Who owns the record: the people and teams picked, counted.
  if (
    isRuleCriteriaOwnerField(field) &&
    (filter.operator === RuleCriteriaOperator.HasAnyOf ||
      filter.operator === RuleCriteriaOperator.HasNoneOf)
  ) {
    return {
      template: RULE_CRITERIA_OWNER_SENTENCES[filter.operator],
      field: fieldTitle,
      count: Array.isArray(filter.value) ? filter.value.length : 1,
    };
  }

  /*
   * A list of records, counted. A saved rule holds a list operator with a
   * list and every other with one value (RuleCriteriaMatcher); one that
   * does not is read as the list it would be.
   */
  if (Array.isArray(filter.value) || isListOperator(filter.operator)) {
    return {
      template:
        RULE_CRITERIA_LIST_SENTENCES[
          isListOperator(filter.operator)
            ? filter.operator
            : RuleCriteriaOperator.HasAnyOf
        ],
      field: fieldTitle,
      count: Array.isArray(filter.value) ? filter.value.length : 1,
    };
  }

  if (typeof filter.value === "boolean") {
    const yesOrNo: string | undefined =
      RULE_CRITERIA_YES_OR_NO_SENTENCES[filter.operator];

    if (yesOrNo) {
      return {
        template: yesOrNo,
        field: fieldTitle,
        booleanValue: filter.value,
      };
    }
  }

  const addressRange: string | undefined = isRuleCriteriaAddressRangeField(
    field,
  )
    ? RULE_CRITERIA_ADDRESS_RANGE_SENTENCES[filter.operator]
    : undefined;

  return {
    template:
      addressRange ||
      RULE_CRITERIA_CONDITION_SENTENCES[filter.operator] ||
      (RULE_CRITERIA_CONDITION_SENTENCES[
        RuleCriteriaOperator.Equals
      ] as string),
    field: fieldTitle,
    value: String(filter.value),
  };
}

// A yes or no in the words of the sentence it goes in, as a sentence says it.
function getYesOrNoWord(value: boolean, sentence: Translator): string {
  const word: string = value ? TRUE_WORD : FALSE_WORD;

  return (sentence.translateText(word) || word).toLocaleLowerCase(
    sentence.language,
  );
}

// What fills a condition's sentence besides the value a person typed.
function getConditionValues(
  reading: RuleCriteriaConditionReading,
): TemplateValues {
  const values: TemplateValues = {
    field: translatableTerm(reading.field),
  };

  if (reading.booleanValue !== undefined) {
    const booleanValue: boolean = reading.booleanValue;

    values["value"] = composedValue((sentence: Translator): string => {
      return getYesOrNoWord(booleanValue, sentence);
    });
  }

  return values;
}

// One condition as text, in `translator`'s language.
export function formatRuleCriteriaCondition(
  reading: RuleCriteriaConditionReading,
  translator: Translator,
  options?: { setsValuesApart?: boolean | undefined },
): string {
  const values: TemplateValues = getConditionValues(reading);

  if (reading.value !== undefined) {
    values["value"] = reading.value;
  }

  if (typeof reading.template === "string") {
    return translator.translateTemplate(reading.template, values, options);
  }

  return translator.translatePlural(
    reading.template,
    reading.count || 0,
    values,
    options,
  );
}

function getCriteria<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): RuleCriteria | null {
  const item: Record<string, unknown> = data.item as unknown as Record<
    string,
    unknown
  >;
  const configuredCriteria: unknown = item["criteria"];

  if (configuredCriteria !== undefined && configuredCriteria !== null) {
    return isValidRuleCriteria(configuredCriteria) ? configuredCriteria : null;
  }

  return convertLegacyValuesToRuleCriteria({
    fields: data.fields,
    values: item,
  });
}

function getTableName<TEntity>(item: TEntity): string | null {
  const tableName: unknown = (item as unknown as { tableName?: unknown })
    .tableName;

  return typeof tableName === "string" ? tableName : null;
}

function getEmptySummary<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): string {
  const tableName: string | null = getTableName(data.item);

  if (isRuleCriteriaConditionRequired(tableName)) {
    return RULE_CRITERIA_SUMMARY_MATCHES_NOTHING;
  }

  return getRuleCriteriaSubjectCopy(
    resolveRuleCriteriaSubject({
      modelName: tableName,
      subject: data.subject,
    }),
  ).all;
}

/*
 * What a rule's summary says: one phrase of the locale files (no
 * conditions, or criteria that cannot be read), or its conditions and how
 * they are combined.
 */
export type RuleCriteriaSummaryReading =
  | { kind: "phrase"; phrase: string }
  | {
      kind: "conditions";
      conditions: Array<RuleCriteriaConditionReading>;
      // How two or more are combined; null for a single condition.
      combinedWith: FilterCondition | null;
    };

export function readRuleCriteriaSummary<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): RuleCriteriaSummaryReading {
  const configuredCriteria: unknown = (
    data.item as unknown as Record<string, unknown>
  )["criteria"];
  const criteria: RuleCriteria | null = getCriteria(data);

  if (!criteria) {
    return {
      kind: "phrase",
      phrase:
        configuredCriteria !== undefined && configuredCriteria !== null
          ? RULE_CRITERIA_SUMMARY_INVALID
          : getEmptySummary(data),
    };
  }

  if (criteria.filters.length === 0) {
    return { kind: "phrase", phrase: getEmptySummary(data) };
  }

  return {
    kind: "conditions",
    conditions: criteria.filters.map(
      (filter: RuleCriteriaFilter): RuleCriteriaConditionReading => {
        return readRuleCriteriaCondition(data.fields, filter);
      },
    ),
    /*
     * "Match all" / "Match any" only once there are two conditions to
     * combine (isFilterConditionNeeded), as the conditions builder asks
     * it: one condition is simply the condition.
     */
    combinedWith: isFilterConditionNeeded(criteria.filters)
      ? criteria.filterCondition === FilterCondition.All
        ? FilterCondition.All
        : FilterCondition.Any
      : null,
  };
}

function getCombinedSentence(combinedWith: FilterCondition): string {
  return combinedWith === FilterCondition.All
    ? RULE_CRITERIA_MATCH_ALL_SENTENCE
    : RULE_CRITERIA_MATCH_ANY_SENTENCE;
}

/*
 * The summary as text. With no translator it is English, word for word as
 * the line always read - what the table exports and searches. Handed the
 * reader's, it is in their language: what the cell shows on hover.
 */
export function getRuleCriteriaSummaryText<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
  translator: Translator = ENGLISH,
  options?: { setsValuesApart?: boolean | undefined },
): string {
  const reading: RuleCriteriaSummaryReading = readRuleCriteriaSummary(data);

  if (reading.kind === "phrase") {
    return translator.translateText(reading.phrase) || reading.phrase;
  }

  const conditions: Array<string> = reading.conditions.map(
    (condition: RuleCriteriaConditionReading): string => {
      return formatRuleCriteriaCondition(condition, translator, options);
    },
  );

  if (reading.combinedWith === null) {
    return conditions.join(getClauseSeparator(conditions, translator.language));
  }

  return translator.translateTemplate(
    getCombinedSentence(reading.combinedWith),
    {
      conditions: composedValue((sentence: Translator): string => {
        const inSentence: Array<string> = reading.conditions.map(
          (condition: RuleCriteriaConditionReading): string => {
            return formatRuleCriteriaCondition(condition, sentence, options);
          },
        );

        return inSentence.join(
          getClauseSeparator(inSentence, sentence.language),
        );
      }),
    },
    options,
  );
}

// One condition, drawn: its value set apart as typed.
const RuleCriteriaCondition: (props: {
  reading: RuleCriteriaConditionReading;
}) => ReactElement = (props: {
  reading: RuleCriteriaConditionReading;
}): ReactElement => {
  const values: TemplateValues = getConditionValues(props.reading);
  const slots: Record<string, ReactNode> = {};

  if (props.reading.value !== undefined) {
    slots["value"] = (
      <IsolatedText text={props.reading.value} className="font-medium" />
    );
  }

  return (
    <TranslatedSentence
      template={props.reading.template}
      count={props.reading.count}
      values={values}
      slots={slots}
    />
  );
};

const RuleCriteriaSummary: <TEntity extends BaseModel>(
  props: RuleCriteriaSummaryData<TEntity>,
) => ReactElement = <TEntity extends BaseModel>(
  props: RuleCriteriaSummaryData<TEntity>,
): ReactElement => {
  const { fields, item, subject } = props;
  const translator: Translator = useTranslator();
  const data: RuleCriteriaSummaryData<TEntity> = { fields, item, subject };
  const reading: RuleCriteriaSummaryReading = readRuleCriteriaSummary(data);
  // The whole summary under the pointer, in the same words.
  const title: string = getRuleCriteriaSummaryText(data, translator, {
    setsValuesApart: true,
  });

  let summary: ReactNode = title;

  if (reading.kind === "conditions") {
    const conditionTexts: Array<string> = reading.conditions.map(
      (condition: RuleCriteriaConditionReading): string => {
        return formatRuleCriteriaCondition(condition, translator);
      },
    );
    const separator: string = getClauseSeparator(
      conditionTexts,
      translator.language,
    );
    const conditions: ReactElement = (
      <>
        {reading.conditions.map(
          (
            condition: RuleCriteriaConditionReading,
            index: number,
          ): ReactElement => {
            return (
              <Fragment key={index}>
                {index > 0 ? separator : <></>}
                <RuleCriteriaCondition reading={condition} />
              </Fragment>
            );
          },
        )}
      </>
    );

    summary =
      reading.combinedWith === null ? (
        conditions
      ) : (
        <TranslatedSentence
          template={getCombinedSentence(reading.combinedWith)}
          slots={{ conditions: conditions }}
        />
      );
  }

  return (
    <span
      className="text-sm text-gray-700"
      title={title}
      data-testid="rule-criteria-summary"
    >
      {summary}
    </span>
  );
};

export default RuleCriteriaSummary;
