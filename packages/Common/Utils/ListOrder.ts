import SortOrder from "../Types/BaseDatabase/SortOrder";

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
 *   - A new row without a number goes to the end of its list.
 *   - A WRITE PLACES ITS OWN ROW, AND MOVES NO OTHER. A number is kept as it
 *     was written, even one another row of the list holds: the two then
 *     share it, and are read the older first (compareListOrderItems), so the
 *     order is still total. Terraform - and anything else that keeps a whole
 *     list's numbering - writes every changed row's number on its own, all
 *     at once, in no set order, and every row must end at the number
 *     written. When a write of a held number made the row holding it step
 *     aside, each write moved rows another had just placed, and the next
 *     plan never came back empty. Writes that each change one row cannot
 *     undo each other, whatever order they land in.
 *   - A MOVE IS ITS OWN REQUEST (getListOrderMoveChanges; POST
 *     <list>/:id/move, Types/Database/MoveInList), which a drop in a
 *     reorderable table sends: the row takes the place of the row it was
 *     dropped on, the rows between step one place towards where it was, and
 *     the list is numbered 1..n from the top (n..1 for a list that counts
 *     down). In a list numbered 1..n that changes only the rows between the
 *     two places, as a drag always did; a list with gaps or shared numbers
 *     comes out tidy.
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
 * Two rows' numbers in the order the list is shown in: the top first
 * (lower numbers, or higher ones in a list that counts down), and a row
 * without a number after every row that has one - never at a number made up
 * for it, such as 0 or its place in a read, which would put it among the
 * numbered rows. Zero for two rows at one place, or two without a number:
 * the caller breaks that tie (compareListOrderItems: the older first; a
 * reader that has no age keeps the order it read them in).
 *
 * The one rule for "no number" (issue #9655): every reader of a
 * drag-ordered list that compares numbers itself compares them with this.
 */
export const compareListOrderValues: (
  a: unknown,
  b: unknown,
  sortOrder: SortOrder,
) => number = (a: unknown, b: unknown, sortOrder: SortOrder): number => {
  const aValue: number | null = toListOrderNumber(a);
  const bValue: number | null = toListOrderNumber(b);

  if (aValue !== null && bValue === null) {
    return -1;
  }

  if (aValue === null && bValue !== null) {
    return 1;
  }

  if (aValue !== null && bValue !== null && aValue !== bValue) {
    return toRank(aValue, sortOrder) - toRank(bValue, sortOrder);
  }

  return 0;
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
  const byValue: number = compareListOrderValues(a.value, b.value, sortOrder);

  if (byValue !== 0) {
    return byValue;
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

// A sort's direction for one column, as TypeORM reads it, or null.
const toSortDirection: (value: unknown) => SortOrder | null = (
  value: unknown,
): SortOrder | null => {
  const direction: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["direction"]
      : value;

  if (typeof direction !== "string") {
    return null;
  }

  const upper: string = direction.toUpperCase();

  if (upper === SortOrder.Ascending) {
    return SortOrder.Ascending;
  }

  return upper === SortOrder.Descending ? SortOrder.Descending : null;
};

/**
 * The order the server reads a drag-ordered list's rows in, given the sort
 * its caller asked for (DatabaseService.getReadSort), so that a read agrees
 * with the list as it is shown (compareListOrderItems; issue #9654):
 *
 *   - asked for no order: the list's own, top first, two rows at one
 *     number the older first. So "the project's created state" - a lookup
 *     by a flag alone, findOneBy({ isCreatedState: true }) - is the
 *     topmost row carrying it, as every rule and the Dashboard take it,
 *     never the newest one, which a read in no order used to give;
 *   - asked for the list's number last, in the list's direction: two rows
 *     at that number the older first, as the list shows them, rather than
 *     by id;
 *   - asked for it against the list's direction - from the bottom up, as
 *     "the least severe severity" is read: the newer of two rows at one
 *     number first, and by id from the highest, so the first row read is
 *     the last row the list shows.
 *
 * Any other order is read as asked, and so is one that already says how
 * its ties go (by createdAt or _id).
 */
export const getListOrderReadSort: (data: {
  sort: Record<string, unknown> | null | undefined;
  column: string;
  sortOrder: SortOrder;
}) => Record<string, unknown> = (data: {
  sort: Record<string, unknown> | null | undefined;
  column: string;
  sortOrder: SortOrder;
}): Record<string, unknown> => {
  const entries: Array<[string, unknown]> = Object.entries(
    data.sort || {},
  ).filter((entry: [string, unknown]): boolean => {
    return entry[1] !== undefined && entry[1] !== null;
  });

  if (entries.length === 0) {
    return {
      [data.column]: data.sortOrder,
      createdAt: SortOrder.Ascending,
    };
  }

  const [lastColumn, lastValue] = entries[entries.length - 1]!;
  const direction: SortOrder | null = toSortDirection(lastValue);
  const saysHowTiesGo: boolean = entries.some(
    (entry: [string, unknown]): boolean => {
      return entry[0] === "createdAt" || entry[0] === "_id";
    },
  );

  if (lastColumn !== data.column || direction === null || saysHowTiesGo) {
    return data.sort || {};
  }

  if (direction === data.sortOrder) {
    return { ...data.sort, createdAt: SortOrder.Ascending };
  }

  return {
    ...data.sort,
    createdAt: SortOrder.Descending,
    _id: SortOrder.Descending,
  };
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
 * The other rows that have to step aside for a row to be put AT
 * `requestedValue` rather than beside the row holding it.
 *
 * A write of a number never does this (see the contract above): only a row
 * whose place the server itself picks, because its caller named none - a
 * state created without a number goes just above the resolved state
 * (Common/Utils/StateOrder) - makes room for itself this way.
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

/*
 * What a move of one row of a list to another row's place comes to: the rows
 * given another number, or why it is no move of this list - the moved row is
 * not in it (deleted, or moved to another list, since it was read), or the
 * row whose place it takes is not.
 */
export type ListOrderMove =
  | { kind: "moved"; changes: Array<ListOrderChange> }
  | { kind: "rowNotInList" }
  | { kind: "placeNotInList" };

// Ids as Postgres writes a uuid, however a caller wrote them.
const sameListOrderId: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

/**
 * Moves row `itemId` to the place of row `placeOfId`: the list in the order
 * it is shown (sortListOrderItems), the moved row taken out and put where the
 * named row stands - just above it when it came from below, just below it
 * when it came from above - and the list numbered from scratch, 1..n from
 * the top (n..1 for a list that counts down). Only the rows whose number
 * changes are given; a move to the row's own place changes none.
 *
 * A drop in a reorderable table, and the move request (POST <list>/:id/move)
 * it sends: the row it was dropped on is named by its id, so a list with
 * gaps, rows without a number or two rows at one number moves exactly where
 * it was dropped all the same.
 */
export const getListOrderMoveChanges: (data: {
  items: Array<ListOrderItem>;
  itemId: string;
  placeOfId: string;
  sortOrder: SortOrder;
}) => ListOrderMove = (data: {
  items: Array<ListOrderItem>;
  itemId: string;
  placeOfId: string;
  sortOrder: SortOrder;
}): ListOrderMove => {
  const list: Array<ListOrderItem> = sortListOrderItems(
    data.items,
    data.sortOrder,
  );

  const from: number = list.findIndex((item: ListOrderItem): boolean => {
    return sameListOrderId(item.id, data.itemId);
  });

  if (from < 0) {
    return { kind: "rowNotInList" };
  }

  const to: number = list.findIndex((item: ListOrderItem): boolean => {
    return sameListOrderId(item.id, data.placeOfId);
  });

  if (to < 0) {
    return { kind: "placeNotInList" };
  }

  if (from === to) {
    return { kind: "moved", changes: [] };
  }

  return {
    kind: "moved",
    changes: getListOrderChanges({
      orderedItems: moveListItem(list, from, to),
      sortOrder: data.sortOrder,
    }),
  };
};
