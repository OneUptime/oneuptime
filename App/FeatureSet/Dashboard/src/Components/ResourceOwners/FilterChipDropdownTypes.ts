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
