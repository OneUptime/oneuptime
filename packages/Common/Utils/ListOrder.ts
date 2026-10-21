import SortOrder from "../Types/BaseDatabase/SortOrder";

/*
 * The arithmetic of a list people put in order by dragging rows - custom
 * fields, reminder rules, pipelines, status page links - with no database and
 * no React in it, so the server that keeps the numbers and the table that
 * shows them agree on what every number means.
 *
 * The contract, for every such list:
 *
 *   - Lower numbers come first: 1 is the top (a list whose top is its HIGHEST
 *     number - site assignment rules, where the higher priority wins - counts
 *     the other way).
 *   - A new row without a number goes to the end of its list.
 *   - A number is kept as it was written. When a row is given a number that
 *     another row of its list already holds, that row moves one step to make
 *     room - down the list for a row moving up, up the list for a row moving
 *     down - and so on along any run of neighbours, until the step lands on a
 *     free number. In a list numbered 1..n that is exactly "take the place of
 *     the row holding that number, and shift the ones in between", which is
 *     what a drop in a reorderable table sends: the number of the row it was
 *     dropped onto. Numbers nobody collides with are never rewritten, so an
 *     API or Terraform caller that writes 10, 20, 30 reads 10, 20, 30 back.
 *   - So no two rows of a list share a number, and the order is total.
 */

export interface ListOrderItem {
  id: string;
  // The number stored on the row. Anything but a finite number is "unset".
  value?: number | string | null | undefined;
  // Breaks ties between rows with no number: the older first.
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
 * the list counts. Lets everything below be written once for both.
 */
const toRank: (value: number, sortOrder: SortOrder) => number = (
  value: number,
  sortOrder: SortOrder,
): number => {
  // `0 - x`, not `-x`: never a negative zero.
  return sortOrder === SortOrder.Descending ? 0 - value : value;
};

const fromRank: (rank: number, sortOrder: SortOrder) => number = (
  rank: number,
  sortOrder: SortOrder,
): number => {
  return sortOrder === SortOrder.Descending ? 0 - rank : rank;
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
 * The number a new row gets so that it is the last of its list: one past the
 * last row's (one below it for a list that counts down), or 1 for the first
 * row of a list.
 */
export const getListOrderAppendValue: (data: {
  siblings: Array<ListOrderItem>;
  sortOrder: SortOrder;
}) => number = (data: {
  siblings: Array<ListOrderItem>;
  sortOrder: SortOrder;
}): number => {
  let lastRank: number | null = null;

  for (const sibling of data.siblings) {
    const value: number | null = toListOrderNumber(sibling.value);

    if (value === null) {
      continue;
    }

    const rank: number = toRank(value, data.sortOrder);

    if (lastRank === null || rank > lastRank) {
      lastRank = rank;
    }
  }

  if (lastRank === null) {
    return 1;
  }

  /*
   * Whole numbers only: a list typed as 1.5, 2.5 still gets a new row at a
   * whole number past its last one.
   */
  return fromRank(Math.floor(lastRank) + 1, data.sortOrder);
};

/**
 * The other rows that have to move when one row is given `requestedValue`.
 *
 * `siblings` are the rows of the list as they are now (the row being placed
 * may be among them; it is ignored). `previousValue` is the number the row
 * had (null for a row that is new to this list).
 *
 * Nothing moves when no sibling holds the requested number. Otherwise the
 * one that does takes one step away - down the list when the row is moving
 * up (or is new), up the list when it is moving down - and if that step
 * lands on another row's number, that row steps along too, until a step
 * lands on a free number. The row's own old number counts as free: the run
 * of rows between where it was and where it is going closes up behind it.
 */
export const getListOrderCollisionChanges: (data: {
  siblings: Array<ListOrderItem>;
  itemId: string;
  previousValue: unknown;
  requestedValue: unknown;
  sortOrder: SortOrder;
}) => Array<ListOrderChange> = (data: {
  siblings: Array<ListOrderItem>;
  itemId: string;
  previousValue: unknown;
  requestedValue: unknown;
  sortOrder: SortOrder;
}): Array<ListOrderChange> => {
  const requested: number | null = toListOrderNumber(data.requestedValue);

  if (requested === null) {
    return [];
  }

  const previous: number | null = toListOrderNumber(data.previousValue);
  const requestedRank: number = toRank(requested, data.sortOrder);
  const previousRank: number | null =
    previous === null ? null : toRank(previous, data.sortOrder);

  if (previousRank !== null && previousRank === requestedRank) {
    return [];
  }

  // Rows by the rank their number gives them; the row being placed is not one.
  const rowsByRank: Map<number, Array<ListOrderItem>> = new Map();

  for (const sibling of data.siblings) {
    if (sibling.id === data.itemId) {
      continue;
    }

    const value: number | null = toListOrderNumber(sibling.value);

    if (value === null) {
      continue;
    }

    const rank: number = toRank(value, data.sortOrder);
    const rows: Array<ListOrderItem> = rowsByRank.get(rank) || [];
    rows.push(sibling);
    rowsByRank.set(rank, rows);
  }

  // Moving up (or arriving): the rows in the way step down, and vice versa.
  const step: number =
    previousRank === null || requestedRank < previousRank ? 1 : -1;

  const changes: Array<ListOrderChange> = [];
  let rank: number = requestedRank;
  let movingRows: Array<ListOrderItem> = rowsByRank.get(rank) || [];

  while (movingRows.length > 0) {
    const nextRank: number = rank + step;

    for (const row of movingRows) {
      changes.push({
        id: row.id,
        value: fromRank(nextRank, data.sortOrder),
      });
    }

    rank = nextRank;
    /*
     * The run ends on a free number. The row's own old number is free - it
     * is moving away from it - unless another row shares it, in which case
     * that row steps along as well.
     */
    movingRows = rowsByRank.get(rank) || [];
  }

  return changes;
};

/**
 * The number the row at `position` (1 = the top) holds in a list of `count`
 * rows numbered from scratch.
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
 * Renumbers a list that is already in the order it should keep - 1..n from
 * the top (n..1 for a list that counts down) - and says which rows end up
 * with a number different from the one they hold. Those, and only those,
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
 * Whether a list has rows without a number or two rows with the same one -
 * the lists saved before the server kept the numbers, where a drop onto a row
 * could not say where it meant. A list with unique numbers, gaps or not, is
 * fine as it is.
 */
export const needsListOrderNormalization: (
  items: Array<ListOrderItem>,
) => boolean = (items: Array<ListOrderItem>): boolean => {
  const seen: Set<number> = new Set();

  for (const item of items) {
    const value: number | null = toListOrderNumber(item.value);

    if (value === null || seen.has(value)) {
      return true;
    }

    seen.add(value);
  }

  return false;
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
