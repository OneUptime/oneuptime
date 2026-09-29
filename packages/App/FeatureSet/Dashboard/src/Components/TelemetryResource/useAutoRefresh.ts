import {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
} from "Common/Types/Dashboard/DashboardViewConfig";
import { MutableRefObject, useEffect, useRef, useState } from "react";

export interface UseAutoRefreshOptions {
  /*
   * Per-resource localStorage key so each overview page remembers its own
   * auto-refresh choice independently (e.g. a user can keep Services on 30s
   * while leaving Hosts off).
   */
  storageKey: string;
  /*
   * Re-fetches the page's live data. Invoked by the interval timer. The page
   * is expected to refresh in place (no full-page loader) so the view doesn't
   * flicker between ticks.
   */
  onRefresh: () => void;
  // Defaults to 30s when the user has never picked an interval for this key.
  defaultInterval?: AutoRefreshInterval | undefined;
}

export interface UseAutoRefreshResult {
  autoRefreshInterval: AutoRefreshInterval;
  // Updates the interval and persists the choice to localStorage.
  setAutoRefreshInterval: (interval: AutoRefreshInterval) => void;
}

/*
 * Shared auto-refresh scheduling for the telemetry/infrastructure resource
 * overview pages (Services, Cloud, RUM, Serverless, Ceph, Docker Swarm, …).
 * Owns the interval state, its localStorage persistence, and the timer that
 * fires onRefresh. The page keeps ownership of its own loading/last-refreshed
 * state so the indicator can reflect exactly when its fetch finished.
 */
const useAutoRefresh: (
  options: UseAutoRefreshOptions,
) => UseAutoRefreshResult = (
  options: UseAutoRefreshOptions,
): UseAutoRefreshResult => {
  const { storageKey, onRefresh } = options;
  const defaultInterval: AutoRefreshInterval =
    options.defaultInterval ?? AutoRefreshInterval.THIRTY_SECONDS;

  const [autoRefreshInterval, setAutoRefreshIntervalState] =
    useState<AutoRefreshInterval>(() => {
      if (typeof window === "undefined") {
        return defaultInterval;
      }
      const stored: string | null =
        window.localStorage?.getItem(storageKey) ?? null;
      if (
        stored &&
        (Object.values(AutoRefreshInterval) as Array<string>).includes(stored)
      ) {
        return stored as AutoRefreshInterval;
      }
      return defaultInterval;
    });

  /*
   * Keep a stable ref to onRefresh. The interval re-arms only when the chosen
   * interval changes, so without the ref the timer would keep calling the
   * first render's closure (with a stale time range / state setters). Updating
   * the ref every render lets us swap intervals without tearing down the
   * timer on every parent re-render.
   */
  const onRefreshRef: MutableRefObject<() => void> =
    useRef<() => void>(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      onRefreshRef.current();
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval]);

  const setAutoRefreshInterval: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshIntervalState(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(storageKey, interval);
    }
  };

  return { autoRefreshInterval, setAutoRefreshInterval };
};

export default useAutoRefresh;
