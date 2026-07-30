import {
  DATE_FACET_OPERATORS,
  FILTER_OPERATOR_LABELS,
  FacetKind,
  FilterOperator,
  OPTION_FACET_OPERATORS,
} from "./FilterChipDropdownTypes";
import { isFacetDateRangeActive } from "./FacetDateRange";
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

/**
 * Derived from FILTER_OPERATOR_LABELS rather than restated, because this is the
 * gate every operator arriving from a URL or a saved view passes through.
 *
 * Spelled out by hand, it silently fell behind the type when the date operators
 * were added: TypeScript was happy, and a "between" in a shared link was thrown
 * away and replaced with "is" — the same chip, a different filter, no error
 * anywhere. Tying it to the label map means an operator the chip can print is
 * an operator this accepts, by construction.
 */
export const isFilterOperator: IsFilterOperatorFunction = (
  value: unknown,
): value is FilterOperator => {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(FILTER_OPERATOR_LABELS, value)
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
  /** Defaults to "options" — the chip kind every facet was before dates. */
  type?: FacetKind | undefined;
  /** Facet keys this one cannot be active alongside. See buildFacetConflictMap. */
  exclusiveWith?: Array<string> | undefined;
}

export type FacetConflictMap = { [facetKey: string]: Array<string> };

export type BuildFacetConflictMapFunction = (
  facets: Array<FacetSelectionConstraint>,
) => FacetConflictMap;

/**
 * Which chips cannot be active at the same time, read from every facet's
 * `exclusiveWith`.
 *
 * Two chips over the same column do not AND — the merged query is one object,
 * so the later one overwrites the earlier, silently, while both stay lit and
 * claim to apply. Naming the conflict makes an activating chip clear the other.
 *
 * Built symmetrically, so declaring it on one side is enough AND declaring it
 * on one side only cannot half-work: a one-way map would clear the second chip
 * when the first moved but not the reverse, leaving whichever the user reached
 * for second to be the one silently overwritten — the exact bug the declaration
 * exists to prevent.
 */
export const buildFacetConflictMap: BuildFacetConflictMapFunction = (
  facets: Array<FacetSelectionConstraint>,
): FacetConflictMap => {
  const conflicts: { [facetKey: string]: Set<string> } = {};

  const link: (from: string, to: string) => void = (
    from: string,
    to: string,
  ): void => {
    /*
     * A facet excluded with itself would clear its own selection the instant it
     * was made, and a blank key is something only a hand-written facet list
     * produces — neither is a conflict anything can act on.
     */
    if (!from || !to || from === to) {
      return;
    }

    if (!conflicts[from]) {
      conflicts[from] = new Set<string>();
    }

    conflicts[from]!.add(to);
  };

  for (const facet of facets) {
    for (const other of facet.exclusiveWith || []) {
      link(facet.key, other);
      link(other, facet.key);
    }
  }

  const map: FacetConflictMap = {};

  for (const key of Object.keys(conflicts)) {
    map[key] = Array.from(conflicts[key]!);
  }

  return map;
};

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
      const isDateRange: boolean = facet.type === "dateRange";
      const operator: FilterOperator | undefined =
        sanitized.facetOperators[facet.key];
      const supported: Array<FilterOperator> =
        facet.supportedOperators && facet.supportedOperators.length > 0
          ? facet.supportedOperators
          : isDateRange
            ? DATE_FACET_OPERATORS
            : OPTION_FACET_OPERATORS;

      const resolvedOperator: FilterOperator =
        operator !== undefined && !supported.includes(operator)
          ? supported[0]!
          : operator || "is";

      if (operator !== undefined && !supported.includes(operator)) {
        sanitized.facetOperators[facet.key] = supported[0]!;
      }

      const values: Array<string> | undefined =
        sanitized.facetSelections[facet.key];

      if (!facet.isMultiSelect && values && values.length > 1) {
        // The chip shows only the first value, so only the first may filter.
        sanitized.facetSelections[facet.key] = [values[0]!];
      }

      /*
       * A date chip's value is dates, and its inputs can only show dates. A
       * restored selection holding anything else — a hand-edited URL, a value
       * a since-renamed build wrote — would leave the chip lit and its inputs
       * blank, describing a filter the user cannot see or correct.
       *
       * Dropping it is what keeps those two in agreement: an unreadable range
       * comes back as an empty chip over the full list, which is at least a
       * state the bar can express.
       */
      if (isDateRange) {
        const dateValues: Array<string> | undefined =
          sanitized.facetSelections[facet.key];

        if (
          dateValues &&
          dateValues.length > 0 &&
          !isFacetDateRangeActive(dateValues, resolvedOperator)
        ) {
          sanitized.facetSelections[facet.key] = [];
        }
      }
    }

    return sanitized;
  };

export type IsFacetActiveFunction = (
  facet: FacetSelectionConstraint,
  values: Array<string> | undefined,
  operator: FilterOperator | undefined,
) => boolean;

/**
 * Is this one chip narrowing the list?
 *
 * "Has a value" stopped being the whole answer once dates arrived: a date chip
 * holds the half-filled range the user is still typing, which is a value but
 * not yet a filter. Everything that counts active chips — the bar's badge, the
 * table's "nothing matches the filters" copy, whether the selection is worth
 * putting on the URL — has to agree with the query builder about which of those
 * two a chip currently is, or the page claims a filter it is not applying.
 */
export const isFacetActive: IsFacetActiveFunction = (
  facet: FacetSelectionConstraint,
  values: Array<string> | undefined,
  operator: FilterOperator | undefined,
): boolean => {
  const resolved: FilterOperator = resolveFacetOperator(operator);

  if (facet.type === "dateRange") {
    return isFacetDateRangeActive(values, resolved);
  }

  if (resolved === "is_empty" || resolved === "is_not_empty") {
    return true;
  }

  return (values || []).length > 0;
};

export type IsFacetSelectionActiveFunction = (
  state: FacetSelectionState,
  facets?: Array<FacetSelectionConstraint> | undefined,
) => boolean;

/**
 * Does this state constrain anything? Used to decide whether the snapshot is
 * worth putting on the URL at all.
 *
 * `facets` is optional and only changes the answer for date chips, whose stored
 * value can be a range the user has not finished entering. Without it, every
 * facet is read the way option chips have always been read — which is what
 * callers that predate date facets already expect.
 */
export const isFacetSelectionActive: IsFacetSelectionActiveFunction = (
  state: FacetSelectionState,
  facets?: Array<FacetSelectionConstraint> | undefined,
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

  const constraintFor: (key: string) => FacetSelectionConstraint = (
    key: string,
  ): FacetSelectionConstraint => {
    return (
      (facets || []).find((facet: FacetSelectionConstraint) => {
        return facet.key === key;
      }) || { key: key }
    );
  };

  const keys: Set<string> = new Set<string>([
    ...Object.keys(state.facetSelections),
    ...Object.keys(state.facetOperators),
  ]);

  for (const key of keys) {
    if (
      isFacetActive(
        constraintFor(key),
        state.facetSelections[key],
        state.facetOperators[key],
      )
    ) {
      return true;
    }
  }

  return false;
};
