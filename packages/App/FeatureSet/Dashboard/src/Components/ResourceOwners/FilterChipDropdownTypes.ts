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
 * - "text" / "number" — an operator plus one typed value. Same reason as dates:
 *   a free-text custom field's values are whatever anyone has ever entered, so
 *   there is no list to offer, and the question a user has of one ("Ticket
 *   contains JIRA-", "Impacted Users is over 500") is only expressible by
 *   typing.
 */
export type FacetKind = "options" | "dateRange" | "text" | "number";

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
 * - "contains" / "not_contains" / "starts_with" / "ends_with" — text chips.
 * - "greater_than" / "greater_than_or_equal" / "less_than" /
 *   "less_than_or_equal" — number chips.
 */
export type FilterOperator =
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "before"
  | "after"
  | "between"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal";

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  before: "is before",
  after: "is after",
  between: "is between",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  greater_than: "is greater than",
  greater_than_or_equal: "is greater than or equal to",
  less_than: "is less than",
  less_than_or_equal: "is less than or equal to",
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

/**
 * The operators a free-text chip offers.
 *
 * "is" leads rather than "contains" because an exact match is what a user
 * picking a value out of a column they can see is usually after; "contains" is
 * one click away and is what makes the chip a *search* rather than a filter.
 */
export const TEXT_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
];

/** The operators a numeric chip offers. */
export const NUMBER_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "is_not",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_empty",
  "is_not_empty",
];

/**
 * Does this chip hold one value the user typed, rather than a selection from a
 * list? Both kinds render the same control and store their value the same way
 * (a single-element array), so most call sites want to ask this rather than
 * compare against each kind.
 */
export const isTypedValueFacetKind: (kind: FacetKind | undefined) => boolean = (
  kind: FacetKind | undefined,
): boolean => {
  return kind === "text" || kind === "number";
};

/**
 * Is this operator one only a numeric chip can answer? Kept next to the
 * operator list it comes from so a new comparison cannot be added to one
 * without the other noticing.
 */
export const isNumericComparisonOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return (
    op === "greater_than" ||
    op === "greater_than_or_equal" ||
    op === "less_than" ||
    op === "less_than_or_equal"
  );
};

/**
 * Is this operator one of the substring comparisons a text chip offers?
 */
export const isTextMatchOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return (
    op === "contains" ||
    op === "not_contains" ||
    op === "starts_with" ||
    op === "ends_with"
  );
};

export const isValueOperator: (op: FilterOperator) => boolean = (
  op: FilterOperator,
): boolean => {
  return op === "is" || op === "is_not";
};

/**
 * Does this operator carry no value at all? Every chip kind hides its value
 * input on these, and they all write IsNull / NotNull for them — except a chip
 * over one key inside a JSON column, which writes the same pair *inside* that
 * column (see ResourceFacet.handlesValuelessOperators).
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
