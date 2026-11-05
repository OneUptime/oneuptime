import SortOrder from "../BaseDatabase/SortOrder";

/*
 * THE NEXT PAGE OF A LIST, FROM THE LAST ROW OF THIS ONE.
 *
 * A list at offset 190,000 of a cloud's 200,000 instances makes Postgres walk 190,000 rows to throw
 * them away, which took 3.4 seconds where the same page found from its last row took a tenth of a
 * millisecond. So a table moving one page at a time says where it got to, and the server seeks
 * from there. A person jumping to a page they have not been through has no last row to go by, so
 * that one read still goes by offset. Exporting or selecting a whole list moves a page at a time,
 * so it gets the same.
 *
 * In one place so the page that asks and the server that answers agree on what can be sought.
 */

export interface OpenStackListSeek {
  // What the list is sorted by. `_id` breaks ties, because names are not unique.
  column: string;
  // That column's value on the last row of the page before, and that row's ID.
  value: string | number | null;
  id: string;
  // What a read last counted: a count is a scan of the whole kind, and adds nothing to a seek.
  count: number;
}

export type OpenStackListSeekValue = string | number | null;

// A value a list can be sought by, as text or a number, or nothing when it cannot.
export function toOpenStackListSeekValue(
  value: unknown,
): OpenStackListSeekValue | undefined {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return undefined;
}

export function isOpenStackListSeek(
  value: unknown,
): value is OpenStackListSeek {
  const seek: Partial<OpenStackListSeek> | null =
    value && typeof value === "object"
      ? (value as Partial<OpenStackListSeek>)
      : null;

  return Boolean(
    seek &&
      typeof seek.column === "string" &&
      typeof seek.id === "string" &&
      typeof seek.count === "number" &&
      seek.count >= 0 &&
      (seek.value === null ||
        typeof seek.value === "string" ||
        typeof seek.value === "number"),
  );
}

/*
 * The sort a page reads by, so a page sought and a page by offset put rows in the same order. The
 * one column and `_id`, or null for a sort that cannot be sought.
 */
export function getOpenStackListSeekSort(
  sort: Record<string, unknown>,
): { column: string; order: SortOrder } | null {
  const columns: Array<string> = Object.keys(sort).filter(
    (column: string): boolean => {
      return column !== "_id";
    },
  );

  if (columns.length !== 1) {
    return null;
  }

  const order: unknown = sort[columns[0] as string];

  return order === SortOrder.Ascending || order === SortOrder.Descending
    ? { column: columns[0] as string, order: order }
    : null;
}
