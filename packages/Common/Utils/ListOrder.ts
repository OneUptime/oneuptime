import SortOrder from "../Types/BaseDatabase/SortOrder";

/*
 * The arithmetic of a list people put in order by dragging rows - custom
 * fields, reminder rules, pipelines, status page links - with no database and
 * no React in it, so the server that stores the order and the table that
 * shows it agree on what every number means.
 *
 * The contract, for every such list:
 *
 *   - A row's number IS its place: 1 for the row at the top, 2 for the next,
 *     and so on (a list whose top is its HIGHEST number - site assignment
 *     rules, where the higher priority wins - counts the other way: n at the
 *     top, 1 at the bottom). Nobody types these numbers any more; the server
 *     keeps them.
 *   - A new row goes to the end of its list.
 *   - Setting a row's number moves it to where the row holding that number is
 *     now, and the rows in between shift by one to make room. That is the
 *     whole drag-and-drop protocol: the table sends the number of the row the
 *     dragged one was dropped onto. It is also what an API caller who sets
 *     `order: 3` means - "make this the third one".
 *   - Every change renumbers the whole list 1..n again, so a list that came
 *     out of older versions with gaps, duplicates or no numbers at all heals
 *     the first time anything in it changes.
 */

export interface ListOrderItem {
  id: string;
  // The number stored on the row. Anything but a finite number is "unset".
  value?: number | string | null | undefined;
  // Breaks ties between rows with the same (or no) number: the older first.
  createdAt?: Date | string | null | undefined;
}

export interface ListOrderChange {
  id: string;
  value: number;
}

/**
 * The stored value as a number, or null when it is not one. API callers and
 * `<input type="number">` both send numbers as strings; null, undefined, NaN
 * and anything else that is not a number all mean "unset".
 */
export const toListOrderNumber: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

/*
 * Closeness to the top of the list: smaller is nearer the top, whichever way
 * the list counts. Lets the placement below be written once for both.
 */
const toRank: (value: number, sortOrder: SortOrder) => number = (
  value: number,
  sortOrder: SortOrder,
): number => {
  return sortOrder === SortOrder.Descending ? -value : value;
};

const toTime: (value: Date | string | null | undefined) => number | null = (
  value: Date | string | null | undefined,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const time: number =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
};

/**
 * The order a list is shown in: by number (rows without one at the bottom,
 * whichever way the list counts), then the older row first, then by id so
 * that two calls can never disagree.
 */
export const compareListOrderItems: (
  a: ListOrderItem,
  b: ListOrderItem,
  sortOrder: SortOrder,
) => number = (
  a: ListOrderItem,
  b: ListOrderItem,
  sortOrder: SortOrder,
): number => {
  const aValue: number | null = toListOrderNumber(a.value);
  const bValue: number | null = toListOrderNumber(b.value);

  if (aValue !== null && bValue === null) {
    return -1;
  }

  if (aValue === null && bValue !== null) {
    return 1;
  }

  if (aValue !== null && bValue !== null && aValue !== bValue) {
    return toRank(aValue, sortOrder) - toRank(bValue, sortOrder);
  }

  const aTime: number | null = toTime(a.createdAt);
  const bTime: number | null = toTime(b.createdAt);

  if (aTime !== null && bTime === null) {
    return -1;
  }

  if (aTime === null && bTime !== null) {
    return 1;
  }

  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }

  if (a.id === b.id) {
    return 0;
  }

  return a.id < b.id ? -1 : 1;
};

/** A copy of the rows, top of the list first. */
export const sortListOrderItems: <T extends ListOrderItem>(
  items: Array<T>,
  sortOrder: SortOrder,
) => Array<T> = <T extends ListOrderItem>(
  items: Array<T>,
  sortOrder: SortOrder,
): Array<T> => {
  return [...items].sort((a: T, b: T) => {
    return compareListOrderItems(a, b, sortOrder);
  });
};

/**
 * The list with one row put where it was asked to go.
 *
 * `siblings` are the OTHER rows of the list, in any order and with the
 * numbers they hold now. `previousValue` is where the row was (null for a
 * row that is new to this list) and `requestedValue` where it is going (null
 * for "the end").
 *
 * A row moving up goes in front of the first row whose number is at or past
 * the requested one; a row moving down goes after the last one whose number
 * is at or before it. For a list numbered 1..n that is exactly "take the
 * place of the row holding that number, and shift the ones in between" -
 * which is what a drop onto that row means. It also does something sensible
 * with a list that has gaps in its numbers. A row asked to go where it
 * already is stays put.
 */
