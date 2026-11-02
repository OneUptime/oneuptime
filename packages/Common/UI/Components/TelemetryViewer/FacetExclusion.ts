import {
  FacetValueState,
  getBaseFacetKey,
  isExcludeFacetKey,
  toExcludeFacetKey,
} from "./FacetSelection";

/*
 * Keeping a facet value, or leaving it out, in every telemetry explorer -
 * Logs, Traces, Metrics, Exceptions and Security Events.
 *
 * A sidebar row offers both: a click keeps only the value's rows, the minus
 * beside it leaves them out. An explorer holds either as a chip, and a
 * left-out value's chip says so on its key (`!severityText: Debug`, see
 * FacetSelection), so the chip row, the address and a saved view carry it
 * like any other chip.
 *
 * Two rules every explorer shares, kept here so they cannot drift apart:
 *
 *  - Choosing a state is never a toggle. A value ends up in exactly the
 *    state asked for: keeping a value that is left out (or the reverse)
 *    moves it, and asking for the state it is already in changes nothing.
 *    Taking a filter off is the chip's own x, or a click on a lit row.
 *
 *  - The compilers read a facet's kept and left-out values apart, by the
 *    facet they filter (groupFacetFilters). A facet with values to keep
 *    filters on those; its left-out values are applied beside them where
 *    that can change the answer (a substring match, a row that belongs to
 *    two resources) and dropped where it cannot (one value per row, kept
 *    exactly).
 *
 * Kept free of React so the rules are unit-testable on their own.
 */

export type FacetChoiceState = FacetValueState.Included | FacetValueState.Excluded;

/*
 * The chip key a value in this state is stored under: the facet's own key
 * to keep it, the same key marked `!` to leave it out.
 */
export const getFacetChoiceChipKey: (
  facetKey: string,
  state: FacetChoiceState,
) => string = (facetKey: string, state: FacetChoiceState): string => {
  const baseKey: string = getBaseFacetKey(facetKey);

  return state === FacetValueState.Excluded
    ? toExcludeFacetKey(baseKey)
    : baseKey;
};

/*
 * Put one value of a facet in exactly one state, in a map of chips
 * (`chip key -> values`, as the Logs and Security Events explorers keep
 * them). Returns the very map it was handed when nothing changes, so a
 * caller can tell a no-op from a change.
 */
export const chooseFacetValueInMap: (
  previous: ReadonlyMap<string, ReadonlySet<string>>,
  facetKey: string,
  value: string,
  state: FacetChoiceState,
) => Map<string, Set<string>> = (
  previous: ReadonlyMap<string, ReadonlySet<string>>,
  facetKey: string,
  value: string,
  state: FacetChoiceState,
): Map<string, Set<string>> => {
  const targetKey: string = getFacetChoiceChipKey(facetKey, state);
  const oppositeKey: string = getFacetChoiceChipKey(
    facetKey,
    state === FacetValueState.Excluded
      ? FacetValueState.Included
      : FacetValueState.Excluded,
  );

  const isApplied: boolean = Boolean(previous.get(targetKey)?.has(value));
  const isOpposite: boolean = Boolean(previous.get(oppositeKey)?.has(value));

  if (!value || (isApplied && !isOpposite)) {
    return previous as Map<string, Set<string>>;
  }

  const next: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const [key, values] of previous.entries()) {
    next.set(key, new Set<string>(values));
  }

  if (isOpposite) {
    const remaining: Set<string> = next.get(oppositeKey)!;
    remaining.delete(value);

    if (remaining.size === 0) {
      next.delete(oppositeKey);
    }
  }

  const target: Set<string> = next.get(targetKey) || new Set<string>();
  target.add(value);
  next.set(targetKey, target);

  return next;
};

// The part of a chip the choice reads: its key and its value.
export interface FacetChoiceChip {
  facetKey: string;
  value: string;
  readOnly?: boolean | undefined;
}

/*
 * The same choice in a list of chips (as the Traces, Metrics and Exceptions
 * explorers keep them). `buildChip` makes the new chip from the key it is
 * stored under, so each explorer names it as it names its others. Returns
 * the very list it was handed when nothing changes. A page's own read-only
 * chip is never moved: it is not the reader's.
 */
