/*
 * The comparisons an If / Else step offers, in the words its settings use.
 *
 * Most are one stored operator: "is equal to" is stored as "==". Two are
 * shortcuts for a condition the step could always express: "is true" is ==
 * with both values compared as true or false and Compare with set to true.
 * Storing them that way means the Jira templates' check of a script's
 * `proceed` flag - stored exactly so - reads "is true" without being changed.
 *
 * Shared by the settings (Workflow/Condition), the step's help and the
 * generic Operator dropdown, so they never disagree on a word.
 */

import { ConditionOperator, ConditionValueType } from "./Condition";
import {
  ConditionTypes,
  ResolvedConditionOperator,
  getEffectiveConditionTypes,
  LegacyConditionOperator,
  resolveConditionOperator,
} from "./ConditionEvaluation";

export enum ConditionComparisonId {
  EqualTo = "==",
  NotEqualTo = "!=",
  Contains = "contains",
  DoesNotContain = "does not contain",
  StartsWith = "starts with",
  EndsWith = "ends with",
  GreaterThan = ">",
  GreaterThanOrEqualTo = ">=",
  LessThan = "<",
  LessThanOrEqualTo = "<=",
  IsEmpty = "is empty",
  IsNotEmpty = "is not empty",
  IsTrue = "is true",
  IsFalse = "is false",
}

/*
 * What a comparison works on, which decides how the two values are compared
 * (see the "Compare as" rules in Workflow/Condition/ConditionModel).
 */
export enum ConditionComparisonKind {
  // is equal to, is not equal to: text unless Compare as says otherwise.
  Equality = "Equality",
  // contains and the like: always text.
  Text = "Text",
  // is greater than and the like: numbers unless Compare as says otherwise.
  Order = "Order",
  // is empty, is not empty: the value to check only.
  Presence = "Presence",
  // is true, is false.
  TrueOrFalse = "TrueOrFalse",
}

export interface ConditionComparison {
  id: ConditionComparisonId;
  // The words, as they read in "If <value> <label> <value>".
  label: string;
  // What is stored for it.
  operator: ConditionOperator;
  kind: ConditionComparisonKind;
  // Whether it is compared with a second value.
  usesCompareWith: boolean;
  // is true and is false: the value Compare with holds.
  fixedCompareWith?: "true" | "false" | undefined;
}

export const CONDITION_COMPARISONS: Array<ConditionComparison> = [
  {
    id: ConditionComparisonId.EqualTo,
    label: "is equal to",
    operator: ConditionOperator.EqualTo,
    kind: ConditionComparisonKind.Equality,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.NotEqualTo,
    label: "is not equal to",
    operator: ConditionOperator.NotEqualTo,
    kind: ConditionComparisonKind.Equality,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.Contains,
    label: "contains",
    operator: ConditionOperator.Contains,
    kind: ConditionComparisonKind.Text,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.DoesNotContain,
    label: "does not contain",
    operator: ConditionOperator.DoesNotContain,
    kind: ConditionComparisonKind.Text,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.StartsWith,
    label: "starts with",
    operator: ConditionOperator.StartsWith,
    kind: ConditionComparisonKind.Text,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.EndsWith,
    label: "ends with",
    operator: ConditionOperator.EndsWith,
    kind: ConditionComparisonKind.Text,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.GreaterThan,
    label: "is greater than",
    operator: ConditionOperator.GreaterThan,
    kind: ConditionComparisonKind.Order,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.GreaterThanOrEqualTo,
    label: "is greater than or equal to",
    operator: ConditionOperator.GreaterThanOrEqualTo,
    kind: ConditionComparisonKind.Order,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.LessThan,
    label: "is less than",
    operator: ConditionOperator.LessThan,
    kind: ConditionComparisonKind.Order,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.LessThanOrEqualTo,
    label: "is less than or equal to",
    operator: ConditionOperator.LessThanOrEqualTo,
    kind: ConditionComparisonKind.Order,
    usesCompareWith: true,
  },
  {
    id: ConditionComparisonId.IsEmpty,
    label: "is empty",
    operator: ConditionOperator.IsEmpty,
    kind: ConditionComparisonKind.Presence,
    usesCompareWith: false,
  },
  {
    id: ConditionComparisonId.IsNotEmpty,
    label: "is not empty",
    operator: ConditionOperator.IsNotEmpty,
    kind: ConditionComparisonKind.Presence,
    usesCompareWith: false,
  },
  {
    id: ConditionComparisonId.IsTrue,
    label: "is true",
    operator: ConditionOperator.EqualTo,
    kind: ConditionComparisonKind.TrueOrFalse,
    usesCompareWith: false,
    fixedCompareWith: "true",
  },
  {
    id: ConditionComparisonId.IsFalse,
    label: "is false",
    operator: ConditionOperator.EqualTo,
    kind: ConditionComparisonKind.TrueOrFalse,
    usesCompareWith: false,
    fixedCompareWith: "false",
  },
];

/*
 * How the list is laid out: the everyday two first, then one group per kind
 * of value, each named for what it compares.
 */
