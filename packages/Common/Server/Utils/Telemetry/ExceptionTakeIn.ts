/*
 * WHAT AN EXCEPTION TAKES IN WHEN ANOTHER BECOMES PART OF IT.
 *
 * Two things make one exception count what another counted:
 *
 *   - a person merging an exception into another as the same bug
 *     (TelemetryExceptionMerge);
 *   - two copies of one exception becoming one, when the two copies of the
 *     resource they belong to merge - a host a race made twice
 *     (ExceptionTwinMerge, run by DuplicateRowMerge).
 *
 * Both add up the same way, here, so they never drift apart: the occurrences
 * counted, the first and last seen with the release each was seen in, and
 * whether any occurrence escaped uncaught. The first and last seen are the
 * earliest and the latest of all, each with its own release; a release that
 * is not known never replaces one that is.
 *
 * And both take back the same way: a count given back is subtracted, never
 * below zero.
 */

// What an exception counted, as its row holds it.
export interface ExceptionCounts {
  occuranceCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstSeenInRelease: string | null;
  lastSeenInRelease: string | null;
  unhandled: boolean;
}

// What one exception takes in from others, added up.
export interface ExceptionTakeIn {
  occuranceCount: number;
  firstSeenAt: Date | null;
  // Empty when no release is known.
  firstSeenInRelease: string;
  lastSeenAt: Date | null;
  lastSeenInRelease: string;
  unhandled: boolean;
}

// A statement and its parameters, for a QueryRunner or an EntityManager.
export interface ExceptionTakeInStatement {
  query: string;
  parameters: Array<unknown>;
}

// The table, as SQL, when the caller names none.
const TELEMETRY_EXCEPTION_TABLE: string = `"TelemetryException"`;

export const NOTHING_TAKEN_IN: ExceptionTakeIn = {
  occuranceCount: 0,
  firstSeenAt: null,
  firstSeenInRelease: "",
  lastSeenAt: null,
  lastSeenInRelease: "",
  unhandled: false,
};

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return (
    Boolean(a) &&
    Boolean(b) &&
    new Date(a!).getTime() === new Date(b!).getTime()
  );
}

/*
 * `total` with `other` taken in as well: its count - or `occuranceCount`,
 * when only part of what it counted joins (an exception merged into
 * another, whose own occurrences are all it brings) - its seen times and
 * their releases, and whether it was unhandled. Pure.
 */
export function takeIn(
  total: ExceptionTakeIn,
  other: ExceptionCounts,
  occuranceCount: number = other.occuranceCount,
): ExceptionTakeIn {
  const result: ExceptionTakeIn = { ...total };

  result.occuranceCount =
    total.occuranceCount + Math.max(0, Number(occuranceCount) || 0);

  result.firstSeenAt = earliest(total.firstSeenAt, other.firstSeenAt);

  if (
    other.firstSeenInRelease &&
    sameDate(result.firstSeenAt, other.firstSeenAt)
  ) {
    result.firstSeenInRelease = other.firstSeenInRelease;
  }

  result.lastSeenAt = latest(total.lastSeenAt, other.lastSeenAt);

  if (
    other.lastSeenInRelease &&
    sameDate(result.lastSeenAt, other.lastSeenAt)
  ) {
    result.lastSeenInRelease = other.lastSeenInRelease;
  }

  result.unhandled = total.unhandled || Boolean(other.unhandled);

  return result;
}

/*
 * The statement that makes exception `exceptionId` take `takenIn` in: its
 * count grows by it, its first and last seen move to the earliest and the
 * latest, each release with them, and it is unhandled if either was.
 * Postgres reads every SET expression against the row as it was, so each
 * release is decided against the seen time before it moves.
 */
export function getTakeInStatement(data: {
  exceptionId: string;
  takenIn: ExceptionTakeIn;
  // As SQL, quoted; "TelemetryException" when not named.
  table?: string | undefined;
}): ExceptionTakeInStatement {
  return {
    query: `UPDATE ${data.table || TELEMETRY_EXCEPTION_TABLE} SET
              "occuranceCount" = COALESCE("occuranceCount", 0) + $1,
              "firstSeenInRelease" = CASE
                WHEN $2::text <> '' AND ("firstSeenAt" IS NULL OR $3::timestamptz < "firstSeenAt") THEN $2::text
                ELSE "firstSeenInRelease" END,
              "lastSeenInRelease" = CASE
                WHEN $4::text <> '' AND ("lastSeenAt" IS NULL OR $5::timestamptz > "lastSeenAt") THEN $4::text
                ELSE "lastSeenInRelease" END,
              "firstSeenAt" = LEAST("firstSeenAt", $3::timestamptz),
              "lastSeenAt" = GREATEST("lastSeenAt", $5::timestamptz),
              "unhandled" = COALESCE("unhandled", false) OR $6::boolean,
              "updatedAt" = now()
            WHERE "_id" = $7`,
    parameters: [
      data.takenIn.occuranceCount,
      data.takenIn.firstSeenInRelease,
      data.takenIn.firstSeenAt,
      data.takenIn.lastSeenInRelease,
      data.takenIn.lastSeenAt,
      data.takenIn.unhandled,
      data.exceptionId,
    ],
  };
}

/*
 * The statement that takes `occuranceCount` back off exception
 * `exceptionId` - what an exception that leaves it counted - never below
 * zero. Its seen times stay: what is left cannot be told apart from what
 * went without reading the occurrences.
 */
export function getTakeBackStatement(data: {
  exceptionId: string;
  occuranceCount: number;
  table?: string | undefined;
}): ExceptionTakeInStatement {
  return {
    query: `UPDATE ${data.table || TELEMETRY_EXCEPTION_TABLE} SET "occuranceCount" = GREATEST(0, COALESCE("occuranceCount", 0) - $1), "updatedAt" = now() WHERE "_id" = $2`,
    parameters: [
      Math.max(0, Number(data.occuranceCount) || 0),
      data.exceptionId,
    ],
  };
}
