import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { DiscoveryScanStatus } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const DISCOVERY_REFRESH_INTERVAL_MS: number = 10000;
export const DISCOVERY_REFRESH_TIMEOUT_MS: number = 15000;

function isActive(scan: NetworkDeviceDiscoveryScan): boolean {
  return (
    scan.status === DiscoveryScanStatus.Pending ||
    scan.status === DiscoveryScanStatus.InProgress
  );
}

function getScheduledScanTime(scan: NetworkDeviceDiscoveryScan): number | null {
  if (
    !scan.isRecurring ||
    !scan.nextScanAt ||
    (scan.status !== DiscoveryScanStatus.Completed &&
      scan.status !== DiscoveryScanStatus.Failed)
  ) {
    return null;
  }
  const scheduledAt: number = new Date(scan.nextScanAt).getTime();
  return Number.isFinite(scheduledAt) ? scheduledAt : null;
}

export interface DiscoveryScanLiveUpdates {
  onRowsLoaded: (rows: Array<NetworkDeviceDiscoveryScan>) => void;
  getScan: (scan: NetworkDeviceDiscoveryScan) => NetworkDeviceDiscoveryScan;
  activeCount: number;
  isRefreshing: boolean;
  isPaused: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  refresh: () => Promise<void>;
}

/**
 * Refresh active scans and due recurring scans on the visible page, without
 * replacing table rows or changing the operator's filters and pagination.
 */
export default function useDiscoveryScanLiveUpdates(): DiscoveryScanLiveUpdates {
  const [rows, setRows] = useState<Array<NetworkDeviceDiscoveryScan>>([]);
  const rowsRef: MutableRefObject<Array<NetworkDeviceDiscoveryScan>> = useRef(
    [],
  );
  const generationRef: MutableRefObject<number> = useRef(0);
  const mountedRef: MutableRefObject<boolean> = useRef(true);
  const inFlightRef: MutableRefObject<boolean> = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(document.hidden);
  const [error, setError] = useState<string>("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const onRowsLoaded: DiscoveryScanLiveUpdates["onRowsLoaded"] = useCallback(
    (newRows: Array<NetworkDeviceDiscoveryScan>): void => {
      generationRef.current++;
      rowsRef.current = newRows;
      setRows(newRows);
      setIsPaused(document.hidden);
      setError("");
      setLastRefreshedAt(new Date());
    },
    [],
  );

  const refresh: DiscoveryScanLiveUpdates["refresh"] =
    useCallback(async (): Promise<void> => {
      const now: number = Date.now();
      const refreshableRows: Array<NetworkDeviceDiscoveryScan> =
        rowsRef.current.filter((scan: NetworkDeviceDiscoveryScan): boolean => {
          const scheduledAt: number | null = getScheduledScanTime(scan);
          return isActive(scan) || (scheduledAt !== null && scheduledAt <= now);
        });
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (
        inFlightRef.current ||
        document.hidden ||
        !projectId ||
        refreshableRows.length === 0
      ) {
        return;
      }
      const generation: number = generationRef.current;
      inFlightRef.current = true;
      setIsRefreshing(true);
      try {
        const result: ListResult<NetworkDeviceDiscoveryScan> =
          await ModelAPI.getList<NetworkDeviceDiscoveryScan>({
            modelType: NetworkDeviceDiscoveryScan,
            query: {
              projectId,
              _id: new Includes(
                refreshableRows.map(
                  (scan: NetworkDeviceDiscoveryScan): string => {
                    return scan._id!;
                  },
                ),
              ),
            },
            skip: 0,
            limit: refreshableRows.length,
            sort: {},
            requestOptions: {
              apiRequestOptions: {
                timeout: DISCOVERY_REFRESH_TIMEOUT_MS,
                retries: 0,
              },
            },
            select: {
              _id: true,
              name: true,
              cidr: true,
              status: true,
              statusMessage: true,
              scannedHostCount: true,
              respondedHostCount: true,
              discoveredDevices: true,
              startedAt: true,
              completedAt: true,
              nextScanAt: true,
              isRecurring: true,
              rescanIntervalInMinutes: true,
              isSnmpEnabled: true,
            },
          });
        if (!mountedRef.current || generation !== generationRef.current) {
          return;
        }
        const updates: Map<string, NetworkDeviceDiscoveryScan> = new Map(
          result.data.map(
            (
              scan: NetworkDeviceDiscoveryScan,
            ): [string, NetworkDeviceDiscoveryScan] => {
              return [scan._id!, scan];
            },
          ),
        );
        const updatedRows: Array<NetworkDeviceDiscoveryScan> =
          rowsRef.current.map(
            (scan: NetworkDeviceDiscoveryScan): NetworkDeviceDiscoveryScan => {
              const update: NetworkDeviceDiscoveryScan | undefined =
                updates.get(scan._id!);
              if (!update) {
                return scan;
              }
              // Keep unselected fields (including the probe relation) from the table.
              const merged: NetworkDeviceDiscoveryScan = Object.assign(
                new NetworkDeviceDiscoveryScan(),
                scan,
              );
              for (const key of Object.keys(update)) {
                const value: unknown = (
                  update as unknown as Record<string, unknown>
                )[key];
                if (value !== undefined) {
                  (merged as unknown as Record<string, unknown>)[key] = value;
                }
              }
              return merged;
            },
          );
        rowsRef.current = updatedRows;
        setRows(updatedRows);
        setLastRefreshedAt(new Date());
        setError(
          refreshableRows.some((scan: NetworkDeviceDiscoveryScan): boolean => {
            return !updates.has(scan._id!);
          })
            ? "Some scans are no longer available. Refresh the list to see the latest scans."
            : "",
        );
      } catch (err) {
        if (mountedRef.current && generation === generationRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) {
          setIsRefreshing(false);
        }
      }
    }, []);

  const activeCount: number = rows.filter(isActive).length;
  /*
   * Scheduled runs need a local clock, but no request until nextScanAt is due.
   * Keep them out of activeCount until the server actually queues the next run.
   */
  const hasScansToWatch: boolean = rows.some(
    (scan: NetworkDeviceDiscoveryScan): boolean => {
      return isActive(scan) || getScheduledScanTime(scan) !== null;
    },
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current++;
    };
  }, []);

  useEffect(() => {
    setIsPaused(document.hidden);
    const onVisibilityChange: () => void = (): void => {
      setIsPaused(document.hidden);
      if (!document.hidden) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (!hasScansToWatch) {
      return;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void refresh();
    }, DISCOVERY_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hasScansToWatch, refresh]);

  return {
    onRowsLoaded,
    getScan: (scan: NetworkDeviceDiscoveryScan): NetworkDeviceDiscoveryScan => {
      return (
        rows.find((row: NetworkDeviceDiscoveryScan): boolean => {
          return row._id === scan._id;
        }) || scan
      );
    },
    activeCount,
    isRefreshing,
    isPaused,
    error,
    lastRefreshedAt,
    refresh,
  };
}
