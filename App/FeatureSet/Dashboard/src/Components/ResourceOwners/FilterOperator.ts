/**
 * Filter operator that the chip surfaces to the user.
 * - "is" / "is_not" — match against the selected options
 * - "is_empty" / "is_not_empty" — match rows with no value / any value
 *   (no option selection required)
 *
 * Deliberately kept in its own react-free module. FacetSelectionState is pure
 * serialization logic and is pulled into App's tsconfig through App/Tests, which
 * compiles without React installed — importing this type straight from
 * FilterChipDropdown.tsx dragged `react` into that graph and broke the Compile
 * job with TS2307. FilterChipDropdown re-exports all three names, so existing
 * importers are unaffected.
 */
export type FilterOperator = "is" | "is_not" | "is_empty" | "is_not_empty";

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export const isValueOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return op === "is" || op === "is_not";
};
