import FilterCondition from "../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
  RuleCriteriaValue,
} from "../../../Types/Rules/RuleCriteria";
import {
  getRuleCriteriaValidationError,
  RULE_CRITERIA_MAX_FILTERS,
  RULE_CRITERIA_MAX_RELATION_VALUES,
  RULE_CRITERIA_MAX_STRING_LENGTH,
} from "../../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import type Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import type FormValues from "../Forms/Types/FormValues";

/*
 * What the condition builder knows about the fields a rule can match on, kept
 * apart from the component so the form, the rule table's summary and the tests
 * all read the same answers.
 *
 * A rule page lists its match fields as ordinary form fields on the
 * "match-criteria" step: the column a condition stores into, the title the
 * criteria picker shows, the field type that decides the operators. Nothing in
 * here is specific to one rule kind except the two address-range fields, whose
 * pattern operators read "Is in".
 */

export const RULE_CRITERIA_ARRAY_OPERATORS: ReadonlyArray<RuleCriteriaOperator> =
  [
    RuleCriteriaOperator.HasAnyOf,
    RuleCriteriaOperator.HasAllOf,
    RuleCriteriaOperator.HasNoneOf,
  ];

export const RULE_CRITERIA_TEXT_OPERATORS: ReadonlyArray<RuleCriteriaOperator> =
  [
    RuleCriteriaOperator.Contains,
    RuleCriteriaOperator.DoesNotContain,
    RuleCriteriaOperator.Equals,
    RuleCriteriaOperator.NotEquals,
    RuleCriteriaOperator.StartsWith,
    RuleCriteriaOperator.EndsWith,
    RuleCriteriaOperator.MatchesPattern,
    RuleCriteriaOperator.DoesNotMatchPattern,
  ];

export const RULE_CRITERIA_SCALAR_OPERATORS: ReadonlyArray<RuleCriteriaOperator> =
  [RuleCriteriaOperator.Equals, RuleCriteriaOperator.NotEquals];

export const RULE_CRITERIA_PATTERN_OPERATORS: ReadonlyArray<RuleCriteriaOperator> =
  [
    RuleCriteriaOperator.MatchesPattern,
    RuleCriteriaOperator.DoesNotMatchPattern,
  ];

/*
 * Fields that take one syntax of their own rather than free text, so only the
 * pattern operators make sense: an IP range, and an SNMP object ID prefix.
 */
const PATTERN_ONLY_FIELD_NAMES: ReadonlyArray<string> = [
  "ipMatchTarget",
  "sysObjectIdPattern",
  "subnetCidr",
];

/*
 * The fields whose value is an address range (a CIDR, or an octet range)
 * that the resource's IP has to fall inside. "Host IP matches pattern
 * 10.0.0.0/8" says it the long way round; "Host IP is in 10.0.0.0/8" is what
 * the rule actually checks.
 */
export const RULE_CRITERIA_ADDRESS_RANGE_FIELD_NAMES: ReadonlyArray<string> = [
  "ipMatchTarget",
  "subnetCidr",
];

export const RULE_CRITERIA_OPERATOR_LABELS: Record<
  RuleCriteriaOperator,
  string
> = {
  [RuleCriteriaOperator.Equals]: "Equals",
  [RuleCriteriaOperator.NotEquals]: "Does not equal",
  [RuleCriteriaOperator.Contains]: "Contains",
  [RuleCriteriaOperator.DoesNotContain]: "Does not contain",
  [RuleCriteriaOperator.StartsWith]: "Starts with",
  [RuleCriteriaOperator.EndsWith]: "Ends with",
  [RuleCriteriaOperator.MatchesPattern]: "Matches pattern",
  [RuleCriteriaOperator.DoesNotMatchPattern]: "Does not match pattern",
  [RuleCriteriaOperator.HasAnyOf]: "Has any of",
  [RuleCriteriaOperator.HasAllOf]: "Has all of",
  [RuleCriteriaOperator.HasNoneOf]: "Has none of",
};

export const RULE_CRITERIA_ADDRESS_RANGE_OPERATOR_LABELS: Partial<
  Record<RuleCriteriaOperator, string>
