import React, { useCallback, useEffect, useRef, useState } from "react";
import { HistogramBucket } from "./types";

export interface LogsHistogramRefreshOptions {
  /**
   * A background refresh: no loader, no blanking on failure, and no stacking
   * if the previous one has not come back yet. This is what live mode uses.
   */
  silent?: boolean | undefined;
}

export interface LogsHistogramData {
  buckets: Array<HistogramBucket>;
  /*
   * How much time one bucket covers, as the query bucketed it. It travels
   * with the buckets it describes so the chart never pairs one window's
   * bars with another window's width.
   */
  bucketIntervalMs?: number | undefined;
}

export interface LogsHistogramState {
  buckets: Array<HistogramBucket>;
  /** Width of one bucket in `buckets`; undefined when the query did not say. */
  bucketIntervalMs: number | undefined;
  isLoading: boolean;
  refresh: (options?: LogsHistogramRefreshOptions) => Promise<void>;
}

/*
 * A bare array is a query that does not report its bucket width; the chart
 * still draws it, but can only zoom from one bar's start to another's.
 */
export type FetchHistogramBucketsFunction = () => Promise<
  Array<HistogramBucket> | LogsHistogramData
>;

const EMPTY_HISTOGRAM: LogsHistogramData = { buckets: [] };

function toHistogramData(
  result: Array<HistogramBucket> | LogsHistogramData,
): LogsHistogramData {
  if (Array.isArray(result)) {
    return { buckets: result };
  }

  return {
    buckets: result.buckets || [],
    bucketIntervalMs: result.bucketIntervalMs,
  };
}

export type UseLogsHistogramFunction = (
  fetchBuckets: FetchHistogramBucketsFunction,
) => LogsHistogramState;

/**
 * Owns the log histogram's data, loading flag and refresh loop.
 *
 * The chart is fed by its own aggregation query rather than by the rows in
 * the table, so it needs refreshing in its own right — including on every
 * live-mode tick. A poll is a *silent* refresh, which is what keeps live mode
 * from looking broken:
 *
 * - it does not raise the loading flag, so the chart does not flash a loader
 *   every few seconds;
 * - it keeps the buckets already on screen if the request fails, so one bad
 *   response does not blank the chart;
 * - it is dropped while an earlier poll is still running, so a slow
 *   aggregation cannot pile requests up behind it.
 *
 * `fetchBuckets` doubles as the query identity: hand over a new callback (a
 * new time range, filter or scope) and the histogram reloads.
 */
const useLogsHistogram: UseLogsHistogramFunction = (
  fetchBuckets: FetchHistogramBucketsFunction,
): LogsHistogramState => {
  const [histogram, setHistogram] =
    useState<LogsHistogramData>(EMPTY_HISTOGRAM);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const silentRequestInFlight: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * The query the viewer is on right now. A request that comes back after the
   * reader has moved to another time range or filter is dropped rather than
   * painted over the window they are actually looking at.
   */
  const currentQuery: React.MutableRefObject<FetchHistogramBucketsFunction> =
    useRef<FetchHistogramBucketsFunction>(fetchBuckets);

  useEffect(() => {
    currentQuery.current = fetchBuckets;
  }, [fetchBuckets]);

  const refresh: (options?: LogsHistogramRefreshOptions) => Promise<void> =
    useCallback(
      async (options: LogsHistogramRefreshOptions = {}): Promise<void> => {
        const isSilent: boolean = options.silent === true;

        if (isSilent) {
          if (silentRequestInFlight.current) {
            return;
          }

          silentRequestInFlight.current = true;
        } else {
          setIsLoading(true);
        }

        try {
          const next: LogsHistogramData = toHistogramData(await fetchBuckets());

          if (currentQuery.current === fetchBuckets) {
            setHistogram(next);
          }
        } catch {
          // The histogram is non-critical; degrade rather than fail the page.
          if (!isSilent && currentQuery.current === fetchBuckets) {
            setHistogram(EMPTY_HISTOGRAM);
          }
        } finally {
          if (isSilent) {
            silentRequestInFlight.current = false;
          } else if (currentQuery.current === fetchBuckets) {
            setIsLoading(false);
          }
        }
      },
      [fetchBuckets],
    );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    buckets: histogram.buckets,
    bucketIntervalMs: histogram.bucketIntervalMs,
    isLoading: isLoading,
    refresh: refresh,
  };
};

export default useLogsHistogram;
