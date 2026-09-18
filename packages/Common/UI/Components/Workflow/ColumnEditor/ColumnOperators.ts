/*
 * Which comparisons a column can be filtered by, and what to call them.
 *
 * The old row editor offered all fourteen operators against every column, so a
 * Boolean column offered "starts with" and an ID column offered "greater than".
 * Both are accepted by the form and neither means anything - `uuid ILIKE '%x%'`
 * needs a cast Postgres will not do for you.
 *
 * Only the labels change here. The DictionaryFilterOperator members, and
 * therefore every byte that reaches the server, are exactly the ones the
 * Dictionary form already emitted.
 */

import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  getOperatorOption,
} from "../../Dictionary/DictionaryFilterOperator";
import { ModelColumnControl } from "./ColumnRow";

const TEXT_OPERATORS: Array<DictionaryFilterOperator> = [
  DictionaryFilterOperator.EqualTo,
  DictionaryFilterOperator.NotEqual,
  DictionaryFilterOperator.Contains,
  DictionaryFilterOperator.NotContains,
  DictionaryFilterOperator.StartsWith,
  DictionaryFilterOperator.EndsWith,
  DictionaryFilterOperator.IsAnyOf,
  DictionaryFilterOperator.IsNoneOf,
  DictionaryFilterOperator.IsEmpty,
  DictionaryFilterOperator.IsNotEmpty,
];

const NUMBER_OPERATORS: Array<DictionaryFilterOperator> = [
  DictionaryFilterOperator.EqualTo,
  DictionaryFilterOperator.NotEqual,
  DictionaryFilterOperator.GreaterThan,
  DictionaryFilterOperator.GreaterThanOrEqual,
  DictionaryFilterOperator.LessThan,
  DictionaryFilterOperator.LessThanOrEqual,
  DictionaryFilterOperator.IsAnyOf,
  DictionaryFilterOperator.IsNoneOf,
  DictionaryFilterOperator.IsEmpty,
  DictionaryFilterOperator.IsNotEmpty,
];

const DATE_OPERATORS: Array<DictionaryFilterOperator> = [
  DictionaryFilterOperator.EqualTo,
  DictionaryFilterOperator.NotEqual,
  DictionaryFilterOperator.GreaterThan,
  DictionaryFilterOperator.GreaterThanOrEqual,
  DictionaryFilterOperator.LessThan,
  DictionaryFilterOperator.LessThanOrEqual,
  DictionaryFilterOperator.IsEmpty,
  DictionaryFilterOperator.IsNotEmpty,
];

const IDENTIFIER_OPERATORS: Array<DictionaryFilterOperator> = [
  DictionaryFilterOperator.EqualTo,
  DictionaryFilterOperator.NotEqual,
  DictionaryFilterOperator.IsAnyOf,
  DictionaryFilterOperator.IsNoneOf,
  DictionaryFilterOperator.IsEmpty,
  DictionaryFilterOperator.IsNotEmpty,
];

const BOOLEAN_OPERATORS: Array<DictionaryFilterOperator> = [
  DictionaryFilterOperator.EqualTo,
  DictionaryFilterOperator.NotEqual,
  DictionaryFilterOperator.IsEmpty,
  DictionaryFilterOperator.IsNotEmpty,
];

/*
 * A date reads far better as "is after" than as ">", and the ordering
 * operators are the whole point of filtering on one. Anything not listed keeps
 * the shared label from DICTIONARY_FILTER_OPERATOR_OPTIONS.
 */
const DATE_OPERATOR_LABELS: Partial<Record<DictionaryFilterOperator, string>> =
  {
    [DictionaryFilterOperator.EqualTo]: "is",
    [DictionaryFilterOperator.NotEqual]: "is not",
    [DictionaryFilterOperator.GreaterThan]: "is after",
    [DictionaryFilterOperator.GreaterThanOrEqual]: "is on or after",
    [DictionaryFilterOperator.LessThan]: "is before",
    [DictionaryFilterOperator.LessThanOrEqual]: "is on or before",
    [DictionaryFilterOperator.IsEmpty]: "is not set",
    [DictionaryFilterOperator.IsNotEmpty]: "is set",
  };

