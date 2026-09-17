import { FilterOperator } from "./FilterChipDropdownTypes";
import {
  normalizeFacetValues,
  resolveFacetOperator,
} from "./FacetSelectionState";

/*
 * A summary tile above a list is a count, and every count answers a question
 * the user immediately wants the rows for — "three devices are down, which
 * three?".
 *
 * The rows are produced by moving the *facet bar*, not by a second filter
 * hidden behind the table: the chips are then the visible, editable record of
 * why the list is short, and the user narrows further or backs out through the
 * same control they would have used if they had started from the bar. This
 * module is the vocabulary the tiles and the bar share.
 */
export interface FacetTileSelection {
  /**
   * Which chip this tile moves. `null` means the tile describes the whole,
   * unfiltered list — activating it clears every chip instead of setting one.
   */
  facetKey: string | null;
  /** Values to select on that chip. Empty with an `is_empty` operator. */
  values: Array<string>;
  operator: FilterOperator;
}

export type FacetSelectionMap = { [facetKey: string]: Array<string> };
export type FacetOperatorMap = { [facetKey: string]: FilterOperator };

export type IsFacetTileSelectionAppliedFunction = (
  selection: FacetTileSelection,
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
) => boolean;

/**
 * Is the bar already showing exactly what this tile describes?
 *
 * Drives both the tile's pressed state and its toggle-off behaviour, so the two
 * cannot disagree — a tile that looks lit has to be the one a second click
 * turns off.
 *
 * Value order is ignored (the chip stores whatever order the user clicked in,
 * and a tile hands over a list built from a query result), but the value *set*
 * has to match exactly: a tile that means "these three statuses" is not applied
 * while only two of them are selected.
 */
export const isFacetTileSelectionApplied: IsFacetTileSelectionAppliedFunction =
  (
    selection: FacetTileSelection,
    facetSelections: FacetSelectionMap,
    facetOperators: FacetOperatorMap,
  ): boolean => {
    if (selection.facetKey === null) {
      // The "everything" tile is applied exactly when nothing else is.
      return !hasAnyFacetSelection(facetSelections, facetOperators);
    }

    const currentOperator: FilterOperator = resolveFacetOperator(
      facetOperators[selection.facetKey],
    );

    if (currentOperator !== resolveFacetOperator(selection.operator)) {
      return false;
    }

    const current: Array<string> = normalizeFacetValues(
      facetSelections[selection.facetKey],
    );
    const wanted: Array<string> = normalizeFacetValues(selection.values);

    if (current.length !== wanted.length) {
      return false;
    }

    const currentSet: Set<string> = new Set<string>(current);

    return wanted.every((value: string) => {
      return currentSet.has(value);
    });
  };

export type HasAnyFacetSelectionFunction = (
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
) => boolean;

/**
 * Is any extra facet constraining the list?
 *
 * Deliberately blind to the Owner and Labels chips the hook owns: this answers
 * "is one of the tiles' facets active", which is what the total tile reports.
 */
export const hasAnyFacetSelection: HasAnyFacetSelectionFunction = (
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
): boolean => {
  for (const key of Object.keys(facetSelections || {})) {
    if (normalizeFacetValues(facetSelections[key]).length > 0) {
      return true;
    }
  }

  for (const key of Object.keys(facetOperators || {})) {
    const operator: FilterOperator = resolveFacetOperator(facetOperators[key]);

    if (operator === "is_empty" || operator === "is_not_empty") {
      return true;
    }
  }

  return false;
};

export interface ApplyFacetTileSelectionOptions {
  selection: FacetTileSelection;
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
  clearAllFacets: () => void;
}

export type ApplyFacetTileSelectionFunction = (
  options: ApplyFacetTileSelectionOptions,
) => void;

/**
 * Move the bar to what a tile describes — or, when the bar is already there,
 * back out of it.
 *
 * The toggle is what stops a tile being a one-way door: the click that narrowed
 * the list is also the click that widens it again, which is the only affordance
 * a user who has scrolled past the bar is likely to find.
 */
export const applyFacetTileSelection: ApplyFacetTileSelectionFunction = (
  options: ApplyFacetTileSelectionOptions,
): void => {
  const { selection } = options;

  if (selection.facetKey === null) {
    options.clearAllFacets();
    return;
  }

  if (
    isFacetTileSelectionApplied(
      selection,
      options.facetSelections,
      options.facetOperators,
    )
  ) {
    options.setFacetSelection(selection.facetKey, [], "is");
    return;
  }

  options.setFacetSelection(
    selection.facetKey,
    normalizeFacetValues(selection.values),
    resolveFacetOperator(selection.operator),
  );
};
