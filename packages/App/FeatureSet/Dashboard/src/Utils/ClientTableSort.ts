import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import GenericObject from "Common/Types/GenericObject";

/*
 * Sorting for the tables that read their whole list in one fetch and page it
 * in the browser - the Docker and Podman Containers lists and the Ceph
 * Daemons list. The shared table header only reports which column was
 * clicked and which way; the page sorts its own rows, all of them, before it
 * cuts out the page on screen.
 *
 * Pure, so the rules are unit tested directly
 * (App/Tests/Dashboard/ClientTableSort.test.ts).
 */

// What a row sorts by in one column. Null when the row has nothing there.
export type ClientSortValue = string | number | null;

export interface ClientSortColumn<T> {
  // Which way the column opens on its first click.
  firstSortOrder: SortOrder;
  /*
   * What the column sorts by. Defaults to the row's field of the same name;
   * set it when the order is not that field's own - a status sorted by how
   * bad it is rather than by its label.
   */
  value?: ((row: T) => ClientSortValue) | undefined;
}

// Every column that sorts, under the key its table column declares.
export type ClientSortColumns<T, K extends string> = Record<
  K,
  ClientSortColumn<T>
>;

export interface ClientSort<K extends string> {
  sortBy: K;
  sortOrder: SortOrder;
}

/*
 * Text in the order people count - worker2 before worker10, 18.2.4 before
 * 18.2.10 - ignoring case. Text that differs only in case or leading zeros
 * still gets one fixed order, so two such rows cannot swap places from one
 * refresh to the next.
 */
export const compareText: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  const order: number = a.localeCompare(b, undefined, {
    sensitivity: "base",
    numeric: true,
  });

  if (order !== 0) {
    return order;
  }

  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

/*
 * The value a row sorts by, or null when it has none: no reading, an empty
 * name, or a reading that is not a number.
 */
const presentValueOf: (value: unknown) => string | number | null = (
  value: unknown,
): string | number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    return value.trim() === "" ? null : value;
  }

  return null;
};

/*
 * One column's order between two rows. A missing value sorts last whichever
 * way the column is sorted: a dash is not the smallest reading, and flipping
 * a column should not lift every row without one to the top.
 */
const compareValues: (
  rawA: unknown,
  rawB: unknown,
  sortOrder: SortOrder,
) => number = (rawA: unknown, rawB: unknown, sortOrder: SortOrder): number => {
  const a: string | number | null = presentValueOf(rawA);
  const b: string | number | null = presentValueOf(rawB);

  if (a === null || b === null) {
    if (a === b) {
      return 0;
    }

    return a === null ? 1 : -1;
  }

  const order: number =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : compareText(String(a), String(b));

  return sortOrder === SortOrder.Descending ? -order : order;
};

export const isClientSortKey: <T, K extends string>(
  columns: ClientSortColumns<T, K>,
  value: unknown,
) => value is K = <T, K extends string>(
  columns: ClientSortColumns<T, K>,
  value: unknown,
): value is K => {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(columns, value)
  );
};

/*
 * The sort after a header click. The shared table header flips whatever way
 * the table was last sorted, whichever column was clicked - so after CPU
 * (busiest first) a click on Memory would open on the containers using the
 * least. A newly picked column opens its own way instead; clicking the
 * sorted column again still flips it. A key that is not a sortable column
 * leaves the sort as it was.
 */
export const resolveClientSort: <T, K extends string>(input: {
  columns: ClientSortColumns<T, K>;
  current: ClientSort<K>;
  requestedSortBy: unknown;
  requestedSortOrder: SortOrder;
}) => ClientSort<K> = <T, K extends string>(input: {
  columns: ClientSortColumns<T, K>;
  current: ClientSort<K>;
  requestedSortBy: unknown;
  requestedSortOrder: SortOrder;
}): ClientSort<K> => {
  if (!isClientSortKey(input.columns, input.requestedSortBy)) {
    return input.current;
  }

  if (input.requestedSortBy !== input.current.sortBy) {
    return {
      sortBy: input.requestedSortBy,
      sortOrder: input.columns[input.requestedSortBy].firstSortOrder,
    };
  }

  return {
    sortBy: input.requestedSortBy,
    sortOrder: input.requestedSortOrder,
  };
};

/*
 * A sorted copy of the rows. Rows that tie fall back to `tieBreak` - the
 * order the list opens on - always the same way round, so they hold still
 * from one refresh to the next and when the column is flipped.
 */
export const sortClientRows: <
  T extends GenericObject,
  K extends string,
>(input: {
  rows: Array<T>;
  columns: ClientSortColumns<T, K>;
  sort: ClientSort<K>;
  tieBreak: (a: T, b: T) => number;
}) => Array<T> = <T extends GenericObject, K extends string>(input: {
  rows: Array<T>;
  columns: ClientSortColumns<T, K>;
  sort: ClientSort<K>;
  tieBreak: (a: T, b: T) => number;
}): Array<T> => {
  const column: ClientSortColumn<T> = input.columns[input.sort.sortBy];

  const valueOf: (row: T) => unknown = (row: T): unknown => {
    if (column.value) {
      return column.value(row);
    }

    return row[input.sort.sortBy as string as keyof T];
  };

  return [...input.rows].sort((a: T, b: T): number => {
    return (
      compareValues(valueOf(a), valueOf(b), input.sort.sortOrder) ||
      input.tieBreak(a, b)
    );
  });
};
