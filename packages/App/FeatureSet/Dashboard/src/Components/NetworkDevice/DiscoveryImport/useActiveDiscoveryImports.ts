import {
  DiscoveryImportView,
  isDiscoveryImportActive,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { listActiveDiscoveryImports } from "./DiscoveryImportApi";

/*
 * The project's imports that have not finished, by scan, for the scans
 * table: read when the page opens, again every few seconds while one runs,
 * and on demand when the dialog starts or finishes one. A failed read keeps
 * the last answer: the rows are a convenience, the dialog is the record.
 */

export const ACTIVE_DISCOVERY_IMPORTS_POLL_INTERVAL_MS: number = 4000;

export interface ActiveDiscoveryImports {
  byScanId: Map<string, DiscoveryImportView>;
  refresh: () => void;
}

export function indexActiveImportsByScan(
  imports: ReadonlyArray<DiscoveryImportView>,
): Map<string, DiscoveryImportView> {
  const byScanId: Map<string, DiscoveryImportView> = new Map<
    string,
    DiscoveryImportView
  >();

  // The oldest active import of a scan is the one running; later ones wait.
  for (const view of imports) {
    if (isDiscoveryImportActive(view.status) && !byScanId.has(view.scanId)) {
      byScanId.set(view.scanId, view);
    }
  }

  return byScanId;
}

export default function useActiveDiscoveryImports(): ActiveDiscoveryImports {
  const [byScanId, setByScanId] = useState<Map<string, DiscoveryImportView>>(
    new Map<string, DiscoveryImportView>(),
  );
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const read: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    sequenceRef.current += 1;
    const sequence: number = sequenceRef.current;
    let hasActive: boolean = false;

    try {
      const imports: Array<DiscoveryImportView> =
        await listActiveDiscoveryImports();

      if (!isMountedRef.current || sequence !== sequenceRef.current) {
        return;
      }

      const next: Map<string, DiscoveryImportView> =
        indexActiveImportsByScan(imports);

      setByScanId(next);
      hasActive = next.size > 0;
    } catch {
      if (!isMountedRef.current || sequence !== sequenceRef.current) {
        return;
      }

      // Keep the rows as they were, and look again.
      hasActive = true;
    }

    if (hasActive && isMountedRef.current) {
      timerRef.current = setTimeout(() => {
        void read();
      }, ACTIVE_DISCOVERY_IMPORTS_POLL_INTERVAL_MS);
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

  return { byScanId: byScanId, refresh: refresh };
}
