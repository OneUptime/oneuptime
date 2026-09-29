/**
 * Operators that a user can pick in the filter UI. Not every operator is
 * valid for every field type — use `getOperatorsForFieldType` to get the list
 * that applies to a given field.
 */
enum FilterOperator {
  // Text
  Contains = "contains",
  DoesNotContain = "does_not_contain",
  StartsWith = "starts_with",
  EndsWith = "ends_with",

  // Comparison (shared across text / number / date)
  EqualTo = "equal_to",
  NotEqualTo = "not_equal_to",
  GreaterThan = "greater_than",
  LessThan = "less_than",
  GreaterThanOrEqualTo = "greater_than_or_equal_to",
  LessThanOrEqualTo = "less_than_or_equal_to",
  Between = "between",

  // Date-specific aliases for comparison
  Before = "before",
  After = "after",

  // Entity / single-value selection
  Is = "is",
  IsNot = "is_not",

  // Entity array selection
  HasAnyOf = "has_any_of",
  HasAllOf = "has_all_of",
  HasNoneOf = "has_none_of",

  // Presence
  IsEmpty = "is_empty",
  IsNotEmpty = "is_not_empty",

  // Boolean
  IsTrue = "is_true",
  IsFalse = "is_false",
}

export default FilterOperator;

type FilterOperatorLabelMap = {
  [key in FilterOperator]: string;
};

export const FilterOperatorLabel: FilterOperatorLabelMap = {
  [FilterOperator.Contains]: "contains",
  [FilterOperator.DoesNotContain]: "does not contain",
  [FilterOperator.StartsWith]: "starts with",
  [FilterOperator.EndsWith]: "ends with",
  [FilterOperator.EqualTo]: "equals",
  [FilterOperator.NotEqualTo]: "does not equal",
  [FilterOperator.GreaterThan]: "is greater than",
  [FilterOperator.LessThan]: "is less than",
  [FilterOperator.GreaterThanOrEqualTo]: "is greater than or equal to",
  [FilterOperator.LessThanOrEqualTo]: "is less than or equal to",
  [FilterOperator.Between]: "is between",
  [FilterOperator.Before]: "is before",
  [FilterOperator.After]: "is after",
  [FilterOperator.Is]: "is",
  [FilterOperator.IsNot]: "is not",
  [FilterOperator.HasAnyOf]: "has any of",
  [FilterOperator.HasAllOf]: "has all of",
  [FilterOperator.HasNoneOf]: "has none of",
  [FilterOperator.IsEmpty]: "is empty",
  [FilterOperator.IsNotEmpty]: "is not empty",
  [FilterOperator.IsTrue]: "is true",
  [FilterOperator.IsFalse]: "is false",
};
