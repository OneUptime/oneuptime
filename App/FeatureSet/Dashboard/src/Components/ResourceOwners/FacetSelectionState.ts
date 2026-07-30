import { FilterOperator } from "./FilterChipDropdownTypes";
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

export type NormalizeFacetValuesFunction = (
  values: Array<string> | null | undefined,
) => Array<string>;

/**
 * Clean a selection handed to the bar from outside it — a summary tile, a deep
 * link, a bulk "show me these" affordance.
 *
 * Duplicates are dropped because the selection is spread into an `Includes(...)`
 * verbatim, and blanks because an empty string is a value the option lists can
 * never produce but a hand-built caller easily can.
 */
export const normalizeFacetValues: NormalizeFacetValuesFunction = (
  values: Array<string> | null | undefined,
): Array<string> => {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const normalized: Array<string> = [];

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
};

export type ResolveFacetOperatorFunction = (
  operator: FilterOperator | null | undefined,
) => FilterOperator;

/**
 * The operator a facet should end up with. "is" is the default the whole bar
 * assumes when a facet has no entry, so an unrecognised value has to land there
 * rather than reach the query builder.
 */
export const resolveFacetOperator: ResolveFacetOperatorFunction = (
  operator: FilterOperator | null | undefined,
): FilterOperator => {
  return isFilterOperator(operator) ? operator : "is";
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

/**
 * The bits of a facet definition that constrain what a selection may hold.
 * `ResourceFacet` satisfies this structurally; kept minimal so this module stays
 * free of React.
 */
export interface FacetSelectionConstraint {
  key: string;
  isMultiSelect?: boolean | undefined;
  supportedOperators?: Array<FilterOperator> | undefined;
}

const DEFAULT_SUPPORTED_OPERATORS: Array<FilterOperator> = [
  "is",
  "is_not",
  "is_empty",
  "is_not_empty",
];

export type SanitizeFacetSelectionStateFunction = (
  state: FacetSelectionState,
  facets: Array<FacetSelectionConstraint>,
) => FacetSelectionState;

/**
 * Clamp a restored selection to what its chips can actually express.
 *
 * Selections come back from a URL param anyone can edit and from views saved by
 * older builds, so a facet can arrive holding an operator it never offered or more
 * values than it can display. Left alone, both produce a chip that claims a filter
 * the table is not applying — and a facet offering a single operator renders no
 * operator switcher, so the user cannot even see what to correct.
 *
 * Clamping here rather than at the query builder is what keeps the chip and the
 * request in agreement: everything downstream reads this one state.
 *
 * The user's *values* are kept wherever possible — an unsupported operator falls
 * back to the facet's first offered one rather than dropping the selection.
 */
export const sanitizeFacetSelectionState: SanitizeFacetSelectionStateFunction =
  (
    state: FacetSelectionState,
    facets: Array<FacetSelectionConstraint>,
  ): FacetSelectionState => {
    if (facets.length === 0) {
      return state;
    }

    const sanitized: FacetSelectionState = {
      ...state,
      facetSelections: { ...state.facetSelections },
      facetOperators: { ...state.facetOperators },
    };

    for (const facet of facets) {
      const operator: FilterOperator | undefined =
        sanitized.facetOperators[facet.key];
      const supported: Array<FilterOperator> =
        facet.supportedOperators && facet.supportedOperators.length > 0
          ? facet.supportedOperators
          : DEFAULT_SUPPORTED_OPERATORS;

      if (operator !== undefined && !supported.includes(operator)) {
        sanitized.facetOperators[facet.key] = supported[0]!;
      }

      const values: Array<string> | undefined =
        sanitized.facetSelections[facet.key];

      if (!facet.isMultiSelect && values && values.length > 1) {
        // The chip shows only the first value, so only the first may filter.
        sanitized.facetSelections[facet.key] = [values[0]!];
      }
    }

    return sanitized;
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
