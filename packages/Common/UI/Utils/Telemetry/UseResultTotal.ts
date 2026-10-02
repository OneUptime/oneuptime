import React, { useEffect, useRef, useState } from "react";
import ResultTotalUtil, {
  ResultTotal,
  ResultTotalListPage,
  ResultTotalStatus,
} from "./ResultTotal";

// A page the list committed, and the query it was fetched with.
export interface ResultTotalListAnswer<TQuery> {
  query: TQuery;
  page: ResultTotalListPage;
}

export interface UseResultTotalOptions<TQuery> {
  /*
   * The list's query. A new object is a new result set: its total is worked
   * out afresh. Keep it memoized — a query rebuilt on every render would be
   * counted on every render.
   */
  query: TQuery;
  /*
   * The newest page the list committed. Only a page fetched with `query`
   * says anything about its total; until one arrives the total is counting.
   */
  listAnswer: ResultTotalListAnswer<TQuery> | null;
  // Counts every row `query` matches. Rejects when it cannot.
  countRows: (query: TQuery) => Promise<number>;
  /*
   * False while the list is not on screen (an explorer's analytics view):
   * nothing is counted for a total nobody can see.
   */
  isEnabled?: boolean | undefined;
  /*
   * Bump to count the same query again — the Refresh button, a live poll.
   * The last total stays on screen until the new one lands, so a live view
   * does not flash "Counting" on every beat.
   */
  refreshKey?: number | undefined;
}

interface CountedTotal<TQuery> {
  query: TQuery;
  refreshKey: number;
  total: ResultTotal;
}

interface CountRequest<TQuery> {
  query: TQuery;
  sequence: number;
}

/*
 * The total of a telemetry explorer's result set (see ResultTotal). A list
 * page that ends the list proves it outright, so most narrow searches never
 * ask for a count; otherwise the rows are counted once per query, apart from
 * the list, so a slow count never holds the list back.
 */
export default function useResultTotal<TQuery>(
  options: UseResultTotalOptions<TQuery>,
): ResultTotal {
  const isEnabled: boolean = options.isEnabled ?? true;
  const refreshKey: number = options.refreshKey ?? 0;

  const [counted, setCounted] = useState<CountedTotal<TQuery> | null>(null);

  const inFlightRef: React.MutableRefObject<CountRequest<TQuery> | null> =
    useRef<CountRequest<TQuery> | null>(null);
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  // Usually an inline arrow: read the newest one without re-running on it.
  const countRowsRef: React.MutableRefObject<
    (query: TQuery) => Promise<number>
  > = useRef<(query: TQuery) => Promise<number>>(options.countRows);
  countRowsRef.current = options.countRows;

  const page: ResultTotalListPage | null =
    options.listAnswer && options.listAnswer.query === options.query
      ? options.listAnswer.page
      : null;

  const provenTotal: number | null = page
    ? ResultTotalUtil.getTotalProvenByPage(page)
    : null;

  const needsCount: boolean =
    isEnabled && page !== null && provenTotal === null;

  const isUpToDate: boolean = Boolean(
    counted &&
      counted.query === options.query &&
      counted.refreshKey === refreshKey,
  );

  useEffect(() => {
    if (!needsCount || isUpToDate) {
      return;
    }

    /*
     * One count per query at a time. A refresh that lands while one is out
     * waits for it rather than replacing it: on a count slower than the live
     * poll, replacing would drop every answer. Its landing re-runs this
     * effect, which then counts again for the newer refresh.
     */
    if (inFlightRef.current && inFlightRef.current.query === options.query) {
      return;
    }

    const query: TQuery = options.query;
    const requestedRefreshKey: number = refreshKey;
    const sequence: number = ++sequenceRef.current;

    inFlightRef.current = { query, sequence };

    const commit: (total: ResultTotal) => void = (total: ResultTotal): void => {
      // A newer query asked meanwhile: its count is the one that matters.
      if (sequenceRef.current !== sequence) {
        return;
      }

      inFlightRef.current = null;
      setCounted({ query, refreshKey: requestedRefreshKey, total });
    };

    let request: Promise<number>;

    // A count that throws before it starts is a failed count, not a crash.
    try {
      request = countRowsRef.current(query);
    } catch (error) {
      request = Promise.reject(error);
    }

    request.then(
      (count: number) => {
        commit({ status: ResultTotalStatus.Exact, count });
      },
      (error: unknown) => {
        commit({
          status: ResultTotalStatus.Unavailable,
          unavailableReason: ResultTotalUtil.getUnavailableReason(error),
        });
      },
    );
  }, [needsCount, isUpToDate, options.query, refreshKey]);

  if (!page) {
    return { status: ResultTotalStatus.Counting };
  }

  if (provenTotal !== null) {
    return { status: ResultTotalStatus.Exact, count: provenTotal };
  }

  if (!counted || counted.query !== options.query) {
    return { status: ResultTotalStatus.Counting };
  }

  if (counted.total.status === ResultTotalStatus.Exact) {
    // Current, or the last one standing in while a refresh recounts.
    return {
      status: ResultTotalStatus.Exact,
      count: ResultTotalUtil.reconcileCount(counted.total.count || 0, page),
    };
  }

  // A failure is only shown for the refresh it answered.
  return isUpToDate ? counted.total : { status: ResultTotalStatus.Counting };
}
