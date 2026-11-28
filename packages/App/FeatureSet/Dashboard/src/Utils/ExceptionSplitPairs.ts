import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ProjectUtil from "Common/UI/Utils/Project";
import { MAX_SCOPED_FINGERPRINTS } from "./ExceptionsAttributeScope";

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

/*
 * THE LIST'S FILTER FOR THEM: SPLIT BY A SCRUB RULE (#11026).
 *
 * The Split pill marks each pair as a person scrolls; the filter lists only
 * them. It lists each pair once, by its split one: the exception the rule's
 * occurrences went to, which records the pair
 * (splitFromTelemetryExceptionId) and whose page offers Merge Exceptions.
 * As every list read, merged exceptions and former fingerprints are left
 * out by the server (hideMergedExceptions), so a pair is no longer listed
 * once it is merged.
 *
 * Only a project that has such an exception needs the filter, and only
 * projects whose scrub rules split exceptions before #10434 have one: the
 * list counts them once as it opens, by the column's partial index, and
 * offers the filter while there are any, or while a link or a saved view
 * asks for it. The number the toggle shows is the list's own: how many of
 * what it shows turning the filter on keeps (countSplitExceptionsInList).
 */

// The URL's word for the filter: `split=scrub-rule`, as `assigned=me`.
export const SPLIT_BY_SCRUB_RULE_PARAM: string = "split";
export const SPLIT_BY_SCRUB_RULE_PARAM_VALUE: string = "scrub-rule";

/*
 * The exceptions the filter lists and the count counts: the project's split
 * ones, in any state, last seen at any time.
 */
export function getSplitExceptionsQuery(): Query<TelemetryException> {
  const query: Query<TelemetryException> = {};
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (projectId) {
    query.projectId = projectId;
  }

  (query as Record<string, unknown>)["splitFromTelemetryExceptionId"] =
    new NotNull();

  return query;
}

/*
 * How many exceptions the filter can list: the project's unmerged split
 * ones, counted once. Null when the count fails: the list then offers no
 * filter, as it offers none to a project that has no split pair.
 */
export async function countSplitExceptions(): Promise<number | null> {
  try {
    return await ModelAPI.count<TelemetryException>({
      modelType: TelemetryException,
      query: getSplitExceptionsQuery(),
    });
  } catch {
    return null;
  }
}

/*
 * WHAT THE TOGGLE COUNTS: WHAT TURNING IT ON LISTS (#11116).
 *
 * The toggle narrows the list under it, which keeps its status, its time
 * window and whatever else narrows it (a search, a facet, Assigned to me,
 * the class lens). Counted over the whole project, it could say 3 while the
 * list it narrows showed fewer. So it counts with the list's own query,
 * the split ones of it - as the Error Class counts read the list's own
 * rows - and its number changes with the list's filters: pressed, it is
 * the list's own total. The project's count above still says whether the
 * project has a pair at all, which is when the toggle is offered.
 */
export function getSplitExceptionsInListQuery(
  listQuery: Query<TelemetryException>,
): Query<TelemetryException> {
  const query: Query<TelemetryException> = { ...listQuery };

  (query as Record<string, unknown>)["splitFromTelemetryExceptionId"] =
    new NotNull();

  return query;
}

// How many the list's query keeps with the filter on. Null when the count fails.
export async function countSplitExceptionsInList(
  listQuery: Query<TelemetryException>,
): Promise<number | null> {
  try {
    return await ModelAPI.count<TelemetryException>({
      modelType: TelemetryException,
      query: getSplitExceptionsInListQuery(listQuery),
    });
  } catch {
    return null;
  }
}

/*
 * WHETHER THE PROJECT HAS A PAIR, REMEMBERED (#11116).
 *
 * The toggle is offered while the project has a split exception, which the
 * list counts as it opens. Drawn only once that count was in, it appeared a
 * moment after the toolbar did and pushed what came after it along (the
 * Sort menu, the time range). So what the last count said is kept for each
 * project - in the page for the visit, in the browser's storage for the
 * next one - and the toolbar draws the toggle at once when it said there
 * were some. The count still decides: one that finds none takes the toggle
 * away and is remembered so. A browser that keeps nothing (a private
 * window, blocked storage) remembers for the visit, as the page does.
 */
const SPLIT_EXCEPTIONS_HINT_KEY_PREFIX: string =
  "exceptions-split-by-scrub-rule-";

const rememberedSplitExceptions: Map<string, boolean> = new Map<
  string,
  boolean
>();

export function getSplitExceptionsHintKey(projectId: string): string {
  return `${SPLIT_EXCEPTIONS_HINT_KEY_PREFIX}${projectId.toLowerCase()}`;
}

/*
 * What the project's last count said: whether it had split exceptions.
 * Null when nothing is remembered.
 */
