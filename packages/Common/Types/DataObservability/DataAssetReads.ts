/*
 * WHEN A TABLE WAS LAST READ, AND WHETHER ANYONE STILL READS IT.
 *
 * Every engine Data Observability reads counts the reads of each table in
 * its own statistics - PostgreSQL's scans, MySQL's performance_schema reads,
 * SQL Server's seeks, scans and lookups, with its last read's time - since
 * its statistics were reset or the server started (the stats epoch). A
 * collection compares the counter with the last one kept: when it moved,
 * the table was read in between. At a table's first collection a counter
 * of 0 says it has not been read since the epoch, so a table nobody reads
 * is known as unused from the start, not after months of watching. The
 * services seen reading a table in their database spans count too
 * (noteObservedRead).
 *
 *  - lastReadAt: the last read seen, to the hour.
 *  - unreadSince: the time from which the table is known to have had no
 *    read: its last read, or the epoch when it has had none since. Null
 *    while that cannot be said: no counter, or reads at unknown times.
 *
 * A table is unused once it has had no read for 90 days. Views keep no
 * counters of their own (their reads are their tables'), so they are never
 * called unused.
 */

// How precisely a read's time is kept: a busy table's row is written at most this often.
export const READ_TIME_PRECISION_IN_SECONDS: number = 60 * 60;

// How long without a read before a table is unused.
export const UNUSED_AFTER_DAYS: number = 90;

export interface DataAssetReadState {
  readCount: number | null;
  lastReadAt: Date | null;
  unreadSince: Date | null;
}

export interface DataAssetReadTracking {
  state: DataAssetReadState;
  // Whether the asset's row must be written to keep it.
  isChanged: boolean;
}

const EMPTY: DataAssetReadState = {
  readCount: null,
  lastReadAt: null,
  unreadSince: null,
};

function sameTime(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return a > b ? a : b;
}

// A read at this time: kept when it is newer than the last one by the precision.
function withRead(state: DataAssetReadState, readAt: Date): DataAssetReadState {
  if (
    state.lastReadAt &&
    readAt.getTime() - state.lastReadAt.getTime() <
      READ_TIME_PRECISION_IN_SECONDS * 1000
  ) {
    return state;
  }

  const lastReadAt: Date = later(state.lastReadAt, readAt)!;

  return { ...state, lastReadAt, unreadSince: lastReadAt };
}

export function trackDataAssetReads(data: {
  previous: DataAssetReadState | null;
  readCount: number | null | undefined;
  secondsSinceRead: number | null | undefined;
  secondsSinceStatsReset: number | null | undefined;
  collectedAt: Date;
}): DataAssetReadTracking {
  const previous: DataAssetReadState = data.previous || EMPTY;
  const count: number | null = data.readCount ?? null;
  const epoch: Date | null =
    data.secondsSinceStatsReset !== null &&
    data.secondsSinceStatsReset !== undefined
      ? new Date(
          data.collectedAt.getTime() - data.secondsSinceStatsReset * 1000,
        )
      : null;
  let state: DataAssetReadState = { ...previous };

  if (data.secondsSinceRead !== null && data.secondsSinceRead !== undefined) {
    // The engine's own time of the last read (SQL Server): no counter to keep.
    state = withRead(
      state,
      new Date(data.collectedAt.getTime() - data.secondsSinceRead * 1000),
    );
  } else if (count !== null) {
    const isFirstCount: boolean = previous.readCount === null;
    const wasReset: boolean =
      previous.readCount !== null && count < previous.readCount;

    if (!isFirstCount && !wasReset && count > previous.readCount!) {
      // Read between the two collections.
      const read: DataAssetReadState = withRead(state, data.collectedAt);

      // Within the hour of the last read kept: the counter waits with it.
      state = read === state ? state : { ...read, readCount: count };
    } else if (isFirstCount || wasReset) {
      state.readCount = count;

      if (count === 0) {
        // Not read since the counters started.
        state.unreadSince = later(
          state.lastReadAt,
          wasReset ? epoch ?? data.collectedAt : epoch,
        );
      } else if (wasReset) {
        // Read since the counters were reset: lately.
        state = { ...withRead(state, data.collectedAt), readCount: count };
      } else {
        // Read since the counters started, when is not known: none can be said before now.
        state.unreadSince = later(state.unreadSince, data.collectedAt);
      }
    }
  }

  return {
    state,
    isChanged:
      state.readCount !== previous.readCount ||
      !sameTime(state.lastReadAt, previous.lastReadAt) ||
      !sameTime(state.unreadSince, previous.unreadSince),
  };
}

// A read seen elsewhere - a service's database span - at this time.
export function noteObservedRead(
  state: DataAssetReadState,
  readAt: Date,
): DataAssetReadTracking {
  const next: DataAssetReadState = withRead(state, readAt);

  return { state: next, isChanged: next !== state };
}

export function isDataAssetUnused(data: {
  unreadSince: Date | null | undefined;
  now: Date;
  days?: number | undefined;
}): boolean {
  if (!data.unreadSince) {
    return false;
  }

  const days: number = data.days ?? UNUSED_AFTER_DAYS;

  return (
    new Date(data.unreadSince).getTime() <=
    data.now.getTime() - days * 24 * 60 * 60 * 1000
  );
}

// The cutoff an unused table's unreadSince is at or before.
export function getUnusedCutoff(now: Date, days?: number | undefined): Date {
  return new Date(
    now.getTime() - (days ?? UNUSED_AFTER_DAYS) * 24 * 60 * 60 * 1000,
  );
}
