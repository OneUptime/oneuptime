import { ActiveFilter, FacetValue } from "./types";
import {
  parseSearchValue,
  SearchValueOperator,
  SearchValuePredicate,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import { isServiceFacetKey } from "../../../Types/Telemetry/ResourceEntityFacet";

/*
 * What a value in a telemetry facet sidebar is doing to the list, and which
 * filters a click on it has to take off. One reading for every explorer -
 * Logs, Traces, Metrics, Exceptions and Security Events.
 *
 * Every explorer keeps its filters as chips, `{ facetKey, value }` pairs, and
 * the sidebar lights a row from them. A click on a lit row takes off the very
 * chips that lit it, through the explorer's own chip removal (the path the
 * chip's x already takes), so a row that looks checked is always one that a
 * click unchecks, whatever an explorer stores and however it spells it.
 * Explorers used to decide that themselves, and three of them only ever
 * added: clicking a checked Service, Status or Span Type did nothing.
 *
 * What a chip lights:
 *
 *   severityText: error              the Severity row "error", included
 *   !severityName: Low               the Severity row "Low", excluded (the
 *                                    exclusion is marked on the key, as
 *                                    Security Events writes it)
 *   attributes.host.name: "web 01"   the Host Name row "web 01": attribute
 *                                    chips hold search-grammar tokens, so
 *                                    `/api/\*`, `a\?b` and `"web 01"` light
 *                                    `/api/*`, `a?b` and `web 01`
 *   attributes.host.name: !web-01    the Host Name row "web-01", excluded
 *   serviceId: <id>                  the Service row (`serviceId` is the
 *                                    pre-rename alias of primaryEntityId)
 *
 * A chip whose value stands for more than one value - a glob, a list, a
 * comparison, a contains - lights no row: no single row is what it filters.
 *
 * A row lit only by the page's own read-only chips (a service page's scope)
 * is locked: it shows, but nothing here can take it off.
 *
 * Kept free of React so the rules are unit-testable on their own.
 */

// A chip that leaves its value out says so on its key: `!severityName`.
export const FACET_EXCLUDE_KEY_PREFIX: string = "!";

// Attribute chips: `attributes.<key>`, their values written in the search grammar.
export const ATTRIBUTE_FACET_KEY_PREFIX: string = "attributes.";

// The Service facet; `serviceId` is the same facet under its old name.
export const SERVICE_FACET_KEY: string = "primaryEntityId";

export const isExcludeFacetKey: (facetKey: string) => boolean = (
  facetKey: string,
): boolean => {
  return facetKey.startsWith(FACET_EXCLUDE_KEY_PREFIX);
};

// The key of the chip that excludes a value of this facet.
export const toExcludeFacetKey: (facetKey: string) => string = (
  facetKey: string,
): string => {
  return isExcludeFacetKey(facetKey)
    ? facetKey
    : `${FACET_EXCLUDE_KEY_PREFIX}${facetKey}`;
};

// The facet an include-or-exclude key stands for.
export const getBaseFacetKey: (facetKey: string) => string = (
  facetKey: string,
): string => {
  return isExcludeFacetKey(facetKey)
    ? facetKey.substring(FACET_EXCLUDE_KEY_PREFIX.length)
    : facetKey;
};

export enum FacetValueState {
  // The value is not part of the filter.
  None = "none",
  // Only rows with this value are listed.
  Included = "included",
  // Rows with this value are left out.
  Excluded = "excluded",
}

// One chip, as the explorer's chip removal names it.
export interface FacetChipRef {
  facetKey: string;
  value: string;
}

export interface FacetChipReading {
  // The sidebar facet keys whose row for `value` the chip lights.
  facetKeys: Array<string>;
  // The facet value it stands for, escapes resolved.
  value: string;
  state: FacetValueState.Included | FacetValueState.Excluded;
}

type ReadAttributeValueFunction = (token: string) => {
  value: string;
  isNegated: boolean;
} | null;

/*
 * The one value an attribute chip's token stands for, or null when it stands
 * for a pattern, a list or a comparison. `!x` is not-equal: the chip leaves
 * `x` out.
 */
const readAttributeValue: ReadAttributeValueFunction = (
  token: string,
): {
  value: string;
  isNegated: boolean;
} | null => {
  const predicate: SearchValuePredicate = parseSearchValue(token);

  if (predicate.operator === SearchValueOperator.Equals) {
    return { value: predicate.value, isNegated: false };
  }

  if (predicate.operator === SearchValueOperator.NotEquals) {
    return { value: predicate.value, isNegated: true };
  }

  return null;
};

// What one chip lights in a facet sidebar, or null when it lights nothing.
export const readFacetChip: (
  chip: Pick<ActiveFilter, "facetKey" | "value">,
) => FacetChipReading | null = (
  chip: Pick<ActiveFilter, "facetKey" | "value">,
): FacetChipReading | null => {
  if (!chip || typeof chip.facetKey !== "string") {
    return null;
  }

  const isExcludeKey: boolean = isExcludeFacetKey(chip.facetKey);
  const baseKey: string = getBaseFacetKey(chip.facetKey);
  const rawValue: string = String(chip.value ?? "");

  if (!baseKey) {
    return null;
  }

  if (baseKey.startsWith(ATTRIBUTE_FACET_KEY_PREFIX)) {
    const attributeKey: string = baseKey.substring(
      ATTRIBUTE_FACET_KEY_PREFIX.length,
    );

    if (!attributeKey) {
      return null;
    }

    const read: { value: string; isNegated: boolean } | null =
      readAttributeValue(rawValue);

    if (!read) {
      return null;
    }

    // `!attributes.k: !v` leaves out what leaves out v: it keeps v.
    const isExcluded: boolean = isExcludeKey !== read.isNegated;

    return {
      // A sidebar may key the facet either way; Traces keys it bare.
      facetKeys: [attributeKey, baseKey],
      value: read.value,
      state: isExcluded ? FacetValueState.Excluded : FacetValueState.Included,
    };
  }

  return {
    facetKeys: isServiceFacetKey(baseKey)
      ? Array.from(new Set<string>([SERVICE_FACET_KEY, baseKey]))
      : [baseKey],
    value: rawValue,
    state: isExcludeKey ? FacetValueState.Excluded : FacetValueState.Included,
  };
};

export interface FacetValueSelection {
  state: FacetValueState.Included | FacetValueState.Excluded;
  /*
   * The user's chips that put the value in this state: what a click on the
   * row takes off. Empty when only the page's read-only chips do.
   */
  chips: Array<FacetChipRef>;
  // Lit only by the page's own (read-only) chips: shown, not changeable here.
  isLocked: boolean;
  /*
   * What the chip calls the value, when that is more than the raw value (a
   * service's name for its id): the row's label when the facet's values do
   * not include it.
   */
  displayValue?: string | undefined;
}

// facet key -> facet value -> what that value is doing.
export type FacetSelections = Map<string, Map<string, FacetValueSelection>>;

interface SelectionTally {
  includedChips: Array<FacetChipRef>;
  includedLocked: boolean;
  excludedChips: Array<FacetChipRef>;
  excludedLocked: boolean;
  displayValue?: string | undefined;
}

/*
 * Read every chip into what each facet row shows. When chips disagree about
 * one value - included and excluded at once, which only a hand-edited link
 * can produce - the include wins, as the explorers compile it.
 */
export const buildFacetSelections: (
  filters: ReadonlyArray<ActiveFilter> | null | undefined,
) => FacetSelections = (
  filters: ReadonlyArray<ActiveFilter> | null | undefined,
): FacetSelections => {
  const tallies: Map<string, Map<string, SelectionTally>> = new Map<
    string,
    Map<string, SelectionTally>
  >();

  for (const filter of filters || []) {
    const reading: FacetChipReading | null = readFacetChip(filter);

    if (!reading) {
      continue;
    }

    for (const facetKey of reading.facetKeys) {
      if (!tallies.has(facetKey)) {
        tallies.set(facetKey, new Map<string, SelectionTally>());
      }

      const byValue: Map<string, SelectionTally> = tallies.get(facetKey)!;

      if (!byValue.has(reading.value)) {
        byValue.set(reading.value, {
          includedChips: [],
          includedLocked: false,
          excludedChips: [],
          excludedLocked: false,
        });
      }

      const tally: SelectionTally = byValue.get(reading.value)!;
      const isIncluded: boolean = reading.state === FacetValueState.Included;

      if (filter.readOnly) {
        if (isIncluded) {
          tally.includedLocked = true;
        } else {
          tally.excludedLocked = true;
        }
      } else {
        const chip: FacetChipRef = {
          facetKey: filter.facetKey,
          value: filter.value,
        };
        const chips: Array<FacetChipRef> = isIncluded
          ? tally.includedChips
          : tally.excludedChips;

        if (
          !chips.some((existing: FacetChipRef): boolean => {
            return (
              existing.facetKey === chip.facetKey &&
              existing.value === chip.value
            );
          })
        ) {
          chips.push(chip);
        }
      }

      const displayValue: string = String(filter.displayValue ?? "").trim();

      if (
        tally.displayValue === undefined &&
        displayValue &&
        displayValue !== reading.value
      ) {
        tally.displayValue = displayValue;
      }
    }
  }

  const selections: FacetSelections = new Map<
    string,
    Map<string, FacetValueSelection>
  >();

  for (const [facetKey, byValue] of tallies.entries()) {
    const values: Map<string, FacetValueSelection> = new Map<
      string,
      FacetValueSelection
    >();

    for (const [value, tally] of byValue.entries()) {
      const isIncluded: boolean =
        tally.includedChips.length > 0 || tally.includedLocked;
      const chips: Array<FacetChipRef> = isIncluded
        ? tally.includedChips
        : tally.excludedChips;
      const isLocked: boolean = isIncluded
        ? tally.includedLocked && tally.includedChips.length === 0
        : tally.excludedLocked && tally.excludedChips.length === 0;

      values.set(value, {
        state: isIncluded ? FacetValueState.Included : FacetValueState.Excluded,
        chips: chips,
        isLocked: isLocked,
        displayValue: tally.displayValue,
      });
    }

    selections.set(facetKey, values);
  }

  return selections;
};

// What one facet's value is doing, or undefined when it is not filtering.
export const getFacetValueSelection: (
  selections: FacetSelections,
  facetKey: string,
  value: string,
) => FacetValueSelection | undefined = (
  selections: FacetSelections,
  facetKey: string,
  value: string,
): FacetValueSelection | undefined => {
  return selections.get(facetKey)?.get(value);
};

export interface FacetSectionSelection {
  // Values that keep only their rows.
  includedValues: Set<string>;
  // Values whose rows are left out.
  excludedValues: Set<string>;
  // Values set by the page itself: shown, not changeable here.
  lockedValues: Set<string>;
}

// The three sets one facet section draws its rows from.
export const getFacetSectionSelection: (
  selections: FacetSelections,
  facetKey: string,
) => FacetSectionSelection = (
  selections: FacetSelections,
  facetKey: string,
): FacetSectionSelection => {
  const result: FacetSectionSelection = {
    includedValues: new Set<string>(),
    excludedValues: new Set<string>(),
    lockedValues: new Set<string>(),
  };

  for (const [value, selection] of selections.get(facetKey)?.entries() || []) {
    if (selection.state === FacetValueState.Included) {
      result.includedValues.add(value);
    } else {
      result.excludedValues.add(value);
    }

    if (selection.isLocked) {
      result.lockedValues.add(value);
    }
  }

  return result;
};

/*
 * Every value that is filtering, per facet - included or excluded. What the
 * visibility rules read as "this facet is in use": such a facet never folds
 * away, and its values stay listed under a locked scope.
 */
export const getSelectedValuesByKey: (
  selections: FacetSelections,
) => Record<string, Set<string>> = (
  selections: FacetSelections,
): Record<string, Set<string>> => {
  const result: Record<string, Set<string>> = {};

  for (const [facetKey, byValue] of selections.entries()) {
    result[facetKey] = new Set<string>(byValue.keys());
  }

  return result;
};

/*
 * The chips to take off when a lit row is clicked: every user chip that puts
 * the value in the state the row shows. Empty for an unlit or locked row.
 */
export const getFacetChipsToClear: (
  selections: FacetSelections,
  facetKey: string,
  value: string,
) => Array<FacetChipRef> = (
  selections: FacetSelections,
  facetKey: string,
  value: string,
): Array<FacetChipRef> => {
  const selection: FacetValueSelection | undefined = getFacetValueSelection(
    selections,
    facetKey,
    value,
  );

  return selection ? [...selection.chips] : [];
};

/*
 * A facet's values with every value that is filtering on it kept in the
 * list. A facet count describes the rows the filters leave, so an excluded
 * value counts nothing and drops out of the answer - and with it went the
 * one place it could be clicked back. Such a value is added with a count of
 * 0, named as its chip names it. The values that are there keep their
 * order; the added ones follow, in the order their chips were added.
 */
export const withSelectedFacetValues: (
  values: ReadonlyArray<FacetValue>,
  selected: ReadonlyMap<string, FacetValueSelection> | undefined,
) => Array<FacetValue> = (
  values: ReadonlyArray<FacetValue>,
  selected: ReadonlyMap<string, FacetValueSelection> | undefined,
): Array<FacetValue> => {
  if (!selected || selected.size === 0) {
    return values as Array<FacetValue>;
  }

  const present: Set<string> = new Set<string>(
    values.map((facetValue: FacetValue): string => {
      return String(facetValue.value);
    }),
  );

  const missing: Array<FacetValue> = [];

  for (const [value, selection] of selected.entries()) {
    if (present.has(value)) {
      continue;
    }

    missing.push(
      selection.displayValue
        ? { value: value, count: 0, displayName: selection.displayValue }
        : { value: value, count: 0 },
    );
  }

  return missing.length > 0
    ? [...values, ...missing]
    : (values as Array<FacetValue>);
};

export interface DisplayedFacetValuesOptions {
  // The section's values after its search filter.
  values: ReadonlyArray<FacetValue>;
  // How many rows show before "Show N more".
  visibleCount: number;
  // "Show N more" was pressed, or a search is on: every value shows.
  showAll: boolean;
  // Values that are filtering: never folded behind "Show N more".
  pinnedValues: ReadonlySet<string>;
}

export interface DisplayedFacetValues {
  displayed: Array<FacetValue>;
  // Values behind "Show N more".
  hiddenCount: number;
}

/*
 * The rows a section shows: the first `visibleCount` values, and every value
 * that is filtering wherever it sits in the list, so a checked value is never
 * folded away where it cannot be unchecked. The pinned ones keep their place
 * in the list's order.
 */
export const getDisplayedFacetValues: (
  options: DisplayedFacetValuesOptions,
) => DisplayedFacetValues = (
  options: DisplayedFacetValuesOptions,
): DisplayedFacetValues => {
  if (options.showAll) {
    return { displayed: [...options.values], hiddenCount: 0 };
  }

  const displayed: Array<FacetValue> = options.values.filter(
    (facetValue: FacetValue, index: number): boolean => {
      return (
        index < options.visibleCount ||
        options.pinnedValues.has(String(facetValue.value))
      );
    },
  );

  return {
    displayed: displayed,
    hiddenCount: options.values.length - displayed.length,
  };
};