> = {
  [RuleCriteriaOperator.MatchesPattern]: "Is in",
  [RuleCriteriaOperator.DoesNotMatchPattern]: "Is not in",
};

/*
 * Every sentence the builder and its validation can show, in English. The
 * dashboard looks each one up in its locale files by this text, so the i18n
 * test holds the whole list to all seventeen of them. "{{max}}" and
 * "{{number}}" are filled in after the lookup.
 */
export const RuleCriteriaCopy: {
  readonly ifConnector: string;
  readonly andConnector: string;
  readonly orConnector: string;
  readonly combineLegend: string;
  readonly matchAll: string;
  readonly matchAny: string;
  readonly matchAllHint: string;
  readonly matchAnyHint: string;
  readonly emptyTitle: string;
  readonly emptyMatchesEverything: string;
  readonly emptyNeedsCondition: string;
  readonly addCondition: string;
  readonly removeCondition: string;
  readonly fieldUnavailable: string;
  readonly selectOneOrMore: string;
  readonly selectAValue: string;
  readonly enterText: string;
  readonly enterANumber: string;
  readonly enterAPattern: string;
  readonly trueValue: string;
  readonly falseValue: string;
  readonly enterAValueProblem: string;
  readonly chooseAValueProblem: string;
  readonly chooseAtLeastOneValueProblem: string;
  readonly enterANumberProblem: string;
  readonly invalidPatternProblem: string;
  readonly invalidAddressRangeProblem: string;
  readonly tooLongProblem: string;
  readonly tooManyValuesProblem: string;
  readonly addAtLeastOneConditionProblem: string;
  readonly tooManyConditionsProblem: string;
  readonly conditionProblem: string;
} = {
  ifConnector: "If",
  andConnector: "And",
  orConnector: "Or",
  combineLegend: "How conditions are combined",
  matchAll: "Match all",
  matchAny: "Match any",
  matchAllHint: "Every condition must be true.",
  matchAnyHint: "At least one condition must be true.",
  emptyTitle: "No conditions yet",
  emptyMatchesEverything:
    "Without conditions, this rule applies to everything. Add a condition to narrow it down.",
  emptyNeedsCondition:
    "Add at least one condition. This rule only applies to what its conditions match.",
  addCondition: "Add condition",
  removeCondition: "Remove condition",
  fieldUnavailable:
    "This field is no longer available. Choose another one or remove this condition.",
  selectOneOrMore: "Select one or more",
  selectAValue: "Select a value",
  enterText: "Enter text",
  enterANumber: "Enter a number",
  enterAPattern: "Enter a pattern",
  trueValue: "True",
  falseValue: "False",
  enterAValueProblem: "Enter a value.",
  chooseAValueProblem: "Choose a value.",
  chooseAtLeastOneValueProblem: "Choose at least one value.",
  enterANumberProblem: "Enter a number.",
  invalidPatternProblem:
    "Enter a valid pattern: a regular expression such as ^api-.* or a * wildcard such as *api*.",
  invalidAddressRangeProblem:
    "Enter an address range such as 10.0.0.0/24 or 10.16-22.0-255.1-254.",
  tooLongProblem: "Use {{max}} characters or fewer.",
  tooManyValuesProblem: "Choose {{max}} values or fewer.",
  addAtLeastOneConditionProblem: "Add at least one condition.",
  tooManyConditionsProblem: "Use {{max}} conditions or fewer.",
  conditionProblem: "Condition {{number}}: {{problem}}",
};

/*
 * A message for the person filling in the form: an English template from
 * RuleCriteriaCopy and the values its placeholders take. It is translated
 * where it is shown (formatRuleCriteriaMessage), never assembled in English
 * first: "Condition 2: Enter a value." is the template "Condition
 * {{number}}: {{problem}}" around the separately translated "Enter a value.".
 */
export interface RuleCriteriaMessage {
  text: string;
  values?: Record<string, string | number> | undefined;
  // The message that fills this one's {{problem}}.
  inner?: RuleCriteriaMessage | undefined;
}

