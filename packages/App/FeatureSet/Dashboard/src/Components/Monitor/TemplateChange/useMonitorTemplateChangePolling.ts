import {
  MonitorTemplateChangeView,
  isMonitorTemplateChangeActive,
} from "Common/Types/Monitor/MonitorTemplateChange";
import API from "Common/UI/Utils/API/API";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getMonitorTemplateChange } from "./MonitorTemplateChangeApi";

/*
 * Keeps one change's view current while it runs (issues #11260, #11266):
 * asks the server every two seconds, a little slower after a failed ask, not
 * at all while the tab is hidden, and stops once the change is done. A
 * response that arrives after the dialog moved to another change is dropped.
 * The discovery import's progress is read the same way
 * (useDiscoveryImportPolling).
 */

export const MONITOR_TEMPLATE_CHANGE_POLL_INTERVAL_MS: number = 2000;
export const MONITOR_TEMPLATE_CHANGE_POLL_RETRY_MS: number = 5000;

export interface MonitorTemplateChangePolling {
  view: MonitorTemplateChangeView | null;
  // The last ask failed; the view is the last one that arrived.
  error: string | null;
  setView: (view: MonitorTemplateChangeView | null) => void;
  refresh: () => Promise<void>;
}

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

export default function useMonitorTemplateChangePolling(data: {
  changeId: string | null;
  // Told once when the change it watches finishes.
  onFinished?: ((view: MonitorTemplateChangeView) => void) | undefined;
}): MonitorTemplateChangePolling {
  const [view, setViewState] = useState<MonitorTemplateChangeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinishedRef: React.MutableRefObject<
    ((view: MonitorTemplateChangeView) => void) | undefined
  > = useRef<((view: MonitorTemplateChangeView) => void) | undefined>(
    data.onFinished,
  );
  const reportedFinishedRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const changeIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(data.changeId);

  onFinishedRef.current = data.onFinished;
  changeIdRef.current = data.changeId;

  const clearTimer: () => void = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const report: (next: MonitorTemplateChangeView) => void = useCallback(
    (next: MonitorTemplateChangeView): void => {
      if (
        !isMonitorTemplateChangeActive(next.status) &&
        reportedFinishedRef.current !== next.id
      ) {
        reportedFinishedRef.current = next.id;
        onFinishedRef.current?.(next);
      }
    },
    [],
  );

  const poll: () => Promise<void> = useCallback(async (): Promise<void> => {
    const changeId: string | null = changeIdRef.current;

    clearTimer();

    if (!changeId) {
      return;
    }

    sequenceRef.current += 1;
    const sequence: number = sequenceRef.current;
    let nextDelay: number | null = null;

    try {
      const next: MonitorTemplateChangeView =
        await getMonitorTemplateChange(changeId);

      if (
        sequence !== sequenceRef.current ||
        changeIdRef.current !== changeId
      ) {
        return;
      }

      setViewState(next);
      setError(null);
      report(next);

      if (isMonitorTemplateChangeActive(next.status)) {
        nextDelay = MONITOR_TEMPLATE_CHANGE_POLL_INTERVAL_MS;
      }
    } catch (err) {
      if (
        sequence !== sequenceRef.current ||
        changeIdRef.current !== changeId
      ) {
        return;
      }

      setError(API.getFriendlyMessage(err));
      nextDelay = MONITOR_TEMPLATE_CHANGE_POLL_RETRY_MS;
    }

    if (nextDelay !== null && !isDocumentHidden()) {
      timerRef.current = setTimeout(() => {
        void poll();
      }, nextDelay);
    }
  }, [clearTimer, report]);

  // A new change to watch starts fresh, with one ask straight away.
  useEffect(() => {
    sequenceRef.current += 1;
    clearTimer();

    if (!data.changeId) {
      return;
    }

    void poll();

    return () => {
      sequenceRef.current += 1;
      clearTimer();
    };
  }, [data.changeId, poll, clearTimer]);

  // Asks again when a hidden tab comes back, if the change still runs.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const onVisibilityChange: () => void = (): void => {
      if (!isDocumentHidden() && changeIdRef.current && !timerRef.current) {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [poll]);

  const setView: (next: MonitorTemplateChangeView | null) => void = useCallback(
    (next: MonitorTemplateChangeView | null): void => {
      setViewState(next);

      if (next) {
        report(next);
      }
    },
    [report],
  );

  return {
    view: view,
    error: error,
    setView: setView,
    refresh: poll,
  };
}
