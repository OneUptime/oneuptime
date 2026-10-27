/*
 * WHICH OF A TELEMETRY LIST'S ROWS ARE SELECTED, for its Bulk Actions
 * (TelemetryViewer's `bulk`). React-free, so the rules are tested alone.
 *
 * A selection is the rows a person ticked on the page they are reading,
 * kept by each row's id: the same row read again (a refresh, a live
 * update) stays ticked, and a row that is no longer on the page (another
 * page, a narrower search, a row that moved out of the list after a bulk
 * action) leaves the selection. The list pages, so a selection is never
 * wider than its page - what the header's box selects, and all that Bulk
 * Actions acts on.
 */

export type RowId<T> = (item: T) => string;

export enum PageSelectionState {
  None = "none",
  Some = "some",
  All = "all",
}

const idsOf: <T>(items: Array<T>, getId: RowId<T>) => Set<string> = <T>(
  items: Array<T>,
  getId: RowId<T>,
): Set<string> => {
  return new Set<string>(
    items.map((item: T): string => {
      return getId(item);
    }),
  );
};

export const isRowSelected: <T>(
  selected: Array<T>,
  item: T,
  getId: RowId<T>,
) => boolean = <T>(selected: Array<T>, item: T, getId: RowId<T>): boolean => {
  const id: string = getId(item);

  return selected.some((each: T): boolean => {
    return getId(each) === id;
  });
};

// A row's box ticked or cleared: the selection with or without it, once.
export const setRowSelected: <T>(
  selected: Array<T>,
  item: T,
  isSelected: boolean,
  getId: RowId<T>,
) => Array<T> = <T>(
  selected: Array<T>,
  item: T,
  isSelected: boolean,
  getId: RowId<T>,
): Array<T> => {
  const id: string = getId(item);
  const without: Array<T> = selected.filter((each: T): boolean => {
    return getId(each) !== id;
  });

  return isSelected ? [...without, item] : without;
};

/*
 * The selection kept to the rows on the page, each as the page has it now:
 * a row read again carries its new state (a resolved exception says so),
 * one that left the page leaves the selection. In the page's order.
 */
export const keepSelectedOnPage: <T>(
  selected: Array<T>,
  items: Array<T>,
  getId: RowId<T>,
) => Array<T> = <T>(
  selected: Array<T>,
  items: Array<T>,
  getId: RowId<T>,
): Array<T> => {
  const selectedIds: Set<string> = idsOf(selected, getId);

  return items.filter((item: T): boolean => {
    return selectedIds.has(getId(item));
  });
};

// How the header's box reads: nothing ticked, some, or every row on the page.
export const getPageSelectionState: <T>(
  selected: Array<T>,
  items: Array<T>,
  getId: RowId<T>,
) => PageSelectionState = <T>(
  selected: Array<T>,
  items: Array<T>,
  getId: RowId<T>,
): PageSelectionState => {
  if (items.length === 0) {
    return PageSelectionState.None;
  }

  const selectedIds: Set<string> = idsOf(selected, getId);
  const onPage: number = items.filter((item: T): boolean => {
    return selectedIds.has(getId(item));
  }).length;

  if (onPage === 0) {
    return PageSelectionState.None;
  }

  return onPage === items.length
    ? PageSelectionState.All
    : PageSelectionState.Some;
};
