import SortOrder from "../Types/BaseDatabase/SortOrder";
import MoveInListUtil from "../Types/Database/MoveInList";

/*
 * The arithmetic of a list people put in order by dragging rows - custom
 * fields, reminder rules, pipelines, status page links - with no database and
 * no React in it, so the server that keeps the numbers and the table that
 * shows them agree on what every number means.
 *
 * The contract, for every such list (issue #9609):
 *
 *   - Lower numbers come first: 1 is the top (a list whose top is its HIGHEST
 *     number - site assignment rules, where the higher priority wins - counts
 *     the other way).
 *   - Rows that share a number come in the order of their ids, as the
 *     database reads them (Types/Database/MoveInList), and rows without one
 *     last.
 *   - A number is kept as it was written, and writing it moves no other row:
 *     two rows may share a number, and a deleted row leaves a gap. Terraform,
 *     and anything else that numbers a whole list, writes every row's number
 *     on its own, all at once, in no set order - each must end at the number
 *     written. An API or Terraform caller that writes 10, 20, 30 reads 10,
 *     20, 30 back.
 *   - A new row without a number goes to the end of its list.
 *   - Moving a row past others is a request of its own (POST <list>/:id/move,
 *     Types/Database/MoveInList): what a drop in a reorderable table sends,
 *     naming the row it was dropped on. It numbers the list from scratch,
 *     1..n from the top.
 */

export interface ListOrderItem {
  id: string;
  // The number stored on the row. Anything but a finite number is "unset".
  value?: number | string | null | undefined;
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

/**
 * The order a list is shown in: by number from the top (rows without one at
 * the bottom, whichever way the list counts), then rows that share a number
 * by id - the order the database reads them in, and the order a move
 * numbers them in (MoveInListUtil.compare), so a drop lands next to the row
 * the server moves it next to.
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
  return MoveInListUtil.compare(
    { id: a.id, order: toListOrderNumber(a.value) },
    { id: b.id, order: toListOrderNumber(b.value) },
    sortOrder,
  );
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
  return MoveInListUtil.getNumberAt({
    position: data.position - 1,
    count: data.count,
    sortOrder: data.sortOrder,
  });
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
 * What a table sends when a row is dropped: the id of the row that sat where
 * it was dropped, whose place the dragged row takes (POST <list>/:id/move).
 * Null when nothing moved, or no row sat there - the caller has nothing to
 * send.
 */
export const getDropTargetId: <T>(data: {
  items: Array<T>;
  sourceIndex: number;
  destinationIndex: number;
  getId: (item: T) => unknown;
}) => string | null = <T>(data: {
  items: Array<T>;
  sourceIndex: number;
  destinationIndex: number;
  getId: (item: T) => unknown;
}): string | null => {
  if (data.sourceIndex === data.destinationIndex) {
    return null;
  }

  const target: T | undefined = data.items[data.destinationIndex];

  if (target === undefined) {
    return null;
  }

  const id: unknown = data.getId(target);

  if (id === null || id === undefined) {
    return null;
  }

  const text: string = id.toString().trim();

  return text.length > 0 ? text : null;
};
