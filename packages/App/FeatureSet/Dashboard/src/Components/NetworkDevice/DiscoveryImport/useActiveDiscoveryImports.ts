import { DiscoveryImportView } from "Common/Types/NetworkDevice/DiscoveryImport";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveDiscoveredDeviceImports,
  indexActiveImportsByScan,
} from "./DiscoveryImportActive";
import { listActiveDiscoveryImports } from "./DiscoveryImportApi";

// React-free, for App's tests (DiscoveryImportActive); re-exported here.
export { getActiveDiscoveredDeviceImports, indexActiveImportsByScan };

/*
 * The project's imports that have not finished, by scan, for the scans
 * table - and the Discovered Devices list's, which have no scan (issue
 * #5775), for its page: read when the page opens, again every few seconds while one runs,
 * and on demand when the dialog starts or finishes one. A failed read keeps
 * the last answer and looks again more slowly while that answer had an
 * import running - and not at all when it had none, so a server that cannot
 * answer is not asked every few seconds for nothing: the rows are a
 * convenience, the dialog is the record.
 */

export const ACTIVE_DISCOVERY_IMPORTS_POLL_INTERVAL_MS: number = 4000;
export const ACTIVE_DISCOVERY_IMPORTS_RETRY_MS: number = 15000;

export interface ActiveDiscoveryImports {
  byScanId: Map<string, DiscoveryImportView>;
  // Imports of rows of the Discovered Devices list, oldest first.
  fromDiscoveredDevices: Array<DiscoveryImportView>;
  refresh: () => void;
}

export default function useActiveDiscoveryImports(): ActiveDiscoveryImports {
  const [byScanId, setByScanId] = useState<Map<string, DiscoveryImportView>>(
    new Map<string, DiscoveryImportView>(),
  );
  const [fromDiscoveredDevices, setFromDiscoveredDevices] = useState<
    Array<DiscoveryImportView>
  >([]);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);
  // The last answer's size, for a failed read to decide whether to look again.
  const lastActiveCountRef: React.MutableRefObject<number> = useRef<number>(0);

  const read: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    sequenceRef.current += 1;
    const sequence: number = sequenceRef.current;
    let nextDelay: number | null = null;

    try {
      const imports: Array<DiscoveryImportView> =
        await listActiveDiscoveryImports();

      if (!isMountedRef.current || sequence !== sequenceRef.current) {
        return;
      }

      const next: Map<string, DiscoveryImportView> =
        indexActiveImportsByScan(imports);

      const fromList: Array<DiscoveryImportView> =
        getActiveDiscoveredDeviceImports(imports);

      setByScanId(next);
      setFromDiscoveredDevices(fromList);
      lastActiveCountRef.current = next.size + fromList.length;

      if (lastActiveCountRef.current > 0) {
        nextDelay = ACTIVE_DISCOVERY_IMPORTS_POLL_INTERVAL_MS;
      }
    } catch {
      if (!isMountedRef.current || sequence !== sequenceRef.current) {
        return;
      }

      // Keep the rows as they were; look again, slowly, only if one ran.
      if (lastActiveCountRef.current > 0) {
        nextDelay = ACTIVE_DISCOVERY_IMPORTS_RETRY_MS;
      }
    }

    if (nextDelay !== null && isMountedRef.current) {
      timerRef.current = setTimeout(() => {
        void read();
      }, nextDelay);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void read();

    return () => {
      isMountedRef.current = false;
      sequenceRef.current += 1;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [read]);

  const refresh: () => void = useCallback((): void => {
    void read();
  }, [read]);

  return {
    byScanId: byScanId,
    fromDiscoveredDevices: fromDiscoveredDevices,
    refresh: refresh,
  };
}
