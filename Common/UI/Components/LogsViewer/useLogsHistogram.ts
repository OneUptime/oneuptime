import React, { useCallback, useEffect, useRef, useState } from "react";
import { HistogramBucket } from "./types";

export interface LogsHistogramRefreshOptions {
  /**
   * A background refresh: no loader, no blanking on failure, and no stacking
   * if the previous one has not come back yet. This is what live mode uses.
   */
  silent?: boolean | undefined;
}

export interface LogsHistogramState {
  buckets: Array<HistogramBucket>;
  isLoading: boolean;
  refresh: (options?: LogsHistogramRefreshOptions) => Promise<void>;
}

export type FetchHistogramBucketsFunction = () => Promise<
  Array<HistogramBucket>
>;

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
  const [buckets, setBuckets] = useState<Array<HistogramBucket>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const silentRequestInFlight: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

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
          setBuckets(await fetchBuckets());
        } catch {
          // The histogram is non-critical; degrade rather than fail the page.
          if (!isSilent) {
            setBuckets([]);
          }
        } finally {
          if (isSilent) {
            silentRequestInFlight.current = false;
          } else {
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
    buckets: buckets,
    isLoading: isLoading,
    refresh: refresh,
  };
};

export default useLogsHistogram;
