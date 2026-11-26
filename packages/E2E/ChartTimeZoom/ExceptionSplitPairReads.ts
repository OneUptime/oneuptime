/*
 * THE SMALL READS AN EXCEPTIONS LIST MAKES OF EACH PAGE IT DRAWS (#10897).
 *
 * Once a page's rows are in, the exceptions list reads the exceptions a scrub
 * rule split from those rows - by splitFromTelemetryExceptionId, their ids
 * and that column alone - and, of rows that were split from another, that
 * other one - by id, whether it is merged - so that both halves of a pair
 * say Split (the Dashboard's Utils/ExceptionSplitPairs,
 * readSplitPairExceptionIds). Each is a getList of TelemetryException, as
 * the list's own read is: a spec that counts the list's reads, or reads the
 * list's query, tells them apart by what they select.
 */

// The columns of a select, in one order.
function columnsOf(select: Record<string, unknown>): string {
  return Object.keys(select).sort().join();
}

// What each of the two reads selects (SPLIT_ONE_SELECT, SPLIT_FROM_ONE_SELECT).
const SPLIT_PAIR_SELECTS: ReadonlyArray<string> = [
  columnsOf({ _id: true, splitFromTelemetryExceptionId: true }),
  columnsOf({ _id: true, mergedIntoTelemetryExceptionId: true }),
];

export interface ExceptionRead {
  select?: Record<string, unknown> | null | undefined;
}

// Whether a recorded read is one of the list's split-pair reads.
export function isSplitPairRead(read: ExceptionRead): boolean {
  return SPLIT_PAIR_SELECTS.includes(columnsOf(read.select || {}));
}

/*
 * The ids of the rows a split-pair read asks about: the exceptions split
 * from them (`splitFromTelemetryExceptionId` in the ids), or the ones they
 * were split from (`_id` in the ids).
 */
export function splitPairReadIds(read: {
  query?: Record<string, unknown> | null | undefined;
}): Array<string> {
  const condition: unknown =
    read.query?.["splitFromTelemetryExceptionId"] || read.query?.["_id"];
  const values: unknown = (condition as { value?: unknown } | undefined)?.value;

  return Array.isArray(values)
    ? values
        .map((value: unknown): string => {
          return String(value);
        })
        .sort()
    : [];
}
