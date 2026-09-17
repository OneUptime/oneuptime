import React, { useEffect, useRef } from "react";

export interface LiveLogsRefreshOptions {
  /** Whether the user has switched live mode on. */
  isLive: boolean;
  /**
   * Whether the current view can be refreshed in place. Live tailing only
   * makes sense on the first page sorted newest-first — on page 3, or sorted
   * by severity, "the newest logs" is not what the viewer is showing.
   */
  isEligible: boolean;
  /** How often to poll while live mode is on. */
  intervalInMs: number;
  /** Pull the newest page of logs. */
  refreshLogs: () => void;
  /**
   * Re-run the histogram query. The chart is driven by its own aggregation
   * request rather than by the rows in the table, so it goes stale unless it
   * is refreshed on the same beat as the list.
   */
  refreshHistogram: () => void;
}

export type UseLiveLogsRefreshFunction = (
  options: LiveLogsRefreshOptions,
) => void;

/**
 * Drives the polling loop behind the log viewer's live mode.
 *
 * Every tick refreshes the log list *and* the histogram together. That
 * pairing is the point of this hook: the two come from different endpoints,
 * and refreshing only the list leaves a chart that stops moving while rows
 * keep arriving underneath it.
 *
 * The callbacks are read through refs, so a parent that re-renders (which it
 * does on every poll, as results land) does not tear down and re-arm the
 * timer — that would reset the cadence and fire an extra immediate poll each
 * time. Only the gating flags and the interval restart the loop.
 */
const useLiveLogsRefresh: UseLiveLogsRefreshFunction = (
  options: LiveLogsRefreshOptions,
): void => {
  const { isLive, isEligible, intervalInMs } = options;

  const refreshLogsRef: React.MutableRefObject<() => void> = useRef<() => void>(
    options.refreshLogs,
  );
  const refreshHistogramRef: React.MutableRefObject<() => void> = useRef<
    () => void
  >(options.refreshHistogram);

  /*
   * Declared before the polling effect so the refs are already current by the
   * time that effect (re-)runs — effects fire in declaration order.
   */
  useEffect(() => {
    refreshLogsRef.current = options.refreshLogs;
    refreshHistogramRef.current = options.refreshHistogram;
  });

  useEffect(() => {
    if (!isLive || !isEligible) {
      return;
    }

    const poll: () => void = (): void => {
      refreshLogsRef.current();
      refreshHistogramRef.current();
    };

    // Switching live mode on should show fresh data immediately, not one tick later.
    poll();

    const intervalId: ReturnType<typeof setInterval> = setInterval(
      poll,
      intervalInMs,
    );

    return () => {
      clearInterval(intervalId);
    };
  }, [isLive, isEligible, intervalInMs]);
};

export default useLiveLogsRefresh;
