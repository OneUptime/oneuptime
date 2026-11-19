import { useState } from "react";
import { usePaneState } from "../navigation/paneState";
import { useFilterOptions } from "./useFilterOptions";
import {
  NO_FILTERS,
  applyListFilters,
  clearFacet,
  countActiveFacets,
  emptyFilters,
  filtersForList,
  getFiltersKey,
  hasActiveFilters,
  type FilterFacet,
  type FilterableList,
  type RecordFilters,
} from "../filters/recordFilters";
import type { FilterSheetOptions } from "../filters/filterOptions";
import {
  getActiveFilterItems,
  type FilterSummaryItem,
} from "../filters/filterSummary";

export interface RecordFilterControls {
  // Every filter set on the screen, shared by its lists (incidents and episodes).
  filters: RecordFilters;
  // The filters the list on screen asks: those of its facets.
  listFilters: RecordFilters;
  activeCount: number;
  hasActive: boolean;
  items: Array<FilterSummaryItem>;
  options: FilterSheetOptions;
  sheetVisible: boolean;
  focusFacet: FilterFacet | null;
  open: (facet?: FilterFacet) => void;
  close: () => void;
  // The sheet's filters applied; the result says whether they pick states.
  apply: (next: RecordFilters) => { picksStates: boolean };
  remove: (facet: FilterFacet) => void;
  clear: () => void;
}

/*
 * A list screen's filters (filters/recordFilters.ts) and the sheet that
 * sets them. The filters live in the navigator (paneState), as the search
 * does, so a fold or an unfold brings them back; the sheet's values are
 * read only while it is open or a filter is on. `onChange` runs whenever
 * the filters change, for the screen to go back to its first page.
 */
export function useRecordFilterControls(
  list: FilterableList,
  paneKey: string,
  onChange?: () => void,
): RecordFilterControls {
  const [filters, setFilters] = usePaneState<RecordFilters>(
    paneKey,
    NO_FILTERS,
  );
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [focusFacet, setFocusFacet] = useState<FilterFacet | null>(null);
  const hasActive: boolean = hasActiveFilters(filters, list);
  const options: FilterSheetOptions = useFilterOptions(
    list,
    sheetVisible || hasActive,
  );

  const update: (next: RecordFilters) => void = (next: RecordFilters): void => {
    if (getFiltersKey(next) === getFiltersKey(filters)) {
      return;
    }
    setFilters(next);
    onChange?.();
  };

  return {
    filters: filters,
    listFilters: filtersForList(filters, list),
    activeCount: countActiveFacets(filters, list),
    hasActive: hasActive,
    items: getActiveFilterItems(list, filters, options),
    options: options,
    sheetVisible: sheetVisible,
    focusFacet: focusFacet,
    open: (facet?: FilterFacet): void => {
      setFocusFacet(facet ?? null);
      setSheetVisible(true);
    },
    close: (): void => {
      setSheetVisible(false);
    },
    apply: (next: RecordFilters): { picksStates: boolean } => {
      setSheetVisible(false);
      const merged: RecordFilters = applyListFilters(filters, next, list);
      update(merged);
      return {
        picksStates:
          merged.stateIds.length > 0 &&
          [...merged.stateIds].sort().join(",") !==
            [...filters.stateIds].sort().join(","),
      };
    },
    remove: (facet: FilterFacet): void => {
      update(clearFacet(filters, facet));
    },
    clear: (): void => {
      update(emptyFilters());
    },
  };
}
