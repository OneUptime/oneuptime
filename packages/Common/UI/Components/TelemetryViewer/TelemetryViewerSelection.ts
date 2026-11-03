/*
 * WHICH OF A TELEMETRY LIST'S ROWS ARE SELECTED, for its Bulk Actions
 * (TelemetryViewer's `bulk`). React-free, so the rules are tested alone.
 *
 * A selection is the rows a person ticked on the page they are reading,
 * kept by each row's id: the same row read again (a refresh, a live
 * update) stays ticked, and a row that is no longer on the page (another
 * page, a narrower search, a row that moved out of the list after a bulk
 * action) leaves the selection - what the header's box selects.
 *
 * ...unless the list offers every row that matches (the bulk prop's
 * selectAllMatching) and the person took it: then the selection is every
 * match, read in one go, and it is kept whole from page to page - the rows
 * on the page carry their state as the page has it now
 * (refreshSelectedFromPage) - until the search changes or a row is
 * unticked, which leaves the page's ticked rows.
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

/*
 * A selection of every match, each row as the page has it now where the
 * page shows it: a row read again carries its new state (so the menu offers
 * what it can take now), and the rows the page does not show stay as they
 * were read. Nothing leaves it, and its order is its own.
 */
export const refreshSelectedFromPage: <T>(
  selected: Array<T>,
  items: Array<T>,
  getId: RowId<T>,
) => Array<T> = <T>(
  selected: Array<T>,
  items: Array<T>,
  getId: RowId<T>,
): Array<T> => {
  const onPage: Map<string, T> = new Map<string, T>();

  for (const item of items) {
    onPage.set(getId(item), item);
  }

  let isChanged: boolean = false;

  const refreshed: Array<T> = selected.map((each: T): T => {
    const fresh: T | undefined = onPage.get(getId(each));

    if (fresh !== undefined && fresh !== each) {
      isChanged = true;
      return fresh;
    }

    return each;
  });

  // The same array when nothing changed, so an idle list renders once.
  return isChanged ? refreshed : selected;
};
