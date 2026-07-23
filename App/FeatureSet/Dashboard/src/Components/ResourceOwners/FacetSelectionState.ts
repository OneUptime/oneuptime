import { FilterOperator } from "./FilterChipDropdown";
import { JSONObject } from "Common/Types/JSON";

/**
 * Everything the facet bar lets a user pick, in a form that survives a round
 * trip through a URL query param or a saved `TableView`.
 *
 * Only IDs and operators are stored — never the display labels — so a restored
 * selection produces the correct query immediately, before the (async) option
 * lists have loaded and can supply names.
 */
export interface FacetSelectionState {
  selectedOwnerKeys: Array<string>;
  selectedLabelIds: Array<string>;
  facetSelections: { [facetKey: string]: Array<string> };
  ownerOperator: FilterOperator;
  labelOperator: FilterOperator;
  facetOperators: { [facetKey: string]: FilterOperator };
}

export type IsFilterOperatorFunction = (
  value: unknown,
) => value is FilterOperator;

export const isFilterOperator: IsFilterOperatorFunction = (
  value: unknown,
): value is FilterOperator => {
  return (
    value === "is" ||
    value === "is_not" ||
    value === "is_empty" ||
    value === "is_not_empty"
  );
};

export type GetEmptyFacetSelectionStateFunction = () => FacetSelectionState;

/**
 * A fresh "nothing selected" state. Returned as a new object each call so
 * callers can hand it straight to `useState` without sharing mutable arrays.
 */
export const getEmptyFacetSelectionState: GetEmptyFacetSelectionStateFunction =
  (): FacetSelectionState => {
    return {
      selectedOwnerKeys: [],
      selectedLabelIds: [],
      facetSelections: {},
      ownerOperator: "is",
      labelOperator: "is",
      facetOperators: {},
    };
  };

type ToStringArrayFunction = (value: unknown) => Array<string>;

const toStringArray: ToStringArrayFunction = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry: unknown): entry is string => {
    return typeof entry === "string" && entry.length > 0;
  });
};

export type ParseFacetSelectionStateFunction = (
  state: JSONObject | null | undefined,
) => FacetSelectionState;

/**
 * Rebuild facet selections from an untrusted snapshot (a URL param a teammate
 * pasted, or a saved view written by an older build).
 *
 * Every field is validated on its own and falls back to its default, so one
 * malformed entry can never take the whole filter bar down — the worst case is
 * that a single chip comes back empty.
 */
export const parseFacetSelectionState: ParseFacetSelectionStateFunction = (
  state: JSONObject | null | undefined,
): FacetSelectionState => {
  const parsed: FacetSelectionState = getEmptyFacetSelectionState();

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return parsed;
  }

  parsed.selectedOwnerKeys = toStringArray(state["selectedOwnerKeys"]);
  parsed.selectedLabelIds = toStringArray(state["selectedLabelIds"]);

  const rawSelections: unknown = state["facetSelections"];
  if (
    rawSelections &&
    typeof rawSelections === "object" &&
    !Array.isArray(rawSelections)
  ) {
    for (const [key, value] of Object.entries(
      rawSelections as Record<string, unknown>,
    )) {
      if (Array.isArray(value)) {
        parsed.facetSelections[key] = toStringArray(value);
      }
    }
  }

  if (isFilterOperator(state["ownerOperator"])) {
    parsed.ownerOperator = state["ownerOperator"];
  }

  if (isFilterOperator(state["labelOperator"])) {
    parsed.labelOperator = state["labelOperator"];
  }

  const rawFacetOperators: unknown = state["facetOperators"];
  if (
    rawFacetOperators &&
    typeof rawFacetOperators === "object" &&
    !Array.isArray(rawFacetOperators)
  ) {
    for (const [key, value] of Object.entries(
      rawFacetOperators as Record<string, unknown>,
    )) {
      if (isFilterOperator(value)) {
        parsed.facetOperators[key] = value;
      }
    }
  }

  return parsed;
};

export type IsFacetSelectionActiveFunction = (
  state: FacetSelectionState,
) => boolean;

/**
 * Does this state constrain anything? Used to decide whether the snapshot is
 * worth putting on the URL at all.
 */
export const isFacetSelectionActive: IsFacetSelectionActiveFunction = (
  state: FacetSelectionState,
): boolean => {
  const operatorIsActive: (operator: FilterOperator) => boolean = (
    operator: FilterOperator,
  ): boolean => {
    return operator === "is_empty" || operator === "is_not_empty";
  };

  if (
    state.selectedOwnerKeys.length > 0 ||
    state.selectedLabelIds.length > 0 ||
    operatorIsActive(state.ownerOperator) ||
    operatorIsActive(state.labelOperator)
  ) {
    return true;
  }

  for (const key of Object.keys(state.facetSelections)) {
    if ((state.facetSelections[key] || []).length > 0) {
      return true;
    }
  }

  for (const key of Object.keys(state.facetOperators)) {
    if (operatorIsActive(state.facetOperators[key] as FilterOperator)) {
      return true;
    }
  }

  return false;
};