export const chooseFacetValueInChips: <TChip extends FacetChoiceChip>(
  previous: ReadonlyArray<TChip>,
  facetKey: string,
  value: string,
  state: FacetChoiceState,
  buildChip: (chipKey: string) => TChip,
) => Array<TChip> = <TChip extends FacetChoiceChip>(
  previous: ReadonlyArray<TChip>,
  facetKey: string,
  value: string,
  state: FacetChoiceState,
  buildChip: (chipKey: string) => TChip,
): Array<TChip> => {
  const targetKey: string = getFacetChoiceChipKey(facetKey, state);
  const oppositeKey: string = getFacetChoiceChipKey(
    facetKey,
    state === FacetValueState.Excluded
      ? FacetValueState.Included
      : FacetValueState.Excluded,
  );

  const isChip: (chip: TChip, key: string) => boolean = (
    chip: TChip,
    key: string,
  ): boolean => {
    return !chip.readOnly && chip.facetKey === key && chip.value === value;
  };

  const isApplied: boolean = previous.some((chip: TChip): boolean => {
    return isChip(chip, targetKey);
  });
  const isOpposite: boolean = previous.some((chip: TChip): boolean => {
    return isChip(chip, oppositeKey);
  });

  if (!value || (isApplied && !isOpposite)) {
    return previous as Array<TChip>;
  }

  const kept: Array<TChip> = previous.filter((chip: TChip): boolean => {
    return !isChip(chip, oppositeKey);
  });

  return isApplied ? kept : [...kept, buildChip(targetKey)];
};

// Each facet's kept and left-out values, by the facet they filter.
export interface FacetFilterGroups {
  // Base facet key -> the values to keep, in the order first seen.
  included: Map<string, Array<string>>;
  // Base facet key -> the values to leave out, in the order first seen.
  excluded: Map<string, Array<string>>;
}

const addValue: (
  groups: Map<string, Array<string>>,
  key: string,
  value: string,
) => void = (
  groups: Map<string, Array<string>>,
  key: string,
  value: string,
): void => {
  if (typeof value !== "string" || value.length === 0) {
    return;
  }

  const values: Array<string> = groups.get(key) || [];

  if (!values.includes(value)) {
    values.push(value);
  }

  groups.set(key, values);
};

/*
 * Read a map of chips (`chip key -> values`) into each facet's kept and
 * left-out values. Empty values and empty groups are dropped, so an emptied
 * group never reaches a compiler as a list that matches nothing.
 */
export const groupFacetFilters: (
  entries: Iterable<[string, Iterable<string>]>,
) => FacetFilterGroups = (
  entries: Iterable<[string, Iterable<string>]>,
): FacetFilterGroups => {
  const groups: FacetFilterGroups = {
    included: new Map<string, Array<string>>(),
    excluded: new Map<string, Array<string>>(),
  };

  for (const [chipKey, values] of entries) {
    const baseKey: string = getBaseFacetKey(chipKey);

    if (!baseKey) {
      continue;
    }

    const target: Map<string, Array<string>> = isExcludeFacetKey(chipKey)
      ? groups.excluded
      : groups.included;

    for (const value of values) {
      addValue(target, baseKey, value);
    }
  }

  return groups;
};

// The same reading of a list of chips; a page's read-only chips included.
export const groupFacetChips: (
  chips: ReadonlyArray<FacetChoiceChip>,
) => FacetFilterGroups = (
  chips: ReadonlyArray<FacetChoiceChip>,
): FacetFilterGroups => {
  return groupFacetFilters(
    chips.map((chip: FacetChoiceChip): [string, Array<string>] => {
      return [chip.facetKey, [chip.value]];
    }),
  );
};

/*
 * The values of one facet a compiler should leave out: none when the same
 * facet keeps values and every row holds one value of it, kept exactly -
 * leaving a value out of what is already kept to other values changes
 * nothing, and one predicate per column is what a list query can hold.
 */
export const getEffectiveExcludedValues: (
  groups: FacetFilterGroups,
  baseKey: string,
) => Array<string> = (
  groups: FacetFilterGroups,
  baseKey: string,
): Array<string> => {
  const included: Array<string> = groups.included.get(baseKey) || [];

  if (included.length > 0) {
    return [];
  }

  return groups.excluded.get(baseKey) || [];
};