export const placeListOrderItem: <T extends ListOrderItem>(data: {
  siblings: Array<T>;
  item: T;
  previousValue: unknown;
  requestedValue: unknown;
  sortOrder: SortOrder;
}) => Array<T> = <T extends ListOrderItem>(data: {
  siblings: Array<T>;
  item: T;
  previousValue: unknown;
  requestedValue: unknown;
  sortOrder: SortOrder;
}): Array<T> => {
  const ordered: Array<T> = sortListOrderItems(
    data.siblings.filter((sibling: T) => {
      return sibling.id !== data.item.id;
    }),
    data.sortOrder,
  );

  const requested: number | null = toListOrderNumber(data.requestedValue);
  const previous: number | null = toListOrderNumber(data.previousValue);

  if (requested === null) {
    return [...ordered, data.item];
  }

  const requestedRank: number = toRank(requested, data.sortOrder);

  if (previous !== null && toRank(previous, data.sortOrder) === requestedRank) {
    // Not a move: the row keeps the place its number gives it.
    return sortListOrderItems(
      [...ordered, { ...data.item, value: previous }],
      data.sortOrder,
    ).map((row: T) => {
      return row.id === data.item.id ? data.item : row;
    });
  }

  const isMovingUp: boolean =
    previous === null || requestedRank < toRank(previous, data.sortOrder);

  let index: number;

  if (isMovingUp) {
    index = ordered.findIndex((sibling: T) => {
      const value: number | null = toListOrderNumber(sibling.value);
      // Rows with no number are below every numbered one.
      return value === null || toRank(value, data.sortOrder) >= requestedRank;
    });

    if (index === -1) {
      index = ordered.length;
    }
  } else {
    index = 0;

    ordered.forEach((sibling: T, position: number) => {
      const value: number | null = toListOrderNumber(sibling.value);

      if (value !== null && toRank(value, data.sortOrder) <= requestedRank) {
        index = position + 1;
      }
    });
  }

  return [...ordered.slice(0, index), data.item, ...ordered.slice(index)];
};

/**
 * The number the row at `position` (1 = the top) holds in a list of `count`
 * rows.
 */
export const getListOrderValue: (data: {
  position: number;
  count: number;
  sortOrder: SortOrder;
}) => number = (data: {
  position: number;
  count: number;
  sortOrder: SortOrder;
}): number => {
  return data.sortOrder === SortOrder.Descending
    ? data.count - data.position + 1
    : data.position;
};

/**
 * Renumbers a list that is already in its new order and says which rows end
 * up with a number different from the one they hold. Those - and only those -
 * have to be written.
 */
export const getListOrderChanges: (data: {
  orderedItems: Array<ListOrderItem>;
  sortOrder: SortOrder;
}) => Array<ListOrderChange> = (data: {
  orderedItems: Array<ListOrderItem>;
  sortOrder: SortOrder;
}): Array<ListOrderChange> => {
  const changes: Array<ListOrderChange> = [];

  data.orderedItems.forEach((item: ListOrderItem, index: number) => {
    const value: number = getListOrderValue({
      position: index + 1,
      count: data.orderedItems.length,
      sortOrder: data.sortOrder,
    });

    if (toListOrderNumber(item.value) !== value) {
      changes.push({ id: item.id, value: value });
    }
  });

  return changes;
};

/**
 * Whether a list already holds exactly the numbers its rows' places give
 * them - 1..n top-down (n..1 for a list whose top is its highest number).
 */
export const isListOrderNormalized: (data: {
  items: Array<ListOrderItem>;
  sortOrder: SortOrder;
}) => boolean = (data: {
  items: Array<ListOrderItem>;
  sortOrder: SortOrder;
}): boolean => {
  return (
    getListOrderChanges({
      orderedItems: sortListOrderItems(data.items, data.sortOrder),
      sortOrder: data.sortOrder,
    }).length === 0
  );
};

/**
 * The rows with one of them moved, as a list shows them the moment it is
 * dropped - before the server has answered.
 */
export const moveListItem: <T>(
  items: Array<T>,
  fromIndex: number,
  toIndex: number,
) => Array<T> = <T>(
  items: Array<T>,
  fromIndex: number,
  toIndex: number,
): Array<T> => {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }

  const moved: Array<T> = [...items];
  const [item] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, item as T);

  return moved;
};

/**
 * What a table sends when a row is dropped: the number held by the row that
 * sat where it was dropped. Null when that cannot be known (no row there, or
 * the row has no number yet), in which case the caller has nothing honest to
 * send.
 */
export const getDropTargetValue: <T>(data: {
  items: Array<T>;
  sourceIndex: number;
  destinationIndex: number;
  getValue: (item: T) => unknown;
}) => number | null = <T>(data: {
  items: Array<T>;
  sourceIndex: number;
  destinationIndex: number;
  getValue: (item: T) => unknown;
}): number | null => {
  if (data.sourceIndex === data.destinationIndex) {
    return null;
  }

  const target: T | undefined = data.items[data.destinationIndex];

  if (target === undefined) {
    return null;
  }

  return toListOrderNumber(data.getValue(target));
};