export function recallSplitExceptions(
  projectId: ObjectID | null | undefined,
): boolean | null {
  if (!projectId) {
    return null;
  }

  const key: string = getSplitExceptionsHintKey(projectId.toString());

  if (rememberedSplitExceptions.has(key)) {
    return rememberedSplitExceptions.get(key) as boolean;
  }

  try {
    const value: unknown = LocalStorage.getItem(key);

    if (value === true || value === "true") {
      return true;
    }

    if (value === false || value === "false") {
      return false;
    }
  } catch {
    // A browser that keeps nothing: nothing is remembered.
  }

  return null;
}

// Keeps what a count of the project's split exceptions said.
export function rememberSplitExceptions(
  projectId: ObjectID | null | undefined,
  hasSome: boolean,
): void {
  if (!projectId) {
    return;
  }

  const key: string = getSplitExceptionsHintKey(projectId.toString());

  rememberedSplitExceptions.set(key, hasSome);

  try {
    LocalStorage.setItem(key, hasSome ? "true" : "false");
  } catch {
    // A browser that keeps nothing still remembers for this visit.
  }
}

// Forgets what this page remembered (tests: one page load each).
export function forgetRememberedSplitExceptions(): void {
  rememberedSplitExceptions.clear();
}

/*
 * What the chart's narrowing reads of the split ones, and of the exceptions
 * merged into them.
 */
export const SPLIT_FINGERPRINT_SELECT: {
  _id: true;
  fingerprint: true;
} = {
  _id: true,
  fingerprint: true,
};

function fingerprintOf(exception: TelemetryException): string {
  return exception.fingerprint?.toString() || "";
}

/*
 * The fingerprints of the occurrences the filtered list counts: its split
 * ones', and those of the exceptions merged into them, whose occurrences
 * keep their own fingerprint and count there (TelemetryExceptionMerge).
 *
 * The chart and the facet counts above the list read occurrences
 * (ExceptionInstance), which know nothing of the pair. With the filter on
 * they are narrowed by these, as an attribute filter narrows them
 * (ExceptionsAttributeScope), so they count what the list lists. Two reads,
 * once: the split ones by their column's partial index, the exceptions
 * merged into them by the merge column's index. The split ones are few
 * (only rules from before #10434 split exceptions), and at most
 * MAX_SCOPED_FINGERPRINTS are read. Throws when a read fails: the chart and
 * the facet counts then say they could not load, never counting every
 * exception under a filter that says otherwise, and the list reads them
 * again on its next change, or on Try again (#11116). Read as empty, a
 * failure left the chart counting nothing until the page was loaded again.
 */
export async function readSplitExceptionFingerprints(): Promise<Array<string>> {
  const splitOnes: ListResult<TelemetryException> =
    await ModelAPI.getList<TelemetryException>({
      modelType: TelemetryException,
      query: getSplitExceptionsQuery(),
      select: SPLIT_FINGERPRINT_SELECT,
      limit: MAX_SCOPED_FINGERPRINTS,
      skip: 0,
      sort: { _id: SortOrder.Ascending },
    });

  const splitIds: Array<string> = Array.from(
    new Set<string>(
      (splitOnes.data || []).map(idOf).filter((id: string): boolean => {
        return id.length > 0;
      }),
    ),
  );

  const mergedIn: ListResult<TelemetryException> | null =
    splitIds.length > 0
      ? await ModelAPI.getList<TelemetryException>({
          modelType: TelemetryException,
          query: {
            mergedIntoTelemetryExceptionId: new Includes(splitIds),
          },
          select: SPLIT_FINGERPRINT_SELECT,
          limit: MAX_SCOPED_FINGERPRINTS,
          skip: 0,
          sort: { _id: SortOrder.Ascending },
        })
      : null;

  return Array.from(
    new Set<string>(
      [...(splitOnes.data || []), ...(mergedIn?.data || [])]
        .map(fingerprintOf)
        .filter((fingerprint: string): boolean => {
          return fingerprint.length > 0;
        }),
    ),
  );
}

/*
 * The fingerprints the chart and the facet counts read occurrences of. An
 * instance scope's (an attribute filter, an entity key or a host's stored
 * query: null when there is none), within the split ones' while the filter
 * is on (null while it is off). Null when nothing narrows them. Empty when
 * the two have none in common, or a read found none: the caller then sends
 * the no-match sentinel, as for an instance scope that matched nothing.
 * Pure, for the tests.
 */
export function getOccurrenceFingerprints(input: {
  scopeFingerprints: ReadonlyArray<string> | null;
  splitFingerprints: ReadonlyArray<string> | null;
}): Array<string> | null {
  if (input.splitFingerprints === null) {
    return input.scopeFingerprints === null
      ? null
      : [...input.scopeFingerprints];
  }

  if (input.scopeFingerprints === null) {
    return [...input.splitFingerprints];
  }

  const split: Set<string> = new Set<string>(input.splitFingerprints);

  return input.scopeFingerprints.filter((fingerprint: string): boolean => {
    return split.has(fingerprint);
  });
}