export type RuleCriteriaMessageTranslator = (
  template: string,
  values: Record<string, string | number>,
) => string;

// Fills a template in English, for callers with no translation at hand.
export const englishRuleCriteriaMessage: RuleCriteriaMessageTranslator = (
  template: string,
  values: Record<string, string | number>,
): string => {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (placeholder: string, name: string): string => {
      return values[name] === undefined ? placeholder : String(values[name]);
    },
  );
};

export function formatRuleCriteriaMessage(
  message: RuleCriteriaMessage,
  translate: RuleCriteriaMessageTranslator = englishRuleCriteriaMessage,
): string {
  const values: Record<string, string | number> = {
    ...(message.values || {}),
  };

  if (message.inner) {
    values["problem"] = formatRuleCriteriaMessage(message.inner, translate);
  }

  return translate(message.text, values);
}

const TEXT_FIELD_TYPES: ReadonlyArray<FormFieldSchemaType> = [
  FormFieldSchemaType.Text,
  FormFieldSchemaType.LongText,
  FormFieldSchemaType.Name,
  FormFieldSchemaType.Hostname,
  FormFieldSchemaType.Domain,
  FormFieldSchemaType.Email,
  FormFieldSchemaType.URL,
  FormFieldSchemaType.Route,
];

const NUMBER_FIELD_TYPES: ReadonlyArray<FormFieldSchemaType> = [
  FormFieldSchemaType.Number,
  FormFieldSchemaType.PositiveNumber,
  FormFieldSchemaType.Port,
];

// "(optional)" at the end of a placeholder written for the old, optional field.
const OPTIONAL_PLACEHOLDER_SUFFIX: RegExp = /\(optional\)\s*$/i;

// A column name's trailing "Pattern" / "Regex Pattern", never part of a title.
const PATTERN_TITLE_SUFFIX: RegExp = /(?:\s+regex)?\s+pattern$/i;

export function getRuleCriteriaFieldName<TEntity>(
  field: Field<TEntity>,
): string | null {
  if (field.overrideFieldKey) {
    return field.overrideFieldKey;
  }

  const names: Array<string> = Object.keys(field.field || {});
  return names[0] || null;
}

/*
 * The name a criterion goes by: its form field's title, or, for a field
 * written without one, its column name in words - less the "Pattern" a
 * column name carries for the old regex-only fields, because the operator
 * is what says a value is a pattern.
 */
export function getRuleCriteriaFieldTitle<TEntity>(
  field: Field<TEntity> | undefined,
  fieldName: string,
): string {
  if (field?.title) {
    return field.title;
  }

  const words: string = fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character: string): string => {
      return character.toUpperCase();
    });

  return words.replace(PATTERN_TITLE_SUFFIX, "") || words;
}

export function isRuleCriteriaArrayOperator(
  operator: RuleCriteriaOperator,
): boolean {
  return RULE_CRITERIA_ARRAY_OPERATORS.includes(operator);
}

export function isRuleCriteriaPatternOperator(
  operator: RuleCriteriaOperator,
): boolean {
  return RULE_CRITERIA_PATTERN_OPERATORS.includes(operator);
}

function isTextField<TEntity>(field: Field<TEntity>): boolean {
  return TEXT_FIELD_TYPES.includes(field.fieldType || FormFieldSchemaType.Text);
}

function isNumberField<TEntity>(field: Field<TEntity>): boolean {
  return NUMBER_FIELD_TYPES.includes(
    field.fieldType || FormFieldSchemaType.Text,
  );
}

function isBooleanField<TEntity>(field: Field<TEntity>): boolean {
  return (
    field.fieldType === FormFieldSchemaType.Toggle ||
    field.fieldType === FormFieldSchemaType.Checkbox
  );
}

// A value picked from a list rather than typed.
function isChoiceField<TEntity>(field: Field<TEntity>): boolean {
  return (
    Boolean(field.dropdownModal) ||
    Boolean(field.dropdownOptions) ||
    isBooleanField(field)
  );
}

