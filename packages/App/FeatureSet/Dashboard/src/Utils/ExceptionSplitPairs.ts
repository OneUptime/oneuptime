import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHICH EXCEPTIONS OF A LIST ARE A PAIR A SCRUB RULE SPLIT (#10897).
 *
 * Before #10434 a scrub rule that hid part of an exception found in logs
 * split it in two: from the rule on, its occurrences made a new exception,
 * while the one they had been counted in went quiet. Ingest records the pair
 * on the split one (splitFromTelemetryExceptionId), and the exceptions list
 * marks both, so a person tidying up sees each pair at a glance - the split
 * one, and the one it was split from, which says nothing of it itself and
 * is often resolved by then. Each one's page names the other, with Merge
 * Exceptions (ExceptionSplitNotice).
 *
 * A pair is marked while it is one: as on the pages, not once the two are
 * merged, either way, nor when the other cannot be read by this reader.
 */

// The most exceptions split from one page's that are read for it.
export const MAX_EXCEPTIONS_SPLIT_FROM_A_PAGE: number = 200;

// What the list reads of the exceptions split from the rows of a page.
export const SPLIT_ONE_SELECT: {
  _id: true;
  splitFromTelemetryExceptionId: true;
} = {
  _id: true,
  splitFromTelemetryExceptionId: true,
};

// And of the exceptions the rows of a page were split from.
export const SPLIT_FROM_ONE_SELECT: {
  _id: true;
  mergedIntoTelemetryExceptionId: true;
} = {
  _id: true,
  mergedIntoTelemetryExceptionId: true,
};

interface HasId {
  _id?: { toString: () => string } | string | null | undefined;
  id?: { toString: () => string } | null | undefined;
}

// An exception's id as the pairs compare it: lowercase, "" for none.
export function idOf(exception: HasId): string {
  return (exception._id || exception.id)?.toString().toLowerCase() || "";
}

// Another id the same way.
function idText(value: unknown): string {
  return value ? String(value).toLowerCase() : "";
}

/*
 * The rows of a page that are one of a pair a scrub rule split, by id:
 *
 *  - a split one, when the one it was split from could be read and is not
 *    merged into it (`splitFroms`, read by id, so merged ones too);
 *  - one a split one was split from, when such a split one could be read
 *    and is merged into nothing (`splitOnes`, read as the lists read
 *    exceptions, which leave merged ones out).
 *
 * Pure, for the tests.
 */
export function getSplitPairExceptionIds(data: {
  rows: ReadonlyArray<HasId & { splitFromTelemetryExceptionId?: unknown }>;
  splitFroms: ReadonlyArray<
    HasId & { mergedIntoTelemetryExceptionId?: unknown }
  >;
  splitOnes: ReadonlyArray<HasId & { splitFromTelemetryExceptionId?: unknown }>;
}): Set<string> {
  const pairs: Set<string> = new Set<string>();
  const rowIds: Set<string> = new Set<string>(
    data.rows.map(idOf).filter((id: string): boolean => {
      return id.length > 0;
    }),
  );
  const mergedIntoOf: Map<string, string> = new Map<string, string>();

  for (const splitFrom of data.splitFroms) {
    const id: string = idOf(splitFrom);

    if (id) {
      mergedIntoOf.set(id, idText(splitFrom.mergedIntoTelemetryExceptionId));
    }
  }

  for (const row of data.rows) {
    const id: string = idOf(row);
    const splitFromId: string = idText(row.splitFromTelemetryExceptionId);

    if (!id || !splitFromId || splitFromId === id) {
      continue;
    }

    const mergedInto: string | undefined = mergedIntoOf.get(splitFromId);

    if (mergedInto !== undefined && mergedInto !== id) {
      pairs.add(id);
    }
  }

  for (const splitOne of data.splitOnes) {
    const id: string = idOf(splitOne);
    const splitFromId: string = idText(splitOne.splitFromTelemetryExceptionId);

    if (id && splitFromId && splitFromId !== id && rowIds.has(splitFromId)) {
      pairs.add(splitFromId);
    }
  }

  return pairs;
}

/*
 * The rows of a page that are one of a split pair, as the reader may read
 * the other: two small reads, at once, by the indexes the pair has
 * (splitFromTelemetryExceptionId's, and the ids). Best effort: none when
 * they cannot be read, and the rows show as they would without them.
 */
export async function readSplitPairExceptionIds(
  rows: ReadonlyArray<TelemetryException>,
): Promise<Set<string>> {
  const rowIds: Array<string> = Array.from(
    new Set<string>(
      rows.map(idOf).filter((id: string): boolean => {
        return id.length > 0;
      }),
    ),
  );

  if (rowIds.length === 0) {
    return new Set<string>();
  }

  const splitFromIds: Array<string> = Array.from(
    new Set<string>(
      rows
        .map((row: TelemetryException): string => {
          return idText(row.splitFromTelemetryExceptionId);
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        }),
    ),
  );

  try {
    const [splitOnes, splitFroms] = await Promise.all([
      ModelAPI.getList<TelemetryException>({
        modelType: TelemetryException,
        query: { splitFromTelemetryExceptionId: new Includes(rowIds) },
        select: SPLIT_ONE_SELECT,
        limit: MAX_EXCEPTIONS_SPLIT_FROM_A_PAGE,
        skip: 0,
        sort: { _id: SortOrder.Ascending },
      }),
      splitFromIds.length > 0
        ? ModelAPI.getList<TelemetryException>({
            modelType: TelemetryException,
            query: { _id: new Includes(splitFromIds) },
            select: SPLIT_FROM_ONE_SELECT,
            limit: splitFromIds.length,
            skip: 0,
            sort: { _id: SortOrder.Ascending },
          })
        : Promise.resolve({
            data: [],
            count: 0,
            skip: 0,
            limit: 0,
          } as ListResult<TelemetryException>),
    ]);

    return getSplitPairExceptionIds({
      rows,
      splitFroms: splitFroms.data || [],
      splitOnes: splitOnes.data || [],
    });
  } catch {
    return new Set<string>();
  }
}
