import {
  DiscoveryImportView,
  isDiscoveryImportActive,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import API from "Common/UI/Utils/API/API";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getDiscoveryImport } from "./DiscoveryImportApi";

/*
 * Keeps one import's view current while it runs: asks the server every two
 * seconds, a little slower after a failed ask, not at all while the tab is
 * hidden, and stops once the import is done. A response that arrives after
 * the dialog moved to another import is dropped.
 */

export const DISCOVERY_IMPORT_POLL_INTERVAL_MS: number = 2000;
export const DISCOVERY_IMPORT_POLL_RETRY_MS: number = 5000;

export interface DiscoveryImportPolling {
  view: DiscoveryImportView | null;
  // The last ask failed; the view is the last one that arrived.
  error: string | null;
  setView: (view: DiscoveryImportView | null) => void;
  refresh: () => Promise<void>;
}

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

export default function useDiscoveryImportPolling(data: {
  importId: string | null;
  // Told once when the import it watches finishes.
  onFinished?: ((view: DiscoveryImportView) => void) | undefined;
}): DiscoveryImportPolling {
  const [view, setViewState] = useState<DiscoveryImportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinishedRef: React.MutableRefObject<
    ((view: DiscoveryImportView) => void) | undefined
  > = useRef<((view: DiscoveryImportView) => void) | undefined>(
    data.onFinished,
  );
  const reportedFinishedRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const importIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(data.importId);

  onFinishedRef.current = data.onFinished;
  importIdRef.current = data.importId;

  const clearTimer: () => void = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const report: (next: DiscoveryImportView) => void = useCallback(
    (next: DiscoveryImportView): void => {
      if (
        !isDiscoveryImportActive(next.status) &&
        reportedFinishedRef.current !== next.id
      ) {
        reportedFinishedRef.current = next.id;
        onFinishedRef.current?.(next);
      }
    },
    [],
  );

  const poll: () => Promise<void> = useCallback(async (): Promise<void> => {
    const importId: string | null = importIdRef.current;

    clearTimer();

    if (!importId) {
      return;
    }

    sequenceRef.current += 1;
    const sequence: number = sequenceRef.current;
    let nextDelay: number | null = null;

    try {
      const next: DiscoveryImportView = await getDiscoveryImport(importId);

      if (
        sequence !== sequenceRef.current ||
        importIdRef.current !== importId
      ) {
        return;
      }

      setViewState(next);
      setError(null);
      report(next);

      if (isDiscoveryImportActive(next.status)) {
        nextDelay = DISCOVERY_IMPORT_POLL_INTERVAL_MS;
      }
    } catch (err) {
      if (
        sequence !== sequenceRef.current ||
        importIdRef.current !== importId
      ) {
        return;
      }

      setError(API.getFriendlyMessage(err));
      nextDelay = DISCOVERY_IMPORT_POLL_RETRY_MS;
    }

    if (nextDelay !== null && !isDocumentHidden()) {
      timerRef.current = setTimeout(() => {
        void poll();
      }, nextDelay);
    }
  }, [clearTimer, report]);

  // A new import to watch starts fresh, with one ask straight away.
  useEffect(() => {
    sequenceRef.current += 1;
    clearTimer();

    if (!data.importId) {
      return;
    }

    void poll();

    return () => {
      sequenceRef.current += 1;
      clearTimer();
    };
  }, [data.importId, poll, clearTimer]);

  // Asks again when a hidden tab comes back, if the import still runs.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const onVisibilityChange: () => void = (): void => {
      if (!isDocumentHidden() && importIdRef.current && !timerRef.current) {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [poll]);

  const setView: (next: DiscoveryImportView | null) => void = useCallback(
    (next: DiscoveryImportView | null): void => {
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