export function isRuleCriteriaAddressRangeField<TEntity>(
  field: Field<TEntity> | undefined,
): boolean {
  if (!field) {
    return false;
  }

  return RULE_CRITERIA_ADDRESS_RANGE_FIELD_NAMES.includes(
    getRuleCriteriaFieldName(field) || "",
  );
}

export function getRuleCriteriaOperatorsForField<TEntity>(
  field: Field<TEntity>,
): Array<RuleCriteriaOperator> {
  const fieldName: string = getRuleCriteriaFieldName(field) || "";

  if (PATTERN_ONLY_FIELD_NAMES.includes(fieldName)) {
    return [...RULE_CRITERIA_PATTERN_OPERATORS];
  }

  if (field.fieldType === FormFieldSchemaType.MultiSelectDropdown) {
    return [...RULE_CRITERIA_ARRAY_OPERATORS];
  }

  if (isTextField(field)) {
    return [...RULE_CRITERIA_TEXT_OPERATORS];
  }

  return [...RULE_CRITERIA_SCALAR_OPERATORS];
}

/*
 * The operator's name as the criteria picker and the rule summary say it,
 * for this field: "Is in" for an address range, the plain name otherwise.
 */
export function getRuleCriteriaOperatorLabel<TEntity>(
  field: Field<TEntity> | undefined,
  operator: RuleCriteriaOperator,
): string {
  if (isRuleCriteriaAddressRangeField(field)) {
    const label: string | undefined =
      RULE_CRITERIA_ADDRESS_RANGE_OPERATOR_LABELS[operator];

    if (label) {
      return label;
    }
  }

  return RULE_CRITERIA_OPERATOR_LABELS[operator] || operator;
}

/*
 * What an old rule's own column meant, before conditions: a relation column
 * matched any of its values, a "...Pattern" column was a regex, and any other
 * column had to equal its value. A rule saved that way is shown and kept with
 * exactly that meaning.
 */
export function getLegacyRuleCriteriaOperator<TEntity>(
  field: Field<TEntity>,
): RuleCriteriaOperator {
  const fieldName: string = getRuleCriteriaFieldName(field) || "";
  const operators: Array<RuleCriteriaOperator> =
    getRuleCriteriaOperatorsForField(field);

  if (field.fieldType === FormFieldSchemaType.MultiSelectDropdown) {
    return RuleCriteriaOperator.HasAnyOf;
  }

  if (
    isTextField(field) &&
    fieldName.toLocaleLowerCase().includes("pattern") &&
    operators.includes(RuleCriteriaOperator.MatchesPattern)
  ) {
    return RuleCriteriaOperator.MatchesPattern;
  }

  if (operators.includes(RuleCriteriaOperator.Equals)) {
    return RuleCriteriaOperator.Equals;
  }

  return operators[0]!;
}

/*
 * The operator a new condition starts on. Text starts on "Contains" - what
 * most people mean by "the title is about databases" - and patterns are one
 * choice away for whoever wants a regex. A field that only takes patterns
 * starts on its pattern operator, and a list on "Has any of".
 */
export function getDefaultRuleCriteriaOperator<TEntity>(
  field: Field<TEntity>,
): RuleCriteriaOperator {
  const operators: Array<RuleCriteriaOperator> =
    getRuleCriteriaOperatorsForField(field);

  if (operators.includes(RuleCriteriaOperator.HasAnyOf)) {
    return RuleCriteriaOperator.HasAnyOf;
  }

  if (operators.includes(RuleCriteriaOperator.Contains)) {
    return RuleCriteriaOperator.Contains;
  }

  return operators[0]!;
}

function normalizeScalarValue(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value && typeof value === "object") {
    const objectValue: Record<string, unknown> = value as Record<
      string,
      unknown
    >;

    for (const key of ["value", "_id", "id"]) {
      const candidate: unknown = objectValue[key];

      if (
        typeof candidate === "string" ||
        typeof candidate === "number" ||
        typeof candidate === "boolean"
      ) {
        return candidate;
      }

      if (
        candidate &&
        typeof candidate === "object" &&
        typeof (candidate as { toString?: () => string }).toString ===
          "function"
      ) {
        const stringValue: string = (
          candidate as { toString: () => string }
        ).toString();

        if (stringValue !== "[object Object]") {
          return stringValue;
        }
      }
    }
  }

  return "";
}