const BOOLEAN_OPERATOR_LABELS: Partial<
  Record<DictionaryFilterOperator, string>
> = {
  [DictionaryFilterOperator.EqualTo]: "is",
  [DictionaryFilterOperator.NotEqual]: "is not",
  [DictionaryFilterOperator.IsEmpty]: "is not set",
  [DictionaryFilterOperator.IsNotEmpty]: "is set",
};

const DEFAULT_OPERATOR_LABELS: Partial<
  Record<DictionaryFilterOperator, string>
> = {
  [DictionaryFilterOperator.IsEmpty]: "is not set",
  [DictionaryFilterOperator.IsNotEmpty]: "is set",
};

export type OperatorsForControlFunction = (
  control: ModelColumnControl,
  currentOperator?: DictionaryFilterOperator | undefined,
) => Array<DictionaryFilterOperator>;

/**
 * The operators offered for a column, in the order they should be listed.
 *
 * `currentOperator` is always included even when the type filter would drop it.
 * A query saved before this filter existed can hold "contains" on an ID column;
 * leaving it out of the list would render a blank dropdown, and the next
 * unrelated edit to that row would silently rewrite the operator to equals.
 */
export const operatorsForControl: OperatorsForControlFunction = (
  control: ModelColumnControl,
  currentOperator?: DictionaryFilterOperator | undefined,
): Array<DictionaryFilterOperator> => {
  let operators: Array<DictionaryFilterOperator>;

  switch (control) {
    case ModelColumnControl.Number:
      operators = NUMBER_OPERATORS;
      break;
    case ModelColumnControl.Date:
      operators = DATE_OPERATORS;
      break;
    case ModelColumnControl.ObjectId:
    case ModelColumnControl.Color:
      operators = IDENTIFIER_OPERATORS;
      break;
    case ModelColumnControl.Boolean:
      operators = BOOLEAN_OPERATORS;
      break;
    default:
      /*
       * Unsupported lands here too. It is never offered in the picker, but a
       * stored condition on such a column still gets a row, and that row should
       * have the widest set rather than the narrowest.
       */
      operators = TEXT_OPERATORS;
      break;
  }

  if (currentOperator && !operators.includes(currentOperator)) {
    return [...operators, currentOperator];
  }

  return [...operators];
};

export type DefaultOperatorForControlFunction = (
  control: ModelColumnControl,
) => DictionaryFilterOperator;

export const defaultOperatorForControl: DefaultOperatorForControlFunction =
  (): DictionaryFilterOperator => {
    /*
     * Equals for every type. It is the only operator that is right more often
     * than not, and it is the one the value serializes without a wrapper.
     */
    return DictionaryFilterOperator.EqualTo;
  };

export type OperatorLabelForFunction = (
  operator: DictionaryFilterOperator,
  control: ModelColumnControl,
) => string;

export const operatorLabelFor: OperatorLabelForFunction = (
  operator: DictionaryFilterOperator,
  control: ModelColumnControl,
): string => {
  const overrides: Partial<Record<DictionaryFilterOperator, string>> =
    control === ModelColumnControl.Date
      ? DATE_OPERATOR_LABELS
      : control === ModelColumnControl.Boolean
        ? BOOLEAN_OPERATOR_LABELS
        : DEFAULT_OPERATOR_LABELS;

  const override: string | undefined = overrides[operator];

  if (override) {
    return override;
  }

  return getOperatorOption(operator).label;
};

export type IsKnownOperatorFunction = (value: string) => boolean;

export const isKnownOperator: IsKnownOperatorFunction = (
  value: string,
): boolean => {
  return DICTIONARY_FILTER_OPERATOR_OPTIONS.some(
    (option: DictionaryFilterOperatorOption) => {
      return option.operator === value;
    },
  );
};