export interface ConditionComparisonGroup {
  // No title: listed above the groups.
  title?: string | undefined;
  ids: Array<ConditionComparisonId>;
}

export const CONDITION_COMPARISON_GROUPS: Array<ConditionComparisonGroup> = [
  {
    ids: [ConditionComparisonId.EqualTo, ConditionComparisonId.NotEqualTo],
  },
  {
    title: "Text",
    ids: [
      ConditionComparisonId.Contains,
      ConditionComparisonId.DoesNotContain,
      ConditionComparisonId.StartsWith,
      ConditionComparisonId.EndsWith,
    ],
  },
  {
    title: "Numbers",
    ids: [
      ConditionComparisonId.GreaterThan,
      ConditionComparisonId.GreaterThanOrEqualTo,
      ConditionComparisonId.LessThan,
      ConditionComparisonId.LessThanOrEqualTo,
    ],
  },
  {
    title: "Empty or not",
    ids: [ConditionComparisonId.IsEmpty, ConditionComparisonId.IsNotEmpty],
  },
  {
    title: "True or false",
    ids: [ConditionComparisonId.IsTrue, ConditionComparisonId.IsFalse],
  },
];

type GetConditionComparisonFunction = (
  id: ConditionComparisonId,
) => ConditionComparison;

export const getConditionComparison: GetConditionComparisonFunction = (
  id: ConditionComparisonId,
): ConditionComparison => {
  return CONDITION_COMPARISONS.find((comparison: ConditionComparison) => {
    return comparison.id === id;
  }) as ConditionComparison;
};

/*
 * The ways of comparing two values that the settings offer, under Compare as.
 * Null and Undefined are not among them (see ConditionValueType).
 */
export interface ConditionCompareAsOption {
  type: ConditionValueType;
  label: string;
  // The rule, in a sentence.
  description: string;
}

export const CONDITION_COMPARE_AS_OPTIONS: Array<ConditionCompareAsOption> = [
  {
    type: ConditionValueType.Text,
    label: "Text",
    description:
      'Letter by letter, and capital letters count: "Error" is not "error".',
  },
  {
    type: ConditionValueType.Number,
    label: "Number",
    description:
      "As numbers, so 10 is greater than 9. Text that is not a number counts as 0.",
  },
  {
    type: ConditionValueType.Boolean,
    label: "True / False",
    description: "Only true counts as true. Anything else is false.",
  },
];

/*
 * Each value type in words, for the generic Value Type dropdown and for a
 * workflow that still uses a type the settings no longer offer.
 */
export const CONDITION_VALUE_TYPE_LABELS: Record<ConditionValueType, string> = {
  [ConditionValueType.Text]: "Text",
  [ConditionValueType.Number]: "Number",
  [ConditionValueType.Boolean]: "True / False",
  [ConditionValueType.Null]: "Null",
  [ConditionValueType.Undefined]: "Undefined",
};

export interface StoredCondition {
  operator: unknown;
  compareWith: unknown;
  valueToCheckType: unknown;
  compareWithType: unknown;
}

type IsTrueFalseTextFunction = (value: unknown) => "true" | "false" | null;

// Compare with as is true / is false store it: true or false, as text or not.
const trueFalseText: IsTrueFalseTextFunction = (
  value: unknown,
): "true" | "false" | null => {
  if (value === true || value === "true") {
    return "true";
  }

  if (value === false || value === "false") {
    return "false";
  }

  return null;
};

type ComparisonForStoredConditionFunction = (
  stored: StoredCondition,
) => ConditionComparison | null;

/**
 * The comparison a stored condition reads as, or null when its operator is
 * not one the step knows. "===" and "!==", which the step still runs, read as
 * is equal to and is not equal to; they are only rewritten if changed.
 */
export const comparisonForStoredCondition: ComparisonForStoredConditionFunction =
  (stored: StoredCondition): ConditionComparison | null => {
    const operator: ResolvedConditionOperator | null = resolveConditionOperator(
      stored.operator,
    );

    if (!operator) {
      return null;
    }

    const base: ConditionOperator =
      operator === LegacyConditionOperator.StrictEqualTo
        ? ConditionOperator.EqualTo
        : operator === LegacyConditionOperator.StrictNotEqualTo
          ? ConditionOperator.NotEqualTo
          : operator;

    if (operator === ConditionOperator.EqualTo) {
      const types: ConditionTypes = getEffectiveConditionTypes(
        stored.valueToCheckType,
        stored.compareWithType,
      );
      const fixed: "true" | "false" | null = trueFalseText(stored.compareWith);

      if (
        fixed &&
        types.valueToCheck === ConditionValueType.Boolean &&
        types.compareWith === ConditionValueType.Boolean
      ) {
        return getConditionComparison(
          fixed === "true"
            ? ConditionComparisonId.IsTrue
            : ConditionComparisonId.IsFalse,
        );
      }
    }

    return (
      CONDITION_COMPARISONS.find((comparison: ConditionComparison) => {
        return (
          comparison.operator === base &&
          comparison.kind !== ConditionComparisonKind.TrueOrFalse
        );
      }) || null
    );
  };