export function normalizeRuleCriteriaValue(
  value: unknown,
  operator: RuleCriteriaOperator,
): RuleCriteriaValue {
  if (isRuleCriteriaArrayOperator(operator)) {
    const values: Array<unknown> = Array.isArray(value) ? value : [value];

    return values
      .map((item: unknown): string => {
        return normalizeScalarValue(item).toString();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  return normalizeScalarValue(value);
}

function hasLegacyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

export function convertLegacyValuesToRuleCriteria<TEntity>(data: {
  fields: Array<Field<TEntity>>;
  values?: Record<string, unknown> | undefined;
}): RuleCriteria {
  const filters: Array<RuleCriteriaFilter> = [];

  for (const field of data.fields) {
    const fieldName: string | null = getRuleCriteriaFieldName(field);

    if (!fieldName) {
      continue;
    }

    const legacyValue: unknown = data.values?.[fieldName];

    if (!hasLegacyValue(legacyValue)) {
      continue;
    }

    const operator: RuleCriteriaOperator = getLegacyRuleCriteriaOperator(field);

    filters.push({
      field: fieldName,
      operator: operator,
      value: normalizeRuleCriteriaValue(legacyValue, operator),
    });
  }

  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

// The fields a condition can be about right now: those whose showIf allows it.
export function getAvailableRuleCriteriaFields<TEntity>(
  fields: Array<Field<TEntity>>,
  values: Record<string, unknown> | undefined,
): Array<Field<TEntity>> {
  return fields.filter((field: Field<TEntity>): boolean => {
    return (
      Boolean(getRuleCriteriaFieldName(field)) &&
      (!field.showIf || field.showIf((values || {}) as FormValues<TEntity>))
    );
  });
}

export function findRuleCriteriaField<TEntity>(
  fields: Array<Field<TEntity>>,
  fieldName: string,
): Field<TEntity> | undefined {
  return fields.find((field: Field<TEntity>): boolean => {
    return getRuleCriteriaFieldName(field) === fieldName;
  });
}

export function getEmptyRuleCriteriaValue<TEntity>(
  field: Field<TEntity>,
  operator: RuleCriteriaOperator,
): RuleCriteriaValue {
  if (isRuleCriteriaArrayOperator(operator)) {
    return [];
  }

  if (isBooleanField(field)) {
    return true;
  }

  if (isNumberField(field)) {
    return 0;
  }

  return "";
}

/*
 * The placeholder in a condition's value box. The rule pages wrote theirs for
 * the old, optional fields ("Select Monitors (optional)"); in a condition the
 * value is what the condition is about, so those give way to a plain prompt.
 * A pattern keeps the page's example (prod-.*, 10.42.7.0/24), which shows the
 * syntax better than any sentence could - but only for a pattern operator: an
 * example regex in a "Contains" box reads as something to type literally.
 */
export function getRuleCriteriaValuePlaceholder<TEntity>(
  field: Field<TEntity>,
  operator: RuleCriteriaOperator,
): string {
  const ownPlaceholder: string = (field.placeholder || "").trim();
  const usableOwnPlaceholder: string | null =
    ownPlaceholder && !OPTIONAL_PLACEHOLDER_SUFFIX.test(ownPlaceholder)
      ? ownPlaceholder
      : null;

  if (isRuleCriteriaArrayOperator(operator)) {
    return usableOwnPlaceholder || RuleCriteriaCopy.selectOneOrMore;
  }

  if (isChoiceField(field)) {
    return usableOwnPlaceholder || RuleCriteriaCopy.selectAValue;
  }

  if (isNumberField(field)) {
    return RuleCriteriaCopy.enterANumber;
  }

  if (isRuleCriteriaPatternOperator(operator)) {
    return usableOwnPlaceholder || RuleCriteriaCopy.enterAPattern;
  }

  return RuleCriteriaCopy.enterText;
}

/*
 * The field "Add condition" starts a new condition on: the first one no
 * condition uses yet, so adding three conditions does not give three
 * "Monitors" rows to change one by one. Once every field is in use, the
 * first field again - two conditions on one field are allowed ("title
 * contains db" and "title does not contain staging").
 */
export function getNextRuleCriteriaField<TEntity>(
  fields: Array<Field<TEntity>>,
  filters: Array<RuleCriteriaFilter>,
): Field<TEntity> | undefined {
  const usedFieldNames: Set<string> = new Set<string>(
    filters.map((filter: RuleCriteriaFilter): string => {
      return filter.field;
    }),
  );

  return (
    fields.find((field: Field<TEntity>): boolean => {
      const fieldName: string | null = getRuleCriteriaFieldName(field);
      return Boolean(fieldName) && !usedFieldNames.has(fieldName!);
    }) || fields[0]
  );
}

export function createRuleCriteriaFilter<TEntity>(
  field: Field<TEntity>,
): RuleCriteriaFilter | null {
  const fieldName: string | null = getRuleCriteriaFieldName(field);

  if (!fieldName) {
    return null;
  }

  const operator: RuleCriteriaOperator = getDefaultRuleCriteriaOperator(field);

  return {
    field: fieldName,
    operator: operator,
    value: getEmptyRuleCriteriaValue(field, operator),
  };
}

/*
 * What kind of value a field holds, for deciding whether a value typed or
 * picked for one field still means something for another. Two relation fields
 * share a kind only when they pick from the same model: switching "Incident
 * Labels" to "Monitor Labels" keeps the labels picked, while switching
 * "Monitors" to "Monitor Labels" cannot keep monitor ids.
 */
function getValueKind<TEntity>(field: Field<TEntity>): unknown {
  if (field.dropdownModal) {
    return field.dropdownModal.type;
  }

  if (field.dropdownOptions) {
    return field.dropdownOptions;
  }

  if (isBooleanField(field)) {
    return "boolean";
  }

  if (isNumberField(field)) {
    return "number";
  }

  if (isRuleCriteriaAddressRangeField(field)) {
    return "address-range";
  }

  if (isTextField(field)) {
    return "text";
  }

  return field;
}

/*
 * A condition moved to another field. The operator stays when the new field
 * offers it, and so does the value when it means the same thing there
 * ("Incident Title contains db" -> "Incident Description contains db");
 * anything else starts over on the new field's defaults.
 */
export function changeRuleCriteriaFilterField<TEntity>(data: {
  filter: RuleCriteriaFilter;
  fromField: Field<TEntity> | undefined;
  toField: Field<TEntity>;
}): RuleCriteriaFilter {
  const fieldName: string = getRuleCriteriaFieldName(data.toField) || "";
  const keepsOperator: boolean = getRuleCriteriaOperatorsForField(
    data.toField,
  ).includes(data.filter.operator);
  const operator: RuleCriteriaOperator = keepsOperator
    ? data.filter.operator
    : getDefaultRuleCriteriaOperator(data.toField);
  const keepsValue: boolean =
    keepsOperator &&
    data.fromField !== undefined &&
    getValueKind(data.fromField) === getValueKind(data.toField);

  return {
    field: fieldName,
    operator: operator,
    value: keepsValue
      ? data.filter.value
      : getEmptyRuleCriteriaValue(data.toField, operator),
  };
}

/*
 * A condition given another operator. Text typed for "Contains" is still the
 * text for "Starts with", and labels picked for "Has any of" are still the
 * labels for "Has none of"; only a switch between one value and a list of
 * values starts the value over.
 */
export function changeRuleCriteriaFilterOperator<TEntity>(data: {
  filter: RuleCriteriaFilter;
  field: Field<TEntity>;
  operator: RuleCriteriaOperator;
}): RuleCriteriaFilter {
  const keepsValue: boolean =
    isRuleCriteriaArrayOperator(data.filter.operator) ===
    isRuleCriteriaArrayOperator(data.operator);

  return {
    field: data.filter.field,
    operator: data.operator,
    value: keepsValue
      ? data.filter.value
      : getEmptyRuleCriteriaValue(data.field, data.operator),
  };
}

/*
 * What is wrong with one condition, in words for the person filling in the
 * form, or null when nothing is. It covers what a person can get wrong in the
 * builder - a missing value, a pattern that compiles to nothing, a value too
 * long - and leaves the malformed payloads only an API caller can send to
 * getRuleCriteriaValidationError.
 */
export function getRuleCriteriaFilterProblem<TEntity>(
  filter: RuleCriteriaFilter,
  field: Field<TEntity> | undefined,
): RuleCriteriaMessage | null {
  if (!field) {
    return { text: RuleCriteriaCopy.fieldUnavailable };
  }

  const value: RuleCriteriaValue = filter.value;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { text: RuleCriteriaCopy.chooseAtLeastOneValueProblem };
    }

    if (value.length > RULE_CRITERIA_MAX_RELATION_VALUES) {
      return {
        text: RuleCriteriaCopy.tooManyValuesProblem,
        values: { max: RULE_CRITERIA_MAX_RELATION_VALUES },
      };
    }

    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? null
      : { text: RuleCriteriaCopy.enterANumberProblem };
  }

  if (typeof value !== "string") {
    return null;
  }

  if (value.trim().length === 0) {
    return {
      text: isChoiceField(field)
        ? RuleCriteriaCopy.chooseAValueProblem
        : RuleCriteriaCopy.enterAValueProblem,
    };
  }

  if (value.length > RULE_CRITERIA_MAX_STRING_LENGTH) {
    return {
      text: RuleCriteriaCopy.tooLongProblem,
      values: { max: RULE_CRITERIA_MAX_STRING_LENGTH },
    };
  }

  if (
    isRuleCriteriaPatternOperator(filter.operator) &&
    !RulePatternMatchUtil.isSupportedPattern(value)
  ) {
    return {
      text: isRuleCriteriaAddressRangeField(field)
        ? RuleCriteriaCopy.invalidAddressRangeProblem
        : RuleCriteriaCopy.invalidPatternProblem,
    };
  }

  return null;
}

/*
 * The one message a rule form shows for its conditions, or null when they
 * can be saved. People get the friendly version of every mistake the builder
 * lets them make; anything else - a payload no builder produces - falls
 * through to the API's own wording, so the form never sends what the API
 * would refuse.
 */
export function getRuleCriteriaFormProblem<TEntity>(data: {
  criteria: unknown;
  fields: Array<Field<TEntity>>;
  requiresCondition?: boolean | undefined;
}): RuleCriteriaMessage | null {
  const technicalError: string | null = getRuleCriteriaValidationError(
    data.criteria,
  );
  const filters: unknown =
    typeof data.criteria === "object" && data.criteria !== null
      ? (data.criteria as { filters?: unknown }).filters
      : undefined;

  if (!Array.isArray(filters)) {
    return technicalError ? { text: technicalError } : null;
  }

  if (data.requiresCondition && filters.length === 0) {
    return { text: RuleCriteriaCopy.addAtLeastOneConditionProblem };
  }

  if (filters.length > RULE_CRITERIA_MAX_FILTERS) {
    return {
      text: RuleCriteriaCopy.tooManyConditionsProblem,
      values: { max: RULE_CRITERIA_MAX_FILTERS },
    };
  }

  for (let index: number = 0; index < filters.length; index++) {
    const filter: unknown = filters[index];

    if (
      typeof filter !== "object" ||
      filter === null ||
      typeof (filter as RuleCriteriaFilter).field !== "string"
    ) {
      continue;
    }

    const problem: RuleCriteriaMessage | null = getRuleCriteriaFilterProblem(
      filter as RuleCriteriaFilter,
      findRuleCriteriaField(data.fields, (filter as RuleCriteriaFilter).field),
    );

    if (problem) {
      return {
        text: RuleCriteriaCopy.conditionProblem,
        values: { number: index + 1 },
        inner: problem,
      };
    }
  }

  return technicalError ? { text: technicalError } : null;
}
