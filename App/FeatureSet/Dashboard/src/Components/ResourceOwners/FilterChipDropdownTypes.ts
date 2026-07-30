import IconProp from "Common/Types/Icon/IconProp";

/*
 * The React-free half of FilterChipDropdown.
 *
 * These types are shared with plain-TypeScript modules such as
 * FacetSelectionState, which is imported by jest tests under App/Tests. App's
 * own `tsc` run excludes FeatureSet/Dashboard, but an excluded file still gets
 * type-checked when something inside the program imports it — so importing
 * these from the .tsx component pulled React into App's compile, where React is
 * not a dependency ("Cannot find module 'react'"). Keeping them here keeps that
 * import chain free of anything that needs React.
 *
 * FilterChipDropdown.tsx re-exports everything below, so existing imports of
 * these names from "./FilterChipDropdown" keep working.
 */

/**
 * What kind of control a chip puts in its popover.
 *
 * - "options" — the option list every chip started as: search, pick, done.
 * - "dateRange" — an operator plus one or two date inputs. A date column has no
 *   option list to offer (every instant is a distinct value), so the question a
 *   user actually has of one — "not polled since last Tuesday" — is only
 *   expressible by typing a date.
 */
export type FacetKind = "options" | "dateRange";

export interface FilterChipDropdownOption {
  value: string;
  label: string;
  /** Optional sub-label shown smaller below the main label. */
  sublabel?: string | undefined;
  /** Optional icon shown as a fallback to the left of the label. */
  icon?: IconProp | undefined;
  /**
   * Initials shown in a colored circle as the option avatar. Takes precedence
   * over `icon`. The background color is hashed from `value` unless `color`
   * is also provided.
   */
  initials?: string | undefined;
  /**
   * Explicit color for the avatar dot (CSS color string — hex, rgb, named).
   * When provided without `initials`, renders as a small solid circle
   * (the right call for labels / status colors). With `initials`, the dot
   * gets the color as its background.
   */
  color?: string | undefined;
  /** Optional group key for sectioning options under a heading. */
  group?: string | undefined;
}

/**
 * Filter operator that the chip surfaces to the user.
 * - "is" / "is_not" — match against the selected options
 * - "is_empty" / "is_not_empty" — match rows with no value / any value
 *   (no option selection required)
 * - "before" / "after" / "between" — date-range chips only, and never offered
 *   by an option-list chip: they compare against a date the user typed rather
 *   than against anything in an option list.
 */
export type FilterOperator =
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "before"
  | "after"
  | "between";

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  before: "is before",
  after: "is after",
  between: "is between",
};

/**
 * The operators a date-range chip offers, in the order the popover lists them.
 *
 * Deliberately the same vocabulary the column-filter popup's date entry has
 * always used (Common/UI/Components/Filters/DateFilter.tsx) — a user who has
 * filtered a date column anywhere else in the product already knows what these
 * four mean, and "is" meaning "on that day" rather than "at that instant" is
 * part of what they know.
 */
export const DATE_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "before",
  "after",
  "between",
  "is_empty",
  "is_not_empty",
];

/**
 * Operators an *option-list* chip may offer. A date operator reaching one of
 * those chips has no date to compare against, so it can only produce a filter
 * the chip cannot describe — see sanitizeFacetSelectionState, which clamps it
 * back rather than letting it through.
 */
export const OPTION_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "is_not",
  "is_empty",
  "is_not_empty",
];

export const isValueOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return op === "is" || op === "is_not";
};

/**
 * Does this operator carry no value at all? Both chip kinds hide their value
 * input on these, and both write IsNull / NotNull for them.
 */
export const isValuelessOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return op === "is_empty" || op === "is_not_empty";
};

/** Does this operator need two dates rather than one? */
export const isRangeOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return op === "between";
};
