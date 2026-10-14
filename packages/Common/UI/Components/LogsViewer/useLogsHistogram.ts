import React, { useCallback, useEffect, useRef, useState } from "react";
import { HistogramBucket } from "./types";
import TelemetryLoadErrorUtil, {
  TelemetryLoadError,
} from "../../Utils/Telemetry/TelemetryLoadError";

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
  /*
   * Why the last load failed — a search stopped at the time limit, or any
   * other failure — until the next one succeeds (issue #4707). The chart
   * says so in its card instead of vanishing as if the window held nothing.
   */
  error: TelemetryLoadError | undefined;
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

export interface UseLogsHistogramOptions {
  /*
   * False holds the request back: the caller does not know yet which query
   * it will show (the logs explorer waiting for a saved view to apply on
   * load, issue #4709). The chart reads as loading meanwhile, since a
   * request will follow, and the query handed over when this turns true is
   * the one fetched - once, not the one before it and then that one.
   * Defaults to true.
   */
  isEnabled?: boolean | undefined;
}

export type UseLogsHistogramFunction = (
  fetchBuckets: FetchHistogramBucketsFunction,
  options?: UseLogsHistogramOptions | undefined,
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
 *   response does not blank the chart, and raises no error;
 * - it is dropped while an earlier poll is still running, so a slow
 *   aggregation cannot pile requests up behind it.
 *
 * `fetchBuckets` doubles as the query identity: hand over a new callback (a
 * new time range, filter or scope) and the histogram reloads.
 */
const useLogsHistogram: UseLogsHistogramFunction = (
  fetchBuckets: FetchHistogramBucketsFunction,
  options?: UseLogsHistogramOptions | undefined,
): LogsHistogramState => {
  const isEnabled: boolean = options?.isEnabled ?? true;

  const [histogram, setHistogram] =
    useState<LogsHistogramData>(EMPTY_HISTOGRAM);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<TelemetryLoadError | undefined>(undefined);

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
          setError(undefined);
        }

        try {
          const next: LogsHistogramData = toHistogramData(await fetchBuckets());

          if (currentQuery.current === fetchBuckets) {
            setHistogram(next);
            setError(undefined);
          }
        } catch (err) {
          /*
           * The histogram is non-critical: it never fails the page. It says
           * why it is missing, in its own card.
           */
          if (!isSilent && currentQuery.current === fetchBuckets) {
            setHistogram(EMPTY_HISTOGRAM);
            setError(TelemetryLoadErrorUtil.fromError(err));
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
    if (!isEnabled) {
      return;
    }

    void refresh();
  }, [refresh, isEnabled]);

  return {
    buckets: histogram.buckets,
    bucketIntervalMs: histogram.bucketIntervalMs,
    // Held back, the chart is waiting for its first request.
    isLoading: isLoading || !isEnabled,
    error: error,
    refresh: refresh,
  };
};

export default useLogsHistogram;
